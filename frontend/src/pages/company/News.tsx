import { useState } from 'react'
import { NewsList } from '../../components/NewsList'
import { ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

export default function News({ ticker }: TabProps) {
  const [days, setDays] = useState('30')
  const [deals, setDeals] = useState(false)
  const { data, error } = useApi<any>(`/company/${ticker}/news?days=${days}`)
  const items = (data?.items ?? []).filter((n: any) => !deals || n.is_deal)
  return (
    <Panel
      title={`${ticker} news`}
      png={false}
      right={
        <div className="flex gap-2 items-center">
          <label className="text-[10px] flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={deals} onChange={() => setDeals(!deals)} /> M&amp;A only
          </label>
          <Seg value={days} options={[{ value: '7', label: '1W' }, { value: '30', label: '1M' }, { value: '90', label: '3M' }, { value: '365', label: '1Y' }] as any} onChange={setDays} />
        </div>
      }
      note="Sources: Finnhub company news (with a key), Yahoo Finance, and GDELT articles pulled for move windows. Article text belongs to the publishers; links open the original."
    >
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : <NewsList items={items} title={`${ticker}_news`} showTicker={false} />}
    </Panel>
  )
}
