import { forwardRef, memo, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { COLORS, imageURL, thumbURL } from './store.js'
import { icons, inferType, seededBars, seededTilt, seedFrac } from './media.js'
import { SWIFT, LIQUID } from './anim.js'

// resolve an object URL via a store getter (imageURL = full-res original,
// thumbURL = small thumbnail). Cards/orbit use thumbnails; only the lightbox
// loads originals — so the app never holds full-res decodes for the timeline.
function useResolvedURL(imgId, getter) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let live = true
    if (imgId) getter(imgId).then((u) => live && setUrl(u))
    else setUrl(null)
    return () => { live = false }
  }, [imgId])
  return url
}

export const useImage = (imgId) => useResolvedURL(imgId, imageURL) // full-res (lightbox)
export const useThumb = (imgId) => useResolvedURL(imgId, thumbURL) // small (cards/orbit)

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
  const url = useThumb(id)
  if (!url) return null
  return <img className="stack-img" style={style} src={url} alt="" draggable={false} decoding="async" />
}

// multiple photos = a deck pinned in ONE spot: every print fills the card and
// sits in the same place; only the rotation differs, so the ones underneath
// peek out at the corners. The top print stays the focus (see reference).
function PhotoBlock({ m }) {
  const images = m.media.filter((x) => x.kind === 'image').slice(0, 4)
  const topUrl = useThumb(images[0]?.id)
  if (!images.length) return null
  // Render the 4/3 box from mount (the src fills in when the thumbnail resolves)
  // so the card reserves its full height immediately — it never grows a frame
  // later when the thumb decodes, which used to shove the column's other cards.
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
  // play inline like a live photo: muted + looping autoplay, no controls
  return (
    <div className="video-thumb">
      {url
        ? <video src={url} muted loop autoPlay playsInline draggable={false} />
        : <div className="video-thumb-empty" />}
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
// `forwardRef` so App can read a card's live `offsetTop` when a column flips
// from auto → manual (seed manual Y from the current rendered layout = no jump).
const MemoryCard = forwardRef(function MemoryCard({
  m, index = 0, entered = false,
  // manual placement (vertical drag): when `manual` is true the card is
  // absolutely positioned at `manualY` (its committed top); `yMV` is a TRANSIENT
  // drag offset (0 at rest; we write the pointer delta into it while dragging,
  // and App glides it back to 0 after the drop commit). The drag is a CUSTOM
  // pointer implementation — framer's drag system fought our settle animation
  // (its constraint snap-back is an uncontrollable bouncy inertia), which was
  // the source of the drop bounce and the glitchy feel.
  // `instantLayout` is true for renders that belong to a drag (App's dragActive
  // ref): the layout transition snaps so projection can't fight the gesture.
  // `getDragBounds(id)` is called once per gesture (at the drag threshold) so
  // no per-render DOM reads are needed to keep the drag clamped on-screen.
  manual = false, manualY = 0, yMV, getDragBounds, instantLayout = false,
  onDragStart, onDragEnd, onDragCancel,
  onDelete, onEdit, onOpen,
}, ref) {
  const type = inferType(m)
  const color = COLORS[m.color] || COLORS.blue
  const isQuote = type === 'quote'
  // distinguishes a drag from a click: set once the pointer moves past the
  // threshold, consumed by onClick so a drag never opens the lightbox
  const draggedRef = useRef(false)
  // live gesture state: { startY, pointerId, moved, el }
  const gestureRef = useRef(null)

  const startDrag = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    if (e.target.closest('button, .audio-pill')) return
    draggedRef.current = false
    gestureRef.current = { startY: e.clientY, pointerId: e.pointerId, moved: false, el: e.currentTarget }
  }
  const moveDrag = (e) => {
    const s = gestureRef.current
    if (!s || e.pointerId !== s.pointerId) return
    const dy = e.clientY - s.startY
    if (!s.moved) {
      if (Math.abs(dy) < 4) return // dead zone: taps/clicks never start a drag
      s.moved = true
      draggedRef.current = true
      try { s.el.setPointerCapture(s.pointerId) } catch { /* synthetic pointers */ }
      s.el.style.zIndex = '60'
      s.el.style.willChange = 'transform' // promote ONLY for the live drag
      // flips the column to manual SYNCHRONOUSLY (App uses flushSync), so this
      // card is absolute + bound to yMV before the first offset is written
      onDragStart?.(m.id)
      // clamp bounds for the whole gesture, computed once after the flip
      s.bounds = getDragBounds?.(m.id) ?? null
    }
    // clamp live so the card physically can't leave the visible band
    const b = s.bounds
    yMV.set(b ? Math.min(Math.max(dy, b.top), b.bottom) : dy)
  }
  const endDrag = (e) => {
    const s = gestureRef.current
    if (!s || e.pointerId !== s.pointerId) return
    gestureRef.current = null
    if (!s.moved) return
    try { s.el.releasePointerCapture(s.pointerId) } catch { /* already released */ }
    const el = s.el
    setTimeout(() => { el.style.zIndex = ''; el.style.willChange = '' }, 200) // after the settle finishes
    onDragEnd?.(m.id, yMV.get())
  }
  // the browser stole the pointer (touch became a scroll, system gesture) —
  // REVERT the drag instead of committing wherever the card happened to be
  const cancelDrag = () => {
    const s = gestureRef.current
    gestureRef.current = null
    if (!s?.moved) return
    try { s.el.releasePointerCapture(s.pointerId) } catch { /* already released */ }
    s.el.style.zIndex = ''
    s.el.style.willChange = ''
    onDragCancel?.(m.id)
  }
  // unmount safety: if the card is removed mid-drag (deleted, column regroup)
  // the gesture can never end — without this, App's dragActive ref would stay
  // true forever and force-snap every layout animation in the app
  useEffect(() => () => { if (gestureRef.current?.moved) onDragCancel?.(m.id) }, [])

  // placement (AUTO mode only): most columns start at the top; an occasional
  // first card (~30%) sits noticeably lower so the wall feels hand-arranged.
  // Cards after the first keep one uniform gap (the column's flex gap).
  const f = seedFrac(m.id + ':y')
  const scatter = index === 0 && f >= 0.7 ? Math.round(140 + f * 120) : 0

  // inline style, composed from two orthogonal flags:
  // - quotes have no pastel background (the highlight strips carry the colour)
  // - AUTO: flex stack + scatter margin, NO `yMV` (layout="position" owns the
  //   transform in auto mode; the flip to manual happens synchronously inside
  //   the threshold-crossing pointermove, before any offset is written)
  // - MANUAL: absolute at the committed `manualY` + the transient `yMV` offset
  const style = {
    ...(isQuote ? {} : { background: color.bg }),
    ...(manual
      ? { position: 'absolute', top: manualY, left: 0, width: '100%', y: yMV }
      : { marginTop: scatter }),
  }

  return (
    <motion.div
      ref={ref}
      // Toggle glide (Days↔Months): shared-layout flight via layoutId +
      // layout="position" => animate ONLY the move, never the size (otherwise the
      // card balloons in height while images re-measure mid-transition).
      // Enabled for MANUAL cards too — so hand-arranged columns glide on view
      // toggles like everyone else. Renders that belong to a drag set
      // `instantLayout`, which makes the layout transition snap (duration 0) so
      // projection never animates against the pointer or the drop compensation.
      layoutId={m.id}
      layout="position"
      className={`card ${isQuote ? 'card-quote' : ''} ${manual ? 'card-manual' : ''}`}
      style={style}
      // fade in only on the first load; on toggle re-mounts start visible so the
      // card just glides (no opacity flicker).
      initial={entered ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16, ease: 'easeOut' } }}
      transition={{
        // gesture transforms (whileHover / whileTap scale, shadow) settle on a
        // quick tween — NO spring, so releasing a press never bounces the card
        default: { type: 'tween', duration: 0.14, ease: 'easeOut' },
        opacity: { duration: 0.34, ease: SWIFT, delay: Math.min(index, 6) * 0.04 },
        // the Days↔Months glide uses the SAME LIQUID spring as the zoom pill,
        // so pill + crossfade + cards land together as one motion (no slow
        // drift, no tail). Instant during drag-owned renders (see instantLayout).
        layout: instantLayout ? { duration: 0 } : LIQUID,
      }}
      // ---- vertical drag (custom pointer implementation) ----
      // We own the whole gesture: pointer delta -> yMV (clamped live), drop ->
      // App commits the snapped top and glides yMV back to 0. ONE animation,
      // zero framer drag inertia, so the drop can't bounce or glitch.
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      // lift on press (covers the whole drag too — tap has gesture priority)
      whileTap={{ scale: 1.02, boxShadow: '0 6px 16px rgba(20,20,40,0.12)' }}
      whileHover={{ scale: 0.98 }}
      onClick={(e) => {
        // a drag just happened — swallow the click so we don't open the lightbox
        if (draggedRef.current) { draggedRef.current = false; return }
        if (e.target.closest('button, .audio-pill')) return
        if (type !== 'note' && !isQuote) onOpen(m.id)
      }}
    >
      <div className="card-actions">
        <button className="card-act" onClick={(e) => { e.stopPropagation(); onEdit(m.id) }} title="Edit">
          <Icon d={icons.edit} size={15} />
        </button>
        <button className="card-act card-del" onClick={(e) => { e.stopPropagation(); onDelete(m.id) }} title="Delete">
          <Icon d={icons.close} size={15} />
        </button>
      </div>

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
})

// memoized: App re-renders often (boot ticks, resize, dock morph) and every
// drag-relevant prop is either stable (callbacks, yMV, ref) or a primitive,
// so untouched cards skip re-rendering entirely
export default memo(MemoryCard)
