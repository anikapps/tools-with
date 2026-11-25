import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Play, Trophy, Zap, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Shuffle } from 'lucide-react';
import { ToolDef } from '../../data/toolsCatalog';
import { Panel, StatTile, ToolHeader } from '../ui/SharedUi';

type FunTab = '2048' | 'reaction' | 'memory' | 'math' | 'snake' | 'scramble';

// ==================== 2048 HELPERS ====================
function spawnTile(board: number[][]): number[][] {
  const next = board.map((r) => [...r]);
  const empty: [number, number][] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (next[r][c] === 0) empty.push([r, c]);
    }
  }
  if (!empty.length) return next;
  const [rr, cc] = empty[Math.floor(Math.random() * empty.length)];
  next[rr][cc] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

function createInitial2048(): number[][] {
  const blank = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  return spawnTile(spawnTile(blank));
}

function slideRowLeft(row: number[]): { row: number[]; gain: number } {
  const nonZero = row.filter((x) => x !== 0);
  const out: number[] = [];
  let gain = 0;
  for (let i = 0; i < nonZero.length; i++) {
    if (i + 1 < nonZero.length && nonZero[i] === nonZero[i + 1]) {
      const merged = nonZero[i] * 2;
      out.push(merged);
      gain += merged;
      i++;
    } else {
      out.push(nonZero[i]);
    }
  }
  while (out.length < 4) out.push(0);
  return { row: out, gain };
}

function move2048(board: number[][], dir: 'left' | 'right' | 'up' | 'down'): { board: number[][]; gain: number; moved: boolean } {
  let gain = 0;
  const next = board.map((r) => [...r]);
  const read = (i: number, j: number) => {
    if (dir === 'left') return next[i][j];
    if (dir === 'right') return next[i][3 - j];
    if (dir === 'up') return next[j][i];
    return next[3 - j][i];
  };
  const write = (i: number, j: number, val: number) => {
    if (dir === 'left') next[i][j] = val;
    else if (dir === 'right') next[i][3 - j] = val;
    else if (dir === 'up') next[j][i] = val;
    else next[3 - j][i] = val;
  };
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const line = [0, 1, 2, 3].map((j) => read(i, j));
    const res = slideRowLeft(line);
    gain += res.gain;
    for (let j = 0; j < 4; j++) {
      if (line[j] !== res.row[j]) moved = true;
      write(i, j, res.row[j]);
    }
  }
  return { board: moved ? spawnTile(next) : next, gain, moved };
}

const TILE_STYLE: Record<number, string> = {
  0: 'bg-white/75 border border-slate-300/60 text-transparent dark:bg-slate-900/60 dark:border-slate-700/60',
  2: 'bg-white border border-slate-300 text-slate-900 shadow-xs dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100',
  4: 'bg-indigo-100 border border-indigo-200 text-indigo-950 shadow-xs dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-100',
  8: 'bg-indigo-400 text-white shadow-xs',
  16: 'bg-indigo-600 text-white shadow-xs',
  32: 'bg-sky-500 text-white shadow-xs',
  64: 'bg-emerald-500 text-white shadow-xs',
  128: 'bg-amber-400 text-slate-950 shadow-xs',
  256: 'bg-amber-500 text-white shadow-xs',
  512: 'bg-orange-500 text-white shadow-xs',
  1024: 'bg-rose-500 text-white shadow-xs',
  2048: 'bg-violet-600 text-white shadow-sm',
};

// ==================== MEMORY MATCH DATA ====================
const MEMORY_SYMBOLS = ['⚡', '🎯', '🚀', '🎨', '💎', '🌍', '🎵', '🔥'];
function createMemoryDeck() {
  const pairs = [...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS];
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs.map((symbol, id) => ({ id, symbol, matched: false }));
}

// ==================== WORD SCRAMBLE DATA ====================
const SCRAMBLE_WORDS = [
  { word: 'TYPESCRIPT', hint: 'Typed superset of JavaScript' },
  { word: 'ALGORITHM', hint: 'Step-by-step problem-solving procedure' },
  { word: 'SPREADSHEET', hint: 'Grid of rows and columns like XLSX' },
  { word: 'COMPRESS', hint: 'Shrink a file into fewer bytes' },
  { word: 'BANGLADESH', hint: 'Home of the Sundarbans & Padma River' },
  { word: 'CRYPTOGRAPHY', hint: 'Science of secure hashing & encryption' },
  { word: 'INTERFACE', hint: 'Where humans interact with software' },
  { word: 'WORKFLOW', hint: 'Automated sequence of tasks' },
  { word: 'CALCULUS', hint: 'Branch of math with derivatives & integrals' },
  { word: 'VECTORIZE', hint: 'Turn bitmap shapes into scalable SVG paths' },
];

function scrambleWord(word: string): string {
  const arr = word.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const out = arr.join('');
  return out === word ? arr.reverse().join('') : out;
}

export function FunArcadeWorkspace({ tool }: { tool: ToolDef }) {
  const [tab, setTab] = useState<FunTab>((tool.tab as FunTab) || '2048');

  useEffect(() => {
    setTab((tool.tab as FunTab) || '2048');
  }, [tool.id, tool.tab]);

  // ---- 2048 State ----
  const [board, setBoard] = useState<number[][]>(createInitial2048);
  const [score2048, setScore2048] = useState(0);
  const [best2048, setBest2048] = useState(() => Number(localStorage.getItem('twa_best_2048') || 0));

  const apply2048 = useCallback(
    (dir: 'left' | 'right' | 'up' | 'down') => {
      setBoard((prev) => {
        const res = move2048(prev, dir);
        if (res.moved) {
          setScore2048((s) => {
            const next = s + res.gain;
            if (next > best2048) {
              setBest2048(next);
              try {
                localStorage.setItem('twa_best_2048', String(next));
              } catch {
                // ignore
              }
            }
            return next;
          });
        }
        return res.board;
      });
    },
    [best2048]
  );

  useEffect(() => {
    if (tab !== '2048') return;
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') apply2048('left');
        if (e.key === 'ArrowRight') apply2048('right');
        if (e.key === 'ArrowUp') apply2048('up');
        if (e.key === 'ArrowDown') apply2048('down');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, apply2048]);

  // ---- Reaction Arena State ----
  const [rxState, setRxState] = useState<'idle' | 'waiting' | 'ready' | 'tooSoon' | 'done'>('idle');
  const [rxTimes, setRxTimes] = useState<number[]>([]);
  const rxStartRef = useRef(0);
  const rxTimerRef = useRef<number | null>(null);

  const startReaction = () => {
    if (rxTimerRef.current) window.clearTimeout(rxTimerRef.current);
    setRxState('waiting');
    const delay = 1200 + Math.random() * 2400;
    rxTimerRef.current = window.setTimeout(() => {
      rxStartRef.current = performance.now();
      setRxState('ready');
    }, delay);
  };

  useEffect(() => {
    return () => {
      if (rxTimerRef.current) window.clearTimeout(rxTimerRef.current);
    };
  }, []);

  const tapReaction = () => {
    if (rxState === 'idle' || rxState === 'done' || rxState === 'tooSoon') {
      startReaction();
      return;
    }
    if (rxState === 'waiting') {
      if (rxTimerRef.current) window.clearTimeout(rxTimerRef.current);
      setRxState('tooSoon');
      return;
    }
    if (rxState === 'ready') {
      const ms = Math.round(performance.now() - rxStartRef.current);
      setRxTimes((prev) => [ms, ...prev].slice(0, 5));
      setRxState('done');
    }
  };

  // ---- Memory Match State ----
  const [deck, setDeck] = useState(createMemoryDeck);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [memMoves, setMemMoves] = useState(0);
  const memSolved = deck.every((c) => c.matched);

  const flipCard = (idx: number) => {
    if (flipped.length === 2 || flipped.includes(idx) || deck[idx].matched) return;
    const nextFlipped = [...flipped, idx];
    setFlipped(nextFlipped);
    if (nextFlipped.length === 2) {
      setMemMoves((m) => m + 1);
      const [a, b] = nextFlipped;
      if (deck[a].symbol === deck[b].symbol) {
        setDeck((d) => d.map((c, i) => (i === a || i === b ? { ...c, matched: true } : c)));
        setFlipped([]);
      } else {
        setTimeout(() => setFlipped([]), 650);
      }
    }
  };

  // ---- Speed Math Blitz State ----
  const makeMathQ = () => {
    const ops = ['+', '-', '×'] as const;
    const op = ops[Math.floor(Math.random() * ops.length)];
    const a = op === '×' ? 2 + Math.floor(Math.random() * 11) : 6 + Math.floor(Math.random() * 44);
    const b = op === '×' ? 2 + Math.floor(Math.random() * 11) : 4 + Math.floor(Math.random() * 35);
    const ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
    return { text: `${a} ${op} ${b}`, ans };
  };
  const [mathActive, setMathActive] = useState(false);
  const [mathLeft, setMathLeft] = useState(45);
  const [mathScore, setMathScore] = useState(0);
  const [mathStreak, setMathStreak] = useState(0);
  const [mathQ, setMathQ] = useState(makeMathQ);
  const [mathInput, setMathInput] = useState('');

  useEffect(() => {
    if (!mathActive) return;
    const id = window.setInterval(() => {
      setMathLeft((t) => {
        if (t <= 1) {
          setMathActive(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [mathActive]);

  const submitMath = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mathActive) return;
    if (Number(mathInput.trim()) === mathQ.ans) {
      setMathStreak((s) => s + 1);
      setMathScore((sc) => sc + 10 + mathStreak * 2);
    } else {
      setMathStreak(0);
    }
    setMathInput('');
    setMathQ(makeMathQ());
  };

  // ---- Snake Classic Canvas State ----
  const snakeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [snakeRunning, setSnakeRunning] = useState(false);
  const [snakeScore, setSnakeScore] = useState(0);
  const [snakeBest, setSnakeBest] = useState(() => Number(localStorage.getItem('twa_best_snake') || 0));
  const [snakeOver, setSnakeOver] = useState(false);
  const snakeRef = useRef<{ body: [number, number][]; dir: [number, number]; food: [number, number] }>({
    body: [
      [8, 8],
      [7, 8],
      [6, 8],
    ],
    dir: [1, 0],
    food: [13, 8],
  });

  const drawSnake = useCallback(() => {
    const cv = snakeCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const cell = 18;
    const grid = 18;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= grid; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, grid * cell);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(grid * cell, i * cell);
      ctx.stroke();
    }
    const { body, food } = snakeRef.current;
    // Food
    ctx.fillStyle = '#e11d48';
    ctx.beginPath();
    ctx.arc(food[0] * cell + cell / 2, food[1] * cell + cell / 2, cell * 0.36, 0, Math.PI * 2);
    ctx.fill();
    // Snake
    body.forEach(([x, y], idx) => {
      ctx.fillStyle = idx === 0 ? '#4f46e5' : '#6366f1';
      ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
    });
  }, []);

  const resetSnake = () => {
    snakeRef.current = {
      body: [
        [8, 8],
        [7, 8],
        [6, 8],
      ],
      dir: [1, 0],
      food: [13, 8],
    };
    setSnakeScore(0);
    setSnakeOver(false);
    setSnakeRunning(true);
    drawSnake();
  };

  useEffect(() => {
    if (tab === 'snake') drawSnake();
  }, [tab, drawSnake]);

  useEffect(() => {
    if (tab !== 'snake' || !snakeRunning) return;
    const onKey = (e: KeyboardEvent) => {
      const [dx, dy] = snakeRef.current.dir;
      if ((e.key === 'ArrowUp' || e.key === 'w') && dy !== 1) {
        e.preventDefault();
        snakeRef.current.dir = [0, -1];
      } else if ((e.key === 'ArrowDown' || e.key === 's') && dy !== -1) {
        e.preventDefault();
        snakeRef.current.dir = [0, 1];
      } else if ((e.key === 'ArrowLeft' || e.key === 'a') && dx !== 1) {
        e.preventDefault();
        snakeRef.current.dir = [-1, 0];
      } else if ((e.key === 'ArrowRight' || e.key === 'd') && dx !== -1) {
        e.preventDefault();
        snakeRef.current.dir = [1, 0];
      }
    };
    window.addEventListener('keydown', onKey);
    const id = window.setInterval(() => {
      const st = snakeRef.current;
      const head: [number, number] = [st.body[0][0] + st.dir[0], st.body[0][1] + st.dir[1]];
      if (
        head[0] < 0 ||
        head[0] >= 18 ||
        head[1] < 0 ||
        head[1] >= 18 ||
        st.body.some(([bx, by]) => bx === head[0] && by === head[1])
      ) {
        setSnakeRunning(false);
        setSnakeOver(true);
        return;
      }
      const ate = head[0] === st.food[0] && head[1] === st.food[1];
      st.body = ate ? [head, ...st.body] : [head, ...st.body.slice(0, -1)];
      if (ate) {
        setSnakeScore((s) => {
          const next = s + 10;
          if (next > snakeBest) {
            setSnakeBest(next);
            try {
              localStorage.setItem('twa_best_snake', String(next));
            } catch {
              // ignore
            }
          }
          return next;
        });
        st.food = [Math.floor(Math.random() * 18), Math.floor(Math.random() * 18)];
      }
      drawSnake();
    }, 125);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearInterval(id);
    };
  }, [tab, snakeRunning, snakeBest, drawSnake]);

  // ---- Word Scramble State ----
  const [scrIdx, setScrIdx] = useState(0);
  const [scrMixed, setScrMixed] = useState(() => scrambleWord(SCRAMBLE_WORDS[0].word));
  const [scrGuess, setScrGuess] = useState('');
  const [scrStreak, setScrStreak] = useState(0);
  const [scrFeedback, setScrFeedback] = useState('');

  const nextScramble = (nextIndex?: number) => {
    const idx = nextIndex ?? (scrIdx + 1) % SCRAMBLE_WORDS.length;
    setScrIdx(idx);
    setScrMixed(scrambleWord(SCRAMBLE_WORDS[idx].word));
    setScrGuess('');
    setScrFeedback('');
  };

  return (
    <div>
      <ToolHeader tool={tool} />

      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-xs)]">
        {[
          ['2048', '2048 Tile Puzzle'],
          ['reaction', 'Reflex Speed Arena'],
          ['memory', 'Memory Card Match'],
          ['math', 'Speed Math Blitz'],
          ['snake', 'Snake Classic'],
          ['scramble', 'Word Scramble'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id as FunTab)}
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

      {/* 2048 */}
      {tab === '2048' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <Panel
            title="2048 Puzzle Board"
            className="lg:col-span-7"
            actions={
              <button
                type="button"
                onClick={() => {
                  setBoard(createInitial2048());
                  setScore2048(0);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold hover:bg-[var(--surface-2)]"
              >
                <RotateCcw className="h-3.5 w-3.5" /> New Game
              </button>
            }
          >
            <div className="mx-auto max-w-[360px] rounded-2xl border border-slate-300/80 bg-slate-200/80 p-3 dark:border-slate-700 dark:bg-slate-800/80">
              <div className="grid grid-cols-4 gap-2.5">
                {board.flat().map((val, i) => (
                  <div
                    key={i}
                    className={`num flex h-[74px] items-center justify-center rounded-xl font-display text-xl font-extrabold transition-all duration-150 ${
                      TILE_STYLE[val] || 'bg-violet-700 text-white'
                    }`}
                  >
                    {val > 0 ? val : ''}
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Score & Controls" className="lg:col-span-5">
            <div className="grid grid-cols-2 gap-3 mb-5">
              <StatTile label="Score" value={score2048} />
              <StatTile label="Best Score" value={best2048} />
            </div>
            <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
              Use your keyboard <strong>Arrow keys</strong> or the pad below to slide matching numbers together and reach <strong>2048</strong>.
            </p>
            <div className="mx-auto grid w-44 grid-cols-3 gap-2">
              <div />
              <button type="button" aria-label="Slide Up" onClick={() => apply2048('up')} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--accent)]">
                <ArrowUp className="h-4 w-4" />
              </button>
              <div />
              <button type="button" aria-label="Slide Left" onClick={() => apply2048('left')} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--accent)]">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Slide Down" onClick={() => apply2048('down')} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--accent)]">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Slide Right" onClick={() => apply2048('right')} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--accent)]">
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </Panel>
        </div>
      )}

      {/* REACTION ARENA */}
      {tab === 'reaction' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <Panel title="Reflex Reaction Test" className="lg:col-span-8">
            <button
              type="button"
              onClick={tapReaction}
              className={`flex h-64 w-full flex-col items-center justify-center rounded-2xl border-2 text-center transition-colors ${
                rxState === 'waiting'
                  ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                  : rxState === 'ready'
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : rxState === 'tooSoon'
                  ? 'border-rose-400 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                  : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)] hover:border-[var(--accent)]'
              }`}
            >
              <Zap className="mb-3 h-8 w-8" />
              <div className="font-display text-2xl font-extrabold">
                {rxState === 'idle' && 'Click anywhere here to start'}
                {rxState === 'waiting' && 'Wait for GREEN...'}
                {rxState === 'ready' && 'CLICK NOW!'}
                {rxState === 'tooSoon' && 'Too early! Click to retry'}
                {rxState === 'done' && `${rxTimes[0]} ms — Click for next round`}
              </div>
              <p className="mt-1.5 text-xs opacity-80">
                {rxState === 'done'
                  ? rxTimes[0] < 220
                    ? 'Lightning reflexes!'
                    : rxTimes[0] < 300
                    ? 'Sharp response speed!'
                    : 'Warming up — try again!'
                  : 'Measures precision millisecond response time locally'}
              </p>
            </button>
          </Panel>
          <Panel title="Session Telemetry" className="lg:col-span-4">
            <div className="space-y-3">
              <StatTile
                label="Best Time"
                value={rxTimes.length ? `${Math.min(...rxTimes)} ms` : '—'}
              />
              <StatTile
                label="5-Round Average"
                value={rxTimes.length ? `${Math.round(rxTimes.reduce((a, b) => a + b, 0) / rxTimes.length)} ms` : '—'}
              />
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/60 p-3 text-xs">
                <div className="mb-1.5 font-semibold text-[var(--muted)]">Recent Rounds</div>
                {rxTimes.length === 0 ? (
                  <div className="text-[var(--muted)]">No rounds recorded yet</div>
                ) : (
                  <div className="flex flex-wrap gap-2 font-mono font-bold">
                    {rxTimes.map((t, i) => (
                      <span key={i}>{t}ms</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* MEMORY CARD MATCH */}
      {tab === 'memory' && (
        <Panel
          title="Memory Card Match (4×4)"
          actions={
            <div className="flex items-center gap-3 text-xs">
              <span className="num font-semibold text-[var(--muted)]">Moves: {memMoves}</span>
              <button
                type="button"
                onClick={() => {
                  setDeck(createMemoryDeck());
                  setFlipped([]);
                  setMemMoves(0);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1 font-semibold hover:bg-[var(--surface-2)]"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Shuffle
              </button>
            </div>
          }
        >
          {memSolved && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-[var(--success-soft)] px-4 py-3 text-xs font-bold text-[var(--success)]">
              <Trophy className="h-4 w-4" /> All 8 pairs matched in {memMoves} moves!
            </div>
          )}
          <div className="mx-auto grid max-w-md grid-cols-4 gap-3">
            {deck.map((card, i) => {
              const show = card.matched || flipped.includes(i);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => flipCard(i)}
                  className={`flex h-20 items-center justify-center rounded-xl border text-2xl font-bold transition-all duration-150 ${
                    card.matched
                      ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40'
                      : show
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--accent)]/60'
                  }`}
                >
                  {show ? card.symbol : '?'}
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {/* SPEED MATH BLITZ */}
      {tab === 'math' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <Panel title="45-Second Speed Math Blitz" className="lg:col-span-7">
            {!mathActive ? (
              <div className="py-10 text-center">
                <div className="font-display text-2xl font-extrabold text-[var(--ink)]">
                  {mathScore > 0 ? `Final Score: ${mathScore}` : 'Ready to test your mental math?'}
                </div>
                <p className="mt-1.5 text-xs text-[var(--muted)]">
                  Answer as many equations as you can in 45 seconds. Consecutive streaks boost points!
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMathScore(0);
                    setMathStreak(0);
                    setMathLeft(45);
                    setMathQ(makeMathQ());
                    setMathInput('');
                    setMathActive(true);
                  }}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)]"
                >
                  <Play className="h-4 w-4" /> Start Challenge
                </button>
              </div>
            ) : (
              <form onSubmit={submitMath} className="space-y-4 py-4 text-center">
                <div className="num font-display text-4xl font-extrabold tracking-tight text-[var(--ink)]">
                  {mathQ.text} = ?
                </div>
                <div className="mx-auto flex max-w-xs gap-2">
                  <input
                    autoFocus
                    type="number"
                    value={mathInput}
                    onChange={(e) => setMathInput(e.target.value)}
                    placeholder="Answer..."
                    className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5 text-center font-mono text-lg font-bold focus:border-[var(--accent)] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)]"
                  >
                    Go
                  </button>
                </div>
              </form>
            )}
          </Panel>
          <Panel title="Live Scoreboard" className="lg:col-span-5">
            <div className="grid grid-cols-3 gap-2.5">
              <StatTile label="Time Left" value={`${mathLeft}s`} />
              <StatTile label="Score" value={mathScore} />
              <StatTile label="Streak" value={`${mathStreak}x`} />
            </div>
          </Panel>
        </div>
      )}

      {/* SNAKE CLASSIC */}
      {tab === 'snake' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <Panel
            title="Snake Classic Canvas"
            className="lg:col-span-7"
            actions={
              <button
                type="button"
                onClick={resetSnake}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
              >
                <Play className="h-3.5 w-3.5" /> {snakeRunning ? 'Restart' : 'Play Snake'}
              </button>
            }
          >
            <div className="flex flex-col items-center">
              <canvas
                ref={snakeCanvasRef}
                width={324}
                height={324}
                className="rounded-xl border border-[var(--line)] bg-slate-50 shadow-[var(--shadow-xs)]"
              />
              {snakeOver && (
                <div className="mt-3 text-xs font-bold text-[var(--danger)]">
                  Game over! Score: {snakeScore} — Click Play Snake to go again.
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Score & Touch Pad" className="lg:col-span-5">
            <div className="grid grid-cols-2 gap-3 mb-5">
              <StatTile label="Score" value={snakeScore} />
              <StatTile label="High Score" value={snakeBest} />
            </div>
            <p className="mb-4 text-xs text-[var(--muted)]">
              Steer with Arrow keys, WASD, or the directional pad below.
            </p>
            <div className="mx-auto grid w-44 grid-cols-3 gap-2">
              <div />
              <button type="button" aria-label="Snake Up" onClick={() => { if (snakeRef.current.dir[1] !== 1) snakeRef.current.dir = [0, -1]; }} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
                <ArrowUp className="h-4 w-4" />
              </button>
              <div />
              <button type="button" aria-label="Snake Left" onClick={() => { if (snakeRef.current.dir[0] !== 1) snakeRef.current.dir = [-1, 0]; }} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Snake Down" onClick={() => { if (snakeRef.current.dir[1] !== -1) snakeRef.current.dir = [0, 1]; }} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Snake Right" onClick={() => { if (snakeRef.current.dir[0] !== -1) snakeRef.current.dir = [1, 0]; }} className="flex h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </Panel>
        </div>
      )}

      {/* WORD SCRAMBLE */}
      {tab === 'scramble' && (
        <Panel
          title="Word Scramble Challenge"
          actions={
            <button
              type="button"
              onClick={() => nextScramble()}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold hover:bg-[var(--surface-2)]"
            >
              <Shuffle className="h-3.5 w-3.5" /> Skip Word
            </button>
          }
        >
          <div className="mx-auto max-w-md py-4 text-center space-y-4">
            <div className="text-xs font-semibold text-[var(--muted)]">
              Hint: {SCRAMBLE_WORDS[scrIdx].hint}
            </div>
            <div className="font-mono text-3xl font-extrabold tracking-[0.22em] text-[var(--accent)]">
              {scrMixed}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (scrGuess.trim().toUpperCase() === SCRAMBLE_WORDS[scrIdx].word) {
                  setScrStreak((s) => s + 1);
                  setScrFeedback('Correct! Loading next word...');
                  setTimeout(() => nextScramble(), 650);
                } else {
                  setScrStreak(0);
                  setScrFeedback('Not quite — try again!');
                }
              }}
              className="flex gap-2"
            >
              <input
                value={scrGuess}
                onChange={(e) => setScrGuess(e.target.value)}
                placeholder="Type your guess..."
                className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5 text-center font-mono text-sm font-bold uppercase focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-bold text-white hover:bg-[var(--accent-hover)]"
              >
                Check
              </button>
            </form>
            {scrFeedback && <div className="text-xs font-semibold text-[var(--ink-2)]">{scrFeedback}</div>}
            <div className="text-xs text-[var(--muted)]">Current Streak: <strong className="num text-[var(--ink)]">{scrStreak}</strong></div>
          </div>
        </Panel>
      )}
    </div>
  );
}
