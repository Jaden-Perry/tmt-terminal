import { useMemo, useState } from 'react'
import { CandleChart, CompareChart, type Marker } from '../../components/PriceChart'
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

const RANGES = [
  { value: '0.25', label: '3M' },
  { value: '0.5', label: '6M' },
  { value: '1', label: '1Y' },
  { value: '2', label: '2Y' },
  { value: '5', label: '5Y' },
  { value: '10', label: '10Y' },
]
const ETFS = ['SPY', 'QQQ', 'XLK', 'XLC', 'SMH', 'IGV']

export default function Chart({ ticker }: TabProps) {
  const [years, setYears] = useState('1')
  const [mode, setMode] = useState<'candles' | 'compare'>('candles')
  const [showPeers, setShowPeers] = useState(false)
  const [etfs, setEtfs] = useState<string[] | null>(null)
  const { data, error } = useApi<any>(`/company/${ticker}/prices?years=${years}`)
  const { data: ev } = useApi<any>(`/company/${ticker}/events?years=${years}`)
  const { data: prof } = useApi<any>(mode === 'compare' ? `/company/${ticker}/profile` : null)
  const { data: cmpDefault } = useApi<any>(mode === 'compare' ? `/company/${ticker}/compare?years=0.1` : null)
  const chosen = etfs ?? (cmpDefault ? ['SPY', cmpDefault.default_etf] : ['SPY'])
  const peerSyms = showPeers ? (prof?.peers ?? []).slice(0, 5) : []
  const symbols = [...chosen, ...peerSyms].join(',')
  const { data: cmp } = useApi<any>(mode === 'compare' && cmpDefault ? `/company/${ticker}/compare?years=${years}&symbols=${symbols}` : null)

  const markers: Marker[] = useMemo(() => ev?.markers ?? [], [ev])

  return (
    <Panel
      title={`${ticker} ${mode === 'candles' ? 'Price · Volume · 50/200D MA' : 'Relative performance'}`}
      right={
        <div className="flex items-center gap-2">
          <Seg value={mode} options={[{ value: 'candles', label: 'CANDLES' }, { value: 'compare', label: 'COMPARE' }] as any} onChange={setMode as any} />
          <Seg value={years} options={RANGES as any} onChange={setYears} />
        </div>
      }
      note={
        mode === 'candles' ? (
          <span>
            <span className="text-[#4fb3ff]">● E</span> earnings date · <span className="text-up">▲</span>/<span className="text-down">▼</span> significant move (&gt;2σ or &gt;5% daily;
            click the MOVE tab for the cause) · <span className="text-[#ffa028]">■</span> M&amp;A-related 8-K. Daily bars, end of day (Yahoo Finance).
          </span>
        ) : (
          'Total-return basis (dividend-adjusted closes), rebased to 0% at the start of the window.'
        )
      }
    >
      {error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : data.bars.length === 0 ? (
        <Empty>{data.note}</Empty>
      ) : mode === 'candles' ? (
        <CandleChart bars={data.bars} markers={markers} />
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-[10px]">
            <span className="text-dim">VS:</span>
            {ETFS.map((e) => (
              <label key={e} className="flex items-center gap-1 num cursor-pointer">
                <input
                  type="checkbox"
                  checked={chosen.includes(e)}
                  onChange={() => setEtfs(chosen.includes(e) ? chosen.filter((x) => x !== e) : [...chosen, e])}
                />
                {e}
              </label>
            ))}
            <label className="flex items-center gap-1 cursor-pointer ml-3">
              <input type="checkbox" checked={showPeers} onChange={() => setShowPeers(!showPeers)} /> Top 5 peers {prof && !prof.peers?.length ? '(none in universe)' : ''}
            </label>
          </div>
          {cmp ? <CompareChart series={cmp.series} /> : <Loading />}
        </div>
      )}
    </Panel>
  )
}
