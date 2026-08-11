-- Closes the two confirmed device_id leaks from the audit:
--
-- 1. `votes` had `"read votes" for select using (true)` — a fully open
--    read policy with zero scoping. Any anon-key holder could query
--    `votes?select=*` directly and get every device_id's full voting
--    history. Nothing in the app actually needs this broad a read anymore:
--    CardStack's own-vote-history lookups and CrowdPicks' answered-history
--    lookups both move to get_my_voted_post_ids() (previous migration),
--    and percentage displays already went through post_results/crowd_picks
--    (aggregate views, never expose individual device_id) rather than
--    reading raw `votes` rows directly. Dropping this policy leaves anon
--    with zero ability to read `votes` at all, which is correct — RLS
--    enabled + no SELECT policy means deny-by-default.
--
-- 2. `crowd_picks` included `p.device_id` in its own SELECT list, marked
--    "internal use only... never rendered" — true of the UI, but the
--    column was still present in the raw JSON response CrowdPicks.jsx
--    received from `.select('*')`. Nothing in the current codebase reads
--    `device_id` off a crowd_picks row for any purpose (checked
--    CrowdPicks.jsx directly), so this is a clean removal with zero
--    behavior change other than closing the leak.

drop policy if exists "read votes" on votes;

-- Postgres refuses `CREATE OR REPLACE VIEW` when it would drop a column
-- (removing device_id here counts) — has to be a real DROP + CREATE.
drop view if exists crowd_picks;

create view crowd_picks as
select
  p.id,
  p.text,
  p.category,
  p.safety_flag,
  p.status,
  r.red_flag_count,
  r.relax_count,
  r.total_votes,
  r.red_flag_pct
from posts p
join post_results r on r.post_id = p.id
where p.status = 'approved' and r.total_votes > 0;
