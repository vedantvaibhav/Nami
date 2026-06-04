// Builds MediaItems for the 3D canvas: photos use their stored blobs,
// notes and quotes are painted onto offscreen canvases so *everything* is a card.
import { COLORS, imageURL } from '../store.js'
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

function paintQuote(m) {
  const W = 720
  const H = 420
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  ctx.fillStyle = '#232936'
  ctx.font = 'italic 500 52px Newsreader, Georgia, serif'
  ctx.textAlign = 'center'
  const lines = wrapText(ctx, m.title || '…', W - 80).slice(0, 5)
  const startY = H / 2 - ((lines.length - 1) * 64) / 2
  lines.forEach((l, i) => ctx.fillText(l, W / 2, startY + i * 64))

  return { url: c.toDataURL('image/png'), width: W, height: H }
}

const imgDimensions = (url) =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 4, height: img.naturalHeight || 3 })
    img.onerror = () => resolve({ width: 4, height: 3 })
    img.src = url
  })

async function photoItem(m) {
  const url = await imageURL(firstImageId(m))
  if (!url) return null
  const dims = await imgDimensions(url)
  return { url, ...dims }
}

export async function buildMediaItems(memories) {
  await document.fonts.ready // Newsreader must be loaded before painting quotes
  const items = []
  for (const m of memories) {
    if (m.draft) continue
    const type = inferType(m)
    let item = null
    if (type === 'photo') item = await photoItem(m)
    else if (type === 'quote') item = paintQuote(m)
    else item = paintNote(m) // notes, video, audio → painted card
    if (item) items.push({ ...item, memory: m })
  }
  return items
}
