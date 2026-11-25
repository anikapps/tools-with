import JSZip from 'jszip';
import {
  buildDocxFromBlocks,
  convertDataFormat,
  convertDocxToPdf,
  convertHtmlToExactPdf,
  convertPdfToDocx,
  convertPdfToXlsx,
  exportWorkbookAllSheetsToPdf,
  parseHtmlToBlocks,
  parseMarkdownToBlocks,
  parseSpreadsheetBytes,
  parseWordOrRichDocBytes,
  PdfRenderMode,
  renderBlocksToPdf,
  renderTableToPdf,
  rowsToBeautifiedHtml,
  rowsToCsvString,
  rowsToXlsxBytes,
} from './converterEngine';
import { fmtBytes, parseCsv, safeBase } from './formatters';

export type BulkTargetFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'html'
  | 'txt'
  | 'json'
  | 'png'
  | 'jpg'
  | 'webp';
export type BulkGlobalTarget = 'auto' | BulkTargetFormat;

export type BulkStage =
  | 'queued'
  | 'reading'
  | 'parsing'
  | 'rendering'
  | 'previewing'
  | 'done'
  | 'error';

export interface PreviewPayload {
  kind: 'pdf' | 'html' | 'table' | 'text' | 'image' | 'empty';
  html?: string;
  rows?: string[][];
  sheetNames?: string[];
  text?: string;
  pdfImgs?: string[];
  pageCount?: number;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  summaryMeta?: string;
}

export interface BulkOutputArtifact {
  filename: string;
  mime: string;
  sizeBytes: number;
  blob: Blob;
  url: string;
  preview: PreviewPayload;
}

export interface BulkJobItem {
  id: string;
  file: File;
  name: string;
  ext: string;
  sizeBytes: number;
  targetFormat: BulkTargetFormat;
  status: BulkStage;
  progress: number;
  stageDetail: string;
  durationMs?: number;
  warnings?: string[];
  inputPreview?: PreviewPayload;
  inputPreviewLoading?: boolean;
  output?: BulkOutputArtifact;
  error?: string;
}

export interface BulkProgressSummary {
  total: number;
  done: number;
  failed: number;
  active: number;
  queued: number;
  overallPct: number;
  totalInputBytes: number;
  totalOutputBytes: number;
}

const WORD_EXTS = new Set(['docx', 'doc', 'rtf', 'odt']);
const SHEET_EXTS = new Set(['xlsx', 'xls', 'ods']);
const DOC_TEXT_EXTS = new Set(['md', 'markdown', 'html', 'htm', 'txt']);
const TABULAR_TEXT_EXTS = new Set(['csv', 'tsv']);
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']);

export const TARGET_FORMAT_LABELS: Record<BulkTargetFormat, string> = {
  pdf: 'PDF (.pdf)',
  docx: 'Word (.docx)',
  xlsx: 'Excel (.xlsx)',
  csv: 'CSV (.csv)',
  html: 'Styled HTML (.html)',
  txt: 'Plain Text (.txt)',
  json: 'JSON (.json)',
  png: 'Lossless PNG (.png)',
  jpg: 'High-Quality JPG (.jpg)',
  webp: 'Compact WebP (.webp)',
};

export function getFileExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

export function getSupportedTargetFormats(ext: string): BulkTargetFormat[] {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return ['pdf', 'png', 'webp', 'jpg', 'html'];
  if (WORD_EXTS.has(e)) return ['pdf', 'html', 'txt'];
  if (SHEET_EXTS.has(e)) return ['pdf', 'csv', 'json', 'html', 'docx'];
  if (TABULAR_TEXT_EXTS.has(e)) return ['pdf', 'xlsx', 'json', 'html', 'docx'];
  if (e === 'pdf') return ['docx', 'png', 'jpg', 'webp', 'xlsx', 'csv', 'txt'];
  if (e === 'json') return ['pdf', 'xlsx', 'csv', 'html', 'txt'];
  if (DOC_TEXT_EXTS.has(e)) return ['pdf', 'docx', 'html', 'txt'];
  return ['pdf', 'txt'];
}

export function getDefaultTargetForExt(ext: string): BulkTargetFormat {
  const e = ext.toLowerCase();
  if (e === 'pdf') return 'docx';
  return 'pdf';
}

export function resolveBulkTarget(ext: string, globalTarget: BulkGlobalTarget): BulkTargetFormat {
  if (globalTarget === 'auto') return getDefaultTargetForExt(ext);
  const supported = getSupportedTargetFormats(ext);
  return supported.includes(globalTarget) ? globalTarget : getDefaultTargetForExt(ext);
}

export function summarizeBulkProgress(
  items: ReadonlyArray<{
    status: BulkStage;
    progress: number;
    sizeBytes: number;
    output?: { sizeBytes: number };
  }>
): BulkProgressSummary {
  const total = items.length;
  let done = 0;
  let failed = 0;
  let active = 0;
  let queued = 0;
  let pctSum = 0;
  let totalInputBytes = 0;
  let totalOutputBytes = 0;

  for (const it of items) {
    totalInputBytes += it.sizeBytes;
    if (it.output) totalOutputBytes += it.output.sizeBytes;
    if (it.status === 'done') {
      done++;
      pctSum += 100;
    } else if (it.status === 'error') {
      failed++;
      pctSum += 100;
    } else if (it.status === 'queued') {
      queued++;
    } else {
      active++;
      pctSum += Math.max(0, Math.min(99, it.progress));
    }
  }

  return {
    total,
    done,
    failed,
    active,
    queued,
    overallPct: total === 0 ? 0 : Math.round(pctSum / total),
    totalInputBytes,
    totalOutputBytes,
  };
}

export function getStageStepIndex(stage: BulkStage): number {
  switch (stage) {
    case 'queued':
      return 0;
    case 'reading':
      return 1;
    case 'parsing':
      return 2;
    case 'rendering':
      return 3;
    case 'previewing':
      return 3;
    case 'done':
      return 4;
    case 'error':
      return -1;
  }
}

const yieldPaint = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  });
}

function measureImageDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof Image === 'undefined') return Promise.resolve({ width: 0, height: 0 });
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

export async function renderPdfThumbsForPreview(
  bytes: Uint8Array,
  maxPages = 4
): Promise<{ pageCount: number; imgs: string[] }> {
  if (typeof document === 'undefined') {
    return { pageCount: 0, imgs: [] };
  }
  try {
    const { openPdfJs, renderPdfPageToCanvas } = await import('./pdfEngine');
    const pdfDoc = await openPdfJs(bytes);
    const total = pdfDoc.numPages;
    const limit = Math.min(total, maxPages);
    const imgs: string[] = [];
    for (let p = 1; p <= limit; p++) {
      const canvas = await renderPdfPageToCanvas(pdfDoc, p, 1.15);
      imgs.push(canvas.toDataURL('image/png'));
    }
    await pdfDoc.cleanup();
    return { pageCount: total, imgs };
  } catch {
    return { pageCount: 0, imgs: [] };
  }
}

function escapeHtmlBasic(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function blocksToPreviewHtml(blocks: { type: string; text?: string; rows?: string[][] }[]): string {
  return blocks
    .slice(0, 120)
    .map((b) => {
      if (b.type === 'h1') return `<h1>${escapeHtmlBasic(b.text || '')}</h1>`;
      if (b.type === 'h2') return `<h2>${escapeHtmlBasic(b.text || '')}</h2>`;
      if (b.type === 'h3') return `<h3>${escapeHtmlBasic(b.text || '')}</h3>`;
      if (b.type === 'li') return `<ul><li>${escapeHtmlBasic(b.text || '')}</li></ul>`;
      if (b.type === 'hr') return '<hr />';
      if (b.type === 'code') return `<pre><code>${escapeHtmlBasic(b.text || '')}</code></pre>`;
      if (b.type === 'table' && b.rows?.length) {
        const rowsHtml = b.rows
          .slice(0, 40)
          .map(
            (r, ri) =>
              `<tr>${r
                .map((c) => (ri === 0 ? `<th>${escapeHtmlBasic(c)}</th>` : `<td>${escapeHtmlBasic(c)}</td>`))
                .join('')}</tr>`
          )
          .join('');
        return `<table><tbody>${rowsHtml}</tbody></table>`;
      }
      return `<p>${escapeHtmlBasic(b.text || '')}</p>`;
    })
    .join('\n');
}

/** Build an instant visual source preview as soon as a file enters the queue */
export async function inspectSourcePreview(file: File): Promise<PreviewPayload> {
  const ext = getFileExt(file.name);

  if (IMAGE_EXTS.has(ext) || file.type.startsWith('image/')) {
    const dataUrl = await readBlobAsDataUrl(file);
    const dims = await measureImageDataUrl(dataUrl);
    return {
      kind: 'image',
      imageUrl: dataUrl,
      imageWidth: dims.width,
      imageHeight: dims.height,
      summaryMeta:
        dims.width && dims.height
          ? `${ext.toUpperCase()} Image · ${dims.width} × ${dims.height} px`
          : `${ext.toUpperCase()} Image`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (WORD_EXTS.has(ext)) {
    const parsed = await parseWordOrRichDocBytes(bytes, file.name);
    return {
      kind: 'html',
      html: parsed.html || blocksToPreviewHtml(parsed.blocks),
      text: parsed.plainText.slice(0, 8000),
      summaryMeta: `${parsed.formatLabel} · ${parsed.blocks.length} blocks`,
    };
  }

  if (SHEET_EXTS.has(ext)) {
    const wb = parseSpreadsheetBytes(bytes);
    const first = wb.sheetNames.find((s) => (wb.sheets[s]?.length || 0) > 0) || wb.sheetNames[0] || '';
    const rows = (first ? wb.sheets[first] : []) || [];
    const colCount = rows[0]?.length || 0;
    return {
      kind: 'table',
      rows: rows.slice(0, 80),
      sheetNames: wb.sheetNames,
      summaryMeta: `${wb.sheetNames.length} sheet${wb.sheetNames.length === 1 ? '' : 's'} · ${Math.max(0, rows.length - 1)} rows · ${colCount} cols`,
    };
  }

  if (TABULAR_TEXT_EXTS.has(ext)) {
    const raw = new TextDecoder().decode(bytes);
    const normalized = ext === 'tsv' ? raw.replace(/\t/g, ',') : raw;
    const rows = parseCsv(normalized);
    return {
      kind: 'table',
      rows: rows.slice(0, 80),
      text: raw.slice(0, 8000),
      summaryMeta: `${Math.max(0, rows.length - 1)} rows · ${rows[0]?.length || 0} cols`,
    };
  }

  if (ext === 'pdf') {
    const { pageCount, imgs } = await renderPdfThumbsForPreview(bytes, 4);
    return {
      kind: 'pdf',
      pdfImgs: imgs,
      pageCount,
      summaryMeta: pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : 'PDF document',
    };
  }

  if (ext === 'html' || ext === 'htm') {
    const raw = new TextDecoder().decode(bytes);
    const blocks = parseHtmlToBlocks(raw);
    return {
      kind: 'html',
      html: blocksToPreviewHtml(blocks),
      text: raw.slice(0, 8000),
      summaryMeta: `HTML · ${blocks.length} blocks`,
    };
  }

  if (ext === 'md' || ext === 'markdown') {
    const raw = new TextDecoder().decode(bytes);
    const blocks = parseMarkdownToBlocks(raw);
    return {
      kind: 'html',
      html: blocksToPreviewHtml(blocks),
      text: raw.slice(0, 8000),
      summaryMeta: `Markdown · ${blocks.length} blocks`,
    };
  }

  const raw = new TextDecoder().decode(bytes);
  if (ext === 'json') {
    try {
      const parsed = JSON.parse(raw);
      const pretty = JSON.stringify(parsed, null, 2);
      const count = Array.isArray(parsed) ? `${parsed.length} items` : `${Object.keys(parsed || {}).length} keys`;
      return {
        kind: 'text',
        text: pretty.slice(0, 12000),
        summaryMeta: `JSON · ${count}`,
      };
    } catch {
      return { kind: 'text', text: raw.slice(0, 12000), summaryMeta: 'JSON text' };
    }
  }

  return {
    kind: 'text',
    text: raw.slice(0, 12000),
    summaryMeta: `${raw.split(/\r?\n/).length} lines`,
  };
}

/** Convert a single queued file with granular real-time progress callbacks and zero output branding */
export async function convertBulkFile(
  file: File,
  targetFormat: BulkTargetFormat,
  options: {
    renderMode?: PdfRenderMode;
    orientation?: 'auto' | 'portrait' | 'landscape';
  } = {},
  onStage?: (stage: BulkStage, progress: number, detail: string) => void
): Promise<{
  filename: string;
  mime: string;
  sizeBytes: number;
  blob: Blob;
  preview: PreviewPayload;
  warnings: string[];
  durationMs: number;
}> {
  const started = performance.now();
  const ext = getFileExt(file.name);
  const base = safeBase(file.name);
  const cleanTitle = base.replace(/[_-]+/g, ' ');
  const renderMode = options.renderMode || 'auto';
  const orientation = options.orientation === 'auto' ? undefined : options.orientation;
  const warnings: string[] = [];

  onStage?.('reading', 14, `Reading ${fmtBytes(file.size)} from ${file.name}`);
  await yieldPaint();
  const bytes = new Uint8Array(await file.arrayBuffer());

  onStage?.('parsing', 40, `Parsing ${ext.toUpperCase() || 'file'} document structure`);
  await yieldPaint();

  let outBytes: Uint8Array | null = null;
  let outText: string | null = null;
  let mime = 'application/octet-stream';
  let outExt: string = targetFormat;
  let preview: PreviewPayload = { kind: 'empty' };

  // 0) Images (.png, .jpg, .jpeg, .webp, .gif, .bmp, .svg) -> PDF / PNG / WebP / JPG / HTML
  if (IMAGE_EXTS.has(ext) || file.type.startsWith('image/')) {
    onStage?.('rendering', 72, `Converting image to ${targetFormat.toUpperCase()}`);
    await yieldPaint();

    if (targetFormat === 'pdf') {
      const { imagesToPdf } = await import('./pdfEngine');
      outBytes = await imagesToPdf([file], {
        pageSize: 'a4',
        orientation: options.orientation || 'auto',
      });
      mime = 'application/pdf';
    } else if (targetFormat === 'html') {
      const dataUrl = await readBlobAsDataUrl(file);
      outText = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtmlBasic(cleanTitle)}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:24px}img{max-width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(15,23,42,.12)}</style></head><body><img src="${dataUrl}" alt="${escapeHtmlBasic(cleanTitle)}" /></body></html>`;
      mime = 'text/html;charset=utf-8';
      const dims = await measureImageDataUrl(dataUrl);
      preview = {
        kind: 'image',
        imageUrl: dataUrl,
        imageWidth: dims.width,
        imageHeight: dims.height,
        summaryMeta: `Embedded HTML Image · ${dims.width} × ${dims.height} px`,
      };
    } else {
      const { canvasToBlob, loadImageFile } = await import('./download');
      const imgEl = await loadImageFile(file);
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth || imgEl.width || 1;
      canvas.height = imgEl.naturalHeight || imgEl.height || 1;
      const ctx = canvas.getContext('2d')!;
      if (targetFormat === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(imgEl, 0, 0);
      const outMime =
        targetFormat === 'png'
          ? 'image/png'
          : targetFormat === 'webp'
            ? 'image/webp'
            : 'image/jpeg';
      const convertedBlob = await canvasToBlob(canvas, outMime, targetFormat === 'png' ? 1 : 0.92);
      outBytes = new Uint8Array(await convertedBlob.arrayBuffer());
      mime = outMime;
      outExt = targetFormat;
      const previewUrl = await readBlobAsDataUrl(convertedBlob);
      preview = {
        kind: 'image',
        imageUrl: previewUrl,
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        summaryMeta: `${targetFormat.toUpperCase()} · ${canvas.width} × ${canvas.height} px`,
      };
    }
  }
  // 1) Word & Rich Documents (.docx, .doc, .rtf, .odt)
  else if (WORD_EXTS.has(ext)) {
    if (targetFormat === 'pdf') {
      onStage?.('rendering', 72, 'Rendering exact Word document layout to PDF');
      await yieldPaint();
      const res = await convertDocxToPdf(bytes, cleanTitle, { filename: file.name, renderMode });
      warnings.push(...res.warnings);
      outBytes = res.pdfBytes;
      mime = 'application/pdf';
    } else {
      const parsed = await parseWordOrRichDocBytes(bytes, file.name);
      warnings.push(...parsed.warnings);

      onStage?.('rendering', 74, `Rendering ${targetFormat.toUpperCase()} output`);
      await yieldPaint();

      if (targetFormat === 'html') {
        outText = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtmlBasic(cleanTitle)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:780px;margin:32px auto;padding:0 20px;color:#0f172a;line-height:1.6}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left}th{background:#f1f5f9}</style></head><body>${parsed.html}</body></html>`;
        mime = 'text/html;charset=utf-8';
        preview = { kind: 'html', html: parsed.html, text: outText.slice(0, 8000), summaryMeta: 'Clean HTML document' };
      } else {
        outText = parsed.plainText;
        mime = 'text/plain;charset=utf-8';
        outExt = 'txt';
        preview = {
          kind: 'text',
          text: outText.slice(0, 12000),
          summaryMeta: `${outText.split(/\r?\n/).length} lines`,
        };
      }
    }
  }
  // 2) Spreadsheets (.xlsx, .xls, .ods)
  else if (SHEET_EXTS.has(ext)) {
    const wb = parseSpreadsheetBytes(bytes);
    const first = wb.sheetNames.find((s) => (wb.sheets[s]?.length || 0) > 0) || wb.sheetNames[0] || '';
    const rows = (first ? wb.sheets[first] : []) || [];

    onStage?.('rendering', 74, `Formatting ${wb.sheetNames.length} worksheet(s) as ${targetFormat.toUpperCase()}`);
    await yieldPaint();

    if (targetFormat === 'pdf') {
      outBytes =
        wb.sheetNames.length > 1
          ? await exportWorkbookAllSheetsToPdf(wb, { title: cleanTitle, orientation, renderMode })
          : await renderTableToPdf(rows, { title: cleanTitle, orientation, renderMode });
      mime = 'application/pdf';
    } else if (targetFormat === 'csv') {
      outText = rowsToCsvString(rows);
      mime = 'text/csv;charset=utf-8';
      preview = {
        kind: 'table',
        rows: rows.slice(0, 80),
        text: outText.slice(0, 8000),
        summaryMeta: `${Math.max(0, rows.length - 1)} rows · ${rows[0]?.length || 0} cols`,
      };
    } else if (targetFormat === 'json') {
      outText = convertDataFormat(rowsToCsvString(rows), 'csv', 'json');
      mime = 'application/json;charset=utf-8';
      preview = { kind: 'text', text: outText.slice(0, 12000), summaryMeta: 'JSON records' };
    } else if (targetFormat === 'html') {
      outText = rowsToBeautifiedHtml(rows, cleanTitle);
      mime = 'text/html;charset=utf-8';
      preview = {
        kind: 'table',
        rows: rows.slice(0, 80),
        text: outText.slice(0, 8000),
        summaryMeta: `Styled HTML table · ${Math.max(0, rows.length - 1)} rows`,
      };
    } else {
      outBytes = await buildDocxFromBlocks([{ type: 'table', rows }], { title: cleanTitle });
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      outExt = 'docx';
      preview = {
        kind: 'table',
        rows: rows.slice(0, 80),
        summaryMeta: `Word (.docx) table · ${Math.max(0, rows.length - 1)} rows`,
      };
    }
  }
  // 3) CSV / TSV / JSON tabular data
  else if (TABULAR_TEXT_EXTS.has(ext) || ext === 'json') {
    const raw = new TextDecoder().decode(bytes);
    let csvSource = raw;
    if (ext === 'tsv') {
      csvSource = raw.replace(/\t/g, ',');
    } else if (ext === 'json') {
      try {
        csvSource = convertDataFormat(raw, 'json', 'csv');
      } catch {
        csvSource = `Key,Value\nPayload,"${raw.slice(0, 200).replace(/"/g, '""')}"`;
      }
    }
    const rows = parseCsv(csvSource);

    onStage?.('rendering', 74, `Generating ${targetFormat.toUpperCase()} from ${Math.max(0, rows.length - 1)} rows`);
    await yieldPaint();

    if (targetFormat === 'pdf') {
      outBytes = await renderTableToPdf(rows, { title: cleanTitle, orientation, renderMode });
      mime = 'application/pdf';
    } else if (targetFormat === 'xlsx') {
      outBytes = rowsToXlsxBytes(rows, cleanTitle.slice(0, 31) || 'Sheet1');
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      preview = {
        kind: 'table',
        rows: rows.slice(0, 80),
        summaryMeta: `Excel (.xlsx) · ${Math.max(0, rows.length - 1)} rows · ${rows[0]?.length || 0} cols`,
      };
    } else if (targetFormat === 'csv') {
      outText = rowsToCsvString(rows);
      mime = 'text/csv;charset=utf-8';
      preview = {
        kind: 'table',
        rows: rows.slice(0, 80),
        text: outText.slice(0, 8000),
        summaryMeta: `${Math.max(0, rows.length - 1)} rows · ${rows[0]?.length || 0} cols`,
      };
    } else if (targetFormat === 'json') {
      outText = ext === 'json' ? JSON.stringify(JSON.parse(raw), null, 2) : convertDataFormat(csvSource, 'csv', 'json');
      mime = 'application/json;charset=utf-8';
      preview = { kind: 'text', text: outText.slice(0, 12000), summaryMeta: 'Formatted JSON' };
    } else if (targetFormat === 'html') {
      outText = rowsToBeautifiedHtml(rows, cleanTitle);
      mime = 'text/html;charset=utf-8';
      preview = {
        kind: 'table',
        rows: rows.slice(0, 80),
        text: outText.slice(0, 8000),
        summaryMeta: `Styled HTML table · ${Math.max(0, rows.length - 1)} rows`,
      };
    } else if (targetFormat === 'docx') {
      outBytes = await buildDocxFromBlocks([{ type: 'table', rows }], { title: cleanTitle });
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      preview = {
        kind: 'table',
        rows: rows.slice(0, 80),
        summaryMeta: `Word (.docx) table · ${Math.max(0, rows.length - 1)} rows`,
      };
    } else {
      outText = rowsToCsvString(rows);
      mime = 'text/plain;charset=utf-8';
      outExt = 'txt';
      preview = { kind: 'text', text: outText.slice(0, 12000), summaryMeta: `${rows.length} lines` };
    }
  }
  // 4) PDF -> DOCX / Full HD PNG, JPG, WebP / XLSX / CSV / TXT
  else if (ext === 'pdf') {
    onStage?.('rendering', 74, `Rendering PDF pages to ${targetFormat.toUpperCase()}`);
    await yieldPaint();

    if (targetFormat === 'png' || targetFormat === 'jpg' || targetFormat === 'webp') {
      const { convertPdfToOutputs } = await import('./pdfEngine');
      const imgRes = await convertPdfToOutputs(bytes, file.name, targetFormat, 3.0); // Full HD · 216 DPI
      outBytes = new Uint8Array(await imgRes.blob.arrayBuffer());
      const isZipOut = imgRes.downloadName.endsWith('.zip');
      mime = isZipOut
        ? 'application/zip'
        : targetFormat === 'jpg'
          ? 'image/jpeg'
          : targetFormat === 'webp'
            ? 'image/webp'
            : 'image/png';
      outExt = isZipOut ? 'zip' : targetFormat;
      preview = {
        kind: 'image',
        imageUrl: imgRes.previewDataUrl,
        imageWidth: imgRes.widthPx,
        imageHeight: imgRes.heightPx,
        summaryMeta:
          imgRes.widthPx && imgRes.heightPx
            ? `Full HD ${targetFormat.toUpperCase()} · ${imgRes.widthPx} × ${imgRes.heightPx} px${isZipOut ? ' (ZIP of pages)' : ''}`
            : `Full HD ${targetFormat.toUpperCase()}`,
      };
    } else if (targetFormat === 'xlsx') {
      const res = await convertPdfToXlsx(bytes);
      outBytes = res.xlsxBytes;
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      preview = {
        kind: 'table',
        rows: res.rows.slice(0, 80),
        summaryMeta: `Excel (.xlsx) · ${Math.max(0, res.rows.length - 1)} extracted lines`,
      };
    } else if (targetFormat === 'csv') {
      const res = await convertPdfToXlsx(bytes);
      outText = res.csv;
      mime = 'text/csv;charset=utf-8';
      preview = {
        kind: 'table',
        rows: res.rows.slice(0, 80),
        text: res.csv.slice(0, 8000),
        summaryMeta: `CSV · ${Math.max(0, res.rows.length - 1)} extracted lines`,
      };
    } else if (targetFormat === 'txt') {
      const res = await convertPdfToDocx(bytes, cleanTitle);
      outText = res.previewText;
      mime = 'text/plain;charset=utf-8';
      preview = {
        kind: 'text',
        text: res.previewText.slice(0, 12000),
        summaryMeta: `${res.pageCount} pages extracted`,
      };
    } else {
      const res = await convertPdfToDocx(bytes, cleanTitle);
      outBytes = res.docxBytes;
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      outExt = 'docx';
      preview = {
        kind: 'text',
        text: res.previewText.slice(0, 12000),
        summaryMeta: `Editable Word (.docx) · ${res.pageCount} page${res.pageCount === 1 ? '' : 's'}`,
      };
    }
  }
  // 5) Markdown / HTML / Plain Text -> PDF / DOCX / HTML / TXT
  else {
    const raw = new TextDecoder().decode(bytes);
    const isHtml = ext === 'html' || ext === 'htm';
    const blocks = isHtml ? parseHtmlToBlocks(raw) : parseMarkdownToBlocks(raw);

    onStage?.('rendering', 74, `Rendering ${blocks.length} document blocks to ${targetFormat.toUpperCase()}`);
    await yieldPaint();

    if (targetFormat === 'pdf') {
      outBytes = isHtml
        ? await convertHtmlToExactPdf(raw, { title: cleanTitle, orientation, renderMode })
        : await renderBlocksToPdf(blocks, { title: cleanTitle, renderMode });
      mime = 'application/pdf';
    } else if (targetFormat === 'docx') {
      outBytes = await buildDocxFromBlocks(blocks, { title: cleanTitle });
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      preview = {
        kind: 'html',
        html: blocksToPreviewHtml(blocks),
        text: raw.slice(0, 8000),
        summaryMeta: `Word (.docx) · ${blocks.length} blocks`,
      };
    } else if (targetFormat === 'html') {
      const bodyHtml = blocksToPreviewHtml(blocks);
      outText = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtmlBasic(cleanTitle)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:780px;margin:32px auto;padding:0 20px;color:#0f172a;line-height:1.6}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left}th{background:#f1f5f9}</style></head><body>${bodyHtml}</body></html>`;
      mime = 'text/html;charset=utf-8';
      preview = { kind: 'html', html: bodyHtml, text: outText.slice(0, 8000), summaryMeta: 'Styled HTML' };
    } else {
      outText = raw;
      mime = 'text/plain;charset=utf-8';
      outExt = 'txt';
      preview = { kind: 'text', text: raw.slice(0, 12000), summaryMeta: `${raw.split(/\r?\n/).length} lines` };
    }
  }

  onStage?.('previewing', 92, 'Generating live output preview');
  await yieldPaint();

  const blob =
    outBytes !== null
      ? new Blob([outBytes as unknown as BlobPart], { type: mime })
      : new Blob([outText || ''], { type: mime });

  if (mime === 'application/pdf' && outBytes) {
    const { pageCount, imgs } = await renderPdfThumbsForPreview(outBytes, 4);
    preview = {
      kind: 'pdf',
      pdfImgs: imgs,
      pageCount,
      summaryMeta: pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} · A4 PDF` : 'PDF Ready',
    };
  }

  const durationMs = Math.max(1, Math.round(performance.now() - started));
  onStage?.('done', 100, `Completed in ${durationMs} ms`);

  return {
    filename: `${base}.${outExt}`,
    mime,
    sizeBytes: blob.size,
    blob,
    preview,
    warnings,
    durationMs,
  };
}

/** Package all completed bulk outputs into one clean ZIP archive with deduplicated filenames */
export async function buildBulkOutputsZip(items: BulkJobItem[]): Promise<Blob> {
  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (const item of items) {
    if (item.status !== 'done' || !item.output) continue;
    let name = item.output.filename;
    const count = usedNames.get(name) || 0;
    if (count > 0) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)}_${count + 1}${name.slice(dot)}` : `${name}_${count + 1}`;
    }
    usedNames.set(item.output.filename, count + 1);
    zip.file(name, item.output.blob);
  }

  return zip.generateAsync({ type: 'blob' });
}
