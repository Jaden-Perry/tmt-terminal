import { toPng } from 'html-to-image'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const safe = (s: string) => s.replace(/[^\w-]+/g, '_').slice(0, 80)

export function exportCsv(title: string, columns: string[], rows: unknown[][]) {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = [columns, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  download(new Blob([body], { type: 'text/csv' }), `${safe(title)}.csv`)
}

export async function exportXlsx(title: string, columns: string[], rows: unknown[][]) {
  const r = await fetch('/api/export/xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, columns, rows }),
  })
  if (!r.ok) throw new Error('Excel export failed')
  download(await r.blob(), `${safe(title)}.xlsx`)
}

export async function exportPng(node: HTMLElement, title: string) {
  const dataUrl = await toPng(node, { backgroundColor: '#000000', pixelRatio: 2, cacheBust: true })
  const blob = await (await fetch(dataUrl)).blob()
  download(blob, `${safe(title)}.png`)
}
