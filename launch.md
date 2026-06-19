# Launch Plan — Nami (local-first)

> Plan to launch Nami as a local-first, static web app. Memories live in each visitor's
> browser (IndexedDB) — no backend, no login. Format: `- [ ]` open, `- [x]` done.
> Read `nami.md` before touching anything — it holds the invariants.
>
> _Last updated: 2026-06-14_

---

## Positioning (decided)

**Nami is a beautiful home for your memories** — a personal memory timeline, not a tracker.
The *feel* (morphing dock, liquid zoom, 3D Years orbit) is the product. Constraints are
features: max 3 memories/day, no future dates, colors chosen for you — "moments, not a feed."
Against Day One (utilitarian) and Apple Photos Memories (algorithmic). Nami is curated and
tactile on purpose.

## Launch model & the one real risk

Public, free, **local-first**. The app is static files; each visitor's memories live in their
own browser. This means **every visitor already gets a private, blank slate automatically** —
no auth needed for that. The data isn't "at the URL," it's in each browser.

> ⚠️ **The one risk: local data loss.** IndexedDB can be cleared by the browser (Safari evicts
> after ~7 days idle) with no recovery. For a *memory* app that's the worst failure. **Export/
> backup + honest "your memories live in this browser" messaging are must-haves, not polish.**

---

## 🚀 Must-have before launch

- [ ] **Export / Import backup** — one downloadable bundle (cards + media), and restore from it.
      Plus `navigator.storage.persist()` on load and a calm "back up your memories" affordance.
- [ ] **Empty states (Days / Months / Years)** — see the prompt you're building now.
- [ ] **First-run** — the app opens to an empty orbit; add a warm one-line "what Nami is" +
      invite to add the first memory, shown only at zero memories.
- [ ] **Domain + deploy** — pick a domain (you choose the name), deploy the Vite static build to
      Vercel/Netlify/Cloudflare Pages, add favicon + `<title>` + OG/Twitter meta.
- [ ] **Mobile / touch pass** — zoom pill drag, 3D orbit gestures, composer + lightbox on a phone.

## 🎨 Polish / UX

- [ ] **Card stacking & rounding** — rounder cards, softer shadows, clearer 2–3 card stacks,
      polaroid-style photo piles.
- [ ] **Orbit aesthetics** — framing, depth, spacing of the 3D Years view.
- [ ] **Month curation** — when a month has many memories, show up to 3 varied, seeded picks +
      "+N more" (display-only; Days still shows all).

## ✅ Done

- [x] **Image performance** — thumbnails on upload (~800px JPEG), thumbnails everywhere except
      the lightbox, object-URL revocation + THREE texture disposal on delete. (Fixed the
      "lags as photos pile up" memory growth. Verify VRAM/leak via DevTools Memory profiler.)
- [x] **Animation pass** — fixed 1s loader → Years, smoother Day/Month/Year switches, card
      glide matched to switch tempo, will-change/compositing sanity fixes. (On `smooth-animations`.)

## 🧪 Needs real testing

- [ ] **Memory release** — heap snapshot: add ~20 photos, delete, force GC; retained size +
      detached blobs should return near baseline. Re-open the same photo in the lightbox (revoke
      bug check). Rapid Months↔Years toggle (deferred-dispose race check).
- [ ] **Cross-browser** — Chrome / Safari / Firefox; confirm IndexedDB persists (Safari riskiest).
- [ ] **Large library** — 100+ memories with media: scroll / zoom / orbit framerate.

## 🐛 Known gaps / tech debt

- [ ] **No error boundary** — one bad blob/render blanks the app; wrap the canvas + orbit.
- [ ] **No automatic backups** — local-first; Export is the only safety net.
- [ ] **StrictMode is off** (double-mount issues per nami.md) — note, revisit only if it hides a bug.
- [ ] **No tests** — verification is `npm run build` + manual; acceptable for launch.

## 💡 Backlog (post-launch)

- [ ] **Headcount / analytics** — privacy-friendly analytics (Plausible/Umami) to count users
      with zero friction. No login wall needed for a count.
- [ ] **Accounts: cross-device sync + durability** — the ONLY reasons to add auth. Note:
      IndexedDB already gives every visitor a private blank slate, so auth alone buys nothing;
      it only earns its keep when paired with **server-side storage** (Supabase Postgres +
      Storage) so a person's memories follow them across devices and survive a browser wipe.
      That path re-inherits the **1GB free-tier media ceiling** + per-user caps + a one-time
      "upload my local memories to my account" migration. Do this only when "I lost my
      memories" or "I want them on my phone too" becomes a real complaint.
