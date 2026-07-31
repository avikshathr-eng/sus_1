import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { usePrefersReducedMotion } from '../lib/useReducedMotion'

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
// Must match `.app, .onboarding, .gate-screen { max-width: 480px }` in
// styles.css — the true hard ceiling on this container's width. Used only
// as a sanity clamp on the ResizeObserver measurement below: on first
// paint, before the flex/max-width layout has fully settled, the observer
// can report the raw window width instead of the constrained container
// width for one frame. Clamping to the CSS rule's own declared ceiling
// fixes the symptom regardless of the exact browser-timing cause.
const MAX_APP_WIDTH = 480

// Background colors + illustrations sampled/cropped directly from the
// user's own reference designs (not the app's global category PALETTE —
// this screen intentionally uses its own, more saturated set to match
// those references exactly). Each PNG has its own flat background
// chroma-keyed to transparent, so it sits directly on this animated
// background with no visible edge/seam as the color interpolates during
// a drag between screens.
// The onboarding-1.png source (the user's own "ex1" reference art) ships
// with blank cards — no "Anonymous" label or confession text baked in, by
// design this time: we render that text ourselves so it stays crisp at any
// resolution instead of depending on raster/AI-generated text. Position/
// rotation below are measured by pixel-probing the card edges in the source
// image (760x560 frame) — best-effort, not pixel-perfect, since there's no
// live-browser pass to visually confirm the fit in this environment.
const CONFESSION_CARDS = [
  { label: 'Anonymous', text: 'He still texts his ex. 👀', top: 26.5, left: 42, width: 34, rotate: -8 },
  { label: 'Anonymous', text: 'She cancelled plans last minute again. 🤔', top: 69, left: 60.5, width: 34, rotate: 12 },
]

const SCREENS = [
  {
    id: 'opinions',
    bg: '#98A0ED', // lavender
    headline: <>We all have opinions.</>,
    support: 'Real dilemmas, real people. Judge, swipe, repeat.',
    image: '/onboarding-1.png',
  },
  {
    id: 'verdict',
    bg: '#E79CBD', // pink
    headline: <>Every swipe counts.</>,
    support: 'Hundreds of tiny opinions become one answer.',
    image: '/onboarding-2.png',
  },
  {
    id: 'ask',
    bg: '#FDCB8C', // peach
    headline: <>Got your own story?<br />Ask SUS.</>,
    support: 'Share anonymously. Get real opinions. Help the community.',
    image: '/onboarding-3.png',
    isLast: true,
  },
]

function clampIndex(i) {
  return Math.min(Math.max(i, 0), SCREENS.length - 1)
}

// A dedicated component (not inlined in a .map()) so its useTransform calls
// respect React's rules of hooks — see the identical reasoning in
// OnboardingIllustration below.
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

// Its own component (not inlined in the .map() below) so its useTransform
// calls follow React's rules of hooks — a fixed-length list mapped inline
// would call hooks in a loop, which only works today by accident of SCREENS
// never changing length. Takes children rather than a hardcoded <img> so the
// opinions screen can render its image-plus-text-overlay frame through the
// same opacity/scale/parallax/idle-float wrapper as every other screen's
// plain image, instead of duplicating that logic.
function OnboardingIllustration({ index, pageProgress, reducedMotion, children }) {
  const visibility = useTransform(pageProgress, [index - 1, index, index + 1], [0, 1, 0], { clamp: true })
  const scale = useTransform(pageProgress, [index - 1, index, index + 1], [0.92, 1, 0.92], { clamp: true })
  const parallaxX = useTransform(
    pageProgress,
    [index - 1, index, index + 1],
    reducedMotion ? [0, 0, 0] : [26, 0, -26],
    { clamp: true }
  )
  return (
    <motion.div className="onboard-illustration-wrap" style={{ opacity: visibility, scale, x: parallaxX }}>
      <div className={reducedMotion ? undefined : 'onboard-illustration-float'}>
        {children}
      </div>
    </motion.div>
  )
}

export default function Onboarding({ onDone }) {
  const reducedMotion = usePrefersReducedMotion()
  const viewportRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(
    () => Math.min(typeof window !== 'undefined' ? window.innerWidth : 390, MAX_APP_WIDTH)
  )
  const [index, setIndex] = useState(0)
  const trackX = useMotionValue(0)

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
    animate(trackX, -clamped * viewportWidth, reducedMotion
      ? { duration: 0.2, ease: 'easeOut' }
      : { type: 'spring', stiffness: 300, damping: 32 }
    )
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
                <OnboardingIllustration index={i} pageProgress={pageProgress} reducedMotion={reducedMotion}>
                  {s.id === 'opinions' ? (
                    <div className="onboard-confess-frame">
                      <img src={s.image} alt="" className="onboard-confess-frame-img" draggable={false} />
                      {CONFESSION_CARDS.map((c, ci) => (
                        <div
                          key={ci}
                          className="onboard-confess-overlay"
                          style={{
                            top: `${c.top}%`,
                            left: `${c.left}%`,
                            width: `${c.width}%`,
                            transform: `translate(-50%, -50%) rotate(${c.rotate}deg)`,
                          }}
                        >
                          <span className="onboard-confess-overlay-label">{c.label}</span>
                          <p className="onboard-confess-overlay-text">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <img src={s.image} alt="" className="onboard-illustration-img" draggable={false} />
                  )}
                </OnboardingIllustration>
              </div>
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
