-- Launch-health observability. No admin UI requested — these are views,
-- queryable directly from the Supabase SQL editor/table view. All scoped
-- to source='user_submitted' + status='approved' (seed content isn't
-- meaningful "community health" signal).

-- Per-post timestamp of when it crossed each vote-count milestone, derived
-- from `votes` (not the cached counters) since it needs the actual
-- sequence/timing of individual votes, not just a running total.
create or replace view post_vote_milestones as
select
  post_id,
  min(created_at) filter (where rn = 1) as first_vote_at,
  min(created_at) filter (where rn = 8) as vote_8_at,
  min(created_at) filter (where rn = 20) as vote_20_at,
  min(created_at) filter (where rn = 40) as vote_40_at
from (
  select post_id, created_at, row_number() over (partition by post_id order by created_at) as rn
  from votes
) ranked
group by post_id;

-- Single-row overview: volume, backlog health, and how "stuck" the oldest
-- under-answered question currently is.
create or replace view admin_feed_health as
with user_posts as (
  select * from posts where source = 'user_submitted' and status = 'approved'
)
select
  (select count(*) from user_posts) as approved_user_submissions,
  (select count(*) from user_posts where vote_count < 40) as under_answered_count,
  (select round(avg(vote_count), 1) from user_posts) as avg_votes_per_submission,
  (select round(percentile_cont(0.5) within group (order by vote_count)::numeric, 1) from user_posts) as median_votes_per_submission,
  (select round(avg(skip_count), 1) from user_posts) as avg_skips_per_submission,
  (select min(created_at) from user_posts where vote_count < 40) as oldest_under_answered_created_at,
  (select round(extract(epoch from (now() - min(created_at))) / 3600, 1) from user_posts where vote_count < 40) as oldest_under_answered_age_hours;

-- Single-row overview: how fast questions actually move through the
-- pipeline once posted.
create or replace view admin_time_to_votes as
select
  count(*) as sample_size,
  round(avg(extract(epoch from (m.first_vote_at - p.created_at)) / 60)::numeric, 1) as avg_minutes_to_first_vote,
  round(avg(extract(epoch from (m.vote_8_at - p.created_at)) / 60)::numeric, 1) as avg_minutes_to_8_votes,
  round(avg(extract(epoch from (m.vote_20_at - p.created_at)) / 3600)::numeric, 1) as avg_hours_to_20_votes,
  round(avg(extract(epoch from (m.vote_40_at - p.created_at)) / 3600)::numeric, 1) as avg_hours_to_40_votes,
  round(
    (100.0 * count(*) filter (where m.vote_40_at is not null and m.vote_40_at <= p.created_at + interval '24 hours')
    / nullif(count(*), 0))::numeric,
    1
  ) as pct_reaching_40_within_24h
from posts p
join post_vote_milestones m on m.post_id = p.id
where p.source = 'user_submitted' and p.status = 'approved';

-- Per-post breakdown: skip rate and report rate, newest first. This is the
-- one that's naturally a table, not a single summary row — "per question"
-- in the spec means per-row here.
create or replace view admin_post_engagement as
select
  p.id,
  p.text,
  p.created_at,
  p.vote_count,
  p.skip_count,
  round((100.0 * p.skip_count / nullif(p.skip_count + p.vote_count, 0))::numeric, 1) as skip_rate_pct,
  coalesce(r.report_count, 0) as report_count,
  round((100.0 * coalesce(r.report_count, 0) / nullif(p.vote_count, 0))::numeric, 1) as report_rate_pct
from posts p
left join (
  select post_id, count(*) as report_count from reports group by post_id
) r on r.post_id = p.id
where p.source = 'user_submitted' and p.status = 'approved'
order by p.created_at desc;

-- None of these four views grant anon SELECT — they're for direct SQL
-- editor / dashboard use with your own account, not client-facing, so no
-- RLS/grant change is needed for them to stay private (views run with the
-- querying user's own permissions by default; anon was never granted
-- access to begin with).
