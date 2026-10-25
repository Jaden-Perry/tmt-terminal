import { useState } from 'react'
import { DataTable, type Col } from '../../components/DataTable'
import { NewsList } from '../../components/NewsList'
import { ErrorBox, Loading, Panel, Seg } from '../../components/Panel'
import { ago } from '../../lib/fmt'
import { useApi } from '../../lib/useApi'
import type { TabProps } from '../Company'

export default function Filings({ ticker }: TabProps) {
  const { data, error } = useApi<any>(`/company/${ticker}/filings`)
  const { data: nws } = useApi<any>(`/company/${ticker}/news?days=365`)
  const [form, setForm] = useState<'ALL' | 'KQ' | '8-K' | 'M&A'>('ALL')
  const rows = (data?.filings ?? []).filter((f: any) =>
    form === 'ALL' ? true : form === 'KQ' ? /^10-[KQ]/.test(f.form) : form === '8-K' ? f.form.startsWith('8-K') : f.is_ma,
  )
  const cols: Col<any>[] = [
    { key: 'filed', label: 'Filed', kind: 'date' },
    { key: 'form', label: 'Form', kind: 'text', render: (r) => <span className="text-amber num">{r.form}</span> },
    {
      key: 'is_ma',
      label: 'M&A',
      kind: 'text',
      get: (r) => (r.is_ma ? 1 : 0),
      render: (r) => (r.is_ma ? <span className="text-[9.5px] uppercase border border-amber text-amber px-1" title={r.ma_reason}>M&amp;A</span> : null),
    },
    {
      key: 'items',
      label: 'Items / description',
      kind: 'text',
      get: (r) => r.item_labels.join('; ') || r.description,
      render: (r) => (
        <span className="whitespace-normal">
          {r.items.length
            ? r.items.map((it: string, i: number) => (
                <span key={it} className={['1.01', '2.01'].includes(it) ? 'text-amber' : ''}>
                  {i > 0 && '; '}
                  {it} {r.item_labels[i]}
                </span>
              ))
            : r.description || '—'}
        </span>
      ),
    },
    { key: 'report_date', label: 'Period', kind: 'date' },
    {
      key: 'url',
      label: 'Links',
      kind: 'text',
      render: (r) => (
        <span className="flex gap-2">
          <a className="text-info hover:underline" href={r.url} target="_blank" rel="noreferrer">doc</a>
          <a className="text-info hover:underline" href={r.index_url} target="_blank" rel="noreferrer">index</a>
        </span>
      ),
    },
  ]
  const deals = (nws?.items ?? []).filter((n: any) => n.is_deal)
  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[3fr_2fr] gap-1.5">
      <Panel
        title={`${ticker} SEC filings`}
        png={false}
        right={<Seg value={form} options={[{ value: 'ALL', label: 'ALL' }, { value: 'KQ', label: '10-K/Q' }, { value: '8-K', label: '8-K' }, { value: 'M&A', label: 'M&A' }] as any} onChange={setForm as any} />}
        note={
          <>
            M&amp;A flags: 8-K Item 1.01 (material definitive agreement) or 2.01 (completed acquisition/disposition), plus merger, tender and activist forms (S-4, 425, DEFM14A, SC TO-T,
            SC 13D). Source: SEC EDGAR submissions, fetched {ago(data?.fetched_at)} (on demand, cached 6h).
          </>
        }
      >
        {error ? <ErrorBox error={error} /> : !data ? <Loading what="Loading EDGAR filing index" /> : <DataTable title={`${ticker}_filings`} cols={cols} rows={rows} maxHeight="70vh" empty={data.note ?? 'No filings of this type.'} />}
      </Panel>
      <Panel title={`${ticker} deal-related news (12 months)`} png={false} note="Keyword-flagged headlines (acquire, merger, takeover, divest, in talks…). Includes rumors, so verify against filings.">
        {!nws ? <Loading /> : <NewsList items={deals} title={`${ticker}_deal_news`} showTicker={false} />}
      </Panel>
    </div>
  )
}
