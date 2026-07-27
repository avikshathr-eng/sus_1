# sus. — MVP project brief (v3 — native app path)

## Concept
Anonymous, swipeable situation cards. See a one-sentence real-life situation
(loyalty / trust / honesty / boundaries / money / family / friendship / work),
swipe left for "red flag" or right for "relax," then see the live crowd
percentage. Three tabs: Feed (swipe), Crowd Picks (leaderboard of most-voted
situations), Spill (anonymous submission). NOT dating-exclusive — a situation
can be about a partner, friend, coworker, parent, or roommate.

Primary audience for launch: young women, campus-first (author's own women's
college network), Hyderabad/India. This is peer opinion for fun/validation,
explicitly NOT professional or crisis advice — say so in the UI at all times.

**Goal is a real installed app (not just a mobile website)** so retention can
actually be tested — does someone open it again tomorrow. That's why this
version adds Capacitor (native wrapper) and the compliance work Apple/Google
require for apps with anonymous user-generated content.

## Stack
- Frontend: React + Vite + framer-motion (drag-to-swipe gestures, animated
  stamps, spring transitions), wrapped natively via **Capacitor** for iOS/
  Android. No router — a small `useState` stage machine in `App.jsx` handles
  onboarding → age+terms gate → main app, and tab switching.
- Backend: Supabase (Postgres + REST + RLS + one Edge Function). No custom
  server beyond that.
- Auth: none. Anonymous `device_id` (random UUID) in `localStorage` — used to
  stop double-voting and to enforce the daily swipe limit.
- Content moderation: **server-side now**, via the `submit-post` Edge
  Function (see below) — this is a real change from the previous version and
  matters for app store approval, not just security.

## What's in this scaffold

### Data layer
- `supabase/schema.sql` — `posts`, `votes`, `reports` tables, `post_results`
  view (live %), `crowd_picks` view (leaderboard). **The anon key has no
  insert policy on `posts` anymore** — the only way to create a post is
  through the Edge Function below. Run this first.
- `supabase/functions/submit-post/index.ts` — Edge Function that re-runs the
  moderation check (length, phone/email/handle/link regex, profanity via
  `bad-words`) server-side using the service-role key, then inserts. This is
  what makes moderation an actual enforced gate instead of a client-side
  suggestion that anyone hitting the API directly could skip — which is
  specifically what Apple's Guideline 1.2 requires ("automated or manual
  mechanisms to detect and hold objectionable posts for review"). Deploy
  with `supabase functions deploy submit-post` — `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` are injected automatically, no manual secrets
  needed.
- `supabase/seed.sql` / `seed/cards.json` — 56 starter cards, ≤90 chars,
  generic themes. Expand toward 150+ before real launch.
- `src/lib/moderation.js` — the same checks, run client-side first for
  instant feedback in the UI. Not the enforcement boundary anymore, just a
  fast first pass; the Edge Function is what actually decides.

### App shell & UI
- `src/App.jsx` — Onboarding → AgeGate → main app (Feed / Crowd Picks / Spill
  via `BottomNav`).
- `src/components/SwipeCard.jsx` / `CardStack.jsx` — the swipe gesture, daily
  limit ("today · N left ✨" — 15/day, a deliberate retention hook, keep it),
  and the percentage-reveal toast after each vote.
- `src/components/Onboarding.jsx` + `OnboardingSwipeDemo.jsx` — 3-slide
  carousel. Slides 1 & 3 need illustration PNGs at `public/onboarding-1.png`
  and `public/onboarding-3.png` (drop yours in). Slide 2 is a live swipeable
  demo instead of a static image.
- `src/components/AgeGate.jsx` — **now a real gate, not a suggestion**:
  requires ticking "I'm 18+ and I agree to the Terms & Community Guidelines"
  before the Continue button even enables. This directly satisfies Apple's
  requirement for an affirmative agreement to terms prohibiting objectionable
  content/abuse before someone can use a UGC app — a viewable link was not
  enough on its own.
- `src/lib/legalText.js` + `components/LegalModal.jsx` — plain-language
  disclosure. **Have an actual lawyer review this before real public
  submission** — it's enough to be upfront for beta testing, not a
  substitute for a real EULA.
- `src/components/ReportButton.jsx` — flag icon on every card → `reports`
  table. Check periodically:
  `select post_id, count(*) from reports group by post_id order by count(*) desc;`
  and flip `status='rejected'` on anything that deserves it. Apple and Google
  both expect evidence you actually act on reports, not just collect them —
  do this on a real cadence (e.g. daily) once testers are using it.

### Native wrapper
- `capacitor.config.json` — `appId: com.avikshathr.sus` (placeholder — change
  before real submission if you land on a different brand name), `webDir:
  dist`.
- `package.json` scripts: `npm run cap:sync` (builds the web app, syncs into
  native projects), `npm run cap:android` / `npm run cap:ios` (sync + open in
  Android Studio / Xcode).

## Setup steps (web app first — do this before touching Capacitor)
1. Create a free Supabase project.
2. Run `supabase/schema.sql`, then `supabase/seed.sql`, in the SQL editor.
3. Deploy the Edge Function: install the Supabase CLI, `supabase login`,
   `supabase link` to your project, then `supabase functions deploy submit-post`.
4. Copy `.env.example` to `.env`, fill in your Supabase URL + anon key.
5. Drop your onboarding illustration PNGs into `public/onboarding-1.png` and
   `public/onboarding-3.png`.
6. `npm install && npm run dev` — confirm the full loop works in the browser
   first (swipe, vote, Spill a new card, see it in Crowd Picks) before adding
   the native layer on top.

## Going native — the actual path, in order

**Step 1 — see it as a real app for free, no accounts needed yet.**
Run `npx cap add android` once (generates the `android/` folder), then
`npm run cap:android` — this opens Android Studio, which can run the app on
an emulator or your own phone over USB. No Google account, no fee, no
review. This is your fastest way to just look at the "end product" as an
installed app before spending anything.

For iOS the same idea applies (`npx cap add ios`, `npm run cap:ios` opens
Xcode) but **Xcode only runs on macOS** — there's no way around this on
Windows, and no, an iPad doesn't close the gap. Apple does let you upload a
finished build to TestFlight from an iPad via Swift Playgrounds, but
Playgrounds is built for simple native Swift/SwiftUI projects authored
inside it — it doesn't support compiling a full Xcode project with CocoaPods
dependencies, which is exactly what `npx cap add ios` generates for a
Capacitor app. There's no path from iPad-only to a compiled Capacitor build.

Where the iPad IS genuinely useful: once a build exists (built via Mac or
cloud CI), install TestFlight on it and use it as a real test device, and
manage testers/release notes in App Store Connect from its browser — that's
account admin, not compiling.

For the actual build without owning a Mac: **Codemagic** or Apple's own
**Xcode Cloud** both build Capacitor iOS projects in the cloud and can push
straight to TestFlight. Codemagic's free tier (500 build-minutes/month) is
plenty for occasional builds of a small app — this is the realistic path
here, not buying a Mac. Note: as of April 28, 2026 Apple requires
App Store Connect submissions to be built with Xcode 26+ (Capacitor 8
already supports this, and Codemagic's images already have it — just don't
be thrown if you see it referenced in their docs). Either way, running on
the iOS Simulator during development doesn't require a paid Apple Developer
account.

**Step 2 — real-device testing with actual testers, before spending on the
full store listing.**
This is the step that answers your retention question, and it's much
cheaper/faster than a full public launch:
- **Android**: you can literally send testers a signed `.apk` file to
  sideload — zero cost, zero review, works today once you have a Mac-free
  Android build. Google Play's internal testing track (needs the $25 one-
  time Play Console fee) is the slightly more polished version of this, still
  with no real review.
- **iOS**: Apple doesn't allow free sideloading to testers the way Android
  does. Getting a build onto real testers' phones requires the $99/year
  Apple Developer Program either way, then distributing via **TestFlight**
  (up to 100 internal testers with zero review; more testers via "external"
  testing needs a lighter Beta App Review, not the full App Store review).

**Step 3 — full public App Store / Play Store listing.**
Only do this once you like what beta testing shows. This is where Guideline
1.2 (UGC) and the Google Play UGC policy are actually checked in full —
which is why the ToS gate and server-side moderation above are already built
ahead of this step, not scrambled together at submission time. Also budget
for: app icon + screenshots (design work, not started here), an accurate age
rating in both consoles (likely 17+/Mature given the relationship/money/
family themes — this is a metadata questionnaire, not extra dev work), and
Apple's review turnaround (typically 1–3 days, can bounce back with change
requests).

**Cost summary**: $99/year (Apple) + $25 one-time (Google) = $124 total to
have both, well inside a $200 budget. You do NOT need to pay either fee just
to preview the app locally (Step 1) — only once you want it on other
people's devices via TestFlight/Play testing tracks or the public stores.

## MVP scope — build/verify next, in order
1. Verify the full web loop end to end against your real Supabase project.
2. Confirm the Edge Function actually rejects bad submissions (try
   submitting a phone number or a slur through the real Spill tab and
   confirm it's blocked server-side, not just client-side).
3. `npx cap add android`, get it running on an emulator or your own phone.
4. Decide on Mac access for iOS (buy time on a friend's Mac, or set up a
   Codemagic/GitHub Actions cloud build) before committing to the $99 fee.
5. Once both look right, get 10-20 friends onto TestFlight/Play internal
   testing and watch actual return behavior for a week or two before
   deciding whether to pay for full public listings.

## Explicitly OUT of scope for now
- User accounts / login
- Comments or reply threads
- Push notifications (worth adding before real retention testing, actually —
  ask if you want this built next, it's what turns "check back on your own"
  into an actual daily-return nudge)
- Matching or DMs
- Any payment/monetization flow
- Automated scraping pipelines
- App icon / screenshot design assets

## Design notes carried over from planning
- `category` on every post is a generic theme tag, not a dating category —
  it's what makes this useful beyond a dating-confessions app and what
  powers later "68% of women in Hyderabad think X" stats for growth content.
- Don't build monetization yet. If this gets traction, fastest paths are (a)
  a lightweight cost/gate on submitting, or (b) native ads. Anonymized
  aggregate data as a monetization line is a "maybe someday."
