import { LEGAL_TEXT } from '../lib/legalText'

export default function LegalModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal legal-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{LEGAL_TEXT.title}</h3>
        {LEGAL_TEXT.sections.map((s) => (
          <div key={s.heading} className="legal-section">
            <h4>{s.heading}</h4>
            <p>{s.body}</p>
          </div>
        ))}
        <button className="btn-primary full" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
