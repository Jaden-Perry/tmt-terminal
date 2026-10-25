import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { COMPANY_TABS, parseCommand } from '../lib/commands'

type Hit = { ticker: string; name: string | null; sub_industry: string | null }

export function CommandBar() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [sel, setSel] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  // "/" or Esc focuses the command bar from anywhere, like Bloomberg's yellow keys
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if ((e.key === '/' || e.key === 'Escape') && tag !== 'INPUT' && tag !== 'SELECT') {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    const first = q.trim().split(/\s+/)[0]
    if (!first || q.includes(' ')) {
      setHits([])
      return
    }
    const id = setTimeout(() => {
      api<Hit[]>(`/search?q=${encodeURIComponent(first)}`)
        .then((h) => {
          setHits(h)
          setSel(0)
        })
        .catch(() => setHits([]))
    }, 120)
    return () => clearTimeout(id)
  }, [q])

  const go = (text: string) => {
    const route = parseCommand(text)
    if (!route) {
      setErr(`Unknown command: ${text}`)
      return
    }
    setErr(null)
    setQ('')
    setHits([])
    nav(route)
    ref.current?.blur()
  }

  return (
    <div className="relative flex-1 max-w-[620px]">
      <div className="flex items-center bg-[#1a1200] border border-amber-dim h-7">
        <span className="px-2 text-amber num font-semibold">&gt;</span>
        <input
          ref={ref}
          value={q}
          spellCheck={false}
          placeholder="Ticker or command (NVDA FA, SCREEN, MACRO, HELP). Press / to focus"
          className="flex-1 bg-transparent outline-none text-amber num uppercase placeholder:normal-case placeholder:text-amber-dim/70 text-[13px]"
          onChange={(e) => {
            setQ(e.target.value)
            setErr(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(s + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              const typed = q.trim()
              const exact = hits.find((h) => h.ticker === typed.toUpperCase())
              if (hits.length && !typed.includes(' ') && !exact && parseCommand(typed)?.startsWith('/c/')) go(hits[sel].ticker)
              else go(typed)
            } else if (e.key === 'Escape') {
              setQ('')
              setHits([])
              ref.current?.blur()
            }
          }}
        />
        <span className="px-2 text-[10px] text-amber-dim num">GO</span>
      </div>
      {err && <div className="absolute top-8 left-0 text-down text-[11px] num bg-black border border-line px-2 py-1 z-50">{err}</div>}
      {hits.length > 0 && (
        <div className="absolute top-8 left-0 right-0 bg-panel2 border border-line z-50 shadow-xl">
          {hits.map((h, i) => (
            <div
              key={h.ticker}
              onMouseDown={() => go(h.ticker)}
              onMouseEnter={() => setSel(i)}
              className={`flex gap-3 px-2 py-1 cursor-pointer ${i === sel ? 'bg-amber/15' : ''}`}
            >
              <span className="text-amber num w-16">{h.ticker}</span>
              <span className="truncate">{h.name}</span>
              <span className="ml-auto text-dim">{h.sub_industry}</span>
            </div>
          ))}
          <div className="px-2 py-1 text-[10px] text-dim border-t border-line">
            Add a function after the ticker: {COMPANY_TABS.map((t) => t.code).join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}
