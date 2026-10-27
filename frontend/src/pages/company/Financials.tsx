import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, C, GRID, tickCap, tickPct, TOOLTIP } from '../../lib/chart'
import { exportCsv, exportXlsx } from '../../lib/export'
import { ago, fmtCap, NA } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

type Stmt = 'income' | 'balance' | 'cashflow'
type Freq = 'annual' | 'quarterly'

function cell(v: number | null, row: any) {
  if (v === null || v === undefined) return <NA why="Not reported in this period's XBRL (or the company uses a tag we don't map)." />
  if (row.pct) return <span className="num">{(v * 100).toFixed(1)}%</span>
  if (row.per_share) return <span className="num">{v.toFixed(2)}</span>
  if (row.key.startsWith('shares')) return <span className="num">{(v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
  const m = v / 1e6
  return <span className={`num ${m < 0 ? 'text-down' : ''}`}>{m.toLocaleString(undefined, { maximumFractionDigits: Math.abs(m) < 100 ? 1 : 0 })}</span>
}

function exportRows(data: any) {
  return data.rows.map((r: any) => [r.label, ...r.values.map((v: number | null) => (v === null ? '' : r.pct || r.per_share ? v : v / 1e6))])
}

function Charts({ ticker, freq }: { ticker: string; freq: Freq }) {
  const { data } = useApi<any>(`/company/${ticker}/financials/series?freq=${freq}`)
  const pts = (data?.points ?? []).slice(freq === 'quarterly' ? -20 : -12)
  if (!pts.length) return null
  const bar = (key: string, title: string, money = true) => (
    <Panel title={`${ticker} ${title}`} className="min-w-0">
      <div style={{ height: 190 }}>
        <ResponsiveContainer>
          <BarChart data={pts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            <YAxis {...AXIS} tickFormatter={money ? tickCap : (v) => v.toFixed(1)} width={48} />
            <Tooltip {...TOOLTIP} formatter={(v: any) => (v === null ? 'N/A' : money ? fmtCap(v) : Number(v).toFixed(2))} />
            <Bar dataKey={key} isAnimationActive={false}>
              {pts.map((p: any, i: number) => (
                <Cell key={i} fill={(p[key] ?? 0) < 0 ? C.red : C.amber} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-1.5">
      {bar('revenue', 'Revenue')}
      {bar('eps_diluted', 'Diluted EPS', false)}
      {bar('fcf', 'Free cash flow')}
      <Panel title={`${ticker} Margins`} className="min-w-0">
        <div style={{ height: 190 }}>
          <ResponsiveContainer>
            <LineChart data={pts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} tickFormatter={tickPct} width={40} />
              <Tooltip {...TOOLTIP} formatter={(v: any) => (v === null ? 'N/A' : `${(v * 100).toFixed(1)}%`)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line dataKey="gross_margin" name="Gross" stroke={C.amber} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="operating_margin" name="Operating" stroke={C.blue} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="net_margin" name="Net" stroke={C.green} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="fcf_margin" name="FCF" stroke={C.purple} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  )
}

export default function Financials({ ticker }: TabProps) {
  const [stmt, setStmt] = useState<Stmt>('income')
  const [freq, setFreq] = useState<Freq>('annual')
  const { data, error } = useApi<any>(`/company/${ticker}/financials?statement=${stmt}&freq=${freq}`)
  const title = `${ticker}_${stmt}_${freq}`

  return (
    <div className="flex flex-col gap-1.5">
      <Charts ticker={ticker} freq={freq} />
      <Panel
        title={`${ticker} ${stmt === 'income' ? 'Income statement' : stmt === 'balance' ? 'Balance sheet' : 'Cash flow'} · ${freq} · USD millions`}
        png={false}
        right={
          <div className="flex items-center gap-2">
            <Seg value={stmt} options={[{ value: 'income', label: 'IS' }, { value: 'balance', label: 'BS' }, { value: 'cashflow', label: 'CF' }] as any} onChange={setStmt as any} />
            <Seg value={freq} options={[{ value: 'annual', label: 'ANNUAL' }, { value: 'quarterly', label: 'QUARTERLY' }] as any} onChange={setFreq as any} />
            {data?.rows?.length > 0 && (
              <>
                <button className="text-dim hover:text-amber text-[10px]" onClick={() => exportCsv(title, ['Line item (USD m; margins %, EPS $)', ...data.periods.map((p: any) => `${p.label} (${p.end})`)], exportRows(data))}>
                  CSV
                </button>
                <button className="text-dim hover:text-amber text-[10px]" onClick={() => exportXlsx(title, ['Line item (USD m; margins %, EPS $)', ...data.periods.map((p: any) => `${p.label} (${p.end})`)], exportRows(data))}>
                  XLSX
                </button>
              </>
            )}
          </div>
        }
      >
        {error ? (
          <ErrorBox error={error} />
        ) : !data ? (
          <Loading what="Loading statements (first load pulls SEC XBRL company facts)" />
        ) : data.rows.length === 0 ? (
          <Empty>{data.note ?? 'No data.'}</Empty>
        ) : (
          <>
            <div className="overflow-auto max-h-[60vh]">
              <table className="term">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', position: 'sticky', left: 0 }}>Line item</th>
                    {data.periods.map((p: any) => (
                      <th key={p.end} style={{ textAlign: 'right' }} title={`Fiscal period ending ${p.end}`}>
                        {p.label}
                        {freq === 'quarterly' && <div className="text-[9px] text-dim normal-case">{p.end.slice(0, 7)}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <tr key={r.key}>
                      <td className={`sticky left-0 bg-panel ${r.pct ? 'text-dim pl-4' : ''}`} title={r.concept ? `XBRL tag: ${r.concept}` : 'Derived'}>
                        {r.label}
                      </td>
                      {r.values.map((v: number | null, i: number) => (
                        <td key={i} style={{ textAlign: 'right' }}>
                          {cell(v, r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-2 py-1 text-[10px] text-dim">
              Source: {data.source} ({data.entity}) · fetched {ago(data.fetched_at)}
              {data.stale ? ' · STALE (refresh failed, showing last good copy)' : ''}. Hover a line item to see its XBRL tag. {data.notes?.join(' ')}
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}
