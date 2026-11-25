import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  FileText,
  FileCode2,
  RefreshCw,
  CheckCircle2,
  Archive,
  Send,
  Eye,
  AlertTriangle,
  Layers,
  Loader2,
} from 'lucide-react';
import { ToolDef } from '../../data/toolsCatalog';
import { useWorkspace } from '../../context/WorkspaceContext';
import { CopyButton, FileDropzone, Panel, StatTile, ToolHeader } from '../ui/SharedUi';
import { downloadBlob, downloadBytes, downloadText, readFileAsBytes } from '../../utils/download';
import { fmtBytes, parseCsv as parseCsvRows, safeBase } from '../../utils/formatters';
import {
  buildDocxFromBlocks,
  convertDataFormat,
  convertDocxToPdf,
  convertHtmlToExactPdf,
  convertPdfToDocx,
  convertPdfToXlsx,
  exportWorkbookAllSheetsToPdf,
  exportWorkbookSheetsToCsvZip,
  parseHtmlToBlocks,
  parseMarkdownToBlocks,
  parseSpreadsheetBytes,
  parseWordOrRichDocBytes,
  PdfRenderMode,
  renderBlocksToPdf,
  renderTableToPdf,
  rowsToBeautifiedHtml,
  rowsToCsvString,
  rowsToMarkdownTable,
  rowsToXlsxBytes,
  WorkbookPreview,
} from '../../utils/converterEngine';
import { convertPdfToOutputs, openPdfJs, renderPdfPageToCanvas } from '../../utils/pdfEngine';
import {
  BulkTargetFormat,
  convertBulkFile,
  getDefaultTargetForExt,
  inspectSourcePreview,
  isImageExt,
  PreviewPayload,
} from '../../utils/bulkConverter';
import { ConverterBulkPanel } from './ConverterBulkPanel';
import { ConverterPreviewModal } from './ConverterPreviewModal';

type ConvTab =
  | 'universal'
  | 'bulk'
  | 'docx-pdf'
  | 'pdf-docx'
  | 'xlsx-csv'
  | 'csv-pdf'
  | 'xlsx-pdf'
  | 'doc-builder'
  | 'data-matrix';

const SAMPLE_CSV = `Invoice,Client,Region,Category,Units,Amount_USD,Status
INV-2041,Apex Retail Ltd,Dhaka,Software,4,2400,Paid
INV-2042,Nordic Studio,Oslo,Consulting,2,1850,Paid
INV-2043,Crescent Exports,Chattogram,Automation,6,4200,Pending
INV-2044,Horizon Labs,Singapore,Analytics,3,3150,Paid
INV-2045,Meridian Health,London,PDF Pipeline,5,2900,Paid`;

const SAMPLE_MARKDOWN = `# Quarterly Operations Brief

Executive summary formatted cleanly for local PDF and Word export.

## Key Highlights
- 100% browser-based DOC, DOCX, PDF, XLS, XLSX, and CSV conversion
- Full Unicode & বাংলা script support with automatic HiDPI PDF rendering
- Zero server uploads for confidential company records

## Performance Breakdown
| Metric | Q3 Result | Q4 Target |
| --- | --- | --- |
| Processing Speed | 0.4s / doc | 0.2s / doc |
| Privacy Score | 100% Local | 100% Local |
| Supported Formats | 18+ Types | 24+ Types |

---

Ready to export as a styled **PDF Report** or editable **Word (.docx)** file.`;

const WORD_EXTS = new Set(['docx', 'doc', 'rtf', 'odt']);
const SHEET_EXTS = new Set(['xlsx', 'xls', 'ods']);

/** Live Exact Word Layout Preview using `docx-preview` so users see the exact DOCX pages before exporting PDF */
function ExactDocxLivePreview({ bytes }: { bytes: Uint8Array }) {
  const styleRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    (async () => {
      try {
        if (!bodyRef.current || !styleRef.current) return;
        const { renderDocxToContainer } = await import('../../utils/docxFidelityRenderer');
        if (!active || !bodyRef.current || !styleRef.current) return;
        await renderDocxToContainer(bytes, bodyRef.current, styleRef.current);
        if (active) setStatus('ready');
      } catch {
        if (active) setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [bytes]);

  return (
    <div className="relative">
      <div ref={styleRef} />
      {status === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-12 text-xs font-medium text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          Rendering exact Word layout preview...
        </div>
      )}
      <div
        ref={bodyRef}
        data-docx-exact-preview
        className={`max-h-[540px] overflow-auto rounded-xl border border-[var(--line)] bg-slate-200/70 p-3 [&_.docx-exact-wrapper]:!bg-transparent [&_.docx-exact-wrapper]:!p-0 [&_section.docx-exact]:!mx-auto [&_section.docx-exact]:!mb-4 [&_section.docx-exact]:!shadow-md [&_section.docx-exact]:!max-w-full ${
          status === 'loading' ? 'hidden' : 'block'
        }`}
      />
      {status === 'error' && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-xs text-[var(--muted)]">
          Exact Word preview unavailable for this file — fallback text preview will be used on export.
        </div>
      )}
    </div>
  );
}

export function ConverterStudioWorkspace({ tool }: { tool: ToolDef }) {
  const { transfer, clearTransfer, navigateToTool } = useWorkspace();
  const [tab, setTab] = useState<ConvTab>((tool.tab as ConvTab) || 'universal');

  // Shared status / error / output preview
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [successMsg, setSuccessMsg] = useState('');
  const [pdfRenderMode, setPdfRenderMode] = useState<PdfRenderMode>('auto');
  const [bulkIncoming, setBulkIncoming] = useState<{ files: File[]; nonce: number }>({ files: [], nonce: 0 });
  const [lastOutput, setLastOutput] = useState<{
    name: string;
    size: number;
    mime: string;
    blob: Blob;
    url: string;
    pageCount?: number;
    previewImgs?: string[];
  } | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const lastUrlRef = useRef<string>('');

  // File-based conversion state
  const [file, setFile] = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [singlePreview, setSinglePreview] = useState<PreviewPayload | undefined>(undefined);
  const [singlePreviewLoading, setSinglePreviewLoading] = useState(false);
  const [singleModalOpen, setSingleModalOpen] = useState(false);
  const [singleModalTarget, setSingleModalTarget] = useState<BulkTargetFormat>('pdf');

  // Word / Rich Doc preview state
  const [docxHtml, setDocxHtml] = useState('');
  const [docxPlain, setDocxPlain] = useState('');
  const [docFormatLabel, setDocFormatLabel] = useState('');

  // Spreadsheet / CSV state
  const [wbPreview, setWbPreview] = useState<WorkbookPreview | null>(null);
  const [activeSheet, setActiveSheet] = useState('');
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [pdfTitle, setPdfTitle] = useState('Executive Data Report');
  const [pdfOrient, setPdfOrient] = useState<'auto' | 'portrait' | 'landscape'>('auto');

  // PDF -> DOCX / XLSX preview state
  const [pdfPreviewText, setPdfPreviewText] = useState('');
  const [pdfPageCount, setPdfPageCount] = useState(0);

  // Markdown / HTML -> DOCX / PDF builder
  const [docSourceMode, setDocSourceMode] = useState<'markdown' | 'html'>('markdown');
  const [docSource, setDocSource] = useState(SAMPLE_MARKDOWN);
  const [docTitle, setDocTitle] = useState('Quarterly Operations Brief');

  // Data Matrix (JSON / CSV / TSV / YAML / XML)
  const [matrixFrom, setMatrixFrom] = useState<'json' | 'csv' | 'tsv' | 'yaml' | 'xml'>('csv');
  const [matrixTo, setMatrixTo] = useState<'json' | 'csv' | 'tsv' | 'yaml' | 'xml' | 'markdown'>('json');
  const [matrixInput, setMatrixInput] = useState(SAMPLE_CSV);

  useEffect(() => {
    setTab((tool.tab as ConvTab) || 'universal');
    setError('');
    setSuccessMsg('');
  }, [tool.id, tool.tab]);

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (transfer?.files?.length) {
      if (transfer.files.length > 1) {
        routeFilesToBulk(transfer.files);
      } else {
        handleIncomingFile(transfer.files[0]);
      }
      clearTransfer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.nonce]);

  const detectedExt = useMemo(() => {
    if (!file) return '';
    return file.name.split('.').pop()?.toLowerCase() || '';
  }, [file]);

  const activeRows = useMemo(() => {
    if (wbPreview && activeSheet && wbPreview.sheets[activeSheet]) {
      return wbPreview.sheets[activeSheet];
    }
    return parseCsvRows(csvText);
  }, [wbPreview, activeSheet, csvText]);

  const matrixResult = useMemo(() => {
    try {
      return { output: convertDataFormat(matrixInput, matrixFrom, matrixTo), err: '' };
    } catch (e) {
      return { output: '', err: e instanceof Error ? e.message : 'Unable to parse input format' };
    }
  }, [matrixInput, matrixFrom, matrixTo]);

  const renderPdfPreviewThumbs = async (bytes: Uint8Array): Promise<{ pageCount: number; imgs: string[] }> => {
    try {
      const pdfDoc = await openPdfJs(bytes);
      const total = pdfDoc.numPages;
      const limit = Math.min(total, 3);
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
  };

  const recordAndDownload = (blob: Blob, filename: string, mime: string) => {
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    const url = URL.createObjectURL(blob);
    lastUrlRef.current = url;
    setLastOutput({ name: filename, size: blob.size, mime, blob, url });
    setShowPdfPreview(false);
    downloadBlob(blob, filename);
  };

  const recordAndDownloadBytes = (bytes: Uint8Array, filename: string, mime = 'application/pdf') => {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    const url = URL.createObjectURL(blob);
    lastUrlRef.current = url;
    setLastOutput({ name: filename, size: blob.size, mime, blob, url });
    downloadBlob(blob, filename);
    if (mime === 'application/pdf') {
      setShowPdfPreview(true);
      void renderPdfPreviewThumbs(bytes).then(({ pageCount, imgs }) => {
        setLastOutput((prev) =>
          prev && prev.url === url ? { ...prev, pageCount, previewImgs: imgs } : prev
        );
      });
    } else {
      setShowPdfPreview(false);
    }
  };

  const routeFilesToBulk = (files: File[]) => {
    setError('');
    setWarnings([]);
    setSuccessMsg('');
    setBulkIncoming({ files, nonce: Date.now() });
    setTab('bulk');
  };

  const handleDropFiles = (files: File[]) => {
    if (!files.length) return;
    if (files.length > 1) {
      routeFilesToBulk(files);
    } else {
      void handleIncomingFile(files[0]);
    }
  };

  const handleIncomingFile = async (f: File) => {
    setError('');
    setWarnings([]);
    setSuccessMsg('');
    setFile(f);
    setSinglePreview(undefined);
    setSinglePreviewLoading(true);
    setBusy(true);
    try {
      const bytes = await readFileAsBytes(f);
      setFileBytes(bytes);
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      const base = safeBase(f.name);
      setPdfTitle(base.replace(/[_-]+/g, ' '));
      setDocTitle(base.replace(/[_-]+/g, ' '));
      setSingleModalTarget(getDefaultTargetForExt(ext));

      // Populate full input preview asynchronously for the File Preview Modal
      void inspectSourcePreview(f)
        .then((p) => {
          setSinglePreview(p);
          setSinglePreviewLoading(false);
        })
        .catch(() => setSinglePreviewLoading(false));

      if (isImageExt(ext) || f.type.startsWith('image/')) {
        setSuccessMsg(
          `Loaded ${ext.toUpperCase() || 'image'} file. Preview it in full-screen modal or convert to PDF, PNG, WebP, JPG, or HTML.`
        );
      } else if (WORD_EXTS.has(ext)) {
        const parsed = await parseWordOrRichDocBytes(bytes, f.name);
        setDocxHtml(parsed.html);
        setDocxPlain(parsed.plainText);
        setDocFormatLabel(parsed.formatLabel);
        setWarnings(parsed.warnings);
        if (tab !== 'universal' && tab !== 'docx-pdf') setTab('docx-pdf');
        setSuccessMsg(
          `Loaded ${parsed.formatLabel} (${parsed.blocks.length} content blocks). Preview input or export as PDF, HTML, or TXT.`
        );
      } else if (SHEET_EXTS.has(ext)) {
        const preview = parseSpreadsheetBytes(bytes);
        setWbPreview(preview);
        const firstNonEmpty =
          preview.sheetNames.find((s) => (preview.sheets[s]?.length || 0) > 0) || preview.sheetNames[0] || '';
        setActiveSheet(firstNonEmpty);
        if (firstNonEmpty) {
          setCsvText(rowsToCsvString(preview.sheets[firstNonEmpty] || []));
        }
        if (tab === 'docx-pdf' || tab === 'pdf-docx' || tab === 'doc-builder') {
          setTab('xlsx-pdf');
        }
        setSuccessMsg(
          `Loaded Excel workbook with ${preview.sheetNames.length} sheet(s). Click "Download PDF Report" or choose CSV/JSON/HTML.`
        );
      } else if (ext === 'csv' || ext === 'tsv') {
        const txt = new TextDecoder().decode(bytes);
        setCsvText(txt);
        setWbPreview(null);
        setMatrixInput(txt);
        setMatrixFrom(ext === 'tsv' ? 'tsv' : 'csv');
        if (tab === 'docx-pdf' || tab === 'pdf-docx' || tab === 'doc-builder') {
          setTab('csv-pdf');
        }
        setSuccessMsg(`Loaded ${ext.toUpperCase()} dataset. Ready to export as PDF, XLSX, JSON, or HTML.`);
      } else if (ext === 'json') {
        const txt = new TextDecoder().decode(bytes);
        setMatrixInput(txt);
        setMatrixFrom('json');
        try {
          const parsed = JSON.parse(txt);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          if (arr.length && typeof arr[0] === 'object') {
            const csv = convertDataFormat(txt, 'json', 'csv');
            setCsvText(csv);
            setWbPreview(null);
          }
        } catch {
          // keep matrix text
        }
        setSuccessMsg('Loaded JSON payload. Export to PDF table, XLSX, CSV, YAML, or XML.');
      } else if (ext === 'md' || ext === 'txt' || ext === 'html' || ext === 'htm') {
        const txt = new TextDecoder().decode(bytes);
        setDocSource(txt);
        setDocSourceMode(ext === 'html' || ext === 'htm' ? 'html' : 'markdown');
        if (tab !== 'universal' && tab !== 'doc-builder') setTab('doc-builder');
        setSuccessMsg(`Loaded ${ext.toUpperCase()} document. Ready to export as PDF or Word (.docx).`);
      } else if (ext === 'pdf') {
        setPdfPreviewText('');
        setPdfPageCount(0);
        if (tab !== 'universal' && tab !== 'pdf-docx') setTab('pdf-docx');
        setSuccessMsg('Loaded PDF document. Preview pages in modal, Convert to Word (.docx), or Extract to Excel (.xlsx).');
      } else {
        setError(`Unsupported file extension ".${ext}". Supported: DOC, DOCX, RTF, ODT, XLS, XLSX, ODS, CSV, TSV, PDF, PNG, JPG, WebP, SVG, JSON, HTML, MD, TXT.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to inspect uploaded file.');
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setBusyStage({ label: `${label}: Parsing & rendering...`, pct: 45 });
    setError('');
    setSuccessMsg('');
    try {
      await new Promise((r) => setTimeout(r, 15));
      await fn();
      setBusyStage({ label: `${label}: Ready`, pct: 100 });
      setSuccessMsg(`${label} ready! Download triggered — you can also preview or re-download below.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed.`);
    } finally {
      setBusy(false);
      setTimeout(() => setBusyStage(null), 500);
    }
  };

  const tabs: [ConvTab, string][] = [
    ['universal', 'Universal Converter'],
    ['bulk', 'Bulk Queue & Preview'],
    ['docx-pdf', 'DOC / DOCX / RTF → PDF'],
    ['pdf-docx', 'PDF → DOCX / XLSX'],
    ['xlsx-csv', 'XLS / XLSX ⇄ CSV / JSON'],
    ['csv-pdf', 'CSV → Beautified PDF'],
    ['xlsx-pdf', 'XLS / XLSX → PDF Report'],
    ['doc-builder', 'MD / HTML → DOCX & PDF'],
    ['data-matrix', 'JSON / CSV / YAML / XML'],
  ];

  const renderModeControl = (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <span className="font-semibold text-[var(--muted)]">PDF Engine:</span>
      <select
        value={pdfRenderMode}
        onChange={(e) => setPdfRenderMode(e.target.value as PdfRenderMode)}
        aria-label="PDF Render Engine"
        className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)]"
      >
        <option value="auto">Exact Layout &amp; Office Fidelity (Default)</option>
        <option value="visual">Visual HiDPI (Bangla / Complex CSS)</option>
        <option value="vector">Vector Text (Smallest Latin PDF)</option>
      </select>
    </label>
  );

  return (
    <div>
      <ToolHeader
        tool={tool}
        extra={
          <div className="flex flex-wrap items-center gap-2">
            {renderModeControl}
            <button
              type="button"
              onClick={() => navigateToTool('pdf-batch')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent)] hover:text-white transition-colors whitespace-nowrap"
            >
              <Layers className="h-3.5 w-3.5" />
              Batch Processing Studio
            </button>
            <button
              type="button"
              onClick={() => navigateToTool('pdf-convert')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] whitespace-nowrap"
            >
              <Send className="h-3.5 w-3.5" />
              Full HD PDF → PNG
            </button>
          </div>
        }
      />

      {/* Mode Switcher */}
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-xs)]">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setError('');
              setSuccessMsg('');
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === id
                ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-xs)]'
                : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-[var(--danger-soft)] px-4 py-3 text-xs font-semibold text-[var(--danger)]">
          {error}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            {warnings.slice(0, 3).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        </div>
      )}
      {busyStage && (
        <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-xs)]">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--ink)]">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
              {busyStage.label}
            </span>
            <span className="font-mono tabular-nums text-[var(--muted)]">{busyStage.pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={busyStage.pct}
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
          >
            <div
              className="h-full bg-[var(--accent)] transition-all duration-200"
              style={{ width: `${busyStage.pct}%` }}
            />
          </div>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-[var(--success-soft)] px-4 py-3 text-xs font-semibold text-[var(--success)]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Single-File Quick Preview Modal (Documents & Images before Conversion) */}
      <ConverterPreviewModal
        open={singleModalOpen && Boolean(file)}
        item={
          file
            ? {
                id: `${file.name}-${file.size}`,
                name: file.name,
                ext: detectedExt,
                sizeBytes: file.size,
                targetFormat: singleModalTarget,
                inputPreview: singlePreview,
                inputPreviewLoading: singlePreviewLoading,
                outputFilename: lastOutput?.name,
                outputSizeBytes: lastOutput?.size,
                outputUrl: lastOutput?.url,
                outputPreview:
                  lastOutput?.mime === 'application/pdf' && lastOutput.previewImgs?.length
                    ? {
                        kind: 'pdf',
                        pdfImgs: lastOutput.previewImgs,
                        pageCount: lastOutput.pageCount,
                      }
                    : undefined,
              }
            : null
        }
        onClose={() => setSingleModalOpen(false)}
        onChangeTarget={(fmt) => setSingleModalTarget(fmt)}
        converting={busy}
        onConvertNow={
          file
            ? () => {
                setSingleModalOpen(false);
                void runAction(`Convert → ${singleModalTarget.toUpperCase()}`, async () => {
                  const res = await convertBulkFile(file, singleModalTarget, {
                    renderMode: pdfRenderMode,
                    orientation: pdfOrient,
                  });
                  const bytes = new Uint8Array(await res.blob.arrayBuffer());
                  recordAndDownloadBytes(bytes, res.filename, res.mime);
                });
              }
            : undefined
        }
      />

      {/* ==================== BULK QUEUE & LIVE FILE PREVIEW ==================== */}
      <div className={tab === 'bulk' ? 'block' : 'hidden'}>
        <ConverterBulkPanel
          pdfRenderMode={pdfRenderMode}
          incomingFiles={bulkIncoming.files}
          incomingNonce={bulkIncoming.nonce}
          onClearIncoming={() => setBulkIncoming({ files: [], nonce: 0 })}
        />
      </div>

      {/* Persistent Last Exported Output Bar & Inline PDF Preview */}
      {tab !== 'bulk' && lastOutput && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-[var(--ink)]">
                  Output Ready: {lastOutput.name}
                </div>
                <div className="text-[11px] text-[var(--muted)]">
                  {fmtBytes(lastOutput.size)} · {lastOutput.mime}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lastOutput.mime === 'application/pdf' && (
                <button
                  type="button"
                  onClick={() => setShowPdfPreview((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)]"
                >
                  <Eye className="h-3.5 w-3.5" /> {showPdfPreview ? 'Hide PDF Preview' : 'Preview PDF'}
                </button>
              )}
              <a
                href={lastOutput.url}
                download={lastOutput.name}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Download className="h-3.5 w-3.5" /> Save / Download
              </a>
            </div>
          </div>
          {showPdfPreview && lastOutput.mime === 'application/pdf' && (
            <div className="mt-3 rounded-xl border border-[var(--line)] bg-slate-100/90 p-4">
              <div className="mb-2.5 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                <span>
                  Rendered PDF Preview
                  {lastOutput.pageCount
                    ? ` · Showing ${Math.min(lastOutput.pageCount, 3)} of ${lastOutput.pageCount} page${lastOutput.pageCount > 1 ? 's' : ''}`
                    : ' · Rendering pages...'}
                </span>
                <span>Exact output as saved</span>
              </div>
              {lastOutput.previewImgs && lastOutput.previewImgs.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {lastOutput.previewImgs.map((src, idx) => (
                    <div
                      key={idx}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                    >
                      <img
                        src={src}
                        alt={`PDF Page ${idx + 1}`}
                        data-pdf-preview-page={idx + 1}
                        className="w-full h-auto block"
                      />
                      <div className="border-t border-slate-100 bg-slate-50 px-2.5 py-1 text-center text-[10px] font-mono text-slate-500">
                        Page {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-xs text-slate-500">Rendering PDF page preview...</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== UNIVERSAL ANY-TO-ANY CONVERTER ==================== */}
      {tab === 'universal' && (
        <div className="space-y-5">
          <FileDropzone
            multiple
            accept=".doc,.docx,.rtf,.odt,.xlsx,.xls,.ods,.csv,.tsv,.pdf,.json,.md,.html,.htm,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,image/*"
            onFiles={handleDropFiles}
            label={
              file
                ? `Loaded: ${file.name} (${fmtBytes(file.size)}) — drop multiple files for Bulk Mode`
                : 'Drop 1 document or image for instant conversion — or drop multiple files for Bulk Queue'
            }
            hint="Auto-detects DOC, DOCX, RTF, ODT, XLS, XLSX, CSV, PDF, Images (PNG/JPG/WebP/SVG), JSON, HTML & Markdown locally"
          />

          {!file ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                {
                  title: 'Bulk Queue & Live Preview',
                  desc: 'Convert multiple mixed files & images at once with real-time progress and modal preview.',
                  target: 'bulk' as ConvTab,
                  icon: Layers,
                },
                {
                  title: 'Word (.doc / .docx / .rtf) → PDF',
                  desc: 'Convert Word, RTF & ODT documents into clean A4 PDFs with Bangla & image support.',
                  target: 'docx-pdf' as ConvTab,
                  icon: FileText,
                },
                {
                  title: 'PDF → Word (.docx)',
                  desc: 'Extract structured text & headings from PDFs into editable Word or Excel files.',
                  target: 'pdf-docx' as ConvTab,
                  icon: RefreshCw,
                },
                {
                  title: 'Excel (.xls / .xlsx) → CSV',
                  desc: 'Export single sheets to CSV/JSON/HTML or all workbook sheets into one ZIP.',
                  target: 'xlsx-csv' as ConvTab,
                  icon: FileSpreadsheet,
                },
                {
                  title: 'Excel / CSV → Beautified PDF',
                  desc: 'Turn Excel sheets or raw CSV data into multi-page styled PDF reports.',
                  target: 'xlsx-pdf' as ConvTab,
                  icon: FileCode2,
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.title}
                    type="button"
                    onClick={() => setTab(card.target)}
                    className="group flex flex-col justify-between rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-[var(--shadow-xs)] hover:border-[var(--accent)]/60 transition-all"
                  >
                    <div>
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="font-display text-sm font-bold text-[var(--ink)] group-hover:text-[var(--accent)]">
                        {card.title}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{card.desc}</p>
                    </div>
                    <div className="mt-3 inline-flex items-center text-xs font-semibold text-[var(--accent)]">
                      Open converter <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Panel
              title={`Convert "${file.name}" (${detectedExt.toUpperCase()})`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-single-preview-modal-btn
                    onClick={() => setSingleModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent)] hover:text-white transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" /> Quick Preview Input
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setFileBytes(null);
                      setSinglePreview(undefined);
                      setDocxHtml('');
                      setDocxPlain('');
                      setWbPreview(null);
                      setWarnings([]);
                    }}
                    className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                  >
                    Choose another file
                  </button>
                </div>
              }
            >
              <div className="flex flex-wrap gap-2.5">
                {(isImageExt(detectedExt) || file.type.startsWith('image/')) && (
                  <>
                    {(['pdf', 'png', 'webp', 'jpg', 'html'] as BulkTargetFormat[]).map((fmt, i) => (
                      <button
                        key={fmt}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          runAction(`Image → ${fmt.toUpperCase()}`, async () => {
                            const res = await convertBulkFile(file, fmt, {
                              renderMode: pdfRenderMode,
                              orientation: pdfOrient,
                            });
                            const bytes = new Uint8Array(await res.blob.arrayBuffer());
                            recordAndDownloadBytes(bytes, res.filename, res.mime);
                          })
                        }
                        className={
                          i === 0
                            ? 'inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50'
                            : 'rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]'
                        }
                      >
                        {i === 0 && <Download className="h-3.5 w-3.5" />}
                        {fmt === 'pdf'
                          ? 'Convert to A4 PDF'
                          : fmt === 'png'
                            ? 'Lossless PNG'
                            : fmt === 'webp'
                              ? 'Export WebP'
                              : fmt === 'jpg'
                                ? 'Export JPG'
                                : 'Embed in HTML'}
                      </button>
                    ))}
                  </>
                )}
                {WORD_EXTS.has(detectedExt) && fileBytes && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('Document → PDF', async () => {
                          const { pdfBytes } = await convertDocxToPdf(fileBytes, safeBase(file.name), {
                            filename: file.name,
                            renderMode: pdfRenderMode,
                          });
                          recordAndDownloadBytes(pdfBytes, `${safeBase(file.name)}.pdf`, 'application/pdf');
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" /> Export Beautified PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText(docxHtml, `${safeBase(file.name)}.html`, 'text/html')}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    >
                      Export Clean HTML
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText(docxPlain, `${safeBase(file.name)}.txt`, 'text/plain')}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    >
                      Export Plain TXT
                    </button>
                  </>
                )}

                {detectedExt === 'pdf' && fileBytes && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('PDF → DOCX', async () => {
                          const res = await convertPdfToDocx(fileBytes, safeBase(file.name));
                          setPdfPreviewText(res.previewText);
                          setPdfPageCount(res.pageCount);
                          recordAndDownloadBytes(
                            res.docxBytes,
                            `${safeBase(file.name)}.docx`,
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                          );
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" /> Convert to Word (.docx)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('PDF → XLSX', async () => {
                          const res = await convertPdfToXlsx(fileBytes);
                          recordAndDownloadBytes(
                            res.xlsxBytes,
                            `${safeBase(file.name)}.xlsx`,
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                          );
                        })
                      }
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    >
                      Extract to Excel (.xlsx)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('PDF → Full HD PNG', async () => {
                          const res = await convertPdfToOutputs(fileBytes, file.name, 'png', 3.0);
                          recordAndDownload(res.blob, res.downloadName, res.blob.type || 'image/png');
                        })
                      }
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    >
                      Export Full HD PNG (216 DPI)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('PDF → Full HD JPG', async () => {
                          const res = await convertPdfToOutputs(fileBytes, file.name, 'jpg', 3.0);
                          recordAndDownload(res.blob, res.downloadName, res.blob.type || 'image/jpeg');
                        })
                      }
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    >
                      Export Full HD JPG
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateToTool('pdf-convert', { files: [file] })}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    >
                      More Image &amp; 4K Options
                    </button>
                  </>
                )}

                {(SHEET_EXTS.has(detectedExt) || detectedExt === 'csv' || detectedExt === 'tsv' || detectedExt === 'json') && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('Table → PDF', async () => {
                          const pdfBytes = await renderTableToPdf(activeRows, {
                            title: pdfTitle,
                            orientation: pdfOrient === 'auto' ? undefined : pdfOrient,
                            renderMode: pdfRenderMode,
                          });
                          recordAndDownloadBytes(pdfBytes, `${safeBase(file.name)}.pdf`, 'application/pdf');
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
                    >
                      <Download className="h-3.5 w-3.5" /> Export Beautified PDF
                    </button>
                    {wbPreview && wbPreview.sheetNames.length > 1 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          runAction('All Sheets → Combined PDF', async () => {
                            const pdfBytes = await exportWorkbookAllSheetsToPdf(wbPreview, {
                              title: pdfTitle,
                              orientation: pdfOrient === 'auto' ? undefined : pdfOrient,
                              renderMode: pdfRenderMode,
                            });
                            recordAndDownloadBytes(pdfBytes, `${safeBase(file.name)}_all_sheets.pdf`, 'application/pdf');
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                      >
                        <Download className="h-3.5 w-3.5" /> All {wbPreview.sheetNames.length} Sheets → PDF
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadText(rowsToCsvString(activeRows), `${safeBase(file.name)}.csv`, 'text/csv')}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const xlsxBytes = rowsToXlsxBytes(activeRows, activeSheet || 'Sheet1');
                        recordAndDownloadBytes(
                          xlsxBytes,
                          `${safeBase(file.name)}.xlsx`,
                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        );
                      }}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                    >
                      Export Excel (.xlsx)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('Table → DOCX', async () => {
                          const docxBytes = await buildDocxFromBlocks([{ type: 'table', rows: activeRows }], {
                            title: pdfTitle,
                          });
                          recordAndDownloadBytes(
                            docxBytes,
                            `${safeBase(file.name)}.docx`,
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                          );
                        })
                      }
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                    >
                      Export Word Table (.docx)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadText(
                          rowsToBeautifiedHtml(activeRows, pdfTitle),
                          `${safeBase(file.name)}.html`,
                          'text/html'
                        )
                      }
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                    >
                      Export Styled HTML
                    </button>
                  </>
                )}

                {(detectedExt === 'md' || detectedExt === 'txt' || detectedExt === 'html' || detectedExt === 'htm') && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('Document → PDF', async () => {
                          const pdfBytes =
                            docSourceMode === 'html'
                              ? await convertHtmlToExactPdf(docSource, {
                                  title: docTitle,
                                  renderMode: pdfRenderMode,
                                })
                              : await renderBlocksToPdf(parseMarkdownToBlocks(docSource), {
                                  title: docTitle,
                                  renderMode: pdfRenderMode,
                                });
                          recordAndDownloadBytes(pdfBytes, `${safeBase(file.name)}.pdf`, 'application/pdf');
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
                    >
                      <Download className="h-3.5 w-3.5" /> Export Exact PDF
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction('Document → DOCX', async () => {
                          const blocks =
                            docSourceMode === 'html'
                              ? parseHtmlToBlocks(docSource)
                              : parseMarkdownToBlocks(docSource);
                          const docxBytes = await buildDocxFromBlocks(blocks, { title: docTitle });
                          recordAndDownloadBytes(
                            docxBytes,
                            `${safeBase(file.name)}.docx`,
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                          );
                        })
                      }
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                    >
                      Export Word (.docx)
                    </button>
                  </>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ==================== DOC / DOCX / RTF / ODT -> PDF / HTML / TXT ==================== */}
      {tab === 'docx-pdf' && (
        <div className="space-y-5">
          <FileDropzone
            multiple
            accept=".doc,.docx,.rtf,.odt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/vnd.oasis.opendocument.text"
            onFiles={handleDropFiles}
            label={
              file && WORD_EXTS.has(detectedExt)
                ? `Loaded: ${file.name} (${docFormatLabel || detectedExt.toUpperCase()})`
                : 'Drop 1 or more Word (.docx / .doc), Rich Text (.rtf), or OpenDocument (.odt) files'
            }
            hint="Supports headings, paragraphs, bullet lists, tables, embedded images & full Bangla/Unicode scripts — drop multiple files for Bulk Queue"
          />

          {file && fileBytes && WORD_EXTS.has(detectedExt) && (
            <div className="grid gap-5 lg:grid-cols-12">
              <Panel title="Export Options" className="lg:col-span-4">
                <div className="space-y-3 text-xs">
                  <label className="block">
                    <span className="font-semibold text-[var(--ink-2)]">PDF Document Title</span>
                    <input
                      value={pdfTitle}
                      onChange={(e) => setPdfTitle(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction('Document → PDF', async () => {
                        const { pdfBytes } = await convertDocxToPdf(fileBytes, pdfTitle || safeBase(file.name), {
                          filename: file.name,
                          renderMode: pdfRenderMode,
                        });
                        recordAndDownloadBytes(pdfBytes, `${safeBase(file.name)}.pdf`, 'application/pdf');
                      })
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" /> {busy ? 'Rendering PDF...' : 'Convert & Download PDF'}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => downloadText(docxHtml || docxPlain, `${safeBase(file.name)}.html`, 'text/html')}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-semibold hover:bg-[var(--surface-2)]"
                    >
                      Download HTML
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText(docxPlain, `${safeBase(file.name)}.txt`, 'text/plain')}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-semibold hover:bg-[var(--surface-2)]"
                    >
                      Download TXT
                    </button>
                  </div>
                </div>
              </Panel>
              <Panel
                title={detectedExt === 'docx' ? 'Exact Word Layout Preview (Matches Exported PDF)' : 'Formatted Document Preview'}
                className="lg:col-span-8"
              >
                {detectedExt === 'docx' ? (
                  <ExactDocxLivePreview bytes={fileBytes} />
                ) : docxHtml ? (
                  <div
                    className="prose prose-sm max-h-[460px] overflow-y-auto rounded-xl border border-[var(--line)] bg-white p-6 text-slate-800 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_p]:mb-2.5 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_img]:max-w-full [&_img]:rounded-lg [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-100 [&_th]:p-2"
                    dangerouslySetInnerHTML={{ __html: docxHtml }}
                  />
                ) : (
                  <pre className="max-h-[460px] overflow-y-auto rounded-xl border border-[var(--line)] bg-white p-5 font-sans text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                    {docxPlain || '(Document loaded — click "Convert & Download PDF" to generate PDF.)'}
                  </pre>
                )}
              </Panel>
            </div>
          )}
        </div>
      )}

      {/* ==================== PDF -> DOCX / XLSX ==================== */}
      {tab === 'pdf-docx' && (
        <div className="space-y-5">
          <FileDropzone
            multiple
            accept=".pdf,application/pdf"
            onFiles={handleDropFiles}
            label={
              file?.name.toLowerCase().endsWith('.pdf')
                ? `Loaded: ${file.name} (${fmtBytes(file.size)})`
                : 'Drop 1 or more PDF files to convert to Word (.docx) or Excel (.xlsx)'
            }
            hint="Extracts page text with line grouping into editable OpenXML Word (.docx) and Excel (.xlsx) files — drop multiple PDFs for Bulk Queue"
          />

          {file && fileBytes && file.name.toLowerCase().endsWith('.pdf') && (
            <Panel title="Convert PDF to Office Formats">
              <div className="mb-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction('PDF → DOCX', async () => {
                      const res = await convertPdfToDocx(fileBytes, safeBase(file.name));
                      setPdfPreviewText(res.previewText);
                      setPdfPageCount(res.pageCount);
                      recordAndDownloadBytes(
                        res.docxBytes,
                        `${safeBase(file.name)}.docx`,
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                      );
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  <Download className="h-4 w-4" /> {busy ? 'Converting...' : 'Convert to Word (.docx)'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction('PDF → XLSX', async () => {
                      const res = await convertPdfToXlsx(fileBytes);
                      setPdfPreviewText(res.csv);
                      recordAndDownloadBytes(
                        res.xlsxBytes,
                        `${safeBase(file.name)}.xlsx`,
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      );
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Extract to Excel (.xlsx)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction('PDF → CSV', async () => {
                      const res = await convertPdfToXlsx(fileBytes);
                      setPdfPreviewText(res.csv);
                      downloadText(res.csv, `${safeBase(file.name)}.csv`, 'text/csv');
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Export Lines as CSV
                </button>
              </div>
              {pdfPreviewText && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--muted)]">
                    <span>Extracted Text Preview {pdfPageCount > 0 ? `(${pdfPageCount} pages)` : ''}</span>
                    <CopyButton text={pdfPreviewText} />
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 font-mono text-xs whitespace-pre-wrap">
                    {pdfPreviewText}
                  </pre>
                </div>
              )}
            </Panel>
          )}
        </div>
      )}

      {/* ==================== XLS / XLSX <-> CSV / JSON / PDF ==================== */}
      {(tab === 'xlsx-csv' || tab === 'csv-pdf' || tab === 'xlsx-pdf') && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-12">
            <Panel title="Input Spreadsheet or CSV" className="lg:col-span-5">
              <FileDropzone
                compact
                multiple
                accept=".xlsx,.xls,.ods,.csv,.tsv"
                onFiles={handleDropFiles}
                label={wbPreview ? `Workbook: ${file?.name}` : 'Drop .xlsx, .xls, .ods, or .csv file(s)'}
                hint="Drop multiple spreadsheets for Bulk Queue, or edit CSV directly below"
              />
              {wbPreview && wbPreview.sheetNames.length > 0 && (
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-[var(--muted)]">
                    Select Worksheet ({wbPreview.sheetNames.length})
                  </label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {wbPreview.sheetNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          setActiveSheet(name);
                          setCsvText(rowsToCsvString(wbPreview.sheets[name] || []));
                        }}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                          activeSheet === name
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                            : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 space-y-2.5 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="font-semibold text-[var(--ink-2)]">Report Title</span>
                    <input
                      value={pdfTitle}
                      onChange={(e) => setPdfTitle(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5"
                    />
                  </label>
                  <label>
                    <span className="font-semibold text-[var(--ink-2)]">PDF Orientation</span>
                    <select
                      value={pdfOrient}
                      onChange={(e) => setPdfOrient(e.target.value as typeof pdfOrient)}
                      className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5"
                    >
                      <option value="auto">Auto (Smart)</option>
                      <option value="portrait">A4 Portrait</option>
                      <option value="landscape">A4 Landscape</option>
                    </select>
                  </label>
                </div>
                <textarea
                  rows={8}
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    setWbPreview(null);
                  }}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-[11px]"
                />
              </div>
            </Panel>

            <Panel
              title="Live Beautified Table Preview & Exports"
              className="lg:col-span-7"
              actions={
                <span className="num text-xs font-medium text-[var(--muted)]">
                  {Math.max(0, activeRows.length - 1)} rows · {activeRows[0]?.length || 0} cols
                </span>
              }
            >
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction('Table → Beautified PDF', async () => {
                      const pdfBytes = await renderTableToPdf(activeRows, {
                        title: pdfTitle,
                        orientation: pdfOrient === 'auto' ? undefined : pdfOrient,
                        renderMode: pdfRenderMode,
                      });
                      recordAndDownloadBytes(pdfBytes, `${safeBase(pdfTitle || 'table')}.pdf`, 'application/pdf');
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--accent-hover)]"
                >
                  <Download className="h-3.5 w-3.5" /> Download PDF Report
                </button>
                {wbPreview && wbPreview.sheetNames.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction('All Sheets → Combined PDF', async () => {
                        const pdfBytes = await exportWorkbookAllSheetsToPdf(wbPreview, {
                          title: pdfTitle,
                          orientation: pdfOrient === 'auto' ? undefined : pdfOrient,
                          renderMode: pdfRenderMode,
                        });
                        recordAndDownloadBytes(
                          pdfBytes,
                          `${safeBase(file?.name || 'workbook')}_all_sheets.pdf`,
                          'application/pdf'
                        );
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    <Download className="h-3.5 w-3.5" /> All Sheets PDF
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => downloadText(rowsToCsvString(activeRows), `${safeBase(pdfTitle || 'sheet')}.csv`, 'text/csv')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const bytes = rowsToXlsxBytes(activeRows, activeSheet || 'Data');
                    recordAndDownloadBytes(
                      bytes,
                      `${safeBase(pdfTitle || 'workbook')}.xlsx`,
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    );
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Export Excel (.xlsx)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction('Table → DOCX', async () => {
                      const bytes = await buildDocxFromBlocks([{ type: 'table', rows: activeRows }], {
                        title: pdfTitle,
                      });
                      recordAndDownloadBytes(
                        bytes,
                        `${safeBase(pdfTitle || 'table')}.docx`,
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                      );
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Export Word (.docx)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      rowsToBeautifiedHtml(activeRows, pdfTitle),
                      `${safeBase(pdfTitle || 'table')}.html`,
                      'text/html'
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Styled HTML
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(rowsToMarkdownTable(activeRows), `${safeBase(pdfTitle || 'table')}.md`, 'text/markdown')
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Markdown Table
                </button>
                {wbPreview && wbPreview.sheetNames.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction('All Sheets → CSV ZIP', async () => {
                        const blob = await exportWorkbookSheetsToCsvZip(wbPreview);
                        recordAndDownload(blob, `${safeBase(file?.name || 'sheets')}_csvs.zip`, 'application/zip');
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <Archive className="h-3.5 w-3.5" /> All Sheets CSV ZIP
                  </button>
                )}
              </div>

              <div className="max-h-[380px] overflow-auto rounded-xl border border-[var(--line)]">
                <table className="w-full border-collapse text-left text-xs">
                  {activeRows[0] && (
                    <thead className="sticky top-0 bg-slate-800 text-white">
                      <tr>
                        {activeRows[0].map((h, i) => (
                          <th key={i} className="px-3 py-2.5 font-semibold whitespace-nowrap">
                            {h || `Col ${i + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody className="divide-y divide-[var(--line)] bg-[var(--surface)]">
                    {activeRows.slice(1, 100).map((row, rIdx) => (
                      <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-[var(--surface-2)]/60' : ''}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-3 py-2 text-[var(--ink-2)] whitespace-nowrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ==================== MARKDOWN / HTML -> DOCX & PDF ==================== */}
      {tab === 'doc-builder' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <Panel
            title="Markdown / HTML Source"
            className="lg:col-span-7"
            actions={
              <div className="flex gap-1">
                {(['markdown', 'html'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDocSourceMode(m)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      docSourceMode === m
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--surface-2)] text-[var(--ink-2)]'
                    }`}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            }
          >
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Document Title"
              className="mb-3 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold"
            />
            <textarea
              rows={14}
              value={docSource}
              onChange={(e) => setDocSource(e.target.value)}
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs leading-relaxed"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction('Document → Beautified PDF', async () => {
                    const blocks =
                      docSourceMode === 'html'
                        ? parseHtmlToBlocks(docSource)
                        : parseMarkdownToBlocks(docSource);
                    const pdfBytes = await renderBlocksToPdf(blocks, {
                      title: docTitle,
                      renderMode: pdfRenderMode,
                    });
                    recordAndDownloadBytes(pdfBytes, `${safeBase(docTitle || 'document')}.pdf`, 'application/pdf');
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white hover:bg-[var(--accent-hover)]"
              >
                <Download className="h-3.5 w-3.5" /> Export Beautified PDF
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction('Document → Word (.docx)', async () => {
                    const blocks =
                      docSourceMode === 'html'
                        ? parseHtmlToBlocks(docSource)
                        : parseMarkdownToBlocks(docSource);
                    const docxBytes = await buildDocxFromBlocks(blocks, { title: docTitle });
                    recordAndDownloadBytes(
                      docxBytes,
                      `${safeBase(docTitle || 'document')}.docx`,
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    );
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Download className="h-3.5 w-3.5" /> Export Word (.docx)
              </button>
            </div>
          </Panel>

          <Panel title="Document Structure Preview" className="lg:col-span-5">
            <div className="space-y-2.5 rounded-xl border border-[var(--line)] bg-white p-5 text-xs text-slate-800 max-h-[440px] overflow-y-auto">
              <div className="border-b border-slate-200 pb-2">
                <div className="font-display text-base font-extrabold text-slate-900">{docTitle || 'Untitled Document'}</div>
                <div className="text-[11px] text-slate-500">A4 Styled Print Layout · Page Numbers Included</div>
              </div>
              {(docSourceMode === 'html' ? parseHtmlToBlocks(docSource) : parseMarkdownToBlocks(docSource)).map(
                (b, idx) => {
                  if (b.type === 'h1') return <h1 key={idx} className="text-base font-bold text-indigo-700">{b.text}</h1>;
                  if (b.type === 'h2') return <h2 key={idx} className="pt-1 text-sm font-bold text-slate-900">{b.text}</h2>;
                  if (b.type === 'h3') return <h3 key={idx} className="text-xs font-bold text-slate-800">{b.text}</h3>;
                  if (b.type === 'hr') return <hr key={idx} className="border-slate-200" />;
                  if (b.type === 'li') return <div key={idx} className="pl-3">• {b.text}</div>;
                  if (b.type === 'code') return <pre key={idx} className="rounded bg-slate-100 p-2 font-mono text-[11px]">{b.text}</pre>;
                  if (b.type === 'table' && b.rows) {
                    return (
                      <table key={idx} className="w-full border-collapse text-[11px]">
                        <tbody>
                          {b.rows.map((r, ri) => (
                            <tr key={ri} className={ri === 0 ? 'bg-indigo-600 text-white font-semibold' : ri % 2 === 0 ? 'bg-slate-50' : ''}>
                              {r.map((c, ci) => (
                                <td key={ci} className="border border-slate-200 px-2 py-1">{c}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  }
                  return <p key={idx} className="leading-relaxed text-slate-700">{b.text}</p>;
                }
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* ==================== MULTI-FORMAT DATA MATRIX ==================== */}
      {tab === 'data-matrix' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Input Format" value={matrixFrom.toUpperCase()} />
            <StatTile label="Output Format" value={matrixTo.toUpperCase()} />
            <StatTile label="Input Size" value={fmtBytes(new Blob([matrixInput]).size)} />
            <StatTile label="Output Size" value={fmtBytes(new Blob([matrixResult.output]).size)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title="Source Data"
              actions={
                <select
                  value={matrixFrom}
                  onChange={(e) => setMatrixFrom(e.target.value as typeof matrixFrom)}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="tsv">TSV</option>
                  <option value="yaml">YAML</option>
                  <option value="xml">XML</option>
                </select>
              }
            >
              <textarea
                rows={13}
                value={matrixInput}
                onChange={(e) => setMatrixInput(e.target.value)}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
              />
            </Panel>

            <Panel
              title="Converted Output"
              actions={
                <div className="flex items-center gap-2">
                  <select
                    value={matrixTo}
                    onChange={(e) => setMatrixTo(e.target.value as typeof matrixTo)}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold"
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                    <option value="tsv">TSV</option>
                    <option value="yaml">YAML</option>
                    <option value="xml">XML</option>
                    <option value="markdown">Markdown Table</option>
                  </select>
                  <CopyButton text={matrixResult.output} />
                </div>
              }
            >
              {matrixResult.err ? (
                <div className="rounded-xl border border-red-200 bg-[var(--danger-soft)] p-3 text-xs font-semibold text-[var(--danger)]">
                  {matrixResult.err}
                </div>
              ) : (
                <textarea
                  rows={13}
                  readOnly
                  value={matrixResult.output}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
                />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!matrixResult.output}
                  onClick={() =>
                    downloadText(
                      matrixResult.output,
                      `converted.${matrixTo === 'markdown' ? 'md' : matrixTo}`
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" /> Download .{matrixTo === 'markdown' ? 'md' : matrixTo}
                </button>
                <button
                  type="button"
                  disabled={busy || Boolean(matrixResult.err)}
                  onClick={() =>
                    runAction('Data → Excel (.xlsx)', async () => {
                      const csv = convertDataFormat(matrixInput, matrixFrom, 'csv');
                      const rows = parseCsvRows(csv);
                      const bytes = rowsToXlsxBytes(rows, 'Data');
                      recordAndDownloadBytes(
                        bytes,
                        'converted_data.xlsx',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      );
                    })
                  }
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Export Excel (.xlsx)
                </button>
                <button
                  type="button"
                  disabled={busy || Boolean(matrixResult.err)}
                  onClick={() =>
                    runAction('Data → PDF Table', async () => {
                      const csv = convertDataFormat(matrixInput, matrixFrom, 'csv');
                      const rows = parseCsvRows(csv);
                      const pdfBytes = await renderTableToPdf(rows, {
                        title: 'Structured Data Report',
                        renderMode: pdfRenderMode,
                      });
                      recordAndDownloadBytes(pdfBytes, 'converted_data.pdf', 'application/pdf');
                    })
                  }
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold hover:bg-[var(--surface-2)]"
                >
                  Export PDF Table
                </button>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
