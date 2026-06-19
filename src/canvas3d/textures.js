// Builds MediaItems for the 3D canvas: photos use their stored blobs,
// notes and quotes are painted onto offscreen canvases so *everything* is a card.
import { COLORS, thumbURL } from '../store.js'
import { cardDateLabel } from '../time.js'
import { inferType, firstImageId } from '../media.js'

const wrapText = (ctx, text, maxWidth) => {
  const words = (text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function paintNote(m) {
  const color = COLORS[m.color] || COLORS.blue
  const W = 560
  const H = 420
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  roundRect(ctx, 0, 0, W, H, 38)
  ctx.fillStyle = color.bg
  ctx.fill()

  ctx.fillStyle = color.text
  ctx.font = '600 40px system-ui, -apple-system, sans-serif'
  const lines = wrapText(ctx, m.title || 'Untitled', W - 96).slice(0, 3)
  lines.forEach((l, i) => ctx.fillText(l, 48, 96 + i * 52))

  ctx.globalAlpha = 0.65
  ctx.font = '600 22px system-ui, -apple-system, sans-serif'
  ctx.fillText(cardDateLabel(m.date).toUpperCase(), 48, 110 + lines.length * 52)
  ctx.globalAlpha = 1

  if (m.body) {
    ctx.fillStyle = '#4A5160'
    ctx.font = '400 26px system-ui, -apple-system, sans-serif'
    wrapText(ctx, m.body, W - 96)
      .slice(0, 4)
      .forEach((l, i) => ctx.fillText(l, 48, 160 + lines.length * 52 + i * 36))
  }

  return { url: c.toDataURL('image/png'), width: W, height: H }
}

// quotes paint as the pinned handwritten note: colour strips behind each line
function paintQuote(m) {
  const color = COLORS[m.color] || COLORS.blue
  const W = 720
  const H = 460
  const lineH = 66
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  ctx.font = '500 46px Caveat, cursive'
  ctx.textAlign = 'center'
  const lines = wrapText(ctx, m.title || '…', W - 160).slice(0, 5)
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2
  const jitterFor = (i) => ((i * 37) % 21) - 10 // ragged strip edges
  const stripFor = (l, i) => {
    const w = ctx.measureText(l).width
    const j = jitterFor(i)
    return { x: W / 2 - w / 2 - 18 + j, y: startY + i * lineH - 38, w: w + 36, h: 54, j }
  }

  lines.forEach((l, i) => {
    const s = stripFor(l, i)
    ctx.fillStyle = color.bg
    ctx.fillRect(s.x, s.y, s.w, s.h)
    ctx.fillStyle = color.text
    ctx.fillText(l, W / 2 + s.j, startY + i * lineH)
  })

  return { url: c.toDataURL('image/png'), width: W, height: H }
}

// ONE image load per photo: read the natural dimensions and draw the rounded-
// rect clipped copy (rounded corners like the painted cards) from the same
// decode, capped at 1024px so the texture stays sane
const roundedPhoto = (url) =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || 4
      const h = img.naturalHeight || 3
      const scale = Math.min(1, 1024 / Math.max(w, h))
      const cw = Math.max(1, Math.round(w * scale))
      const ch = Math.max(1, Math.round(h * scale))
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      const ctx = c.getContext('2d')
      roundRect(ctx, 0, 0, cw, ch, Math.round(Math.min(cw, ch) * 0.07))
      ctx.clip()
      ctx.drawImage(img, 0, 0, cw, ch)
      resolve({ url: c.toDataURL('image/png'), width: w, height: h })
    }
    img.onerror = () => resolve({ url, width: 4, height: 3 })
    img.src = url
  })

async function photoItem(m) {
  // build the orbit texture from the THUMBNAIL, never the full-res original
  const url = await thumbURL(firstImageId(m))
  if (!url) return null
  return roundedPhoto(url)
}

// Per-memory built-item cache (url + dims, painted/decoded ONCE). Without it,
// every memories change — including deleting ONE card — re-ran buildMediaItems
// and re-decoded EVERY photo's full-resolution bitmap (`new Image()` in
// roundedPhoto). A few rapid deletes of real (multi-MB) photos overlapped those
// full-res decodes and OOM-crashed the renderer ("Aw Snap"). Keyed by content,
// so only NEW/edited memories build; deleted ones are evicted.
const itemCache = new Map() // contentKey -> { url, width, height }
// the per-memory content key (everything the orbit texture depends on — NOT
// pos). Exported so YearOrbit's rebuild-trigger key uses the SAME definition,
// instead of a copy-pasted template that could silently drift from this one.
export const memKey = (m) =>
  `${m.id}:${m.date}:${m.title}:${m.body}:${m.color}:${(m.media || []).map((x) => x.id).join(',')}`

export async function buildMediaItems(memories) {
  await document.fonts.ready // Newsreader must be loaded before painting quotes
  const list = memories.filter((m) => !m.draft)
  const results = new Array(list.length) // indexed: result order is stable
  const liveKeys = new Set()
  let next = 0
  // a few items in flight at once — IDB reads + image decodes overlap instead
  // of running strictly one-by-one (boot is several times faster on photos)
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      const m = list[i]
      const key = memKey(m)
      liveKeys.add(key)
      // one corrupt blob must never hang the whole boot — skip the item instead
      try {
        let item = itemCache.get(key) // reuse — no re-decode/repaint
        if (!item) {
          const type = inferType(m)
          if (type === 'photo') item = await photoItem(m)
          else if (type === 'quote') item = paintQuote(m)
          else item = paintNote(m) // notes, video, audio → painted card
          if (item) itemCache.set(key, item)
        }
        if (item) results[i] = { ...item, memory: m }
      } catch { /* skip unreadable memory */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker))
  // evict entries for memories that no longer exist (deleted / edited) so the
  // cache stays bounded by the LIVE set
  for (const k of itemCache.keys()) if (!liveKeys.has(k)) itemCache.delete(k)
  return results.filter(Boolean)
}
