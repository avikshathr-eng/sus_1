-- Closes the "no way to actually resolve a report, or see how old it is"
-- gap flagged during the App Store 1.2 rejection review. Before this, a
-- report was just a row with a reason and a timestamp — the admin dashboard
-- could count them but had no way to mark one handled, and no way to tell
-- how urgently it needed attention. Apple's rejection explicitly requires
-- acting on objectionable-content reports within 24 hours, so "how old is
-- this report" has to be a first-class, queryable thing.
--
-- Deliberately reusing the `reports` table rather than a parallel
-- moderation-queue table — same reasoning as banned_devices/author_blocks:
-- one table per concern, extended in place.

alter table reports add column if not exists status text not null default 'open'
  check (status in ('open', 'resolved'));
alter table reports add column if not exists resolved_at timestamptz;

-- One open report per (post, device) — a single device mashing the report
-- button shouldn't be able to inflate a post's report count or manufacture
-- urgency. Re-reporting the same post from the same device after the first
-- report is resolved is still blocked (this is a spam guard, not a "you can
-- only ever flag this once across all time" limit that matters in practice
-- for a table that's never bulk-cleared) — acceptable given the alternative
-- is unlimited duplicate-report spam from one device.
create unique index if not exists reports_post_device_uniq on reports (post_id, device_id);

-- Admin dashboard's "how old is the oldest unresolved report on this post"
-- query filters on status='open' then needs post_id/created_at — this
-- partial index covers exactly that shape.
create index if not exists idx_reports_open_post_created on reports (post_id, created_at)
  where status = 'open';
