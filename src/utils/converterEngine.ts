import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import { csvToJson, jsonToCsv, jsonToSimpleXml, parseCsv as parseCsvRows, simpleXmlToJson } from './formatters';

export type PdfRenderMode = 'auto' | 'vector' | 'visual';

export interface StructuredBlock {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'code' | 'hr' | 'table' | 'image';
  text?: string;
  rows?: string[][];
  imageDataUrl?: string;
  caption?: string;
}

export interface WorkbookPreview {
  sheetNames: string[];
  sheets: Record<string, string[][]>;
}

/** Detect if text contains non-WinAnsi Unicode characters (Bangla, Arabic, CJK, ৳, emojis, etc.) */
export function hasNonWinAnsiText(input: string): boolean {
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x7f) continue;
    if (code >= 0x00a0 && code <= 0x00ff) continue;
    // Common smart punctuation we map safely to ASCII in vector mode
    if (code === 0x2018 || code === 0x2019 || code === 0x201c || code === 0x201d || code === 0x2013 || code === 0x2014 || code === 0x2022 || code === 0x2026) {
      continue;
    }
    return true;
  }
  return false;
}

function blocksNeedVisualPdf(blocks: StructuredBlock[], title?: string, subtitle?: string): boolean {
  if (title && hasNonWinAnsiText(title)) return true;
  if (subtitle && hasNonWinAnsiText(subtitle)) return true;
  for (const b of blocks) {
    if (b.type === 'image' && b.imageDataUrl) return true;
    if (b.text && hasNonWinAnsiText(b.text)) return true;
    if (b.rows) {
      for (const row of b.rows) {
        for (const cell of row) {
          if (hasNonWinAnsiText(cell)) return true;
        }
      }
    }
  }
  return false;
}

function tableNeedsVisualPdf(rows: string[][], title?: string, subtitle?: string): boolean {
  if (title && hasNonWinAnsiText(title)) return true;
  if (subtitle && hasNonWinAnsiText(subtitle)) return true;
  for (const row of rows) {
    for (const cell of row) {
      if (hasNonWinAnsiText(cell)) return true;
    }
  }
  return false;
}

/** Sanitize text to WinAnsi-safe characters for pdf-lib StandardFonts */
export function toPdfSafeText(input: string): string {
  return String(input ?? '')
    .replace(/\t/g, '  ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u2026/g, '...')
    .replace(/\u09F3/g, 'BDT ')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0x00a1 && code <= 0x00ff) return ch;
      return ' ';
    });
}

function wrapTextLines(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  fontSize: number,
  maxWidth: number
): string[] {
  const safe = toPdfSafeText(text).trim();
  if (!safe) return [''];
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const clean = String(text ?? '').replace(/\r/g, '').trim();
  if (!clean) return [''];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width > maxWidth) {
        let chunk = '';
        for (const ch of Array.from(word)) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function canvasPagesToPdfBytes(
  canvases: HTMLCanvasElement[],
  pageW: number,
  pageH: number,
  title: string
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title || 'Document');

  for (const c of canvases) {
    const dataUrl = c.toDataURL('image/png');
    const b64 = dataUrl.split(',')[1] || '';
    const binStr = atob(b64);
    const pngBytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) pngBytes[i] = binStr.charCodeAt(i);
    const img = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: true }));
}

/** Parse Markdown text into structured document blocks */
export function parseMarkdownToBlocks(markdown: string): StructuredBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: StructuredBlock[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let tableBuf: string[][] = [];

  const flushTable = () => {
    if (tableBuf.length) {
      blocks.push({ type: 'table', rows: tableBuf });
      tableBuf = [];
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      flushTable();
      if (inCode) {
        blocks.push({ type: 'code', text: codeBuf.join('\n') });
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(rawLine);
      continue;
    }
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      if (!cells.every((c) => /^:?-+:?$/.test(c))) {
        tableBuf.push(cells);
      }
      continue;
    }
    flushTable();

    if (!trimmed) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4).replace(/\*\*/g, '') });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3).replace(/\*\*/g, '') });
    } else if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', text: trimmed.slice(2).replace(/\*\*/g, '') });
    } else if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      blocks.push({ type: 'li', text: trimmed.replace(/^([-*+]|\d+\.)\s+/, '').replace(/\*\*/g, '') });
    } else {
      blocks.push({ type: 'p', text: trimmed.replace(/\*\*/g, '').replace(/`/g, '') });
    }
  }
  flushTable();
  if (inCode && codeBuf.length) blocks.push({ type: 'code', text: codeBuf.join('\n') });
  return blocks;
}

/** Parse HTML markup cleanly into structured blocks including embedded images & tables */
export function parseHtmlToBlocks(html: string): StructuredBlock[] {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blocks: StructuredBlock[] = [];

    const walk = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'head' || tag === 'meta') return;
      if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          blocks.push({ type: 'image', imageDataUrl: src, caption: el.getAttribute('alt') || undefined });
        }
        return;
      }
      if (tag === 'h1') {
        const t = el.textContent?.trim();
        if (t) blocks.push({ type: 'h1', text: t });
        return;
      }
      if (tag === 'h2') {
        const t = el.textContent?.trim();
        if (t) blocks.push({ type: 'h2', text: t });
        return;
      }
      if (tag === 'h3' || tag === 'h4') {
        const t = el.textContent?.trim();
        if (t) blocks.push({ type: 'h3', text: t });
        return;
      }
      if (tag === 'p' || tag === 'blockquote') {
        const imgs = el.querySelectorAll('img');
        imgs.forEach((im) => {
          const src = im.getAttribute('src') || '';
          if (src.startsWith('data:image/')) {
            blocks.push({ type: 'image', imageDataUrl: src, caption: im.getAttribute('alt') || undefined });
          }
        });
        const t = el.textContent?.trim();
        if (t) blocks.push({ type: 'p', text: t });
        return;
      }
      if (tag === 'li') {
        const t = el.textContent?.trim();
        if (t) blocks.push({ type: 'li', text: t });
        return;
      }
      if (tag === 'pre') {
        const t = el.textContent?.trim();
        if (t) blocks.push({ type: 'code', text: t });
        return;
      }
      if (tag === 'hr') {
        blocks.push({ type: 'hr' });
        return;
      }
      if (tag === 'table') {
        const rows: string[][] = [];
        el.querySelectorAll('tr').forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim());
          if (cells.length) rows.push(cells);
        });
        if (rows.length) blocks.push({ type: 'table', rows });
        return;
      }
      for (const child of Array.from(el.children)) {
        walk(child);
      }
    };

    walk(doc.body);
    if (blocks.length) return blocks;
  }

  // Regex fallback for Node / plain HTML strings
  const blocks: StructuredBlock[] = [];
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  const tokenRe = /<(h1|h2|h3|p|li|pre)[^>]*>([\s\S]*?)<\/\1>|<img\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleaned)) !== null) {
    if (m[3] !== undefined) {
      const srcM = /\bsrc=["'](data:image\/[^"']+)["']/i.exec(m[3]);
      if (srcM) {
        const altM = /\balt=["']([^"']*)["']/i.exec(m[3]);
        blocks.push({ type: 'image', imageDataUrl: srcM[1], caption: altM?.[1] || undefined });
      }
      continue;
    }
    const tag = m[1].toLowerCase();
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (tag === 'h1') blocks.push({ type: 'h1', text });
    else if (tag === 'h2') blocks.push({ type: 'h2', text });
    else if (tag === 'h3') blocks.push({ type: 'h3', text });
    else if (tag === 'li') blocks.push({ type: 'li', text });
    else if (tag === 'pre') blocks.push({ type: 'code', text });
    else blocks.push({ type: 'p', text });
  }
  if (!blocks.length) {
    const plain = cleaned.replace(/<[^>]+>/g, '\n');
    for (const line of plain.split('\n')) {
      const t = line.trim();
      if (t) blocks.push({ type: 'p', text: t });
    }
  }
  return blocks;
}

/** Extract clean readable text from an RTF (.rtf) document */
export function extractTextFromRtf(rtf: string): string {
  let s = rtf
    .replace(/\r\n/g, '\n')
    // Remove header/font/color/stylesheet groups
    .replace(/\{\\\*\\[^}]+\}/g, '')
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object)[\s\S]*?\}/g, '')
    // Decode Unicode escapes \uNNNN?
    .replace(/\\u(-?\d+)\??/g, (_, codeStr) => {
      let code = Number(codeStr);
      if (code < 0) code += 65536;
      return String.fromCharCode(code);
    })
    // Decode hex \'xx
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Line/paragraph breaks
    .replace(/\\(?:par|line)\b\s?/g, '\n')
    .replace(/\\tab\b\s?/g, '\t')
    // Escaped literals
    .replace(/\\([\\{}])/g, '$1')
    // Strip remaining RTF control words
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
    .replace(/[{}]/g, '');
  s = s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

/** Extract clean text/HTML from legacy .doc files (supports HTML-saved .doc, RTF-saved .doc, WordXML .doc, and binary OLE2 .doc) */
export function extractTextFromLegacyDocBytes(bytes: Uint8Array): {
  text: string;
  html?: string;
  kind: 'html-doc' | 'rtf-doc' | 'xml-doc' | 'binary-doc';
} {
  const headAscii = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 512)));
  const trimmedHead = headAscii.trimStart();

  // Case 1: RTF saved with .doc extension
  if (trimmedHead.startsWith('{\\rtf')) {
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return { text: extractTextFromRtf(raw), kind: 'rtf-doc' };
  }

  // Case 2: HTML or MHTML saved with .doc extension (very common from web exports & old Word)
  if (/^<(?:!doctype|html|head|body|table|div|p)\b/i.test(trimmedHead) || /<html[\s>]/i.test(trimmedHead)) {
    const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const plain = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return { text: plain, html, kind: 'html-doc' };
  }

  // Case 3: WordprocessingML XML (.doc)
  if (trimmedHead.startsWith('<?xml') || trimmedHead.includes('<w:document')) {
    const xml = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const paras: string[] = [];
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(xml)) !== null) {
      const runs = m[1].replace(/<[^>]+>/g, '').trim();
      if (runs) paras.push(runs);
    }
    return { text: paras.join('\n\n') || xml.replace(/<[^>]+>/g, ' ').trim(), kind: 'xml-doc' };
  }

  // Case 4: Classic Binary OLE2 Microsoft Word 97-2003 (.doc)
  // Extract readable runs from UTF-16LE and single-byte ASCII/Windows-1252 streams, filtering OLE directory junk
  const utf16Runs: string[] = [];
  let cur16 = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    const isGood =
      code === 0x000d ||
      code === 0x000a ||
      code === 0x0009 ||
      (code >= 0x0020 && code <= 0x007e) ||
      (code >= 0x0980 && code <= 0x09ff) || // Bangla Unicode block
      (code >= 0x0600 && code <= 0x06ff) || // Arabic
      (code >= 0x0900 && code <= 0x097f); // Devanagari
    if (isGood) {
      cur16 += code === 0x000d ? '\n' : String.fromCharCode(code);
    } else {
      const cleaned = cur16.trim();
      if (cleaned.length >= 6 && !/^(Root Entry|WordDocument|1Table|0Table|SummaryInformation|DocumentSummaryInformation|CompObj|Data|MsoDataStore|Microsoft Word)$/i.test(cleaned)) {
        utf16Runs.push(cleaned);
      }
      cur16 = '';
    }
  }
  if (cur16.trim().length >= 6) utf16Runs.push(cur16.trim());

  const asciiRuns: string[] = [];
  let curA = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 13 || b === 10 || b === 9 || (b >= 32 && b <= 126)) {
      curA += b === 13 ? '\n' : String.fromCharCode(b);
    } else {
      const cleaned = curA.trim();
      if (
        cleaned.length >= 12 &&
        /[a-zA-Z]{3,}/.test(cleaned) &&
        !/^(Root Entry|WordDocument|Normal\.dot|Calibri|Times New Roman|Cambria|Microsoft Office Word|bjbj)/i.test(cleaned)
      ) {
        asciiRuns.push(cleaned);
      }
      curA = '';
    }
  }
  if (curA.trim().length >= 12) asciiRuns.push(curA.trim());

  const best = utf16Runs.join('\n').length >= asciiRuns.join('\n').length ? utf16Runs : asciiRuns;
  const deduped = Array.from(new Set(best))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: deduped, kind: 'binary-doc' };
}

/** Parse OpenDocument Text (.odt) archive locally via JSZip */
export async function parseOdtBytes(bytes: Uint8Array): Promise<{
  html: string;
  plainText: string;
  blocks: StructuredBlock[];
}> {
  const zip = await JSZip.loadAsync(bytes);
  const contentFile = zip.file('content.xml');
  if (!contentFile) {
    throw new Error('Invalid .odt archive (content.xml missing).');
  }
  const xml = await contentFile.async('string');
  const blocks: StructuredBlock[] = [];
  const tokenRe = /<(text:h|text:p|table:table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (tag === 'table:table') {
      const rows: string[][] = [];
      const rowRe = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(inner)) !== null) {
        const cells: string[] = [];
        const cellRe = /<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi;
        let cm: RegExpExecArray | null;
        while ((cm = cellRe.exec(rm[1])) !== null) {
          cells.push(cm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) blocks.push({ type: 'table', rows });
    } else {
      const txt = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      blocks.push({ type: tag === 'text:h' ? 'h2' : 'p', text: txt });
    }
  }
  const plainText = blocks.map((b) => b.text || '').filter(Boolean).join('\n\n');
  const html = blocksToSimpleHtml(blocks);
  return { html, plainText, blocks };
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function blocksToSimpleHtml(blocks: StructuredBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'h1') return `<h1>${escapeHtml(b.text || '')}</h1>`;
      if (b.type === 'h2') return `<h2>${escapeHtml(b.text || '')}</h2>`;
      if (b.type === 'h3') return `<h3>${escapeHtml(b.text || '')}</h3>`;
      if (b.type === 'li') return `<ul><li>${escapeHtml(b.text || '')}</li></ul>`;
      if (b.type === 'code') return `<pre><code>${escapeHtml(b.text || '')}</code></pre>`;
      if (b.type === 'hr') return '<hr />';
      if (b.type === 'image' && b.imageDataUrl) return `<p><img src="${b.imageDataUrl}" alt="${escapeHtml(b.caption || '')}" style="max-width:100%;height:auto;" /></p>`;
      if (b.type === 'table' && b.rows?.length) {
        const rowsHtml = b.rows
          .map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`)
          .join('');
        return `<table>${rowsHtml}</table>`;
      }
      return `<p>${escapeHtml(b.text || '')}</p>`;
    })
    .join('\n');
}

/** Visual HiDPI Canvas -> Multi-page A4 PDF renderer (100% Unicode / Bangla / ৳ / Embedded Image support!) */
export async function renderBlocksToVisualPdf(
  blocks: StructuredBlock[],
  options: { title?: string; subtitle?: string } = {}
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    return renderBlocksToPdf(blocks, { ...options, renderMode: 'vector' });
  }

  const scale = 2; // crisp 144 DPI
  const pageW = 595.28;
  const pageH = 841.89;
  const cw = Math.round(pageW * scale);
  const ch = Math.round(pageH * scale);
  const marginX = 48 * scale;
  const contentW = cw - marginX * 2;
  const topY = 58 * scale;
  const bottomLimit = ch - 58 * scale;
  const fontStack = `'Plus Jakarta Sans', 'Noto Sans Bengali', 'Hind Siliguri', system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const monoStack = `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;

  const pages: HTMLCanvasElement[] = [];
  let canvas = document.createElement('canvas');
  let ctx!: CanvasRenderingContext2D;
  let y = topY;

  const startNewPage = (isFirst: boolean) => {
    canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    // Top indigo bar
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(0, 0, cw, (isFirst ? 6 : 4) * scale);
    pages.push(canvas);
    y = topY;
  };

  const ensureSpace = (neededPx: number) => {
    if (y + neededPx > bottomLimit) {
      startNewPage(false);
    }
  };

  startNewPage(true);

  if (options.title) {
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 ${20 * scale}px ${fontStack}`;
    const titleLines = wrapCanvasText(ctx, options.title, contentW);
    for (const tl of titleLines) {
      ctx.fillText(tl, marginX, y);
      y += 26 * scale;
    }
    if (options.subtitle) {
      ctx.fillStyle = '#64748b';
      ctx.font = `500 ${9.5 * scale}px ${fontStack}`;
      ctx.fillText(options.subtitle, marginX, y - 4 * scale);
      y += 14 * scale;
    }
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(cw - marginX, y);
    ctx.stroke();
    y += 20 * scale;
  }

  for (const b of blocks) {
    if (b.type === 'hr') {
      ensureSpace(16 * scale);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1 * scale;
      ctx.beginPath();
      ctx.moveTo(marginX, y);
      ctx.lineTo(cw - marginX, y);
      ctx.stroke();
      y += 16 * scale;
      continue;
    }

    if (b.type === 'image' && b.imageDataUrl) {
      const img = await loadImageElement(b.imageDataUrl);
      if (img && img.width > 0 && img.height > 0) {
        const maxImgW = contentW;
        const maxImgH = 340 * scale;
        const ratio = Math.min(maxImgW / img.width, maxImgH / img.height, 1.5);
        const drawW = Math.round(img.width * ratio);
        const drawH = Math.round(img.height * ratio);
        ensureSpace(drawH + 20 * scale);
        ctx.drawImage(img, marginX, y, drawW, drawH);
        y += drawH + 14 * scale;
      }
      continue;
    }

    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      const pt = b.type === 'h1' ? 16 : b.type === 'h2' ? 13.5 : 11.5;
      ctx.font = `700 ${pt * scale}px ${fontStack}`;
      const lines = wrapCanvasText(ctx, b.text || '', contentW);
      const lh = (pt + 6) * scale;
      ensureSpace(lines.length * lh + 12 * scale);
      y += 6 * scale;
      ctx.fillStyle = b.type === 'h1' ? '#4f46e5' : '#0f172a';
      for (const ln of lines) {
        ctx.fillText(ln, marginX, y);
        y += lh;
      }
      y += 4 * scale;
      continue;
    }

    if (b.type === 'li') {
      const pt = 10.5;
      ctx.font = `400 ${pt * scale}px ${fontStack}`;
      const lines = wrapCanvasText(ctx, b.text || '', contentW - 18 * scale);
      const lh = 16 * scale;
      ensureSpace(lines.length * lh + 4 * scale);
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath();
      ctx.arc(marginX + 5 * scale, y - 3.5 * scale, 2.2 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e293b';
      for (const ln of lines) {
        ctx.fillText(ln, marginX + 16 * scale, y);
        y += lh;
      }
      y += 2 * scale;
      continue;
    }

    if (b.type === 'code') {
      const pt = 9;
      ctx.font = `400 ${pt * scale}px ${monoStack}`;
      const rawLines = (b.text || '').split('\n');
      const wrapped: string[] = [];
      for (const rl of rawLines) wrapped.push(...wrapCanvasText(ctx, rl, contentW - 22 * scale));
      const lh = 13.5 * scale;
      const boxH = wrapped.length * lh + 16 * scale;
      ensureSpace(boxH + 10 * scale);
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1 * scale;
      ctx.fillRect(marginX, y - 10 * scale, contentW, boxH);
      ctx.strokeRect(marginX, y - 10 * scale, contentW, boxH);
      ctx.fillStyle = '#0f172a';
      let cy = y + 4 * scale;
      for (const ln of wrapped) {
        ctx.fillText(ln, marginX + 11 * scale, cy);
        cy += lh;
      }
      y += boxH + 8 * scale;
      continue;
    }

    if (b.type === 'table' && b.rows?.length) {
      const cols = Math.max(...b.rows.map((r) => r.length), 1);
      const colW = contentW / cols;
      const pt = cols > 6 ? 7.8 : 8.8;
      const lh = (pt + 4) * scale;

      for (let rIdx = 0; rIdx < b.rows.length; rIdx++) {
        const row = b.rows[rIdx];
        const isHeader = rIdx === 0;
        ctx.font = `${isHeader ? '700' : '400'} ${pt * scale}px ${fontStack}`;
        const wrappedCells = Array.from({ length: cols }, (_, c) =>
          wrapCanvasText(ctx, String(row[c] ?? ''), colW - 10 * scale)
        );
        const maxL = Math.min(5, Math.max(...wrappedCells.map((w) => w.length), 1));
        const rowH = maxL * lh + 10 * scale;
        ensureSpace(rowH + 4 * scale);

        ctx.fillStyle = isHeader ? '#1e293b' : rIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
        ctx.fillRect(marginX, y - 10 * scale, contentW, rowH);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 0.6 * scale;
        ctx.strokeRect(marginX, y - 10 * scale, contentW, rowH);

        ctx.fillStyle = isHeader ? '#ffffff' : '#0f172a';
        ctx.font = `${isHeader ? '700' : '400'} ${pt * scale}px ${fontStack}`;
        for (let c = 0; c < cols; c++) {
          let ty = y + 2 * scale;
          for (const ln of wrappedCells[c].slice(0, 5)) {
            ctx.fillText(ln, marginX + c * colW + 5 * scale, ty);
            ty += lh;
          }
        }
        y += rowH;
      }
      y += 14 * scale;
      continue;
    }

    // Default paragraph
    const pt = 10.5;
    ctx.font = `400 ${pt * scale}px ${fontStack}`;
    const lines = wrapCanvasText(ctx, b.text || '', contentW);
    const lh = 16 * scale;
    ensureSpace(lines.length * lh + 6 * scale);
    ctx.fillStyle = '#1e293b';
    for (const ln of lines) {
      ctx.fillText(ln, marginX, y);
      y += lh;
    }
    y += 6 * scale;
  }

  // Draw crisp footers on all pages
  pages.forEach((pgCanvas, idx) => {
    const pCtx = pgCanvas.getContext('2d')!;
    pCtx.strokeStyle = '#e2e8f0';
    pCtx.lineWidth = 0.8 * scale;
    pCtx.beginPath();
    pCtx.moveTo(marginX, ch - 36 * scale);
    pCtx.lineTo(cw - marginX, ch - 36 * scale);
    pCtx.stroke();
    pCtx.fillStyle = '#64748b';
    pCtx.font = `500 ${8 * scale}px ${fontStack}`;
    const numStr = `Page ${idx + 1} of ${pages.length}`;
    const nw = pCtx.measureText(numStr).width;
    pCtx.fillText(numStr, cw - marginX - nw, ch - 21 * scale);
  });

  return canvasPagesToPdfBytes(pages, pageW, pageH, options.title || 'Converted Document');
}

/** Visual HiDPI Canvas -> Multi-page A4 PDF Table renderer (handles Unicode/Bangla + wide tables!) */
export async function renderTableToVisualPdf(
  rows: string[][],
  options: { title?: string; orientation?: 'portrait' | 'landscape'; subtitle?: string } = {}
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    return renderTableToPdf(rows, { ...options, renderMode: 'vector' });
  }
  const safeRows = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!safeRows.length) {
    return renderBlocksToVisualPdf([{ type: 'p', text: 'Empty table dataset.' }], {
      title: options.title || 'Data Table',
    });
  }

  const colCount = Math.max(...safeRows.map((r) => r.length), 1);
  const orientation = options.orientation || (colCount > 5 ? 'landscape' : 'portrait');
  const pageW = orientation === 'landscape' ? 841.89 : 595.28;
  const pageH = orientation === 'landscape' ? 595.28 : 841.89;
  const scale = 2;
  const cw = Math.round(pageW * scale);
  const ch = Math.round(pageH * scale);
  const marginX = 34 * scale;
  const contentW = cw - marginX * 2;
  const bottomLimit = ch - 46 * scale;
  const fontStack = `'Plus Jakarta Sans', 'Noto Sans Bengali', 'Hind Siliguri', system-ui, -apple-system, 'Segoe UI', sans-serif`;

  const maxPerGroup = orientation === 'landscape' ? 14 : 9;
  const colGroups: [number, number][] = [];
  for (let start = 0; start < colCount; start += maxPerGroup) {
    colGroups.push([start, Math.min(colCount, start + maxPerGroup)]);
  }

  const headers = safeRows[0];
  const bodyRows = safeRows.slice(1);
  const pages: HTMLCanvasElement[] = [];

  for (let gIdx = 0; gIdx < colGroups.length; gIdx++) {
    const [colStart, colEnd] = colGroups[gIdx];
    const groupCols = colEnd - colStart;
    const weights = Array.from({ length: groupCols }, (_, offset) => {
      const c = colStart + offset;
      let maxLen = 6;
      for (let r = 0; r < Math.min(safeRows.length, 40); r++) {
        maxLen = Math.max(maxLen, Math.min(34, String(safeRows[r][c] ?? '').length));
      }
      return maxLen;
    });
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    const colWidths = weights.map((w) => (w / totalW) * contentW);
    const pt = groupCols > 10 ? 7.2 : groupCols > 6 ? 8 : 8.8;
    const lh = (pt + 3.5) * scale;

    let canvas = document.createElement('canvas');
    let ctx!: CanvasRenderingContext2D;
    let y = 0;

    const startPage = (isFirstOfGroup: boolean) => {
      canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(0, 0, cw, 5 * scale);
      pages.push(canvas);
      y = 38 * scale;
      if (isFirstOfGroup) {
        ctx.fillStyle = '#0f172a';
        ctx.font = `700 ${15 * scale}px ${fontStack}`;
        const groupSuffix = colGroups.length > 1 ? ` (Columns ${colStart + 1}–${colEnd})` : '';
        ctx.fillText(`${options.title || 'Spreadsheet Report'}${groupSuffix}`, marginX, y);
        y += 17 * scale;
        ctx.fillStyle = '#64748b';
        ctx.font = `500 ${8.5 * scale}px ${fontStack}`;
        const meta =
          options.subtitle ||
          `${bodyRows.length.toLocaleString()} rows · ${colCount} columns · Generated ${new Date().toISOString().slice(0, 10)}`;
        ctx.fillText(meta, marginX, y);
        y += 16 * scale;
      }
    };

    const drawRow = (row: string[], isHeader: boolean, rIdx: number) => {
      ctx.font = `${isHeader ? '700' : '400'} ${pt * scale}px ${fontStack}`;
      const wrapped = Array.from({ length: groupCols }, (_, offset) =>
        wrapCanvasText(ctx, String(row[colStart + offset] ?? ''), colWidths[offset] - 8 * scale)
      );
      const maxL = Math.min(4, Math.max(...wrapped.map((w) => w.length), 1));
      const rowH = maxL * lh + 9 * scale;

      if (y + rowH > bottomLimit) {
        startPage(false);
        if (!isHeader) drawRow(headers, true, -1);
      }

      ctx.fillStyle = isHeader ? '#1e293b' : rIdx % 2 === 1 ? '#f8fafc' : '#ffffff';
      ctx.fillRect(marginX, y, contentW, rowH);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 0.5 * scale;
      ctx.strokeRect(marginX, y, contentW, rowH);

      ctx.fillStyle = isHeader ? '#ffffff' : '#0f172a';
      ctx.font = `${isHeader ? '700' : '400'} ${pt * scale}px ${fontStack}`;
      let cx = marginX;
      for (let offset = 0; offset < groupCols; offset++) {
        let ty = y + lh;
        for (const ln of wrapped[offset].slice(0, 4)) {
          ctx.fillText(ln, cx + 4 * scale, ty);
          ty += lh;
        }
        cx += colWidths[offset];
      }
      y += rowH;
    };

    startPage(true);
    drawRow(headers, true, -1);
    for (let i = 0; i < bodyRows.length; i++) {
      drawRow(bodyRows[i], false, i);
    }
  }

  pages.forEach((pgCanvas, idx) => {
    const pCtx = pgCanvas.getContext('2d')!;
    pCtx.strokeStyle = '#e2e8f0';
    pCtx.lineWidth = 0.7 * scale;
    pCtx.beginPath();
    pCtx.moveTo(marginX, ch - 30 * scale);
    pCtx.lineTo(cw - marginX, ch - 30 * scale);
    pCtx.stroke();
    pCtx.fillStyle = '#64748b';
    pCtx.font = `500 ${7.5 * scale}px ${fontStack}`;
    const pgLabel = `Page ${idx + 1} of ${pages.length}`;
    const w = pCtx.measureText(pgLabel).width;
    pCtx.fillText(pgLabel, cw - marginX - w, ch - 17 * scale);
  });

  return canvasPagesToPdfBytes(pages, pageW, pageH, options.title || 'Spreadsheet Report');
}

/** Render structured document blocks into a publication-grade beautified A4 PDF */
export async function renderBlocksToPdf(
  blocks: StructuredBlock[],
  options: { title?: string; subtitle?: string; accentHex?: string; renderMode?: PdfRenderMode } = {}
): Promise<Uint8Array> {
  const mode = options.renderMode || 'auto';
  if (
    typeof document !== 'undefined' &&
    (mode === 'visual' || (mode === 'auto' && blocksNeedVisualPdf(blocks, options.title, options.subtitle)))
  ) {
    return renderBlocksToVisualPdf(blocks, options);
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(toPdfSafeText(options.title || 'Document'));

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  const pageW = 595.28;
  const pageH = 841.89;
  const marginX = 50;
  const topY = pageH - 54;
  const bottomY = 56;
  const contentW = pageW - marginX * 2;

  const accentColor = rgb(0.31, 0.27, 0.9);
  const inkColor = rgb(0.06, 0.09, 0.16);
  const mutedColor = rgb(0.39, 0.45, 0.55);
  const lineColor = rgb(0.88, 0.91, 0.94);
  const surfaceColor = rgb(0.96, 0.97, 0.99);

  let page = pdf.addPage([pageW, pageH]);
  let y = topY;

  const ensureSpace = (needed: number) => {
    if (y - needed < bottomY) {
      page = pdf.addPage([pageW, pageH]);
      page.drawRectangle({ x: 0, y: pageH - 4, width: pageW, height: 4, color: accentColor });
      y = topY;
    }
  };

  page.drawRectangle({ x: 0, y: pageH - 6, width: pageW, height: 6, color: accentColor });
  if (options.title) {
    const titleLines = wrapTextLines(options.title, fontBold, 20, contentW);
    for (const tl of titleLines) {
      page.drawText(tl, { x: marginX, y, size: 20, font: fontBold, color: inkColor });
      y -= 24;
    }
    if (options.subtitle) {
      page.drawText(toPdfSafeText(options.subtitle), {
        x: marginX,
        y: y + 4,
        size: 9.5,
        font: fontRegular,
        color: mutedColor,
      });
      y -= 14;
    }
    page.drawLine({
      start: { x: marginX, y: y + 4 },
      end: { x: pageW - marginX, y: y + 4 },
      thickness: 1,
      color: lineColor,
    });
    y -= 16;
  }

  for (const b of blocks) {
    if (b.type === 'hr') {
      ensureSpace(16);
      page.drawLine({
        start: { x: marginX, y: y - 4 },
        end: { x: pageW - marginX, y: y - 4 },
        thickness: 0.8,
        color: lineColor,
      });
      y -= 16;
      continue;
    }

    if (b.type === 'image' && b.imageDataUrl) {
      try {
        const mimeMatch = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i.exec(b.imageDataUrl);
        if (mimeMatch) {
          const bin = atob(mimeMatch[2]);
          const imgBytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);
          const embedded = mimeMatch[1].toLowerCase().includes('png')
            ? await pdf.embedPng(imgBytes)
            : await pdf.embedJpg(imgBytes);
          const dims = embedded.scaleToFit(contentW, 300);
          ensureSpace(dims.height + 16);
          page.drawImage(embedded, {
            x: marginX,
            y: y - dims.height,
            width: dims.width,
            height: dims.height,
          });
          y -= dims.height + 14;
        }
      } catch {
        // skip unsupported inline image in vector mode
      }
      continue;
    }

    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      const size = b.type === 'h1' ? 16 : b.type === 'h2' ? 13.5 : 11.5;
      const lines = wrapTextLines(b.text || '', fontBold, size, contentW);
      ensureSpace(lines.length * (size + 5) + 12);
      y -= 6;
      for (const ln of lines) {
        page.drawText(ln, {
          x: marginX,
          y,
          size,
          font: fontBold,
          color: b.type === 'h1' ? accentColor : inkColor,
        });
        y -= size + 5;
      }
      y -= 4;
      continue;
    }

    if (b.type === 'li') {
      const lines = wrapTextLines(b.text || '', fontRegular, 10.5, contentW - 18);
      ensureSpace(lines.length * 15 + 4);
      page.drawCircle({ x: marginX + 5, y: y + 3.5, size: 2, color: accentColor });
      for (const ln of lines) {
        page.drawText(ln, { x: marginX + 15, y, size: 10.5, font: fontRegular, color: inkColor });
        y -= 15;
      }
      y -= 2;
      continue;
    }

    if (b.type === 'code') {
      const rawLines = toPdfSafeText(b.text || '').split('\n');
      const codeLines: string[] = [];
      for (const rl of rawLines) {
        codeLines.push(...wrapTextLines(rl, fontMono, 8.8, contentW - 20));
      }
      const boxH = codeLines.length * 12.5 + 14;
      ensureSpace(boxH + 8);
      page.drawRectangle({
        x: marginX,
        y: y - boxH + 10,
        width: contentW,
        height: boxH,
        color: surfaceColor,
        borderColor: lineColor,
        borderWidth: 0.75,
      });
      let cy = y - 2;
      for (const cl of codeLines) {
        page.drawText(cl, { x: marginX + 10, y: cy, size: 8.8, font: fontMono, color: inkColor });
        cy -= 12.5;
      }
      y -= boxH + 10;
      continue;
    }

    if (b.type === 'table' && b.rows && b.rows.length > 0) {
      const cols = Math.max(...b.rows.map((r) => r.length), 1);
      const colW = contentW / cols;
      const cellFontSize = cols > 6 ? 7.5 : 8.5;

      for (let rIdx = 0; rIdx < b.rows.length; rIdx++) {
        const row = b.rows[rIdx];
        const isHeader = rIdx === 0;
        const wrappedCells = Array.from({ length: cols }, (_, c) =>
          wrapTextLines(row[c] ?? '', isHeader ? fontBold : fontRegular, cellFontSize, colW - 8)
        );
        const maxLines = Math.max(...wrappedCells.map((wc) => wc.length), 1);
        const rowH = maxLines * (cellFontSize + 3.5) + 10;
        ensureSpace(rowH + 4);

        const rowBottom = y - rowH + 8;
        page.drawRectangle({
          x: marginX,
          y: rowBottom,
          width: contentW,
          height: rowH,
          color: isHeader ? accentColor : rIdx % 2 === 0 ? surfaceColor : rgb(1, 1, 1),
          borderColor: lineColor,
          borderWidth: 0.5,
        });

        for (let c = 0; c < cols; c++) {
          let ty = y - 2;
          for (const ln of wrappedCells[c]) {
            page.drawText(ln, {
              x: marginX + c * colW + 4,
              y: ty,
              size: cellFontSize,
              font: isHeader ? fontBold : fontRegular,
              color: isHeader ? rgb(1, 1, 1) : inkColor,
            });
            ty -= cellFontSize + 3.5;
          }
        }
        y -= rowH;
      }
      y -= 12;
      continue;
    }

    const lines = wrapTextLines(b.text || '', fontRegular, 10.5, contentW);
    ensureSpace(lines.length * 15 + 6);
    for (const ln of lines) {
      page.drawText(ln, { x: marginX, y, size: 10.5, font: fontRegular, color: inkColor });
      y -= 15;
    }
    y -= 6;
  }

  const pages = pdf.getPages();
  const total = pages.length;
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: marginX, y: 38 },
      end: { x: pageW - marginX, y: 38 },
      thickness: 0.6,
      color: lineColor,
    });
    const numStr = `Page ${i + 1} of ${total}`;
    const nw = fontRegular.widthOfTextAtSize(numStr, 8);
    p.drawText(numStr, {
      x: pageW - marginX - nw,
      y: 24,
      size: 8,
      font: fontRegular,
      color: mutedColor,
    });
  });

  return new Uint8Array(await pdf.save({ useObjectStreams: true }));
}

/** Render tabular rows (CSV / XLSX / JSON) into a beautified A4 PDF table report (supports wide sheets + Unicode!) */
export async function renderTableToPdf(
  rows: string[][],
  options: { title?: string; orientation?: 'portrait' | 'landscape'; subtitle?: string; renderMode?: PdfRenderMode } = {}
): Promise<Uint8Array> {
  const safeRows = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!safeRows.length) {
    return renderBlocksToPdf([{ type: 'p', text: 'Empty table dataset.' }], {
      title: options.title || 'Data Table',
      renderMode: options.renderMode,
    });
  }

  const mode = options.renderMode || 'auto';
  if (
    typeof document !== 'undefined' &&
    (mode === 'visual' || (mode === 'auto' && tableNeedsVisualPdf(safeRows, options.title, options.subtitle)))
  ) {
    return renderTableToVisualPdf(safeRows, options);
  }

  const colCount = Math.max(...safeRows.map((r) => r.length), 1);
  const orientation = options.orientation || (colCount > 5 ? 'landscape' : 'portrait');
  const pageW = orientation === 'landscape' ? 841.89 : 595.28;
  const pageH = orientation === 'landscape' ? 595.28 : 841.89;
  const marginX = 34;
  const contentW = pageW - marginX * 2;
  const bottomY = 48;

  const pdf = await PDFDocument.create();
  pdf.setTitle(toPdfSafeText(options.title || 'Spreadsheet Report'));

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const headerBg = rgb(0.11, 0.15, 0.28);
  const accentColor = rgb(0.31, 0.27, 0.9);
  const inkColor = rgb(0.08, 0.11, 0.18);
  const mutedColor = rgb(0.4, 0.46, 0.56);
  const zebraColor = rgb(0.96, 0.97, 0.99);
  const borderColor = rgb(0.87, 0.9, 0.94);

  // Split wide tables into column chunks so zero columns are ever dropped!
  const maxPerGroup = orientation === 'landscape' ? 14 : 9;
  const colGroups: [number, number][] = [];
  for (let start = 0; start < colCount; start += maxPerGroup) {
    colGroups.push([start, Math.min(colCount, start + maxPerGroup)]);
  }

  const headers = safeRows[0];
  const bodyRows = safeRows.slice(1);

  for (let gIdx = 0; gIdx < colGroups.length; gIdx++) {
    const [colStart, colEnd] = colGroups[gIdx];
    const groupCols = colEnd - colStart;
    const weights = Array.from({ length: groupCols }, (_, offset) => {
      const c = colStart + offset;
      let maxLen = 6;
      for (let r = 0; r < Math.min(safeRows.length, 40); r++) {
        maxLen = Math.max(maxLen, Math.min(34, String(safeRows[r][c] ?? '').length));
      }
      return maxLen;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    const colWidths = weights.map((w) => (w / totalWeight) * contentW);
    const fontSize = groupCols > 10 ? 6.8 : groupCols > 7 ? 7.4 : groupCols > 5 ? 8 : 8.8;

    let page = pdf.addPage([pageW, pageH]);
    let y = pageH - 42;

    const drawPageTop = (isFirst: boolean) => {
      page.drawRectangle({ x: 0, y: pageH - 5, width: pageW, height: 5, color: accentColor });
      y = pageH - 36;
      if (isFirst) {
        const groupSuffix = colGroups.length > 1 ? ` (Cols ${colStart + 1}-${colEnd})` : '';
        page.drawText(toPdfSafeText((options.title || 'Spreadsheet Table Report') + groupSuffix), {
          x: marginX,
          y,
          size: 15.5,
          font: fontBold,
          color: inkColor,
        });
        y -= 16;
        const meta =
          options.subtitle ||
          `${bodyRows.length.toLocaleString()} rows · ${colCount} columns · Generated ${new Date().toISOString().slice(0, 10)}`;
        page.drawText(toPdfSafeText(meta), {
          x: marginX,
          y,
          size: 8.5,
          font: fontRegular,
          color: mutedColor,
        });
        y -= 18;
      }
    };

    const drawRow = (row: string[], isHeader: boolean, rowIdx: number) => {
      const wrapped = Array.from({ length: groupCols }, (_, offset) =>
        wrapTextLines(String(row[colStart + offset] ?? ''), isHeader ? fontBold : fontRegular, fontSize, colWidths[offset] - 8)
      );
      const maxLines = Math.min(4, Math.max(...wrapped.map((w) => w.length), 1));
      const rowH = maxLines * (fontSize + 3.2) + 9;

      if (y - rowH < bottomY) {
        page = pdf.addPage([pageW, pageH]);
        drawPageTop(false);
        if (!isHeader) drawRow(headers, true, -1);
      }

      const rowBottom = y - rowH + 6;
      page.drawRectangle({
        x: marginX,
        y: rowBottom,
        width: contentW,
        height: rowH,
        color: isHeader ? headerBg : rowIdx % 2 === 1 ? zebraColor : rgb(1, 1, 1),
        borderColor,
        borderWidth: 0.45,
      });

      let cx = marginX;
      for (let offset = 0; offset < groupCols; offset++) {
        let ty = y - 3;
        const lines = wrapped[offset].slice(0, 4);
        for (const ln of lines) {
          page.drawText(ln, {
            x: cx + 4,
            y: ty,
            size: fontSize,
            font: isHeader ? fontBold : fontRegular,
            color: isHeader ? rgb(1, 1, 1) : inkColor,
          });
          ty -= fontSize + 3.2;
        }
        cx += colWidths[offset];
      }
      y -= rowH;
    };

    drawPageTop(true);
    drawRow(headers, true, -1);
    for (let i = 0; i < bodyRows.length; i++) {
      drawRow(bodyRows[i], false, i);
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({
      start: { x: marginX, y: 32 },
      end: { x: pageW - marginX, y: 32 },
      thickness: 0.5,
      color: borderColor,
    });
    const pgLabel = `Page ${idx + 1} of ${pages.length}`;
    const w = fontRegular.widthOfTextAtSize(pgLabel, 7.5);
    p.drawText(pgLabel, {
      x: pageW - marginX - w,
      y: 19,
      size: 7.5,
      font: fontRegular,
      color: mutedColor,
    });
  });

  return new Uint8Array(await pdf.save({ useObjectStreams: true }));
}

/** Export ALL sheets of an Excel workbook into one combined multi-section PDF */
export async function exportWorkbookAllSheetsToPdf(
  preview: WorkbookPreview,
  options: { title?: string; orientation?: 'portrait' | 'landscape'; renderMode?: PdfRenderMode } = {}
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  merged.setTitle(toPdfSafeText(options.title || 'Workbook Report'));

  for (const sheetName of preview.sheetNames) {
    const rows = preview.sheets[sheetName] || [];
    if (!rows.some((r) => r.some((c) => String(c ?? '').trim() !== ''))) continue;
    const sheetPdfBytes = await renderTableToPdf(rows, {
      title: `${options.title || 'Workbook'} — ${sheetName}`,
      orientation: options.orientation,
      renderMode: options.renderMode,
    });
    const src = await PDFDocument.load(sheetPdfBytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }

  if (merged.getPageCount() === 0) {
    return renderBlocksToPdf([{ type: 'p', text: 'Workbook contains no non-empty sheets.' }], {
      title: options.title || 'Workbook Report',
      renderMode: options.renderMode,
    });
  }
  return new Uint8Array(await merged.save({ useObjectStreams: true }));
}

/** Build a genuine styled Microsoft Word (.docx) binary from structured blocks */
export async function buildDocxFromBlocks(
  blocks: StructuredBlock[],
  options: { title?: string; pageBreaksBetweenPages?: boolean } = {}
): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];

  if (options.title) {
    children.push(
      new Paragraph({
        text: options.title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 },
      })
    );
  }

  for (const b of blocks) {
    if (b.type === 'hr') {
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
      continue;
    }
    if (b.type === 'h1') {
      children.push(
        new Paragraph({
          text: b.text || '',
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (b.type === 'h2') {
      children.push(
        new Paragraph({
          text: b.text || '',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (b.type === 'h3') {
      children.push(
        new Paragraph({
          text: b.text || '',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        })
      );
    } else if (b.type === 'li') {
      children.push(
        new Paragraph({
          text: b.text || '',
          bullet: { level: 0 },
          spacing: { after: 80 },
        })
      );
    } else if (b.type === 'code') {
      children.push(
        new Paragraph({
          shading: { type: ShadingType.SOLID, color: 'F1F5F9', fill: 'F1F5F9' },
          spacing: { before: 100, after: 120 },
          children: [
            new TextRun({
              text: b.text || '',
              font: 'Courier New',
              size: 19,
            }),
          ],
        })
      );
    } else if (b.type === 'table' && b.rows && b.rows.length > 0) {
      const cols = Math.max(...b.rows.map((r) => r.length), 1);
      const tableRows = b.rows.map(
        (r, rIdx) =>
          new TableRow({
            tableHeader: rIdx === 0,
            children: Array.from({ length: cols }, (_, c) => {
              const isHeader = rIdx === 0;
              return new TableCell({
                shading: isHeader
                  ? { type: ShadingType.SOLID, color: '4F46E5', fill: '4F46E5' }
                  : rIdx % 2 === 0
                  ? { type: ShadingType.SOLID, color: 'F8FAFC', fill: 'F8FAFC' }
                  : undefined,
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                  right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.LEFT,
                    children: [
                      new TextRun({
                        text: String(r[c] ?? ''),
                        bold: isHeader,
                        color: isHeader ? 'FFFFFF' : '0F172A',
                        size: 20,
                      }),
                    ],
                  }),
                ],
              });
            }),
          })
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows,
        })
      );
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    } else if (b.type !== 'image') {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: b.text || '', size: 22 })],
        })
      );
    }
  }

  const doc = new Document({
    title: options.title || 'Document',
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children: children.length ? children : [new Paragraph('')],
      },
    ],
  });

  const arrayBuffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(arrayBuffer);
}

/** Parse a .docx file into HTML, plain text, and structured blocks via Mammoth */
export async function parseDocxBytes(bytes: Uint8Array): Promise<{
  html: string;
  plainText: string;
  blocks: StructuredBlock[];
  warnings: string[];
}> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const isNode = typeof window === 'undefined' && typeof Buffer !== 'undefined';
  const input = isNode ? { buffer: Buffer.from(bytes) } : { arrayBuffer };
  const [htmlRes, textRes] = await Promise.all([
    mammoth.convertToHtml(input as { arrayBuffer: ArrayBuffer }),
    mammoth.extractRawText(input as { arrayBuffer: ArrayBuffer }),
  ]);
  let blocks = parseHtmlToBlocks(htmlRes.value || '');
  const plainText = textRes.value || '';
  if (!blocks.length && plainText.trim()) {
    blocks = plainText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text) => ({ type: 'p' as const, text }));
  }
  const html = htmlRes.value?.trim() ? htmlRes.value : blocksToSimpleHtml(blocks);
  const warnings = htmlRes.messages
    .map((m) => m.message)
    .filter((msg) => !/^Unrecognised (paragraph|run|table) style/i.test(msg));
  return {
    html,
    plainText,
    blocks,
    warnings,
  };
}

/** Universal Word & Rich Document parser supporting .docx, .doc, .rtf, and .odt */
export async function parseWordOrRichDocBytes(
  bytes: Uint8Array,
  filename: string
): Promise<{
  html: string;
  plainText: string;
  blocks: StructuredBlock[];
  warnings: string[];
  formatLabel: string;
}> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  // Detect ZIP magic header (PK\x03\x04) in case a .docx or .odt was misnamed as .doc
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  if (ext === 'odt') {
    const res = await parseOdtBytes(bytes);
    return { ...res, warnings: [], formatLabel: 'OpenDocument (.odt)' };
  }

  if (ext === 'rtf') {
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const plainText = extractTextFromRtf(raw);
    const blocks: StructuredBlock[] = plainText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text) => ({ type: 'p', text }));
    return {
      html: blocksToSimpleHtml(blocks),
      plainText,
      blocks,
      warnings: [],
      formatLabel: 'Rich Text (.rtf)',
    };
  }

  if (ext === 'docx' || isZip) {
    try {
      const parsed = await parseDocxBytes(bytes);
      return { ...parsed, formatLabel: 'Microsoft Word (.docx)' };
    } catch (err) {
      // Fallback: maybe it's an ODT renamed to .docx
      try {
        const odt = await parseOdtBytes(bytes);
        return { ...odt, warnings: ['Parsed as OpenDocument archive.'], formatLabel: 'OpenDocument (.odt)' };
      } catch {
        throw err;
      }
    }
  }

  // Legacy .doc (HTML-doc, RTF-doc, WordXML, or binary OLE2 .doc)
  const legacy = extractTextFromLegacyDocBytes(bytes);
  const blocks = legacy.html
    ? parseHtmlToBlocks(legacy.html)
    : legacy.text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((text) => ({ type: 'p' as const, text }));
  const html = legacy.html || blocksToSimpleHtml(blocks);
  const warnings =
    legacy.kind === 'binary-doc'
      ? [
          'Legacy Word 97-2003 binary (.doc) detected: extracted clean text paragraphs locally. For full table & image fidelity, save as .docx in Word.',
        ]
      : [];
  return {
    html,
    plainText: legacy.text,
    blocks,
    warnings,
    formatLabel:
      legacy.kind === 'html-doc'
        ? 'Word HTML Document (.doc)'
        : legacy.kind === 'rtf-doc'
          ? 'Word RTF Document (.doc)'
          : legacy.kind === 'xml-doc'
            ? 'Word XML Document (.doc)'
            : 'Legacy Word 97-2003 (.doc)',
  };
}

/** Convert DOC / DOCX / RTF / ODT bytes to PDF — uses Exact Word Layout fidelity for .docx in browser */
export async function convertDocxToPdf(
  bytes: Uint8Array,
  title = 'Word Document',
  options: { filename?: string; renderMode?: PdfRenderMode } = {}
): Promise<{
  pdfBytes: Uint8Array;
  html: string;
  blockCount: number;
  warnings: string[];
  exactFidelity?: boolean;
}> {
  const filename = options.filename || 'document.docx';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isRealDocx = (ext === 'docx' || (isZip && ext !== 'odt')) && bytes.length > 0;
  const parsed = await parseWordOrRichDocBytes(bytes, filename);
  const safeBlocks: StructuredBlock[] = parsed.blocks.length
    ? parsed.blocks
    : [{ type: 'p', text: parsed.plainText || '(Document contains no extractable text or images.)' }];

  // Use Exact Word Layout Renderer (`docx-preview` + `html2canvas-pro`) for .docx whenever running in browser (unless user explicitly forces vector-only)
  if (isRealDocx && typeof document !== 'undefined' && options.renderMode !== 'vector') {
    try {
      const { renderDocxExactToPdf } = await import('./docxFidelityRenderer');
      const exactBytes = await renderDocxExactToPdf(bytes, { title, scale: 2.4 });
      if (exactBytes && exactBytes.byteLength > 200) {
        return {
          pdfBytes: exactBytes,
          html: parsed.html,
          blockCount: safeBlocks.length,
          warnings: parsed.warnings,
          exactFidelity: true,
        };
      }
    } catch {
      // Fall back smoothly to structured renderer if a malformed docx cannot render via docx-preview
    }
  }

  // For HTML-saved .doc files in browser, also render with full CSS fidelity
  if (
    parsed.formatLabel === 'Word HTML Document (.doc)' &&
    parsed.html &&
    typeof document !== 'undefined' &&
    options.renderMode !== 'vector'
  ) {
    try {
      const { renderStyledHtmlExactToPdf } = await import('./docxFidelityRenderer');
      const htmlPdf = await renderStyledHtmlExactToPdf(parsed.html, { title, scale: 2.2 });
      if (htmlPdf && htmlPdf.byteLength > 200) {
        return {
          pdfBytes: htmlPdf,
          html: parsed.html,
          blockCount: safeBlocks.length,
          warnings: parsed.warnings,
          exactFidelity: true,
        };
      }
    } catch {
      // Fallback below
    }
  }

  const pdfBytes = await renderBlocksToPdf(safeBlocks, {
    title,
    renderMode: options.renderMode || 'auto',
  });
  return {
    pdfBytes,
    html: parsed.html,
    blockCount: safeBlocks.length,
    warnings: parsed.warnings,
    exactFidelity: false,
  };
}

/** Convert rich styled HTML document into an exact visual HiDPI PDF (falls back to structured blocks in Node) */
export async function convertHtmlToExactPdf(
  htmlContent: string,
  options: { title?: string; orientation?: 'portrait' | 'landscape'; renderMode?: PdfRenderMode } = {}
): Promise<Uint8Array> {
  if (typeof document !== 'undefined' && options.renderMode !== 'vector') {
    try {
      const { renderStyledHtmlExactToPdf } = await import('./docxFidelityRenderer');
      const exact = await renderStyledHtmlExactToPdf(htmlContent, {
        title: options.title,
        orientation: options.orientation,
        scale: 2.2,
      });
      if (exact && exact.byteLength > 200) return exact;
    } catch {
      // Fall back to structured block renderer
    }
  }
  const blocks = parseHtmlToBlocks(htmlContent);
  return renderBlocksToPdf(blocks, { title: options.title, renderMode: options.renderMode });
}

/** Convert PDF bytes into a genuine editable .docx Word document */
export async function convertPdfToDocx(
  pdfBytes: Uint8Array,
  title = 'Converted PDF'
): Promise<{ docxBytes: Uint8Array; pageCount: number; previewText: string }> {
  const { extractPdfTextAndSearch } = await import('./pdfEngine');
  const extracted = await extractPdfTextAndSearch(pdfBytes);
  const blocks: StructuredBlock[] = [];
  extracted.pages.forEach((pg, idx) => {
    if (idx > 0) blocks.push({ type: 'hr' });
    blocks.push({ type: 'h2', text: `Page ${pg.page}` });
    const lines = pg.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      blocks.push({ type: 'p', text: '(No selectable text detected on this page — scanned image page)' });
    } else {
      for (const ln of lines) {
        if (ln.length < 70 && ln === ln.toUpperCase() && /[A-Z]{3,}/.test(ln)) {
          blocks.push({ type: 'h3', text: ln });
        } else {
          blocks.push({ type: 'p', text: ln });
        }
      }
    }
  });
  const docxBytes = await buildDocxFromBlocks(blocks, { title });
  return {
    docxBytes,
    pageCount: extracted.pages.length,
    previewText: extracted.fullText,
  };
}

/** Extract PDF text lines into an Excel (.xlsx) workbook + CSV string */
export async function convertPdfToXlsx(
  pdfBytes: Uint8Array
): Promise<{ xlsxBytes: Uint8Array; csv: string; rows: string[][] }> {
  const { extractPdfTextAndSearch } = await import('./pdfEngine');
  const extracted = await extractPdfTextAndSearch(pdfBytes);
  const rows: string[][] = [['Page', 'Line', 'Content']];
  for (const pg of extracted.pages) {
    const lines = pg.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    lines.forEach((line, idx) => {
      rows.push([String(pg.page), String(idx + 1), line]);
    });
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Extracted_PDF');
  const xlsxBytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const csv = XLSX.utils.sheet_to_csv(ws);
  return { xlsxBytes, csv, rows };
}

/** Read an Excel (.xlsx / .xls / .ods) or CSV file into normalized multi-sheet preview */
export function parseSpreadsheetBytes(bytes: Uint8Array): WorkbookPreview {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheets: Record<string, string[][]> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
    const cleaned = aoa
      .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []))
      .filter((r) => r.some((c) => c.trim() !== ''));
    sheets[name] = cleaned;
  }
  return { sheetNames: wb.SheetNames, sheets };
}

/** Convert a 2D array of rows into Excel .xlsx bytes with clean column auto-sizing */
export function rowsToXlsxBytes(rows: string[][], sheetName = 'Sheet1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  ws['!cols'] = Array.from({ length: colCount }, (_, c) => {
    let maxLen = 10;
    for (let r = 0; r < Math.min(rows.length, 100); r++) {
      maxLen = Math.max(maxLen, Math.min(48, String(rows[r]?.[c] ?? '').length + 2));
    }
    return { wch: maxLen };
  });
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

export function rowsToCsvString(rows: string[][]): string {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.utils.sheet_to_csv(ws);
}

export function rowsToTsvString(rows: string[][]): string {
  return rows.map((r) => r.map((c) => String(c ?? '').replace(/\t|\r|\n/g, ' ')).join('\t')).join('\n');
}

export function rowsToBeautifiedHtml(rows: string[][], title = 'Data Export'): string {
  if (!rows.length) return '<p>Empty table</p>';
  const head = rows[0].map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .slice(1)
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 32px; color: #0f172a; background: #f8fafc; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
  h1 { margin: 0 0 16px; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #1e293b; color: #fff; text-align: left; padding: 10px 12px; font-weight: 600; }
  td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</body>
</html>`;
}

export function rowsToMarkdownTable(rows: string[][]): string {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const padRow = (r: string[]) =>
    '| ' + Array.from({ length: cols }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |';
  const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
  return [padRow(rows[0]), sep, ...rows.slice(1).map(padRow)].join('\n');
}

export async function exportWorkbookSheetsToCsvZip(preview: WorkbookPreview): Promise<Blob> {
  const zip = new JSZip();
  for (const name of preview.sheetNames) {
    const csv = rowsToCsvString(preview.sheets[name] || []);
    const safeName = name.replace(/[^\w.-]+/g, '_') || 'sheet';
    zip.file(`${safeName}.csv`, csv);
  }
  return zip.generateAsync({ type: 'blob' });
}

export function jsonToSimpleYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/[:#\n"'{}\[\],]|^\s|\s$/.test(value) || value === '') {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          const nested = jsonToSimpleYaml(item, indent + 1);
          return `${pad}-\n${nested}`;
        }
        return `${pad}- ${jsonToSimpleYaml(item, indent + 1)}`;
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return '{}';
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === 'object' && (!Array.isArray(v) || v.length > 0)) {
          return `${pad}${k}:\n${jsonToSimpleYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${jsonToSimpleYaml(v, indent + 1)}`;
      })
      .join('\n');
  }
  return String(value);
}

export function simpleYamlToJson(yamlText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlText.replace(/\r\n/g, '\n').split('\n');
  let currentKey = '';
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('- ') && currentKey) {
      const existing = result[currentKey];
      const val = parseYamlScalar(trimmed.slice(2).trim());
      if (Array.isArray(existing)) existing.push(val);
      else result[currentKey] = [val];
      continue;
    }
    const idx = trimmed.indexOf(':');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      const rest = trimmed.slice(idx + 1).trim();
      currentKey = k;
      result[k] = rest ? parseYamlScalar(rest) : [];
    }
  }
  return result;
}

function parseYamlScalar(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function convertDataFormat(
  input: string,
  from: 'json' | 'csv' | 'tsv' | 'yaml' | 'xml',
  to: 'json' | 'csv' | 'tsv' | 'yaml' | 'xml' | 'markdown'
): string {
  let data: unknown;
  if (from === 'json') data = JSON.parse(input);
  else if (from === 'csv') data = csvToJson(input);
  else if (from === 'tsv') {
    const rows = input
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.split('\t'));
    const headers = rows[0] || [];
    data = rows.slice(1).map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = r[i] ?? '';
      });
      return obj;
    });
  } else if (from === 'yaml') data = simpleYamlToJson(input);
  else data = simpleXmlToJson(input);

  if (to === 'json') return JSON.stringify(data, null, 2);
  if (to === 'yaml') return jsonToSimpleYaml(data);
  if (to === 'xml') return jsonToSimpleXml(data, 'root');

  const arr = Array.isArray(data) ? data : [data];
  if (to === 'csv') return jsonToCsv(arr);
  const rows = parseCsvRows(jsonToCsv(arr));
  if (to === 'tsv') return rowsToTsvString(rows);
  return rowsToMarkdownTable(rows);
}
