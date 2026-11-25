import React, { useMemo, useState } from 'react';
import {
  Search,
  Star,
  ArrowRight,
  ArrowLeftRight,
  FileUp,
  FileText,
  FileSpreadsheet,
  Layers,
  Receipt,
  Minimize2,
  Gamepad2,
  X,
} from 'lucide-react';
import {
  CATEGORIES,
  detectBestToolsForFile,
  getToolById,
  TOOLS_CATALOG,
  ToolCategory,
  ToolDef,
} from '../data/toolsCatalog';
import { useWorkspace } from '../context/WorkspaceContext';
import { CategoryIcon } from './ui/CategoryIcon';

export function HomeOverview() {
  const { navigateToTool, favorites, toggleFavorite, recents } = useWorkspace();
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<'All' | ToolCategory>('All');
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const favTools = useMemo(() => favorites.map(getToolById).filter(Boolean) as ToolDef[], [favorites]);
  const recentTools = useMemo(() => recents.map(getToolById).filter(Boolean) as ToolDef[], [recents]);
  const funGames = useMemo(() => TOOLS_CATALOG.filter((t) => t.cat === 'Fun & Brain Games'), []);

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = TOOLS_CATALOG.filter((t) => {
      if (activeCat !== 'All') return t.cat === activeCat;
      // Keep the main workspace catalog focused on productivity tools when browsing "All" with no search query,
      // while Fun & Brain Games get their own dedicated entertainment arcade at the bottom.
      if (!q && t.cat === 'Fun & Brain Games') return false;
      return true;
    });

    if (!q) {
      if (activeCat === 'All') {
        // Keep the best, most-used flagship tools right at the top of the list
        return [...list].sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)));
      }
      return list;
    }

    const scored: { tool: ToolDef; score: number }[] = [];
    for (const t of list) {
      const name = t.name.toLowerCase();
      const desc = t.desc.toLowerCase();
      const cat = t.cat.toLowerCase();
      const kw = t.keywords?.toLowerCase() ?? '';
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 85;
      else if (name.split(/[\s/&+-]+/).some((w) => w.startsWith(q))) score = 70;
      else if (name.includes(q)) score = 55;
      else if (kw.includes(q)) score = 35;
      else if (cat.includes(q)) score = 20;
      else if (desc.includes(q)) score = 10;
      if (score > 0) scored.push({ tool: t, score: score + (t.popular ? 5 : 0) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.tool);
  }, [query, activeCat]);

  const smartRoute = useMemo(
    () => (droppedFiles[0] ? detectBestToolsForFile(droppedFiles[0]) : null),
    [droppedFiles]
  );

  const ToolCard = ({ t }: { t: ToolDef }) => {
    const isFav = favorites.includes(t.id);
    return (
      <div className="group relative flex flex-col justify-between rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--accent)]/50 hover:shadow-[var(--shadow-sm)]">
        <button
          type="button"
          onClick={() => toggleFavorite(t.id)}
          aria-label={isFav ? `Unpin ${t.name}` : `Pin ${t.name}`}
          className={`absolute right-3.5 top-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            isFav
              ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/50'
              : 'text-[var(--muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[var(--surface-2)] hover:text-amber-500'
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${isFav ? 'fill-amber-400' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => navigateToTool(t.id)}
          className="flex flex-1 flex-col justify-between text-left focus:outline-none"
        >
          <div>
            <div className="mb-3 flex items-center gap-2.5 pr-8">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.04] dark:border-white/[0.06]"
                style={{ backgroundColor: `${t.color}14`, color: t.color }}
              >
                <CategoryIcon category={t.cat} className="h-[18px] w-[18px]" />
              </span>
              <span className="truncate text-[11px] font-medium text-[var(--muted)]">{t.cat}</span>
            </div>
            <h3 className="font-display text-[14px] font-bold leading-snug text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
              {t.name}
            </h3>
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">{t.desc}</p>
          </div>
          <div className="mt-3.5 flex items-center text-[11px] font-semibold text-[var(--accent)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <span>Open tool</span>
            <ArrowRight className="ml-1 h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5" />
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Balanced 2-Column Hero & Smart File Drop Router */}
      <section className="grid items-stretch gap-5 lg:grid-cols-12">
        <div className="hero-surface flex flex-col justify-between rounded-2xl border border-[var(--line)] p-6 shadow-[var(--shadow-xs)] sm:p-7 lg:col-span-7">
          <div>
            <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--accent)]">
              <span>Tools with Anik</span>
              <span aria-hidden="true" className="text-[var(--line-strong)]">·</span>
              <span className="font-medium text-[var(--muted)]">Fast Local PDF &amp; Converter Studio</span>
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-[32px] sm:leading-[1.14]">
              Instant PDF workspace, file converters &amp; {TOOLS_CATALOG.length} private browser tools.
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
              Merge &amp; drag-reorder PDFs instantly, shrink PDFs dramatically while keeping vector text 100% sharp, convert DOCX/XLSX/CSV ⇄ PDF with exact Word layout fidelity, and render Full HD 216–300 DPI images locally.
            </p>
          </div>

          <div className="mt-6 pt-5 border-t border-[var(--line)]/80">
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Quick Launch</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-hero-batch-studio-btn
                onClick={() => navigateToTool('pdf-batch')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white shadow-[var(--shadow-xs)] hover:-translate-y-0.5 hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-sm)] transition-all whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5" />
                Batch Processing Studio
              </button>
              {[
                { id: 'pdf-merge', label: 'Merge PDFs', icon: Layers },
                { id: 'pdf-compress', label: 'Compress PDF', icon: Minimize2 },
                { id: 'pdf-convert', label: 'PDF → PNG (Full HD)', icon: FileText },
                { id: 'conv-docx-pdf', label: 'DOCX → Exact PDF', icon: ArrowLeftRight },
                { id: 'conv-xlsx-pdf', label: 'XLSX → PDF', icon: FileSpreadsheet },
                { id: 'conv-pdf-docx', label: 'PDF → DOCX', icon: FileText },
                { id: 'biz-invoice', label: 'Invoice Maker', icon: Receipt },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateToTool(item.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink-2)] shadow-[var(--shadow-xs)] hover:-translate-y-0.5 hover:border-[var(--accent)] hover:text-[var(--accent)] hover:shadow-[var(--shadow-sm)] transition-all whitespace-nowrap"
                  >
                    <Icon className="h-3.5 w-3.5 text-[var(--accent)]" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Universal Smart File Drop Router */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) setDroppedFiles(Array.from(e.dataTransfer.files));
          }}
          className={`surface-dots flex flex-col justify-between rounded-2xl border-2 border-dashed p-6 transition-all duration-150 lg:col-span-5 ${
            dragging
              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
              : 'border-[var(--line-strong)] bg-[var(--surface)] hover:border-[var(--accent)]/70'
          }`}
        >
          {!smartRoute ? (
            <label className="flex h-full cursor-pointer flex-col items-center justify-center text-center py-4">
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) setDroppedFiles(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
              <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--accent)]/15 bg-[var(--accent-soft)] text-[var(--accent)]">
                <FileUp className="h-5 w-5" />
              </div>
              <div className="font-display text-[15px] font-bold text-[var(--ink)]">
                Smart File Drop &amp; Converter Router
              </div>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[var(--muted)]">
                Drop any document, spreadsheet, PDF, or image — we detect the format and route it straight to the best converter or editor.
              </p>
              <div className="mt-4 flex flex-wrap justify-center items-center gap-x-2 gap-y-1 font-mono text-[11px] font-medium text-[var(--muted)]">
                <span>DOCX</span>
                <span aria-hidden="true">·</span>
                <span>XLSX</span>
                <span aria-hidden="true">·</span>
                <span>CSV</span>
                <span aria-hidden="true">·</span>
                <span>PDF</span>
                <span aria-hidden="true">·</span>
                <span>PNG/JPG</span>
                <span aria-hidden="true">·</span>
                <span>JSON/ZIP</span>
              </div>
            </label>
          ) : (
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--accent)]">{smartRoute.label}</span>
                  <button
                    type="button"
                    onClick={() => setDroppedFiles([])}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reset
                  </button>
                </div>
                <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/70 px-3 py-2 text-xs font-semibold text-[var(--ink)] truncate">
                  {droppedFiles.length} file{droppedFiles.length > 1 ? 's' : ''} · {droppedFiles[0].name}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {smartRoute.suggestions.map((s) => (
                  <button
                    key={s.toolId}
                    type="button"
                    onClick={() => navigateToTool(s.toolId, { files: droppedFiles })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
                  >
                    {s.actionLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Pinned Favorites & Recently Used */}
      {(favTools.length > 0 || recentTools.length > 0) && !query && activeCat === 'All' && (
        <section className="space-y-6">
          {favTools.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-[var(--ink)]">Pinned Favorites</h2>
                <span className="num text-xs text-[var(--muted)]">{favTools.length} pinned</span>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {favTools.map((t) => (
                  <ToolCard key={t.id} t={t} />
                ))}
              </div>
            </div>
          )}
          {recentTools.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-[var(--ink)]">Recently Used</h2>
                <span className="text-xs text-[var(--muted)]">Jump back in</span>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {recentTools.slice(0, 4).map((t) => (
                  <ToolCard key={t.id} t={t} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Search + Category Segmented Filter Bar */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search all ${TOOLS_CATALOG.length} tools (DOCX to PDF, XLSX to CSV, PDF to DOCX, Invoice, 2048)...`}
              aria-label="Search tools"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] py-2.5 pl-10 pr-9 text-sm text-[var(--ink)] shadow-[var(--shadow-xs)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <span className="num text-xs font-medium text-[var(--muted)] whitespace-nowrap">
            {activeCat === 'All' && !query
              ? `Top flagship tools first · ${filteredTools.length} utilities`
              : `Showing ${filteredTools.length} of ${TOOLS_CATALOG.length} tools`}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-xs)]">
          <button
            type="button"
            onClick={() => setActiveCat('All')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeCat === 'All'
                ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-xs)]'
                : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
            }`}
          >
            <span>Top &amp; All</span>
            <span className={`num font-mono text-[11px] ${activeCat === 'All' ? 'text-white/80' : 'text-[var(--muted)]'}`}>
              {TOOLS_CATALOG.length}
            </span>
          </button>
          {CATEGORIES.map((c) => {
            const count = TOOLS_CATALOG.filter((t) => t.cat === c.id).length;
            const active = activeCat === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCat(c.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-xs)]'
                    : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
                }`}
              >
                <CategoryIcon category={c.id} className="h-3.5 w-3.5 shrink-0" />
                <span>{c.label}</span>
                <span className={`num font-mono text-[11px] ${active ? 'text-white/80' : 'text-[var(--muted)]'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tool Grid */}
        {filteredTools.length === 0 ? (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] py-16 text-center shadow-[var(--shadow-xs)]">
            <p className="font-display text-sm font-bold text-[var(--ink)]">
              No matching tools found for "{query}"
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Try searching by task (e.g., DOCX, XLSX, CSV, compress, split, QR, invoice, 2048).
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setActiveCat('All');
              }}
              className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredTools.map((t) => (
              <ToolCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* Take a Break — Fun & Mini-Games Section at the Bottom */}
      {activeCat === 'All' && !query && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-xs)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600">
                <Gamepad2 className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-extrabold text-[var(--ink)]">
                  Take a Break — Fun &amp; Brain Mini-Games
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  Instant offline brain games built right in — unwind between tasks without leaving the workspace.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigateToTool('fun-2048')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/70 px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              Open Arcade
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {funGames.map((game) => (
              <ToolCard key={game.id} t={game} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
