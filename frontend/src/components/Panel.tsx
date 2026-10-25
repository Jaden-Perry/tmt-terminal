import { useRef, useState, type ReactNode } from 'react'
import { exportPng } from '../lib/export'

export function Panel({
  title,
  right,
  children,
  className = '',
  png = true,
  bodyClass = '',
  note,
}: {
  title: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  png?: boolean
  bodyClass?: string
  note?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const name = typeof title === 'string' ? title : 'chart'
  return (
    <section className={`bg-panel border border-line flex flex-col min-w-0 ${className}`}>
      <header className="flex items-center gap-2 px-2 h-6 border-b border-line bg-panel2 shrink-0">
        <h2 className="text-amber text-[11px] font-semibold uppercase tracking-wide truncate">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          {right}
          {png && (
            <button
              className="text-dim hover:text-amber text-[10px] uppercase"
              title="Export this panel as a PNG image"
              disabled={busy}
              onClick={async () => {
                if (!ref.current) return
                setBusy(true)
                try {
                  await exportPng(ref.current, name)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? '…' : 'PNG'}
            </button>
          )}
        </div>
      </header>
      <div ref={ref} className={`flex-1 min-h-0 bg-panel ${bodyClass}`}>
        {children}
        {note && <div className="px-2 py-1 text-[10px] text-dim border-t border-line">{note}</div>}
      </div>
    </section>
  )
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="p-3 text-dim num animate-pulse">{what}…</div>
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="p-3 text-down num">ERR: {error}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-3 text-dim">{children}</div>
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly T[] | { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const opts = (options as any[]).map((o) => (typeof o === 'string' ? { value: o, label: o.toUpperCase() } : o))
  return (
    <div className="flex">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-1.5 text-[10px] num border border-line -ml-px ${value === o.value ? 'tab-active' : 'text-dim hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
