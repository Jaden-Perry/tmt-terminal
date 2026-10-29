import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, C, GRID, SERIES, tickCap, TOOLTIP } from '../../lib/chart'
import { exportCsv } from '../../lib/export'
import { fmtCap } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

type Kind = 'pct' | 'cap' | 'days' | 'shares' | 'x'
// What each standard chart is and why it matters (shown under the value)
const META: Record<string, { label: string; kind: Kind; why: string }> = {
  rev_yoy: { label: 'Revenue growth YoY', kind: 'pct', why: 'Quarter vs the same quarter a year ago.' },
  rpo: { label: 'Remaining performance obligations (RPO)', kind: 'cap', why: 'Signed contracts not yet recognized as revenue. Leads future revenue.' },
  rpo_yoy: { label: 'RPO growth YoY', kind: 'pct', why: 'Faster than revenue growth = bookings accelerating.' },
  deferred_rev: { label: 'Deferred revenue (total)', kind: 'cap', why: 'Cash billed in advance; also customer prepayments for equipment makers.' },
  capex_pct: { label: 'Capex % of revenue', kind: 'pct', why: 'Capital intensity. Rising capex pressures free cash flow.' },
  capex_ttm: { label: 'Capex (trailing 12 months)', kind: 'cap', why: 'Dollar spend on property and equipment, incl. data centers.' },
  rnd_pct: { label: 'R&D % of revenue', kind: 'pct', why: 'Reinvestment in products.' },
  sbc_pct: { label: 'Stock comp % of revenue', kind: 'pct', why: 'A real cost that non-GAAP profit excludes. Falling = profits are more "real".' },
  dso: { label: 'Days sales outstanding', kind: 'days', why: 'How long customers take to pay. Rising can signal weaker demand or looser terms.' },
  inventory_days: { label: 'Inventory days', kind: 'days', why: 'Days of inventory on hand. Rising ahead of revenue is a downturn warning.' },
  shares_diluted: { label: 'Diluted share count', kind: 'shares', why: 'Falling = buybacks outpace stock comp dilution.' },
  gross_margin: { label: 'Gross margin', kind: 'pct', why: 'Pricing power and mix.' },
  operating_margin: { label: 'Operating margin (GAAP)', kind: 'pct', why: 'Profit after all operating costs, incl. stock comp.' },
  ebitda_margin: { label: 'EBITDA margin', kind: 'pct', why: 'Operating profit before depreciation & amortization.' },
  fcf_ttm: { label: 'Free cash flow (TTM)', kind: 'cap', why: 'Operating cash flow minus capex, last 12 months.' },
  fcf_margin_ttm: { label: 'FCF margin (TTM)', kind: 'pct', why: 'Free cash flow per dollar of revenue.' },
  buybacks_ttm: { label: 'Buybacks (TTM)', kind: 'cap', why: 'Cash spent repurchasing stock, last 12 months.' },
  net_debt_ebitda: { label: 'Net debt / EBITDA (TTM)', kind: 'x', why: 'Leverage: years of EBITDA to pay off net debt.' },
}
const fmt = (v: number | null | undefined, kind: string) => {
  if (v == null) return 'N/A'
  if (kind === 'pct') return `${(v * 100).toFixed(1)}%`
  if (kind === 'days') return `${v.toFixed(0)}d`
  if (kind === 'x') return `${v.toFixed(1)}x`
  if (kind === 'num') return v.toFixed(2)
  if (kind === 'count' || kind === 'shares') return fmtCap(v).replace('$', '')
  if (kind === 'usd_unit') return `$${v.toFixed(2)}`
  return fmtCap(v)
}
const tick = (kind: string) => (v: number) => {
  if (kind === 'pct') return `${(v * 100).toFixed(Math.abs(v) < 0.1 && v !== 0 ? 1 : 0)}%`
  if (kind === 'x') return `${v.toFixed(1)}x`
  if (kind === 'days' || kind === 'num') return v.toFixed(kind === 'num' ? 1 : 0)
  return kind === 'count' || kind === 'shares' ? tickCap(v).replace('$', '') : tickCap(v)
}
const isLevel = (kind: string) => kind === 'cap' || kind === 'shares' || kind === 'usd' || kind === 'count'

function MiniChart({ title, value, sub, data, kind, why }: { title: string; value: string; sub?: ReactNode; data: { end: string; v: number | null }[]; kind: string; why?: string }) {
  return (
    <Panel title={title}>
      <div className="px-2 pt-1 flex items-baseline gap-2">
        <span className="num text-amber">{value}</span>
        {sub}
      </div>
      {why && <div className="px-2 text-[10px] text-dim leading-tight">{why}</div>}
      <div style={{ height: 120 }}>
        <ResponsiveContainer>
          {isLevel(kind) ? (
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="end" {...AXIS} minTickGap={30} />
              <YAxis {...AXIS} width={44} tickFormatter={tick(kind)} domain={kind === 'shares' ? ['auto', 'auto'] : [0, 'auto']} />
              <Tooltip {...TOOLTIP} formatter={(v: any) => fmt(v, kind)} />
              <Bar dataKey="v" fill={C.amber} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="end" {...AXIS} minTickGap={30} />
              <YAxis {...AXIS} width={40} tickFormatter={tick(kind)} domain={['auto', 'auto']} />
              <Tooltip {...TOOLTIP} formatter={(v: any) => fmt(v, kind)} />
              <Line dataKey="v" stroke={C.amber} dot={data.length <= 12} connectNulls isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

const Yoy = ({ v, kind }: { v: number | null | undefined; kind: string }) =>
  v == null ? null : (
    <span className={`num text-[11px] ${v >= 0 ? 'text-up' : 'text-down'}`}>
      {v >= 0 ? '+' : ''}
      {kind === 'pct' ? `${(v * 100).toFixed(1)}pp` : `${(v * 100).toFixed(1)}%`} YoY
    </span>
  )

function Reported({ ticker, r }: { ticker: string; r: any }) {
  const qs: any[] = r.quarters
  const last = qs[qs.length - 1]
  const byKey: Record<string, any> = Object.fromEntries(r.metrics.map((m: any) => [m.key, m]))
  return (
    <>
      <div className="text-[10.5px] text-dim px-0.5 pt-1 uppercase tracking-wide">Company-reported KPIs · from earnings releases</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5">
        {r.headline.map((k: string) => {
          const m = byKey[k]
          if (!m) return null
          return (
            <MiniChart
              key={k}
              title={`${ticker} ${m.label}`}
              value={fmt(last?.values[k], m.kind)}
              sub={<Yoy v={last?.yoy[k]} kind={m.kind} />}
              why={m.derived ? `= ${m.derived}` : undefined}
              kind={m.kind}
              data={qs.map((q) => ({ end: q.end.slice(0, 7), v: q.values[k] }))}
            />
          )
        })}
      </div>
      <Panel
        title={`${ticker} Company-reported KPIs · last ${qs.length} quarters`}
        png={false}
        right={
          <button
            className="text-[10px] text-dim hover:text-amber"
            onClick={() =>
              exportCsv(`${ticker}_reported_kpis`, ['Metric', ...qs.map((q) => q.end), 'Latest YoY'], r.metrics.map((m: any) => [m.label, ...qs.map((q) => q.values[m.key]), last?.yoy[m.key]]))
            }
          >
            CSV
          </button>
        }
        note={`Source: ${r.source}, one release per quarter (click a quarter to open its release). YoY uses the year-ago figure printed in the same release; ratio changes are in percentage points (pp).`}
      >
        <div className="overflow-auto">
          <table className="term">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Metric</th>
                {qs.map((q) => (
                  <th key={q.end} style={{ textAlign: 'right' }}>
                    <a className="hover:text-amber underline decoration-dotted" href={q.release.url} target="_blank" rel="noreferrer" title={`Earnings release filed ${q.release.filed}`}>
                      {q.end.slice(0, 7)}
                    </a>
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>YoY</th>
              </tr>
            </thead>
            <tbody>
              {r.metrics.map((m: any) => (
                <tr key={m.key}>
                  <td className="whitespace-nowrap">{m.label}</td>
                  {qs.map((q) => (
                    <td key={q.end} className="num text-right" title={q.values[m.key] == null ? (q.error ?? 'Not found in this release (table layout differs).') : undefined}>
                      {fmt(q.values[m.key], m.kind)}
                    </td>
                  ))}
                  <td className="text-right whitespace-nowrap">
                    <Yoy v={last?.yoy[m.key]} kind={m.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

// Same metric keys across a company and its hand-picked peers (config/kpis.yaml compare_with)
function PeerCompare({ ticker, c }: { ticker: string; c: any }) {
  const cos: any[] = c.companies.filter((x: any) => x.quarters?.length)
  const latest = (x: any) => [...x.quarters].reverse().find((q: any) => q.values.gb != null)
  const ends = [...new Set(cos.flatMap((x) => x.quarters.map((q: any) => q.end.slice(0, 7))))].sort()
  const series = (k: string, yoy: boolean) =>
    ends.map((e) => {
      const row: any = { end: e }
      cos.forEach((x) => {
        const q = x.quarters.find((q: any) => q.end.slice(0, 7) === e)
        row[x.ticker] = q ? (yoy ? q.yoy[k] : q.values[k]) : null
      })
      return row
    })
  const chart = (title: string, k: string, yoy: boolean, why: string) => (
    <Panel title={title}>
      <div className="px-2 pt-1 text-[10px] text-dim">{why}</div>
      <div style={{ height: 170 }}>
        <ResponsiveContainer>
          <LineChart data={series(k, yoy)} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="end" {...AXIS} minTickGap={30} />
            <YAxis {...AXIS} width={40} tickFormatter={tick('pct')} domain={['auto', 'auto']} />
            <Tooltip {...TOOLTIP} formatter={(v: any) => fmt(v, 'pct')} />
            {cos.map((x, i) => (
              <Line key={x.ticker} dataKey={x.ticker} stroke={SERIES[i]} strokeWidth={x.ticker === ticker ? 2 : 1} dot connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-3 px-2 pb-1 text-[10.5px]">
        {cos.map((x, i) => (
          <span key={x.ticker} style={{ color: SERIES[i] }}>
            ■ {x.ticker}
          </span>
        ))}
      </div>
    </Panel>
  )
  const cell = (q: any, k: string, kind: string) => (
    <td className="num text-right whitespace-nowrap">
      <div>{fmt(q?.values[k], kind)}</div>
      {q?.yoy[k] != null && <Yoy v={q.yoy[k]} kind={kind} />}
    </td>
  )
  return (
    <>
      <div className="text-[10.5px] text-dim px-0.5 pt-1 uppercase tracking-wide">Peer comparison · same metrics from each company's earnings release</div>
      <Panel
        title={`${ticker} vs peers · latest reported quarter`}
        png={false}
        note="Bookings = gross bookings (Uber, Lyft), Marketplace GOV (DoorDash), GTV (Instacart): total customer spend on the platform, defined slightly differently by each. Take rate = revenue / bookings. Volume = trips, orders or rides. FCF margin (TTM) is from SEC filings so it's defined the same way for everyone (ʳ = from earnings releases because the SEC data lacks that company's capex). Adjusted EBITDA is each company's own non-GAAP measure."
      >
        <div className="overflow-auto">
          <table className="term">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Company</th>
                <th>Quarter</th>
                <th style={{ textAlign: 'right' }}>Bookings</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Take rate</th>
                <th style={{ textAlign: 'right' }}>Adj. EBITDA</th>
                <th style={{ textAlign: 'right' }}>EBITDA % bookings</th>
                <th style={{ textAlign: 'right' }}>FCF margin (TTM)</th>
              </tr>
            </thead>
            <tbody>
              {c.companies.map((x: any) => {
                const q = x.quarters?.length ? latest(x) : null
                if (!q)
                  return (
                    <tr key={x.ticker}>
                      <td className="text-amber">{x.ticker}</td>
                      <td colSpan={8} className="text-dim">
                        {x.error ?? 'No readable earnings release.'}
                      </td>
                    </tr>
                  )
                return (
                  <tr key={x.ticker} className={x.ticker === ticker ? 'bg-panel2' : ''}>
                    <td>
                      <a className="text-amber hover:underline" href={`/c/${x.ticker}/KPI`}>
                        {x.ticker}
                      </a>
                    </td>
                    <td className="num text-dim">
                      <a className="hover:text-amber" href={q.url} target="_blank" rel="noreferrer" title="Open this quarter's earnings release">
                        {q.end.slice(0, 7)}
                      </a>
                    </td>
                    {cell(q, 'gb', 'usd')}
                    <td className="num text-right whitespace-nowrap" title={x.labels.volume}>
                      <div>
                        {fmt(q.values.volume, 'count')} <span className="text-dim text-[10px]">{(x.labels.volume ?? '').toLowerCase()}</span>
                      </div>
                      {q.yoy.volume != null && <Yoy v={q.yoy.volume} kind="count" />}
                    </td>
                    {cell(q, 'revenue', 'usd')}
                    {cell(q, 'take_rate', 'pct')}
                    {cell(q, 'adj_ebitda', 'usd')}
                    {cell(q, 'ebitda_pct_gb', 'pct')}
                    <td className="num text-right" title={x.fcf_margin_ttm?.value != null ? `TTM through ${x.fcf_margin_ttm.through}, from ${x.fcf_margin_ttm.source}` : 'No cash flow data'}>
                      {pct(x.fcf_margin_ttm?.value)}
                      {x.fcf_margin_ttm?.source && x.fcf_margin_ttm.source !== 'SEC' ? 'ʳ' : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-1.5">
        {chart('Bookings growth YoY', 'gb', true, 'Who is gaining share: growth in total customer spend.')}
        {chart('Take rate (revenue / bookings)', 'take_rate', false, 'How much of each dollar spent the platform keeps as revenue.')}
        {chart('Adj. EBITDA % of bookings', 'ebitda_pct_gb', false, 'Profitability on the same base for everyone.')}
      </div>
    </>
  )
}

const pct = (v: number | null | undefined) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)

function Segments({ ticker, x, prefer }: { ticker: string; x: any; prefer?: string }) {
  const keys = Object.keys(x.segments ?? {})
  const [axis, setAxis] = useState<string | null>(prefer ?? null)
  const ak = axis && keys.includes(axis) ? axis : keys[0]
  const seg = ak ? x.segments[ak] : null
  const has = (k: string) => seg?.has?.includes(k)
  return (
    <Panel
      title={`${ticker} Segments · latest quarter vs year ago`}
      png={false}
      right={keys.length > 1 ? <Seg value={ak} options={keys.map((s) => ({ value: s, label: s.toUpperCase() }))} onChange={setAxis} /> : undefined}
      note={
        x.filing
          ? `From the ${x.filing.form} filed ${x.filing.filed} (SEC XBRL). Segment profit is the company's own segment measure (often adjusted). Margins: latest quarter (year-ago in brackets). Italic rows are subtotals of rows below.`
          : undefined
      }
    >
      {!seg ? (
        <Empty>{x.note ?? 'No segment data tagged in the latest filing.'}</Empty>
      ) : (
        <div className="overflow-auto">
          <table className="term">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{seg.axis}</th>
                <th style={{ textAlign: 'right' }}>Rev {seg.periods[0]?.slice(0, 7)}</th>
                <th style={{ textAlign: 'right' }}>Rev {seg.periods[1]?.slice(0, 7)}</th>
                <th style={{ textAlign: 'right' }}>YoY</th>
                {has('operating_income') && <th style={{ textAlign: 'right' }}>Seg. profit</th>}
                {has('op_margin') && <th style={{ textAlign: 'right' }}>Margin</th>}
                {has('gross_margin') && <th style={{ textAlign: 'right' }}>Gross margin</th>}
              </tr>
            </thead>
            <tbody>
              {seg.rows.map((r: any) => {
                const [a, b] = r.revenue
                return (
                  <tr key={r.member} className={r.subtotal ? 'italic text-dim' : ''}>
                    <td>
                      {r.label}
                      {r.subtotal ? ' (subtotal)' : ''}
                    </td>
                    <td className="num text-right">{a == null ? 'N/A' : fmtCap(a)}</td>
                    <td className="num text-right">{b == null ? 'N/A' : fmtCap(b)}</td>
                    <td className={`num text-right ${a && b ? (b >= a ? 'text-up' : 'text-down') : ''}`}>{a && b ? `${((b / a - 1) * 100).toFixed(1)}%` : 'N/A'}</td>
                    {has('operating_income') && <td className="num text-right">{r.operating_income?.[1] == null ? 'N/A' : fmtCap(r.operating_income[1])}</td>}
                    {has('op_margin') && (
                      <td className="num text-right whitespace-nowrap">
                        {pct(r.op_margin?.[1])} <span className="text-dim">({pct(r.op_margin?.[0])})</span>
                      </td>
                    )}
                    {has('gross_margin') && (
                      <td className="num text-right whitespace-nowrap">
                        {pct(r.gross_margin?.[1])} <span className="text-dim">({pct(r.gross_margin?.[0])})</span>
                      </td>
                    )}
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

export default function KPIs({ ticker }: TabProps) {
  const { data, error } = useApi<any>(`/company/${ticker}/kpis`)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Reading XBRL and earnings releases" />
  const x = data.xbrl ?? {}
  const p = data.profile
  const series: any[] = data.series
  const lastOf = (k: string) => [...series].reverse().find((r) => r[k] != null)
  return (
    <div className="flex flex-col gap-1.5">
      <Panel title={`${ticker} What matters here · ${p.name} profile${p.company_specific ? ' + company notes' : ''}`} png={false}>
        <div className="p-2 text-[11.5px]">{p.focus}</div>
      </Panel>

      {data.reported ? (
        <>
          <Reported ticker={ticker} r={data.reported} />
          {data.compare && <PeerCompare ticker={ticker} c={data.compare} />}
        </>
      ) : data.reported_error ? (
        <Panel title={`${ticker} Company-reported KPIs`} png={false}>
          <Empty>{data.reported_error}</Empty>
        </Panel>
      ) : null}

      <div className="text-[10.5px] text-dim px-0.5 pt-1 uppercase tracking-wide">Standard {p.name} metrics · SEC XBRL, quarterly</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5">
        {p.charts.map((k: string) => {
          const m = META[k]
          if (!m) return null
          if (data.missing[k])
            return (
              <Panel key={k} title={`${ticker} ${m.label}`} png={false}>
                <div className="p-2 text-dim">
                  <span className="num" title={data.missing[k]}>N/A</span>
                  <div className="text-[10.5px] mt-1">{data.missing[k]}</div>
                </div>
              </Panel>
            )
          const last = lastOf(k)
          return (
            <MiniChart
              key={k}
              title={`${ticker} ${m.label}`}
              value={last ? fmt(last[k], m.kind) : 'N/A'}
              why={m.why}
              kind={m.kind}
              data={series.map((r) => ({ end: r.end.slice(0, 7), v: r[k] }))}
            />
          )
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
        <Segments ticker={ticker} x={x} prefer={p.segment_axis} />
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
