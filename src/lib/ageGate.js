import { TERMS_VERSION } from './legalText'

const AGE_KEY = 'sus_age_confirmed'
const TOS_KEY = 'sus_tos_accepted_at'
const TOS_VERSION_KEY = 'sus_tos_accepted_version'
const ONBOARDED_KEY = 'sus_onboarded'

export const hasConfirmedAge = () => localStorage.getItem(AGE_KEY) === 'true'
// Gated on the accepted version matching the CURRENT Community rules/Terms
// version, not just "accepted at some point" — if TERMS_VERSION is ever
// bumped (a real policy change, not a typo fix), every existing user is
// re-sent through AgeGate for a fresh affirmative agreement instead of being
// silently grandfathered into rules they never actually saw.
export const hasAcceptedTos = () =>
  !!localStorage.getItem(TOS_KEY) && localStorage.getItem(TOS_VERSION_KEY) === TERMS_VERSION

// Called together, from one explicit user action (see AgeGate.jsx) — Apple's
// Guideline 1.2 requires an affirmative agreement to terms that prohibit
// objectionable content/abuse before someone can use a UGC app, not just a
// viewable link. Recording the version + timestamp (even just locally) gives
// you something to point to if a reviewer or a user ever asks exactly what
// they agreed to and when.
export function confirmAgeAndTos() {
  localStorage.setItem(AGE_KEY, 'true')
  localStorage.setItem(TOS_KEY, new Date().toISOString())
  localStorage.setItem(TOS_VERSION_KEY, TERMS_VERSION)
}

export const hasOnboarded = () => localStorage.getItem(ONBOARDED_KEY) === 'true'
export const markOnboarded = () => localStorage.setItem(ONBOARDED_KEY, 'true')
