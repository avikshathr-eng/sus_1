-- Deterministic test harness for get_feed() — not a migration, not meant
-- to be committed to schema history. Seeds a small, clearly-tagged set of
-- posts across ages/vote-counts, calls get_feed() as a fixed test device,
-- and prints the resulting order so the distribution ladder can be
-- visually verified against the spec. Cleans up everything it inserted at
-- the end — run section by section, or the whole file at once.

-- ============ SEED ============
-- All test posts are tagged with a '[TEST]' prefix so cleanup is
-- unambiguous even if a later step is interrupted.

insert into posts (id, text, category, status, source, device_id, created_at, vote_count) values
  ('00000000-0000-0000-0000-000000000001', '[TEST] fresh, just posted, 2 votes', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '2 hours', 2),
  ('00000000-0000-0000-0000-000000000002', '[TEST] fresh, just posted, 5 votes', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '1 hour', 5),
  ('00000000-0000-0000-0000-000000000003', '[TEST] old, low votes (3), 10 days ago', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '10 days', 3),
  ('00000000-0000-0000-0000-000000000004', '[TEST] close to graduating, 39 votes', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '5 days', 39),
  ('00000000-0000-0000-0000-000000000005', '[TEST] mature, 100 votes', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '3 days', 100),
  ('00000000-0000-0000-0000-000000000006', '[TEST] needs opinions, 5 votes, 8 days old', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '8 days', 5),
  ('00000000-0000-0000-0000-000000000007', '[TEST] seed filler A', 'relationship', 'approved', 'seed', null, now() - interval '30 days', 0),
  ('00000000-0000-0000-0000-000000000008', '[TEST] seed filler B', 'career', 'approved', 'seed', null, now() - interval '30 days', 0),
  ('00000000-0000-0000-0000-000000000009', '[TEST] my own post — must never appear', 'other', 'approved', 'user_submitted', 'test-device-000', now() - interval '1 hour', 1),
  ('00000000-0000-0000-0000-00000000000a', '[TEST] already voted — must never reappear', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '1 hour', 1),
  ('00000000-0000-0000-0000-00000000000b', '[TEST] already skipped — must never reappear', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '1 hour', 1),
  ('00000000-0000-0000-0000-00000000000c', '[TEST] locally hidden — must never appear', 'other', 'approved', 'user_submitted', 'test-author-a', now() - interval '1 hour', 1),
  ('00000000-0000-0000-0000-00000000000d', '[TEST] blocked author — must never appear', 'other', 'approved', 'user_submitted', 'test-author-blocked', now() - interval '1 hour', 1)
on conflict (id) do nothing;

insert into votes (post_id, device_id, vote)
  values ('00000000-0000-0000-0000-00000000000a', 'test-device-000', 'red_flag')
  on conflict do nothing;

insert into post_skips (post_id, device_id)
  values ('00000000-0000-0000-0000-00000000000b', 'test-device-000')
  on conflict do nothing;

insert into author_blocks (device_id, blocked_device_id)
  values ('test-device-000', 'test-author-blocked')
  on conflict do nothing;

-- ============ SCENARIO 1-6, 9-10, 16: main get_feed() output ============
-- Composition + order for the full test batch (excludes the "hidden"
-- post via p_hidden_post_ids, mirroring what the client actually sends).
select
  text,
  source,
  vote_count,
  created_at
from get_feed(
  'test-device-000',
  30,
  '{}'::uuid[],
  array['00000000-0000-0000-0000-00000000000c']::uuid[]
);

-- Expect, reading top to bottom:
--   1. "fresh, just posted, 5 votes"  (newer of the two fresh-boost candidates, first)
--   2. "fresh, just posted, 2 votes"
--   3. "needs opinions, 5 votes, 8 days old"  (needs-opinions: lowest vote_count, oldest first)
--   4. "old, low votes (3), 10 days ago"      (also needs-opinions — a 3-vote 10-day-old post is NOT buried)
--   5. "close to graduating, 39 votes"        (still < 40, still needs-opinions, ranked last among this group)
--   6. "mature, 100 votes"                    (mature lane — ranked BELOW every needs-opinions post, confirming
--                                               a 100-vote post has lower priority than a 5-vote post — scenario 4)
--   7-8. the two seed fillers, in random order
-- NOT present at all: own post, voted post, skipped post, hidden post, blocked-author post — scenarios 6-10.
-- No `device_id` column in the output at all — scenario 16, structurally guaranteed by
-- get_feed's RETURNS TABLE signature, not just by this query happening not to select it.

-- ============ SCENARIO 13: prefetch dedup ============
-- Same call, now excluding everything from the first result via p_exclude_ids
-- (mirrors what CardStack's prefetch effect actually does with already-
-- loaded post ids) — should return zero of the same rows, not duplicates.
select text from get_feed(
  'test-device-000',
  30,
  (select array_agg(id) from posts where text like '[TEST]%' and id != '00000000-0000-0000-0000-00000000000c'),
  array['00000000-0000-0000-0000-00000000000c']::uuid[]
);
-- Expect: empty result set (every eligible test post was already excluded) —
-- confirms no duplicate is ever returned for an already-loaded id.

-- ============ SCENARIO 11-12: duplicate vote / duplicate skip impossible ============
-- Both should fail with a unique_violation (23505), not silently succeed.
select 'attempting duplicate vote...' as step;
insert into votes (post_id, device_id, vote)
  values ('00000000-0000-0000-0000-00000000000a', 'test-device-000', 'relax');
-- ^ expect: ERROR - duplicate key value violates unique constraint "votes_post_id_device_id_key"

select 'attempting duplicate skip...' as step;
insert into post_skips (post_id, device_id)
  values ('00000000-0000-0000-0000-00000000000b', 'test-device-000');
-- ^ expect: ERROR - duplicate key value violates unique constraint "post_skips_post_id_device_id_key"

-- ============ CLEANUP ============
-- Run this regardless of whether the duplicate-insert checks above errored
-- (they're expected to — that's the test passing) — errors from the two
-- INSERT statements above don't roll back anything that came before them
-- in `supabase db query`'s per-statement execution, but do run this block
-- as its own explicit step to be certain no [TEST] data lingers.
delete from author_blocks where device_id = 'test-device-000' and blocked_device_id = 'test-author-blocked';
delete from post_skips where device_id = 'test-device-000';
delete from votes where device_id = 'test-device-000';
delete from posts where text like '[TEST]%';
