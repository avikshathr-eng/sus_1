import { useState, useEffect } from 'react'
import { supabase, getDeviceId } from '../lib/supabase'
import { invokeFunction } from '../lib/invokeFunction'
import { TAG_LABEL, tagStyleSolid } from '../lib/tags'
import { calculateDisplayedVoteSplit, formatVoteCountLabel } from '../lib/voteSplit'

const STATUS_LABEL = {
  approved: 'Published',
  pending: 'Under review',
  flagged: 'Needs an edit',
  rejected: 'Not published',
}

// Replaces the old "#N" leaderboard-rank label now that the Answered list
// is ordered by when this device voted, not by total_votes — a plain rank
// number would be meaningless (and misleading) against a chronological
// list, while a "when" label is exactly what makes the history readable at
// a glance (today's vs. an older answer from a previous day).
function formatAnsweredWhen(iso) {
  if (!iso) return null
  const voted = new Date(iso)
  const now = new Date()
  const votedDay = new Date(voted.getFullYear(), voted.getMonth(), voted.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((today - votedDay) / 86400000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return voted.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// This device's own answer for a card, if any — 'skip' is included for
// forward-compatibility only: skips aren't currently written to `votes` at
// all (see CardStack's loadSkipResult), so in practice this only ever
// resolves to 'red_flag', 'relax', or no chip at all. Never guessed from
// crowd percentages or majority — only ever the persisted row for this
// specific device_id, or nothing.
const MY_ANSWER_CHIP = {
  red_flag: { text: '✓ You chose Red Flag', className: 'red_flag' },
  relax: { text: '✓ You chose Relax', className: 'relax' },
  skip: { text: 'You skipped', className: 'skip' },
}

// The "Answered" list is your full voting history, most recently answered
// first — every card this device has ever voted on, not a popularity
// leaderboard capped at some arbitrary size. It used to be ordered by
// total_votes (most-engaged-with-by-everyone first) and capped at 30 rows,
// which meant older answers could silently fall off the list entirely as
// more popular cards pushed past the cap — the opposite of "all your
// history." Sorting by this device's own vote timestamp instead guarantees
// every card you've ever answered stays visible, oldest just further down.
export default function CrowdPicks({ onEditPost }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [myPosts, setMyPosts] = useState([])
  const [myPostsLoading, setMyPostsLoading] = useState(true)

  // A card's result is a spoiler for the opinion you haven't formed yet —
  // Crowd Picks only ever shows cards this device has personally swiped on
  // (left or right), never the full public leaderboard. Also doubles as a
  // small return-and-swipe-more incentive.
  useEffect(() => {
    async function load() {
      setLoading(true)
      const device_id = getDeviceId()

      // get_my_voted_post_ids() (see the feed-distribution/security
      // migrations) replaces a direct `votes` table read — the open
      // "read votes" RLS policy this used to rely on was a real leak (any
      // anon-key holder could query it unscoped and get every device's
      // full voting history), now closed. The RPC takes device_id as a
      // parameter and returns only post_id/vote/created_at — never a
      // device_id column for anyone's data — so this still gets exactly
      // what it needs (which cards this device voted on, its own answer,
      // and when) without that column ever being queryable at all anymore.
      const { data: votedRows, error: votedError } = await supabase
        .rpc('get_my_voted_post_ids', { p_device_id: device_id })

      if (votedError) {
        console.error('voted-history load failed', votedError)
        setLoading(false)
        return
      }

      const votedIds = (votedRows || []).map((v) => v.post_id)
      if (votedIds.length === 0) {
        setRows([])
        setLoading(false)
        return
      }

      // post_id -> this device's own vote/vote-time, batched from the single
      // query above rather than looked up per row.
      const myAnswerById = new Map((votedRows || []).map((v) => [v.post_id, v.vote]))
      const myVoteTimeById = new Map((votedRows || []).map((v) => [v.post_id, v.created_at]))

      const { data, error } = await supabase
        .from('crowd_picks')
        .select('*')
        .in('id', votedIds)

      if (error) {
        console.error('crowd picks load failed', error)
        setLoading(false)
        return
      }

      const withAnswers = (data || []).map((post) => ({
        ...post,
        myAnswer: myAnswerById.get(post.id) ?? null,
        myVoteTime: myVoteTimeById.get(post.id) ?? null,
      }))
      withAnswers.sort((a, b) => new Date(b.myVoteTime) - new Date(a.myVoteTime))
      setRows(withAnswers)
      setLoading(false)
    }
    load()
  }, [])

  // Own submissions, every status — the my-posts Edge Function is the only
  // way to read these, since the anon key's RLS policy on `posts` only
  // exposes status='approved' rows (see supabase/functions/my-posts).
  useEffect(() => {
    async function loadMine() {
      setMyPostsLoading(true)
      const { data, error } = await invokeFunction('my-posts', {
        body: { device_id: getDeviceId() },
      })
      if (error) {
        console.error('your posts load failed', error)
        setMyPostsLoading(false)
        return
      }
      setMyPosts(data?.posts || [])
      setMyPostsLoading(false)
    }
    loadMine()
  }, [])

  return (
    <div className="crowd-tab">
      <h2>Crowd Picks</h2>
      <p className="muted-text">The crowd has spoken—softest to spiciest. Still anonymous. 💜</p>

      {!myPostsLoading && myPosts.length > 0 && (
        <section className="your-posts-section">
          <h3 className="section-heading">My Questions</h3>
          {myPosts.map((post) => {
            const split = post.result
              ? calculateDisplayedVoteSplit(post.result.red_flag_count, post.result.relax_count)
              : null
            const votesLabel = post.result ? formatVoteCountLabel(post.result.total_votes) : null

            return (
              <div className="pick-card" key={post.id}>
                <div className="pick-top-row">
                  <span className="card-tag" style={tagStyleSolid(post.category)}>{TAG_LABEL[post.category] || post.category}</span>
                  <span className={`my-post-status status-${post.status}`}>{STATUS_LABEL[post.status] || post.status}</span>
                </div>
                <p className="pick-text">{post.text}</p>

                {post.status === 'approved' && split && (
                  <>
                    <p className="muted-text small">
                      {split.redPct}% Red Flag{votesLabel ? ` · ${votesLabel}` : ''}
                    </p>
                    <div className="result-bar-track">
                      <div className="result-bar-fill red" style={{ width: `${split.redPct}%` }} />
                      <div className="result-bar-fill green" style={{ width: `${split.relaxPct}%` }} />
                    </div>
                  </>
                )}

                {post.status === 'pending' && (
                  <p className="muted-text small">Still being reviewed.</p>
                )}

                {post.status === 'flagged' && (
                  <div className="my-post-flag-notice">
                    <p className="muted-text small">{post.flag_reason || "It may not meet community guidelines."}</p>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onEditPost?.({ text: post.text, category: post.category })}
                    >
                      Edit post
                    </button>
                  </div>
                )}

                {post.status === 'rejected' && (
                  <p className="muted-text small">This submission wasn't published.</p>
                )}
              </div>
            )
          })}
        </section>
      )}

      {loading && <p className="muted-text">Loading…</p>}
      {!loading && rows.length === 0 && <p className="muted-text">No votes yet — go swipe a few cards first.</p>}
      {!loading && rows.length > 0 && <h3 className="section-heading">Answered</h3>}

      {rows.map((post) => {
        const split = calculateDisplayedVoteSplit(post.red_flag_count, post.relax_count)
        const votesLabel = formatVoteCountLabel(post.total_votes)
        const chip = MY_ANSWER_CHIP[post.myAnswer] ?? null

        return (
          <div className="pick-card" key={post.id}>
            <div className="pick-top-row">
              <span className="card-tag" style={tagStyleSolid(post.category)}>{TAG_LABEL[post.category] || post.category}</span>
            </div>
            <p className="pick-text">{post.text}</p>

            {chip && <span className={`my-answer-chip ${chip.className}`}>{chip.text}</span>}

            <div className="pick-pct-row">
              <span>{split.redPct}% Red Flag</span>
              <span>{split.relaxPct}% Relax</span>
            </div>
            <div className="result-bar-track">
              <div className="result-bar-fill red" style={{ width: `${split.redPct}%` }} />
              <div className="result-bar-fill green" style={{ width: `${split.relaxPct}%` }} />
            </div>
            <p className="muted-text small">
              {[votesLabel, formatAnsweredWhen(post.myVoteTime)].filter(Boolean).join(' · ')}
            </p>
          </div>
        )
      })}
    </div>
  )
}
