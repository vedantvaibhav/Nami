// Media helpers: type inference, deterministic tilts, video thumbnails, time formatting
// Broad categories so iOS Safari's photo picker shows selectable photos. Narrow
// per-subtype lists (image/jpeg,image/heic,…) make iOS grey out the library or
// route to Files instead of Photos. attach() still filters via kindFromMime().
export const ACCEPT = 'image/*,video/*,audio/*'

export const MAX_SAFE_BYTES = 200 * 1024 * 1024 // warn above 200MB

export const kindFromMime = (type) => {
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('image/')) return 'image'
  return null
}

// Card type is inferred from attached media — never explicitly chosen
export const inferType = (m) => {
  if (m.type === 'quote') return 'quote'
  const media = m.media || []
  if (media.some((x) => x.kind === 'video')) return 'video'
  if (media.some((x) => x.kind === 'image')) return 'photo'
  if (media.some((x) => x.kind === 'audio')) return 'audio'
  return 'note'
}

export const firstImageId = (m) =>
  m.media?.find((x) => x.kind === 'image')?.id || m.imgId || null

// Deterministic tilt from card/media id — stable across reloads
export const seededTilt = (id, i = 0, range = 4) => {
  const s = `${id}:${i}`
  let h = 0
  for (let k = 0; k < s.length; k++) h = ((h << 5) - h + s.charCodeAt(k)) | 0
  return +((((Math.abs(h) % 1000) / 1000) * 2 - 1) * range).toFixed(2)
}

// Deterministic 0..1 fraction from any string — for stable "random" layout
export const seedFrac = (s) => {
  let h = 0
  for (let k = 0; k < s.length; k++) h = ((h << 5) - h + s.charCodeAt(k)) | 0
  return (Math.abs(h) % 1000) / 1000
}

// Deterministic waveform bars from id — visual chrome, not real data
export const seededBars = (id, count = 28) => {
  const bars = []
  for (let i = 0; i < count; i++) {
    const s = `${id}:${i}`
    let h = 0
    for (let k = 0; k < s.length; k++) h = ((h << 5) - h + s.charCodeAt(k)) | 0
    bars.push(0.25 + (Math.abs(h) % 1000) / 1000 * 0.75)
  }
  return bars
}

export const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Inline SVG icons (Tabler outlines) — avoids an icon dependency
export const icons = {
  upload: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2 M7 9l5 -5l5 5 M12 4v12',
  play: 'M7 4v16l13 -8z',
  pause: 'M6 5h4v14h-4z M14 5h4v14h-4z',
  plus: 'M12 5v14 M5 12h14',
  close: 'M18 6l-12 12 M6 6l12 12',
  edit: 'M4 20h4l10.5 -10.5a2.1 2.1 0 0 0 -3 -3l-10.5 10.5v3z M13.5 6.5l3 3',
  calendar: 'M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z M16 3v4 M8 3v4 M4 11h16',
  chevronL: 'M15 6l-6 6l6 6',
  chevronR: 'M9 6l6 6l-6 6',
  volume: 'M6 9v6h3l4 4V5l-4 4z M16 9a3 3 0 0 1 0 6 M19 7a7 7 0 0 1 0 10',
  mute: 'M6 9v6h3l4 4V5l-4 4z M16 10l4 4 M20 10l-4 4',
}
