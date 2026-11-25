import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CopyPlus,
  Download,
  Eye,
  FilePlus2,
  FileText,
  GripVertical,
  Grid2x2,
  Layers,
  List,
  RotateCcw,
  RotateCw,
  Shuffle,
  Trash2,
  Undo2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { assemblePdfFromPages, openPdfJs, renderPdfPageToCanvas } from '../../utils/pdfEngine';
import { readFileAsBytes } from '../../utils/download';
import { fmtBytes, safeBase } from '../../utils/formatters';
import { interleavePagesBySource, reorderBySourceOrder, reorderList } from '../../utils/pdfMergeUtils';
import { FileDropzone, Panel } from '../ui/SharedUi';

interface SourceDoc {
  id: string;
  sourceIndex: number;
  name: string;
  sizeBytes: number;
  pageCount: number;
  bytes: Uint8Array;
}

interface PageItem {
  uid: string;
  sourceIndex: number; // -1 = blank page
  pageNumber?: number; // 1-indexed
  rotation: number;
  label: string;
  fileName: string;
}

interface PdfMergeStudioProps {
  mode: 'merge' | 'organize';
  incomingFiles?: File[];
  onBuilt: (result: { bytes: Uint8Array; name: string; note: string }) => void;
  onStatus?: (msg: string) => void;
}

/** Lazy viewport-prioritized single-page thumbnail card */
const LazyPageThumb = React.memo(function LazyPageThumb({
  item,
  index,
  thumbUrl,
  isDragging,
  isDragOver,
  onRequestThumb,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveEarlier,
  onMoveLater,
  onRotate,
  onDuplicate,
  onDelete,
  onPreview,
  totalCount,
}: {
  item: PageItem;
  index: number;
  thumbUrl?: string;
  isDragging: boolean;
  isDragOver: boolean;
  onRequestThumb: (item: PageItem) => void;
  onDragStart: (index: number, e: React.DragEvent) => void;
  onDragOver: (index: number, e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (index: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveEarlier: (index: number) => void;
  onMoveLater: (index: number) => void;
  onRotate: (index: number, delta: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onPreview: (item: PageItem) => void;
  totalCount: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (thumbUrl || item.sourceIndex < 0) return;
    const el = cardRef.current;
    if (!el) return;

    // Immediately trigger for the first 12 cards for zero-wait visual paint
    if (index < 12) {
      onRequestThumb(item);
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      onRequestThumb(item);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onRequestThumb(item);
          observer.disconnect();
        }
      },
      { rootMargin: '280px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [thumbUrl, item, index, onRequestThumb]);

  return (
    <div
      ref={cardRef}
      draggable
      data-merge-page-card
      data-page-uid={item.uid}
      data-page-label={item.label}
      onDragStart={(e) => onDragStart(index, e)}
      onDragOver={(e) => onDragOver(index, e)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(index, e)}
      onDragEnd={onDragEnd}
      className={`group relative flex select-none flex-col rounded-xl border bg-[var(--surface)] p-2.5 transition-all duration-150 cursor-grab active:cursor-grabbing ${
        isDragging
          ? 'scale-[0.97] border-[var(--accent)] opacity-45 shadow-none'
          : isDragOver
            ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/35 bg-[var(--accent-soft)]/40 -translate-y-0.5'
            : 'border-[var(--line)] hover:border-[var(--accent)]/55 hover:shadow-[var(--shadow-sm)]'
      }`}
    >
      {/* Top Drag Header */}
      <div className="mb-2 flex items-center justify-between gap-1 text-[11px] font-semibold">
        <span className="inline-flex items-center gap-1 text-[var(--ink-2)]">
          <GripVertical className="h-3.5 w-3.5 text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors" />
          <span className="num font-mono">Page {index + 1}</span>
        </span>
        <div className="flex items-center gap-1">
          {item.rotation !== 0 && (
            <span className="font-mono text-[10px] text-[var(--accent-ink)]">{item.rotation}°</span>
          )}
          {item.sourceIndex >= 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(item);
              }}
              aria-label={`Zoom preview ${item.label}`}
              title="Inspect page"
              className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Crisp Page Preview Surface */}
      <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-lg border border-[var(--line)]/70 bg-[var(--surface-2)]/70">
        {item.sourceIndex < 0 ? (
          <div className="flex flex-col items-center gap-1 text-[var(--muted)]">
            <FileText className="h-6 w-6 opacity-50" />
            <span className="text-[11px] font-medium">Blank A4</span>
          </div>
        ) : thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.label}
            draggable={false}
            style={{ transform: `rotate(${item.rotation}deg)` }}
            className="max-h-full max-w-full object-contain shadow-xs transition-transform duration-150 pointer-events-none"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3">
            <div className="h-24 w-16 animate-pulse rounded border border-[var(--line)] bg-[var(--surface)]" />
            <span className="font-mono text-[10px] text-[var(--muted)]">p{item.pageNumber}</span>
          </div>
        )}
      </div>

      {/* File Origin */}
      <div className="mt-2 truncate text-[11px] font-medium text-[var(--ink-2)]" title={item.label}>
        {item.label}
      </div>

      {/* Quick Actions */}
      <div className="mt-2 grid grid-cols-5 gap-1">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMoveEarlier(index)}
          aria-label={`Move ${item.label} earlier`}
          title="Move earlier"
          className="flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 text-[var(--ink-2)] hover:border-[var(--accent)]/60 hover:text-[var(--accent)] disabled:opacity-30"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          disabled={index === totalCount - 1}
          onClick={() => onMoveLater(index)}
          aria-label={`Move ${item.label} later`}
          title="Move later"
          className="flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 text-[var(--ink-2)] hover:border-[var(--accent)]/60 hover:text-[var(--accent)] disabled:opacity-30"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onRotate(index, 90)}
          aria-label={`Rotate ${item.label} 90 degrees`}
          title="Rotate +90°"
          className="flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 text-[var(--ink-2)] hover:border-[var(--accent)]/60 hover:text-[var(--accent)]"
        >
          <RotateCw className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(index)}
          aria-label={`Duplicate ${item.label}`}
          title="Duplicate page"
          className="flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 text-[var(--ink-2)] hover:border-[var(--accent)]/60 hover:text-[var(--accent)]"
        >
          <CopyPlus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(index)}
          aria-label={`Remove ${item.label}`}
          title="Remove page"
          className="flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 text-[var(--danger)] hover:border-[var(--danger)]/50 hover:bg-[var(--danger-soft)]"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
});

export function PdfMergeStudio({ mode, incomingFiles, onBuilt, onStatus }: PdfMergeStudioProps) {
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [fileOrder, setFileOrder] = useState<number[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [undoStack, setUndoStack] = useState<PageItem[][]>([]);
  const [viewMode, setViewMode] = useState<'pages' | 'files'>('pages');
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [loadingCount, setLoadingCount] = useState(0);
  const [building, setBuilding] = useState(false);
  const [loadDurationMs, setLoadDurationMs] = useState<number | null>(null);

  // Drag-and-drop state (Pages)
  const [dragPageIdx, setDragPageIdx] = useState<number | null>(null);
  const [dragOverPageIdx, setDragOverPageIdx] = useState<number | null>(null);

  // Drag-and-drop state (Whole Files)
  const [dragFileIdx, setDragFileIdx] = useState<number | null>(null);
  const [dragOverFileIdx, setDragOverFileIdx] = useState<number | null>(null);

  // Zoom Preview Modal state
  const [previewItem, setPreviewItem] = useState<PageItem | null>(null);
  const [previewBigUrl, setPreviewBigUrl] = useState<string>('');
  const [previewBusy, setPreviewBusy] = useState(false);

  // Background thumbnail worker refs (keeps pdfJs proxy cached per sourceIndex)
  const sourcesRef = useRef<SourceDoc[]>([]);
  sourcesRef.current = sources;
  const pdfJsCacheRef = useRef<Map<number, Promise<Awaited<ReturnType<typeof openPdfJs>>>>>(new Map());
  const requestedKeysRef = useRef<Set<string>>(new Set());
  const thumbQueueRef = useRef<PageItem[]>([]);
  const activeWorkersRef = useRef(0);
  const addMoreRef = useRef<HTMLInputElement>(null);

  const pushUndo = useCallback((next: PageItem[]) => {
    setPages((current) => {
      setUndoStack((u) => [current, ...u].slice(0, 18));
      return next;
    });
  }, []);

  // Cleanup cached pdfJs instances on unmount
  useEffect(() => {
    const cache = pdfJsCacheRef.current;
    return () => {
      cache.forEach((p) => {
        p.then((doc) => doc.cleanup?.()).catch(() => {});
      });
      cache.clear();
    };
  }, []);

  const getPdfJsCached = useCallback((sourceIndex: number) => {
    const existing = pdfJsCacheRef.current.get(sourceIndex);
    if (existing) return existing;
    const src = sourcesRef.current.find((s) => s.sourceIndex === sourceIndex);
    if (!src) return Promise.reject(new Error('Source not found'));
    const promise = openPdfJs(src.bytes);
    pdfJsCacheRef.current.set(sourceIndex, promise);
    return promise;
  }, []);

  /** Concurrent 3-worker background thumbnail renderer (fast JPEG at 0.30x scale — zero UI blocking!) */
  const pumpThumbQueue = useCallback(() => {
    const MAX_WORKERS = 3;
    while (activeWorkersRef.current < MAX_WORKERS && thumbQueueRef.current.length > 0) {
      const next = thumbQueueRef.current.shift()!;
      if (next.sourceIndex < 0 || !next.pageNumber) continue;
      const cacheKey = `${next.sourceIndex}:${next.pageNumber}`;
      activeWorkersRef.current += 1;

      (async () => {
        try {
          const pdfJs = await getPdfJsCached(next.sourceIndex);
          // Fast crisp thumbnail: 0.32 scale + JPEG 0.72 is ~6x faster and ~10x smaller than PNG
          const canvas = await renderPdfPageToCanvas(pdfJs, next.pageNumber!, 0.32);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
          setThumbMap((prev) => (prev[cacheKey] ? prev : { ...prev, [cacheKey]: dataUrl }));
        } catch {
          // non-fatal thumbnail fallback
        } finally {
          activeWorkersRef.current -= 1;
          pumpThumbQueue();
        }
      })();
    }
  }, [getPdfJsCached]);

  const requestThumb = useCallback(
    (item: PageItem) => {
      if (item.sourceIndex < 0 || !item.pageNumber) return;
      const key = `${item.sourceIndex}:${item.pageNumber}`;
      if (requestedKeysRef.current.has(key)) return;
      requestedKeysRef.current.add(key);
      thumbQueueRef.current.push(item);
      pumpThumbQueue();
    },
    [pumpThumbQueue]
  );

  /** INSTANT file loading: reads bytes + counts pages in parallel (<50ms), populates UI immediately, streams thumbnails lazily */
  const handleAddFiles = useCallback(
    async (incoming: File[]) => {
      const pdfs = incoming.filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (!pdfs.length) {
        onStatus?.('Please select valid .pdf files.');
        return;
      }

      const t0 = performance.now();
      setLoadingCount(pdfs.length);
      onStatus?.('');

      try {
        const startIdx = sourcesRef.current.length;
        // Read & inspect page counts in parallel — zero canvas blocking!
        const loaded = await Promise.all(
          pdfs.map(async (f, offset) => {
            const bytes = await readFileAsBytes(f);
            const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
            const pageCount = doc.getPageCount();
            const sIdx = startIdx + offset;
            return {
              source: {
                id: `${sIdx}_${f.name}_${f.size}_${Date.now()}`,
                sourceIndex: sIdx,
                name: f.name,
                sizeBytes: f.size,
                pageCount,
                bytes,
              } satisfies SourceDoc,
              pages: Array.from({ length: pageCount }, (_, pIdx) => ({
                uid: `${sIdx}_${pIdx + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                sourceIndex: sIdx,
                pageNumber: pIdx + 1,
                rotation: 0,
                fileName: f.name,
                label: `${f.name} · p${pIdx + 1}`,
              })) satisfies PageItem[],
            };
          })
        );

        const newSources = loaded.map((l) => l.source);
        const newPages = loaded.flatMap((l) => l.pages);

        setSources((prev) => [...prev, ...newSources]);
        setFileOrder((prev) => [...prev, ...newSources.map((s) => s.sourceIndex)]);
        setPages((prev) => [...prev, ...newPages]);
        setLoadDurationMs(Math.max(1, Math.round(performance.now() - t0)));
      } catch (err) {
        onStatus?.(`Error loading PDF: ${(err as Error).message}`);
      } finally {
        setLoadingCount(0);
      }
    },
    [onStatus]
  );

  // Consume cross-tool transferred PDFs
  const lastIncomingRef = useRef<File[] | undefined>(undefined);
  useEffect(() => {
    if (incomingFiles?.length && incomingFiles !== lastIncomingRef.current) {
      lastIncomingRef.current = incomingFiles;
      void handleAddFiles(incomingFiles);
    }
  }, [incomingFiles, handleAddFiles]);

  // High-res page zoom preview on demand
  const handleInspectPage = useCallback(
    async (item: PageItem) => {
      if (item.sourceIndex < 0 || !item.pageNumber) return;
      setPreviewItem(item);
      setPreviewBigUrl('');
      setPreviewBusy(true);
      try {
        const pdfJs = await getPdfJsCached(item.sourceIndex);
        const canvas = await renderPdfPageToCanvas(pdfJs, item.pageNumber, 1.45);
        setPreviewBigUrl(canvas.toDataURL('image/jpeg', 0.88));
      } catch {
        setPreviewBigUrl(thumbMap[`${item.sourceIndex}:${item.pageNumber}`] || '');
      } finally {
        setPreviewBusy(false);
      }
    },
    [getPdfJsCached, thumbMap]
  );

  useEffect(() => {
    if (!previewItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewItem(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewItem]);

  // --- Page Drag-and-Drop Handlers ---
  const handlePageDragStart = useCallback((idx: number, e: React.DragEvent) => {
    setDragPageIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(idx));
    } catch {
      // ignore synthetic events
    }
  }, []);

  const handlePageDragOver = useCallback((idx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPageIdx((prev) => (prev === idx ? prev : idx));
  }, []);

  const handlePageDragLeave = useCallback(() => {
    setDragOverPageIdx(null);
  }, []);

  const handlePageDrop = useCallback(
    (targetIdx: number, e: React.DragEvent) => {
      e.preventDefault();
      // Support dropping fresh external PDF files directly onto the page grid!
      if (e.dataTransfer.files?.length) {
        setDragPageIdx(null);
        setDragOverPageIdx(null);
        void handleAddFiles(Array.from(e.dataTransfer.files));
        return;
      }
      const raw = e.dataTransfer.getData('text/plain');
      const fromIdx = dragPageIdx !== null ? dragPageIdx : raw !== '' ? Number(raw) : NaN;
      setDragPageIdx(null);
      setDragOverPageIdx(null);
      if (Number.isNaN(fromIdx) || fromIdx === targetIdx) return;
      setPages((prev) => {
        setUndoStack((u) => [prev, ...u].slice(0, 18));
        return reorderList(prev, fromIdx, targetIdx);
      });
    },
    [dragPageIdx, handleAddFiles]
  );

  const handlePageDragEnd = useCallback(() => {
    setDragPageIdx(null);
    setDragOverPageIdx(null);
  }, []);

  // --- Whole-File Drag-and-Drop Handlers (Files Order View) ---
  const orderedFiles = useMemo(() => {
    const byIdx = new Map(sources.map((s) => [s.sourceIndex, s]));
    const pageCounts = new Map<number, number>();
    pages.forEach((p) => {
      if (p.sourceIndex >= 0) pageCounts.set(p.sourceIndex, (pageCounts.get(p.sourceIndex) || 0) + 1);
    });
    return fileOrder
      .map((sIdx) => byIdx.get(sIdx))
      .filter((s): s is SourceDoc => Boolean(s && (pageCounts.get(s.sourceIndex) || 0) > 0))
      .map((s) => ({ ...s, activePages: pageCounts.get(s.sourceIndex) || 0 }));
  }, [sources, fileOrder, pages]);

  const handleFileDrop = (targetIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    const fromIdx = dragFileIdx !== null ? dragFileIdx : raw !== '' ? Number(raw) : NaN;
    setDragFileIdx(null);
    setDragOverFileIdx(null);
    if (Number.isNaN(fromIdx) || fromIdx === targetIdx) return;
    const activeIds = orderedFiles.map((f) => f.sourceIndex);
    const nextOrder = reorderList(activeIds, fromIdx, targetIdx);
    setFileOrder(nextOrder);
    pushUndo(reorderBySourceOrder(pages, nextOrder));
  };

  // --- Page Actions ---
  const movePage = useCallback(
    (from: number, to: number) => {
      setPages((prev) => {
        if (to < 0 || to >= prev.length) return prev;
        setUndoStack((u) => [prev, ...u].slice(0, 18));
        return reorderList(prev, from, to);
      });
    },
    []
  );

  const rotatePage = useCallback((idx: number, delta: number) => {
    setPages((prev) => {
      setUndoStack((u) => [prev, ...u].slice(0, 18));
      const copy = [...prev];
      copy[idx] = { ...copy[idx], rotation: (copy[idx].rotation + delta + 360) % 360 };
      return copy;
    });
  }, []);

  const duplicatePage = useCallback((idx: number) => {
    setPages((prev) => {
      setUndoStack((u) => [prev, ...u].slice(0, 18));
      const copy = [...prev];
      const item = copy[idx];
      copy.splice(idx + 1, 0, {
        ...item,
        uid: `${item.uid}_dup_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      });
      return copy;
    });
  }, []);

  const deletePage = useCallback((idx: number) => {
    setPages((prev) => {
      setUndoStack((u) => [prev, ...u].slice(0, 18));
      return prev.filter((_, k) => k !== idx);
    });
  }, []);

  const removeWholeFile = (sourceIndex: number) => {
    pushUndo(pages.filter((p) => p.sourceIndex !== sourceIndex));
    setFileOrder((prev) => prev.filter((id) => id !== sourceIndex));
  };

  const rotateAllPages = (delta: number) => {
    if (!pages.length) return;
    pushUndo(pages.map((p) => ({ ...p, rotation: (p.rotation + delta + 360) % 360 })));
  };

  const buildFinalPdf = async () => {
    if (!pages.length) return;
    setBuilding(true);
    const t0 = performance.now();
    try {
      const sourceBytesList = sources.map((s) => s.bytes);
      const outBytes = await assemblePdfFromPages(
        sourceBytesList,
        pages.map((p) => ({
          sourceIndex: p.sourceIndex,
          pageNumber: p.pageNumber,
          rotation: p.rotation,
        }))
      );
      const ms = Math.max(1, Math.round(performance.now() - t0));
      const name =
        mode === 'merge'
          ? 'merged_document.pdf'
          : `${safeBase(sources[0]?.name || 'document')}_organized.pdf`;
      onBuilt({
        bytes: outBytes,
        name,
        note: `Assembled ${pages.length} page${pages.length === 1 ? '' : 's'} from ${orderedFiles.length} file${orderedFiles.length === 1 ? '' : 's'} in ${ms} ms.`,
      });
    } catch (err) {
      onStatus?.(`Build failed: ${(err as Error).message}`);
    } finally {
      setBuilding(false);
    }
  };

  const totalInputBytes = useMemo(
    () => orderedFiles.reduce((s, f) => s + f.sizeBytes, 0),
    [orderedFiles]
  );

  const renderedThumbsCount = useMemo(
    () =>
      pages.filter(
        (p) => p.sourceIndex < 0 || Boolean(thumbMap[`${p.sourceIndex}:${p.pageNumber}`])
      ).length,
    [pages, thumbMap]
  );

  return (
    <div className="space-y-5">
      <input
        ref={addMoreRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleAddFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {/* Empty Dropzone or Loaded Action Bar */}
      {pages.length === 0 ? (
        <FileDropzone
          accept=".pdf"
          multiple
          onFiles={handleAddFiles}
          label={
            mode === 'merge'
              ? 'Drop PDF files here to Merge — loads instantly'
              : 'Drop a PDF here to Organize, Rotate & Reorder Pages'
          }
          hint="Instant non-blocking load · Drag & drop any page or file to reorder · 100% private in your browser"
        />
      ) : (
        <>
          <Panel
            title={`Workspace Queue · ${pages.length} Page${pages.length === 1 ? '' : 's'} across ${orderedFiles.length} PDF${orderedFiles.length === 1 ? '' : 's'}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {/* Instant Load Speed Metric */}
                {loadDurationMs !== null && (
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-[var(--muted)]">
                    <Zap className="h-3 w-3 text-emerald-600" />
                    Loaded in {loadDurationMs}ms
                    {renderedThumbsCount < pages.length
                      ? ` · Rendering previews ${renderedThumbsCount}/${pages.length}`
                      : ''}
                  </span>
                )}

                {/* View Mode Toggle: Pages Grid vs Whole Files */}
                <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('pages')}
                    data-merge-view-pages
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      viewMode === 'pages'
                        ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-xs)]'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <Grid2x2 className="h-3.5 w-3.5" />
                    Pages ({pages.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('files')}
                    data-merge-view-files
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      viewMode === 'files'
                        ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-xs)]'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" />
                    Files ({orderedFiles.length})
                  </button>
                </div>
              </div>
            }
          >
            {/* Primary Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => addMoreRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                Add More PDFs
              </button>

              <button
                type="button"
                onClick={() =>
                  pushUndo([
                    ...pages,
                    {
                      uid: `blank_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                      sourceIndex: -1,
                      rotation: 0,
                      fileName: 'Blank Page',
                      label: 'Blank A4 Page',
                    },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/75 px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <FilePlus2 className="h-3.5 w-3.5" /> + Blank
              </button>

              <button
                type="button"
                onClick={() => rotateAllPages(90)}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/75 px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                title="Rotate all pages 90° clockwise"
              >
                <RotateCw className="h-3.5 w-3.5" /> Rotate All
              </button>

              <button
                type="button"
                onClick={() => pushUndo([...pages].reverse())}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/75 px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" /> Reverse
              </button>

              {orderedFiles.length > 1 && (
                <button
                  type="button"
                  onClick={() => pushUndo(interleavePagesBySource(pages))}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/75 px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  title="Alternate pages from each PDF (A1, B1, A2, B2...)"
                >
                  <Shuffle className="h-3.5 w-3.5" /> Interleave
                </button>
              )}

              <button
                type="button"
                disabled={!undoStack.length}
                onClick={() => {
                  const [prev, ...rest] = undoStack;
                  setPages(prev);
                  setUndoStack(rest);
                }}
                data-merge-undo-btn
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-35"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo ({undoStack.length})
              </button>

              <button
                type="button"
                onClick={() => {
                  setSources([]);
                  setFileOrder([]);
                  setPages([]);
                  setUndoStack([]);
                  setThumbMap({});
                  requestedKeysRef.current.clear();
                  thumbQueueRef.current = [];
                  setLoadDurationMs(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>

              <button
                type="button"
                disabled={!pages.length || building}
                onClick={buildFinalPdf}
                data-merge-build-btn
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white shadow-[var(--shadow-xs)] hover:bg-[var(--accent-hover)] disabled:opacity-40 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                {building
                  ? 'Building PDF...'
                  : mode === 'merge'
                    ? `Merge ${pages.length} Pages → PDF`
                    : `Save Organized PDF (${pages.length} Pages)`}
              </button>
            </div>

            {/* Subtle Drag Hint & Summary Strip */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2.5 text-xs text-[var(--muted)]">
              <span>
                Drag any {viewMode === 'pages' ? 'page card' : 'PDF file row'} to reorder instantly — or drop more PDFs directly onto the grid.
              </span>
              <span className="font-mono tabular-nums">
                Total input: {fmtBytes(totalInputBytes)}
                {loadingCount > 0 ? ` · Loading ${loadingCount} file(s)...` : ''}
              </span>
            </div>
          </Panel>

          {/* FILES ORDER VIEW (Instant drag-and-drop for whole PDFs!) */}
          {viewMode === 'files' ? (
            <div className="space-y-2.5">
              {orderedFiles.map((doc, fIdx) => {
                const coverUrl = thumbMap[`${doc.sourceIndex}:1`];
                if (!coverUrl) {
                  const firstPage = pages.find((p) => p.sourceIndex === doc.sourceIndex);
                  if (firstPage) requestThumb(firstPage);
                }
                return (
                  <div
                    key={doc.id}
                    draggable
                    data-merge-file-row
                    data-file-name={doc.name}
                    onDragStart={(e) => {
                      setDragFileIdx(fIdx);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(fIdx));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverFileIdx(fIdx);
                    }}
                    onDragLeave={() => setDragOverFileIdx(null)}
                    onDrop={(e) => handleFileDrop(fIdx, e)}
                    onDragEnd={() => {
                      setDragFileIdx(null);
                      setDragOverFileIdx(null);
                    }}
                    className={`flex items-center justify-between gap-4 rounded-xl border bg-[var(--surface)] px-4 py-3 transition-all cursor-grab active:cursor-grabbing ${
                      dragFileIdx === fIdx
                        ? 'opacity-45 border-[var(--accent)]'
                        : dragOverFileIdx === fIdx
                          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30 bg-[var(--accent-soft)]/35'
                          : 'border-[var(--line)] hover:border-[var(--accent)]/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <GripVertical className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <span className="font-mono text-xs font-bold text-[var(--muted)] w-5">
                        {fIdx + 1}.
                      </span>
                      <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--line)] bg-[var(--surface-2)]">
                        {coverUrl ? (
                          <img src={coverUrl} alt={doc.name} className="h-full w-full object-cover" />
                        ) : (
                          <Layers className="h-4 w-4 text-[var(--muted)]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--ink)]">{doc.name}</div>
                        <div className="font-mono text-xs tabular-nums text-[var(--muted)]">
                          {doc.activePages} page{doc.activePages === 1 ? '' : 's'} · {fmtBytes(doc.sizeBytes)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={fIdx === 0}
                        onClick={() => {
                          const nextOrder = reorderList(
                            orderedFiles.map((f) => f.sourceIndex),
                            fIdx,
                            fIdx - 1
                          );
                          setFileOrder(nextOrder);
                          pushUndo(reorderBySourceOrder(pages, nextOrder));
                        }}
                        aria-label={`Move ${doc.name} up`}
                        className="rounded-lg border border-[var(--line)] p-1.5 text-[var(--ink-2)] hover:border-[var(--accent)] disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={fIdx === orderedFiles.length - 1}
                        onClick={() => {
                          const nextOrder = reorderList(
                            orderedFiles.map((f) => f.sourceIndex),
                            fIdx,
                            fIdx + 1
                          );
                          setFileOrder(nextOrder);
                          pushUndo(reorderBySourceOrder(pages, nextOrder));
                        }}
                        aria-label={`Move ${doc.name} down`}
                        className="rounded-lg border border-[var(--line)] p-1.5 text-[var(--ink-2)] hover:border-[var(--accent)] disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeWholeFile(doc.sourceIndex)}
                        aria-label={`Remove ${doc.name}`}
                        className="rounded-lg border border-[var(--line)] p-1.5 text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* PAGES VISUAL DRAG-AND-DROP GRID */
            <div
              data-merge-pages-grid
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) e.preventDefault();
              }}
              onDrop={(e) => {
                if (e.dataTransfer.files?.length) {
                  e.preventDefault();
                  void handleAddFiles(Array.from(e.dataTransfer.files));
                }
              }}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            >
              {pages.map((item, idx) => (
                <LazyPageThumb
                  key={item.uid}
                  item={item}
                  index={idx}
                  totalCount={pages.length}
                  thumbUrl={
                    item.sourceIndex >= 0 && item.pageNumber
                      ? thumbMap[`${item.sourceIndex}:${item.pageNumber}`]
                      : undefined
                  }
                  isDragging={dragPageIdx === idx}
                  isDragOver={dragOverPageIdx === idx && dragPageIdx !== idx}
                  onRequestThumb={requestThumb}
                  onDragStart={handlePageDragStart}
                  onDragOver={handlePageDragOver}
                  onDragLeave={handlePageDragLeave}
                  onDrop={handlePageDrop}
                  onDragEnd={handlePageDragEnd}
                  onMoveEarlier={(i) => movePage(i, i - 1)}
                  onMoveLater={(i) => movePage(i, i + 1)}
                  onRotate={rotatePage}
                  onDuplicate={duplicatePage}
                  onDelete={deletePage}
                  onPreview={handleInspectPage}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* High-Res Page Inspection Lightbox Modal */}
      {previewItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Page preview ${previewItem.label}`}
          onClick={() => setPreviewItem(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[var(--ink)]">{previewItem.label}</div>
                <div className="text-xs text-[var(--muted)]">
                  Rotation: {previewItem.rotation}° · Press Esc to close
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const idx = pages.findIndex((p) => p.uid === previewItem.uid);
                    if (idx >= 0) {
                      rotatePage(idx, -90);
                      setPreviewItem((cur) =>
                        cur ? { ...cur, rotation: (cur.rotation + 270) % 360 } : null
                      );
                    }
                  }}
                  aria-label="Rotate left 90 degrees"
                  className="rounded-lg border border-[var(--line)] p-1.5 text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idx = pages.findIndex((p) => p.uid === previewItem.uid);
                    if (idx >= 0) {
                      rotatePage(idx, 90);
                      setPreviewItem((cur) =>
                        cur ? { ...cur, rotation: (cur.rotation + 90) % 360 } : null
                      );
                    }
                  }}
                  aria-label="Rotate right 90 degrees"
                  className="rounded-lg border border-[var(--line)] p-1.5 text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  aria-label="Close preview"
                  className="rounded-lg border border-[var(--line)] p-1.5 text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-[var(--surface-2)] p-6">
              {previewBusy ? (
                <div className="text-xs font-semibold text-[var(--muted)]">Rendering sharp preview...</div>
              ) : previewBigUrl ? (
                <img
                  src={previewBigUrl}
                  alt={previewItem.label}
                  style={{ transform: `rotate(${previewItem.rotation}deg)` }}
                  className="max-h-[72vh] max-w-full rounded-lg border border-[var(--line)] bg-white shadow-md transition-transform"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
