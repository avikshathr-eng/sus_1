// Supabase Edge Function: record-skip
//
// Same platform-issue bypass as record-vote (see that function's comment
// for the full explanation) — routes post_skips inserts through the
// service-role key instead of the currently-broken anon-key REST path.
// Skip isn't gated on banned_devices — that check was never on skip's RLS
// policy either, only on submissions and voting, so this doesn't add one.

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
    const { post_id, device_id } = await req.json()

    if (typeof post_id !== 'string' || typeof device_id !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid skip.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error } = await supabaseAdmin
      .from('post_skips')
      .insert({ post_id, device_id: device_id.slice(0, 128) })

    // A duplicate skip is harmless — the post is already excluded from this
    // device's feed either way. Same tolerance the old direct insert had.
    if (error && error.code !== '23505') throw error

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Something went wrong.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
