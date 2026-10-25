import { useNavigate } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { ErrorBox, Loading, Panel } from '../../components/Panel'
import { useApi } from '../../lib/useApi'
import { SNAPSHOT_COLS } from '../Dashboard'
import type { TabProps } from '../Company'
import { Segments } from './Segments'

export default function Overview({ ticker }: TabProps) {
  const nav = useNavigate()
  const { data, error } = useApi<any>(`/company/${ticker}/profile`)
  const { data: peers } = useApi<any>(data ? `/company/${ticker}/peers` : null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const p = data.profile || {}
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[2fr_3fr] gap-1.5">
      <Panel title="Business description" png={false}>
        <div className="p-2 leading-relaxed text-[12px]">
          {p.longBusinessSummary ?? <span className="text-dim">No business description available from Yahoo Finance.</span>}
        </div>
        <table className="term">
          <tbody>
            {[
              ['Sector / Industry (Yahoo)', [p.sector, p.industry].filter(Boolean).join(' / ') || 'N/A'],
              ['GICS sub-industry', data.universe?.gics_sub_industry ?? 'N/A (not in S&P lists)'],
              ['Peer group tag', data.universe?.sub_industry ?? 'Outside TMT universe'],
              ['Universe source', data.universe?.source ?? 'Ad-hoc lookup'],
              ['Employees', p.fullTimeEmployees?.toLocaleString() ?? 'N/A'],
              ['Country', p.country ?? 'N/A'],
              ['Exchange', p.exchange ?? 'N/A'],
              ['Website', p.website ? <a className="text-info" href={p.website} target="_blank" rel="noreferrer">{p.website}</a> : 'N/A'],
              ['SEC CIK', data.universe?.cik ?? 'N/A'],
            ].map(([k, v]) => (
              <tr key={k as string}>
                <td className="text-dim w-48">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="flex flex-col gap-1.5 min-w-0">
        <Segments ticker={ticker} />
        <Panel title={`Peer group: ${data.universe?.sub_industry ?? 'n/a'}`} png={false}>
          {peers ? (
            <DataTable
              title={`${ticker}_peers`}
              cols={SNAPSHOT_COLS.filter((c) => !['chg_1w', 'chg_ytd', 'gross_margin', 'net_margin', 'analyst_count'].includes(c.key))}
              rows={peers.rows}
              onRow={(r) => nav(`/c/${r.ticker}`)}
              rowKey={(r) => r.ticker}
              empty="No peers found. Ticker is outside the TMT universe or its sub-industry has no other members."
            />
          ) : (
            <Loading what="Loading peers" />
          )}
          <div className="px-2 py-1 text-[10px] text-dim">
            Peers: same sub-industry tag, ranked by closest market cap. Finnhub's peer list is used to supplement when a key is set.
          </div>
        </Panel>
      </div>
    </div>
  )
}
