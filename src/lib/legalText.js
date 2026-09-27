// Plain-language placeholder copy. Have an actual lawyer look at this before
// any real public launch — this is enough to be upfront with users for an
// MVP tested with friends/college network, not a substitute for real ToS.
//
// Sections here are the plain-text ones rendered directly by LegalModal's
// accordion. "Your data" and "Legal and contact" are interactive (buttons,
// links) and built inline in LegalModal.jsx instead of as static copy.
export const INFO_TITLE = 'About sus.'

// Bump this whenever the substance of the Community rules changes (not for
// typo fixes) — AgeGate/ageGate.js gates continued use on having accepted
// THIS exact version, so a real policy change re-prompts every existing
// user for a fresh affirmative agreement instead of silently grandfathering
// them into rules they never saw.
export const TERMS_VERSION = '2026-09-26'

export const INFO_INTRO =
  "sus. is peer opinion for fun and validation, from people who'll never know who you are. " +
  "It is NOT professional advice — not legal, medical, financial, or psychological — and " +
  "nothing here should be the basis for a serious or safety-related decision."

export const INFO_SECTIONS = [
  {
    id: 'how-it-works',
    heading: 'How it works',
    defaultOpen: true,
    paragraphs: [
      "You'll see a short, anonymous situation — about a partner, friend, coworker, " +
        "parent, or roommate. Swipe left if it feels like a red flag, right if you'd relax " +
        "about it, then see what percentage of the crowd agreed with you.",
      'Crowd Picks shows the most-voted situations. Spill lets you share your own — no ' +
        'names, no login, one sentence.',
      'You must be 18 or older to use sus., and you agree to the Community rules below ' +
        'before you can get past the welcome screen.',
    ],
  },
  {
    id: 'privacy',
    heading: 'Privacy and anonymity',
    defaultOpen: false,
    paragraphs: [
      "sus. doesn't have accounts, so there's no name, email, or phone number tied to " +
        "your activity. Instead, your device gets a random id (like a serial number) stored " +
        "only in this browser — it's used to stop double-voting, enforce the daily swipe " +
        'limit, and (if you submit something) let you delete that specific submission later.',
      "That device id is never shown to other users and never attached to anything you " +
        "post or vote on that's visible to anyone else.",
    ],
  },
  {
    id: 'safety',
    heading: 'Safety first',
    defaultOpen: false,
    paragraphs: [
      'If this involves abuse, stalking, threats, or immediate danger, do not rely on ' +
        'sus. Contact someone you trust or local emergency services.',
    ],
  },
  {
    id: 'community-rules',
    heading: 'Community rules',
    defaultOpen: false,
    paragraphs: [
      'sus. has zero tolerance for objectionable content or abusive behavior. Posting any ' +
        'of the following is not allowed, ever:',
      '• Harassment, bullying, or targeting a specific individual',
      '• Threats of violence or harm',
      '• Hate speech or content that attacks people based on identity (race, religion, ' +
        'gender, sexual orientation, nationality, disability, etc.)',
      '• Sexually explicit content',
      '• Illegal content or activity',
      '• Doxxing — real names, phone numbers, addresses, social handles, links, or any ' +
        'other information that could identify a real person',
      '• Impersonation of another person',
      '• Spam or scam content',
      'We enforce this with automated screening on every submission plus human review of ' +
        'anything reported. Violating these rules can get a submission removed and — for ' +
        'repeat or serious issues — get your device permanently blocked from submitting, ' +
        'voting, or using sus. at all. We act on reports of objectionable content or abusive ' +
        'users within 24 hours.',
    ],
  },
  {
    id: 'reports-removal',
    heading: 'Reports and removal',
    defaultOpen: false,
    paragraphs: [
      'New submissions are automatically screened before they go live — for things like ' +
        'contact info, links, and profanity — using an automated check that runs on our ' +
        'server, not just in the app. That catches obvious problems but not everything.',
      'Anyone can also report a card they see (tap the flag icon), with a reason. Reports ' +
        "are reviewed by the person running sus., and posts that break the rules are taken " +
        'down. Reporting something is not a guarantee it will be removed.',
      'You can delete your own submissions yourself at any time — see "Your data" below.',
    ],
  },
]
