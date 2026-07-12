import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Swiper, SwiperSlide } from 'swiper/react'
import { EffectCards, Keyboard, Mousewheel } from 'swiper/modules'
import 'swiper/css'
import 'swiper/css/effect-cards'
import { toISO } from './time.js'
import { icons } from './media.js'
import { Icon } from './MemoryCard.jsx'
import { CalendarPopover, prettyDate } from './CalendarPopover.jsx'

// Place several dropped/selected photos, one at a time: a blurred modal with a
// Swiper "cards" deck (front card = current photo), a date field beneath it, and
// picking a date advances to the next photo. Arrow keys, scroll, or drag also
// move the deck. Files are raw File objects -> local preview URLs (revoked on
// unmount). Date uses the shared CalendarPopover.
export default function BulkUploader({ files, onClose, onCommit }) {
  const today = toISO(new Date())
  const [dates, setDates] = useState(() => files.map(() => today))
  const [current, setCurrent] = useState(0)
  const [calAnchor, setCalAnchor] = useState(null) // rect of the date field while the calendar is open
  const swiperRef = useRef(null)
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  const openCal = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setCalAnchor({ left: r.left, width: r.width, top: r.top })
  }
  const pickDate = (d) => {
    setDates((arr) => arr.map((v, j) => (j === current ? d : v)))
    setCalAnchor(null)
    if (current < files.length - 1) swiperRef.current?.slideNext() // placed -> on to the next photo
  }

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

        <Swiper
          className="bulk-swiper"
          effect="cards"
          grabCursor
          keyboard={{ enabled: true }}
          mousewheel={{ forceToAxis: true }}
          modules={[EffectCards, Keyboard, Mousewheel]}
          onSwiper={(s) => { swiperRef.current = s }}
          onSlideChange={(s) => setCurrent(s.activeIndex)}
        >
          {files.map((f, i) => (
            <SwiperSlide key={i} className="bulk-swiper-slide">
              <img src={urls[i]} alt="" draggable={false} />
            </SwiperSlide>
          ))}
        </Swiper>

        <button className="bulk-datebtn" type="button" onClick={openCal}>
          <span>{prettyDate(dates[current])}</span>
          <Icon d={icons.calendar} size={18} />
        </button>

        <p className="bulk-hint">Use ← → keys, scroll, or drag to move · pick a date to place it</p>

        <div className="bulk-bar">
          <button className="bulk-cancel" onClick={onClose}>Cancel</button>
          <button className="bulk-add" onClick={commit}>Add to timeline</button>
        </div>
      </motion.div>

      <AnimatePresence>
        {calAnchor && (
          <CalendarPopover
            value={dates[current]}
            max={today}
            anchor={calAnchor}
            onChange={pickDate}
            onClose={() => setCalAnchor(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
