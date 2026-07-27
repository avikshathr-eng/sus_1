const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'crowd', label: 'Crowd Picks' },
  { id: 'spill', label: 'Spill' },
]

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`nav-pill ${active === t.id ? 'nav-pill-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
