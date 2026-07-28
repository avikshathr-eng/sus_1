// Icon-only floating pill. Order matches the Feed's centrality: Crowd Picks
// (browse what's already been judged) on the left, the swipeable Feed in
// the middle as the default landing tab, Spill (add a new one) on the right.
const TABS = [
  { id: 'crowd', label: 'Crowd Picks', icon: FlameIcon },
  { id: 'feed', label: 'Feed', icon: LayersIcon },
  { id: 'spill', label: 'Spill', icon: PencilIcon },
]

function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="bottom-nav">
      {TABS.map((t) => {
        const Icon = t.icon
        return (
          <button
            key={t.id}
            className={`nav-icon-btn ${active === t.id ? 'nav-icon-btn-active' : ''}`}
            onClick={() => onChange(t.id)}
            aria-label={t.label}
            title={t.label}
          >
            <Icon />
          </button>
        )
      })}
    </nav>
  )
}
