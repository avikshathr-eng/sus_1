import { useRef } from 'react'
import { useMotionValueEvent } from 'framer-motion'
import { categoryColor } from '../lib/tags'
import { COMPLETION_DISTANCE } from '../lib/dragConfig'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'

// A few px of soft blend right at the reveal edge — enough to avoid a hard
// aliased line, nowhere near enough to read as a fold/shadow/seam. Disabled
// entirely under reduced motion for a plainer, lighter transition.
const FEATHER_PX = 3

function progressOf(x) {
  return Math.max(-1, Math.min(1, x / COMPLETION_DISTANCE))
}

// Two flat solid-color layers, no shapes, no gradients. The top layer (the
// *current* card's color) gets a CSS mask that reveals the bottom layer
// (the *next* card's color) from whichever side the drag is heading
// toward. A plain `clip-path: inset()` would give a perfectly hard edge —
// using `mask-image` with a linear-gradient instead buys the tiny soft
// feather for free, as just one extra gradient stop, with no separate
// strip/shadow/highlight element.
function maskFor(p, featherPx) {
  if (p === 0) return 'none'
  const pct = Math.abs(p) * 100
  if (p < 0) {
    // Dragging left: current layer keeps its left (100-pct)%, right side
    // reveals the next layer.
    const edge = 100 - pct
    return featherPx
      ? `linear-gradient(to right, #000 0%, #000 ${edge}%, transparent calc(${edge}% + ${featherPx}px))`
      : `linear-gradient(to right, #000 ${edge}%, transparent ${edge}%)`
  }
  // Dragging right: current layer keeps its right (100-pct)%, left side
  // reveals the next layer.
  const edge = pct
  return featherPx
    ? `linear-gradient(to right, transparent calc(${edge}% - ${featherPx}px), #000 ${edge}%, #000 100%)`
    : `linear-gradient(to right, transparent ${edge}%, #000 ${edge}%)`
}

// `dragX` is the same shared motion value SwipeCard's drag gesture writes
// to (owned by App.jsx) — this component is a pure function of it, updated
// via a direct subscription (useMotionValueEvent) rather than React state,
// so dragging never causes a re-render here. Cancel/success need no special
// handling: when SwipeCard's own animate takes dragX back to 0 or out past
// COMPLETION_DISTANCE, the mask just follows.
export default function SwipeBackground({ currentCategory, nextCategory, dragX }) {
  const reducedMotion = usePrefersReducedMotion()
  const currentColor = categoryColor(currentCategory)
  const nextColor = categoryColor(nextCategory ?? currentCategory)
  const topLayerRef = useRef(null)

  useMotionValueEvent(dragX, 'change', (x) => {
    if (!topLayerRef.current) return
    const mask = maskFor(progressOf(x), reducedMotion ? 0 : FEATHER_PX)
    topLayerRef.current.style.maskImage = mask
    topLayerRef.current.style.webkitMaskImage = mask
  })

  return (
    <div className="swipe-bg" aria-hidden="true">
      <div className="swipe-bg-layer" style={{ backgroundColor: nextColor }} />
      <div ref={topLayerRef} className="swipe-bg-layer" style={{ backgroundColor: currentColor }} />
    </div>
  )
}
