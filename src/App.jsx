import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, animate, motion, motionValue, useMotionValue } from 'framer-motion'
import MemoryCard from './MemoryCard.jsx'
import YearOrbit from './YearOrbit.jsx'
import Lightbox from './Lightbox.jsx'
import Composer from './Composer.jsx'
import { loadMemories, saveMemories, saveImage, deleteImage, COLOR_KEYS } from './store.js'
import { kindFromMime, MAX_SAFE_BYTES } from './media.js'
import { ZOOMS, markerLabel, toISO, fromISO, unitStart } from './time.js'

const MARKER_H = 130 // px reserved at top for date markers
// One shared, unhurried spring for everything the pill does — slow and liquidy
const LIQUID = { type: 'spring', stiffness: 170, damping: 26, mass: 1 }
// The dock morph — each direction tuned separately
const SHELL_OPEN = { type: 'spring', stiffness: 250, damping: 30, mass: 1 }      // lively, settles a bit quicker
const SHELL_CLOSE = { type: 'spring', stiffness: 190, damping: 32, mass: 1.05 }  // slow, liquid settle

// A card is worth keeping if it has a title, body, or any media
const isEmpty = (m) => !m.title?.trim() && !m.body?.trim() && !(m.media?.length)

// swift "dissolve" easing — races to ~80% then a soft settle (easeOutExpo-ish)
const SWIFT = [0.16, 1, 0.3, 1]
// view cross-fade: opacity dissolves quickly, position/scale settles a touch
// slower on the same swift curve — reads as a smooth, fast dissolve (no bounce)
const VIEW_SWAP = {
  scale: { duration: 0.5, ease: SWIFT },
  opacity: { duration: 0.3, ease: 'easeOut' },
}
// one-time entrance for the whole stack on first load
const APP_ENTER = { duration: 0.6, ease: SWIFT }

const DAY_LIMIT = 2 // max memories per day
const COL_W = 340 // fixed column width — populated dates lay out sequentially

// ---- manual vertical placement (drag-to-reposition) ----
const COL_TOP = MARKER_H + 20      // column's top offset inside the canvas (matches .column top)
const DOCK_CLEARANCE = 96          // bottom margin that clears the floating dock
const SNAP_THRESHOLD = 12          // gentle magnetic snap distance (px)
// settle spring for a card committing to its snapped/clamped Y on drop
const CARD_SETTLE = { type: 'spring', stiffness: 340, damping: 30, mass: 1 }

export default function App() {
  const [memories, setMemories] = useState(null)
  const [zoomIdx, setZoomIdx] = useState(2) // open in Years view on load
  const [openId, setOpenId] = useState(null) // lightbox
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKey, setComposerKey] = useState(0) // remount composer fresh on each open
  const [entered, setEntered] = useState(false) // true after the load entrance — gates the card fade-in so toggles don't re-flicker
  const toolbarRef = useRef(null)
  const composerRef = useRef(null)
  const sizeMorph = useRef(false) // animate the shell size only during a composer open/close

  // flip `entered` once, shortly after the first load, so cards fade in on the
  // initial entrance but NOT on later re-mounts (e.g. Days<->Months toggles)
  useEffect(() => {
    if (!memories || entered) return
    const t = setTimeout(() => setEntered(true), 750)
    return () => clearTimeout(t)
  }, [memories, entered])
  const [dockDims, setDockDims] = useState({ toolbarW: 462, composerH: 450 })
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const scrollRef = useRef(null)

  // ---- manual placement (vertical drag) --------------------------------
  // Which columns are in MANUAL mode, keyed `${view}:${columnKey}`. A column is
  // either fully auto (flex stack + scatter) or fully manual (absolute Y/card).
  // The FIRST drag in a column flips it for that view.
  // live DOM refs to each rendered card, so we can read offsetTop when seeding
  // manual Y from the current auto layout (no visual jump at the switch).
  const cardRefs = useRef(new Map()) // m.id -> element
  const setCardRef = useCallback((id, el) => {
    if (el) cardRefs.current.set(id, el)
    else cardRefs.current.delete(id)
  }, [])
  // m.id -> MotionValue for the transient vertical drag offset (see cardYMV)
  const yMVs = useRef(new Map())

  const zoom = ZOOMS[zoomIdx]
  const isYears = zoom.id === 'years'
  // ref mirror for stable callbacks (syncThumb) — both views stay mounted now,
  // so "is the orbit active" can't be inferred from scrollRef being null anymore.
  // useLayoutEffect (declared before the zoom-restore effect below) so it's
  // fresh before any same-pass layout work reads it.
  const zoomIdRef = useRef(zoom.id)
  useLayoutEffect(() => { zoomIdRef.current = zoom.id }, [zoom.id])

  // ---- load / persist -------------------------------------------------
  useEffect(() => {
    loadMemories().then((saved) => {
      // start empty — only days the user actually adds to will appear
      const list = saved && saved.length ? saved : []
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

  // debounced autosave (800ms) — persists every non-empty card, dropping the
  // transient warnLarge flag so it never reaches storage
  useEffect(() => {
    if (!memories) return
    const t = setTimeout(() => {
      saveMemories(memories.filter((m) => !isEmpty(m)).map(({ warnLarge, ...keep }) => keep))
    }, 800)
    return () => clearTimeout(t)
  }, [memories])

  // ---- timeline geometry ----------------------------------------------
  // Days: sparse — only days with memories become columns.
  // Months: continuous — every month from Jan of the earliest year through
  // the current month (empty months show too), growing as time passes.
  const columns = useMemo(() => {
    if (!memories) return []
    const groups = new Map()
    for (const m of memories) {
      const k = unitStart(m.date, zoom.id)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(m)
    }

    let keys
    if (zoom.id === 'months') {
      const today = new Date()
      let earliestYear = today.getFullYear()
      for (const m of memories) earliestYear = Math.min(earliestYear, fromISO(m.date).getFullYear())
      keys = []
      let d = new Date(earliestYear, 0, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 1)
      while (d <= end) { keys.push(toISO(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1) }
    } else {
      keys = [...groups.keys()].sort() // ISO dates sort chronologically
    }

    return keys.map((k, i) => {
      // chronological within a column (months can span several dates)
      const items = (groups.get(k) || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      return { key: k, colX: i * COL_W, colW: COL_W, items }
    })
  }, [memories, zoom.id])

  const widthPx = Math.max(columns.length * COL_W, 1)

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

  // ---- viewport width + height (responsiveness; height drives drag clamp) ----
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280)
  const [vh, setVh] = useState(typeof window !== 'undefined' ? window.innerHeight : 800)
  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ---- scrollbar thumb (the zoom pill IS the scrollbar) -----------------
  // pill track shrinks on small screens so the whole toolbar fits the width
  const TRACK_W = Math.min(280, Math.max(150, vw - 200))
  const thumbX = useMotionValue(0)
  const thumbWmv = useMotionValue(TRACK_W)
  const thumbWTarget = useRef(TRACK_W)
  const thumbDrag = useRef(null)

  const zoomMorphing = useRef(false)
  const morphAnim = useRef(null)

  const syncThumb = useCallback((smooth = false) => {
    // in the orbit (Years) view the pill fills the whole track — the scroller
    // is still mounted (hidden layer), so gate on the zoom, not on the ref
    const el = zoomIdRef.current === 'years' ? null : scrollRef.current
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
    // preserve scroll *fraction* across zooms (columns re-lay-out by count)
    if (el) {
      const maxScroll = el.scrollWidth - el.clientWidth
      pendingCenter.current = maxScroll > 0 ? el.scrollLeft / maxScroll : 0
    }
    setZoomIdx(idx)
  }

  // restore the anchored fraction right after the canvas re-renders, then morph the pill
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && pendingCenter.current !== null) {
      el.scrollLeft = pendingCenter.current * (el.scrollWidth - el.clientWidth)
      pendingCenter.current = null
    }
    syncThumb(true)
  }, [zoomIdx, widthPx, syncThumb])

  // ---- mutations -------------------------------------------------------
  const removeMemory = useCallback((id) => {
    setMemories((ms) => {
      const m = ms.find((x) => x.id === id)
      m?.media?.forEach((x) => deleteImage(x.id))
      if (m?.imgId) deleteImage(m.imgId)
      yMVs.current.delete(id) // drop the transient drag motion value
      return ms.filter((x) => x.id !== id)
    })
    setOpenId((cur) => (cur === id ? null : cur))
  }, [])

  // ---- manual placement helpers ----------------------------------------
  const view = zoom.id // 'days' | 'months' (drag is a 2D-timeline feature only)
  // A column is MANUAL for this view when any of its cards already has a saved
  // pos[view]. Deriving this from the data (not local state) means manual
  // layouts persist across reloads — the saved positions are actually used.
  const isManualCol = (items) => items.some((it) => it.pos?.[view] != null)

  // The vertical band a card may occupy: from the column top (0) down to just
  // above the floating dock. Recomputed from viewport height so it adapts to
  // bigger screens / resize. `bottom` is the max TOP a card can take.
  const visibleHeight = Math.max(120, vh - COL_TOP - DOCK_CLEARANCE)

  // Read a card's height (live element if present, else a sane default).
  const cardHeight = (id) => cardRefs.current.get(id)?.offsetHeight || 120

  // Clamp a manual top so the card stays fully on-screen and clear of the dock.
  const clampY = (id, y) => {
    const max = Math.max(0, visibleHeight - cardHeight(id))
    return Math.min(Math.max(0, y), max)
  }

  // Per-card TRANSIENT drag offset (0 at rest). framer's drag writes it live;
  // after a drop we spring it back to 0 while `pos[view]` (the committed top)
  // absorbs the move. App owns these so the settle can compensate for the snap.
  const cardYMV = useCallback((id) => {
    let mv = yMVs.current.get(id)
    if (!mv) { mv = motionValue(0); yMVs.current.set(id, mv) }
    return mv
  }, [])

  // First drag in an auto column flips the WHOLE column to manual (for this
  // view). Fires at drag START so the switch is atomic: every card's pos[view]
  // is seeded from its CURRENT offsetTop and all cards become absolutely placed
  // in the same render — so nothing reflows and the dragged card stays exactly
  // under the cursor (its top = offsetTop, framer keeps driving the yMV offset).
  const onCardDragStart = useCallback((id, items) => {
    if (isManualCol(items.list)) return // already manual — nothing to flip/seed
    setMemories((ms) =>
      ms.map((m) => {
        if (!items.list.some((it) => it.id === m.id)) return m
        if (m.pos && m.pos[view] != null) return m // already seeded for this view
        const el = cardRefs.current.get(m.id)
        // offsetTop is relative to the .column (offsetParent starts at COL_TOP),
        // so it's the in-column Y we want.
        const seedY = el ? el.offsetTop : 0
        return { ...m, pos: { ...(m.pos || {}), [view]: seedY } }
      })
    )
  }, [view])

  // Commit a drag: free vertical placement with a GENTLE magnetic snap to the
  // column top (0) or a neighbour card's top/bottom edge, then clamp on-screen.
  // The transient yMV holds framer's raw offset at drop; we move that offset into
  // pos[view] (the committed top) and spring yMV → 0 so the card settles with a
  // soft, magnetic spring rather than snapping abruptly.
  const commitDrag = useCallback((id, info, items) => {
    const base = memories.find((m) => m.id === id)?.pos?.[view] ?? 0
    const raw = base + info.offset.y // where the card actually is at drop

    // gentle snap: candidate anchors = column top + each neighbour's top/bottom
    const anchors = [0]
    for (const it of items) {
      if (it.id === id) continue
      const top = it.pos?.[view]
      if (top == null) continue
      anchors.push(top)
      anchors.push(top + cardHeight(it.id))
    }
    let y = raw
    let best = null
    for (const a of anchors) {
      const d = Math.abs(raw - a)
      if (d <= SNAP_THRESHOLD && (best == null || d < best.d)) best = { a, d }
    }
    if (best) y = best.a
    y = clampY(id, y) // never off-screen / under the dock

    // keep the card visually where it was dropped (top=target + offset), then
    // spring the offset to 0 → soft magnetic settle onto the snapped/clamped top
    const mv = cardYMV(id)
    mv.set(raw - y)
    animate(mv, 0, CARD_SETTLE)

    setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, pos: { ...(m.pos || {}), [view]: y } } : m)))
  }, [view, visibleHeight, memories, cardYMV])

  // completely random pastel from the palette; fixed once assigned
  const nextColor = () => COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)]
  const todayISO = () => toISO(new Date())

  // how many memories already sit on a date
  const countOn = (iso) => memories.filter((m) => m.date === iso).length
  const showToast = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }

  // New cards default to today; the composer's date picker lets the user change it.
  const anchorDate = () => todayISO()

  const blankCard = (date) => ({
    id: crypto.randomUUID(),
    type: 'note',
    title: '',
    body: '',
    date,
    color: nextColor(),
    media: [],
  })

  // commit a finished memory from the morphing composer form.
  // name only -> quote; name + note -> coloured card; media -> photo/video/audio
  const addFromComposer = ({ title, body, date, media }) => {
    if (countOn(date) >= DAY_LIMIT) { showToast(`Only ${DAY_LIMIT} memories per day`); return }
    const hasMedia = media && media.length
    const isQuote = !hasMedia && title && !body
    const card = {
      id: crypto.randomUUID(),
      type: isQuote ? 'quote' : 'note',
      title,
      body,
      date,
      media: media || [],
      color: nextColor(), // random, fixed — not user-changeable
    }
    setMemories((ms) => [...ms, card])
    sizeMorph.current = true
    setComposerOpen(false)
  }

  const openComposer = () => {
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

    const existingImgs = memories?.find((m) => m.id === id)?.media?.filter((x) => x.kind === 'image').length || 0
    let imgRoom = 4 - existingImgs // cap images at 4
    for (const { file, kind } of accepted) {
      if (kind === 'image') {
        if (imgRoom <= 0) continue
        imgRoom--
      }
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

  // ---- canvas interactions ----------------------------------------------
  // dropped/pasted files become a memory on today directly (no inline editing)
  const onDrop = async (e) => {
    e.preventDefault()
    if (zoom.id === 'years') return // orbit view: no drop target
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    if (countOn(anchorDate()) >= DAY_LIMIT) { showToast(`Only ${DAY_LIMIT} memories per day`); return }
    const card = blankCard(anchorDate())
    setMemories((ms) => [...ms, card])
    attachFiles(card.id, files)
  }

  useEffect(() => {
    const onPaste = async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      if (countOn(anchorDate()) >= DAY_LIMIT) { showToast(`Only ${DAY_LIMIT} memories per day`); return }
      const card = blankCard(anchorDate())
      setMemories((ms) => [...ms, card])
      attachFiles(card.id, [item.getAsFile()])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [memories])

  if (!memories) return <div className="loading">…</div>

  const openCard = memories.find((m) => m.id === openId)

  return (
    <div className="viewport" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* Both views stay mounted and cross-fade — remounting the 3D canvas on
          every Months↔Years switch (WebGL context + shaders + textures) was
          the source of the switch lag. Hidden layer is visibility:hidden and
          the orbit's frameloop pauses, so it costs nothing while inactive. */}
      {/* hidden layers stay opacity-0 but PAINTED — flipping visibility forced a
          full timeline repaint in the same frame the pill morph starts (hitch) */}
      <motion.div
        className="view-stack"
        initial={{ opacity: 0, y: -26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={APP_ENTER}
      >
      <motion.div
        className={`view-layer ${isYears ? 'view-layer-off' : ''}`}
        initial={false}
        animate={isYears ? { opacity: 0, scale: 0.985 } : { opacity: 1, scale: 1 }}
        transition={VIEW_SWAP}
      >
      <div className="scroller" ref={scrollRef}>
        <div className="canvas" style={{ width: widthPx }}>
          <div className="topline" />
          {columns.map(({ key, colX }) => {
            const d = fromISO(key)
            return (
              <div key={`m-${key}`}>
                <div className="gridline" style={{ left: colX }} />
                <div className="marker" style={{ left: colX + COL_W / 2 }}>
                  <div className="marker-day">{markerLabel(d, zoom.id)}</div>
                  <div className="marker-year">{d.getFullYear()}</div>
                </div>
              </div>
            )
          })}

          {/* one layout group so a card glides from its Days position to its
              Months position (and back) — shared-layout flight on toggle */}
          <LayoutGroup>
            {columns.map(({ key, colX, items }) => {
              // a column is fully auto (flex stack + scatter) or fully manual
              // (absolute Y per card) for THIS view; the first drag flips it.
              const isManual = isManualCol(items)
              return (
              <div
                key={key}
                className={`column ${isManual ? 'column-manual' : ''}`}
                style={{ left: colX + 8, top: MARKER_H + 20, width: COL_W - 16 }}
              >
                <AnimatePresence>
                  {items.map((m, idx) => {
                    // committed top for this view. We do NOT clamp here: the seed
                    // equals the card's auto offsetTop (so the flip never jumps),
                    // and a tall column's lower cards legitimately sit below the
                    // fold just as they did in auto mode. Clamping every card at
                    // render would pin them all to the same max and overlap them.
                    // On-screen safety lives in the drag (dragBounds) + drop
                    // (commitDrag clampY): you can never *place* a card off-screen.
                    // In auto mode the card's real top is its live flex offsetTop
                    // (used so the first-drag bounds are correct before the flip).
                    const top = isManual
                      ? (m.pos?.[view] ?? 0)
                      : (cardRefs.current.get(m.id)?.offsetTop ?? 0)
                    return (
                    <MemoryCard
                      key={m.id}
                      ref={(el) => setCardRef(m.id, el)}
                      m={m}
                      index={idx}
                      entered={entered}
                      manual={isManual}
                      manualY={isManual ? top : 0}
                      yMV={cardYMV(m.id)}
                      // clamp the drag so the card can never go off-screen or
                      // under the dock. Bounds are on the transient yMV offset,
                      // relative to the card's current top.
                      dragBounds={{
                        top: -top,
                        bottom: Math.max(0, visibleHeight - cardHeight(m.id)) - top,
                      }}
                      onDragStart={() => onCardDragStart(m.id, { key, list: items })}
                      onDragEnd={(id, info) => commitDrag(id, info, items)}
                      onDelete={removeMemory}
                      onOpen={setOpenId}
                    />
                    )
                  })}
                </AnimatePresence>
              </div>
              )
            })}
          </LayoutGroup>
        </div>
      </div>
      </motion.div>

      <motion.div
        className={`view-layer ${isYears ? '' : 'view-layer-off'}`}
        initial={false}
        animate={isYears ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.04 }}
        transition={VIEW_SWAP}
      >
        <YearOrbit memories={memories} active={isYears} />
      </motion.div>
      </motion.div>

      <div className="dock-wrap">
        <motion.div
          className={`dock-shell ${composerOpen ? 'dock-shell-open' : ''}`}
          initial={{ y: 72, opacity: 0 }}
          animate={{
            y: 0,
            opacity: 1,
            width: composerOpen ? Math.min(440, vw - 24) : dockDims.toolbarW,
            height: composerOpen ? dockDims.composerH : 48,
          }}
          style={{ borderRadius: 24 }}
          transition={{
            // entrance: the bar waits for the content to load + the toolbar to
            // self-measure (so it appears at its final width, no snap), then
            // rises up slowly from below — y and opacity share one timing
            y: { duration: 0.7, ease: SWIFT, delay: 0.55 },
            opacity: { duration: 0.55, ease: 'easeOut', delay: 0.55 },
            // size only animates during an actual open/close morph; on load /
            // self-measurement it snaps instantly so the bar just appears
            width: sizeMorph.current ? (composerOpen ? SHELL_OPEN : SHELL_CLOSE) : { duration: 0 },
            // height: morph spring during open/close; while open, content changes
            // (e.g. a photo is added) animate gently instead of jumping
            height: sizeMorph.current
              ? (composerOpen ? SHELL_OPEN : SHELL_CLOSE)
              : (composerOpen ? { type: 'spring', stiffness: 300, damping: 30 } : { duration: 0 }),
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
                    initial={{ opacity: 0, y: 7, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -7, filter: 'blur(4px)' }}
                    transition={{ duration: 0.32, ease: SWIFT }}
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
        {toast && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openCard && <Lightbox key={openCard.id} m={openCard} onClose={() => setOpenId(null)} />}
      </AnimatePresence>
    </div>
  )
}
