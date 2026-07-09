// Ported from edoardolunardi/infinite-canvas (MIT) — adapted for Moments:
// memories as media planes, click-to-open via R3F raycasting, no keyboard deps.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  CHUNK_FADE_MARGIN,
  CHUNK_OFFSETS,
  CHUNK_SIZE,
  DEPTH_FADE_END,
  DEPTH_FADE_START,
  INITIAL_CAMERA_Z,
  INVIS_THRESHOLD,
  MAX_VELOCITY,
  RENDER_DISTANCE,
  VELOCITY_DECAY,
  VELOCITY_LERP,
  clamp,
  hashString,
  lerp,
  generateChunkPlanes,
  getChunkUpdateThrottleMs,
} from './utils.js'

const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1)
const textureCache = new Map()
const loader = new THREE.TextureLoader()

// ---- boot reveal -----------------------------------------------------------
// Planes stay invisible until the app's boot overlay lifts (`revealed` prop),
// then fade + scale in with a small per-plane stagger — a calm, deliberate
// entrance instead of textures popping in whenever they happen to load.
let introStart = null // perf.now() when the reveal began; null = not yet
const INTRO_MS = 520
const introDelayFor = (id) => (hashString(String(id)) % 10) * 70 // 0..630ms, stable per plane

function getTexture(url, onLoad) {
  const existing = textureCache.get(url)
  if (existing) {
    const img = existing.image
    if (img && img.complete !== false && (img.naturalWidth === undefined || img.naturalWidth > 0)) onLoad?.(existing)
    return existing
  }
  const texture = loader.load(url, (tex) => {
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = 4
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    onLoad?.(tex)
  })
  textureCache.set(url, texture)
  return texture
}

// a cached texture is a video texture iff its backing image is a <video> element
const videoEl = (tex) => (tex?.image?.tagName === 'VIDEO' ? tex.image : null)

// One shared VideoTexture per video url — a single <video> decodes once and every
// tiled plane samples it (muted, looping, autoplay). Cached in the SAME map as
// image textures so the existing dispose-by-url pass cleans it up too.
function getVideoTexture(url, onReady) {
  const existing = textureCache.get(url)
  if (existing) { onReady?.(existing); return existing }
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.play?.().catch(() => {})
  const texture = new THREE.VideoTexture(video) // auto-updates each rendered frame
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  textureCache.set(url, texture)
  onReady?.(texture)
  return texture
}

// Force a frame whenever the media set changes — signing in swaps the demo
// memories for the real ones, and without this the scene wasn't repainted until
// a pointer/scroll woke the render loop (content looked stale until you moved).
function RenderOnMediaChange({ media }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { invalidate() }, [media, invalidate])
  return null
}

function MediaPlane({ position, scale, item, chunkCx, chunkCy, chunkCz, cameraGridRef, onOpen, introDelay = 0 }) {
  const meshRef = useRef(null)
  const materialRef = useRef(null)
  const localState = useRef({ opacity: 0, frame: 0, introScaled: false, introDone: false, scaleInit: false })
  const [texture, setTexture] = useState(null)

  useFrame(() => {
    const material = materialRef.current
    const mesh = meshRef.current
    const state = localState.current
    if (!material || !mesh) return

    // first frame with a mounted mesh: snap to the right size (still invisible)
    if (!state.scaleInit) { mesh.scale.copy(displayScale); state.scaleInit = true }

    // ---- boot reveal gate: hold invisible, then ease in (staggered) ----
    // once done, skip the clock read + easing math forever (hot path)
    let introEase = 1
    if (!state.introDone) {
      if (introStart === null) introEase = 0
      else {
        const t = (performance.now() - introStart - introDelay) / INTRO_MS
        introEase = t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(1 - t, 3) // easeOutCubic
        if (t >= 1) state.introDone = true
      }
      if (introEase <= 0) {
        material.opacity = 0
        material.depthWrite = false
        mesh.visible = false
        return
      }
      if (introEase < 1) {
        const f = 0.94 + 0.06 * introEase // gentle scale-in with the fade
        mesh.scale.set(displayScale.x * f, displayScale.y * f, displayScale.z)
        state.introScaled = true
      } else if (state.introScaled) {
        mesh.scale.copy(displayScale)
        state.introScaled = false
      }
    }

    // after the intro, EASE any size/aspect change (a live media remap when a
    // photo is added) toward the new target instead of snapping — this is what
    // stops the whole field from lurching/"trimming down" on upload
    if (state.introDone) mesh.scale.lerp(displayScale, 0.16)

    state.frame = (state.frame + 1) & 1
    if (state.opacity < INVIS_THRESHOLD && !mesh.visible && state.frame === 0 && state.introDone) return

    const cam = cameraGridRef.current
    const dist = Math.max(Math.abs(chunkCx - cam.cx), Math.abs(chunkCy - cam.cy), Math.abs(chunkCz - cam.cz))
    const absDepth = Math.abs(position.z - cam.camZ)

    if (absDepth > DEPTH_FADE_END + 50) {
      state.opacity = 0
      material.opacity = 0
      material.depthWrite = false
      mesh.visible = false
      return
    }

    const gridFade =
      dist <= RENDER_DISTANCE ? 1 : Math.max(0, 1 - (dist - RENDER_DISTANCE) / Math.max(CHUNK_FADE_MARGIN, 0.0001))
    const depthFade =
      absDepth <= DEPTH_FADE_START
        ? 1
        : Math.max(0, 1 - (absDepth - DEPTH_FADE_START) / Math.max(DEPTH_FADE_END - DEPTH_FADE_START, 0.0001))

    const target = Math.min(gridFade, depthFade * depthFade) * introEase
    state.opacity = target < INVIS_THRESHOLD && state.opacity < INVIS_THRESHOLD ? 0 : lerp(state.opacity, target, 0.18)

    const isFullyOpaque = state.opacity > 0.99
    material.opacity = isFullyOpaque ? 1 : state.opacity
    material.depthWrite = isFullyOpaque
    mesh.visible = state.opacity > INVIS_THRESHOLD
  })

  const displayScale = useMemo(() => {
    if (item.width && item.height) {
      const aspect = item.width / item.height
      return new THREE.Vector3(scale.y * aspect, scale.y, 1)
    }
    return scale
  }, [item.width, item.height, scale])

  useEffect(() => {
    // Don't reset opacity here: on a live media remap that blinked the WHOLE
    // field out and back in. The new texture swaps in at the plane's current
    // opacity, and the scale eases (see useFrame), so an upload no longer lurches.
    ;(item.isVideo ? getVideoTexture : getTexture)(item.url, (tex) => setTexture(tex))
  }, [item.url])

  if (!texture) return null

  return (
    <mesh
      ref={meshRef}
      position={position}
      visible={false}
      geometry={PLANE_GEOMETRY}
      onClick={(e) => {
        e.stopPropagation()
        // only treat as a click if the pointer barely moved (not a drag)
        if (e.delta < 6 && meshRef.current?.visible) onOpen?.(item.memory)
      }}
    >
      <meshBasicMaterial ref={materialRef} transparent opacity={0} side={THREE.DoubleSide} map={texture} />
    </mesh>
  )
}

function Chunk({ cx, cy, cz, media, cameraGridRef, onOpen }) {
  const [planes, setPlanes] = useState(null)

  useEffect(() => {
    let canceled = false
    const run = () => !canceled && setPlanes(generateChunkPlanes(cx, cy, cz))
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(run, { timeout: 100 })
      return () => {
        canceled = true
        cancelIdleCallback(id)
      }
    }
    const id = setTimeout(run, 0)
    return () => {
      canceled = true
      clearTimeout(id)
    }
  }, [cx, cy, cz])

  if (!planes) return null

  return (
    <group>
      {planes.map((plane) => {
        const item = media[plane.mediaIndex % media.length]
        if (!item) return null
        return (
          <MediaPlane
            key={plane.id}
            position={plane.position}
            scale={plane.scale}
            item={item}
            chunkCx={cx}
            chunkCy={cy}
            chunkCz={cz}
            cameraGridRef={cameraGridRef}
            onOpen={onOpen}
            introDelay={introDelayFor(plane.id)}
          />
        )
      })}
    </group>
  )
}

const createInitialState = (camZ) => ({
  velocity: { x: 0, y: 0, z: 0 },
  targetVel: { x: 0, y: 0, z: 0 },
  basePos: { x: 0, y: 0, z: camZ },
  drift: { x: 0, y: 0 },
  mouse: { x: 0, y: 0 },
  lastMouse: { x: 0, y: 0 },
  scrollAccum: 0,
  isDragging: false,
  lastTouches: [],
  lastTouchDist: 0,
  lastChunkKey: '',
  lastChunkUpdate: 0,
  pendingChunk: null,
})

const getTouchDistance = (touches) => {
  if (touches.length < 2) return 0
  const [t1, t2] = touches
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function SceneController({ media, onOpen }) {
  const { camera, gl } = useThree()
  const state = useRef(createInitialState(INITIAL_CAMERA_Z))
  const cameraGridRef = useRef({ cx: 0, cy: 0, cz: 0, camZ: camera.position.z })
  const [chunks, setChunks] = useState([])

  useEffect(() => {
    const canvas = gl.domElement
    const s = state.current
    canvas.style.cursor = 'grab'
    const setCursor = (c) => { canvas.style.cursor = c }

    const onMouseDown = (e) => {
      s.isDragging = true
      s.lastMouse = { x: e.clientX, y: e.clientY }
      setCursor('grabbing')
    }
    const onMouseUp = () => { s.isDragging = false; setCursor('grab') }
    const onMouseLeave = () => { s.mouse = { x: 0, y: 0 }; s.isDragging = false; setCursor('grab') }
    const onMouseMove = (e) => {
      s.mouse = { x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 }
      if (s.isDragging) {
        s.targetVel.x -= (e.clientX - s.lastMouse.x) * 0.025
        s.targetVel.y += (e.clientY - s.lastMouse.y) * 0.025
        s.lastMouse = { x: e.clientX, y: e.clientY }
      }
    }
    const onWheel = (e) => { e.preventDefault(); s.scrollAccum += e.deltaY * 0.006 }
    const onTouchStart = (e) => {
      e.preventDefault()
      s.lastTouches = Array.from(e.touches)
      s.lastTouchDist = getTouchDistance(s.lastTouches)
      setCursor('grabbing')
    }
    const onTouchMove = (e) => {
      e.preventDefault()
      const touches = Array.from(e.touches)
      if (touches.length === 1 && s.lastTouches.length >= 1) {
        const [touch] = touches
        const [last] = s.lastTouches
        if (touch && last) {
          s.targetVel.x -= (touch.clientX - last.clientX) * 0.02
          s.targetVel.y += (touch.clientY - last.clientY) * 0.02
        }
      } else if (touches.length === 2 && s.lastTouchDist > 0) {
        const dist = getTouchDistance(touches)
        s.scrollAccum += (s.lastTouchDist - dist) * 0.006
        s.lastTouchDist = dist
      }
      s.lastTouches = touches
    }
    const onTouchEnd = (e) => {
      s.lastTouches = Array.from(e.touches)
      s.lastTouchDist = getTouchDistance(s.lastTouches)
      setCursor('grab')
    }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseleave', onMouseLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [gl])

  useFrame(() => {
    const s = state.current
    const now = performance.now()

    const isZooming = Math.abs(s.velocity.z) > 0.05
    const zoomFactor = clamp(s.basePos.z / 50, 0.3, 2.0)
    const driftAmount = 8.0 * zoomFactor
    const driftLerp = isZooming ? 0.2 : 0.12

    if (!s.isDragging) {
      s.drift.x = lerp(s.drift.x, s.mouse.x * driftAmount, driftLerp)
      s.drift.y = lerp(s.drift.y, s.mouse.y * driftAmount, driftLerp)
    }

    s.targetVel.z += s.scrollAccum
    s.scrollAccum *= 0.8

    s.targetVel.x = clamp(s.targetVel.x, -MAX_VELOCITY, MAX_VELOCITY)
    s.targetVel.y = clamp(s.targetVel.y, -MAX_VELOCITY, MAX_VELOCITY)
    s.targetVel.z = clamp(s.targetVel.z, -MAX_VELOCITY, MAX_VELOCITY)

    s.velocity.x = lerp(s.velocity.x, s.targetVel.x, VELOCITY_LERP)
    s.velocity.y = lerp(s.velocity.y, s.targetVel.y, VELOCITY_LERP)
    s.velocity.z = lerp(s.velocity.z, s.targetVel.z, VELOCITY_LERP)

    s.basePos.x += s.velocity.x
    s.basePos.y += s.velocity.y
    s.basePos.z += s.velocity.z

    camera.position.set(s.basePos.x + s.drift.x, s.basePos.y + s.drift.y, s.basePos.z)

    s.targetVel.x *= VELOCITY_DECAY
    s.targetVel.y *= VELOCITY_DECAY
    s.targetVel.z *= VELOCITY_DECAY

    const cx = Math.floor(s.basePos.x / CHUNK_SIZE)
    const cy = Math.floor(s.basePos.y / CHUNK_SIZE)
    const cz = Math.floor(s.basePos.z / CHUNK_SIZE)
    cameraGridRef.current = { cx, cy, cz, camZ: s.basePos.z }

    const key = `${cx},${cy},${cz}`
    if (key !== s.lastChunkKey) {
      s.pendingChunk = { cx, cy, cz }
      s.lastChunkKey = key
    }

    const throttleMs = getChunkUpdateThrottleMs(isZooming, Math.abs(s.velocity.z))
    if (s.pendingChunk && now - s.lastChunkUpdate >= throttleMs) {
      const { cx: ucx, cy: ucy, cz: ucz } = s.pendingChunk
      s.pendingChunk = null
      s.lastChunkUpdate = now
      setChunks(
        CHUNK_OFFSETS.map((o) => ({
          key: `${ucx + o.dx},${ucy + o.dy},${ucz + o.dz}`,
          cx: ucx + o.dx,
          cy: ucy + o.dy,
          cz: ucz + o.dz,
        }))
      )
    }
  })

  useEffect(() => {
    setChunks(CHUNK_OFFSETS.map((o) => ({ key: `${o.dx},${o.dy},${o.dz}`, cx: o.dx, cy: o.dy, cz: o.dz })))
  }, [])

  return chunks.map((chunk) => (
    <Chunk key={chunk.key} cx={chunk.cx} cy={chunk.cy} cz={chunk.cz} media={media} cameraGridRef={cameraGridRef} onOpen={onOpen} />
  ))
}

export default function InfiniteMemoryCanvas({ media, active = true, revealed = true, onOpen }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

  // start the staggered plane reveal the moment the boot overlay lifts
  useEffect(() => {
    if (revealed && introStart === null) introStart = performance.now()
  }, [revealed])

  // pause the shared video textures while this layer is hidden (the render loop
  // is parked too) so they don't decode in the background; resume on return.
  useEffect(() => {
    for (const tex of textureCache.values()) {
      const vid = videoEl(tex)
      if (!vid) continue
      if (active) vid.play?.().catch(() => {})
      else vid.pause?.()
    }
  }, [active, media])

  // VRAM release: dispose GPU textures whose URL is no longer in the live media
  // set (deleted/edited memories). Deferred so every plane has swapped to its
  // new texture first — disposing a still-bound texture would flash/warn.
  useEffect(() => {
    const live = new Set(media.map((m) => m.url))
    const t = setTimeout(() => {
      for (const [url, tex] of textureCache) {
        if (live.has(url)) continue
        const vid = videoEl(tex)
        if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load() } // release the decoder
        tex.dispose?.()
        textureCache.delete(url)
      }
    }, 1500)
    return () => clearTimeout(t)
  }, [media])

  if (!media.length) return null

  return (
    <div className="canvas3d-container">
      <Canvas
        camera={{ position: [0, 0, INITIAL_CAMERA_Z], fov: 60, near: 1, far: 500 }}
        dpr={dpr}
        flat
        frameloop={active ? 'always' : 'never'} // pause render loop while the layer is hidden
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#FDFDFC']} />
        <fog attach="fog" args={['#FDFDFC', 120, 320]} />
        <RenderOnMediaChange media={media} />
        <SceneController media={media} onOpen={onOpen} />
      </Canvas>
    </div>
  )
}
