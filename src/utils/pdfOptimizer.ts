import { PDFDocument, PDFName, PDFNumber, PDFDict, PDFRawStream, PDFRef } from 'pdf-lib';
import { parsePageRanges } from './formatters';
import { deflateBytes } from './pdfImageDecode';

export type PdfCompressionEngine = 'lossless' | 'smart-vector' | 'high-dpi-raster';

export interface LosslessOptimizeOptions {
  stripMetadata?: boolean;
  stripThumbnails?: boolean;
  stripAnnotations?: boolean;
  stripOutlines?: boolean;
  flattenForms?: boolean;
  pageRange?: string;
}

export interface LosslessOptimizeResult {
  bytes: Uint8Array;
  pagesKept: number;
  thumbnailsRemoved: number;
  annotationsRemoved: number;
  metadataStripped: boolean;
  outlinesRemoved: boolean;
  formsFlattened: boolean;
  streamsCompressed: number;
  duplicatesRemoved: number;
  pieceInfoRemoved: number;
}

/** Deterministic fingerprint of parameters so UIs know immediately when settings changed */
export function computeParamSignature(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  return JSON.stringify(
    keys.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = params[k];
      return acc;
    }, {})
  );
}

/** Compute clean byte & percentage savings telemetry */
export function computeCompressionDelta(origBytes: number, outBytes: number): {
  savedBytes: number;
  savedPct: number;
  improved: boolean;
} {
  const savedBytes = origBytes - outBytes;
  const savedPct = origBytes > 0 ? Number(((savedBytes / origBytes) * 100).toFixed(1)) : 0;
  return {
    savedBytes,
    savedPct,
    improved: outBytes < origBytes,
  };
}

/** Fast concurrent batch worker pool with pause and cancellation checks */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  controls?: {
    isCancelled?: () => boolean;
    isPaused?: () => boolean;
    onItemDone?: (index: number, result: R) => void;
    onItemError?: (index: number, error: unknown) => void;
  }
): Promise<Array<R | undefined>> {
  const count = items.length;
  const results = new Array<R | undefined>(count);
  const maxWorkers = Math.max(1, Math.min(concurrency, count || 1));
  let cursor = 0;

  const waitWhilePaused = async () => {
    while (controls?.isPaused?.() && !controls?.isCancelled?.()) {
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  const runners = Array.from({ length: maxWorkers }, async () => {
    while (true) {
      await waitWhilePaused();
      if (controls?.isCancelled?.()) return;
      const idx = cursor++;
      if (idx >= count) return;
      try {
        const res = await worker(items[idx], idx);
        results[idx] = res;
        controls?.onItemDone?.(idx, res);
      } catch (err) {
        controls?.onItemError?.(idx, err);
      }
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Pure lossless PDF structural optimizer.
 * Never rasterizes pages or text — keeps 100% vector text, fonts, and sharp paths intact
 * while pruning unused objects, Adobe PieceInfo blobs, page thumbnails, XMP metadata streams,
 * Flate-compressing uncompressed streams, and deduplicating repeated identical streams.
 */
export async function optimizePdfStructureLossless(
  bytes: Uint8Array,
  options: LosslessOptimizeOptions = {}
): Promise<LosslessOptimizeResult> {
  const {
    stripMetadata = true,
    stripThumbnails = true,
    stripAnnotations = false,
    stripOutlines = false,
    flattenForms = true,
    pageRange = '',
  } = options;

  const src = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  let formsFlattened = false;
  if (flattenForms) {
    try {
      const form = src.getForm();
      if (form.getFields().length > 0) {
        form.flatten();
        formsFlattened = true;
      }
    } catch {
      // PDF has no interactive AcroForm
    }
  }

  const total = src.getPageCount();
  const keep = parsePageRanges(pageRange, total);

  // Fresh document copies ONLY referenced pages & live resources, pruning dead/orphaned objects automatically
  const outDoc = await PDFDocument.create();
  const copiedPages = await outDoc.copyPages(
    src,
    keep.map((p) => p - 1)
  );

  let thumbnailsRemoved = 0;
  let annotationsRemoved = 0;
  let pieceInfoRemoved = 0;

  for (const page of copiedPages) {
    if (stripThumbnails && page.node.has(PDFName.of('Thumb'))) {
      page.node.delete(PDFName.of('Thumb'));
      thumbnailsRemoved++;
    }
    if (stripAnnotations && page.node.has(PDFName.of('Annots'))) {
      page.node.delete(PDFName.of('Annots'));
      annotationsRemoved++;
    }
    if (stripMetadata && page.node.has(PDFName.of('Metadata'))) {
      page.node.delete(PDFName.of('Metadata'));
    }
    if (page.node.has(PDFName.of('PieceInfo'))) {
      page.node.delete(PDFName.of('PieceInfo'));
      pieceInfoRemoved++;
    }
    outDoc.addPage(page);
  }

  if (outDoc.catalog.has(PDFName.of('PieceInfo'))) {
    outDoc.catalog.delete(PDFName.of('PieceInfo'));
    pieceInfoRemoved++;
  }

  let outlinesRemoved = false;
  if (stripOutlines && outDoc.catalog.has(PDFName.of('Outlines'))) {
    outDoc.catalog.delete(PDFName.of('Outlines'));
    outlinesRemoved = true;
  }

  if (stripMetadata) {
    if (outDoc.catalog.has(PDFName.of('Metadata'))) {
      outDoc.catalog.delete(PDFName.of('Metadata'));
    }
    outDoc.setTitle('');
    outDoc.setAuthor('');
    outDoc.setSubject('');
    outDoc.setKeywords([]);
    outDoc.setCreator('');
    outDoc.setProducer('');
  } else {
    // Preserve original document info cleanly without adding app branding
    const title = src.getTitle();
    const author = src.getAuthor();
    const subject = src.getSubject();
    if (title) outDoc.setTitle(title);
    if (author) outDoc.setAuthor(author);
    if (subject) outDoc.setSubject(subject);
  }

  // Losslessly Flate-compress any uncompressed content/font/raw streams (>= 256 bytes)
  let streamsCompressed = 0;
  try {
    streamsCompressed = await compressUncompressedStreamsLossless(outDoc);
  } catch {
    // Non-fatal lossless pass
  }

  // Deduplicate identical raw streams (e.g. repeated logos/images/fonts across copied pages)
  let duplicatesRemoved = 0;
  try {
    duplicatesRemoved = deduplicateIdenticalStreams(outDoc);
  } catch {
    // Safe non-fatal optimization
  }

  const saved = new Uint8Array(
    await outDoc.save({
      useObjectStreams: true,
      objectsPerTick: 100,
    })
  );

  return {
    bytes: saved,
    pagesKept: copiedPages.length,
    thumbnailsRemoved,
    annotationsRemoved,
    metadataStripped: stripMetadata,
    outlinesRemoved,
    formsFlattened,
    streamsCompressed,
    duplicatesRemoved,
    pieceInfoRemoved,
  };
}

/** Losslessly Flate-compress uncompressed PDFRawStream objects (content streams, embedded fonts, raw vectors/bitmaps) */
async function compressUncompressedStreamsLossless(doc: PDFDocument): Promise<number> {
  if (typeof CompressionStream === 'undefined') return 0;
  const ctx = doc.context;
  const targets: { ref: PDFRef; stream: PDFRawStream }[] = [];

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.has(PDFName.of('Filter'))) continue;
    if (obj.contents.length < 256) continue;
    // Skip XRef / Metadata streams just in case
    const type = obj.dict.get(PDFName.of('Type'));
    if (type === PDFName.of('XRef') || type === PDFName.of('Metadata')) continue;
    targets.push({ ref, stream: obj });
  }

  if (targets.length === 0) return 0;

  let compressedCount = 0;
  await runWithConcurrency(targets, 4, async ({ ref, stream }) => {
    const deflated = await deflateBytes(stream.contents);
    if (deflated.byteLength > 0 && deflated.byteLength < stream.contents.byteLength * 0.94) {
      const newDict = stream.dict.clone(ctx);
      newDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      newDict.set(PDFName.of('Length'), PDFNumber.of(deflated.byteLength));
      ctx.assign(ref, PDFRawStream.of(newDict, deflated));
      compressedCount++;
    }
  });

  return compressedCount;
}

function quickHashBytes(data: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const step = data.length > 4096 ? Math.floor(data.length / 2048) : 1;
  for (let i = 0; i < data.length; i += step) {
    const b = data[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= b ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${data.length}:${h1 >>> 0}:${h2 >>> 0}`;
}

/** Deduplicate identical large Image XObject streams across pages to shrink multi-page PDFs losslessly */
function deduplicateIdenticalStreams(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Map<string, { ref: PDFRef; contents: Uint8Array }>();
  const replacements = new Map<PDFRef, PDFRef>();

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype !== PDFName.of('Image')) continue;
    if (obj.contents.length < 2048) continue;

    const w = obj.dict.get(PDFName.of('Width'))?.toString() || '';
    const h = obj.dict.get(PDFName.of('Height'))?.toString() || '';
    const filter = obj.dict.get(PDFName.of('Filter'))?.toString() || '';
    const cs = obj.dict.get(PDFName.of('ColorSpace'))?.toString() || '';
    const smask = obj.dict.get(PDFName.of('SMask'))?.toString() || '';
    const key = `${w}x${h}|${filter}|${cs}|${smask}|${quickHashBytes(obj.contents)}`;

    const existing = seen.get(key);
    if (existing && existing.contents.length === obj.contents.length) {
      let exact = true;
      for (let i = 0; i < obj.contents.length; i++) {
        if (obj.contents[i] !== existing.contents[i]) {
          exact = false;
          break;
        }
      }
      if (exact) {
        replacements.set(ref, existing.ref);
        continue;
      }
    }
    seen.set(key, { ref, contents: obj.contents });
  }

  if (replacements.size === 0) return 0;

  // Rewrite XObject dictionary references to point to the canonical image ref
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    for (const [k, v] of obj.entries()) {
      if (v instanceof PDFRef && replacements.has(v)) {
        obj.set(k, replacements.get(v)!);
      }
    }
  }

  for (const dupRef of replacements.keys()) {
    ctx.delete(dupRef);
  }
  return replacements.size;
}
