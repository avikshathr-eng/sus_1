-- SUS MVP schema — Supabase (Postgres)
-- Run this in Supabase SQL editor, then run seed.sql.

create extension if not exists "pgcrypto";

-- ============ POSTS ============
-- A "post" is one anonymous situation card users swipe on. Generic themes,
-- not dating-specific — a situation can involve a partner, friend, coworker,
-- parent, roommate, anyone.
create table posts (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 5 and 180),
  category text not null check (
    category in ('relationship','friendship','career','family','other')
  ),

  -- Safety: flag posts that reference abuse/stalking/controlling behavior so
  -- the UI can show a resource banner. Set manually during a spot-check, or
  -- default false for auto-approved user submissions.
  safety_flag boolean not null default false,

  -- 'pending' | 'approved' | 'rejected' | 'flagged'. User submissions that
  -- pass the server-side moderation filter (submit-post) are inserted
  -- directly as 'approved' for MVP speed. 'flagged' is for content that
  -- slipped past automated screening but shouldn't be live — set it by hand
  -- (or by a future automated check) to immediately pull a post out of the
  -- feed (see the "read approved posts" policy below) without deleting it,
  -- and the author sees it under Your Posts as "Needs an edit". Flip status
  -- back to 'approved' in the table editor to return it to the stack, or to
  -- 'rejected' to keep it down for good.
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'flagged')),

  -- Why a post was flagged — shown to the author under Your Posts so they
  -- know what to fix before resubmitting. Null unless status = 'flagged'.
  flag_reason text,
  flagged_at timestamptz,

  source text default 'seed', -- 'seed' | 'user_submitted'
  created_at timestamptz not null default now(),

  -- The submitting device's anonymous id (same random UUID used for votes),
  -- captured server-side in submit-post. Never displayed anywhere in the
  -- UI — it exists only so a device can list/delete/view-status-of its own
  -- submissions (see supabase/functions/my-posts and delete-post) and so
  -- "hide posts from this account" can filter client-side. Null for seed
  -- rows.
  device_id text
);

create index posts_status_idx on posts (status);
create index posts_category_idx on posts (category);

-- ============ VOTES ============
-- One vote per (post, device). device_id is a random UUID generated
-- client-side and stored in localStorage — no accounts for MVP.
create table votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  device_id text not null,
  vote text not null check (vote in ('red_flag', 'relax')),
  created_at timestamptz not null default now(),
  unique (post_id, device_id)
);

create index votes_post_idx on votes (post_id);

-- ============ REPORTS ============
-- Lightweight community-moderation supplement. Anyone can flag a card from
-- the UI. Nothing auto-hides — check this table periodically:
--   select post_id, count(*) from reports group by post_id order by count(*) desc;
-- and flip status='rejected' on posts.id by hand for anything that deserves it.
create table reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  device_id text not null,
  reason text, -- category chosen in the report menu, e.g. 'harassment', 'spam'
  created_at timestamptz not null default now()
);

-- ============ VIEWS ============

-- Raw per-post vote breakdown + live percentage.
create or replace view post_results as
select
  p.id as post_id,
  count(*) filter (where v.vote = 'red_flag') as red_flag_count,
  count(*) filter (where v.vote = 'relax') as relax_count,
  count(*) as total_votes,
  round(
    100.0 * count(*) filter (where v.vote = 'red_flag') / nullif(count(*), 0), 1
  ) as red_flag_pct
from posts p
left join votes v on v.post_id = p.id
group by p.id;

-- Denormalized view for the Crowd Picks tab — joins post fields + results in
-- one query (a plain PostgREST embed on post_results won't work automatically
-- since it's a view with no FK, so the frontend queries this instead).
create or replace view crowd_picks as
select
  p.id,
  p.text,
  p.category,
  p.safety_flag,
  p.status,
  r.red_flag_count,
  r.relax_count,
  r.total_votes,
  r.red_flag_pct,
  p.device_id -- internal use only (hide-this-account filtering) — never rendered
from posts p
join post_results r on r.post_id = p.id
where p.status = 'approved' and r.total_votes > 0;

-- ============ RLS ============
alter table posts enable row level security;
alter table votes enable row level security;
alter table reports enable row level security;

create policy "read approved posts" on posts
  for select using (status = 'approved');

-- Deliberately NO insert policy for the anon key on posts. The only way to
-- create a post is through the `submit-post` Edge Function, which runs the
-- moderation check server-side and writes using the service-role key (which
-- bypasses RLS entirely). This is what makes the moderation step actually
-- enforceable instead of just a client-side suggestion — see
-- supabase/functions/submit-post/index.ts and Guideline 1.2 in CLAUDE.md.

create policy "read votes" on votes
  for select using (true);

create policy "insert vote" on votes
  for insert with check (true);

create policy "insert report" on reports
  for insert with check (true);
-- No select policy on reports for the anon key — only readable via the
-- Supabase dashboard / service role, intentionally.
