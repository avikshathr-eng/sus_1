import { useRef } from 'react'
import { useMotionValueEvent } from 'framer-motion'
import { categoryColor } from '../lib/tags'

// Fraction of viewport width a horizontal drag needs to cover before the
// vote color is fully revealed — matches SwipeCard's own DISTANCE_RATIO
// commit threshold exactly, so the background reaches full Red Flag/Relax
// color right as the vote actually commits, not before or after it.
const HORIZONTAL_COMMIT_RATIO = 0.20

function overlayColorAndOpacity(x) {
  const width = typeof window !== 'undefined' ? window.innerWidth : 400
  const threshold = width * HORIZONTAL_COMMIT_RATIO
  const opacity = threshold > 0 ? Math.min(Math.abs(x) / threshold, 1) : 0
  const color = x < 0 ? 'var(--flag)' : 'var(--relax)'
  return { opacity, color }
}

// Two flat, full-bleed layers: the bottom one is always the current card's
// category color (the feed's normal resting ambiance, unchanged by this
// component's drag handling). The top one is a solid Red Flag/Relax overlay
// whose opacity crossfades in from 0 as a locked horizontal drag progresses
// toward its commit threshold — full color right at commit, and it stays
// fully opaque through the exit and the result hold (dragX sits far past
// the threshold then). An upward/skip drag keeps dragX damped near zero
// (see SwipeCard's cross-axis damping), so the overlay naturally stays
// hidden and the background reads as neutral, with no extra signal needed
// here — this is a pure function of the same shared dragX SwipeCard's
// gesture already writes to, updated via a direct subscription
// (useMotionValueEvent) rather than React state, so dragging never causes a
// re-render here.
export default function SwipeBackground({ currentCategory, dragX }) {
  const currentColor = categoryColor(currentCategory)
  const overlayRef = useRef(null)

  useMotionValueEvent(dragX, 'change', (x) => {
    if (!overlayRef.current) return
    const { opacity, color } = overlayColorAndOpacity(x)
    overlayRef.current.style.opacity = String(opacity)
    overlayRef.current.style.backgroundColor = color
  })

  return (
    <div className="swipe-bg" aria-hidden="true">
      <div className="swipe-bg-layer" style={{ backgroundColor: currentColor }} />
      <div ref={overlayRef} className="swipe-bg-layer" style={{ opacity: 0 }} />
    </div>
  )
}
