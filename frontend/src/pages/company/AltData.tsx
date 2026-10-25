import { useMemo } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Empty, ErrorBox, Loading, Panel } from '../../components/Panel'
import { AXIS, C, GRID, TOOLTIP } from '../../lib/chart'
import { ago } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

function AltChart({ src, price }: { src: any; price: any[] }) {
  const data = useMemo(() => {
    if (!src.points.length) return []
    const first = src.points[0].date
    const pxMap = new Map(price.filter((p) => p.date >= first).map((p) => [p.date, p.close]))
    // Align price to the alt series dates (carry the last close forward over weekends)
    let lastPx: number | null = null
    const pxDates = [...pxMap.keys()].sort()
    let j = 0
    return src.points.map((p: any) => {
      while (j < pxDates.length && pxDates[j] <= p.date) {
        lastPx = pxMap.get(pxDates[j]) ?? lastPx
        j++
      }
      return { date: p.date, alt: p.value, price: lastPx }
    })
  }, [src, price])
  return (
    <div style={{ height: 210 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={(d) => d.slice(0, 7)} minTickGap={40} />
          <YAxis yAxisId="alt" {...AXIS} width={46} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(+v.toFixed(2)))} />
          <YAxis yAxisId="px" orientation="right" {...AXIS} width={44} domain={['auto', 'auto']} />
          <Tooltip {...TOOLTIP} />
          <Line yAxisId="alt" dataKey="alt" name={`${src.name} (${src.unit})`} stroke={C.blue} dot={false} strokeWidth={1} isAnimationActive={false} />
          <Line yAxisId="px" dataKey="price" name="Price (adj.)" stroke={C.amber} dot={false} strokeWidth={1.4} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function AltData({ ticker }: TabProps) {
  const { data, error } = useApi<any>(`/company/${ticker}/altdata`)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Fetching alt-data proxies (several free sources, each rate-limited; first load ~30-60s, then cached)" />
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10.5px] text-dim px-1">
        <span className="text-amber">PROXIES, not fundamentals.</span> These measure attention and interest around “{data.company_query}”, not sales or usage. Name collisions (e.g. a company
        sharing a common word) inflate counts. Blue = alt series (left axis), amber = share price (right axis).
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
        {data.sources.map((s: any) => (
          <Panel
            key={s.id}
            title={`${ticker} · ${s.name} [PROXY]`}
            note={
              <span>
                {s.description} Proxy for: {s.proxy_for}. {s.fetched_at ? `Fetched ${ago(s.fetched_at)}.` : ''}
              </span>
            }
          >
            {s.points.length ? <AltChart src={s} price={data.price} /> : <Empty>{s.status}</Empty>}
          </Panel>
        ))}
      </div>
    </div>
  )
}
