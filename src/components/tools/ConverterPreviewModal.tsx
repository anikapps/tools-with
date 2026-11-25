import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Play,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CopyButton } from '../ui/SharedUi';
import { fmtBytes } from '../../utils/formatters';
import {
  BulkTargetFormat,
  getSupportedTargetFormats,
  isImageExt,
  PreviewPayload,
  TARGET_FORMAT_LABELS,
} from '../../utils/bulkConverter';

export interface PreviewModalItem {
  id: string;
  name: string;
  ext: string;
  sizeBytes: number;
  targetFormat?: BulkTargetFormat;
  inputPreview?: PreviewPayload;
  inputPreviewLoading?: boolean;
  outputPreview?: PreviewPayload;
  outputFilename?: string;
  outputSizeBytes?: number;
  outputUrl?: string;
}

export function ConverterPreviewModal({
  open,
  item,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onChangeTarget,
  onConvertNow,
  converting = false,
}: {
  open: boolean;
  item: PreviewModalItem | null;
  index?: number;
  total?: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChangeTarget?: (target: BulkTargetFormat) => void;
  onConvertNow?: () => void;
  converting?: boolean;
}) {
  const [viewMode, setViewMode] = useState<'input' | 'output'>('input');
  const [zoomPct, setZoomPct] = useState(100);
  const [pdfPage, setPdfPage] = useState(0);

  useEffect(() => {
    setViewMode('input');
    setZoomPct(100);
    setPdfPage(0);
  }, [item?.id, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, onPrev, onNext]);

  if (!open || !item) return null;

  const hasOutput = Boolean(item.outputPreview && item.outputPreview.kind !== 'empty');
  const activePayload = viewMode === 'output' && hasOutput ? item.outputPreview : item.inputPreview;
  const supportedTargets = getSupportedTargetFormats(item.ext);
  const canZoom = activePayload?.kind === 'image' || activePayload?.kind === 'pdf';

  const renderIcon = () => {
    if (isImageExt(item.ext)) return <ImageIcon className="h-4 w-4 text-violet-600 shrink-0" />;
    if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(item.ext)) {
      return <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />;
    }
    if (['json', 'html', 'htm', 'md', 'markdown'].includes(item.ext)) {
      return <FileCode2 className="h-4 w-4 text-sky-600 shrink-0" />;
    }
    return <FileText className="h-4 w-4 text-[var(--accent)] shrink-0" />;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${item.name}`}
      data-converter-preview-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-[2px] sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {renderIcon()}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-display text-sm font-bold text-[var(--ink)]">{item.name}</h2>
                {total && total > 1 && index !== undefined && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted)]">
                    {index + 1} / {total}
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] tabular-nums text-[var(--muted)]">
                {item.ext.toUpperCase() || 'FILE'} · {fmtBytes(item.sizeBytes)}
                {activePayload?.summaryMeta ? ` · ${activePayload.summaryMeta}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {total && total > 1 && (
              <div className="flex items-center gap-1 border-r border-[var(--line)] pr-2">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!onPrev}
                  aria-label="Previous file"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-35"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!onNext}
                  aria-label="Next file"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-35"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              data-close-preview-modal
              aria-label="Close file preview"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Sub-Toolbar: Input/Output Toggle + Zoom + PDF Pages */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--surface-2)]/55 px-5 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode('input')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === 'input'
                  ? 'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-xs)]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              Input File
            </button>
            {hasOutput && (
              <button
                type="button"
                onClick={() => setViewMode('output')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  viewMode === 'output'
                    ? 'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-xs)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                Converted Output
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activePayload?.kind === 'pdf' && (activePayload.pdfImgs?.length || 0) > 1 && (
              <div className="flex items-center gap-1 border-r border-[var(--line)] pr-2">
                {activePayload.pdfImgs!.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPdfPage(i)}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                      pdfPage === i
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                        : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    P{i + 1}
                  </button>
                ))}
              </div>
            )}

            {canZoom && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoomPct((z) => Math.max(50, z - 25))}
                  aria-label="Zoom out"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[44px] text-center font-mono text-[11px] font-semibold tabular-nums text-[var(--ink)]">
                  {zoomPct}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomPct((z) => Math.min(250, z + 25))}
                  aria-label="Zoom in"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomPct(100)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                >
                  <Maximize2 className="h-3 w-3" /> Fit
                </button>
              </div>
            )}

            {activePayload?.kind === 'text' && activePayload.text && (
              <CopyButton text={activePayload.text} label="Copy text" />
            )}
          </div>
        </div>

        {/* Main Scrollable Preview Viewport */}
        <div className="flex-1 overflow-auto bg-slate-100/80 p-5 dark:bg-slate-900/60">
          {item.inputPreviewLoading && viewMode === 'input' ? (
            <div className="flex min-h-[340px] flex-col items-center justify-center gap-2 text-xs text-[var(--muted)]">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
              <span>Loading document &amp; image preview...</span>
            </div>
          ) : !activePayload || activePayload.kind === 'empty' ? (
            <div className="flex min-h-[340px] flex-col items-center justify-center gap-2 text-center text-xs text-[var(--muted)]">
              <Eye className="h-7 w-7 opacity-60" />
              <div className="font-semibold text-[var(--ink)]">No inline preview available</div>
              <p>You can still convert this file directly using the controls below.</p>
            </div>
          ) : activePayload.kind === 'image' && activePayload.imageUrl ? (
            <div className="flex min-h-[360px] items-center justify-center">
              <div
                className="overflow-hidden rounded-xl border border-slate-300/80 shadow-md"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  backgroundColor: '#ffffff',
                }}
              >
                <img
                  src={activePayload.imageUrl}
                  alt={item.name}
                  data-modal-preview-image
                  style={{ width: zoomPct === 100 ? 'auto' : `${zoomPct}%`, maxWidth: zoomPct === 100 ? '100%' : 'none' }}
                  className="block max-h-[62vh] object-contain"
                />
              </div>
            </div>
          ) : activePayload.kind === 'pdf' && activePayload.pdfImgs?.length ? (
            <div className="flex flex-col items-center">
              <img
                src={activePayload.pdfImgs[Math.min(pdfPage, activePayload.pdfImgs.length - 1)]}
                alt={`Page ${pdfPage + 1}`}
                data-modal-preview-pdf
                style={{ width: `${Math.round(620 * (zoomPct / 100))}px`, maxWidth: zoomPct <= 100 ? '100%' : 'none' }}
                className="block rounded-lg border border-slate-300 bg-white shadow-md"
              />
            </div>
          ) : activePayload.kind === 'html' && activePayload.html ? (
            <div
              data-modal-preview-doc
              className="prose prose-sm mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-7 text-slate-800 shadow-sm [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_p]:mb-2.5 [&_p]:text-sm [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_img]:max-w-full [&_img]:rounded [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-100 [&_th]:p-2"
              dangerouslySetInnerHTML={{ __html: activePayload.html }}
            />
          ) : activePayload.kind === 'table' && activePayload.rows ? (
            <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-left text-xs">
                {activePayload.rows[0] && (
                  <thead className="sticky top-0 bg-slate-800 text-white">
                    <tr>
                      {activePayload.rows[0].map((h, i) => (
                        <th key={i} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                          {h || `Col ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {activePayload.rows.slice(1, 100).map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 1 ? 'bg-slate-50/80' : ''}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="whitespace-nowrap px-3 py-2">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="mx-auto max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white p-5 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap shadow-sm">
              {activePayload.text || '(Empty file)'}
            </pre>
          )}
        </div>

        {/* Modal Footer: Target Selector & Quick Convert / Save */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--surface)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {item.targetFormat && onChangeTarget && (
              <label className="inline-flex items-center gap-1.5">
                <span className="font-semibold text-[var(--muted)]">Convert to:</span>
                <select
                  value={item.targetFormat}
                  onChange={(e) => onChangeTarget(e.target.value as BulkTargetFormat)}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)]"
                >
                  {supportedTargets.map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {TARGET_FORMAT_LABELS[fmt]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="hidden text-[11px] text-[var(--muted)] sm:inline">
              Press Esc to close{total && total > 1 ? ' · ← / → to browse files' : ''}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {item.outputUrl && item.outputFilename && (
              <a
                href={item.outputUrl}
                download={item.outputFilename}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Download className="h-3.5 w-3.5" /> Save Output ({fmtBytes(item.outputSizeBytes || 0)})
              </a>
            )}
            {onConvertNow && (
              <button
                type="button"
                disabled={converting}
                data-modal-convert-now
                onClick={onConvertNow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {converting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Converting...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" /> Convert Now
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
