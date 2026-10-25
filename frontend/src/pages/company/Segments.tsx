import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, GRID, SERIES, tickCap, TOOLTIP } from '../../lib/chart'
import { fmtCap } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'

const NAMES: Record<string, string> = { segment: 'SEGMENT', product: 'PRODUCT', geography: 'GEOGRAPHY' }

export function Segments({ ticker }: { ticker: string }) {
  const { data } = useApi<any>(`/company/${ticker}/segments`)
  const keys = Object.keys(data?.breakdowns ?? {})
  const [pick, setPick] = useState<string | null>(null)
  const k = pick && keys.includes(pick) ? pick : keys[0]
  const b = k ? data.breakdowns[k] : null
  const rows = b
    ? b.periods.map((p: string, i: number) => ({ period: p.slice(0, 7), ...Object.fromEntries(b.members.map((m: any) => [m.label, m.values[i]])) }))
    : []
  const latestTotal = b ? b.members.reduce((s: number, m: any) => s + (m.values[m.values.length - 1] ?? 0), 0) : 0
  return (
    <Panel
      title={`${ticker} Revenue by ${k ?? 'segment'} (10-K XBRL)`}
      right={keys.length > 1 ? <Seg value={k} options={keys.map((x) => ({ value: x, label: NAMES[x] ?? x }))} onChange={setPick} /> : undefined}
      note={
        data?.filing
          ? `From ${data.filing.form} filed ${data.filing.filed}. Annual values as tagged by the company; some members are subtotals of others (e.g. Data Center = Compute + Networking), so bars can overlap.`
          : undefined
      }
    >
      {!data ? (
        <Loading what="Reading latest 10-K XBRL" />
      ) : !b ? (
        <Empty>{data.note ?? data.error ?? 'No segment data.'}</Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr]">
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="period" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={tickCap} width={48} />
                <Tooltip {...TOOLTIP} formatter={(v: any) => (v == null ? 'N/A' : fmtCap(v))} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {b.members.slice(0, 10).map((m: any, i: number) => (
                  <Bar key={m.member} dataKey={m.label} fill={SERIES[i % SERIES.length]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="term">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{NAMES[k] ?? k}</th>
                <th style={{ textAlign: 'right' }}>Latest</th>
                <th style={{ textAlign: 'right' }}>Mix</th>
                <th style={{ textAlign: 'right' }}>YoY</th>
              </tr>
            </thead>
            <tbody>
              {b.members.map((m: any) => {
                const v = m.values[m.values.length - 1]
                const p = m.values[m.values.length - 2]
                return (
                  <tr key={m.member}>
                    <td className="truncate max-w-[160px]" title={m.member}>{m.label}</td>
                    <td className="num text-right">{v == null ? 'N/A' : fmtCap(v)}</td>
                    <td className="num text-right text-dim">{v == null || !latestTotal ? '' : `${((v / latestTotal) * 100).toFixed(0)}%`}</td>
                    <td className={`num text-right ${v != null && p ? (v >= p ? 'text-up' : 'text-down') : ''}`}>{v != null && p ? `${((v / p - 1) * 100).toFixed(1)}%` : 'N/A'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
