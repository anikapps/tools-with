import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  Play,
  Pause,
  XCircle,
  RotateCcw,
  FolderUp,
  Download,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  Zap,
  SlidersHorizontal,
  Loader2,
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';
import { ToolDef } from '../../data/toolsCatalog';
import { ToolHeader, FileDropzone, Panel } from '../ui/SharedUi';
import {
  compressPdf,
  convertPdfToOutputs,
  extractPdfTextAndSearch,
  imagesToPdf,
  layoutPdf,
  splitPdfToZip,
  stampPdf,
} from '../../utils/pdfEngine';
import {
  computeCompressionDelta,
  computeParamSignature,
  PdfCompressionEngine,
  runWithConcurrency,
} from '../../utils/pdfOptimizer';
import { downloadBlob, readFileAsBytes } from '../../utils/download';
import { fmtBytes, parsePageRanges, safeBase } from '../../utils/formatters';
import { useWorkspace } from '../../context/WorkspaceContext';

type BatchEngineId =
  | 'compress'
  | 'merge'
  | 'split'
  | 'rotate'
  | 'watermark'
  | 'img2pdf'
  | 'pdf2img'
  | 'rename'
  | 'extract'
  | 'metadata'
  | 'numbers'
  | 'stamp'
  | 'grayscale'
  | 'flatten'
  | 'resize'
  | 'text';

const BATCH_ENGINES: { id: BatchEngineId; label: string; sub: string; accept: string }[] = [
  { id: 'compress', label: '1. Batch PDF Compressor', sub: 'Lossless Vector-Safe & Smart Photo Shrink', accept: '.pdf' },
  { id: 'merge', label: '2. Batch PDF Merger', sub: 'Combine all queued PDFs cleanly', accept: '.pdf' },
  { id: 'split', label: '3. Batch PDF Splitter', sub: 'Single, Every N, Odd/Even, Custom -> ZIP', accept: '.pdf' },
  { id: 'rotate', label: '4. Batch PDF Rotation', sub: 'Rotate 90°/180°/270° with page subset', accept: '.pdf' },
  { id: 'watermark', label: '5. Batch PDF Watermark', sub: 'Custom text, opacity & font size', accept: '.pdf' },
  { id: 'img2pdf', label: '6. Batch Image-to-PDF', sub: 'A4/Letter/Fit, per-file or merged PDF', accept: 'image/*' },
  { id: 'pdf2img', label: '7. Batch PDF-to-Image', sub: 'HiDPI PNG/JPG/WebP renders in ZIP', accept: '.pdf' },
  { id: 'rename', label: '8. Batch PDF Renamer', sub: 'Pattern rules + date & index tokens', accept: '.pdf' },
  { id: 'extract', label: '9. Batch Page Extraction', sub: 'Extract ranges (e.g. 1-2, last) per PDF', accept: '.pdf' },
  { id: 'metadata', label: '10. Batch Metadata Studio', sub: 'Strip all or stamp Title/Author/Subject', accept: '.pdf' },
  { id: 'numbers', label: '11. Batch Page & Bates #', sub: 'Page X of Y, Page X, or Legal Bates', accept: '.pdf' },
  { id: 'stamp', label: '12. Batch Header & Footer', sub: 'Dynamic header/footer tokens', accept: '.pdf' },
  { id: 'grayscale', label: '13. Batch Grayscale & Scan', sub: 'Readable HiDPI grayscale / B&W scan', accept: '.pdf' },
  { id: 'flatten', label: '14. Batch Flatten & Sanitize', sub: 'Flatten forms, strip metadata & thumbs', accept: '.pdf' },
  { id: 'resize', label: '15. Batch Page Standardizer', sub: 'Normalize pages to A4/Letter/Legal', accept: '.pdf' },
  { id: 'text', label: '16. Batch Text & Markdown', sub: 'Extract .txt or .md per PDF', accept: '.pdf' },
];

interface QueueItem {
  id: string;
  file: File;
  relPath: string;
  origSize: number;
  outSize?: number;
  durationMs?: number;
  note?: string;
  status: 'queued' | 'running' | 'done' | 'error';
  error?: string;
  runParamSig?: string;
  outputs?: { name: string; blob: Blob }[];
}

export function PdfBatchWorkspace({ tool }: { tool: ToolDef }) {
  const { transfer, clearTransfer } = useWorkspace();
  const [engine, setEngine] = useState<BatchEngineId>('compress');
  const [activeQueue, setActiveQueue] = useState<'A' | 'B' | 'C'>('A');
  const [queues, setQueues] = useState<Record<'A' | 'B' | 'C', QueueItem[]>>({
    A: [],
    B: [],
    C: [],
  });

  // High-speed concurrency control
  const [concurrency, setConcurrency] = useState<number>(3);

  // Powerful Compression Engine Parameters (Smart Vector + Photo Engine keeps text 100% lossless while shrinking embedded PNG/JPEG graphics!)
  const [compressMode, setCompressMode] = useState<PdfCompressionEngine>('smart-vector');
  const [compressQuality, setCompressQuality] = useState(0.82);
  const [compressDpi, setCompressDpi] = useState(2.2); // 158 DPI crisp default when raster is explicitly chosen
  const [imageMaxPx, setImageMaxPx] = useState(1750);
  const [targetKb, setTargetKb] = useState(0);
  const [colorMode, setColorMode] = useState<'color' | 'grayscale' | 'bw-scan'>('color');
  const [stripMetadata, setStripMetadata] = useState(true);
  const [stripThumbnails, setStripThumbnails] = useState(true);
  const [stripAnnotations, setStripAnnotations] = useState(false);
  const [stripOutlines, setStripOutlines] = useState(false);
  const [flattenForms, setFlattenForms] = useState(true);
  const [sharpenText, setSharpenText] = useState(true);
  const [compressPageRange, setCompressPageRange] = useState('');

  // Other Engine Parameters (upgraded & richer)
  const [splitMode, setSplitMode] = useState<'single' | 'every-n' | 'odd-even' | 'halves' | 'custom'>('single');
  const [splitN, setSplitN] = useState(2);
  const [splitCustom, setSplitCustom] = useState('1-2, 3-last');
  const [rotateDeg, setRotateDeg] = useState(90);
  const [rotateRange, setRotateRange] = useState('');
  const [wmText, setWmText] = useState('CONFIDENTIAL');
  const [wmOpacity, setWmOpacity] = useState(0.22);
  const [wmSize, setWmSize] = useState(44);
  const [headerText, setHeaderText] = useState('{filename} • {date}');
  const [footerText, setFooterText] = useState('Page {page} of {pages}');
  const [numberFormat, setNumberFormat] = useState<'x-of-y' | 'page-x' | 'bates'>('bates');
  const [batesPrefix, setBatesPrefix] = useState('BATES-');
  const [batesStart, setBatesStart] = useState(1);
  const [extractRange, setExtractRange] = useState('1-2');
  const [renamePattern, setRenamePattern] = useState('{index}_{name}');
  const [titleOverride, setTitleOverride] = useState('');
  const [authorOverride, setAuthorOverride] = useState('');
  const [subjectOverride, setSubjectOverride] = useState('');
  const [targetPageSize, setTargetPageSize] = useState<'a4' | 'letter' | 'legal'>('a4');
  const [imgPageSize, setImgPageSize] = useState<'a4' | 'letter' | 'fit'>('a4');
  const [imgOrient, setImgOrient] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [imgMergeAll, setImgMergeAll] = useState(false);
  const [imgOutFormat, setImgOutFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [imgOutScale, setImgOutScale] = useState(3.0); // Default Full HD · 216 DPI
  const [grayMode, setGrayMode] = useState<'grayscale' | 'bw-scan'>('grayscale');
  const [grayDpi, setGrayDpi] = useState(2.2);
  const [textFormat, setTextFormat] = useState<'txt' | 'md'>('txt');

  const [running, setRunning] = useState(false);
  const [runElapsedMs, setRunElapsedMs] = useState(0);
  const [runCount, setRunCount] = useState(0);
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const items = queues[activeQueue];
  const engineMeta = BATCH_ENGINES.find((e) => e.id === engine)!;

  // Compute deterministic signature of ALL active parameters so ANY parameter change re-arms the Run button!
  const currentParamSig = useMemo(
    () =>
      computeParamSignature({
        engine,
        compressMode,
        compressQuality,
        compressDpi,
        imageMaxPx,
        targetKb,
        colorMode,
        stripMetadata,
        stripThumbnails,
        stripAnnotations,
        stripOutlines,
        flattenForms,
        sharpenText,
        compressPageRange,
        splitMode,
        splitN,
        splitCustom,
        rotateDeg,
        rotateRange,
        wmText,
        wmOpacity,
        wmSize,
        headerText,
        footerText,
        numberFormat,
        batesPrefix,
        batesStart,
        extractRange,
        renamePattern,
        titleOverride,
        authorOverride,
        subjectOverride,
        targetPageSize,
        imgPageSize,
        imgOrient,
        imgMergeAll,
        imgOutFormat,
        imgOutScale,
        grayMode,
        grayDpi,
        textFormat,
      }),
    [
      engine,
      compressMode,
      compressQuality,
      compressDpi,
      imageMaxPx,
      targetKb,
      colorMode,
      stripMetadata,
      stripThumbnails,
      stripAnnotations,
      stripOutlines,
      flattenForms,
      sharpenText,
      compressPageRange,
      splitMode,
      splitN,
      splitCustom,
      rotateDeg,
      rotateRange,
      wmText,
      wmOpacity,
      wmSize,
      headerText,
      footerText,
      numberFormat,
      batesPrefix,
      batesStart,
      extractRange,
      renamePattern,
      titleOverride,
      authorOverride,
      subjectOverride,
      targetPageSize,
      imgPageSize,
      imgOrient,
      imgMergeAll,
      imgOutFormat,
      imgOutScale,
      grayMode,
      grayDpi,
      textFormat,
    ]
  );

  const staleDoneCount = useMemo(
    () => items.filter((it) => it.status === 'done' && it.runParamSig !== currentParamSig).length,
    [items, currentParamSig]
  );

  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    setRunElapsedMs(0);
    const id = window.setInterval(() => setRunElapsedMs(Date.now() - start), 80);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (transfer?.files?.length) {
      addFiles(transfer.files);
      clearTransfer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.nonce]);

  const addFiles = (files: File[]) => {
    const newItems: QueueItem[] = files.map((f, idx) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}_${idx}`,
      file: f,
      relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      origSize: f.size,
      status: 'queued',
    }));
    setQueues((prev) => ({
      ...prev,
      [activeQueue]: [...prev[activeQueue], ...newItems],
    }));
  };

  const updateItem = (qKey: 'A' | 'B' | 'C', id: string, patch: Partial<QueueItem>) => {
    setQueues((prev) => ({
      ...prev,
      [qKey]: prev[qKey].map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  };

  const formatOutName = (origName: string, idx: number, suffix: string, ext = 'pdf') => {
    const base = safeBase(origName);
    const date = new Date().toISOString().slice(0, 10);
    const formatted = renamePattern
      .replace(/\{index\}/gi, String(idx + 1).padStart(3, '0'))
      .replace(/\{name\}/gi, base)
      .replace(/\{op\}/gi, suffix)
      .replace(/\{date\}/gi, date);
    return `${formatted || base}.${ext}`;
  };

  const processSingle = async (
    it: QueueItem,
    idx: number
  ): Promise<{ outputs: { name: string; blob: Blob }[]; note: string }> => {
    const bytes = await readFileAsBytes(it.file);
    const base = safeBase(it.file.name);

    switch (engine) {
      case 'compress': {
        const res = await compressPdf(bytes, {
          mode: compressMode,
          quality: compressQuality,
          dpiScale: compressDpi,
          imageMaxPx,
          targetKb,
          colorMode,
          stripMetadata,
          stripThumbnails,
          stripAnnotations,
          stripOutlines,
          flattenForms,
          sharpenText,
          pageRange: compressPageRange,
        });
        return {
          outputs: [
            {
              name: `${base}_compressed.pdf`,
              blob: new Blob([res.bytes as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: res.modeUsed,
        };
      }
      case 'split': {
        const { zipBlob, filesCount } = await splitPdfToZip(
          bytes,
          it.file.name,
          splitMode,
          splitN,
          splitCustom
        );
        return {
          outputs: [{ name: `${base}_split.zip`, blob: zipBlob }],
          note: `${filesCount} split PDFs`,
        };
      }
      case 'rotate': {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = doc.getPages();
        const targetPages = new Set(parsePageRanges(rotateRange, pages.length));
        pages.forEach((p, pIdx) => {
          if (targetPages.has(pIdx + 1)) {
            p.setRotation(degrees((p.getRotation().angle + rotateDeg) % 360));
          }
        });
        const out = await doc.save({ useObjectStreams: true });
        return {
          outputs: [
            {
              name: `${base}_rot${rotateDeg}.pdf`,
              blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: `Rotated ${targetPages.size} page(s) +${rotateDeg}°`,
        };
      }
      case 'watermark': {
        const out = await stampPdf(bytes, {
          filename: it.file.name,
          watermarkText: wmText,
          watermarkOpacity: wmOpacity,
          watermarkSize: wmSize,
        });
        return {
          outputs: [
            {
              name: `${base}_wm.pdf`,
              blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: `Watermarked (${Math.round(wmOpacity * 100)}%)`,
        };
      }
      case 'numbers': {
        const out = await stampPdf(bytes, {
          filename: it.file.name,
          pageNumberFormat: numberFormat,
          batesPrefix,
          batesStart: batesStart + idx * 100,
        });
        return {
          outputs: [
            {
              name: `${base}_numbered.pdf`,
              blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: numberFormat === 'bates' ? `Bates ${batesPrefix}${batesStart + idx * 100}+` : `Numbered (${numberFormat})`,
        };
      }
      case 'stamp': {
        const out = await stampPdf(bytes, {
          filename: it.file.name,
          headerText,
          footerText,
        });
        return {
          outputs: [
            {
              name: `${base}_stamped.pdf`,
              blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: 'Header/footer stamped',
        };
      }
      case 'grayscale': {
        const res = await compressPdf(bytes, {
          mode: 'high-dpi-raster',
          colorMode: grayMode,
          dpiScale: grayDpi,
          quality: 0.86,
          sharpenText: true,
        });
        return {
          outputs: [
            {
              name: `${base}_${grayMode}.pdf`,
              blob: new Blob([res.bytes as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: `${Math.round(grayDpi * 72)} DPI ${grayMode}`,
        };
      }
      case 'flatten': {
        const res = await compressPdf(bytes, {
          mode: 'lossless',
          flattenForms: true,
          stripMetadata: true,
          stripThumbnails: true,
          stripAnnotations,
        });
        return {
          outputs: [
            {
              name: `${base}_flattened.pdf`,
              blob: new Blob([res.bytes as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: 'Lossless flattened & sanitized',
        };
      }
      case 'resize': {
        const out = await layoutPdf(bytes, { mode: 'resize', targetSize: targetPageSize });
        return {
          outputs: [
            {
              name: `${base}_${targetPageSize}.pdf`,
              blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: `Standardized to ${targetPageSize.toUpperCase()}`,
        };
      }
      case 'extract': {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const keep = parsePageRanges(extractRange, src.getPageCount());
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, keep.map((p) => p - 1));
        copied.forEach((p) => out.addPage(p));
        const res = await out.save({ useObjectStreams: true });
        return {
          outputs: [
            {
              name: `${base}_extracted.pdf`,
              blob: new Blob([res as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: `Extracted ${keep.length} page(s)`,
        };
      }
      case 'metadata': {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        doc.setTitle(titleOverride);
        doc.setAuthor(authorOverride);
        doc.setSubject(subjectOverride);
        doc.setKeywords([]);
        doc.setCreator('');
        doc.setProducer('');
        const out = await doc.save({ useObjectStreams: true });
        return {
          outputs: [
            {
              name: `${base}_meta.pdf`,
              blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: authorOverride || titleOverride ? 'Metadata updated' : 'Metadata stripped',
        };
      }
      case 'rename': {
        const outName = formatOutName(it.file.name, idx, 'pdf');
        return {
          outputs: [{ name: outName, blob: it.file }],
          note: outName,
        };
      }
      case 'img2pdf': {
        const pdfBytes = await imagesToPdf([it.file], {
          pageSize: imgPageSize,
          orientation: imgOrient,
        });
        return {
          outputs: [
            {
              name: `${base}.pdf`,
              blob: new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }),
            },
          ],
          note: `${imgPageSize.toUpperCase()} PDF`,
        };
      }
      case 'pdf2img': {
        const res = await convertPdfToOutputs(bytes, it.file.name, imgOutFormat, imgOutScale);
        return {
          outputs: [{ name: res.downloadName, blob: res.blob }],
          note: `${imgOutFormat.toUpperCase()} @ ${Math.round(imgOutScale * 72)} DPI`,
        };
      }
      case 'text': {
        const { pages } = await extractPdfTextAndSearch(bytes);
        const content =
          textFormat === 'md'
            ? pages.map((p) => `## Page ${p.page}\n\n${p.text}`).join('\n\n')
            : pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join('\n\n');
        return {
          outputs: [{ name: `${base}.${textFormat}`, blob: new Blob([content], { type: 'text/plain' }) }],
          note: `${pages.length} pages extracted`,
        };
      }
      default:
        return { outputs: [], note: '' };
    }
  };

  const runBatch = async () => {
    const qKey = activeQueue;
    const list = queues[qKey];
    if (!list.length || running) return;

    const sigAtRun = currentParamSig;
    setRunning(true);
    setPaused(false);
    pausedRef.current = false;
    cancelledRef.current = false;
    setRunCount((c) => c + 1);

    // Special multi-file combined engines: merge OR img2pdf (merge all)
    if (engine === 'merge' || (engine === 'img2pdf' && imgMergeAll)) {
      const started = performance.now();
      try {
        if (engine === 'img2pdf') {
          list.forEach((it) => updateItem(qKey, it.id, { status: 'running', error: undefined }));
          const mergedPdf = await imagesToPdf(
            list.map((it) => it.file),
            { pageSize: imgPageSize, orientation: imgOrient }
          );
          const blob = new Blob([mergedPdf as unknown as BlobPart], { type: 'application/pdf' });
          const dur = Math.max(1, Math.round(performance.now() - started));
          list.forEach((it, idx) =>
            updateItem(qKey, it.id, {
              status: 'done',
              outSize: idx === 0 ? mergedPdf.byteLength : it.origSize,
              durationMs: dur,
              runParamSig: sigAtRun,
              note: idx === 0 ? `Combined ${list.length} images` : 'Included in merged PDF',
              outputs: idx === 0 ? [{ name: `images_merged_queue_${qKey}.pdf`, blob }] : undefined,
            })
          );
          downloadBlob(blob, `images_merged_queue_${qKey}.pdf`);
        } else {
          const out = await PDFDocument.create();
          for (let i = 0; i < list.length; i++) {
            if (cancelledRef.current) break;
            updateItem(qKey, list[i].id, { status: 'running', error: undefined });
            const bytes = await readFileAsBytes(list[i].file);
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const copied = await out.copyPages(src, src.getPageIndices());
            copied.forEach((p) => out.addPage(p));
            updateItem(qKey, list[i].id, {
              status: 'done',
              outSize: list[i].origSize,
              runParamSig: sigAtRun,
              note: `${src.getPageCount()} page(s) merged`,
            });
          }
          if (!cancelledRef.current) {
            const merged = await out.save({ useObjectStreams: true, objectsPerTick: 100 });
            const blob = new Blob([merged as unknown as BlobPart], { type: 'application/pdf' });
            const dur = Math.max(1, Math.round(performance.now() - started));
            updateItem(qKey, list[0].id, {
              outputs: [{ name: `merged_queue_${qKey}.pdf`, blob }],
              outSize: merged.byteLength,
              durationMs: dur,
              runParamSig: sigAtRun,
              note: `Merged ${list.length} PDFs`,
            });
            downloadBlob(blob, `merged_queue_${qKey}.pdf`);
          }
        }
      } catch (e) {
        updateItem(qKey, list[0].id, { status: 'error', error: (e as Error).message });
      } finally {
        setRunning(false);
      }
      return;
    }

    // ALWAYS re-run items whose parameter signature changed, or ALL items if every item is already done!
    const allAlreadyUpToDate = list.every(
      (it) => it.status === 'done' && it.runParamSig === sigAtRun && it.outputs?.length
    );
    const itemsToProcess = list
      .map((item, idx) => ({ item, idx }))
      .filter(
        ({ item }) =>
          allAlreadyUpToDate ||
          item.status !== 'done' ||
          item.runParamSig !== sigAtRun ||
          !item.outputs?.length
      );

    // Reset target items visibly to queued before parallel workers kick off
    const targetIdSet = new Set(itemsToProcess.map((x) => x.item.id));
    setQueues((prev) => ({
      ...prev,
      [qKey]: prev[qKey].map((it) =>
        targetIdSet.has(it.id)
          ? { ...it, status: 'queued', error: undefined }
          : it
      ),
    }));

    await runWithConcurrency(
      itemsToProcess,
      concurrency,
      async ({ item, idx }) => {
        const started = performance.now();
        updateItem(qKey, item.id, { status: 'running', error: undefined });
        const { outputs, note } = await processSingle(item, idx);
        const totalOut = outputs.reduce((s, o) => s + o.blob.size, 0);
        const durationMs = Math.max(1, Math.round(performance.now() - started));
        updateItem(qKey, item.id, {
          status: 'done',
          outputs,
          outSize: totalOut,
          durationMs,
          note,
          runParamSig: sigAtRun,
        });
      },
      {
        isCancelled: () => cancelledRef.current,
        isPaused: () => pausedRef.current,
        onItemError: (workerIdx, err) => {
          const target = itemsToProcess[workerIdx]?.item;
          if (target) {
            updateItem(qKey, target.id, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Processing failed',
            });
          }
        },
      }
    );

    setRunning(false);
  };

  const downloadAllZip = async () => {
    const done = items.filter((i) => i.status === 'done' && i.outputs?.length);
    if (!done.length) return;
    const zip = new JSZip();
    const used = new Map<string, number>();
    done.forEach((it) => {
      it.outputs!.forEach((o) => {
        const prevCount = used.get(o.name) || 0;
        let finalName = o.name;
        if (prevCount > 0) {
          const dot = o.name.lastIndexOf('.');
          finalName = dot > 0 ? `${o.name.slice(0, dot)}_${prevCount + 1}${o.name.slice(dot)}` : `${o.name}_${prevCount + 1}`;
        }
        used.set(o.name, prevCount + 1);
        zip.file(finalName, o.blob);
      });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `pdf_batch_${engine}_queue_${activeQueue}.zip`);
  };

  const totalOrig = items.reduce((s, i) => s + i.origSize, 0);
  const doneCount = items.filter((i) => i.status === 'done').length;
  const activeCount = items.filter((i) => i.status === 'running').length;
  const errorCount = items.filter((i) => i.status === 'error').length;
  const totalOut = items.reduce((s, i) => s + (i.outSize ?? 0), 0);
  const doneOrigSum = items.reduce((s, i) => s + (i.outSize ? i.origSize : 0), 0);
  const savings = computeCompressionDelta(doneOrigSum, totalOut);
  const overallPct =
    items.length === 0
      ? 0
      : Math.round(((doneCount + errorCount + activeCount * 0.5) / items.length) * 100);

  const runButtonLabel = running
    ? 'Processing Batch...'
    : staleDoneCount > 0
      ? `Re-run Batch (${items.length}) · Settings Updated`
      : doneCount === items.length && items.length > 0
        ? `Re-run All (${items.length})`
        : `Run Batch (${items.length})`;

  return (
    <div>
      <ToolHeader
        tool={tool}
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs" title="Parallel processing workers">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <select
                value={concurrency}
                disabled={running}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                aria-label="Batch Parallel Concurrency"
                className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 font-mono text-xs font-semibold text-[var(--ink)]"
              >
                <option value={1}>1× Safe</option>
                <option value={2}>2× Fast</option>
                <option value={3}>3× Turbo</option>
                <option value={4}>4× Max</option>
              </select>
            </label>
            <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-1">
              {(['A', 'B', 'C'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setActiveQueue(q)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    activeQueue === q
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--ink-2)] hover:bg-[var(--surface)]'
                  }`}
                >
                  Queue {q} ({queues[q].length})
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* 16 Engine Selector Grid */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-4">
        {BATCH_ENGINES.map((eng) => {
          const active = engine === eng.id;
          return (
            <button
              key={eng.id}
              type="button"
              onClick={() => setEngine(eng.id)}
              className={`rounded-xl border p-2.5 text-left transition-all ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]'
              }`}
            >
              <div className="text-xs font-bold text-[var(--ink)]">{eng.label}</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">{eng.sub}</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-4">
          <Panel title="Add Files to Queue">
            <FileDropzone
              accept={engineMeta.accept}
              multiple
              compact
              onFiles={addFiles}
              label={`Drop ${engine === 'img2pdf' ? 'Images' : 'PDFs'} into Queue ${activeQueue}`}
              hint="Supports multi-file select or folder upload"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-3)]"
              >
                <FolderUp className="h-3.5 w-3.5" /> Upload Folder
              </button>
              <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is non-standard but supported in Chromium/Firefox
                webkitdirectory=""
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={running}
                onClick={() => setQueues((p) => ({ ...p, [activeQueue]: [] }))}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          </Panel>

          <Panel
            title="Engine Parameters"
            actions={
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
                <SlidersHorizontal className="h-3 w-3" /> Live Re-run
              </span>
            }
          >
            <div className="space-y-3.5 text-xs">
              {engine === 'compress' && (
                <>
                  {/* Mode Selector — Lossless Vector-Safe is DEFAULT */}
                  <div>
                    <label className="mb-1 block font-semibold text-[var(--ink)]">
                      Compression Engine
                    </label>
                    <select
                      value={compressMode}
                      data-batch-compress-mode
                      onChange={(e) => setCompressMode(e.target.value as PdfCompressionEngine)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-semibold text-[var(--ink)]"
                    >
                      <option value="lossless">Lossless Vector-Safe (Sharp Text)</option>
                      <option value="smart-vector">Smart Vector + Photo Shrink</option>
                      <option value="high-dpi-raster">High-DPI Crisp Scan / Target KB</option>
                    </select>
                    <div className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>
                        {compressMode === 'lossless'
                          ? 'Zero rasterization: keeps all fonts & text 100% vector-sharp while stripping bloat, thumbnails, metadata & duplicate streams.'
                          : compressMode === 'smart-vector'
                            ? 'Recompresses only large embedded photos in-place — vector text, fonts & links stay 100% sharp and selectable.'
                            : 'Renders pages at high readable DPI with optional text edge sharpening or Target KB tuning.'}
                      </span>
                    </div>
                  </div>

                  {/* Structural Lossless Controls */}
                  <div className="space-y-1.5 border-t border-[var(--line)] pt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                      Lossless Structural Cleanup
                    </div>
                    {[
                      ['Strip Metadata & XMP', stripMetadata, setStripMetadata],
                      ['Remove Embedded Page Thumbnails', stripThumbnails, setStripThumbnails],
                      ['Flatten Interactive Forms', flattenForms, setFlattenForms],
                      ['Remove Comments & Annotations', stripAnnotations, setStripAnnotations],
                      ['Strip Bookmarks / Outlines', stripOutlines, setStripOutlines],
                    ].map(([label, checked, setter]) => (
                      <label key={label as string} className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-2)]">
                        <input
                          type="checkbox"
                          checked={checked as boolean}
                          onChange={(e) => (setter as React.Dispatch<React.SetStateAction<boolean>>)(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-[var(--line-strong)] accent-[var(--accent)]"
                        />
                        <span>{label as string}</span>
                      </label>
                    ))}
                  </div>

                  {/* Smart Vector & High-DPI Extra Parameters */}
                  {compressMode !== 'lossless' && (
                    <div className="space-y-3 border-t border-[var(--line)] pt-3">
                      <div>
                        <label className="mb-1 flex justify-between font-semibold">
                          <span>{compressMode === 'smart-vector' ? 'Embedded Photo Quality' : 'Render Quality'}</span>
                          <span className="font-mono tabular-nums">{Math.round(compressQuality * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0.45}
                          max={0.95}
                          step={0.05}
                          value={compressQuality}
                          onChange={(e) => setCompressQuality(Number(e.target.value))}
                          className="w-full accent-[var(--accent)]"
                        />
                      </div>

                      {compressMode === 'smart-vector' && (
                        <div>
                          <label className="mb-1 flex justify-between font-semibold">
                            <span>Max Embedded Photo Size</span>
                            <span className="font-mono tabular-nums">{imageMaxPx} px</span>
                          </label>
                          <input
                            type="range"
                            min={1000}
                            max={3000}
                            step={200}
                            value={imageMaxPx}
                            onChange={(e) => setImageMaxPx(Number(e.target.value))}
                            className="w-full accent-[var(--accent)]"
                          />
                        </div>
                      )}

                      {compressMode === 'high-dpi-raster' && (
                        <>
                          <div>
                            <label className="mb-1 flex justify-between font-semibold">
                              <span>Readable Render DPI</span>
                              <span className="font-mono tabular-nums">{Math.round(compressDpi * 72)} DPI</span>
                            </label>
                            <input
                              type="range"
                              min={1.6}
                              max={3.0}
                              step={0.1}
                              value={compressDpi}
                              onChange={(e) => setCompressDpi(Number(e.target.value))}
                              className="w-full accent-[var(--accent)]"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label>
                              <span className="mb-1 block font-semibold">Color Profile</span>
                              <select
                                value={colorMode}
                                onChange={(e) => setColorMode(e.target.value as typeof colorMode)}
                                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5"
                              >
                                <option value="color">Full Color</option>
                                <option value="grayscale">Grayscale</option>
                                <option value="bw-scan">Crisp B&amp;W Scan</option>
                              </select>
                            </label>
                            <label>
                              <span className="mb-1 block font-semibold">Target KB (0=off)</span>
                              <input
                                type="number"
                                min={0}
                                value={targetKb}
                                onChange={(e) => setTargetKb(Math.max(0, Number(e.target.value)))}
                                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono"
                              />
                            </label>
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-2)]">
                            <input
                              type="checkbox"
                              checked={sharpenText}
                              onChange={(e) => setSharpenText(e.target.checked)}
                              className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
                            />
                            <span>Text Crispness Edge Sharpen</span>
                          </label>
                        </>
                      )}
                    </div>
                  )}

                  <div className="border-t border-[var(--line)] pt-3">
                    <label className="mb-1 block font-semibold">Page Subset (optional)</label>
                    <input
                      value={compressPageRange}
                      onChange={(e) => setCompressPageRange(e.target.value)}
                      placeholder="All pages (or e.g. 1-5, last)"
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 font-mono"
                    />
                  </div>
                </>
              )}

              {engine === 'split' && (
                <>
                  <div>
                    <label className="mb-1 block font-semibold">Split Strategy</label>
                    <select
                      value={splitMode}
                      onChange={(e) => setSplitMode(e.target.value as typeof splitMode)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <option value="single">Every Single Page</option>
                      <option value="every-n">Every N Pages</option>
                      <option value="odd-even">Odd &amp; Even Pages</option>
                      <option value="halves">Split in Two Halves</option>
                      <option value="custom">Custom Page Ranges</option>
                    </select>
                  </div>
                  {splitMode === 'every-n' && (
                    <div>
                      <label className="mb-1 block font-semibold">Pages per split chunk</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={splitN}
                        onChange={(e) => setSplitN(Math.max(1, Number(e.target.value)))}
                        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
                      />
                    </div>
                  )}
                  {splitMode === 'custom' && (
                    <div>
                      <label className="mb-1 block font-semibold">Ranges (comma separated)</label>
                      <input
                        value={splitCustom}
                        onChange={(e) => setSplitCustom(e.target.value)}
                        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
                      />
                    </div>
                  )}
                </>
              )}

              {engine === 'rotate' && (
                <>
                  <div>
                    <label className="mb-1 block font-semibold">Rotation Angle</label>
                    <select
                      value={rotateDeg}
                      onChange={(e) => setRotateDeg(Number(e.target.value))}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <option value={90}>90° Clockwise</option>
                      <option value={180}>180° Flip</option>
                      <option value={270}>270° Counter-Clockwise</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">Pages to Rotate (optional)</label>
                    <input
                      value={rotateRange}
                      onChange={(e) => setRotateRange(e.target.value)}
                      placeholder="All pages (or e.g. 1, 3-5)"
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
                    />
                  </div>
                </>
              )}

              {engine === 'watermark' && (
                <>
                  <div>
                    <label className="mb-1 block font-semibold">Diagonal Watermark Text</label>
                    <input
                      value={wmText}
                      onChange={(e) => setWmText(e.target.value)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex justify-between font-semibold">
                      <span>Opacity</span>
                      <span className="font-mono tabular-nums">{Math.round(wmOpacity * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min={0.08}
                      max={0.7}
                      step={0.02}
                      value={wmOpacity}
                      onChange={(e) => setWmOpacity(Number(e.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex justify-between font-semibold">
                      <span>Font Size</span>
                      <span className="font-mono tabular-nums">{wmSize} pt</span>
                    </label>
                    <input
                      type="range"
                      min={24}
                      max={76}
                      step={2}
                      value={wmSize}
                      onChange={(e) => setWmSize(Number(e.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                  </div>
                </>
              )}

              {engine === 'numbers' && (
                <>
                  <div>
                    <label className="mb-1 block font-semibold">Numbering Format</label>
                    <select
                      value={numberFormat}
                      onChange={(e) => setNumberFormat(e.target.value as typeof numberFormat)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <option value="bates">Legal Bates Numbering</option>
                      <option value="x-of-y">Page X of Y</option>
                      <option value="page-x">Page X</option>
                    </select>
                  </div>
                  {numberFormat === 'bates' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        <span className="mb-1 block font-semibold">Prefix</span>
                        <input
                          value={batesPrefix}
                          onChange={(e) => setBatesPrefix(e.target.value)}
                          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block font-semibold">Start #</span>
                        <input
                          type="number"
                          min={1}
                          value={batesStart}
                          onChange={(e) => setBatesStart(Math.max(1, Number(e.target.value)))}
                          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono"
                        />
                      </label>
                    </div>
                  )}
                </>
              )}

              {engine === 'stamp' && (
                <>
                  <div>
                    <label className="mb-1 block font-semibold">Header ({`{filename}, {date}, {page}`})</label>
                    <input
                      value={headerText}
                      onChange={(e) => setHeaderText(e.target.value)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">Footer</label>
                    <input
                      value={footerText}
                      onChange={(e) => setFooterText(e.target.value)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    />
                  </div>
                </>
              )}

              {engine === 'extract' && (
                <div>
                  <label className="mb-1 block font-semibold">Page Ranges (e.g. 1-2, last)</label>
                  <input
                    value={extractRange}
                    onChange={(e) => setExtractRange(e.target.value)}
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
                  />
                </div>
              )}

              {engine === 'rename' && (
                <div>
                  <label className="mb-1 block font-semibold">Naming Pattern</label>
                  <input
                    value={renamePattern}
                    onChange={(e) => setRenamePattern(e.target.value)}
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
                  />
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    Tokens: {`{index}`}, {`{name}`}, {`{date}`}
                  </div>
                </div>
              )}

              {engine === 'metadata' && (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block font-semibold">Title (blank to strip)</label>
                    <input
                      value={titleOverride}
                      onChange={(e) => setTitleOverride(e.target.value)}
                      placeholder="Leave empty to clear Title"
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">Author (blank to strip)</label>
                    <input
                      value={authorOverride}
                      onChange={(e) => setAuthorOverride(e.target.value)}
                      placeholder="Leave empty to clear Author"
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">Subject (blank to strip)</label>
                    <input
                      value={subjectOverride}
                      onChange={(e) => setSubjectOverride(e.target.value)}
                      placeholder="Leave empty to clear Subject"
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5"
                    />
                  </div>
                </div>
              )}

              {engine === 'resize' && (
                <div>
                  <label className="mb-1 block font-semibold">Target Page Size</label>
                  <select
                    value={targetPageSize}
                    onChange={(e) => setTargetPageSize(e.target.value as typeof targetPageSize)}
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                  >
                    <option value="a4">A4 (595 × 842 pt)</option>
                    <option value="letter">US Letter (612 × 792 pt)</option>
                    <option value="legal">US Legal (612 × 1008 pt)</option>
                  </select>
                </div>
              )}

              {engine === 'img2pdf' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="mb-1 block font-semibold">Page Size</span>
                      <select
                        value={imgPageSize}
                        onChange={(e) => setImgPageSize(e.target.value as typeof imgPageSize)}
                        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5"
                      >
                        <option value="a4">A4</option>
                        <option value="letter">Letter</option>
                        <option value="fit">Fit Image</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block font-semibold">Orientation</span>
                      <select
                        value={imgOrient}
                        onChange={(e) => setImgOrient(e.target.value as typeof imgOrient)}
                        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5"
                      >
                        <option value="auto">Auto</option>
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-2)]">
                    <input
                      type="checkbox"
                      checked={imgMergeAll}
                      onChange={(e) => setImgMergeAll(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
                    />
                    <span>Merge all queued images into one PDF</span>
                  </label>
                </>
              )}

              {engine === 'pdf2img' && (
                <>
                  <div>
                    <label className="mb-1 block font-semibold">Image Format</label>
                    <select
                      value={imgOutFormat}
                      onChange={(e) => setImgOutFormat(e.target.value as typeof imgOutFormat)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <option value="png">PNG (Lossless Full HD)</option>
                      <option value="webp">WebP (Crisp Full HD &amp; Compact)</option>
                      <option value="jpg">JPG (Full HD Universal)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 flex justify-between font-semibold">
                      <span>Render Resolution</span>
                      <span className="font-mono tabular-nums">{Math.round(imgOutScale * 72)} DPI</span>
                    </label>
                    <div className="mb-2 grid grid-cols-3 gap-1.5">
                      {[
                        { s: 2.0, lbl: 'HD · 144' },
                        { s: 3.0, lbl: 'Full HD · 216' },
                        { s: 4.17, lbl: '4K · 300' },
                      ].map((p) => (
                        <button
                          key={p.s}
                          type="button"
                          onClick={() => setImgOutScale(p.s)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                            Math.abs(imgOutScale - p.s) < 0.05
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                              : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]'
                          }`}
                        >
                          {p.lbl}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={1.5}
                      max={4.17}
                      step={0.17}
                      value={imgOutScale}
                      onChange={(e) => setImgOutScale(Number(e.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                  </div>
                </>
              )}

              {engine === 'grayscale' && (
                <>
                  <div>
                    <label className="mb-1 block font-semibold">Scan Profile</label>
                    <select
                      value={grayMode}
                      onChange={(e) => setGrayMode(e.target.value as typeof grayMode)}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <option value="grayscale">Readable Grayscale</option>
                      <option value="bw-scan">High-Contrast B&amp;W Scan</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 flex justify-between font-semibold">
                      <span>Scan DPI</span>
                      <span className="font-mono tabular-nums">{Math.round(grayDpi * 72)} DPI</span>
                    </label>
                    <input
                      type="range"
                      min={1.8}
                      max={3.0}
                      step={0.2}
                      value={grayDpi}
                      onChange={(e) => setGrayDpi(Number(e.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                  </div>
                </>
              )}

              {engine === 'flatten' && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-2)]">
                  <input
                    type="checkbox"
                    checked={stripAnnotations}
                    onChange={(e) => setStripAnnotations(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
                  />
                  <span>Also strip comments &amp; annotations</span>
                </label>
              )}

              {engine === 'text' && (
                <div>
                  <label className="mb-1 block font-semibold">Export Format</label>
                  <select
                    value={textFormat}
                    onChange={(e) => setTextFormat(e.target.value as 'txt' | 'md')}
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                  >
                    <option value="txt">Plain Text (.txt)</option>
                    <option value="md">Markdown (.md)</option>
                  </select>
                </div>
              )}

              {staleDoneCount > 0 && !running && (
                <div
                  data-batch-settings-changed
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"
                >
                  Parameters changed — click below to re-run all {items.length} file(s) with the new settings.
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  data-pdf-batch-run-btn
                  disabled={!items.length || running}
                  onClick={runBatch}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
                >
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : staleDoneCount > 0 || (doneCount === items.length && items.length > 0) ? (
                    <RotateCcw className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  <span>{runButtonLabel}</span>
                </button>
                {running && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        pausedRef.current = !pausedRef.current;
                        setPaused(pausedRef.current);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold"
                    >
                      <Pause className="h-3.5 w-3.5" /> {paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        cancelledRef.current = true;
                        pausedRef.current = false;
                        setPaused(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--danger)] px-3 py-2 text-xs font-semibold text-[var(--danger)]"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-4 lg:col-span-8">
          {/* Live Progress & Throughput Telemetry Bar */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span
                  data-pdf-batch-pct
                  className="font-mono text-2xl font-bold tracking-tight tabular-nums text-[var(--ink)]"
                >
                  {overallPct}%
                </span>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                  <span className="font-medium text-emerald-700">
                    <span className="font-mono font-bold tabular-nums">{doneCount}</span> / {items.length} Done
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Input <strong className="font-mono tabular-nums text-[var(--ink)]">{fmtBytes(totalOrig)}</strong>
                  </span>
                  {totalOut > 0 && (
                    <>
                      <span aria-hidden="true">→</span>
                      <span>
                        Output <strong className="font-mono tabular-nums text-[var(--ink)]">{fmtBytes(totalOut)}</strong>
                      </span>
                      {savings.improved && (
                        <span className="font-mono font-bold tabular-nums text-emerald-600">
                          (-{savings.savedPct}%)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-[var(--muted)]">
                {runCount > 0 && (
                  <span data-pdf-batch-run-count>
                    Run #{runCount}
                  </span>
                )}
                {(running || runElapsedMs > 0) && (
                  <span>
                    Elapsed <strong className="text-[var(--ink)]">{(runElapsedMs / 1000).toFixed(1)}s</strong>
                  </span>
                )}
              </div>
            </div>

            <div
              role="progressbar"
              aria-label="PDF Batch progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={overallPct}
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
            >
              <div
                className="h-full bg-emerald-600 transition-all duration-150"
                style={{ width: `${overallPct}%` }}
              />
            </div>
          </div>

          <Panel
            title={`Queue ${activeQueue} Files (${items.length})`}
            actions={
              <button
                type="button"
                disabled={!doneCount}
                onClick={downloadAllZip}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" /> Download All ZIP ({doneCount})
              </button>
            }
          >
            {items.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--muted)]">
                Add multiple PDFs or images on the left to start Queue {activeQueue}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                      <th className="py-2 pr-3 font-medium">File</th>
                      <th className="py-2 pr-3 text-right font-medium">Input</th>
                      <th className="py-2 pr-3 text-right font-medium">Output</th>
                      <th className="py-2 pr-3 font-medium">Engine / Status</th>
                      <th className="py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {items.map((it) => {
                      const delta =
                        it.outSize !== undefined
                          ? computeCompressionDelta(it.origSize, it.outSize)
                          : null;
                      const isStale = it.status === 'done' && it.runParamSig !== currentParamSig;
                      return (
                        <tr key={it.id} data-pdf-batch-row={it.relPath} className="hover:bg-[var(--surface-2)]/60">
                          <td className="py-2.5 pr-3">
                            <div className="font-medium text-[var(--ink)]">{it.relPath}</div>
                            {it.note && (
                              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                                {it.note}
                                {it.durationMs !== undefined ? ` · ${it.durationMs} ms` : ''}
                              </div>
                            )}
                          </td>
                          <td className="num py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--muted)]">
                            {fmtBytes(it.origSize)}
                          </td>
                          <td className="num py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--ink)]">
                            {it.outSize ? (
                              <div>
                                <span>{fmtBytes(it.outSize)}</span>
                                {delta && delta.savedPct !== 0 && (
                                  <span
                                    className={`ml-1.5 text-[11px] font-semibold ${
                                      delta.improved ? 'text-emerald-600' : 'text-[var(--muted)]'
                                    }`}
                                  >
                                    {delta.improved ? `-${delta.savedPct}%` : `+${Math.abs(delta.savedPct)}%`}
                                  </span>
                                )}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            {it.status === 'done' && !isStale && (
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                              </span>
                            )}
                            {it.status === 'done' && isStale && (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                                <Sparkles className="h-3.5 w-3.5" /> Stale (re-run)
                              </span>
                            )}
                            {it.status === 'running' && (
                              <span className="inline-flex items-center gap-1 font-semibold text-[var(--accent)]">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
                              </span>
                            )}
                            {it.status === 'queued' && (
                              <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                                <Clock className="h-3 w-3" /> Queued
                              </span>
                            )}
                            {it.status === 'error' && (
                              <span className="inline-flex items-center gap-1 text-[var(--danger)]" title={it.error}>
                                <AlertCircle className="h-3.5 w-3.5" /> {it.error}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {it.outputs?.[0] && (
                                <button
                                  type="button"
                                  onClick={() => downloadBlob(it.outputs![0].blob, it.outputs![0].name)}
                                  className="rounded-md bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent)] hover:text-white transition-colors"
                                >
                                  Save
                                </button>
                              )}
                              {it.status === 'error' && (
                                <button
                                  type="button"
                                  onClick={() => updateItem(activeQueue, it.id, { status: 'queued' })}
                                  className="rounded-md border border-[var(--line)] p-1 text-[var(--ink-2)]"
                                  title="Retry"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={running}
                                onClick={() =>
                                  setQueues((p) => ({
                                    ...p,
                                    [activeQueue]: p[activeQueue].filter((x) => x.id !== it.id),
                                  }))
                                }
                                className="rounded-md p-1 text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-35"
                                title="Remove"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
