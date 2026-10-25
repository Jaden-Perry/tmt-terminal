import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'

export type Bar = { time: string; open: number; high: number; low: number; close: number; adj_close: number; volume: number }
export type Marker = { time: string; kind: 'earnings' | 'up' | 'down' | 'filing' | 'deal'; text: string }

const BASE = {
  layout: { background: { type: ColorType.Solid, color: '#000000' }, textColor: '#a0a0a0', fontFamily: 'IBM Plex Mono', fontSize: 11 },
  grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
  rightPriceScale: { borderColor: '#262626' },
  timeScale: { borderColor: '#262626' },
  crosshair: { mode: 0 },
}

function sma(bars: Bar[], n: number) {
  const out: { time: Time; value: number }[] = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close
    if (i >= n) sum -= bars[i - n].close
    if (i >= n - 1) out.push({ time: bars[i].time as Time, value: sum / n })
  }
  return out
}

const MARKER_STYLE: Record<Marker['kind'], Partial<SeriesMarker<Time>>> = {
  earnings: { position: 'belowBar', color: '#4fb3ff', shape: 'circle' },
  up: { position: 'belowBar', color: '#2fd16c', shape: 'arrowUp' },
  down: { position: 'aboveBar', color: '#ff4d4d', shape: 'arrowDown' },
  filing: { position: 'aboveBar', color: '#c08cff', shape: 'square' },
  deal: { position: 'aboveBar', color: '#ffa028', shape: 'square' },
}

export function CandleChart({
  bars,
  markers = [],
  mas = [50, 200],
  height = 460,
  onMarkerClick,
}: {
  bars: Bar[]
  markers?: Marker[]
  mas?: number[]
  height?: number
  onMarkerClick?: (time: string) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!el.current || bars.length === 0) return
    const chart = createChart(el.current, { ...BASE, height, autoSize: true } as any)
    chartRef.current = chart
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#2fd16c',
      downColor: '#ff4d4d',
      wickUpColor: '#2fd16c',
      wickDownColor: '#ff4d4d',
      borderVisible: false,
    })
    candles.setData(bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })))
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } })
    vol.setData(bars.map((b) => ({ time: b.time as Time, value: b.volume, color: b.close >= b.open ? '#1d5c36' : '#6b2323' })))
    const maColors = ['#ffa028', '#4fb3ff', '#c08cff']
    mas.forEach((n, i) => {
      if (bars.length < n) return
      const s = chart.addSeries(LineSeries, { color: maColors[i % 3], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      s.setData(sma(bars, n))
    })
    const times = new Set(bars.map((b) => b.time))
    const ms = markers
      .filter((m) => times.has(m.time))
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((m) => ({ time: m.time as Time, text: m.text, ...MARKER_STYLE[m.kind] }) as SeriesMarker<Time>)
    createSeriesMarkers(candles, ms)
    if (onMarkerClick) {
      const markerTimes = new Set(markers.map((m) => m.time))
      chart.subscribeClick((p) => {
        if (p.time && markerTimes.has(String(p.time))) onMarkerClick(String(p.time))
      })
    }
    chart.timeScale().fitContent()
    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [bars, markers, mas, height, onMarkerClick])

  return <div ref={el} style={{ height }} />
}

const LINE_COLORS = ['#ffa028', '#4fb3ff', '#2fd16c', '#c08cff', '#ff6b9d', '#f5e663', '#7fffd4', '#ff8c42', '#9aa0a6']

export function CompareChart({ series, height = 460 }: { series: { name: string; points: { time: string; value: number }[] }[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!el.current) return
    const chart = createChart(el.current, {
      ...BASE,
      height,
      autoSize: true,
      localization: { priceFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` },
    } as any)
    series.forEach((s, i) => {
      const line = chart.addSeries(LineSeries, { color: LINE_COLORS[i % LINE_COLORS.length], lineWidth: i === 0 ? 2 : 1, title: s.name, priceLineVisible: false })
      line.setData(s.points.map((p) => ({ time: p.time as Time, value: p.value })))
    })
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [series, height])
  return (
    <div>
      <div className="flex flex-wrap gap-3 px-2 py-1 text-[10px] num">
        {series.map((s, i) => (
          <span key={s.name} style={{ color: LINE_COLORS[i % LINE_COLORS.length] }}>
            ■ {s.name} {s.points.length ? `${s.points[s.points.length - 1].value >= 0 ? '+' : ''}${s.points[s.points.length - 1].value.toFixed(1)}%` : 'N/A'}
          </span>
        ))}
      </div>
      <div ref={el} style={{ height }} />
    </div>
  )
}
