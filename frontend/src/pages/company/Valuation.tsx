import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Col } from '../../components/DataTable'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, C, GRID, TOOLTIP } from '../../lib/chart'
import { Val } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import { Star } from '../../lib/watchlists'
import type { TabProps } from '../Company'

const METRICS = [
  { key: 'pe', label: 'P/E', snap: 'trailing_pe', kind: 'x' as const },
  { key: 'fwd_pe_realized', label: 'NTM P/E', snap: 'ntm_pe', kind: 'x' as const },
  { key: 'ev_ebitda', label: 'EV/EBITDA', snap: 'ev_ebitda', kind: 'x' as const },
  { key: 'ev_sales', label: 'EV/Sales', snap: 'ev_sales', kind: 'x' as const },
  { key: 'fcf_yield', label: 'FCF Yield', snap: 'fcf_yield', kind: 'pctPlain' as const },
  { key: 'peg', label: 'PEG', snap: 'peg', kind: 'num' as const },
]

export function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

const fmtM = (v: any, kind: string) => (v === null || v === undefined ? 'N/A' : kind === 'pctPlain' ? `${(v * 100).toFixed(1)}%` : `${Number(v).toFixed(kind === 'num' ? 2 : 1)}${kind === 'x' ? 'x' : ''}`)

function HistoryChart({ data, metric, ticker }: { data: any; metric: (typeof METRICS)[number]; ticker: string }) {
  const st = data.summary?.metrics?.[metric.key]?.stats_5y
  const peer = useMemo(() => Object.fromEntries((data.peer_median?.points ?? []).map((p: any) => [p.date, p[metric.key]])), [data, metric])
  const rows = data.history.map((p: any) => ({ date: p.date, v: p[metric.key], peer: peer[p.date] ?? null, band: st ? [st.p25, st.p75] : null }))
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
  const metric = METRICS.find((m) => m.key === mk)!

  const peerRows = (peers?.rows ?? []).filter((r: any) => r.ticker !== ticker)
  const summaryRows = METRICS.map((m) => {
    const s = data?.summary?.metrics?.[m.key] ?? {}
    const pm = median(peerRows.map((r: any) => r[m.snap]))
    const cur = snap?.[m.snap]
    return {
      metric: m.label,
      kind: m.kind,
      sec_current: s.current,
      yahoo_current: cur,
      avg: s.stats_5y?.mean,
      med: s.stats_5y?.median,
      min: s.stats_5y?.min,
      max: s.stats_5y?.max,
      pctile: s.percentile_5y,
      // For forward P/E, "current" is today's consensus (Yahoo) vs the 5Y average realized forward P/E
      vs_avg: m.key === 'fwd_pe_realized' ? snap?.fwd_pe_vs_5y : s.vs_avg,
      peer_median: pm,
      vs_peer: cur != null && pm ? cur / pm - 1 : null,
      na: {
        sec_current:
          m.key === 'fwd_pe_realized'
            ? "Today's forward P/E needs consensus estimates (Yahoo column). History uses realized next-12M GAAP earnings; consensus EPS is usually non-GAAP, so compare with care."
            : 'Not meaningful (negative or zero denominator) or no SEC data',
        avg: 'Fewer than 6 meaningful monthly points in 5 years',
        peer_median: 'No peers with this metric',
        yahoo_current: snap?.na?.[m.snap],
      },
    }
  })

  const sCols: Col<any>[] = [
    { key: 'metric', label: 'Multiple', kind: 'text', render: (r) => <span className="text-amber">{r.metric}</span> },
    { key: 'yahoo_current', label: 'Current (Yahoo)', render: (r) => <Val v={r.yahoo_current} kind={r.kind} na={r.na.yahoo_current} />, title: 'Latest close / Yahoo TTM fundamentals' },
    { key: 'sec_current', label: 'Current (SEC)', render: (r) => <Val v={r.sec_current} kind={r.kind} na={r.na.sec_current} />, title: 'Latest close / SEC-reported TTM (methodology below)' },
    { key: 'avg', label: '5Y Avg', render: (r) => <Val v={r.avg} kind={r.kind} na={r.na.avg} /> },
    { key: 'med', label: '5Y Med', render: (r) => <Val v={r.med} kind={r.kind} na={r.na.avg} /> },
    { key: 'min', label: '5Y Low', render: (r) => <Val v={r.min} kind={r.kind} na={r.na.avg} /> },
    { key: 'max', label: '5Y High', render: (r) => <Val v={r.max} kind={r.kind} na={r.na.avg} /> },
    { key: 'pctile', label: '5Y %ile', render: (r) => <Val v={r.pctile} kind="pctPlain" digits={0} na={r.na.avg} />, title: 'Where today sits in its own 5Y range (0% = cheapest)' },
    { key: 'vs_avg', label: 'vs 5Y Avg', render: (r) => <Val v={r.vs_avg} kind="pct" color na={r.na.avg} /> },
    { key: 'peer_median', label: 'Peer Med', render: (r) => <Val v={r.peer_median} kind={r.kind} na={r.na.peer_median} /> },
    { key: 'vs_peer', label: 'vs Peers', render: (r) => <Val v={r.vs_peer} kind="pct" color na="Missing own or peer value" /> },
  ]

  const compCols: Col<any>[] = [
    { key: 'star', label: '', render: (r) => (r.ticker === 'MEDIAN' ? null : <Star ticker={r.ticker} />) },
    { key: 'ticker', label: 'Ticker', kind: 'text', render: (r) => <span className={r.ticker === ticker ? 'text-amber font-semibold num' : r.ticker === 'MEDIAN' ? 'text-info num' : 'num'}>{r.ticker}</span> },
    { key: 'name', label: 'Name', kind: 'text', render: (r) => <span className="truncate inline-block max-w-[160px] align-bottom">{r.name}</span> },
    { key: 'market_cap', label: 'Mkt Cap', kind: 'cap' },
    { key: 'trailing_pe', label: 'P/E', kind: 'x' },
    { key: 'forward_pe', label: 'Fwd P/E', kind: 'x' },
    { key: 'ev_ebitda', label: 'EV/EBITDA', kind: 'x' },
    { key: 'ev_sales', label: 'EV/Sales', kind: 'x' },
    { key: 'fcf_yield', label: 'FCF Yld', kind: 'pctPlain' },
    { key: 'peg', label: 'PEG', kind: 'num' },
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
      <Panel title={`${ticker} ${metric.label} over time vs 5Y average & peer median`} right={<Seg value={mk} options={METRICS.map((m) => ({ value: m.key, label: m.label }))} onChange={setMk} />}>
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
          "Current (Yahoo)" uses Yahoo's TTM fundamentals with the latest close and is what the screener uses. "Current (SEC)" uses the same method as the history line, so
          compare the history to that column. Small differences come from TTM timing and debt definitions.
        </div>
      </Panel>
    </div>
  )
}
