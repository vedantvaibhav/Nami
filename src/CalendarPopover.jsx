import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { toISO, fromISO, MONTHS } from './time.js'
import { icons } from './media.js'
import { Icon } from './MemoryCard.jsx'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export const prettyDate = (iso) => {
  const d = fromISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// Custom calendar popover, portaled so it escapes any overflow-clipping ancestor
// (the dock, the bulk modal). Positioned above `anchor` (a { left, width, top }
// rect from the field that opened it). Shared by the composer and the bulk uploader.
export function CalendarPopover({ value, max, anchor, onChange, onClose }) {
  const sel = fromISO(value)
  const today = fromISO(max)
  const [view, setView] = useState({ y: sel.getFullYear(), m: sel.getMonth() })

  const firstDay = new Date(view.y, view.m, 1).getDay()
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length < 6 * WEEKDAYS.length) cells.push(null) // always 6 rows -> the popover height never changes month-to-month

  const atMaxMonth = view.y === today.getFullYear() && view.m === today.getMonth()
  const prevMonth = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))
  const nextMonth = () => { if (!atMaxMonth) setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })) }

  const isFuture = (d) => new Date(view.y, view.m, d) > today
  const isSelected = (d) => d === sel.getDate() && view.m === sel.getMonth() && view.y === sel.getFullYear()
  const pick = (d) => { if (!isFuture(d)) { onChange(toISO(new Date(view.y, view.m, d))); onClose() } }

  return createPortal(
    <div className="cal-backdrop" onClick={onClose}>
      <motion.div
        className="cal-pop"
        onClick={(e) => e.stopPropagation()}
        style={{
          left: anchor.left,
          width: anchor.width,
          bottom: window.innerHeight - anchor.top + 8, // 8px gap above the field
          transformOrigin: 'bottom center',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      >
        <div className="cal-head">
          <button className="cal-nav icon-btn" onClick={prevMonth} title="Previous month">
            <Icon d={icons.chevronL} size={18} />
          </button>
          <span className="cal-month">{MONTHS[view.m]} {view.y}</span>
          <button
            className="cal-nav icon-btn"
            onClick={nextMonth}
            disabled={atMaxMonth}
            title="Next month"
          >
            <Icon d={icons.chevronR} size={18} />
          </button>
        </div>
        <div className="cal-grid cal-weekdays">
          {WEEKDAYS.map((w, i) => <span key={i} className="cal-wd">{w}</span>)}
        </div>
        <div className="cal-grid cal-days">
          {cells.map((d, i) =>
            d === null ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                className={`cal-day ${isSelected(d) ? 'cal-day-sel' : ''}`}
                disabled={isFuture(d)}
                onClick={() => pick(d)}
              >
                {d}
              </button>
            )
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
