// Generic theme tags — deliberately NOT dating-specific. A "situation" can be
// about a partner, a friend, a coworker, a parent, a roommate, anything.
//
// Category → color is a single deterministic mapping cycled across exactly
// four brand colors (lavender/peach/mint/pink). With five categories, one
// color repeats (index 4 % 4 === 0) — that's intentional, not a bug: the
// palette is fixed and colors are never invented or derived.
const PALETTE = ['#9CADFF', '#FECC8F', '#82D7B8', '#F694C3']

export const TAGS = [
  { id: 'relationship', label: 'Relationship' },
  { id: 'friendship', label: 'Friendship' },
  { id: 'career', label: 'Career' },
  { id: 'family', label: 'Family' },
  { id: 'other', label: 'Other' },
].map((t, i) => ({ ...t, color: PALETTE[i % PALETTE.length] }))

export const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.id, t.label]))
export const TAG_COLOR = Object.fromEntries(TAGS.map((t) => [t.id, t.color]))

// Solid category color + black text — used where the category is the single
// active/selected state (the card's own tag, a picked Spill category).
export function tagStyleSolid(categoryId) {
  return { backgroundColor: TAG_COLOR[categoryId] || PALETTE[0], color: '#000000' }
}

// White fill with a category-colored border — used for unselected options
// (e.g. the other pills in Spill's category picker) so we're not inventing
// tinted/alpha variants of the palette.
export function tagStyleOutline(categoryId) {
  return { backgroundColor: '#FFFFFF', color: '#000000', border: `1.5px solid ${TAG_COLOR[categoryId] || PALETTE[0]}` }
}

// The current card's category drives the whole screen's background color.
export function categoryColor(categoryId) {
  return TAG_COLOR[categoryId] || PALETTE[0]
}

// The three other palette colors, for decorative shapes that need to
// contrast against whichever category color is currently the page
// background. Keyed by the resolved background hex (only 4 exist) rather
// than by category id, since "other" shares relationship's lavender.
const SHAPE_CONTRAST = {
  '#9CADFF': ['#FECC8F', '#F694C3', '#82D7B8'], // on lavender: peach, pink, mint
  '#FECC8F': ['#9CADFF', '#F694C3', '#82D7B8'], // on peach: lavender, pink, mint
  '#82D7B8': ['#9CADFF', '#FECC8F', '#F694C3'], // on mint: lavender, peach, pink
  '#F694C3': ['#9CADFF', '#FECC8F', '#82D7B8'], // on pink: lavender, peach, mint
}

export function shapeColorsFor(categoryId) {
  const bg = categoryColor(categoryId)
  return SHAPE_CONTRAST[bg] || SHAPE_CONTRAST[PALETTE[0]]
}

export function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
