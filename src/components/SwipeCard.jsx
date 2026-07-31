import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform } from 'framer-motion'
import { TAG_LABEL, tagStyleSolid } from '../lib/tags'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'
import { useFitText } from '../lib/useFitText'
import ReportButton from './ReportButton'

const DISTANCE_RATIO = 0.2 // fraction of card width that counts as a completed swipe
const VELOCITY_THRESHOLD = 380 // px/s — a fast flick completes the swipe even if short
const EXIT_DISTANCE = 900 // px the card travels off-screen on a successful swipe

const EXIT_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } // 200ms ease-out, no bounce
const SETTLE_SPRING = { type: 'spring', stiffness: 420, damping: 28, mass: 0.5 } // ~220ms, no overshoot
const REDUCED_MOTION_TRANSITION = { duration: 0.15, ease: 'easeOut' }

// The single active card. Only one of these is ever mounted for the voting
// screen — there is no stack and no visible next-card preview. Drag physics,
// exit, and the next card's entrance are all handled here; vote persistence
// and advancing to the next post live in the parent (CardStack).
//
// `dragX` is shared (owned by App.jsx, not created here) so the background
// color reveal, the wordmark dot, and the vote buttons can all react to the
// same live value the gesture is writing to, in real time, without any of
// them needing to re-render every frame. Because it's shared across every
// card that ever mounts here (not recreated per-card), it's explicitly
// reset to 0 on mount below — otherwise a new card would inherit whatever
// position the previous one exited to.
export default function SwipeCard({ post, onSwiped, locked, skipEntrance, dragX, safetyBanner }) {
  const reducedMotion = usePrefersReducedMotion()
  const cardRef = useRef(null)
  const x = dragX
  const y = useMotionValue(0)

  useEffect(() => {
    x.set(0)
  }, [x])

  // Piecewise so live drag (within ±250px) stays inside the ~7deg cap, while
  // a successful exit — which animates x out to ±EXIT_DISTANCE — eases up to
  // the slightly stronger ~10deg exit tilt via the same derived value, no
  // second rotation control needed.
  const rotate = useTransform(
    x,
    [-EXIT_DISTANCE, -250, 0, 250, EXIT_DISTANCE],
    reducedMotion ? [0, 0, 0, 0, 0] : [-10, -7, 0, 7, 10],
    { clamp: true }
  )
  const [exitVote, setExitVote] = useState(null)
  const hapticFiredRef = useRef(false)
  const { containerRef: textRef, fontSize } = useFitText(post.text)

  function handleDragStart() {
    hapticFiredRef.current = false
  }

  function handleDrag(_, info) {
    // One subtle selection tick the instant a horizontal drag first crosses
    // the completion threshold — not repeated while the finger stays past
    // it. No-ops silently on browsers without the Vibration API (iOS Safari
    // notably doesn't have one).
    if (hapticFiredRef.current) return
    const width = cardRef.current?.offsetWidth || (typeof window !== 'undefined' ? window.innerWidth : 400)
    if (Math.abs(info.offset.x) > width * DISTANCE_RATIO && Math.abs(info.offset.x) > Math.abs(info.offset.y)) {
      hapticFiredRef.current = true
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10)
    }
  }

  function handleDragEnd(_, info) {
    if (exitVote || locked) return
    const width = cardRef.current?.offsetWidth || (typeof window !== 'undefined' ? window.innerWidth : 400)
    const height = cardRef.current?.offsetHeight || (typeof window !== 'undefined' ? window.innerHeight : 600)

    // Swipe up = skip. Checked first, and only when the gesture is more
    // vertical than horizontal, so a diagonal flick still resolves to
    // whichever direction actually dominated it.
    const isMostlyVertical = Math.abs(info.offset.y) > Math.abs(info.offset.x)
    const passedUpDistance = -info.offset.y > height * DISTANCE_RATIO
    const passedUpVelocity = -info.velocity.y > VELOCITY_THRESHOLD
    if (isMostlyVertical && info.offset.y < 0 && (passedUpDistance || passedUpVelocity)) {
      setExitVote('skip')
      onSwiped('skip')
      return
    }

    const passedDistance = Math.abs(info.offset.x) > width * DISTANCE_RATIO
    const passedVelocity = Math.abs(info.velocity.x) > VELOCITY_THRESHOLD
    if (!passedDistance && !passedVelocity) return // framer springs x/y back to the animate target below

    const vote = info.offset.x < 0 ? 'red_flag' : 'relax'
    setExitVote(vote)
    onSwiped(vote)
  }

  const animateTarget = reducedMotion
    ? { opacity: exitVote ? 0 : 1 }
    : exitVote === 'skip'
      ? { x: 0, y: -EXIT_DISTANCE, opacity: 1, scale: 1 }
      : exitVote
        ? { x: exitVote === 'red_flag' ? -EXIT_DISTANCE : EXIT_DISTANCE, y: 0, opacity: 1, scale: 1 }
        : { x: 0, y: 0, opacity: 1, scale: 1 }

  const transition = reducedMotion ? REDUCED_MOTION_TRANSITION : exitVote ? EXIT_TRANSITION : SETTLE_SPRING

  return (
    <motion.div
      ref={cardRef}
      className="swipe-card"
      style={reducedMotion ? undefined : { x, y, rotate }}
      drag={!locked && !exitVote ? true : false}
      dragConstraints={{ top: -2000, bottom: 10, left: -2000, right: 2000 }}
      dragElastic={{ top: 1, bottom: 0.4, left: 1, right: 1 }}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      whileDrag={reducedMotion ? undefined : {
        scale: 1.015,
        boxShadow: '0 46px 84px -18px rgba(30,20,10,0.3), 0 14px 26px -10px rgba(30,20,10,0.16)',
      }}
      initial={skipEntrance ? false : reducedMotion ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.97 }}
      animate={animateTarget}
      transition={transition}
    >
      <div className="card-top-row">
        <span className="card-tag" style={tagStyleSolid(post.category)}>{TAG_LABEL[post.category] || post.category}</span>
        <ReportButton postId={post.id} authorId={post.device_id} />
      </div>

      {safetyBanner}

      <p className="card-text" ref={textRef} style={{ fontSize: `${fontSize}px` }}>{post.text}</p>
    </motion.div>
  )
}
