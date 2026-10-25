import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { CommandBar } from './CommandBar'
import { useApi } from '../lib/useApi'
import { ago } from '../lib/fmt'

const NAV = [
  ['/', 'DASH'],
  ['/screen', 'SCREEN'],
  ['/macro', 'MACRO'],
  ['/news', 'NEWS'],
  ['/deals', 'DEALS'],
  ['/settings', 'SET'],
  ['/help', 'HELP'],
] as const

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const et = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })
  return <span className="num text-dim">{et} ET</span>
}

export function Layout() {
  const { data: st } = useApi<any>('/status', { pollMs: 15000 })
  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-2 h-10 border-b border-amber-dim/60 bg-black shrink-0">
        <span className="num font-semibold text-amber tracking-widest text-[13px]">TMT◆TERM</span>
        <CommandBar />
        <nav className="flex gap-px">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `px-2 py-1 num text-[11px] ${isActive ? 'tab-active' : 'text-amber hover:bg-amber/10'}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[10px]">
          {st?.refresh?.running && (
            <span className="text-info num animate-pulse" title="Background refresh in progress">
              ⟳ {st.refresh.job} {st.refresh.progress ?? ''}
            </span>
          )}
          {st && (
            <span className="text-dim num" title="Prices are end-of-day from Yahoo Finance (not real-time)">
              PX {ago(st.last_price_refresh)} · EOD
            </span>
          )}
          <Clock />
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-auto p-1.5">
        <Outlet />
      </main>
    </div>
  )
}
