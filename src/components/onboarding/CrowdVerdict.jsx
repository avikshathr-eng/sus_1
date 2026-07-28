import { useEffect, useState } from 'react'
import { motion, useTransform } from 'framer-motion'
import { PALETTE } from '../../lib/tags'

const RED_PCT = 72

// Skips PALETTE[2] (mint/teal) deliberately — onboarding stays within
// lavender / pink-red / butter-yellow / ink / white only, no green.
const DOT_COLORS = [PALETTE[0], PALETTE[3], PALETTE[1], '#221e1a']

// Deterministic ring of small profile marks around the center — angle in
// degrees, radius in px from center, size in px. Two loose "rings" rather
// than one, so it reads as a crowd, not a clock face.
const DOTS = [0, 40, 80, 120, 160, 200, 240, 280, 320].map((angle, i) => ({
  angle,
  radius: i % 2 === 0 ? 96 : 122,
  size: i % 3 === 0 ? 11 : 8,
  color: DOT_COLORS[i % DOT_COLORS.length],
  floatDelay: (i * 0.35).toFixed(2),
}))

const RING_RADIUS = 58
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
  const collapseX = useTransform(funnel, [0, 1], [0, 140 - x])
  const collapseY = useTransform(funnel, [0, 1], [0, 140 - y])
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
        animationDelay: reducedMotion ? undefined : `${d.floatDelay}s`,
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
  // "funnels" inward rather than just fading.
  const funnel = useTransform(pageProgress, [1, 2], [0, 1], { clamp: true })

  const redDisplay = useCountUp(RED_PCT, active, reducedMotion)
  const dashOffset = RING_CIRCUMFERENCE * (1 - redDisplay / 100)

  return (
    <div className="onboard-verdict-wrap" aria-hidden="true">
      <motion.svg
        className="onboard-verdict-orbits"
        viewBox="0 0 280 280"
        style={{ opacity: visibility }}
      >
        <circle cx="140" cy="140" r="96" className="onboard-orbit-line" />
        <circle cx="140" cy="140" r="122" className="onboard-orbit-line" />
      </motion.svg>

      {DOTS.map((d, i) => {
        const x = 140 + d.radius * Math.cos((d.angle * Math.PI) / 180)
        const y = 140 + d.radius * Math.sin((d.angle * Math.PI) / 180)
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

      <motion.div className="onboard-verdict-center" style={{ opacity: visibility, scale }}>
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
          <span className="onboard-verdict-primary">{redDisplay}% <span className="onboard-verdict-label">RED FLAG</span></span>
          <span className="onboard-verdict-secondary">{100 - redDisplay}% RELAX</span>
        </div>
      </motion.div>
    </div>
  )
}
