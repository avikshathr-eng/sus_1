import { motion, useTransform } from 'framer-motion'
import { Flag, CheckCircle } from 'lucide-react'
import { COMPLETION_DISTANCE } from '../lib/dragConfig'

// Piecewise 3-point range: [-COMPLETION_DISTANCE, 0, COMPLETION_DISTANCE].
// The segment on a button's "wrong" side has identical start/end values, so
// e.g. the left (Red Flag) button is completely flat during a rightward
// drag instead of doing something backwards — it only ever reacts to drag
// moving toward it.
const RANGE = [-COMPLETION_DISTANCE, 0, COMPLETION_DISTANCE]

const REST_SHADOW = '0 14px 28px -10px rgba(40,30,15,0.22)'
const RED_SHADOW = '0 18px 34px -10px rgba(246,148,195,0.5)'
const GREEN_SHADOW = '0 18px 34px -10px rgba(130,215,184,0.5)'

// Tied directly to the same shared `dragX` SwipeCard's gesture writes to —
// continuous, no React re-renders, and naturally settles back to rest
// whenever dragX resets to 0 for the next card. Always mounted (just
// `disabled` while locked) — the post-vote result lives in its own card in
// .card-stack now, not swapped in here, so this is a plain div.
export default function VoteButtons({ dragX, onVote, locked }) {
  const leftScale = useTransform(dragX, RANGE, [1.1, 1, 0.96])
  const leftBg = useTransform(dragX, RANGE, ['#F694C3', '#ffffff', '#ffffff'])
  const leftIcon = useTransform(dragX, RANGE, ['#000000', '#F694C3', '#F694C3'])
  const leftOpacity = useTransform(dragX, RANGE, [1, 1, 0.5])
  const leftShadow = useTransform(dragX, RANGE, [RED_SHADOW, REST_SHADOW, REST_SHADOW])

  const rightScale = useTransform(dragX, RANGE, [0.96, 1, 1.1])
  const rightBg = useTransform(dragX, RANGE, ['#ffffff', '#ffffff', '#82D7B8'])
  const rightIcon = useTransform(dragX, RANGE, ['#82D7B8', '#82D7B8', '#000000'])
  const rightOpacity = useTransform(dragX, RANGE, [0.5, 1, 1])
  const rightShadow = useTransform(dragX, RANGE, [REST_SHADOW, REST_SHADOW, GREEN_SHADOW])

  return (
    <div className="tap-fallback">
      <div className="vote-btn-group">
        <motion.button
          className="vote-btn red"
          style={{ scale: leftScale, backgroundColor: leftBg, color: leftIcon, opacity: leftOpacity, boxShadow: leftShadow }}
          onClick={() => onVote('red_flag')}
          disabled={locked}
          aria-label="Red Flag"
        >
          <Flag size={22} />
        </motion.button>
        <span className="vote-btn-label">Red Flag</span>
      </div>
      <div className="vote-btn-group">
        <motion.button
          className="vote-btn green"
          style={{ scale: rightScale, backgroundColor: rightBg, color: rightIcon, opacity: rightOpacity, boxShadow: rightShadow }}
          onClick={() => onVote('relax')}
          disabled={locked}
          aria-label="Relax"
        >
          <CheckCircle size={22} />
        </motion.button>
        <span className="vote-btn-label">Relax</span>
      </div>
    </div>
  )
}
