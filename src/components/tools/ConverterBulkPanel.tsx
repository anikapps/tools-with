import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { CopyButton, FileDropzone } from '../ui/SharedUi';
import { downloadBlob } from '../../utils/download';
import { fmtBytes } from '../../utils/formatters';
import { PdfRenderMode } from '../../utils/converterEngine';
import { computeParamSignature, runWithConcurrency } from '../../utils/pdfOptimizer';
import {
  buildBulkOutputsZip,
  BulkGlobalTarget,
  BulkJobItem,
  BulkStage,
  BulkTargetFormat,
  convertBulkFile,
  getFileExt,
  getStageStepIndex,
  getSupportedTargetFormats,
  inspectSourcePreview,
  isImageExt,
  PreviewPayload,
  resolveBulkTarget,
  summarizeBulkProgress,
  TARGET_FORMAT_LABELS,
} from '../../utils/bulkConverter';
import { ConverterPreviewModal } from './ConverterPreviewModal';

const ACCEPT_ALL =
  '.doc,.docx,.rtf,.odt,.xlsx,.xls,.ods,.csv,.tsv,.pdf,.json,.md,.markdown,.html,.htm,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,image/*';

const PIPELINE_STEPS = [
  { key: 1, label: 'Read' },
  { key: 2, label: 'Parse' },
  { key: 3, label: 'Render' },
  { key: 4, label: 'Ready' },
] as const;

type PreviewTab = 'source' | 'output' | 'split';

function formatStageText(stage: BulkStage): string {
  switch (stage) {
    case 'queued':
      return 'Queued';
    case 'reading':
      return 'Reading';
    case 'parsing':
      return 'Parsing';
    case 'rendering':
      return 'Rendering';
    case 'previewing':
      return 'Previewing';
    case 'done':
      return 'Done';
    case 'error':
      return 'Failed';
  }
}

function FileTypeIcon({ ext }: { ext: string }) {
  const e = ext.toLowerCase();
  if (isImageExt(e)) {
    return <ImageIcon className="h-4 w-4 text-violet-600 shrink-0" />;
  }
  if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(e)) {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />;
  }
  if (['json', 'html', 'htm', 'md', 'markdown'].includes(e)) {
    return <FileCode2 className="h-4 w-4 text-sky-600 shrink-0" />;
  }
  return <FileText className="h-4 w-4 text-[var(--accent)] shrink-0" />;
}

function PreviewRenderer({
  payload,
  loading,
  emptyTitle,
  emptyHint,
  compact = false,
}: {
  payload?: PreviewPayload;
  loading?: boolean;
  emptyTitle: string;
  emptyHint: string;
  compact?: boolean;
}) {
  const [activePdfPage, setActivePdfPage] = useState(0);

  useEffect(() => {
    setActivePdfPage(0);
  }, [payload]);

  if (loading) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 text-xs text-[var(--muted)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
        <span>Preparing preview...</span>
      </div>
    );
  }

  if (!payload || payload.kind === 'empty') {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
        <Eye className="mb-2 h-6 w-6 text-[var(--muted)]/70" />
        <div className="text-xs font-semibold text-[var(--ink)]">{emptyTitle}</div>
        <p className="mt-1 max-w-xs text-[11px] text-[var(--muted)]">{emptyHint}</p>
      </div>
    );
  }

  const maxHClass = compact ? 'max-h-[340px]' : 'max-h-[470px]';

  if (payload.kind === 'image' && payload.imageUrl) {
    return (
      <div className="space-y-2">
        {payload.summaryMeta && (
          <div className="font-mono text-[11px] tabular-nums text-[var(--muted)]">{payload.summaryMeta}</div>
        )}
        <div
          className={`flex ${maxHClass} items-center justify-center overflow-auto rounded-lg border border-[var(--line)] p-4`}
          style={{
            backgroundImage:
              'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
            backgroundSize: '14px 14px',
            backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0px',
            backgroundColor: '#ffffff',
          }}
        >
          <img
            src={payload.imageUrl}
            alt="Image preview"
            className="max-h-[360px] max-w-full rounded border border-slate-200 object-contain shadow-sm"
          />
        </div>
      </div>
    );
  }

  if (payload.kind === 'pdf') {
    const imgs = payload.pdfImgs || [];
    const safeIdx = Math.min(activePdfPage, Math.max(0, imgs.length - 1));
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
          <span className="font-mono tabular-nums">
            {payload.summaryMeta || 'PDF Document'}
            {imgs.length > 0 && payload.pageCount && payload.pageCount > imgs.length
              ? ` · Showing first ${imgs.length} pages`
              : ''}
          </span>
          {imgs.length > 1 && (
            <div className="flex items-center gap-1">
              {imgs.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActivePdfPage(i)}
                  className={`rounded-md border px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                    safeIdx === i
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  P{i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
        {imgs.length > 0 ? (
          <div className={`${maxHClass} overflow-auto rounded-lg border border-[var(--line)] bg-slate-100/90 p-3`}>
            <img
              src={imgs[safeIdx]}
              alt={`Rendered PDF Page ${safeIdx + 1}`}
              data-bulk-pdf-preview-page={safeIdx + 1}
              className="mx-auto block w-full max-w-[560px] rounded border border-slate-200 bg-white shadow-sm"
            />
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-6 text-center text-xs text-[var(--muted)]">
            PDF generated cleanly. Click Save / Download to open the full document.
          </div>
        )}
      </div>
    );
  }

  if (payload.kind === 'html' && payload.html) {
    return (
      <div className="space-y-2">
        {payload.summaryMeta && (
          <div className="font-mono text-[11px] tabular-nums text-[var(--muted)]">{payload.summaryMeta}</div>
        )}
        <div
          className={`prose prose-sm ${maxHClass} overflow-y-auto rounded-lg border border-[var(--line)] bg-white p-5 text-slate-800 [&_h1]:mb-2.5 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-3.5 [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-bold [&_p]:mb-2 [&_p]:text-xs [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_li]:text-xs [&_img]:max-w-full [&_img]:rounded [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:border-slate-200 [&_td]:p-1.5 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-100 [&_th]:p-1.5`}
          dangerouslySetInnerHTML={{ __html: payload.html }}
        />
      </div>
    );
  }

  if (payload.kind === 'table' && payload.rows) {
    const headers = payload.rows[0] || [];
    const body = payload.rows.slice(1, 60);
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
          <span className="font-mono tabular-nums">{payload.summaryMeta}</span>
          {payload.sheetNames && payload.sheetNames.length > 1 && (
            <span className="truncate text-[11px]">Sheets: {payload.sheetNames.join(', ')}</span>
          )}
        </div>
        <div className={`${maxHClass} overflow-auto rounded-lg border border-[var(--line)] bg-white`}>
          <table className="w-full border-collapse text-left text-xs">
            {headers.length > 0 && (
              <thead className="sticky top-0 bg-slate-800 text-white">
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-2.5 py-2 font-semibold">
                      {h || `Col ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {body.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? 'bg-slate-50/80' : ''}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="whitespace-nowrap px-2.5 py-1.5">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tabular-nums text-[var(--muted)]">
          {payload.summaryMeta || 'Text preview'}
        </span>
        {payload.text && <CopyButton text={payload.text} label="Copy text" />}
      </div>
      <pre
        className={`${maxHClass} overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ink)] whitespace-pre-wrap`}
      >
        {payload.text || '(Empty content)'}
      </pre>
    </div>
  );
}

export function ConverterBulkPanel({
  pdfRenderMode,
  incomingFiles,
  incomingNonce,
  onClearIncoming,
}: {
  pdfRenderMode: PdfRenderMode;
  incomingFiles?: File[];
  incomingNonce?: number;
  onClearIncoming?: () => void;
}) {
  const [jobs, setJobs] = useState<BulkJobItem[]>([]);
  const [globalTarget, setGlobalTarget] = useState<BulkGlobalTarget>('auto');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [concurrency, setConcurrency] = useState<number>(2);
  const [selectedId, setSelectedId] = useState<string>('');
  const [modalJobId, setModalJobId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('source');
  const [followActive, setFollowActive] = useState(true);
  const [running, setRunning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [runElapsedMs, setRunElapsedMs] = useState(0);
  const [lastRunSig, setLastRunSig] = useState<string>('');

  const cancelRef = useRef(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const jobsRef = useRef<BulkJobItem[]>([]);
  jobsRef.current = jobs;

  const currentParamSig = useMemo(
    () =>
      computeParamSignature({
        globalTarget,
        orientation,
        pdfRenderMode,
        targets: jobs.map((j) => `${j.id}:${j.targetFormat}`),
      }),
    [globalTarget, orientation, pdfRenderMode, jobs]
  );

  const settingsChangedSinceRun = Boolean(lastRunSig && lastRunSig !== currentParamSig && jobs.some((j) => j.status === 'done'));

  // Revoke object URLs on unmount
  useEffect(() => {
    const urlSet = urlsRef.current;
    return () => {
      urlSet.forEach((u) => URL.revokeObjectURL(u));
      urlSet.clear();
    };
  }, []);

  // Elapsed timer during active bulk conversion
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    setRunElapsedMs(0);
    const id = window.setInterval(() => {
      setRunElapsedMs(Date.now() - start);
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  const enqueueFiles = (files: File[]) => {
    if (!files.length) return;
    const created: BulkJobItem[] = files.map((file, idx) => {
      const ext = getFileExt(file.name);
      return {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        ext,
        sizeBytes: file.size,
        targetFormat: resolveBulkTarget(ext, globalTarget),
        status: 'queued',
        progress: 0,
        stageDetail: 'Waiting in queue',
        inputPreviewLoading: true,
      };
    });

    setJobs((prev) => [...prev, ...created]);
    if (!selectedId && created[0]) {
      setSelectedId(created[0].id);
      setPreviewTab('source');
    }

    // Generate live source previews in parallel
    void runWithConcurrency(created, 3, async (item) => {
      try {
        const inputPreview = await inspectSourcePreview(item.file);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === item.id ? { ...j, inputPreview, inputPreviewLoading: false } : j
          )
        );
      } catch {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === item.id
              ? { ...j, inputPreview: { kind: 'empty' }, inputPreviewLoading: false }
              : j
          )
        );
      }
    });
  };

  // Accept batches forwarded from any Converter Studio dropzone
  useEffect(() => {
    if (incomingFiles && incomingFiles.length > 0) {
      enqueueFiles(incomingFiles);
      onClearIncoming?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingNonce]);

  const summary = useMemo(() => summarizeBulkProgress(jobs), [jobs]);

  const activeJob = useMemo(
    () => jobs.find((j) => !['queued', 'done', 'error'].includes(j.status)) || null,
    [jobs]
  );

  const selectedJob = useMemo(() => {
    const found = jobs.find((j) => j.id === selectedId);
    return found || jobs[0] || null;
  }, [jobs, selectedId]);

  const modalIndex = useMemo(
    () => (modalJobId ? jobs.findIndex((j) => j.id === modalJobId) : -1),
    [jobs, modalJobId]
  );
  const modalJob = modalIndex >= 0 ? jobs[modalIndex] : null;

  const pipelineFocusJob = activeJob || selectedJob;

  // Apply global target across ALL files (including already-done files so changing settings re-arms them!)
  const applyGlobalTarget = (next: BulkGlobalTarget) => {
    setGlobalTarget(next);
    setJobs((prev) =>
      prev.map((j) => {
        const nextFmt = resolveBulkTarget(j.ext, next);
        if (nextFmt === j.targetFormat) return j;
        return {
          ...j,
          targetFormat: nextFmt,
          status: j.status === 'done' || j.status === 'error' ? 'queued' : j.status,
          progress: j.status === 'done' || j.status === 'error' ? 0 : j.progress,
          stageDetail: 'Target changed — click Convert to re-run',
        };
      })
    );
  };

  const updateJobTarget = (id: string, targetFormat: BulkTargetFormat) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j;
        if (j.output?.url) {
          URL.revokeObjectURL(j.output.url);
          urlsRef.current.delete(j.output.url);
        }
        return {
          ...j,
          targetFormat,
          status: 'queued',
          progress: 0,
          stageDetail: 'Target updated — ready to convert',
          output: undefined,
          error: undefined,
          durationMs: undefined,
        };
      })
    );
  };

  const removeJob = (id: string) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.id === id);
      if (target?.output?.url) {
        URL.revokeObjectURL(target.output.url);
        urlsRef.current.delete(target.output.url);
      }
      const next = prev.filter((j) => j.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id || '');
      if (modalJobId === id) setModalJobId(next[0]?.id || null);
      return next;
    });
  };

  const clearQueue = () => {
    if (running) return;
    jobs.forEach((j) => {
      if (j.output?.url) {
        URL.revokeObjectURL(j.output.url);
        urlsRef.current.delete(j.output.url);
      }
    });
    setJobs([]);
    setSelectedId('');
    setModalJobId(null);
    setLastRunSig('');
  };

  const convertOneJob = async (jobSnapshot: BulkJobItem) => {
    if (followActive && concurrency === 1) {
      setSelectedId(jobSnapshot.id);
    }
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobSnapshot.id
          ? { ...j, status: 'reading', progress: 10, stageDetail: 'Starting conversion...', error: undefined }
          : j
      )
    );

    try {
      const res = await convertBulkFile(
        jobSnapshot.file,
        jobSnapshot.targetFormat,
        { renderMode: pdfRenderMode, orientation },
        (stage, progress, detail) => {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobSnapshot.id ? { ...j, status: stage, progress, stageDetail: detail } : j
            )
          );
        }
      );

      const url = URL.createObjectURL(res.blob);
      urlsRef.current.add(url);

      setJobs((prev) =>
        prev.map((j) => {
          if (j.id !== jobSnapshot.id) return j;
          if (j.output?.url) {
            URL.revokeObjectURL(j.output.url);
            urlsRef.current.delete(j.output.url);
          }
          return {
            ...j,
            status: 'done',
            progress: 100,
            stageDetail: `Completed in ${res.durationMs} ms`,
            durationMs: res.durationMs,
            warnings: res.warnings,
            output: {
              filename: res.filename,
              mime: res.mime,
              sizeBytes: res.sizeBytes,
              blob: res.blob,
              url,
              preview: res.preview,
            },
          };
        })
      );
      if (followActive) {
        setSelectedId((cur) => cur || jobSnapshot.id);
        setPreviewTab('output');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Conversion failed';
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobSnapshot.id
            ? { ...j, status: 'error', progress: 100, stageDetail: msg, error: msg }
            : j
        )
      );
    }
  };

  const runBulkConversion = async (forceAll = false) => {
    if (running || !jobs.length) return;
    cancelRef.current = false;
    setRunning(true);

    const mustReconvertAll =
      forceAll ||
      settingsChangedSinceRun ||
      jobsRef.current.every((j) => j.status === 'done');

    const targets = mustReconvertAll
      ? [...jobsRef.current]
      : jobsRef.current.filter((j) => j.status === 'queued' || j.status === 'error');

    if (mustReconvertAll) {
      setJobs((prev) =>
        prev.map((j) => ({
          ...j,
          status: 'queued',
          progress: 0,
          stageDetail: 'Queued with updated settings',
          error: undefined,
        }))
      );
    }

    await runWithConcurrency(
      targets,
      concurrency,
      async (item) => {
        const latest = jobsRef.current.find((j) => j.id === item.id);
        if (!latest) return;
        await convertOneJob(latest);
      },
      { isCancelled: () => cancelRef.current }
    );

    if (!cancelRef.current) {
      setLastRunSig(currentParamSig);
    }
    setRunning(false);
  };

  const handleDownloadZip = async () => {
    const doneCount = jobs.filter((j) => j.status === 'done' && j.output).length;
    if (!doneCount) return;
    setZipping(true);
    try {
      const zipBlob = await buildBulkOutputsZip(jobs);
      downloadBlob(zipBlob, `converted_files_${doneCount}.zip`);
    } finally {
      setZipping(false);
    }
  };

  const doneSegmentPct = summary.total > 0 ? (summary.done / summary.total) * 100 : 0;
  const failedSegmentPct = summary.total > 0 ? (summary.failed / summary.total) * 100 : 0;
  const activeSegmentPct = Math.max(0, summary.overallPct - doneSegmentPct - failedSegmentPct);
  const pendingCount = summary.queued + summary.failed;

  return (
    <div className="space-y-5">
      <input
        ref={addInputRef}
        type="file"
        accept={ACCEPT_ALL}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) enqueueFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {/* Full-screen Input Document & Image Preview Modal */}
      <ConverterPreviewModal
        open={Boolean(modalJob)}
        item={
          modalJob
            ? {
                id: modalJob.id,
                name: modalJob.name,
                ext: modalJob.ext,
                sizeBytes: modalJob.sizeBytes,
                targetFormat: modalJob.targetFormat,
                inputPreview: modalJob.inputPreview,
                inputPreviewLoading: modalJob.inputPreviewLoading,
                outputPreview: modalJob.output?.preview,
                outputFilename: modalJob.output?.filename,
                outputSizeBytes: modalJob.output?.sizeBytes,
                outputUrl: modalJob.output?.url,
              }
            : null
        }
        index={modalIndex}
        total={jobs.length}
        onClose={() => setModalJobId(null)}
        onPrev={
          modalIndex > 0 ? () => setModalJobId(jobs[modalIndex - 1].id) : undefined
        }
        onNext={
          modalIndex >= 0 && modalIndex < jobs.length - 1
            ? () => setModalJobId(jobs[modalIndex + 1].id)
            : undefined
        }
        onChangeTarget={
          modalJob && !running
            ? (fmt) => updateJobTarget(modalJob.id, fmt)
            : undefined
        }
        converting={running}
        onConvertNow={
          modalJob && !running
            ? async () => {
                setRunning(true);
                await convertOneJob(modalJob);
                setRunning(false);
              }
            : undefined
        }
      />

      {jobs.length === 0 ? (
        <div className="space-y-4">
          <FileDropzone
            multiple
            accept={ACCEPT_ALL}
            onFiles={enqueueFiles}
            label="Drop documents or images for bulk conversion & instant modal preview"
            hint="Supports Word (.docx/.doc/.rtf/.odt), Excel (.xlsx/.xls), CSV, PDF, Images (PNG/JPG/WebP/SVG), Markdown, HTML & JSON — zero branding on outputs"
          />
          <div className="grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-3 text-xs">
            <div className="space-y-1">
              <div className="font-semibold text-[var(--ink)]">1. Quick Input Preview Modal</div>
              <p className="text-[var(--muted)] leading-relaxed">
                Inspect documents, spreadsheets, PDF pages, and zoomable images in a modal before starting conversion.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-semibold text-[var(--ink)]">2. Parallel High-Speed Pipeline</div>
              <p className="text-[var(--muted)] leading-relaxed">
                Convert multiple files concurrently with live stage progress (Read, Parse, Render, Ready) and instant re-runs on setting changes.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-semibold text-[var(--ink)]">3. Clean Unbranded Outputs</div>
              <p className="text-[var(--muted)] leading-relaxed">
                Compare source and output side-by-side and download files individually or bundled in one ZIP archive.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ==================== REAL-TIME PROGRESS VISUALIZATION HEADER ==================== */}
          <div
            data-bulk-progress-panel
            className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-xs)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-[var(--accent)]" />
                  <span className="font-display text-sm font-bold text-[var(--ink)]">
                    Bulk Conversion Queue
                  </span>
                </div>
                <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                  {summary.total} file{summary.total === 1 ? '' : 's'} · {fmtBytes(summary.totalInputBytes)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs">
                  <span className="font-medium text-[var(--muted)]">Target:</span>
                  <select
                    value={globalTarget}
                    disabled={running}
                    onChange={(e) => applyGlobalTarget(e.target.value as BulkGlobalTarget)}
                    aria-label="Bulk Target Format"
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)]"
                  >
                    <option value="auto">Auto Best Target</option>
                    <option value="pdf">All → PDF (.pdf)</option>
                    <option value="docx">All → Word (.docx)</option>
                    <option value="xlsx">All → Excel (.xlsx)</option>
                    <option value="csv">All → CSV (.csv)</option>
                    <option value="png">Images → PNG (.png)</option>
                    <option value="webp">Images → WebP (.webp)</option>
                    <option value="jpg">Images → JPG (.jpg)</option>
                    <option value="html">All → HTML (.html)</option>
                    <option value="json">All → JSON (.json)</option>
                    <option value="txt">All → Plain Text (.txt)</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-1.5 text-xs">
                  <span className="font-medium text-[var(--muted)]">Page:</span>
                  <select
                    value={orientation}
                    disabled={running}
                    onChange={(e) => setOrientation(e.target.value as typeof orientation)}
                    aria-label="Bulk PDF Page Orientation"
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs font-semibold text-[var(--ink)]"
                  >
                    <option value="auto">Auto</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-1 text-xs" title="Parallel files converted at once">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <select
                    value={concurrency}
                    disabled={running}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    aria-label="Conversion Parallel Speed"
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs font-semibold text-[var(--ink)]"
                  >
                    <option value={1}>1× Safe</option>
                    <option value={2}>2× Fast</option>
                    <option value={3}>3× Turbo</option>
                  </select>
                </label>

                <button
                  type="button"
                  disabled={running}
                  onClick={() => addInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Files
                </button>

                {!running ? (
                  <>
                    <button
                      type="button"
                      data-bulk-convert-btn
                      onClick={() => runBulkConversion(settingsChangedSinceRun || pendingCount === 0)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)] whitespace-nowrap"
                    >
                      {settingsChangedSinceRun ? (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" /> Re-convert All ({summary.total}) · Updated
                        </>
                      ) : pendingCount === 0 ? (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" /> Re-convert All ({summary.total})
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" /> Convert All ({pendingCount})
                        </>
                      )}
                    </button>
                    {summary.done > 0 && (
                      <button
                        type="button"
                        data-bulk-zip-btn
                        disabled={zipping}
                        onClick={handleDownloadZip}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        {zipping ? 'Packing ZIP...' : `Download ZIP (${summary.done})`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearQueue}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)] whitespace-nowrap"
                      title="Clear queue"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Clear
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      cancelRef.current = true;
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 whitespace-nowrap"
                  >
                    <Square className="h-3.5 w-3.5" /> Stop Run
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span
                    data-bulk-overall-pct
                    className="font-mono text-2xl font-bold tracking-tight tabular-nums text-[var(--ink)]"
                  >
                    {summary.overallPct}%
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      <span className="font-mono tabular-nums font-bold">{summary.done}</span> Completed
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[var(--accent)]">
                      <span className="font-mono tabular-nums font-bold">{summary.active}</span> Active
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <span className="font-mono tabular-nums font-semibold text-[var(--ink-2)]">
                        {summary.queued}
                      </span>{' '}
                      Queued
                    </span>
                    {summary.failed > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-red-600">
                          <span className="font-mono tabular-nums font-bold">{summary.failed}</span> Failed
                        </span>
                      </>
                    )}
                    {settingsChangedSinceRun && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-amber-600">Settings updated — ready to re-run</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-[var(--muted)]">
                  {summary.totalOutputBytes > 0 && (
                    <span>
                      Output: <strong className="text-[var(--ink)]">{fmtBytes(summary.totalOutputBytes)}</strong>
                    </span>
                  )}
                  {(running || runElapsedMs > 0) && (
                    <span>
                      Elapsed: <strong className="text-[var(--ink)]">{(runElapsedMs / 1000).toFixed(1)}s</strong>
                    </span>
                  )}
                </div>
              </div>

              <div
                role="progressbar"
                aria-label="Overall bulk conversion progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={summary.overallPct}
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
              >
                <div
                  className="h-full bg-emerald-600 transition-all duration-200"
                  style={{ width: `${doneSegmentPct}%` }}
                />
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-150"
                  style={{ width: `${activeSegmentPct}%` }}
                />
                <div
                  className="h-full bg-red-500 transition-all duration-200"
                  style={{ width: `${failedSegmentPct}%` }}
                />
              </div>

              {pipelineFocusJob && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {activeJob ? 'Processing' : 'Selected'}:
                    </span>
                    <span className="truncate font-semibold text-[var(--ink)] max-w-[220px] sm:max-w-[300px]">
                      {pipelineFocusJob.name}
                    </span>
                    <span className="text-[var(--muted)] truncate hidden sm:inline">
                      — {pipelineFocusJob.stageDetail}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {PIPELINE_STEPS.map((step, idx) => {
                      const currentStep = getStageStepIndex(pipelineFocusJob.status);
                      const isDone = currentStep >= step.key;
                      const isCurrent =
                        pipelineFocusJob.status !== 'done' &&
                        pipelineFocusJob.status !== 'error' &&
                        currentStep === step.key;
                      const isError = pipelineFocusJob.status === 'error' && idx === 2;
                      return (
                        <React.Fragment key={step.key}>
                          <div
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                              isError
                                ? 'text-red-600'
                                : isDone
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : isCurrent
                                    ? 'text-[var(--accent)]'
                                    : 'text-[var(--muted)]'
                            }`}
                          >
                            {isDone ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : isCurrent ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <span className="font-mono tabular-nums">{step.key}.</span>
                            )}
                            <span>{step.label}</span>
                          </div>
                          {idx < PIPELINE_STEPS.length - 1 && (
                            <span className="text-[var(--line-strong)]" aria-hidden="true">
                              /
                            </span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ==================== SPLIT WORKSPACE: QUEUE (5) + FILE PREVIEW (7) ==================== */}
          <div className="grid gap-5 lg:grid-cols-12 items-stretch">
            <div className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-xs)] lg:col-span-5">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                <h2 className="font-display text-sm font-bold text-[var(--ink)]">
                  Files in Queue ({jobs.length})
                </h2>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={followActive}
                    onChange={(e) => setFollowActive(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[var(--line-strong)] accent-[var(--accent)]"
                  />
                  Follow active
                </label>
              </div>

              <div className="max-h-[560px] divide-y divide-[var(--line)] overflow-y-auto">
                {jobs.map((job) => {
                  const isSelected = selectedJob?.id === job.id;
                  const supportedTargets = getSupportedTargetFormats(job.ext);
                  const isProcessing = !['queued', 'done', 'error'].includes(job.status);

                  return (
                    <div
                      key={job.id}
                      data-bulk-job-row={job.name}
                      onClick={() => {
                        setSelectedId(job.id);
                        if (job.status === 'done' && job.output) {
                          setPreviewTab('output');
                        } else {
                          setPreviewTab('source');
                        }
                      }}
                      className={`cursor-pointer px-4 py-3 transition-colors ${
                        isSelected
                          ? 'bg-[var(--accent-soft)]/55'
                          : 'hover:bg-[var(--surface-2)]/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileTypeIcon ext={job.ext} />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-[var(--ink)]" title={job.name}>
                              {job.name}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums text-[var(--muted)]">
                              <span>{fmtBytes(job.sizeBytes)}</span>
                              {job.output && (
                                <>
                                  <ArrowRight className="h-3 w-3" />
                                  <span className="text-[var(--ink)] font-semibold">
                                    {fmtBytes(job.output.sizeBytes)}
                                  </span>
                                </>
                              )}
                              {job.durationMs !== undefined && (
                                <>
                                  <span>·</span>
                                  <span>{job.durationMs} ms</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div
                          className="flex shrink-0 items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            data-quick-preview-btn={job.name}
                            onClick={() => setModalJobId(job.id)}
                            title="Quick Preview in Modal"
                            aria-label={`Quick preview ${job.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <select
                            value={job.targetFormat}
                            disabled={running}
                            aria-label={`Target format for ${job.name}`}
                            onChange={(e) => updateJobTarget(job.id, e.target.value as BulkTargetFormat)}
                            className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 py-1 font-mono text-[11px] font-semibold uppercase text-[var(--ink)]"
                          >
                            {supportedTargets.map((fmt) => (
                              <option key={fmt} value={fmt}>
                                → {fmt.toUpperCase()}
                              </option>
                            ))}
                          </select>

                          {job.status === 'done' && job.output && (
                            <a
                              href={job.output.url}
                              download={job.output.filename}
                              title={`Download ${job.output.filename}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          )}

                          {!running && (
                            <button
                              type="button"
                              onClick={() => removeJob(job.id)}
                              title="Remove from queue"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-red-600"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 flex items-center gap-2.5">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                          <div
                            className={`h-full transition-all duration-150 ${
                              job.status === 'done'
                                ? 'bg-emerald-600'
                                : job.status === 'error'
                                  ? 'bg-red-500'
                                  : isProcessing
                                    ? 'bg-[var(--accent)]'
                                    : 'bg-slate-300'
                            }`}
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                        <div
                          className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${
                            job.status === 'done'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : job.status === 'error'
                                ? 'text-red-600'
                                : isProcessing
                                  ? 'text-[var(--accent)]'
                                  : 'text-[var(--muted)]'
                          }`}
                        >
                          {job.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {job.status === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
                          {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {job.status === 'queued' && <Clock className="h-3 w-3" />}
                          <span className="font-mono tabular-nums">
                            {formatStageText(job.status)}
                            {isProcessing ? ` ${job.progress}%` : ''}
                          </span>
                        </div>
                      </div>
                      {job.error && (
                        <div className="mt-1.5 text-[11px] font-medium text-red-600">{job.error}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              data-bulk-preview-panel
              className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-xs)] lg:col-span-7"
            >
              {selectedJob ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <h2 className="truncate font-display text-sm font-bold text-[var(--ink)]">
                          {selectedJob.name}
                        </h2>
                        <span className="shrink-0 font-mono text-[11px] font-semibold uppercase text-[var(--muted)]">
                          {selectedJob.ext || 'file'} → {selectedJob.targetFormat}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--muted)]">
                        Input {fmtBytes(selectedJob.sizeBytes)}
                        {selectedJob.output
                          ? ` · Output ${selectedJob.output.filename} (${fmtBytes(selectedJob.output.sizeBytes)})`
                          : ` · Target: ${TARGET_FORMAT_LABELS[selectedJob.targetFormat]}`}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setModalJobId(selectedJob.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)] whitespace-nowrap"
                      >
                        <Maximize2 className="h-3.5 w-3.5" /> Quick Preview Modal
                      </button>

                      {selectedJob.status === 'done' && selectedJob.output ? (
                        <a
                          href={selectedJob.output.url}
                          download={selectedJob.output.filename}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5" /> Save {selectedJob.targetFormat.toUpperCase()}
                        </a>
                      ) : (
                        <button
                          type="button"
                          disabled={running}
                          onClick={async () => {
                            setRunning(true);
                            await convertOneJob(selectedJob);
                            setRunning(false);
                            setPreviewTab('output');
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 whitespace-nowrap"
                        >
                          <Play className="h-3.5 w-3.5" /> Convert File
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--surface-2)]/50 px-5 py-2">
                    <div className="flex items-center gap-1">
                      {(
                        [
                          ['source', 'Source Preview'],
                          ['output', 'Converted Output'],
                          ['split', 'Side-by-Side'],
                        ] as [PreviewTab, string][]
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          data-preview-mode-tab={mode}
                          onClick={() => setPreviewTab(mode)}
                          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                            previewTab === mode
                              ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-xs)] border border-[var(--line)]'
                              : 'text-[var(--muted)] hover:text-[var(--ink)]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <span className="font-mono text-[11px] tabular-nums text-[var(--muted)]">
                      {formatStageText(selectedJob.status)}
                      {selectedJob.durationMs !== undefined ? ` · ${selectedJob.durationMs} ms` : ''}
                    </span>
                  </div>

                  <div className="flex-1 p-5">
                    {previewTab === 'source' && (
                      <PreviewRenderer
                        payload={selectedJob.inputPreview}
                        loading={selectedJob.inputPreviewLoading}
                        emptyTitle="No source preview available"
                        emptyHint="Click Convert File to process this document into your chosen output format."
                      />
                    )}

                    {previewTab === 'output' && (
                      <>
                        {selectedJob.status === 'done' && selectedJob.output ? (
                          <PreviewRenderer
                            payload={selectedJob.output.preview}
                            emptyTitle="Output ready to download"
                            emptyHint="Use the Save button above to download this converted file."
                          />
                        ) : !['queued', 'error'].includes(selectedJob.status) ? (
                          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
                            <Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" />
                            <div className="text-sm font-bold text-[var(--ink)]">
                              {formatStageText(selectedJob.status)} ({selectedJob.progress}%)
                            </div>
                            <p className="text-xs text-[var(--muted)]">{selectedJob.stageDetail}</p>
                            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-[var(--surface-2)]">
                              <div
                                className="h-full bg-[var(--accent)] transition-all duration-150"
                                style={{ width: `${selectedJob.progress}%` }}
                              />
                            </div>
                          </div>
                        ) : selectedJob.status === 'error' ? (
                          <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 px-6 text-center">
                            <AlertCircle className="h-6 w-6 text-red-600" />
                            <div className="text-xs font-bold text-red-700">Conversion Failed</div>
                            <p className="max-w-sm text-xs text-[var(--muted)]">{selectedJob.error}</p>
                          </div>
                        ) : (
                          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2.5 px-6 text-center">
                            <Eye className="h-6 w-6 text-[var(--muted)]/70" />
                            <div className="text-xs font-semibold text-[var(--ink)]">
                              Ready to convert to {TARGET_FORMAT_LABELS[selectedJob.targetFormat]}
                            </div>
                            <p className="max-w-sm text-[11px] text-[var(--muted)]">
                              Run Convert All or Convert File to generate a clean, unbranded{' '}
                              {selectedJob.targetFormat.toUpperCase()} file and inspect the rendered output here.
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {previewTab === 'split' && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                            Source ({selectedJob.ext.toUpperCase()})
                          </div>
                          <PreviewRenderer
                            compact
                            payload={selectedJob.inputPreview}
                            loading={selectedJob.inputPreviewLoading}
                            emptyTitle="No source preview"
                            emptyHint="Source file queued."
                          />
                        </div>
                        <div className="space-y-2 border-t border-[var(--line)] pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                            Output ({selectedJob.targetFormat.toUpperCase()})
                          </div>
                          {selectedJob.status === 'done' && selectedJob.output ? (
                            <PreviewRenderer
                              compact
                              payload={selectedJob.output.preview}
                              emptyTitle="Output ready"
                              emptyHint="Click Save to download."
                            />
                          ) : (
                            <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--muted)]">
                              {selectedJob.status === 'error'
                                ? selectedJob.error
                                : 'Convert this file to compare output side-by-side.'}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex min-h-[320px] items-center justify-center text-xs text-[var(--muted)]">
                  Select a file from the queue to inspect its source and converted output.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
