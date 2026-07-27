// Generic theme tags — deliberately NOT dating-specific. A "situation" can be
// about a partner, a friend, a coworker, a parent, a roommate, anything.
export const TAGS = [
  { id: 'loyalty', label: 'Loyalty' },
  { id: 'trust', label: 'Trust' },
  { id: 'honesty', label: 'Honesty' },
  { id: 'boundaries', label: 'Boundaries' },
  { id: 'money', label: 'Money' },
  { id: 'family', label: 'Family' },
  { id: 'friendship', label: 'Friendship' },
  { id: 'work', label: 'Work' },
  { id: 'other', label: 'Other' },
]

export const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.id, t.label]))

export function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
