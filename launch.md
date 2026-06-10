# Launch Plan — Nami (hosted)

> Sequenced plan to launch Nami as a hosted, login-gated web app on Supabase.
> Each task has a ready-to-paste **Cowork prompt**. Format: `- [ ]` open, `- [x]` done.
> Read `nami.md` before touching anything — it holds the invariants.
> Build screens as **mockups first** (Phase 0), wire Supabase once (Phase 1), then polish.
>
> _Last updated: 2026-06-10_

---

## Positioning (decided)

**Nami is a beautiful home for your memories** — a personal memory timeline, not a tracker.
The *feel* (morphing dock, liquid zoom, 3D Years orbit) is the product. Constraints are
features: max 3 memories/day, no future dates, colors chosen for you — "moments, not a feed."
Against Day One (utilitarian) and Apple Photos Memories (algorithmic). Nami is curated and
tactile on purpose.

## Launch model & the cost reality

Public, free, **fully hosted**: Supabase Postgres (memory data) + Supabase Storage (media)
+ Google login. Flow: visit → **Login/Landing** → authenticated **timeline app** → **Settings**.

> ⚠️ **Free tier is for building + soft launch only.** 500MB DB (fine), but **1GB total
> file storage** and **project pauses after 1 week of inactivity** and **no automatic
> backups**. A public app with user video will blow past 1GB and a cold visit after a quiet
> week hits a paused backend. **Plan to move to Pro ($25/mo) before any real public push,
> and ship a hard per-user media cap from day one.**

---

## Phase 0 — Mockups first (hard-coded, no backend)

Build these as **real React components** gated by a fake `session` state so you can click
through the whole experience before wiring anything. They become the real screens later.

### 0.1 Login / landing screen (dummy)

- [ ] Landing screen shown when not logged in: what Nami is + a "Continue with Google" button
- [ ] Clicking the button flips a fake `session` flag and reveals the existing timeline app
- [ ] On-brand with the app (warm, tactile, matches the dock/orbit aesthetic)

```
Read nami.md and src/App.jsx, src/main.jsx, src/styles.css. Add a top-level auth gate so
the app shows a Login/Landing screen when there's no session, and the existing timeline
when there is. For now use a HARD-CODED dummy: a fake `session` React state (no real auth
yet) that the "Continue with Google" button flips to true, revealing the current app.

Build it as a real component (e.g. src/Landing.jsx) wrapped in a Root that switches on
session — NOT a throwaway HTML file — because real Supabase auth will plug into this exact
gate later. Design the landing to match Nami's warm, tactile feel (one line on what Nami
is, a single Google button, the 3D-orbit aesthetic in the background if cheap to do).

Keep all existing app behavior intact behind the gate. Don't add any backend yet. Verify
`npm run build`, show a screenshot from `npm run dev`, and update nami.md with the new
Root/auth-gate structure.
```

### 0.2 Settings screen (dummy)

- [ ] Reachable from the app (e.g. an avatar/menu in a corner)
- [ ] Sections: Account (email shown, Sign out), Data (Export / Delete all), Display (placeholder)
- [ ] Hard-coded values for now; Sign out flips the fake session back to logged-out

```
Read nami.md and the Root/auth-gate from task 0.1. Add a Settings screen (src/Settings.jsx)
reachable from the app via an avatar or menu button placed so it doesn't fight the dock.
Use hard-coded dummy data for now. Sections:
- Account: show a dummy email + a "Sign out" button that flips the fake session to
  logged-out (back to the Landing screen).
- Data: "Export my memories" and "Delete all memories" buttons (wire to real behavior in a
  later task; for now stub with a confirm dialog).
- Display: a placeholder section for future preferences (leave room to grow).

Match Nami's styling (single stylesheet, .icon-btn pattern). No backend yet. Verify
`npm run build`, screenshot, update nami.md.
```

### 0.3 UI changes (your running list — add to this)

> Add the tweaks you want here as bullets; each becomes its own Cowork prompt.

- [ ] _(add yours)_
- [ ] _(add yours)_
- [ ] **Card stacking & rounding** — rounder cards, softer shadows, clearer 2–3 card stacks,
      photo piles that read like polaroids. Prompt:
```
Use the design-critique skill on the current look, then implement. Read nami.md,
src/styles.css, src/MemoryCard.jsx, and the `column` layout in src/App.jsx (fixed COL_W=340,
cards top-aligned). Goal: make the timeline feel like a tactile pile of moments — unify and
increase corner radius across all card types, soften shadows, and rework how 2–3 cards in a
column stack (gentle overlap + seeded tilt via the existing seededTilt, not a flat list)
without breaking click/edit targets. Make photo memories read like a small stack of
polaroids (echo the `polaroid`/PhotoExpand language from Lightbox.jsx). Keep it coherent
across Days/Months and the Years orbit. Show before/after screenshots, verify `npm run build`,
update nami.md.
```
- [ ] **Smoother zoom transitions** — Years swaps the 2D scroller for a 3D canvas with no
      transition; Days↔Months regroups without animating cards. Prompt:
```
Read nami.md, src/App.jsx, src/YearOrbit.jsx, src/time.js. Make zoom changes feel like one
continuous motion: (1) cross-fade + subtle scale/blur between the 2D timeline and the
<YearOrbit/> 3D view instead of a hard cut; (2) animate cards to their new column positions
(framer `layout`) when regrouping Days→Months. Preserve every invariant: the zoom pill IS
the scrollbar (don't break syncThumb/thumbX/thumbWmv), scroll-fraction is kept across zooms
(setZoomKeepCenter), app opens in Years view. No router, no TypeScript. Verify `npm run build`,
update nami.md.
```

---

## Phase 1 — Supabase backend (wire once Phase 0 is approved)

Do these **in order**. The hard part is media (Storage), not auth.

### 1.1 Supabase project, schema & storage design

- [ ] Create the free Supabase project
- [ ] `memories` table mirroring the data model in nami.md (+ `user_id`, timestamps)
- [ ] Storage bucket for media; Row Level Security so users only see their own data
- [ ] Per-user media cap defined (cost control)

```
Read nami.md (Data model + Storage sections). Design the Supabase backend for Nami BEFORE
coding. Output: (1) a `memories` table schema matching the memory object (id, type, title,
body, date, time, color, media[], created_at) plus user_id; (2) a Storage bucket plan for
media blobs (images/video/audio) with a path convention; (3) Row Level Security policies so
each user only reads/writes their own rows and files; (4) a recommended per-user media size
cap to stay sane on cost. Give me the SQL and the bucket/RLS config. Don't wire the app yet
— this is the schema + setup step.
```

### 1.2 Google auth (replace the dummy gate)

- [ ] Supabase Auth with Google provider
- [ ] Real session replaces the fake flag from 0.1; Sign out works
- [ ] Auth-gate redirects: no session → Landing, session → app

```
Read nami.md and the Root/auth-gate from task 0.1. Replace the fake `session` flag with
real Supabase Auth using the Google provider. The Landing "Continue with Google" button now
does real OAuth; Settings "Sign out" really signs out. Keep the same gate structure so the
UI doesn't change — only the session source does. Add the supabase-js client and env config.
Verify `npm run build`, document the Google OAuth setup steps I need to do in the Supabase
and Google Cloud dashboards, and update nami.md.
```

### 1.3 Replace persistence: IndexedDB → Supabase

- [ ] `store.js` reads/writes the `memories` table instead of idb-keyval
- [ ] Media uploads go to Supabase Storage; cards reference storage URLs
- [ ] Loading/saving states handle network (it's no longer instant/local)

```
Read nami.md (Storage section) and src/store.js, src/media.js, src/App.jsx (load/persist
effects, attachFiles). Replace the local IndexedDB persistence with Supabase as the source
of truth: the memories list reads/writes the `memories` table (scoped to the logged-in
user), and media blobs upload to the Storage bucket from task 1.1 instead of being stored
locally. Update imageURL/useImage to resolve Storage URLs. Handle the fact that saves are
now async/networked — keep the UX responsive (optimistic update + the existing debounced
save is fine) and surface errors via the existing toast. Enforce the per-user media cap.
Verify `npm run build`, test a full add→reload→still-there round trip, update nami.md's
Stack and Storage sections.
```

### 1.4 Wire the real Export / Delete-all (from Settings)

- [ ] Export bundles the user's memories + media into one downloadable file
- [ ] Delete-all removes rows + storage files (with confirm)

```
Read nami.md and src/Settings.jsx. Wire the Data section to real behavior against Supabase:
Export downloads the user's memories (rows + media) as a single file; Delete-all removes the
user's rows and their Storage files behind a typed/explicit confirm. Verify `npm run build`,
test both, update nami.md.
```

---

## Phase 2 — Domain, deploy & first-run

- [ ] Pick + connect a domain (you choose the name; registrar login is a you-step)
- [ ] Deploy the Vite build to a static host (Vercel/Netlify/Cloudflare Pages) with Supabase env vars
- [ ] favicon, page title, OG/Twitter meta so shared links preview well
- [ ] First-run empty state for brand-new accounts (the app opens to an empty orbit)

```
Read nami.md. Deploy Nami (Vite + React + supabase-js) to a static host — recommend one,
explain the steps, and wire the Supabase env vars for production. Add a favicon, proper
<title>, and Open Graph/Twitter meta in index.html. Add a warm first-run empty state for a
brand-new account that says what Nami is in one line and invites the first memory (only when
zero memories). Verify `npm run build`, update nami.md.
```

## Phase 3 — Testing before public

- [ ] Auth flow on a fresh browser + multiple accounts don't see each other's data (RLS)
- [ ] Media: upload/limit path with photos AND video; confirm the per-user cap fires
- [ ] Cross-browser (Chrome/Safari/Firefox) + a real mobile pass (zoom pill + 3D orbit on touch)
- [ ] Large library (100+ memories) scroll/zoom/orbit framerate
- [ ] Confirm the free-tier pause/limits don't surprise you — decide the Pro cutover point

## Known gaps / tech debt

- [ ] **No error boundary** — one bad blob/render blanks the app; wrap the canvas + orbit.
- [ ] **No automatic backups on free tier** — rely on Export until Pro.
- [ ] **StrictMode is off** (double-mount issues per nami.md) — note, revisit only if it hides a bug.
- [ ] **No analytics** — add a privacy-respecting page-view + "added a memory" event to read the launch.
- [ ] **No tests** — verification is `npm run build` + manual; acceptable for launch.
