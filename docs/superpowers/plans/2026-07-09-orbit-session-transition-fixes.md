# Orbit Session-Transition Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two Years-orbit bugs that appear on login/logout — (A) the orbit shows stale content until you scroll, and (B) every card "stretches" as the media swaps in.

**Architecture:** Both stem from the whole media set swapping when `session` changes. (A) the R3F render loop is gated on a lagging `orbitLive` flag a session change never touches, and `invalidate()` is a hard no-op while the loop is `'never'` — so nothing repaints until a pointer event. Fix: gate the loop on the orbit's *visibility* (`isYears || orbitLive`). (B) `MediaPlane` lerps `mesh.scale` toward the new item's aspect on every remap, morphing each card. Fix: snap scale when the plane's *item identity* changes, lerp only when the same item's dimensions refine.

**Tech Stack:** React 19 + Vite (no test runner — verify with `npm run build` + the Claude Preview browser tools). three.js + @react-three/fiber.

**Verification note:** No unit-test runner. "Tests" are `npm run build` (must pass) plus browser checks. The login/logout transitions themselves need real Google OAuth, which the harness can't drive — so the *behavioral* confirmation (stale-gone, stretch-gone) is a user step on their machine. What IS verifiable here: the build compiles, the demo orbit still renders with no console errors, and the code changes match the confirmed root causes.

---

## Root-cause summary (confirmed)

- **Bug A** — `src/canvas3d/InfiniteMemoryCanvas.jsx:464` `frameloop={active ? 'always' : 'never'}`, where `active` = `orbitLive` (`src/App.jsx:931`). `orbitLive` (`App.jsx:182-183`) is only re-armed by `isYears` flipping or the fade-out `onAnimationComplete` (`App.jsx:927`) — a session change touches neither. While parked (`'never'`), R3F's `invalidate()` returns immediately (no-op), so the `RenderOnMediaChange` nudge does nothing; only a real pointer event repaints. The layer's own `visibility` already uses the correct expression `isYears || orbitLive` (`App.jsx:926`) — the frameloop should use the same.
- **Bug B** — `src/canvas3d/InfiniteMemoryCanvas.jsx` `MediaPlane`: `if (state.introDone) mesh.scale.lerp(displayScale, 0.16)` eases the mesh from the old item's aspect to the new item's aspect when a plane remaps (the `key` is grid-based so the instance persists), morphing the card. On a full set swap every plane remaps → every card stretches.

---

## File Structure

- `src/App.jsx` — pass the orbit's `active` prop as its *visibility*, and drop the now-superseded `RenderOnMediaChange` usage isn't here (it's in the canvas). One-line change.
- `src/canvas3d/InfiniteMemoryCanvas.jsx` — `MediaPlane` scale handling (snap-on-item-change), and remove the now-redundant `RenderOnMediaChange` (superseded by the always-on loop while visible).

---

### Task 1: Bug A — keep the orbit's render loop live while it's visible

**Files:**
- Modify: `src/App.jsx` (the `<YearOrbit … active={orbitLive} />` prop, ~line 931)
- Modify: `src/canvas3d/InfiniteMemoryCanvas.jsx` (remove `RenderOnMediaChange` — def near line 85 and its render near line 460)

- [ ] **Step 1: Gate the loop on visibility, not the lagging flag**

In `src/App.jsx`, the orbit layer renders `<YearOrbit memories={memories} active={orbitLive} revealed={booted} />`. Change `active` to the same expression the layer's `visibility` uses:

```jsx
        <YearOrbit
          memories={memories}
          active={isYears || orbitLive}
          revealed={booted}
        />
```

Why: in Years `isYears` is always `true`, so `frameloop` is `'always'` — the loop runs, idle drift renders, and a `session → memories → buildMediaItems → setMedia → texture-load` chain repaints immediately with no scroll. Leaving Years still keeps it live through the fade (`orbitLive` true) and parks only once hidden.

- [ ] **Step 2: Remove the now-redundant `RenderOnMediaChange`**

It was an earlier partial fix and is a no-op while parked (the exact failure mode). With the loop live whenever visible, it does nothing useful. In `src/canvas3d/InfiniteMemoryCanvas.jsx` delete the component definition:

```jsx
// DELETE this block:
function RenderOnMediaChange({ media }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { invalidate() }, [media, invalidate])
  return null
}
```

and its usage inside `<Canvas>`:

```jsx
// DELETE this line:
        <RenderOnMediaChange media={media} />
```

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -1 && rm -rf dist`
Expected: `✓ built in …`

- [ ] **Step 4: Browser sanity check (no regression)**

Reload the running preview (logged-out demo). Confirm the orbit still renders the demo cards and the console has no errors (`preview_console_logs` level error → "No console logs").

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/canvas3d/InfiniteMemoryCanvas.jsx
git commit -m "Orbit: keep render loop live while visible so content repaints on session change (no scroll)"
```

---

### Task 2: Bug B — snap card scale on item change instead of morphing it

**Files:**
- Modify: `src/canvas3d/InfiniteMemoryCanvas.jsx` — `MediaPlane` (localState init ~line 85, the texture `useEffect` ~line 176, the useFrame scale line ~line 135)

- [ ] **Step 1: Add a `needsSnap` flag to the plane's local state**

Find the `localState` ref init and add `needsSnap: false`:

```jsx
  const localState = useRef({ opacity: 0, frame: 0, introScaled: false, introDone: false, scaleInit: false, needsSnap: false })
```

- [ ] **Step 2: Mark a snap whenever the plane's item identity changes**

In the texture-loading `useEffect` (keyed on `item.url`), set `needsSnap` so the next frame snaps to the new aspect instead of lerping:

```jsx
  useEffect(() => {
    // remapped to a DIFFERENT item (e.g. session swap) → snap to its aspect,
    // don't morph across two unrelated cards. Same-item dimension refinements
    // (below, in useFrame) still lerp smoothly.
    localState.current.needsSnap = true
    ;(item.isVideo ? getVideoTexture : getTexture)(item.url, (tex) => setTexture(tex))
  }, [item.url])
```

- [ ] **Step 3: Snap when flagged, else keep the smooth lerp**

Replace the post-intro scale line:

```jsx
    // after the intro, ease size refinements — but SNAP when the plane was
    // remapped to a different item, so a full media swap (login/logout) doesn't
    // morph every card's aspect ratio.
    if (state.introDone) {
      if (state.needsSnap) { mesh.scale.copy(displayScale); state.needsSnap = false }
      else mesh.scale.lerp(displayScale, 0.16)
    }
```

- [ ] **Step 4: Build**

Run: `npm run build 2>&1 | tail -1 && rm -rf dist`
Expected: `✓ built in …`

- [ ] **Step 5: Browser sanity check (no regression)**

Reload the preview; confirm the demo orbit renders normally and console is clean. (The stretch itself only reproduces on a real login/logout media swap — user-verified.)

- [ ] **Step 6: Commit**

```bash
git add src/canvas3d/InfiniteMemoryCanvas.jsx
git commit -m "Orbit: snap card scale on item swap (fixes cards stretching on login/logout)"
```

---

## Self-Review

- **Spec coverage:** Bug A (stale-until-scroll) → Task 1 (frameloop on visibility + remove dead invalidate). Bug B (stretch) → Task 2 (snap on item change). ✓
- **Placeholder scan:** none — all steps have concrete code.
- **Type/consistency:** `needsSnap` added to `localState` init (Task 2 Step 1) and read/written in Steps 2–3; `scaleInit` untouched. `active={isYears || orbitLive}` matches the visibility expression at `App.jsx:926`. `RenderOnMediaChange` fully removed (def + usage) so no dangling reference.
