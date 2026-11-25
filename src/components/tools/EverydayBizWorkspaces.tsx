import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer, RefreshCw, Volume2, Send, FileDown, Award } from 'lucide-react';
import { ToolDef } from '../../data/toolsCatalog';
import { ToolHeader, Panel, StatTile, CopyButton } from '../ui/SharedUi';
import { useWorkspace } from '../../context/WorkspaceContext';
import { renderCode128Svg, renderQrSvg } from '../../utils/barcodeQr';
import {
  morseToText,
  numToWordsBn,
  numToWordsEnBD,
  numToWordsEnIntl,
  phoneticToBangla,
  textToMorse,
  toBanglaDigits,
} from '../../utils/formatters';
import { calcBajusGoldPrice, calcZakat } from '../../utils/calculators';
import { canvasToBlob, downloadBlob, downloadBytes, downloadText } from '../../utils/download';
import { renderBlocksToPdf } from '../../utils/converterEngine';

// ==================== EVERYDAY UTILITIES (27) ====================
export function EverydayWorkspace({ tool }: { tool: ToolDef }) {
  const [tab, setTab] = useState(tool.tab || 'qr');

  // QR & Barcode
  const [qrInput, setQrInput] = useState('https://anik.studio');
  const [qrColor, setQrColor] = useState('#0f172a');
  const [qrRounded, setQrRounded] = useState(false);
  const [bcInput, setBcInput] = useState('ANIK-2025-8842');
  const [scanResult, setScanResult] = useState('');

  // Security: Password, Diceware, Strength & Multi-Hashes
  const [pwLen, setPwLen] = useState(16);
  const [pwOut, setPwOut] = useState('');
  const [pwCheck, setPwCheck] = useState('');
  const [hashInput, setHashInput] = useState('Tools with Anik');
  const [hashes, setHashes] = useState({ sha1: '', sha256: '', sha512: '' });

  // Currency & Units
  const [curAmt, setCurAmt] = useState(100);
  const [curFrom, setCurFrom] = useState('USD');
  const [curTo, setCurTo] = useState('BDT');
  const [rates, setRates] = useState<Record<string, number>>({
    USD: 1,
    BDT: 121.5,
    EUR: 0.92,
    GBP: 0.79,
    SAR: 3.75,
    AED: 3.67,
    INR: 85.4,
    JPY: 152.0,
  });
  const [unitCat, setUnitCat] = useState<'area-bd' | 'length' | 'weight' | 'temp'>('area-bd');
  const [unitVal, setUnitVal] = useState(1);

  // Bangla Phonetic & Islamic Tools
  const [banglish, setBanglish] = useState('Amar shonar bangla');
  const [hijriDateIso, setHijriDateIso] = useState(() => new Date().toISOString().slice(0, 10));
  const [zakatWealth, setZakatWealth] = useState({ cash: 250000, gold: 180000, stocks: 50000, debt: 20000, nisab: 110000 });
  const [prayerCity, setPrayerCity] = useState('Dhaka');
  const [prayers, setPrayers] = useState({ Fajr: '04:12', Dhuhr: '12:01', Asr: '15:24', Maghrib: '18:32', Isha: '19:49' });

  // Random / Wheel / Lucky Draw / RNG / Teams / Emoji
  const [wheelNames, setWheelNames] = useState('Anik, Nadia, Tariq, Farhan, Sami, Raisa');
  const [wheelAngle, setWheelAngle] = useState(0);
  const [wheelWinner, setWheelWinner] = useState('');
  const [drawCount, setDrawCount] = useState(2);
  const [drawnWinners, setDrawnWinners] = useState<string[]>([]);
  const [teamCount, setTeamCount] = useState(2);
  const [teamsOut, setTeamsOut] = useState<string[][]>([]);
  const [rngMin, setRngMin] = useState(1);
  const [rngMax, setRngMax] = useState(100);
  const [rngCount, setRngCount] = useState(5);
  const [rngRes, setRngRes] = useState<number[]>([7, 24, 53, 81, 95]);
  const [diceRes, setDiceRes] = useState<number[]>([4, 6]);
  const [coinRes, setCoinRes] = useState('Heads');

  // Morse & Whiteboard & Quote
  const [morsePlain, setMorsePlain] = useState('HELLO ANIK');
  const wbCanvasRef = useRef<HTMLCanvasElement>(null);
  const wbDrawingRef = useRef(false);
  const [wbColor, setWbColor] = useState('#4f46e5');
  const [wbSize, setWbSize] = useState(3);
  const [quoteText, setQuoteText] = useState('Simple tools done right save hours every week.');
  const [quoteAuthor, setQuoteAuthor] = useState('Tools with Anik');
  const [quoteTheme, setQuoteTheme] = useState<'indigo' | 'slate' | 'emerald' | 'amber'>('indigo');

  const exportQuotePng = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 675;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grads: Record<string, [string, string]> = {
      indigo: ['#3730a3', '#0284c7'],
      slate: ['#0f172a', '#334155'],
      emerald: ['#065f46', '#0d9488'],
      amber: ['#9a3412', '#d97706'],
    };
    const [c1, c2] = grads[quoteTheme];
    const g = ctx.createLinearGradient(0, 0, 1200, 675);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1200, 675);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    ctx.strokeRect(48, 48, 1104, 579);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = 'bold 140px Georgia, serif';
    ctx.fillText('“', 82, 190);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px system-ui, -apple-system, sans-serif';
    const words = quoteText.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > 960 && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    let y = 260;
    for (const ln of lines.slice(0, 5)) {
      ctx.fillText(ln, 110, y);
      y += 64;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 26px system-ui, -apple-system, sans-serif';
    ctx.fillText(`— ${quoteAuthor}`, 110, Math.min(560, y + 36));
    downloadBlob(await canvasToBlob(canvas, 'image/png', 1), 'quote_card.png');
  };

  // Printable Calendar & Paper
  const [calMonth, setCalMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [printMode, setPrintMode] = useState<'calendar' | 'paper'>(tool.id === 'ev-paper' ? 'paper' : 'calendar');
  const [paperStyle, setPaperStyle] = useState<'ruled' | 'grid' | 'dot' | 'music'>('ruled');

  useEffect(() => {
    setTab(tool.tab || 'qr');
    if (tool.id === 'ev-paper') setPrintMode('paper');
    else if (tool.id === 'ev-calendar') setPrintMode('calendar');
  }, [tool.id, tool.tab]);

  useEffect(() => {
    const data = new TextEncoder().encode(hashInput);
    const toHex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    Promise.all([
      crypto.subtle.digest('SHA-1', data),
      crypto.subtle.digest('SHA-256', data),
      crypto.subtle.digest('SHA-512', data),
    ]).then(([b1, b256, b512]) => setHashes({ sha1: toHex(b1), sha256: toHex(b256), sha512: toHex(b512) }));
  }, [hashInput]);

  const qrSvg = useMemo(() => renderQrSvg(qrInput, qrColor, '#ffffff', qrRounded), [qrInput, qrColor, qrRounded]);
  const bcSvg = useMemo(() => renderCode128Svg(bcInput), [bcInput]);

  const exportSvgAsPng = async (svgMarkup: string, width: number, height: number, filename: string) => {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('SVG render failed'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      downloadBlob(await canvasToBlob(canvas, 'image/png', 1), filename);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*_-';
    const arr = new Uint32Array(pwLen);
    crypto.getRandomValues(arr);
    const next = Array.from(arr, (n) => chars[n % chars.length]).join('');
    setPwOut(next);
    setPwCheck(next);
  };

  const generateDiceware = () => {
    const words = [
      'river', 'cobalt', 'mango', 'orbit', 'cedar', 'quartz', 'tiger', 'velvet', 'falcon', 'amber',
      'lotus', 'prism', 'summit', 'breeze', 'coral', 'harbor', 'meadow', 'pixel', 'cipher', 'zenith',
      'bamboo', 'glacier', 'horizon', 'lantern', 'marble', 'nectar', 'onyx', 'pebble', 'saffron', 'willow',
    ];
    const arr = new Uint32Array(5);
    crypto.getRandomValues(arr);
    const phrase = Array.from(arr, (n) => words[n % words.length]).join('-');
    setPwOut(phrase);
    setPwCheck(phrase);
  };

  const pwEntropy = useMemo(() => {
    const p = pwCheck || pwOut;
    if (!p) return { bits: 0, label: 'Empty' };
    let pool = 0;
    if (/[a-z]/.test(p)) pool += 26;
    if (/[A-Z]/.test(p)) pool += 26;
    if (/[0-9]/.test(p)) pool += 10;
    if (/[^A-Za-z0-9]/.test(p)) pool += 32;
    const bits = Math.round(p.length * Math.log2(Math.max(2, pool)));
    const label = bits < 40 ? 'Weak' : bits < 60 ? 'Fair' : bits < 80 ? 'Strong' : 'Very Strong';
    return { bits, label };
  }, [pwCheck, pwOut]);

  useEffect(() => {
    if (!pwOut) generatePassword();
  }, []);

  const syncRates = async () => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      const data = await res.json();
      if (data?.rates) setRates((prev) => ({ ...prev, ...data.rates }));
    } catch {
      // Keep offline rates fallback
    }
  };

  const syncPrayerTimes = async () => {
    try {
      const res = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(prayerCity)}&country=Bangladesh&method=1`);
      const d = await res.json();
      if (d?.data?.timings) {
        const t = d.data.timings;
        setPrayers({ Fajr: t.Fajr, Dhuhr: t.Dhuhr, Asr: t.Asr, Maghrib: t.Maghrib, Isha: t.Isha });
      }
    } catch {
      // keep fallback
    }
  };

  const spinWheel = () => {
    const items = wheelNames.split(',').map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    const idx = Math.floor(Math.random() * items.length);
    const slice = 360 / items.length;
    setWheelAngle((a) => a + 1080 + (360 - (idx + 0.5) * slice));
    setTimeout(() => setWheelWinner(items[idx]), 600);
  };

  const runLuckyDraw = () => {
    const items = wheelNames.split(',').map((s) => s.trim()).filter(Boolean);
    const pool = [...items].sort(() => Math.random() - 0.5);
    setDrawnWinners(pool.slice(0, Math.min(pool.length, Math.max(1, drawCount))));
  };

  const generateTeams = () => {
    const items = wheelNames.split(',').map((s) => s.trim()).filter(Boolean);
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    const n = Math.max(2, Math.min(teamCount, Math.max(2, shuffled.length)));
    const buckets: string[][] = Array.from({ length: n }, () => []);
    shuffled.forEach((name, idx) => buckets[idx % n].push(name));
    setTeamsOut(buckets);
  };

  const rollRng = () => {
    const lo = Math.min(rngMin, rngMax);
    const hi = Math.max(rngMin, rngMax);
    const arr: number[] = [];
    for (let i = 0; i < Math.max(1, Math.min(50, rngCount)); i++) {
      arr.push(lo + Math.floor(Math.random() * (hi - lo + 1)));
    }
    setRngRes(arr);
  };

  const playMorseAudio = () => {
    const code = textToMorse(morsePlain);
    const ctx = new AudioContext();
    let t = ctx.currentTime + 0.05;
    for (const ch of code) {
      if (ch === '.' || ch === '-') {
        const dur = ch === '.' ? 0.08 : 0.22;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.value = 680;
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
        t += dur + 0.07;
      } else {
        t += ch === '/' ? 0.28 : 0.14;
      }
    }
  };

  const downloadMorseWav = () => {
    const code = textToMorse(morsePlain);
    const sr = 22050;
    const samples: number[] = [];
    const pushTone = (sec: number, freq: number) => {
      const len = Math.floor(sec * sr);
      for (let i = 0; i < len; i++) {
        samples.push(freq > 0 ? Math.sin((2 * Math.PI * freq * i) / sr) * 0.45 : 0);
      }
    };
    for (const ch of code) {
      if (ch === '.') {
        pushTone(0.08, 680);
        pushTone(0.07, 0);
      } else if (ch === '-') {
        pushTone(0.22, 680);
        pushTone(0.07, 0);
      } else {
        pushTone(ch === '/' ? 0.28 : 0.14, 0);
      }
    }
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buf);
    const writeStr = (off: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
    downloadBlob(new Blob([buf], { type: 'audio/wav' }), 'morse_code.wav');
  };

  const handleScanImage = async (file: File) => {
    if ('BarcodeDetector' in window) {
      try {
        const bmp = await createImageBitmap(file);
        // @ts-expect-error BarcodeDetector global
        const det = new window.BarcodeDetector();
        const found = await det.detect(bmp);
        setScanResult(found.length ? found.map((f: { rawValue: string }) => f.rawValue).join(', ') : 'No QR/Barcode detected in image.');
      } catch {
        setScanResult('Could not decode image via BarcodeDetector.');
      }
    } else {
      setScanResult('Browser BarcodeDetector API unavailable in this runtime.');
    }
  };

  const hijriStr = useMemo(() => {
    try {
      const dt = new Date(`${hijriDateIso}T12:00:00`);
      return new Intl.DateTimeFormat('en-TN-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(dt);
    } catch {
      return 'Hijri calendar';
    }
  }, [hijriDateIso]);

  const zakatRes = useMemo(
    () =>
      calcZakat({
        cashBank: zakatWealth.cash,
        goldSilverValue: zakatWealth.gold,
        investments: zakatWealth.stocks,
        businessStock: 0,
        liabilities: zakatWealth.debt,
        nisabThreshold: zakatWealth.nisab,
      }),
    [zakatWealth]
  );

  return (
    <div>
      <ToolHeader tool={tool} />
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5">
        {[
          ['qr', 'QR & Code-128 Barcode'],
          ['security', 'Password & SHA Hash'],
          ['convert', 'Currency & BD/Intl Units'],
          ['bangla-islamic', 'Bangla Phonetic / Prayer / Zakat'],
          ['random', 'Spin Wheel / Dice / Coin / Emoji'],
          ['creative', 'Morse / Whiteboard / Quote'],
          ['printables', 'Calendar / Paper / Device'],
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

      {tab === 'qr' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Offline QR Code Generator (SVG / High-Res PNG)">
            <div className="space-y-3 text-xs">
              <input value={qrInput} onChange={(e) => setQrInput(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2" />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 font-semibold">Color <input type="color" value={qrColor} onChange={(e) => setQrColor(e.target.value)} /></label>
                <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={qrRounded} onChange={(e) => setQrRounded(e.target.checked)} /> Rounded Dots</label>
              </div>
              <div className="mx-auto w-48 rounded-xl border border-[var(--line)] bg-white p-3" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => downloadText(qrSvg, 'qr_code.svg', 'image/svg+xml')} className="rounded-lg bg-[var(--accent)] py-2 font-bold text-white">
                  Download .SVG
                </button>
                <button type="button" onClick={() => exportSvgAsPng(qrSvg, 1024, 1024, 'qr_code.png')} className="rounded-lg border border-[var(--line)] py-2 font-semibold">
                  Download .PNG (1024px)
                </button>
              </div>
            </div>
          </Panel>
          <Panel title="Code-128B Barcode & Scanner">
            <div className="space-y-3 text-xs">
              <input value={bcInput} onChange={(e) => setBcInput(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
              <div className="rounded-xl border border-[var(--line)] bg-white p-4" dangerouslySetInnerHTML={{ __html: bcSvg }} />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => downloadText(bcSvg, 'barcode.svg', 'image/svg+xml')} className="rounded-lg border border-[var(--line)] py-2 font-semibold">
                  Download .SVG
                </button>
                <button type="button" onClick={() => exportSvgAsPng(bcSvg, 1200, 360, 'barcode.png')} className="rounded-lg border border-[var(--line)] py-2 font-semibold">
                  Download .PNG
                </button>
              </div>
              <div className="border-t border-[var(--line)] pt-3">
                <div className="mb-1 font-semibold">Scan QR / Barcode from Image</div>
                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleScanImage(e.target.files[0])} />
                {scanResult && <div className="mt-2 rounded bg-[var(--surface-2)] p-2 font-mono">{scanResult}</div>}
              </div>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'security' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Password / Diceware Generator & Strength Meter">
            <div className="space-y-3 text-xs">
              <label className="flex justify-between font-semibold">
                <span>Password Length</span>
                <span className="font-mono">{pwLen} chars</span>
              </label>
              <input type="range" min={8} max={48} value={pwLen} onChange={(e) => setPwLen(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
              <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-2)] p-3 font-mono text-sm font-bold">
                <span className="flex-1 break-all">{pwOut}</span>
                <CopyButton text={pwOut} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={generatePassword} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-white">
                  <RefreshCw className="h-3.5 w-3.5" /> Random Password
                </button>
                <button type="button" onClick={generateDiceware} className="rounded-lg border border-[var(--line)] px-3.5 py-2 font-semibold">
                  5-Word Diceware Passphrase
                </button>
              </div>
              <div className="border-t border-[var(--line)] pt-3">
                <label className="mb-1 block font-semibold">Check Any Password Strength & Bit Entropy</label>
                <input value={pwCheck} onChange={(e) => setPwCheck(e.target.value)} placeholder="Type password to test entropy..." className="mb-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
                <div className="flex items-center justify-between text-[11px] font-semibold">
                  <span>Strength: <strong>{pwEntropy.label}</strong></span>
                  <span className="font-mono">{pwEntropy.bits} bits entropy</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className={`h-full ${pwEntropy.bits < 40 ? 'bg-rose-500' : pwEntropy.bits < 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, pwEntropy.bits)}%` }}
                  />
                </div>
              </div>
            </div>
          </Panel>
          <Panel title="Cryptographic Text Hasher (SHA-1 / SHA-256 / SHA-512)">
            <input value={hashInput} onChange={(e) => setHashInput(e.target.value)} className="mb-3 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs" />
            <div className="space-y-2.5 text-xs">
              <div>
                <div className="mb-1 flex justify-between font-semibold"><span>SHA-256</span><CopyButton text={hashes.sha256} label="Copy" /></div>
                <div className="break-all rounded-lg bg-[var(--surface-2)] p-2.5 font-mono text-[11px]">{hashes.sha256}</div>
              </div>
              <div>
                <div className="mb-1 flex justify-between font-semibold"><span>SHA-512</span><CopyButton text={hashes.sha512} label="Copy" /></div>
                <div className="break-all rounded-lg bg-[var(--surface-2)] p-2.5 font-mono text-[11px]">{hashes.sha512}</div>
              </div>
              <div>
                <div className="mb-1 flex justify-between font-semibold"><span>SHA-1</span><CopyButton text={hashes.sha1} label="Copy" /></div>
                <div className="break-all rounded-lg bg-[var(--surface-2)] p-2.5 font-mono text-[11px]">{hashes.sha1}</div>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'convert' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Currency Converter (Live Sync + Offline Fallback)">
            <div className="grid grid-cols-3 gap-2 text-xs mb-3">
              <input type="number" value={curAmt} onChange={(e) => setCurAmt(Number(e.target.value))} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
              <select value={curFrom} onChange={(e) => setCurFrom(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-2">
                {Object.keys(rates).slice(0, 20).map((c) => <option key={c}>{c}</option>)}
              </select>
              <select value={curTo} onChange={(e) => setCurTo(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-2">
                {Object.keys(rates).slice(0, 20).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <StatTile
              label={`${curAmt} ${curFrom} =`}
              value={`${((curAmt / (rates[curFrom] || 1)) * (rates[curTo] || 1)).toFixed(2)} ${curTo}`}
            />
            <button type="button" onClick={syncRates} className="mt-3 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold">
              Sync Live Rates
            </button>
          </Panel>
          <Panel title="Unit Converter (BD Land Katha/Bigha, Length, Weight, Temp)">
            <div className="flex gap-2 mb-3 text-xs">
              <select value={unitCat} onChange={(e) => setUnitCat(e.target.value as typeof unitCat)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                <option value="area-bd">Land Area (Katha / Bigha / Decimal / Sqft)</option>
                <option value="length">Length (m / km / ft / mile)</option>
                <option value="weight">Weight (kg / g / lb / Vori)</option>
                <option value="temp">Temperature (°C / °F / K)</option>
              </select>
              <input type="number" value={unitVal} onChange={(e) => setUnitVal(Number(e.target.value))} className="w-28 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {unitCat === 'area-bd' && (
                <>
                  <StatTile label="Katha → Sq Ft" value={(unitVal * 720).toLocaleString()} />
                  <StatTile label="Katha → Decimal (শতাংশ)" value={(unitVal * 1.6529).toFixed(3)} />
                  <StatTile label="Katha → Bigha" value={(unitVal / 20).toFixed(3)} />
                  <StatTile label="Sq Meters" value={(unitVal * 66.89).toFixed(2)} />
                </>
              )}
              {unitCat === 'length' && (
                <>
                  <StatTile label="Meters → Feet" value={(unitVal * 3.28084).toFixed(3)} />
                  <StatTile label="Kilometers → Miles" value={(unitVal * 0.62137).toFixed(3)} />
                </>
              )}
              {unitCat === 'weight' && (
                <>
                  <StatTile label="Kg → Pounds" value={(unitVal * 2.20462).toFixed(2)} />
                  <StatTile label="Vori → Grams" value={(unitVal * 11.664).toFixed(3)} />
                </>
              )}
              {unitCat === 'temp' && (
                <>
                  <StatTile label="°C → °F" value={((unitVal * 9) / 5 + 32).toFixed(2)} />
                  <StatTile label="°C → Kelvin" value={(unitVal + 273.15).toFixed(2)} />
                </>
              )}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'bangla-islamic' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Bangla Phonetic Keyboard & Keypad">
            <input value={banglish} onChange={(e) => setBanglish(e.target.value)} className="mb-3 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs" />
            <div className="flex items-center justify-between rounded-lg bg-[var(--accent-soft)] p-3 text-base font-bold text-[var(--accent-ink)]">
              <span>{phoneticToBangla(banglish)}</span>
              <CopyButton text={phoneticToBangla(banglish)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {['অ','আ','ই','ঈ','উ','ঊ','এ','ঐ','ও','ঔ','ক','খ','গ','ঘ','চ','ছ','জ','ঝ','ত','থ','দ','ধ','ন','প','ফ','ব','ভ','ম','র','ল','শ','ষ','স','হ','ং','ঁ'].map((ch) => (
                <button key={ch} type="button" onClick={() => setBanglish((s) => s + ch)} className="h-8 w-8 rounded border border-[var(--line)] bg-[var(--surface-2)] text-sm font-bold hover:border-[var(--accent)]">
                  {ch}
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Hijri Date Converter, Prayer Times & Zakat">
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--accent-soft)] p-2.5 text-xs">
              <input type="date" value={hijriDateIso} onChange={(e) => setHijriDateIso(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 font-mono text-[var(--ink)]" />
              <span className="font-bold text-[var(--accent-ink)]">→ {hijriStr}</span>
            </div>
            <div className="mb-3 flex gap-2 text-xs">
              <input value={prayerCity} onChange={(e) => setPrayerCity(e.target.value)} className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5" />
              <button type="button" onClick={syncPrayerTimes} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-white">Sync</button>
            </div>
            <div className="grid grid-cols-5 gap-1.5 mb-4 text-center text-xs">
              {Object.entries(prayers).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                  <div className="font-semibold">{k}</div>
                  <div className="font-mono font-bold">{v}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mb-2">
              <label>Cash <input type="number" value={zakatWealth.cash} onChange={(e) => setZakatWealth((z) => ({ ...z, cash: Number(e.target.value) }))} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" /></label>
              <label>Gold/Silver <input type="number" value={zakatWealth.gold} onChange={(e) => setZakatWealth((z) => ({ ...z, gold: Number(e.target.value) }))} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" /></label>
              <label>Debts <input type="number" value={zakatWealth.debt} onChange={(e) => setZakatWealth((z) => ({ ...z, debt: Number(e.target.value) }))} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" /></label>
            </div>
            <StatTile label="Annual Zakat Due (2.5%)" value={Math.round(zakatRes.zakatDue).toLocaleString()} sub={`Net Zakatable: ${zakatRes.netWealth.toLocaleString()}`} />
          </Panel>
        </div>
      )}

      {tab === 'random' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Spin Wheel, Lucky Draw & Random Team Generator">
            <label className="mb-1 block text-xs font-semibold">Names / Entries (comma separated)</label>
            <input value={wheelNames} onChange={(e) => setWheelNames(e.target.value)} className="mb-3 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs" />
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div
                className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-[var(--accent)] bg-[var(--accent-soft)] text-center text-xs font-bold transition-transform duration-500"
                style={{ transform: `rotate(${wheelAngle}deg)` }}
              >
                Spin
              </div>
              <div className="space-y-2 text-xs flex-1">
                <button type="button" onClick={spinWheel} className="rounded-lg bg-[var(--accent)] px-4 py-1.5 font-bold text-white">
                  Spin Wheel
                </button>
                {wheelWinner && <div className="text-sm font-extrabold text-emerald-600">Wheel Winner: {wheelWinner}</div>}
                <div className="flex items-center gap-2 pt-1">
                  <input type="number" min={1} max={10} value={drawCount} onChange={(e) => setDrawCount(Math.max(1, Number(e.target.value)))} className="w-16 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
                  <button type="button" onClick={runLuckyDraw} className="rounded border border-[var(--line)] px-3 py-1 font-semibold">
                    Lucky Draw
                  </button>
                </div>
                {drawnWinners.length > 0 && <div className="font-mono text-emerald-700">Winners: {drawnWinners.join(', ')}</div>}
              </div>
            </div>
            <div className="border-t border-[var(--line)] pt-3 text-xs">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-semibold">Split into Teams:</span>
                <input type="number" min={2} max={8} value={teamCount} onChange={(e) => setTeamCount(Math.max(2, Number(e.target.value)))} className="w-16 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
                <button type="button" onClick={generateTeams} className="rounded bg-[var(--accent)] px-3 py-1 font-bold text-white">
                  Shuffle Teams
                </button>
              </div>
              {teamsOut.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {teamsOut.map((tm, i) => (
                    <div key={i} className="rounded-lg bg-[var(--surface-2)] p-2">
                      <div className="font-bold text-[var(--accent)]">Team {i + 1}</div>
                      <div>{tm.join(', ')}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Random Numbers (RNG), Dice, Coin & Quick Emojis">
            <div className="mb-4 rounded-lg border border-[var(--line)] p-3 text-xs">
              <div className="mb-2 font-bold">Random Number Generator</div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <label>Min <input type="number" value={rngMin} onChange={(e) => setRngMin(Number(e.target.value))} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" /></label>
                <label>Max <input type="number" value={rngMax} onChange={(e) => setRngMax(Number(e.target.value))} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" /></label>
                <label>Count <input type="number" min={1} max={50} value={rngCount} onChange={(e) => setRngCount(Number(e.target.value))} className="w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" /></label>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={rollRng} className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 font-bold text-white">Generate</button>
                <div className="font-mono font-bold text-[var(--ink)]">{rngRes.join(', ')}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => setDiceRes([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)])}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white"
              >
                Roll 2d6 ({diceRes[0]} + {diceRes[1]} = {diceRes[0] + diceRes[1]})
              </button>
              <button
                type="button"
                onClick={() => setCoinRes(Math.random() < 0.5 ? 'Heads' : 'Tails')}
                className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-semibold"
              >
                Flip Coin ({coinRes})
              </button>
            </div>
            <div className="text-xs font-semibold mb-1.5">Click Emoji to Copy</div>
            <div className="flex flex-wrap gap-1.5">
              {['🚀', '✅', '⚡', '🔥', '📄', '🎯', '💡', '🎉', '🔒', '🇧🇩', '⭐', '❤️'].map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(em)}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-lg hover:border-[var(--accent)]"
                >
                  {em}
                </button>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'creative' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Morse Code Translator, Live Audio & .WAV Download">
            <input value={morsePlain} onChange={(e) => setMorsePlain(e.target.value)} className="mb-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs" />
            <div className="mb-3 rounded-lg bg-[var(--surface-2)] p-3 font-mono text-sm font-bold">{textToMorse(morsePlain)}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={playMorseAudio} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white">
                <Volume2 className="h-3.5 w-3.5" /> Play Audio
              </button>
              <button type="button" onClick={downloadMorseWav} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold">
                <Download className="h-3.5 w-3.5" /> Download .WAV
              </button>
              <button type="button" onClick={() => setMorsePlain(morseToText(textToMorse(morsePlain)))} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold">
                Roundtrip Check
              </button>
            </div>
          </Panel>
          <Panel title="Whiteboard Sketchpad & Quote Card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <input type="color" value={wbColor} onChange={(e) => setWbColor(e.target.value)} />
                <label className="flex items-center gap-1">
                  Size
                  <input type="range" min={1} max={14} value={wbSize} onChange={(e) => setWbSize(Number(e.target.value))} className="w-20 accent-[var(--accent)]" />
                </label>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    if (!wbCanvasRef.current) return;
                    downloadBlob(await canvasToBlob(wbCanvasRef.current, 'image/png', 1), 'whiteboard.png');
                  }}
                  className="rounded border border-[var(--line)] px-2.5 py-1 font-semibold"
                >
                  Save PNG
                </button>
                <button type="button" onClick={() => wbCanvasRef.current?.getContext('2d')?.clearRect(0, 0, 480, 180)} className="rounded border border-[var(--line)] px-2.5 py-1">
                  Clear
                </button>
              </div>
            </div>
            <canvas
              ref={wbCanvasRef}
              width={480}
              height={180}
              onPointerDown={(e) => {
                wbDrawingRef.current = true;
                const r = wbCanvasRef.current!.getBoundingClientRect();
                const ctx = wbCanvasRef.current!.getContext('2d')!;
                ctx.beginPath();
                ctx.moveTo(((e.clientX - r.left) / r.width) * 480, ((e.clientY - r.top) / r.height) * 180);
              }}
              onPointerMove={(e) => {
                if (!wbDrawingRef.current) return;
                const r = wbCanvasRef.current!.getBoundingClientRect();
                const ctx = wbCanvasRef.current!.getContext('2d')!;
                ctx.strokeStyle = wbColor;
                ctx.lineWidth = wbSize;
                ctx.lineCap = 'round';
                ctx.lineTo(((e.clientX - r.left) / r.width) * 480, ((e.clientY - r.top) / r.height) * 180);
                ctx.stroke();
              }}
              onPointerUp={() => {
                wbDrawingRef.current = false;
              }}
              className="w-full cursor-crosshair rounded-lg border border-[var(--line)] bg-white touch-none"
            />
            <div
              className={`mt-3 rounded-2xl p-5 text-white shadow-sm ${
                quoteTheme === 'indigo'
                  ? 'bg-gradient-to-br from-indigo-700 to-sky-600'
                  : quoteTheme === 'slate'
                    ? 'bg-gradient-to-br from-slate-900 to-slate-700'
                    : quoteTheme === 'emerald'
                      ? 'bg-gradient-to-br from-emerald-800 to-teal-600'
                      : 'bg-gradient-to-br from-orange-800 to-amber-600'
              }`}
            >
              <div className="rounded-xl border border-white/20 p-4">
                <div className="font-serif text-3xl leading-none text-white/30">“</div>
                <div className="mt-1 text-base font-bold leading-snug">{quoteText}</div>
                <div className="mt-3 text-xs font-medium text-white/80">— {quoteAuthor}</div>
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
              <input value={quoteText} onChange={(e) => setQuoteText(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5" />
              <input value={quoteAuthor} onChange={(e) => setQuoteAuthor(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5" />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex gap-1.5">
                {(['indigo', 'slate', 'emerald', 'amber'] as const).map((th) => (
                  <button
                    key={th}
                    type="button"
                    onClick={() => setQuoteTheme(th)}
                    className={`rounded-md px-2.5 py-1 font-semibold capitalize border ${
                      quoteTheme === th ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--muted)]'
                    }`}
                  >
                    {th}
                  </button>
                ))}
              </div>
              <button type="button" onClick={exportQuotePng} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-white">
                <Download className="h-3.5 w-3.5" /> Export PNG (1200×675)
              </button>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'printables' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="Printable Monthly Calendar & Ruled / Grid / Dot / Music Paper"
            actions={
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white">
                <Printer className="h-3.5 w-3.5" /> Print Sheet
              </button>
            }
          >
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <div className="flex rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
                <button type="button" onClick={() => setPrintMode('calendar')} className={`rounded-md px-2.5 py-1 font-semibold ${printMode === 'calendar' ? 'bg-[var(--accent)] text-white' : ''}`}>Calendar</button>
                <button type="button" onClick={() => setPrintMode('paper')} className={`rounded-md px-2.5 py-1 font-semibold ${printMode === 'paper' ? 'bg-[var(--accent)] text-white' : ''}`}>Stationery Paper</button>
              </div>
              {printMode === 'calendar' ? (
                <input type="month" value={calMonth} onChange={(e) => setCalMonth(e.target.value)} className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-mono" />
              ) : (
                <select value={paperStyle} onChange={(e) => setPaperStyle(e.target.value as typeof paperStyle)} className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1">
                  <option value="ruled">Ruled Notebook Paper</option>
                  <option value="grid">Engineering Graph Grid</option>
                  <option value="dot">Bullet Journal Dot Grid</option>
                  <option value="music">Blank Music Staff Sheet</option>
                </select>
              )}
            </div>
            {printMode === 'calendar' ? (
              (() => {
                const [yStr, mStr] = calMonth.split('-');
                const yr = Number(yStr) || new Date().getFullYear();
                const mo = (Number(mStr) || 1) - 1;
                const firstDay = new Date(yr, mo, 1).getDay();
                const daysInMonth = new Date(yr, mo + 1, 0).getDate();
                const monthTitle = new Date(yr, mo, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
                return (
                  <div className="print-area rounded-lg border border-[var(--line)] bg-white p-4 text-slate-900">
                    <div className="mb-2 text-sm font-bold">{monthTitle} Planner</div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
                      {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} className="h-9" />)}
                      {Array.from({ length: daysInMonth }, (_, i) => (
                        <div key={i} className="h-9 rounded border border-slate-200 p-1 text-left font-mono text-[10px]">{i + 1}</div>
                      ))}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="print-area h-72 w-full overflow-hidden rounded-lg border border-[var(--line)] bg-white p-4">
                {paperStyle === 'ruled' && (
                  <div className="h-full w-full border-l-2 border-rose-300 pl-3" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 23px, #cbd5e1 24px)' }} />
                )}
                {paperStyle === 'grid' && (
                  <div className="h-full w-full" style={{ backgroundImage: 'linear-gradient(to right, #cbd5e1 1px, transparent 1px), linear-gradient(to bottom, #cbd5e1 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
                )}
                {paperStyle === 'dot' && (
                  <div className="h-full w-full" style={{ backgroundImage: 'radial-gradient(#94a3b8 1.2px, transparent 1.2px)', backgroundSize: '18px 18px' }} />
                )}
                {paperStyle === 'music' && (
                  <div className="flex h-full flex-col justify-around py-2">
                    {Array.from({ length: 4 }, (_, s) => (
                      <div key={s} className="space-y-1.5">
                        {Array.from({ length: 5 }, (_, l) => <div key={l} className="h-px w-full bg-slate-500" />)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>
          <Panel title="Device & Browser Environment Probe">
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Viewport" value={`${window.innerWidth}×${window.innerHeight}`} sub={`DPR ${window.devicePixelRatio}`} />
              <StatTile label="CPU / Online" value={`${navigator.hardwareConcurrency || 4} cores`} sub={navigator.onLine ? 'Online' : 'Offline'} />
            </div>
            <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3 font-mono text-[11px] text-[var(--ink-2)] break-all">
              {navigator.userAgent}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

// ==================== BUSINESS & PRINT (11) ====================
export function BusinessPrintWorkspace({ tool }: { tool: ToolDef }) {
  const { navigateToTool } = useWorkspace();
  const [tab, setTab] = useState(tool.tab || 'invoice');

  // Invoice & Receipt
  const [bizName, setBizName] = useState('Anik Creative Tech Ltd.');
  const [bizTagline, setBizTagline] = useState('Dhaka, Bangladesh · hello@toolswithanik.com');
  const [clientName, setClientName] = useState('Dhaka Retail Solutions');
  const [invNo, setInvNo] = useState('INV-2025-104');
  const [invCurrency, setInvCurrency] = useState('৳');
  const [invTaxPct, setInvTaxPct] = useState(5);
  const [invDiscount, setInvDiscount] = useState(0);
  const [invItems, setInvItems] = useState([
    { desc: 'Web Platform Design & Setup', qty: 1, rate: 45000 },
    { desc: 'PDF & Document Converter Pipeline', qty: 2, rate: 12000 },
  ]);
  const [receiptNo, setReceiptNo] = useState('MR-2025-088');
  const [receiptMethod, setReceiptMethod] = useState('Bank Transfer');
  const [receiptPurpose, setReceiptPurpose] = useState('Software Delivery & Milestone Payment');

  // Gold Calculator (BAJUS)
  const [vori, setVori] = useState(1);
  const [ana, setAna] = useState(4);
  const [roti, setRoti] = useState(0);
  const [point, setPoint] = useState(0);
  const [pricePerVori, setPricePerVori] = useState(145000);
  const [includeVat, setIncludeVat] = useState(true);

  // Number to Words & Cheque
  const [amtWords, setAmtWords] = useState(125500);
  const [payeeName, setPayeeName] = useState('Tariq Hasan');

  // Certificate & Card & Label
  const [certRecipient, setCertRecipient] = useState('Nadia Karim');
  const [certCourse, setCertCourse] = useState('Full-Stack TypeScript Engineering');
  const [certSigner, setCertSigner] = useState('Anik Rahman, Lead Director');
  const [cardRole, setCardRole] = useState('Senior Product Engineer');
  const [cardEmail, setCardEmail] = useState('hello@toolswithanik.com');
  const [cardPhone, setCardPhone] = useState('+880 1700-000000');
  const [cardTheme, setCardTheme] = useState<'midnight' | 'ivory' | 'indigo'>('midnight');
  const [priceLabel, setPriceLabel] = useState({ title: 'Wireless Mechanical Keyboard', sku: 'SKU-4092', price: '৳ 4,250' });

  // Signature Pad
  const sigRef = useRef<HTMLCanvasElement>(null);
  const sigDrawing = useRef(false);

  useEffect(() => {
    setTab(tool.tab || 'invoice');
  }, [tool.id, tool.tab]);

  const invSubtotal = invItems.reduce((s, it) => s + it.qty * it.rate, 0);
  const invTaxAmt = Math.round(((invSubtotal - invDiscount) * invTaxPct) / 100);
  const invTotal = Math.max(0, invSubtotal - invDiscount + invTaxAmt);
  const goldRes = useMemo(
    () => calcBajusGoldPrice({ vori, ana, roti, point, pricePerVori, makingPerGram: 600, includeVat5Pct: includeVat }),
    [vori, ana, roti, point, pricePerVori, includeVat]
  );
  const invQr = useMemo(() => renderQrSvg(`${invNo} | ${bizName} | Total: ${invTotal}`), [invNo, bizName, invTotal]);
  const cardQr = useMemo(() => renderQrSvg(`MECARD:N:${payeeName};ORG:${bizName};TEL:${cardPhone};EMAIL:${cardEmail};;`), [payeeName, bizName, cardPhone, cardEmail]);
  const labelBc = useMemo(() => renderCode128Svg(priceLabel.sku), [priceLabel.sku]);

  const exportInvoicePdf = async () => {
    const blocks = [
      { type: 'h1' as const, text: bizName },
      { type: 'p' as const, text: `${bizTagline}` },
      { type: 'hr' as const },
      { type: 'h2' as const, text: `INVOICE ${invNo}` },
      { type: 'p' as const, text: `Billed To: ${clientName}   |   Issue Date: ${new Date().toISOString().slice(0, 10)}` },
      {
        type: 'table' as const,
        rows: [
          ['Description', 'Qty', 'Unit Rate', 'Line Total'],
          ...invItems.map((it) => [
            it.desc,
            String(it.qty),
            it.rate.toLocaleString(),
            (it.qty * it.rate).toLocaleString(),
          ]),
        ],
      },
      { type: 'p' as const, text: `Subtotal: ${invSubtotal.toLocaleString()}   |   Discount: -${invDiscount.toLocaleString()}   |   Tax (${invTaxPct}%): ${invTaxAmt.toLocaleString()}` },
      { type: 'h2' as const, text: `Grand Total: ${invTotal.toLocaleString()} (${numToWordsEnBD(invTotal)} Only)` },
      { type: 'hr' as const },
      { type: 'p' as const, text: 'Thank you for your business.' },
    ];
    const pdfBytes = await renderBlocksToPdf(blocks, { title: `${bizName} — ${invNo}`, subtitle: `Bill To: ${clientName}` });
    downloadBytes(pdfBytes, `${invNo.toLowerCase()}.pdf`, 'application/pdf');
  };

  const exportCertificatePng = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1130;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Warm parchment background
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, 1600, 1130);
    // Double ornate borders
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 10;
    ctx.strokeRect(42, 42, 1516, 1046);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.strokeRect(64, 64, 1472, 1002);
    // Top gold ribbon bar
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(64, 64, 1472, 18);
    // Header text
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('CERTIFICATE OF ACHIEVEMENT', 800, 210);
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillText('This proud distinction is presented to', 800, 290);
    // Recipient Name
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 84px Georgia, serif';
    ctx.fillText(certRecipient, 800, 420);
    // Gold underline
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(420, 455);
    ctx.lineTo(1180, 455);
    ctx.stroke();
    // Course
    ctx.fillStyle = '#475569';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('for successfully completing all requirements of', 800, 535);
    ctx.fillStyle = '#3730a3';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText(certCourse, 800, 610);
    // Gold Seal circle
    ctx.beginPath();
    ctx.arc(800, 770, 78, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(800, 770, 64, 0, Math.PI * 2);
    ctx.strokeStyle = '#fffbeb';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('VERIFIED', 800, 766);
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(new Date().getFullYear().toString(), 800, 792);
    // Footer Signatures
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText(certSigner, 170, 930);
    ctx.fillStyle = '#64748b';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(bizName, 170, 965);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(new Date().toISOString().slice(0, 10), 1430, 930);
    ctx.fillStyle = '#64748b';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText('Date of Issue', 1430, 965);
    downloadBlob(await canvasToBlob(canvas, 'image/png', 1), `certificate_${certRecipient.toLowerCase().replace(/\s+/g, '_')}.png`);
  };

  const exportBusinessCardPng = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1050;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const isLight = cardTheme === 'ivory';
    if (cardTheme === 'midnight') {
      const g = ctx.createLinearGradient(0, 0, 1050, 600);
      g.addColorStop(0, '#0f172a');
      g.addColorStop(1, '#1e293b');
      ctx.fillStyle = g;
    } else if (cardTheme === 'indigo') {
      const g = ctx.createLinearGradient(0, 0, 1050, 600);
      g.addColorStop(0, '#312e81');
      g.addColorStop(1, '#4f46e5');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillRect(0, 0, 1050, 600);
    // Accent bar
    ctx.fillStyle = isLight ? '#4f46e5' : '#38bdf8';
    ctx.fillRect(0, 0, 18, 600);
    ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.fillText(payeeName, 84, 185);
    ctx.fillStyle = isLight ? '#4f46e5' : '#93c5fd';
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillText(cardRole, 84, 238);
    ctx.fillStyle = isLight ? '#475569' : '#cbd5e1';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(bizName, 84, 330);
    ctx.font = '24px monospace';
    ctx.fillText(cardEmail, 84, 420);
    ctx.fillText(cardPhone, 84, 464);
    downloadBlob(await canvasToBlob(canvas, 'image/png', 1), 'business_card.png');
  };

  return (
    <div>
      <ToolHeader
        tool={tool}
        extra={
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white">
            <Printer className="h-3.5 w-3.5" /> Print / Save PDF
          </button>
        }
      />
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 no-print">
        {[
          ['invoice', 'Invoice'],
          ['receipt', 'Money Receipt / মানি রসিদ'],
          ['gold', 'BAJUS Gold (ভরি/আনা)'],
          ['cheque', 'Cheque & Words (EN/BN)'],
          ['cert', 'Certificate'],
          ['card', 'Business Card'],
          ['labels', 'Price Label & Barcode Sheet'],
          ['sign', 'Signature Studio'],
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

      {tab === 'invoice' && (
        <div className="grid gap-5 lg:grid-cols-12">
          <Panel title="Invoice Details" className="lg:col-span-5 no-print">
            <div className="space-y-2.5 text-xs">
              <input value={bizName} onChange={(e) => setBizName(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" placeholder="Company Name" />
              <input value={bizTagline} onChange={(e) => setBizTagline(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" placeholder="Address / Contact" />
              <div className="grid grid-cols-2 gap-2">
                <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" placeholder="Client Name" />
                <input value={invNo} onChange={(e) => setInvNo(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 font-mono" placeholder="Invoice #" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Currency
                  <select value={invCurrency} onChange={(e) => setInvCurrency(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5">
                    <option value="৳">৳ BDT</option>
                    <option value="$">$ USD</option>
                    <option value="€">€ EUR</option>
                    <option value="£">£ GBP</option>
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Tax / VAT (%)
                  <input type="number" min={0} max={50} value={invTaxPct} onChange={(e) => setInvTaxPct(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Discount
                  <input type="number" min={0} value={invDiscount} onChange={(e) => setInvDiscount(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
                </label>
              </div>
              <div className="pt-1 font-semibold text-[var(--muted)]">Line Items</div>
              {invItems.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5">
                  <input value={it.desc} onChange={(e) => setInvItems((p) => p.map((x, k) => (k === i ? { ...x, desc: e.target.value } : x)))} className="col-span-6 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5" />
                  <input type="number" min={1} value={it.qty} onChange={(e) => setInvItems((p) => p.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} className="col-span-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
                  <input type="number" value={it.rate} onChange={(e) => setInvItems((p) => p.map((x, k) => (k === i ? { ...x, rate: Number(e.target.value) } : x)))} className="col-span-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" />
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => setInvItems((p) => [...p, { desc: 'Consultation & Support', qty: 1, rate: 5000 }])} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 font-semibold">
                  + Add Line Item
                </button>
                <button type="button" onClick={exportInvoicePdf} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 font-semibold text-white">
                  <FileDown className="h-3.5 w-3.5" /> Export Styled PDF
                </button>
              </div>
            </div>
          </Panel>
          <div className="print-area overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm lg:col-span-7">
            <div className="h-2 bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500" />
            <div className="p-6 sm:p-7">
              <div className="flex flex-wrap justify-between items-start gap-4 border-b border-slate-200 pb-5">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600">Official Invoice</div>
                  <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{bizName}</h2>
                  <div className="mt-0.5 text-xs text-slate-500">{bizTagline}</div>
                  <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-slate-500">Bill To: </span>
                    <strong className="text-slate-900">{clientName}</strong>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-extrabold text-indigo-700">{invNo}</div>
                  <div className="text-[11px] text-slate-500">Issued: {new Date().toISOString().slice(0, 10)}</div>
                  <div className="w-16 ml-auto mt-2 rounded-lg border border-slate-200 p-1" dangerouslySetInnerHTML={{ __html: invQr }} />
                </div>
              </div>
              <table className="mt-5 w-full text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="rounded-l-lg px-3 py-2.5 text-left font-semibold">Description</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
                    <th className="rounded-r-lg px-3 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invItems.map((it, i) => (
                    <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/70' : ''}>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{it.desc}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{it.qty}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600">{invCurrency} {it.rate.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900">{invCurrency} {(it.qty * it.rate).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-5 flex flex-wrap justify-between items-end gap-4 border-t border-slate-200 pt-4">
                <div className="max-w-xs text-[11px] text-slate-500">
                  <div className="font-semibold text-slate-700">Amount in Words</div>
                  <div className="mt-0.5">{numToWordsEnBD(invTotal)} {invCurrency === '৳' ? 'Taka' : ''} Only</div>
                  {invCurrency === '৳' && <div className="mt-0.5 text-slate-500">{numToWordsBn(invTotal)} টাকা মাত্র</div>}
                </div>
                <div className="w-56 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="font-mono">{invCurrency} {invSubtotal.toLocaleString()}</span></div>
                  {invDiscount > 0 && <div className="flex justify-between text-emerald-700"><span>Discount</span><span className="font-mono">- {invCurrency} {invDiscount.toLocaleString()}</span></div>}
                  {invTaxPct > 0 && <div className="flex justify-between text-slate-600"><span>Tax / VAT ({invTaxPct}%)</span><span className="font-mono">{invCurrency} {invTaxAmt.toLocaleString()}</span></div>}
                  <div className="flex justify-between rounded-lg bg-indigo-50 px-2.5 py-2 text-sm font-extrabold text-indigo-900">
                    <span>Total Due</span>
                    <span className="font-mono">{invCurrency} {invTotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="mt-8 flex justify-between items-end pt-4 text-[11px] text-slate-400">
                <span>Verified locally via Tools with Anik</span>
                <div className="w-40 border-t border-slate-300 pt-1 text-center font-semibold text-slate-600">Authorized Signature</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'receipt' && (
        <Panel title="Money Receipt / মানি রসিদ">
          <div className="mb-4 grid gap-2 sm:grid-cols-4 text-xs no-print">
            <input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="Receipt No" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 font-mono" />
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Received From" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" />
            <input type="number" value={amtWords} onChange={(e) => setAmtWords(Number(e.target.value))} placeholder="Amount" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 font-mono" />
            <select value={receiptMethod} onChange={(e) => setReceiptMethod(e.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
              <option>Bank Transfer</option>
              <option>Cash</option>
              <option>Cheque</option>
              <option>bKash / Nagad</option>
            </select>
          </div>
          <div className="mb-4 text-xs no-print">
            <input value={receiptPurpose} onChange={(e) => setReceiptPurpose(e.target.value)} placeholder="Purpose / Against" className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2" />
          </div>
          <div className="print-area overflow-hidden rounded-2xl border-2 border-slate-300 bg-white text-slate-900">
            <div className="flex flex-wrap justify-between items-center bg-slate-900 px-6 py-4 text-white">
              <div>
                <div className="text-lg font-extrabold">{bizName}</div>
                <div className="text-xs text-slate-300">Official Money Receipt / মানি রসিদ</div>
              </div>
              <div className="text-right font-mono text-xs">
                <div className="font-bold text-amber-300">{receiptNo}</div>
                <div className="text-slate-300">Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2 border-b border-dashed border-slate-300 pb-2">
                <span>Received with thanks from:</span>
                <strong className="text-slate-900">{clientName}</strong>
              </div>
              <div className="flex flex-wrap justify-between gap-2 border-b border-dashed border-slate-300 pb-2">
                <span>Payment Purpose / Account of:</span>
                <strong className="text-slate-800">{receiptPurpose}</strong>
              </div>
              <div className="flex flex-wrap justify-between gap-2 border-b border-dashed border-slate-300 pb-2">
                <span>Payment Mode:</span>
                <strong className="text-indigo-700">{receiptMethod}</strong>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
                <div className="font-mono text-xl font-extrabold text-indigo-900">৳ {amtWords.toLocaleString()}/=</div>
                <div className="mt-1 text-xs font-medium text-slate-700">In Words: {numToWordsEnBD(amtWords)} Taka Only</div>
                <div className="mt-0.5 text-xs text-slate-600">কথায়: {numToWordsBn(amtWords)} টাকা মাত্র</div>
              </div>
              <div className="mt-8 flex justify-between pt-6 text-xs text-slate-600">
                <div className="w-40 border-t border-slate-400 pt-1 text-center font-semibold">Payer Signature</div>
                <div className="w-40 border-t border-slate-400 pt-1 text-center font-semibold">Authorized Receiver</div>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {tab === 'gold' && (
        <Panel title="BAJUS Gold Calculator (ভরি / আনা / রতি / পয়েন্ট ⇄ Gram)">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs mb-4">
            <label>ভরি (Vori)<input type="number" min={0} value={vori} onChange={(e) => setVori(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
            <label>আনা (Ana)<input type="number" min={0} max={15} value={ana} onChange={(e) => setAna(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
            <label>রতি (Roti)<input type="number" min={0} max={5} value={roti} onChange={(e) => setRoti(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
            <label>পয়েন্ট (Pt)<input type="number" min={0} max={9} value={point} onChange={(e) => setPoint(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
            <label>Price/Vori<input type="number" value={pricePerVori} onChange={(e) => setPricePerVori(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 font-mono" /></label>
          </div>
          <label className="mb-4 inline-flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={includeVat} onChange={(e) => setIncludeVat(e.target.checked)} /> Include 5% BD Govt VAT + Making (৳600/g)
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label="Total Weight" value={`${goldRes.totalGrams.toFixed(3)} g`} sub={`${toBanglaDigits(goldRes.totalVori.toFixed(3))} ভরি`} />
            <StatTile label="Gold Value" value={`৳ ${Math.round(goldRes.goldCost).toLocaleString()}`} />
            <StatTile label="Making + 5% VAT" value={`৳ ${Math.round(goldRes.makingCost + goldRes.vat).toLocaleString()}`} />
            <StatTile label="Grand Total" value={`৳ ${Math.round(goldRes.grandTotal).toLocaleString()}`} />
          </div>
        </Panel>
      )}

      {tab === 'cheque' && (
        <Panel title="Bank Cheque Leaf & Number to Words (BD / Intl / বাংলা)">
          <div className="grid gap-3 sm:grid-cols-2 text-xs mb-4 no-print">
            <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Payee Name" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2" />
            <input type="number" value={amtWords} onChange={(e) => setAmtWords(Number(e.target.value))} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono" />
          </div>
          <div className="print-area overflow-hidden rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 via-teal-50/70 to-sky-50 text-slate-900 shadow-sm mb-4">
            <div className="p-6">
              <div className="flex flex-wrap justify-between items-start gap-2">
                <div className="inline-block -rotate-3 border-y-2 border-emerald-800 px-3 py-0.5 text-[11px] font-extrabold tracking-widest text-emerald-900">
                  A/C PAYEE ONLY
                </div>
                <div className="rounded border border-emerald-400 bg-white px-3 py-1 font-mono text-xs font-bold tracking-widest">
                  DATE: {new Date().toISOString().slice(0, 10)}
                </div>
              </div>
              <div className="mt-5 flex items-baseline gap-2 border-b border-emerald-400/70 pb-1.5 text-sm">
                <span className="text-xs font-semibold text-emerald-800">PAY TO:</span>
                <strong className="text-base">{payeeName}</strong>
                <span className="ml-auto text-[11px] text-emerald-700">OR BEARER</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex-1 border-b border-emerald-400/70 pb-1.5 text-xs">
                  <span className="font-semibold text-emerald-800">THE SUM OF: </span>
                  <strong className="text-sm">{numToWordsEnBD(amtWords)} Taka Only</strong>
                </div>
                <div className="rounded-lg border-2 border-emerald-600 bg-white px-4 py-2 font-mono text-lg font-extrabold text-emerald-950">
                  ৳ {amtWords.toLocaleString()}/=
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <div className="w-44 border-t border-slate-500 pt-1 text-center text-[11px] font-semibold text-slate-600">
                  Account Holder Signature
                </div>
              </div>
            </div>
            <div className="bg-white/90 px-6 py-2 font-mono text-xs tracking-[0.25em] text-slate-500 border-t border-emerald-200">
              ⑈ 048291 ⑈ 090261742 ⑆ 0041289012 ⑈
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <div className="rounded-lg bg-[var(--surface-2)] p-3"><strong>English (BD Lakh/Crore):</strong> {numToWordsEnBD(amtWords)}</div>
            <div className="rounded-lg bg-[var(--surface-2)] p-3"><strong>English (International):</strong> {numToWordsEnIntl(amtWords)}</div>
            <div className="rounded-lg bg-[var(--surface-2)] p-3"><strong>বাংলা কথায়:</strong> {numToWordsBn(amtWords)} ({toBanglaDigits(amtWords)})</div>
          </div>
        </Panel>
      )}

      {tab === 'cert' && (
        <Panel
          title="Gold-Seal Certificate Generator"
          actions={
            <button type="button" onClick={exportCertificatePng} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white no-print">
              <Download className="h-3.5 w-3.5" /> Export High-Res PNG
            </button>
          }
        >
          <div className="grid gap-2.5 sm:grid-cols-3 text-xs mb-5 no-print">
            <input value={certRecipient} onChange={(e) => setCertRecipient(e.target.value)} placeholder="Recipient Name" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2" />
            <input value={certCourse} onChange={(e) => setCertCourse(e.target.value)} placeholder="Course / Award Title" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2" />
            <input value={certSigner} onChange={(e) => setCertSigner(e.target.value)} placeholder="Signatory Name & Role" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2" />
          </div>
          <div className="print-area rounded-2xl border-8 border-double border-amber-500 bg-[#fffdf7] p-8 sm:p-12 text-center text-slate-900 shadow-sm">
            <div className="mx-auto mb-3 h-1.5 w-32 rounded-full bg-indigo-900" />
            <div className="text-xs font-extrabold uppercase tracking-[0.3em] text-amber-700">Certificate of Achievement</div>
            <div className="mt-3 text-xs italic text-slate-500">This proud distinction is presented to</div>
            <div className="mt-2 font-serif text-4xl font-extrabold tracking-tight text-slate-900">{certRecipient}</div>
            <div className="mx-auto mt-3 h-0.5 w-56 bg-amber-400" />
            <div className="mt-4 text-sm text-slate-600">
              for successfully completing all requirements of <strong className="text-indigo-900">{certCourse}</strong>
            </div>
            <div className="mt-7 flex items-center justify-center">
              <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-4 border-amber-200 bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md">
                <Award className="h-6 w-6" />
                <span className="text-[9px] font-extrabold tracking-wider">VERIFIED</span>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap justify-between items-end gap-4 border-t border-amber-200/80 pt-4 text-xs text-slate-600">
              <div className="text-left">
                <div className="font-bold text-slate-900">{certSigner}</div>
                <div className="text-[11px] text-slate-500">{bizName}</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-slate-900">{new Date().toISOString().slice(0, 10)}</div>
                <div className="text-[11px] text-slate-500">Date of Issue</div>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {tab === 'card' && (
        <Panel
          title="Scannable Business Card Maker (Front & Back)"
          actions={
            <button type="button" onClick={exportBusinessCardPng} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white no-print">
              <Download className="h-3.5 w-3.5" /> Download Print PNG
            </button>
          }
        >
          <div className="mb-4 grid gap-2 sm:grid-cols-4 text-xs no-print">
            <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Full Name" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" />
            <input value={cardRole} onChange={(e) => setCardRole(e.target.value)} placeholder="Job Title" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" />
            <input value={cardEmail} onChange={(e) => setCardEmail(e.target.value)} placeholder="Email" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" />
            <input value={cardPhone} onChange={(e) => setCardPhone(e.target.value)} placeholder="Phone" className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" />
          </div>
          <div className="mb-5 flex gap-2 text-xs no-print">
            {([
              ['midnight', 'Midnight Slate'],
              ['ivory', 'Studio Ivory'],
              ['indigo', 'Royal Indigo'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCardTheme(id)}
                className={`rounded-lg border px-3 py-1.5 font-semibold ${
                  cardTheme === id ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--ink-2)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="print-area grid gap-5 md:grid-cols-2">
            {/* Front */}
            <div
              className={`relative overflow-hidden rounded-2xl p-6 shadow-md flex items-center justify-between min-h-[210px] ${
                cardTheme === 'midnight'
                  ? 'bg-gradient-to-br from-slate-900 to-slate-800 text-white'
                  : cardTheme === 'indigo'
                    ? 'bg-gradient-to-br from-indigo-900 to-indigo-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-900'
              }`}
            >
              <div className={`absolute inset-y-0 left-0 w-2 ${cardTheme === 'ivory' ? 'bg-indigo-600' : 'bg-sky-400'}`} />
              <div className="pl-2">
                <div className="text-xl font-extrabold tracking-tight">{payeeName}</div>
                <div className={`text-xs font-semibold ${cardTheme === 'ivory' ? 'text-indigo-600' : 'text-sky-300'}`}>{cardRole}</div>
                <div className={`mt-4 text-xs font-bold ${cardTheme === 'ivory' ? 'text-slate-700' : 'text-slate-200'}`}>{bizName}</div>
                <div className={`mt-1 font-mono text-[11px] ${cardTheme === 'ivory' ? 'text-slate-500' : 'text-slate-300'}`}>{cardEmail}</div>
                <div className={`font-mono text-[11px] ${cardTheme === 'ivory' ? 'text-slate-500' : 'text-slate-300'}`}>{cardPhone}</div>
              </div>
              <div className="h-24 w-24 shrink-0 rounded-xl border border-slate-200 bg-white p-1.5" dangerouslySetInnerHTML={{ __html: cardQr }} />
            </div>
            {/* Back */}
            <div
              className={`rounded-2xl p-6 shadow-md flex flex-col items-center justify-center text-center min-h-[210px] ${
                cardTheme === 'midnight'
                  ? 'bg-slate-950 text-white'
                  : cardTheme === 'indigo'
                    ? 'bg-indigo-950 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-900'
              }`}
            >
              <div className="font-display text-lg font-extrabold tracking-tight">{bizName}</div>
              <div className={`mt-1 text-xs ${cardTheme === 'ivory' ? 'text-slate-500' : 'text-slate-300'}`}>{bizTagline}</div>
              <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] opacity-60">Scan QR to Save vCard</div>
            </div>
          </div>
        </Panel>
      )}

      {tab === 'labels' && (
        <Panel title="Retail Price Label & 3×4 Barcode Sticker Sheet">
          <div className="grid grid-cols-3 gap-2 text-xs mb-4 no-print">
            <input value={priceLabel.title} onChange={(e) => setPriceLabel((p) => ({ ...p, title: e.target.value }))} className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2" />
            <input value={priceLabel.sku} onChange={(e) => setPriceLabel((p) => ({ ...p, sku: e.target.value }))} className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 font-mono" />
            <input value={priceLabel.price} onChange={(e) => setPriceLabel((p) => ({ ...p, price: e.target.value }))} className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 font-mono font-bold" />
          </div>
          <div className="print-area grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rounded-xl border border-slate-300 bg-white p-3.5 text-center text-slate-900 shadow-xs">
                <div className="truncate text-xs font-bold text-slate-800">{priceLabel.title}</div>
                <div className="mt-0.5 text-lg font-extrabold text-indigo-700">{priceLabel.price}</div>
                <div className="mt-1.5" dangerouslySetInnerHTML={{ __html: labelBc }} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'sign' && (
        <Panel title="Digital Signature Pad">
          <canvas
            ref={sigRef}
            width={520}
            height={180}
            onPointerDown={(e) => {
              sigDrawing.current = true;
              const r = sigRef.current!.getBoundingClientRect();
              const ctx = sigRef.current!.getContext('2d')!;
              ctx.beginPath();
              ctx.moveTo(((e.clientX - r.left) / r.width) * 520, ((e.clientY - r.top) / r.height) * 180);
            }}
            onPointerMove={(e) => {
              if (!sigDrawing.current) return;
              const r = sigRef.current!.getBoundingClientRect();
              const ctx = sigRef.current!.getContext('2d')!;
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 3;
              ctx.lineCap = 'round';
              ctx.lineTo(((e.clientX - r.left) / r.width) * 520, ((e.clientY - r.top) / r.height) * 180);
              ctx.stroke();
            }}
            onPointerUp={() => {
              sigDrawing.current = false;
            }}
            className="w-full max-w-lg cursor-crosshair rounded-xl border border-[var(--line-strong)] bg-white touch-none"
          />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => sigRef.current?.getContext('2d')?.clearRect(0, 0, 520, 180)}
              className="rounded-lg border border-[var(--line)] px-3 py-2 font-semibold"
            >
              Clear Signature
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!sigRef.current) return;
                downloadBlob(await canvasToBlob(sigRef.current, 'image/png', 1), 'signature.png');
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-white"
            >
              <Download className="h-3.5 w-3.5" /> Download Transparent PNG
            </button>
            <button
              type="button"
              onClick={() => {
                if (!sigRef.current) return;
                navigateToTool('pdf-sign', { signatureDataUrl: sigRef.current.toDataURL('image/png') });
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white"
            >
              <Send className="h-3.5 w-3.5" /> Stamp directly onto a PDF
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
