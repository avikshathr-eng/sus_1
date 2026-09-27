import { useState } from 'react'
import { X } from 'lucide-react'
import { getDeviceId } from '../lib/supabase'
import { invokeFunction } from '../lib/invokeFunction'
import { REPORT_REASONS } from '../lib/reportReasons'
import { hidePost } from '../lib/hiddenContent'
import { hideAuthor } from '../lib/reportActions'

// Compact flag menu: report-with-a-reason, locally-scoped "hide this post",
// and server-side "block this user". Apple's Guideline 1.2 requires that
// reporting a post ALSO immediately removes it from the reporter's own feed
// (not just queues it for admin review) — this is Guideline 1.2 required
// behavior, not a design choice we made up, so submitReport below hides the
// post the same way the explicit "Hide this post" button does, on top of
// recording the report. Reports still don't auto-remove the post for OTHER
// users — a single bad-faith report shouldn't silence a post for everyone —
// the person running sus. checks the admin dashboard (admin/index.html,
// which now surfaces open-report age against the 24h SLA) and acts on it.
//
// No `authorId` prop anymore — get_feed() never returns a post's raw
// device_id to the client at all (see the security-audit migrations), so
// "block this user" goes through hideAuthor(postId), which resolves the
// author server-side via the hide_author() database function. The blocked
// user's identity is never exposed to the blocker, and the block is never
// visible to the blocked user.
//
// `onRemoved` (from SwipeCard/CardStack) is called any time this menu takes
// an action that should pull the post off screen immediately — Apple
// explicitly requires "a mechanism for users to immediately remove posts
// from the feed," and a locally-hidden post that still shows on screen
// until the next swipe doesn't satisfy that literally. Block uses a
// separate `onBlocked` callback instead of `onRemoved` — removing just this
// one post isn't enough there, since other posts by the same author could
// already be sitting further down in CardStack's prefetched buffer (see
// CardStack's handleAuthorBlocked for why that needs a full feed refresh,
// not a single-post filter).
export default function ReportButton({ postId, onRemoved, onBlocked }) {
  const [open, setOpen] = useState(false)
  const [sentReason, setSentReason] = useState(null)
  const [hiddenAction, setHiddenAction] = useState(null) // 'post' | 'author'

  async function submitReport(reasonId) {
    setSentReason(reasonId)
    // Reporting removes the post from THIS device's feed immediately, same
    // as the explicit "Hide this post" action — Apple's rejection requires
    // this, not just "we'll look at it eventually."
    hidePost(postId)
    onRemoved?.(postId)
    // Routes through record-report (service-role key) rather than inserting
    // into `reports` directly with the anon key — PostgREST is currently
    // rejecting every anon-key INSERT project-wide regardless of policy
    // (open Supabase support ticket); the identical insert via service-role
    // works fine. See supabase/functions/record-report/index.ts.
    const { error } = await invokeFunction('record-report', {
      body: { post_id: postId, device_id: getDeviceId(), reason: reasonId },
    })
    if (error) console.error('report failed', error)
  }

  function handleHidePost() {
    hidePost(postId)
    onRemoved?.(postId)
    setHiddenAction('post')
  }

  function handleBlockUser() {
    // hideAuthor() itself is fire-and-forget (same pattern as skip
    // persistence elsewhere in this app — see CardStack's loadSkipResult),
    // but onBlocked (CardStack's handleAuthorBlocked) is NOT: it discards
    // the rest of the prefetched buffer and re-fetches through get_feed(),
    // which only guarantees a clean result once hide_author() has actually
    // committed the block server-side. Awaiting hideAuthor() first closes a
    // real race — firing the refetch before the block lands could get back
    // a batch that still includes the very author just blocked.
    hideAuthor(postId).then(() => onBlocked?.(postId))
    setHiddenAction('author')
  }

  function close() {
    setOpen(false)
    // Reset after the close animation-ish delay so reopening later (a
    // different card reuses this same mounted-once-per-card component)
    // always starts from the reason list, not a stale "Thanks" state.
    setTimeout(() => {
      setSentReason(null)
      setHiddenAction(null)
    }, 200)
  }

  return (
    <div className="report-wrap">
      <button
        className="report-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Report or hide this post"
        title="Report or hide"
      >
        🚩
      </button>

      {open && (
        <>
          <div className="report-menu-backdrop" onClick={close} />
          <div className="report-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <div className="report-menu-header">
              <span>Report this post</span>
              <button className="report-menu-close" onClick={close} aria-label="Close report menu">
                <X size={14} />
              </button>
            </div>

            {sentReason ? (
              <p className="report-menu-thanks">
                Thanks for letting us know. This post has been removed from your feed and will be reviewed.
              </p>
            ) : (
              <div className="report-menu-list">
                {REPORT_REASONS.map((r) => (
                  <button key={r.id} className="report-menu-item" role="menuitem" onClick={() => submitReport(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            )}

            <div className="report-menu-divider" />

            {hiddenAction ? (
              <p className="report-menu-thanks">
                {hiddenAction === 'post' ? "This post has been removed from your feed." : "You won't see posts from this user again."}
              </p>
            ) : (
              <div className="report-menu-list">
                <button
                  className="report-menu-item"
                  role="menuitem"
                  onClick={handleHidePost}
                >
                  Hide this post
                </button>
                <button
                  className="report-menu-item"
                  role="menuitem"
                  onClick={handleBlockUser}
                >
                  Block this user
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
