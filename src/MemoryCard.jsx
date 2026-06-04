import { useEffect, useRef, useState } from 'react'
import { motion, Reorder } from 'framer-motion'
import { COLORS, imageURL } from './store.js'
import { cardDateLabel, fromISO, toISO, startOfDay } from './time.js'
import { ACCEPT, icons, inferType, seededBars, seededTilt, videoThumb } from './media.js'

export function useImage(imgId) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let live = true
    if (imgId) imageURL(imgId).then((u) => live && setUrl(u))
    else setUrl(null)
    return () => { live = false }
  }, [imgId])
  return url
}

export const Icon = ({ d, size = 16, stroke = 1.8, className = '' }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d.split(' M').map((p, i) => <path key={i} d={(i === 0 ? '' : 'M') + p} />)}
  </svg>
)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// ---- date chip + minimal month/day picker --------------------------------
function DateChip({ m, color, editable, onSetDate, liveDate }) {
  const [open, setOpen] = useState(false)
  const date = fromISO(liveDate || m.date)
  const today = startOfDay(new Date())
  const year = date.getFullYear()

  const setMonth = (mo) => {
    const maxDay = new Date(year, mo + 1, 0).getDate()
    let d = new Date(year, mo, Math.min(date.getDate(), maxDay))
    if (d > today) d = today
    onSetDate(toISO(d))
  }
  const setDay = (day) => {
    let d = new Date(year, date.getMonth(), day)
    if (d > today) d = today
    onSetDate(toISO(d))
  }

  const monthMax = year === today.getFullYear() ? today.getMonth() : 11
  const dayMax =
    year === today.getFullYear() && date.getMonth() === today.getMonth()
      ? today.getDate()
      : new Date(year, date.getMonth() + 1, 0).getDate()

  return (
    <div className="chip-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        className="card-chip"
        style={{ color: color.text }}
        onClick={() => editable && setOpen(!open)}
      >
        {cardDateLabel(liveDate || m.date)}
      </button>
      {open && editable && (
        <div className="chip-picker">
          <select value={date.getMonth()} onChange={(e) => setMonth(+e.target.value)}>
            {MONTHS.slice(0, monthMax + 1).map((name, i) => (
              <option key={name} value={i}>{name}</option>
            ))}
          </select>
          <select value={date.getDate()} onChange={(e) => setDay(+e.target.value)}>
            {Array.from({ length: dayMax }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button className="chip-done" onClick={() => setOpen(false)}>✓</button>
        </div>
      )}
    </div>
  )
}

// ---- media renderers -------------------------------------------------------
function StackPhoto({ id, seed, i, top }) {
  const url = useImage(id)
  if (!url) return null
  if (top) {
    return (
      <img
        className="card-photo stack-top"
        style={{ transform: `rotate(${seededTilt(seed, 0, 2.5)}deg)` }}
        src={url}
        alt=""
        draggable={false}
      />
    )
  }
  const rot = seededTilt(seed, i, 7)
  return (
    <img
      className="stack-under-img"
      style={{ transform: `rotate(${rot}deg) translate(${i * 7}px, ${i * 9}px)`, zIndex: -i }}
      src={url}
      alt=""
      draggable={false}
    />
  )
}

function PhotoBlock({ m }) {
  const images = m.media.filter((x) => x.kind === 'image')
  const topUrl = useImage(images[0]?.id)
  if (!topUrl) return null
  if (images.length === 1) {
    return <img className="card-photo" src={topUrl} alt={m.title || 'memory'} draggable={false} />
  }
  const under = images.slice(1, 3)
  return (
    <div className="photo-stack">
      {under.map((img, i) => (
        <StackPhoto key={img.id} id={img.id} seed={m.id} i={i + 1} />
      ))}
      <StackPhoto id={images[0].id} seed={m.id} top />
      <span className="stack-count">{images.length}</span>
    </div>
  )
}

function VideoBlock({ m }) {
  const video = m.media.find((x) => x.kind === 'video')
  const url = useImage(video?.id)
  const [thumb, setThumb] = useState(null)
  useEffect(() => {
    let live = true
    if (video && url) videoThumb(video.id, url).then((t) => live && setThumb(t))
    return () => { live = false }
  }, [video?.id, url])
  return (
    <div className="video-thumb">
      {thumb ? <img src={thumb} alt={m.title || 'video'} draggable={false} /> : <div className="video-thumb-empty" />}
      <span className="play-badge"><Icon d={icons.play} size={18} /></span>
    </div>
  )
}

export function AudioBlock({ m, tall = false }) {
  const audio = m.media.find((x) => x.kind === 'audio')
  const url = useImage(audio?.id)
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const bars = seededBars(m.id)

  const toggle = (e) => {
    e.stopPropagation()
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  return (
    <div className={`audio-pill ${tall ? 'audio-pill-tall' : ''}`} onClick={(e) => e.stopPropagation()}>
      {url && <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} />}
      <button className="audio-play" onClick={toggle}>
        <Icon d={playing ? icons.pause : icons.play} size={18} />
      </button>
      <div className="audio-bars">
        {bars.map((h, i) => <span key={i} style={{ height: `${h * 100}%` }} />)}
      </div>
    </div>
  )
}

// ---- edit-mode pieces ------------------------------------------------------
function DropZone({ onFiles, warning }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  return (
    <div
      className={`dropzone ${over ? 'dropzone-over' : ''}`}
      onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      }}
    >
      <Icon d={icons.upload} size={20} className="dropzone-icon" />
      {warning && <div className="dropzone-warning">This file is large and may not save reliably.</div>}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => { onFiles([...e.target.files]); e.target.value = '' }}
      />
    </div>
  )
}

function EditMediaRow({ m }) {
  if (!m.media?.length) return null
  return (
    <div className="edit-media-row">
      {m.media.map((x) => (
        <EditMediaThumb key={x.id} item={x} />
      ))}
    </div>
  )
}

function EditMediaThumb({ item }) {
  const url = useImage(item.kind === 'image' ? item.id : null)
  if (item.kind === 'image' && url) return <img className="edit-thumb" src={url} alt="" />
  return <span className="edit-thumb edit-thumb-file">{item.kind === 'video' ? '▶' : '♪'}</span>
}

// ---- the card --------------------------------------------------------------
export default function MemoryCard({
  m, editing, canDrag,
  onEdit, onChange, onCommit, onCancel, onDelete, onOpen,
  onAttach, onSetDate,
}) {
  const type = inferType(m)
  const color = COLORS[m.color] || COLORS.blue
  const titleRef = useRef(null)

  useEffect(() => {
    if (editing && titleRef.current) {
      titleRef.current.focus()
      titleRef.current.select()
    }
  }, [editing])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit() }
    if (e.key === 'Escape') onCancel()
  }

  const isQuote = type === 'quote'
  const images = (m.media || []).filter((i) => i.kind === 'image')
  const hasMedia = (m.media || []).length > 0

  return (
    <Reorder.Item
      as="div"
      value={m}
      layout
      className={`card ${isQuote ? 'card-quote' : ''} ${editing ? 'card-editing' : ''}`}
      style={isQuote ? undefined : { background: color.bg }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15, ease: 'easeOut' } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      dragListener={canDrag && !editing}
      onClick={(e) => {
        if (editing) return
        if (e.target.closest('button, input, select, textarea, .audio-pill, .chip-picker')) return
        if (type === 'note' || isQuote) onEdit(m.id)
        else onOpen(m.id)
      }}
      whileDrag={{ scale: 1.04, zIndex: 50, boxShadow: '0 14px 32px rgba(20,20,40,0.16)', cursor: 'grabbing' }}
    >
      {!editing && (
        <>
          <button className="card-delete" onClick={(e) => { e.stopPropagation(); onDelete(m.id) }} title="Delete">×</button>
          {canDrag && (
            <span className="card-grip"><Icon d={icons.grip} size={14} /></span>
          )}
        </>
      )}

      {editing ? (
        <>
          <textarea
            ref={titleRef}
            className={isQuote ? 'edit-quote' : 'edit-title'}
            style={isQuote ? undefined : { color: color.text }}
            value={m.title}
            rows={1}
            placeholder={isQuote ? 'A line worth remembering…' : 'Name this moment'}
            onChange={(e) => onChange({ ...m, title: e.target.value })}
            onKeyDown={onKeyDown}
          />
          {!isQuote && (
            <>
              <DateChip m={m} color={color} editable onSetDate={(iso) => onSetDate(m.id, iso)} />
              <EditMediaRow m={m} />
              <DropZone onFiles={(files) => onAttach(m.id, files)} warning={m.warnLarge} />
              <textarea
                className="edit-body"
                value={m.body}
                rows={2}
                placeholder="Add a note (optional)"
                onChange={(e) => onChange({ ...m, body: e.target.value })}
                onKeyDown={onKeyDown}
              />
            </>
          )}
          <div className="edit-toolbar" onClick={(e) => e.stopPropagation()}>
            {!hasMedia && (
              <button
                className={`type-toggle ${isQuote ? 'type-toggle-active' : ''}`}
                onClick={() => onChange({ ...m, type: isQuote ? 'note' : 'quote' })}
                title="Quote style"
              >
                Aa
              </button>
            )}
            <button className="toolbar-delete" onClick={() => onDelete(m.id)} title="Delete">🗑</button>
            <button className="toolbar-done" onClick={onCommit} title="Done">✓</button>
          </div>
        </>
      ) : isQuote ? (
        <div className="quote-text">{m.title || '…'}</div>
      ) : (
        <>
          {m.title && <div className="card-title" style={{ color: color.text }}>{m.title}</div>}
          {type === 'photo' && <PhotoBlock m={m} />}
          {type === 'video' && <VideoBlock m={m} />}
          {type === 'audio' && (
            <>
              <AudioBlock m={m} />
              <div className="audio-name">{m.media.find((i) => i.kind === 'audio')?.name}</div>
            </>
          )}
          {m.body && <div className="card-body">{m.body}</div>}
          {m.saveError && <span className="error-badge" title="Failed to save media">!</span>}
        </>
      )}
    </Reorder.Item>
  )
}
