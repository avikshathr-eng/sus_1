// A capped number of swipes per day — deliberate design choice, not a
// limitation. It's what makes Wordle/BeReal-style apps feel worth opening
// daily instead of an infinite scroll people binge once and abandon. It also
// stretches a small seed-content pool much further while the community is
// still small.
export const DAILY_LIMIT = 75

const KEY = 'sus_daily_swipes'

// Deliberately built from local date getters (getFullYear/getMonth/getDate),
// NOT toISOString() — toISOString() always reports UTC, so the "new day"
// boundary it produces is UTC midnight, not the device's actual local
// midnight. For anyone west of UTC (including every US timezone) that's a
// multi-hour gap where local midnight has already passed but the UTC date
// hasn't rolled over yet — the limit kept reading as exhausted for hours
// into the new local day ("used it yesterday, still says come back
// tomorrow" even after local midnight). Local getters make this roll over
// at the device's own midnight, which is what "refreshed at 12:00 AM"
// actually means to someone using the app.
function todayStr() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
