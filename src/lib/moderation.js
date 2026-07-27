// Client-side pre-check used by Spill.jsx for instant feedback (no round
// trip needed to tell someone "no phone numbers"). This is NOT the real
// enforcement boundary anymore — the submit-post Edge Function
// (supabase/functions/submit-post/index.ts) re-runs the same checks
// server-side using the service-role key, and it's the only path that can
// actually write to `posts` (the anon key has no insert policy on that
// table — see schema.sql). That split — fast client check + non-bypassable
// server check — is what satisfies Apple's Guideline 1.2 "hold objectionable
// content for review" language instead of just being a client-side
// suggestion.
import { Filter } from 'bad-words'

const filter = new Filter()

const PHONE_REGEX = /(\+?\d[\d\s-]{8,}\d)/
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/
const HANDLE_REGEX = /[@#][\w.]{2,}/
const URL_REGEX = /(https?:\/\/|www\.)\S+/i

export function validateSubmission(text) {
  const trimmed = text.trim()

  if (trimmed.length < 5) {
    return { ok: false, reason: 'A little more detail, please.' }
  }
  if (trimmed.length > 90) {
    return { ok: false, reason: 'Keep it to one sentence — 90 characters max.' }
  }
  if (PHONE_REGEX.test(trimmed)) {
    return { ok: false, reason: 'No phone numbers — keep it anonymous.' }
  }
  if (EMAIL_REGEX.test(trimmed)) {
    return { ok: false, reason: 'No email addresses — keep it anonymous.' }
  }
  if (HANDLE_REGEX.test(trimmed)) {
    return { ok: false, reason: 'No @handles or hashtags — keep it anonymous.' }
  }
  if (URL_REGEX.test(trimmed)) {
    return { ok: false, reason: 'No links allowed.' }
  }
  if (filter.isProfane(trimmed)) {
    return { ok: false, reason: 'Keep it clean — try rewording.' }
  }

  return { ok: true }
}
