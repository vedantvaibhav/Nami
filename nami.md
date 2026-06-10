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
  time: string | null,   // currently unused (kept for future)
  media: [{ id, kind, name }],  // kind: 'image' | 'video' | 'audio'; blob stored by id
  color: 'blue'|'yellow'|'pink'|'purple'|'mint'|'peach',  // fixed at creation
  draft?: boolean,       // true while a card is being composed inline; not persisted
}
```

**Display type** is computed by `inferType(m)` in `media.js`, not stored:
- has video → `'video'`, else has image → `'photo'`, else has audio → `'audio'`
- no media + title only (no body) → `'quote'`
- otherwise → `'note'` (pastel coloured card)

**Storage** (`store.js`, idb-keyval):
- `moments:list` → the array of (non-draft) memories
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
visible lag. The hidden layer gets `visibility: hidden` + `pointer-events: none`, and
the orbit's R3F `frameloop` flips to `'never'` (via the `active` prop chain
`App → YearOrbit → InfiniteMemoryCanvas`) so it costs nothing while inactive.
Consequences to respect:
- `scrollRef` is **never null** anymore — gate orbit-vs-timeline logic on the zoom
  (see `zoomIdRef` used by `syncThumb`, and the `zoom.id === 'years'` check in `onDrop`).
- Don't conditionally unmount either view; toggle via the layer animation.

The **zoom pill is the scrollbar**: its width = `viewport/scrollWidth`, its position
tracks scroll, and you can drag it. See `syncThumb` / `thumbX` / `thumbWmv`.

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
- **Scattered placement**: cards are **mostly top-anchored** — the first card in a column
  has `marginTop: 0` ~70% of the time, occasionally dropping to ~140–260px; later cards
  add a seeded 24–72px gap. Stable per card (`seedFrac`), never overlapping.
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
- **New card content** → add to the memory object, render in `MemoryCard` (resting +
  edit) and in the composer if user-editable; remember to persist (it auto-saves via the
  debounced effect — just don't store transient fields like `draft`).
- **Anything date/column related** → go through `time.js` + the `columns` memo, don't
  recompute dates inline.

> ⚠️ Update this file whenever the above changes.
