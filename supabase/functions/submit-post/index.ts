// Supabase Edge Function: submit-post
//
// Why this exists: the original approach ran the content filter in the
// browser (src/lib/moderation.js) and let the anon key insert straight into
// `posts`. That's bypassable by anyone calling the REST API directly, which
// is fine for a handful of friends but not for Apple/Google's "hold
// objectionable content for review" requirement (App Store Guideline 1.2 /
// Google Play UGC policy) once this is a real submitted app. This function
// re-runs the same checks server-side, using the service-role key, and is
// the ONLY way to create a post — the anon key's insert policy on `posts`
// is intentionally removed in schema.sql so this can't be skipped. Someone
// calling this Edge Function directly gets exactly the same moderation as
// someone using the app — there is no separate, weaker path.
//
// Deploy: `supabase functions deploy submit-post`
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically —
// no manual secret setup needed. This function has NO external
// dependencies and needs no additional secrets — see the v1 moderation
// policy note below.)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Filter } from 'npm:bad-words@4.0.0'

const ALLOWED_CATEGORIES = [
  'relationship', 'friendship', 'career', 'family', 'other',
]

// Must match src/lib/moderation.js's MAX_CONFESSION_LENGTH — Deno functions
// can't import from the frontend, so this is the one place it's duplicated
// rather than centralized.
const MAX_CONFESSION_LENGTH = 300

const filter = new Filter()

// ============ v2 moderation policy: positive safe-content gate, entirely self-hosted, zero external API cost ============
// This is the SECOND major architecture revision. The first (v1) was a
// straightforward "reject the bad, pend the ambiguous, approve everything
// else" pipeline — i.e. APPROVE was the default outcome whenever nothing
// matched. That shape is what let "I hate all the men in this world. I
// will kill all of them." reach APPROVED: the pipeline only auto-publishes
// what it recognizes as unsafe, so anything it doesn't recognize — a
// pattern gap, an unsupported language, obfuscated text — silently
// defaults to safe.
//
// v2 inverts the default. APPROVE is no longer "nothing matched" — it now
// requires POSITIVE evidence the system actually understood the text:
//   1. Hard-reject checks (layer1Reject) — unchanged from v1, still the
//      first and highest-priority tier: contact info, name-disclosure,
//      violent intent, group hate/dehumanization, spam.
//   2. Pending risk signals (layer2PendingSignal) — unchanged in kind from
//      v1 (targeted hostility, ambiguous group hostility, self-harm
//      distress, possible illegal activity/stalking/extremism,
//      objectification, ambiguous sexual/spam content), PLUS a new first
//      check: language confidence. If the pipeline cannot confidently
//      recognize the text as ordinary supported-language English, that
//      alone is enough to pend it — nothing downstream gets a chance to
//      wrongly call it safe just because no bad pattern happened to match.
// A post only auto-publishes if it clears BOTH tiers. This is the literal
// implementation of "unknown must no longer mean safe": the system no
// longer needs to correctly classify a phrase as unsafe to keep it from
// auto-publishing — it only needs to fail to recognize it as safe.
// See moderate() below for exactly how these combine, including the
// fail-safe (unexpected errors resolve to 'pending', never 'approve').

// ---- Normalization ----
// One normalization pass, deliberately CASE-PRESERVING (not lowercased).
// Case is itself a signal several of the checks below rely on — a
// capitalized word following "my coworker" is what makes it plausibly a
// name, and lowercasing away that signal would silently disable that
// detector. Every check below is either explicitly case-insensitive (the
// 'i' regex flag, or comparing against a lowercased copy of a captured
// substring) or explicitly case-sensitive where capitalization is the
// point — never accidentally one or the other.
const HOMOGLYPH_MAP: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i',
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'Х': 'X', 'У': 'Y', 'І': 'I',
}
const HOMOGLYPH_REGEX = new RegExp('[' + Object.keys(HOMOGLYPH_MAP).join('') + ']', 'g')
// A small, narrowly-scoped Cyrillic-lookalike map — "kіll hіm" (with
// Cyrillic і, U+0456) reads identically to "kill him" but wouldn't match
// any pattern below without this. Deliberately limited to characters with
// no legitimate use in ordinary English SUS text, so it can't corrupt
// real language the way a broader homoglyph table might.
function normalizeHomoglyphs(s: string): string {
  return s.replace(HOMOGLYPH_REGEX, (ch) => HOMOGLYPH_MAP[ch] ?? ch)
}

function collapseLetterSpacing(s: string): string {
  // "k.i.l.l" / "k-i-l-l" / "k----i----l----l" -> "kill". Punctuation
  // separators ONLY — plain space is deliberately excluded (see the
  // note below on collapseRepeatedPunctuationGlue for why). The
  // separator class now tolerates REPEATED punctuation between letters,
  // not just a single character — "k----i----l----l" previously survived
  // uncollapsed because `[.\-_*]` only matched exactly one separator char
  // per letter. Still requires 4+ single letters in a row (3 reps of
  // letter+separator, then a final letter) so common 2-3 letter
  // abbreviations ("u.s.a", "a.m.") don't collapse.
  return s.replace(/\b(?:[a-zA-Z][.\-_*]+){3,}[a-zA-Z]\b/g, (m) => m.replace(/[.\-_*]/g, ''))
}

// "kill.....him" (repeated punctuation gluing two whole words together
// with no whitespace at all) doesn't match collapseLetterSpacing above —
// that function is for a single letter-spaced WORD, not two already-
// formed words jammed together — and every phrase-level check below
// requires `\s+` between a verb and its target, so this evasion
// previously bypassed everything. Only fires on 2+ repeated punctuation
// marks directly between two letters (never a single "." as in normal
// sentence punctuation, and never when a space is already present), so
// ordinary "Wait... he left." is untouched.
function collapseRepeatedPunctuationGlue(s: string): string {
  return s.replace(/([a-zA-Z])[.\-_*]{2,}([a-zA-Z])/g, '$1 $2')
}

function normalizeForModeration(text: string): string {
  let s = (text || '')
  s = s.replace(/[​‌‍﻿]/g, '') // zero-width chars stripped first
  s = s.normalize('NFKC')
  s = normalizeHomoglyphs(s)
  s = s.replace(/[‘’‛`´]/g, "'")
  s = s.replace(/[“”„]/g, '"')
  s = s.replace(/\s+/g, ' ').trim()
  s = collapseLetterSpacing(s)
  s = collapseRepeatedPunctuationGlue(s)
  return s
}

const LEET_MAP: Record<string, string> = { '@': 'a', '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's', '!': 'i' }
// Only de-leets tokens that mix real letters WITH leet chars ("h4te" ->
// "hate") — a pure-digit token ("555", "3") is left untouched, which is
// what keeps this from mangling phone numbers or ordinary numerals. Runs
// on a SEPARATE copy of the text used only for keyword/phrase matching —
// never on the copy used for contact-info detection, since de-leeting "@"
// to "a" would destroy the literal "@" an email address needs. Note:
// SPAM_REJECT_REGEX below is deliberately tested against the un-deleeted
// `normalized` text, not this one, because a dollar amount like
// "$500/day" also mixes letters (from "day") with leet-class chars
// ('$'/'5'/'0') and would otherwise be mangled into "ssoo/day".
function deleetForKeywords(s: string): string {
  return s.split(' ').map((token) => {
    if (!/[a-zA-Z]/.test(token)) return token
    if (!/[@013457$!]/.test(token)) return token
    return token.replace(/[@013457$!]/g, (ch) => LEET_MAP[ch] ?? ch)
  }).join(' ')
}

function isLikelyProperNoun(word: string): boolean {
  return /^[A-Z][a-z]+$/.test(word)
}
function isLikelyCapitalizedPlural(word: string): boolean {
  return /^[A-Z][a-z]+s$/.test(word)
}

// A narrow language-coverage gate: what fraction of the text's letters are
// Latin-script. Every pattern in this file is an English word/phrase — a
// post that's mostly non-Latin script (Devanagari, Telugu, Arabic, ...)
// cannot be meaningfully evaluated by any of them. Kept as one input among
// several into the broader language-confidence gate below (looksLikeConfidentEnglish) —
// non-Latin script is the clearest case, but not the only one.
function looksUnsupportedLanguage(trimmed: string): boolean {
  const allLetters = (trimmed.match(/\p{L}/gu) || []).length
  if (allLetters < 8) return false // too short to judge reliably either way
  const latinLetters = (trimmed.match(/[a-zA-ZÀ-ɏ]/g) || []).length
  return latinLetters / allLetters < 0.6
}

// Generic backstop for gibberish/encoded/symbol-heavy text this system has
// no other pattern for — an unusually long "word" or an unusually high
// ratio of non-basic-punctuation characters both indicate content none of
// the checks below were written to evaluate.
function looksStructurallyUnusual(trimmed: string): boolean {
  const words = trimmed.split(/\s+/)
  if (words.some((w) => w.replace(/[^a-zA-Z0-9]/g, '').length > 40)) return true
  const basicPunctStripped = trimmed.replace(/[a-zA-Z0-9\s.,!?'"()\-:;]/g, '')
  if (trimmed.length > 0 && basicPunctStripped.length / trimmed.length > 0.3) return true
  return false
}

// "kill" also matches "k.i.l.l" / "k-i-l-l" / "k i l l" — narrowly scoped
// to a short high-risk verb list (not the whole text), so it can safely
// tolerate a literal space separator without the whole-sentence-merging
// problem a general space-inclusive collapse caused (see
// collapseLetterSpacing above).
function spacedWordPattern(word: string): string {
  return '\\b' + word.split('').join('[\\s.\\-_*]?') + '\\b'
}

// ---- NEW in v2: positive language-confidence gate ----
// This is the core of the "unknown must no longer mean safe" principle
// applied specifically to language coverage. Two independent signals,
// either of which is enough to call a post "not confidently supported
// English":
//
// 1. NON_ENGLISH_MARKER_REGEX — small, closed, maintainable lists of very
//    common function/particle words for the languages this spec explicitly
//    requires coverage for: Hindi (romanized), Spanish, French, German.
//    This directly targets CODE-SWITCHED text ("he mujhe ignore karta hai
//    and I hate it") that a pure ratio-based check would miss, since a
//    code-switched sentence can contain plenty of genuine English function
//    words too — one non-English marker anywhere is enough to pend the
//    whole post. Deliberately excludes short, high-collision tokens that
//    coincide with common English words (Hindi "the"/"wo", Spanish/French
//    "no"/"me", German "die"/"bin") — a collision there would incorrectly
//    pend ordinary English, which the spec explicitly accepts as a safe
//    tradeoff ("false positives to PENDING are acceptable"); the opposite
//    mistake (a common English word missing from a foreign marker list)
//    is not something a marker list can protect against anyway, so the
//    exclusions cost nothing.
// 2. ENGLISH_FUNCTION_WORD ratio — for text with no foreign marker hit,
//    requires a minimum density of recognized English words scaled to
//    sentence length, calibrated so idiomatic short English ("I hate
//    Monday mornings") passes while the required Spanish/French/German
//    test sentences fail.
//
// This is intentionally NOT a general-purpose language identifier or an
// attempt to semantically moderate Hindi/Spanish/French/German content —
// the spec explicitly forbids that. It only answers one narrow question:
// can this specific pipeline confidently evaluate this text at all? If
// not, PENDING — never a silent APPROVE riding a blind spot.
const HINDI_MARKERS = [
  'hai', 'hain', 'nahi', 'nahin', 'karta', 'karti', 'karte', 'kar', 'karo', 'kiya', 'kiye',
  'raha', 'rahi', 'rahe', 'gaya', 'gayi', 'gaye', 'diya', 'diye', 'liya', 'liye',
  'mujhe', 'humein', 'hamein', 'uska', 'uski', 'uske', 'usse', 'usne', 'unka', 'unki', 'unke',
  'mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'hamara', 'hamari', 'hamare',
  'yeh', 'woh', 'kya', 'kyun', 'kyu', 'kaise', 'kab', 'kaun', 'kitna', 'kitne', 'itna', 'itne',
  'bhi', 'abhi', 'phir', 'lekin', 'magar', 'sirf', 'bas', 'accha', 'achha', 'bura',
  'gaali', 'pareshan', 'bahut', 'dost', 'shaadi', 'ghar', 'paisa', 'paise', 'wapas', 'aur',
  'jhagda', 'pyaar', 'pyar', 'thoda', 'thodi', 'jaata', 'jaati', 'jaate', 'aata', 'aati', 'aate',
  'hota', 'hoti', 'hote', 'tha', 'thi', 'wala', 'wali',
  // 'the' was deliberately excluded even though Hindi "the" (past
  // auxiliary "were") is common — it collides with English's single most
  // common word and would have made the language gate reject nearly all
  // ordinary English text. 'wo' was also dropped (too short, ambiguous)
  // in favor of the fuller 'woh' spelling, the far more common romanization.
]
const SPANISH_MARKERS = ['mi', 'tu', 'su', 'los', 'las', 'que', 'por', 'para', 'pero', 'muy', 'este', 'esta', 'esa', 'ese', 'novio', 'novia', 'siempre', 'nunca', 'respeta', 'escucha', 'quiere', 'hola']
const FRENCH_MARKERS = ['le', 'les', 'des', 'une', 'est', 'avec', 'toujours', 'jamais', 'copain', 'copine', 'ment', 'mon', 'ma', 'ses', 'tres', 'très', 'bonjour', 'méchant', 'mechant']
// 'die' (German "the") and 'bin'/'ich' ("am"/"I") are deliberately
// excluded — 'die' collides with English "die" (a word this file's own
// threat patterns match on), and 'bin' collides with English "bin" (trash
// bin). Neither is needed for the required German test coverage.
const GERMAN_MARKERS = ['der', 'das', 'und', 'ist', 'nicht', 'aber', 'immer', 'nie', 'freund', 'freundin', 'ignoriert', 'mich', 'meiner', 'wegen', 'traurig', 'beziehung']
const NON_ENGLISH_MARKER_REGEX = new RegExp(
  '\\b(?:' + [...HINDI_MARKERS, ...SPANISH_MARKERS, ...FRENCH_MARKERS, ...GERMAN_MARKERS].join('|') + ')\\b',
  'i'
)

const ENGLISH_FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'them', 'us',
  'my', 'your', 'his', 'their', 'our', 'its', 'mine', 'yours', 'ours', 'theirs',
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'do', 'does', 'did', "doesn't", "didn't", "don't",
  'have', 'has', 'had', "hasn't", "haven't", "hadn't",
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'not', 'no', 'never', 'always', 'still', 'again', 'just', 'really', 'very',
  'and', 'but', 'or', 'so', 'because', 'if', 'when', 'while', 'than', 'then',
  'to', 'of', 'in', 'on', 'at', 'with', 'for', 'from', 'about', 'against', 'into', 'over', 'after', 'before',
  'this', 'that', 'these', 'those', 'what', 'who', 'whom', 'which', 'why', 'how',
  'all', 'some', 'any', 'every', 'each', 'more', 'most', 'other', 'such',
  'keeps', 'keep', 'kept', 'said', 'says', 'get', 'gets', 'got', 'went', 'go', 'going', 'goes',
  'out', 'up', 'down', 'back', 'away', 'now', 'today', 'yesterday', 'tomorrow',
  "i'm", "i've", "i'll", "i'd", "it's", "that's", "he's", "she's", "they're", "we're", "you're",
  "won't", "can't", "isn't", "wasn't", "aren't", "weren't", "wouldn't", "couldn't", "shouldn't",
  // A small set of very common English CONTENT words (not grammatical
  // function words) added deliberately: short, everyday SUS-style
  // sentences ("I hate Monday mornings", "My friend loves Walmart brand
  // snacks") often carry only one true function word, which under-scores
  // them on a pure function-word ratio. These specific words are safe
  // additions — none are common loanwords/cognates in Hindi, Spanish,
  // French, or German, so they don't reopen the cross-language collision
  // risk the rest of this list is designed to avoid.
  'someone', 'somebody', 'something', 'anyone', 'anybody', 'anything',
  'everyone', 'everybody', 'everything', 'nobody', 'nothing', 'else', 'together', 'anymore',
  'honestly', 'actually', 'friend', 'friends', 'boyfriend', 'girlfriend', 'husband', 'wife',
  'family', 'today', 'tonight', 'hate', 'hates', 'hated', 'love', 'loves', 'loved', 'like', 'likes', 'liked',
])
function extractAlphaWords(normalized: string): string[] {
  return normalized.toLowerCase().split(/\s+/)
    .map((w) => w.replace(/^[^a-z']+|[^a-z']+$/g, ''))
    .filter((w) => /^[a-z']+$/.test(w) && w.length > 0)
}
// Short sentences (<=5 words) need at least 1 match at >=30% density;
// longer sentences need at least 2 matches at >=20% density — calibrated
// against the full adversarial test suite so idiomatic short English
// passes while every required Hinglish/Spanish/French/German test fails.
function looksLikeConfidentEnglish(normalized: string): boolean {
  if (NON_ENGLISH_MARKER_REGEX.test(normalized)) return false
  const words = extractAlphaWords(normalized)
  if (words.length === 0) return false
  const matched = words.filter((w) => ENGLISH_FUNCTION_WORDS.has(w)).length
  const ratio = matched / words.length
  if (words.length <= 5) return matched >= 1 && ratio >= 0.3
  return matched >= 2 && ratio >= 0.2
}

// ---- Shared vocabulary ----
// The relationship/person-role word list — used by BOTH Layer 1 (explicit
// possessive name disclosure, e.g. "my roommate's name is Karan") and
// Layer 2 (possible identity via "my roommate Karan ...") below. Defined
// once here rather than duplicated so the two checks can never drift apart.
const PERSON_CONTEXT_WORDS = [
  'boyfriend', 'girlfriend', 'partner', 'husband', 'wife', 'spouse', 'ex', 'date', 'dating',
  'friend', 'roommate', 'coworker', 'colleague', 'boss', 'manager', 'neighbor',
  'brother', 'sister', 'cousin', 'mother', 'father', 'mom', 'dad', 'parent', 'son', 'daughter',
  'guy', 'girl', 'man', 'woman', 'person', 'with',
].join('|')

// A reasonable curated group-term set, not an attempt to enumerate every
// ethnicity/nationality/religion.
const GROUP_TERMS =
  'men|women|boys|girls|guys|indians?|americans?|pakistanis?|chinese|japanese|muslims?|hindus?|christians?|' +
  'jews?|sikhs?|buddhists?|blacks?|whites?|asians?|mexicans?|arabs?|africans?|europeans?|gays?|lesbians?|trans(?:genders?)?'
// Tolerates a determiner/intensifier between the hostility verb and the
// group noun ("hate ALL THE men", "hate EVERY woman").
const GROUP_INTENSIFIER = '(?:all\\s+(?:the\\s+)?|every\\s+|those\\s+)?'
// GROUP_TERMS only carries plural forms, so "I hate every woman" (singular,
// but explicitly quantified) needs a separate list gated on every/any
// rather than merged into GROUP_TERMS bare, since unquantified singular
// ("I hate that man") is an individual insult, not group hate.
const SINGULAR_GROUP_TERMS = 'man|woman|guy|girl'

const PERSON_STOPLIST = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'instagram', 'facebook', 'snapchat', 'tiktok', 'whatsapp', 'twitter', 'walmart', 'christmas', 'diwali', 'halloween', 'thanksgiving',
  'india', 'america', 'york', 'new', 'someone', 'somebody', 'everyone', 'anybody', 'anyone',
])
const CATCHALL_GROUP_STOPLIST = new Set(['mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays', 'weekdays', 'weekends', 'holidays', 'birthdays', 'anniversaries'])
// Harmless plural "hate objects" excluded from the unknown-group-hate
// check below (Section 6 of this pass) — things people commonly say they
// hate that are not people-groups.
const SAFE_HATE_OBJECTS = new Set([
  'mornings', 'evenings', 'nights', 'weekends', 'holidays', 'birthdays', 'anniversaries',
  'apps', 'ads', 'commercials', 'notifications', 'emails', 'meetings', 'deadlines', 'exams', 'assignments',
  'chores', 'dishes', 'traffic', 'commutes', 'potholes', 'spoilers', 'mosquitoes', 'insects', 'bugs',
  'onions', 'vegetables', 'olives', 'mushrooms', 'crowds', 'lines', 'queues', 'delays', 'rules', 'taxes',
  'forms', 'workouts',
])
// Common short words that happen to end in "s" but are grammatically
// determiners/pronouns/auxiliaries, not plural nouns — without this, "I
// hate this situation" reads "this" as a captured pseudo-plural and
// incorrectly flags 'possible_group_hostility'.
const PSEUDO_PLURAL_STOPWORDS = new Set(['this', 'has', 'was', 'is', 'his', 'yes', 'plus', 'status', 'bus', 'gas', 'glass', 'stress', 'process', 'address', 'business', 'across', 'always', 'towards'])

// ---- Layer 1: deterministic hard rejects ----
// Reserved for patterns with essentially zero legitimate alternate
// reading — every check here is a REJECT, never a pending.

// A. Contact / private information. Common formatting variants (dots,
// spelled-out "at"/"dot") are handled without a heavier NLP dependency.
const PHONE_REGEX = /(\+?\d[\d\s.\-]{8,}\d)/
// PHONE_REGEX above requires 10+ total digit/separator characters, so a
// bare 9-digit (or 7- or 8-digit) number falls through entirely — "Please
// torture him at 555786789" reached APPROVE partly because of this. Real
// phone numbers vary in length by country and formatting; rather than
// loosening PHONE_REGEX itself (which would start flagging plain long
// numbers — order numbers, step counts, dollar amounts — with no context
// at all), this instead requires an explicit contact-solicitation PHRASE
// immediately before a 7+ digit sequence of any length. Context is what
// distinguishes "call me at 5557867" (contact info) from "I walked 10000
// steps" (not), not digit count alone.
const CONTACT_NUMBER_REGEX = new RegExp(
  `\\b(?:call|text|dm|message|contact|reach)\\s+(?:me|him|her|them)\\s+at\\s*[:\\-]?\\s*\\+?\\d[\\d\\s.\\-]{5,}\\d\\b|` +
  `\\b(?:her|his|their|my)\\s+(?:phone\\s+)?number\\s+(?:is|:)?\\s*\\+?\\d[\\d\\s.\\-]{5,}\\d\\b|` +
  `\\bphone\\s+number\\s*(?:is|:)?\\s*\\+?\\d[\\d\\s.\\-]{5,}\\d\\b`,
  'i'
)
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/
const OBFUSCATED_EMAIL_REGEX = /\b[\w.+-]+\s*(?:\[at\]|\(at\)|\bat\b)\s*[\w-]+\s*(?:\[dot\]|\(dot\)|\bdot\b)\s*[a-zA-Z]{2,}\b/i
const HANDLE_REGEX = /[@#][\w.]{2,}/
const URL_REGEX = /(https?:\/\/|www\.)\S+/i
const BARE_DOMAIN_REGEX = /\b[a-zA-Z0-9-]{2,63}\.(?:com|net|org|io|co|me|info|biz|xyz|app|gov|edu)\b/i
const STREET_ADDRESS_REGEX = /\b\d{1,5}\s+[a-zA-Z][a-zA-Z\s]{2,25}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)\b/i
const LICENSE_PLATE_REGEX = /\b(?:license plate|plate number)\s*(?:is|:)?\s*[a-zA-Z0-9]{4,8}\b/i
// Explicit direct-contact solicitation ("DM me for details") without
// necessarily an attached handle/number — those are already caught by
// HANDLE_REGEX/EMAIL_REGEX/PHONE_REGEX above; this catches the bare
// solicitation phrasing itself. Requires "for/at/on/about" immediately
// after "<verb> me" (not just any occurrence of "call me"/"text me"
// bare), AND excludes the phrase when preceded by a negation ("he won't
// call me for help", "he won't follow me on social media") — both
// guards were added after testing found each, independently, as
// ordinary complaints (not solicitation) that would otherwise
// incorrectly hard-reject.
const CONTACT_SOLICITATION_REJECT_REGEX = /\b(?<!won'?t\s)(?<!wouldn'?t\s)(?<!doesn'?t\s)(?<!didn'?t\s)(?<!never\s)(?:dm|message|text|call|contact|email|follow)\s+me\s+(?:for|at|on|about|@)/i

// B. Explicit identity-introduction phrasing.
const NAME_INTRO_REGEX =
  /\b(my|his|her|their|(?:the|this) person(?:'s)?|(?:the|this) guy(?:'s)?|(?:the|this) girl(?:'s)?)\s+(?:full\s+)?name\s+is\b/i
const ROLE_POSSESSIVE_NAME_REGEX = new RegExp(
  `\\b(?:${PERSON_CONTEXT_WORDS})(?:'s|s)?\\s+(?:full\\s+)?name\\s+is\\b`,
  'i'
)
// "Call me Raman" / "Everyone calls him Raman" / "goes by Kabir" — direct
// self- or third-party naming without the word "name" at all. Trigger
// words matched case-insensitively so a sentence-initial "Call me Raman."
// isn't missed just because "call" is capitalized; the captured name's
// capitalization is checked separately in JS (isLikelyProperNoun), since
// folding the whole pattern to /i would also blind the capture group to
// case and defeat that signal entirely.
const CALL_ME_NAME_REGEX = /\bcall\s+me\s+([a-zA-Z]{2,20})\b/gi
const EVERYONE_CALLS_NAME_REGEX = /\b(?:everyone|people|they all)\s+calls?\s+(?:him|her|them)\s+([a-zA-Z]{2,20})\b/gi
const GOES_BY_NAME_REGEX = /\bgoes\s+by\s+([a-zA-Z]{2,20})\b/gi
// "He introduced himself as Karan" — a fourth name-disclosure shape found
// during red-team testing, same family as call-me/everyone-calls/goes-by.
const INTRODUCED_AS_NAME_REGEX = /\bintroduced\s+(?:himself|herself|themselves)\s+as\s+([a-zA-Z]{2,20})\b/gi
function hasCallMeName(text: string): boolean {
  for (const m of text.matchAll(CALL_ME_NAME_REGEX)) if (isLikelyProperNoun(m[1])) return true
  return false
}
function hasEveryoneCallsName(text: string): boolean {
  for (const m of text.matchAll(EVERYONE_CALLS_NAME_REGEX)) if (isLikelyProperNoun(m[1])) return true
  return false
}
function hasGoesByName(text: string): boolean {
  for (const m of text.matchAll(GOES_BY_NAME_REGEX)) if (isLikelyProperNoun(m[1])) return true
  return false
}
function hasIntroducedAsName(text: string): boolean {
  for (const m of text.matchAll(INTRODUCED_AS_NAME_REGEX)) if (isLikelyProperNoun(m[1])) return true
  return false
}

// D. Threats / violence — HIGHEST PRIORITY.
// 'drown', 'suffocate', 'crush', 'smash' added after red-team testing
// found "I will drown him" / "I will suffocate him" / "I will crush her"
// all reaching APPROVE — the original list covered the most obvious
// violent verbs but not this set, which are just as unambiguous in a
// first-person-intent + human-target structure.
// 'torture' and 'burn' (as a direct verb on a person, not "burn his
// house" which VIOLENT_INTENT_PHRASAL_REGEX already covers separately)
// added after "Please torture him at 555786789" reached APPROVE — neither
// verb was in this list at all, so "Please torture him" matched nothing
// regardless of what followed it.
const VIOLENT_VERB_LIST = ['kill', 'murder', 'shoot', 'stab', 'poison', 'strangle', 'choke', 'attack', 'destroy', 'hurt', 'drown', 'suffocate', 'crush', 'smash', 'torture', 'burn']
const VIOLENT_ACTION_VERBS_SRC = VIOLENT_VERB_LIST.map(spacedWordPattern).join('|')
const VIOLENCE_TARGET = 'him|her|them|everyone|all\\s+of\\s+them|us'
// "what if i" added after testing found "What if I just made him
// disappear?" reaching APPROVE — a rhetorical-question framing of the
// same first-person violent intent VIOLENT_INTENT_PHRASAL_REGEX already
// catches for the direct "I'm going to..." phrasing.
const FIRST_PERSON_INTENT_PREFIX =
  "(?:i\\s+will|i'll|i\\s+am\\s+going\\s+to|i'm\\s+going\\s+to|i\\s+want(?:s)?\\s+to|i\\s+wanna|i'm\\s+planning\\s+to|i\\s+am\\s+planning\\s+to|i\\s+intend\\s+to|i'm\\s+about\\s+to|i\\s+am\\s+about\\s+to|i'm\\s+gonna|i\\s+gonna|what\\s+if\\s+i)"

const VIOLENT_INTENT_REGEX = new RegExp(
  `${FIRST_PERSON_INTENT_PREFIX}\\s+(?:${VIOLENT_ACTION_VERBS_SRC})\\s+(?:${VIOLENCE_TARGET}|(?:all\\s+)?(?:${GROUP_TERMS}))\\b`,
  'i'
)
const VIOLENT_INTENT_PHRASAL_REGEX = new RegExp(
  `${FIRST_PERSON_INTENT_PREFIX}\\s+beat\\s+(?:him|her|them)\\s+up\\b|` +
  `${FIRST_PERSON_INTENT_PREFIX}\\s+burn\\s+(?:his|her|their)\\s+house\\b|` +
  // Tolerates an optional filler word ("just") and both "make"/"made" —
  // "What if I just made him disappear?" (the "what if i" prefix reads
  // naturally with past tense) was missing under the original bare
  // "make" + no filler shape.
  `${FIRST_PERSON_INTENT_PREFIX}\\s+(?:just\\s+)?(?:make|made)\\s+(?:him|her|them)\\s+disappear\\b`,
  'i'
)
// Imperative / third-party calls to violence — no "I" subject at all.
// "Kill all men", "Beat her up", "Someone should kill him". The negative
// lookbehinds keep this from firing on "I wish karma would destroy him" —
// a soft wish-framing, not an imperative.
const IMPERATIVE_VIOLENCE_REGEX = new RegExp(
  `\\b(?<!would\\s)(?<!wish\\s)(?<!wishes\\s)(?<!hope\\s)(?<!hopes\\s)(?:${VIOLENT_ACTION_VERBS_SRC})\\s+(?:${VIOLENCE_TARGET}|(?:all\\s+)?(?:${GROUP_TERMS}))\\b|` +
  `\\bbeat\\s+(?:him|her|them)\\s+up\\b|` +
  // "Make him suffer" — a distinct imperative shape from the bare
  // verb+target pattern above (VIOLENT_ACTION_VERBS_SRC doesn't include
  // "suffer" as a transitive verb the way "hurt"/"kill" are).
  `\\bmake\\s+(?:${VIOLENCE_TARGET})\\s+suffer\\b|` +
  `\\b(?:someone|somebody)\\s+should\\s+(?:kill|hurt|attack|beat\\s+up)\\s+(?:${VIOLENCE_TARGET})\\b`,
  'i'
)
const SEVERE_THREAT_REJECT_REGEX = new RegExp(
  `\\bdeserves?\\s+to\\s+(?:get\\s+)?(?:hurt|die|suffer)\\b|` +
  `\\bwants?\\s+to\\s+(?:hurt|kill)\\s+(?:him|her|them)\\b|` +
  `\\bwish(?:es)?\\s+(?:he|she|they)\\s+(?:was|were)\\s+dead\\b|` +
  `\\bwish(?:es)?\\s+something\\s+(?:bad|terrible|awful)\\s+(?:would\\s+)?happen(?:s|ed)?\\s+to\\s+(?:him|her|them)\\b|` +
  `\\b(?:he|she|they|everyone(?:\\s+like\\s+(?:him|her))?|(?:all\\s+)?(?:${GROUP_TERMS}))\\s+should\\s+(?:all\\s+)?die\\b`,
  'i'
)
const WISH_DEATH_THIRD_PARTY_REGEX = /\bhopes?\s+(?:he|she|they)\s+dies?\b/i
// Broadened to also catch unquoted third-party reporting frames ("my
// uncle says X", "she said X", "people keep saying X") so laundered/
// reported hate & threats downgrade from reject to pending instead of
// staying a hard reject. Does NOT apply to first-person violent-intent
// checks (VIOLENT_INTENT_REGEX/VIOLENT_INTENT_PHRASAL_REGEX) — those stay
// strictly first-person, where a reporting-frame wrapper is far more
// likely to be a laundering attempt than genuine reported speech.
const REPORTING_CONTEXT_REGEX = /\bi\s+(?:told|said)\s+(?:him|her|them)\b|\band\s+regret\b|\bi\s+regret\s+(?:saying|that)\b|\b(?:my\s+\w+|he|she|they|someone|people)\s+(?:keeps?\s+)?(?:is\s+|are\s+)?(?:say|says|saying|said)\b|\bi\s+(?:keep\s+)?(?:read|saw|heard)\b/i
// Self-harm ENCOURAGEMENT directed at someone else — always reject.
const SELF_HARM_ENCOURAGEMENT_REGEX = /\b(?:you|he|she|they)\s+should\s+(?:kill|hurt)\s+(?:yourself|himself|herself|themselves)\b/i

// E. Clear group-directed hate/dehumanization.
const GROUP_HOSTILITY_BASE_REGEX = new RegExp(
  `\\bi\\s+(?:hate|despise|loathe)\\s+${GROUP_INTENSIFIER}(?:${GROUP_TERMS})\\b|\\bi\\s+can'?t\\s+stand\\s+${GROUP_INTENSIFIER}(?:${GROUP_TERMS})\\b`,
  'i'
)
const GROUP_HOSTILITY_ELABORATION_REGEX = new RegExp(
  `\\bi\\s+(?:hate|despise|loathe|can'?t\\s+stand)\\s+${GROUP_INTENSIFIER}(?:${GROUP_TERMS})\\b(?=\\s+(?:who|that|because|for|when))`,
  'i'
)
const GROUP_HOSTILITY_SINGULAR_REGEX = new RegExp(
  `\\bi\\s+(?:hate|despise|loathe)\\s+(?:every|any)\\s+(?:${SINGULAR_GROUP_TERMS})\\b|\\bi\\s+can'?t\\s+stand\\s+(?:every|any)\\s+(?:${SINGULAR_GROUP_TERMS})\\b`,
  'i'
)
const GROUP_HOSTILITY_SINGULAR_ELABORATION_REGEX = new RegExp(
  `\\bi\\s+(?:hate|despise|loathe|can'?t\\s+stand)\\s+(?:every|any)\\s+(?:${SINGULAR_GROUP_TERMS})\\b(?=\\s+(?:who|that|because|for|when))`,
  'i'
)
// Bare declarative fragment with no subject pronoun at all ("Hate all
// men.", or the letter-spaced evasion "h.a.t.e all men" once normalized).
const GROUP_HOSTILITY_NO_SUBJECT_REGEX = new RegExp(
  `^(?:hate|despise|loathe)\\s+(?:${GROUP_INTENSIFIER}(?:${GROUP_TERMS})|(?:every|any)\\s+(?:${SINGULAR_GROUP_TERMS}))\\b(?!\\s+(?:who|that|because|for|when))`,
  'i'
)
const NEGATIVE_GROUP_ADJECTIVES =
  'trash|disgusting|horrible|garbage|scum|worthless|awful|pathetic|subhuman|filth|terrible|evil|monsters?|animals?|stupid'
const GROUP_ARE_NEGATIVE_REGEX = new RegExp(
  `\\b(?:all\\s+)?(?:${GROUP_TERMS})(?:\\s+people)?\\s+are\\s+(?:such\\s+|so\\s+|really\\s+)?(?:${NEGATIVE_GROUP_ADJECTIVES})\\b`,
  'i'
)
const GROUP_SHOULDNT_EXIST_REGEX = new RegExp(`\\b(?:all\\s+)?(?:${GROUP_TERMS})\\s+shouldn'?t\\s+exist\\b`, 'i')
const DEHUMANIZATION_REGEX = /\b(?:those|these)\s+people\s+are\s+(?:animals?|vermin|subhuman|not\s+human|monsters?)\b/i

// Spam reject requires promotion/solicitation STRUCTURE (money/earn
// language co-occurring with a contact/click instruction, or an explicit
// imperative "click my link to earn"), not bare financial vocabulary —
// "my boyfriend says he needs to earn money first" (the confirmed
// production false positive from the previous pass) no longer matches
// anything in Layer 1 or Layer 2.
const SPAM_REJECT_REGEX = new RegExp(
  "\\b(?:guaranteed\\s+returns|crypto\\s+investment\\s+opportunity|double\\s+your\\s+(?:money|bitcoin|crypto)|click\\s+this\\s+link\\s+to\\s+claim|verify\\s+your\\s+account\\s+now|congratulations\\s+you'?ve?\\s+won)\\b" +
  "|\\b(?:earn|make)\\s+(?:money|cash|\\$\\d+(?:\\s*/\\s*day|\\s*a\\s*day|\\s*per\\s*day)?)\\b[^.!?]{0,40}\\b(?:dm|message|text|click|link|contact)\\s+me\\b" +
  "|\\bclick\\s+(?:my|this)\\s+link\\s+to\\s+earn\\b",
  'i'
)

// F. Conditional/indirect threat/danger signal (NEW this pass) —
// structural patterns broader than an exact-phrase enumeration, without
// bare-word-matching risk vocabulary directly (that would break harmless
// idioms like "this workout is killing me" — verified in testing that it
// still doesn't).
const CONDITIONAL_DANGER_REGEX = new RegExp(
  `\\b(?:someone|somebody|he|she|they)(?:'s|\\s+is|\\s+are)?\\s+going\\s+to\\s+(?:get\\s+)?(?:hurt|suffer|regret|pay)\\b|` +
  `\\b(?:make|want)\\s+(?:him|her|them)\\s+(?:to\\s+)?pay\\b|` +
  `\\b(?:he|she|they)(?:'ll|\\s+will)\\s+pay\\s+for\\s+this\\b|` +
  `\\bget(?:s|ting)?\\s+what('s|\\s+is)\\s+coming\\b|` +
  `\\bmake\\s+(?:him|her|them)\\s+sorry\\b|` +
  `\\bgets?\\s+what\\s+(?:he|she|they)\\s+deserves?\\b|` +
  `\\bmake\\s+sure\\s+(?:he|she|they)\\s+gets?\\s+what\\s+(?:he|she|they)\\s+deserves?\\b|` +
  // Added after testing found "If he doesn't stop, he won't like what
  // happens next" reaching APPROVE — a conditional threat phrased without
  // any of the verbs above.
  `\\bwon'?t\\s+like\\s+what\\s+happens\\b`,
  'i'
)
// Bare violent-weapon vocabulary appearing near a human target, short of
// the Layer-1 imperative/intent shapes. Kept narrow (co-occurrence only,
// not a bare-word scan of the whole text) so it doesn't relitigate the
// idiom false-positive problem.
const WEAPON_NEAR_TARGET_REGEX = /\b(?:weapon|gun|knife|poison)\b.{0,30}\b(?:him|her|them)\b|\b(?:him|her|them)\b.{0,30}\b(?:weapon|gun|knife|poison)\b/i

function layer1Reject(normalized: string, forKeywords: string): string | null {
  if (PHONE_REGEX.test(normalized)) return 'phone'
  if (CONTACT_NUMBER_REGEX.test(normalized)) return 'phone'
  if (EMAIL_REGEX.test(normalized)) return 'email'
  if (OBFUSCATED_EMAIL_REGEX.test(normalized)) return 'email_obfuscated'
  if (HANDLE_REGEX.test(normalized)) return 'handle'
  if (URL_REGEX.test(normalized)) return 'url'
  if (BARE_DOMAIN_REGEX.test(normalized)) return 'url'
  if (STREET_ADDRESS_REGEX.test(normalized)) return 'address'
  if (LICENSE_PLATE_REGEX.test(normalized)) return 'license_plate'
  if (CONTACT_SOLICITATION_REJECT_REGEX.test(normalized)) return 'contact_solicitation'
  if (NAME_INTRO_REGEX.test(forKeywords)) return 'name_intro'
  if (ROLE_POSSESSIVE_NAME_REGEX.test(forKeywords)) return 'name_intro'
  if (hasCallMeName(forKeywords)) return 'name_intro'
  if (hasEveryoneCallsName(forKeywords)) return 'name_intro'
  if (hasGoesByName(forKeywords)) return 'name_intro'
  if (hasIntroducedAsName(forKeywords)) return 'name_intro'
  if (VIOLENT_INTENT_REGEX.test(forKeywords)) return 'threat'
  if (VIOLENT_INTENT_PHRASAL_REGEX.test(forKeywords)) return 'threat'
  // Reporting-context downgrade applies here — "People keep saying 'kill
  // all men' online. Is that normal?" reports someone ELSE'S imperative,
  // not the poster's own.
  if (IMPERATIVE_VIOLENCE_REGEX.test(forKeywords) && !REPORTING_CONTEXT_REGEX.test(forKeywords)) return 'threat'
  if (SEVERE_THREAT_REJECT_REGEX.test(forKeywords)) return 'threat'
  if (WISH_DEATH_THIRD_PARTY_REGEX.test(forKeywords) && !REPORTING_CONTEXT_REGEX.test(forKeywords)) return 'threat'
  if (SELF_HARM_ENCOURAGEMENT_REGEX.test(forKeywords)) return 'self_harm_encouragement'
  if (GROUP_ARE_NEGATIVE_REGEX.test(forKeywords) && !REPORTING_CONTEXT_REGEX.test(forKeywords)) return 'group_hate'
  if (DEHUMANIZATION_REGEX.test(forKeywords) && !REPORTING_CONTEXT_REGEX.test(forKeywords)) return 'group_hate'
  if (GROUP_SHOULDNT_EXIST_REGEX.test(forKeywords) && !REPORTING_CONTEXT_REGEX.test(forKeywords)) return 'group_hate'
  if (GROUP_HOSTILITY_BASE_REGEX.test(forKeywords) && !GROUP_HOSTILITY_ELABORATION_REGEX.test(forKeywords) && !REPORTING_CONTEXT_REGEX.test(forKeywords)) return 'group_hate'
  if (GROUP_HOSTILITY_SINGULAR_REGEX.test(forKeywords) && !GROUP_HOSTILITY_SINGULAR_ELABORATION_REGEX.test(forKeywords)) return 'group_hate'
  if (GROUP_HOSTILITY_NO_SUBJECT_REGEX.test(forKeywords)) return 'group_hate'
  // Tested against `normalized`, not `forKeywords` — see the note on
  // deleetForKeywords above for why (dollar-amount mangling).
  if (SPAM_REJECT_REGEX.test(normalized)) return 'spam'
  return null
}

// ---- Layer 2: pending risk signals ----
// We do NOT need to prove a post is unsafe — any meaningful signal here
// means "hold for human review," not "reject." SUS's core use case is
// describing someone else's bad behavior, so ordinary interpersonal
// complaints must NOT trip these.

const PERSON_CONTEXT_REGEX = new RegExp(`\\b(?:${PERSON_CONTEXT_WORDS})\\s+([a-zA-Z]{2,20})\\b`, 'gi')
function hasPersonContextName(text: string): boolean {
  for (const m of text.matchAll(PERSON_CONTEXT_REGEX)) {
    const word = m[1]
    if (isLikelyProperNoun(word) && !PERSON_STOPLIST.has(word.toLowerCase())) return true
  }
  return false
}
const NAME_LEADING_CONTEXT_REGEX = /\b([A-Z][a-z]+)\s+(?:from\s+(?:my|our|the)\s+(?:office|work|job|team|building|street|neighborhood|apartment|school|class)\b|who\s+works?\s+at\s+[A-Z]|at\s+[A-Z][a-z]+\s+(?:steals?|cheats?|lies?|scams?|abuses?))/g
function hasLeadingNameContext(text: string): boolean {
  for (const m of text.matchAll(NAME_LEADING_CONTEXT_REGEX)) {
    if (!PERSON_STOPLIST.has(m[1].toLowerCase())) return true
  }
  return false
}

const PRONOUN_HOSTILITY_REGEX = /\bi\s+(?:hate|despise|loathe)\s+(?:him|her|them)\b|\bi\s+can'?t\s+stand\s+(?:him|her|them)\b/i
// "that|this" + GROUP_TERMS added after testing found "That Muslim is
// disgusting" reaching APPROVE — an individually-targeted insult phrased
// via an identity/demographic noun instead of woman/man/guy/girl/person.
// This is a personal-insult check (Layer 2, PENDING), not the group-hate
// check above — "that Muslim is disgusting" targets one person, not a
// demographic generalization, so it belongs here structurally.
const INSULT_SUBJECT = `(?:he|she|that\\s+(?:woman|man|guy|girl|person|${GROUP_TERMS})|this\\s+(?:woman|man|guy|girl|person|${GROUP_TERMS})|(?:my|his|her|their)\\s+(?:${PERSON_CONTEXT_WORDS}))`
const INSULT_WORDS = 'idiot|loser|pathetic|worthless|scum|trash|disgusting|psychopath|psycho|monster|garbage|stupid|ugly|horrible'
const INSULT_REGEX = new RegExp(`\\b${INSULT_SUBJECT}(?:'s|\\s+is)\\s+(?:such\\s+)?(?:a|an)?\\s*(?:\\w+\\s+)?(?:${INSULT_WORDS})\\b`, 'i')
const BULLY_ENCOURAGEMENT_REGEX = /\b(?:everyone|someone|people)\s+should\s+bully\s+(?:him|her|them)\b/i

const HATE_WHEN_GROUP_REGEX = new RegExp(`\\bi\\s+hate\\s+when\\s+(?:${GROUP_TERMS})\\b`, 'i')
const CAPITALIZED_PLURAL_HOSTILITY_REGEX = new RegExp(
  `\\bi\\s+(?:hate|despise|loathe)\\s+${GROUP_INTENSIFIER}([a-zA-Z]{2,20})\\b|\\bi\\s+can'?t\\s+stand\\s+${GROUP_INTENSIFIER}([a-zA-Z]{2,20})\\b`,
  'gi'
)
function hasUnrecognizedGroupHostility(text: string): boolean {
  for (const m of text.matchAll(CAPITALIZED_PLURAL_HOSTILITY_REGEX)) {
    const word = m[1] || m[2]
    if (!word) continue
    if (isLikelyCapitalizedPlural(word) && !CATCHALL_GROUP_STOPLIST.has(word.toLowerCase())) return true
  }
  return false
}
// Unknown-group hostility for LOWERCASE plural nouns too ("I hate
// immigrants", "I hate accountants") — the check above only covers
// capitalized plurals. Excludes GROUP_TERMS (already handled by Layer 1),
// SAFE_HATE_OBJECTS, and PSEUDO_PLURAL_STOPWORDS.
const UNKNOWN_GROUP_HATE_REGEX = new RegExp(
  `\\bi\\s+(?:hate|despise|loathe)\\s+${GROUP_INTENSIFIER}([a-z]{3,24}s)\\b|\\bi\\s+can'?t\\s+stand\\s+${GROUP_INTENSIFIER}([a-z]{3,24}s)\\b`,
  'gi'
)
function hasUnknownGroupHostility(text: string): boolean {
  for (const m of text.matchAll(UNKNOWN_GROUP_HATE_REGEX)) {
    const word = (m[1] || m[2] || '').toLowerCase()
    if (!word) continue
    if (SAFE_HATE_OBJECTS.has(word) || CATCHALL_GROUP_STOPLIST.has(word) || PSEUDO_PLURAL_STOPWORDS.has(word)) continue
    return true
  }
  return false
}
// "[adjective]? people are <negative>" for uncurated groups ("Disabled
// people are disgusting") — GROUP_ARE_NEGATIVE_REGEX only fires for
// curated GROUP_TERMS; this is the generalized, PENDING-tier fallback for
// any other "___ people are ___" shape.
const UNKNOWN_PEOPLE_ARE_NEGATIVE_REGEX = new RegExp(`\\b(?:[a-z]+\\s+)?people\\s+are\\s+(?:such\\s+|so\\s+|really\\s+)?(?:${NEGATIVE_GROUP_ADJECTIVES})\\b`, 'i')
// The same "X are <negative>" shape but for an UNCURATED plural noun with
// no "people" head word at all ("Politicians are disgusting").
const UNKNOWN_GROUP_ARE_NEGATIVE_REGEX = new RegExp(`\\b([a-z]{3,24}s)\\s+are\\s+(?:such\\s+|so\\s+|really\\s+)?(?:${NEGATIVE_GROUP_ADJECTIVES})\\b`, 'gi')
function hasUnknownGroupAreNegative(text: string): boolean {
  for (const m of text.matchAll(UNKNOWN_GROUP_ARE_NEGATIVE_REGEX)) {
    const word = (m[1] || '').toLowerCase()
    if (!word) continue
    if (SAFE_HATE_OBJECTS.has(word) || CATCHALL_GROUP_STOPLIST.has(word) || PSEUDO_PLURAL_STOPWORDS.has(word)) continue
    return true
  }
  return false
}

// Cross-sentence hostility aggregation (NEW this pass) — one sentence
// introduces a people/group target, another (anywhere in the same post)
// contains a wish-of-harm/disappear phrase. Deliberately narrow triggers
// on both sides (not a bare-word scan) to avoid false-triggering on
// unrelated combinations.
const GROUP_TARGET_MENTION_REGEX = new RegExp(`\\b(?:this|these|those|a)\\s+group\\s+of\\s+people\\b|\\b(?:those|these)\\s+people\\b|\\b(?:${GROUP_TERMS})\\b`, 'i')
const CROSS_SENTENCE_HARM_WISH_REGEX = /\bi\s+wish\s+(?:he|she|they|they'd|they\s+would|he'd|he\s+would|she'd|she\s+would)\s+(?:disappear|die|were\s+gone|would\s+disappear)\b|\bshould\s+(?:all\s+)?disappear\b/i

const REVENGE_REGEX = /\brevenge\b/i
// Bare "karma" no longer triggers pending on its own ("I believe in
// karma" must approve) — only karma directed hostilely AT a target does.
const KARMA_HOSTILE_REGEX = /\bkarma\s+(?:will\s+|is\s+going\s+to\s+|'ll\s+|would\s+)?(?:get|hit|come\s+for|catch\s+up\s+with|destroy|ruin|end)\s+(?:him|her|them)\b|\bhope\s+karma\s+gets?\s+(?:him|her|them)\b/i
const WILL_REGRET_REGEX = /\b(?:he|she|they)(?:'ll|\s+will)\s+regret\b/i
const BROAD_WISH_DIE_REGEX = /\b(?:hopes?|wishe?s?)\b.{0,20}\b(?:dies?|dead)\b/i
const WANT_SUFFER_REGEX = /\bwant\s+(?:him|her|them)\s+to\s+suffer\b/i
const WATCH_BACK_REGEX = /\bbetter\s+watch\s+(?:his|her|their)\s+back\b/i

// "had (?:\w+\s+){0,2}sex" tolerates an inserted adjective ("had
// unprotected sex") — the previous literal "had sex"/"having sex" phrase
// missed this during red-team testing since there's no adjacency.
const SEXUAL_AMBIGUOUS_REGEX = /\b(?:sent nudes|nudes|hook ?up|one night stand|slept with|sleeping with|had\s+(?:\w+\s+){0,2}sex|having\s+(?:\w+\s+){0,2}sex)\b/i

// "earn (?:money|cash|extra)" bare trigger REMOVED — that was the
// confirmed production false positive ("he needs to earn money first").
// Genuine promo/solicitation is now Layer 1 (SPAM_REJECT_REGEX above);
// this tier keeps only the non-financial promo signals.
const SPAM_AMBIGUOUS_REGEX = /\b(?:dm me|click here|limited time offer|free (?:money|gift|cash)|subscribe to|check out my|link in bio|promo ?code)\b/i

const SELF_HARM_DISTRESS_REGEX = /\bi\s+(?:feel\s+like|want\s+to|'m\s+going\s+to|am\s+going\s+to)\s+(?:hurt(?:ing)?|kill(?:ing)?)\s+myself\b|\bi\s+want\s+to\s+die\b|\bi\s+don'?t\s+want\s+to\s+live\b/i

// Child safety split into a high-confidence EXPLOIT reject tier and a
// softer co-occurrence PENDING tier — exploitation still hard-rejects,
// but "my teenager asked me about sex" only pends (the previous blunt
// co-occurrence-always-rejects heuristic was flagged as a false-positive
// risk in the prior audit).
const MINOR_AGE_INDICATOR_REGEX = /\b(?:1[0-7]\s*-?\s*year-?\s*old|minor|underage|middle\s*school(?:er)?|high\s*school(?:er)?|teen(?:ager)?)\b/i
const SEXUAL_TERM_REGEX = /\b(?:sex|sexual|nude|nudes|porn|sexting|grooming)\b/i
const CHILD_EXPLOITATION_REJECT_REGEX = /\b(?:sent|send|sending|share[ds]?|asked\s+for|asking\s+for|traded?)\s+(?:nudes?|nude\s+(?:pics?|photos?|pictures?))\b|\b(?:slept|sleeping|had\s+sex|sex(?:ting)?)\s+with\s+(?:a\s+)?(?:1[0-7]\s*-?\s*year-?\s*old|minor|underage)\b|\bgroom(?:ed|ing)?\s+(?:a\s+)?(?:1[0-7]\s*-?\s*year-?\s*old|minor|underage|teen(?:ager)?)\b/i
function hasChildExploitation(text: string): boolean { return CHILD_EXPLOITATION_REJECT_REGEX.test(text) }
function hasChildSafetyAmbiguity(text: string): boolean { return MINOR_AGE_INDICATOR_REGEX.test(text) && SEXUAL_TERM_REGEX.test(text) }

const ILLEGAL_INSTRUCTION_REGEX = /\bhow\s+(?:do\s+i|can\s+i|to)\s+(?:hack|make\s+a\s+bomb|make\s+meth|pick\s+a\s+lock|get\s+away\s+with|poison\s+someone|track\s+(?:him|her|them)\s+without|stalk\s+(?:him|her|them)\s+without)\b/i
const STALKING_ADMISSION_REGEX = /\bi'?m\s+following\s+(?:him|her|them|my\s+ex)\s+everywhere\b|\bso\s+(?:he|she|they)\s+knows?\s+i'?m\s+watching\b/i
const EXTREMISM_REGEX = /\bjoin\s+isis\b|\bjoin\s+al-?qaeda\b|\bsupport(?:s|ing)?\s+terroris(?:m|t)\b|\bbecome\s+a\s+terrorist\b|\bcommit\s+a\s+terrorist\s+attack\b|\bplan(?:ning)?\s+an?\s+attack\s+on\b/i
const OBJECTIFICATION_REGEX = /\bis\s+[A-Z][a-z]+\s+(?:hot|attractive|ugly|cute)\??\b|\brate\s+(?:my|this)\s+(?:[a-z]+'s\s+)?looks?\b|\bwould\s+you\s+(?:sleep\s+with|date|hook\s+up\s+with)\s+(?:this|that)\s+(?:person|girl|guy|man|woman)\b|\bis\s+this\s+(?:girl|guy|person)\s+(?:hot|ugly|attractive)\??\b/i

// Small high-risk weapon-emoji signal, PENDING only — never semantically
// interpreted, just a narrow co-occurrence with a human-target pronoun.
const WEAPON_EMOJI_REGEX = /[\u{1F52A}\u{1F52B}⚔\u{1F4A3}\u{1FA78}]/u
const HUMAN_TARGET_PRONOUN_REGEX = /\b(?:him|her|them|me)\b/i

function layer2PendingSignal(normalized: string, forKeywords: string): string | null {
  // NEW: the positive language-confidence gate is checked FIRST, before
  // any other Layer 2 signal — if the system isn't confident this is
  // supported-language English, nothing downstream gets a chance to
  // wrongly call it safe.
  if (!looksLikeConfidentEnglish(normalized)) return 'unsupported_or_uncertain_language'
  if (looksUnsupportedLanguage(normalized)) return 'unsupported_language'
  if (looksStructurallyUnusual(normalized)) return 'structurally_unusual'
  if (hasChildSafetyAmbiguity(forKeywords)) return 'child_safety_ambiguous'
  if (hasPersonContextName(forKeywords)) return 'possible_identity'
  if (hasLeadingNameContext(forKeywords)) return 'possible_identity'
  if (PRONOUN_HOSTILITY_REGEX.test(forKeywords)) return 'targeted_hostility'
  if (INSULT_REGEX.test(forKeywords)) return 'insult'
  if (BULLY_ENCOURAGEMENT_REGEX.test(forKeywords)) return 'harassment'
  if (GROUP_HOSTILITY_BASE_REGEX.test(forKeywords)) return 'ambiguous_group_hostility'
  if (GROUP_HOSTILITY_SINGULAR_REGEX.test(forKeywords)) return 'ambiguous_group_hostility'
  if (HATE_WHEN_GROUP_REGEX.test(forKeywords)) return 'ambiguous_group_hostility'
  if (GROUP_ARE_NEGATIVE_REGEX.test(forKeywords)) return 'ambiguous_group_hostility' // reporting-context downgrade lands here
  if (DEHUMANIZATION_REGEX.test(forKeywords)) return 'ambiguous_group_hostility'
  if (GROUP_SHOULDNT_EXIST_REGEX.test(forKeywords)) return 'ambiguous_group_hostility'
  if (hasUnrecognizedGroupHostility(forKeywords)) return 'possible_group_hostility'
  if (hasUnknownGroupHostility(forKeywords)) return 'possible_group_hostility'
  if (UNKNOWN_PEOPLE_ARE_NEGATIVE_REGEX.test(forKeywords)) return 'possible_group_hostility'
  if (hasUnknownGroupAreNegative(forKeywords)) return 'possible_group_hostility'
  if (GROUP_TARGET_MENTION_REGEX.test(forKeywords) && CROSS_SENTENCE_HARM_WISH_REGEX.test(forKeywords)) return 'cross_sentence_hostility'
  // Catches the reporting-context downgrade from layer1Reject above —
  // still held for review, never silently approved.
  if (IMPERATIVE_VIOLENCE_REGEX.test(forKeywords)) return 'possible_violence'
  if (CONDITIONAL_DANGER_REGEX.test(forKeywords)) return 'possible_violence'
  if (WEAPON_NEAR_TARGET_REGEX.test(forKeywords)) return 'possible_violence'
  if (WEAPON_EMOJI_REGEX.test(normalized) && HUMAN_TARGET_PRONOUN_REGEX.test(forKeywords)) return 'possible_violence'
  if (KARMA_HOSTILE_REGEX.test(forKeywords)) return 'possible_violence'
  if (REVENGE_REGEX.test(forKeywords)) return 'possible_violence'
  if (WILL_REGRET_REGEX.test(forKeywords)) return 'possible_violence'
  if (BROAD_WISH_DIE_REGEX.test(forKeywords)) return 'possible_violence'
  if (WANT_SUFFER_REGEX.test(forKeywords)) return 'possible_violence'
  if (WATCH_BACK_REGEX.test(forKeywords)) return 'possible_violence'
  if (SELF_HARM_DISTRESS_REGEX.test(forKeywords)) return 'self_harm_distress'
  if (ILLEGAL_INSTRUCTION_REGEX.test(forKeywords)) return 'possible_illegal'
  if (STALKING_ADMISSION_REGEX.test(forKeywords)) return 'possible_stalking'
  if (EXTREMISM_REGEX.test(forKeywords)) return 'possible_extremism'
  if (OBJECTIFICATION_REGEX.test(forKeywords)) return 'objectification'
  if (SEXUAL_AMBIGUOUS_REGEX.test(forKeywords)) return 'possible_sexual_content'
  if (SPAM_AMBIGUOUS_REGEX.test(forKeywords)) return 'possible_spam'
  return null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Moderation =
  | { outcome: 'reject'; reason: string }
  | { outcome: 'approve'; text: string }
  | { outcome: 'pending'; text: string; reason: string }

// The full pipeline. This is the ONLY function that decides a submission's
// fate — the insert below just acts on its outcome. Internal reason codes
// (e.g. 'possible_identity') are for admin/debugging use only and are
// never sent back to the client — see the reject response below, which
// always uses a single generic message.
function moderate(text: string, category: string): Moderation {
  const trimmed = (text || '').trim()

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return { outcome: 'reject', reason: 'Invalid category.' }
  }
  if (trimmed.length < 5) return { outcome: 'reject', reason: 'A little more detail, please.' }
  if (trimmed.length > MAX_CONFESSION_LENGTH) return { outcome: 'reject', reason: `Keep it under ${MAX_CONFESSION_LENGTH} characters.` }

  // Fail-safe: the ENTIRE matching pipeline — normalization, the bad-words
  // check, Layer 1 hard-rejects, and Layer 2 pending signals (including
  // the language-confidence gate) — runs inside one try/catch. If ANYTHING
  // below throws for any reason, the submission resolves to 'pending',
  // never 'approve' — this is the literal implementation of "never fail
  // open."
  try {
    const normalized = normalizeForModeration(trimmed)
    const forKeywords = deleetForKeywords(normalized)

    // The bad-words library flags the bare word "sex" as profane in ANY
    // context — including ordinary relationship discussion ("we haven't
    // had sex in months") — which conflicts with keeping normal
    // relationship talk eligible for approval. Neutralizing only the
    // standalone word (never "sexy"/"sexual"/"sexting" etc., which stay
    // intact and still trigger the filter normally) before running the
    // profanity check removes that one over-broad trigger while leaving
    // every other word the library catches untouched.
    const profanityCheckText = forKeywords.replace(/\bsex\b/gi, 'sxx')
    if (filter.isProfane(profanityCheckText)) return { outcome: 'reject', reason: 'Keep it clean — try rewording.' }

    // Child safety: high-confidence exploitation is always a hard reject,
    // checked before the generic hard-reject list so it can never be
    // shadowed by a lower-priority match. Softer age+sexual-term
    // co-occurrence (e.g. "my teenager asked me about sex") is handled by
    // layer2PendingSignal's hasChildSafetyAmbiguity instead — see the
    // final report for why this was split from a blunt always-reject.
    if (hasChildExploitation(forKeywords)) {
      return {
        outcome: 'reject',
        reason: "This submission can't be posted. Please remove names, identifying information, or inappropriate content and try again.",
      }
    }

    const hardReject = layer1Reject(normalized, forKeywords)
    if (hardReject === 'name_intro') return { outcome: 'reject', reason: 'No real names — describe the behavior, not who they are.' }
    if (hardReject) {
      return {
        outcome: 'reject',
        reason: "This submission can't be posted. Please remove names, identifying information, or inappropriate content and try again.",
      }
    }

    const signal = layer2PendingSignal(normalized, forKeywords)
    if (signal) return { outcome: 'pending', text: trimmed, reason: signal }
    return { outcome: 'approve', text: trimmed }
  } catch {
    return { outcome: 'pending', text: trimmed, reason: 'moderation_error' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { text, category, device_id } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const normalizedDeviceId = typeof device_id === 'string' ? device_id.slice(0, 128) : null
    if (normalizedDeviceId) {
      // No daily submission cap — devices can Spill as many questions as
      // they want. The only server-side gate left is banned_devices (see
      // its migration for how a device actually gets banned — hand-run
      // SQL, no admin UI — and why this exists: App Store Guideline 1.2
      // expects the ability to remove abusive users, not just their
      // content).
      const { data: banRow, error: banError } = await supabaseAdmin
        .from('banned_devices')
        .select('device_id')
        .eq('device_id', normalizedDeviceId)
        .maybeSingle()

      if (banError) throw banError

      if (banRow) {
        return new Response(
          JSON.stringify({ error: 'This device is not permitted to submit posts.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const result = moderate(text, category)

    if (result.outcome === 'reject') {
      return new Response(JSON.stringify({ error: result.reason }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data, error } = await supabaseAdmin
      .from('posts')
      .insert({
        text: result.text,
        category,
        // 'approved' only when moderate() found zero pending-risk signals —
        // everything else lands on 'pending' and needs an explicit admin
        // approval (admin-posts' update_status action) before it can reach
        // the public feed. See moderate() above.
        status: result.outcome === 'approve' ? 'approved' : 'pending',
        source: 'user_submitted',
        device_id: normalizedDeviceId,
      })
      .select()
      .single()

    if (error) throw error

    return new Response(JSON.stringify({ post: data }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Something went wrong — try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
