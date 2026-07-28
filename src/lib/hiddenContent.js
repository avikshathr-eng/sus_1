// Client-side-only "hide this post" / "hide posts from this account."
// There are no user accounts, so this can't sync across devices — it's
// scoped to this browser, which is an honest limitation, not a full block.
// `device_id` is used only as an internal key here; it is never rendered
// anywhere in the UI.
const HIDDEN_POSTS_KEY = 'sus_hidden_posts'
const HIDDEN_AUTHORS_KEY = 'sus_hidden_authors'

function getSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'))
  } catch {
    return new Set()
  }
}
function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]))
}

export function hidePost(postId) {
  const s = getSet(HIDDEN_POSTS_KEY)
  s.add(postId)
  saveSet(HIDDEN_POSTS_KEY, s)
}

export function hideAuthor(deviceId) {
  if (!deviceId) return
  const s = getSet(HIDDEN_AUTHORS_KEY)
  s.add(deviceId)
  saveSet(HIDDEN_AUTHORS_KEY, s)
}

// Drops posts that are individually hidden, or whose (internal-only)
// device_id belongs to a hidden account.
export function filterHidden(posts) {
  const hiddenPosts = getSet(HIDDEN_POSTS_KEY)
  const hiddenAuthors = getSet(HIDDEN_AUTHORS_KEY)
  if (hiddenPosts.size === 0 && hiddenAuthors.size === 0) return posts
  return posts.filter((p) => !hiddenPosts.has(p.id) && !(p.device_id && hiddenAuthors.has(p.device_id)))
}
