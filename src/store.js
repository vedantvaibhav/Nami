import { get, set, del } from 'idb-keyval'

const LIST_KEY = 'moments:list'

export async function loadMemories() {
  return (await get(LIST_KEY)) || null
}

export async function saveMemories(list) {
  await set(LIST_KEY, list)
}

export async function saveImage(id, blob) {
  await set('img:' + id, blob)
}

export async function deleteImage(id) {
  await del('img:' + id)
}

const urlCache = new Map()

export async function imageURL(id) {
  if (urlCache.has(id)) return urlCache.get(id)
  const blob = await get('img:' + id)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export const COLORS = {
  blue:   { bg: '#DBE9FC', text: '#2563EB' },
  yellow: { bg: '#FCF3C4', text: '#B45309' },
  pink:   { bg: '#FCDEE7', text: '#DB2777' },
  purple: { bg: '#ECDFFB', text: '#7C3AED' },
  mint:   { bg: '#D9F2E2', text: '#0F8A4F' },
  peach:  { bg: '#FDE7D3', text: '#C2570B' },
}

export const COLOR_KEYS = Object.keys(COLORS)
