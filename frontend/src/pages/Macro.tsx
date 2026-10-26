import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Col } from '../components/DataTable'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/Panel'
import { AXIS, C, GRID, TOOLTIP } from '../lib/chart'
import { useApi } from '../lib/useApi'
import { useWatchlists } from '../lib/watchlists'

function SeriesCard({ s }: { s: any }) {
  const fmt = (v: number) => (s.unit === 'k' ? `${v.toFixed(0)}k` : `${v.toFixed(2)}${s.unit === '%' || s.unit === 'pp' ? '%' : ''}`)
  return (
    <Panel
      title={s.label}
      right={
        <a href={s.source_url} target="_blank" rel="noreferrer" className="text-[10px] text-dim hover:text-amber">
          {s.id}
        </a>
      }
      note={s.note}
    >
      {s.points.length === 0 ? (
        <Empty>{s.error ?? 'No data'}</Empty>
      ) : (
        <>
          <div className="flex items-baseline gap-2 px-2 pt-1 num">
            <span className="text-[16px] text-amber">{fmt(s.last)}</span>
            <span className="text-[10px] text-dim">as of {s.last_date}</span>
            {s.chg_1y != null && (
              <span className={`text-[10px] ml-auto ${s.chg_1y >= 0 ? 'text-up' : 'text-down'}`}>
                {s.chg_1y >= 0 ? '+' : ''}
                {fmt(s.chg_1y)} vs 1Y ago
              </span>
            )}
          </div>
          <div style={{ height: 120 }}>
            <ResponsiveContainer>
              <LineChart data={s.points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={(d) => d.slice(0, 4)} minTickGap={40} />
                <YAxis {...AXIS} width={38} domain={['auto', 'auto']} tickFormatter={(v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))} />
                <Tooltip {...TOOLTIP} formatter={(v: any) => fmt(v)} />
                {s.points.some((p: any) => p.v < 0) && <ReferenceLine y={0} stroke="#444" />}
                <Line dataKey="v" stroke={C.amber} dot={false} strokeWidth={1.3} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  )
}

function Sensitivity() {
  const { lists, active } = useWatchlists()
  const [wl, setWl] = useState(active)
  const [years, setYears] = useState('3')
  const { data, error } = useApi<any>(`/macro/sensitivity?watchlist=${encodeURIComponent(wl)}&years=${years}`)
  const cols: Col<any>[] = [
    { key: 'ticker', label: 'Ticker', kind: 'text', render: (r) => <span className="text-amber num">{r.ticker}</span> },
    { key: 'beta_spy', label: 'Beta S&P 500', kind: 'num', title: 'Beta vs SPY' },
    { key: 'corr_spy', label: 'Corr S&P 500', kind: 'num', title: 'Correlation vs SPY' },
    { key: 'beta_qqq', label: 'Beta Nasdaq-100', kind: 'num' },
    { key: 'corr_qqq', label: 'Corr Nasdaq-100', kind: 'num' },
    { key: 'etf', label: 'Sector ETF', kind: 'text' },
    { key: 'beta_etf', label: 'Beta Sector', kind: 'num' },
    { key: 'corr_etf', label: 'Corr Sector', kind: 'num' },
    { key: 'rate_beta', label: '% per +10bp 10Y', kind: 'pct', color: true, digits: 2, title: "Stock's average weekly % move per +10bp change in the 10Y yield" },
    { key: 'corr_10y', label: 'Corr 10Y Δ', kind: 'num' },
    { key: 'vol_ann', label: 'Ann. Vol', kind: 'pctPlain' },
  ]
  return (
    <Panel
      title="Watchlist sensitivity to rates & indices"
      png={false}
      right={
        <div className="flex items-center gap-2">
          <select value={wl} onChange={(e) => setWl(e.target.value)} className="bg-black border border-line text-[11px]">
            {Object.keys(lists).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <Seg value={years} options={[{ value: '1', label: '1Y' }, { value: '3', label: '3Y' }, { value: '5', label: '5Y' }] as any} onChange={setYears} />
        </div>
      }
    >
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : <DataTable title={`sensitivity_${wl}_${years}y`} cols={cols} rows={data.rows} rowKey={(r) => r.ticker} />}
      {data?.method && <div className="px-2 py-1 text-[10px] text-dim">{data.method}</div>}
    </Panel>
  )
}

export default function Macro() {
  const { data, error } = useApi<any>('/macro')
  const groups = [...new Set<string>((data?.series ?? []).map((s: any) => s.group))]
  return (
    <div className="flex flex-col gap-1.5">
      <Sensitivity />
      {error && <ErrorBox error={error} />}
      {!data ? (
        <Loading what="Loading FRED series (first load fetches ~20 series)" />
      ) : data.needs_key ? (
        <Panel title="Macro series" png={false}>
          <div className="p-3 text-[12px] leading-relaxed">
            <div className="text-amber mb-1">FRED API key needed</div>
            Get a free key at <a className="text-info" href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noreferrer">fred.stlouisfed.org/docs/api/api_key.html</a> (takes a
            minute, no cost), add <span className="num text-amber">FRED_API_KEY=…</span> to <span className="num">.env</span>, and restart the backend. Until then, betas and
            correlations to the S&amp;P 500 and Nasdaq above still work; rate sensitivity shows N/A.
          </div>
        </Panel>
      ) : (
        groups.map((g) => (
          <div key={g}>
            <div className="text-amber text-[11px] uppercase tracking-wide px-1 pt-1">{g}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5">
              {data.series
                .filter((s: any) => s.group === g)
                .map((s: any) => (
                  <SeriesCard key={s.id} s={s} />
                ))}
            </div>
          </div>
        ))
      )}
      {data && !data.needs_key && <div className="text-[10px] text-dim px-1">Source: {data.source}. Daily series shown weekly. YoY series are computed from index levels. Refreshed daily.</div>}
    </div>
  )
}
