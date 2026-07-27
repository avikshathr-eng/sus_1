// A capped number of swipes per day — deliberate design choice, not a
// limitation. It's what makes Wordle/BeReal-style apps feel worth opening
// daily instead of an infinite scroll people binge once and abandon. It also
// stretches a small seed-content pool much further while the community is
// still small.
export const DAILY_LIMIT = 50

const KEY = 'sus_daily_swipes'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function getSwipesLeft() {
  const raw = localStorage.getItem(KEY)
  if (!raw) return DAILY_LIMIT
  const { date, count } = JSON.parse(raw)
  if (date !== todayStr()) return DAILY_LIMIT
  return Math.max(0, DAILY_LIMIT - count)
}

export function recordSwipe() {
  const raw = localStorage.getItem(KEY)
  let count = 0
  if (raw) {
    const parsed = JSON.parse(raw)
    count = parsed.date === todayStr() ? parsed.count : 0
  }
  count += 1
  localStorage.setItem(KEY, JSON.stringify({ date: todayStr(), count }))
  return Math.max(0, DAILY_LIMIT - count)
}
