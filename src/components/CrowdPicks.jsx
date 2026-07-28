import { useState, useEffect } from 'react'
import { supabase, getDeviceId } from '../lib/supabase'
import { TAG_LABEL, tagStyleSolid } from '../lib/tags'
import { calculateDisplayedVoteSplit, formatVoteCountLabel } from '../lib/voteSplit'

const STATUS_LABEL = {
  approved: 'Published',
  pending: 'Under review',
  flagged: 'Needs an edit',
  rejected: 'Not published',
}

// Ranked by total votes (simple "most engaged with" heuristic for MVP — easy
// to swap for a fancier "controversial vs. landslide" score later).
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

      const { data: votedRows, error: votedError } = await supabase
        .from('votes')
        .select('post_id')
        .eq('device_id', device_id)

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

      const { data, error } = await supabase
        .from('crowd_picks')
        .select('*')
        .in('id', votedIds)
        .order('total_votes', { ascending: false })
        .limit(30)

      if (error) {
        console.error('crowd picks load failed', error)
        setLoading(false)
        return
      }

      setRows(data || [])
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
      const { data, error } = await supabase.functions.invoke('my-posts', {
        body: { device_id: getDeviceId() },
      })
      if (error || data?.error) {
        console.error('your posts load failed', error || data?.error)
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
          <h3 className="section-heading">Your Posts</h3>
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

      {rows.map((post, i) => {
        const split = calculateDisplayedVoteSplit(post.red_flag_count, post.relax_count)
        const votesLabel = formatVoteCountLabel(post.total_votes)

        return (
          <div className="pick-card" key={post.id}>
            <div className="pick-top-row">
              <span className="card-tag" style={tagStyleSolid(post.category)}>{TAG_LABEL[post.category] || post.category}</span>
              <span className="pick-pct">{split.redPct}%</span>
            </div>
            <p className="pick-text">{post.text}</p>
            <p className="muted-text small">
              {split.redPct}% Red Flag{votesLabel ? ` · ${votesLabel}` : ''} · #{i + 1}
            </p>
            <div className="result-bar-track">
              <div className="result-bar-fill red" style={{ width: `${split.redPct}%` }} />
              <div className="result-bar-fill green" style={{ width: `${split.relaxPct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
