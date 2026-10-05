// Final reranking pass — guarantees no more than `maxConsecutive` cards of
// the same category in a row, whenever that's mathematically possible given
// the batch's actual category mix (impossible only if one category is an
// outright majority of the batch, which never happens in practice here).
// Deliberately a REORDER, never a drop: every post in the input is present
// exactly once in the output — this only ever changes WHERE in the batch a
// post appears, never WHETHER it appears.
//
// Two-step, not a single left-to-right swap sweep: a single sweep (the
// original implementation) greedily fixes the violation it's currently
// looking at by swapping in a later card, but that swap can silently create
// a NEW violation further down that the sweep, having already moved past
// it, never revisits — verified this miss empirically against live feed
// batches during the new-device onboarding work (runs of 4 survived a
// single sweep, and even repeating the same sweep to a fixed point, because
// a greedy "take the first later card with a different category" doesn't
// reliably reach a globally valid arrangement even when one exists).
//
// Instead: (1) build an ordering of just the CATEGORY LABELS that respects
// maxConsecutive, greedily placing whichever remaining category has the
// most cards left (the standard, well-known approach for "rearrange so no
// run exceeds k" — same idea as task-scheduler cooldown problems), then
// (2) slot the actual posts into that template, taking each category's
// posts in their original relative order — which is exactly what preserves
// get_feed's own vote_count-driven priority within a category untouched;
// only the category SLOT a post lands in changes, never the relative order
// of posts sharing a category.
export function diversifyCategories(posts, maxConsecutive = 2) {
  const buckets = new Map()
  for (const p of posts) {
    if (!buckets.has(p.category)) buckets.set(p.category, [])
    buckets.get(p.category).push(p)
  }

  const remaining = new Map()
  for (const [cat, arr] of buckets) remaining.set(cat, arr.length)

  const template = []
  let lastCat = null
  let lastRun = 0
  for (let i = 0; i < posts.length; i++) {
    const candidates = [...remaining.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
    // Prefer the largest remaining category that wouldn't extend a run past
    // maxConsecutive; only fall back to extending the run if truly every
    // remaining category is already-maxed-out (mathematically unavoidable
    // given this batch's composition) — same "never strand content, only
    // reorder it" guarantee the original implementation had.
    let pick = candidates.find(([cat]) => !(cat === lastCat && lastRun >= maxConsecutive))?.[0]
    if (pick === undefined) pick = candidates[0][0]

    template.push(pick)
    remaining.set(pick, remaining.get(pick) - 1)
    if (pick === lastCat) lastRun++
    else {
      lastCat = pick
      lastRun = 1
    }
  }

  const cursors = new Map()
  for (const cat of buckets.keys()) cursors.set(cat, 0)
  return template.map((cat) => {
    const idx = cursors.get(cat)
    cursors.set(cat, idx + 1)
    return buckets.get(cat)[idx]
  })
}

// A small, fixed stoplist of words too generic to signal "these two cards
// are about the same specific dilemma" — relationship-role nouns and basic
// grammar words. Deliberately NOT a general NLP stopword list — just enough
// to stop every card matching every other card on "partner"/"friend"/etc.
const GENERIC_WORDS = new Set([
  'my', 'his', 'her', 'their', 'our', 'your', 'i', 'me', 'he', 'she', 'they', 'we', 'you',
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'to', 'of', 'in', 'on', 'at', 'with', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'has', 'have', 'had',
  'that', 'this', 'it', 'because', 'even', 'though', 'after', 'before', 'every', 'always',
  'never', 'just', 'still', 'really', 'not', "don't", "doesn't", "isn't", "won't",
  'partner', 'partners', 'friend', 'friends', 'roommate', 'roommates', 'sibling', 'siblings',
  'parent', 'parents', 'family', 'coworker', 'coworkers', 'manager', 'managers', 'boss',
  'date', 'dating', 'wants', 'want', 'wanted', 'says', 'said', 'thinks', 'think', 'thought',
  'expects', 'expect', 'expected', 'gets', 'get', 'got',
])

function significantWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w))
  )
}

// Second lightweight reranking pass, same swap-never-drop philosophy as
// diversifyCategories above: if a card shares `minSharedWords` or more
// non-generic words with any of the last `windowSize` cards already placed
// (i.e. likely the same underlying dilemma, just reworded), swap it with
// the next card further down the batch that doesn't share that overlap.
// Deliberately NOT semantic/embedding-based — a cheap, deterministic,
// explainable keyword-overlap check, consistent with "no complicated
// recommendation engine."
//
// Must run BEFORE diversifyCategories, not after — a swap made here cares
// only about text overlap, not category, so it can reintroduce a same-
// category run that a prior diversifyCategories pass had already fixed.
// diversifyCategories is the one with the harder "never more than N"
// requirement, so it needs to be the last word; this pass runs first and
// diversifyCategories cleans up after it. See CardStack.jsx's
// fetchFeedBatch for the actual call order.
export function spaceOutNearDuplicates(posts, windowSize = 5, minSharedWords = 2) {
  const result = [...posts]
  const wordsCache = result.map((p) => significantWords(p.text))

  function overlapsRecent(idx) {
    const start = Math.max(0, idx - windowSize)
    for (let j = start; j < idx; j++) {
      let shared = 0
      for (const w of wordsCache[idx]) {
        if (wordsCache[j].has(w)) shared++
      }
      if (shared >= minSharedWords) return true
    }
    return false
  }

  for (let i = 1; i < result.length; i++) {
    if (!overlapsRecent(i)) continue

    const swapIndex = result.findIndex((_, idx) => {
      if (idx <= i) return false
      const start = Math.max(0, i - windowSize)
      for (let j = start; j < i; j++) {
        let shared = 0
        for (const w of wordsCache[idx]) {
          if (wordsCache[j].has(w)) shared++
        }
        if (shared >= minSharedWords) return false
      }
      return true
    })
    if (swapIndex !== -1) {
      const tmpPost = result[i]
      const tmpWords = wordsCache[i]
      result[i] = result[swapIndex]
      wordsCache[i] = wordsCache[swapIndex]
      result[swapIndex] = tmpPost
      wordsCache[swapIndex] = tmpWords
    }
  }
  return result
}
