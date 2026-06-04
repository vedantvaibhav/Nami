// Media helpers: type inference, deterministic tilts, video thumbnails, time formatting
export const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/heic,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg'

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

// First-frame thumbnail for video blobs (hidden <video> -> canvas)
const thumbCache = new Map()
export const videoThumb = (mediaId, url) => {
  if (thumbCache.has(mediaId)) return thumbCache.get(mediaId)
  const p = new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    const fail = () => resolve(null)
    v.addEventListener('loadeddata', () => { v.currentTime = 0.01 }, { once: true })
    v.addEventListener('seeked', () => {
      try {
        const c = document.createElement('canvas')
        c.width = v.videoWidth || 640
        c.height = v.videoHeight || 360
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', 0.82))
      } catch { fail() }
    }, { once: true })
    v.addEventListener('error', fail, { once: true })
  })
  thumbCache.set(mediaId, p)
  return p
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
  calendar: 'M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z M16 3v4 M8 3v4 M4 11h16',
  chevronL: 'M15 6l-6 6l6 6',
  chevronR: 'M9 6l6 6l-6 6',
  volume: 'M6 9v6h3l4 4V5l-4 4z M16 9a3 3 0 0 1 0 6 M19 7a7 7 0 0 1 0 10',
  mute: 'M6 9v6h3l4 4V5l-4 4z M16 10l4 4 M20 10l-4 4',
}
