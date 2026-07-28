// Single source of truth for anywhere a Red Flag vs. Relax split gets shown
// — the post-vote result card, Crowd Picks, and Your Posts. Two rules live
// here so they can never drift apart between screens: the display-only
// smoothing prior, and the public vote-count visibility threshold.

// A brand-new confession with zero real votes would otherwise show a
// meaningless 100/0 (or NaN) the instant its first vote comes in. This is a
// *display-only* Bayesian prior — one imaginary vote on each side — never
// written to the database and never shown to anyone as a real vote. It
// starts every confession at a neutral 50/50 and converges toward the real
// percentages as more real votes come in.
export function calculateDisplayedVoteSplit(redFlagCount, relaxCount) {
  const smoothedRed = (redFlagCount ?? 0) + 1
  const smoothedRelax = (relaxCount ?? 0) + 1
  const smoothedTotal = smoothedRed + smoothedRelax

  // Round one side, derive the other from it — rounding both independently
  // can produce 99% or 101%.
  const redPct = Math.round((smoothedRed / smoothedTotal) * 100)
  const relaxPct = 100 - redPct

  return { redPct, relaxPct }
}

// Below this many *real* votes, an exact count reads as more significant
// than it is (and invites exactly the kind of "only 3 people voted" doubt
// that made "Early read" wording necessary before) — so it's simply hidden.
// At or above it, a compact count becomes useful social proof.
export const PUBLIC_VOTE_COUNT_THRESHOLD = 100

// Returns null below the threshold (render nothing), otherwise a compact
// label like "248 votes" or "1.2K votes".
export function formatVoteCountLabel(totalVotes) {
  const total = totalVotes ?? 0
  if (total < PUBLIC_VOTE_COUNT_THRESHOLD) return null
  if (total < 1000) return `${total} votes`
  const compact = (total / 1000).toFixed(1).replace(/\.0$/, '')
  return `${compact}K votes`
}
