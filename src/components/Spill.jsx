import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { TAGS } from '../lib/tags'
import { validateSubmission } from '../lib/moderation'

export default function Spill() {
  const [text, setText] = useState('')
  const [category, setCategory] = useState('other')
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('idle') // idle | submitting | done

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
      body: { text: text.trim(), category },
    })

    if (fnError || data?.error) {
      setError(data?.error || 'Something went wrong — try again.')
      setStatus('idle')
      return
    }

    setStatus('done')
    setText('')
  }

  if (status === 'done') {
    return (
      <div className="spill-tab">
        <h2>Sent 🎉</h2>
        <p className="muted-text">It's already live in the feed. Thanks for spilling.</p>
        <button className="btn-primary" onClick={() => setStatus('idle')}>Spill another</button>
      </div>
    )
  }

  return (
    <form className="spill-tab" onSubmit={handleSubmit}>
      <h2>Spill it 🤝</h2>
      <p className="muted-text">One sentence, no names. Totally anonymous — the crowd's got you.</p>

      <textarea
        rows={3}
        maxLength={90}
        placeholder="He still texts his ex..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
      />
      <div className="char-row">
        <span className="muted-text small">🔒 anonymous, always</span>
        <span className="muted-text small">{text.length}/90</span>
      </div>

      {error && <p className="form-error">{error}</p>}

      <p className="muted-text small">What's it about?</p>
      <div className="tag-picker">
        {TAGS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={`tag-pill ${category === t.id ? 'tag-pill-active' : ''}`}
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
  )
}
