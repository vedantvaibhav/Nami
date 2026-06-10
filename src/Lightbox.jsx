import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cardDateLabel } from './time.js'
import { fmtTime, icons, inferType, seededBars } from './media.js'
import { Icon, useImage } from './MemoryCard.jsx'

// ---- photo: overlapping collage of prints (Amie "Meet Eric/Antoine" style) ----
// slot layouts per image count: % positions of each print's centre + rotation
const COLLAGE = {
  1: [{ left: 50, top: 50, w: 72, r: -2, z: 1 }],
  2: [
    { left: 40, top: 44, w: 58, r: -4, z: 2 },
    { left: 63, top: 58, w: 54, r: 3, z: 1 },
  ],
  3: [
    { left: 37, top: 35, w: 54, r: -3, z: 2 },
    { left: 66, top: 41, w: 52, r: 3, z: 1 },
    { left: 45, top: 69, w: 50, r: -5, z: 3 },
  ],
  4: [
    { left: 34, top: 33, w: 50, r: -3, z: 2 },
    { left: 67, top: 36, w: 48, r: 4, z: 1 },
    { left: 38, top: 69, w: 46, r: -5, z: 3 },
    { left: 69, top: 66, w: 46, r: 6, z: 2 },
  ],
}

function PhotoExpand({ m }) {
  const images = m.media.filter((x) => x.kind === 'image').slice(0, 4)
  const slots = COLLAGE[images.length] || COLLAGE[4]
  return (
    <div className="lb-collage">
      {images.map((img, i) => (
        <CollageImg key={img.id} id={img.id} i={i} slot={slots[i]} />
      ))}
    </div>
  )
}

function CollageImg({ id, i, slot }) {
  const url = useImage(id)
  if (!url) return null
  return (
    <motion.img
      className="lb-collage-img"
      src={url}
      alt=""
      style={{ left: `${slot.left}%`, top: `${slot.top}%`, width: `${slot.w}%`, zIndex: slot.z }}
      initial={{ opacity: 0, scale: 0.82, rotate: 0, x: '-50%', y: '-50%' }}
      animate={{ opacity: 1, scale: 1, rotate: slot.r, x: '-50%', y: '-50%' }}
      transition={{ type: 'spring', stiffness: 240, damping: 22, delay: 0.05 * i }}
    />
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

  // photos show just the images + a close button at the bottom (no text)
  if (type === 'photo') {
    return (
      <motion.div
        className="lb-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
      >
        <div className="lb-photo-wrap" onClick={(e) => e.stopPropagation()}>
          <PhotoExpand m={m} />
          <button className="lb-close-bottom" onClick={onClose} title="Close">
            <Icon d={icons.close} size={20} />
          </button>
        </div>
      </motion.div>
    )
  }

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
        {type === 'video' && <VideoExpand m={m} />}
        {type === 'audio' && <AudioExpand m={m} />}
        {type === 'video' && (
          <div className="lb-meta">
            {m.title && <div className="lb-title">{m.title}</div>}
            <div className="lb-date">{cardDateLabel(m.date)}</div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
