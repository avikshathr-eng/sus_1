import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { supabase, getDeviceId } from '../lib/supabase'
import { getSwipesLeft, recordSwipe, DAILY_LIMIT } from '../lib/dailyLimit'
import { SAFETY_BANNER } from '../lib/safetyResources'
import SwipeCard from './SwipeCard'
import ResultToast from './ResultToast'

const HINT_KEY = 'sus_seen_swipe_hint'

export default function CardStack() {
  const [posts, setPosts] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [swipesLeft, setSwipesLeft] = useState(getSwipesLeft())
  const [toast, setToast] = useState(null) // { result, vote }
  const [showHint, setShowHint] = useState(!localStorage.getItem(HINT_KEY))

  const loadPosts = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('status', 'approved')
      .limit(200)

    if (error) {
      console.error('load failed', error)
      setLoading(false)
      return
    }

    setPosts([...(data || [])].sort(() => Math.random() - 0.5))
    setIndex(0)
    setLoading(false)
  }, [])

  useEffect(() => { loadPosts() }, [loadPosts])

  async function handleSwiped(vote) {
    if (showHint) {
      setShowHint(false)
      localStorage.setItem(HINT_KEY, '1')
    }
    const post = posts[index]
    const device_id = getDeviceId()

    const { error } = await supabase.from('votes').insert({ post_id: post.id, device_id, vote })
    if (error && error.code !== '23505') console.error('vote failed', error)

    const { data: result } = await supabase
      .from('post_results')
      .select('*')
      .eq('post_id', post.id)
      .single()

    setToast({ result, vote })
    setSwipesLeft(recordSwipe())

    setTimeout(() => {
      setToast(null)
      setIndex((i) => {
        const next = i + 1
        if (next >= posts.length) {
          loadPosts()
          return 0
        }
        return next
      })
    }, 1100)
  }

  const current = posts[index]
  const next = posts[index + 1]
  const outOfSwipes = swipesLeft <= 0

  return (
    <div className="feed-tab">
      <div className="feed-meta">
        {outOfSwipes ? (
          <span>come back tomorrow ✨</span>
        ) : (
          <span>today · {swipesLeft} left ✨</span>
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

        {!loading && !outOfSwipes && current && (
          <>
            {next && (
              <div className="swipe-card swipe-card-behind">
                <div className="card-top-row">
                  <span className="card-tag">&nbsp;</span>
                </div>
                <p className="card-text">&nbsp;</p>
              </div>
            )}
            <SwipeCard
              key={current.id}
              post={current}
              isTop
              onSwiped={handleSwiped}
              safetyBanner={
                current.safety_flag ? (
                  <div className="safety-banner">
                    {SAFETY_BANNER.text}{' '}
                    {SAFETY_BANNER.resources.map((r) => (
                      <a key={r.href} href={r.href}>{r.label}</a>
                    ))}
                  </div>
                ) : null
              }
            />
            <div className="tap-fallback">
              <button className="vote-btn red" onClick={() => handleSwiped('red_flag')} aria-label="Red flag">
                🚩
              </button>
              <button className="vote-btn green" onClick={() => handleSwiped('relax')} aria-label="Relax">
                😌
              </button>
            </div>
          </>
        )}

        <AnimatePresence>
          {toast && <ResultToast key="toast" result={toast.result} vote={toast.vote} />}
        </AnimatePresence>
      </div>

      {!loading && !outOfSwipes && current && showHint && (
        <p className="swipe-hint">← swipe left = red flag · swipe right = relax →</p>
      )}
    </div>
  )
}
