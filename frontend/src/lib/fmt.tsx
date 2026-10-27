import type { ReactNode } from 'react'

export type Kind = 'pct' | 'pctPlain' | 'x' | 'money' | 'cap' | 'num' | 'int' | 'text' | 'date' | 'big'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function fmtCap(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

export function fmtValue(v: unknown, kind: Kind = 'num', digits?: number): string | null {
  if (v === null || v === undefined || v === '') return null
  if (kind === 'text') return String(v)
  if (kind === 'date') {
    const s = String(v)
    return s.length >= 10 ? s.slice(0, 10) : s
  }
  if (!isNum(v)) return typeof v === 'string' ? v : null
  switch (kind) {
    case 'pct':
      return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits ?? 1)}%`
    case 'pctPlain':
      return `${(v * 100).toFixed(digits ?? 1)}%`
    case 'x':
      return `${v.toFixed(digits ?? 1)}x`
    case 'money':
      return v.toLocaleString(undefined, { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 })
    case 'cap':
    case 'big':
      return fmtCap(v)
    case 'int':
      return Math.round(v).toLocaleString()
    default:
      return v.toLocaleString(undefined, { maximumFractionDigits: digits ?? 2 })
  }
}

/** "N/A" with an explanatory tooltip. Never throws on missing data. */
export function NA({ why }: { why?: string | null }) {
  return (
    <span className="text-dim cursor-help border-b border-dotted border-dim/50" title={why || 'Not available from the free data sources used.'}>
      N/A
    </span>
  )
}

export function Val({
  v,
  kind = 'num',
  na,
  color,
  digits,
}: {
  v: unknown
  kind?: Kind
  na?: string | null
  color?: boolean
  digits?: number
}): ReactNode {
  const s = fmtValue(v, kind, digits)
  if (s === null) return <NA why={na} />
  const cls = color && isNum(v) ? (v > 0 ? 'text-up' : v < 0 ? 'text-down' : '') : ''
  return <span className={`num ${cls}`}>{s}</span>
}

export const ago = (ts?: number | null) => {
  if (!ts) return 'never'
  const s = Date.now() / 1000 - ts
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export const RATING_LABEL: Record<string, string> = {
  strong_buy: 'Strong Buy',
  buy: 'Buy',
  hold: 'Hold',
  underperform: 'Underperform',
  sell: 'Sell',
}

/** A multiple with its data basis; values that fell back to Yahoo get a small marker. */
export function BasisVal({ row, k, kind }: { row: any; k: string; kind: Kind }) {
  const b: string | undefined = row?.basis?.[k]
  const yahoo = b?.startsWith('Yahoo')
  return (
    <span title={b ? `Basis: ${b}` : undefined}>
      <Val v={row?.[k]} kind={kind} na={row?.na?.[k] ?? row?.na?._all} />
      {yahoo && row?.[k] != null && <sup className="text-info ml-0.5">ʏ</sup>}
    </span>
  )
}
