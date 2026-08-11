import { supabase, getDeviceId } from './supabase'

// Calls the hide_author(requesting_device_id, post_id) database function
// (see supabase/migrations/20260809000004_hide_author_and_my_votes.sql) —
// the server resolves the author from post_id and stores the block
// relationship in author_blocks. This device never receives or stores the
// author's raw device_id; only post_id (which it already legitimately has,
// as the post being reported) ever leaves the client.
export async function hideAuthor(postId) {
  const { error } = await supabase.rpc('hide_author', {
    p_requesting_device_id: getDeviceId(),
    p_post_id: postId,
  })
  if (error) console.error('hide author failed', error)
  return !error
}
