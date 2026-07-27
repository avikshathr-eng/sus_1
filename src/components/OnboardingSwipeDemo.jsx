import { useState } from 'react'
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion'

// Self-contained fake-data demo so onboarding lets people FEEL the swipe
// mechanic immediately, instead of just reading about it. Nothing here
// touches the database.
const EXAMPLES = [
  { text: "They reply 'k' to every text.", pct: 78 },
  { text: 'Splits every bill exactly 50/50, always.', pct: 41 },
  { text: "Reads your messages while you're asleep.", pct: 91 },
  { text: 'Cancels plans last minute, most weeks.', pct: 63 },
]

export default function OnboardingSwipeDemo() {
  const [i, setI] = useState(0)
  const [verdict, setVerdict] = useState(null)
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-14, 14])
  const redOpacity = useTransform(x, [-140, -30, 0], [1, 0, 0])
  const relaxOpacity = useTransform(x, [0, 30, 140], [0, 0, 1])

  const current = EXAMPLES[i % EXAMPLES.length]

  function handleDragEnd(_, info) {
    if (info.offset.x < -100) setVerdict('red_flag')
    else if (info.offset.x > 100) setVerdict('relax')
  }

  function next() {
    setVerdict(null)
    x.set(0)
    setI((v) => v + 1)
  }

  return (
    <div className="demo-wrap">
      <AnimatePresence mode="wait">
        {!verdict ? (
          <motion.div
            key={i}
            className="swipe-card demo-card"
            style={{ x, rotate }}
            drag="x"
            dragElastic={0.7}
            onDragEnd={handleDragEnd}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="card-tag">Try it</span>
            <p className="card-text">{current.text}</p>
            <motion.div className="stamp stamp-red" style={{ opacity: redOpacity }}>🚩</motion.div>
            <motion.div className="stamp stamp-relax" style={{ opacity: relaxOpacity }}>😌</motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="result"
            className="swipe-card demo-card"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <p className="card-text" style={{ fontSize: 18 }}>
              {verdict === 'red_flag' ? current.pct : 100 - current.pct}% of the crowd agreed with you
            </p>
            <button className="btn-primary full" onClick={next}>Try another →</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
