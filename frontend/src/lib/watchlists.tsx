import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, del, post } from './api'

type Lists = Record<string, string[]>
type Ctx = {
  lists: Lists
  active: string
  setActive: (n: string) => void
  has: (t: string, list?: string) => boolean
  toggle: (t: string, list?: string) => Promise<void>
  reload: () => void
  createList: (name: string) => void
}

const WatchCtx = createContext<Ctx | null>(null)
export const DEFAULT_LIST = 'Fund Holdings'

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState<Lists>({ [DEFAULT_LIST]: [] })
  const [active, setActive] = useState(DEFAULT_LIST)
  const reload = useCallback(() => {
    api<Lists>('/watchlists').then(setLists).catch(() => {})
  }, [])
  useEffect(reload, [reload])

  const has = (t: string, list = active) => (lists[list] || []).includes(t.toUpperCase())
  const toggle = async (t: string, list = active) => {
    const next = has(t, list)
      ? await del<Lists>(`/watchlists/${encodeURIComponent(list)}/${encodeURIComponent(t)}`)
      : await post<Lists>('/watchlists', { name: list, ticker: t })
    setLists(next)
  }
  // A list is stored server-side once it has a ticker; until then it only exists in the UI.
  const createList = (n: string) => setLists((l) => ({ ...l, [n]: l[n] ?? [] }))
  return <WatchCtx.Provider value={{ lists, active, setActive, has, toggle, reload, createList }}>{children}</WatchCtx.Provider>
}

export function useWatchlists() {
  const c = useContext(WatchCtx)
  if (!c) throw new Error('WatchlistProvider missing')
  return c
}

export function Star({ ticker }: { ticker: string }) {
  const { has, toggle, active } = useWatchlists()
  const on = has(ticker)
  return (
    <button
      className={`text-[13px] leading-none ${on ? 'text-amber' : 'text-dim hover:text-amber'}`}
      title={on ? `Remove from ${active}` : `Add to ${active}`}
      onClick={(e) => {
        e.stopPropagation()
        toggle(ticker)
      }}
    >
      {on ? '★' : '☆'}
    </button>
  )
}
