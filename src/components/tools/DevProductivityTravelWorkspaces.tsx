import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Plus, Trash2, Download } from 'lucide-react';
import { ToolDef } from '../../data/toolsCatalog';
import { ToolHeader, Panel, StatTile, CopyButton } from '../ui/SharedUi';
import { countBusinessDays, calcHaversineDistance, simplifyGroupDebts } from '../../utils/calculators';
import { downloadText } from '../../utils/download';
import { jsonToCsv } from '../../utils/formatters';

// ==================== DEVELOPER TOOLS (15) ====================
export function DevToolsWorkspace({ tool }: { tool: ToolDef }) {
  const [tab, setTab] = useState(tool.tab || 'encode');
  const [rawInput, setRawInput] = useState('https://anik.studio/workspace?mode=light&tools=230');
  const [encodedOut, setEncodedOut] = useState('');
  const [uuids, setUuids] = useState<string[]>([crypto.randomUUID()]);
  const [epochSec, setEpochSec] = useState(Math.floor(Date.now() / 1000));
  const [isoInput, setIsoInput] = useState(() => new Date().toISOString().slice(0, 16));

  // Color & WCAG Contrast
  const [fgHex, setFgHex] = useState('#0f172a');
  const [bgHex, setBgHex] = useState('#f8fafc');

  // Regex Tester
  const [regexPat, setRegexPat] = useState('([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\\.[a-z]{2,})');
  const [regexFlags, setRegexFlags] = useState('g');
  const [regexText, setRegexText] = useState('Contact team@anik.studio or support@dhaka.dev for notes.');

  // Code Format / Sandbox
  const [codeSnippet, setCodeSnippet] = useState('<div style="padding:20px;font-family:sans-serif">\n  <h2 style="color:#4f46e5">Live HTML Preview</h2>\n  <p>Sandboxed local iframe output.</p>\n</div>');

  useEffect(() => {
    setTab(tool.tab || 'encode');
  }, [tool.id, tool.tab]);

  const queryParams = useMemo(() => {
    try {
      const u = new URL(rawInput.startsWith('http') ? rawInput : `https://example.com/?${rawInput}`);
      return Array.from(u.searchParams.entries());
    } catch {
      return [];
    }
  }, [rawInput]);

  const contrastRatio = useMemo(() => {
    const lum = (hex: string) => {
      const n = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
    };
    const l1 = lum(fgHex);
    const l2 = lum(bgHex);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }, [fgHex, bgHex]);

  const shades = useMemo(() => {
    const r = parseInt(fgHex.slice(1, 3), 16) || 0;
    const g = parseInt(fgHex.slice(3, 5), 16) || 0;
    const b = parseInt(fgHex.slice(5, 7), 16) || 0;
    return [90, 75, 55, 35, 15, 0, -15, -35, -55, -75].map((shift, i) => {
      const mix = (c: number) =>
        shift >= 0 ? Math.round(c + ((255 - c) * shift) / 100) : Math.round((c * (100 + shift)) / 100);
      const hx = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
      return { stop: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900][i], hex: `#${hx(mix(r))}${hx(mix(g))}${hx(mix(b))}` };
    });
  }, [fgHex]);

  const regexMatches = useMemo(() => {
    try {
      const re = new RegExp(regexPat, regexFlags.includes('g') ? regexFlags : regexFlags + 'g');
      return Array.from(regexText.matchAll(re)).map((m) => ({
        full: m[0],
        index: m.index ?? 0,
        groups: m.slice(1),
      }));
    } catch {
      return [];
    }
  }, [regexPat, regexFlags, regexText]);

  const formatSql = (sql: string) =>
    sql
      .replace(/\s+/g, ' ')
      .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT JOIN|INNER JOIN|GROUP BY|ORDER BY|HAVING|LIMIT)\b/gi, '\n$1')
      .trim();

  const formatCss = (css: string) =>
    css
      .replace(/\s+/g, ' ')
      .replace(/\s*\{\s*/g, ' {\n  ')
      .replace(/;\s*/g, ';\n  ')
      .replace(/\s*\}\s*/g, '\n}\n\n')
      .replace(/\n  \n\}/g, '\n}')
      .trim();

  const formatJs = (js: string) => {
    let indent = 0;
    return js
      .replace(/\s+/g, ' ')
      .replace(/;\s*/g, ';\n')
      .replace(/\{\s*/g, ' {\n')
      .replace(/\}\s*/g, '\n}\n')
      .split('\n')
      .map((raw) => {
        const line = raw.trim();
        if (!line) return '';
        if (line.startsWith('}')) indent = Math.max(0, indent - 1);
        const out = '  '.repeat(indent) + line;
        if (line.endsWith('{')) indent++;
        return out;
      })
      .filter(Boolean)
      .join('\n');
  };

  const formatXmlHtml = (xml: string) => {
    let indent = 0;
    return xml
      .replace(/>\s*</g, '>\n<')
      .split('\n')
      .map((raw) => {
        const ln = raw.trim();
        if (!ln) return '';
        if (/^<\//.test(ln)) indent = Math.max(0, indent - 1);
        const out = '  '.repeat(indent) + ln;
        if (/^<[^!?/][^>]*[^/]>$/.test(ln) && !/<\/[^>]+>$/.test(ln)) indent++;
        return out;
      })
      .filter(Boolean)
      .join('\n');
  };

  return (
    <div>
      <ToolHeader tool={tool} />
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5">
        {[
          ['encode', 'Base64 / URL / Entities'],
          ['time-id', 'UUID v4 & Epoch Time'],
          ['color', 'Color Shades & WCAG'],
          ['format', 'HTML Sandbox & Formatters'],
          ['regex', 'Regex & Capture Groups'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              tab === id ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'encode' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Input & Controls">
            <textarea
              rows={6}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEncodedOut(btoa(unescape(encodeURIComponent(rawInput))))}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-white"
              >
                Base64 Encode
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    setEncodedOut(decodeURIComponent(escape(atob(rawInput.trim()))));
                  } catch {
                    setEncodedOut('Invalid Base64 string');
                  }
                }}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold"
              >
                Base64 Decode
              </button>
              <button
                type="button"
                onClick={() => setEncodedOut(encodeURIComponent(rawInput))}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold"
              >
                URL Encode
              </button>
              <button
                type="button"
                onClick={() => setEncodedOut(decodeURIComponent(rawInput))}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold"
              >
                URL Decode
              </button>
              <button
                type="button"
                onClick={() =>
                  setEncodedOut(
                    rawInput.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
                  )
                }
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold"
              >
                HTML Encode
              </button>
              <button
                type="button"
                onClick={() => {
                  const ta = document.createElement('textarea');
                  ta.innerHTML = rawInput;
                  setEncodedOut(ta.value);
                }}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold"
              >
                HTML Decode
              </button>
            </div>
          </Panel>
          <Panel title="Output & Parsed Query Params" actions={<CopyButton text={encodedOut} />}>
            <textarea
              readOnly
              rows={5}
              value={encodedOut}
              className="mb-3 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
            />
            {queryParams.length > 0 && (
              <div className="text-xs">
                <div className="mb-1 font-semibold">URL Query Parameters ({queryParams.length})</div>
                <div className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
                  {queryParams.map(([k, v], i) => (
                    <div key={i} className="flex justify-between px-3 py-1.5 font-mono">
                      <span className="font-bold">{k}</span>
                      <span className="text-[var(--muted)]">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'time-id' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="UUID v4 Cryptographic Generator">
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setUuids(Array.from({ length: 5 }, () => crypto.randomUUID()))}
                className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white"
              >
                Generate 5 UUID v4s
              </button>
              <CopyButton text={uuids.join('\n')} label="Copy All" />
            </div>
            <div className="space-y-1.5 font-mono text-xs">
              {uuids.map((u) => (
                <div key={u} className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-2">
                  <span>{u}</span>
                  <CopyButton text={u} label="Copy" />
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Unix Epoch & ISO-8601 Converter">
            <div className="space-y-3 text-xs">
              <div className="flex gap-2">
                <input
                  type="number"
                  value={epochSec}
                  onChange={(e) => setEpochSec(Number(e.target.value))}
                  className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setEpochSec(Math.floor(Date.now() / 1000))}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 font-semibold"
                >
                  Now
                </button>
              </div>
              <StatTile label="ISO 8601 (UTC)" value={new Date(epochSec * 1000).toISOString()} />
              <StatTile label="Local Time" value={new Date(epochSec * 1000).toLocaleString()} />
              <div className="border-t border-[var(--line)] pt-3">
                <label className="mb-1 block font-semibold">Date/Time → Unix Epoch</label>
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={isoInput}
                    onChange={(e) => setIsoInput(e.target.value)}
                    className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const ms = Date.parse(isoInput);
                      if (Number.isFinite(ms)) setEpochSec(Math.floor(ms / 1000));
                    }}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-white"
                  >
                    Convert
                  </button>
                </div>
                {Number.isFinite(Date.parse(isoInput)) && (
                  <div className="mt-1.5 font-mono text-[11px] text-[var(--muted)]">
                    Seconds: <strong>{Math.floor(Date.parse(isoInput) / 1000)}</strong> · Milliseconds: <strong>{Date.parse(isoInput)}</strong>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'color' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Color Picker & WCAG 2.1 Contrast Checker">
            <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold">Foreground Text</label>
                <div className="flex gap-2">
                  <input type="color" value={fgHex} onChange={(e) => setFgHex(e.target.value)} />
                  <input value={fgHex} onChange={(e) => setFgHex(e.target.value)} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold">Background</label>
                <div className="flex gap-2">
                  <input type="color" value={bgHex} onChange={(e) => setBgHex(e.target.value)} />
                  <input value={bgHex} onChange={(e) => setBgHex(e.target.value)} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] p-5 text-center" style={{ backgroundColor: bgHex, color: fgHex }}>
              <div className="text-lg font-bold">Contrast Sample Typography</div>
              <div className="text-xs opacity-90">Body text at 14px comparing foreground against surface</div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <StatTile label="Ratio" value={`${contrastRatio.toFixed(2)}:1`} />
              <StatTile label="WCAG AA" value={contrastRatio >= 4.5 ? 'PASS' : contrastRatio >= 3 ? 'Large Only' : 'FAIL'} />
              <StatTile label="WCAG AAA" value={contrastRatio >= 7 ? 'PASS' : 'FAIL'} />
            </div>
          </Panel>
          <Panel title="50–900 Shade Ramp">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {shades.map((s) => (
                <div key={s.stop} className="flex items-center justify-between rounded-lg border border-[var(--line)] p-2">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 rounded border border-black/10" style={{ backgroundColor: s.hex }} />
                    <span className="font-mono font-bold">{s.stop}</span>
                  </div>
                  <span className="font-mono text-[var(--muted)]">{s.hex}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'format' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="HTML / CSS / JS / SQL Editor & Formatters">
            <textarea
              rows={11}
              value={codeSnippet}
              onChange={(e) => setCodeSnippet(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button type="button" onClick={() => setCodeSnippet(formatXmlHtml(codeSnippet))} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-white">
                Format HTML/XML
              </button>
              <button type="button" onClick={() => setCodeSnippet(formatCss(codeSnippet))} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold">
                Format CSS
              </button>
              <button type="button" onClick={() => setCodeSnippet(formatJs(codeSnippet))} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold">
                Format JS
              </button>
              <button type="button" onClick={() => setCodeSnippet(formatSql(codeSnippet))} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold">
                Format SQL
              </button>
              <button
                type="button"
                onClick={() => setCodeSnippet(codeSnippet.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim())}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold"
              >
                Minify Code
              </button>
            </div>
          </Panel>
          <Panel title="Sandboxed Live Preview">
            <iframe
              title="HTML Sandbox"
              sandbox=""
              srcDoc={codeSnippet}
              className="h-64 w-full rounded-lg border border-[var(--line)] bg-white"
            />
          </Panel>
        </div>
      )}

      {tab === 'regex' && (
        <Panel title="Regular Expression Tester & Capture Groups">
          <div className="mb-3 flex gap-2 text-xs">
            <input
              value={regexPat}
              onChange={(e) => setRegexPat(e.target.value)}
              placeholder="Regex pattern"
              className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
            />
            <input
              value={regexFlags}
              onChange={(e) => setRegexFlags(e.target.value)}
              className="w-20 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
            />
          </div>
          <textarea
            rows={4}
            value={regexText}
            onChange={(e) => setRegexText(e.target.value)}
            className="mb-4 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
          />
          <div className="space-y-2 text-xs">
            <div className="font-bold">Matches ({regexMatches.length})</div>
            {regexMatches.map((m, idx) => (
              <div key={idx} className="rounded-lg bg-[var(--surface-2)] px-3 py-2 font-mono">
                <span className="font-bold text-[var(--accent)]">Match #{idx + 1}:</span> {m.full}{' '}
                {m.groups.length > 0 && <span className="text-[var(--muted)]">| Groups: {JSON.stringify(m.groups)}</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ==================== PRODUCTIVITY (14) ====================
export function ProductivityWorkspace({ tool }: { tool: ToolDef }) {
  const [tab, setTab] = useState(tool.tab || 'timers');

  // Timer / Pomodoro / Custom Countdown / Stopwatch / HIIT Interval
  const [pomoSec, setPomoSec] = useState(25 * 60);
  const [pomoRunning, setPomoRunning] = useState(false);
  const [customMin, setCustomMin] = useState(10);
  const [swMs, setSwMs] = useState(0);
  const [swRunning, setSwRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const [hiitWork, setHiitWork] = useState(40);
  const [hiitRest, setHiitRest] = useState(20);
  const [hiitRounds, setHiitRounds] = useState(6);
  const [hiitRound, setHiitRound] = useState(1);
  const [hiitPhase, setHiitPhase] = useState<'work' | 'rest'>('work');
  const [hiitLeft, setHiitLeft] = useState(40);
  const [hiitRunning, setHiitRunning] = useState(false);

  // Tasks / Goals / Notes / Habit Tracker
  const [tasks, setTasks] = useState<{ id: number; text: string; done: boolean }[]>([
    { id: 1, text: 'Review PDF merge & compression outputs', done: true },
    { id: 2, text: 'Push unified Tools with Anik repo to GitHub', done: false },
  ]);
  const [newTask, setNewTask] = useState('');
  const [goals, setGoals] = useState<{ id: number; title: string; current: number; target: number }[]>([
    { id: 1, title: 'Read Technical Chapters', current: 6, target: 12 },
    { id: 2, title: 'Monthly Savings Goal (k)', current: 18, target: 25 },
  ]);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [notes, setNotes] = useState(() => localStorage.getItem('anik_notes_v1') || 'Quick workspace notes...');
  const [habits, setHabits] = useState<{ name: string; days: boolean[] }[]>([
    { name: 'Deep Work (90m)', days: [true, true, true, false, false, false, false] },
    { name: 'Exercise / Walk', days: [true, false, true, true, false, false, false] },
  ]);

  // Business Days & Budget
  const [startIso, setStartIso] = useState('2025-05-01');
  const [endIso, setEndIso] = useState('2025-05-31');
  const [bdWeekend, setBdWeekend] = useState(true);
  const [income, setIncome] = useState(65000);
  const [expenses, setExpenses] = useState<{ name: string; amt: number }[]>([
    { name: 'Housing & Utilities', amt: 22000 },
    { name: 'Groceries & Dining', amt: 12000 },
    { name: 'Transport & Internet', amt: 5500 },
  ]);

  // Typing Speed Test (EN & BN)
  const [typingLang, setTypingLang] = useState<'en' | 'bn'>(tool.id === 'prod-typing-bn' ? 'bn' : 'en');
  const promptEn = 'Fast local tools eliminate unnecessary uploads and keep every workflow private and crisp.';
  const promptBn = 'পরিচ্ছন্ন বাংলা টাইপিং অনুশীলন আপনার গতি ও নির্ভুলতা দ্রুত বৃদ্ধি করে।';
  const targetPrompt = typingLang === 'bn' ? promptBn : promptEn;
  const [typedText, setTypedText] = useState('');
  const typingStartRef = useRef<number | null>(null);

  useEffect(() => {
    setTab(tool.tab || 'timers');
    if (tool.id === 'prod-typing-bn') {
      setTypingLang('bn');
      setTypedText('');
      typingStartRef.current = null;
    } else if (tool.id === 'prod-typing-en') {
      setTypingLang('en');
      setTypedText('');
      typingStartRef.current = null;
    }
  }, [tool.id, tool.tab]);

  useEffect(() => {
    if (!pomoRunning) return;
    const id = setInterval(() => setPomoSec((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [pomoRunning]);

  useEffect(() => {
    if (!hiitRunning) return;
    const id = setInterval(() => {
      setHiitLeft((prev) => {
        if (prev > 1) return prev - 1;
        if (hiitPhase === 'work') {
          setHiitPhase('rest');
          return hiitRest;
        }
        if (hiitRound < hiitRounds) {
          setHiitRound((r) => r + 1);
          setHiitPhase('work');
          return hiitWork;
        }
        setHiitRunning(false);
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [hiitRunning, hiitPhase, hiitRound, hiitRounds, hiitWork, hiitRest]);

  useEffect(() => {
    if (!swRunning) return;
    const id = setInterval(() => setSwMs((m) => m + 50), 50);
    return () => clearInterval(id);
  }, [swRunning]);

  const bizRes = useMemo(
    () => countBusinessDays(startIso, endIso, bdWeekend ? [5, 6] : [0, 6]),
    [startIso, endIso, bdWeekend]
  );

  const typingMetrics = useMemo(() => {
    if (!typedText.length || !typingStartRef.current) return { wpm: 0, accuracy: 100 };
    const elapsedMin = Math.max(0.05, (Date.now() - typingStartRef.current) / 60000);
    let correct = 0;
    for (let i = 0; i < typedText.length; i++) {
      if (typedText[i] === targetPrompt[i]) correct++;
    }
    const accuracy = Math.round((correct / typedText.length) * 100);
    const wpm = Math.round(typedText.length / 5 / elapsedMin);
    return { wpm, accuracy };
  }, [typedText, targetPrompt]);

  const totalSpent = expenses.reduce((s, e) => s + e.amt, 0);

  return (
    <div>
      <ToolHeader tool={tool} />
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5">
        {[
          ['timers', 'Pomodoro / Stopwatch'],
          ['workspace', 'To-Do / Habits / Notes'],
          ['dates-money', 'Business Days & Budget'],
          ['typing', 'Typing Speed (EN & বাংলা)'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              tab === id ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'timers' && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Pomodoro & Custom Countdown Timer">
              <div className="flex flex-col items-center py-3">
                <div className="num font-mono text-5xl font-extrabold text-[var(--ink)]">
                  {String(Math.floor(pomoSec / 3600)).padStart(2, '0')}:
                  {String(Math.floor((pomoSec % 3600) / 60)).padStart(2, '0')}:
                  {String(pomoSec % 60).padStart(2, '0')}
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPomoRunning((r) => !r)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white"
                  >
                    {pomoRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {pomoRunning ? 'Pause' : 'Start Timer'}
                  </button>
                  <button type="button" onClick={() => { setPomoRunning(false); setPomoSec(25 * 60); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold">
                    25m Focus
                  </button>
                  <button type="button" onClick={() => { setPomoRunning(false); setPomoSec(5 * 60); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold">
                    5m Break
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="text-[var(--muted)]">Custom mins:</span>
                  <input type="number" min={1} max={600} value={customMin} onChange={(e) => setCustomMin(Math.max(1, Number(e.target.value)))} className="w-20 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
                  <button type="button" onClick={() => { setPomoRunning(false); setPomoSec(customMin * 60); }} className="rounded border border-[var(--line)] px-2.5 py-1 font-semibold">
                    Set Countdown
                  </button>
                </div>
              </div>
            </Panel>
            <Panel title="Precision Stopwatch & Laps">
              <div className="flex flex-col items-center py-3">
                <div className="num font-mono text-4xl font-extrabold">
                  {(swMs / 1000).toFixed(2)}s
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSwRunning((r) => !r)}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white"
                  >
                    {swRunning ? 'Pause' : 'Start'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLaps((l) => [swMs, ...l])}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold"
                  >
                    Lap
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSwRunning(false); setSwMs(0); setLaps([]); }}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
                {laps.length > 0 && (
                  <div className="mt-3 w-full max-h-32 overflow-y-auto divide-y divide-[var(--line)] font-mono text-xs">
                    {laps.map((l, idx) => (
                      <div key={idx} className="flex justify-between py-1">
                        <span>Lap {laps.length - idx}</span>
                        <span>{(l / 1000).toFixed(2)}s</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <Panel title="HIIT & Study Interval Timer (Work / Rest Cycles)">
            <div className="grid gap-4 md:grid-cols-12 items-center">
              <div className="md:col-span-5 grid grid-cols-3 gap-2 text-xs">
                <label>Work (s)<input type="number" min={5} value={hiitWork} onChange={(e) => { const v = Math.max(5, Number(e.target.value)); setHiitWork(v); if (!hiitRunning && hiitPhase === 'work') setHiitLeft(v); }} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
                <label>Rest (s)<input type="number" min={5} value={hiitRest} onChange={(e) => setHiitRest(Math.max(5, Number(e.target.value)))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
                <label>Rounds<input type="number" min={1} value={hiitRounds} onChange={(e) => setHiitRounds(Math.max(1, Number(e.target.value)))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
              </div>
              <div className="md:col-span-4 text-center">
                <div className={`text-xs font-bold uppercase tracking-wider ${hiitPhase === 'work' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {hiitPhase === 'work' ? 'WORK PHASE' : 'REST PHASE'} · Round {hiitRound}/{hiitRounds}
                </div>
                <div className="num font-mono text-4xl font-extrabold">{hiitLeft}s</div>
              </div>
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setHiitRunning((r) => !r)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white">
                  {hiitRunning ? 'Pause' : 'Start HIIT'}
                </button>
                <button type="button" onClick={() => { setHiitRunning(false); setHiitRound(1); setHiitPhase('work'); setHiitLeft(hiitWork); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold">
                  Reset
                </button>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'workspace' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="To-Do Tasks, Goal Progress & 7-Day Habits">
            <div className="mb-3 flex gap-2 text-xs">
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTask.trim()) {
                    setTasks((t) => [...t, { id: Date.now(), text: newTask.trim(), done: false }]);
                    setNewTask('');
                  }
                }}
                placeholder="Add new task..."
                className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newTask.trim()) return;
                  setTasks((t) => [...t, { id: Date.now(), text: newTask.trim(), done: false }]);
                  setNewTask('');
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 font-bold text-white"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5 text-xs mb-4">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
                    />
                    <span className={t.done ? 'line-through text-[var(--muted)]' : ''}>{t.text}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setTasks((p) => p.filter((x) => x.id !== t.id))}
                    className="text-[var(--muted)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="text-xs font-bold mb-2">Goal Progress Milestones</div>
            <div className="space-y-2 mb-4 text-xs">
              {goals.map((g) => {
                const pct = Math.min(100, Math.round((g.current / Math.max(1, g.target)) * 100));
                return (
                  <div key={g.id} className="rounded-lg border border-[var(--line)] p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold">{g.title}</span>
                      <div className="flex items-center gap-1.5 font-mono">
                        <button type="button" onClick={() => setGoals((p) => p.map((x) => (x.id === g.id ? { ...x, current: Math.max(0, x.current - 1) } : x)))} className="rounded border border-[var(--line)] px-1.5">−</button>
                        <span>{g.current}/{g.target} ({pct}%)</span>
                        <button type="button" onClick={() => setGoals((p) => p.map((x) => (x.id === g.id ? { ...x, current: x.current + 1 } : x)))} className="rounded border border-[var(--line)] px-1.5">+</button>
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-2">
                <input value={newGoalTitle} onChange={(e) => setNewGoalTitle(e.target.value)} placeholder="New goal milestone..." className="flex-1 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5" />
                <button
                  type="button"
                  onClick={() => {
                    if (!newGoalTitle.trim()) return;
                    setGoals((p) => [...p, { id: Date.now(), title: newGoalTitle.trim(), current: 0, target: 10 }]);
                    setNewGoalTitle('');
                  }}
                  className="rounded border border-[var(--line)] px-3 py-1 font-semibold"
                >
                  Add Goal
                </button>
              </div>
            </div>
            <div className="text-xs font-bold mb-2">7-Day Habit Matrix</div>
            {habits.map((h, hi) => (
              <div key={hi} className="mb-2 flex items-center justify-between text-xs">
                <span>{h.name}</span>
                <div className="flex gap-1">
                  {h.days.map((d, di) => (
                    <button
                      key={di}
                      type="button"
                      onClick={() =>
                        setHabits((prev) =>
                          prev.map((x, idx) =>
                            idx === hi ? { ...x, days: x.days.map((v, k) => (k === di ? !v : v)) } : x
                          )
                        )
                      }
                      className={`h-6 w-6 rounded border text-[10px] font-bold ${
                        d ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[var(--line)] bg-[var(--surface-2)]'
                      }`}
                    >
                      {'SMTWTFS'[di]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Panel>
          <Panel
            title="Quick Notes (Auto-Saved Locally)"
            actions={
              <button type="button" onClick={() => downloadText(notes, 'workspace_notes.txt', 'text/plain')} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold">
                <Download className="h-3 w-3" /> .TXT
              </button>
            }
          >
            <textarea
              rows={15}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                try {
                  localStorage.setItem('anik_notes_v1', e.target.value);
                } catch {
                  // ignore
                }
              }}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm"
            />
          </Panel>
        </div>
      )}

      {tab === 'dates-money' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Date Difference & BD/International Business Days">
            <div className="grid grid-cols-2 gap-3 text-xs mb-3">
              <input type="date" value={startIso} onChange={(e) => setStartIso(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
              <input type="date" value={endIso} onChange={(e) => setEndIso(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
            </div>
            <label className="mb-3 inline-flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" checked={bdWeekend} onChange={(e) => setBdWeekend(e.target.checked)} />
              Bangladesh Weekend (Fri–Sat) instead of Sat–Sun
            </label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatTile label="Total Days" value={bizRes.totalDays} sub={`${(bizRes.totalDays / 7).toFixed(1)} wks`} />
              <StatTile label="Business Days" value={bizRes.businessDays} />
              <StatTile label="Weekends" value={bizRes.weekendCount} />
            </div>
            <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs font-mono">
              Exact Span: <strong>{Math.floor(bizRes.totalDays / 365)}y {Math.floor((bizRes.totalDays % 365) / 30)}m {bizRes.totalDays % 30}d</strong> ({(bizRes.totalDays * 24).toLocaleString()} hours)
            </div>
          </Panel>
          <Panel
            title="Monthly Budget & Expense Tracker"
            actions={
              <button
                type="button"
                onClick={() => downloadText(jsonToCsv(expenses), 'monthly_expenses.csv', 'text/csv')}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold"
              >
                <Download className="h-3 w-3" /> CSV
              </button>
            }
          >
            <div className="mb-3 text-xs">
              <label className="mb-1 block font-semibold">Monthly Income</label>
              <input type="number" value={income} onChange={(e) => setIncome(Number(e.target.value))} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
            </div>
            <div className="space-y-1.5 text-xs mb-3">
              {expenses.map((ex, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={ex.name} onChange={(e) => setExpenses((p) => p.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} className="flex-1 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1" />
                  <input type="number" value={ex.amt} onChange={(e) => setExpenses((p) => p.map((x, k) => (k === i ? { ...x, amt: Number(e.target.value) } : x)))} className="w-28 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
                  <button type="button" onClick={() => setExpenses((p) => p.filter((_, k) => k !== i))} className="text-[var(--muted)] hover:text-[var(--danger)]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setExpenses((p) => [...p, { name: 'New Expense', amt: 1500 }])}
                className="inline-flex items-center gap-1 rounded border border-[var(--line)] px-2.5 py-1 font-semibold"
              >
                <Plus className="h-3 w-3" /> Add Expense Line
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Total Expenses" value={totalSpent.toLocaleString()} sub={`${income > 0 ? Math.round((totalSpent / income) * 100) : 0}% of income`} />
              <StatTile label="Remaining Savings" value={(income - totalSpent).toLocaleString()} />
            </div>
          </Panel>
        </div>
      )}

      {tab === 'typing' && (
        <Panel title="Typing Speed Test (English & বাংলা)">
          <div className="mb-3 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setTypingLang('en'); setTypedText(''); typingStartRef.current = null; }}
                className={`rounded-lg px-3 py-1.5 font-semibold ${typingLang === 'en' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)]'}`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => { setTypingLang('bn'); setTypedText(''); typingStartRef.current = null; }}
                className={`rounded-lg px-3 py-1.5 font-semibold ${typingLang === 'bn' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)]'}`}
              >
                বাংলা
              </button>
            </div>
            <button type="button" onClick={() => { setTypedText(''); typingStartRef.current = null; }} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold">
              Reset Test
            </button>
          </div>
          <div className="mb-3 rounded-lg bg-[var(--surface-2)] p-4 text-base font-medium leading-relaxed select-none">
            {Array.from(targetPrompt).map((ch, idx) => {
              const typedCh = Array.from(typedText)[idx];
              const cls =
                typedCh === undefined
                  ? 'text-[var(--ink-2)]'
                  : typedCh === ch
                    ? 'text-emerald-600 bg-emerald-500/10'
                    : 'text-rose-600 bg-rose-500/15 underline';
              return (
                <span key={idx} className={cls}>
                  {ch}
                </span>
              );
            })}
          </div>
          <textarea
            rows={3}
            value={typedText}
            onChange={(e) => {
              if (!typingStartRef.current) typingStartRef.current = Date.now();
              setTypedText(e.target.value);
            }}
            placeholder="Start typing the sentence above..."
            className="mb-4 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
          />
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Typing Speed" value={`${typingMetrics.wpm} WPM`} />
            <StatTile label="Accuracy" value={`${typingMetrics.accuracy}%`} />
            <StatTile label="Progress" value={`${Math.min(100, Math.round((typedText.length / Math.max(1, targetPrompt.length)) * 100))}%`} />
          </div>
        </Panel>
      )}
    </div>
  );
}

// ==================== TRAVEL TOOLS (12) ====================
export function TravelToolsWorkspace({ tool }: { tool: ToolDef }) {
  const [tab, setTab] = useState(tool.tab || 'budget');
  const [participants, setParticipants] = useState('Anik, Nadia, Tariq');
  const [tripExpenses, setTripExpenses] = useState([
    { paidBy: 'Anik', amount: 4500, label: 'Hotel Booking' },
    { paidBy: 'Nadia', amount: 1800, label: 'Dinner & Transport' },
  ]);
  const [newExp, setNewExp] = useState({ paidBy: 'Anik', amount: 600, label: 'Tickets' });

  // Travel Budget Planner
  const [tripDays, setTripDays] = useState(4);
  const [flightBudget, setFlightBudget] = useState(12000);
  const [hotelPerNight, setHotelPerNight] = useState(4500);
  const [foodPerDay, setFoodPerDay] = useState(1800);
  const [activityBudget, setActivityBudget] = useState(5000);

  // World Time Zone Slider
  const [utcHour, setUtcHour] = useState(9);
  const cities = [
    { name: 'New York', offset: -4 },
    { name: 'London', offset: 1 },
    { name: 'Dubai', offset: 4 },
    { name: 'Dhaka', offset: 6 },
    { name: 'Singapore', offset: 8 },
    { name: 'Tokyo', offset: 9 },
  ];

  // Distance, Speed/ETA & Weather & Fuel
  const [lat1, setLat1] = useState(23.8103); // Dhaka
  const [lon1, setLon1] = useState(90.4125);
  const [lat2, setLat2] = useState(22.3569); // Chattogram
  const [lon2, setLon2] = useState(91.7832);
  const [kmPerLiter, setKmPerLiter] = useState(14);
  const [fuelPrice, setFuelPrice] = useState(125);
  const [avgSpeedKmh, setAvgSpeedKmh] = useState(65);
  const [weatherInfo, setWeatherInfo] = useState('');

  // Packing / Shopping / Itinerary / Multi-Destination Stops
  const [packItems, setPackItems] = useState([
    { item: 'Passport / NID & Tickets', packed: true },
    { item: 'Power bank & Type-C Cable', packed: true },
    { item: 'Umbrella / Light Jacket', packed: false },
    { item: 'First Aid & Sunglasses', packed: false },
  ]);
  const [newPackItem, setNewPackItem] = useState('');
  const [shopItems, setShopItems] = useState([
    { item: 'Sunscreen SPF 50', bought: false },
    { item: 'Travel Adapter', bought: true },
  ]);
  const [newShopItem, setNewShopItem] = useState('');
  const [itinerary, setItinerary] = useState([
    { day: 'Day 1', city: 'Cox’s Bazar', plan: 'Check-in, Sugandha Beach sunset & seafood dinner' },
    { day: 'Day 2', city: 'Inani & Marine Drive', plan: 'Morning drive to Inani Beach, Himchari waterfall' },
  ]);
  const [newStop, setNewStop] = useState({ day: 'Day 3', city: 'Saint Martin', plan: 'Boat ferry & coral island walk' });

  useEffect(() => {
    setTab(tool.tab || 'budget');
  }, [tool.id, tool.tab]);

  // Offline astronomical sunrise/sunset calculation (NOAA approximation)
  const solarTimes = useMemo(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000);
    const rad = Math.PI / 180;
    const decl = 23.44 * Math.sin(rad * ((360 / 365) * (doy - 81)));
    const cosH =
      (Math.cos(90.833 * rad) - Math.sin(lat2 * rad) * Math.sin(decl * rad)) /
      (Math.cos(lat2 * rad) * Math.cos(decl * rad));
    if (Math.abs(cosH) > 1) return { sunrise: 'Polar', sunset: 'Polar', daylight: cosH < -1 ? '24h' : '0h' };
    const halfDayHrs = (Math.acos(cosH) / rad) / 15;
    const tzApprox = Math.round(lon2 / 15);
    const solarNoon = 12 + tzApprox - lon2 / 15;
    const fmt = (h: number) => {
      const wrapped = ((h % 24) + 24) % 24;
      const hh = Math.floor(wrapped);
      const mm = Math.floor((wrapped - hh) * 60);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    const dlHrs = halfDayHrs * 2;
    return {
      sunrise: fmt(solarNoon - halfDayHrs),
      sunset: fmt(solarNoon + halfDayHrs),
      daylight: `${Math.floor(dlHrs)}h ${Math.round((dlHrs % 1) * 60)}m`,
    };
  }, [lat2, lon2]);

  const memberList = useMemo(
    () => participants.split(',').map((s) => s.trim()).filter(Boolean),
    [participants]
  );
  const debtData = useMemo(
    () => simplifyGroupDebts(tripExpenses, memberList),
    [tripExpenses, memberList]
  );
  const distKm = useMemo(() => calcHaversineDistance(lat1, lon1, lat2, lon2), [lat1, lon1, lat2, lon2]);

  const fetchOpenMeteo = async () => {
    try {
      setWeatherInfo('Fetching destination weather...');
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat2}&longitude=${lon2}&current_weather=true&daily=sunrise,sunset&timezone=auto`
      );
      const data = await res.json();
      const cur = data.current_weather;
      const sr = data.daily?.sunrise?.[0]?.slice(11) ?? '';
      const ss = data.daily?.sunset?.[0]?.slice(11) ?? '';
      setWeatherInfo(`${cur.temperature}°C, Wind ${cur.windspeed} km/h · Sunrise ${sr} / Sunset ${ss}`);
    } catch {
      setWeatherInfo('Offline fallback: clear sky estimate available.');
    }
  };

  return (
    <div>
      <ToolHeader tool={tool} />
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5">
        {[
          ['budget', 'Group Split & Fuel Budget'],
          ['lists', 'Packing & Itinerary Checklists'],
          ['time-geo', '24h Time Zone / Distance / Solar'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              tab === id ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'budget' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Group Expense Debt Simplifier">
            <label className="mb-1 block text-xs font-semibold">Participants (comma separated)</label>
            <input
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              className="mb-3 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs"
            />
            <div className="mb-3 flex gap-2 text-xs">
              <select
                value={newExp.paidBy}
                onChange={(e) => setNewExp((x) => ({ ...x, paidBy: e.target.value }))}
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5"
              >
                {memberList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input
                value={newExp.label}
                onChange={(e) => setNewExp((x) => ({ ...x, label: e.target.value }))}
                placeholder="Description"
                className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5"
              />
              <input
                type="number"
                value={newExp.amount}
                onChange={(e) => setNewExp((x) => ({ ...x, amount: Number(e.target.value) }))}
                className="w-24 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono"
              />
              <button
                type="button"
                onClick={() => setTripExpenses((p) => [...p, newExp])}
                className="rounded-lg bg-[var(--accent)] px-3 font-bold text-white"
              >
                Add
              </button>
            </div>
            <div className="space-y-1 text-xs mb-4">
              {tripExpenses.map((e, i) => (
                <div key={i} className="flex justify-between rounded bg-[var(--surface-2)] px-3 py-1.5">
                  <span><strong>{e.paidBy}</strong> paid for {e.label}</span>
                  <span className="font-mono font-bold">{e.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="font-bold text-emerald-800 dark:text-emerald-300 mb-1">Simplified Settlements</div>
              {debtData.settlements.length === 0 ? (
                <div>All settled!</div>
              ) : (
                debtData.settlements.map((s, idx) => (
                  <div key={idx} className="font-mono">
                    {s.from} → {s.to}: <strong>{s.amount.toLocaleString()}</strong>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Trip Budget Planner & Road Fuel Estimator">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 text-xs mb-3">
              <label>Days<input type="number" min={1} value={tripDays} onChange={(e) => setTripDays(Math.max(1, Number(e.target.value)))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
              <label>Flights/Transport<input type="number" value={flightBudget} onChange={(e) => setFlightBudget(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
              <label>Hotel / Night<input type="number" value={hotelPerNight} onChange={(e) => setHotelPerNight(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
              <label>Food / Day<input type="number" value={foodPerDay} onChange={(e) => setFoodPerDay(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
              <label>Activities<input type="number" value={activityBudget} onChange={(e) => setActivityBudget(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
              <label>Fuel Price (/L)<input type="number" value={fuelPrice} onChange={(e) => setFuelPrice(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
            </div>
            {(() => {
              const totalTrip = flightBudget + hotelPerNight * Math.max(0, tripDays - 1) + foodPerDay * tripDays + activityBudget;
              return (
                <div className="grid grid-cols-2 gap-2.5 mb-3">
                  <StatTile label="Total Trip Budget" value={totalTrip.toLocaleString()} sub={`${Math.round(totalTrip / tripDays).toLocaleString()} / day`} />
                  <StatTile label="Est. Road Fuel" value={Math.round((distKm / Math.max(1, kmPerLiter)) * fuelPrice).toLocaleString()} sub={`${distKm.toFixed(0)} km @ ${kmPerLiter} km/L`} />
                </div>
              );
            })()}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--muted)]">Mileage (km/L):</span>
              <input type="number" min={1} value={kmPerLiter} onChange={(e) => setKmPerLiter(Math.max(1, Number(e.target.value)))} className="w-20 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
            </div>
          </Panel>
        </div>
      )}

      {tab === 'lists' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Packing Checklist & Trip Presets">
            <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
              {[
                ['Beach', ['Swimwear & Towel', 'Sunscreen SPF 50', 'Flip-Flops', 'Sunglasses', 'Waterproof Pouch']],
                ['Business', ['Laptop & Charger', 'Blazer / Formal Wear', 'Business Cards', 'Travel Adapter', 'Notebook']],
                ['Winter', ['Thermal Layers', 'Warm Jacket', 'Gloves & Beanie', 'Moisturizer', 'Wool Socks']],
              ].map(([label, preset]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={() => setPackItems((preset as string[]).map((item) => ({ item, packed: false })))}
                  className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 font-semibold hover:border-[var(--accent)]"
                >
                  Load {label as string}
                </button>
              ))}
            </div>
            <div className="mb-3 flex gap-2 text-xs">
              <input value={newPackItem} onChange={(e) => setNewPackItem(e.target.value)} placeholder="Add packing item..." className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5" />
              <button
                type="button"
                onClick={() => {
                  if (!newPackItem.trim()) return;
                  setPackItems((p) => [...p, { item: newPackItem.trim(), packed: false }]);
                  setNewPackItem('');
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-white"
              >
                Add
              </button>
            </div>
            <div className="space-y-1.5 text-xs mb-4">
              {packItems.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={p.packed} onChange={() => setPackItems((prev) => prev.map((x, k) => (k === idx ? { ...x, packed: !x.packed } : x)))} />
                    <span className={p.packed ? 'line-through text-[var(--muted)]' : 'font-medium'}>{p.item}</span>
                  </label>
                  <button type="button" onClick={() => setPackItems((prev) => prev.filter((_, k) => k !== idx))} className="text-[var(--muted)] hover:text-[var(--danger)]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-[var(--line)] pt-3">
              <div className="mb-2 text-xs font-bold">Pre-Trip Shopping List</div>
              <div className="mb-2 flex gap-2 text-xs">
                <input value={newShopItem} onChange={(e) => setNewShopItem(e.target.value)} placeholder="Add item to buy..." className="flex-1 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1" />
                <button
                  type="button"
                  onClick={() => {
                    if (!newShopItem.trim()) return;
                    setShopItems((p) => [...p, { item: newShopItem.trim(), bought: false }]);
                    setNewShopItem('');
                  }}
                  className="rounded border border-[var(--line)] px-2.5 py-1 font-semibold"
                >
                  + Add
                </button>
              </div>
              <div className="space-y-1 text-xs">
                {shopItems.map((s, idx) => (
                  <label key={idx} className="flex items-center gap-2 rounded bg-[var(--surface-2)] px-2.5 py-1.5 cursor-pointer">
                    <input type="checkbox" checked={s.bought} onChange={() => setShopItems((p) => p.map((x, k) => (k === idx ? { ...x, bought: !x.bought } : x)))} />
                    <span className={s.bought ? 'line-through text-[var(--muted)]' : ''}>{s.item}</span>
                  </label>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Day-by-Day Itinerary & Multi-Destination Stops">
            <div className="space-y-2 text-xs mb-3">
              {itinerary.map((stop, idx) => (
                <div key={idx} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--accent)]">{stop.day} — {stop.city}</span>
                    <button type="button" onClick={() => setItinerary((p) => p.filter((_, k) => k !== idx))} className="text-[var(--muted)] hover:text-[var(--danger)]">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 text-[var(--ink-2)]">{stop.plan}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mb-2">
              <input value={newStop.day} onChange={(e) => setNewStop((s) => ({ ...s, day: e.target.value }))} placeholder="Day #" className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5" />
              <input value={newStop.city} onChange={(e) => setNewStop((s) => ({ ...s, city: e.target.value }))} placeholder="Destination / City" className="col-span-2 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5" />
            </div>
            <div className="flex gap-2 text-xs">
              <input value={newStop.plan} onChange={(e) => setNewStop((s) => ({ ...s, plan: e.target.value }))} placeholder="Activities / Notes..." className="flex-1 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5" />
              <button
                type="button"
                onClick={() => {
                  if (!newStop.city.trim()) return;
                  setItinerary((p) => [...p, newStop]);
                  setNewStop({ day: `Day ${itinerary.length + 2}`, city: '', plan: '' });
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-white"
              >
                Add Stop
              </button>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'time-geo' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="24h World Time Zone & Meeting Overlap Slider">
            <label className="mb-2 flex justify-between text-xs font-semibold">
              <span>UTC Reference Hour</span>
              <span className="font-mono">{String(utcHour).padStart(2, '0')}:00 UTC</span>
            </label>
            <input
              type="range"
              min={0}
              max={23}
              value={utcHour}
              onChange={(e) => setUtcHour(Number(e.target.value))}
              className="mb-4 w-full accent-[var(--accent)]"
            />
            <div className="grid grid-cols-2 gap-2 text-xs">
              {cities.map((c) => {
                const h = (utcHour + c.offset + 24) % 24;
                const polite = h >= 9 && h <= 18;
                return (
                  <div key={c.name} className={`rounded-lg border p-2.5 ${polite ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-[var(--line)]'}`}>
                    <div className="font-bold">{c.name}</div>
                    <div className="font-mono text-sm font-bold">{String(h).padStart(2, '0')}:00</div>
                    <div className="text-[11px] text-[var(--muted)]">{polite ? 'Work hours (9–6)' : 'Off-hours'}</div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Distance, Speed/ETA, Offline Sunrise/Sunset & Weather">
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <input type="number" step="0.01" value={lat1} onChange={(e) => setLat1(Number(e.target.value))} placeholder="Origin Lat" className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
              <input type="number" step="0.01" value={lon1} onChange={(e) => setLon1(Number(e.target.value))} placeholder="Origin Lon" className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
              <input type="number" step="0.01" value={lat2} onChange={(e) => setLat2(Number(e.target.value))} placeholder="Dest Lat" className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
              <input type="number" step="0.01" value={lon2} onChange={(e) => setLon2(Number(e.target.value))} placeholder="Dest Lon" className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
            </div>
            <div className="mb-3 flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                Avg Speed (km/h):
                <input type="number" min={5} value={avgSpeedKmh} onChange={(e) => setAvgSpeedKmh(Math.max(5, Number(e.target.value)))} className="w-20 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
              </label>
              <button type="button" onClick={fetchOpenMeteo} className="ml-auto rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-white">
                Sync Live Weather
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <StatTile label="Distance & ETA" value={`${distKm.toFixed(1)} km`} sub={`ETA ${(distKm / avgSpeedKmh).toFixed(1)} hrs @ ${avgSpeedKmh} km/h`} />
              <StatTile label="Offline Solar (Dest)" value={`${solarTimes.sunrise} / ${solarTimes.sunset}`} sub={`Daylight: ${solarTimes.daylight}`} />
            </div>
            {weatherInfo && (
              <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs font-medium">{weatherInfo}</div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
