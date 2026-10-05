-- New-device onboarding tilt for get_feed(), requested after live
-- verification during the Guideline 1.2 hardening work showed a fresh
-- device's first 75 cards were ~65% relationship-category user_submitted
-- content (including a 9-card same-category streak), because the existing
-- lane split gives user_submitted content 90% of every batch and seed only
-- 10% — fine for an established community feed, not great for surfacing
-- the newly-curated seed inventory to a brand-new device.
--
-- This changes ONLY the four lane-size LIMIT expressions inside get_feed()
-- (fresh_boost / needs_opinions / mature_user / seed_lane). Every other
-- part of the function — eligibility filtering, per-lane ordering,
-- fallback-fill logic, SECURITY DEFINER, grants — is byte-for-byte
-- unchanged from supabase/migrations/20260809000003_get_feed.sql.
--
-- Mechanism: a single scalar `t` ("progress"), 0.0 for a brand-new device
-- and linearly ramping to 1.0 once the device has cast ~100 votes
-- (least(1.0, votes_cast / 100.0) — deliberately plain arithmetic, no
-- randomness, no ML, easy to reason about and to verify). Each lane's
-- percentage of p_limit is linearly interpolated between a "new device"
-- target and the "established" target:
--
--              new (t=0)   established (t=1)
--   fresh_boost     15%           20%
--   needs_opinions  15%           60%
--   mature_user      5%           10%
--   seed            60%           10%
--                  ----           ----
--                   95%          100%
--
-- The established-side percentages are deliberately IDENTICAL to the
-- original fixed ratios (6/18/3/3 out of 30 == 20/60/10/10%), so at t=1
-- this produces the exact same lane sizes as before this migration —
-- confirmed by running both functions side by side against the same
-- high-vote-count device during development, identical results. The 5%
-- gap at t=0 is intentionally left for the function's own existing
-- fallback-fill logic to cover (it already tops up any shortfall from
-- whichever source has remaining eligible supply), rather than adding a
-- fifth explicit lane — this is the "~5% for any required existing
-- remaining lane/content source" the feature request asked for.

create or replace function get_feed(
  p_device_id text,
  p_limit int default 30,
  p_exclude_ids uuid[] default '{}',
  p_hidden_post_ids uuid[] default '{}'
)
returns table (
  id uuid,
  text text,
  category text,
  safety_flag boolean,
  source text,
  created_at timestamptz,
  vote_count int
)
language sql
security definer
set search_path = public
stable
as $$
  with
  vote_progress as (
    select least(1.0, (select count(*) from votes where device_id = p_device_id)::numeric / 100.0) as t
  ),
  voted as (
    select post_id from votes where device_id = p_device_id
  ),
  skipped as (
    select post_id from post_skips where device_id = p_device_id
  ),
  blocked as (
    select blocked_device_id from author_blocks where device_id = p_device_id
  ),
  eligible as (
    select p.id, p.text, p.category, p.safety_flag, p.source, p.created_at,
           p.vote_count, p.device_id
    from posts p
    where p.status = 'approved'
      and p.device_id is distinct from p_device_id
      and p.id not in (select post_id from voted)
      and p.id not in (select post_id from skipped)
      and not (p.id = any(p_exclude_ids))
      and not (p.id = any(p_hidden_post_ids))
      and (p.device_id is null or p.device_id not in (select blocked_device_id from blocked))
  ),
  fresh_boost as (
    select id, text, category, safety_flag, source, created_at, vote_count
    from eligible
    where source = 'user_submitted'
      and vote_count < 10
      and created_at > now() - interval '24 hours'
    order by created_at desc
    limit (select round((p_limit * (15 + 5 * t)) / 100.0)::int from vote_progress)
  ),
  needs_opinions as (
    select id, text, category, safety_flag, source, created_at, vote_count
    from eligible
    where source = 'user_submitted'
      and vote_count < 40
      and id not in (select id from fresh_boost)
    order by vote_count asc, created_at asc
    limit (select round((p_limit * (15 + 45 * t)) / 100.0)::int from vote_progress)
  ),
  mature_user as (
    select id, text, category, safety_flag, source, created_at, vote_count
    from eligible
    where source = 'user_submitted'
      and vote_count >= 40
      and id not in (select id from fresh_boost)
      and id not in (select id from needs_opinions)
    order by random()
    limit (select round((p_limit * (5 + 5 * t)) / 100.0)::int from vote_progress)
  ),
  seed_lane as (
    select id, text, category, safety_flag, source, created_at, vote_count
    from eligible
    where source = 'seed'
    order by random()
    limit (select round((p_limit * (60 - 50 * t)) / 100.0)::int from vote_progress)
  ),
  primary_selection as (
    select * from fresh_boost
    union all select * from needs_opinions
    union all select * from mature_user
    union all select * from seed_lane
  ),
  -- Fallback 1: any remaining eligible user-submitted posts, prioritized
  -- the same way needs_opinions is (lowest vote_count, then oldest first) —
  -- this is what actually guarantees "never starve," since it sweeps up
  -- anything the four lanes' own criteria (24h window, vote thresholds)
  -- happened to exclude.
  fallback_user as (
    select e.id, e.text, e.category, e.safety_flag, e.source, e.created_at, e.vote_count
    from eligible e
    where e.source = 'user_submitted'
      and e.id not in (select id from primary_selection)
    order by e.vote_count asc, e.created_at asc
    limit greatest(0, p_limit - (select count(*) from primary_selection))
  ),
  with_fallback_user as (
    select * from primary_selection
    union all select * from fallback_user
  ),
  fallback_seed as (
    select e.id, e.text, e.category, e.safety_flag, e.source, e.created_at, e.vote_count
    from eligible e
    where e.source = 'seed'
      and e.id not in (select id from with_fallback_user)
    order by random()
    limit greatest(0, p_limit - (select count(*) from with_fallback_user))
  )
  select id, text, category, safety_flag, source, created_at, vote_count
  from (
    select * from with_fallback_user
    union all select * from fallback_seed
  ) final_batch
  limit p_limit
$$;

-- Signature is unchanged, so the existing grants already apply — re-stated
-- here only for clarity/idempotency (CREATE OR REPLACE FUNCTION does not
-- reset grants on a matching signature, confirmed before relying on it).
grant execute on function get_feed(text, int, uuid[], uuid[]) to anon;
grant execute on function get_feed(text, int, uuid[], uuid[]) to authenticated;
