// Tracks which post ids this device has submitted, purely client-side —
// there's no login, so this list (not a server-side "my posts" query) is
// what powers "Your Posts" / delete-my-submissions. Populated at the
// moment a submission succeeds (see Spill.jsx).
const KEY = 'sus_my_post_ids'

export function getMyPostIds() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export function addMyPostId(id) {
  const ids = getMyPostIds()
  if (!ids.includes(id)) {
    localStorage.setItem(KEY, JSON.stringify([id, ...ids].slice(0, 200)))
  }
}

export function removeMyPostId(id) {
  localStorage.setItem(KEY, JSON.stringify(getMyPostIds().filter((x) => x !== id)))
}
