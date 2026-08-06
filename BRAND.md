# sus. — brand reference

Source of truth for anything visual: `src/styles.css` (`:root` custom
properties) and `src/lib/tags.js` / `src/lib/voteColors.js`. This file just
documents what's already there in one place — if code and doc ever disagree,
the code wins; update this file to match.

## Logo / wordmark

`public/logo.png` — "sus." in Fraunces 700, ink-black "sus" + a red period,
on white, 1613×975px, no transparency (flat white background baked in).

The **only** correct way to render the wordmark in-product is the
`SusWordmark` component (`src/components/SusWordmark.jsx`), not a raw PNG or
hand-typed markup:

```jsx
<SusWordmark />                                  // static — onboarding, age gate
<SusWordmark className="sus-wordmark-feed" dragX={dragX} />  // feed header, drag-reactive
```

Rules, enforced by the component/CSS, not just convention:
- Real `.` character — never a circle or icon glyph.
- Only the period is colored (`--brand-period`); "sus" itself always takes
  the surrounding ink color, never the accent.
- Sits on the normal text baseline, same size/weight as "sus" (`font:
  inherit` — see `.sus-wordmark-dot` in styles.css).
- Near-zero gap between "sus" and the period (`margin-left: 0.015em`).

`.logo .dot` (used only by `BlockedUnder18.jsx`) is a deliberately separate,
older lavender-dot treatment — not the current brand mark, kept as-is for
that one screen rather than migrated.

## Color

All colors are CSS custom properties in `src/styles.css`'s `:root`. Never
hardcode a hex that already has a token — reference the variable (or, in a
framer-motion color-interpolation context that can't take a `var()`, the
matching literal from `src/lib/voteColors.js`, kept in sync by hand).

### Core palette
| Token | Value | Use |
|---|---|---|
| `--paper-top` / `--paper-bottom` | `#F8F6F1` | App background outside the swipe feed — flat warm off-white, no gradient |
| `--ink` | `#221e1a` | Primary text |
| `--ink-soft` | `#8a8175` | Secondary/muted text |
| `--surface` | `#ffffff` | Cards, sheets |
| `--accent` | `#b98a52` | Warm accent (sparingly) |

### Vote colors — `VOTE_COLORS` (`src/lib/voteColors.js`)
| Token | Value | Use |
|---|---|---|
| `--flag` / `VOTE_COLORS.redFlag` | `#D3453B` | Red Flag: drag-reveal background, full-screen result, vote button, Crowd Picks bar segment + chip |
| `--relax` / `VOTE_COLORS.relax` | `#449F66` | Relax: same set of surfaces, green side |
| `--vote-result-text` / `VOTE_COLORS.resultText` | `#FFF8F0` | Warm-white text on the full-screen vote result (over `--flag`/`--relax`) |
| `--brand-period` | `#D3453B` | The wordmark's period — currently equals `--flag` but is its own token on purpose (see the comment above it in styles.css) |

These are saturated, high-contrast reds/greens — a deliberate step away from
the app's earlier pastel palette, specifically for the full-screen vote
takeover to read clearly at a glance.

### Category palette — `PALETTE` (`src/lib/tags.js`)
Cycled deterministically across the 5 categories (relationship, friendship,
career, family, other) — 4 colors for 5 tags is intentional, one repeats:
```
#9CADFF  lavender   (relationship, and other — reused)
#FECC8F  peach      (friendship)
#82D7B8  mint       (career)
#F694C3  pink       (family)
```
Used for the card's category tag pill and the feed's resting background
color (`SwipeBackground.jsx`). Never invented per-category — always pulled
from this fixed 4-color set.

### Neutral tints
Soft/tinted variants (chips, status pills) derive from the above at low
alpha rather than introducing new hues — e.g. the Crowd Picks "You chose Red
Flag" chip is `rgba(211,69,59,0.12)` background with `#A92F28` text (a
darkened, readable version of `--flag`, not a new color).

## Typography

Two families, loaded in `index.html` via Google Fonts:

```html
Fraunces:ital,wght@0,500;0,600;0,700;1,600
Inter:wght@400;500;600;700
```

| Token | Stack | Use |
|---|---|---|
| `--font-display` | `'Fraunces', Georgia, serif` | The wordmark, confession card text, feed title — the app's editorial/expressive voice |
| `--font-sans` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | Everything UI: buttons, labels, the full-screen vote result's percentage/label/sub-text, body copy |

Fraunces is used at weight 500–700 (upright) or 600 (italic) depending on
context; Inter mostly at 600–800 for anything that needs to read as a
number or a shout (e.g. the vote-result percentage is Inter at
`font-weight: 800`). Never substitute a generic system serif for Fraunces or
a generic system sans for Inter — both are deliberate, specific choices
(see the full-screen result's own history: it originally shipped in
Fraunces and was corrected to Inter specifically because results shouldn't
read as "literary," they should read as a clear, fast number).

## Shape language

- **Cards**: 42px border-radius, soft warm shadow (`rgba(40,30,15,…)` —
  never pure black) — e.g. `.swipe-card`.
- **Pills/buttons/bars**: fully rounded, `border-radius: 100px` (or
  `999px` — used interchangeably, same visual result at these sizes).
- **Modals/menus**: 14–26px radius, smaller/tighter than cards.
- Shadows are always warm-toned (brown/black rgba, never a cool gray) —
  matches the paper/ink palette rather than a generic neutral shadow.

## Voice

From `CLAUDE.md`: peer opinion for fun/validation, explicitly not
professional or crisis advice — this shows up directly in copy ("The crowd
has spoken—softest to spiciest. Still anonymous. 💜", "It's peer opinion for
fun, not professional advice"). Warm, a little playful, never clinical.
