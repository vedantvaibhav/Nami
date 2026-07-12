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
// Swiper coverflow deck with each photo's date badged onto the image. Picking a
// date advances to the next. `capacityFor(date)` (from App) = how many more
// images that day can take; if more photos are assigned to a day than it can
// hold, their date badge turns red and Add is disabled until it's resolved.
export default function BulkUploader({ files, onClose, onCommit, capacityFor }) {
  const today = toISO(new Date())
  const [dates, setDates] = useState(() => files.map(() => today))
  const [current, setCurrent] = useState(0)
  const [calAnchor, setCalAnchor] = useState(null) // { left, width, top, index } while the calendar is open
  const swiperRef = useRef(null)
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  // Escape closes the takeover (Swiper's keyboard module owns the arrow keys)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !calAnchor) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [calAnchor, onClose])

  // a day is over capacity when more batch photos are assigned to it than it can hold
  const batchOn = (d) => dates.filter((x) => x === d).length
  const overCap = (d) => batchOn(d) > capacityFor(d)
  const currentInvalid = overCap(dates[current])
  const anyInvalid = dates.some((d) => overCap(d))

  const openCal = (e, i) => {
    const r = e.currentTarget.getBoundingClientRect()
    setCalAnchor({ left: r.left, width: Math.max(r.width, 220), top: r.top, index: i })
  }
  const pickDate = (d) => {
    const i = calAnchor.index
    setDates((arr) => arr.map((v, j) => (j === i ? d : v)))
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
      <button className="bulk-close" onClick={onClose} title="Close">
        <Icon d={icons.close} size={18} />
        <span>esc</span>
      </button>

      <div className="bulk-intro">
        <h2 className="bulk-title">Bulk upload</h2>
        <p className="bulk-sub">Assign a date to each photo</p>
      </div>

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
            <button
              className={`bulk-datebtn ${overCap(dates[i]) ? 'bulk-datebtn-error' : ''}`}
              type="button"
              style={{ pointerEvents: i === current ? 'auto' : 'none' }}
              onClick={(e) => { e.stopPropagation(); openCal(e, i) }}
            >
              <span>{prettyDate(dates[i])}</span>
              <Icon d={icons.calendar} size={16} />
            </button>
          </SwiperSlide>
        ))}
      </Swiper>

      <p className="bulk-error" style={{ visibility: currentInvalid ? 'visible' : 'hidden' }}>
        This day is full. Pick another date.
      </p>

      <button className="bulk-add" disabled={anyInvalid} onClick={commit}>Add to timeline</button>

      <AnimatePresence>
        {calAnchor && (
          <CalendarPopover
            value={dates[calAnchor.index]}
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
