import { useEffect, useState } from 'react'
import { Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { AXIS, C, TOOLTIP } from '../../lib/chart'
import { post } from '../../lib/api'
import { Val } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

type Move = { date: string; window: '1D' | '1W' | '1M'; start: string; end: string; ret: number; z: number | null; rel_ret: number | null; etf: string; reasons: string[]; latest?: boolean }

const KIND_STYLE: Record<string, string> = {
  earnings: 'text-info border-info',
  filing: 'text-[#c08cff] border-[#c08cff]',
  news: 'text-fg border-line',
}

function moveLabel(t: string, m: Move) {
  return `${t} ${m.ret >= 0 ? '+' : ''}${(m.ret * 100).toFixed(1)}% ${m.window === '1D' ? `on ${m.start}` : `from ${m.start} to ${m.end}`}${m.rel_ret != null ? ` (${(m.rel_ret * 100).toFixed(1)}% vs ${m.etf})` : ''}`
}

function Explain({ ticker, move, existing, enabled }: { ticker: string; move: Move; existing: any; enabled: boolean }) {
  const [res, setRes] = useState<any>(existing)
  const [busy, setBusy] = useState(false)
  useEffect(() => setRes(existing), [existing])
  if (!enabled && !res)
    return <div className="px-2 py-1 text-[10.5px] text-dim">AI summaries are off (no ANTHROPIC_API_KEY). The headlines and filings below are the full evidence.</div>
  return (
    <div className="px-2 py-2 border-b border-line">
      {!res && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              setRes(await post(`/company/${ticker}/moves/explain`, { start: move.start, end: move.end, label: moveLabel(ticker, move) }))
            } catch (e) {
              setRes({ error: (e as Error).message })
            } finally {
              setBusy(false)
            }
          }}
          className="px-2 py-0.5 border border-amber text-amber text-[11px] hover:bg-amber/10"
          title="Sends only the headlines and filings listed below to Claude Haiku. Result is cached and never regenerated."
        >
          {busy ? 'Explaining…' : '✦ Explain (AI)'}
        </button>
      )}
      {res?.error && <div className="text-down text-[11px]">{res.error}</div>}
      {res?.summary && (
        <div className="border border-amber-dim/60 bg-[#120c00] p-2">
          <div className="text-[9.5px] uppercase tracking-wide text-amber mb-1">
            AI-generated summary · {res.model} · uses only the {res.sources?.length} sources below · {res.cached ? 'cached' : `cost $${res.cost_usd?.toFixed(5)}`}
          </div>
          <div className="text-[12px] leading-relaxed">{res.summary}</div>
          {res.cited?.length > 0 && (
            <ol className="mt-1 text-[10.5px] text-dim">
              {res.cited.map((i: number) => {
                const s = res.sources[i - 1]
                return (
                  <li key={i}>
                    [{i}] {s.date} {s.kind}:{' '}
                    {s.url ? (
                      <a className="text-info hover:underline" href={s.url} target="_blank" rel="noreferrer">
                        {s.text}
                      </a>
                    ) : (
                      s.text
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

function Timeline({ ticker, move }: { ticker: string; move: Move }) {
  const { data, error, loading } = useApi<any>(`/company/${ticker}/moves/timeline?start=${move.start}&end=${move.end}`)
  if (error) return <ErrorBox error={error} />
  if (loading || !data) return <Loading what="Pulling news, filings and earnings for this window (GDELT is rate-limited to 1 request / 5s)" />
  return (
    <div>
      <div style={{ height: 150 }} className="px-1">
        <ResponsiveContainer>
          <LineChart data={data.bars} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="time" {...AXIS} tickFormatter={(d) => d.slice(5)} minTickGap={30} />
            <YAxis {...AXIS} domain={['auto', 'auto']} width={44} />
            <Tooltip {...TOOLTIP} />
            {move.start === move.end ? (
              <ReferenceLine x={move.end} stroke={move.ret >= 0 ? C.green : C.red} strokeWidth={2} />
            ) : (
              <ReferenceArea x1={move.start < data.bars[0]?.time ? data.bars[0]?.time : move.start} x2={move.end} fill={move.ret >= 0 ? C.green : C.red} fillOpacity={0.15} />
            )}
            <Line dataKey="close" stroke={C.amber} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Explain ticker={ticker} move={move} existing={data.ai} enabled={data.ai_enabled} />
      {data.notes?.length > 0 && <div className="px-2 py-1 text-[10px] text-dim">{data.notes.join(' ')}</div>}
      {data.events.length === 0 ? (
        <Empty>No news, filings or earnings found in this window. The move may be sector- or market-driven (see the relative move above).</Empty>
      ) : (
        <div className="px-2 py-1">
          {data.events.map((e: any, i: number) => (
            <div key={i} className="flex gap-2 py-0.5 border-b border-[#151515] text-[11.5px]">
              <span className="num text-dim w-20 shrink-0">{e.date}</span>
              <span className={`text-[9.5px] uppercase border px-1 h-4 leading-4 shrink-0 w-16 text-center ${KIND_STYLE[e.kind]}`}>{e.kind}</span>
              {(e.is_ma || e.is_deal) && <span className="text-[9.5px] uppercase border border-amber text-amber px-1 h-4 leading-4 shrink-0">M&amp;A</span>}
              {e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-amber truncate">
                  {e.text}
                </a>
              ) : (
                <span>{e.text}</span>
              )}
              {e.source && <span className="ml-auto text-dim text-[10px] shrink-0">{e.source}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Moves({ ticker }: TabProps) {
  const [years, setYears] = useState('1')
  const [win, setWin] = useState<'ALL' | '1D' | '1W' | '1M'>('ALL')
  const { data, error } = useApi<any>(`/company/${ticker}/moves?years=${years}`)
  const [sel, setSel] = useState<Move | null>(null)
  const significant: Move[] = (data?.moves ?? []).filter((m: Move) => win === 'ALL' || m.window === win)
  // Always offer the latest session at the top, unless it is already listed as a significant move
  const latest: Move | null = data?.latest && !significant.some((m) => m.window === '1D' && m.end === data.latest.end) ? data.latest : null
  const list: Move[] = latest && win !== '1W' && win !== '1M' ? [latest, ...significant] : significant
  useEffect(() => setSel(null), [ticker, years])
  const active = sel ?? list[0] ?? null

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-1.5">
      <Panel
        title={`${ticker} significant moves`}
        png={false}
        right={
          <div className="flex gap-2">
            <Seg value={win} options={[{ value: 'ALL', label: 'ALL' }, { value: '1D', label: 'DAILY' }, { value: '1W', label: 'WEEKLY' }, { value: '1M', label: 'MONTHLY' }] as any} onChange={setWin as any} />
            <Seg value={years} options={[{ value: '0.25', label: '3M' }, { value: '1', label: '1Y' }, { value: '3', label: '3Y' }] as any} onChange={setYears} />
          </div>
        }
      >
        {error ? (
          <ErrorBox error={error} />
        ) : !data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty>No significant moves in this window.</Empty>
        ) : (
          <div className="overflow-auto max-h-[72vh]">
            <table className="term">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Date</th>
                  <th>Win</th>
                  <th style={{ textAlign: 'right' }}>Move</th>
                  <th style={{ textAlign: 'right' }}>σ</th>
                  <th style={{ textAlign: 'right' }}>vs ETF</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr
                    key={`${m.window}${m.end}`}
                    className={`clickable ${active && active.start === m.start && active.end === m.end ? 'bg-amber/15' : ''}`}
                    onClick={() => setSel(m)}
                    title={m.reasons.join(' · ')}
                  >
                    <td className="num">
                      {m.window === '1D' ? m.end : `${m.start.slice(5)}→${m.end.slice(5)}`}
                      {m.latest && <span className="ml-1 text-[9px] uppercase text-info">latest</span>}
                    </td>
                    <td className="text-dim text-center">{m.window}</td>
                    <td className="text-right">
                      <Val v={m.ret} kind="pct" color />
                    </td>
                    <td className="text-right num text-dim">{m.z != null ? m.z.toFixed(1) : ''}</td>
                    <td className="text-right">
                      <Val v={m.rel_ret} kind="pct" color na={m.window === '1D' ? 'No sector ETF data' : 'Relative moves are computed for daily windows only'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="px-2 py-1 text-[10px] text-dim leading-snug">
            <span className="text-fg">Click a row to see what happened around that move.</span> The top row is always the latest trading day.
            Other rows are significant moves only. Flags: daily |move| &gt; {data.rules.daily_abs * 100}% or &gt; {data.rules.daily_sigma}σ of trailing 1Y daily vol; weekly &gt; {data.rules.weekly_abs * 100}%;
            monthly &gt; {data.rules.monthly_abs * 100}%; or a daily move vs the sub-industry ETF &gt; {data.rules.relative_sigma}σ (and &gt;3%). Typical daily vol:{' '}
            {data.stats?.daily_vol_1y ? `${(data.stats.daily_vol_1y * 100).toFixed(1)}%` : 'N/A'}.
          </div>
        )}
      </Panel>
      <Panel title={active ? `Why did it move? ${moveLabel(ticker, active)}` : 'Why did it move?'} png={false}>
        {active ? <Timeline key={`${active.start}${active.end}`} ticker={ticker} move={active} /> : <Empty>Select a move.</Empty>}
      </Panel>
    </div>
  )
}
