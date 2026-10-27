import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Col } from '../components/DataTable'
import { ErrorBox, Loading, Panel } from '../components/Panel'
import { BasisVal, fmtValue, Val } from '../lib/fmt'
import { useApi } from '../lib/useApi'
import { Star } from '../lib/watchlists'

type Bound = { min?: number; max?: number }
type Filters = Record<string, Bound>
type Spec = { key: string; label: string; min: number; max: number; step: number; kind: 'x' | 'pct' | 'pctPlain' | 'num' | 'cap' | 'int'; group: string; hint?: string }

const SPECS: Spec[] = [
  { key: 'market_cap', label: 'Market cap', min: 0, max: 500e9, step: 1e9, kind: 'cap', group: 'Size' },
  { key: 'forward_pe', label: 'NTM P/E', min: 0, max: 80, step: 1, kind: 'x', group: 'Valuation' },
  { key: 'trailing_pe', label: 'Trailing P/E', min: 0, max: 100, step: 1, kind: 'x', group: 'Valuation' },
  { key: 'ev_ebitda', label: 'EV/EBITDA', min: 0, max: 80, step: 1, kind: 'x', group: 'Valuation' },
  { key: 'ev_sales', label: 'EV/Sales', min: 0, max: 30, step: 0.5, kind: 'x', group: 'Valuation' },
  { key: 'peg', label: 'PEG', min: 0, max: 5, step: 0.1, kind: 'num', group: 'Valuation' },
  { key: 'fcf_yield', label: 'FCF yield', min: -0.05, max: 0.15, step: 0.005, kind: 'pctPlain', group: 'Valuation' },
  { key: 'pe_vs_5y', label: 'P/E vs own 5Y avg', min: -0.8, max: 1, step: 0.05, kind: 'pct', group: 'Valuation', hint: 'Trailing GAAP P/E vs its own 5Y average. Negative = cheaper than history' },
  { key: 'ev_ebitda_vs_5y', label: 'EV/EBITDA vs own 5Y avg', min: -0.8, max: 1, step: 0.05, kind: 'pct', group: 'Valuation' },
  { key: 'fwd_pe_vs_5y', label: 'NTM P/E vs 5Y realized (ref.)', min: -1, max: 1, step: 0.05, kind: 'pct', group: 'Valuation', hint: 'Reference only: consensus EPS is non-GAAP, history is GAAP, so this skews negative for SBC-heavy companies' },
  { key: 'disc_fwd_pe', label: 'NTM P/E vs sub-ind median', min: -0.8, max: 1, step: 0.05, kind: 'pct', group: 'Valuation', hint: 'Negative = discount to peers' },
  { key: 'disc_ev_ebitda', label: 'EV/EBITDA vs sub-ind median', min: -0.8, max: 1, step: 0.05, kind: 'pct', group: 'Valuation' },
  { key: 'revenue_growth', label: 'Revenue growth (YoY)', min: -0.3, max: 1, step: 0.01, kind: 'pct', group: 'Growth' },
  { key: 'earnings_growth', label: 'Earnings growth (YoY)', min: -0.5, max: 1.5, step: 0.05, kind: 'pct', group: 'Growth' },
  { key: 'gross_margin', label: 'Gross margin', min: 0, max: 1, step: 0.01, kind: 'pctPlain', group: 'Profitability' },
  { key: 'operating_margin', label: 'Operating margin', min: -0.3, max: 0.7, step: 0.01, kind: 'pctPlain', group: 'Profitability' },
  { key: 'roic', label: 'ROIC (TTM)', min: -0.2, max: 0.8, step: 0.01, kind: 'pctPlain', group: 'Profitability' },
  { key: 'chg_1m', label: '1M price change', min: -0.4, max: 0.4, step: 0.01, kind: 'pct', group: 'Momentum' },
  { key: 'chg_3m', label: '3M price change', min: -0.6, max: 0.6, step: 0.01, kind: 'pct', group: 'Momentum' },
  { key: 'chg_1y', label: '1Y price change', min: -0.8, max: 2, step: 0.05, kind: 'pct', group: 'Momentum' },
  { key: 'off_52w_high', label: 'Off 52W high', min: -0.8, max: 0, step: 0.01, kind: 'pct', group: 'Momentum' },
  { key: 'eps_trend_90d', label: 'FY EPS est. change 90D', min: -0.3, max: 0.3, step: 0.01, kind: 'pct', group: 'Estimates' },
  { key: 'net_revisions_30d', label: 'Net EPS revisions 30D', min: -10, max: 10, step: 1, kind: 'int', group: 'Estimates' },
  { key: 'upside', label: 'Upside to avg PT', min: -0.3, max: 1, step: 0.01, kind: 'pct', group: 'Estimates' },
  { key: 'analyst_count', label: '# analysts', min: 0, max: 60, step: 1, kind: 'int', group: 'Estimates' },
  { key: 'value_score', label: 'Value score', min: 0, max: 100, step: 1, kind: 'num', group: 'Composite' },
]

const PRESETS: { name: string; desc: string; filters: Filters; sort: string; dir: 1 | -1 }[] = [
  { name: 'Cheap vs own history', desc: 'Trailing P/E or EV/EBITDA ≥20% below its own 5Y average (SEC-based, GAAP-consistent). Forward P/E history is not comparable on free data: consensus EPS is non-GAAP, reported history is GAAP.', filters: { _anyOwnHist: { max: -0.2 } }, sort: 'ev_ebitda_vs_5y', dir: 1 },
  { name: 'Cheap vs peers', desc: 'NTM P/E or EV/EBITDA ≥20% below the sub-industry median.', filters: { _anyPeer: { max: -0.2 } }, sort: 'disc_fwd_pe', dir: 1 },
  { name: 'GARP', desc: 'PEG ≤ 1.5 with revenue growth ≥ 10% and earnings growth ≥ 10%.', filters: { peg: { min: 0, max: 1.5 }, revenue_growth: { min: 0.1 }, earnings_growth: { min: 0.1 } }, sort: 'peg', dir: 1 },
  { name: 'High FCF yield + growth', desc: 'FCF yield ≥ 4% and revenue growing ≥ 5% YoY.', filters: { fcf_yield: { min: 0.04 }, revenue_growth: { min: 0.05 } }, sort: 'fcf_yield', dir: -1 },
  { name: 'Revisions up, stock down', desc: 'Current-FY EPS consensus up over 90 days (or net upward revisions in 30 days) but the stock is down over 1M or 3M.', filters: { _revUpPxDown: {} }, sort: 'eps_trend_90d', dir: -1 },
  { name: 'Beaten-down quality', desc: 'Operating margin ≥ 20% or ROIC ≥ 15%, gross margin ≥ 40%, and ≥ 25% below the 52-week high.', filters: { _quality: {}, gross_margin: { min: 0.4 }, off_52w_high: { max: -0.25 } }, sort: 'off_52w_high', dir: 1 },
]

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function passes(r: any, f: Filters): boolean {
  for (const [k, b] of Object.entries(f)) {
    if (k === '_anyOwnHist') {
      const ok = (num(r.pe_vs_5y) && r.pe_vs_5y <= b.max!) || (num(r.ev_ebitda_vs_5y) && r.ev_ebitda_vs_5y <= b.max!)
      if (!ok) return false
      continue
    }
    if (k === '_anyPeer') {
      const ok = (num(r.disc_fwd_pe) && r.disc_fwd_pe <= b.max!) || (num(r.disc_ev_ebitda) && r.disc_ev_ebitda <= b.max!)
      if (!ok) return false
      continue
    }
    if (k === '_revUpPxDown') {
      const revUp = (num(r.eps_trend_90d) && r.eps_trend_90d > 0) || (num(r.net_revisions_30d) && r.net_revisions_30d > 0)
      const pxDown = (num(r.chg_1m) && r.chg_1m < 0) || (num(r.chg_3m) && r.chg_3m < 0)
      if (!(revUp && pxDown)) return false
      continue
    }
    if (k === '_quality') {
      if (!((num(r.operating_margin) && r.operating_margin >= 0.2) || (num(r.roic) && r.roic >= 0.15))) return false
      continue
    }
    const v = r[k]
    if (!num(v)) return false
    if (b.min !== undefined && v < b.min) return false
    if (b.max !== undefined && v > b.max) return false
  }
  return true
}

const SPECIAL: Record<string, string> = {
  _anyOwnHist: 'P/E or EV/EBITDA ≤ −20% vs own 5Y avg',
  _anyPeer: 'NTM P/E or EV/EBITDA ≤ −20% vs sub-industry median',
  _revUpPxDown: 'EPS estimates rising & price down (1M or 3M)',
  _quality: 'Op margin ≥ 20% or ROIC ≥ 15%',
}

function Slider({ spec, bound, onChange }: { spec: Spec; bound?: Bound; onChange: (b: Bound | undefined) => void }) {
  const on = !!bound
  const lo = bound?.min ?? spec.min
  const hi = bound?.max ?? spec.max
  const f = (v: number) => fmtValue(v, spec.kind === 'int' ? 'int' : spec.kind) ?? ''
  return (
    <div className={`px-2 py-1 border-b border-line/60 ${on ? '' : 'opacity-60'}`} title={spec.hint}>
      <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
        <input type="checkbox" checked={on} onChange={() => onChange(on ? undefined : { min: spec.min, max: spec.max })} />
        <span className={on ? 'text-amber' : ''}>{spec.label}</span>
        {on && (
          <span className="ml-auto num text-[10px] text-fg">
            {bound?.min !== undefined && bound.min > spec.min ? f(bound.min) : '−∞'} … {bound?.max !== undefined && bound.max < spec.max ? f(bound.max) : '∞'}
          </span>
        )}
      </label>
      {on && (
        <div className="flex flex-col">
          <input type="range" min={spec.min} max={spec.max} step={spec.step} value={lo} onChange={(e) => onChange({ min: Math.min(+e.target.value, hi), max: bound?.max })} />
          <input type="range" min={spec.min} max={spec.max} step={spec.step} value={hi} onChange={(e) => onChange({ min: bound?.min, max: Math.max(+e.target.value, lo) })} />
        </div>
      )}
    </div>
  )
}

export default function Screener() {
  const nav = useNavigate()
  const { data, error } = useApi<any>('/screen')
  const [filters, setFilters] = useState<Filters>({})
  const [subs, setSubs] = useState<string[]>([])
  const [preset, setPreset] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'value_score', dir: -1 })
  const [showMethod, setShowMethod] = useState(false)

  // Slider bounds at the ends of their range mean "no limit"
  const effective: Filters = useMemo(() => {
    const out: Filters = {}
    for (const [k, b] of Object.entries(filters)) {
      const spec = SPECS.find((s) => s.key === k)
      if (!spec) {
        out[k] = b
        continue
      }
      out[k] = { min: b.min !== undefined && b.min > spec.min ? b.min : undefined, max: b.max !== undefined && b.max < spec.max ? b.max : undefined }
    }
    return out
  }, [filters])

  const rows = useMemo(() => (data?.rows ?? []).filter((r: any) => (subs.length === 0 || subs.includes(r.sub_industry)) && passes(r, effective)), [data, effective, subs])
  const dropped = useMemo(() => {
    // How many were excluded only because a filtered field is N/A
    if (!data) return 0
    return data.rows.filter((r: any) => (subs.length === 0 || subs.includes(r.sub_industry)) && !passes(r, effective) && Object.keys(effective).some((k) => !k.startsWith('_') && !num(r[k]))).length
  }, [data, effective, subs])

  const cols: Col<any>[] = [
    { key: 'star', label: '', render: (r) => <Star ticker={r.ticker} /> },
    { key: 'ticker', label: 'Ticker', kind: 'text', render: (r) => <span className="text-amber num">{r.ticker}</span> },
    { key: 'name', label: 'Name', kind: 'text', render: (r) => <span className="truncate inline-block max-w-[150px] align-bottom">{r.name}</span> },
    { key: 'sub_industry', label: 'Sub-Ind', kind: 'text', render: (r) => <span className="text-dim">{r.sub_industry}</span> },
    {
      key: 'value_score',
      label: 'Score',
      kind: 'num',
      digits: 0,
      title: 'Composite value score (see methodology)',
      render: (r) =>
        num(r.value_score) ? (
          <span
            className="num"
            title={`${Object.entries(r.score_parts)
              .map(([k, v]) => `${k}: ${num(v) ? Math.round(v as number) : 'N/A'}`)
              .join('\n')}\nCoverage: ${Math.round(r.score_coverage * 100)}% of inputs`}
            style={{ color: r.value_score >= 70 ? '#2fd16c' : r.value_score <= 30 ? '#ff4d4d' : undefined }}
          >
            {Math.round(r.value_score)}
            {r.score_coverage < 0.5 ? '*' : ''}
          </span>
        ) : (
          <Val v={null} na={r.na?.value_score} />
        ),
    },
    { key: 'market_cap', label: 'Mkt Cap', kind: 'cap' },
    { key: 'forward_pe', label: 'NTM P/E', kind: 'x', title: 'Price / NTM consensus EPS' },
    { key: 'ev_ebitda', label: 'EV/EBITDA', kind: 'x', render: (r) => <BasisVal row={r} k='ev_ebitda' kind='x' /> },
    { key: 'ev_sales', label: 'EV/Sales', kind: 'x', render: (r) => <BasisVal row={r} k='ev_sales' kind='x' /> },
    { key: 'peg', label: 'PEG', kind: 'num' },
    { key: 'fcf_yield', label: 'FCF Yld', kind: 'pctPlain', render: (r) => <BasisVal row={r} k='fcf_yield' kind='pctPlain' /> },
    { key: 'pe_vs_5y', label: 'P/E vs 5Y', kind: 'pct', color: true, title: 'Trailing P/E vs own 5Y average (SEC-based)' },
    { key: 'ev_ebitda_vs_5y', label: 'EV/EBITDA vs 5Y', kind: 'pct', color: true },
    { key: 'disc_fwd_pe', label: 'NTM vs Peers', kind: 'pct', color: true, title: 'vs sub-industry median' },
    { key: 'revenue_growth', label: 'Rev Gr', kind: 'pct', color: true },
    { key: 'earnings_growth', label: 'EPS Gr', kind: 'pct', color: true },
    { key: 'operating_margin', label: 'Op M', kind: 'pctPlain' },
    { key: 'roic', label: 'ROIC', kind: 'pctPlain' },
    { key: 'eps_trend_90d', label: 'Est Δ90D', kind: 'pct', color: true },
    { key: 'chg_1m', label: '1M', kind: 'pct', color: true },
    { key: 'chg_3m', label: '3M', kind: 'pct', color: true },
    { key: 'off_52w_high', label: 'Off Hi', kind: 'pct', color: true },
    { key: 'upside', label: 'PT Up', kind: 'pct', color: true },
  ]

  const groups = [...new Set(SPECS.map((s) => s.group))]

  return (
    <div className="grid grid-cols-[260px_1fr] gap-1.5 h-full min-h-0">
      <Panel title="Filters" png={false} bodyClass="overflow-auto">
        <div className="p-2 border-b border-line">
          <div className="text-[10px] text-dim uppercase mb-1">Preset screens</div>
          <div className="flex flex-col gap-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                title={p.desc}
                onClick={() => {
                  setPreset(p.name)
                  setFilters(p.filters)
                  setSort({ key: p.sort, dir: p.dir })
                }}
                className={`text-left px-1.5 py-0.5 text-[11px] border border-line ${preset === p.name ? 'tab-active' : 'text-amber hover:bg-amber/10'}`}
              >
                {p.name}
              </button>
            ))}
            <button
              className="text-left px-1.5 py-0.5 text-[11px] text-dim hover:text-fg"
              onClick={() => {
                setPreset(null)
                setFilters({})
                setSubs([])
                setSort({ key: 'value_score', dir: -1 })
              }}
            >
              ✕ Clear all
            </button>
          </div>
          {preset && <div className="mt-1 text-[10px] text-dim leading-snug">{PRESETS.find((p) => p.name === preset)?.desc}</div>}
          {Object.keys(filters)
            .filter((k) => SPECIAL[k])
            .map((k) => (
              <div key={k} className="mt-1 text-[10px] text-amber flex">
                ● {SPECIAL[k]}
                <button
                  className="ml-auto text-dim hover:text-fg"
                  onClick={() => {
                    const n = { ...filters }
                    delete n[k]
                    setFilters(n)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
        </div>
        <div className="p-2 border-b border-line">
          <div className="text-[10px] text-dim uppercase mb-1">Sub-industry</div>
          <div className="flex flex-wrap gap-1">
            {(data?.sub_industries ?? []).map((s: string) => (
              <button
                key={s}
                onClick={() => setSubs(subs.includes(s) ? subs.filter((x) => x !== s) : [...subs, s])}
                className={`px-1 text-[10px] border border-line ${subs.includes(s) ? 'tab-active' : 'text-dim hover:text-fg'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {groups.map((g) => (
          <div key={g}>
            <div className="px-2 pt-2 text-[10px] text-dim uppercase">{g}</div>
            {SPECS.filter((s) => s.group === g).map((s) => (
              <Slider
                key={s.key}
                spec={s}
                bound={filters[s.key]}
                onChange={(b) => {
                  const n = { ...filters }
                  if (b) n[s.key] = b
                  else delete n[s.key]
                  setFilters(n)
                  setPreset(null)
                }}
              />
            ))}
          </div>
        ))}
      </Panel>
      <div className="flex flex-col gap-1.5 min-w-0 min-h-0">
        <Panel
          title={`Screener results · ${rows.length} of ${data?.covered ?? '…'} companies`}
          png={false}
          className="flex-1 min-h-0"
          right={
            <button className="text-[10px] text-dim hover:text-amber" onClick={() => setShowMethod(!showMethod)}>
              {showMethod ? 'HIDE' : 'SHOW'} SCORE METHODOLOGY
            </button>
          }
        >
          {error ? (
            <ErrorBox error={error} />
          ) : !data ? (
            <Loading />
          ) : (
            <>
              {showMethod && <pre className="p-2 text-[10.5px] text-dim whitespace-pre-wrap font-mono border-b border-line">{data.methodology}</pre>}
              {data.covered < data.universe_count && (
                <div className="px-2 py-1 text-[10.5px] text-info border-b border-line">
                  {data.universe_count - data.covered} of {data.universe_count} universe names don't have a fundamentals snapshot yet. The nightly job fills them in within
                  rate limits (SET → Run nightly now).
                </div>
              )}
              {dropped > 0 && <div className="px-2 py-0.5 text-[10px] text-dim">{dropped} companies excluded because a filtered field is N/A for them.</div>}
              <DataTable
                key={`${sort.key}${sort.dir}`}
                title="screener_results"
                cols={cols}
                rows={rows}
                rowKey={(r) => r.ticker}
                initialSort={sort}
                onRow={(r) => nav(`/c/${r.ticker}/RV`)}
                maxHeight="calc(100vh - 170px)"
                empty="No companies match. Loosen a filter."
              />
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
