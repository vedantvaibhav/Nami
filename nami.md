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
on zoom change (0.3s, slight scale). This is deliberate: remounting the 3D canvas on
every Months↔Years switch (WebGL context + shader compile + texture builds) caused
visible lag. The hidden layer is **opacity-0 but stays painted** (`pointer-events: none`; do NOT
flip `visibility` — that forces a full repaint in the same frame the pill morph starts
and causes a visible hitch), and the orbit's R3F `frameloop` flips to `'never'` (via the
`active` prop chain `App → YearOrbit → InfiniteMemoryCanvas`) so it costs ~nothing idle.
Consequences to respect:
- `scrollRef` is **never null** anymore — gate orbit-vs-timeline logic on the zoom
  (see `zoomIdRef` used by `syncThumb`, and the `zoom.id === 'years'` check in `onDrop`).
- Don't conditionally unmount either view; toggle via the layer animation.

The **zoom pill is the scrollbar**: its width = `viewport/scrollWidth`, its position
tracks scroll, and you can drag it. See `syncThumb` / `thumbX` / `thumbWmv`.

---

## Manual card placement (vertical drag)

In the **2D timeline only** (Days + Months; the Years orbit is unaffected) a card can be
**dragged vertically within its own date column** to reposition it. The card's X is fixed
(full column width) and its **date never changes** — no horizontal / cross-column drag.

**Auto vs manual, per column, per view.** A column is either:
- **auto** — the default flex stack + seeded `scatter` (top-aligned, 14px gap), or
- **manual** — every card absolutely positioned at its own `top` (`m.pos[view]`).

The **first drag** in a column **flips that whole column to manual** for the current view.
It flips at **drag start** (`onCardDragStart` in `App.jsx`): every card's `pos[view]` is
seeded from its **current `offsetTop`** and all cards become absolutely placed in the *same
render*, so nothing reflows and the dragged card stays under the cursor (no visual jump).
State lives in `App.jsx`: `manualCols` (a `Set` of `` `${view}:${columnKey}` ``).

**Persistence.** Manual Y is stored on the memory as **`m.pos = { days?, months? }`** (a memory
sits in both a Days column and a Months column at independent positions). It rides the existing
debounced `saveMemories` autosave (which only strips the transient `warnLarge` flag), so it
survives reload. Transient drag state is NOT persisted (see below).

**The transient `yMV`.** Each card has a per-id **`MotionValue`** (App's `yMVs` map, via
`cardYMV`) carrying only the *transient drag offset* (0 at rest). framer's `drag="y"` writes it
live; `m.pos[view]` is the committed `top`. On drop (`commitDrag`): `raw = pos + offset`, apply a
**gentle magnetic snap** (`SNAP_THRESHOLD = 12px`) to the column top (0) or a neighbour card's
top/bottom edge, then **clamp** to `[0, visibleHeight - cardHeight]`. The card is kept under the
cursor (`yMV = raw - target`) and `yMV` is then **sprung to 0** (`CARD_SETTLE`) so it settles
magnetically rather than snapping abruptly. `drag` is **always enabled** so the first drag in an
auto column works on the first try (framer must own the gesture from pointer-down).

**Always on-screen.** `visibleHeight = window.innerHeight - (MARKER_H+20) - DOCK_CLEARANCE(96)`,
recomputed from the live viewport height (`vh` state) so it adapts to resize / bigger screens.
`clampY` keeps every card fully visible and clear of the floating dock; `dragConstraints`
(`dragBounds`, expressed on the transient `yMV` offset) enforce the same band during the drag.

**Integration notes.**
- Manual cards set `layout={false}` / `layoutId={undefined}` — the absolute `top` + `yMV`
  transform is the source of truth, and a shared-layout transform would fight the drag/clamp.
  Consequence: a manual column **opts out of the Days↔Months toggle glide** for that view.
- Auto cards keep `layout="position"` + `layoutId={m.id}` (the glide). They do **not** carry
  `yMV` in `style` (mixing an explicit `y` with `layout` fights it); the first auto drag uses
  framer's internal drag transform and continues seamlessly onto `yMV` at the flip.
- Drag lift = `whileDrag` (scale 1.04 + raised shadow + z-index 50).

---

## Key conventions / invariants

- **No future dates.** New cards and the calendar clamp to today (`todayISO()`).
- **Max `DAY_LIMIT = 2` memories per day.** Enforced at every add path (composer, drop,
  paste) and surfaced via the `toast`.
- **App opens in Years view** on load (`zoomIdx` starts at 2) to avoid a Days-pill flash.
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
  width/height (not framer `layout`), so there's no scale distortion. Open uses one
  spring, close a slower one; size only animates during an actual open/close.

## How to add things

- **New media type** → extend `kindFromMime` + `inferType` + a `*Block` in `MemoryCard`
  + a `*Expand` in `Lightbox`.
- **New card content** → add to the memory object, render it in `MemoryCard` and add an
  input to the composer (the only add path — there is no inline editing); it auto-saves
  via the debounced effect, which strips transient flags like `warnLarge`.
- **Anything date/column related** → go through `time.js` + the `columns` memo, don't
  recompute dates inline.

> ⚠️ Update this file whenever the above changes.
