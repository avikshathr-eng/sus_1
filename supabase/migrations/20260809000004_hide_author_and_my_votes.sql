-- hide_author(): server-side replacement for the old client-side design
-- where ReportButton passed the post's raw device_id (as `authorId`)
-- straight into localStorage. The client now only ever supplies a post_id
-- it already legitimately has (it's the post being reported) — the author
-- is resolved from that post_id INSIDE this function, using SECURITY
-- DEFINER to read posts.device_id without needing an anon SELECT grant on
-- that column. The raw author device_id never crosses back to any client.
--
-- Silently no-ops (rather than erroring) if the post has no device_id
-- (a seed post) or doesn't exist — hiding "the author of a seed card" isn't
-- a meaningful action, and a client racing a deleted post shouldn't see an
-- error for what's functionally already a no-op.

create or replace function hide_author(p_requesting_device_id text, p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_device_id text;
begin
  select device_id into v_author_device_id from posts where id = p_post_id;

  if v_author_device_id is null then
    return;
  end if;

  insert into author_blocks (device_id, blocked_device_id)
  values (p_requesting_device_id, v_author_device_id)
  on conflict (device_id, blocked_device_id) do nothing;
end;
$$;

grant execute on function hide_author(text, uuid) to anon;
grant execute on function hide_author(text, uuid) to authenticated;

-- get_my_voted_post_ids(): replaces the client's direct
-- `supabase.from('votes').select(...).eq('device_id', device_id)` reads.
-- Those queries were already correctly scoped to the caller's own
-- device_id, but that scoping was only ever a *client-chosen filter* — the
-- underlying "read votes" RLS policy (being replaced in the next
-- migration) allowed anyone to drop that filter and read every device's
-- votes. This function takes device_id as a parameter (same self-asserted,
-- unverifiable trust model as everywhere else in this app — there's no
-- real auth to check it against) and returns only post_id/vote/created_at,
-- never a device_id column, for anyone's data — so even though identity
-- isn't cryptographically verified, nothing returned by this function can
-- ever be used to deanonymize a DIFFERENT device's votes, which is the
-- actual security property that matters here.

create or replace function get_my_voted_post_ids(p_device_id text)
returns table (
  post_id uuid,
  vote text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select v.post_id, v.vote, v.created_at
  from votes v
  where v.device_id = p_device_id
$$;

grant execute on function get_my_voted_post_ids(text) to anon;
grant execute on function get_my_voted_post_ids(text) to authenticated;
