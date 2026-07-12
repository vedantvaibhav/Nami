import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Swiper, SwiperSlide } from 'swiper/react'
import { EffectCoverflow, Pagination, Keyboard, Mousewheel } from 'swiper/modules'
import 'swiper/css'
import 'swiper/css/effect-coverflow'
import 'swiper/css/pagination'
import { toISO } from './time.js'
import { icons } from './media.js'
import { Icon } from './MemoryCard.jsx'
import { CalendarPopover, prettyDate } from './CalendarPopover.jsx'

// Full-screen (white) takeover for placing several dropped/selected photos: a
// Swiper coverflow deck of the photos with the date picker beneath the centred
// one. Picking a date sets that photo's date and advances to the next. Arrow
// keys, scroll, drag, and the pagination dots all move the deck. Files are raw
// File objects -> local preview URLs (revoked on unmount). No labels; just the
// deck, the date field, and the Cancel / Add-to-timeline CTAs.
export default function BulkUploader({ files, onClose, onCommit }) {
  const today = toISO(new Date())
  const [dates, setDates] = useState(() => files.map(() => today))
  const [current, setCurrent] = useState(0)
  const [calAnchor, setCalAnchor] = useState(null) // rect of the date field while the calendar is open
  const swiperRef = useRef(null)
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  // Escape closes the takeover (Swiper's keyboard module owns the arrow keys)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !calAnchor) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [calAnchor, onClose])

  const openCal = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setCalAnchor({ left: r.left, width: r.width, top: r.top })
  }
  const pickDate = (d) => {
    setDates((arr) => arr.map((v, j) => (j === current ? d : v)))
    setCalAnchor(null)
    if (current < files.length - 1) swiperRef.current?.slideNext() // placed -> next photo
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
    >
      <Swiper
        className="bulk-swiper"
        effect="coverflow"
        grabCursor
        centeredSlides
        slidesPerView="auto"
        spaceBetween={0}
        coverflowEffect={{ rotate: 40, stretch: 0, depth: 100, modifier: 1, slideShadows: true }}
        keyboard={{ enabled: true }}
        mousewheel={{ forceToAxis: true }}
        pagination={{ clickable: true }}
        modules={[EffectCoverflow, Pagination, Keyboard, Mousewheel]}
        onSwiper={(s) => { swiperRef.current = s }}
        onSlideChange={(s) => setCurrent(s.activeIndex)}
      >
        {files.map((f, i) => (
          <SwiperSlide key={i} className="bulk-slide">
            <img src={urls[i]} alt="" draggable={false} />
          </SwiperSlide>
        ))}
      </Swiper>

      <button className="bulk-datebtn" type="button" onClick={openCal}>
        <span>{prettyDate(dates[current])}</span>
        <Icon d={icons.calendar} size={18} />
      </button>

      <div className="bulk-bar">
        <button className="bulk-cancel" onClick={onClose}>Cancel</button>
        <button className="bulk-add" onClick={commit}>Add to timeline</button>
      </div>

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
