import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion'
import MemoryCard, { Icon } from './MemoryCard.jsx'
import YearOrbit from './YearOrbit.jsx'
import Lightbox from './Lightbox.jsx'
import Composer from './Composer.jsx'
import { seedMemories } from './seed.js'
import { loadMemories, saveMemories, saveImage, deleteImage, COLOR_KEYS } from './store.js'
import { icons, kindFromMime, MAX_SAFE_BYTES } from './media.js'
import { ZOOMS, getRange, getMarkers, xForDate, dateAtX, markerLabel, addDays, toISO, unitStart, colUnitDays, renderEnd, DAY } from './time.js'

const MARKER_H = 130 // px reserved at top for date markers
// One shared, unhurried spring for everything the pill does — slow and liquidy
const LIQUID = { type: 'spring', stiffness: 170, damping: 26, mass: 1 }
// The dock morph — each direction tuned separately
const SHELL_OPEN = { type: 'spring', stiffness: 250, damping: 30, mass: 1 }      // lively, settles a bit quicker
const SHELL_CLOSE = { type: 'spring', stiffness: 190, damping: 32, mass: 1.05 }  // slow, liquid settle
const clampY = (y) => Math.max(MARKER_H + 20, Math.min(y, window.innerHeight - 220))

// A card is worth keeping if it has a title, body, or any media
const isEmpty = (m) => !m.title?.trim() && !m.body?.trim() && !(m.media?.length)

export default function App() {
  const [memories, setMemories] = useState(null)
  const [zoomIdx, setZoomIdx] = useState(2) // open in Years view on load
  const [editingId, setEditingId] = useState(null)
  const editingIdRef = useRef(null)
  // keep a ref in lockstep so handlers never read a stale editingId closure
  const setEditing = useCallback((id) => { editingIdRef.current = id; setEditingId(id) }, [])
  const [openId, setOpenId] = useState(null) // lightbox
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKey, setComposerKey] = useState(0) // remount composer fresh on each open
  const toolbarRef = useRef(null)
  const composerRef = useRef(null)
  const sizeMorph = useRef(false) // animate the shell size only during a composer open/close
  const [dockDims, setDockDims] = useState({ toolbarW: 462, composerH: 290 })
  const [dropHint, setDropHint] = useState(null) // clientX while dragging a file over
  const scrollRef = useRef(null)
  const colorCursor = useRef(Math.floor(Math.random() * COLOR_KEYS.length))

  const zoom = ZOOMS[zoomIdx]

  // ---- load / persist -------------------------------------------------
  useEffect(() => {
    loadMemories().then(async (saved) => {
      const list = saved && saved.length ? saved : await seedMemories()
      // migrate legacy single-image cards (imgId) to the media[] model
      setMemories(
        list.map((m) =>
          m.media
            ? m
            : { ...m, media: m.imgId ? [{ id: m.imgId, kind: 'image', name: 'image' }] : [] }
        )
      )
    })
  }, [])

  // debounced autosave (800ms) — persists every non-empty card, drafts included,
  // so media attached before commit survives a reload
  useEffect(() => {
    if (!memories) return
    const t = setTimeout(() => {
      saveMemories(memories.filter((m) => !isEmpty(m)).map(({ draft, warnLarge, ...keep }) => keep))
    }, 800)
    return () => clearTimeout(t)
  }, [memories])

  // ---- timeline geometry ----------------------------------------------
  const range = useMemo(() => getRange(memories || []), [memories])
  // the canvas extends to the end of today's column at this zoom (full
  // current month/year), but interactions clamp to today
  const canvasEnd = useMemo(() => renderEnd(zoom.id), [zoom.id])
  const widthPx = Math.ceil(((canvasEnd - range.start) / DAY) * zoom.pxPerDay)
  const markers = useMemo(
    () => getMarkers(range.start, canvasEnd, zoom.id),
    [range.start.getTime(), canvasEnd.getTime(), zoom.id]
  )

  // start at the very end — today is the rightmost column.
  // useLayoutEffect so the pill is sized correctly BEFORE first paint
  // (no full-width "Days" flash on appearance)
  const centeredOnce = useRef(false)
  useLayoutEffect(() => {
    if (memories && !centeredOnce.current && scrollRef.current) {
      centeredOnce.current = true
      const el = scrollRef.current
      el.scrollLeft = el.scrollWidth
      syncThumb() // place the pill instantly on load — no liquid morph on appearance
    }
  }, [memories])

  // ---- scrollbar thumb (the zoom pill IS the scrollbar) -----------------
  const TRACK_W = 280
  const thumbX = useMotionValue(0)
  const thumbWmv = useMotionValue(TRACK_W)
  const thumbWTarget = useRef(TRACK_W)
  const thumbDrag = useRef(null)

  const zoomMorphing = useRef(false)
  const morphAnim = useRef(null)

  const syncThumb = useCallback((smooth = false) => {
    const el = scrollRef.current
    // no scroller (orbit view) -> pill fills the whole track
    const frac = el ? el.clientWidth / el.scrollWidth : 1
    const w = Math.max(64, Math.min(TRACK_W, Math.round(TRACK_W * frac)))
    thumbWTarget.current = w
    const maxScroll = el ? el.scrollWidth - el.clientWidth : 0
    const p = el && maxScroll > 0 ? el.scrollLeft / maxScroll : 0
    const target = p * (TRACK_W - w)
    if (smooth) {
      // ONE animation drives both width and position, interpolating the
      // pill as a single shape — x + width stays bounded by construction,
      // so the pill physically cannot leave the track mid-morph
      zoomMorphing.current = true
      morphAnim.current?.stop() // retarget cleanly if a morph is already in flight
      const from = { x: thumbX.get(), w: thumbWmv.get() }
      morphAnim.current = animate(0, 1, {
        ...LIQUID,
        onUpdate: (p) => {
          thumbX.set(from.x + (target - from.x) * p)
          thumbWmv.set(from.w + (w - from.w) * p)
        },
        onComplete: () => { zoomMorphing.current = false },
      })
    } else if (!zoomMorphing.current) {
      // don't stomp an in-flight zoom morph — the scroll restore fires
      // a native scroll event that would otherwise snap the pill
      thumbWmv.set(w)
      thumbX.set(target)
    }
  }, [thumbX, thumbWmv])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => syncThumb()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [memories, zoomIdx, syncThumb])

  const onThumbDown = (e) => {
    e.preventDefault()
    thumbDrag.current = { x: e.clientX, scroll: scrollRef.current.scrollLeft }
    e.target.setPointerCapture(e.pointerId)
  }
  const onThumbMove = (e) => {
    if (!thumbDrag.current) return
    const el = scrollRef.current
    const room = TRACK_W - thumbWTarget.current
    if (room <= 0) return
    const maxScroll = el.scrollWidth - el.clientWidth
    el.scrollLeft = thumbDrag.current.scroll + ((e.clientX - thumbDrag.current.x) / room) * maxScroll
  }
  const onThumbUp = () => { thumbDrag.current = null }

  // vertical wheel -> horizontal scroll (mouse users)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [memories, zoomIdx])

  const pendingCenter = useRef(null)
  const setZoomKeepCenter = (idx) => {
    const el = scrollRef.current
    if (el) pendingCenter.current = (el.scrollLeft + el.clientWidth / 2) / zoom.pxPerDay
    setZoomIdx(idx)
  }

  // restore the anchored center right after the canvas re-renders at the new
  // scale — and only THEN morph the pill, so it lands where the view actually is
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && pendingCenter.current !== null) {
      el.scrollLeft = pendingCenter.current * zoom.pxPerDay - el.clientWidth / 2
      pendingCenter.current = null
    }
    syncThumb(true)
  }, [zoomIdx, widthPx, syncThumb])

  // ---- mutations -------------------------------------------------------
  const update = (next) => setMemories((ms) => ms.map((m) => (m.id === next.id ? next : m)))

  const removeMemory = useCallback((id) => {
    setMemories((ms) => {
      const m = ms.find((x) => x.id === id)
      m?.media?.forEach((x) => deleteImage(x.id))
      if (m?.imgId) deleteImage(m.imgId)
      return ms.filter((x) => x.id !== id)
    })
    if (editingIdRef.current === id) setEditing(null)
    setOpenId((cur) => (cur === id ? null : cur))
  }, [setEditing])

  // id is passed in explicitly by the card being edited — never from a closure/ref
  const commitEditing = useCallback((id = editingIdRef.current) => {
    if (!id) return
    setMemories((ms) =>
      ms
        .filter((m) => !(m.id === id && isEmpty(m))) // discard empty
        .map((m) => (m.id === id ? { ...m, draft: false } : m))
    )
    if (editingIdRef.current === id) setEditing(null)
  }, [setEditing])

  const cancelEditing = useCallback((id = editingIdRef.current) => {
    setMemories((ms) => {
      const m = ms.find((x) => x.id === id)
      if (m?.draft) m.media?.forEach((x) => deleteImage(x.id))
      return ms.filter((x) => !(x.id === id && x.draft))
    })
    if (editingIdRef.current === id) setEditing(null)
  }, [setEditing])

  const cycleColor = (id) =>
    setMemories((ms) =>
      ms.map((m) =>
        m.id === id ? { ...m, color: COLOR_KEYS[(COLOR_KEYS.indexOf(m.color) + 1) % COLOR_KEYS.length] } : m
      )
    )

  const setCardDate = (id, iso) =>
    setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, date: iso } : m)))

  const nextColor = () => COLOR_KEYS[colorCursor.current++ % COLOR_KEYS.length]
  const todayISO = () => toISO(new Date())

  // Anchor date for a new card: today if its column is on-screen, else the
  // nearest visible day. Timeline always reaches today, so today is the default.
  const anchorDate = () => {
    const el = scrollRef.current
    if (!el) return todayISO()
    const todayX = xForDate(todayISO(), range.start, zoom.pxPerDay)
    const visible = todayX >= el.scrollLeft && todayX <= el.scrollLeft + el.clientWidth
    if (visible) return todayISO()
    const centerX = el.scrollLeft + el.clientWidth / 2
    const iso = dateAtX(centerX, range.start, zoom.pxPerDay)
    return iso > todayISO() ? todayISO() : iso
  }

  const blankCard = (date) => ({
    id: crypto.randomUUID(),
    type: 'note',
    title: '',
    body: '',
    date,
    color: nextColor(),
    y: clampY(window.innerHeight * 0.4),
    tilt: 0,
    media: [],
    draft: true,
  })

  // The + button: save any in-progress card, then spawn a fresh blank in edit mode
  const addCard = (preMedia) => {
    // Years view has no editable timeline yet — wiring TBD; show button only
    if (zoom.id === 'years') return
    if (editingIdRef.current) commitEditing()
    const card = blankCard(anchorDate())
    if (preMedia) card.media = preMedia
    setMemories((ms) => [...ms, card])
    setEditing(card.id)
    setOpenId(null)
  }

  // commit a finished memory from the morphing composer form
  const addFromComposer = ({ title, body, date, time, media }) => {
    const card = {
      id: crypto.randomUUID(),
      type: 'note',
      title,
      body,
      date,
      time: time || null,
      media: media || [],
      color: nextColor(),
      y: clampY(window.innerHeight * 0.4),
      tilt: 0,
    }
    setMemories((ms) => [...ms, card])
    sizeMorph.current = true
    setComposerOpen(false)
  }

  const openComposer = () => {
    if (editingIdRef.current) commitEditing()
    setOpenId(null)
    setComposerKey((k) => k + 1) // fresh form each open
    sizeMorph.current = true
    setComposerOpen(true)
  }

  const closeComposer = () => {
    sizeMorph.current = true
    setComposerOpen(false)
  }

  // measure toolbar + composer natural sizes so the shell can animate real
  // width/height (no transform-scale distortion, no unmount cut on close)
  useLayoutEffect(() => {
    const measure = () => {
      const tw = toolbarRef.current?.offsetWidth
      const ch = composerRef.current?.offsetHeight
      setDockDims((d) => ({ toolbarW: tw || d.toolbarW, composerH: ch || d.composerH }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (toolbarRef.current) ro.observe(toolbarRef.current)
    if (composerRef.current) ro.observe(composerRef.current)
    return () => ro.disconnect()
  }, [composerKey, zoomIdx, memories])

  // Persist dropped/picked/pasted files as blobs, attach refs to the card
  const attachFiles = async (id, files) => {
    const accepted = files.map((f) => ({ file: f, kind: kindFromMime(f.type) })).filter((x) => x.kind)
    if (!accepted.length) return
    const tooLarge = accepted.some(({ file }) => file.size > MAX_SAFE_BYTES)
    setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, warnLarge: tooLarge } : m)))

    for (const { file, kind } of accepted) {
      const mediaId = crypto.randomUUID()
      try {
        await saveImage(mediaId, file)
        setMemories((ms) =>
          ms.map((m) =>
            m.id === id
              ? { ...m, saveError: false, media: [...(m.media || []), { id: mediaId, kind, name: file.name }] }
              : m
          )
        )
      } catch {
        setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, saveError: true } : m)))
      }
    }
  }

  const moveCard = (id, dx, dy) => {
    setMemories((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m
        const days = Math.round(dx / zoom.pxPerDay)
        const d = addDays(new Date(m.date + 'T00:00'), days)
        let iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (iso > todayISO()) iso = todayISO() // no future memories
        return { ...m, date: iso, y: clampY(m.y + dy) }
      })
    )
  }

  // live date label while dragging a card horizontally
  const dragDateFor = (m, dx) => {
    const days = Math.round(dx / zoom.pxPerDay)
    const d = addDays(new Date(m.date + 'T00:00'), days)
    let iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (iso > todayISO()) iso = todayISO()
    return iso
  }

  // ---- canvas interactions ----------------------------------------------
  const onCanvasClick = (e) => {
    if (e.target !== e.currentTarget) return
    if (editingIdRef.current) commitEditing()
  }

  const onDrop = async (e) => {
    e.preventDefault()
    setDropHint(null)
    if (!scrollRef.current) return // orbit view: no drop target
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    if (editingIdRef.current) return attachFiles(editingIdRef.current, files)
    const card = blankCard(anchorDate())
    setMemories((ms) => [...ms, card])
    setEditing(card.id)
    attachFiles(card.id, files)
  }

  // paste an image -> attach to the editing card, else spawn a new card with it
  useEffect(() => {
    const onPaste = async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      const file = item.getAsFile()
      if (editingIdRef.current) return attachFiles(editingIdRef.current, [file])
      const card = blankCard(anchorDate())
      setMemories((ms) => [...ms, card])
      setEditing(card.id)
      attachFiles(card.id, [file])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  if (!memories) return <div className="loading">…</div>

  const openCard = memories.find((m) => m.id === openId)

  return (
    <div
      className="viewport"
      onDragOver={(e) => { e.preventDefault(); setDropHint(e.clientX) }}
      onDragLeave={() => setDropHint(null)}
      onDrop={onDrop}
    >
      {zoom.id === 'years' ? (
        <YearOrbit memories={memories} year={new Date().getFullYear()} />
      ) : (
      <div className="scroller" ref={scrollRef}>
        <div className="canvas" style={{ width: widthPx }} onClick={onCanvasClick}>
          <div className="topline" />
          {markers.map((d, i) => {
            const x = Math.round(((d - range.start) / DAY) * zoom.pxPerDay)
            const nextX =
              i + 1 < markers.length
                ? Math.round(((markers[i + 1] - range.start) / DAY) * zoom.pxPerDay)
                : widthPx
            return (
              <div key={d.getTime()}>
                <div className="gridline" style={{ left: x }} />
                <div className="marker" style={{ left: (x + nextX) / 2 }}>
                  {zoom.id === 'years' ? (
                    <div className="marker-day">{d.getFullYear()}</div>
                  ) : (
                    <>
                      <div className="marker-day">{markerLabel(d, zoom.id)}</div>
                      <div className="marker-year">{d.getFullYear()}</div>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          <AnimatePresence>
            {memories.map((m) => {
              // cards snap into their day/month/year column, Amie-style:
              // left edge at column start + inset, width fits the column
              const colX = xForDate(unitStart(m.date, zoom.id), range.start, zoom.pxPerDay)
              const colEnd = Math.min(
                xForDate(unitStart(m.date, zoom.id), range.start, zoom.pxPerDay) +
                  Math.round(colUnitDays(m.date, zoom.id) * zoom.pxPerDay),
                widthPx
              )
              const cardW = Math.min(colEnd - colX - 16, 400)
              return (
              <MemoryCard
                key={m.id}
                m={m}
                x={colX + 8}
                w={cardW}
                pxPerDay={zoom.pxPerDay}
                editing={m.id === editingId}
                onEdit={setEditing}
                onChange={update}
                onCommit={() => commitEditing(m.id)}
                onCancel={() => cancelEditing(m.id)}
                onDelete={removeMemory}
                onMove={moveCard}
                onOpen={setOpenId}
                onAttach={attachFiles}
                onCycleColor={cycleColor}
                onSetDate={setCardDate}
                dragDateFor={dragDateFor}
              />
              )
            })}
          </AnimatePresence>
        </div>
      </div>
      )}

      {dropHint !== null && (
        <div className="drop-line" style={{ left: dropHint }}>
          <span className="drop-chip">
            {markerLabel(
              new Date(
                dateAtX(dropHint + (scrollRef.current?.scrollLeft || 0), range.start, zoom.pxPerDay) + 'T00:00'
              ),
              'days'
            )}
          </span>
        </div>
      )}

      <div className="dock-wrap">
        <motion.div
          className={`dock-shell ${composerOpen ? 'dock-shell-open' : ''}`}
          initial={{ y: 20, opacity: 0 }}
          animate={{
            y: 0,
            opacity: 1,
            width: composerOpen ? 440 : dockDims.toolbarW,
            height: composerOpen ? dockDims.composerH : 48,
          }}
          style={{ borderRadius: 24 }}
          transition={{
            y: { duration: 0.3, ease: 'easeOut' },
            opacity: { duration: 0.3, ease: 'easeOut' },
            // size only animates during an actual open/close morph; on load /
            // self-measurement it snaps instantly so the bar just appears
            width: sizeMorph.current ? (composerOpen ? SHELL_OPEN : SHELL_CLOSE) : { duration: 0 },
            height: sizeMorph.current ? (composerOpen ? SHELL_OPEN : SHELL_CLOSE) : { duration: 0 },
          }}
          onAnimationComplete={() => { sizeMorph.current = false }}
        >
          {/* toolbar face */}
          <motion.div
            ref={toolbarRef}
            className="dock-face zoombar"
            animate={{ opacity: composerOpen ? 0 : 1 }}
            transition={{ duration: composerOpen ? 0.12 : 0.32, delay: composerOpen ? 0 : 0.16, ease: 'easeOut' }}
            style={{ pointerEvents: composerOpen ? 'none' : 'auto' }}
          >
            <button
              disabled={zoomIdx === ZOOMS.length - 1}
              onClick={() => setZoomKeepCenter(zoomIdx + 1)}
              title="Zoom out"
            >−</button>
            <div className="zoom-track" style={{ width: TRACK_W }}>
              <motion.div
                className="zoom-pill"
                style={{ x: thumbX, width: thumbWmv }}
                onPointerDown={onThumbDown}
                onPointerMove={onThumbMove}
                onPointerUp={onThumbUp}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={zoom.id}
                    initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
                    transition={{ duration: 0.45, ease: [0.45, 0, 0.15, 1] }}
                  >
                    {zoom.id === 'years' ? `${zoom.label} (${new Date().getFullYear()})` : zoom.label}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            </div>
            <button
              disabled={zoomIdx === 0}
              onClick={() => setZoomKeepCenter(zoomIdx - 1)}
              title="Zoom in"
            >+</button>

            <span className="zoombar-divider" />
            <button className="add-cta" onClick={openComposer}>Add</button>
          </motion.div>

          {/* composer face */}
          <motion.div
            ref={composerRef}
            className="dock-face dock-composer"
            animate={{ opacity: composerOpen ? 1 : 0 }}
            transition={{ duration: composerOpen ? 0.2 : 0.14, delay: composerOpen ? 0.26 : 0, ease: 'easeOut' }}
            style={{ pointerEvents: composerOpen ? 'auto' : 'none' }}
          >
            <Composer
              key={composerKey}
              active={composerOpen}
              defaultDate={anchorDate()}
              onClose={closeComposer}
              onAdd={addFromComposer}
            />
          </motion.div>
        </motion.div>
      </div>

      <AnimatePresence>
        {openCard && <Lightbox key={openCard.id} m={openCard} onClose={() => setOpenId(null)} />}
      </AnimatePresence>
    </div>
  )
}
