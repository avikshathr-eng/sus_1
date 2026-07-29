import { motion, useTransform } from 'framer-motion'
import { PALETTE } from '../../lib/tags'

// Small huddle beneath the card — deterministic positions/sizes so the
// crowd cluster doesn't reshuffle between renders. Reads as "a handful of
// people," not a grid.
const CROWD = [
  { left: 6, size: 10 },
  { left: 24, size: 7 },
  { left: 42, size: 12 },
  { left: 60, size: 8 },
  { left: 80, size: 11 },
  { left: 100, size: 7 },
]

// cardEntrance/flagEntrance/relaxEntrance are motion values (0 -> 1) driven
// by the parent Onboarding component's goToIndex — see the comment there
// for why the animate() calls live there rather than in a useEffect here.
export default function AskSusCard({ pageProgress, reducedMotion, cardEntrance, flagEntrance, relaxEntrance }) {
  const visibility = useTransform(pageProgress, [1, 2], reducedMotion ? [1, 1] : [0, 1], { clamp: true })
  const scale = useTransform(pageProgress, [1, 2], reducedMotion ? [1, 1] : [0.9, 1], { clamp: true })

  // The card itself is two nested layers: this outer wrapper carries the
  // one-time spring-in, the inner .onboard-ask-card carries a separate,
  // always-on CSS idle float. Same reasoning as ConfessionCards — one
  // element can't cleanly own both a framer-driven transform and a
  // CSS-keyframe transform at once.
  const cardY = useTransform(cardEntrance, [0, 1], [18, 0])
  const flagY = useTransform(flagEntrance, [0, 1], [10, 0])
  const flagScale = useTransform(flagEntrance, [0, 1], [0.9, 1])
  const relaxY = useTransform(relaxEntrance, [0, 1], [10, 0])
  const relaxScale = useTransform(relaxEntrance, [0, 1], [0.9, 1])

  return (
    <motion.div className="onboard-ask-wrap" style={{ opacity: visibility, scale }} aria-hidden="true">
      <div className="onboard-ask-glow" />

      {/* Crowd cluster + the two response chips together make "you submit,
          the crowd responds" legible — the chips visibly emerge from the
          cluster rather than floating independently of it. */}
      <div className="onboard-ask-crowd">
        {CROWD.map((d, i) => (
          <span
            key={i}
            className="onboard-ask-crowd-dot"
            style={{
              left: d.left,
              width: d.size,
              height: d.size,
              background: i % 2 === 0 ? PALETTE[0] : '#221e1a',
              animationDelay: reducedMotion ? undefined : `${(i * 0.3).toFixed(2)}s`,
            }}
          />
        ))}
      </div>

      <motion.span
        className="onboard-ask-chip onboard-ask-chip-flag"
        style={{ opacity: flagEntrance, y: flagY, scale: flagScale }}
      >
        RED FLAG
      </motion.span>
      <motion.span
        className="onboard-ask-chip onboard-ask-chip-relax"
        style={{ opacity: relaxEntrance, y: relaxY, scale: relaxScale }}
      >
        RELAX
      </motion.span>

      <motion.div style={{ opacity: cardEntrance, y: cardY }}>
        <div className="onboard-ask-card">
          <span className="onboard-ask-anon">🔒 Anonymous</span>
          <p className="onboard-ask-placeholder">
            Tell us what happened…
            <span className="onboard-ask-cursor" aria-hidden="true">|</span>
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}
