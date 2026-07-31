import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getDeviceId } from '../lib/supabase'
import { getSwipesLeft, recordSwipe } from '../lib/dailyLimit'
import { SAFETY_BANNER } from '../lib/safetyResources'
import { filterHidden } from '../lib/hiddenContent'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'
import SwipeCard from './SwipeCard'
import VoteButtons from './VoteButtons'
import CrowdResultCard from './CrowdResultCard'
import WordmarkDot from './WordmarkDot'

const HINT_KEY = 'sus_seen_swipe_hint'
// Once fewer than this many unseen posts remain in the loaded batch, quietly
// fetch and append more in the background (see the prefetch effect below) —
// well before the user could actually run out. The seed pool is only 56
// cards, and a device's own vote history excludes already-voted ones from
// every fetch, so on a real device that's been tested repeatedly the fresh
// pool shrinks fast; hitting the end of a batch used to trigger a blocking
// reload right in the middle of swiping, which is exactly what "some cards
// are still slow, unpredictably" turned out to be — it only happened when a
// swipe happened to land on the last loaded post.
const PREFETCH_THRESHOLD = 6
// Skip has no result to show — just enough delay for the skip-exit animation
// to clear before the next card takes over.
const SKIP_ADVANCE_DELAY = 120
// How long the incoming card's own entrance animation (see SwipeCard's
// SETTLE_SPRING) takes to settle, counted from when it mounts. Voting is
// re-enabled on this fixed schedule rather than via an onAnimationComplete
// callback — framer-motion doesn't reliably fire that callback for a
// component whose x/y are simultaneously driven by `drag`, so a
// deterministic timer is the robust choice here.
const ENTRANCE_DURATION = 220
// Gives the outgoing question card's own swipe-exit animation (see
// SwipeCard's EXIT_TRANSITION, 200ms) time to fully finish — the result
// card must never appear while the question it belongs to is still visible.
const RESULT_ENTER_DELAY = 200
// How long the result card stays fully visible once the real result has
// arrived. History: 1050ms originally -> cut to 650ms for "quick and
// addictive" -> 900ms after feedback that was too fast to read -> still not
// enough per the next round of real-device feedback ("a second more" than
// what 900ms was giving). 1900ms leaves ~1450ms of settled time after the
// 450ms count-up animation finishes, well past just barely legible.
const RESULT_VISIBLE_MS = 1900
// Gives the result card's own exit animation (see CrowdResultCard's
// `transition`) time to fully finish before the next question mounts.
const RESULT_EXIT_MS = 180

export default function CardStack({ onCategoriesChange, dragX }) {
  const reducedMotion = usePrefersReducedMotion()
  const [posts, setPosts] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [swipesLeft, setSwipesLeft] = useState(getSwipesLeft())
  // 'question' | 'result' | 'none' — which card .card-stack is currently
  // showing. 'none' is a deliberate brief gap between the result card
  // finishing its own exit animation and the next question mounting — see
  // scheduleAdvance. Sequencing is done entirely with our own timers rather
  // than by relying on AnimatePresence's mode="wait" to signal when an
  // exiting child (SwipeCard has no `exit` prop of its own — its exit is
  // self-driven via internal state) has actually finished; that dependency
  // was found to stall the transition indefinitely in this framer-motion
  // version, echoing this codebase's existing distrust of animation-complete
  // callbacks.
  const [phase, setPhase] = useState('question')
  // { id, postId, vote, status: 'saving' | 'saved' | 'error', result }
  const [reveal, setReveal] = useState(null)
  const [showHint, setShowHint] = useState(!localStorage.getItem(HINT_KEY))
  // True from the moment a swipe succeeds until the next card is ready to be
  // interacted with — blocks drag/tap so a rapid second swipe can't record a
  // second vote. `locked` (state) drives the UI; `lockedRef` is the actual
  // guard inside handleSwiped, since two swipes fired within the same tick
  // (e.g. a drag-end and a fallback tap racing each other) would otherwise
  // both close over the same stale `locked === false` from before either
  // commit had re-rendered.
  const [locked, setLocked] = useState(false)
  const lockedRef = useRef(false)
  const hasSwipedRef = useRef(false)
  // Whether a fetch has ever come back with zero fresh posts — i.e. this
  // device has actually voted on everything available, as opposed to just
  // being between prefetch batches. Distinguishes the two in the empty
  // state below so "still loading more" doesn't look like "nothing left".
  const [hasMore, setHasMore] = useState(true)
  const hasMoreRef = useRef(true)
  const loadingMoreRef = useRef(false)
  const revealIdRef = useRef(0)
  // Whether the in-flight vote for the current revealId has already failed
  // to save — checked right before the optimistically-scheduled advance
  // actually fires, so a slow failure can still cancel it in time. See
  // saveVote/handleSwiped.
  const revealErrorRef = useRef(false)
  const enterTimeoutRef = useRef(null)
  const advanceTimeoutRef = useRef(null)
  const nextTimeoutRef = useRef(null)
  const unlockTimeoutRef = useRef(null)

  // Shared by the initial load and the background prefetch below — fetches
  // every approved post NOT in excludeIds, filters locally-hidden ones, and
  // returns them with user-submitted posts shuffled ahead of the seed pool
  // (so a fresh Spill gets seen soon rather than buried in the much larger
  // starter set). Returns null on a hard query error so callers can tell
  // that apart from "zero posts came back" (genuine exhaustion).
  async function fetchApprovedPosts(excludeIds) {
    let query = supabase.from('posts').select('*').eq('status', 'approved').limit(2000)
    if (excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`)
    }
    const { data, error } = await query
    if (error) return null

    const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5)
    const all = filterHidden(data || [])
    const userSubmitted = shuffle(all.filter((p) => p.source === 'user_submitted'))
    const rest = shuffle(all.filter((p) => p.source !== 'user_submitted'))
    return [...userSubmitted, ...rest]
  }

  const loadPosts = useCallback(async () => {
    setLoading(true)
    const device_id = getDeviceId()

    // A device should never be shown a card it has already voted on, no
    // matter how many days/sessions later — fetch this device's own voting
    // history first so it can be excluded from the pool query itself
    // (cheaper than fetching everything and filtering client-side, and
    // stays cheap as the seed pool grows into the thousands).
    const { data: votedRows, error: votedError } = await supabase
      .from('votes')
      .select('post_id')
      .eq('device_id', device_id)

    if (votedError) console.error('voted-history load failed', votedError)
    const votedIds = (votedRows || []).map((v) => v.post_id)

    const fresh = await fetchApprovedPosts(votedIds)
    if (fresh === null) {
      console.error('load failed')
      setLoading(false)
      return
    }

    hasMoreRef.current = fresh.length > 0
    setHasMore(hasMoreRef.current)
    setPosts(fresh)
    setIndex(0)
    setLoading(false)
  }, [])

  useEffect(() => { loadPosts() }, [loadPosts])
  useEffect(() => () => {
    clearTimeout(enterTimeoutRef.current)
    clearTimeout(advanceTimeoutRef.current)
    clearTimeout(nextTimeoutRef.current)
    clearTimeout(unlockTimeoutRef.current)
  }, [])

  const current = posts[index]
  const next = posts[index + 1]

  // Tops up the loaded batch quietly, in the background, well before the
  // user could actually reach the end of it — see PREFETCH_THRESHOLD. Runs
  // on every index/posts change but exits immediately unless the remaining
  // unseen count is actually low, so in practice this only touches the
  // network every ~50 swipes, not every swipe.
  useEffect(() => {
    if (loading || !hasMoreRef.current || loadingMoreRef.current) return
    if (posts.length - index > PREFETCH_THRESHOLD) return

    loadingMoreRef.current = true
    ;(async () => {
      const device_id = getDeviceId()
      const { data: votedRows } = await supabase.from('votes').select('post_id').eq('device_id', device_id)
      const votedIds = (votedRows || []).map((v) => v.post_id)
      const loadedIds = posts.map((p) => p.id)
      const excludeIds = [...new Set([...votedIds, ...loadedIds])]

      const fresh = await fetchApprovedPosts(excludeIds)
      loadingMoreRef.current = false
      if (fresh === null) { console.error('prefetch failed'); return }
      if (fresh.length === 0) { hasMoreRef.current = false; setHasMore(false); return }
      setPosts((prev) => [...prev, ...fresh])
    })()
  }, [index, posts, loading])

  // Report current/next category up to App.jsx — it owns the background,
  // which needs both (the next one only to pre-paint the layer being
  // revealed underneath).
  useEffect(() => {
    onCategoriesChange?.({ current: current?.category ?? null, next: next?.category ?? null })
  }, [current?.category, next?.category, onCategoriesChange])

  function advanceToNextPost() {
    // Just increments — the prefetch effect above keeps the batch topped up
    // well before this could run past the end of it. If it somehow does
    // (prefetch still in flight, or hasMoreRef is genuinely false), `current`
    // becomes undefined and the empty-state below takes over rather than
    // this blocking on a fresh reload mid-swipe.
    setIndex((i) => i + 1)
    unlockTimeoutRef.current = setTimeout(() => {
      lockedRef.current = false
      setLocked(false)
    }, ENTRANCE_DURATION)
  }

  // Saves the vote, then fetches the live result, updating `reveal` as each
  // step resolves. Deliberately does NOT drive the advance-to-next-card
  // timer anymore (see scheduleAdvance's call site in handleSwiped) — that
  // used to run from here, meaning the pager's pacing was only ever as fast
  // as two sequential network round-trips. On a real phone that latency is
  // variable and stacks with the fixed UI timers, which is exactly what
  // "fine for the first few swipes, then it keeps getting slower" looks
  // like — confirmed by testing with heap/DOM-node measurements across 15
  // rapid swipes (both stayed flat, ruling out an actual JS memory leak)
  // before finding the network coupling in this function. `revealId` still
  // guards every state write against a newer vote (or a fresh retry) having
  // superseded this call while it was in flight.
  async function saveVote(postId, vote, revealId) {
    const device_id = getDeviceId()
    const { error } = await supabase.from('votes').insert({ post_id: postId, device_id, vote })

    if (revealIdRef.current !== revealId) return

    if (error && error.code !== '23505') {
      console.error('vote failed', error)
      // The normal-path advance was already scheduled optimistically (see
      // handleSwiped) — a genuinely failed save has to cancel it and wait
      // for an explicit retry instead of silently advancing past an unsaved
      // vote.
      revealErrorRef.current = true
      clearTimeout(advanceTimeoutRef.current)
      clearTimeout(nextTimeoutRef.current)
      setReveal((r) => (r && r.id === revealId ? { ...r, status: 'error' } : r))
      return
    }

    const { data: result } = await supabase
      .from('post_results')
      .select('*')
      .eq('post_id', postId)
      .single()

    if (revealIdRef.current !== revealId) return

    setReveal((r) => (r && r.id === revealId ? { ...r, status: 'saved', result } : r))
  }

  // Result stays up just long enough to read, then hides itself (phase
  // 'none' — nothing rendered) for exactly as long as its own exit
  // animation takes, and only then does the next question mount. Two
  // separate timers, not one combined step, so the result card is
  // guaranteed to be fully gone before the next question ever appears.
  function scheduleAdvance(revealId) {
    clearTimeout(advanceTimeoutRef.current)
    advanceTimeoutRef.current = setTimeout(() => {
      if (revealIdRef.current !== revealId) return
      setPhase('none')
      clearTimeout(nextTimeoutRef.current)
      nextTimeoutRef.current = setTimeout(() => {
        if (revealIdRef.current !== revealId) return
        setReveal(null)
        setPhase('question')
        advanceToNextPost()
      }, RESULT_EXIT_MS)
    }, RESULT_VISIBLE_MS)
  }

  function handleSwiped(vote) {
    if (lockedRef.current) return // already mid-transition — ignore duplicate taps/drags
    lockedRef.current = true
    hasSwipedRef.current = true
    setLocked(true)

    if (showHint) {
      setShowHint(false)
      localStorage.setItem(HINT_KEY, '1')
    }
    setSwipesLeft(recordSwipe())

    // Skipping still uses up today's swipe allowance (above), but there's no
    // opinion to record and no result to show — just clear the way for the
    // next card once this one's exit finishes.
    if (vote === 'skip') {
      advanceTimeoutRef.current = setTimeout(advanceToNextPost, SKIP_ADVANCE_DELAY)
      return
    }

    const post = posts[index]
    revealIdRef.current += 1
    const revealId = revealIdRef.current
    revealErrorRef.current = false
    setReveal({ id: revealId, postId: post.id, vote, status: 'saving', result: null })

    // The question card must be completely gone before the result card
    // appears — wait out its own swipe-exit animation first. scheduleAdvance
    // fires from right here, the instant the result actually becomes
    // visible, rather than from whenever the vote-save network call happens
    // to resolve — see saveVote's own comment for why that coupling was the
    // real cause of swiping feeling like it degraded over a session.
    clearTimeout(enterTimeoutRef.current)
    enterTimeoutRef.current = setTimeout(() => {
      if (revealIdRef.current !== revealId) return
      setPhase('result')
      if (!revealErrorRef.current) scheduleAdvance(revealId)
    }, RESULT_ENTER_DELAY)

    saveVote(post.id, vote, revealId)
  }

  function handleRetryVote() {
    if (!reveal || reveal.status !== 'error') return
    const { id, postId, vote } = reveal
    revealErrorRef.current = false
    setReveal((r) => (r && r.id === id ? { ...r, status: 'saving' } : r))
    scheduleAdvance(id)
    saveVote(postId, vote, id)
  }

  const outOfSwipes = swipesLeft <= 0

  return (
    <div className="feed-tab">
      <h1 className="feed-title">sus<WordmarkDot dragX={dragX} /></h1>
      <div className="feed-meta">
        {outOfSwipes ? (
          <span>come back tomorrow ✨</span>
        ) : (
          <span>{swipesLeft} left today ✦</span>
        )}
      </div>

      <div className="card-stack">
        {loading && <p className="muted-text">Loading…</p>}

        {!loading && outOfSwipes && (
          <div className="empty-state">
            <p>You're all caught up for today 🎉</p>
            <p className="muted-text">Check Crowd Picks while you wait, or come back tomorrow.</p>
          </div>
        )}

        {/* hasMore distinguishes "the prefetch just hasn't landed yet"
            (index caught up to a still-in-flight background fetch) from
            actually having voted on everything available — the former
            should read as a brief pause, not a dead end. */}
        {!loading && !outOfSwipes && !current && hasMore && (
          <p className="muted-text">Loading more…</p>
        )}

        {!loading && !outOfSwipes && !current && !hasMore && (
          <div className="empty-state">
            <p>No cards yet. Be the first to Spill one 👀</p>
          </div>
        )}

        {/* Both cards are plain-conditional, not wrapped in AnimatePresence.
            CrowdResultCard's `exit` used a spring transition that doesn't
            resolve to "done" (and so doesn't get unmounted by
            AnimatePresence) within the RESULT_EXIT_MS gap this component's
            own timers already allot for it — the two ran on independent
            clocks and could leave it visually lingering well past when
            `phase` had already moved on to the next question, which is
            exactly what "never simultaneously visible" forbids. Plain
            conditionals remove a card from the DOM the instant its
            condition goes false — synchronous, not dependent on any
            animation library's own completion detection. CrowdResultCard
            still animates in freely on mount (only its *exit* needed
            AnimatePresence); it now just disappears instantly rather than
            fading out, which is a fair trade for the correctness guarantee. */}
        {!loading && !outOfSwipes && phase === 'question' && current && (
          <SwipeCard
            key={`q-${current.id}`}
            post={current}
            onSwiped={handleSwiped}
            locked={locked}
            skipEntrance={index === 0 && !hasSwipedRef.current}
            dragX={dragX}
            safetyBanner={
              current.safety_flag ? (
                <div className="safety-banner">
                  {SAFETY_BANNER.text}
                </div>
              ) : null
            }
          />
        )}
        {!loading && !outOfSwipes && phase === 'result' && reveal && (
          <CrowdResultCard
            key={`r-${reveal.id}`}
            reveal={reveal}
            reducedMotion={reducedMotion}
            onRetry={handleRetryVote}
          />
        )}
      </div>

      {!loading && !outOfSwipes && current && (
        <>
          {showHint && phase === 'question' && <p className="swipe-hint">← red flag · relax → · skip ↑</p>}
          <div className="vote-area">
            <VoteButtons dragX={dragX} onVote={handleSwiped} locked={locked} />
          </div>
        </>
      )}
    </div>
  )
}
