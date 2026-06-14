import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLORS } from './store.js'
import { useImage } from './MemoryCard.jsx'
import { cardDateLabel } from './time.js'
import { firstImageId, seededTilt } from './media.js'
import { buildMediaItems } from './canvas3d/textures.js'
import InfiniteMemoryCanvas from './canvas3d/InfiniteMemoryCanvas.jsx'

function OrbitModal({ m, onClose }) {
  const color = COLORS[m.color] || COLORS.blue
  const imgUrl = useImage(firstImageId(m))
  return (
    <motion.div
      className="orbit-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
    >
      <motion.div
        className="orbit-stage"
        initial={{ scale: 0.7, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 12 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        {m.type === 'quote' ? (
          <div className="orbit-stage-quote">{m.title}</div>
        ) : (
          <div className="orbit-stage-card" style={{ background: color.bg }}>
            {m.title && <div className="orbit-stage-title" style={{ color: color.text }}>{m.title}</div>}
            <div className="orbit-stage-date" style={{ color: color.text }}>{cardDateLabel(m.date)}</div>
            {m.body && <div className="orbit-stage-body">{m.body}</div>}
            {imgUrl && (
              <div className="polaroid" style={{ transform: `rotate(${seededTilt(m.id, 0, 2)}deg)` }}>
                <img src={imgUrl} alt={m.title || 'memory'} draggable={false} />
              </div>
            )}
          </div>
        )}
        {m.type === 'quote' && <div className="orbit-stage-date orbit-stage-date-quote">{cardDateLabel(m.date)}</div>}
        <button className="orbit-close" onClick={onClose} title="Close">×</button>
      </motion.div>
    </motion.div>
  )
}

export default function YearOrbit({ memories, active = true, revealed = true, onProgress, onReady }) {
  const [media, setMedia] = useState(null)
  const [open, setOpen] = useState(null)

  // rebuild textures only when CONTENT changes — pos (manual drag Y) is not
  // rendered here, and rebuilding every photo/note texture on each card drop
  // was main-thread jank exactly when the drop settle animation runs
  const contentKey = useMemo(
    () => memories.map((m) => `${m.id}:${m.date}:${m.title}:${m.body}:${m.color}:${(m.media || []).map((x) => x.id).join(',')}`).join('|'),
    [memories]
  )

  useEffect(() => {
    let live = true
    // every committed memory orbits here, regardless of its year.
    // onProgress/onReady drive the app's boot loading bar — media building
    // (blob decode + texture painting) is the real readiness signal.
    buildMediaItems(memories, (done, total) => { if (live) onProgress?.(done, total) })
      .then((built) => {
        if (!live) return
        setMedia(built)
        onReady?.()
      })
      .catch(() => {
        // a failed build must still lift the boot overlay — empty orbit > white hang
        if (!live) return
        setMedia([])
        onReady?.()
      })
    return () => { live = false }
  }, [contentKey])

  return (
    <div className="orbit-view">
      {media && <InfiniteMemoryCanvas media={media} active={active} revealed={revealed} onOpen={setOpen} />}

      {/* empty state: nothing to orbit yet — a calm centred invite on the same
          off-white orbit background (first pass; refine later) */}
      {memories.length === 0 && (
        <div className="orbit-empty">
          <div className="orbit-empty-title">Your memories will orbit here</div>
          <div className="orbit-empty-sub">Add your first one to begin.</div>
        </div>
      )}

      <AnimatePresence>
        {open && <OrbitModal m={open} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </div>
  )
}
