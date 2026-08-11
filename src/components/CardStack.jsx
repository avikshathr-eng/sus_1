import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getDeviceId } from '../lib/supabase'
import { DAILY_LIMIT, getSwipesLeft, recordSwipe } from '../lib/dailyLimit'
import { FEED_BATCH_SIZE } from '../lib/feedDistribution'
import { getHiddenPostIds } from '../lib/hiddenContent'
import { diversifyCategories } from '../lib/categoryDiversity'
import { SAFETY_BANNER } from '../lib/safetyResources'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'
import { calculateDisplayedVoteSplit } from '../lib/voteSplit'
import SwipeCard from './SwipeCard'
import VoteButtons from './VoteButtons'
import CrowdResultCard from './CrowdResultCard'
import SusWordmark from './SusWordmark'

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
// How long the incoming card's own entrance animation (see SwipeCard's
// SETTLE_SPRING) takes to settle, counted from when it mounts. Voting is
// re-enabled on this fixed schedule rather than via an onAnimationComplete
// callback — framer-motion doesn't reliably fire that callback for a
// component whose x/y are simultaneously driven by `drag`, so a
// deterministic timer is the robust choice here.
const ENTRANCE_DURATION = 220
// Gives the outgoing question card's own swipe-exit animation (see
// SwipeCard's EXIT_TRANSITION, 220ms) time to fully finish — the result
// must never appear while the question it belongs to is still visible.
const RESULT_ENTER_DELAY = 220
// How long the result stays fully visible once it has arrived — vote (the
// new full-screen takeover) and skip (the split-bar card) share this same
// hold time so the feed's rhythm doesn't change depending on which one just
// happened.
const RESULT_VISIBLE_MS = 1400
// Gives the result card's own exit animation (see CrowdResultCard's
// `transition`) time to fully finish before the next question mounts.
const RESULT_EXIT_MS = 180
// Supabase's client has no built-in request timeout — on a bad mobile
// connection a stalled request can hang indefinitely, which leaves
// maybeRevealResult's data-gate permanently unsatisfied. By the time that
// happens the card has already exited and swept the shared dragX value (and
// with it, SwipeBackground's overlay) all the way to full red/green — so a
// hang here reads as "the screen is stuck on a solid red/green background"
// with no way out, since the polished full-screen takeover that would
// normally cover it never gets to show. Racing every network call in the
// reveal path against this timeout turns a hang into the same real-failure
// path saveVote already handles correctly, instead of an infinite wait.
const NETWORK_TIMEOUT_MS = 8000

function withTimeout(promise, ms = NETWORK_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ])
}

export default function CardStack({ onCategoryChange, onVoteResultChange, dragX }) {
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
  // Only meaningful once hasMore is false — distinguishes "literally zero
  // approved posts exist in the whole system" from "this device has
  // exhausted everything eligible for it," which need different empty-
  // state copy (see checkSystemHasAnyApprovedPosts and the render below).
  const [systemEmpty, setSystemEmpty] = useState(false)
  const loadingMoreRef = useRef(false)
  const revealIdRef = useRef(0)
  // Whether the in-flight vote for the current revealId has already failed
  // to save — checked right before the optimistically-scheduled advance
  // actually fires, so a slow failure can still cancel it in time. See
  // saveVote/handleSwiped.
  const revealErrorRef = useRef(false)
  // The result is only allowed to become visible once BOTH of these are true
  // for the current revealId: the outgoing card's exit animation has had
  // time to finish, AND the real percentages (or a definitive error) have
  // actually arrived. Gating on the timer alone — the previous approach —
  // meant a slow network could still be mid-flight when phase flipped to
  // 'result', so the result mounted showing the neutral 50/50 fallback and
  // then jumped to the real numbers a moment later once the fetch resolved.
  // That jump isn't the artificial counting animation this app deliberately
  // doesn't have, but it reads exactly the same to someone watching it.
  // There's no timeout-based fallback here at the UI-gate level — that was
  // tried once and, on a genuinely slow connection, could itself fire
  // moments before the real data arrived, revealing the placeholder and
  // then immediately overwriting it with the real value, which is the exact
  // flicker this gate exists to prevent. Instead saveVote/loadSkipResult
  // race their own network calls against NETWORK_TIMEOUT_MS: a merely slow
  // connection still waits for the real number with no flicker risk, but a
  // genuinely hung request (dropped connection, no response ever coming)
  // eventually rejects and resolves through the same real-failure path as
  // an actual error, via CrowdResultCard's retry UI — rather than leaving
  // this gate (and the swept-red/green background behind it) stuck forever.
  const resultTimerReadyRef = useRef(false)
  const resultDataReadyRef = useRef(false)
  const enterTimeoutRef = useRef(null)
  const advanceTimeoutRef = useRef(null)
  const nextTimeoutRef = useRef(null)
  const unlockTimeoutRef = useRef(null)

  // Server-side eligibility + distribution-ladder ranking — see get_feed()
  // (supabase/migrations/20260809000003_get_feed.sql). The server already
  // excludes voted/skipped/owned/author-blocked posts internally (it knows
  // this device's history directly, no separate lookup needed from here
  // anymore); the only exclusions still sourced from the client are
  // individually-hidden posts (hiddenContent.js, never meant to sync
  // anywhere) and whatever's already in the currently-loaded batch (so a
  // prefetch can't hand back something already on screen). Applies the
  // category-diversity reorder pass before returning — a pure local
  // reorder, doesn't change which posts are included or dropped. Returns
  // null on a hard query error so callers can tell that apart from "zero
  // posts came back" (genuine exhaustion).
  async function fetchFeedBatch(excludeIds, deviceId) {
    const { data, error } = await supabase.rpc('get_feed', {
      p_device_id: deviceId,
      p_limit: FEED_BATCH_SIZE,
      p_exclude_ids: excludeIds,
      p_hidden_post_ids: getHiddenPostIds(),
    })
    if (error) return null
    return diversifyCategories(data || [])
  }

  // get_feed() only ever answers "what's eligible for THIS device" — a
  // zero-row result can't distinguish "nothing exists in the whole system"
  // from "this device has voted/skipped/hidden/owns everything currently
  // eligible," and those need different empty-state copy (see the render
  // below). Only called on that rare empty-result path, never on every
  // fetch. Fails open (assumes posts exist) on a network error, since that
  // reads as the less alarming of the two empty states if something's
  // temporarily wrong.
  async function checkSystemHasAnyApprovedPosts() {
    const { count, error } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved')
    if (error) return true
    return (count ?? 0) > 0
  }

  const loadPosts = useCallback(async () => {
    setLoading(true)
    const device_id = getDeviceId()

    const fresh = await fetchFeedBatch([], device_id)
    if (fresh === null) {
      console.error('load failed')
      setLoading(false)
      return
    }

    if (fresh.length === 0) {
      setSystemEmpty(!(await checkSystemHasAnyApprovedPosts()))
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

  // Tops up the loaded batch quietly, in the background, well before the
  // user could actually reach the end of it — see PREFETCH_THRESHOLD. Runs
  // on every index/posts change but exits immediately unless the remaining
  // unseen count is actually low, so in practice this only touches the
  // network every ~PREFETCH_THRESHOLD swipes, not every swipe.
  useEffect(() => {
    if (loading || !hasMoreRef.current || loadingMoreRef.current) return
    if (posts.length - index > PREFETCH_THRESHOLD) return

    loadingMoreRef.current = true
    ;(async () => {
      const device_id = getDeviceId()
      const loadedIds = posts.map((p) => p.id)

      const fresh = await fetchFeedBatch(loadedIds, device_id)
      loadingMoreRef.current = false
      if (fresh === null) { console.error('prefetch failed'); return }
      if (fresh.length === 0) {
        hasMoreRef.current = false
        setHasMore(false)
        setSystemEmpty(!(await checkSystemHasAnyApprovedPosts()))
        return
      }
      setPosts((prev) => [...prev, ...fresh])
    })()
  }, [index, posts, loading])

  // Report the active card's category up to App.jsx, which owns the feed's
  // resting background color.
  useEffect(() => {
    onCategoryChange?.(current?.category ?? null)
  }, [current?.category, onCategoryChange])

  // Report the full-screen vote result up to App.jsx whenever one should be
  // showing — derived straight from `phase`/`reveal` (the single source of
  // truth already driving CrowdResultCard below) rather than tracked as
  // separate state, so it can never drift out of sync with what's actually
  // being held. Only fires for an actual vote: skip and a failed save keep
  // using CrowdResultCard's own split-bar/retry UI (see the render below),
  // so this explicitly excludes both.
  useEffect(() => {
    if (phase === 'result' && reveal && reveal.vote !== 'skip' && reveal.status !== 'error') {
      const { redPct, relaxPct } = reveal.result
        ? calculateDisplayedVoteSplit(reveal.result.red_flag_count, reveal.result.relax_count)
        : { redPct: 50, relaxPct: 50 }
      onVoteResultChange?.({ vote: reveal.vote, redFlagPercentage: redPct, relaxPercentage: relaxPct })
    } else {
      onVoteResultChange?.(null)
    }
  }, [phase, reveal, onVoteResultChange])

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
    // Routes through record-vote (service-role key) rather than inserting
    // into `votes` directly with the anon key — PostgREST is currently
    // rejecting every anon-key INSERT project-wide regardless of policy
    // (open Supabase support ticket), while the identical insert via
    // service-role works fine. See record-vote/index.ts for the full
    // explanation and how to revert this once Supabase confirms a fix.
    let error
    try {
      const { data, error: invokeError } = await withTimeout(
        supabase.functions.invoke('record-vote', { body: { post_id: postId, device_id, vote } })
      )
      error = invokeError || (data?.error ? new Error(data.error) : null)
    } catch (err) {
      error = err
    }

    if (revealIdRef.current !== revealId) return

    if (error) {
      console.error('vote failed', error)
      // The normal-path advance may already have been scheduled optimistically
      // (see maybeRevealResult/handleRetryVote) — a genuinely failed save has
      // to cancel it and wait for an explicit retry instead of silently
      // advancing past an unsaved vote.
      revealErrorRef.current = true
      clearTimeout(advanceTimeoutRef.current)
      clearTimeout(nextTimeoutRef.current)
      setReveal((r) => (r && r.id === revealId ? { ...r, status: 'error' } : r))
      resultDataReadyRef.current = true
      maybeRevealResult(revealId)
      return
    }

    // The vote itself is already saved at this point — a slow/failed
    // percentage fetch shouldn't block or error the whole reveal, just fall
    // back to the neutral 50/50 display (see the `reveal.result ? ... :
    // {redPct:50,...}` fallback in the onVoteResultChange effect below).
    let result = null
    try {
      const { data } = await withTimeout(
        supabase.from('post_results').select('*').eq('post_id', postId).single()
      )
      result = data
    } catch (err) {
      console.error('result fetch failed or timed out', err)
    }

    if (revealIdRef.current !== revealId) return

    setReveal((r) => (r && r.id === revealId ? { ...r, status: 'saved', result } : r))
    resultDataReadyRef.current = true
    maybeRevealResult(revealId)
  }

  // Skip never inserts a vote row — it only needs to read the post's
  // already-existing split so the result card can show it, the same as a
  // voter would see, without an "error" retry state: there's no submission
  // to lose if this read fails, so it just falls back to CrowdResultCard's
  // own neutral 50/50 display via a null result instead of blocking advance.
  //
  // It DOES persist the skip itself now (post_skips — see the feed-
  // distribution migrations), so get_feed excludes this post from ever
  // reappearing to this device, the same guarantee already given to voted
  // posts. Fired alongside the result fetch below, not awaited before it —
  // persisting the skip has no bearing on how fast the reveal can show; it
  // only needs to land before this post could ever be fetched again, which
  // has ample time regardless. A duplicate-skip race (code 23505, the
  // unique (post_id, device_id) constraint) is expected and harmless — the
  // post is already excluded either way — so it's the one error code this
  // deliberately doesn't log.
  async function loadSkipResult(postId, revealId) {
    // Routes through record-skip (service-role key) rather than inserting
    // into `post_skips` directly with the anon key — see saveVote's
    // identical comment above for why. Still fire-and-forget, not awaited
    // before the result fetch below.
    supabase
      .functions.invoke('record-skip', { body: { post_id: postId, device_id: getDeviceId() } })
      .then(({ data, error }) => {
        if (error || data?.error) console.error('skip persist failed', error || data?.error)
      })

    let result = null
    try {
      const { data, error } = await withTimeout(
        supabase.from('post_results').select('*').eq('post_id', postId).single()
      )
      if (error) console.error('skip result load failed', error)
      result = data
    } catch (err) {
      console.error('skip result load failed or timed out', err)
    }

    if (revealIdRef.current !== revealId) return
    setReveal((r) => (r && r.id === revealId ? { ...r, status: 'saved', result: result || null } : r))
    resultDataReadyRef.current = true
    maybeRevealResult(revealId)
  }

  // The single gate both the exit-animation timer and the data fetch report
  // to — only actually reveals the result once both have checked in for this
  // exact revealId. See resultTimerReadyRef/resultDataReadyRef above for why
  // this exists, and why there's deliberately no timeout-based fallback here.
  function maybeRevealResult(revealId) {
    if (revealIdRef.current !== revealId) return
    if (!resultTimerReadyRef.current || !resultDataReadyRef.current) return
    setPhase('result')
    if (!revealErrorRef.current) scheduleAdvance(revealId)
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

    // Skipping still uses up today's swipe allowance (above), but goes
    // through this exact same reveal pipeline as a vote now — it shows the
    // post's existing overall split (see loadSkipResult) rather than
    // recording an opinion. Same pacing as a vote, just no insert.
    const post = posts[index]
    revealIdRef.current += 1
    const revealId = revealIdRef.current
    revealErrorRef.current = false
    resultTimerReadyRef.current = false
    resultDataReadyRef.current = false
    setReveal({ id: revealId, postId: post.id, vote, status: 'saving', result: null })

    // The question card must be completely gone before the result appears —
    // wait out its own swipe-exit animation first. But the timer alone isn't
    // sufficient either: the result must never actually mount showing a
    // number that isn't the real one, so maybeRevealResult also waits for
    // the data fetch (below) to report in — whichever of the two finishes
    // last is what actually reveals it. On a normal connection the fetch
    // already started well before this timer and wins the race, so nothing
    // about the felt timing changes; only a slow connection waits a little
    // longer than usual rather than showing a wrong number first.
    clearTimeout(enterTimeoutRef.current)
    enterTimeoutRef.current = setTimeout(() => {
      resultTimerReadyRef.current = true
      maybeRevealResult(revealId)
    }, RESULT_ENTER_DELAY)

    if (vote === 'skip') {
      loadSkipResult(post.id, revealId)
    } else {
      saveVote(post.id, vote, revealId)
    }
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
      <h1 className="feed-title"><SusWordmark className="sus-wordmark-feed" dragX={dragX} /></h1>
      <div className="feed-meta">
        {outOfSwipes ? (
          <span>come back tomorrow ✨</span>
        ) : (
          <span>{swipesLeft} left today ✦</span>
        )}
      </div>

      <div className="card-stack">
        {loading && <p className="muted-text">Loading…</p>}

        {/* Gated on phase === 'question', not just outOfSwipes — swipesLeft
            hits 0 the instant the LAST swipe is recorded (see handleSwiped),
            well before that swipe's own reveal has finished playing. Without
            this gate, this message rendered immediately underneath the
            still-in-flight full-screen result, then the result cleared to
            reveal the message already there — read as "the message, then
            the last card's percentage" rather than the intended order.
            Waiting for phase to settle back to 'question' means this only
            ever appears once the last reveal has genuinely finished. */}
        {!loading && outOfSwipes && phase === 'question' && (
          <div className="empty-state">
            <p>That's all {DAILY_LIMIT} for today 🎉</p>
            <p className="muted-text">Come back tomorrow for a fresh batch.</p>
          </div>
        )}

        {/* hasMore distinguishes "the prefetch just hasn't landed yet"
            (index caught up to a still-in-flight background fetch) from
            actually having voted on everything available — the former
            should read as a brief pause, not a dead end. */}
        {!loading && !outOfSwipes && !current && hasMore && (
          <p className="muted-text">Loading more…</p>
        )}

        {/* Two distinct exhaustion states, not one — systemEmpty (set by
            checkSystemHasAnyApprovedPosts, only ever checked on the rare
            zero-result path) distinguishes "literally nothing has been
            approved in the whole system yet" from "you personally have
            voted/skipped/hidden/own everything currently eligible," which
            read very differently to someone who's already an active user —
            the old single "Be the first to Spill one" message was
            genuinely misleading for the latter case. */}
        {!loading && !outOfSwipes && !current && !hasMore && systemEmpty && (
          <div className="empty-state">
            <p>No questions yet 👀</p>
            <p className="muted-text">Spill the first one.</p>
          </div>
        )}
        {!loading && !outOfSwipes && !current && !hasMore && !systemEmpty && (
          <div className="empty-state">
            <p>You're all caught up 👀</p>
            <p className="muted-text">Check back later or Spill something new.</p>
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
        {/* Skip and a failed save keep the split-bar/retry card in this slot;
            an actual Red Flag/Relax result now renders as a full-app-bleed
            layer up in App.jsx instead (see onVoteResultChange above) — this
            slot is left empty for that case, and the full-screen layer
            covers it regardless. */}
        {!loading && !outOfSwipes && phase === 'result' && reveal && (reveal.vote === 'skip' || reveal.status === 'error') && (
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
