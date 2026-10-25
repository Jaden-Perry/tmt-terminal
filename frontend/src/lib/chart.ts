// Shared Recharts styling for the dark terminal theme.
import { fmtCap } from './fmt'

export const AXIS = { stroke: '#555', tick: { fill: '#8a8a8a', fontSize: 10, fontFamily: 'IBM Plex Mono' } }
export const GRID = { stroke: '#1c1c1c', strokeDasharray: '2 4' }
export const TOOLTIP = {
  contentStyle: { background: '#0b0b0b', border: '1px solid #333', fontFamily: 'IBM Plex Mono', fontSize: 11 },
  labelStyle: { color: '#ffa028' },
  itemStyle: { padding: 0 },
}
export const C = {
  amber: '#ffa028',
  blue: '#4fb3ff',
  green: '#2fd16c',
  red: '#ff4d4d',
  purple: '#c08cff',
  pink: '#ff6b9d',
  yellow: '#f5e663',
  dim: '#666',
}
export const SERIES = [C.amber, C.blue, C.green, C.purple, C.pink, C.yellow, '#7fffd4', '#ff8c42', '#9aa0a6', '#b0e57c']

export const tickCap = (v: number) => (v === 0 ? '0' : fmtCap(v))
export const tickPct = (v: number) => `${(v * 100).toFixed(0)}%`
export const tickX = (v: number) => `${v.toFixed(0)}x`
