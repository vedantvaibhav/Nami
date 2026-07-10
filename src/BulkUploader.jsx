import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toISO } from './time.js'

// Full-screen takeover for placing several dropped/selected photos onto the
// timeline at once: a thumbnail grid where each photo gets its own date before
// being committed. Files here are raw File objects (not yet uploaded), so
// thumbnails come from local object URLs (revoked on unmount).
export default function BulkUploader({ files, onClose, onCommit }) {
  const today = toISO(new Date())
  const [dates, setDates] = useState(() => files.map(() => today))
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  const cols = files.length <= 4 ? 2 : 3

  const commit = () => {
    onCommit(files.map((file, i) => ({ file, date: dates[i] })))
    onClose()
  }

  return (
    <motion.div
      className="bulk-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="bulk-panel">
        <h2 className="bulk-title">Place your photos</h2>
        <div className="bulk-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {files.map((f, i) => (
            <div className="bulk-item" key={i}>
              <img className="bulk-thumb" src={urls[i]} alt="" draggable={false} />
              <input
                className="bulk-date"
                type="date"
                max={today}
                value={dates[i]}
                onChange={(e) =>
                  setDates((d) => d.map((v, j) => (j === i ? (e.target.value || today) : v)))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="bulk-bar">
        <button className="bulk-cancel" onClick={onClose}>Cancel</button>
        <button className="bulk-add" onClick={commit}>Add to timeline</button>
      </div>
    </motion.div>
  )
}
