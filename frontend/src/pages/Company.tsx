import { lazy, Suspense, type ComponentType } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { ErrorBox, Loading } from '../components/Panel'
import { COMPANY_TABS, type TabCode } from '../lib/commands'
import { ago, RATING_LABEL, Val } from '../lib/fmt'
import { useApi } from '../lib/useApi'
import { Star } from '../lib/watchlists'

export type TabProps = { ticker: string; snap: any }

const TABS: Partial<Record<TabCode, ComponentType<TabProps>>> = {
  DES: lazy(() => import('./company/Overview')),
  GP: lazy(() => import('./company/Chart')),
  FA: lazy(() => import('./company/Financials')),
  RV: lazy(() => import('./company/Valuation')),
  EE: lazy(() => import('./company/Estimates')),
  MOVE: lazy(() => import('./company/Moves')),
  NEWS: lazy(() => import('./company/News')),
  CF: lazy(() => import('./company/Filings')),
  KPI: lazy(() => import('./company/KPIs')),
  ALT: lazy(() => import('./company/AltData')),
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col px-2 border-l border-line">
      <span className="text-[9.5px] text-dim uppercase">{label}</span>
      <span className="text-[12px]">{children}</span>
    </div>
  )
}

export default function Company() {
  const { ticker: raw = '', tab = 'DES' } = useParams()
  const ticker = raw.toUpperCase()
  const { data: snap, error, loading } = useApi<any>(`/company/${ticker}/snapshot`)
  const Tab = TABS[tab as TabCode]

  return (
    <div className="flex flex-col gap-1.5">
      <div className="bg-panel border border-line flex flex-wrap items-center gap-y-1 py-1">
        <div className="flex items-center gap-2 px-2">
          <Star ticker={ticker} />
          <span className="text-amber num text-[18px] font-semibold">{ticker}</span>
          <div className="flex flex-col">
            <span className="text-[12px] max-w-[260px] truncate">{snap?.name ?? (loading ? '…' : 'Unknown')}</span>
            <span className="text-[10px] text-dim">
              {snap?.sub_industry ?? 'Outside TMT universe'}
              {snap?.gics_sub_industry && snap.gics_sub_industry !== snap.sub_industry ? ` · ${snap.gics_sub_industry}` : ''}
            </span>
          </div>
        </div>
        {snap && (
          <>
            <Stat label={`Last ${snap.price_date ?? ''}`}>
              <Val v={snap.price} kind="money" na={snap.na?.price} /> <Val v={snap.chg_1d} kind="pct" color />
            </Stat>
            <Stat label="Mkt Cap">
              <Val v={snap.market_cap} kind="cap" na={snap.na?.market_cap} />
            </Stat>
            <Stat label="P/E TTM / Fwd">
              <Val v={snap.trailing_pe} kind="x" na={snap.na?.trailing_pe} /> / <Val v={snap.forward_pe} kind="x" na={snap.na?.forward_pe} />
            </Stat>
            <Stat label="EV/EBITDA">
              <Val v={snap.ev_ebitda} kind="x" na={snap.na?.ev_ebitda} />
            </Stat>
            <Stat label="EV/Sales">
              <Val v={snap.ev_sales} kind="x" na={snap.na?.ev_sales} />
            </Stat>
            <Stat label="FCF Yld">
              <Val v={snap.fcf_yield} kind="pctPlain" na={snap.na?.fcf_yield} />
            </Stat>
            <Stat label="52W Hi / Off">
              <Val v={snap.high_52w} kind="money" /> <Val v={snap.off_52w_high} kind="pct" color />
            </Stat>
            <Stat label="Rating · PT · Upside">
              <span className="num">
                {snap.rating ? RATING_LABEL[snap.rating] ?? snap.rating : <Val v={null} na={snap.na?.rating} />} · <Val v={snap.target_mean} kind="money" na={snap.na?.target_mean} /> ·{' '}
                <Val v={snap.upside} kind="pct" color na={snap.na?.upside} />
              </span>
            </Stat>
            <span className="ml-auto px-2 text-[10px] text-dim" title="Fundamentals refresh weekly; price-based ratios use the latest stored close">
              Fundamentals {ago(snap.fundamentals_as_of)}
              {snap.fundamentals_stale ? ' (stale: refresh failed)' : ''}
            </span>
          </>
        )}
      </div>
      {error && <ErrorBox error={error} />}
      <nav className="flex flex-wrap gap-px">
        {COMPANY_TABS.map((t) => (
          <NavLink
            key={t.code}
            to={`/c/${ticker}/${t.code}`}
            className={() => `px-2 py-0.5 num text-[11px] border border-line ${tab === t.code ? 'tab-active' : 'text-amber hover:bg-amber/10'}`}
          >
            <span className="opacity-70">{t.code}</span> {t.label}
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<Loading />}>
        {Tab ? <Tab ticker={ticker} snap={snap} /> : <div className="p-3 text-dim">Unknown function. Try DES, GP, FA, RV, EE, KPI, MOVE, NEWS, CF, ALT.</div>}
      </Suspense>
    </div>
  )
}
