import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, LayoutGroup, animate, motion, motionValue, useMotionValue } from 'framer-motion'
import { SWIFT, LIQUID } from './anim.js'
import MemoryCard, { Icon } from './MemoryCard.jsx'
import YearOrbit from './YearOrbit.jsx'
import Lightbox from './Lightbox.jsx'
import Composer from './Composer.jsx'
import BulkUploader from './BulkUploader.jsx'
import { supabase, userProfile } from './supabase.js'
import { loadMemories, saveMemories, saveImageMedia, cachePreview, deleteImage, randomColorKey } from './store.js'
import { kindFromMime, MAX_SAFE_BYTES, seedFrac, icons } from './media.js'
import { ZOOMS, markerLabel, toISO, fromISO, unitStart, currentMonthDays, currentYearMonths } from './time.js'

const MARKER_H = 130 // px reserved at top for date markers
// LIQUID (the shared switch spring — pill morph + card glide) lives in anim.js
// The dock morph. OPEN is a spring (the reverse-of-close feel). CLOSE is a
// fixed-duration TWEEN, not a spring: adding an image grows the composer via its
// own spring, so clicking Add interrupts that in-flight motion — a spring close
// carries the leftover UPWARD velocity and drifts/stalls before reversing (the
// "stuck in between, then goes" hitch), and its overdamped tail hangs near the
// end over the taller distance. A tween interpolates from the current height
// with no velocity carryover and no tail, so the shrink is smooth every time.
// SWIFT (easeOutExpo-ish) keeps the snappy-then-soft character.
const SHELL_OPEN = { type: 'spring', stiffness: 320, damping: 36, mass: 1 }
const SHELL_CLOSE = { duration: 0.34, ease: SWIFT }
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
const DAY_MAX = 4 // most memories allowed on a single day (governs the bulk-upload capacity)
const IMAGES_PER_CARD = 4 // a single card holds up to this many images
// Per-day content-type rule (composer): a memory counts as an "image memory" if
// its media has any image; everything else (a note or a bare quote) is a
// note/quote memory. A day allows at most 2 image memories + 1 note/quote.
const isImageMemory = (mediaArr) => mediaArr?.some((x) => x.kind === 'image')
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

// Seeded ONCE per page load (module scope = never re-rolls on an App re-render).
// The Months view samples only MONTHS_VIEW_MAX cards from a busy month; this seed
// makes that sample stable within a session but varied between page loads.
const SESSION_SEED = Math.random()

// Pick a session-stable, month-varied sample of a busy month's cards. Each column
// gets its own starting offset (SESSION_SEED + a per-key fraction from seedFrac,
// whose rolling hash spreads adjacent month keys well apart) so different months
// surface different memories; picked items are re-sorted by date so the column
// still reads chronologically.
const pickForMonth = (sorted, colKey) => {
  if (sorted.length <= MONTHS_VIEW_MAX) return sorted
  const offset = Math.floor((SESSION_SEED + seedFrac(colKey)) * sorted.length) % sorted.length
  const idxs = Array.from({ length: MONTHS_VIEW_MAX }, (_, i) => (offset + i) % sorted.length)
  return idxs.map((i) => sorted[i]).sort(byDate)
}

const collateColumn = (items, view, key) => {
  const sorted = items.slice().sort(byDate)
  return view === 'months' ? pickForMonth(sorted, key) : sorted
}

// The ordered column keys for a view. Days is sparse (only days with memories);
// Months is continuous (every month from the earliest year to now). Both fall
// back to a placeholder scaffold when empty so the canvas is never blank. Shared
// by the `columns` memo and the zoom shrink-test so the two can't diverge.
const columnKeys = (memories, view) => {
  if (!memories) return []
  if (view === 'months') {
    if (!memories.length) return currentYearMonths()
    const today = new Date()
    let earliestYear = today.getFullYear()
    for (const m of memories) earliestYear = Math.min(earliestYear, fromISO(m.date).getFullYear())
    const keys = []
    let d = new Date(earliestYear, 0, 1)
    const end = new Date(today.getFullYear(), today.getMonth(), 1)
    while (d <= end) { keys.push(toISO(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1) }
    return keys
  }
  const keys = [...new Set(memories.map((m) => unitStart(m.date, view)))].sort()
  return keys.length ? keys : currentMonthDays()
}

// Shown to logged-out visitors so the product is visible immediately (read-only —
// never written to Supabase). Placeholder entries; real Cloudinary media later.
const DEMO_MEMORIES = [
  { id: 'demo-1', type: 'note', title: 'Morning hike', body: 'First trail of the year', date: '2024-03-08', color: 'mint', media: [] },
  { id: 'demo-2', type: 'note', title: "Dad's birthday", body: 'The whole family came', date: '2024-03-22', color: 'yellow', media: [] },
  { id: 'demo-3', type: 'note', title: 'Beach day', body: '', date: '2024-04-14', color: 'blue', media: [] },
  { id: 'demo-4', type: 'note', title: 'Garden party', body: "Mia's farewell evening", date: '2024-05-03', color: 'purple', media: [] },
  { id: 'demo-5', type: 'note', title: 'Road trip', body: '3 days, 1,200 km', date: '2024-06-17', color: 'peach', media: [] },
  { id: 'demo-6', type: 'note', title: 'Rooftop dinner', body: 'Golden hour over the city', date: '2024-06-28', color: 'pink', media: [] },
]

// Solid top nav (no gradient/blur) with a bottom border matching the month
// gridlines, over the live demo timeline when signed out.
// "Report a bug" / "Request a feature" open a Gmail compose window (new tab),
// pre-addressed to SUPPORT_EMAIL with the subject filled in.
const SUPPORT_EMAIL = 'vedant.vai@gmail.com'
const gmailCompose = (subject) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${SUPPORT_EMAIL}&su=${encodeURIComponent(subject)}`

// Account-menu icons (Lucide) — one shared <svg> wrapper, one path set each.
const NAV_ICONS = {
  bug: <><path d="M12 20v-9" /><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" /><path d="M14.12 3.88 16 2" /><path d="M21 21a4 4 0 0 0-3.81-4" /><path d="M21 5a4 4 0 0 1-3.55 3.97" /><path d="M22 13h-4" /><path d="M3 21a4 4 0 0 1 3.81-4" /><path d="M3 5a4 4 0 0 0 3.55 3.97" /><path d="M6 13H2" /><path d="m8 2 1.88 1.88" /><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" /></>,
  feature: <><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" /><rect x="3" y="14" width="7" height="7" rx="1" /><circle cx="17.5" cy="17.5" r="3.5" /></>,
  logout: <><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></>,
}
const MenuIcon = ({ name }) => (
  <svg className="nav-menu-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {NAV_ICONS[name]}
  </svg>
)

// Persistent top nav across the whole product. Right slot: a profile avatar
// (opens the account menu) when signed in, else the "Login" CTA.
function TopNav({ session, profile, onSignIn, onSignOut, onBulkPick }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const accountRef = useRef(null)
  const bulkInputRef = useRef(null)
  // close the menu on an outside click or Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => { if (!accountRef.current?.contains(e.target)) setMenuOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  return (
    <div className="top-nav">
      <span className="nav-brand">Nami</span>
      {session ? (
        <div className="nav-right">
          <button className="nav-bulk" onClick={() => bulkInputRef.current?.click()}>
            <Icon d={icons.upload} size={16} />
            Bulk upload
          </button>
          <input
            ref={bulkInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const picked = [...e.target.files]
              e.target.value = '' // allow re-picking the same files
              if (picked.length) onBulkPick(picked)
            }}
          />
        <div className="nav-account" ref={accountRef}>
          <button
            className="nav-avatar"
            onClick={() => setMenuOpen((o) => !o)}
            title="Account"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {profile.avatarUrl
              ? <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" draggable={false} />
              : <span>{profile.initial}</span>}
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                className="nav-menu"
                role="menu"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: SWIFT }}
              >
                {(profile.name || profile.email) && (
                  <div className="nav-menu-head">
                    {profile.name && <span className="nav-menu-name">{profile.name}</span>}
                    {profile.email && <span className="nav-menu-email">{profile.email}</span>}
                  </div>
                )}
                <a className="nav-menu-item" role="menuitem" href={gmailCompose('Nami bug report')} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
                  <MenuIcon name="bug" />
                  Report a bug
                </a>
                <a className="nav-menu-item" role="menuitem" href={gmailCompose('Nami feature request')} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
                  <MenuIcon name="feature" />
                  Request a feature
                </a>
                <div className="nav-menu-sep" />
                <button className="nav-menu-item nav-menu-logout" role="menuitem" onClick={() => { setMenuOpen(false); onSignOut() }}>
                  <MenuIcon name="logout" />
                  Log out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </div>
      ) : (
        <button className="nav-login" onClick={onSignIn}>
          <svg className="nav-login-logo" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          <span>Login</span>
          <span className="nav-login-chev" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [memories, setMemories] = useState(null)
  const [zoomIdx, setZoomIdx] = useState(2) // open in Years view on load
  const [openId, setOpenId] = useState(null) // lightbox
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKey, setComposerKey] = useState(0) // remount composer fresh on each open
  const [bulkFiles, setBulkFiles] = useState(null) // File[] while the bulk-placement modal is open
  const [toast, setToast] = useState(null) // transient top toast (e.g. day-full); auto-dismisses
  const toastTimer = useRef(null)
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const showToast = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }
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
  const signingOut = useRef(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  // Sign out, then hard-reload so the app lands on a FRESH demo state. A same-
  // page swap (real memories → demo) morphed the orbit in place — cards stretched
  // and content stayed stale until scroll. A reload sidesteps that entirely.
  const handleSignOut = async () => {
    signingOut.current = true // the SIGNED_OUT event fires before the reload — don't swap to demo in place
    await supabase.auth.signOut()
    window.location.reload()
  }
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
    if (signingOut.current) return // reload imminent — don't morph the orbit to demo in place
    if (session === undefined) return // still resolving — stay on boot-blank, don't flash demo
    if (!session) { setMemories(DEMO_MEMORIES); return } // logged out: read-only demo timeline
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
    return columnKeys(memories, view2d).map((k, i) => {
      // chronological within a column; Months collates to a session-seeded sample (see collateColumn)
      const items = collateColumn(groups.get(k) || [], view2d, k)
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
      const w = Math.max(88, Math.min(TRACK_W, Math.round(TRACK_W * frac))) // min keeps ≥8px padding around the label
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
  // The flicker on a shrinking zoom (Months→Days) was never the flight itself —
  // it was the browser AUTO-CLAMPING scrollLeft the instant the narrower canvas
  // commits, before our restore lands, so the cards were measured against a
  // clamped scroll for one frame. We defeat the clamp at the source: hold the
  // canvas at least as wide as it was BEFORE the switch for the switch commit,
  // restore scroll under that wide canvas (no clamp is possible), then release
  // the floor on the next frame. With no clamp there's nothing to hide, so the
  // shared-layout flight stays on in BOTH directions (framer's layoutScroll
  // absorbs the release-frame re-narrowing — a pure scroll change, not a move).
  const [zoomWidthFloor, setZoomWidthFloor] = useState(0)
  const setZoomKeepCenter = (idx) => {
    const el = scrollRef.current
    pendingCenter.current = null
    pendingCenterDate.current = null
    setZoomWidthFloor(el ? el.scrollWidth : 0)
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
    // layout + scroll are now settled for the new view. Next frame: drop the
    // width floor so the canvas returns to its true width (the flight is already
    // gliding, so re-narrowing here reads as a pure scroll change that
    // layoutScroll absorbs, not a second move), and morph the pill.
    const raf = requestAnimationFrame(() => {
      setZoomWidthFloor(0)
      if (el) el.scrollLeft = Math.min(el.scrollLeft, el.scrollWidth - el.clientWidth)
      syncThumb(true)
    })
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

  // ---- months-view scatter (delight) -----------------------------------
  // Lay a month's cards out top-to-bottom at varied heights so the wall reads
  // hand-arranged rather than a flat stack — but with a HARD no-overlap
  // guarantee. Each card is placed strictly below the previous card's bottom
  // (plus MIN_GAP), and the leftover vertical space is handed out as seeded
  // random gaps above/between/below the cards. Because every card sits below
  // the one before it, cards (and their images) can never overlap; because the
  // gaps sum to exactly the free space, the whole column always fits above the
  // dock (there is no vertical scroll). Seeded by id → stable, never jitters.
  // No tilt, no horizontal nudge: cards stay square and inside their column.
  const SCATTER_MAX_GAP = 96 // most extra breathing room a card adds above itself
  const scatterTops = (items) => {
    const n = items.length
    const colAvail = Math.max(120, window.innerHeight - COL_TOP - DOCK_CLEARANCE)
    const heights = items.map((m) => cardHeight(m.id))
    // Each card's extra gap is seeded on its OWN id and drawn from a per-slot
    // budget, so a card's top depends only on the cards BEFORE it (their seeds +
    // heights) — appending a card never moves the ones above it. The running
    // cursor keeps every card strictly below the previous one (no overlap), and
    // the budget keeps the whole column within colAvail (never under the dock).
    const fixed = heights.reduce((a, b) => a + b, 0) + MIN_GAP * (n + 1)
    const perSlot = Math.min(SCATTER_MAX_GAP, Math.max(0, (colAvail - fixed) / (n + 1)))
    const tops = {}
    let cursor = MIN_GAP + seedFrac(items[0].id + ':g') * perSlot
    for (let i = 0; i < n; i++) {
      tops[items[i].id] = Math.round(cursor)
      const nextGap = i + 1 < n ? seedFrac(items[i + 1].id + ':g') * perSlot : 0
      cursor += heights[i] + MIN_GAP + nextGap
    }
    return tops
  }

  // the dragged card's column-mates, derived at event time from fresh data
  const colItemsFor = (id) => {
    const ms = memoriesRef.current || []
    const me = ms.find((m) => m.id === id)
    if (!me) return []
    const k = unitStart(me.date, view2dRef.current)
    // same collation (and same session-seeded sample) as the rendered column, so
    // drag only considers visible cards — pass the key so the pick matches
    return collateColumn(ms.filter((m) => unitStart(m.date, view2dRef.current) === k), view2dRef.current, k)
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
    // Insert in the SAME commit as the close. shellMorph (state, timer-cleared)
    // and the size-measure bail-out already protect the shrink from mid-morph
    // re-measures, and the card's image loads async (useThumb) so no decode
    // happens in this commit — deferring the insert a frame bought nothing and
    // only made the new card mount late, out of sync with the close.
    if (editId) {
      // editing in place — never counts against the per-day limit, always allowed
      setMemories((ms) => ms.map((m) => (m.id === editId ? { ...m, type, title, body, date, media: media || [], color } : m)))
    } else {
      // new memory — content-type-aware per-day cap: at most 2 image memories
      // and 1 note/quote memory per day. If the relevant slot is full, reject
      // WITHOUT closing (the composer keeps its form + open state) and flag it
      // with a toast. Editing (the branch above) is always allowed.
      const dayMemories = memories.filter((m) => m.date === date)
      const addingImage = isImageMemory(media)
      if (addingImage && dayMemories.filter((m) => isImageMemory(m.media)).length >= 2) {
        showToast('This day already has 2 photos. Add a note instead.')
        return
      }
      if (!addingImage && dayMemories.filter((m) => !isImageMemory(m.media)).length >= 1) {
        showToast('This day already has a note. Add a photo instead.')
        return
      }
      setToast(null)
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
      setDockDims((d) => {
        const toolbarW = tw || d.toolbarW, composerH = ch || d.composerH
        // bail out (same reference) when nothing changed, so a re-measure never
        // forces a needless re-render mid-morph
        return toolbarW === d.toolbarW && composerH === d.composerH ? d : { toolbarW, composerH }
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (toolbarRef.current) ro.observe(toolbarRef.current)
    if (composerRef.current) ro.observe(composerRef.current)
    return () => ro.disconnect()
    // `session` + `memories` matter: the dock mounts once the session resolves,
    // and in demo mode memories are set while session is still loading — without
    // a re-run here the toolbar keeps its stale default width (extra side padding
    // until a zoom click). Re-measuring on every add used to hitch the close,
    // but setDockDims now bails out when the size is unchanged (which it is on
    // add — the composer keeps its content as it fades), so there's no re-render.
  }, [composerKey, zoomIdx, memories, session])

  // Persist dropped/picked/pasted files as blobs, attach refs to the card
  const attachFiles = async (id, files) => {
    const accepted = files.map((f) => ({ file: f, kind: kindFromMime(f.type) })).filter((x) => x.kind)
    if (!accepted.length) return
    const tooLarge = accepted.some(({ file }) => file.size > MAX_SAFE_BYTES)
    setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, warnLarge: tooLarge } : m)))

    const existingImgs = memories?.find((m) => m.id === id)?.media?.filter((x) => x.kind === 'image').length || 0
    let imgRoom = IMAGES_PER_CARD - existingImgs // cap images per card
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
    // multiple images at once -> full-screen placement flow (assign a date each);
    // a single file (or a non-image drop) keeps the existing quick-add behaviour
    const imgs = files.filter((f) => kindFromMime(f.type) === 'image')
    if (imgs.length > 1) { setBulkFiles(imgs); return }
    const card = blankCard(anchorDate())
    setMemories((ms) => [...ms, card])
    attachFiles(card.id, files)
  }

  // How many more images a given day can hold: (free cards) x IMAGES_PER_CARD.
  // Single source for both the uploader's live validation and the commit below.
  const imageRoomFor = useCallback(
    (date) => Math.max(0, DAY_MAX - (memories?.filter((m) => m.date === date).length || 0)) * IMAGES_PER_CARD,
    [memories],
  )

  // Commit the bulk-placement modal: photos sharing a date are GROUPED onto one
  // card (chunked to the IMAGES_PER_CARD cap), and a day never exceeds DAY_MAX
  // cards; any photos beyond a day's capacity are skipped and flagged.
  const handleBulkCommit = (assignments) => {
    const byDate = new Map()
    for (const { file, date } of assignments) {
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date).push(file)
    }
    let skipped = 0
    for (const [date, dateFiles] of byDate) {
      const place = dateFiles.slice(0, imageRoomFor(date)) // respects DAY_MAX cards x IMAGES_PER_CARD
      skipped += dateFiles.length - place.length
      for (let i = 0; i < place.length; i += IMAGES_PER_CARD) {
        const card = blankCard(date)
        setMemories((ms) => [...ms, card])
        attachFiles(card.id, place.slice(i, i + IMAGES_PER_CARD))
      }
    }
    setBulkFiles(null)
    if (skipped) showToast("Some photos weren't added. Those days were full.")
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
    <div className="viewport viewport-with-nav" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
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
        <div className="canvas" style={{ width: Math.max(widthPx, zoomWidthFloor) }}>
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
              // A non-manual MONTHS column gets the seeded scatter: cards are
              // absolutely placed at non-overlapping, hand-arranged tops. It
              // renders exactly like a manual column, so the drag/drop system and
              // the Days↔Months flight need no special-casing — only the initial
              // top differs (seed, not saved pos). The first drag flips it to a
              // real manual column (onCardDragStart seeds every card from its
              // live offsetTop, so the scattered layout is preserved with no jump).
              const scattered = !isManual && view2d === 'months'
              const scatterTop = scattered && items.length ? scatterTops(items) : null
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
                className={`column ${(isManual || scattered) ? 'column-manual' : ''}`}
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
                    } else if (scattered) {
                      top = scatterTop[m.id]
                    }
                    return (
                    <MemoryCard
                      key={m.id}
                      ref={cardRefCb(m.id)}
                      m={m}
                      index={idx}
                      entered={entered}
                      manual={isManual || scattered}
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
          active={isYears || orbitLive}
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

            {session && <span className="zoombar-divider" />}
            {session && <button className="add-cta" onClick={openComposer}>Add</button>}
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
              notice={toast}
            />
          </motion.div>
        </motion.div>
      </div>

      <TopNav
        session={session}
        profile={profile}
        onSignIn={signInWithGoogle}
        onSignOut={handleSignOut}
        onBulkPick={setBulkFiles}
      />

      <AnimatePresence>
        {openCard && <Lightbox key={openCard.id} m={openCard} onClose={() => setOpenId(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {bulkFiles && (
          <BulkUploader
            files={bulkFiles}
            onClose={() => setBulkFiles(null)}
            onCommit={handleBulkCommit}
            capacityFor={imageRoomFor}
          />
        )}
      </AnimatePresence>

      {/* top toast for messages shown while the composer is closed (e.g. the
          bulk "some days were full" notice); the composer shows its own toast
          above the CTA when open */}
      <AnimatePresence>
        {toast && !composerOpen && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: -12, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -12, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
