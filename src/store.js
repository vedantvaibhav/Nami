import { get, set, del } from 'idb-keyval'

const LIST_KEY = 'moments:list'
const THUMB_MAX = 800     // long-edge px for the card + orbit thumbnails
const THUMB_QUALITY = 0.8 // JPEG quality for thumbnails

export async function loadMemories() {
  return (await get(LIST_KEY)) || null
}

export async function saveMemories(list) {
  await set(LIST_KEY, list)
}

// Downscale an image blob to a small JPEG thumbnail (long edge THUMB_MAX).
// Returns null if it can't be decoded (caller falls back to the original).
export async function makeThumbnail(blob) {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, THUMB_MAX / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', THUMB_QUALITY))
    return out || null
  } catch {
    return null // undecodable (e.g. HEIC on some browsers) — fall back to original
  }
}

// Persist a media blob. For images, also generate + store a small thumbnail
// under `thumb:<id>` so cards/orbit never decode the full-resolution original.
// Video/audio store only the original (no thumbnail).
export async function saveImageMedia(id, blob, kind) {
  if (kind !== 'image') { await set('img:' + id, blob); return }
  // the original write and the thumbnail decode are independent — overlap them
  const [, thumb] = await Promise.all([set('img:' + id, blob), makeThumbnail(blob)])
  if (thumb) await set('thumb:' + id, thumb)
}

// Delete an image + its thumbnail, and revoke/drop any cached object URLs.
export async function deleteImage(id) {
  revokeURL('img:' + id)
  revokeURL('thumb:' + id)
  await del('img:' + id)
  await del('thumb:' + id)
}

// storageKey ('img:<id>' | 'thumb:<id>') -> object URL
const urlCache = new Map()

// cache an object URL for a blob, deduping if a concurrent caller beat us to it
function cacheURL(key, blob) {
  const url = URL.createObjectURL(blob)
  if (urlCache.has(key)) { URL.revokeObjectURL(url); return urlCache.get(key) }
  urlCache.set(key, url)
  return url
}

async function urlForKey(key) {
  if (urlCache.has(key)) return urlCache.get(key)
  const blob = await get(key)
  if (!blob) return null
  return cacheURL(key, blob)
}

// Full-resolution original — ONLY the lightbox should use this.
export async function imageURL(id) {
  if (!id) return null
  return urlForKey('img:' + id)
}

// Small thumbnail — cards + orbit use this. Prefers `thumb:<id>`; for memories
// saved before thumbnails existed, lazily generates one from the original (and
// persists it), falling back to the original URL only if generation fails.
export async function thumbURL(id) {
  if (!id) return null
  const key = 'thumb:' + id
  if (urlCache.has(key)) return urlCache.get(key)
  let blob = await get(key)
  if (!blob) {
    const orig = await get('img:' + id)
    if (!orig) return null
    blob = await makeThumbnail(orig)
    if (blob) await set(key, blob)
    else return imageURL(id) // generation failed — show the original
  }
  if (urlCache.has(key)) return urlCache.get(key)
  return cacheURL(key, blob)
}

// Revoke a single cached object URL by storage key.
export function revokeURL(key) {
  const url = urlCache.get(key)
  if (url) { URL.revokeObjectURL(url); urlCache.delete(key) }
}

// Revoke just the heavy full-res original (e.g. when the lightbox closes) —
// the card thumbnail (a different key) stays cached.
export function revokeOriginal(id) { revokeURL('img:' + id) }

export const COLORS = {
  blue:   { bg: '#DBE9FC', text: '#2563EB' },
  yellow: { bg: '#FCF3C4', text: '#B45309' },
  pink:   { bg: '#FCDEE7', text: '#DB2777' },
  purple: { bg: '#ECDFFB', text: '#7C3AED' },
  mint:   { bg: '#D9F2E2', text: '#0F8A4F' },
  peach:  { bg: '#FDE7D3', text: '#C2570B' },
}

export const COLOR_KEYS = Object.keys(COLORS)
export const randomColorKey = () => COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)]
