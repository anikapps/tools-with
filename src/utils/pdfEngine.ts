import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, rgb, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import { parsePageRanges, parseSplitSpec, safeBase } from './formatters';
import { canvasToBlob, loadImageFile } from './download';
import { optimizePdfStructureLossless, runWithConcurrency } from './pdfOptimizer';
import { inflateBytes, rawPixelsToRgba, unpredictPngScanlines } from './pdfImageDecode';

// Configure bundled PDF.js worker (zero external CDN dependency)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface PdfInspection {
  pageCount: number;
  sizeBytes: number;
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  hasFormFields: boolean;
  formFieldCount: number;
  pageDimensions: { page: number; widthPt: number; heightPt: number }[];
}

export async function openPdfJs(bytes: Uint8Array) {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  return await loadingTask.promise;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let formFieldCount = 0;
  try {
    formFieldCount = doc.getForm().getFields().length;
  } catch {
    formFieldCount = 0;
  }
  const pages = doc.getPages();
  return {
    pageCount: pages.length,
    sizeBytes: bytes.byteLength,
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    hasFormFields: formFieldCount > 0,
    formFieldCount,
    pageDimensions: pages.map((p, idx) => {
      const { width, height } = p.getSize();
      return { page: idx + 1, widthPt: Math.round(width), heightPt: Math.round(height) };
    }),
  };
}

export async function renderPdfPageToCanvas(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale = 1.25,
  intent: 'display' | 'print' = 'display'
): Promise<HTMLCanvasElement> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas, intent }).promise;
  return canvas;
}

export function isCanvasMostlyBlank(canvas: HTMLCanvasElement, whiteThreshold = 0.992): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let nearWhite = 0;
  const total = canvas.width * canvas.height;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 246 && data[i + 1] > 246 && data[i + 2] > 246) nearWhite++;
  }
  return nearWhite / total >= whiteThreshold;
}

export async function detectWhitespaceMargins(canvas: HTMLCanvasElement): Promise<{
  topPct: number;
  rightPct: number;
  bottomPct: number;
  leftPct: number;
}> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { topPct: 0, rightPct: 0, bottomPct: 0, leftPct: 0 };
  const w = canvas.width;
  const h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let foundInk = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx] < 245 || data[idx + 1] < 245 || data[idx + 2] < 245) {
        foundInk = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!foundInk) return { topPct: 0, rightPct: 0, bottomPct: 0, leftPct: 0 };
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  return {
    leftPct: Math.round((minX / w) * 100),
    topPct: Math.round((minY / h) * 100),
    rightPct: Math.round(((w - 1 - maxX) / w) * 100),
    bottomPct: Math.round(((h - 1 - maxY) / h) * 100),
  };
}

function applyCanvasPostProcess(
  srcCanvas: HTMLCanvasElement,
  mode: 'color' | 'grayscale' | 'bw-scan',
  sharpenText = false
): HTMLCanvasElement {
  if (mode === 'color' && !sharpenText) return srcCanvas;
  const out = document.createElement('canvas');
  out.width = srcCanvas.width;
  out.height = srcCanvas.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(srcCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;

  if (mode !== 'color') {
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = mode === 'bw-scan' ? (lum > 172 ? 255 : lum < 92 ? 0 : lum * 0.72) : lum;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

  // Subtle unsharp contrast boost keeps scanned text crisp and readable
  if (sharpenText && out.width > 4 && out.height > 4) {
    const src = new Uint8ClampedArray(d);
    const w = out.width;
    const h = out.height;
    const amount = 0.35;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const center = src[idx + c];
          const avg =
            (src[idx - 4 + c] +
              src[idx + 4 + c] +
              src[idx - w * 4 + c] +
              src[idx + w * 4 + c]) *
            0.25;
          const sharp = center + (center - avg) * amount;
          d[idx + c] = sharp < 0 ? 0 : sharp > 255 ? 255 : sharp;
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

async function decodeJpegBytesToCanvas(
  jpegBytes: Uint8Array,
  maxPx: number,
  grayscale: boolean
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;
  const blob = new Blob([jpegBytes as unknown as BlobPart], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (grayscale) ctx.filter = 'grayscale(100%)';
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeFlateOrRawImageToCanvas(
  stream: PDFRawStream,
  ctx: PDFDocument['context'],
  maxPx: number,
  grayscale: boolean,
  preserveExactDims: boolean
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;

  const wObj = stream.dict.get(PDFName.of('Width'));
  const hObj = stream.dict.get(PDFName.of('Height'));
  const bpcObj = stream.dict.get(PDFName.of('BitsPerComponent'));
  const width = wObj instanceof PDFNumber ? wObj.asNumber() : 0;
  const height = hObj instanceof PDFNumber ? hObj.asNumber() : 0;
  const bpc = bpcObj instanceof PDFNumber ? bpcObj.asNumber() : 8;
  if (width < 24 || height < 24 || bpc !== 8) return null;
  if (width * height > 24_000_000) return null; // safety cap for ultra-giant rasters

  const csObj = ctx.lookup(stream.dict.get(PDFName.of('ColorSpace')));
  let components: 1 | 3 | 0 = 0;
  if (csObj === PDFName.of('DeviceRGB')) components = 3;
  else if (csObj === PDFName.of('DeviceGray')) components = 1;
  else return null;

  const filter = stream.dict.get(PDFName.of('Filter'));
  let raw: Uint8Array | null = null;
  if (!filter) {
    raw = stream.contents;
  } else if (filter === PDFName.of('FlateDecode')) {
    const inflated = await inflateBytes(stream.contents);
    if (!inflated) return null;
    const dpObj = ctx.lookup(stream.dict.get(PDFName.of('DecodeParms')));
    let predictor = 1;
    if (dpObj instanceof PDFDict) {
      const predVal = dpObj.get(PDFName.of('Predictor'));
      if (predVal instanceof PDFNumber) predictor = predVal.asNumber();
    }
    if (predictor >= 10 && predictor <= 15) {
      raw = unpredictPngScanlines(inflated, width, height, components, bpc);
    } else if (predictor === 1) {
      raw = inflated;
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!raw) return null;
  const rgba = rawPixelsToRgba(raw, width, height, components);
  if (!rgba) return null;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d')!;
  const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  srcCtx.putImageData(imgData, 0, 0);

  const scale = preserveExactDims ? 1 : Math.min(1, maxPx / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  if (outW === width && outH === height && !grayscale) {
    return { canvas: srcCanvas, width: outW, height: outH };
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  if (grayscale) outCtx.filter = 'grayscale(100%)';
  outCtx.drawImage(srcCanvas, 0, 0, outW, outH);
  return { canvas: outCanvas, width: outW, height: outH };
}

/**
 * High-speed parallel in-place optimizer for embedded Image XObjects inside a PDF.
 * Handles BOTH JPEG (DCTDecode) AND lossless FlateDecode / uncompressed RGB & Grayscale bitmaps
 * (including transparent PNGs with SMask!) while keeping 100% of vector text, fonts, tables,
 * hyperlinks, and vector paths completely untouched and razor-sharp.
 */
async function recompressEmbeddedImagesVectorSafe(
  baseBytes: Uint8Array,
  options: {
    imageQuality: number;
    imageMaxPx: number;
    grayscale?: boolean;
    minImageBytes?: number;
  },
  onProgress?: (pct: number, note: string) => void
): Promise<{ bytes: Uint8Array; imagesOptimized: number; bytesSavedFromImages: number }> {
  const { imageQuality, imageMaxPx, grayscale = false, minImageBytes = 6 * 1024 } = options;
  const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;

  // Track SMask refs so we never convert an alpha channel mask into RGB JPEG
  const smaskRefs = new Set<PDFRef>();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const sm = obj.dict.get(PDFName.of('SMask'));
    if (sm instanceof PDFRef) smaskRefs.add(sm);
  }

  interface CandidateImage {
    ref: PDFRef;
    stream: PDFRawStream;
    kind: 'dct' | 'flate-or-raw';
    hasSmask: boolean;
  }

  const candidates: CandidateImage[] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (smaskRefs.has(ref)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype !== PDFName.of('Image')) continue;
    // Skip 1-bit stencil masks
    if (obj.dict.get(PDFName.of('ImageMask'))?.toString() === 'true') continue;
    if (obj.contents.length < minImageBytes) continue;

    const filter = obj.dict.get(PDFName.of('Filter'));
    const hasSmask = Boolean(obj.dict.get(PDFName.of('SMask')));
    if (filter === PDFName.of('DCTDecode')) {
      candidates.push({ ref, stream: obj, kind: 'dct', hasSmask });
    } else if (!filter || filter === PDFName.of('FlateDecode')) {
      candidates.push({ ref, stream: obj, kind: 'flate-or-raw', hasSmask });
    }
  }

  if (candidates.length === 0) {
    return { bytes: baseBytes, imagesOptimized: 0, bytesSavedFromImages: 0 };
  }

  let completed = 0;
  let imagesOptimized = 0;
  let bytesSavedFromImages = 0;

  interface ReplacementResult {
    ref: PDFRef;
    stream: PDFRawStream;
    reencodedBytes: Uint8Array;
    width: number;
    height: number;
    saved: number;
  }

  const processed = await runWithConcurrency<CandidateImage, ReplacementResult | null>(
    candidates,
    4,
    async (cand) => {
      const targetMaxPx = cand.hasSmask ? 100_000 : imageMaxPx;
      const targetQuality = cand.hasSmask ? Math.max(imageQuality, 0.86) : imageQuality;

      const decoded =
        cand.kind === 'dct'
          ? await decodeJpegBytesToCanvas(cand.stream.contents, targetMaxPx, grayscale)
          : await decodeFlateOrRawImageToCanvas(cand.stream, ctx, targetMaxPx, grayscale, cand.hasSmask);

      completed++;
      onProgress?.(
        25 + Math.round((completed / candidates.length) * 62),
        `Optimizing embedded graphic ${completed}/${candidates.length} (vector text 100% lossless)...`
      );

      if (!decoded) return null;
      const reencodedBlob = await canvasToBlob(decoded.canvas, 'image/jpeg', targetQuality);
      const reencodedBytes = new Uint8Array(await reencodedBlob.arrayBuffer());

      // Only replace if strictly smaller by at least 5%
      if (reencodedBytes.byteLength < cand.stream.contents.byteLength * 0.95) {
        return {
          ref: cand.ref,
          stream: cand.stream,
          reencodedBytes,
          width: decoded.width,
          height: decoded.height,
          saved: cand.stream.contents.byteLength - reencodedBytes.byteLength,
        };
      }
      return null;
    }
  );

  for (const item of processed) {
    if (!item) continue;
    const newDict = item.stream.dict.clone(ctx);
    newDict.set(PDFName.of('Width'), PDFNumber.of(item.width));
    newDict.set(PDFName.of('Height'), PDFNumber.of(item.height));
    newDict.set(PDFName.of('Length'), PDFNumber.of(item.reencodedBytes.byteLength));
    newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
    newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    newDict.delete(PDFName.of('DecodeParms'));
    ctx.assign(item.ref, PDFRawStream.of(newDict, item.reencodedBytes));
    imagesOptimized++;
    bytesSavedFromImages += item.saved;
  }

  if (imagesOptimized === 0) {
    return { bytes: baseBytes, imagesOptimized: 0, bytesSavedFromImages: 0 };
  }

  const outBytes = new Uint8Array(await doc.save({ useObjectStreams: true, objectsPerTick: 100 }));
  return { bytes: outBytes, imagesOptimized, bytesSavedFromImages };
}

export async function compressPdf(
  bytes: Uint8Array,
  options: {
    mode: 'lossless' | 'smart-vector' | 'high-dpi-raster' | 'auto' | 'smart' | 'raster';
    quality?: number; // 0.35 .. 0.95
    dpiScale?: number; // 1.4 .. 3.0 (100 .. 216 DPI)
    imageMaxPx?: number; // max px for embedded photos in smart-vector mode
    targetKb?: number;
    colorMode?: 'color' | 'grayscale' | 'bw-scan';
    stripMetadata?: boolean;
    stripThumbnails?: boolean;
    stripAnnotations?: boolean;
    stripOutlines?: boolean;
    flattenForms?: boolean;
    sharpenText?: boolean;
    pageRange?: string;
  },
  onProgress?: (pct: number, note: string) => void
): Promise<{
  bytes: Uint8Array;
  modeUsed: string;
  note: string;
  imagesOptimized?: number;
  streamsCompressed?: number;
  duplicatesRemoved?: number;
}> {
  const {
    mode = 'smart-vector',
    quality = 0.82,
    dpiScale = 2.0,
    imageMaxPx = 1800,
    targetKb = 0,
    colorMode = 'color',
    stripMetadata = true,
    stripThumbnails = true,
    stripAnnotations = false,
    stripOutlines = false,
    flattenForms = true,
    sharpenText = true,
    pageRange = '',
  } = options;

  const runLossless = async () => {
    return optimizePdfStructureLossless(bytes, {
      stripMetadata,
      stripThumbnails,
      stripAnnotations,
      stripOutlines,
      flattenForms,
      pageRange,
    });
  };

  const runRaster = async (q: number, scale: number) => {
    const safeScale = Math.max(1.5, scale); // Minimum ~108 DPI so text stays crisp & legible
    const pdfJs = await openPdfJs(bytes);
    try {
      const keep = parsePageRanges(pageRange, pdfJs.numPages);
      let doneCount = 0;

      const renderedPages = await runWithConcurrency(
        keep,
        3,
        async (pNum) => {
          const page = await pdfJs.getPage(pNum);
          const origVp = page.getViewport({ scale: 1 });
          const rawCanvas = await renderPdfPageToCanvas(pdfJs, pNum, safeScale, 'print');
          const proc = applyCanvasPostProcess(rawCanvas, colorMode, sharpenText);
          const jpgBlob = await canvasToBlob(proc, 'image/jpeg', q);
          const jpgBytes = new Uint8Array(await jpgBlob.arrayBuffer());
          doneCount++;
          onProgress?.(
            Math.round((doneCount / keep.length) * 90),
            `Rendered crisp page ${doneCount}/${keep.length} at ${Math.round(safeScale * 72)} DPI...`
          );
          return { jpgBytes, width: origVp.width, height: origVp.height };
        }
      );

      const outDoc = await PDFDocument.create();
      for (const item of renderedPages) {
        if (!item) continue;
        const embedded = await outDoc.embedJpg(item.jpgBytes);
        const pdfPage = outDoc.addPage([item.width, item.height]);
        pdfPage.drawImage(embedded, {
          x: 0,
          y: 0,
          width: item.width,
          height: item.height,
        });
      }
      return new Uint8Array(await outDoc.save({ useObjectStreams: true, objectsPerTick: 100 }));
    } finally {
      await pdfJs.cleanup();
    }
  };

  // 1) Pure Lossless Mode (100% crisp vector text, zero rasterization ever)
  if (mode === 'lossless') {
    onProgress?.(40, 'Deflating raw streams, deduplicating images & pruning unused objects...');
    const res = await runLossless();
    onProgress?.(100, 'Lossless optimization complete');
    const extras: string[] = [];
    if (res.streamsCompressed > 0) extras.push(`${res.streamsCompressed} streams Flate-compressed`);
    if (res.duplicatesRemoved > 0) extras.push(`${res.duplicatesRemoved} duplicate images merged`);
    if (res.pieceInfoRemoved > 0) extras.push('Adobe bloat stripped');
    if (res.thumbnailsRemoved > 0) extras.push(`${res.thumbnailsRemoved} thumbnails stripped`);
    if (res.annotationsRemoved > 0) extras.push(`${res.annotationsRemoved} annotation blocks removed`);
    if (res.formsFlattened) extras.push('forms flattened');
    if (res.metadataStripped) extras.push('metadata cleaned');
    return {
      bytes: res.bytes,
      modeUsed: 'Lossless Vector-Safe',
      streamsCompressed: res.streamsCompressed,
      duplicatesRemoved: res.duplicatesRemoved,
      note:
        extras.length > 0
          ? `100% sharp vector text preserved (${extras.join(', ')}).`
          : '100% sharp vector text & fonts preserved cleanly.',
    };
  }

  // 2) Target Size KB Mode — tries Lossless -> Smart Vector (JPEG + FlateDecode photos) -> High-DPI Raster only if needed
  if (targetKb > 0) {
    onProgress?.(12, `Checking lossless pass against ${targetKb} KB target...`);
    const lossless = await runLossless();
    if (lossless.bytes.byteLength / 1024 <= targetKb) {
      return {
        bytes: lossless.bytes,
        modeUsed: `Target ${targetKb} KB (Lossless Vector)`,
        streamsCompressed: lossless.streamsCompressed,
        duplicatesRemoved: lossless.duplicatesRemoved,
        note: `Hit target at ${(lossless.bytes.byteLength / 1024).toFixed(1)} KB with 100% sharp vector text.`,
      };
    }

    onProgress?.(25, 'Compressing embedded PNG & JPEG graphics in-place (text untouched)...');
    const vectorTry = await recompressEmbeddedImagesVectorSafe(lossless.bytes, {
      imageQuality: Math.min(quality, 0.72),
      imageMaxPx: Math.min(imageMaxPx, 1500),
      grayscale: colorMode !== 'color',
    });
    if (vectorTry.bytes.byteLength / 1024 <= targetKb) {
      return {
        bytes: vectorTry.bytes,
        modeUsed: `Target ${targetKb} KB (Smart Vector)`,
        imagesOptimized: vectorTry.imagesOptimized,
        streamsCompressed: lossless.streamsCompressed,
        duplicatesRemoved: lossless.duplicatesRemoved,
        note: `Hit ${(vectorTry.bytes.byteLength / 1024).toFixed(1)} KB (${vectorTry.imagesOptimized} embedded images shrunk, vector text 100% sharp).`,
      };
    }

    // Fallback to readable High-DPI raster binary search
    let lo = 0.44;
    let hi = 0.92;
    let bestBytes = vectorTry.bytes;
    for (let iter = 0; iter < 4; iter++) {
      const mid = (lo + hi) / 2;
      const scale = mid < 0.55 ? Math.max(1.55, Math.min(dpiScale, 1.75)) : Math.max(1.75, dpiScale);
      onProgress?.(45 + iter * 13, `Tuning readable DPI pass ${iter + 1}/4 for ${targetKb} KB...`);
      const attempt = await runRaster(mid, scale);
      bestBytes = attempt;
      if (attempt.byteLength / 1024 > targetKb) hi = mid - 0.03;
      else lo = mid + 0.03;
      if (Math.abs(attempt.byteLength / 1024 - targetKb) < Math.max(14, targetKb * 0.07)) break;
    }
    return {
      bytes: bestBytes,
      modeUsed: `Target Size (${targetKb} KB)`,
      note: `Tuned to ${(bestBytes.byteLength / 1024).toFixed(1)} KB with readable DPI floor.`,
    };
  }

  // 3) Explicit High-DPI Crisp Raster / Grayscale / B&W Scan Mode
  if (mode === 'high-dpi-raster' || mode === 'raster' || colorMode !== 'color') {
    const out = await runRaster(quality, dpiScale);
    return {
      bytes: out,
      modeUsed:
        colorMode === 'bw-scan'
          ? 'Crisp B&W Scan'
          : colorMode === 'grayscale'
            ? 'Crisp Grayscale Render'
            : 'High-DPI Crisp Raster',
      note: `Rendered at ${Math.round(Math.max(1.5, dpiScale) * 72)} DPI, q=${Math.round(quality * 100)}%${sharpenText ? ', text sharpen on' : ''}`,
    };
  }

  // 4) 'smart-vector' / 'auto' / 'smart': Lossless structure + parallel in-place JPEG/FlateDecode image shrink (NEVER blurs text!)
  onProgress?.(14, 'Running lossless structural optimization & stream compression...');
  const lossless = await runLossless();
  const smart = await recompressEmbeddedImagesVectorSafe(
    lossless.bytes,
    {
      imageQuality: quality,
      imageMaxPx,
      grayscale: false,
    },
    onProgress
  );
  onProgress?.(100, 'Optimization complete');

  const structuralBits: string[] = [];
  if (lossless.streamsCompressed > 0) structuralBits.push(`${lossless.streamsCompressed} raw streams deflated`);
  if (lossless.duplicatesRemoved > 0) structuralBits.push(`${lossless.duplicatesRemoved} duplicates merged`);
  if (lossless.pieceInfoRemoved > 0) structuralBits.push('Adobe bloat stripped');

  if (smart.imagesOptimized > 0 && smart.bytes.byteLength < lossless.bytes.byteLength) {
    const extra = structuralBits.length ? ` · ${structuralBits.join(', ')}` : '';
    return {
      bytes: smart.bytes,
      modeUsed: 'Smart Vector + Photo Engine',
      imagesOptimized: smart.imagesOptimized,
      streamsCompressed: lossless.streamsCompressed,
      duplicatesRemoved: lossless.duplicatesRemoved,
      note: `Optimized ${smart.imagesOptimized} embedded graphic(s) in-place${extra} — 100% vector text kept razor-sharp.`,
    };
  }

  return {
    bytes: lossless.bytes,
    modeUsed: 'Lossless Vector-Safe',
    imagesOptimized: 0,
    streamsCompressed: lossless.streamsCompressed,
    duplicatesRemoved: lossless.duplicatesRemoved,
    note:
      structuralBits.length > 0
        ? `100% sharp vector text preserved (${structuralBits.join(', ')}).`
        : 'Vector text, fonts & drawings preserved at 100% native sharpness.',
  };
}

export interface PageAssemblySpec {
  sourceIndex: number; // -1 for blank page
  pageNumber?: number; // 1-based
  rotation: number; // 0, 90, 180, 270
}

export async function assemblePdfFromPages(
  sources: Uint8Array[],
  specs: PageAssemblySpec[]
): Promise<Uint8Array> {
  const loaded = await Promise.all(sources.map((b) => PDFDocument.load(b, { ignoreEncryption: true })));
  const out = await PDFDocument.create();
  for (const spec of specs) {
    if (spec.sourceIndex < 0 || !spec.pageNumber) {
      const p = out.addPage([595.28, 841.89]);
      p.setRotation(degrees(spec.rotation));
    } else {
      const srcDoc = loaded[spec.sourceIndex];
      const [copied] = await out.copyPages(srcDoc, [spec.pageNumber - 1]);
      const existingRot = copied.getRotation().angle;
      copied.setRotation(degrees((existingRot + spec.rotation) % 360));
      out.addPage(copied);
    }
  }
  return new Uint8Array(await out.save({ useObjectStreams: true }));
}

export async function splitPdfToZip(
  bytes: Uint8Array,
  filename: string,
  mode: 'single' | 'every-n' | 'odd-even' | 'halves' | 'custom',
  everyN = 2,
  customExpr = '1-2, 3-last'
): Promise<{ zipBlob: Blob; filesCount: number }> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const specs = parseSplitSpec(mode, src.getPageCount(), everyN, customExpr);
  const zip = new JSZip();
  const base = safeBase(filename);

  for (const grp of specs) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      grp.pages.map((p) => p - 1)
    );
    copied.forEach((p) => out.addPage(p));
    const pdfBytes = await out.save({ useObjectStreams: true });
    zip.file(`${base}_${grp.label}.pdf`, pdfBytes);
  }
  return { zipBlob: await zip.generateAsync({ type: 'blob' }), filesCount: specs.length };
}

export async function imagesToPdf(
  files: File[],
  options: {
    pageSize?: 'fit' | 'a4' | 'letter';
    marginPt?: number;
    orientation?: 'auto' | 'portrait' | 'landscape';
  } = {}
): Promise<Uint8Array> {
  const { pageSize = 'a4', marginPt = 24, orientation = 'auto' } = options;
  const doc = await PDFDocument.create();

  for (const file of files) {
    const imgEl = await loadImageFile(file);
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth || imgEl.width;
    canvas.height = imgEl.naturalHeight || imgEl.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(imgEl, 0, 0);

    const isPng = file.type === 'image/png';
    const blob = await canvasToBlob(canvas, isPng ? 'image/png' : 'image/jpeg', 0.92);
    const imgBytes = new Uint8Array(await blob.arrayBuffer());
    const embedded = isPng ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
    const iw = embedded.width;
    const ih = embedded.height;

    let pw = iw + marginPt * 2;
    let ph = ih + marginPt * 2;
    if (pageSize === 'a4') {
      pw = 595.28;
      ph = 841.89;
    } else if (pageSize === 'letter') {
      pw = 612;
      ph = 792;
    }

    if (pageSize !== 'fit') {
      const isImgLandscape = iw > ih;
      const wantLandscape =
        orientation === 'landscape' || (orientation === 'auto' && isImgLandscape);
      if (wantLandscape && pw < ph) [pw, ph] = [ph, pw];
      if (!wantLandscape && pw > ph) [pw, ph] = [ph, pw];
    }

    const page = doc.addPage([pw, ph]);
    const availW = Math.max(10, pw - marginPt * 2);
    const availH = Math.max(10, ph - marginPt * 2);
    const ratio = Math.min(availW / iw, availH / ih);
    const dw = iw * ratio;
    const dh = ih * ratio;
    page.drawImage(embedded, {
      x: (pw - dw) / 2,
      y: (ph - dh) / 2,
      width: dw,
      height: dh,
    });
  }
  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

export async function textOrMarkdownToPdf(
  content: string,
  title = 'Document',
  isMarkdown = true
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const monoFont = await doc.embedFont(StandardFonts.Courier);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 50;
  const maxWidth = pageW - margin * 2;
  const accent = rgb(0.31, 0.27, 0.9);
  const ink = rgb(0.08, 0.11, 0.19);
  const muted = rgb(0.4, 0.46, 0.56);
  const border = rgb(0.88, 0.91, 0.94);
  const codeBg = rgb(0.96, 0.97, 0.99);

  let page = doc.addPage([pageW, pageH]);
  page.drawRectangle({ x: 0, y: pageH - 6, width: pageW, height: 6, color: accent });
  let y = pageH - 54;

  const ensureSpace = (needed: number) => {
    if (y - needed < 56) {
      page = doc.addPage([pageW, pageH]);
      page.drawRectangle({ x: 0, y: pageH - 4, width: pageW, height: 4, color: accent });
      y = pageH - 52;
    }
  };

  const wrapText = (txt: string, f: typeof font, size: number, widthLimit = maxWidth) => {
    const words = txt.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(candidate, size) <= widthLimit) {
        cur = candidate;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  const safeStr = (s: string) =>
    s
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^\x20-\x7e]/g, ' ');

  if (title.trim()) {
    doc.setTitle(title.trim());
    page.drawText(safeStr(title.trim()), { x: margin, y, size: 19, font: boldFont, color: ink });
    y -= 14;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: border });
    y -= 18;
  }

  let inCode = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = safeStr(rawLine);
    if (isMarkdown && line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (!line.trim()) {
      y -= 8;
      continue;
    }

    if (inCode || (isMarkdown && (line.startsWith('    ') || line.startsWith('\t')))) {
      const wrapped = wrapText(line.trim(), monoFont, 9, maxWidth - 16);
      const boxH = wrapped.length * 13 + 8;
      ensureSpace(boxH + 4);
      page.drawRectangle({
        x: margin,
        y: y - boxH + 10,
        width: maxWidth,
        height: boxH,
        color: codeBg,
        borderColor: border,
        borderWidth: 0.6,
      });
      for (const wl of wrapped) {
        page.drawText(wl, { x: margin + 8, y, size: 9, font: monoFont, color: ink });
        y -= 13;
      }
      y -= 6;
      continue;
    }

    let f = font;
    let size = 10.5;
    let color = ink;
    let text = line.replace(/\*\*/g, '').replace(/`/g, '');
    let isBullet = false;

    if (isMarkdown) {
      if (/^-{3,}$/.test(line.trim())) {
        ensureSpace(14);
        page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.8, color: border });
        y -= 14;
        continue;
      } else if (line.startsWith('# ')) {
        f = boldFont;
        size = 16.5;
        color = accent;
        text = text.slice(2);
        y -= 6;
      } else if (line.startsWith('## ')) {
        f = boldFont;
        size = 13.5;
        text = text.slice(3);
        y -= 4;
      } else if (line.startsWith('### ')) {
        f = boldFont;
        size = 11.5;
        text = text.slice(4);
      } else if (line.startsWith('> ')) {
        text = text.slice(2);
        color = muted;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        isBullet = true;
        text = text.slice(2);
      }
    }

    const wrapped = wrapText(text, f, size, isBullet ? maxWidth - 16 : maxWidth);
    ensureSpace(wrapped.length * (size + 5) + 4);
    if (isBullet) {
      page.drawCircle({ x: margin + 5, y: y + 3.5, size: 2, color: accent });
    }
    for (const wLine of wrapped) {
      ensureSpace(size + 6);
      page.drawText(wLine, { x: isBullet ? margin + 15 : margin, y, size, font: f, color });
      y -= size + 5;
    }
    y -= 2;
  }

  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({ start: { x: margin, y: 36 }, end: { x: pageW - margin, y: 36 }, thickness: 0.6, color: border });
    const label = `Page ${idx + 1} of ${pages.length}`;
    const lw = font.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: pageW - margin - lw, y: 22, size: 8, font, color: muted });
  });

  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

export async function stampPdf(
  bytes: Uint8Array,
  options: {
    filename?: string;
    headerText?: string;
    footerText?: string;
    watermarkText?: string;
    watermarkOpacity?: number;
    watermarkSize?: number;
    pageNumberFormat?: 'none' | 'x-of-y' | 'page-x' | 'bates';
    batesPrefix?: string;
    batesStart?: number;
    logoFile?: File | null;
    logoScale?: number;
  }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const total = pages.length;
  const dateStr = new Date().toISOString().slice(0, 10);

  let embeddedLogo: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (options.logoFile) {
    const imgEl = await loadImageFile(options.logoFile);
    const c = document.createElement('canvas');
    c.width = imgEl.naturalWidth;
    c.height = imgEl.naturalHeight;
    c.getContext('2d')!.drawImage(imgEl, 0, 0);
    const b = await canvasToBlob(c, 'image/png', 1);
    embeddedLogo = await doc.embedPng(new Uint8Array(await b.arrayBuffer()));
  }

  const expand = (tpl: string, pageNum: number) =>
    tpl
      .replace(/\{page\}/gi, String(pageNum))
      .replace(/\{pages\}/gi, String(total))
      .replace(/\{date\}/gi, dateStr)
      .replace(/\{filename\}/gi, options.filename || 'document.pdf');

  pages.forEach((p, idx) => {
    const pNum = idx + 1;
    const { width, height } = p.getSize();

    if (options.headerText?.trim()) {
      const txt = expand(options.headerText.trim(), pNum);
      p.drawText(txt, {
        x: 36,
        y: height - 26,
        size: 9.5,
        font,
        color: rgb(0.32, 0.37, 0.46),
      });
    }

    if (options.footerText?.trim()) {
      const txt = expand(options.footerText.trim(), pNum);
      p.drawText(txt, {
        x: 36,
        y: 20,
        size: 9.5,
        font,
        color: rgb(0.32, 0.37, 0.46),
      });
    }

    if (options.pageNumberFormat && options.pageNumberFormat !== 'none') {
      let label = `${pNum} / ${total}`;
      if (options.pageNumberFormat === 'page-x') label = `Page ${pNum}`;
      else if (options.pageNumberFormat === 'bates') {
        const seq = String((options.batesStart ?? 1) + idx).padStart(5, '0');
        label = `${options.batesPrefix || 'BATES-'}${seq}`;
      }
      const w = font.widthOfTextAtSize(label, 9.5);
      p.drawText(label, {
        x: width - w - 36,
        y: 20,
        size: 9.5,
        font: bold,
        color: rgb(0.2, 0.25, 0.35),
      });
    }

    if (options.watermarkText?.trim()) {
      const wm = expand(options.watermarkText.trim(), pNum);
      const sz = options.watermarkSize ?? 44;
      const w = bold.widthOfTextAtSize(wm, sz);
      p.drawText(wm, {
        x: Math.max(24, (width - w * 0.72) / 2),
        y: height * 0.44,
        size: sz,
        font: bold,
        color: rgb(0.35, 0.38, 0.55),
        opacity: options.watermarkOpacity ?? 0.22,
        rotate: degrees(38),
      });
    }

    if (embeddedLogo) {
      const s = options.logoScale ?? 0.16;
      const lw = Math.min(140, width * s);
      const lh = (embeddedLogo.height / embeddedLogo.width) * lw;
      p.drawImage(embeddedLogo, {
        x: width - lw - 32,
        y: height - lh - 22,
        width: lw,
        height: lh,
      });
    }
  });

  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

export async function extractPdfTextAndSearch(bytes: Uint8Array): Promise<{
  fullText: string;
  pages: { page: number; text: string; items: { str: string; x: number; y: number; w: number; h: number }[] }[];
}> {
  const pdfJs = await openPdfJs(bytes);
  const pages: {
    page: number;
    text: string;
    items: { str: string; x: number; y: number; w: number; h: number }[];
  }[] = [];

  for (let i = 1; i <= pdfJs.numPages; i++) {
    const page = await pdfJs.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: { str: string; x: number; y: number; w: number; h: number }[] = [];
    const lineChunks: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const s = raw.str;
      if (!s) continue;
      const tx = raw.transform;
      const itemY = vp.height - tx[5] - (raw.height || 10);
      if (lastY !== null && Math.abs(itemY - lastY) > 5) {
        if (currentLine.trim()) lineChunks.push(currentLine.trim());
        currentLine = s;
      } else {
        currentLine = currentLine ? `${currentLine} ${s}` : s;
      }
      lastY = itemY;
      items.push({
        str: s,
        x: tx[4],
        y: itemY,
        w: raw.width || s.length * 5,
        h: raw.height || 12,
      });
    }
    if (currentLine.trim()) lineChunks.push(currentLine.trim());
    pages.push({ page: i, text: lineChunks.join('\n'), items });
  }

  const fullText = pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join('\n\n');
  return { fullText, pages };
}

export async function extractPdfImagesToZip(bytes: Uint8Array, baseName: string): Promise<{
  zipBlob: Blob;
  count: number;
}> {
  // Scan JPEG SOI..EOI & render fallback embedded image crops via PDF.js OPS or clean page fallback
  const zip = new JSZip();
  const safe = safeBase(baseName);
  let count = 0;

  // 1) Carve embedded JPEG streams directly from raw PDF bytes
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      let end = -1;
      for (let j = i + 4; j < Math.min(bytes.length - 1, i + 12_000_000); j++) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end > i + 1024) {
        count++;
        zip.file(`${safe}_img_${String(count).padStart(3, '0')}.jpg`, bytes.subarray(i, end));
        i = end;
      }
    }
  }

  // 2) If zero raw JPEG streams found (e.g., FlateDecode PNG/vector PDF), render pages at crisp PNG so user always gets usable visuals
  if (count === 0) {
    const pdfJs = await openPdfJs(bytes);
    for (let p = 1; p <= pdfJs.numPages; p++) {
      const c = await renderPdfPageToCanvas(pdfJs, p, 1.8);
      const blob = await canvasToBlob(c, 'image/png', 1);
      count++;
      zip.file(`${safe}_page_${String(p).padStart(3, '0')}.png`, blob);
    }
  }

  return { zipBlob: await zip.generateAsync({ type: 'blob' }), count };
}

export async function layoutPdf(
  bytes: Uint8Array,
  options: {
    mode: 'resize' | 'nup' | 'booklet' | 'reverse';
    targetSize?: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
    nup?: 2 | 4 | 6 | 9;
  }
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const sizes: Record<string, [number, number]> = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    legal: [612, 1008],
    a3: [841.89, 1190.55],
    a5: [419.53, 595.28],
  };

  if (options.mode === 'reverse') {
    const out = await PDFDocument.create();
    const idxs = Array.from({ length: total }, (_, i) => total - 1 - i);
    const copied = await out.copyPages(src, idxs);
    copied.forEach((p) => out.addPage(p));
    return new Uint8Array(await out.save({ useObjectStreams: true }));
  }

  if (options.mode === 'resize') {
    const [tw, th] = sizes[options.targetSize || 'a4'];
    const out = await PDFDocument.create();
    const embeddedPages = await out.embedPages(src.getPages());
    for (const ep of embeddedPages) {
      const page = out.addPage([tw, th]);
      const ratio = Math.min(tw / ep.width, th / ep.height);
      const w = ep.width * ratio;
      const h = ep.height * ratio;
      page.drawPage(ep, { x: (tw - w) / 2, y: (th - h) / 2, width: w, height: h });
    }
    return new Uint8Array(await out.save({ useObjectStreams: true }));
  }

  // N-up or Booklet imposition
  const out = await PDFDocument.create();
  const embeddedPages = await out.embedPages(src.getPages());

  if (options.mode === 'booklet') {
    // Pad to multiple of 4
    const paddedCount = Math.ceil(embeddedPages.length / 4) * 4;
    const sheetW = 841.89; // Landscape A4
    const sheetH = 595.28;
    const halfW = sheetW / 2;
    let lo = 0;
    let hi = paddedCount - 1;
    let sheetIdx = 0;
    while (lo < hi) {
      const leftIdx = sheetIdx % 2 === 0 ? hi : lo;
      const rightIdx = sheetIdx % 2 === 0 ? lo : hi;
      lo++;
      hi--;
      sheetIdx++;
      const sheet = out.addPage([sheetW, sheetH]);
      const drawHalf = (epIdx: number, xOffset: number) => {
        if (epIdx >= embeddedPages.length) return;
        const ep = embeddedPages[epIdx];
        const r = Math.min((halfW - 16) / ep.width, (sheetH - 16) / ep.height);
        const w = ep.width * r;
        const h = ep.height * r;
        sheet.drawPage(ep, {
          x: xOffset + (halfW - w) / 2,
          y: (sheetH - h) / 2,
          width: w,
          height: h,
        });
      };
      drawHalf(leftIdx, 0);
      drawHalf(rightIdx, halfW);
    }
    return new Uint8Array(await out.save({ useObjectStreams: true }));
  }

  const nup = options.nup || 2;
  const cols = nup === 2 ? 2 : nup === 4 ? 2 : 3;
  const rows = nup === 2 ? 1 : nup === 4 ? 2 : nup === 6 ? 2 : 3;
  const sheetW = nup === 2 || nup === 6 ? 841.89 : 595.28;
  const sheetH = nup === 2 || nup === 6 ? 595.28 : 841.89;
  const cellW = sheetW / cols;
  const cellH = sheetH / rows;

  for (let i = 0; i < embeddedPages.length; i += nup) {
    const sheet = out.addPage([sheetW, sheetH]);
    for (let k = 0; k < nup && i + k < embeddedPages.length; k++) {
      const col = k % cols;
      const row = Math.floor(k / cols);
      const ep = embeddedPages[i + k];
      const r = Math.min((cellW - 16) / ep.width, (cellH - 16) / ep.height);
      const w = ep.width * r;
      const h = ep.height * r;
      const x = col * cellW + (cellW - w) / 2;
      const y = sheetH - (row + 1) * cellH + (cellH - h) / 2;
      sheet.drawPage(ep, { x, y, width: w, height: h });
    }
  }
  return new Uint8Array(await out.save({ useObjectStreams: true }));
}

export async function cropPdfPages(
  bytes: Uint8Array,
  marginsPct: { top: number; right: number; bottom: number; left: number },
  pageRange = ''
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = doc.getPageCount();
  const target = new Set(parsePageRanges(pageRange, total));
  doc.getPages().forEach((page, idx) => {
    if (!target.has(idx + 1)) return;
    const { width, height } = page.getSize();
    const l = (marginsPct.left / 100) * width;
    const r = (marginsPct.right / 100) * width;
    const b = (marginsPct.bottom / 100) * height;
    const t = (marginsPct.top / 100) * height;
    const nw = Math.max(20, width - l - r);
    const nh = Math.max(20, height - t - b);
    page.setCropBox(l, b, nw, nh);
  });
  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

export async function redactPdfPermanent(
  bytes: Uint8Array,
  terms: string[]
): Promise<{ bytes: Uint8Array; redactedPages: number[]; matchCount: number }> {
  const pdfJs = await openPdfJs(bytes);
  const cleanTerms = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const redactedPages: number[] = [];
  let matchCount = 0;
  const outDoc = await PDFDocument.create();

  for (let p = 1; p <= pdfJs.numPages; p++) {
    const page = await pdfJs.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const content = await page.getTextContent();
    const rectsToBlackout: { x: number; y: number; w: number; h: number }[] = [];

    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str) continue;
      const low = raw.str.toLowerCase();
      if (cleanTerms.some((term) => low.includes(term))) {
        const tx = raw.transform;
        const x = tx[4] * 2;
        const h = Math.max(18, (raw.height || 12) * 2.2);
        const y = vp.height - tx[5] * 2 - h * 0.85;
        const w = Math.max(20, (raw.width || raw.str.length * 6) * 2);
        rectsToBlackout.push({ x, y, w, h });
        matchCount++;
      }
    }

    if (rectsToBlackout.length > 0) {
      redactedPages.push(p);
    }
    const canvas = await renderPdfPageToCanvas(pdfJs, p, 2);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    for (const r of rectsToBlackout) {
      ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    }
    const jpgBlob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    const emb = await outDoc.embedJpg(new Uint8Array(await jpgBlob.arrayBuffer()));
    const origVp = page.getViewport({ scale: 1 });
    const outPage = outDoc.addPage([origVp.width, origVp.height]);
    outPage.drawImage(emb, { x: 0, y: 0, width: origVp.width, height: origVp.height });
  }

  return {
    bytes: new Uint8Array(await outDoc.save({ useObjectStreams: true })),
    redactedPages,
    matchCount,
  };
}

export async function signPdfWithDataUrl(
  bytes: Uint8Array,
  sigDataUrl: string,
  options: {
    pageMode: 'last' | 'first' | 'all' | 'custom';
    customPage?: number;
    anchor: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'center';
    widthPt?: number;
  }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const base64 = sigDataUrl.split(',')[1];
  const bin = atob(base64);
  const pngBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pngBytes[i] = bin.charCodeAt(i);
  const embedded = await doc.embedPng(pngBytes);
  const pages = doc.getPages();
  const wPt = options.widthPt ?? 150;
  const hPt = (embedded.height / embedded.width) * wPt;

  pages.forEach((page, idx) => {
    const pNum = idx + 1;
    const apply =
      options.pageMode === 'all' ||
      (options.pageMode === 'first' && pNum === 1) ||
      (options.pageMode === 'last' && pNum === pages.length) ||
      (options.pageMode === 'custom' && pNum === (options.customPage ?? 1));
    if (!apply) return;

    const { width, height } = page.getSize();
    let x = width - wPt - 40;
    let y = 48;
    if (options.anchor === 'bottom-left') x = 40;
    else if (options.anchor === 'bottom-center') x = (width - wPt) / 2;
    else if (options.anchor === 'center') {
      x = (width - wPt) / 2;
      y = (height - hPt) / 2;
    }
    page.drawImage(embedded, { x, y, width: wPt, height: hPt });
  });

  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

export async function convertPdfToOutputs(
  bytes: Uint8Array,
  filename: string,
  mode: 'png' | 'jpg' | 'webp' | 'long-png' | 'grid-png' | 'md' | 'html' | 'json',
  dpiScale = 3.0 // Default Full HD · 216 DPI (~1786 x 2526 px on A4)
): Promise<{
  blob: Blob;
  downloadName: string;
  previewText?: string;
  previewDataUrl?: string;
  widthPx?: number;
  heightPx?: number;
}> {
  const base = safeBase(filename);

  if (mode === 'md' || mode === 'html' || mode === 'json') {
    const { pages } = await extractPdfTextAndSearch(bytes);
    if (mode === 'json') {
      const jsonStr = JSON.stringify({ filename, pageCount: pages.length, pages }, null, 2);
      return {
        blob: new Blob([jsonStr], { type: 'application/json' }),
        downloadName: `${base}.json`,
        previewText: jsonStr,
      };
    }
    if (mode === 'md') {
      const md = pages.map((p) => `## Page ${p.page}\n\n${p.text}`).join('\n\n---\n\n');
      return {
        blob: new Blob([md], { type: 'text/markdown' }),
        downloadName: `${base}.md`,
        previewText: md,
      };
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${base}</title><style>body{font-family:system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.6}section{border-bottom:1px solid #e2e8f0;padding:24px 0}</style></head><body><h1>${base}</h1>${pages
      .map((p) => `<section><h2>Page ${p.page}</h2><p>${p.text.replace(/</g, '&lt;')}</p></section>`)
      .join('')}</body></html>`;
    return {
      blob: new Blob([html], { type: 'text/html' }),
      downloadName: `${base}.html`,
      previewText: html,
    };
  }

  const pdfJs = await openPdfJs(bytes);
  try {
    const pageNums = Array.from({ length: pdfJs.numPages }, (_, i) => i + 1);
    const effectiveScale = mode === 'long-png' || mode === 'grid-png' ? Math.min(dpiScale, 2.2) : dpiScale;
    const rendered = await runWithConcurrency(pageNums, 3, (p) =>
      renderPdfPageToCanvas(pdfJs, p, effectiveScale, 'print')
    );
    const canvases = rendered.filter((c): c is HTMLCanvasElement => Boolean(c));
    if (canvases.length === 0) {
      throw new Error('Could not render any PDF pages.');
    }

    if (mode === 'long-png') {
      const maxW = Math.max(...canvases.map((c) => c.width));
      const totalH = canvases.reduce((s, c) => s + c.height + 12, 0);
      const big = document.createElement('canvas');
      big.width = maxW;
      big.height = Math.max(1, totalH);
      const ctx = big.getContext('2d')!;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, 0, big.width, big.height);
      let y = 0;
      for (const c of canvases) {
        ctx.drawImage(c, Math.floor((maxW - c.width) / 2), y);
        y += c.height + 12;
      }
      const blob = await canvasToBlob(big, 'image/png', 1);
      return {
        blob,
        downloadName: `${base}_scroll.png`,
        previewDataUrl: big.toDataURL('image/png'),
        widthPx: big.width,
        heightPx: big.height,
      };
    }

    if (mode === 'grid-png') {
      const cols = Math.min(3, canvases.length);
      const rows = Math.ceil(canvases.length / cols);
      const cw = Math.max(...canvases.map((c) => c.width));
      const ch = Math.max(...canvases.map((c) => c.height));
      const gap = 16;
      const grid = document.createElement('canvas');
      grid.width = cols * cw + (cols + 1) * gap;
      grid.height = rows * ch + (rows + 1) * gap;
      const ctx = grid.getContext('2d')!;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, grid.width, grid.height);
      canvases.forEach((c, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        ctx.drawImage(c, gap + col * (cw + gap), gap + row * (ch + gap));
      });
      const blob = await canvasToBlob(grid, 'image/png', 1);
      return {
        blob,
        downloadName: `${base}_contact_sheet.png`,
        previewDataUrl: grid.toDataURL('image/png'),
        widthPx: grid.width,
        heightPx: grid.height,
      };
    }

    const mime = mode === 'jpg' ? 'image/jpeg' : mode === 'webp' ? 'image/webp' : 'image/png';
    const encodeQuality = mode === 'png' ? 1 : 0.96;
    const first = canvases[0];
    if (canvases.length === 1) {
      const blob = await canvasToBlob(first, mime, encodeQuality);
      return {
        blob,
        downloadName: `${base}_p1.${mode}`,
        previewDataUrl: first.toDataURL(mime, encodeQuality),
        widthPx: first.width,
        heightPx: first.height,
      };
    }

    const zip = new JSZip();
    const blobs = await runWithConcurrency(canvases, 3, (c) => canvasToBlob(c, mime, encodeQuality));
    blobs.forEach((blob, i) => {
      if (blob) zip.file(`${base}_page_${String(i + 1).padStart(3, '0')}.${mode}`, blob);
    });
    return {
      blob: await zip.generateAsync({ type: 'blob' }),
      downloadName: `${base}_${mode}_fullhd_pages.zip`,
      previewDataUrl: first.toDataURL(mime, encodeQuality),
      widthPx: first.width,
      heightPx: first.height,
    };
  } finally {
    await pdfJs.cleanup();
  }
}

export async function compareTwoPdfPages(
  bytesA: Uint8Array,
  bytesB: Uint8Array,
  pageNumber = 1
): Promise<{
  canvasA: HTMLCanvasElement;
  canvasB: HTMLCanvasElement;
  diffCanvas: HTMLCanvasElement;
  diffPercent: number;
}> {
  const [pdfA, pdfB] = await Promise.all([openPdfJs(bytesA), openPdfJs(bytesB)]);
  const pA = Math.min(pageNumber, pdfA.numPages);
  const pB = Math.min(pageNumber, pdfB.numPages);
  const [cA, cB] = await Promise.all([
    renderPdfPageToCanvas(pdfA, pA, 1.35),
    renderPdfPageToCanvas(pdfB, pB, 1.35),
  ]);
  const w = Math.max(cA.width, cB.width);
  const h = Math.max(cA.height, cB.height);

  const norm = (src: HTMLCanvasElement) => {
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  };

  const dA = norm(cA).data;
  const dB = norm(cB).data;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = w;
  diffCanvas.height = h;
  const diffCtx = diffCanvas.getContext('2d')!;
  const diffImg = diffCtx.createImageData(w, h);
  let changed = 0;

  for (let i = 0; i < dA.length; i += 4) {
    const delta = Math.abs(dA[i] - dB[i]) + Math.abs(dA[i + 1] - dB[i + 1]) + Math.abs(dA[i + 2] - dB[i + 2]);
    if (delta > 36) {
      changed++;
      diffImg.data[i] = 225;
      diffImg.data[i + 1] = 29;
      diffImg.data[i + 2] = 72;
      diffImg.data[i + 3] = 255;
    } else {
      const lum = Math.round((dA[i] + dA[i + 1] + dA[i + 2]) / 3);
      const faded = Math.min(255, Math.round(lum * 0.4 + 150));
      diffImg.data[i] = diffImg.data[i + 1] = diffImg.data[i + 2] = faded;
      diffImg.data[i + 3] = 255;
    }
  }
  diffCtx.putImageData(diffImg, 0, 0);
  const diffPercent = (changed / (w * h)) * 100;
  return { canvasA: cA, canvasB: cB, diffCanvas, diffPercent };
}
