// Client-side-only "hide this post." There are no user accounts, so this
// can't sync across devices — it's scoped to this browser, which is an
// honest limitation, not a full block.
//
// "Hide this account" used to live here too, keyed by the post's raw
// device_id (see git history) — that's gone now. It required the client to
// already hold another device's raw identifier just to store a hide-list
// entry, which is exactly the kind of client-side device_id exposure the
// feed-distribution/security redesign closed off. The equivalent feature
// is now hideAuthor() in src/lib/reportActions.js, which calls the
// hide_author(requesting_device_id, post_id) database function — the
// server resolves the author from post_id internally and this client never
// sees or stores a raw author id again.
const HIDDEN_POSTS_KEY = 'sus_hidden_posts'

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

// Returns a plain array of hidden post ids — the shape get_feed's
// p_hidden_post_ids parameter expects (server-side eligibility now
// excludes voted/skipped/owned/author-blocked posts itself; this is the
// one exclusion still sourced from the client, since individual post-hides
// were never meant to sync anywhere).
export function getHiddenPostIds() {
  return [...getSet(HIDDEN_POSTS_KEY)]
}
