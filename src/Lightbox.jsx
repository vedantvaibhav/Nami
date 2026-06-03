import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { COLORS } from './store.js'
import { cardDateLabel } from './time.js'
import { fmtTime, icons, inferType, seededBars } from './media.js'
import { Icon, useImage } from './MemoryCard.jsx'

function PhotoExpand({ m }) {
  const images = m.media.filter((x) => x.kind === 'image')
  const [activeId, setActiveId] = useState(images[0]?.id)
  const mainUrl = useImage(activeId)
  return (
    <>
      <div className="lb-main">
        {mainUrl && <motion.img key={activeId} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} src={mainUrl} alt={m.title || 'memory'} />}
      </div>
      {images.length > 1 && (
        <div className="lb-strip">
          {images.map((img) => (
            <StripThumb key={img.id} id={img.id} active={img.id === activeId} onPick={() => setActiveId(img.id)} />
          ))}
        </div>
      )}
    </>
  )
}

function StripThumb({ id, active, onPick }) {
  const url = useImage(id)
  if (!url) return null
  return (
    <button className={`lb-thumb ${active ? 'lb-thumb-active' : ''}`} onClick={onPick}>
      <img src={url} alt="" />
    </button>
  )
}

function VideoExpand({ m }) {
  const video = m.media.find((x) => x.kind === 'video')
  const url = useImage(video?.id)
  const [hover, setHover] = useState(false)
  return (
    <div className="lb-main" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {url && <video src={url} autoPlay muted loop playsInline controls={hover} />}
    </div>
  )
}

function AudioExpand({ m }) {
  const audio = m.media.find((x) => x.kind === 'audio')
  const url = useImage(audio?.id)
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const bars = seededBars(m.id, 40)
  const color = COLORS[m.color] || COLORS.blue

  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  return (
    <div className="lb-audio" style={{ background: color.bg }}>
      {url && (
        <audio
          ref={ref}
          src={url}
          onTimeUpdate={(e) => setTime(e.target.currentTime)}
          onLoadedMetadata={(e) => setDur(e.target.duration)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <div className="lb-audio-top">
        <button className="audio-play audio-play-big" onClick={toggle}>
          <Icon d={playing ? icons.pause : icons.play} size={22} />
        </button>
        <div className="audio-bars audio-bars-tall">
          {bars.map((h, i) => (
            <span key={i} style={{ height: `${h * 100}%`, opacity: dur && time / dur > i / bars.length ? 1 : 0.4 }} />
          ))}
        </div>
      </div>
      <input
        className="lb-scrub"
        type="range"
        min={0}
        max={dur || 1}
        step={0.1}
        value={time}
        onChange={(e) => {
          const t = +e.target.value
          if (ref.current) ref.current.currentTime = t
          setTime(t)
        }}
      />
      <div className="lb-audio-time">{fmtTime(time)} / {fmtTime(dur)}</div>
      <div className="audio-name">{audio?.name}</div>
    </div>
  )
}

export default function Lightbox({ m, onClose }) {
  const type = inferType(m)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="lb-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        className="lb-content"
        initial={{ y: 20, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 14, opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lb-close" onClick={onClose} title="Close">×</button>
        {type === 'photo' && <PhotoExpand m={m} />}
        {type === 'video' && <VideoExpand m={m} />}
        {type === 'audio' && <AudioExpand m={m} />}
        <div className="lb-meta">
          {m.title && <div className="lb-title">{m.title}</div>}
          <div className="lb-date">{cardDateLabel(m.date)}</div>
          {m.body && <div className="lb-body">{m.body}</div>}
        </div>
      </motion.div>
    </motion.div>
  )
}
