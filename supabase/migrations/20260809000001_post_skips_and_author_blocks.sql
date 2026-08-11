-- Persisted skips + server-side author blocking.
--
-- post_skips: mirrors the shape of `votes` deliberately (post_id, device_id,
-- unique constraint) but is NOT a vote — get_feed excludes skipped posts
-- from re-appearing, the same way voted posts already are, without ever
-- counting toward red_flag_count/relax_count.
--
-- author_blocks: replaces the old client-side "hide this account" design,
-- which required the client to already hold the author's raw device_id
-- (see hiddenContent.js / ReportButton.jsx before this migration). The
-- server now resolves the author from post_id via hide_author() (see
-- 20260809000004_get_my_voted_and_hide_author.sql) — the client never
-- receives or stores a raw author device_id again.
--
-- Neither table gets an anon SELECT policy. The only legitimate reader of
-- either is the SECURITY DEFINER functions (get_feed, hide_author), which
-- bypass RLS internally and never return device_id in their own output —
-- an open "for select using (true))" here would just recreate the exact
-- votes-table leak this whole redesign exists to close.

create table post_skips (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  device_id text not null,
  created_at timestamptz not null default now(),
  unique (post_id, device_id)
);

alter table post_skips enable row level security;

-- Open insert, same trust model as `insert vote` — device_id is
-- self-asserted with no real auth, and there's nothing sensitive being
-- inserted (a device recording its own skip). No select policy: skips are
-- only ever read back internally by get_feed (SECURITY DEFINER).
create policy "insert skip" on post_skips
  for insert with check (true);

create table author_blocks (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,          -- the device doing the blocking
  blocked_device_id text not null,  -- the author being blocked
  created_at timestamptz not null default now(),
  unique (device_id, blocked_device_id)
);

alter table author_blocks enable row level security;
-- No anon policies at all, not even insert — the only writer is
-- hide_author() (SECURITY DEFINER), which resolves blocked_device_id
-- server-side from a post_id rather than trusting a client-supplied value.
