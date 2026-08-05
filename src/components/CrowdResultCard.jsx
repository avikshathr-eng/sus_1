import { motion } from 'framer-motion'
import { Flag, CheckCircle } from 'lucide-react'
import { calculateDisplayedVoteSplit, formatVoteCountLabel } from '../lib/voteSplit'
import { VOTE_COLORS } from '../lib/voteColors'

// The neutral result: shown after a Skip (both crowd percentages, no side
// highlighted, no "you chose" framing since the user didn't actually vote)
// or after a vote's save failed (retry prompt). A committed Red Flag/Relax
// vote no longer renders here at all — that's FullScreenAgreementResult's
// job now (see CardStack, which only ever mounts this component for
// reveal.vote === 'skip' or reveal.status === 'error').
//
// Occupies the exact slot SwipeCard sits in (see CardStack's .card-stack) —
// rendered only once the outgoing question card has fully finished exiting,
// and only for as long as it takes to read, per the question → result →
// next-question sequence. Never coexists on screen with either the question
// it belongs to or the next one.
export default function CrowdResultCard({ reveal, reducedMotion, onRetry }) {
  const { status, result } = reveal
  const isError = status === 'error'

  // 50/50 here only covers the rare case the network call genuinely hasn't
  // resolved yet by the time this mounts (see CardStack's fixed, network-
  // independent result timing) — it's never animated away from; the text
  // just re-renders at the real value the instant `result` arrives, same as
  // any other data-dependent render.
  const { redPct, relaxPct } = result
    ? calculateDisplayedVoteSplit(result.red_flag_count, result.relax_count)
    : { redPct: 50, relaxPct: 50 }
  const votesLabel = result ? formatVoteCountLabel(result.total_votes) : null

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
          <span className="crowd-result-pill skip">Skipped</span>

          <div className="crowd-result-split">
            <div className="crowd-result-side">
              <Flag size={20} color={VOTE_COLORS.redFlag} />
              <span className="crowd-result-side-label">Red Flag</span>
              <span className="crowd-result-side-pct">{redPct}%</span>
            </div>
            <div className="crowd-result-side">
              <CheckCircle size={20} color={VOTE_COLORS.relax} />
              <span className="crowd-result-side-label">Relax</span>
              <span className="crowd-result-side-pct">{relaxPct}%</span>
            </div>
          </div>

          <div className="crowd-result-bar-track">
            <motion.div
              className="crowd-result-bar-fill red"
              initial={{ width: '0%' }}
              animate={{ width: `${redPct}%` }}
              transition={{ duration: reducedMotion ? 0 : 0.45, ease: 'easeOut' }}
            />
            <motion.div
              className="crowd-result-bar-fill green"
              initial={{ width: '0%' }}
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
