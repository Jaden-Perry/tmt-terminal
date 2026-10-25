import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, C, GRID, tickCap, TOOLTIP } from '../../lib/chart'
import { exportCsv } from '../../lib/export'
import { fmtCap } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

const META: Record<string, { label: string; kind: 'pct' | 'cap' | 'days' | 'shares' }> = {
  rev_yoy: { label: 'Revenue growth YoY', kind: 'pct' },
  rpo: { label: 'Remaining performance obligations (RPO)', kind: 'cap' },
  rpo_yoy: { label: 'RPO growth YoY', kind: 'pct' },
  deferred_rev: { label: 'Deferred revenue (total)', kind: 'cap' },
  capex_pct: { label: 'Capex % of revenue', kind: 'pct' },
  rnd_pct: { label: 'R&D % of revenue', kind: 'pct' },
  sbc_pct: { label: 'Stock comp % of revenue', kind: 'pct' },
  dso: { label: 'Days sales outstanding', kind: 'days' },
  inventory_days: { label: 'Inventory days', kind: 'days' },
  shares_diluted: { label: 'Diluted share count', kind: 'shares' },
  gross_margin: { label: 'Gross margin', kind: 'pct' },
  operating_margin: { label: 'Operating margin', kind: 'pct' },
}
const fmt = (v: number | null, kind: string) =>
  v == null ? 'N/A' : kind === 'pct' ? `${(v * 100).toFixed(1)}%` : kind === 'days' ? `${v.toFixed(0)}d` : fmtCap(v)

function KpiChart({ ticker, k, series }: { ticker: string; k: string; series: any[] }) {
  const m = META[k]
  const data = series.map((r) => ({ end: r.end.slice(0, 7), v: r[k] }))
  const last = [...series].reverse().find((r) => r[k] != null)
  return (
    <Panel title={`${ticker} ${m.label}`}>
      <div className="px-2 pt-1 num text-amber">{last ? fmt(last[k], m.kind) : 'N/A'}</div>
      <div style={{ height: 130 }}>
        <ResponsiveContainer>
          {m.kind === 'cap' || m.kind === 'shares' ? (
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="end" {...AXIS} minTickGap={30} />
              <YAxis {...AXIS} width={44} tickFormatter={tickCap} domain={m.kind === 'shares' ? ['auto', 'auto'] : [0, 'auto']} />
              <Tooltip {...TOOLTIP} formatter={(v: any) => fmt(v, m.kind)} />
              <Bar dataKey="v" fill={C.amber} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="end" {...AXIS} minTickGap={30} />
              <YAxis {...AXIS} width={40} tickFormatter={(v) => (m.kind === 'pct' ? `${(v * 100).toFixed(0)}%` : v.toFixed(0))} />
              <Tooltip {...TOOLTIP} formatter={(v: any) => fmt(v, m.kind)} />
              <Line dataKey="v" stroke={C.amber} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

export default function KPIs({ ticker }: TabProps) {
  const { data, error } = useApi<any>(`/company/${ticker}/kpis`)
  const [segKey, setSegKey] = useState<string | null>(null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Reading XBRL (financial facts + latest 10-Q)" />
  const x = data.xbrl ?? {}
  const segKeys = Object.keys(x.segments ?? {})
  const sk = segKey && segKeys.includes(segKey) ? segKey : segKeys[0]
  const seg = sk ? x.segments[sk] : null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5">
        {data.available.map((k: string) => (META[k] ? <KpiChart key={k} ticker={ticker} k={k} series={data.series} /> : null))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
        <Panel
          title={`${ticker} Latest-quarter segments`}
          png={false}
          right={segKeys.length > 1 ? <Seg value={sk} options={segKeys.map((s) => ({ value: s, label: s.replace(':', ' · ').replace('_', ' ').toUpperCase() }))} onChange={setSegKey} /> : undefined}
          note={x.filing ? `From ${x.filing.form} filed ${x.filing.filed}. Latest period vs prior-year comparative as tagged.` : undefined}
        >
          {!seg ? (
            <Empty>{x.note ?? 'No segment data tagged in the latest filing.'}</Empty>
          ) : (
            <table className="term">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{seg.axis}</th>
                  {seg.periods.map((p: string) => (
                    <th key={p} style={{ textAlign: 'right' }}>{p}</th>
                  ))}
                  <th style={{ textAlign: 'right' }}>YoY</th>
                </tr>
              </thead>
              <tbody>
                {seg.rows.map((r: any) => {
                  const [a, b] = r.values.length === 2 ? r.values : [null, r.values[0]]
                  return (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      {r.values.map((v: number | null, i: number) => (
                        <td key={i} className="num text-right">{v == null ? 'N/A' : fmtCap(v)}</td>
                      ))}
                      <td className={`num text-right ${a && b ? (b >= a ? 'text-up' : 'text-down') : ''}`}>{a && b ? `${((b / a - 1) * 100).toFixed(1)}%` : 'N/A'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel
          title={`${ticker} Company-specific XBRL tags (as reported)`}
          png={false}
          right={
            x.custom?.length ? (
              <button
                className="text-[10px] text-dim hover:text-amber"
                onClick={() => exportCsv(`${ticker}_custom_kpis`, ['Label', 'Value', 'Unit', 'Period end', 'Days', 'Tag'], x.custom.map((c: any) => [c.label, c.value, c.unit, c.period_end, c.days, c.concept]))}
              >
                CSV
              </button>
            ) : undefined
          }
          note="Tags the company created itself (outside the standard US-GAAP taxonomy), latest value per tag. Debt/lease/tax/comp plumbing is filtered out. Flow values cover the filing's period (Days column; 270 = nine months year-to-date)."
        >
          {!x.custom?.length ? (
            <Empty>No company-specific tags beyond standard US-GAAP in the latest filing.</Empty>
          ) : (
            <div className="overflow-auto max-h-[380px]">
              <table className="term">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Metric</th>
                    <th style={{ textAlign: 'right' }}>Value</th>
                    <th>Unit</th>
                    <th>Period</th>
                    <th style={{ textAlign: 'right' }}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {x.custom.map((c: any) => (
                    <tr key={c.concept} title={c.concept}>
                      <td className="whitespace-normal">{c.label}</td>
                      <td className="num text-right">{String(c.unit).toLowerCase() === 'usd' ? fmtCap(c.value) : c.value.toLocaleString()}</td>
                      <td className="text-dim">{c.unit}</td>
                      <td className="num text-dim">{c.period_end ?? ''}</td>
                      <td className="num text-dim text-right">{c.days ?? 'inst'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="What's not here" png={false}>
        <ul className="p-2 pl-6 list-disc text-[11px] text-dim">
          {data.gaps.map((g: string) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
