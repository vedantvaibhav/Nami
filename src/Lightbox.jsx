import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cardDateLabel } from './time.js'
import { fmtTime, icons, inferType, seededBars } from './media.js'
import { Icon, useImage } from './MemoryCard.jsx'

// ---- photo stack: big active image + fan-in thumbnail strip ----
function PhotoExpand({ m }) {
  const images = m.media.filter((x) => x.kind === 'image')
  const [activeId, setActiveId] = useState(images[0]?.id)
  const mainUrl = useImage(activeId)
  return (
    <>
      <div className="lb-main">
        {mainUrl && (
          <motion.img
            key={activeId}
            initial={{ opacity: 0.3, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            src={mainUrl}
            alt={m.title || 'memory'}
          />
        )}
      </div>
      {images.length > 1 && (
        <motion.div
          className="lb-strip"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } } }}
        >
          {images.map((img, i) => (
            <StripThumb key={img.id} id={img.id} index={i} active={img.id === activeId} onPick={() => setActiveId(img.id)} />
          ))}
        </motion.div>
      )}
    </>
  )
}

function StripThumb({ id, index, active, onPick }) {
  const url = useImage(id)
  if (!url) return null
  return (
    <motion.button
      className={`lb-thumb ${active ? 'lb-thumb-active' : ''}`}
      onClick={onPick}
      variants={{
        hidden: { opacity: 0, scale: 0.5, rotate: index % 2 ? 8 : -8, y: 14 },
        show: { opacity: 1, scale: 1, rotate: 0, y: 0 },
      }}
      transition={{ type: 'spring', stiffness: 360, damping: 24 }}
      whileHover={{ y: -3 }}
    >
      <img src={url} alt="" />
    </motion.button>
  )
}

// ---- video: fills the lightbox, autoplays muted, persistent volume toggle ----
function VideoExpand({ m }) {
  const video = m.media.find((x) => x.kind === 'video')
  const url = useImage(video?.id)
  const ref = useRef(null)
  const [muted, setMuted] = useState(true)
  return (
    <div className="lb-main lb-video">
      {url && <video ref={ref} src={url} autoPlay loop playsInline muted={muted} />}
      <button
        className="lb-volume"
        onClick={() => setMuted((mu) => !mu)}
        title={muted ? 'Unmute' : 'Mute'}
      >
        <Icon d={muted ? icons.mute : icons.volume} size={20} />
      </button>
    </div>
  )
}

// ---- audio: Amie-style player — waveform with a centred play/pause ----
function AudioExpand({ m }) {
  const audio = m.media.find((x) => x.kind === 'audio')
  const url = useImage(audio?.id)
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const bars = seededBars(m.id, 56)

  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }
  const progress = dur ? time / dur : 0

  return (
    <div className="lb-audio">
      {url && (
        <audio
          ref={ref}
          src={url}
          onTimeUpdate={(e) => setTime(e.target.currentTime)}
          onLoadedMetadata={(e) => setDur(e.target.duration)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <div className="lb-wave">
        {bars.map((h, i) => (
          <span key={i} style={{ height: `${h * 100}%`, opacity: progress > i / bars.length ? 1 : 0.32 }} />
        ))}
        <button className="lb-wave-play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
          <Icon d={playing ? icons.pause : icons.play} size={22} />
        </button>
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
      <div className="lb-audio-foot">
        <span className="lb-audio-name">{m.title || audio?.name}</span>
        <span className="lb-audio-time">{fmtTime(time)} / {fmtTime(dur)}</span>
      </div>
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

  const showMeta = type !== 'audio' // audio shows its own name/time row

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
        <button className="lb-close icon-btn" onClick={onClose} title="Close">
          <Icon d={icons.close} size={18} />
        </button>
        {type === 'photo' && <PhotoExpand m={m} />}
        {type === 'video' && <VideoExpand m={m} />}
        {type === 'audio' && <AudioExpand m={m} />}
        {showMeta && (
          <div className="lb-meta">
            {m.title && <div className="lb-title">{m.title}</div>}
            <div className="lb-date">{cardDateLabel(m.date)}</div>
            {m.body && <div className="lb-body">{m.body}</div>}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
