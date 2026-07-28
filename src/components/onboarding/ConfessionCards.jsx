import { motion, useTransform } from 'framer-motion'
import { TAG_LABEL, tagStyleSolid } from '../../lib/tags'
import FaceMark from './FaceMark'

const CARD_A = { text: 'He still sends his mom screenshots of our arguments.', category: 'family' }
const CARD_B = { text: "She made me unfollow every woman I've ever dated.", category: 'relationship' }

// Screen 1 only ever transitions forward (there's no screen before index 0),
// so the only range that matters is progress 0 (at rest, here) -> 1 (fully
// on screen 2). The two cards drift by slightly different amounts so they
// visibly separate rather than moving in lockstep.
export default function ConfessionCards({ pageProgress, reducedMotion }) {
  const driftA = useTransform(pageProgress, [0, 1], reducedMotion ? [0, 0] : [0, -22])
  const driftB = useTransform(pageProgress, [0, 1], reducedMotion ? [0, 0] : [0, -46])
  const tiltA = useTransform(pageProgress, [0, 1], reducedMotion ? [-6, -6] : [-6, -10])
  const tiltB = useTransform(pageProgress, [0, 1], reducedMotion ? [5, 5] : [5, 9])

  return (
    <div className="onboard-confess-wrap" aria-hidden="true">
      <motion.div
        className="onboard-confess-card onboard-confess-card-a"
        style={{ x: driftA, rotate: tiltA }}
      >
        <span className="card-tag onboard-confess-tag" style={tagStyleSolid(CARD_A.category)}>
          {TAG_LABEL[CARD_A.category]}
        </span>
        <p className="onboard-confess-text">{CARD_A.text}</p>
        <FaceMark size={20} bg="#221e1a" style={{ position: 'absolute', bottom: 14, right: 14 }} />
      </motion.div>

      <motion.div
        className="onboard-confess-card onboard-confess-card-b"
        style={{ x: driftB, rotate: tiltB }}
      >
        <span className="card-tag onboard-confess-tag" style={tagStyleSolid(CARD_B.category)}>
          {TAG_LABEL[CARD_B.category]}
        </span>
        <p className="onboard-confess-text">{CARD_B.text}</p>
        <FaceMark size={20} bg="#221e1a" style={{ position: 'absolute', bottom: 14, right: 14 }} />
      </motion.div>
    </div>
  )
}
