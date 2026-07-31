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
// arrived. Was 1050ms; cut way down after real-device feedback that the
// whole question->result->next loop felt sluggish for rapid-fire swiping —
// this is now tuned for "quick and addictive" over "let it sink in", at the
// cost of not much settled read time after the count-up animation
// (CrowdResultCard's own number/bar animation takes 450ms of this).
const RESULT_VISIBLE_MS = 650
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
  const revealIdRef = useRef(0)
  const enterTimeoutRef = useRef(null)
  const advanceTimeoutRef = useRef(null)
  const nextTimeoutRef = useRef(null)
  const unlockTimeoutRef = useRef(null)

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

    let query = supabase.from('posts').select('*').eq('status', 'approved').limit(2000)
    if (votedIds.length > 0) {
      query = query.not('id', 'in', `(${votedIds.join(',')})`)
    }
    const { data, error } = await query

    if (error) {
      console.error('load failed', error)
      setLoading(false)
      return
    }

    // Real people's submissions always queue ahead of the seed question
    // pool, so a fresh Spill actually gets seen soon instead of being
    // buried in the (much larger) starter-card pool — each group is still
    // shuffled on its own for variety.
    const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5)
    const all = filterHidden(data || [])
    const userSubmitted = shuffle(all.filter((p) => p.source === 'user_submitted'))
    const rest = shuffle(all.filter((p) => p.source !== 'user_submitted'))

    setPosts([...userSubmitted, ...rest])
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

  // Report current/next category up to App.jsx — it owns the background,
  // which needs both (the next one only to pre-paint the layer being
  // revealed underneath).
  useEffect(() => {
    onCategoriesChange?.({ current: current?.category ?? null, next: next?.category ?? null })
  }, [current?.category, next?.category, onCategoriesChange])

  function advanceToNextPost() {
    setIndex((i) => {
      const nextIndex = i + 1
      if (nextIndex >= posts.length) {
        loadPosts()
        return 0
      }
      return nextIndex
    })
    unlockTimeoutRef.current = setTimeout(() => {
      lockedRef.current = false
      setLocked(false)
    }, ENTRANCE_DURATION)
  }

  // Saves the vote, then fetches the live result. `revealId` guards every
  // state write against a newer vote (or a fresh retry) having superseded
  // this call while it was in flight — the result shown must always belong
  // to the card that was actually just voted on.
  async function saveVoteAndAdvance(postId, vote, revealId) {
    const device_id = getDeviceId()
    const { error } = await supabase.from('votes').insert({ post_id: postId, device_id, vote })

    if (revealIdRef.current !== revealId) return

    if (error && error.code !== '23505') {
      console.error('vote failed', error)
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
    scheduleAdvance(revealId)
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
    setReveal({ id: revealId, postId: post.id, vote, status: 'saving', result: null })

    // The question card must be completely gone before the result card
    // appears — wait out its own swipe-exit animation first.
    clearTimeout(enterTimeoutRef.current)
    enterTimeoutRef.current = setTimeout(() => {
      if (revealIdRef.current !== revealId) return
      setPhase('result')
    }, RESULT_ENTER_DELAY)

    saveVoteAndAdvance(post.id, vote, revealId)
  }

  function handleRetryVote() {
    if (!reveal || reveal.status !== 'error') return
    const { id, postId, vote } = reveal
    setReveal((r) => (r && r.id === id ? { ...r, status: 'saving' } : r))
    saveVoteAndAdvance(postId, vote, id)
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

        {!loading && !outOfSwipes && !current && (
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
