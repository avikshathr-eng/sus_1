import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import OnboardingSwipeDemo from './OnboardingSwipeDemo'

// Slides 1 and 3 reference illustration files — drop your exported PNGs into
// /public with these exact names (see CLAUDE.md) and they'll render here.
// Slide 2 is a live interactive demo instead of a static image, so the swipe
// mechanic is felt, not just described.
const SLIDES = [
  {
    image: '/onboarding-1.png',
    headline: <>Real takes,<br />real people.</>,
    body: 'A community-led space to get honest opinions on anything — dating, money, family, friends.',
  },
  {
    demo: true,
    headline: <>Scroll. Swipe.<br />Repeat.</>,
    body: 'See everyday situations, swipe left for red flag or right to relax, and keep the vibe moving.',
  },
  {
    image: '/onboarding-3.png',
    headline: <>Spill it<br />anonymously.</>,
    body: 'Share one short situation and see where the crowd lands. Nobody knows who said what.',
  },
]

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0)
  const isLast = index === SLIDES.length - 1
  const slide = SLIDES[index]

  return (
    <div className="onboarding">
      <div className="header">
        <div className="logo">sus<span className="dot">.</span></div>
        {!isLast && <button className="nav-link" onClick={onDone}>skip</button>}
      </div>

      <div className="onboarding-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            className="onboarding-slide"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <div className="onboarding-visual">
              {slide.demo ? <OnboardingSwipeDemo /> : <img src={slide.image} alt="" />}
            </div>
            <h1 className="onboarding-headline">{slide.headline}</h1>
            <p className="onboarding-copy">{slide.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="dots">
        {SLIDES.map((_, i) => (
          <span key={i} className={`dot-indicator ${i === index ? 'dot-active' : ''}`} onClick={() => setIndex(i)} />
        ))}
      </div>

      <button
        className="fab"
        onClick={() => (isLast ? onDone() : setIndex(index + 1))}
      >
        {isLast ? 'Get started' : 'Next'} →
      </button>
    </div>
  )
}
