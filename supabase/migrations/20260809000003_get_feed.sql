-- get_feed(): server-side eligibility + distribution-ladder ranking,
-- replacing the client-side fetchApprovedPosts() in CardStack.jsx (which
-- downloaded up to 2000 rows into the browser and did all filtering/sorting
-- there). SECURITY DEFINER so it can read votes/post_skips/author_blocks
-- (none of which grant anon SELECT — see the two migrations above) while
-- its RETURN TABLE simply never includes device_id at all, which is what
-- actually keeps it out of the client's hands, not RLS on the base tables.
--
-- Lane proportions are scaled from the spec's 20-card window
-- (4 fresh-boost : 12 needs-opinions : 2 mature : 2 seed) to
-- FEED_BATCH_SIZE = 30 by the same ratio (6 : 18 : 3 : 3), via integer
-- division against p_limit — a caller requesting a different p_limit still
-- gets the same proportions, not a hardcoded 30.
--
-- Fallback order (unused lane capacity): other eligible user-submitted
-- posts first (oldest/least-voted first, same tiebreak as needs-opinions),
-- then seed. This guarantees the function always returns up to p_limit
-- rows whenever that many eligible posts exist, even if a specific lane's
-- own criteria came up short — exactly the "no lane should ever starve a
-- post just because its bucket was empty" requirement.

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
  with voted as (
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
    limit (p_limit * 6 / 30)
  ),
  needs_opinions as (
    select id, text, category, safety_flag, source, created_at, vote_count
    from eligible
    where source = 'user_submitted'
      and vote_count < 40
      and id not in (select id from fresh_boost)
    order by vote_count asc, created_at asc
    limit (p_limit * 18 / 30)
  ),
  mature_user as (
    select id, text, category, safety_flag, source, created_at, vote_count
    from eligible
    where source = 'user_submitted'
      and vote_count >= 40
      and id not in (select id from fresh_boost)
      and id not in (select id from needs_opinions)
    order by random()
    limit (p_limit * 3 / 30)
  ),
  seed_lane as (
    select id, text, category, safety_flag, source, created_at, vote_count
    from eligible
    where source = 'seed'
    order by random()
    limit (p_limit * 3 / 30)
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

grant execute on function get_feed(text, int, uuid[], uuid[]) to anon;
grant execute on function get_feed(text, int, uuid[], uuid[]) to authenticated;
