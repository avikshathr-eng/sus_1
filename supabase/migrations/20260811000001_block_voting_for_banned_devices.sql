-- Extends the banned_devices gap (see 20260810000001) to voting, not just
-- submissions. Votes are inserted directly by the anon key via RLS, not
-- through an Edge Function, so this can't be a service-role check the way
-- submit-post's is — it has to live in the insert policy itself.
--
-- banned_devices has RLS enabled with zero policies (intentional — see its
-- own migration), which means a plain correlated subquery against it from
-- an RLS check clause would see nothing at all, since the check runs as the
-- calling (anon) role and is itself subject to banned_devices' RLS. Routing
-- the lookup through a SECURITY DEFINER function sidesteps that: the
-- function body runs as its owner, not the caller, so it can actually read
-- the table while still only ever exposing a single boolean to the caller
-- — never the banned list itself.

create or replace function is_device_banned(p_device_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from banned_devices where device_id = p_device_id)
$$;

grant execute on function is_device_banned(text) to anon;
grant execute on function is_device_banned(text) to authenticated;

drop policy if exists "insert vote" on votes;

create policy "insert vote" on votes
  for insert
  with check (not is_device_banned(device_id));
