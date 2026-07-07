import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLORS } from './store.js'
import { useImage } from './MemoryCard.jsx'
import { cardDateLabel } from './time.js'
import { firstImageId, seededTilt } from './media.js'
import { buildMediaItems, memKey } from './canvas3d/textures.js'
import InfiniteMemoryCanvas from './canvas3d/InfiniteMemoryCanvas.jsx'

// Some mobile devices can't create a WebGL context — render the empty-state photo
// instead of a blank white canvas so the Years view always shows something.
const webglOK = (() => {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
})()

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

export default function YearOrbit({ memories, active = true, revealed = true }) {
  const [media, setMedia] = useState(null)
  const [open, setOpen] = useState(null)

  // rebuild textures only when CONTENT changes — pos (manual drag Y) is not
  // rendered here, and rebuilding every photo/note texture on each card drop
  // was main-thread jank exactly when the drop settle animation runs. Uses the
  // same memKey as the texture cache so the trigger and the cache never drift.
  const contentKey = useMemo(() => memories.map(memKey).join('|'), [memories])

  useEffect(() => {
    let live = true
    // every committed memory orbits here, regardless of its year
    buildMediaItems(memories)
      .then((built) => { if (live) setMedia(built) })
      .catch(() => { if (live) setMedia([]) }) // a failed build still shows an empty orbit
    return () => { live = false }
  }, [contentKey])

  return (
    <div className="orbit-view">
      {media && webglOK && <InfiniteMemoryCanvas media={media} active={active} revealed={revealed} onOpen={setOpen} />}

      {/* empty state: a full-bleed photo that slowly zooms, then the line fades
          in, then the bottom panel rises (staged via CSS delays). The first
          memory swaps this for the real orbit. */}
      {(memories.length === 0 || !webglOK) && (
        <div className="orbit-empty">
          <img className="orbit-empty-img" src="/empty_state.png" alt="" draggable={false} />
          <div className="orbit-empty-text">The unscripted moments that make you pause</div>
        </div>
      )}

      <AnimatePresence>
        {open && <OrbitModal m={open} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </div>
  )
}
