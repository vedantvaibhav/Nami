export const ZOOMS = [
  { id: 'days', label: 'Days' },
  { id: 'months', label: 'Months' },
  { id: 'years', label: 'Years' },
]

export const startOfDay = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}


export const toISO = (d) => {
  const x = startOfDay(d)
  const mm = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${mm}-${dd}`
}

export const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// The start of the column (day/month/year) a date belongs to at this zoom
export const unitStart = (iso, zoomId) => {
  const d = fromISO(iso)
  if (zoomId === 'months') return toISO(new Date(d.getFullYear(), d.getMonth(), 1))
  if (zoomId === 'years') return toISO(new Date(d.getFullYear(), 0, 1))
  return iso
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

export const cardDateLabel = (iso) => {
  const d = fromISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()].toUpperCase()}`
}

export const markerLabel = (d, zoomId) =>
  zoomId === 'months' ? MONTHS[d.getMonth()] : `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
