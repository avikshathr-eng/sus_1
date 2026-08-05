import { useState } from 'react'
import { useMotionValue } from 'framer-motion'
import { Info } from 'lucide-react'
import { hasOnboarded, markOnboarded, hasConfirmedAge, hasAcceptedTos } from './lib/ageGate'
import Onboarding from './components/Onboarding'
import AgeGate from './components/AgeGate'
import BlockedUnder18 from './components/BlockedUnder18'
import SwipeBackground from './components/SwipeBackground'
import FullScreenAgreementResult from './components/FullScreenAgreementResult'
import BottomNav from './components/BottomNav'
import CardStack from './components/CardStack'
import CrowdPicks from './components/CrowdPicks'
import Spill from './components/Spill'
import LegalModal from './components/LegalModal'

const isGated = () => hasConfirmedAge() && hasAcceptedTos()

// Simple state-machine flow — no router needed for 3 stages + 3 tabs.
function getInitialStage() {
  if (!hasOnboarded()) return 'onboarding'
  if (!isGated()) return 'age-gate'
  return 'app'
}

export default function App() {
  const [stage, setStage] = useState(getInitialStage())
  const [tab, setTab] = useState('feed')
  const [showLegal, setShowLegal] = useState(false)
  // The active card's category — CardStack reports this up as a plain
  // category id for the feed's resting background color.
  const [currentCategory, setCurrentCategory] = useState(null)
  // { vote: 'red_flag' | 'relax', redFlagPercentage, relaxPercentage } while
  // a full-screen vote result is being shown, else null. Reported up by
  // CardStack (see its onVoteResultChange) rather than owned there, because
  // this needs to render as a full-app-bleed layer alongside
  // SwipeBackground — CardStack's own .card-stack slot is a bounded box
  // partway down the page, not the whole screen.
  const [voteResult, setVoteResult] = useState(null)
  // If Spill is opened via "Edit & resubmit" from Your Posts (Crowd Picks),
  // this pre-fills the form with the flagged submission's text/category.
  const [spillDraft, setSpillDraft] = useState(null)
  // Owned here (not in CardStack) specifically so it can be handed straight
  // down to both CardStack→SwipeCard (which drives it via the drag gesture)
  // and SwipeBackground (which only reads it) without any React state
  // round-trip — a motion value update never triggers a re-render.
  const dragX = useMotionValue(0)

  if (stage === 'onboarding') {
    return <Onboarding onDone={() => { markOnboarded(); setStage(isGated() ? 'app' : 'age-gate') }} />
  }

  if (stage === 'age-gate') {
    return <AgeGate onConfirmed={() => setStage('app')} onUnder18={() => setStage('blocked')} />
  }

  if (stage === 'blocked') {
    return <BlockedUnder18 />
  }

  function openSpillDraft(draft) {
    setSpillDraft(draft)
    setTab('spill')
  }

  return (
    <div className="app">
      {tab === 'feed' && (
        <SwipeBackground currentCategory={currentCategory} dragX={dragX} />
      )}
      {tab === 'feed' && voteResult && (
        <FullScreenAgreementResult
          selectedAnswer={voteResult.vote === 'red_flag' ? 'redFlag' : 'relax'}
          redFlagPercentage={voteResult.redFlagPercentage}
          relaxPercentage={voteResult.relaxPercentage}
        />
      )}

      <div className="header">
        <button className="icon-btn-circle" onClick={() => setShowLegal(true)} aria-label="How it works" title="How it works">
          <Info size={18} />
        </button>
      </div>

      {tab === 'feed' && (
        <CardStack onCategoryChange={setCurrentCategory} onVoteResultChange={setVoteResult} dragX={dragX} />
      )}
      {tab === 'crowd' && <CrowdPicks onEditPost={openSpillDraft} />}
      {tab === 'spill' && (
        <Spill draft={spillDraft} onDraftConsumed={() => setSpillDraft(null)} />
      )}

      <BottomNav active={tab} onChange={setTab} />

      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
    </div>
  )
}
