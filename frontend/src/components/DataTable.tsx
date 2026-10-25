import { useMemo, useState, type ReactNode } from 'react'
import { fmtValue, Val, type Kind } from '../lib/fmt'
import { exportCsv, exportXlsx } from '../lib/export'

export type Col<R> = {
  key: string
  label: string
  kind?: Kind
  digits?: number
  color?: boolean
  align?: 'left' | 'right'
  get?: (r: R) => unknown
  render?: (r: R) => ReactNode
  na?: (r: R) => string | undefined | null
  title?: string
  width?: number
}

type Props<R> = {
  title: string
  cols: Col<R>[]
  rows: R[]
  onRow?: (r: R) => void
  initialSort?: { key: string; dir: 1 | -1 }
  rowKey?: (r: R, i: number) => string
  exportable?: boolean
  maxHeight?: string
  dense?: boolean
  empty?: ReactNode
}

function rowNa(r: any, key: string): string | undefined {
  return r?.na?.[key] ?? r?.na?._all
}

export function DataTable<R>({ title, cols, rows, onRow, initialSort, rowKey, exportable = true, maxHeight, empty }: Props<R>) {
  const [sort, setSort] = useState(initialSort ?? null)
  const val = (c: Col<R>, r: R) => (c.get ? c.get(r) : (r as any)[c.key])

  const sorted = useMemo(() => {
    if (!sort) return rows
    const c = cols.find((x) => x.key === sort.key)
    if (!c) return rows
    return [...rows].sort((a, b) => {
      const va = val(c, a)
      const vb = val(c, b)
      const na = va === null || va === undefined
      const nb = vb === null || vb === undefined
      if (na && nb) return 0
      if (na) return 1 // missing values always sink to the bottom
      if (nb) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir
      return String(va).localeCompare(String(vb)) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, cols])

  const matrix = () =>
    sorted.map((r) =>
      cols.map((c) => {
        const v = val(c, r)
        if (typeof v === 'number') return v
        return v === null || v === undefined ? '' : fmtValue(v, c.kind === 'date' ? 'date' : 'text') ?? ''
      }),
    )

  return (
    <div className="flex flex-col min-h-0 h-full">
      {exportable && (
        <div className="flex justify-end gap-2 px-2 py-0.5 text-[10px] uppercase text-dim">
          <span className="mr-auto num">{rows.length} rows</span>
          <button className="hover:text-amber" onClick={() => exportCsv(title, cols.map((c) => c.label), matrix())}>
            CSV
          </button>
          <button className="hover:text-amber" onClick={() => exportXlsx(title, cols.map((c) => c.label), matrix())}>
            XLSX
          </button>
        </div>
      )}
      <div className="overflow-auto min-h-0" style={{ maxHeight }}>
        {rows.length === 0 ? (
          <div className="p-3 text-dim">{empty ?? 'No rows.'}</div>
        ) : (
          <table className="term">
            <thead>
              <tr>
                {cols.map((c) => {
                  const right = c.align ? c.align === 'right' : c.kind !== 'text' && c.kind !== 'date' && c.kind !== undefined
                  return (
                    <th
                      key={c.key}
                      title={c.title ?? 'Click to sort'}
                      style={{ textAlign: right ? 'right' : 'left', width: c.width }}
                      onClick={() =>
                        setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: right ? -1 : 1 }))
                      }
                    >
                      {c.label}
                      {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={rowKey ? rowKey(r, i) : i} className={onRow ? 'clickable' : ''} onClick={onRow ? () => onRow(r) : undefined}>
                  {cols.map((c) => {
                    const right = c.align ? c.align === 'right' : c.kind !== 'text' && c.kind !== 'date' && c.kind !== undefined
                    return (
                      <td key={c.key} style={{ textAlign: right ? 'right' : 'left' }}>
                        {c.render ? (
                          c.render(r)
                        ) : (
                          <Val v={val(c, r)} kind={c.kind ?? 'text'} digits={c.digits} color={c.color} na={c.na ? c.na(r) : rowNa(r, c.key)} />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
