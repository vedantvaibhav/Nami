import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Swiper, SwiperSlide } from 'swiper/react'
import { EffectCoverflow, Pagination, Keyboard, Mousewheel } from 'swiper/modules'
import 'swiper/css'
import 'swiper/css/effect-coverflow'
import 'swiper/css/pagination'
import { SWIFT } from './anim.js'
import { toISO } from './time.js'
import { icons } from './media.js'
import { Icon } from './MemoryCard.jsx'
import { CalendarPopover, prettyDate } from './CalendarPopover.jsx'

// Entrance: the white backdrop dissolves in first, THEN its children rise/fade in
// (staggered) — see the `when: 'beforeChildren'` + delay/stagger below.
const BACKDROP_V = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.28, ease: 'easeOut', when: 'beforeChildren', delayChildren: 0.18, staggerChildren: 0.12 } },
}
const RISE_V = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: SWIFT } },
}

// Full-screen (white) takeover for placing several photos: a Swiper coverflow
// deck with each photo's date badged onto the image. Picking a date advances to
// the next. `capacityFor(date)` (from App) = how many more images that day can
// take; over-assigning a day turns its date badge red and disables Add.
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

  const batchOn = (d) => dates.filter((x) => x === d).length
  const overCap = (d) => batchOn(d) > capacityFor(d)
  const currentInvalid = overCap(dates[current])
  const anyInvalid = dates.some((d) => overCap(d))

  const openCal = (e, i) => {
    // span the FULL photo width (anchor to the slide, not the narrow badge) and
    // open just above the badge, so the calendar covers the picture and isn't clipped
    const badge = e.currentTarget.getBoundingClientRect()
    const slide = e.currentTarget.closest('.bulk-slide')?.getBoundingClientRect() || badge
    setCalAnchor({ left: slide.left, width: slide.width, top: badge.top, index: i })
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
      variants={BACKDROP_V}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <motion.button className="bulk-close" variants={RISE_V} onClick={onClose} title="Close (Esc)">
        <Icon d={icons.close} size={18} />
      </motion.button>

      <motion.p className="bulk-intro" variants={RISE_V}>Assign a date to each photo</motion.p>

      <motion.div className="bulk-stage" variants={RISE_V}>
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
                <Icon d={icons.calendar} size={17} />
              </button>
            </SwiperSlide>
          ))}
        </Swiper>
      </motion.div>

      <p className="bulk-error" style={{ visibility: currentInvalid ? 'visible' : 'hidden' }}>
        This day is full. Pick another date.
      </p>

      <motion.button className="bulk-add" variants={RISE_V} disabled={anyInvalid} onClick={commit}>
        Add to timeline
      </motion.button>

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
