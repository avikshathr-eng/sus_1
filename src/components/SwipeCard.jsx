import { useState } from 'react'
import { motion, useMotionValue, useTransform } from 'framer-motion'
import { TAG_LABEL } from '../lib/tags'
import ReportButton from './ReportButton'

const SWIPE_THRESHOLD = 110

// A single draggable card. Drag left = red flag, drag right = relax.
// Pure presentation + gesture — voting logic lives in the parent (CardStack),
// this component just reports which way the user swiped.
export default function SwipeCard({ post, onSwiped, isTop, safetyBanner }) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-12, 12])
  const redOpacity = useTransform(x, [-140, -30, 0], [1, 0, 0])
  const relaxOpacity = useTransform(x, [0, 30, 140], [0, 0, 1])
  const [exiting, setExiting] = useState(null)

  function handleDragEnd(_, info) {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      setExiting('red_flag')
      onSwiped('red_flag')
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      setExiting('relax')
      onSwiped('relax')
    }
  }

  return (
    <motion.div
      className="swipe-card"
      style={{ x, rotate }}
      drag={isTop ? 'x' : false}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      animate={
        exiting
          ? { x: exiting === 'red_flag' ? -600 : 600, opacity: 0, rotate: exiting === 'red_flag' ? -20 : 20 }
          : { x: 0 }
      }
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      whileTap={{ cursor: 'grabbing' }}
    >
      <div className="card-top-row">
        <span className="card-tag">{TAG_LABEL[post.category] || post.category}</span>
        <ReportButton postId={post.id} />
      </div>

      {safetyBanner}

      <p className="card-text">{post.text}</p>

      {isTop && (
        <>
          <motion.div className="stamp stamp-red" style={{ opacity: redOpacity }}>
            🚩 red flag
          </motion.div>
          <motion.div className="stamp stamp-relax" style={{ opacity: relaxOpacity }}>
            😌 relax
          </motion.div>
        </>
      )}
    </motion.div>
  )
}
