import { motion } from 'framer-motion'

// Brief percentage reveal shown right after a swipe, then auto-dismisses.
export default function ResultToast({ result, vote }) {
  const redPct = result?.red_flag_pct ?? 0
  const verdict = vote === 'red_flag' ? 'red flag' : 'relax'
  const pctForVote = vote === 'red_flag' ? redPct : 100 - redPct

  return (
    <motion.div
      className="result-toast"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <strong>{pctForVote.toFixed(0)}%</strong> of the crowd agrees — {verdict}
    </motion.div>
  )
}
