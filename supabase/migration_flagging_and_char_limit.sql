-- Run this once in the Supabase SQL editor against the live project.
-- Safe to run even though the table already has rows — every statement is
-- either idempotent or a straightforward ALTER.

-- 1. New columns for the flagging workflow.
alter table posts add column if not exists flag_reason text;
alter table posts add column if not exists flagged_at timestamptz;

-- 2. Allow 'flagged' as a status (drop + recreate the check constraint —
--    Postgres has no "ALTER CHECK", constraint name matches what Postgres
--    auto-generates for an inline check on this column).
alter table posts drop constraint if exists posts_status_check;
alter table posts add constraint posts_status_check
  check (status in ('pending', 'approved', 'rejected', 'flagged'));

-- 3. Raise the confession length limit from 90 to 180 characters.
alter table posts drop constraint if exists posts_text_check;
alter table posts add constraint posts_text_check
  check (char_length(text) between 5 and 180);

-- 4. Flag the post reported as hate speech / a self-identifying phrase that
--    should have been caught on review. Pulls it out of the live feed
--    immediately (the feed query only reads status = 'approved').
update posts
set status = 'flagged',
    flag_reason = 'Hate speech and a self-identifying phrase ("my name is...") — flagged after being missed in review.',
    flagged_at = now()
where text = 'i hate people. my name is xyz'
  and status = 'approved';

-- To put a flagged post back in the stack later:
--   update posts set status = 'approved', flag_reason = null, flagged_at = null where id = '<post id>';
-- To keep it down for good instead:
--   update posts set status = 'rejected' where id = '<post id>';
