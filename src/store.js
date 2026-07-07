import { supabase } from './supabase.js'

// Phase 3 plan — move the memories list from IndexedDB to Supabase Postgres:
// - Minimal transport swap: the list is still ONE array; it now lives in a
//   single JSONB row per user (memories.data) instead of one idb-keyval value.
//   Only loadMemories/saveMemories change; Cloudinary media + urlCache/kinds are
//   untouched.
// - userId flow: App has session from Phase 2; it passes session.user.id into
//   loadMemories(userId) and saveMemories(userId, list). RLS scopes the row.
// - First login: no row exists yet. .single() returns error PGRST116 ("no rows")
//   — we treat that as an empty list []; the first saveMemories upsert creates
//   the row.
// - Race: App guards both effects with `if (!session) return` and depends on
//   session, so loadMemories only runs once a user id exists.

export async function loadMemories(userId) {
  const { data, error } = await supabase
    .from('memories')
    .select('data')
    .eq('user_id', userId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return [] // no row yet — valid empty state
    throw error
  }
  return data.data
}

export async function saveMemories(userId, list) {
  const { error } = await supabase
    .from('memories')
    .upsert({ user_id: userId, data: list, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ---- Cloudinary media storage ----------------------------------------------
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

// public_id (our UUID) -> kind, so imageURL/thumbURL pick the right delivery
// type. In-memory only: after a reload it's empty and we default to 'image'.
const kinds = new Map()

// cacheKey ('img:<id>' | 'thumb:<id>') -> Cloudinary URL string
const urlCache = new Map()

// image assets deliver from /image/upload; video AND audio from /video/upload.
// Unknown kind (e.g. after a reload cleared the Map) defaults to image.
const deliveryType = (id) => {
  const k = kinds.get(id)
  return k === 'video' || k === 'audio' ? 'video' : 'image'
}

// Upload a media blob to Cloudinary via the unsigned upload endpoint. `auto`
// resource type accepts image, video, and audio through one endpoint. We reuse
// our own UUID as the public_id so the delivery URL is reconstructable on any
// reload with no extra stored data. Throws on failure so the caller can catch.
export async function saveImageMedia(id, blob, kind) {
  kinds.set(id, kind)
  const form = new FormData()
  form.append('file', blob)
  form.append('upload_preset', PRESET)
  form.append('public_id', id)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Cloudinary upload failed (${res.status}): ${detail}`)
  }
  return res.json()
}

// Cloudinary deletion needs the API secret (unsafe in the browser), so we only
// drop local caches — the remote asset is left in place.
export async function deleteImage(id) {
  urlCache.delete('img:' + id)
  urlCache.delete('thumb:' + id)
  kinds.delete(id)
}

// Full-resolution original — ONLY the lightbox should use this.
export async function imageURL(id) {
  if (!id) return null
  const key = 'img:' + id
  if (urlCache.has(key)) return urlCache.get(key)
  const url = `https://res.cloudinary.com/${CLOUD_NAME}/${deliveryType(id)}/upload/${id}`
  urlCache.set(key, url)
  return url
}

// Small thumbnail — cards + orbit use this. Cloudinary resizes images on the
// fly (w_800, quality/format auto); video/audio have no image transform so they
// deliver the same URL as the original.
export async function thumbURL(id) {
  if (!id) return null
  const key = 'thumb:' + id
  if (urlCache.has(key)) return urlCache.get(key)
  const url = deliveryType(id) === 'image'
    ? `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_800,c_limit,q_auto,f_auto/${id}`
    : `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/${id}`
  urlCache.set(key, url)
  return url
}

// Cloudinary URLs are plain strings — nothing to revoke. Kept as no-ops so the
// existing callers (App.jsx, Lightbox.jsx) don't break.
export function revokeURL() {}
export function revokeOriginal() {}

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
