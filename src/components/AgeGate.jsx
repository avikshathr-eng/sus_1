import { useState } from 'react'
import { confirmAgeAndTos } from '../lib/ageGate'
import LegalModal from './LegalModal'
import SusWordmark from './SusWordmark'

// Combined age + terms gate. This is a real entry requirement, not a
// decoration: Apple's Guideline 1.2 (User-Generated Content) requires an
// affirmative agreement to terms that explicitly prohibit objectionable
// content and abusive behavior before someone can use an anonymous UGC app —
// a viewable link isn't enough, the "Continue" action has to be blocked
// until the box is checked.
export default function AgeGate({ onConfirmed, onUnder18 }) {
  const [showLegal, setShowLegal] = useState(false)
  const [agreed, setAgreed] = useState(false)

  function handleContinue() {
    if (!agreed) return
    confirmAgeAndTos()
    onConfirmed()
  }

  return (
    <div className="gate-screen">
      <SusWordmark />
      <h1>You need to be 18+</h1>
      <p className="muted-text">
        sus. deals with real talk about relationships, money, and family — some of it
        can be heavy. It's peer opinion for fun, not professional advice.
      </p>

      <label className="tos-checkbox">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I'm 18 or older and I agree to the{' '}
          <button type="button" className="link-inline" onClick={() => setShowLegal(true)}>
            Terms &amp; Community Guidelines
          </button>{' '}
          — including no harassment, hate speech, or targeting real people.
        </span>
      </label>

      <button className="btn-primary full" disabled={!agreed} onClick={handleContinue}>
        Continue
      </button>
      <button className="btn-secondary full" onClick={onUnder18}>I'm under 18</button>

      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
    </div>
  )
}
