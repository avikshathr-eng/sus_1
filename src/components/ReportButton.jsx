import { useState } from 'react'
import { X } from 'lucide-react'
import { getDeviceId } from '../lib/supabase'
import { invokeFunction } from '../lib/invokeFunction'
import { REPORT_REASONS } from '../lib/reportReasons'
import { hidePost } from '../lib/hiddenContent'
import { hideAuthor } from '../lib/reportActions'

// Compact flag menu: report-with-a-reason, plus locally-scoped "hide this
// post" / server-side "hide this account". Reports don't auto-remove
// anything — a single bad-faith report shouldn't silence a post — the
// person running sus. checks the reports table (now including `reason`)
// periodically and manually unpublishes anything that deserves it. See
// CLAUDE.md for the query.
//
// No `authorId` prop anymore — get_feed() never returns a post's raw
// device_id to the client at all (see the security-audit migrations), so
// "hide this account" now goes through hideAuthor(postId), which resolves
// the author server-side via the hide_author() database function.
export default function ReportButton({ postId }) {
  const [open, setOpen] = useState(false)
  const [sentReason, setSentReason] = useState(null)
  const [hiddenAction, setHiddenAction] = useState(null) // 'post' | 'author'

  async function submitReport(reasonId) {
    setSentReason(reasonId)
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
              <p className="report-menu-thanks">Thanks. We'll review it.</p>
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
                {hiddenAction === 'post' ? "You won't see this post again." : "You won't see posts from this account again."}
              </p>
            ) : (
              <div className="report-menu-list">
                <button
                  className="report-menu-item"
                  role="menuitem"
                  onClick={() => { hidePost(postId); setHiddenAction('post') }}
                >
                  Hide this post
                </button>
                <button
                  className="report-menu-item"
                  role="menuitem"
                  onClick={() => { hideAuthor(postId); setHiddenAction('author') }}
                >
                  Hide posts from this account
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
