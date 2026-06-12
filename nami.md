# Nami — Architecture & Module Map

> Living reference for the **Moments / Nami** timeline app. Read this before adding
> features so changes stay consistent. **Keep it updated when you add or move modules,
> change the data model, or introduce a new convention.**

---

## What it is

A personal memory timeline (inspired by Amie's calendar). Memories live as cards in
date columns on a horizontal, zoomable canvas. Three zoom levels: **Days**, **Months**,
**Years**. Years renders as an infinite 3D "orbit" of all memories.

## Stack

- **Vite + React 19** (no router, no TypeScript)
- **Framer Motion** — all enter/exit/morph animations
- **three.js + @react-three/fiber** — the Years 3D canvas
- **idb-keyval** — IndexedDB persistence (memory list + media blobs)
- No backend, no auth. Everything is local.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build (also the way we verify changes compile)
```
There is **no test runner**. Verification = `npm run build` + manual/preview checks.

---

## Data model

A **memory** object (stored in the `memories` array, persisted as a list):

```js
{
  id: string,            // crypto.randomUUID()
  type: 'note' | 'quote',// BASE type; real display type is derived (see inferType)
  title: string,
  body: string,          // optional note text
  date: 'YYYY-MM-DD',    // day the memory belongs to (no future dates allowed)
  media: [{ id, kind, name }],  // kind: 'image' | 'video' | 'audio'; blob stored by id (max 4 images)
  color: 'blue'|'yellow'|'pink'|'purple'|'mint'|'peach',  // fixed at creation
  pos?: { days?: number, months?: number }, // OPTIONAL manual vertical placement
                                             // (px from the column top), PER VIEW.
                                             // Absent ⇒ that column is still auto.
}
```

**Display type** is computed by `inferType(m)` in `media.js`, not stored:
- has video → `'video'`, else has image → `'photo'`, else has audio → `'audio'`
- no media + title only (no body) → `'quote'`
- otherwise → `'note'` (pastel coloured card)

**Storage** (`store.js`, idb-keyval):
- `moments:list` → the array of memories
- `img:<mediaId>` → a `Blob` for each media item (images/video/audio all use this)
- `imageURL(id)` returns a cached `URL.createObjectURL` for a blob

---

## Module map

| File | Responsibility |
|------|----------------|
| `src/main.jsx` | React entry. Renders `<App/>` (StrictMode is OFF — it caused double-mount issues). |
| `src/App.jsx` | The shell. Owns `memories` state, timeline geometry (columns), zoom, scroll + the zoom-pill scrollbar, the morphing dock↔composer, toast, lightbox routing, and the Days/Months timeline vs Years orbit switch. |
| `src/MemoryCard.jsx` | Renders one card (note/quote/photo/video/audio). **No inline editing — the composer is the only way to add; cards can only be opened (media) or deleted.** Exports the shared **`Icon`** component and **`useImage`** hook. Contains `PhotoBlock` (+`CLUSTER`), `VideoBlock`, `AudioBlock`. |
| `src/Composer.jsx` | The add form that the bottom toolbar morphs into. Title, note, big upload block, a **custom `CalendarPopover`** (portaled, anchored above the date field — we do NOT use the native date picker). |
| `src/Lightbox.jsx` | Expand view per media type: `PhotoExpand` (overlapping collage of prints, close at bottom, no text), `VideoExpand` (big, autoplay muted, volume toggle), `AudioExpand` (waveform + centred play/pause + scrubber). |
| `src/YearOrbit.jsx` | The Years view. Builds media items from all committed memories and renders the 3D canvas; `OrbitModal` is the click-to-open card. |
| `src/canvas3d/` | Ported infinite 3D canvas (from **edoardolunardi/infinite-canvas**, MIT). `InfiniteMemoryCanvas.jsx` (scene + controls), `textures.js` (paints notes/quotes to canvas textures, loads photo blobs via `buildMediaItems`), `utils.js` (chunk math). |
| `src/media.js` | Media helpers: `ACCEPT`, `MAX_SAFE_BYTES`, `kindFromMime`, `inferType`, `firstImageId`, `seededTilt`, `seededBars`, `videoThumb`, `fmtTime`, and the `icons` SVG-path map. |
| `src/store.js` | idb-keyval wrappers + the `COLORS` palette / `COLOR_KEYS`. |
| `src/time.js` | Date helpers: `DAY`, `ZOOMS`, `unitStart`, `startOfDay`, `addDays`, `toISO`, `fromISO`, `cardDateLabel`, `markerLabel`. |
| `src/styles.css` | All styling (single stylesheet). |

---

## Timeline geometry (the important bit)

In `App.jsx`, the `columns` memo turns `memories` into positioned columns:

- **Days view = sparse**: only days that have memories become columns.
- **Months view = continuous**: every month from January of the earliest year through
  the current month (empty months included), so the year fills out as time passes.
- Columns lay out **sequentially** at a fixed width `COL_W = 340` (not proportional to
  real time, Amie-style). `widthPx = columns.length * COL_W`.
- Each column is an absolutely-positioned flex stack; cards stack **top-aligned**, even
  gap, no overlap. New cards append below.
- **Years view** renders `<YearOrbit/>` instead of the column timeline.

**Both views are ALWAYS mounted** as stacked `.view-layer`s in `App.jsx` and cross-fade
on zoom change. This is deliberate: remounting the 3D canvas on every Months↔Years
switch (WebGL context + shader compile + texture builds) caused visible lag.
**One unified switch motion**: the zoom-pill morph, the view crossfade, and the
Days↔Months card glide all run on the shared **`LIQUID`** spring (`anim.js`) / a ~0.42s
`VIEW_SWAP`, so they land together (~0.4s) instead of three staggered speeds.
Consequences to respect:
- `scrollRef` is **never null** anymore — gate orbit-vs-timeline logic on the zoom
  (see `zoomIdRef` used by `syncThumb`, and the `zoom.id === 'years'` check in `onDrop`).
- Don't conditionally unmount either view; toggle via the layer animation.
- **The 2D layout is FROZEN while in Years** (`view2d` latch in `App.jsx`): the timeline
  keeps its last days/months grouping instead of regrouping to year-columns. Regrouping
  the hidden layer mid-crossfade sent every `layoutId` card flying into a one-column
  pile while the layer faded — the months↔years card glitch. All 2D logic (columns memo,
  markers, drag `view`) keys on `view2d`, never `zoom.id`.
- **The inactive layer is `visibility:hidden` once its crossfade COMPLETES** so it stops
  painting/compositing (`timelineLive` / `orbitLive`, set false in the layer's
  `onAnimationComplete`). SHOW is **derived** (`!isYears || timelineLive` etc.) so the
  entering layer is visible on the crossfade's first frame; HIDE is completion-driven so
  visibility never flips in the same frame the morph starts (the old hitch). The orbit's
  `frameloop` rides the same `orbitLive` flag, and its crossfade is **opacity-only** (no
  scale leg — a scaling WebGL canvas re-composites every frame).
- **No static `will-change`** on `.view-stack` / `.view-layer` / `.card-manual` — framer
  applies it for the duration of each animation (and a card sets it imperatively only
  during a live drag), so nothing is pinned to its own GPU layer at rest.

The **zoom pill is the scrollbar**: its width = `viewport/scrollWidth`, its position
tracks scroll, and you can drag it. See `syncThumb` / `thumbX` / `thumbWmv`. The smooth
morph (zoom switches) is ONE `animate()` driving x+width together; its target is
**re-read when a scroll/resize fires mid-morph** (`thumbDirty` flag — not per-frame, that
would force a reflow every frame). On a zoom switch the `scrollLeft` restore and the pill
morph are split across frames (`syncThumb(true)` is deferred to `requestAnimationFrame`)
so the morph's first frame isn't stacked on the restore's forced reflow.

**Boot sequence**: white overlay + thin grey bar (`.boot-overlay/.boot-track/.boot-fill`;
the bar width is driven by a MotionValue — no CSS transition). It's a **fixed ~1s
loader**: `bootMV` animates 0→100% over 1s and `booted` flips on a 1000ms timer,
**regardless** of whether the orbit textures finished (the planes stagger-fade in as they
load). A slow storage read can't strand it. On `booted`: overlay fades, the view-stack
dissolves in from above, orbit planes **stagger in** (module `introStart` + per-plane
seeded delay in `InfiniteMemoryCanvas`), and the dock rises from the bottom edge.

---

## Manual card placement (vertical drag)

In the **2D timeline only** (Days + Months; the Years orbit is unaffected) a card can be
**dragged vertically within its own date column** to reposition it. The card's X is fixed
(full column width) and its **date never changes** — no horizontal / cross-column drag.

**Auto vs manual, per column, per view.** A column is either:
- **auto** — the default flex stack + seeded `scatter` (top-aligned, 14px gap), or
- **manual** — every card absolutely positioned at its own `top` (`m.pos[view]`).

The **first drag** in a column **flips that whole column to manual** for the current view.
It flips when the pointer crosses the 4px drag threshold (`onCardDragStart`, inside
`flushSync`): every card's `pos[view]` is seeded from its **current `offsetTop`** and all
become absolutely placed in the *same synchronous render* — no reflow, no visual jump.
**Manual-ness is DERIVED FROM DATA** (`isManualCol`: any card with `pos[view]`), not local
state, so manual layouts work after reload.

**Persistence.** Manual Y is stored on the memory as **`m.pos = { days?, months? }`** (a memory
sits in both a Days column and a Months column at independent positions). It rides the existing
debounced `saveMemories` autosave, so it survives reload. Cards WITHOUT a `pos` in a manual
column (newly added) stack below the lowest placed card; that fallback top is **committed into
`pos[view]` by an effect right after the render that computed it** (`pendingSeeds`), so there is
ONE positioning mechanism and the placement persists like any dragged position.

**The drag is a CUSTOM pointer implementation** (`startDrag/moveDrag/endDrag/cancelDrag` in
`MemoryCard.jsx`) — framer's drag system fought the settle (its constraint snap-back is an
uncontrollable bouncy inertia). Pointer delta writes the per-card **`yMV` MotionValue** (App's
`yMVs` map), clamped live to `dragBounds`. On drop (`commitDrag`): gentle magnetic snap
(`SNAP_THRESHOLD = 12px`) to the column top or ABUTTING a neighbour with `MIN_GAP` (14px),
clamp on-screen, then a **hard no-overlap resolve** (bands read from the LIVE DOM); the commit
is `flushSync`ed and `yMV` slides to 0 (`CARD_SETTLE`, a 0.13s tween — cannot bounce).
`onPointerCancel` and unmount-mid-drag **revert** via `cancelCardDrag` (never commit, never
leak `dragActive`). Drop = silent `navigator.vibrate` tick. **No UI sounds anywhere.**

**Always on-screen.** The band a card may occupy is `[0, visible - cardHeight]` where
`visible = window.innerHeight - COL_TOP - DOCK_CLEARANCE(96)`, read LIVE at gesture time
(`maxTopFor` / `getDragBounds` — no viewport-height state, so resizes don't re-render the card
tree). Bounds are computed once per gesture at the drag threshold; `commitDrag` clamps at drop.
Committed positions are NOT re-clamped at render (that collapsed tall columns).

**Layout animation integration.** ALL cards (auto AND manual) carry `layoutId={m.id}` +
`layout="position"` — manual columns glide on view toggles like everyone else. Renders that
belong to a drag set App's **`dragActive` ref → `instantLayout` prop → layout transition
`{duration: 0}`**, so projection never animates against the pointer or the drop compensation.
`dragActive` is set at drag start and cleared in `commitDrag`/`cancelCardDrag` — if you add a
new drag path, you MUST clear it. Drag lift = `whileTap` (scale 1.02 + soft shadow); hover =
scale 0.98; gesture transforms settle on a 0.14s tween (never a spring).

---

## Key conventions / invariants

- **No future dates.** New cards and the calendar clamp to today (`todayISO()`).
- **No per-day limit.** Any number of memories per day (the old 2/day cap + toast were removed).
- **App opens in Years view** on load (`zoomIdx` starts at 2) to avoid a Days-pill flash,
  behind the fixed ~1s boot loader (see *Boot sequence*).
- **Colours are fixed at creation** (truly random from the palette), not user-changeable.
  Card title text always uses the matching `color.text` hue of its pastel `color.bg`.
- **Icon buttons follow the `.icon-btn` pattern**: no fill at rest, fill on hover/active.
- **Fonts**: UI is `system-ui`; card titles are weight 500; **quotes are handwritten
  `Caveat`** rendered as highlight strips (`box-decoration-break: clone`) in the memory's
  palette colour — no pins. Same treatment painted in the orbit (`paintQuote`).
- **Card text order**: title → body/note → media. Title is tinted
  `color-mix(text 78%, white)`, body `color-mix(text 60%, white)` — always the card's hue.
- **Multi-photo cards = polaroid row** (`CLUSTER` in `MemoryCard.jsx`): up to 3 square
  white-framed prints side by side, overlapping edges, seeded tilts.
- **Photo expand = spread collage** (`COLLAGE` slots in `Lightbox.jsx`, up to 4 prints,
  minimal overlap so every print stays visible).
- **Scattered placement (AUTO columns)**: cards are **mostly top-anchored** — the first card
  in a column has `marginTop: 0` ~70% of the time, occasionally dropping to ~140–260px.
  Consecutive cards keep ONE uniform gap (the column's 14px flex gap — no extra randomness).
  Stable per card (`seedFrac`), never overlapping. Once a column is dragged it becomes
  **manual** for that view and scatter no longer applies (see *Manual card placement*).
- **Hover**: the card scales *down* slightly (`whileHover scale 0.98`) and the × delete
  appears. **No inline editing** — clicking a media card opens the lightbox; notes/quotes
  do nothing on click. The composer is the only add path (drop/paste create a card
  directly on today).
- **Tilts/waveforms are seeded by id** (`seededTilt`, `seededBars`) so they're stable
  across reloads.
- **The bottom dock morphs** between the toolbar and the composer via measured
  width/height (not framer `layout`), so there's no scale distortion. The size springs
  (`SHELL_OPEN/CLOSE`, ~critically damped) animate ONLY while **`shellMorph` STATE** is
  true (set on open/close, cleared by a 700ms timer). It must stay state, not a ref —
  the old ref was cleared by whichever animation completed first, so the mid-morph
  `ResizeObserver` re-render snapped the shell. Faces crossfade tightly (out 0.1s,
  in 0.18s @ +0.07s) in time with the size morph.
- **The scroller is `motion.div` with `layoutScroll`** — framer's projection must account
  for its scroll offset or every `layoutId` glide breaks when the zoom switch restores
  `scrollLeft` in the same commit. Don't remove it.

## How to add things

- **New media type** → extend `kindFromMime` + `inferType` + a `*Block` in `MemoryCard`
  + a `*Expand` in `Lightbox`.
- **New card content** → add to the memory object, render it in `MemoryCard` and add an
  input to the composer (the only add path — there is no inline editing); it auto-saves
  via the debounced effect, which strips transient flags like `warnLarge`.
- **Anything date/column related** → go through `time.js` + the `columns` memo, don't
  recompute dates inline.

> ⚠️ Update this file whenever the above changes.
