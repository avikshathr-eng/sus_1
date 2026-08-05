import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform } from 'framer-motion'
import { TAG_LABEL, tagStyleSolid } from '../lib/tags'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'
import { useFitText } from '../lib/useFitText'
import ReportButton from './ReportButton'

const DISTANCE_RATIO = 0.20 // fraction of viewport width that counts as a completed left/right swipe
const UP_DISTANCE_RATIO = 0.10 // fraction of viewport height that counts as a completed skip — deliberately a much smaller fraction than DISTANCE_RATIO so skip doesn't need a proportionally longer drag than a vote does
const VELOCITY_THRESHOLD = 650 // px/s — a fast horizontal flick completes the swipe even if short
const UP_VELOCITY_THRESHOLD = 600 // px/s — a fast upward flick completes a skip even if short
const HORIZONTAL_VELOCITY_MIN_OFFSET = 24 // px — a horizontal velocity commit still requires the card to have actually moved this much, so a tap/jitter can't fire a vote
const UP_VELOCITY_MIN_OFFSET = 28 // px — same guard for upward velocity commits
const LOCK_DISTANCE = 12 // px of combined drag before an intended direction is decided
const HORIZONTAL_LOCK_RATIO = 1.15 // |x| must exceed |y| by this much to lock the gesture horizontal
const UP_LOCK_RATIO = 1.05 // |y| must exceed |x| by this much to lock the gesture upward — intentionally more forgiving than the horizontal ratio
const CROSS_AXIS_DAMP = 0.15 // how much of the "wrong" axis is still allowed to show once a direction is locked
const EXIT_DISTANCE_RATIO_X = 1.35 // × viewport width — how far left/right the card travels on a committed vote
const EXIT_DISTANCE_RATIO_Y = 1.15 // × viewport height — how far up the card travels on a committed skip

const EXIT_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] } // 220ms ease-out, no bounce — fixed duration so no card's exit is ever slower than another's, regardless of release velocity
const SETTLE_SPRING = { type: 'spring', stiffness: 420, damping: 28, mass: 0.5 } // ~220ms, no overshoot
const REDUCED_MOTION_TRANSITION = { duration: 0.15, ease: 'easeOut' }

function viewportSize() {
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 400,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }
}

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
  const x = dragX
  const y = useMotionValue(0)
  // Recomputed per render (cheap) rather than cached — thresholds and exit
  // targets should track the real viewport, including an orientation change
  // mid-session, not whatever size happened to be current on first mount.
  const { width: viewportWidth, height: viewportHeight } = viewportSize()
  const exitDistanceX = viewportWidth * EXIT_DISTANCE_RATIO_X
  const exitDistanceY = viewportHeight * EXIT_DISTANCE_RATIO_Y

  // Synchronous (pre-paint) so a freshly-mounted card can never render, even
  // for a single frame, at whatever x the previous card's exit animation
  // left the shared dragX value at — plain useEffect runs after paint, which
  // left a window (small, but real) for that stale position to flash before
  // being reset back to 0.
  useLayoutEffect(() => {
    x.set(0)
    y.set(0)
  }, [x, y])

  // Piecewise so live drag (within ±250px) stays inside the ~7deg cap, while
  // a successful exit — which animates x out to ±exitDistanceX — eases up to
  // the slightly stronger ~10deg exit tilt via the same derived value, no
  // second rotation control needed.
  const rotate = useTransform(
    x,
    [-exitDistanceX, -250, 0, 250, exitDistanceX],
    reducedMotion ? [0, 0, 0, 0, 0] : [-10, -7, 0, 7, 10],
    { clamp: true }
  )
  const [exitVote, setExitVote] = useState(null)
  const hapticFiredRef = useRef(false)
  // 'none' | 'left' | 'right' | 'up' | 'down' — decided early in the drag
  // (see handleDrag) and then held for the rest of the gesture. Deciding
  // this only at release (the previous behavior) is what let diagonal
  // gestures resolve inconsistently and let a diagonal finger path leak
  // horizontal background color into what the user experienced as an
  // upward skip.
  const activeDirectionRef = useRef('none')
  const { containerRef: textRef, fontSize } = useFitText(post.text)

  function handleDragStart() {
    hapticFiredRef.current = false
    activeDirectionRef.current = 'none'
  }

  // Same lock decision used live (here) and as a release-time fallback in
  // handleDragEnd for a gesture that ends before ever crossing LOCK_DISTANCE
  // (a very short, fast flick).
  function lockedDirectionFor(ox, oy) {
    if (Math.abs(ox) > Math.abs(oy) * HORIZONTAL_LOCK_RATIO) return ox < 0 ? 'left' : 'right'
    if (oy < 0 && Math.abs(oy) > Math.abs(ox) * UP_LOCK_RATIO) return 'up'
    if (oy > 0) return 'down'
    return 'none'
  }

  function handleDrag(_, info) {
    if (exitVote || locked) return
    const { width, height } = viewportSize()
    const { x: ox, y: oy } = info.offset

    if (activeDirectionRef.current === 'none' && Math.max(Math.abs(ox), Math.abs(oy)) >= LOCK_DISTANCE) {
      activeDirectionRef.current = lockedDirectionFor(ox, oy)
    }
    const dir = activeDirectionRef.current

    // Once locked, damp whichever axis isn't the committed one — keeps a
    // horizontal vote from visibly drifting vertically, and (more
    // importantly) keeps an upward skip's x near zero, since x is the same
    // shared value the background-color reveal and vote buttons read from.
    // This runs after framer's own per-frame write to x/y, overriding it —
    // the standard pattern for adding custom resistance to a framer drag.
    if (dir === 'left' || dir === 'right') {
      y.set(oy * CROSS_AXIS_DAMP)
    } else if (dir === 'up' || dir === 'down') {
      x.set(ox * CROSS_AXIS_DAMP)
    }

    // One subtle tick the instant the locked direction first crosses its
    // own completion threshold — not repeated while the finger stays past
    // it. No-ops silently on browsers without the Vibration API (iOS Safari
    // notably doesn't have one). Skip's tick is lighter than a vote's.
    if (hapticFiredRef.current) return
    if ((dir === 'left' || dir === 'right') && Math.abs(ox) > width * DISTANCE_RATIO) {
      hapticFiredRef.current = true
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10)
    } else if (dir === 'up' && -oy > height * UP_DISTANCE_RATIO) {
      hapticFiredRef.current = true
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(6)
    }
  }

  function handleDragEnd(_, info) {
    if (exitVote || locked) return
    const { width, height } = viewportSize()
    const { x: ox, y: oy } = info.offset
    const { x: vx, y: vy } = info.velocity

    // Use the direction locked in during the drag, not a fresh read of the
    // final offset — a gesture that was clearly a leftward vote the whole
    // time shouldn't flip to something else because the release frame
    // happened to jitter. Only falls back to deciding from the final
    // offset when the drag ended before ever reaching LOCK_DISTANCE.
    const dir = activeDirectionRef.current === 'none' ? lockedDirectionFor(ox, oy) : activeDirectionRef.current

    if (dir === 'left' || dir === 'right') {
      const passedDistance = Math.abs(ox) >= width * DISTANCE_RATIO
      const passedVelocity = Math.abs(vx) >= VELOCITY_THRESHOLD && Math.abs(ox) >= HORIZONTAL_VELOCITY_MIN_OFFSET
      if (!passedDistance && !passedVelocity) return // framer springs x/y back to the animate target below
      const vote = dir === 'left' ? 'red_flag' : 'relax'
      setExitVote(vote)
      onSwiped(vote)
      return
    }

    if (dir === 'up') {
      const passedDistance = -oy >= height * UP_DISTANCE_RATIO
      const passedVelocity = -vy >= UP_VELOCITY_THRESHOLD && -oy >= UP_VELOCITY_MIN_OFFSET
      if (!passedDistance && !passedVelocity) return
      setExitVote('skip')
      onSwiped('skip')
      return
    }

    // 'down' never commits anything — always springs back to center.
  }

  const animateTarget = reducedMotion
    ? { opacity: exitVote ? 0 : 1 }
    : exitVote === 'skip'
      ? { x: 0, y: -exitDistanceY, opacity: 1, scale: 1 }
      : exitVote
        ? { x: exitVote === 'red_flag' ? -exitDistanceX : exitDistanceX, y: 0, opacity: 1, scale: 1 }
        : { x: 0, y: 0, opacity: 1, scale: 1 }

  const transition = reducedMotion ? REDUCED_MOTION_TRANSITION : exitVote ? EXIT_TRANSITION : SETTLE_SPRING

  return (
    <motion.div
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
