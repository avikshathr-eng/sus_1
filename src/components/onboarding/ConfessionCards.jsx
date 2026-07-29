import { motion, useTransform } from 'framer-motion'
import { TAG_LABEL, tagStyleSolid } from '../../lib/tags'

const CARD_A = { text: 'He still sends his mom screenshots of our arguments.', category: 'family' }
const CARD_B = { text: "She made me unfollow every woman I've ever dated.", category: 'relationship' }

// Screen 1 only ever transitions forward (there's no screen before index 0),
// so the only range that matters is progress 0 (at rest, here) -> 1 (fully
// on screen 2). The two cards drift by different amounts — that difference
// IS the parallax: front and back visibly separate at different rates
// rather than moving in lockstep.
export default function ConfessionCards({ pageProgress, reducedMotion }) {
  const driftA = useTransform(pageProgress, [0, 1], reducedMotion ? [0, 0] : [0, -20])
  const driftB = useTransform(pageProgress, [0, 1], reducedMotion ? [0, 0] : [0, -52])
  const tiltA = useTransform(pageProgress, [0, 1], reducedMotion ? [-6, -6] : [-6, -9])
  const tiltB = useTransform(pageProgress, [0, 1], reducedMotion ? [5, 5] : [5, 10])

  return (
    <div className="onboard-confess-wrap" aria-hidden="true">
      {/* Two nested elements per card, deliberately: the outer motion.div
          carries the drag-driven parallax (x/rotate, written every frame by
          framer while dragging), the inner plain div carries a separate,
          always-on CSS idle float. Both would fight over `transform` on a
          single element — nesting lets them compose instead, same principle
          already documented for SwipeBackground's layered transforms. */}
      <motion.div className="onboard-confess-card onboard-confess-card-a" style={{ x: driftA, rotate: tiltA }}>
        <div className="onboard-confess-card-inner onboard-confess-float-a">
          <span className="card-tag onboard-confess-tag" style={tagStyleSolid(CARD_A.category)}>
            {TAG_LABEL[CARD_A.category]}
          </span>
          <p className="onboard-confess-text">{CARD_A.text}</p>
        </div>
      </motion.div>

      <motion.div className="onboard-confess-card onboard-confess-card-b" style={{ x: driftB, rotate: tiltB }}>
        <div className="onboard-confess-card-inner onboard-confess-float-b">
          <span className="card-tag onboard-confess-tag" style={tagStyleSolid(CARD_B.category)}>
            {TAG_LABEL[CARD_B.category]}
          </span>
          <p className="onboard-confess-text">{CARD_B.text}</p>
        </div>
      </motion.div>
    </div>
  )
}
