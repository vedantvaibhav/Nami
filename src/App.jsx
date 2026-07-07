import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, LayoutGroup, animate, motion, motionValue, useMotionValue } from 'framer-motion'
import { SWIFT, LIQUID } from './anim.js'
import MemoryCard from './MemoryCard.jsx'
import YearOrbit from './YearOrbit.jsx'
import Lightbox from './Lightbox.jsx'
import Composer from './Composer.jsx'
import SettingsPanel from './SettingsPanel.jsx'
import { supabase, userProfile } from './supabase.js'
import { loadMemories, saveMemories, saveImageMedia, cachePreview, deleteImage, randomColorKey } from './store.js'
import { kindFromMime, MAX_SAFE_BYTES } from './media.js'
import { ZOOMS, markerLabel, toISO, fromISO, unitStart, currentMonthDays, currentYearMonths } from './time.js'

const MARKER_H = 130 // px reserved at top for date markers
// LIQUID (the shared switch spring — pill morph + card glide) lives in anim.js
// The dock morph — open and close use the SAME spring, so opening feels just
// like closing in reverse (the close feel the user likes).
const SHELL_CLOSE = { type: 'spring', stiffness: 320, damping: 36, mass: 1 }
const SHELL_OPEN = SHELL_CLOSE
// how long shellMorph stays true — must outlast the open tween / close settle
const SHELL_MORPH_MS = 700

// A card is worth keeping if it has a title, body, or any media
const isEmpty = (m) => !m.title?.trim() && !m.body?.trim() && !(m.media?.length)
// view cross-fade — tuned to land WITH the LIQUID pill/card glide (~0.4s) so
// the whole switch is one motion. The orbit layer is opacity-only (no scale
// leg — see its animate), so the WebGL canvas isn't re-composited every frame.
const VIEW_SWAP = {
  scale: { duration: 0.42, ease: SWIFT },
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

// A month gathers far more memories than a day, so the Months view collates each
// column to at most a few cards — otherwise a busy month stacks past the bottom
// of the viewport (below the dock). Days show everything.
const MONTHS_VIEW_MAX = 3
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
const collateColumn = (items, view) => {
  const sorted = items.slice().sort(byDate)
  return view === 'months' ? sorted.slice(0, MONTHS_VIEW_MAX) : sorted
}

export default function App() {
  const [memories, setMemories] = useState(null)
  const [zoomIdx, setZoomIdx] = useState(2) // open in Years view on load
  const [openId, setOpenId] = useState(null) // lightbox
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKey, setComposerKey] = useState(0) // remount composer fresh on each open
  const [editId, setEditId] = useState(null) // memory being edited (null = adding)
  const [entered, setEntered] = useState(false) // true after the load entrance — gates the card fade-in so toggles don't re-flicker
  const toolbarRef = useRef(null)
  const composerRef = useRef(null)

  // ---- entrance ---------------------------------------------------------
  // No loading screen — the orbit planes stagger-fade in on their own as they
  // load, so a loader isn't needed. `booted` just gates the one-time calm
  // reveal (view-stack dissolves in, dock rises); flip it on the next frame so
  // that reveal still plays once, immediately, with no grey-bar wait.
  const [booted, setBooted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setBooted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // ---- auth session -----------------------------------------------------
  // undefined = still resolving the initial session; null = signed out; object
  // = signed in. The render gate below uses these three states.
  const [session, setSession] = useState(undefined)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  const handleSignOut = () => { setSettingsOpen(false); supabase.auth.signOut() }
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

  // The 2D timeline layer's mirror of orbitLive: visible while it's the active
  // view OR mid-crossfade, then visibility:hidden once its fade-out completes
  // (so the off-screen timeline stops painting). Re-shown the instant we leave
  // Years, before that crossfade begins.
  const [timelineLive, setTimelineLive] = useState(true)
  useEffect(() => { if (!isYears) setTimelineLive(true) }, [isYears])

  // ---- load / persist -------------------------------------------------
  useEffect(() => {
    if (!session) { setMemories([]); return } // logged out: show the empty base screen
    loadMemories(session.user.id).then((saved) => {
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
  }, [session])

  // debounced autosave (800ms) — persists every non-empty card, dropping the
  // transient warnLarge flag so it never reaches storage
  useEffect(() => {
    if (!session) return
    if (!memories) return
    const t = setTimeout(() => {
      saveMemories(session.user.id, memories.filter((m) => !isEmpty(m)).map(({ warnLarge, ...keep }) => keep))
    }, 800)
    return () => clearTimeout(t)
  }, [memories])

  // ---- timeline geometry ----------------------------------------------
  // Days: sparse — only days with memories become columns. Months: continuous
  // — every month from Jan of the earliest year through the current month.
  // EMPTY STATE: when a view would otherwise be blank (no memories, or no day
  // columns), fall back to a scaffold of placeholder columns so the canvas is
  // never empty — the current month's days, or the current year's 12 months.
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
      if (!memories.length) {
        keys = currentYearMonths() // empty state: all 12 months of this year
      } else {
        const today = new Date()
        let earliestYear = today.getFullYear()
        for (const m of memories) earliestYear = Math.min(earliestYear, fromISO(m.date).getFullYear())
        keys = []
        let d = new Date(earliestYear, 0, 1)
        const end = new Date(today.getFullYear(), today.getMonth(), 1)
        while (d <= end) { keys.push(toISO(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1) }
      }
    } else {
      keys = [...groups.keys()].sort() // ISO dates sort chronologically
      if (!keys.length) keys = currentMonthDays() // empty state: this month's days
    }

    return keys.map((k, i) => {
      // chronological within a column; Months collates to the first few (see collateColumn)
      const items = collateColumn(groups.get(k) || [], view2d)
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
  const pendingCenterDate = useRef(null)
  const setZoomKeepCenter = (idx) => {
    const el = scrollRef.current
    pendingCenter.current = null
    pendingCenterDate.current = null
    // Keep you where your memories are across a zoom. From a 2D view (days/
    // months), anchor on the DATE at the viewport centre — so zooming out lands
    // on the month that actually holds that day, not back at fraction 0 (Jan).
    // Days is sparse and Months is continuous, so a raw fraction doesn't map.
    // From Years (no horizontal scroll) keep the fraction fallback.
    if (el && zoom.id !== 'years' && columns.length) {
      const i = Math.max(0, Math.min(columns.length - 1, Math.floor((el.scrollLeft + el.clientWidth / 2) / COL_W)))
      pendingCenterDate.current = columns[i]?.key || null
    } else if (el) {
      const maxScroll = el.scrollWidth - el.clientWidth
      pendingCenter.current = maxScroll > 0 ? el.scrollLeft / maxScroll : 0
    }
    setZoomIdx(idx)
  }

  // restore the anchored fraction right after the canvas re-renders, then morph
  // the pill. The scrollLeft write forces a reflow (it reads scrollWidth); start
  // the pill morph on the NEXT frame so its first frame isn't stacked on that
  // same reflow (double forced layout on the switch frame).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && pendingCenterDate.current !== null) {
      // land on the column for the anchored date in the NEW view: the exact unit
      // (e.g. that day's month), else the nearest column in time.
      const date = pendingCenterDate.current
      let i = columns.findIndex((c) => c.key === unitStart(date, view2d))
      if (i < 0) { i = columns.findIndex((c) => c.key >= date); if (i < 0) i = columns.length - 1 }
      if (i >= 0) {
        const target = i * COL_W + COL_W / 2 - el.clientWidth / 2
        el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth))
      }
      pendingCenterDate.current = null
    } else if (el && pendingCenter.current !== null) {
      el.scrollLeft = pendingCenter.current * (el.scrollWidth - el.clientWidth)
      pendingCenter.current = null
    }
    const raf = requestAnimationFrame(() => syncThumb(true))
    return () => cancelAnimationFrame(raf)
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
    // same collation as the rendered column, so drag only considers visible cards
    return collateColumn(ms.filter((m) => unitStart(m.date, view2dRef.current) === k), view2dRef.current)
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
  // clamped on-screen, then PUSH any overlapped neighbour out of the way (cascading)
  // so cards can NEVER cover each other. offsetY is the pointer's clamped offset at
  // drop; we move it into pos[view] and slide yMV → 0 (fast tween — cannot bounce).
  const commitDrag = useCallback((id, offsetY) => {
    const v = view2dRef.current
    const base = memoriesRef.current?.find((m) => m.id === id)?.pos?.[v] ?? 0
    const raw = base + offsetY // where the card actually is at drop
    const h = cardHeight(id)
    const maxTop = maxTopFor(id)

    // other cards in this column/view — read from the LIVE DOM (offsetTop/
    // offsetHeight), not stale state, so placement holds on a column's very first
    // drag and with freshly-loaded image heights.
    const others = []
    for (const it of colItemsFor(id)) {
      if (it.id === id) continue
      const from = cardRefs.current.get(it.id)?.offsetTop ?? it.pos?.[v]
      if (from == null) continue
      others.push({ id: it.id, from, hh: cardHeight(it.id) })
    }

    // gentle magnetic snap: if the drop lands within SNAP_THRESHOLD of the column
    // top or of ABUTTING a neighbour (just above / just below, with MIN_GAP of
    // breathing room), click to that tidy position.
    const near = others.flatMap((o) => [o.from + o.hh + MIN_GAP, o.from - h - MIN_GAP])
    let y = raw
    let best = null
    for (const a of [0, ...near]) {
      const d = Math.abs(raw - a)
      if (d <= SNAP_THRESHOLD && (best == null || d < best.d)) best = { a, d }
    }
    if (best) y = best.a
    y = Math.min(Math.max(0, y), maxTop) // never off-screen / under the dock

    // PUSH, don't bounce. The dragged card stays where you let go; any neighbour
    // it now overlaps moves OUT OF THE WAY — down if it sits below the drop, up if
    // above — and the shove cascades to that card's own neighbours. (The old logic
    // relocated the DRAGGED card to a free slot, which is exactly what made a drop
    // feel "stuck" — you couldn't drop a card where another one already was.)
    const dragMid = y + h / 2
    const below = others.filter((o) => o.from + o.hh / 2 >= dragMid).sort((a, b) => a.from - b.from)
    const above = others.filter((o) => o.from + o.hh / 2 < dragMid).sort((a, b) => b.from - a.from)
    // each entry holds { from: where the card is now, to: its resolved top }, so
    // the glide loop below needs no second lookup.
    const tops = new Map([[id, { from: raw, to: y }]])
    let floor = y + h + MIN_GAP // lowest top the next card-down may take
    for (const o of below) {
      const t = Math.min(Math.max(o.from, floor), maxTopFor(o.id))
      tops.set(o.id, { from: o.from, to: t })
      floor = t + o.hh + MIN_GAP
    }
    let ceil = y - MIN_GAP // highest bottom the next card-up may take
    for (const o of above) {
      const t = Math.max(Math.min(o.from, ceil - o.hh), 0)
      tops.set(o.id, { from: o.from, to: t })
      ceil = t - MIN_GAP
    }

    // commit every moved card's top SYNCHRONOUSLY (flushSync), then glide each from
    // where it was to its new top via the transient yMV offset — the same one-frame
    // mechanism the dragged card uses, so pushed neighbours slide rather than
    // teleport. Same-frame top+offset avoids the one-frame flash (the "glitch").
    flushSync(() => setMemories((ms) => ms.map((m) =>
      tops.has(m.id) ? { ...m, pos: { ...(m.pos || {}), [v]: tops.get(m.id).to } } : m
    )))
    for (const [cid, { from, to }] of tops) {
      const mv = cardYMV(cid)
      mv.set(from - to)
      animate(mv, 0, CARD_SETTLE)
    }
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
  // positioning mechanism — no parallel cache to invalidate). Deps are
  // [memories, view2d] — the only things that change which cards need a seed —
  // NOT a missing dep array (that ran on every render and is the classic
  // "Maximum update depth" setState-in-effect loop). Converges in one extra
  // pass: after the commit the seeded cards have pos so nothing re-queues.
  useEffect(() => {
    const seeds = pendingSeeds.current
    if (!seeds.length) return
    pendingSeeds.current = []
    setMemories((ms) => ms.map((m) => {
      const s = seeds.find((x) => x.id === m.id)
      if (!s || (m.pos && m.pos[s.view] != null)) return m
      return { ...m, pos: { ...(m.pos || {}), [s.view]: s.top } }
    }))
  }, [memories, view2d])

  const todayISO = () => toISO(new Date())


  // New cards default to today; the composer's date picker lets the user change it.
  const anchorDate = () => todayISO()

  const blankCard = (date) => ({
    id: crypto.randomUUID(),
    type: 'note',
    title: '',
    body: '',
    date,
    color: randomColorKey(),
    media: [],
  })

  // commit a finished memory from the morphing composer form.
  // name only -> quote; name + note -> coloured card; media -> photo/video/audio.
  // editId set => update that memory in place (keep id/color/pos); else add new.
  const addFromComposer = ({ title, body, date, media, color }) => {
    const hasMedia = media && media.length
    const type = !hasMedia && title && !body ? 'quote' : 'note'
    if (editId) {
      setMemories((ms) => ms.map((m) => (m.id === editId ? { ...m, type, title, body, date, media: media || [], color } : m)))
    } else {
      setMemories((ms) => [...ms, {
        id: crypto.randomUUID(),
        type, title, body, date,
        media: media || [],
        color: color || randomColorKey(), // picked in the composer; fall back to random
      }])
    }
    beginShellMorph()
    setComposerOpen(false)
    setEditId(null)
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
    setEditId(null) // fresh add, not an edit
    setOpenId(null)
    setComposerKey((k) => k + 1) // fresh form each open
    beginShellMorph()
    setComposerOpen(true)
  }

  // open the composer pre-filled with a card's content to edit it (CTA -> "Save")
  const editMemory = useCallback((id) => {
    setEditId(id)
    setOpenId(null)
    setComposerKey((k) => k + 1) // remount so the form picks up the editing values
    beginShellMorph()
    setComposerOpen(true)
  }, [])

  const closeComposer = () => {
    beginShellMorph()
    setComposerOpen(false)
    setEditId(null)
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
      cachePreview(mediaId, file, kind) // instant local preview
      setMemories((ms) =>
        ms.map((m) =>
          m.id === id
            ? { ...m, saveError: false, media: [...(m.media || []), { id: mediaId, kind, name: file.name }] }
            : m
        )
      )
      // upload in the background; flag the card if it fails
      saveImageMedia(mediaId, file, kind).catch(() =>
        setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, saveError: true } : m)))
      )
    }
  }

  // ---- canvas interactions ----------------------------------------------
  // dropped/pasted files become a memory on today directly (quick-add). While
  // the composer is OPEN, drop/paste belong to the composer's upload block —
  // they must NOT create a timeline card (the card should only appear on "Add
  // to Timeline").
  const onDrop = async (e) => {
    e.preventDefault()
    if (!session) return // logged out: no adding
    if (composerOpen) return // composer's upload handles its own drop
    if (zoom.id === 'years') return // orbit view: no drop target
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    const card = blankCard(anchorDate())
    setMemories((ms) => [...ms, card])
    attachFiles(card.id, files)
  }

  useEffect(() => {
    const onPaste = async (e) => {
      if (!session) return // logged out: no adding
      if (composerOpen) return // don't quick-add while composing
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (!item) return
      const card = blankCard(anchorDate())
      setMemories((ms) => [...ms, card])
      attachFiles(card.id, [item.getAsFile()])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [memories, composerOpen, session])

  // blank only while the session resolves or memories load; the app shell
  // renders whether or not someone is signed in — a logged-out user sees the
  // empty base screen with a "Log in to continue" bar instead of the dock.
  if (session === undefined || !memories) return <div className="boot-blank" />

  const profile = session ? userProfile(session.user) : null

  const openCard = memories.find((m) => m.id === openId)

  // fresh per render — the columns map below queues fallback seeds into it,
  // and the effect above this return commits them after paint
  pendingSeeds.current = []

  return (
    <div className="viewport" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* Both views stay MOUNTED and cross-fade — remounting the 3D canvas on
          every Months↔Years switch (WebGL context + shaders + textures) was the
          source of the switch lag. But once a crossfade COMPLETES the inactive
          layer is visibility:hidden so it stops painting (timelineLive /
          orbitLive, completion-driven), and it's re-shown before the next
          crossfade begins — the symmetric partner to the orbit frameloop pause. */}
      <motion.div
        className="view-stack"
        initial={false}
        animate={booted ? { opacity: 1 } : { opacity: 0 }}
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
        // SHOW is derived (active view, or mid-fade) so the entering layer is
        // never hidden on the crossfade's first frame; HIDE is completion-driven
        style={{ visibility: (!isYears || timelineLive) ? 'visible' : 'hidden' }}
        onAnimationComplete={() => { if (zoomIdRef.current === 'years') setTimelineLive(false) }}
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
                      onEdit={editMemory}
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
        animate={isYears ? { opacity: 1 } : { opacity: 0 }}
        transition={VIEW_SWAP}
        // orbitLive drives BOTH the frameloop pause AND visibility:hidden, so the
        // hidden WebGL canvas neither renders nor composites. Flipped to false
        // only once the fade-out finishes (completion-driven; survives retuning
        // and rapid-toggle retargets — re-entering Years just retargets the fade)
        style={{ visibility: (isYears || orbitLive) ? 'visible' : 'hidden' }}
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
        {session ? (
        <motion.div
          className={`dock-shell ${composerOpen ? 'dock-shell-open' : ''}`}
          initial={{ y: 84, opacity: 0 }}
          animate={{
            y: booted ? 0 : 84,
            opacity: booted ? 1 : 0,
            // width never changes: the dock grows/shrinks ONLY vertically (like a
            // bottom sheet). Animating width too made the box pinch sideways as it
            // grew, and that lone horizontal settle at the end read as "weird".
            width: dockDims.toolbarW,
            height: composerOpen ? dockDims.composerH : 48,
          }}
          style={{ borderRadius: 24 }}
          transition={{
            // entrance: the panel rises LAST — after the content/photo and the
            // empty-state line have appeared (staged: photo → text ~0.9s → panel)
            y: { duration: 0.9, ease: SWIFT, delay: 1.1 },
            opacity: { duration: 0.6, ease: 'easeOut', delay: 1.1 },
            // height animates ONLY during an open/close morph (shellMorph state —
            // survives mid-morph re-renders); otherwise self-measurement snaps.
            // While open, content growth (adding a photo) animates gently.
            // (width is pinned to the bar's width, so it never needs a transition)
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
            animate={{ opacity: composerOpen ? 1 : 0, y: composerOpen ? 0 : 40 }}
            transition={composerOpen
              // the container opens first; the content then rises up from below
              // (y) and fades in (opacity), landing as the box finishes opening
              ? { opacity: { duration: 0.34, delay: 0.24, ease: 'easeOut' },
                  y: { duration: 0.46, delay: 0.24, ease: SWIFT } }
              : { duration: 0.1, ease: 'easeIn' }}
            style={{ pointerEvents: composerOpen ? 'auto' : 'none' }}
          >
            <Composer
              key={composerKey}
              active={composerOpen}
              defaultDate={anchorDate()}
              editing={editId ? memories.find((m) => m.id === editId) : null}
              onClose={closeComposer}
              onAdd={addFromComposer}
            />
          </motion.div>
        </motion.div>
        ) : (
        <motion.button
          className="login-bar"
          onClick={signInWithGoogle}
          initial={{ y: 84, opacity: 0 }}
          animate={{ y: booted ? 0 : 84, opacity: booted ? 1 : 0 }}
          transition={{ y: { duration: 0.9, ease: SWIFT, delay: 1.1 }, opacity: { duration: 0.6, ease: 'easeOut', delay: 1.1 } }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          <span>Log in to continue</span>
        </motion.button>
        )}
      </div>

      {session && (
        <button className="profile-btn" onClick={() => setSettingsOpen(true)} title="Account">
          {profile.avatarUrl
            ? <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" draggable={false} />
            : <span>{profile.initial}</span>}
        </button>
      )}

      <AnimatePresence>
        {settingsOpen && session && (
          <SettingsPanel user={session.user} onClose={() => setSettingsOpen(false)} onSignOut={handleSignOut} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openCard && <Lightbox key={openCard.id} m={openCard} onClose={() => setOpenId(null)} />}
      </AnimatePresence>
    </div>
  )
}
