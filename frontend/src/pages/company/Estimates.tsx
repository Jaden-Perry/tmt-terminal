import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Col } from '../../components/DataTable'
import { Empty, ErrorBox, Loading, Panel } from '../../components/Panel'
import { AXIS, C, GRID, TOOLTIP } from '../../lib/chart'
import { ago } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

function PriceTargetBar({ pt, price }: { pt: any; price: number | null }) {
  if (!pt?.low || !pt?.high) return <Empty>No price-target range available{pt?.source ? '' : ' (no source has targets for this ticker)'}.</Empty>
  const lo = Math.min(pt.low, price ?? pt.low) * 0.95
  const hi = Math.max(pt.high, price ?? pt.high) * 1.05
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const mark = (v: number | null | undefined, label: string, color: string, top: boolean) =>
    v ? (
      <div className="absolute flex flex-col items-center -translate-x-1/2" style={{ left: x(v), [top ? 'bottom' : 'top']: 14 }}>
        {top && <span className="text-[10px] num whitespace-nowrap" style={{ color }}>{label} {v.toFixed(0)}</span>}
        <span className="w-px h-3" style={{ background: color }} />
        {!top && <span className="text-[10px] num whitespace-nowrap" style={{ color }}>{label} {v.toFixed(0)}</span>}
      </div>
    ) : null
  return (
    <div className="px-6 py-10">
      <div className="relative h-2 bg-line">
        <div className="absolute h-2 bg-amber/40" style={{ left: x(pt.low), width: `calc(${x(pt.high)} - ${x(pt.low)})` }} />
        {mark(pt.low, 'Low', C.red, false)}
        {mark(pt.high, 'High', C.green, false)}
        {mark(pt.mean, 'Mean', C.amber, true)}
        {mark(price, 'Last', '#fff', false)}
        {pt.median && Math.abs(pt.median - pt.mean) / pt.mean > 0.03 ? mark(pt.median, 'Med', C.blue, true) : null}
      </div>
    </div>
  )
}

export default function Estimates({ ticker, snap }: TabProps) {
  const { data, error } = useApi<any>(`/company/${ticker}/estimates`)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading analyst data" />

  const consCols: Col<any>[] = [
    { key: 'label', label: 'Period', kind: 'text', render: (r) => <span className="text-amber">{r.label}</span> },
    { key: 'eps_avg', label: 'EPS Cons', kind: 'money' },
    { key: 'eps_low', label: 'Low', kind: 'money' },
    { key: 'eps_high', label: 'High', kind: 'money' },
    { key: 'eps_year_ago', label: 'Yr Ago', kind: 'money' },
    { key: 'eps_growth', label: 'EPS Gr', kind: 'pct', color: true },
    { key: 'eps_analysts', label: '#', kind: 'int' },
    { key: 'rev_avg', label: 'Rev Cons', kind: 'cap' },
    { key: 'rev_low', label: 'Low', kind: 'cap' },
    { key: 'rev_high', label: 'High', kind: 'cap' },
    { key: 'rev_growth', label: 'Rev Gr', kind: 'pct', color: true },
    { key: 'rev_analysts', label: '#', kind: 'int' },
  ]
  const trendCols: Col<any>[] = [
    { key: 'label', label: 'EPS for', kind: 'text', render: (r) => <span className="text-amber">{r.label}</span> },
    { key: 'current', label: 'Now', kind: 'money' },
    { key: 'd7', label: '7D ago', kind: 'money' },
    { key: 'd30', label: '30D ago', kind: 'money' },
    { key: 'd60', label: '60D ago', kind: 'money' },
    { key: 'd90', label: '90D ago', kind: 'money' },
    { key: 'chg90', label: 'Δ 90D', kind: 'pct', color: true, get: (r) => (r.current != null && r.d90 ? r.current / Math.abs(r.d90) - 1 : null) },
    { key: 'up7', label: 'Up 7D', kind: 'int' },
    { key: 'down7', label: 'Dn 7D', kind: 'int' },
    { key: 'up30', label: 'Up 30D', kind: 'int' },
    { key: 'down30', label: 'Dn 30D', kind: 'int' },
  ]
  const surprises = [...data.surprises].reverse()
  const recs = [...(data.recommendations ?? [])].reverse()

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
        <Panel title={`${ticker} Consensus estimates`} png={false}>
          <DataTable title={`${ticker}_consensus`} cols={consCols} rows={data.consensus} />
          <div className="px-2 py-1 text-[10px] text-dim">
            Next earnings: <span className="text-amber num">{data.next_earnings ?? 'N/A'}</span> · Revenue in USD. Source: Yahoo Finance consensus, fetched {ago(data.as_of)} (weekly).
          </div>
        </Panel>
        <Panel title={`${ticker} Price target range`} note={`Source: ${data.price_targets?.source ?? 'none'} · ${snap?.analyst_count ?? '?'} analysts · mean implies ${snap?.upside != null ? `${(snap.upside * 100).toFixed(1)}%` : 'N/A'} upside`}>
          <PriceTargetBar pt={data.price_targets} price={snap?.price ?? null} />
        </Panel>
      </div>
      <Panel title={`${ticker} EPS estimate revisions`} png={false}>
        <DataTable title={`${ticker}_eps_trend`} cols={trendCols} rows={data.trend} />
      </Panel>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
        <Panel title={`${ticker} EPS surprise history (beat/miss)`}>
          {surprises.length === 0 ? (
            <Empty>No beat/miss history available.</Empty>
          ) : (
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <BarChart data={surprises} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="date" {...AXIS} tickFormatter={(d) => d.slice(0, 7)} minTickGap={20} />
                  <YAxis {...AXIS} width={40} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip
                    {...TOOLTIP}
                    formatter={(v: any, _n: any, p: any) => [`${(v * 100).toFixed(1)}% (est ${p.payload.estimate?.toFixed(2)} vs act ${p.payload.actual?.toFixed(2)})`, 'Surprise']}
                  />
                  <Bar dataKey="surprise_pct" isAnimationActive={false}>
                    {surprises.map((s: any, i: number) => (
                      <Cell key={i} fill={(s.surprise_pct ?? 0) >= 0 ? C.green : C.red} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="px-2 py-1 text-[10px] text-dim">
            Beat rate: {surprises.length ? `${Math.round((100 * surprises.filter((s: any) => (s.surprise_pct ?? 0) > 0).length) / surprises.length)}% of ${surprises.length} quarters` : 'N/A'}. Source:{' '}
            {surprises[0]?.source ?? 'n/a'}.
          </div>
        </Panel>
        <Panel title={`${ticker} Analyst recommendations by month`} note={`Source: ${data.recommendations_source ?? 'none'}`}>
          {recs.length === 0 ? (
            <Empty>No recommendation history.</Empty>
          ) : (
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <BarChart data={recs} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="period" {...AXIS} />
                  <YAxis {...AXIS} width={30} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="strongBuy" name="Strong Buy" stackId="a" fill="#1f9d55" isAnimationActive={false} />
                  <Bar dataKey="buy" name="Buy" stackId="a" fill={C.green} isAnimationActive={false} />
                  <Bar dataKey="hold" name="Hold" stackId="a" fill="#888" isAnimationActive={false} />
                  <Bar dataKey="sell" name="Sell" stackId="a" fill={C.red} isAnimationActive={false} />
                  <Bar dataKey="strongSell" name="Strong Sell" stackId="a" fill="#a11" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>
      {data.fmp_estimates?.length > 0 && (
        <Panel title={`${ticker} Long-range annual estimates (FMP)`} png={false}>
          <DataTable
            title={`${ticker}_fmp_estimates`}
            cols={[
              { key: 'date', label: 'FY end', kind: 'date' },
              { key: 'revenueAvg', label: 'Revenue', kind: 'cap' },
              { key: 'ebitdaAvg', label: 'EBITDA', kind: 'cap' },
              { key: 'netIncomeAvg', label: 'Net income', kind: 'cap' },
              { key: 'epsAvg', label: 'EPS', kind: 'money' },
              { key: 'numAnalystsEps', label: '# EPS', kind: 'int' },
            ]}
            rows={data.fmp_estimates}
          />
        </Panel>
      )}
      <Panel title={`${ticker} Recent rating & target changes`} png={false}>
        <DataTable
          title={`${ticker}_rating_changes`}
          maxHeight="320px"
          cols={[
            { key: 'date', label: 'Date', kind: 'date' },
            { key: 'Firm', label: 'Firm', kind: 'text' },
            { key: 'Action', label: 'Action', kind: 'text', render: (r: any) => <span className={r.Action === 'up' ? 'text-up' : r.Action === 'down' ? 'text-down' : ''}>{r.Action}</span> },
            { key: 'FromGrade', label: 'From', kind: 'text' },
            { key: 'ToGrade', label: 'To', kind: 'text' },
            { key: 'priorPriceTarget', label: 'Prior PT', kind: 'money' },
            { key: 'currentPriceTarget', label: 'New PT', kind: 'money' },
          ]}
          rows={data.upgrades_downgrades}
          empty="No recent rating changes from Yahoo."
        />
      </Panel>
      <Panel title="Data gaps & sources" png={false}>
        <ul className="p-2 text-[11px] text-dim list-disc pl-6">
          {data.gaps.map((g: string) => (
            <li key={g}>{g}</li>
          ))}
          {Object.entries(data.sources).map(([k, v]) => (
            <li key={k}>
              {k}: {String(v)}
            </li>
          ))}
          <li>Price targets: {data.price_targets?.source ? `from ${data.price_targets.source}` : 'none available'}</li>
        </ul>
      </Panel>
    </div>
  )
}
