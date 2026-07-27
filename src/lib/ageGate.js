const AGE_KEY = 'sus_age_confirmed'
const TOS_KEY = 'sus_tos_accepted_at'
const ONBOARDED_KEY = 'sus_onboarded'

export const hasConfirmedAge = () => localStorage.getItem(AGE_KEY) === 'true'
export const hasAcceptedTos = () => !!localStorage.getItem(TOS_KEY)

// Called together, from one explicit user action (see AgeGate.jsx) — Apple's
// Guideline 1.2 requires an affirmative agreement to terms that prohibit
// objectionable content/abuse before someone can use a UGC app, not just a
// viewable link. Recording a timestamp (even just locally) gives you
// something to point to if a reviewer or a user ever asks when this was agreed to.
export function confirmAgeAndTos() {
  localStorage.setItem(AGE_KEY, 'true')
  localStorage.setItem(TOS_KEY, new Date().toISOString())
}

export const hasOnboarded = () => localStorage.getItem(ONBOARDED_KEY) === 'true'
export const markOnboarded = () => localStorage.setItem(ONBOARDED_KEY, 'true')
