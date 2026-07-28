import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Flag, CheckCircle } from 'lucide-react'
import { calculateDisplayedVoteSplit, formatVoteCountLabel } from '../lib/voteSplit'

// Counts a percentage up from 50 (the neutral starting point every card
// animates from) to its final displayed value — the bar itself animates the
// same interval declaratively via framer; a plain text node needs its own
// tick.
function useCountFrom50(target, durationMs, active) {
  const [value, setValue] = useState(50)
  useEffect(() => {
    if (!active) {
      setValue(target)
      return
    }
    let raf
    const start = performance.now()
    const from = 50
    function tick(now) {
      const p = Math.min((now - start) / durationMs, 1)
      setValue(Math.round(from + (target - from) * p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, active])
  return value
}

// Occupies the exact slot SwipeCard sits in (see CardStack's .card-stack) —
// rendered only once the outgoing question card has fully finished exiting,
// and only for as long as it takes to read, per the question → result →
// next-question sequence. Never coexists on screen with either the question
// it belongs to or the next one.
export default function CrowdResultCard({ reveal, reducedMotion, onRetry }) {
  const { vote, status, result } = reveal
  const label = vote === 'red_flag' ? 'Red Flag' : 'Relax'
  const isError = status === 'error'

  // Starts every card at a neutral 50/50 the instant it mounts — if the real
  // result hasn't arrived yet (rare; the network call started well before
  // this card is even shown), it simply animates again once it does, from
  // wherever it currently sits.
  const { redPct, relaxPct } = result
    ? calculateDisplayedVoteSplit(result.red_flag_count, result.relax_count)
    : { redPct: 50, relaxPct: 50 }
  const votesLabel = result ? formatVoteCountLabel(result.total_votes) : null

  const animateRed = useCountFrom50(redPct, 450, !reducedMotion)
  const animateRelax = 100 - animateRed
  const displayRed = reducedMotion ? redPct : animateRed
  const displayRelax = reducedMotion ? relaxPct : animateRelax

  // No `exit` here — this card is removed via plain conditional rendering
  // (see CardStack), not AnimatePresence, so it disappears the instant
  // `phase` moves on rather than depending on an animation-completion
  // signal. It still animates in freely on mount.
  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.97, y: 14 }
  const animate = { opacity: 1, scale: 1, y: 0 }
  const transition = reducedMotion
    ? { duration: 0.18, ease: 'easeOut' }
    : { type: 'spring', stiffness: 340, damping: 32 }

  return (
    <motion.div
      className="swipe-card crowd-result-card"
      initial={initial}
      animate={animate}
      transition={transition}
    >
      {isError ? (
        <div className="crowd-result-error">
          <p className="crowd-result-error-text">Vote wasn't saved.</p>
          <button type="button" className="btn-secondary" onClick={onRetry}>Tap to retry</button>
        </div>
      ) : (
        <div className="crowd-result-body" role="status">
          <span className="crowd-result-label">Crowd split</span>
          <span className={`crowd-result-pill ${vote}`}>You chose {label}</span>

          <div className="crowd-result-split">
            <div className="crowd-result-side">
              <Flag size={20} color="#F694C3" />
              <span className="crowd-result-side-label">Red Flag</span>
              <span className="crowd-result-side-pct">{displayRed}%</span>
            </div>
            <div className="crowd-result-side">
              <CheckCircle size={20} color="#82D7B8" />
              <span className="crowd-result-side-label">Relax</span>
              <span className="crowd-result-side-pct">{displayRelax}%</span>
            </div>
          </div>

          <div className="crowd-result-bar-track">
            <motion.div
              className="crowd-result-bar-fill red"
              initial={{ width: '50%' }}
              animate={{ width: `${redPct}%` }}
              transition={{ duration: reducedMotion ? 0 : 0.45, ease: 'easeOut' }}
            />
            <motion.div
              className="crowd-result-bar-fill green"
              initial={{ width: '50%' }}
              animate={{ width: `${relaxPct}%` }}
              transition={{ duration: reducedMotion ? 0 : 0.45, ease: 'easeOut' }}
            />
          </div>

          {votesLabel && <span className="crowd-result-votes muted-text small">{votesLabel}</span>}
        </div>
      )}
    </motion.div>
  )
}
