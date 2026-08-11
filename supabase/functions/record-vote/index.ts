// Supabase Edge Function: record-vote
//
// Temporary bypass for a platform-side issue where PostgREST's anon-key
// REST path rejects every direct table INSERT, even against unconditional
// policies (see the open Supabase support ticket) — the identical INSERT
// succeeds fine via the service-role key, which is what this function uses
// instead. CardStack.jsx used to insert into `votes` directly; this is a
// drop-in replacement, not a redesign of vote recording itself. Once
// Supabase confirms a fix, this can be retired and the client can go back
// to inserting directly — the original "insert vote" RLS policy is
// intentionally left in place (not dropped) to make that reversion trivial.
//
// Also the enforcement point for banned_devices on voting now: a
// service-role insert bypasses RLS entirely, so the is_device_banned()
// check that used to live in the RLS policy has to be re-done explicitly
// here instead.

import { createClient } from 'npm:@supabase/supabase-js@2'

const VALID_VOTES = ['red_flag', 'relax']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { post_id, device_id, vote } = await req.json()

    if (typeof post_id !== 'string' || typeof device_id !== 'string' || !VALID_VOTES.includes(vote)) {
      return new Response(JSON.stringify({ error: 'Invalid vote.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const normalizedDeviceId = device_id.slice(0, 128)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: banRow, error: banError } = await supabaseAdmin
      .from('banned_devices')
      .select('device_id')
      .eq('device_id', normalizedDeviceId)
      .maybeSingle()

    if (banError) throw banError
    if (banRow) {
      return new Response(JSON.stringify({ error: 'This device is not permitted to vote.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error } = await supabaseAdmin
      .from('votes')
      .insert({ post_id, device_id: normalizedDeviceId, vote })

    // A duplicate vote (already voted on this post from this device) isn't
    // a real failure — the unique (post_id, device_id) constraint is doing
    // its job. Same tolerance the old direct client-side insert had.
    if (error && error.code !== '23505') throw error

    return new Response(JSON.stringify({ ok: true }), {
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
