import { motion, useTransform } from 'framer-motion'
import { COMPLETION_DISTANCE } from '../lib/dragConfig'

// "sus." — "sus" in the surrounding ink color, the period a real "."
// character permanently colored via --brand-period (see styles.css; kept in
// sync by hand with VOTE_COLORS.redFlag in lib/voteColors.js). Both spans
// use `font: inherit` from the outer .sus-wordmark, so sizing comes purely
// from CSS context — see .sus-wordmark-feed for the feed header's larger
// treatment — rather than a size prop here.
//
// `dragX` is optional. Pass it (the feed header, mid-swipe) and the period
// nudges/squashes/grows with the drag exactly like the old WordmarkDot
// circle used to — same transforms, same shared motion value, just applied
// to the real period glyph instead of a separate decorative element.
// Omit it (onboarding, the age gate — no drag to react to) for a plain
// static wordmark.
export default function SusWordmark({ className, dragX }) {
  return (
    <span className={className ? `sus-wordmark ${className}` : 'sus-wordmark'} aria-label="sus.">
      <span className="sus-wordmark-text">sus</span>
      {dragX ? <AnimatedDot dragX={dragX} /> : <span className="sus-wordmark-dot">.</span>}
    </span>
  )
}

function AnimatedDot({ dragX }) {
  const x = useTransform(dragX, [-COMPLETION_DISTANCE, COMPLETION_DISTANCE], [-5, 5], { clamp: true })
  const scaleX = useTransform(dragX, (v) => 1 - Math.min(Math.abs(v) / COMPLETION_DISTANCE, 1) * 0.22)
  const scale = useTransform(dragX, (v) => 1 + Math.min(Math.abs(v) / COMPLETION_DISTANCE, 1) * 0.15)

  return (
    <motion.span className="sus-wordmark-dot" style={{ x, scaleX, scale }}>
      .
    </motion.span>
  )
}
