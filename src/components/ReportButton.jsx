import { useState } from 'react'
import { supabase, getDeviceId } from '../lib/supabase'

// Lightweight community-moderation supplement: anyone can flag a card.
// Reports don't auto-hide anything (a single bad-faith report shouldn't
// silence a post) — Avi checks the reports table periodically and manually
// unpublishes anything that deserves it. See CLAUDE.md for the query.
export default function ReportButton({ postId }) {
  const [sent, setSent] = useState(false)

  async function handleReport(e) {
    e.stopPropagation()
    if (sent) return
    setSent(true)
    await supabase.from('reports').insert({ post_id: postId, device_id: getDeviceId() })
  }

  return (
    <button className="report-btn" onClick={handleReport} title="Report this">
      {sent ? '✓' : '🚩'}
    </button>
  )
}
