import { motion, useTransform } from 'framer-motion'
import { PALETTE } from '../../lib/tags'
import FaceMark from './FaceMark'

// Only the backward edge matters — screen 3 is the last page, there's
// nothing after index 2 to transition into.
export default function AskSusCard({ pageProgress, active, reducedMotion }) {
  const visibility = useTransform(pageProgress, [1, 2], reducedMotion ? [1, 1] : [0, 1], { clamp: true })
  const scale = useTransform(pageProgress, [1, 2], reducedMotion ? [1, 1] : [0.9, 1], { clamp: true })

  const cardInitial = reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18 }
  const cardAnimate = active ? { opacity: 1, y: 0 } : cardInitial
  const cardTransition = reducedMotion
    ? { duration: 0.2, ease: 'easeOut' }
    : { type: 'spring', stiffness: 300, damping: 30 }

  return (
    <div className="onboard-ask-wrap" aria-hidden="true">
      <motion.div className="onboard-ask-glow" style={{ opacity: visibility, scale }} />

      <motion.span
        className="onboard-verdict-dot onboard-ask-float onboard-ask-float-1"
        style={{ background: PALETTE[0], opacity: visibility }}
      />
      <motion.span
        className="onboard-verdict-dot onboard-ask-float onboard-ask-float-2"
        style={{ background: PALETTE[3], opacity: visibility }}
      />
      <FaceMark
        size={22}
        bg="#221e1a"
        style={{ position: 'absolute', top: '14%', right: '18%', opacity: 1 }}
      />

      <motion.div
        className="onboard-ask-card"
        initial={cardInitial}
        animate={cardAnimate}
        transition={cardTransition}
      >
        <span className="onboard-ask-anon">🔒 Anonymous</span>
        <p className="onboard-ask-placeholder">
          Tell us what happened…
          <span className="onboard-ask-cursor" aria-hidden="true">|</span>
        </p>
      </motion.div>
    </div>
  )
}
