// Bloomberg-style mnemonics -> routes.

export const COMPANY_TABS = [
  { code: 'DES', label: 'Overview', aliases: ['DES', 'OV', 'OVERVIEW'] },
  { code: 'GP', label: 'Chart', aliases: ['GP', 'GIP', 'CHART', 'PX'] },
  { code: 'FA', label: 'Financials', aliases: ['FA', 'FIN', 'FINANCIALS'] },
  { code: 'RV', label: 'Valuation', aliases: ['RV', 'VAL', 'VALUATION', 'COMP', 'COMPS'] },
  { code: 'EE', label: 'Estimates', aliases: ['EE', 'EST', 'ANR', 'ESTIMATES', 'EM'] },
  { code: 'KPI', label: 'KPIs', aliases: ['KPI', 'KPIS', 'SEG'] },
  { code: 'MOVE', label: 'Why It Moved', aliases: ['MOVE', 'WHY', 'MOVES'] },
  { code: 'NEWS', label: 'News', aliases: ['NEWS', 'CN', 'N'] },
  { code: 'CF', label: 'Filings & Deals', aliases: ['CF', 'FIL', 'FILINGS', 'DEALS', 'MA'] },
  { code: 'ALT', label: 'Alt Data', aliases: ['ALT', 'ALTDATA', 'TRENDS'] },
] as const

export type TabCode = (typeof COMPANY_TABS)[number]['code']

const GLOBAL: Record<string, string> = {
  HOME: '/',
  DASH: '/',
  W: '/',
  WL: '/',
  MON: '/',
  TOP: '/#movers',
  MOV: '/#movers',
  SCREEN: '/screen',
  EQS: '/screen',
  SCR: '/screen',
  MACRO: '/macro',
  ECO: '/macro',
  ECON: '/macro',
  NEWS: '/news',
  N: '/news',
  TOPN: '/news',
  DEALS: '/deals',
  MA: '/deals',
  SET: '/settings',
  SETTINGS: '/settings',
  STATUS: '/settings',
  HELP: '/help',
  '?': '/help',
}

export function parseCommand(raw: string): string | null {
  const parts = raw.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  // Strip a trailing "<GO>"/"EQUITY"/"US" like real Bloomberg typing habits
  const clean = parts.filter((p) => !['<GO>', 'GO', 'EQUITY', 'US', 'EQ'].includes(p))
  if (clean.length === 0) return null
  if (clean.length === 1 && GLOBAL[clean[0]]) return GLOBAL[clean[0]]
  const [ticker, fn] = clean
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(ticker)) return null
  const t = ticker.replace('.', '-')
  if (!fn) return `/c/${t}`
  const tab = COMPANY_TABS.find((x) => (x.aliases as readonly string[]).includes(fn))
  return tab ? `/c/${t}/${tab.code}` : `/c/${t}`
}

export const HELP_ROWS: [string, string][] = [
  ['NVDA', 'Company overview'],
  ['NVDA FA', 'Financial statements (annual/quarterly)'],
  ['NVDA RV', 'Valuation history & comps (also VAL, COMP)'],
  ['NVDA EE', 'Estimates & consensus (also EST, ANR)'],
  ['NVDA GP', 'Price chart (also CHART)'],
  ['NVDA KPI', 'Segments & operating KPIs from XBRL'],
  ['NVDA MOVE', 'Why did it move? (also WHY)'],
  ['NVDA NEWS', 'Company news'],
  ['NVDA CF', 'Filings & deals (also FIL, MA)'],
  ['NVDA ALT', 'Alternative data proxies'],
  ['SCREEN', 'Screener (also EQS)'],
  ['MACRO', 'Macro dashboard (also ECO)'],
  ['NEWS', 'Sector / watchlist news feed'],
  ['DEALS', 'Sector-wide M&A / deals feed'],
  ['TOP', 'Top movers'],
  ['SET', 'Settings, data status, AI usage'],
]
