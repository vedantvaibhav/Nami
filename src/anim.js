// Shared animation constants (imported by App and MemoryCard — single source
// of truth for the "house" easing curve)
// swift "dissolve" easing — races to ~80% then a soft settle (easeOutExpo-ish)
export const SWIFT = [0.16, 1, 0.3, 1]
// The ONE switch spring: the zoom-pill morph AND the Days↔Months card glide
// use it, so the pill, the crossfade and the cards all land together in a
// single ~400ms motion. Near-critically damped — no wobble, no lingering tail.
export const LIQUID = { type: 'spring', stiffness: 230, damping: 30, mass: 1 }
