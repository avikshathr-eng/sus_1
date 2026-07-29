import { useEffect, useState } from 'react'
import { motion, useTransform } from 'framer-motion'
import { PALETTE } from '../../lib/tags'

const RED_PCT = 72

// Skips PALETTE[2] (mint/teal) deliberately — onboarding stays within
// lavender / pink-red / butter-yellow / ink / white only, no green.
const DOT_COLORS = [PALETTE[0], PALETTE[3], PALETTE[1], '#221e1a']

const WRAP = 320
const CENTER = WRAP / 2
const RING_R = 132
const DOT_COUNT = 26

// One ring of small, mostly-uniform dots the crowd sits ON (radius jitter
// is tiny — organic, not a perfectly robotic gear-tooth spacing, but never
// enough to read as "planets at different orbits" the way two distinct
// radii used to). Deterministic, not random, so layout doesn't reshuffle
// between renders.
const DOTS = Array.from({ length: DOT_COUNT }, (_, i) => {
  const angle = (360 / DOT_COUNT) * i
  const jitter = (i % 5) - 2 // -2..2
  return {
    angle,
    radius: RING_R + jitter * 2,
    size: 6 + (i % 3), // 6-8px, small and mostly uniform
    color: DOT_COLORS[i % DOT_COLORS.length],
    pulseDelay: ((i % 8) * 0.28).toFixed(2),
  }
})

const RING_RADIUS = 62
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

// Counts 0 -> target once the screen becomes active (settled, not mid-drag)
// — mirrors CrowdResultCard's own count-up hook. Starts over from 0 each
// time the screen is re-entered, so revisiting it via a backward-then-
// forward swipe still feels alive rather than static.
function useCountUp(target, active, reducedMotion) {
  const [value, setValue] = useState(reducedMotion ? target : 0)
  useEffect(() => {
    if (!active) return
    if (reducedMotion) { setValue(target); return }
    setValue(0)
    let raf
    const start = performance.now()
    const duration = 650
    function tick(now) {
      const p = Math.min((now - start) / duration, 1)
      setValue(Math.round(target * p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, target, reducedMotion])
  return value
}

// Its own component (not inlined in a .map()) specifically so its
// useTransform calls follow React's rules of hooks — a fixed-length list
// mapped inline would call hooks in a loop, which works today only by
// accident of DOTS never changing length.
function VerdictDot({ d, x, y, funnel, visibility, scale, reducedMotion }) {
  const collapseX = useTransform(funnel, [0, 1], [0, CENTER - x])
  const collapseY = useTransform(funnel, [0, 1], [0, CENTER - y])
  return (
    <motion.span
      className="onboard-verdict-dot"
      style={{
        left: x,
        top: y,
        width: d.size,
        height: d.size,
        background: d.color,
        opacity: visibility,
        scale,
        x: collapseX,
        y: collapseY,
        animationDelay: reducedMotion ? undefined : `${d.pulseDelay}s`,
      }}
    />
  )
}

export default function CrowdVerdict({ pageProgress, active, reducedMotion }) {
  // 0 at either edge, 1 exactly at rest on this screen (index 1 of 0..2) —
  // naturally symmetric, so it reverses correctly on a backward drag too.
  const visibility = useTransform(pageProgress, [0, 1, 2], reducedMotion ? [1, 1, 1] : [0, 1, 0])
  const scale = useTransform(pageProgress, [0, 1, 2], reducedMotion ? [1, 1, 1] : [0.85, 1, 0.85])
  // Only engages on the forward half (heading toward screen 3) — the crowd
  // funnels inward rather than just fading.
  const funnel = useTransform(pageProgress, [1, 2], [0, 1], { clamp: true })

  const redDisplay = useCountUp(RED_PCT, active, reducedMotion)
  const dashOffset = RING_CIRCUMFERENCE * (1 - redDisplay / 100)

  return (
    <div className="onboard-verdict-wrap" aria-hidden="true">
      {/* Ring path + every dot rotate together as one group ("extremely
          slowly", per spec) — it's the structure the crowd stands on, not
          a decorative orbit trail, so it has to move with them. */}
      <motion.div className="onboard-verdict-spin" style={{ opacity: visibility }}>
        <svg className="onboard-verdict-ring-svg" viewBox={`0 0 ${WRAP} ${WRAP}`}>
          <circle cx={CENTER} cy={CENTER} r={RING_R} className="onboard-verdict-ring-path" />
        </svg>
        {DOTS.map((d, i) => {
          const x = CENTER + d.radius * Math.cos((d.angle * Math.PI) / 180)
          const y = CENTER + d.radius * Math.sin((d.angle * Math.PI) / 180)
          return (
            <VerdictDot
              key={i}
              d={d}
              x={x}
              y={y}
              funnel={funnel}
              visibility={visibility}
              scale={scale}
              reducedMotion={reducedMotion}
            />
          )
        })}
      </motion.div>

      {/* .onboard-verdict-center does the top:50%/left:50%/translate(-50%,-50%)
          CSS centering. That centering IS a `transform`, and framer-motion
          takes over the *entire* transform property on any element it
          writes a motion-value style to (here, `scale`) — putting `scale`
          on the same centered element silently discards the CSS centering
          transform. Splitting into an outer plain-CSS positioning layer and
          an inner framer-driven scale/opacity layer avoids the conflict,
          same principle as the nested idle-float cards elsewhere. */}
      <div className="onboard-verdict-center">
        <motion.div className="onboard-verdict-badge-motion" style={{ opacity: visibility, scale }}>
          <div className="onboard-verdict-badge">
            <svg className="onboard-verdict-ring" viewBox="0 0 132 132">
              <circle cx="66" cy="66" r={RING_RADIUS} className="onboard-verdict-ring-track" />
              <circle
                cx="66"
                cy="66"
                r={RING_RADIUS}
                className="onboard-verdict-ring-fill"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="onboard-verdict-text">
              <span className="onboard-verdict-primary">{redDisplay}%</span>
              <span className="onboard-verdict-label">RED FLAG</span>
              <span className="onboard-verdict-secondary">{100 - redDisplay}% RELAX</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
