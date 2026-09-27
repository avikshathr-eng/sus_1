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

// The one place this number is defined client-side — the visible counter in
// Spill.jsx and this check must always agree. The submit-post Edge Function
// (supabase/functions/submit-post/index.ts) re-declares the same value
// server-side, since Deno functions can't import from this file — see the
// comment there if this ever changes.
export const MAX_CONFESSION_LENGTH = 300

const PHONE_REGEX = /(\+?\d[\d\s-]{8,}\d)/
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/
const HANDLE_REGEX = /[@#][\w.]{2,}/
const URL_REGEX = /(https?:\/\/|www\.)\S+/i

// Mirrors submit-post/index.ts's LAYER 1 (deterministic hard-reject) checks
// only — same reasoning there: only the small set of fixed name-
// introduction phrasings, never a general capitalized-word check (that
// would false-positive on nearly everything).
const NAME_INTRO_REGEX =
  /\b(my|his|her|their|(?:the|this)\s+person(?:['’]s)?|(?:the|this)\s+guy(?:['’]s)?|(?:the|this)\s+girl(?:['’]s)?)\s+name\s+is\b/i

// Deliberately no client-side check for anything semantic — group hate,
// harassment, threats, identity-in-story, etc. Those are Layer 2's job now
// (a real classifier call in submit-post's Edge Function, see
// ../../supabase/functions/_shared/moderation.ts), which only makes sense
// as a server-side decision at insert time. Blocking them here would either
// require duplicating an API call from the browser (exposing credentials)
// or guessing with a regex the server no longer relies on — and would
// incorrectly tell the user their post failed when it might have actually
// gone through (approved, or held for review).

export function validateSubmission(text) {
  const trimmed = text.trim()

  if (trimmed.length < 5) {
    return { ok: false, reason: 'A little more detail, please.' }
  }
  if (trimmed.length > MAX_CONFESSION_LENGTH) {
    return { ok: false, reason: `Keep it under ${MAX_CONFESSION_LENGTH} characters.` }
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
  if (NAME_INTRO_REGEX.test(trimmed)) {
    return { ok: false, reason: 'No real names — describe the behavior, not who they are.' }
  }
  if (filter.isProfane(trimmed)) {
    return { ok: false, reason: 'Keep it clean — try rewording.' }
  }

  return { ok: true }
}
