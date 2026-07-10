import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toISO } from './time.js'
import { icons } from './media.js'
import { Icon } from './MemoryCard.jsx'
import { CalendarPopover, prettyDate } from './CalendarPopover.jsx'

// Place several dropped/selected photos onto the timeline, one at a time: a
// blurred backdrop over the app, a card that shows the current photo with its
// date beside it, and prev/next toggles (the track also snap-scrolls one photo
// at a time). Files are raw File objects, so previews come from local object
// URLs (revoked on unmount). Date uses the shared CalendarPopover.
export default function BulkUploader({ files, onClose, onCommit }) {
  const today = toISO(new Date())
  const [dates, setDates] = useState(() => files.map(() => today))
  const [current, setCurrent] = useState(0)
  const [calAnchor, setCalAnchor] = useState(null) // rect of the open date field, or null
  const trackRef = useRef(null)
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  const go = (i) => {
    const next = Math.max(0, Math.min(files.length - 1, i))
    const track = trackRef.current
    if (track) track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' })
    setCurrent(next)
  }
  // keep `current` in sync when the user snap-scrolls the track by hand
  const onScroll = () => {
    const track = trackRef.current
    if (track) setCurrent(Math.round(track.scrollLeft / track.clientWidth))
  }

  const openCal = (e, i) => {
    const r = e.currentTarget.getBoundingClientRect()
    setCalAnchor({ left: r.left, width: r.width, top: r.top, index: i })
  }
  const setDate = (i, d) => setDates((arr) => arr.map((v, j) => (j === i ? d : v)))

  const commit = () => {
    onCommit(files.map((file, i) => ({ file, date: dates[i] })))
    onClose()
  }

  return (
    <motion.div
      className="bulk-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={onClose}
    >
      <motion.div
        className="bulk-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <div className="bulk-head">
          <h2 className="bulk-title">Place your photos</h2>
          <span className="bulk-count">{current + 1} / {files.length}</span>
        </div>

        <div className="bulk-track" ref={trackRef} onScroll={onScroll}>
          {files.map((f, i) => (
            <div className="bulk-slide" key={i}>
              <img className="bulk-photo" src={urls[i]} alt="" draggable={false} />
              <div className="bulk-side">
                <span className="bulk-side-label">Date</span>
                <button className="bulk-datebtn" type="button" onClick={(e) => openCal(e, i)}>
                  <span>{prettyDate(dates[i])}</span>
                  <Icon d={icons.calendar} size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {files.length > 1 && (
          <>
            <button className="bulk-nav bulk-prev" onClick={() => go(current - 1)} disabled={current === 0} title="Previous">
              <Icon d={icons.chevronL} size={22} />
            </button>
            <button className="bulk-nav bulk-next" onClick={() => go(current + 1)} disabled={current === files.length - 1} title="Next">
              <Icon d={icons.chevronR} size={22} />
            </button>
          </>
        )}

        <div className="bulk-bar">
          <button className="bulk-cancel" onClick={onClose}>Cancel</button>
          <button className="bulk-add" onClick={commit}>Add to timeline</button>
        </div>
      </motion.div>

      <AnimatePresence>
        {calAnchor && (
          <CalendarPopover
            value={dates[calAnchor.index]}
            max={today}
            anchor={calAnchor}
            onChange={(d) => setDate(calAnchor.index, d)}
            onClose={() => setCalAnchor(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
