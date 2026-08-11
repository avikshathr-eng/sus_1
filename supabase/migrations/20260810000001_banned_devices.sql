-- Closes the "no way to actually ban a repeat-offender device" gap flagged
-- during the App Store readiness review. Before this, the only enforcement
-- lever was per-post: flip a single post to status='rejected' by hand after
-- a report. There was no way to stop the same device_id from immediately
-- submitting another post — Apple's UGC guideline (1.2) expects the ability
-- to remove abusive users, not just their individual content.
--
-- This table is deliberately just a list, not a workflow — no expiry, no
-- appeal state, no admin UI. Ban/unban by hand via the SQL editor:
--
--   insert into banned_devices (device_id, reason)
--   values ('<device_id>', 'repeated harassment reports');
--
--   delete from banned_devices where device_id = '<device_id>';
--
-- To find repeat offenders worth banning, cross-reference reports against
-- the reported post's author:
--
--   select p.device_id, count(*) as report_count
--   from reports rp
--   join posts p on p.id = rp.post_id
--   where p.device_id is not null
--   group by p.device_id
--   order by report_count desc;

create table banned_devices (
  device_id text primary key,
  reason text,
  banned_at timestamptz not null default now()
);

-- RLS on, zero policies — anon/authenticated have no access at all, not even
-- to check whether a given device_id is banned. Only readable by the
-- service-role key (submit-post, which bypasses RLS entirely) or the
-- dashboard. Same pattern as author_blocks.
alter table banned_devices enable row level security;
