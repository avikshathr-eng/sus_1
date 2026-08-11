// Supabase Edge Function: my-posts
//
// Why this exists: the anon key's only RLS read policy on `posts` is
// "status = 'approved'" (see schema.sql) — a device asking for its own
// pending/flagged/rejected submissions (for the "Your Posts" section) would
// get nothing back through a normal client query, regardless of device_id.
// This mirrors the same trust model already used by delete-post: the client
// supplies its own device_id, the function uses the service-role key to
// bypass RLS, and filters strictly by that device_id server-side. That's
// the same non-cryptographic anonymous-device trust boundary the whole app
// already relies on (no accounts to verify identity against), not a new gap.
//
// Deploy: `supabase functions deploy my-posts`

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { device_id } = await req.json()

    if (!device_id || typeof device_id !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing device_id.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // vote_count comes straight off the trigger-maintained counter column
    // (see the feed-distribution migrations) — cheap, no extra query.
    // Supports the future gathering (0-9) / taking shape (10-39) /
    // community read (40+) states without Crowd Picks needing to change
    // today; the classification itself is trivial to derive from this
    // number whenever that UI actually gets built.
    const { data: posts, error } = await supabaseAdmin
      .from('posts')
      .select('id, text, category, status, flag_reason, created_at, vote_count')
      .eq('device_id', device_id.slice(0, 128))
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    // Only approved posts have anything worth showing a result for — one
    // extra query against the results view, merged in below, rather than a
    // join PostgREST can't do automatically (post_results has no FK).
    const approvedIds = (posts ?? []).filter((p) => p.status === 'approved').map((p) => p.id)
    let resultsById: Record<string, { red_flag_count: number; relax_count: number; total_votes: number }> = {}

    if (approvedIds.length > 0) {
      const { data: results } = await supabaseAdmin
        .from('post_results')
        .select('post_id, red_flag_count, relax_count, total_votes')
        .in('post_id', approvedIds)
      resultsById = Object.fromEntries((results ?? []).map((r) => [r.post_id, r]))
    }

    const merged = (posts ?? []).map((p) => ({ ...p, result: resultsById[p.id] ?? null }))

    return new Response(JSON.stringify({ posts: merged }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Something went wrong — try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
