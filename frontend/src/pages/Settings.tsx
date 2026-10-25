import { DataTable } from '../components/DataTable'
import { Loading, Panel } from '../components/Panel'
import { post } from '../lib/api'
import { ago } from '../lib/fmt'
import { useApi } from '../lib/useApi'

const KEYS: [string, string, string][] = [
  ['sec_user_agent', 'SEC_USER_AGENT', 'Required for SEC EDGAR (financials, filings, segments). Your name + email.'],
  ['finnhub', 'FINNHUB_API_KEY', 'Free at finnhub.io. Adds company news history (~1Y), recommendation trends, M&A news category.'],
  ['fred', 'FRED_API_KEY', 'Free at fred.stlouisfed.org. Powers the MACRO page.'],
  ['fmp', 'FMP_API_KEY', 'Free at financialmodelingprep.com (250 calls/day). Fallback for price targets and long-range estimates.'],
  ['anthropic', 'ANTHROPIC_API_KEY', 'Optional, pay-as-you-go. Enables "Explain" AI summaries under a hard monthly cap.'],
]

export default function Settings() {
  const { data: st, reload } = useApi<any>('/status', { pollMs: 5000 })
  const { data: ai } = useApi<any>('/ai/usage', { pollMs: 30000 })
  const run = async (job: string) => {
    const r = await post(`/refresh/${job}`)
    if (!r.started) alert(r.message)
    reload()
  }
  if (!st) return <Loading />
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5 max-w-[1400px]">
      <Panel title="API keys (.env)" png={false}>
        <table className="term">
          <tbody>
            {KEYS.map(([k, env, what]) => (
              <tr key={k}>
                <td className={st.keys[k] ? 'text-up' : 'text-down'}>{st.keys[k] ? '● set' : '○ missing'}</td>
                <td className="num text-amber">{env}</td>
                <td className="text-dim whitespace-normal">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-2 text-[10.5px] text-dim">Edit the .env file in the project root, then restart the backend. Keys never leave your machine except to their own provider.</div>
      </Panel>
      <Panel title="AI usage (Claude Haiku)" png={false}>
        {!ai ? (
          <Loading />
        ) : (
          <div className="p-2 text-[12px] num">
            <div className="flex items-end gap-2">
              <span className="text-[22px] text-amber">${ai.spent_usd.toFixed(4)}</span>
              <span className="text-dim">of ${ai.cap_usd.toFixed(2)} cap this month ({ai.month})</span>
            </div>
            <div className="h-1.5 bg-line my-1">
              <div className="h-1.5 bg-amber" style={{ width: `${Math.min(100, (100 * ai.spent_usd) / (ai.cap_usd || 1))}%` }} />
            </div>
            <div className="text-dim text-[11px] leading-relaxed">
              {ai.calls} calls this month · {ai.input_tokens.toLocaleString()} in / {ai.output_tokens.toLocaleString()} out tokens · {ai.cached_explanations} cached explanations
              (never regenerated) · all-time ${ai.all_time_usd.toFixed(4)} over {ai.all_time_calls} calls
              <br />
              Model {ai.model} at ${ai.price_per_mtok[0]}/${ai.price_per_mtok[1]} per million input/output tokens. Status: {ai.enabled ? <span className="text-up">enabled</span> : <span className="text-down">disabled (no key)</span>}. Change the cap with
              AI_MONTHLY_CAP_USD in .env.
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Data coverage & refresh" png={false}>
        <table className="term">
          <tbody>
            <tr><td className="text-dim">TMT universe</td><td className="num">{st.universe_count} companies (rebuilt monthly)</td></tr>
            <tr><td className="text-dim">With daily prices</td><td className="num">{st.tickers_with_prices}</td></tr>
            <tr><td className="text-dim">With fundamentals snapshot</td><td className="num">{st.tickers_with_snapshots}</td></tr>
            <tr><td className="text-dim">Last price refresh</td><td className="num">{ago(st.last_price_refresh)}</td></tr>
            <tr><td className="text-dim">API calls today</td><td className="num">{Object.entries(st.api_calls_today).map(([k, v]) => `${k} ${v}`).join(' · ')} (FMP budget {st.fmp_daily_budget}/day)</td></tr>
            <tr><td className="text-dim">Running now</td><td className="num text-info">{st.refresh.running ? `${st.refresh.job} ${st.refresh.progress ?? ''}` : 'idle'}</td></tr>
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 p-2">
          {[
            ['daily', 'Daily price top-up'],
            ['nightly', 'Run nightly crawl now'],
            ['universe', 'Rebuild universe'],
            ['recompute', 'Recompute scores (offline)'],
          ].map(([j, l]) => (
            <button key={j} disabled={st.refresh.running} onClick={() => run(j)} className="px-2 py-0.5 border border-amber text-amber text-[11px] hover:bg-amber/10 disabled:opacity-40">
              {l}
            </button>
          ))}
        </div>
        <div className="px-2 pb-2 text-[10.5px] text-dim">
          Refresh cadence: prices daily · fundamentals, estimates and SEC financials weekly · filings and news on demand (cached 6h) · universe monthly. The nightly crawl walks
          the whole universe within free-tier rate limits and resumes where it left off.
        </div>
      </Panel>
      <Panel title="Recent jobs" png={false}>
        <DataTable
          title="jobs"
          exportable={false}
          cols={[
            { key: 'job', label: 'Job', kind: 'text' },
            { key: 'started', label: 'Started', kind: 'text', render: (r: any) => <span className="num">{new Date(r.started * 1000).toLocaleString()}</span> },
            { key: 'status', label: 'Status', kind: 'text', render: (r: any) => <span className={r.status === 'ok' ? 'text-up' : r.status === 'error' ? 'text-down' : 'text-info'}>{r.status}</span> },
            { key: 'detail', label: 'Detail', kind: 'text', render: (r: any) => <span className="text-dim truncate inline-block max-w-[380px] align-bottom" title={r.detail}>{r.detail}</span> },
          ]}
          rows={st.jobs}
        />
      </Panel>
    </div>
  )
}
