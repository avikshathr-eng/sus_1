import { useEffect, useState } from 'react'
import { supabase, getDeviceId } from '../lib/supabase'
import { TAGS, tagStyleSolid, tagStyleOutline } from '../lib/tags'
import { validateSubmission, MAX_CONFESSION_LENGTH } from '../lib/moderation'
import { addMyPostId } from '../lib/myPosts'

// `draft` (from App.jsx) pre-fills this form when arriving via "Edit post"
// on a flagged submission in Your Posts — editing it here and sending
// creates a fresh, separate submission rather than mutating the old one, so
// no update-in-place backend path was needed for that flow.
export default function Spill({ draft, onDraftConsumed }) {
  const [text, setText] = useState(draft?.text ?? '')
  const [category, setCategory] = useState(draft?.category ?? 'other')
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('idle') // idle | submitting | done

  useEffect(() => {
    if (!draft) return
    setText(draft.text ?? '')
    setCategory(draft.category ?? 'other')
    onDraftConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    // Instant client-side check for a snappy UX (no round-trip for obvious
    // problems), but this is NOT the real gate — the submit-post Edge
    // Function re-checks everything server-side and is the only path that
    // can actually write to the posts table (see supabase/schema.sql, the
    // anon key has no insert policy on posts anymore).
    const check = validateSubmission(text)
    if (!check.ok) {
      setError(check.reason)
      return
    }

    setStatus('submitting')

    const { data, error: fnError } = await supabase.functions.invoke('submit-post', {
      body: { text: text.trim(), category, device_id: getDeviceId() },
    })

    if (fnError || data?.error) {
      setError(data?.error || 'Something went wrong — try again.')
      setStatus('idle')
      return
    }

    if (data?.post?.id) addMyPostId(data.post.id)

    setStatus('done')
    setText('')
  }

  if (status === 'done') {
    return (
      <div className="spill-tab">
        <h1 className="feed-title">Spill it<span className="dot">.</span></h1>
        <p className="feed-meta">Sent 🎉</p>
        <div className="spill-card spill-card-done">
          <p className="muted-text">It's already live in the feed. Thanks for spilling.</p>
          <button className="btn-primary full" onClick={() => setStatus('idle')}>Spill another</button>
        </div>
      </div>
    )
  }

  return (
    <div className="spill-tab">
      <h1 className="feed-title">Spill it<span className="dot">.</span></h1>
      <p className="feed-meta">One sentence. No names. Posted without your name.</p>

      <form className="spill-card" onSubmit={handleSubmit}>
        <p className="muted-text small spill-helper">Describe the behavior—not the person.</p>
        <textarea
          rows={4}
          maxLength={MAX_CONFESSION_LENGTH}
          placeholder="He still texts his ex..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <div className="char-row">
          <span className="muted-text small">🔒 No name attached.</span>
          <span className="muted-text small">{text.length}/{MAX_CONFESSION_LENGTH}</span>
        </div>

        {error && <p className="form-error">{error}</p>}

        <p className="muted-text small">Pick a category</p>
        <div className="tag-picker">
          {TAGS.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`tag-pill ${category === t.id ? 'tag-pill-active' : ''}`}
              style={category === t.id ? tagStyleSolid(t.id) : tagStyleOutline(t.id)}
              onClick={() => setCategory(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button className="btn-primary full" type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Sending…' : 'Spill it'}
        </button>
      </form>
    </div>
  )
}
