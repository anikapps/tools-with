import React, { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Download, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ToolDef } from '../../data/toolsCatalog';
import { ToolHeader, FileDropzone, Panel, StatTile, CopyButton } from '../ui/SharedUi';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  csvToJson,
  fmtBytes,
  jsonToCsv,
  jsonToSimpleXml,
  parseCsv,
  simpleXmlToJson,
} from '../../utils/formatters';
import { crc32, detectMagicMime, hexDump, shannonEntropy } from '../../utils/barcodeQr';
import { downloadBlob, downloadText, readFileAsBytes } from '../../utils/download';

const SAMPLE_CSV = `name,department,salary,projects
Anik,Engineering,95000,12
Nadia,Design,88000,9
Tariq,Operations,72000,14
Sarah,Product,91000,11`;

const SAMPLE_JSON = JSON.stringify(
  {
    workspace: 'Tools with Anik',
    version: '2.0',
    private: true,
    team: [
      { name: 'Anik', role: 'Engineering', salary: 95000 },
      { name: 'Nadia', role: 'Design', salary: 88000 },
    ],
  },
  null,
  2
);

const SAMPLE_XML = `<workspace>
  <name>Tools with Anik</name>
  <private>true</private>
  <member>
    <name>Anik</name>
    <department>Engineering</department>
    <salary>95000</salary>
  </member>
  <member>
    <name>Nadia</name>
    <department>Design</department>
    <salary>88000</salary>
  </member>
</workspace>`;

export function FileDataWorkspace({ tool }: { tool: ToolDef }) {
  const { transfer, clearTransfer } = useWorkspace();
  const [tab, setTab] = useState(tool.tab || 'csv-json');
  const [inputText, setInputText] = useState(() => {
    if (tool.tab === 'json') return SAMPLE_JSON;
    if (tool.tab === 'xml') return SAMPLE_XML;
    return SAMPLE_CSV;
  });
  const [outputText, setOutputText] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [validInfo, setValidInfo] = useState('');

  // ZIP Builder & Packager & Inspector
  const [zipInputFiles, setZipInputFiles] = useState<File[]>([]);
  const [includeManifest, setIncludeManifest] = useState(tool.id === 'fd-packager');
  const [zipEntries, setZipEntries] = useState<
    { name: string; size: number; dir: boolean; getBlob: () => Promise<Blob> }[]
  >([]);

  // File Inspector & Checksums
  const [inspectedFile, setInspectedFile] = useState<{
    name: string;
    size: number;
    mime: string;
    label: string;
    mismatch: boolean;
    entropy: number;
    crc: string;
    sha256: string;
    sha512: string;
    hex: string;
  } | null>(null);

  // CSV Viewer sort/filter/chart
  const [csvFilter, setCsvFilter] = useState('');
  const [sortCol, setSortCol] = useState(0);
  const [chartCol, setChartCol] = useState(2);

  // Dummy Data Generator
  const [dummyCount, setDummyCount] = useState(8);
  const [dummyLang, setDummyLang] = useState<'en' | 'bn'>('en');
  const [dummyFmt, setDummyFmt] = useState<'json' | 'csv' | 'sql'>('json');

  const syncSampleForTab = (nextTab: string) => {
    setErrMsg('');
    setValidInfo('');
    if (nextTab === 'json') {
      try {
        JSON.parse(inputText);
      } catch {
        setInputText(SAMPLE_JSON);
      }
    } else if (nextTab === 'xml') {
      if (!inputText.trim().startsWith('<')) setInputText(SAMPLE_XML);
    } else if (nextTab === 'csv-json' || nextTab === 'csv-grid') {
      if (inputText.trim().startsWith('{') || inputText.trim().startsWith('<')) {
        setInputText(SAMPLE_CSV);
      }
    }
  };

  useEffect(() => {
    const next = tool.tab || 'csv-json';
    setTab(next);
    if (tool.id === 'fd-packager') setIncludeManifest(true);
    syncSampleForTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id, tool.tab]);

  useEffect(() => {
    if (transfer?.files?.[0]) {
      const f = transfer.files[0];
      if (f.name.toLowerCase().endsWith('.zip')) handleInspectZip(f);
      else if (/\.(csv|json|xml|txt)$/i.test(f.name)) {
        f.text().then((t) => setInputText(t));
      } else {
        handleInspectBinary(f);
      }
      clearTransfer();
    }
  }, [transfer]);

  const handleInspectZip = async (f: File) => {
    const z = await JSZip.loadAsync(await f.arrayBuffer());
    const list = await Promise.all(
      Object.entries(z.files).map(async ([name, entry]) => {
        let size = 0;
        if (!entry.dir) {
          const u8 = await entry.async('uint8array');
          size = u8.byteLength;
        }
        return {
          name,
          dir: entry.dir,
          size,
          getBlob: () => entry.async('blob'),
        };
      })
    );
    setZipEntries(list);
  };

  const handleInspectBinary = async (f: File) => {
    const bytes = await readFileAsBytes(f);
    const magic = detectMagicMime(bytes, f.name);
    const entropy = shannonEntropy(bytes);
    const crc = crc32(bytes);
    const h256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice())))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const h512 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-512', bytes.slice())))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    setInspectedFile({
      name: f.name,
      size: f.size,
      mime: magic.mime,
      label: magic.label,
      mismatch: magic.extensionMismatch,
      entropy,
      crc,
      sha256: h256,
      sha512: h512,
      hex: hexDump(bytes, 512),
    });
  };

  const csvRows = useMemo(() => parseCsv(inputText), [inputText]);
  const csvHeaders = csvRows[0] || [];
  const csvBody = useMemo(() => {
    const q = csvFilter.trim().toLowerCase();
    return csvRows
      .slice(1)
      .filter((r) => !q || r.some((cell) => cell.toLowerCase().includes(q)))
      .sort((a, b) => (a[sortCol] || '').localeCompare(b[sortCol] || '', undefined, { numeric: true }));
  }, [csvRows, csvFilter, sortCol]);

  // CSV Structure Validation & Column Bar Chart
  const csvAudit = useMemo(() => {
    const expected = csvHeaders.length;
    let raggedRows = 0;
    let emptyCells = 0;
    const rawBody = csvRows.slice(1);
    for (const r of rawBody) {
      if (r.length !== expected) raggedRows++;
      for (let i = 0; i < expected; i++) {
        if (!String(r[i] ?? '').trim()) emptyCells++;
      }
    }
    const numericCols = csvHeaders
      .map((h, idx) => {
        const vals = rawBody.map((r) => Number(String(r[idx] ?? '').replace(/[^0-9.-]/g, '')));
        const validCount = vals.filter((n) => Number.isFinite(n) && String(rawBody[vals.indexOf(n)]?.[idx] ?? '').trim() !== '').length;
        return validCount >= Math.max(1, Math.ceil(rawBody.length * 0.5)) ? { idx, name: h || `Col ${idx + 1}` } : null;
      })
      .filter(Boolean) as { idx: number; name: string }[];
    return { expected, raggedRows, emptyCells, rowCount: rawBody.length, numericCols };
  }, [csvRows, csvHeaders]);

  const activeChartCol = useMemo(() => {
    if (csvAudit.numericCols.some((c) => c.idx === chartCol)) return chartCol;
    return csvAudit.numericCols[0]?.idx ?? 0;
  }, [csvAudit.numericCols, chartCol]);

  const chartBars = useMemo(() => {
    const bars = csvBody.slice(0, 12).map((r, i) => ({
      label: r[0] || `Row ${i + 1}`,
      value: Number(String(r[activeChartCol] ?? '').replace(/[^0-9.-]/g, '')) || 0,
    }));
    const maxVal = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
    return { bars, maxVal };
  }, [csvBody, activeChartCol]);

  const sortKeysDeep = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(sortKeysDeep);
    if (val && typeof val === 'object') {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce((acc, k) => {
          acc[k] = sortKeysDeep((val as Record<string, unknown>)[k]);
          return acc;
        }, {} as Record<string, unknown>);
    }
    return val;
  };

  const runGenerateDummy = () => {
    const enNames = ['Anik Rahman', 'Nadia Karim', 'Tariq Hasan', 'Sarah Kabir', 'Rafi Ahmed', 'Maya Chowdhury'];
    const bnNames = ['অনিক রহমান', 'নাদিয়া করিম', 'তারিক হাসান', 'সারা কবির', 'রাফি আহমেদ', 'মায়া চৌধুরী'];
    const citiesEn = ['Dhaka', 'Chattogram', 'Sylhet', 'Rajshahi', 'Khulna'];
    const citiesBn = ['ঢাকা', 'চট্টগ্রাম', 'সিলেট', 'রাজশাহী', 'খুলনা'];
    const records = Array.from({ length: dummyCount }, (_, i) => ({
      id: i + 1,
      name: (dummyLang === 'bn' ? bnNames : enNames)[i % 6],
      city: (dummyLang === 'bn' ? citiesBn : citiesEn)[i % 5],
      email: `user${i + 1}@example.com`,
      balance: 1500 + ((i * 731) % 8500),
    }));
    if (dummyFmt === 'json') setOutputText(JSON.stringify(records, null, 2));
    else if (dummyFmt === 'csv') setOutputText(jsonToCsv(records));
    else {
      setOutputText(
        records
          .map(
            (r) =>
              `INSERT INTO users (id, name, city, email, balance) VALUES (${r.id}, '${r.name}', '${r.city}', '${r.email}', ${r.balance});`
          )
          .join('\n')
      );
    }
  };

  const buildZipPackage = async () => {
    const zip = new JSZip();
    const manifest: { file: string; bytes: number; sha256: string; crc32: string }[] = [];
    for (const f of zipInputFiles) {
      zip.file(f.name, f);
      if (includeManifest) {
        const b = await readFileAsBytes(f);
        const digest = await crypto.subtle.digest('SHA-256', b.slice());
        const sha256 = Array.from(new Uint8Array(digest))
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
        manifest.push({ file: f.name, bytes: f.size, sha256, crc32: crc32(b) });
      }
    }
    if (includeManifest) {
      zip.file(
        'manifest.json',
        JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2)
      );
    }
    downloadBlob(
      await zip.generateAsync({ type: 'blob' }),
      includeManifest ? 'packaged_bundle.zip' : 'archive.zip'
    );
  };

  return (
    <div>
      <ToolHeader tool={tool} />

      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5">
        {[
          ['csv-json', 'CSV ⇄ JSON'],
          ['csv-grid', 'CSV Viewer, Chart & Validator'],
          ['json', 'JSON Format / Validate / Sort'],
          ['xml', 'XML ⇄ JSON'],
          ['zip-create', 'ZIP Creator & Packager'],
          ['zip-inspect', 'ZIP Inspector & Extract'],
          ['inspect', 'File Info / MIME / SHA / Hex'],
          ['dummy', 'Dummy Data (EN/BN)'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              syncSampleForTab(id);
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === id ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {errMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errMsg}</span>
        </div>
      )}
      {validInfo && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{validInfo}</span>
        </div>
      )}

      {(tab === 'csv-json' || tab === 'json' || tab === 'xml') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Input Data"
            actions={
              <button
                type="button"
                onClick={() => {
                  setErrMsg('');
                  setValidInfo('');
                  if (tab === 'json') setInputText(SAMPLE_JSON);
                  else if (tab === 'xml') setInputText(SAMPLE_XML);
                  else setInputText(SAMPLE_CSV);
                }}
                className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold hover:bg-[var(--surface-2)]"
              >
                Load Sample
              </button>
            }
          >
            <textarea
              rows={13}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {tab === 'csv-json' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setErrMsg('');
                      const parsed = csvToJson(inputText);
                      setOutputText(JSON.stringify(parsed, null, 2));
                      setValidInfo(`Converted ${parsed.length} CSV row(s) to JSON.`);
                    }}
                    className="rounded-lg bg-[var(--accent)] px-3.5 py-2 font-bold text-white"
                  >
                    CSV → JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setErrMsg('');
                        const parsed = JSON.parse(inputText);
                        setOutputText(jsonToCsv(Array.isArray(parsed) ? parsed : [parsed]));
                        setValidInfo('Converted JSON array to CSV.');
                      } catch (e) {
                        setValidInfo('');
                        setErrMsg((e as Error).message);
                      }
                    }}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2 font-semibold"
                  >
                    JSON → CSV
                  </button>
                </>
              )}
              {tab === 'json' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setErrMsg('');
                        const parsed = JSON.parse(inputText);
                        setOutputText(JSON.stringify(parsed, null, 2));
                        const keys = typeof parsed === 'object' && parsed ? Object.keys(parsed).length : 0;
                        setValidInfo(`Valid JSON! Top-level type: ${Array.isArray(parsed) ? `Array (${parsed.length} items)` : `${typeof parsed} (${keys} keys)`}.`);
                      } catch (e) {
                        setValidInfo('');
                        setErrMsg(`Invalid JSON: ${(e as Error).message}`);
                      }
                    }}
                    className="rounded-lg bg-[var(--accent)] px-3.5 py-2 font-bold text-white"
                  >
                    Format & Validate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setErrMsg('');
                        setOutputText(JSON.stringify(JSON.parse(inputText)));
                        setValidInfo('Valid JSON minified cleanly.');
                      } catch (e) {
                        setValidInfo('');
                        setErrMsg(`Invalid JSON: ${(e as Error).message}`);
                      }
                    }}
                    className="rounded-lg border border-[var(--line)] px-3.5 py-2 font-semibold"
                  >
                    Minify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setErrMsg('');
                        setOutputText(JSON.stringify(sortKeysDeep(JSON.parse(inputText)), null, 2));
                        setValidInfo('Sorted all JSON object keys alphabetically A–Z.');
                      } catch (e) {
                        setValidInfo('');
                        setErrMsg(`Invalid JSON: ${(e as Error).message}`);
                      }
                    }}
                    className="rounded-lg border border-[var(--line)] px-3.5 py-2 font-semibold"
                  >
                    Sort Keys A–Z
                  </button>
                </>
              )}
              {tab === 'xml' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setErrMsg('');
                        setOutputText(JSON.stringify(simpleXmlToJson(inputText), null, 2));
                        setValidInfo('Parsed XML into JSON cleanly.');
                      } catch (e) {
                        setValidInfo('');
                        setErrMsg((e as Error).message);
                      }
                    }}
                    className="rounded-lg bg-[var(--accent)] px-3.5 py-2 font-bold text-white"
                  >
                    XML → JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setErrMsg('');
                        setOutputText(jsonToSimpleXml(JSON.parse(inputText), 'root'));
                        setValidInfo('Serialized JSON into XML.');
                      } catch (e) {
                        setValidInfo('');
                        setErrMsg((e as Error).message);
                      }
                    }}
                    className="rounded-lg border border-[var(--line)] px-3.5 py-2 font-semibold"
                  >
                    JSON → XML
                  </button>
                </>
              )}
            </div>
          </Panel>
          <Panel
            title="Converted Output"
            actions={
              <>
                <CopyButton text={outputText} />
                <button
                  type="button"
                  onClick={() => downloadText(outputText, tab === 'json' ? 'formatted.json' : tab === 'xml' ? 'converted.xml' : 'converted_output.txt')}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold"
                >
                  Download
                </button>
              </>
            }
          >
            <textarea
              readOnly
              rows={13}
              value={outputText}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
            />
          </Panel>
        </div>
      )}

      {tab === 'csv-grid' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Data Rows" value={csvAudit.rowCount} />
            <StatTile label="Columns" value={csvAudit.expected} />
            <StatTile
              label="Structure Check"
              value={csvAudit.raggedRows === 0 ? 'Valid' : `${csvAudit.raggedRows} Ragged`}
              sub={csvAudit.raggedRows === 0 ? 'All rows uniform' : 'Row lengths vary'}
            />
            <StatTile label="Empty Cells" value={csvAudit.emptyCells} />
          </div>

          <Panel title="CSV Source & Filter">
            <div className="flex flex-wrap gap-3 mb-3">
              <input
                value={csvFilter}
                onChange={(e) => setCsvFilter(e.target.value)}
                placeholder="Filter rows..."
                className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs"
              />
              <span className="self-center font-mono text-xs text-[var(--muted)]">
                Showing {csvBody.length} of {csvAudit.rowCount} row(s)
              </span>
            </div>
            <textarea
              rows={4}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 font-mono text-xs"
            />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-12">
            <Panel title="Interactive Table (Click header to sort)" className="lg:col-span-7">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--line)]">
                      {csvHeaders.map((h, i) => (
                        <th
                          key={i}
                          onClick={() => setSortCol(i)}
                          className="cursor-pointer py-2 pr-3 font-bold text-[var(--ink)] hover:text-[var(--accent)]"
                        >
                          {h} {sortCol === i ? '▾' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {csvBody.map((r, ri) => (
                      <tr key={ri}>
                        {csvHeaders.map((_, ci) => (
                          <td key={ci} className="py-2 pr-3 font-mono text-[var(--ink-2)]">
                            {r[ci]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="Column Bar Chart"
              className="lg:col-span-5"
              actions={
                csvAudit.numericCols.length > 0 && (
                  <select
                    value={activeChartCol}
                    onChange={(e) => setChartCol(Number(e.target.value))}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-xs font-semibold"
                  >
                    {csvAudit.numericCols.map((c) => (
                      <option key={c.idx} value={c.idx}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )
              }
            >
              {csvAudit.numericCols.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--muted)]">
                  Add a numeric column to view instant column bar charts.
                </div>
              ) : (
                <div className="space-y-2.5 text-xs">
                  {chartBars.bars.map((b, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between font-medium">
                        <span className="truncate">{b.label}</span>
                        <span className="font-mono font-bold">{b.value.toLocaleString()}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${Math.max(4, Math.round((Math.abs(b.value) / chartBars.maxVal) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === 'zip-create' && (
        <Panel title="Create Compressed ZIP Archive & SHA-256 Packager">
          <FileDropzone
            multiple
            onFiles={(fs) => setZipInputFiles((p) => [...p, ...fs])}
            label={`Drop files to add (${zipInputFiles.length} staged)`}
          />
          <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={includeManifest}
              onChange={(e) => setIncludeManifest(e.target.checked)}
            />
            Include auto-generated SHA-256 &amp; CRC-32 manifest.json (File Packager mode)
          </label>
          {zipInputFiles.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="max-h-48 overflow-y-auto divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] text-xs">
                {zipInputFiles.map((f, idx) => (
                  <div key={`${f.name}-${idx}`} className="flex items-center justify-between px-3 py-2">
                    <span className="truncate font-mono">{f.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-[var(--muted)]">{fmtBytes(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => setZipInputFiles((p) => p.filter((_, i) => i !== idx))}
                        className="text-[var(--muted)] hover:text-[var(--danger)]"
                        aria-label={`Remove ${f.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <span>Total Raw Size: {fmtBytes(zipInputFiles.reduce((s, f) => s + f.size, 0))}</span>
                  <button
                    type="button"
                    onClick={() => setZipInputFiles([])}
                    className="text-[var(--danger)] hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <button
                  type="button"
                  onClick={buildZipPackage}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white"
                >
                  <Download className="h-3.5 w-3.5" /> {includeManifest ? 'Build Package + manifest.json ZIP' : 'Build & Download .ZIP'}
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {tab === 'zip-inspect' && (
        <Panel title="Inspect & Extract ZIP Contents">
          <FileDropzone
            accept=".zip"
            compact
            onFiles={(fs) => fs[0] && handleInspectZip(fs[0])}
            label="Drop a .ZIP archive to inspect internal tree"
          />
          {zipEntries.length > 0 && (
            <div className="mt-4 divide-y divide-[var(--line)] text-xs">
              {zipEntries.map((ent, idx) => (
                <div key={idx} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono font-semibold">{ent.name}</div>
                    {!ent.dir && <div className="font-mono text-[11px] text-[var(--muted)]">{fmtBytes(ent.size)}</div>}
                  </div>
                  {!ent.dir && (
                    <button
                      type="button"
                      onClick={async () => downloadBlob(await ent.getBlob(), ent.name.split('/').pop() || 'file')}
                      className="rounded bg-[var(--accent-soft)] px-2.5 py-1 font-semibold text-[var(--accent-ink)]"
                    >
                      Extract
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === 'inspect' && (
        <div className="space-y-4">
          <FileDropzone
            compact
            onFiles={(fs) => fs[0] && handleInspectBinary(fs[0])}
            label="Drop any binary or text file to inspect Magic MIME, Entropy, SHA-256/512, CRC-32 & Hex Dump"
          />
          {inspectedFile && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="True Magic MIME" value={inspectedFile.mime} sub={inspectedFile.label} />
                <StatTile label="Byte Size" value={fmtBytes(inspectedFile.size)} sub={`${inspectedFile.size.toLocaleString()} B`} />
                <StatTile label="Shannon Entropy" value={`${inspectedFile.entropy.toFixed(3)} / 8`} />
                <StatTile label="CRC-32" value={inspectedFile.crc} sub={inspectedFile.mismatch ? 'Extension mismatch!' : 'Ext matches'} />
              </div>
              <Panel title="Cryptographic Checksums & Hex/ASCII Dump (first 512 bytes)">
                <div className="mb-3 space-y-1.5 font-mono text-xs">
                  <div>
                    <strong>SHA-256:</strong> {inspectedFile.sha256}
                  </div>
                  <div className="break-all">
                    <strong>SHA-512:</strong> {inspectedFile.sha512}
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3 font-mono text-[11px] leading-relaxed">
                  {inspectedFile.hex}
                </pre>
              </Panel>
            </>
          )}
        </div>
      )}

      {tab === 'dummy' && (
        <Panel title="Generate Mock Datasets (EN & বাংলা)">
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <input
              type="number"
              min={1}
              max={200}
              value={dummyCount}
              onChange={(e) => setDummyCount(Number(e.target.value))}
              className="w-24 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono"
            />
            <select
              value={dummyLang}
              onChange={(e) => setDummyLang(e.target.value as 'en' | 'bn')}
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
            >
              <option value="en">English Dataset</option>
              <option value="bn">বাংলা Dataset</option>
            </select>
            <select
              value={dummyFmt}
              onChange={(e) => setDummyFmt(e.target.value as 'json' | 'csv' | 'sql')}
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
            >
              <option value="json">JSON Array</option>
              <option value="csv">CSV Table</option>
              <option value="sql">SQL INSERT</option>
            </select>
            <button
              type="button"
              onClick={runGenerateDummy}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-white"
            >
              Generate {dummyCount} Rows
            </button>
            {outputText && <CopyButton text={outputText} />}
          </div>
          <textarea
            readOnly
            rows={12}
            value={outputText}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs"
          />
        </Panel>
      )}
    </div>
  );
}
