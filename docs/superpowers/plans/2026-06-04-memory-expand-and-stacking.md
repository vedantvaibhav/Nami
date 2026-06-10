# Memory Expand Experiences + Per-Date Stacking — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. This codebase has no unit-test runner; verification is **production build (`npx vite build`) + live preview DOM checks**, the established pattern for this prototype.

**Goal:** Make memories stack cleanly (one-after-another, no overlap, max 4/day with a toast) and give each media type a polished expand experience (photo fan/gallery, Amie-style audio player, big autoplay video with volume, nicer serif quotes).

**Architecture:** Move the canvas from absolute-positioned-per-card (`left`/`top` with random `y`) to **column containers**: group memories by their day/month/year column, render one positioned `.column` div per group, and let cards flow vertically inside (flex column + gap). This guarantees no overlap and handles variable card heights for free. A 4-per-day cap is enforced at every add path, surfaced via a transient toast. The Lightbox gets per-type upgrades.

**Tech Stack:** React 19, Framer Motion, existing `idb-keyval` store. No new deps.

---

### Task 1: Column-flow layout (no overlap) + drop random y/tilt

**Files:** Modify `src/App.jsx`, `src/MemoryCard.jsx`, `src/styles.css`, `src/time.js` (add `colGroupKey`).

- [ ] Group `memories` by `unitStart(date, zoom.id)`; sort each group by date then insertion order.
- [ ] Render one `.column` div per group at `left = colX + 8`, `width = colW - 16`, `top = MARKER_H + 20`; map cards inside.
- [ ] `MemoryCard`: drop `x`/`w`/`m.y` positioning; card is `position: relative`, `width: 100%`, `margin-bottom: 14px`. Keep horizontal drag → `onMove(id, dx)` re-dates.
- [ ] Remove random `y`/`tilt` from `addFromComposer`, `blankCard`, drop/paste spawns, and `seed.js`.
- [ ] Verify: build clean; cards in a column stack vertically, never overlap, at every zoom.

### Task 2: 4-per-day cap + toast

**Files:** Modify `src/App.jsx`, `src/styles.css`.

- [ ] Add `const DAY_LIMIT = 4` and `countOn(date)` helper (non-draft memories on that ISO date).
- [ ] In `addFromComposer` (and drop/paste spawn): if `countOn(date) >= DAY_LIMIT`, call `showToast('Only 4 memories per day')` and return without adding.
- [ ] Add a `toast` state + transient `.toast` element (fixed, bottom-center above dock, auto-dismiss ~2.4s, framer fade/slide).
- [ ] Verify: adding a 5th memory to one day shows the toast and does not add.

### Task 3: Photo stack → fan-out gallery on expand

**Files:** Modify `src/Lightbox.jsx`, `src/styles.css`.

- [ ] `PhotoExpand`: big active image (max 800px). Below, a strip of all images that **animate in fanned** (staggered scale/rotate → settle) then act as tabs; clicking swaps the active image with a crossfade.
- [ ] Verify: open a multi-image card; images fan in, tapping a thumb swaps the main image.

### Task 4: Amie-style audio player

**Files:** Modify `src/Lightbox.jsx`, `src/styles.css`.

- [ ] `AudioExpand`: white rounded card — full-width waveform bars (progress-tinted), a large centered play/pause button, filename + "By you" row, scrubber. Matches the Amie player.
- [ ] Verify: open an audio card; play/pause works, waveform tints with progress.

### Task 5: Video → big, autoplay, volume toggle

**Files:** Modify `src/Lightbox.jsx`, `src/styles.css`, `src/media.js` (add `volume`/`mute` icons).

- [ ] `VideoExpand`: video fills the lightbox, `autoPlay muted loop playsInline`, plus a persistent **mute/unmute (volume) button** overlay (not just hover native controls).
- [ ] Verify: open a video card; it autoplays muted and the volume button toggles sound.

### Task 6: Nicer quote font

**Files:** Modify `src/styles.css`, `index.html` (font weight if needed).

- [ ] Refine `.quote-text` / `.orbit-stage-quote` / lightbox quote: Newsreader italic, slightly larger, tighter leading, balanced wrap — matching the Amie "audience of one" look.
- [ ] Verify: a quote card reads as elegant editorial serif on canvas and expanded.

---

## Self-Review

- **Coverage:** photo fan (T3), audio player (T4), video autoplay+volume (T5), quote font (T6), 4/day cap+toast (T2), no-overlap stacking + remove random y/tilt (T1). All six requirements mapped.
- **Type consistency:** `DAY_LIMIT`, `countOn`, `showToast`, `colGroupKey` named consistently across tasks.
- **No placeholders:** each task names exact files and concrete behavior.
