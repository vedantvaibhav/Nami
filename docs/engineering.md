# Nami — Engineering & Design Reference

> Source document for case studies, writeups, and onboarding.
> Update this file whenever a PR is merged. Each section has a changelog at the bottom.
>
> _Last updated: 2026-07-16_

---

## What Nami is

A personal memory timeline. Users add photos, notes, voice memos and short text to
dates in their past. The app presents them across three zoom levels — Days (sparse
columns per day), Months (one column per month, curated), and Years (a live 3D orbit
of every year). Everything syncs across devices via Cloudinary + Supabase.

**The core design bet:** constraints are features. No future dates, no tagging, no
search, no social. Just your moments, laid out in time.

---

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | React 19 + Vite 6 | Fast HMR, stable ecosystem, React 19 concurrent features |
| 3D | Three.js r184 via @react-three/fiber 9 | WebGL orbit view without raw Three boilerplate |
| Animation | Framer Motion 12 | layoutId shared-element transitions between zoom levels |
| Image storage | Cloudinary (free tier, 25GB) | CDN-delivered, on-the-fly transforms, unsigned browser upload |
| Auth | Supabase + Google OAuth | One-click sign-in, no passwords, RLS built in |
| Database | Supabase Postgres | Per-user memories stored as a single JSONB row, RLS enforced |
| Hosting | Vercel | Zero-config static deploy, automatic preview URLs per PR |
| Fonts | Inter (UI) + Newsreader italic (branding) | Newsreader gives editorial warmth; Inter is neutral UI |

---

## Architecture

### Data model

Each memory is a plain JS object:
```js
{
  id: uuid,
  type: 'note' | 'quote' | 'photo' | 'video' | 'audio',  // inferred, not stored
  title: string,      // max 60 chars
  body: string,       // max 120 chars
  date: 'YYYY-MM-DD', // ISO, never future
  color: 'blue' | 'yellow' | 'pink' | 'purple' | 'mint' | 'peach',
  media: [{ id: uuid, kind: 'image'|'video'|'audio', name: string }],
  pos: { days?: number, months?: number }  // manual Y position per zoom level
}
```

The full array is stored as a single JSONB blob per user in Supabase
(`memories` table, one row per `user_id`). This is intentionally denormalised —
at the scale Nami targets (hundreds of memories, not millions) a single upsert is
simpler and faster than normalised rows.

### Storage split

| Data | Where | Key |
|------|-------|-----|
| Memories list | Supabase Postgres (`memories.data` JSONB) | Per user_id |
| Images (original) | Cloudinary | `{cloudName}/image/upload/{uuid}` |
| Video / audio | Cloudinary | `{cloudName}/video/upload/{uuid}` |
| Thumbnails | Cloudinary transform | `w_800,c_limit,q_auto,f_auto` applied at URL level |

Images are uploaded via unsigned upload preset — no API secret in the browser.
Deletion is a soft-delete (removed from memories list; Cloudinary asset stays until
manual dashboard cleanup — deletion requires the API secret which can't ship in frontend).

### Auth flow

Google OAuth via Supabase. The redirect callback lands on `window.location.origin`
(set as `redirectTo`). Supabase JS client parses the hash fragment on load and
establishes a session automatically. `onAuthStateChange` keeps React in sync.

### State management

No external state library. All state lives in `App.jsx` via `useState` / `useRef`.
Key refs:
- `cardRefs` — live DOM refs to every rendered card (for drag bounds + height measurement)
- `yMVs` — per-card Framer Motion `motionValue` for transient drag offset
- `zoomIdRef` / `view2dRef` — ref mirrors so stable callbacks read fresh zoom/view

---

## Feature inventory

### Core timeline

| Feature | File(s) | Notes |
|---------|---------|-------|
| Three zoom levels (Days / Months / Years) | `App.jsx`, `YearOrbit.jsx` | `ZOOMS` array drives the pill; Years uses WebGL |
| Horizontal scroll canvas | `App.jsx` | Custom scrollbar replaced by the zoom pill |
| Zoom pill as scrollbar | `App.jsx` | `thumbX` / `thumbWmv` MotionValues, drag-to-scroll |
| Vertical mouse wheel → horizontal scroll | `App.jsx` | Prevents the default vertical page scroll |
| Date markers + grid lines | `App.jsx` | One marker per column, ISO-sorted |
| Empty state columns | `App.jsx` | Falls back to current month's days or year's months |

### Memory cards

| Feature | File(s) | Notes |
|---------|---------|-------|
| Card types (note, quote, photo, video, audio) | `MemoryCard.jsx`, `media.js` | Type inferred from `media[]`, not stored |
| Manual drag-to-position | `App.jsx`, `MemoryCard.jsx` | Per-card `motionValue`, saved to `pos[view]` in memories |
| First-drag column flip (auto → manual) | `App.jsx` | `flushSync` seeds all cards from live `offsetTop` on first drag |
| Neighbour push on drop | `App.jsx` | Cascade shove prevents card overlap after drop |
| Magnetic snap on drop | `App.jsx` | `SNAP_THRESHOLD=12px` snaps to top or neighbour edges |
| Seeded tilt | `media.js`, `MemoryCard.jsx` | Deterministic from card ID — stable across reloads |
| Image grid (up to 4 images per card) | `MemoryCard.jsx` | 1/2/3/4 layouts; thumbnails from Cloudinary |
| Lightbox | `Lightbox.jsx` | Full-res from Cloudinary, revokes URL on close |
| Edit memory | `App.jsx`, `Composer.jsx` | Re-opens composer pre-filled; saves in place |
| Delete memory | `App.jsx` | Removes from state + Supabase; Cloudinary asset is soft-deleted |

### Composer

| Feature | File(s) | Notes |
|---------|---------|-------|
| Morphing dock shell | `App.jsx` | Spring animation grows the dock to composer height |
| Custom calendar popover | `Composer.jsx` | Portaled above the dock; max date = today |
| Colour picker | `Composer.jsx` | 6 swatches; own line above date; default is random on each open |
| Multi-media attach (drag, click, paste) | `Composer.jsx`, `App.jsx` | Images cap at 4; accepts image/video/audio |
| Bulk upload modal | `BulkUploader.jsx` | Drop N images → assign date + headline per image → batch commit |
| Per-day content limit | `App.jsx` | Content-type cap: max 2 image memories + 1 note/quote per day; composer toast names the free slot when full. Editing an existing memory is always allowed |
| Paste-to-create | `App.jsx` | Paste an image on the canvas = instant card for today |
| Delete confirmation modal | `App.jsx` | Confirm before permanently removing a memory |

### Cloud / sync

| Feature | File(s) | Notes |
|---------|---------|-------|
| Cloudinary upload (unsigned) | `store.js` | `auto` resource type handles image + video + audio |
| Cloudinary thumbnail transforms | `store.js` | `w_800,c_limit,q_auto,f_auto` via URL — no server |
| Supabase Google OAuth | `AuthScreen.jsx`, `App.jsx` | Single-button flow; no email/password |
| Per-user memories in Postgres | `store.js`, `App.jsx` | Upsert on save; RLS blocks cross-user reads |
| Demo mode (logged-out) | `App.jsx` | Shows hardcoded DEMO_MEMORIES; full UI visible, Add disabled |

### 3D orbit (Years view)

| Feature | File(s) | Notes |
|---------|---------|-------|
| WebGL orbit of year rings | `YearOrbit.jsx`, `canvas3d/` | @react-three/fiber; one ring per year |
| Thumbnail textures on orbit cards | `canvas3d/textures.js` | Cloudinary thumb URLs as THREE textures |
| Frameloop pause when off-screen | `App.jsx`, `YearOrbit.jsx` | `active` prop stops the render loop during crossfade |
| Cross-fade with 2D timeline | `App.jsx` | Both layers stay mounted; opacity + scale transition |

---

## Key engineering decisions

### Why JSONB for the memories list, not normalised rows

A normalised table (one row per memory) adds a migration burden: every schema change
requires a Postgres migration. At Nami's current scale, the entire memories list for
a power user is < 100KB. A single `upsert` is one network round-trip, zero joins,
zero index planning. If the list ever grows past a few MB per user we revisit.

### Why Framer Motion layoutId instead of CSS transitions for zoom switching

The Days → Months transition moves cards between columns. CSS can't animate an element
from one DOM parent to another. `layoutId` measures the card's real position in both
states and interpolates the transform — so the card "flies" from its day column to its
month column. The same mechanism handles the composer dock morphing.

### Why both view layers stay mounted (no unmount on zoom switch)

Unmounting the WebGL canvas on every Years ↔ Months switch destroyed and recreated the
GPU context, shaders and textures — causing a visible freeze (~600ms on M1, longer on
lower-end devices). Keeping both layers mounted and using `visibility: hidden` +
`frameloop: 'never'` when off-screen eliminates the freeze. The `onAnimationComplete`
callback drives the visibility flip so it never desynchronises from the animation.

### Why unsigned Cloudinary uploads (no server)

A signing server would add latency (one extra round-trip) and infrastructure. Unsigned
presets lock down what can be done (no overwrite, fixed folder) without needing a
secret in the browser. The trade-off: deletion requires the API secret, so deletes are
currently soft (removed from the user's list, asset stays on Cloudinary). Acceptable
at this scale.

### Why the zoom pill IS the scrollbar

A standard browser scrollbar on a horizontal canvas looks out of place and varies
wildly across OS/browser. Replacing it with the zoom pill (which already needs to exist)
means one control does two jobs: it shows where you are in time AND lets you scroll.
The pill width is proportional to the visible fraction of the total canvas width.

### Why manual card positioning (drag-to-place) instead of automatic layout

Automatic layout (flex column) means the user has no agency over which memory is most
prominent in a column. Manual positioning lets you put the photo you care most about
at the top. The engineering cost is the `flushSync` column-flip on first drag and the
cascade-push algorithm on drop — but the UX payoff (it feels tactile and personal) is
worth it.

### Session-seeded month card selection

In Months view, columns with > 3 memories show a curated sample of 3. The selection
uses a session seed (`Math.random()` once at module load) combined with a hash of the
column's ISO date key. This gives:
- Stability within a session (no flickering)
- Variation between sessions (the curation feels alive)
- Determinism per column (each month always picks a different subset, not the same
  first-3 every session)

---

## Performance notes

- **Thumbnails everywhere except lightbox** — Cloudinary serves `w_800,q_auto,f_auto`
  transforms. Full-res URLs are only created in the Lightbox and revoked on close.
- **THREE texture disposal** — `YearOrbit` disposes geometry, material and texture on
  unmount. Verified via DevTools Memory profiler.
- **MotionValues, not state, for drag** — the per-card `yMV` offset is a Framer Motion
  `motionValue`, not React state. This means drag updates don't re-render the whole
  tree — only the individual card's transform changes.
- **`flushSync` for drag-start column flip** — seeding all cards' `pos[view]` from live
  DOM `offsetTop` values happens synchronously before the first drag offset is applied.
  Without `flushSync`, the card jumps one frame.

---

## Design decisions — open questions

### Bulk upload: same-date grouping
If a user assigns multiple images to the same date in the bulk uploader, they are
**grouped into one card** (up to 4 images per card).

Rationale: multiple photos from the same day almost always belong to the same moment.
Separate cards per image would clutter the column and burn through the per-day limit.
The bulk modal detects ≥2 images on the same date, visually groups them, and shows
one shared title field for the group. Overflow past 4 images per group is flagged inline.

### Per-day content rule
**Rule: max 2 image memories + max 1 note or quote per day (3 total).**

Rejected alternatives:
- Pure count (4): too permissive for image cards which are visually tall
- Height-based gate: requires measuring live DOM, complex, varies by viewport
- World scroll / infinite wrapping: interesting for the timeline itself (backlog),
  not relevant to per-day limits

The 2-image / 1-note rule is predictable, produces good-looking columns, and is easy
to explain to users in an error message.

---

## Known gaps / debt

| Item | Severity | Notes |
|------|----------|-------|
| Video/audio kind-map resets on reload | Medium | In-memory Map cleared on page load; defaults to 'image' delivery type. Fix: store kind on the media item in Supabase |
| No error boundary | High | One bad render = blank screen. Need `<ErrorBoundary>` around canvas + orbit |
| Cloudinary soft-delete | Low | Deleted media stays on Cloudinary until manual dashboard cleanup |
| No mobile touch pass | High | Composer, lightbox, orbit untested on touch devices |
| StrictMode off | Low | Double-mount issues with WebGL context. Revisit only if it hides a real bug |
| Cloudinary image compression on upload | Medium | Currently uploads original; should set quality + size params on upload |
| File size hard limit | Medium | MAX_SAFE_BYTES is 200MB (just a warning); needs a real hard stop ~15MB |

---

## PR changelog

| Date | PR | What changed |
|------|----|-------------|
| 2026-06-03 | Initial | App scaffolded: timeline, composer, lightbox, 3D orbit |
| 2026-06-14 | smooth-animations | Animation pass: card glide, dock morph, zoom switch crossfade |
| 2026-07-07 | #8 | Phase 1: Cloudinary image storage replaces IndexedDB blobs |
| 2026-07-07 | #9 | Phase 2: Supabase Google OAuth, DemoNav for logged-out state |
| 2026-07-07 | #10 | Phase 3: Supabase Postgres memories sync, idb-keyval removed |
| 2026-07-07 | — | Bulk upload modal, per-day limit, month view session-seeded selection |
| 2026-07-16 | — | Per-day content-type limit: 2 images + 1 note (replaces count-based max-4) |

_Add a row here every time a PR merges._
