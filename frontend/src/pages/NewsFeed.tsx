import { useState } from 'react'
import { NewsList } from '../components/NewsList'
import { ErrorBox, Loading, Panel, Seg } from '../components/Panel'
import { useApi } from '../lib/useApi'
import { useWatchlists } from '../lib/watchlists'

const SUBS = ['Semiconductors', 'Semi Equipment', 'Software', 'Internet', 'IT Services', 'Hardware', 'Comm Equipment', 'Media & Entertainment', 'Telecom']

export default function NewsFeed({ deals = false }: { deals?: boolean }) {
  const { lists, active } = useWatchlists()
  const [scope, setScope] = useState<'sector' | 'watchlist'>(deals ? 'sector' : 'watchlist')
  const [wl, setWl] = useState(active)
  const [sub, setSub] = useState('')
  const [ticker, setTicker] = useState('')
  const [q, setQ] = useState('')
  const [since, setSince] = useState(() => new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10))
  const [until, setUntil] = useState('')
  const [nonce, setNonce] = useState(0)
  const [untagged, setUntagged] = useState(false)
  const params = new URLSearchParams({ scope, watchlist: wl, since, deals: String(deals) })
  if (sub) params.set('sub_industry', sub)
  if (ticker.trim()) params.set('ticker', ticker.trim().toUpperCase())
  if (q.trim()) params.set('q', q.trim())
  if (until) params.set('until', until)
  if (untagged) params.set('untagged', 'true')
  if (nonce) params.set('refresh', 'true')
  const { data, error, loading } = useApi<any>(`/news?${params}&_=${nonce}`)

  return (
    <Panel
      title={deals ? 'TMT deals feed: M&A, divestitures, rumored deals' : 'News feed'}
      png={false}
      right={
        <button className="text-[10px] text-dim hover:text-amber" onClick={() => setNonce(nonce + 1)}>
          REFRESH
        </button>
      }
    >
      <div className="flex flex-wrap gap-2 items-center px-2 py-1 border-b border-line text-[11px]">
        <Seg value={scope} options={[{ value: 'watchlist', label: 'WATCHLIST' }, { value: 'sector', label: 'SECTOR-WIDE' }] as any} onChange={setScope as any} />
        {scope === 'watchlist' && (
          <select value={wl} onChange={(e) => setWl(e.target.value)} className="bg-black border border-line">
            {Object.keys(lists).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        )}
        <select value={sub} onChange={(e) => setSub(e.target.value)} className="bg-black border border-line">
          <option value="">All sub-industries</option>
          {SUBS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="ticker" className="bg-black border border-line w-16 px-1 num uppercase" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search headlines" className="bg-black border border-line w-40 px-1" />
        {scope === 'sector' && (
          <label className="flex items-center gap-1 cursor-pointer text-dim" title="Market-wide headlines that don't mention a universe company">
            <input type="checkbox" checked={untagged} onChange={() => setUntagged(!untagged)} /> general market news
          </label>
        )}
        <span className="text-dim">from</span>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="bg-black border border-line px-1 num" />
        <span className="text-dim">to</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="bg-black border border-line px-1 num" />
      </div>
      {data?.notes?.length > 0 && <div className="px-2 py-1 text-[10px] text-dim">{data.notes.join(' ')}</div>}
      {deals && (
        <div className="px-2 py-1 text-[10px] text-dim">
          Headlines flagged by keyword (acquire, merger, takeover, divest, spin-off, "in talks", strategic alternatives…), so expect some false positives. For confirmed deals see each company's CF tab (8-K items
          1.01/2.01, S-4, SC TO-T, DEFM14A).
        </div>
      )}
      {error ? <ErrorBox error={error} /> : loading && !data ? <Loading what="Fetching news (first load of a watchlist pulls each name once)" /> : <NewsList items={data?.items ?? []} title={deals ? 'tmt_deals' : 'tmt_news'} />}
    </Panel>
  )
}
