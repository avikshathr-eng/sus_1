import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { TAG_LABEL, formatCount } from '../lib/tags'

// Ranked by total votes (simple "most engaged with" heuristic for MVP — easy
// to swap for a fancier "controversial vs. landslide" score later).
export default function CrowdPicks() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('crowd_picks')
        .select('*')
        .order('total_votes', { ascending: false })
        .limit(30)

      if (error) {
        console.error('crowd picks load failed', error)
        setLoading(false)
        return
      }

      setRows(data || [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="crowd-tab">
      <h2>Crowd Picks</h2>
      <p className="muted-text">What everyone felt, softest to spiciest. Nobody knows who said what. 💜</p>

      {loading && <p className="muted-text">Loading…</p>}
      {!loading && rows.length === 0 && <p className="muted-text">No votes yet — go swipe a few cards first.</p>}

      {rows.map((post, i) => {
        const redPct = post.red_flag_pct ?? 0
        return (
          <div className="pick-card" key={post.id}>
            <div className="pick-top-row">
              <span className="card-tag">{TAG_LABEL[post.category] || post.category}</span>
              <span className="pick-pct">{redPct}%</span>
            </div>
            <p className="pick-text">{post.text}</p>
            <p className="muted-text small">{formatCount(post.total_votes)} votes · #{i + 1}</p>
            <div className="result-bar-track">
              <div className="result-bar-fill red" style={{ width: `${redPct}%` }} />
              <div className="result-bar-fill green" style={{ width: `${100 - redPct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
