export const DAY = 86400000

export const ZOOMS = [
  { id: 'days', label: 'Days', pxPerDay: 280 },
  { id: 'months', label: 'Months', pxPerDay: 13 },
  { id: 'years', label: 'Years', pxPerDay: 2.6 },
]

// The start of the column (day/month/year) a date belongs to at this zoom
export const unitStart = (iso, zoomId) => {
  const d = fromISO(iso)
  if (zoomId === 'months') return toISO(new Date(d.getFullYear(), d.getMonth(), 1))
  if (zoomId === 'years') return toISO(new Date(d.getFullYear(), 0, 1))
  return iso
}

// Where the canvas ends at this zoom: today's full day/month/year column
export const renderEnd = (zoomId) => {
  const t = startOfDay(new Date())
  if (zoomId === 'months') return new Date(t.getFullYear(), t.getMonth() + 1, 1)
  if (zoomId === 'years') return new Date(t.getFullYear() + 1, 0, 1)
  return addDays(t, 1)
}

// How many days the column spans at this zoom
export const colUnitDays = (iso, zoomId) => {
  const d = fromISO(iso)
  if (zoomId === 'months') return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  if (zoomId === 'years') return (new Date(d.getFullYear() + 1, 0, 1) - new Date(d.getFullYear(), 0, 1)) / DAY
  return 1
}

export const startOfDay = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export const addDays = (d, n) => new Date(d.getTime() + n * DAY)

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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

export const cardDateLabel = (iso) => {
  const d = fromISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()].toUpperCase()}`
}

export const markerLabel = (d, zoomId) =>
  zoomId === 'months' ? MONTHS[d.getMonth()] : `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`

// The visible range of the timeline — starts at Jan 1 of the earliest year
// and ends at today. The future doesn't exist yet.
export function getRange(memories) {
  const today = startOfDay(new Date())
  let min = today
  for (const m of memories) {
    const d = fromISO(m.date)
    if (d < min) min = d
  }
  return {
    start: new Date(min.getFullYear(), 0, 1),
    end: addDays(today, 1), // exclusive right edge: today is the last column
  }
}

export const xForDate = (iso, start, pxPerDay) =>
  Math.round(((fromISO(iso) - start) / DAY) * pxPerDay)

export const dateAtX = (x, start, pxPerDay) =>
  toISO(addDays(start, Math.floor(x / pxPerDay)))

// Column boundaries for the current zoom: one entry per day/month/year start
export function getMarkers(start, end, zoomId) {
  const out = []
  let d = startOfDay(start)
  if (zoomId === 'days') {
    for (; d < end; d = addDays(d, 1)) out.push(d)
  } else if (zoomId === 'months') {
    d = new Date(d.getFullYear(), d.getMonth(), 1)
    for (; d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(d)
  } else {
    d = new Date(d.getFullYear(), 0, 1)
    for (; d < end; d = new Date(d.getFullYear() + 1, 0, 1)) out.push(d)
  }
  return out
}
