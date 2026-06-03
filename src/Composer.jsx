import { useEffect, useRef, useState } from 'react'
import { saveImage } from './store.js'
import { toISO } from './time.js'
import { ACCEPT, icons, kindFromMime, MAX_SAFE_BYTES } from './media.js'
import { Icon, useImage } from './MemoryCard.jsx'

function Thumb({ item, onRemove }) {
  const url = useImage(item.kind === 'image' ? item.id : null)
  return (
    <div className="composer-thumb">
      {item.kind === 'image' && url ? (
        <img src={url} alt="" />
      ) : (
        <span className="composer-thumb-file">{item.kind === 'video' ? '▶' : '♪'}</span>
      )}
      <button className="composer-thumb-x" onClick={() => onRemove(item.id)} title="Remove">×</button>
    </div>
  )
}

export default function Composer({ active, defaultDate, onClose, onAdd }) {
  const todayISO = toISO(new Date())
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState(defaultDate > todayISO ? todayISO : defaultDate)
  const [time, setTime] = useState('')
  const [media, setMedia] = useState([])
  const [warn, setWarn] = useState(false)
  const titleRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => titleRef.current?.focus(), 280) // after morph settles
    return () => clearTimeout(t)
  }, [active])

  const attach = async (files) => {
    const accepted = files.map((f) => ({ file: f, kind: kindFromMime(f.type) })).filter((x) => x.kind)
    if (accepted.some(({ file }) => file.size > MAX_SAFE_BYTES)) setWarn(true)
    for (const { file, kind } of accepted) {
      const id = crypto.randomUUID()
      await saveImage(id, file)
      setMedia((m) => [...m, { id, kind, name: file.name }])
    }
  }

  const canAdd = title.trim() || media.length
  const submit = () => {
    if (!canAdd) return
    onAdd({ title: title.trim(), body: body.trim(), date, time, media })
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
  }

  return (
    <div
      className="composer"
      onKeyDown={onKeyDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); attach([...e.dataTransfer.files]) }}
    >
      <div className="composer-head">
        <span className="composer-eyebrow">New memory</span>
        <button className="composer-close" onClick={onClose} title="Close">×</button>
      </div>

      <input
        ref={titleRef}
        className="composer-title"
        placeholder="Name this moment"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <textarea
        className="composer-body"
        placeholder="Add a note (optional)"
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      {(media.length > 0 || warn) && (
        <div className="composer-media">
          {media.map((item) => (
            <Thumb key={item.id} item={item} onRemove={(id) => setMedia((m) => m.filter((x) => x.id !== id))} />
          ))}
          {warn && <div className="composer-warn">Large file — may not save reliably.</div>}
        </div>
      )}

      <div className="composer-row">
        <label className="composer-field">
          <span>Date</span>
          <input type="date" max={todayISO} value={date} onChange={(e) => setDate(e.target.value || todayISO)} />
        </label>
        <label className="composer-field">
          <span>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button className="composer-attach" onClick={() => fileRef.current?.click()} title="Attach media">
          <Icon d={icons.upload} size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => { attach([...e.target.files]); e.target.value = '' }}
        />
      </div>

      <button className="composer-add" disabled={!canAdd} onClick={submit}>Add to timeline</button>
    </div>
  )
}
