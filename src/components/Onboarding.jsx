import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { PALETTE } from '../lib/tags'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'
import ConfessionCards from './onboarding/ConfessionCards'
import CrowdVerdict from './onboarding/CrowdVerdict'
import AskSusCard from './onboarding/AskSusCard'

// Matches --ink in styles.css — hardcoded here (not read from the CSS var)
// because framer-motion's color interpolation needs a literal color value
// to animate toward, same reason VoteButtons.jsx/CrowdResultCard.jsx do the
// same for --flag/--relax.
const INK = '#221e1a'
const INACTIVE_DOT = 'rgba(34,30,26,0.16)'

// Mirrors SwipeCard's own drag-completion tuning (distance ratio + velocity
// threshold) rather than a bare 50% round, so the pager's commit feel
// matches the rest of the app's swipe gestures. 0.22 sits in the requested
// 20-25% band.
const DISTANCE_RATIO = 0.22
const VELOCITY_THRESHOLD = 500
// How long after triggering a page transition before this screen's own
// "arrival" flourishes (the verdict count-up, the Ask-sus card's spring-in,
// the CTA reveal) fire. A fixed delay rather than trusting framer's
// animation-complete callback — same reasoning CardStack.jsx documents for
// its own ENTRANCE_DURATION: that callback isn't reliable for a value
// that's simultaneously driven by an active drag gesture.
const SETTLE_DELAY_MS = 380
// Must match `.app, .onboarding, .gate-screen { max-width: 480px }` in
// styles.css — the true hard ceiling on this container's width. Used only
// as a sanity clamp on the ResizeObserver measurement below: on first
// paint, before the flex/max-width layout has fully settled, the observer
// can report the raw window width instead of the constrained container
// width for one frame. Clamping to the CSS rule's own declared ceiling
// fixes the symptom regardless of the exact browser-timing cause.
const MAX_APP_WIDTH = 480

const SCREENS = [
  {
    id: 'opinions',
    bg: PALETTE[0], // lavender
    label: 'Swipe · Judge · Repeat',
    headline: <>Everyone has opinions.</>,
    support: "Let's hear yours.",
    Visual: ConfessionCards,
  },
  {
    id: 'verdict',
    bg: PALETTE[3], // pink-red
    headline: <>Every swipe counts.</>,
    support: 'Thousands of tiny judgments become one answer.',
    Visual: CrowdVerdict,
  },
  {
    id: 'ask',
    bg: PALETTE[1], // butter-yellow
    headline: <>Got your own story?</>,
    support: 'Ask Sus. Let the crowd weigh in.',
    Visual: AskSusCard,
    isLast: true,
  },
]

function clampIndex(i) {
  return Math.min(Math.max(i, 0), SCREENS.length - 1)
}

// A dedicated component (not inlined in a .map()) so its useTransform calls
// respect React's rules of hooks — see the identical reasoning in
// CrowdVerdict.jsx's VerdictDot.
function ProgressDot({ i, pageProgress }) {
  const width = useTransform(pageProgress, [i - 1, i, i + 1], [6, 20, 6], { clamp: true })
  const background = useTransform(pageProgress, [i - 1, i, i + 1], [INACTIVE_DOT, INK, INACTIVE_DOT], { clamp: true })
  return (
    <motion.span
      className="onboard-progress-dot"
      style={{ width, background }}
      aria-hidden="true"
    />
  )
}

export default function Onboarding({ onDone }) {
  const reducedMotion = usePrefersReducedMotion()
  const viewportRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(
    () => Math.min(typeof window !== 'undefined' ? window.innerWidth : 390, MAX_APP_WIDTH)
  )
  const [index, setIndex] = useState(0)
  // Which screen has fully "arrived" — see SETTLE_DELAY_MS above. Distinct
  // from `index`, which updates the instant a transition is triggered.
  const [settledIndex, setSettledIndex] = useState(0)
  const trackX = useMotionValue(0)
  const settleTimeoutRef = useRef(null)
  // Screen 3's entrance flourishes (card spring-in, the two response chips)
  // are triggered from here, in goToIndex, rather than from a useEffect
  // inside AskSusCard itself — verified by direct testing that an
  // animate() call on a motion value made from a child's own useEffect
  // does not reliably restart/complete this deep inside the draggable
  // pager track, while animate() called from this exact function (already
  // used for the page-snap spring itself) does. Passed down as plain
  // motion-value props; ConfessionCards/CrowdVerdict simply don't use them.
  const askCardEntrance = useMotionValue(0)
  const askFlagEntrance = useMotionValue(0)
  const askRelaxEntrance = useMotionValue(0)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setViewportWidth(Math.min(entry.contentRect.width, MAX_APP_WIDTH))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // trackX is stored in absolute px, computed against whatever viewportWidth
  // was true at the time it was last set. If the viewport width changes
  // (device rotation, browser resize) without this, trackX keeps its old
  // pixel value while dragConstraints/pageProgress silently start using the
  // new width — the two go out of sync and the page no longer sits where
  // its own index says it should. Re-snap it to the current index whenever
  // the measured width changes, including the first real measurement.
  useEffect(() => {
    trackX.set(-index * viewportWidth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportWidth])

  useEffect(() => () => clearTimeout(settleTimeoutRef.current), [])

  // 0 at page 1, 1 at page 2, 2 at page 3 — continuous and fractional while
  // dragging, so every screen's decorative motion and the progress dots can
  // derive straight from the same live gesture instead of duplicating drag
  // state anywhere.
  const pageProgress = useTransform(
    trackX,
    [-2 * viewportWidth, -viewportWidth, 0],
    [2, 1, 0]
  )
  const bgColor = useTransform(pageProgress, [0, 1, 2], [SCREENS[0].bg, SCREENS[1].bg, SCREENS[2].bg])

  function goToIndex(target) {
    const clamped = clampIndex(target)
    setIndex(clamped)
    clearTimeout(settleTimeoutRef.current)
    animate(trackX, -clamped * viewportWidth, reducedMotion
      ? { duration: 0.2, ease: 'easeOut' }
      : { type: 'spring', stiffness: 300, damping: 32 }
    )
    settleTimeoutRef.current = setTimeout(() => setSettledIndex(clamped), SETTLE_DELAY_MS)

    if (clamped === SCREENS.length - 1) {
      const spring = { type: 'spring', stiffness: 320, damping: 28 }
      if (reducedMotion) {
        askCardEntrance.set(1)
        askFlagEntrance.set(1)
        askRelaxEntrance.set(1)
      } else {
        animate(askCardEntrance, 1, spring)
        animate(askFlagEntrance, 1, { ...spring, delay: 0.15 })
        animate(askRelaxEntrance, 1, { ...spring, delay: 0.35 })
      }
    } else {
      askCardEntrance.set(0)
      askFlagEntrance.set(0)
      askRelaxEntrance.set(0)
    }
  }

  // Mirrors SwipeCard.jsx's own handleDragEnd exactly: commit decision is
  // driven by `info.offset.x` (the gesture's raw pointer displacement since
  // drag start, as framer reports it) rather than by re-deriving distance
  // from the constrained motion value's current position. Those two can
  // diverge near drag boundaries (elastic resistance pulls the visual
  // position back before release), which was under-committing real swipes.
  function handleDragEnd(_, info) {
    const passedDistance = Math.abs(info.offset.x) > viewportWidth * DISTANCE_RATIO
    const passedVelocity = Math.abs(info.velocity.x) > VELOCITY_THRESHOLD
    let target = index
    if (passedDistance || passedVelocity) {
      target = info.offset.x < 0 ? index + 1 : index - 1
    }
    goToIndex(target)
  }

  const isLast = index === SCREENS.length - 1

  return (
    <motion.div className="app onboarding" style={{ backgroundColor: bgColor }}>
      <div className="onboard-header">
        {!isLast ? (
          <button className="onboard-skip" onClick={onDone} aria-label="Skip onboarding">
            Skip
          </button>
        ) : <span />}
        <div className="onboard-progress" role="progressbar" aria-label="Onboarding progress" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={SCREENS.length}>
          {SCREENS.map((_, i) => <ProgressDot key={i} i={i} pageProgress={pageProgress} />)}
        </div>
        <span />
      </div>

      <div className="onboard-viewport" ref={viewportRef}>
        <motion.div
          className="onboard-track"
          style={{ x: trackX, width: viewportWidth * SCREENS.length }}
          drag="x"
          dragDirectionLock
          dragConstraints={viewportRef}
          dragElastic={0.12}
          onDragEnd={handleDragEnd}
        >
          {SCREENS.map((s, i) => (
            <div className="onboard-page" key={s.id} style={{ width: viewportWidth }}>
              <div className="onboard-visual">
                <s.Visual
                  pageProgress={pageProgress}
                  active={settledIndex === i}
                  reducedMotion={reducedMotion}
                  cardEntrance={askCardEntrance}
                  flagEntrance={askFlagEntrance}
                  relaxEntrance={askRelaxEntrance}
                />
              </div>
              {s.label && <p className="onboard-label">{s.label}</p>}
              <h1 className="onboard-headline">{s.headline}</h1>
              <p className="onboard-support">{s.support}</p>
            </div>
          ))}
        </motion.div>
      </div>

      <div className="onboard-footer">
        {isLast ? (
          <button className="btn-primary full onboard-cta" onClick={onDone} aria-label="Start swiping">
            Start swiping
          </button>
        ) : (
          <button
            className="onboard-next-btn"
            onClick={() => goToIndex(index + 1)}
            aria-label={`Go to screen ${index + 2} of ${SCREENS.length}`}
          >
            <ArrowRight size={22} />
          </button>
        )}
      </div>
    </motion.div>
  )
}
