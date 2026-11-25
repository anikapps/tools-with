import { PDFDocument } from 'pdf-lib';

/**
 * Exact-Fidelity Browser Document Renderer (DOCX & Styled HTML -> Pixel-Faithful PDF).
 * Uses `docx-preview` to reproduce genuine Word layout (margins, typography, colors, tables,
 * merged cells, borders, alignment, embedded images, headers, footers, page breaks)
 * and `html2canvas-pro` at HiDPI scale so the exported PDF looks identical to the original DOCX.
 * Zero watermarks, zero artificial bars, zero app branding.
 */

export async function renderDocxToContainer(
  docxBytes: Uint8Array,
  bodyContainer: HTMLElement,
  styleContainer?: HTMLElement
): Promise<void> {
  const { renderAsync } = await import('docx-preview');
  bodyContainer.innerHTML = '';
  if (styleContainer) styleContainer.innerHTML = '';
  const buf = docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength);
  await renderAsync(buf, bodyContainer, styleContainer, {
    className: 'docx-exact',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    experimental: true,
    useBase64URL: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
  });

  // Match Microsoft Word's built-in default table cell margins (0.08 in ≈ 7.5px L/R) when a DOCX
  // omits explicit <w:tcMar>, and prevent tight fixed-layout cells from clipping or colliding.
  const tables = Array.from(bodyContainer.querySelectorAll('table')) as HTMLTableElement[];
  for (const tbl of tables) {
    tbl.style.maxWidth = '100%';
    tbl.style.borderCollapse = 'collapse';
    const cells = Array.from(tbl.querySelectorAll('td, th')) as HTMLTableCellElement[];
    for (const cell of cells) {
      cell.style.boxSizing = 'border-box';
      const cs = typeof window !== 'undefined' ? window.getComputedStyle(cell) : null;
      const pl = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
      const pr = cs ? parseFloat(cs.paddingRight) || 0 : 0;
      const pt = cs ? parseFloat(cs.paddingTop) || 0 : 0;
      const pb = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
      if (pl < 2) cell.style.paddingLeft = '8px';
      if (pr < 2) cell.style.paddingRight = '8px';
      if (pt < 2) cell.style.paddingTop = '4px';
      if (pb < 2) cell.style.paddingBottom = '4px';
    }
    // If any fixed-width cell overflows its box, switch table to auto layout so numbers never clip
    if (cells.some((c) => c.clientWidth > 0 && c.scrollWidth > c.clientWidth + 2)) {
      tbl.style.tableLayout = 'auto';
      tbl.style.width = '100%';
    }
  }
}

async function waitForImagesAndFonts(root: HTMLElement): Promise<void> {
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch {
    // ignore
  }
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 2500);
      });
    })
  );
  // Allow layout to settle
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

async function canvasToCompactPdfImage(
  pdf: PDFDocument,
  canvas: HTMLCanvasElement
): Promise<ReturnType<PDFDocument['embedPng']> | ReturnType<PDFDocument['embedJpg']>> {
  const toBlob = (type: string, q?: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas encode failed'))), type, q)
    );

  // Crisp 0.94 JPEG is visually indistinguishable from PNG at 2.5x HiDPI while 5-10x smaller for photo-rich pages;
  // for clean vector/text pages PNG can actually be smaller & 100% lossless — pick whichever is best!
  const [pngBlob, jpgBlob] = await Promise.all([
    toBlob('image/png', 1),
    toBlob('image/jpeg', 0.94),
  ]);

  if (pngBlob.size <= 420 * 1024 || pngBlob.size <= jpgBlob.size * 1.45) {
    return pdf.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
  }
  return pdf.embedJpg(new Uint8Array(await jpgBlob.arrayBuffer()));
}

/**
 * Convert a real `.docx` binary into a pixel-faithful PDF matching exact Word layout,
 * margins, tables, colors, borders, images, headers, and footers.
 */
export async function renderDocxExactToPdf(
  docxBytes: Uint8Array,
  options: { title?: string; scale?: number } = {}
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-12000px;top:0;width:1200px;background:#ffffff;opacity:1;pointer-events:none;z-index:-1;';
  const styleHolder = document.createElement('div');
  const bodyHolder = document.createElement('div');
  host.appendChild(styleHolder);
  host.appendChild(bodyHolder);
  document.body.appendChild(host);

  try {
    await renderDocxToContainer(docxBytes, bodyHolder, styleHolder);

    // Strip docx-preview's gray outer wrapper padding/shadow so captured pages are pure crisp white sheets
    const wrapper = bodyHolder.querySelector('.docx-exact-wrapper') as HTMLElement | null;
    if (wrapper) {
      wrapper.style.background = '#ffffff';
      wrapper.style.padding = '0';
      wrapper.style.margin = '0';
      wrapper.style.display = 'block';
    }

    await waitForImagesAndFonts(bodyHolder);

    const sections = Array.from(bodyHolder.querySelectorAll('section.docx-exact')) as HTMLElement[];
    if (sections.length === 0) {
      return null;
    }

    const { default: html2canvas } = await import('html2canvas-pro');
    const captureScale = options.scale ?? 2.4; // ~230 DPI crisp Word layout
    const pdf = await PDFDocument.create();
    if (options.title) pdf.setTitle(options.title);

    for (const sec of sections) {
      // Remove drop shadow & margin from the page element itself before capture
      sec.style.boxShadow = 'none';
      sec.style.margin = '0';
      sec.style.background = sec.style.background || '#ffffff';

      const rect = sec.getBoundingClientRect();
      const cssW = Math.max(200, Math.round(sec.offsetWidth || rect.width || 794));
      const cssH = Math.max(200, Math.round(sec.scrollHeight || sec.offsetHeight || rect.height || 1123));

      const canvas = await html2canvas(sec, {
        scale: captureScale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: cssW,
        height: cssH,
        windowWidth: cssW,
        windowHeight: cssH,
      });

      // Convert CSS px (96 DPI) -> exact PDF points (72 DPI) preserving A4 / Letter / Landscape
      const pageW = Number(((cssW / 96) * 72).toFixed(2));
      const pageH = Number(((cssH / 96) * 72).toFixed(2));

      const embedded = await canvasToCompactPdfImage(pdf, canvas);
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH,
      });
    }

    return new Uint8Array(await pdf.save({ useObjectStreams: true, objectsPerTick: 100 }));
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

/**
 * Render arbitrary styled HTML (e.g., HTML files, rich .doc, styled Excel worksheets)
 * cleanly into multi-page crisp HiDPI A4/Letter PDF preserving full CSS styling, Unicode/Bangla, and tables.
 */
export async function renderStyledHtmlExactToPdf(
  htmlContent: string,
  options: {
    title?: string;
    orientation?: 'portrait' | 'landscape';
    scale?: number;
  } = {}
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  const isLandscape = options.orientation === 'landscape';
  // 96 DPI CSS dimensions matching A4 (595.28 x 841.89 pt)
  const pageCssW = isLandscape ? 1122 : 794;
  const pageCssH = isLandscape ? 794 : 1122;
  const padPx = 42;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-12000px;top:0;width:${pageCssW}px;background:#ffffff;color:#0f172a;font-family:'Plus Jakarta Sans','DM Sans','Noto Sans Bengali',system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.55;box-sizing:border-box;padding:${padPx}px;pointer-events:none;z-index:-1;`;

  // Scoped base print typography so raw HTML renders crisply without leaking into host app
  host.innerHTML = `<style>
    .exact-html-root * { box-sizing: border-box; }
    .exact-html-root h1 { font-size: 22px; font-weight: 800; margin: 0 0 12px; color: #0f172a; }
    .exact-html-root h2 { font-size: 16px; font-weight: 700; margin: 18px 0 8px; color: #0f172a; }
    .exact-html-root h3 { font-size: 14px; font-weight: 700; margin: 14px 0 6px; color: #1e293b; }
    .exact-html-root p { margin: 0 0 10px; }
    .exact-html-root ul, .exact-html-root ol { margin: 0 0 10px; padding-left: 22px; }
    .exact-html-root table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11.5px; }
    .exact-html-root th, .exact-html-root td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; }
    .exact-html-root th { background: #1e293b; color: #ffffff; font-weight: 700; }
    .exact-html-root tr:nth-child(even) td { background: #f8fafc; }
    .exact-html-root img { max-width: 100%; height: auto; }
    .exact-html-root pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; font-family: monospace; font-size: 11px; white-space: pre-wrap; }
  </style><div class="exact-html-root">${htmlContent}</div>`;

  document.body.appendChild(host);

  try {
    await waitForImagesAndFonts(host);
    const { default: html2canvas } = await import('html2canvas-pro');
    const captureScale = options.scale ?? 2.2;
    const totalH = Math.max(pageCssH, host.scrollHeight);

    const fullCanvas = await html2canvas(host, {
      scale: captureScale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: pageCssW,
      height: totalH,
      windowWidth: pageCssW,
      windowHeight: totalH,
    });

    const pageW = isLandscape ? 841.89 : 595.28;
    const pageH = isLandscape ? 595.28 : 841.89;
    const slicePxH = Math.round(pageCssH * captureScale);
    const pdf = await PDFDocument.create();
    if (options.title) pdf.setTitle(options.title);

    const numPages = Math.max(1, Math.ceil(fullCanvas.height / slicePxH));
    for (let i = 0; i < numPages; i++) {
      const sy = i * slicePxH;
      const sh = Math.min(slicePxH, fullCanvas.height - sy);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = fullCanvas.width;
      pageCanvas.height = slicePxH;
      const pCtx = pageCanvas.getContext('2d')!;
      pCtx.fillStyle = '#ffffff';
      pCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pCtx.drawImage(fullCanvas, 0, sy, fullCanvas.width, sh, 0, 0, fullCanvas.width, sh);

      const embedded = await canvasToCompactPdfImage(pdf, pageCanvas);
      const pg = pdf.addPage([pageW, pageH]);
      pg.drawImage(embedded, { x: 0, y: 0, width: pageW, height: pageH });
    }

    return new Uint8Array(await pdf.save({ useObjectStreams: true, objectsPerTick: 100 }));
  } catch {
    return null;
  } finally {
    host.remove();
  }
}
