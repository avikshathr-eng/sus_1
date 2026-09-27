-- Closes a real deanonymization gap found during a live re-audit of the
-- Guideline 1.2 fixes: RLS on `posts` only restricts which ROWS anon can
-- see ("read approved posts", status = 'approved') — it says nothing about
-- COLUMNS. The base GRANT Supabase creates for a new table gives anon
-- SELECT on every column by default, so `device_id` (the raw, un-hashed
-- submitting-device identifier) has been readable this whole time via a
-- plain REST call anyone can make with the public/publishable key:
--
--   GET /rest/v1/posts?select=id,device_id
--
-- That's the exact value the get_feed()/hide_author()/crowd_picks security
-- work (20260809000004/5) went to real effort to keep off the client —
-- those migrations closed the `votes` table and `crowd_picks` view, but
-- never touched grants on `posts` itself, so the same value stayed exposed
-- one table over the whole time. Confirmed empirically: an unauthenticated
-- curl with only the publishable key returned device_id for every approved
-- post before this migration.
--
-- No client code needs this column publicly — the one remaining direct
-- read of `posts` (CardStack's checkSystemHasAnyApprovedPosts) only selects
-- `id` with `head: true`. Every legitimate device_id use already goes
-- through a SECURITY DEFINER function (get_feed, hide_author,
-- get_my_voted_post_ids) or a service-role Edge Function (my-posts,
-- delete-post, submit-post, admin-posts), none of which are affected by a
-- column-level REVOKE against anon/authenticated.

revoke select on posts from anon, authenticated;

grant select (
  id, text, category, safety_flag, status, flag_reason, flagged_at, source, created_at
) on posts to anon, authenticated;
