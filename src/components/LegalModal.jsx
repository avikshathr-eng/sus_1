import { useEffect, useRef, useState } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { INFO_TITLE, INFO_INTRO, INFO_SECTIONS } from '../lib/legalText'
import { SUPPORT_EMAIL } from '../lib/config'
import { getLocalDataSummary, deleteAllMySubmissions, resetDevice } from '../lib/deviceData'
import { getMyPostIds } from '../lib/myPosts'

function AccordionItem({ id, heading, open, onToggle, children }) {
  const panelId = `info-panel-${id}`
  const btnId = `info-btn-${id}`
  return (
    <div className="info-accordion-item">
      <h3 className="info-accordion-heading">
        <button
          id={btnId}
          className="info-accordion-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
        >
          {heading}
          <ChevronDown size={16} className={`info-accordion-chevron ${open ? 'open' : ''}`} />
        </button>
      </h3>
      {open && (
        <div id={panelId} role="region" aria-labelledby={btnId} className="info-accordion-panel">
          {children}
        </div>
      )}
    </div>
  )
}

function YourDataSection({ onOpenPrivacy }) {
  const [summary] = useState(getLocalDataSummary)
  const [manageOpen, setManageOpen] = useState(false)
  const [deleteState, setDeleteState] = useState('idle') // idle | empty | working | done
  const [deleteProgress, setDeleteProgress] = useState(null)
  const [resetState, setResetState] = useState('idle') // idle | confirm | working | done

  async function handleDeleteSubmissions() {
    if (getMyPostIds().length === 0) {
      setDeleteState('empty')
      return
    }
    setDeleteState('working')
    const result = await deleteAllMySubmissions(setDeleteProgress)
    setDeleteProgress(result)
    setDeleteState('done')
  }

  function handleReset() {
    setResetState('working')
    resetDevice()
    setResetState('done')
    setTimeout(() => window.location.reload(), 900)
  }

  return (
    <>
      <p>
        sus. doesn't have accounts, so there's no server-side profile to manage — everything
        below lives only in this browser.
      </p>

      <div className="info-btn-row">
        <button className="btn-secondary" onClick={onOpenPrivacy}>Privacy Policy</button>
        <button className="btn-secondary" onClick={() => setManageOpen((v) => !v)}>Manage my data</button>
      </div>

      {manageOpen && (
        <div className="info-data-summary">
          <p>{summary.submissionCount} submission{summary.submissionCount === 1 ? '' : 's'} tracked on this device.</p>
          <p>{summary.swipesUsedToday} swipe{summary.swipesUsedToday === 1 ? '' : 's'} used today.</p>
          <p className="muted-text small">
            Also stored locally: a random device id (never shown to anyone) and any posts or
            accounts you've chosen to hide.
          </p>
        </div>
      )}

      <div className="info-btn-row">
        {(deleteState === 'idle' || deleteState === 'empty') && (
          <button className="btn-secondary" onClick={handleDeleteSubmissions}>Delete my submissions</button>
        )}
        {deleteState === 'working' && (
          <button className="btn-secondary" disabled>
            Deleting… {deleteProgress ? `${deleteProgress.deleted + deleteProgress.failed}/${deleteProgress.total}` : ''}
          </button>
        )}
        {deleteState === 'done' && (
          <button className="btn-secondary" disabled>Done — {deleteProgress?.deleted ?? 0} deleted</button>
        )}
      </div>
      {deleteState === 'empty' && <p className="muted-text small">No submissions tracked on this device yet.</p>}
      {deleteState === 'done' && deleteProgress?.failed > 0 && (
        <p className="muted-text small">{deleteProgress.failed} couldn't be deleted — try again later.</p>
      )}

      <div className="info-btn-row">
        {resetState === 'idle' && (
          <button className="btn-secondary danger" onClick={() => setResetState('confirm')}>Reset my device</button>
        )}
        {resetState === 'confirm' && (
          <>
            <button className="btn-secondary danger" onClick={handleReset}>Tap again to confirm</button>
            <button className="btn-secondary" onClick={() => setResetState('idle')}>Cancel</button>
          </>
        )}
        {(resetState === 'working' || resetState === 'done') && (
          <button className="btn-secondary" disabled>Resetting…</button>
        )}
      </div>
      <p className="muted-text small">
        sus. doesn't have accounts, so there's nothing called "your account" to delete — this is
        the honest equivalent. It clears this device's id, hidden-post list, and daily swipe
        count from this browser. It does not delete posts you've already submitted — use
        "Delete my submissions" above for that.
      </p>
    </>
  )
}

function LegalContactSection({ onOpenSection }) {
  return (
    <>
      <ul className="info-link-list">
        <li><button className="info-text-link" onClick={() => onOpenSection('community-rules')}>Terms of Use</button></li>
        <li><button className="info-text-link" onClick={() => onOpenSection('privacy')}>Privacy Policy</button></li>
        <li><button className="info-text-link" onClick={() => onOpenSection('community-rules')}>Community Guidelines</button></li>
        <li><a className="info-text-link" href={`mailto:${SUPPORT_EMAIL}`}>Report a problem</a></li>
      </ul>
      <p className="muted-text small">
        Questions, removal requests, or anything else: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </>
  )
}

export default function LegalModal({ onClose }) {
  const scrollRef = useRef(null)
  const sectionRefs = useRef({})
  const [openIds, setOpenIds] = useState(
    () => new Set(INFO_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.id))
  )

  // Always opens scrolled to top — this component is freshly mounted each
  // time the sheet opens (App.jsx renders it conditionally), so a mount-time
  // reset is enough; no need to track open/close transitions separately.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [])

  function toggle(id) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openAndScrollTo(id) {
    setOpenIds((prev) => new Set(prev).add(id))
    requestAnimationFrame(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="info-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="info-sheet-header">
          <h2 className="info-sheet-title">{INFO_TITLE}</h2>
          <button className="icon-btn-circle" onClick={onClose} aria-label="Close information">
            <X size={18} />
          </button>
        </div>

        <div className="info-sheet-body" ref={scrollRef}>
          <p className="info-sheet-intro">{INFO_INTRO}</p>

          {INFO_SECTIONS.map((s) => (
            <div key={s.id} ref={(el) => { sectionRefs.current[s.id] = el }}>
              <AccordionItem id={s.id} heading={s.heading} open={openIds.has(s.id)} onToggle={toggle}>
                {s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
              </AccordionItem>
            </div>
          ))}

          <div ref={(el) => { sectionRefs.current['your-data'] = el }}>
            <AccordionItem id="your-data" heading="Your data" open={openIds.has('your-data')} onToggle={toggle}>
              <YourDataSection onOpenPrivacy={() => openAndScrollTo('privacy')} />
            </AccordionItem>
          </div>

          <div ref={(el) => { sectionRefs.current['legal-contact'] = el }}>
            <AccordionItem id="legal-contact" heading="Legal and contact" open={openIds.has('legal-contact')} onToggle={toggle}>
              <LegalContactSection onOpenSection={openAndScrollTo} />
            </AccordionItem>
          </div>
        </div>

        <div className="info-sheet-footer">
          <button className="btn-primary full" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
