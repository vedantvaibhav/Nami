import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { COLORS, imageURL } from './store.js'
import { icons, inferType, seededBars, seededTilt, seedFrac, videoThumb } from './media.js'

export function useImage(imgId) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let live = true
    if (imgId) imageURL(imgId).then((u) => live && setUrl(u))
    else setUrl(null)
    return () => { live = false }
  }, [imgId])
  return url
}

export const Icon = ({ d, size = 16, stroke = 1.8, className = '' }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d.split(' M').map((p, i) => <path key={i} d={(i === 0 ? '' : 'M') + p} />)}
  </svg>
)

// ---- media renderers -------------------------------------------------------
function StackImg({ id, style }) {
  const url = useImage(id)
  if (!url) return null
  return <img className="stack-img" style={style} src={url} alt="" draggable={false} decoding="async" />
}

// multiple photos = a deck pinned in ONE spot: every print fills the card and
// sits in the same place; only the rotation differs, so the ones underneath
// peek out at the corners. The top print stays the focus (see reference).
function PhotoBlock({ m }) {
  const images = m.media.filter((x) => x.kind === 'image').slice(0, 4)
  const topUrl = useImage(images[0]?.id)
  if (!topUrl) return null
  if (images.length === 1) {
    return <img className="card-photo" src={topUrl} alt={m.title || 'memory'} draggable={false} decoding="async" />
  }
  const n = images.length
  return (
    <div className="photo-stack">
      {images.map((img, i) => {
        // front print nearly straight; each one behind it leans just a touch,
        // alternating side, so its corners show around the top print
        const rot = i === 0
          ? seededTilt(m.id, i, 0.8)
          : (i % 2 ? 1 : -1) * (2 + seedFrac(m.id + i) * 1.5)
        return (
          <StackImg
            key={img.id}
            id={img.id}
            style={{ zIndex: n - i, transform: `rotate(${rot}deg)` }}
          />
        )
      })}
    </div>
  )
}

function VideoBlock({ m }) {
  const video = m.media.find((x) => x.kind === 'video')
  const url = useImage(video?.id)
  const [thumb, setThumb] = useState(null)
  useEffect(() => {
    let live = true
    if (video && url) videoThumb(video.id, url).then((t) => live && setThumb(t))
    return () => { live = false }
  }, [video?.id, url])
  return (
    <div className="video-thumb">
      {thumb ? <img src={thumb} alt={m.title || 'video'} draggable={false} /> : <div className="video-thumb-empty" />}
      <span className="play-badge"><Icon d={icons.play} size={18} /></span>
    </div>
  )
}

export function AudioBlock({ m, tall = false }) {
  const audio = m.media.find((x) => x.kind === 'audio')
  const url = useImage(audio?.id)
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const bars = seededBars(m.id)

  const toggle = (e) => {
    e.stopPropagation()
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  return (
    <div className={`audio-pill ${tall ? 'audio-pill-tall' : ''}`} onClick={(e) => e.stopPropagation()}>
      {url && <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} />}
      <button className="audio-play" onClick={toggle}>
        <Icon d={playing ? icons.pause : icons.play} size={18} />
      </button>
      <div className="audio-bars">
        {bars.map((h, i) => <span key={i} style={{ height: `${h * 100}%` }} />)}
      </div>
    </div>
  )
}

// ---- the card --------------------------------------------------------------
export default function MemoryCard({
  m, index = 0,
  onDelete, onOpen,
}) {
  const type = inferType(m)
  const color = COLORS[m.color] || COLORS.blue
  const isQuote = type === 'quote'

  // placement: most columns start at the top; an occasional first card (~30%)
  // sits noticeably lower so the wall feels hand-arranged. Cards after the
  // first keep one uniform gap (the column's flex gap) — no extra randomness.
  const f = seedFrac(m.id + ':y')
  const scatter = index === 0 && f >= 0.7 ? Math.round(140 + f * 120) : 0

  return (
    <motion.div
      layout
      className={`card ${isQuote ? 'card-quote' : ''}`}
      style={isQuote ? { marginTop: scatter } : { marginTop: scatter, background: color.bg }}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16, ease: 'easeOut' } }}
      transition={{
        duration: 0.42,
        ease: [0.16, 1, 0.3, 1],
        delay: Math.min(index, 6) * 0.04, // gentle cascade down the column
        layout: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
      }}
      whileHover={{ scale: 0.98 }}
      onClick={(e) => {
        if (e.target.closest('button, .audio-pill')) return
        if (type !== 'note' && !isQuote) onOpen(m.id)
      }}
    >
      <button className="card-delete" onClick={(e) => { e.stopPropagation(); onDelete(m.id) }} title="Delete">×</button>

      {isQuote ? (
        <div className="quote-note">
          <span className="quote-strips" style={{ backgroundColor: color.bg, color: color.text }}>
            {m.title || '…'}
          </span>
        </div>
      ) : (
        <>
          {m.title && (
            <div className="card-title" style={{ color: `color-mix(in srgb, ${color.text} 78%, #fff)` }}>
              {m.title}
            </div>
          )}
          {m.body && (
            <div className="card-body" style={{ color: `color-mix(in srgb, ${color.text} 60%, #fff)` }}>
              {m.body}
            </div>
          )}
          {type === 'photo' && <PhotoBlock m={m} />}
          {type === 'video' && <VideoBlock m={m} />}
          {type === 'audio' && (
            <>
              <AudioBlock m={m} />
              <div className="audio-name">{m.media.find((i) => i.kind === 'audio')?.name}</div>
            </>
          )}
          {m.saveError && <span className="error-badge" title="Failed to save media">!</span>}
        </>
      )}
    </motion.div>
  )
}
