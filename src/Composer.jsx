import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { saveImageMedia, cachePreview, COLORS, COLOR_KEYS, randomColorKey } from './store.js'
import { toISO } from './time.js'
import { ACCEPT, icons, kindFromMime, MAX_SAFE_BYTES } from './media.js'
import { Icon, useThumb } from './MemoryCard.jsx'
import { CalendarPopover, prettyDate } from './CalendarPopover.jsx'

function Thumb({ item, onRemove }) {
  const url = useThumb(item.kind === 'image' ? item.id : null)
  return (
    <div className="cmp-thumb">
      {item.kind === 'image' && url ? (
        <img src={url} alt="" />
      ) : (
        <span className="cmp-thumb-file">{item.kind === 'video' ? '▶' : '♪'}</span>
      )}
      <button className="cmp-thumb-x" onClick={(e) => { e.stopPropagation(); onRemove(item.id) }} title="Remove">
        <Icon d={icons.close} size={11} stroke={2.4} />
      </button>
    </div>
  )
}

export default function Composer({ active, defaultDate, editing, onClose, onAdd, notice }) {
  const todayISO = toISO(new Date())
  // when editing an existing memory, pre-fill from it (the composer is remounted
  // per open via `key`, so these initial values are correct each time)
  const [title, setTitle] = useState(editing?.title || '')
  const [body, setBody] = useState(editing?.body || '')
  const [date, setDate] = useState(() => {
    const d = editing?.date || defaultDate
    return d > todayISO ? todayISO : d
  })
  const [media, setMedia] = useState(editing?.media || [])
  // editing keeps the card's colour; a new card defaults to a random one (picked
  // once on open), and the swatch row lets the user change it either way
  const [color, setColor] = useState(() => editing?.color || randomColorKey())
  const [warn, setWarn] = useState(false)
  const [over, setOver] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const titleRef = useRef(null)
  const fileRef = useRef(null)
  const dateBtnRef = useRef(null)

  const toggleCal = () => {
    const r = dateBtnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ left: r.left, width: r.width, top: r.top })
    setCalOpen((o) => !o)
  }

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => titleRef.current?.focus(), 280)
    return () => clearTimeout(t)
  }, [active])

  const attach = async (files) => {
    const accepted = files.map((f) => ({ file: f, kind: kindFromMime(f.type) })).filter((x) => x.kind)
    if (accepted.some(({ file }) => file.size > MAX_SAFE_BYTES)) setWarn(true)
    let imgRoom = 4 - media.filter((x) => x.kind === 'image').length // cap images at 4
    for (const { file, kind } of accepted) {
      if (kind === 'image') {
        if (imgRoom <= 0) continue
        imgRoom--
      }
      const id = crypto.randomUUID()
      cachePreview(id, file, kind)                 // show it instantly from the local file
      setMedia((m) => [...m, { id, kind, name: file.name }])
      saveImageMedia(id, file, kind).catch(() => setWarn(true)) // upload in the background
    }
  }

  const canAdd = title.trim() || media.length
  const submit = () => {
    if (!canAdd) return
    onAdd({ title: title.trim(), body: body.trim(), date, media, color })
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
  }

  return (
    <div className="composer" onKeyDown={onKeyDown}>
      <div className="cmp-titlerow">
        <input
          ref={titleRef}
          className="cmp-title"
          placeholder="Name your memory"
          maxLength={60}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="cmp-close icon-btn" onClick={onClose} title="Close">
          <Icon d={icons.close} size={18} />
        </button>
      </div>

      <input
        className="cmp-note"
        type="text"
        placeholder="Add note"
        maxLength={120}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      {/* big upload block */}
      <div
        className={`cmp-upload ${over ? 'cmp-upload-over' : ''} ${media.length ? 'cmp-upload-filled' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); attach([...e.dataTransfer.files]) }}
      >
        {media.length > 0 ? (
          <div className="cmp-media">
            {media.map((item) => (
              <Thumb key={item.id} item={item} onRemove={(id) => setMedia((m) => m.filter((x) => x.id !== id))} />
            ))}
            <span className="cmp-media-add"><Icon d={icons.plus} size={20} /></span>
          </div>
        ) : (
          <div className="cmp-upload-empty">
            <Icon d={icons.upload} size={26} className="cmp-upload-icon" />
            <span className="cmp-upload-text">Add photos, video or audio</span>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => { attach([...e.target.files]); e.target.value = '' }}
        />
      </div>
      {warn && <div className="cmp-warn">Some files couldn’t be added — try a smaller file.</div>}

      {/* date with custom calendar */}
      <button ref={dateBtnRef} type="button" className="cmp-date" onClick={toggleCal}>
        <span className="cmp-date-value">{prettyDate(date)}</span>
        <Icon d={icons.calendar} size={18} className="cmp-date-icon" />
      </button>
      <AnimatePresence>
        {calOpen && anchor && (
          <CalendarPopover
            value={date}
            max={todayISO}
            anchor={anchor}
            onChange={setDate}
            onClose={() => setCalOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* card colour */}
      <div className="cmp-colors">
        {COLOR_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={`cmp-swatch ${color === k ? 'cmp-swatch-sel' : ''}`}
            style={{ background: COLORS[k].bg, color: COLORS[k].text }}
            onClick={() => setColor(k)}
            title={k}
          />
        ))}
      </div>

      <div className="cmp-add-wrap">
        {/* transient toast that pops up right above the CTA (e.g. day full) */}
        <AnimatePresence>
          {notice && (
            <motion.div
              className={`cmp-toast cmp-toast-${notice.level}`}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            >
              {notice.msg}
            </motion.div>
          )}
        </AnimatePresence>
        <button className="cmp-add" disabled={!canAdd} onClick={submit}>{editing ? 'Save' : 'Add to Timeline'}</button>
      </div>
    </div>
  )
}
