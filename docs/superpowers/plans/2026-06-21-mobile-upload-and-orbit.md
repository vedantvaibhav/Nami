# Mobile Upload + Years-Orbit Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image/media upload work on mobile browsers, and stop the Years orbit from rendering as a blank white screen on real mobile devices.

**Architecture:** Two independent fixes. (1) Broaden the file-input `accept` list so iOS Safari's photo picker shows selectable photos. (2) Harden the three.js/react-three-fiber orbit for mobile GPUs (WebGL1-safe texture filtering, WebGL context-loss recovery) and add a graceful fallback so a failed GL context never leaves a blank white screen.

**Tech Stack:** Vite + React 19 (no TypeScript, no test runner — verify with `npx vite build` + the Claude Preview browser tools at a mobile viewport), three.js + @react-three/fiber, idb-keyval.

**Verification note:** There is no unit-test runner in this repo. "Tests" below are concrete browser-verification steps run through the preview at a mobile viewport (375×812). The orbit's *final* confirmation requires the user's real device, because the bug does NOT reproduce in desktop WebGL2 emulation (verified during investigation: canvas sized correctly, context healthy, cards visible). Desktop regression IS verifiable here and must pass.

---

## Investigation findings (ground truth)

- **Upload**: The upload area is reachable on mobile (`.cmp-upload` has `pointer-events: auto`, nothing overlays its tap target, composer opens fine). The real problem is `ACCEPT` in `src/media.js:2`: a list of narrow explicit MIME subtypes with **no `image/*` wildcard**. iOS Safari greys out / hides photos (or routes to Files instead of the photo library) when the accept list is over-specific. Broadening to `image/*,video/*,audio/*` is the fix. `kindFromMime()` already classifies by `startsWith('image/'|'video/'|'audio/')`, so broadening does not break `attach()`.
- **Orbit**: Renders correctly in desktop mobile-emulation (WebGL2). User reports **totally blank white** on device (no cards, no empty-state photo) → the GL canvas mounts but draws nothing → only the `#FDFDFC` clear color shows. Most likely: WebGL1 fallback (NPOT textures with forced mipmaps) and/or context loss with no recovery, on an unknown device.

---

## File Structure

- `src/media.js` — `ACCEPT` constant only. One responsibility: the accepted-MIME string.
- `src/canvas3d/InfiniteMemoryCanvas.jsx` — `getTexture()` filtering, and the `<Canvas>` setup (context-loss recovery). The orbit's WebGL lives here.
- `src/YearOrbit.jsx` — renders `<InfiniteMemoryCanvas>`; owns the empty-state fallback markup, so the WebGL-unavailable fallback belongs here too.

---

### Task 1: Mobile-reliable media picker

**Files:**
- Modify: `src/media.js:2`

- [ ] **Step 1: Broaden the accept list**

In `src/media.js`, replace the `ACCEPT` constant:

```js
// Broad categories so iOS Safari's photo picker shows selectable photos. Narrow
// per-subtype lists (image/jpeg,image/heic,…) make iOS grey out the library or
// route to Files instead of Photos. attach() still filters via kindFromMime().
export const ACCEPT = 'image/*,video/*,audio/*'
```

- [ ] **Step 2: Build**

Run: `npx vite build 2>&1 | tail -1 && rm -rf dist`
Expected: `✓ built in …`

- [ ] **Step 3: Verify the input accept at a mobile viewport**

With the preview at mobile (375×812): open the composer (click `.add-cta`), then eval:
`document.querySelector('.cmp-upload input[type=file]').accept`
Expected: `"image/*,video/*,audio/*"`

- [ ] **Step 4: Commit**

```bash
git add src/media.js
git commit -m "Mobile: broaden file accept to image/*,video/*,audio/* so iOS shows photos"
```

---

### Task 2: Harden the orbit for mobile GPUs (no more blank white)

**Files:**
- Modify: `src/canvas3d/InfiniteMemoryCanvas.jsx` — `getTexture()` (~lines 44–52) and the `<Canvas>` default export (~lines 400–414)
- Modify: `src/YearOrbit.jsx` — render a WebGL-unavailable fallback instead of a blank canvas

- [ ] **Step 1: WebGL1-safe texture filtering**

In `src/canvas3d/InfiniteMemoryCanvas.jsx`, inside `getTexture`'s load callback, replace the mipmap filtering with mobile-safe linear filtering. Forced mipmaps on non-power-of-two textures render blank on WebGL1 (the likely mobile fallback path); linear + no mipmaps is universally safe (this is what the video texture already uses).

Replace:
```js
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = 4
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
```
with:
```js
    tex.minFilter = THREE.LinearFilter // NPOT + mipmaps render blank on WebGL1 (mobile fallback)
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
```

- [ ] **Step 2: WebGL context-loss recovery**

In the `<Canvas>` default export, add an `onCreated` that prevents the default context-loss teardown and invalidates on restore, so a transient mobile GL context loss recovers instead of staying blank. Add to the `<Canvas>` props:

```jsx
        onCreated={({ gl, invalidate }) => {
          const el = gl.domElement
          el.addEventListener('webglcontextlost', (e) => e.preventDefault(), false)
          el.addEventListener('webglcontextrestored', () => invalidate(), false)
        }}
```

- [ ] **Step 3: Graceful fallback when WebGL is unavailable**

In `src/YearOrbit.jsx`, only mount the canvas when WebGL is actually available; otherwise show the existing empty-state photo so the user never sees a blank white screen. Add near the top of the module:

```js
const webglOK = (() => {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
})()
```

Then gate the canvas render (replace the `{media && <InfiniteMemoryCanvas … />}` line):
```jsx
      {media && webglOK && <InfiniteMemoryCanvas media={media} active={active} revealed={revealed} onOpen={setOpen} />}
```
and broaden the empty-state condition so it also shows when WebGL is unavailable (replace `{memories.length === 0 && (`):
```jsx
      {(memories.length === 0 || !webglOK) && (
```

- [ ] **Step 4: Build**

Run: `npx vite build 2>&1 | tail -1 && rm -rf dist`
Expected: `✓ built in …`

- [ ] **Step 5: Desktop regression — orbit still renders cards**

Seed 3 note memories into IndexedDB (`keyval-store` → `keyval` → key `moments:list`), reload at desktop size in the Years view, and confirm the canvas still renders: WebGL context healthy and cards visible (screenshot). Expected: cards render exactly as before (linear filtering is visually equivalent at orbit scale). Clean up the seeded data afterward.

- [ ] **Step 6: Commit**

```bash
git add src/canvas3d/InfiniteMemoryCanvas.jsx src/YearOrbit.jsx
git commit -m "Orbit: WebGL1-safe textures, context-loss recovery, fallback when GL unavailable"
```

- [ ] **Step 7: On-device confirmation (user)**

Ask the user to retest the Years view on their phone. If still blank, the fallback now shows the empty-state photo (not white), and the next diagnostic step is to log `gl.getParameter(gl.VERSION)` + renderer in `onCreated` on their device.

---

## Self-Review

- **Spec coverage:** Upload (Task 1) ✓. Orbit blank-white (Task 2: filtering + context recovery + fallback) ✓.
- **Placeholder scan:** none — all code is concrete.
- **Type consistency:** `webglOK` boolean used in both gate expressions; `ACCEPT` shape unchanged (still a comma string consumed by the `accept` attr and unrelated to `kindFromMime`).
