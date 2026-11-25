import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtBytes,
  parsePageRanges,
  parseSplitSpec,
  numToWordsEnBD,
  numToWordsEnIntl,
  numToWordsBn,
  phoneticToBangla,
  textToMorse,
  morseToText,
  transformCase,
  slugify,
  csvToJson,
  jsonToCsv,
  computeLineDiff,
} from './formatters.ts';
import {
  evaluateMath,
  numericalDerivative,
  simpsonIntegral,
  calcLoanEmi,
  calcDpsMaturity,
  calcStats,
  calcHaversineDistance,
  simplifyGroupDebts,
  calcBajusGoldPrice,
  calcZakat,
} from './calculators.ts';
import {
  crc32,
  detectMagicMime,
  encodeCode128B,
  generateQrMatrix,
  shannonEntropy,
} from './barcodeQr.ts';

describe('formatters & parsers', () => {
  it('formats byte sizes cleanly', () => {
    assert.equal(fmtBytes(0), '0 B');
    assert.equal(fmtBytes(1024), '1.00 KB');
    assert.equal(fmtBytes(1048576), '1.00 MB');
  });

  it('parses PDF page ranges and split specs', () => {
    assert.deepEqual(parsePageRanges('1-3, 5, 8-last', 10), [1, 2, 3, 5, 8, 9, 10]);
    const oddEven = parseSplitSpec('odd-even', 5);
    assert.deepEqual(oddEven[0].pages, [1, 3, 5]);
    assert.deepEqual(oddEven[1].pages, [2, 4]);
    const every2 = parseSplitSpec('every-n', 5, 2);
    assert.equal(every2.length, 3);
    assert.deepEqual(every2[2].pages, [5]);
  });

  it('converts numbers to English BD, Intl, and Bangla words', () => {
    assert.equal(numToWordsEnBD(125000), 'One Lakh Twenty Five Thousand');
    assert.equal(numToWordsEnIntl(125000), 'One Hundred Twenty Five Thousand');
    assert.equal(numToWordsBn(105000), 'এক লক্ষ পাঁচ হাজার');
  });

  it('transliterates phonetic Banglish and Morse code', () => {
    assert.equal(phoneticToBangla('Amar bangla'), 'আমার বাংলা');
    const enc = textToMorse('SOS 2025');
    assert.equal(morseToText(enc), 'SOS 2025');
  });

  it('handles case transforms, CSV/JSON roundtrips, and line diff', () => {
    assert.equal(transformCase('hello world test', 'camel'), 'helloWorldTest');
    assert.equal(transformCase('helloWorldTest', 'snake'), 'hello_world_test');
    assert.equal(slugify('Hello World! 2025'), 'hello-world-2025');
    const json = csvToJson('name,age\nAnik,27\n"Khan, R",30');
    assert.equal(json.length, 2);
    assert.equal(json[1].name, 'Khan, R');
    const backCsv = jsonToCsv(json);
    assert.ok(backCsv.includes('"Khan, R"'));
    const diff = computeLineDiff('a\nb\nc', 'a\nd\nc');
    assert.ok(diff.some((d) => d.type === 'del' && d.text === 'b'));
    assert.ok(diff.some((d) => d.type === 'add' && d.text === 'd'));
  });
});

describe('calculators & domain math', () => {
  it('evaluates scientific expressions & calculus safely', () => {
    assert.equal(evaluateMath('2 + 3 * 4^2'), 50);
    assert.ok(Math.abs(evaluateMath('sin(pi/2)') - 1) < 1e-9);
    assert.equal(evaluateMath('5!'), 120);
    // d/dx (x^3) at x=2 is 12
    assert.ok(Math.abs(numericalDerivative('x^3', 2) - 12) < 1e-4);
    // integral of x^2 from 0 to 3 is 9
    assert.ok(Math.abs(simpsonIntegral('x^2', 0, 3) - 9) < 1e-4);
  });

  it('computes EMI, DPS, stats, distance, gold, debt settlement, and Zakat', () => {
    const emi = calcLoanEmi(100000, 12, 12);
    assert.ok(emi.emi > 8880 && emi.emi < 8890);
    assert.equal(emi.schedule.length, 12);
    const dps = calcDpsMaturity(5000, 8, 60);
    assert.ok(dps.maturityValue > 360000);
    const st = calcStats([10, 20, 20, 30]);
    assert.equal(st.mean, 20);
    assert.equal(st.median, 20);
    assert.deepEqual(st.mode, [20]);
    const dist = calcHaversineDistance(23.8103, 90.4125, 22.3569, 91.7832);
    assert.ok(dist > 200 && dist < 240);
    const gold = calcBajusGoldPrice({ vori: 1, ana: 0, roti: 0, point: 0, pricePerVori: 140000, includeVat5Pct: true });
    assert.equal(gold.grandTotal, 147000);
    const { settlements } = simplifyGroupDebts(
      [{ paidBy: 'A', amount: 300 }, { paidBy: 'B', amount: 0 }],
      ['A', 'B', 'C']
    );
    assert.equal(settlements.length, 2);
    const z = calcZakat({ cashBank: 200000, goldSilverValue: 0, investments: 0, businessStock: 0, liabilities: 0, nisabThreshold: 100000 });
    assert.equal(z.zakatDue, 5000);
  });
});

describe('barcode, QR, CRC32 & magic MIME', () => {
  it('computes CRC32, entropy, magic bytes, QR & Code-128B', () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    assert.equal(detectMagicMime(pdfBytes, 'doc.jpg').extensionMismatch, true);
    assert.equal(detectMagicMime(pdfBytes, 'doc.pdf').mime, 'application/pdf');
    assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926');
    assert.equal(shannonEntropy(new Uint8Array([1, 1, 1, 1])), 0);
    const qr = generateQrMatrix('https://example.com');
    assert.ok(qr.length >= 21 && qr.length === qr[0].length);
    const bc = encodeCode128B('ANIK-01');
    assert.ok(bc.bars.length > 20);
  });
});

import {
  buildDocxFromBlocks,
  convertDataFormat,
  exportWorkbookAllSheetsToPdf,
  extractTextFromLegacyDocBytes,
  extractTextFromRtf,
  hasNonWinAnsiText,
  parseDocxBytes,
  parseHtmlToBlocks,
  parseMarkdownToBlocks,
  parseSpreadsheetBytes,
  parseWordOrRichDocBytes,
  renderBlocksToPdf,
  renderTableToPdf,
  rowsToXlsxBytes,
} from './converterEngine.ts';
import { PDFDocument } from 'pdf-lib';

describe('converter studio engine (DOC/DOCX, RTF, XLS/XLSX, CSV, PDF, Data Matrix)', () => {
  it('detects non-WinAnsi scripts (Bangla, Taka symbol, emojis) accurately', () => {
    assert.equal(hasNonWinAnsiText('Hello World 2025 - $100'), false);
    assert.equal(hasNonWinAnsiText('বাংলা রিপোর্ট ৳১২,৫০০'), true);
    assert.equal(hasNonWinAnsiText('Total: ৳500'), true);
  });

  it('parses Markdown and HTML (including images) into structured document blocks', () => {
    const mdBlocks = parseMarkdownToBlocks('# Report\n\n- Alpha\n- Beta\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    assert.equal(mdBlocks[0].type, 'h1');
    assert.ok(mdBlocks.some((b) => b.type === 'li' && b.text === 'Alpha'));
    assert.ok(mdBlocks.some((b) => b.type === 'table' && b.rows?.length === 2));

    const htmlBlocks = parseHtmlToBlocks('<h1>Title</h1><p>Hello world</p><img src="data:image/png;base64,AAA" alt="Chart" /><ul><li>Item 1</li></ul>');
    assert.equal(htmlBlocks[0].type, 'h1');
    assert.ok(htmlBlocks.some((b) => b.type === 'p' && b.text === 'Hello world'));
    assert.ok(htmlBlocks.some((b) => b.type === 'image' && b.imageDataUrl === 'data:image/png;base64,AAA'));
    assert.ok(htmlBlocks.some((b) => b.type === 'li' && b.text === 'Item 1'));
  });

  it('extracts text from RTF and legacy .doc (HTML-saved, RTF-saved, and binary UTF-16LE)', async () => {
    const rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Arial;}} Hello \\b World\\b0\\par Second line}';
    const rtfText = extractTextFromRtf(rtf);
    assert.ok(rtfText.includes('Hello'));
    assert.ok(rtfText.includes('Second line'));

    const htmlDocBytes = new TextEncoder().encode('<html><body><h1>Legacy Report</h1><p>Saved as .doc</p></body></html>');
    const parsedHtmlDoc = extractTextFromLegacyDocBytes(htmlDocBytes);
    assert.equal(parsedHtmlDoc.kind, 'html-doc');
    assert.ok(parsedHtmlDoc.text.includes('Legacy Report'));
    const htmlDocParsed = await parseWordOrRichDocBytes(htmlDocBytes, 'legacy.doc');
    assert.ok(htmlDocParsed.blocks.some((b) => b.type === 'h1'));

    const rtfDoc = await parseWordOrRichDocBytes(new TextEncoder().encode(rtf), 'memo.rtf');
    assert.ok(rtfDoc.plainText.includes('Second line'));
    assert.ok(rtfDoc.blocks.length >= 1);

    // Simulated binary OLE2-like stream containing UTF-16LE text
    const str = 'Quarterly Financial Summary 2025';
    const utf16 = new Uint8Array(16 + str.length * 2 + 8);
    utf16.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    for (let i = 0; i < str.length; i++) {
      utf16[16 + i * 2] = str.charCodeAt(i);
      utf16[16 + i * 2 + 1] = 0;
    }
    const parsedBin = extractTextFromLegacyDocBytes(utf16);
    assert.equal(parsedBin.kind, 'binary-doc');
    assert.ok(parsedBin.text.includes('Quarterly Financial Summary 2025'));
  });

  it('roundtrips XLSX spreadsheets and converts CSV/JSON/YAML/XML/Markdown', () => {
    const rows = [
      ['Name', 'Role', 'Score'],
      ['Anik', 'Engineer', '98'],
      ['Nadia', 'Designer', '95'],
    ];
    const xlsxBytes = rowsToXlsxBytes(rows, 'Team');
    assert.ok(xlsxBytes.length > 200);
    const parsed = parseSpreadsheetBytes(xlsxBytes);
    assert.deepEqual(parsed.sheetNames, ['Team']);
    assert.equal(parsed.sheets['Team'].length, 3);
    assert.equal(parsed.sheets['Team'][1][0], 'Anik');

    const csv = 'Name,Score\nAnik,98\nNadia,95';
    const asJson = convertDataFormat(csv, 'csv', 'json');
    assert.ok(asJson.includes('"Anik"'));
    const asYaml = convertDataFormat(asJson, 'json', 'yaml');
    assert.ok(asYaml.includes('Name: Anik'));
    const asXml = convertDataFormat(asJson, 'json', 'xml');
    assert.ok(asXml.includes('<Name>Anik</Name>'));
    const asMd = convertDataFormat(csv, 'csv', 'markdown');
    assert.ok(asMd.includes('| Name | Score |'));
  });

  it('builds valid PDF reports, splits wide 18-column tables across pages, exports multi-sheet PDFs, and roundtrips DOCX', async () => {
    const tablePdf = await renderTableToPdf(
      [
        ['Item', 'Qty', 'Total'],
        ['PDF Engine', '1', '$500'],
      ],
      { title: 'Sales Report' }
    );
    assert.equal(new TextDecoder().decode(tablePdf.slice(0, 5)), '%PDF-');

    // Wide 18-column table should split across multiple pages instead of dropping columns
    const wideHeaders = Array.from({ length: 18 }, (_, i) => `Col${i + 1}`);
    const wideRow = Array.from({ length: 18 }, (_, i) => `Val${i + 1}`);
    const widePdfBytes = await renderTableToPdf([wideHeaders, wideRow], {
      title: 'Wide Sheet',
      orientation: 'portrait',
      renderMode: 'vector',
    });
    const wideDoc = await PDFDocument.load(widePdfBytes);
    assert.ok(wideDoc.getPageCount() >= 2, 'Expected wide 18-col table to split into >=2 pages');

    // Multi-sheet workbook combined PDF
    const combinedPdf = await exportWorkbookAllSheetsToPdf(
      {
        sheetNames: ['Summary', 'Details'],
        sheets: {
          Summary: [['Metric', 'Value'], ['Revenue', '1000']],
          Details: [['Item', 'Qty'], ['Book', '4']],
        },
      },
      { title: 'Annual Workbook', renderMode: 'vector' }
    );
    const combinedDoc = await PDFDocument.load(combinedPdf);
    assert.ok(combinedDoc.getPageCount() >= 2, 'Expected combined workbook PDF to have pages for all sheets');

    const blocks = parseMarkdownToBlocks('# Project Plan\n\nDeliver clean tools.\n\n- Fast\n- Local');
    const docPdf = await renderBlocksToPdf(blocks, { title: 'Project Plan', renderMode: 'vector' });
    assert.equal(new TextDecoder().decode(docPdf.slice(0, 5)), '%PDF-');

    const docxBytes = await buildDocxFromBlocks(blocks, { title: 'Project Plan' });
    // DOCX is a ZIP container starting with PK
    assert.equal(docxBytes[0], 0x50);
    assert.equal(docxBytes[1], 0x4b);
    const extracted = await parseDocxBytes(docxBytes);
    assert.ok(extracted.plainText.includes('Project Plan'));
    assert.ok(extracted.plainText.includes('Deliver clean tools.'));
  });

  it('produces zero branding or watermarks on converted PDF, DOCX, and HTML outputs', async () => {
    const { convertDocxToPdf, rowsToBeautifiedHtml } = await import('./converterEngine.ts');
    const JSZip = (await import('jszip')).default;

    // 1. Build a real DOCX and convert it to PDF
    const srcDocx = await buildDocxFromBlocks(
      [
        { type: 'h1', text: 'Quarterly Proposal' },
        { type: 'p', text: 'Clean unbranded client deliverable.' },
      ],
      { title: 'Quarterly Proposal' }
    );

    // Inspect DOCX XML metadata for zero branding
    const docxZip = await JSZip.loadAsync(srcDocx);
    for (const entryName of Object.keys(docxZip.files)) {
      if (entryName.endsWith('.xml')) {
        const xml = await docxZip.files[entryName].async('string');
        assert.ok(!/tools with anik/i.test(xml), `DOCX XML ${entryName} should not contain app branding`);
        assert.ok(!/converter studio/i.test(xml), `DOCX XML ${entryName} should not contain studio branding`);
      }
    }

    // 2. Convert DOCX -> PDF and verify zero branding in PDF metadata and stream text
    const { pdfBytes } = await convertDocxToPdf(srcDocx, 'Quarterly Proposal', {
      filename: 'proposal.docx',
      renderMode: 'vector',
    });
    const pdfDoc = await PDFDocument.load(pdfBytes);
    assert.ok(!/tools with anik/i.test(pdfDoc.getCreator() || ''));
    assert.ok(!/tools with anik/i.test(pdfDoc.getProducer() || ''));
    assert.ok(!/converter studio/i.test(pdfDoc.getProducer() || ''));

    // Also inspect raw PDF bytes (decompressed streams via save({ useObjectStreams: false }))
    const uncompressed = new TextDecoder('latin1').decode(await pdfDoc.save({ useObjectStreams: false }));
    assert.ok(!/tools with anik/i.test(uncompressed), 'PDF must not contain Tools with Anik branding');
    assert.ok(!/converted from microsoft word/i.test(uncompressed), 'PDF must not contain Converted from subtitle');
    assert.ok(!/converter studio/i.test(uncompressed), 'PDF must not contain Converter Studio footer');

    // 3. Verify table PDF and HTML have zero branding
    const tablePdf = await renderTableToPdf(
      [
        ['Metric', 'Value'],
        ['Revenue', '4200'],
      ],
      { title: 'Metrics', renderMode: 'vector' }
    );
    const tableDoc = await PDFDocument.load(tablePdf);
    const tableRaw = new TextDecoder('latin1').decode(await tableDoc.save({ useObjectStreams: false }));
    assert.ok(!/tools with anik/i.test(tableRaw));
    assert.ok(!/converter studio/i.test(tableRaw));

    const htmlOut = rowsToBeautifiedHtml([['A', 'B'], ['1', '2']], 'Clean Table');
    assert.ok(!/tools with anik/i.test(htmlOut));
    assert.ok(!/converter studio/i.test(htmlOut));
  });
});

import {
  getDefaultTargetForExt,
  getStageStepIndex,
  getSupportedTargetFormats,
  isImageExt,
  resolveBulkTarget,
  summarizeBulkProgress,
} from './bulkConverter.ts';
import {
  computeCompressionDelta,
  computeParamSignature,
  optimizePdfStructureLossless,
  runWithConcurrency,
} from './pdfOptimizer.ts';

describe('bulk converter progress, image & routing helpers', () => {
  it('resolves supported and default target formats accurately including images', () => {
    assert.equal(getDefaultTargetForExt('docx'), 'pdf');
    assert.equal(getDefaultTargetForExt('xlsx'), 'pdf');
    assert.equal(getDefaultTargetForExt('pdf'), 'docx');
    assert.equal(isImageExt('png'), true);
    assert.equal(isImageExt('webp'), true);
    assert.equal(isImageExt('docx'), false);
    assert.equal(getDefaultTargetForExt('png'), 'pdf');
    assert.ok(getSupportedTargetFormats('png').includes('pdf'));
    assert.ok(getSupportedTargetFormats('png').includes('webp'));
    assert.ok(getSupportedTargetFormats('png').includes('jpg'));
    assert.equal(resolveBulkTarget('jpg', 'auto'), 'pdf');
    assert.ok(getSupportedTargetFormats('docx').includes('pdf'));
    assert.ok(getSupportedTargetFormats('xlsx').includes('csv'));
    assert.equal(resolveBulkTarget('docx', 'auto'), 'pdf');
    assert.equal(resolveBulkTarget('pdf', 'auto'), 'docx');
    assert.equal(resolveBulkTarget('xlsx', 'csv'), 'csv');
    // Unsupported global target falls back cleanly to ext default
    assert.equal(resolveBulkTarget('pdf', 'pdf'), 'docx');
  });

  it('aggregates bulk conversion progress, statuses, and byte totals', () => {
    const empty = summarizeBulkProgress([]);
    assert.equal(empty.overallPct, 0);
    assert.equal(empty.total, 0);

    const mid = summarizeBulkProgress([
      { status: 'done', progress: 100, sizeBytes: 1000, output: { sizeBytes: 1200 } },
      { status: 'rendering', progress: 60, sizeBytes: 2000 },
      { status: 'queued', progress: 0, sizeBytes: 500 },
      { status: 'error', progress: 100, sizeBytes: 800 },
    ]);
    assert.equal(mid.total, 4);
    assert.equal(mid.done, 1);
    assert.equal(mid.active, 1);
    assert.equal(mid.queued, 1);
    assert.equal(mid.failed, 1);
    assert.equal(mid.overallPct, 65);
    assert.equal(mid.totalInputBytes, 4300);
    assert.equal(mid.totalOutputBytes, 1200);

    assert.equal(getStageStepIndex('queued'), 0);
    assert.equal(getStageStepIndex('reading'), 1);
    assert.equal(getStageStepIndex('parsing'), 2);
    assert.equal(getStageStepIndex('rendering'), 3);
    assert.equal(getStageStepIndex('done'), 4);
    assert.equal(getStageStepIndex('error'), -1);
  });
});

describe('lossless PDF optimizer, param signatures & concurrent runner', () => {
  it('detects any parameter change deterministically regardless of key order', () => {
    const sigA = computeParamSignature({ mode: 'lossless', stripMetadata: true, quality: 0.8 });
    const sigB = computeParamSignature({ quality: 0.8, mode: 'lossless', stripMetadata: true });
    const sigC = computeParamSignature({ mode: 'smart-vector', stripMetadata: true, quality: 0.8 });
    assert.equal(sigA, sigB);
    assert.notEqual(sigA, sigC);
  });

  it('computes accurate compression deltas', () => {
    const saved = computeCompressionDelta(10000, 7500);
    assert.equal(saved.savedBytes, 2500);
    assert.equal(saved.savedPct, 25);
    assert.equal(saved.improved, true);

    const unchanged = computeCompressionDelta(10000, 10000);
    assert.equal(unchanged.savedBytes, 0);
    assert.equal(unchanged.improved, false);
  });

  it('runs concurrent workers with bounded concurrency and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 8));
      active -= 1;
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
    assert.ok(peak <= 3 && peak >= 2, `Expected bounded concurrency 2..3, got peak=${peak}`);
  });

  it('optimizes PDFs losslessly while keeping vector text intact and zero branding', async () => {
    const src = await PDFDocument.create();
    src.setTitle('Confidential Financial Report');
    src.setAuthor('Jane Doe');
    src.setCreator('Legacy Word Processor');
    src.setProducer('Old Producer 1.0');
    const page = src.addPage([595, 842]);
    page.drawText('Crisp Vector Text Must Remain 100% Sharp', { x: 50, y: 780, size: 16 });
    const rawUncompressed = new Uint8Array(await src.save({ useObjectStreams: false }));

    const result = await optimizePdfStructureLossless(rawUncompressed, {
      stripMetadata: true,
      stripThumbnails: true,
      flattenForms: true,
    });

    assert.equal(result.pagesKept, 1);
    assert.equal(result.metadataStripped, true);

    // Load resulting PDF and confirm metadata stripped, zero branding, and vector text preserved
    const outDoc = await PDFDocument.load(result.bytes);
    assert.equal(outDoc.getPageCount(), 1);
    assert.equal(outDoc.getTitle() || '', '');
    assert.equal(outDoc.getAuthor() || '', '');
    assert.ok(!/tools with anik/i.test(outDoc.getCreator() || ''));
    assert.ok(!/tools with anik/i.test(outDoc.getProducer() || ''));

    // Verify zero rasterization: must preserve Font resources and contain 0 raster Image XObjects
    const { PDFName, PDFDict, PDFRawStream } = await import('pdf-lib');
    const zlib = await import('node:zlib');
    let fontCount = 0;
    let imageCount = 0;
    let decodedStreams = '';
    for (const [, obj] of outDoc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font')) {
        fontCount++;
      }
      if (obj instanceof PDFRawStream) {
        if (obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
          imageCount++;
        } else {
          const filter = obj.dict.get(PDFName.of('Filter'))?.toString() || '';
          try {
            const raw = filter.includes('FlateDecode') ? zlib.inflateSync(obj.contents) : obj.contents;
            decodedStreams += new TextDecoder('latin1').decode(raw) + '\n';
          } catch {
            // ignore non-flate stream
          }
        }
      }
    }
    assert.ok(fontCount >= 1, 'Vector font resource must be preserved');
    assert.equal(imageCount, 0, 'Lossless optimization must never rasterize vector pages into images');
    assert.ok(decodedStreams.includes('Tj') || decodedStreams.includes('TJ'), 'Vector text operators must remain intact');

    const rawOut = new TextDecoder('latin1').decode(await outDoc.save({ useObjectStreams: false }));
    assert.ok(!/tools with anik/i.test(rawOut), 'Output PDF must not contain app branding');
  });
});

import {
  COMPRESSION_PRESETS,
  describeDpi,
  dpiToScale,
  estimateCompressedRange,
  interleavePagesBySource,
  reorderBySourceOrder,
  reorderList,
} from './pdfMergeUtils.ts';

describe('PDF merge drag-and-drop utilities & compression estimator', () => {
  it('reorders page lists cleanly via drag-and-drop without mutating the source array', () => {
    const orig = ['P1', 'P2', 'P3', 'P4', 'P5'];
    assert.deepEqual(reorderList(orig, 0, 3), ['P2', 'P3', 'P4', 'P1', 'P5']);
    assert.deepEqual(reorderList(orig, 4, 1), ['P1', 'P5', 'P2', 'P3', 'P4']);
    assert.deepEqual(reorderList(orig, 2, 2), orig);
    assert.deepEqual(orig, ['P1', 'P2', 'P3', 'P4', 'P5']);
  });

  it('reorders by source file group and interleaves multi-PDF pages accurately', () => {
    const pages = [
      { id: 'A1', sourceIndex: 0 },
      { id: 'A2', sourceIndex: 0 },
      { id: 'B1', sourceIndex: 1 },
      { id: 'B2', sourceIndex: 1 },
      { id: 'BLANK', sourceIndex: -1 },
    ];
    const swapped = reorderBySourceOrder(pages, [1, 0]);
    assert.deepEqual(
      swapped.map((p) => p.id),
      ['B1', 'B2', 'A1', 'A2', 'BLANK']
    );

    const interleaved = interleavePagesBySource(pages.slice(0, 4));
    assert.deepEqual(
      interleaved.map((p) => p.id),
      ['A1', 'B1', 'A2', 'B2']
    );
  });

  it('converts DPI values and estimates realistic compressed file sizes', () => {
    assert.equal(COMPRESSION_PRESETS.balanced.dpi, 150);
    assert.equal(dpiToScale(144), 2);
    assert.equal(dpiToScale(216), 3);
    assert.equal(describeDpi(220), 'Print Sharp');
    assert.equal(describeDpi(150), 'Crisp Reading & Screen');
    assert.equal(describeDpi(120), 'Compact Web & Email');

    const targeted = estimateCompressedRange(2_000_000, {
      preset: 'balanced',
      dpi: 150,
      quality: 0.82,
      targetKb: 500,
      colorMode: 'color',
    });
    assert.equal(targeted.maxBytes, 500 * 1024);
    assert.ok(targeted.minBytes < targeted.maxBytes);

    const auto = estimateCompressedRange(1_000_000, {
      preset: 'small',
      dpi: 130,
      quality: 0.72,
      targetKb: 0,
      colorMode: 'grayscale',
    });
    assert.ok(auto.minBytes > 0 && auto.maxBytes < 1_000_000);
  });
});

import { deflateBytes, inflateBytes, rawPixelsToRgba, unpredictPngScanlines } from './pdfImageDecode.ts';

describe('binary PDF FlateDecode image decoder & lossless stream compression', () => {
  it('round-trips deflateBytes and inflateBytes cleanly', async () => {
    const payload = new TextEncoder().encode('Tools with Anik crisp vector PDF payload '.repeat(80));
    const compressed = await deflateBytes(payload);
    assert.ok(compressed.byteLength < payload.byteLength * 0.25, 'repetitive stream should compress strongly');
    const restored = await inflateBytes(compressed);
    assert.ok(restored !== null);
    assert.deepEqual(Array.from(restored!), Array.from(payload));
  });

  it('reverses PNG scanline predictors (None, Sub, Up, Avg, Paeth) and unpacks RGB/Gray to RGBA', () => {
    // 2x2 RGB image:
    // row 0: [10, 20, 30], [40, 50, 60]
    // row 1: [15, 25, 35], [50, 65, 80]
    // Encode row 0 with Sub filter (1): [1, 10, 20, 30, 30, 30, 30]
    // Encode row 1 with Up filter  (2): [2, 5, 5, 5, 10, 15, 20]
    const predicted = new Uint8Array([
      1, 10, 20, 30, 30, 30, 30,
      2, 5, 5, 5, 10, 15, 20,
    ]);
    const unpred = unpredictPngScanlines(predicted, 2, 2, 3, 8);
    assert.ok(unpred !== null);
    assert.deepEqual(Array.from(unpred!), [10, 20, 30, 40, 50, 60, 15, 25, 35, 50, 65, 80]);

    const rgba = rawPixelsToRgba(unpred!, 2, 2, 3);
    assert.ok(rgba !== null);
    assert.equal(rgba!.length, 16);
    assert.deepEqual(Array.from(rgba!.slice(0, 4)), [10, 20, 30, 255]);
    assert.deepEqual(Array.from(rgba!.slice(12, 16)), [50, 65, 80, 255]);

    const grayRgba = rawPixelsToRgba(new Uint8Array([120, 200]), 2, 1, 1);
    assert.ok(grayRgba !== null);
    assert.deepEqual(Array.from(grayRgba!), [120, 120, 120, 255, 200, 200, 200, 255]);
  });

  it('losslessly Flate-compresses uncompressed PDF streams and strips Adobe PieceInfo bloat', async () => {
    const { PDFName, PDFRawStream } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    // Draw lots of vector text lines so page content stream is large & uncompressed when saved
    for (let i = 0; i < 40; i++) {
      page.drawText(`Lossless sharp vector line #${i + 1} with repeated corporate text`, {
        x: 40,
        y: 800 - i * 16,
        size: 11,
      });
    }
    // Attach fake Adobe PieceInfo bloat dictionary on page
    const bloatStream = PDFRawStream.of(
      doc.context.obj({ Length: 8000 }),
      new Uint8Array(8000).fill(65)
    );
    const bloatRef = doc.context.register(bloatStream);
    page.node.set(PDFName.of('PieceInfo'), doc.context.obj({ Illustrator: bloatRef }));

    const rawBytes = new Uint8Array(await doc.save({ useObjectStreams: false }));
    const res = await optimizePdfStructureLossless(rawBytes, { stripMetadata: true });
    assert.equal(res.pieceInfoRemoved, 1);
    assert.ok(res.bytes.byteLength < rawBytes.byteLength * 0.5, 'PieceInfo + stream compression should dramatically shrink PDF');
    const check = await PDFDocument.load(res.bytes);
    assert.equal(check.getPageCount(), 1);
  });

  it('supports Full HD PNG, JPG, and WebP as bulk targets for PDF inputs', () => {
    const pdfTargets = getSupportedTargetFormats('pdf');
    assert.ok(pdfTargets.includes('png'));
    assert.ok(pdfTargets.includes('jpg'));
    assert.ok(pdfTargets.includes('webp'));
    assert.ok(pdfTargets.includes('docx'));
  });
});





