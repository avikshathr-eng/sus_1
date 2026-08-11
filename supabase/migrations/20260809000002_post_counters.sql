-- Atomic vote/skip counters on `posts`.
--
-- post_results (existing view) computes red_flag_count/relax_count/
-- total_votes via a live COUNT/GROUP BY over the entire `votes` table on
-- every single query — fine at seed-content scale, not fine as the primary
-- input to a feed-ranking query that runs on every prefetch. These columns
-- are denormalized, trigger-maintained counters `get_feed` can read
-- directly with a plain index scan instead of aggregating.
--
-- `votes` remains the source of truth — these columns are a maintained
-- cache of it, not a replacement. post_results/crowd_picks (the actual
-- percentage-display views) are deliberately left alone in this migration;
-- they still compute live off `votes`, which is correct for a
-- percentage a user is about to see (must be exact), whereas get_feed's
-- ranking only needs to be *approximately* right to sort lanes correctly.

alter table posts
  add column vote_count integer not null default 0,
  add column red_flag_count integer not null default 0,
  add column relax_count integer not null default 0,
  add column skip_count integer not null default 0,
  add column first_vote_at timestamptz,
  add column last_vote_at timestamptz;

-- Backfill from existing data — this table already has real votes cast
-- during testing, so these can't just start at zero.
update posts p set
  vote_count = coalesce(v.total, 0),
  red_flag_count = coalesce(v.red_flag, 0),
  relax_count = coalesce(v.relax, 0),
  first_vote_at = v.first_at,
  last_vote_at = v.last_at
from (
  select
    post_id,
    count(*) as total,
    count(*) filter (where vote = 'red_flag') as red_flag,
    count(*) filter (where vote = 'relax') as relax,
    min(created_at) as first_at,
    max(created_at) as last_at
  from votes
  group by post_id
) v
where v.post_id = p.id;

update posts p set skip_count = coalesce(s.total, 0)
from (
  select post_id, count(*) as total from post_skips group by post_id
) s
where s.post_id = p.id;

-- Vote insert: bump the relevant counters. Runs BEFORE UPDATE would be
-- wrong here (this is a trigger ON votes, updating a DIFFERENT table,
-- posts) — AFTER INSERT is correct and standard for this pattern.
create or replace function bump_post_vote_counters()
returns trigger
language plpgsql
as $$
begin
  update posts set
    vote_count = vote_count + 1,
    red_flag_count = red_flag_count + (case when new.vote = 'red_flag' then 1 else 0 end),
    relax_count = relax_count + (case when new.vote = 'relax' then 1 else 0 end),
    first_vote_at = coalesce(first_vote_at, new.created_at),
    last_vote_at = greatest(coalesce(last_vote_at, new.created_at), new.created_at)
  where id = new.post_id;
  return new;
end;
$$;

create trigger trg_bump_post_vote_counters
  after insert on votes
  for each row execute function bump_post_vote_counters();

-- Vote delete: only for administrative cleanup (nothing in the app itself
-- deletes votes today) — kept correct defensively per the spec. Counts are
-- decremented exactly; first_vote_at/last_vote_at are deliberately left
-- as-is rather than rescanning votes to find the new min/max on every
-- delete (a rare, admin-only operation) — they may go slightly stale in
-- that specific edge case, which is an accepted tradeoff, not a bug.
create or replace function unbump_post_vote_counters()
returns trigger
language plpgsql
as $$
begin
  update posts set
    vote_count = greatest(0, vote_count - 1),
    red_flag_count = greatest(0, red_flag_count - (case when old.vote = 'red_flag' then 1 else 0 end)),
    relax_count = greatest(0, relax_count - (case when old.vote = 'relax' then 1 else 0 end))
  where id = old.post_id;
  return old;
end;
$$;

create trigger trg_unbump_post_vote_counters
  after delete on votes
  for each row execute function unbump_post_vote_counters();

-- Skip insert/delete: same pattern, simpler (one counter only).
create or replace function bump_post_skip_counter()
returns trigger
language plpgsql
as $$
begin
  update posts set skip_count = skip_count + 1 where id = new.post_id;
  return new;
end;
$$;

create trigger trg_bump_post_skip_counter
  after insert on post_skips
  for each row execute function bump_post_skip_counter();

create or replace function unbump_post_skip_counter()
returns trigger
language plpgsql
as $$
begin
  update posts set skip_count = greatest(0, skip_count - 1) where id = old.post_id;
  return old;
end;
$$;

create trigger trg_unbump_post_skip_counter
  after delete on post_skips
  for each row execute function unbump_post_skip_counter();
