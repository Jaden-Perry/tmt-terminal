import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataTable, type Col } from '../../components/DataTable'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, C, GRID, TOOLTIP } from '../../lib/chart'
import { BasisVal, Val } from '../../lib/fmt'
import { api, del } from '../../lib/api'
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

function HistoryChart({ data, metric, ticker, pm, setLabel }: { data: any; metric: (typeof METRICS)[number]; ticker: string; pm: any; setLabel: string }) {
  const hk = metric.hist as string
  const st = data.summary?.metrics?.[hk]?.stats_5y
  const peer = useMemo(() => Object.fromEntries((pm?.points ?? []).map((p: any) => [p.date, p[hk]])), [pm, hk])
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
          <Line dataKey="peer" name={`Median: ${setLabel} (${pm?.peers?.length ?? 0} cos)`} stroke={C.blue} dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function Valuation({ ticker, snap }: TabProps) {
  const nav = useNavigate()
  const { data, error } = useApi<any>(`/company/${ticker}/valuation`)
  const [mk, setMk] = useState('pe')
  const metric = CHART_METRICS.find((m) => m.key === mk) ?? CHART_METRICS[0]

  // Peer selection: default comps, a saved set (e.g. "AI peers"), or ad hoc checkbox edits ("Custom")
  const { data: psLoaded } = useApi<any>(`/company/${ticker}/peersets`)
  const [ps, setPs] = useState<any>(null)
  const [sel, setSel] = useState<string[] | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)
  const [addText, setAddText] = useState('')
  useEffect(() => {
    setPs(psLoaded)
    if (psLoaded) setSel((psLoaded.sets.find((x: any) => x.name === psLoaded.active) ?? psLoaded.default).tickers)
  }, [psLoaded])
  const defaults: string[] = ps?.default?.tickers ?? []
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((t) => b.includes(t))
  const isDefault = !sel || same(sel, defaults)
  const savedMatch = sel ? ps?.sets?.find((x: any) => same(x.tickers, sel)) : null
  const setLabel = isDefault ? ps?.default?.name ?? 'Peers' : savedMatch?.name ?? 'Custom'
  const extras = (sel ?? []).filter((t) => !defaults.includes(t))
  const { data: peers } = useApi<any>(ps ? `/company/${ticker}/peers${extras.length ? `?extra=${extras.join(',')}` : ''}` : null)
  const { data: customPm } = useApi<any>(!isDefault && sel?.length ? `/company/${ticker}/peer-median?peers=${sel.join(',')}` : null)
  const pmData = isDefault ? data?.peer_median : sel?.length ? customPm : { peers: [], points: [], note: 'No peers selected.' }

  const choose = (name: string | null) => {
    const set = name ? ps.sets.find((x: any) => x.name === name) : ps.default
    setSel(set.tickers)
    api(`/company/${ticker}/peersets-active`, { method: 'PUT', body: JSON.stringify({ name }) }).then(setPs).catch(() => {})
  }
  const toggle = (t: string) => setSel((cur) => (cur ?? defaults).includes(t) ? (cur ?? defaults).filter((x) => x !== t) : [...(cur ?? defaults), t])
  const saveAs = () => {
    const name = window.prompt('Name this peer set (e.g. "AI peers"). Saving with an existing name replaces it.', savedMatch?.name ?? (setLabel === 'Custom' ? '' : `${setLabel} edited`))
    if (!name?.trim() || !sel) return
    api(`/company/${ticker}/peersets`, { method: 'PUT', body: JSON.stringify({ name, tickers: sel, activate: true }) }).then(setPs).catch((e) => window.alert(e.message))
  }
  const removeSet = () => {
    if (savedMatch && window.confirm(`Delete the peer set "${savedMatch.name}"?`)) {
      del(`/company/${ticker}/peersets/${encodeURIComponent(savedMatch.name)}`).then((r) => {
        setPs(r)
        setSel(r.default.tickers)
      })
    }
  }
  const addTicker = () => {
    const t = addText.trim().toUpperCase().replace('.', '-')
    if (t && t !== ticker && !(sel ?? []).includes(t)) setSel([...(sel ?? defaults), t])
    setAddText('')
  }

  const peerRows = (peers?.rows ?? []).filter((r: any) => r.ticker !== ticker && (sel ?? defaults).includes(r.ticker))
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
    { key: 'peer_median', label: 'Peer Med', render: (r) => <Val v={r.peer_median} kind={r.kind} na={r.na.peer_median} />, title: `Median of the checked comps below: ${setLabel} (${peerRows.length})` },
    { key: 'vs_peer', label: 'vs Peers', render: (r) => <Val v={r.vs_peer} kind="pct" color na="Missing own or peer value" /> },
  ]

  const compCols: Col<any>[] = [
    {
      key: 'in_median',
      label: 'In median',
      title: 'Uncheck to drop a company from the peer median (and everything computed from it)',
      get: (r) => (r.ticker === 'MEDIAN' || r.ticker === ticker ? '' : (sel ?? defaults).includes(r.ticker) ? 'Yes' : 'No'),
      render: (r) =>
        r.ticker === 'MEDIAN' || r.ticker === ticker ? null : (
          <input type="checkbox" className="accent-[#ff9f1c] cursor-pointer" checked={(sel ?? defaults).includes(r.ticker)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.ticker)} />
        ),
    },
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
    { key: 'beta', label: 'Beta', kind: 'num', title: '2Y weekly returns vs S&P 500. 1.5 = moves ~1.5% for each 1% market move' },
    { key: 'beta_unlevered', label: 'Unlev β', kind: 'num', title: 'Beta with the effect of debt removed: beta / (1 + (1 − 21% tax) × debt / market cap). Use the peer median, relevered, for a WACC' },
    { key: 'vol_ann', label: 'Vol', kind: 'pctPlain', title: 'Annualized volatility of weekly returns, 2Y. Total risk, incl. company-specific moves beta ignores' },
  ]
  const numericKeys = compCols.filter((c) => c.kind && c.kind !== 'text').map((c) => c.key)
  const medianRow: any = { ticker: 'MEDIAN', name: `Median: ${setLabel} (${peerRows.length})`, na: {} }
  numericKeys.forEach((k) => (medianRow[k] = median(peerRows.map((r: any) => r[k]))))
  const allRows: any[] = peers?.rows ?? []
  const excluded = allRows.filter((r) => r.ticker !== ticker && !(sel ?? defaults).includes(r.ticker))
  const compRows = peers ? [...allRows.filter((r) => showExcluded || !excluded.includes(r)), medianRow] : []

  return (
    <div className="flex flex-col gap-1.5">
      {error && <ErrorBox error={error} />}
      <Panel title={`${ticker} Valuation vs own 5Y history & peers · ${setLabel} (${peerRows.length})`} png={false}>
        {!data ? <Loading what="Computing valuation history from SEC financials" /> : <DataTable title={`${ticker}_valuation_summary`} cols={sCols} rows={summaryRows} />}
      </Panel>
      <Panel title={`${ticker} ${metric.label} over time vs 5Y average & median of ${setLabel}`} right={<Seg value={metric.key} options={CHART_METRICS.map((m) => ({ value: m.key, label: m.label }))} onChange={setMk} />}>
        {!data ? <Loading /> : data.history.length === 0 ? <Empty>{data.note}</Empty> : <HistoryChart data={data} metric={metric} ticker={ticker} pm={pmData} setLabel={setLabel} />}
        {pmData?.note && <div className="px-2 text-[10px] text-dim">{pmData.note}</div>}
      </Panel>
      <Panel title={`Comps: ${setLabel} (${peerRows.length})`} png={false}>
        {ps && (
          <div className="flex flex-wrap items-center gap-2 px-2 pt-1.5 text-[10.5px]">
            <span className="text-dim">Peer set:</span>
            <Seg
              value={isDefault ? '__default' : savedMatch?.name ?? '__custom'}
              options={[
                { value: '__default', label: `${ps.default.name} (${defaults.length})` },
                ...ps.sets.map((x: any) => ({ value: x.name, label: `${x.name} (${x.tickers.length})` })),
                ...(isDefault || savedMatch ? [] : [{ value: '__custom', label: `Custom (${sel?.length ?? 0})` }]),
              ]}
              onChange={(v) => v !== '__custom' && choose(v === '__default' ? null : v)}
            />
            <button className="text-dim hover:text-amber border border-line px-1.5" onClick={saveAs} title="Save the checked companies as a named set for this company">
              Save as set…
            </button>
            {savedMatch && (
              <button className="text-dim hover:text-down" onClick={removeSet}>
                Delete set
              </button>
            )}
            <span className="flex items-center gap-1">
              <input
                className="bg-panel2 border border-line px-1 w-16 num uppercase"
                placeholder="+ ticker"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTicker()}
              />
              <button className="text-dim hover:text-amber" onClick={addTicker}>
                Add
              </button>
            </span>
            {excluded.length > 0 && (
              <label className="flex items-center gap-1 text-dim cursor-pointer">
                <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
                Show unchecked ({excluded.length})
              </label>
            )}
          </div>
        )}
        {!peers ? (
          <Loading what="Loading comps (peers without a cached snapshot are fetched once from Yahoo)" />
        ) : (
          <DataTable title={`${ticker}_comps_${setLabel.replace(/\W+/g, '_')}`} cols={compCols} rows={compRows} rowKey={(r) => r.ticker} onRow={(r) => r.ticker !== 'MEDIAN' && nav(`/c/${r.ticker}/RV`)} />
        )}
      </Panel>
      {peers && <PositionRisk ticker={ticker} rows={peers.rows} peerRows={peerRows} />}
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

const TAX = 0.21

// How much risk a position size carries, vs the same weight in a typical peer
function PositionRisk({ ticker, rows, peerRows }: { ticker: string; rows: any[]; peerRows: any[] }) {
  const key = `tmt:weight:${ticker}`
  const [w, setW] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const me = rows.find((r) => r.ticker === ticker)
  if (!me || me.beta == null) return null
  const save = (v: string) => {
    setW(v)
    try {
      localStorage.setItem(key, v)
    } catch {
      /* private mode: just don't remember it */
    }
  }
  const wt = parseFloat(w) / 100
  const has = Number.isFinite(wt) && wt > 0
  const medVol = median(peerRows.map((r) => r.vol_ann))
  const medBeta = median(peerRows.map((r) => r.beta))
  const medUnlev = median(peerRows.map((r) => r.beta_unlevered))
  const relevered = medUnlev != null && me.debt_to_equity != null ? medUnlev * (1 + (1 - TAX) * me.debt_to_equity) : null
  const p = (v: number | null | undefined, d = 1) => (v == null ? 'N/A' : `${(v * 100).toFixed(d)}%`)
  return (
    <Panel title={`${ticker} Position risk · what a position size means`} png={false}>
      <div className="p-2 text-[11.5px] flex flex-col gap-1.5">
        <label className="flex items-center gap-2">
          <span className="text-dim">Position size (% of the fund):</span>
          <input
            className="bg-panel2 border border-line px-1.5 py-0.5 w-20 num text-amber"
            inputMode="decimal"
            placeholder="e.g. 5"
            value={w}
            onChange={(e) => save(e.target.value)}
          />
          <span className="text-[10.5px] text-dim">Saved in this browser only.</span>
        </label>
        <table className="term">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}></th>
              <th style={{ textAlign: 'right' }}>{ticker}</th>
              <th style={{ textAlign: 'right' }}>Peer median</th>
              <th style={{ textAlign: 'left' }}>What it means for sizing</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Beta (2Y vs S&amp;P 500)</td>
              <td className="num text-right">{me.beta.toFixed(2)}</td>
              <td className="num text-right">{medBeta?.toFixed(2) ?? 'N/A'}</td>
              <td className="text-dim">
                {has ? (
                  <>
                    Beta-adjusted exposure <span className="num text-amber">{p(wt * me.beta)}</span> of the fund: a 10% market drop costs the fund about{' '}
                    <span className="num text-amber">{p(wt * me.beta * 0.1, 2)}</span> through this position.
                  </>
                ) : (
                  'Enter a position size to see its market exposure.'
                )}
              </td>
            </tr>
            <tr>
              <td>Volatility (annualized)</td>
              <td className="num text-right">{p(me.vol_ann)}</td>
              <td className="num text-right">{p(medVol)}</td>
              <td className="text-dim">
                {has && me.vol_ann != null ? (
                  <>
                    A normal year moves this position by about ±<span className="num text-amber">{p(wt * me.vol_ann, 2)}</span> of the fund.
                    {medVol != null && (
                      <>
                        {' '}
                        Same risk as <span className="num text-amber">{p((wt * me.vol_ann) / medVol)}</span> in a typical peer.
                      </>
                    )}
                  </>
                ) : (
                  'Total risk, including company-specific news that beta ignores.'
                )}
              </td>
            </tr>
            <tr>
              <td>Unlevered beta</td>
              <td className="num text-right">{me.beta_unlevered?.toFixed(2) ?? 'N/A'}</td>
              <td className="num text-right">{medUnlev?.toFixed(2) ?? 'N/A'}</td>
              <td className="text-dim">
                For a WACC: peer median relevered at {ticker}'s debt = <span className="num text-amber">{relevered?.toFixed(2) ?? 'N/A'}</span> (vs its own {me.beta.toFixed(2)}).
              </td>
            </tr>
          </tbody>
        </table>
        <div className="text-[10.5px] text-dim">
          Beta and volatility are backward-looking (2 years of weekly returns) and shift with the window. This sizes one position on its own; it doesn't know the
          fund's other holdings, so stocks that move together (e.g. two ride-hailing names) add up to more risk than either alone.
        </div>
      </div>
    </Panel>
  )
}
