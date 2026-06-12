import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, LayoutGroup, animate, motion, motionValue, useMotionValue, useTransform } from 'framer-motion'
import { SWIFT } from './anim.js'
import MemoryCard from './MemoryCard.jsx'
import YearOrbit from './YearOrbit.jsx'
import Lightbox from './Lightbox.jsx'
import Composer from './Composer.jsx'
import { loadMemories, saveMemories, saveImage, deleteImage, COLOR_KEYS } from './store.js'
import { kindFromMime, MAX_SAFE_BYTES } from './media.js'
import { ZOOMS, markerLabel, toISO, fromISO, unitStart } from './time.js'

const MARKER_H = 130 // px reserved at top for date markers
// The zoom-pill morph — snappy but still liquid, critically damped (no wobble)
const LIQUID = { type: 'spring', stiffness: 230, damping: 30, mass: 1 }
// The dock morph — crisp, physical, essentially critically damped (no double-bounce)
const SHELL_OPEN = { type: 'spring', stiffness: 380, damping: 38, mass: 1 }
const SHELL_CLOSE = { type: 'spring', stiffness: 320, damping: 36, mass: 1 }
// how long shellMorph stays true — must outlast the springs above (~220ms settle)
const SHELL_MORPH_MS = 700

// A card is worth keeping if it has a title, body, or any media
const isEmpty = (m) => !m.title?.trim() && !m.body?.trim() && !(m.media?.length)
// view cross-fade: opacity dissolves quickly, position/scale settles a touch
// slower on the same swift curve — reads as a smooth, fast dissolve (no bounce)
const VIEW_SWAP = {
  scale: { duration: 0.5, ease: SWIFT },
  opacity: { duration: 0.3, ease: 'easeOut' },
}
// one-time entrance for the whole stack after boot — calm and deliberate
const APP_ENTER = { duration: 0.9, ease: SWIFT }

const COL_W = 340 // fixed column width — populated dates lay out sequentially

// ---- manual vertical placement (drag-to-reposition) ----
const COL_TOP = MARKER_H + 20      // column's top offset inside the canvas (matches .column top)
const DOCK_CLEARANCE = 96          // bottom margin that clears the floating dock
const SNAP_THRESHOLD = 12          // gentle magnetic snap distance (px)
const MIN_GAP = 14                 // minimum gap kept between two cards (matches the auto flex gap)
// settle for a card committing to its snapped/clamped Y on drop — an instant,
// decisive slide into place. Short tween, racing ease-out, NO spring => it is
// physically impossible for the drop to bounce.
const CARD_SETTLE = { type: 'tween', duration: 0.13, ease: [0.25, 1, 0.5, 1] }

// the thin grey loading bar — driven by a MotionValue so per-item progress
// updates never re-render the (already mounted) app behind the overlay
function BootBar({ mv }) {
  const width = useTransform(mv, (v) => `${Math.round(v)}%`)
  return (
    <div className="boot-track"><motion.div className="boot-fill" style={{ width }} /></div>
  )
}

export default function App() {
  const [memories, setMemories] = useState(null)
  const [zoomIdx, setZoomIdx] = useState(2) // open in Years view on load
  const [openId, setOpenId] = useState(null) // lightbox
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKey, setComposerKey] = useState(0) // remount composer fresh on each open
  const [entered, setEntered] = useState(false) // true after the load entrance — gates the card fade-in so toggles don't re-flicker
  const toolbarRef = useRef(null)
  const composerRef = useRef(null)

  // ---- boot sequence ----------------------------------------------------
  // Simple fixed loader: white screen + thin grey bar that fills 0→100% over
  // ~1s, then the Years view is revealed REGARDLESS of whether the orbit
  // textures finished (the planes stagger-fade in as they load). A slow
  // storage read can't strand it. Then the calm reveal already wired below:
  // overlay fades, orbit pictures stagger in, dock rises from the bottom.
  const bootMV = useMotionValue(0) // bar %
  const [booted, setBooted] = useState(false)
  useEffect(() => {
    const bar = animate(bootMV, 100, { duration: 1, ease: 'linear' })
    const t = setTimeout(() => setBooted(true), 1000)
    return () => { bar.stop(); clearTimeout(t) }
  }, [bootMV])
  const [dockDims, setDockDims] = useState({ toolbarW: 462, composerH: 450 })
  const scrollRef = useRef(null)

  // ---- manual placement (vertical drag) --------------------------------
  // live DOM refs to each rendered card, so we can read offsetTop when seeding
  // manual Y from the current auto layout (no visual jump at the switch).
  const cardRefs = useRef(new Map()) // m.id -> element
  // stable per-id ref callbacks so memoized cards aren't re-rendered by a
  // fresh closure every App render
  const refCbs = useRef(new Map())
  const cardRefCb = useCallback((id) => {
    let cb = refCbs.current.get(id)
    if (!cb) {
      cb = (el) => {
        if (el) cardRefs.current.set(id, el)
        else cardRefs.current.delete(id)
      }
      refCbs.current.set(id, cb)
    }
    return cb
  }, [])
  // m.id -> MotionValue for the transient vertical drag offset (see cardYMV)
  const yMVs = useRef(new Map())
  // true from drag start until the drop commit ends — renders during a drag
  // use INSTANT layout so projection never fights the gesture
  const dragActive = useRef(false)
  // fallback tops computed during render for cards WITHOUT a saved pos in a
  // manual column (e.g. just added) — committed into pos[view] by an effect
  // right after, so there is ONE positioning mechanism and it persists
  const pendingSeeds = useRef([]) // [{ id, view, top }]

  const zoom = ZOOMS[zoomIdx]
  const isYears = zoom.id === 'years'
  // ref mirror for stable callbacks (syncThumb) — both views stay mounted now,
  // so "is the orbit active" can't be inferred from scrollRef being null anymore.
  // useLayoutEffect (declared before the zoom-restore effect below) so it's
  // fresh before any same-pass layout work reads it.
  const zoomIdRef = useRef(zoom.id)
  useLayoutEffect(() => { zoomIdRef.current = zoom.id }, [zoom.id])

  // THE 2D layout view. While in Years the timeline keeps the LAST 2D grouping
  // (days|months) instead of regrouping to year-columns — regrouping the hidden
  // layer mid-crossfade sent every layoutId card flying into a one-column pile
  // while the layer faded (the months<->years card glitch). Frozen layout =>
  // nothing moves in the 2D layer during the orbit crossfade, ever.
  const lastView2d = useRef('months')
  if (!isYears && lastView2d.current !== zoom.id) lastView2d.current = zoom.id
  const view2d = isYears ? lastView2d.current : zoom.id

  // While leaving Years the orbit must keep rendering through its fade-out —
  // flipping frameloop to 'never' instantly froze it on frame one of the fade.
  // The pause is completion-driven (the orbit layer's onAnimationComplete), so
  // it survives any retuning of VIEW_SWAP and rapid-toggle retargets.
  const [orbitLive, setOrbitLive] = useState(true)
  useEffect(() => { if (isYears) setOrbitLive(true) }, [isYears])

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
    }).catch(() => {
      setMemories([]) // a failed storage read still reveals (empty timeline)
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
      const k = unitStart(m.date, view2d)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(m)
    }

    let keys
    if (view2d === 'months') {
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
  }, [memories, view2d])

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

  // ---- viewport width (responsiveness) ----------------------------------
  // height is NOT state — the drag clamp reads window.innerHeight live at
  // gesture time (maxTopFor), so resizes don't re-render the whole card tree.
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280)
  useEffect(() => {
    let raf = 0
    const onResize = () => {
      // rAF-throttled: one state write per frame during a window drag
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setVw(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
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
  // set by scroll/resize events; the in-flight morph only re-reads layout when
  // this is dirty (a forced reflow per frame would drop frames mid-switch)
  const thumbDirty = useRef(false)

  const syncThumb = useCallback((smooth = false) => {
    // in the orbit (Years) view the pill fills the whole track — the scroller
    // is still mounted (hidden layer), so gate on the zoom, not on the ref
    const read = () => {
      const el = zoomIdRef.current === 'years' ? null : scrollRef.current
      const frac = el ? el.clientWidth / el.scrollWidth : 1
      const w = Math.max(64, Math.min(TRACK_W, Math.round(TRACK_W * frac)))
      const maxScroll = el ? el.scrollWidth - el.clientWidth : 0
      const p = el && maxScroll > 0 ? el.scrollLeft / maxScroll : 0
      return { w, x: p * (TRACK_W - w) }
    }
    const t = read()
    thumbWTarget.current = t.w
    if (smooth) {
      // ONE animation drives both width and position, interpolating the
      // pill as a single shape — x + width stays bounded by construction,
      // so the pill physically cannot leave the track mid-morph.
      zoomMorphing.current = true
      morphAnim.current?.stop() // retarget cleanly if a morph is already in flight
      const from = { x: thumbX.get(), w: thumbWmv.get() }
      let live = t
      thumbDirty.current = false
      morphAnim.current = animate(0, 1, {
        ...LIQUID,
        onUpdate: (p) => {
          // the target retargets continuously when scrolling happens during the
          // morph (the programmatic restore, or the user) — but layout is only
          // re-read when a scroll/resize actually fired (no per-frame reflow)
          if (thumbDirty.current) {
            live = read()
            thumbDirty.current = false
            thumbWTarget.current = live.w
          }
          thumbX.set(from.x + (live.x - from.x) * p)
          thumbWmv.set(from.w + (live.w - from.w) * p)
        },
        onComplete: () => { zoomMorphing.current = false },
      })
    } else if (!zoomMorphing.current) {
      // don't stomp an in-flight zoom morph — it re-reads the target itself
      thumbWmv.set(t.w)
      thumbX.set(t.x)
    }
  }, [thumbX, thumbWmv, TRACK_W])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => { thumbDirty.current = true; syncThumb() }
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
      refCbs.current.delete(id) // and the cached ref callback
      return ms.filter((x) => x.id !== id)
    })
    setOpenId((cur) => (cur === id ? null : cur))
  }, [])

  // ---- manual placement helpers ----------------------------------------
  // ref mirrors so the drag callbacks below are STABLE (memoized cards keep
  // their props) yet always read fresh data at event time
  const memoriesRef = useRef(null)
  memoriesRef.current = memories
  const view2dRef = useRef(view2d)
  view2dRef.current = view2d

  // A column is MANUAL for this view when any of its cards already has a saved
  // pos[view]. Deriving this from the data (not local state) means manual
  // layouts persist across reloads — the saved positions are actually used.
  const isManualCol = (items) => items.some((it) => it.pos?.[view2dRef.current] != null)

  // Read a card's height (live element if present, else a sane default).
  const cardHeight = (id) => cardRefs.current.get(id)?.offsetHeight || 120

  // The max TOP a card may take: from the column top (0) down to just above
  // the floating dock — read from the live viewport so it adapts to resize.
  const maxTopFor = (id) => {
    const visible = Math.max(120, window.innerHeight - COL_TOP - DOCK_CLEARANCE)
    return Math.max(0, visible - cardHeight(id))
  }

  // the dragged card's column-mates, derived at event time from fresh data
  const colItemsFor = (id) => {
    const ms = memoriesRef.current || []
    const me = ms.find((m) => m.id === id)
    if (!me) return []
    const k = unitStart(me.date, view2dRef.current)
    return ms.filter((m) => unitStart(m.date, view2dRef.current) === k)
  }

  // Per-card TRANSIENT drag offset (0 at rest). The card's pointer drag writes
  // it live; after a drop we slide it back to 0 while `pos[view]` (the
  // committed top) absorbs the move.
  const cardYMV = useCallback((id) => {
    let mv = yMVs.current.get(id)
    if (!mv) { mv = motionValue(0); yMVs.current.set(id, mv) }
    return mv
  }, [])

  // Drag clamp bounds (on the transient yMV offset), computed at GESTURE time —
  // not per card per render, which forced DOM layout reads on every App render.
  const getDragBounds = useCallback((id) => {
    const top = cardRefs.current.get(id)?.offsetTop ?? 0
    return { top: -top, bottom: maxTopFor(id) - top }
  }, [])

  // First drag in an auto column flips the WHOLE column to manual (for this
  // view). Runs inside the pointermove that crosses the drag threshold, and
  // SYNCHRONOUSLY (flushSync): every card's pos[view] is seeded from its
  // CURRENT offsetTop and all become absolutely placed before the first drag
  // offset is written — nothing reflows, the card stays under the cursor.
  const onCardDragStart = useCallback((id) => {
    // from here until the drop commit finishes, every render belongs to the
    // drag: layout animations are forced INSTANT so framer's projection can't
    // fight the pointer (yMV) or the drop compensation
    dragActive.current = true
    const items = colItemsFor(id)
    if (isManualCol(items)) return // already manual — nothing to flip/seed
    const v = view2dRef.current
    flushSync(() => setMemories((ms) =>
      ms.map((m) => {
        if (!items.some((it) => it.id === m.id)) return m
        if (m.pos && m.pos[v] != null) return m // already seeded for this view
        const el = cardRefs.current.get(m.id)
        // offsetTop is relative to the .column (offsetParent starts at COL_TOP),
        // so it's the in-column Y we want.
        return { ...m, pos: { ...(m.pos || {}), [v]: el ? el.offsetTop : 0 } }
      })
    ))
  }, [])

  // Commit a drag: free vertical placement with a GENTLE magnetic snap so the
  // card abuts a neighbour (sits just above/below it, never aligned-on-top),
  // clamped on-screen, then a final no-overlap resolve so cards can NEVER cover
  // each other. offsetY is the pointer's clamped offset at drop; we move it
  // into pos[view] and slide yMV → 0 (fast tween — cannot bounce).
  const commitDrag = useCallback((id, offsetY) => {
    const v = view2dRef.current
    const base = memoriesRef.current?.find((m) => m.id === id)?.pos?.[v] ?? 0
    const raw = base + offsetY // where the card actually is at drop
    const h = cardHeight(id)
    const maxTop = maxTopFor(id)

    // other cards' occupied [top, bottom] bands for this column/view — read from
    // the LIVE DOM (offsetTop/offsetHeight), not stale state, so no-overlap holds
    // on the very first drag of a column and with freshly-loaded image heights
    const bands = []
    for (const it of colItemsFor(id)) {
      if (it.id === id) continue
      const top = cardRefs.current.get(it.id)?.offsetTop ?? it.pos?.[v]
      if (top == null) continue
      bands.push({ top, bottom: top + cardHeight(it.id) })
    }

    // candidate positions: the column top, the bottom of the band, and ABUTTING
    // each neighbour with MIN_GAP of breathing room (just below / just above).
    // The same list drives the magnetic snap AND the no-overlap resolve.
    const near = bands.flatMap((b) => [b.bottom + MIN_GAP, b.top - h - MIN_GAP])
    let y = raw
    let best = null
    for (const a of [0, ...near]) {
      const d = Math.abs(raw - a)
      if (d <= SNAP_THRESHOLD && (best == null || d < best.d)) best = { a, d }
    }
    if (best) y = best.a
    y = Math.min(Math.max(0, y), maxTop) // never off-screen / under the dock

    // no overlap: a card must keep at least MIN_GAP from every neighbour. If it
    // doesn't, move to the nearest candidate that does.
    const clear = (p) => p >= 0 && p <= maxTop && !bands.some((b) => p < b.bottom + MIN_GAP && p + h > b.top - MIN_GAP)
    if (!clear(y)) {
      const ok = [0, maxTop, ...near].filter(clear).sort((a, b) => Math.abs(a - y) - Math.abs(b - y))
      if (ok.length) y = ok[0]
    }

    // commit the new top SYNCHRONOUSLY (flushSync), then set the transient offset
    // so the card stays exactly where it was dropped, and glide that offset to 0.
    // Doing the top commit in the same frame as the offset avoids the one-frame
    // flash (the "glitch") you'd get if `top` (state) and the transform updated on
    // different frames.
    const mv = cardYMV(id)
    flushSync(() => setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, pos: { ...(m.pos || {}), [v]: y } } : m))))
    mv.set(raw - y)
    animate(mv, 0, CARD_SETTLE)
    navigator.vibrate?.(8) // silent haptic tick on supported devices — no audio
    dragActive.current = false
  }, [cardYMV])

  // drag aborted (pointer stolen by a scroll/system gesture, or the card
  // unmounted mid-drag): revert the offset, release the drag flag. Without
  // this, dragActive leaked true and force-snapped every layout animation.
  const cancelCardDrag = useCallback((id) => {
    dragActive.current = false
    const mv = yMVs.current.get(id)
    if (mv) animate(mv, 0, CARD_SETTLE)
  }, [])

  // commit render-computed fallback tops into pos[view] so cards added to a
  // hand-arranged column persist exactly where they first appeared (one
  // positioning mechanism — no parallel cache to invalidate). No deps: runs
  // after every render, no-ops unless the columns map queued seeds.
  useEffect(() => {
    const seeds = pendingSeeds.current
    if (!seeds.length) return
    pendingSeeds.current = []
    setMemories((ms) => ms.map((m) => {
      const s = seeds.find((x) => x.id === m.id)
      if (!s || (m.pos && m.pos[s.view] != null)) return m
      return { ...m, pos: { ...(m.pos || {}), [s.view]: s.top } }
    }))
  })

  // completely random pastel from the palette; fixed once assigned
  const nextColor = () => COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)]
  const todayISO = () => toISO(new Date())


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
    beginShellMorph()
    setComposerOpen(false)
  }

  // shellMorph is STATE (not a ref) and is cleared on a timer sized to the
  // spring settle. The old ref was cleared by onAnimationComplete of whichever
  // animation finished FIRST (the 0.2s face fade), so any mid-morph re-render
  // (the ResizeObserver fires during open!) flipped the size transition to
  // {duration: 0} and snapped the shell mid-flight — the dock glitch.
  const [shellMorph, setShellMorph] = useState(false)
  const shellMorphTimer = useRef(null)
  useEffect(() => () => clearTimeout(shellMorphTimer.current), [])
  const beginShellMorph = () => {
    setShellMorph(true)
    clearTimeout(shellMorphTimer.current)
    shellMorphTimer.current = setTimeout(() => setShellMorph(false), SHELL_MORPH_MS)
  }

  const openComposer = () => {
    setOpenId(null)
    setComposerKey((k) => k + 1) // fresh form each open
    beginShellMorph()
    setComposerOpen(true)
  }

  const closeComposer = () => {
    beginShellMorph()
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
    const card = blankCard(anchorDate())
    setMemories((ms) => [...ms, card])
    attachFiles(card.id, files)
  }

  useEffect(() => {
    const onPaste = async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      const card = blankCard(anchorDate())
      setMemories((ms) => [...ms, card])
      attachFiles(card.id, [item.getAsFile()])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [memories])

  if (!memories) {
    // storage still loading — same white screen + thin grey bar the boot
    // overlay shows, so the loading state is ONE continuous visual
    return (
      <div className="boot-overlay">
        <BootBar mv={bootMV} />
      </div>
    )
  }

  const openCard = memories.find((m) => m.id === openId)

  // fresh per render — the columns map below queues fallback seeds into it,
  // and the effect above this return commits them after paint
  pendingSeeds.current = []

  return (
    <div className="viewport" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* Both views stay mounted and cross-fade — remounting the 3D canvas on
          every Months↔Years switch (WebGL context + shaders + textures) was
          the source of the switch lag. Hidden layers stay opacity-0 but PAINTED
          (flipping visibility forced a full repaint in the same frame the pill
          morph starts), and the orbit's frameloop pauses AFTER its fade ends. */}
      <motion.div
        className="view-stack"
        initial={false}
        animate={booted ? { opacity: 1, y: 0 } : { opacity: 0, y: -18 }}
        transition={APP_ENTER}
        // `entered` (gates the cards' one-time fade-in) flips when the boot
        // entrance actually finishes — completion-driven, so it can never
        // desync from APP_ENTER's duration the way a parallel timer could
        onAnimationComplete={() => { if (booted) setEntered(true) }}
      >
      <motion.div
        className={`view-layer ${isYears ? 'view-layer-off' : ''}`}
        initial={false}
        animate={isYears ? { opacity: 0, scale: 0.985 } : { opacity: 1, scale: 1 }}
        transition={VIEW_SWAP}
      >
      {/* layoutScroll: framer's projection accounts for this container's scroll
          offset when measuring layoutId flights — without it the programmatic
          scrollLeft restore (same commit) shifted every glide's origin/target */}
      <motion.div className="scroller" ref={scrollRef} layoutScroll>
        <div className="canvas" style={{ width: widthPx }}>
          <div className="topline" />
          {columns.map(({ key, colX }) => {
            const d = fromISO(key)
            return (
              <div key={`m-${key}`}>
                <div className="gridline" style={{ left: colX }} />
                <div className="marker" style={{ left: colX + COL_W / 2 }}>
                  <div className="marker-day">{markerLabel(d, view2d)}</div>
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
              // cards WITHOUT a saved pos in a manual column (e.g. a memory just
              // added to a hand-arranged day) stack sequentially below the lowest
              // placed card — never at 0, never overlapping. The computed top is
              // queued in pendingSeeds and committed into pos[view] right after
              // this render, so placement persists like any dragged position.
              let fallbackCursor = 0
              if (isManual) {
                for (const it of items) {
                  const p = it.pos?.[view2d]
                  if (p != null) fallbackCursor = Math.max(fallbackCursor, p + cardHeight(it.id))
                }
              }
              return (
              <div
                key={key}
                className={`column ${isManual ? 'column-manual' : ''}`}
                style={{ left: colX + 8, top: COL_TOP, width: COL_W - 16 }}
              >
                <AnimatePresence>
                  {items.map((m, idx) => {
                    // committed top for this view (manual columns only). We do
                    // NOT clamp here: the seed equals the card's auto offsetTop
                    // (so the flip never jumps), and a tall column's lower cards
                    // legitimately sit below the fold just as they did in auto
                    // mode. Clamping every card at render would pin them all to
                    // the same max and overlap them. On-screen safety lives in
                    // the drag (getDragBounds) + the drop (commitDrag's inline
                    // clamp): you can never *place* a card off-screen.
                    let top = 0
                    if (isManual) {
                      if (m.pos?.[view2d] != null) {
                        top = m.pos[view2d]
                      } else {
                        top = fallbackCursor + MIN_GAP
                        fallbackCursor = top + cardHeight(m.id)
                        pendingSeeds.current.push({ id: m.id, view: view2d, top })
                      }
                    }
                    return (
                    <MemoryCard
                      key={m.id}
                      ref={cardRefCb(m.id)}
                      m={m}
                      index={idx}
                      entered={entered}
                      manual={isManual}
                      manualY={top}
                      yMV={cardYMV(m.id)}
                      instantLayout={dragActive.current}
                      getDragBounds={getDragBounds}
                      onDragStart={onCardDragStart}
                      onDragEnd={commitDrag}
                      onDragCancel={cancelCardDrag}
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
      </motion.div>
      </motion.div>

      <motion.div
        className={`view-layer ${isYears ? '' : 'view-layer-off'}`}
        initial={false}
        animate={isYears ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.04 }}
        transition={VIEW_SWAP}
        // pause the orbit's frameloop only once its fade-out has actually
        // finished (completion-driven; survives VIEW_SWAP retuning and
        // rapid-toggle retargets — re-entering Years just retargets the fade)
        onAnimationComplete={() => { if (zoomIdRef.current !== 'years') setOrbitLive(false) }}
      >
        <YearOrbit
          memories={memories}
          active={orbitLive}
          revealed={booted}
        />
      </motion.div>
      </motion.div>

      <div className="dock-wrap">
        <motion.div
          className={`dock-shell ${composerOpen ? 'dock-shell-open' : ''}`}
          initial={{ y: 84, opacity: 0 }}
          animate={{
            y: booted ? 0 : 84,
            opacity: booted ? 1 : 0,
            width: composerOpen ? Math.min(440, vw - 24) : dockDims.toolbarW,
            height: composerOpen ? dockDims.composerH : 48,
          }}
          style={{ borderRadius: 24 }}
          transition={{
            // entrance: tied to the REAL boot signal — rises slowly from the
            // bottom edge once everything is ready (content reveals first)
            y: { duration: 1.0, ease: SWIFT, delay: 0.35 },
            opacity: { duration: 0.7, ease: 'easeOut', delay: 0.35 },
            // size animates ONLY during an open/close morph (shellMorph state —
            // survives mid-morph re-renders); otherwise self-measurement snaps.
            // While open, content growth (adding a photo) animates gently.
            width: shellMorph ? (composerOpen ? SHELL_OPEN : SHELL_CLOSE) : { duration: 0 },
            height: shellMorph
              ? (composerOpen ? SHELL_OPEN : SHELL_CLOSE)
              : (composerOpen ? { type: 'spring', stiffness: 300, damping: 32 } : { duration: 0 }),
          }}
        >
          {/* toolbar face — crossfades tightly with the size morph (no dead air) */}
          <motion.div
            ref={toolbarRef}
            className="dock-face zoombar"
            animate={{ opacity: composerOpen ? 0 : 1 }}
            transition={composerOpen
              ? { duration: 0.1, ease: 'easeIn' }
              : { duration: 0.18, ease: 'easeOut', delay: 0.07 }}
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
            transition={composerOpen
              ? { duration: 0.18, ease: 'easeOut', delay: 0.07 }
              : { duration: 0.1, ease: 'easeIn' }}
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

      {/* boot overlay: plain white + a thin grey bar, fading out on reveal */}
      <AnimatePresence>
        {!booted && (
          <motion.div
            className="boot-overlay"
            initial={false}
            exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeOut' } }}
          >
            <BootBar mv={bootMV} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
