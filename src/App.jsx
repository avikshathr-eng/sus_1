import { useState } from 'react'
import { hasOnboarded, markOnboarded, hasConfirmedAge, hasAcceptedTos } from './lib/ageGate'
import Onboarding from './components/Onboarding'
import AgeGate from './components/AgeGate'
import BlockedUnder18 from './components/BlockedUnder18'
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

  if (stage === 'onboarding') {
    return <Onboarding onDone={() => { markOnboarded(); setStage(isGated() ? 'app' : 'age-gate') }} />
  }

  if (stage === 'age-gate') {
    return <AgeGate onConfirmed={() => setStage('app')} onUnder18={() => setStage('blocked')} />
  }

  if (stage === 'blocked') {
    return <BlockedUnder18 />
  }

  const bgClass = tab === 'feed' ? 'bg-feed' : tab === 'crowd' ? 'bg-crowd' : 'bg-spill'

  return (
    <div className={`app ${bgClass}`}>
      <div className="header">
        <div className="logo">sus<span className="dot">.</span></div>
        <button className="nav-link" onClick={() => setShowLegal(true)}>how it works</button>
      </div>

      {tab === 'feed' && <CardStack />}
      {tab === 'crowd' && <CrowdPicks />}
      {tab === 'spill' && <Spill />}

      <BottomNav active={tab} onChange={setTab} />

      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
    </div>
  )
}
