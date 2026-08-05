import { motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'

const COLOR_VAR = { redFlag: 'var(--flag)', relax: 'var(--relax)' }
const LABEL = { redFlag: 'RED FLAG', relax: 'RELAX' }

// The live-feed vote result: a full-bleed color takeover (rendered by
// App.jsx as a sibling to SwipeBackground, so it covers the whole app area
// the same way the drag background does) showing only the percentage of the
// crowd that agrees with the choice just made. Deliberately does not show
// the opposite percentage or a split bar — that's Crowd Picks' and Skip's
// job (see CrowdResultCard), not this screen's.
export default function FullScreenAgreementResult({ selectedAnswer, redFlagPercentage, relaxPercentage }) {
  const reducedMotion = usePrefersReducedMotion()
  const agreementPercentage = selectedAnswer === 'redFlag' ? redFlagPercentage : relaxPercentage

  const pctInitial = reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 14 }
  const pctAnimate = reducedMotion ? { opacity: 1 } : { opacity: 1, scale: [0.9, 1.04, 1], y: 0 }
  const lineTransition = (delay) =>
    reducedMotion ? { duration: 0.15, ease: 'easeOut' } : { duration: 0.22, ease: [0.22, 1, 0.36, 1], delay }

  return (
    <motion.div
      className="vote-result-fullscreen"
      style={{ backgroundColor: COLOR_VAR[selectedAnswer] }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <motion.span className="vote-result-pct" initial={pctInitial} animate={pctAnimate} transition={lineTransition(0)}>
        {agreementPercentage}%
      </motion.span>
      <motion.span
        className="vote-result-label"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={lineTransition(0.08)}
      >
        {LABEL[selectedAnswer]}
      </motion.span>
      <motion.span
        className="vote-result-sub"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={lineTransition(0.16)}
      >
        You’re with {agreementPercentage}% of the crowd.
      </motion.span>
    </motion.div>
  )
}
