import { motion, useTransform } from 'framer-motion'
import { COMPLETION_DISTANCE } from '../lib/dragConfig'

const DOT_COLOR = '#9CADFF' // fixed lavender — the period stays blue regardless of category

// The "." in "sus." as its own small circle instead of a text glyph, so it
// can react to the drag independently: nudges a few px in the drag
// direction, squashes horizontally, and grows slightly as the gesture
// nears completion. All three are pure `useTransform`s of the same shared
// dragX the card itself is driven by, so when that value springs back
// (cancel) or flies out (success) the dot follows in lockstep for free —
// no separate animation/spring needed here. Kept deliberately subtle.
export default function WordmarkDot({ dragX }) {
  const x = useTransform(dragX, [-COMPLETION_DISTANCE, COMPLETION_DISTANCE], [-5, 5], { clamp: true })
  const scaleX = useTransform(dragX, (v) => {
    const p = Math.min(Math.abs(v) / COMPLETION_DISTANCE, 1)
    return 1 - p * 0.22
  })
  const scale = useTransform(dragX, (v) => {
    const p = Math.min(Math.abs(v) / COMPLETION_DISTANCE, 1)
    return 1 + p * 0.15
  })

  return <motion.span className="wordmark-dot" style={{ backgroundColor: DOT_COLOR, x, scaleX, scale }} />
}
