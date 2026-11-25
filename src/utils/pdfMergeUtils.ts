export interface MergePageRef {
  uid: string;
  sourceIndex: number; // -1 for blank page
  pageNumber?: number;
  rotation: number;
  label: string;
}

/** Immutably move an item from `fromIndex` to `toIndex` (used by drag-and-drop) */
export function reorderList<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Reorder entire source-file groups in order while preserving internal page order of each file */
export function reorderBySourceOrder<T extends { sourceIndex: number }>(
  pages: readonly T[],
  newSourceOrder: readonly number[]
): T[] {
  const buckets = new Map<number, T[]>();
  for (const p of pages) {
    const arr = buckets.get(p.sourceIndex);
    if (arr) arr.push(p);
    else buckets.set(p.sourceIndex, [p]);
  }
  const out: T[] = [];
  const emitted = new Set<number>();
  for (const sIdx of newSourceOrder) {
    const grp = buckets.get(sIdx);
    if (grp) {
      out.push(...grp);
      emitted.add(sIdx);
    }
  }
  // Append any unreferenced items (e.g. blank pages with sourceIndex -1)
  for (const [sIdx, grp] of buckets.entries()) {
    if (!emitted.has(sIdx)) out.push(...grp);
  }
  return out;
}

/** Interleave pages across distinct source PDFs: A1, B1, C1, A2, B2, C2... */
export function interleavePagesBySource<T extends { sourceIndex: number }>(pages: readonly T[]): T[] {
  const order: number[] = [];
  const buckets = new Map<number, T[]>();
  for (const p of pages) {
    if (!buckets.has(p.sourceIndex)) {
      order.push(p.sourceIndex);
      buckets.set(p.sourceIndex, []);
    }
    buckets.get(p.sourceIndex)!.push(p);
  }
  if (order.length <= 1) return [...pages];
  const maxLen = Math.max(...order.map((k) => buckets.get(k)!.length));
  const out: T[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const k of order) {
      const grp = buckets.get(k)!;
      if (i < grp.length) out.push(grp[i]);
    }
  }
  return out;
}

export type CompressionPresetId = 'balanced' | 'lossless' | 'small' | 'print';

export interface CompressionPresetConfig {
  id: CompressionPresetId;
  label: string;
  tagline: string;
  engineMode: 'lossless' | 'smart-vector' | 'high-dpi-raster';
  dpi: number; // e.g. 150, 144, 216
  quality: number; // 0.45 .. 0.95
  maxPhotoPx: number;
  sharpenText: boolean;
}

export const COMPRESSION_PRESETS: Record<CompressionPresetId, CompressionPresetConfig> = {
  balanced: {
    id: 'balanced',
    label: 'Recommended (DPI & Size)',
    tagline: 'Sharp text + smart image & size tuning',
    engineMode: 'smart-vector',
    dpi: 150,
    quality: 0.82,
    maxPhotoPx: 1650,
    sharpenText: true,
  },
  lossless: {
    id: 'lossless',
    label: 'Lossless (100% Original)',
    tagline: 'Zero quality loss — cleans structure & bloat',
    engineMode: 'lossless',
    dpi: 300,
    quality: 1.0,
    maxPhotoPx: 3000,
    sharpenText: false,
  },
  small: {
    id: 'small',
    label: 'Web & Email (Smallest)',
    tagline: 'Compact size for uploads & portals',
    engineMode: 'high-dpi-raster',
    dpi: 130,
    quality: 0.72,
    maxPhotoPx: 1200,
    sharpenText: true,
  },
  print: {
    id: 'print',
    label: 'Print Crisp (High DPI)',
    tagline: '216 DPI high detail for printing',
    engineMode: 'smart-vector',
    dpi: 216,
    quality: 0.92,
    maxPhotoPx: 2400,
    sharpenText: false,
  },
};

export function dpiToScale(dpi: number): number {
  return Number(Math.max(1.2, Math.min(3.5, dpi / 72)).toFixed(2));
}

export function describeDpi(dpi: number): string {
  if (dpi >= 210) return 'Print Sharp';
  if (dpi >= 150) return 'Crisp Reading & Screen';
  if (dpi >= 120) return 'Compact Web & Email';
  return 'Ultra Compact';
}

/** Estimate realistic output byte range to guide users before clicking Compress */
export function estimateCompressedRange(
  origBytes: number,
  options: {
    preset: CompressionPresetId;
    dpi: number;
    quality: number;
    targetKb: number;
    colorMode: 'color' | 'grayscale' | 'bw-scan';
  }
): { minBytes: number; maxBytes: number; targetNote: string } {
  if (origBytes <= 0) return { minBytes: 0, maxBytes: 0, targetNote: '' };

  if (options.targetKb > 0) {
    const targetBytes = options.targetKb * 1024;
    if (targetBytes >= origBytes) {
      return {
        minBytes: Math.round(origBytes * 0.7),
        maxBytes: origBytes,
        targetNote: 'Already under target — lossless cleanup applied',
      };
    }
    return {
      minBytes: Math.round(targetBytes * 0.82),
      maxBytes: targetBytes,
      targetNote: `Auto-tuned to fit under ${options.targetKb} KB`,
    };
  }

  let lowFactor = 0.45;
  let highFactor = 0.8;

  if (options.preset === 'lossless') {
    lowFactor = 0.65;
    highFactor = 0.96;
  } else if (options.preset === 'small') {
    lowFactor = 0.22;
    highFactor = 0.55;
  } else if (options.preset === 'print') {
    lowFactor = 0.58;
    highFactor = 0.92;
  } else {
    // Balanced scales smoothly with DPI & quality
    const dpiRatio = Math.min(1.2, Math.max(0.55, options.dpi / 180));
    const qRatio = Math.min(1, Math.max(0.45, options.quality));
    lowFactor = Math.max(0.25, Math.min(0.8, dpiRatio * qRatio * 0.62));
    highFactor = Math.max(lowFactor + 0.14, Math.min(0.95, dpiRatio * qRatio * 0.96));
  }

  if (options.colorMode === 'grayscale') {
    lowFactor *= 0.85;
    highFactor *= 0.9;
  } else if (options.colorMode === 'bw-scan') {
    lowFactor *= 0.68;
    highFactor *= 0.78;
  }

  return {
    minBytes: Math.max(512, Math.round(origBytes * lowFactor)),
    maxBytes: Math.max(1024, Math.min(origBytes, Math.round(origBytes * highFactor))),
    targetNote: describeDpi(options.dpi),
  };
}
