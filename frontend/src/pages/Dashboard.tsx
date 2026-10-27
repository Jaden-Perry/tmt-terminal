import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResponsiveContainer, Treemap } from 'recharts'
import { DataTable, type Col } from '../components/DataTable'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/Panel'
import { ago, BasisVal, RATING_LABEL, Val } from '../lib/fmt'
import { useApi } from '../lib/useApi'
import { Star, useWatchlists } from '../lib/watchlists'

const PERIODS = ['1d', '1w', '1m', 'ytd', '1y'] as const
type Period = (typeof PERIODS)[number]

export const SNAPSHOT_COLS: Col<any>[] = [
  { key: 'star', label: '', render: (r) => <Star ticker={r.ticker} />, width: 18 },
  { key: 'ticker', label: 'Ticker', kind: 'text', render: (r) => <span className="text-amber num">{r.ticker}</span> },
  { key: 'name', label: 'Name', kind: 'text', render: (r) => <span className="truncate inline-block max-w-[180px] align-bottom">{r.name ?? '—'}</span> },
  { key: 'sub_industry', label: 'Sub-Ind', kind: 'text', render: (r) => <span className="text-dim">{r.sub_industry ?? 'Outside universe'}</span> },
  { key: 'price', label: 'Price', kind: 'money' },
  { key: 'chg_1d', label: '1D', kind: 'pct', color: true },
  { key: 'chg_1w', label: '1W', kind: 'pct', color: true },
  { key: 'chg_1m', label: '1M', kind: 'pct', color: true },
  { key: 'chg_ytd', label: 'YTD', kind: 'pct', color: true },
  { key: 'chg_1y', label: '1Y', kind: 'pct', color: true },
  { key: 'market_cap', label: 'Mkt Cap', kind: 'cap' },
  { key: 'trailing_pe', label: 'P/E TTM', kind: 'x', title: 'Price / SEC TTM EPS', render: (r) => <BasisVal row={r} k="trailing_pe" kind="x" /> },
  { key: 'forward_pe', label: 'P/E NTM', kind: 'x', title: 'Price / NTM consensus EPS', render: (r) => <BasisVal row={r} k="forward_pe" kind="x" /> },
  { key: 'ev_ebitda', label: 'EV/EBITDA', kind: 'x', title: 'SEC TTM', render: (r) => <BasisVal row={r} k="ev_ebitda" kind="x" /> },
  { key: 'ev_sales', label: 'EV/Sales', kind: 'x', title: 'SEC TTM', render: (r) => <BasisVal row={r} k="ev_sales" kind="x" /> },
  { key: 'revenue_growth', label: 'Rev Gr', kind: 'pct', color: true, title: 'Most recent quarter, year over year (Yahoo)' },
  { key: 'gross_margin', label: 'Gross M', kind: 'pctPlain' },
  { key: 'operating_margin', label: 'Op M', kind: 'pctPlain' },
  { key: 'net_margin', label: 'Net M', kind: 'pctPlain' },
  {
    key: 'rating',
    label: 'Rating',
    kind: 'text',
    get: (r) => r.rating_mean,
    title: 'Consensus recommendation (1 = Strong Buy … 5 = Sell)',
    render: (r) =>
      r.rating ? (
        <span title={`Mean ${r.rating_mean?.toFixed?.(2) ?? '?'} on 1 (Strong Buy) to 5 (Sell)`} className={r.rating_mean <= 2 ? 'text-up' : r.rating_mean >= 3.5 ? 'text-down' : ''}>
          {RATING_LABEL[r.rating] ?? r.rating}
        </span>
      ) : (
        <Val v={null} na={r.na?.rating} />
      ),
  },
  { key: 'analyst_count', label: '#An', kind: 'int', title: 'Number of analysts' },
  { key: 'target_mean', label: 'Avg PT', kind: 'money' },
  { key: 'upside', label: 'Upside', kind: 'pct', color: true },
]

function WatchlistPanel() {
  const nav = useNavigate()
  const { lists, active, setActive, toggle, createList } = useWatchlists()
  const { data, error, loading, reload } = useApi<any>(`/dashboard/watchlist?name=${encodeURIComponent(active)}`)
  const [add, setAdd] = useState('')
  const listNames = Object.keys(lists)
  const rows = data?.rows ?? []
  const asOf = Math.min(...rows.map((r: any) => r.fundamentals_as_of).filter(Boolean))

  return (
    <Panel
      title={`Watchlist: ${active}`}
      png={false}
      className="min-h-[220px]"
      right={
        <div className="flex items-center gap-2">
          <select
            value={active}
            onChange={(e) => {
              if (e.target.value === '__new') {
                const n = window.prompt('New watchlist name')
                if (n?.trim()) {
                  createList(n.trim())
                  setActive(n.trim())
                }
              } else setActive(e.target.value)
            }}
            className="bg-black border border-line text-[11px] text-fg"
          >
            {listNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
            <option value="__new">+ New list…</option>
          </select>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!add.trim()) return
              await toggle(add.trim().toUpperCase(), active)
              setAdd('')
              reload()
            }}
          >
            <input
              value={add}
              onChange={(e) => setAdd(e.target.value)}
              placeholder="+ ticker"
              className="bg-black border border-line w-20 px-1 num uppercase text-[11px] outline-none focus:border-amber"
            />
          </form>
          <button className="text-dim hover:text-amber text-[10px]" onClick={() => reload()}>
            RELOAD
          </button>
        </div>
      }
    >
      {error ? (
        <ErrorBox error={error} />
      ) : loading && !data ? (
        <Loading what="Loading watchlist (first load of a new ticker fetches from Yahoo; can take a few seconds each)" />
      ) : (
        <>
          <DataTable
            title={`watchlist_${active}`}
            cols={SNAPSHOT_COLS}
            rows={rows}
            rowKey={(r) => r.ticker}
            onRow={(r) => nav(`/c/${r.ticker}`)}
            empty="Empty watchlist. Star a ticker on its company page, or type one in '+ ticker'."
          />
          <div className="px-2 py-1 text-[10px] text-dim">
            Prices: end-of-day. Trailing multiples (P/E TTM, EV/EBITDA, EV/Sales, FCF yield) use SEC-reported TTM figures with the latest close; ʏ marks a Yahoo fallback
            where SEC data is missing or stale. P/E NTM uses NTM consensus EPS. Analyst data as of {isFinite(asOf) ? ago(asOf) : 'N/A'} (weekly). Hover any value or N/A for details.
          </div>
        </>
      )}
    </Panel>
  )
}

function Benchmarks() {
  const { data } = useApi<any[]>('/dashboard/benchmarks')
  return (
    <div className="flex flex-wrap gap-px bg-line border border-line">
      {(data ?? []).map((b) => (
        <div key={b.ticker} className="bg-panel px-2 py-1 flex-1 min-w-[140px]">
          <div className="text-[10px] text-dim">{b.name}</div>
          <div className="flex gap-2 num text-[11px]">
            <span>1D <Val v={b.chg_1d} kind="pct" color na="No stored price history yet" /></span>
            <span>1M <Val v={b.chg_1m} kind="pct" color /></span>
            <span>YTD <Val v={b.chg_ytd} kind="pct" color /></span>
          </div>
        </div>
      ))}
    </div>
  )
}

function color(chg: number | null | undefined) {
  if (chg === null || chg === undefined) return '#222'
  const c = Math.max(-1, Math.min(1, chg / 0.04))
  if (c >= 0) return `rgb(${Math.round(20 + 10 * c)}, ${Math.round(40 + 140 * c)}, ${Math.round(30 + 50 * c)})`
  return `rgb(${Math.round(50 + 170 * -c)}, ${Math.round(30 + 10 * -c)}, ${Math.round(30 + 10 * -c)})`
}

const pctStr = (v: number | null | undefined) => (v === null || v === undefined ? 'N/A' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`)

function TreeCell(props: any) {
  const { x, y, width, height, depth, name, chg, onClick, onHover, group, company, size } = props
  if (depth === 1) {
    // Group outline only; the label bar is drawn by GroupLabel on top so tiles can't cover it
    return <rect x={x} y={y} width={width} height={height} fill="none" stroke="#000" strokeWidth={3} />
  }
  if (depth !== 2) return null
  return (
    <g
      onClick={() => onClick?.(name)}
      onMouseEnter={() => onHover?.({ ticker: name, company, group, chg, cap: props.value ?? size })}
      onMouseLeave={() => onHover?.(null)}
      style={{ cursor: 'pointer' }}
    >
      <rect x={x} y={y} width={width} height={height} fill={color(chg)} stroke="#000" strokeWidth={1} />
      {width > 34 && height > 22 && (
        <>
          <text x={x + width / 2} y={y + height / 2 - 1} textAnchor="middle" fill="#fff" fontSize={Math.min(13, width / 5)} fontFamily="IBM Plex Mono">
            {name}
          </text>
          <text x={x + width / 2} y={y + height / 2 + 11} textAnchor="middle" fill="#ddd" fontSize={9} fontFamily="IBM Plex Mono">
            {chg === null || chg === undefined ? 'N/A' : `${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(1)}%`}
          </text>
        </>
      )}
    </g>
  )
}

// Drawn by a second, transparent copy of the treemap stacked on top (same data, same layout),
// because Recharts paints tiles after their group, which would cover a label drawn with the group.
function GroupLabel(props: any) {
  const { x, y, width, depth, name, chgByGroup } = props
  if (depth !== 1 || width < 28) return null
  const full = `${name} ${pctStr(chgByGroup?.[name])}`
  const fits = full.length * 6.2 + 8 <= width - 4
  const text = fits ? full : name.slice(0, Math.max(3, Math.floor((width - 12) / 6.2)))
  return (
    <g>
      <rect x={x + 2} y={y + 2} width={text.length * 6.2 + 8} height={14} fill="#000" fillOpacity={0.85} />
      <text x={x + 6} y={y + 12.5} fill="#ffa028" fontSize={10} fontFamily="IBM Plex Mono">
        {text}
      </text>
    </g>
  )
}

function Heatmap() {
  const nav = useNavigate()
  const [period, setPeriod] = useState<Period>('1d')
  const { data, error } = useApi<any>(`/dashboard/heatmap?period=${period}`)
  const [hover, setHover] = useState<any>(null)
  const tree =
    data?.groups.map((g: any) => ({
      name: g.group,
      children: g.items.filter((i: any) => i.market_cap).map((i: any) => ({ name: i.ticker, size: i.market_cap, chg: i.chg, group: g.group, company: i.name })),
    })) ?? []
  return (
    <Panel title={`TMT Heatmap · ${period.toUpperCase()}`} right={<Seg value={period} options={PERIODS} onChange={setPeriod} />} note={data?.note}>
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : tree.length === 0 ? (
        <Empty>No price history stored yet. The first refresh runs automatically at startup (see SET for progress).</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-3 px-2 py-1 text-[10px] num">
            {data.groups.map((g: any) => (
              <span key={g.group}>
                <span className="text-dim">{g.group}</span> <Val v={g.chg} kind="pct" color />
              </span>
            ))}
          </div>
          <div style={{ height: 460 }} className="relative">
            <ResponsiveContainer>
              <Treemap data={tree} dataKey="size" isAnimationActive={false} content={<TreeCell onClick={(t: string) => nav(`/c/${t}`)} onHover={setHover} />} />
            </ResponsiveContainer>
            {hover && (
              <div className="absolute right-2 bottom-2 z-10 bg-black/90 border border-amber-dim px-2 py-1 text-[11px] pointer-events-none">
                <div>
                  <span className="text-amber num">{hover.ticker}</span> {hover.company}
                </div>
                <div className="text-dim">{hover.group}</div>
                <div className="num">
                  <Val v={hover.chg} kind="pct" color /> · mkt cap <Val v={hover.cap} kind="cap" />
                </div>
              </div>
            )}
            <div className="absolute inset-0 heat-overlay">
              <ResponsiveContainer>
                <Treemap
                  data={tree}
                  dataKey="size"
                  isAnimationActive={false}
                  content={<GroupLabel chgByGroup={Object.fromEntries(data.groups.map((g: any) => [g.group, g.chg]))} />}
                />
              </ResponsiveContainer>
            </div>
          </div>
          <div className="px-2 py-1 text-[10px] text-dim">Each outlined block is a sub-industry (label in its top-left bar). Box size = market cap, color = return. Hover a box for details (shown bottom-right); click to open it.</div>
        </>
      )}
    </Panel>
  )
}

function Movers() {
  const nav = useNavigate()
  const [period, setPeriod] = useState<Period>('1d')
  const { data } = useApi<any>(`/dashboard/movers?period=${period}&n=12`)
  const cols: Col<any>[] = [
    { key: 'ticker', label: 'Ticker', kind: 'text', render: (r) => <span className="text-amber num">{r.ticker}</span> },
    { key: 'name', label: 'Name', kind: 'text', render: (r) => <span className="truncate inline-block max-w-[170px] align-bottom" title={`${r.name} · ${r.sub_industry}`}>{r.name}</span> },
    { key: 'chg', label: period.toUpperCase(), kind: 'pct', color: true },
  ]
  return (
    <Panel title={`Top Movers · TMT Universe`} png={false} right={<Seg value={period} options={['1d', '1w', '1m'] as const} onChange={setPeriod} />}>
      <div id="movers" className="grid grid-cols-2 gap-px bg-line">
        <div className="bg-panel">
          <div className="px-2 text-up text-[10px] uppercase">Gainers</div>
          <DataTable title={`gainers_${period}`} cols={cols} rows={data?.gainers ?? []} onRow={(r) => nav(`/c/${r.ticker}/MOVE`)} exportable={false} />
        </div>
        <div className="bg-panel">
          <div className="px-2 text-down text-[10px] uppercase">Losers</div>
          <DataTable title={`losers_${period}`} cols={cols} rows={data?.losers ?? []} onRow={(r) => nav(`/c/${r.ticker}/MOVE`)} exportable={false} />
        </div>
      </div>
    </Panel>
  )
}

export default function Dashboard() {
  return (
    <div className="flex flex-col gap-1.5">
      <Benchmarks />
      <WatchlistPanel />
      <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-1.5">
        <Heatmap />
        <Movers />
      </div>
    </div>
  )
}
