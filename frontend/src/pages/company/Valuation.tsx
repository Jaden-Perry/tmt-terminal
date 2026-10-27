import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Col } from '../../components/DataTable'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, C, GRID, TOOLTIP } from '../../lib/chart'
import { BasisVal, Val } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import { Star } from '../../lib/watchlists'
import type { TabProps } from '../Company'

// One definition per multiple, shared by the summary, the comps table, the dashboard and the screener.
// `hist` is the matching series in the SEC-based monthly history (null = no free history exists).
const METRICS = [
  { key: 'pe', hist: 'pe', label: 'P/E (TTM)', snap: 'trailing_pe', kind: 'x' as const, basis: 'SEC TTM net income' },
  { key: 'ntm', hist: 'fwd_pe_realized', label: 'NTM P/E', snap: 'forward_pe', kind: 'x' as const, basis: 'NTM consensus EPS' },
  { key: 'ev_ebitda', hist: 'ev_ebitda', label: 'EV/EBITDA (TTM)', snap: 'ev_ebitda', kind: 'x' as const, basis: 'SEC TTM' },
  { key: 'ev_sales', hist: 'ev_sales', label: 'EV/Sales (TTM)', snap: 'ev_sales', kind: 'x' as const, basis: 'SEC TTM' },
  { key: 'fcf_yield', hist: 'fcf_yield', label: 'FCF Yield (TTM)', snap: 'fcf_yield', kind: 'pctPlain' as const, basis: 'SEC TTM (CFO − capex)' },
  { key: 'peg', hist: null, label: 'PEG', snap: 'peg', kind: 'num' as const, basis: 'NTM P/E ÷ next-FY consensus EPS growth' },
]
const CHART_METRICS = METRICS.filter((m) => m.hist)

export function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

const fmtM = (v: any, kind: string) => (v === null || v === undefined ? 'N/A' : kind === 'pctPlain' ? `${(v * 100).toFixed(1)}%` : `${Number(v).toFixed(kind === 'num' ? 2 : 1)}${kind === 'x' ? 'x' : ''}`)

function HistoryChart({ data, metric, ticker }: { data: any; metric: (typeof METRICS)[number]; ticker: string }) {
  const hk = metric.hist as string
  const st = data.summary?.metrics?.[hk]?.stats_5y
  const peer = useMemo(() => Object.fromEntries((data.peer_median?.points ?? []).map((p: any) => [p.date, p[hk]])), [data, hk])
  const rows = data.history.map((p: any) => ({ date: p.date, v: p[hk], peer: peer[p.date] ?? null, band: st ? [st.p25, st.p75] : null }))
  // Clip extreme outliers so the chart stays readable (e.g. P/E of 900x when earnings ~0)
  const vals = rows.map((r: any) => r.v).filter((v: any) => v !== null).sort((a: number, b: number) => a - b)
  const cap = vals.length ? vals[Math.floor(vals.length * 0.95)] * 1.5 : undefined
  return (
    <div style={{ height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={(d) => d.slice(0, 7)} minTickGap={40} />
          <YAxis {...AXIS} width={44} domain={[0, cap ?? 'auto']} allowDataOverflow tickFormatter={(v) => fmtM(v, metric.kind)} />
          <Tooltip {...TOOLTIP} formatter={(v: any, n: any) => (Array.isArray(v) ? `${fmtM(v[0], metric.kind)}–${fmtM(v[1], metric.kind)}` : [fmtM(v, metric.kind), n])} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {st && <Area dataKey="band" name="5Y interquartile range" fill={C.amber} fillOpacity={0.08} stroke="none" isAnimationActive={false} />}
          {st && <ReferenceLine y={st.mean} stroke={C.amber} strokeDasharray="4 4" label={{ value: `5Y avg ${fmtM(st.mean, metric.kind)}`, fill: C.amber, fontSize: 10, position: 'insideTopLeft' }} />}
          <Line dataKey="v" name={`${ticker} ${metric.label}`} stroke={C.amber} dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="peer" name={`Peer median (${data.peer_median?.peers?.length ?? 0} cos)`} stroke={C.blue} dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function Valuation({ ticker, snap }: TabProps) {
  const nav = useNavigate()
  const { data, error } = useApi<any>(`/company/${ticker}/valuation`)
  const { data: peers } = useApi<any>(`/company/${ticker}/peers`)
  const [mk, setMk] = useState('pe')
  const metric = CHART_METRICS.find((m) => m.key === mk) ?? CHART_METRICS[0]

  const peerRows = (peers?.rows ?? []).filter((r: any) => r.ticker !== ticker)
  const fiveYrAgo = new Date(Date.now() - 5 * 365.25 * 864e5).toISOString().slice(0, 10)
  const summaryRows = METRICS.map((m) => {
    const st = m.hist ? data?.summary?.metrics?.[m.hist]?.stats_5y : null
    const cur = snap?.[m.snap]
    const usedBasis: string = snap?.basis?.[m.snap] ?? m.basis
    const yahooFallback = usedBasis.startsWith('Yahoo')
    // Percentile of today's value within its own 5Y monthly history (same method as the history line)
    const hist5: number[] = m.hist ? (data?.history ?? []).filter((p: any) => p.date >= fiveYrAgo && p[m.hist!] != null).map((p: any) => p[m.hist!]) : []
    const pctile = cur != null && hist5.length >= 6 && !yahooFallback ? hist5.filter((v) => v <= cur).length / hist5.length : null
    const pm = median(peerRows.map((r: any) => r[m.snap]))
    const noHist = m.hist
      ? yahooFallback
        ? 'Current value is from Yahoo (SEC data missing or stale), so it is not compared with the SEC-based history.'
        : 'Fewer than 6 meaningful monthly points in 5 years (e.g. negative earnings).'
      : 'No free source keeps a history of consensus estimates, so PEG has no 5Y range.'
    return {
      metric: m.label,
      basis: usedBasis + (m.key === 'ntm' ? ' · history: realized next-12M GAAP earnings' : ''),
      kind: m.kind,
      current: cur,
      avg: st?.mean,
      med: st?.median,
      min: st?.min,
      max: st?.max,
      pctile,
      vs_avg: cur != null && st?.mean && !yahooFallback ? cur / st.mean - 1 : null,
      peer_median: pm,
      vs_peer: cur != null && pm ? cur / pm - 1 : null,
      na: { current: snap?.na?.[m.snap], hist: noHist, peer_median: 'No peers with this metric' },
    }
  })

  const sCols: Col<any>[] = [
    { key: 'metric', label: 'Multiple', kind: 'text', render: (r) => <span className="text-amber">{r.metric}</span> },
    { key: 'current', label: 'Current', render: (r) => <Val v={r.current} kind={r.kind} na={r.na.current} />, title: 'Latest close, using the basis shown' },
    { key: 'basis', label: 'Basis', kind: 'text', render: (r) => <span className="text-dim text-[10.5px]">{r.basis}</span> },
    { key: 'avg', label: '5Y Avg', render: (r) => <Val v={r.avg} kind={r.kind} na={r.na.hist} /> },
    { key: 'med', label: '5Y Med', render: (r) => <Val v={r.med} kind={r.kind} na={r.na.hist} /> },
    { key: 'min', label: '5Y Low', render: (r) => <Val v={r.min} kind={r.kind} na={r.na.hist} /> },
    { key: 'max', label: '5Y High', render: (r) => <Val v={r.max} kind={r.kind} na={r.na.hist} /> },
    { key: 'pctile', label: '5Y %ile', render: (r) => <Val v={r.pctile} kind="pctPlain" digits={0} na={r.na.hist} />, title: 'Where today sits in its own 5Y range (0% = cheapest)' },
    { key: 'vs_avg', label: 'vs 5Y Avg', render: (r) => <Val v={r.vs_avg} kind="pct" color na={r.na.hist} /> },
    { key: 'peer_median', label: 'Peer Med', render: (r) => <Val v={r.peer_median} kind={r.kind} na={r.na.peer_median} />, title: 'Median of the comps below (same basis)' },
    { key: 'vs_peer', label: 'vs Peers', render: (r) => <Val v={r.vs_peer} kind="pct" color na="Missing own or peer value" /> },
  ]

  const compCols: Col<any>[] = [
    { key: 'star', label: '', render: (r) => (r.ticker === 'MEDIAN' ? null : <Star ticker={r.ticker} />) },
    { key: 'ticker', label: 'Ticker', kind: 'text', render: (r) => <span className={r.ticker === ticker ? 'text-amber font-semibold num' : r.ticker === 'MEDIAN' ? 'text-info num' : 'num'}>{r.ticker}</span> },
    { key: 'name', label: 'Name', kind: 'text', render: (r) => <span className="truncate inline-block max-w-[160px] align-bottom">{r.name}</span> },
    { key: 'market_cap', label: 'Mkt Cap', kind: 'cap' },
    { key: 'trailing_pe', label: 'P/E TTM', kind: 'x', title: 'SEC TTM', render: (r) => (r.ticker === 'MEDIAN' ? <Val v={r.trailing_pe} kind='x' /> : <BasisVal row={r} k='trailing_pe' kind='x' />) },
    { key: 'forward_pe', label: 'NTM P/E', kind: 'x', title: 'Price / NTM consensus EPS' },
    { key: 'ev_ebitda', label: 'EV/EBITDA', kind: 'x', render: (r) => (r.ticker === 'MEDIAN' ? <Val v={r.ev_ebitda} kind='x' /> : <BasisVal row={r} k='ev_ebitda' kind='x' />) },
    { key: 'ev_sales', label: 'EV/Sales', kind: 'x', render: (r) => (r.ticker === 'MEDIAN' ? <Val v={r.ev_sales} kind='x' /> : <BasisVal row={r} k='ev_sales' kind='x' />) },
    { key: 'fcf_yield', label: 'FCF Yld', kind: 'pctPlain', title: 'SEC TTM (CFO − capex) / market cap', render: (r) => (r.ticker === 'MEDIAN' ? <Val v={r.fcf_yield} kind='pctPlain' /> : <BasisVal row={r} k='fcf_yield' kind='pctPlain' />) },
    { key: 'peg', label: 'PEG', kind: 'num', title: 'NTM P/E ÷ next-FY consensus EPS growth' },
    { key: 'revenue_growth', label: 'Rev Gr', kind: 'pct', color: true },
    { key: 'gross_margin', label: 'Gross M', kind: 'pctPlain' },
    { key: 'operating_margin', label: 'Op M', kind: 'pctPlain' },
    { key: 'roic', label: 'ROIC', kind: 'pctPlain' },
    { key: 'chg_1y', label: '1Y', kind: 'pct', color: true },
    { key: 'upside', label: 'PT Upside', kind: 'pct', color: true },
  ]
  const numericKeys = compCols.filter((c) => c.kind && c.kind !== 'text').map((c) => c.key)
  const medianRow: any = { ticker: 'MEDIAN', name: `Peer median (ex-${ticker})`, na: {} }
  numericKeys.forEach((k) => (medianRow[k] = median(peerRows.map((r: any) => r[k]))))
  const compRows = peers ? [...peers.rows, medianRow] : []

  return (
    <div className="flex flex-col gap-1.5">
      {error && <ErrorBox error={error} />}
      <Panel title={`${ticker} Valuation vs own 5Y history & peers`} png={false}>
        {!data ? <Loading what="Computing valuation history from SEC financials" /> : <DataTable title={`${ticker}_valuation_summary`} cols={sCols} rows={summaryRows} />}
      </Panel>
      <Panel title={`${ticker} ${metric.label} over time vs 5Y average & peer median`} right={<Seg value={metric.key} options={CHART_METRICS.map((m) => ({ value: m.key, label: m.label }))} onChange={setMk} />}>
        {!data ? <Loading /> : data.history.length === 0 ? <Empty>{data.note}</Empty> : <HistoryChart data={data} metric={metric} ticker={ticker} />}
        {data?.peer_median?.note && <div className="px-2 text-[10px] text-dim">{data.peer_median.note}</div>}
      </Panel>
      <Panel title={`Comps: ${snap?.sub_industry ?? ''} peers`} png={false}>
        {!peers ? (
          <Loading what="Loading comps (peers without a cached snapshot are fetched once from Yahoo)" />
        ) : (
          <DataTable title={`${ticker}_comps`} cols={compCols} rows={compRows} rowKey={(r) => r.ticker} onRow={(r) => r.ticker !== 'MEDIAN' && nav(`/c/${r.ticker}/RV`)} />
        )}
      </Panel>
      <Panel title="Methodology" png={false}>
        <pre className="p-2 text-[10.5px] text-dim whitespace-pre-wrap font-mono">{data?.methodology?.trim()}</pre>
        <div className="px-2 pb-2 text-[10.5px] text-dim">
          Every multiple has one definition used everywhere (this tab, comps, dashboard, screener): trailing multiples use SEC-reported TTM figures with the latest
          close and total market cap (all share classes); forward P/E uses NTM consensus EPS; PEG is NTM P/E ÷ next-FY consensus EPS growth. If a company's SEC
          data is missing or stale, the Basis column says Yahoo and the value isn't compared with the SEC history.
        </div>
      </Panel>
    </div>
  )
}
