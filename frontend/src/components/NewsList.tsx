import { Link } from 'react-router-dom'
import { exportCsv } from '../lib/export'

export type NewsItem = {
  id: string
  ticker: string | null
  ts: string
  headline: string
  summary: string | null
  source: string | null
  url: string | null
  provider: string
  is_deal: number
  sub_industry?: string | null
}

export function NewsList({ items, title, showTicker = true }: { items: NewsItem[]; title: string; showTicker?: boolean }) {
  if (!items.length) return <div className="p-3 text-dim">No articles match.</div>
  return (
    <div>
      <div className="flex justify-end px-2 py-0.5 text-[10px] text-dim">
        <span className="mr-auto num">{items.length} articles</span>
        <button
          className="hover:text-amber uppercase"
          onClick={() => exportCsv(title, ['Time (UTC)', 'Ticker', 'Headline', 'Source', 'Provider', 'M&A flag', 'URL'], items.map((n) => [n.ts, n.ticker ?? '', n.headline, n.source ?? '', n.provider, n.is_deal ? 'Y' : '', n.url ?? '']))}
        >
          CSV
        </button>
      </div>
      {items.map((n) => (
        <div key={n.id} className="flex gap-2 px-2 py-0.5 border-b border-[#151515] text-[11.5px] items-baseline" title={n.summary ?? ''}>
          <span className="num text-dim w-28 shrink-0">{n.ts.slice(0, 16).replace('T', ' ')}</span>
          {showTicker && (
            <span className="w-14 shrink-0">
              {n.ticker ? (
                <Link to={`/c/${n.ticker}/NEWS`} className="text-amber num hover:underline">
                  {n.ticker}
                </Link>
              ) : (
                <span className="text-dim">—</span>
              )}
            </span>
          )}
          {n.is_deal ? <span className="text-[9.5px] uppercase border border-amber text-amber px-1 shrink-0">M&amp;A</span> : null}
          <a href={n.url ?? '#'} target="_blank" rel="noreferrer" className="hover:text-amber">
            {n.headline}
          </a>
          <span className="ml-auto text-dim text-[10px] shrink-0 pl-2">
            {n.source} · {n.provider}
          </span>
        </div>
      ))}
    </div>
  )
}
