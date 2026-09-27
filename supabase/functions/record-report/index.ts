// Supabase Edge Function: record-report
//
// Same platform-issue bypass as record-vote (see that function's comment
// for the full explanation) — routes reports inserts through the
// service-role key instead of the currently-broken anon-key REST path.
//
// Also the enforcement point for the reports_post_device_uniq constraint
// (see supabase/migrations/20260827000001_report_lifecycle.sql) — one open
// report per (post, device) to stop a single device from spamming reports
// on the same post. A conflict here just means this device already
// reported this post, which is a success from the caller's perspective
// (ReportButton always shows "Thanks, we'll review it"), not an error.

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
    const { post_id, device_id, reason } = await req.json()

    if (typeof post_id !== 'string' || typeof device_id !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid report.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error } = await supabaseAdmin
      .from('reports')
      .insert({ post_id, device_id: device_id.slice(0, 128), reason: reason ?? null })

    // 23505 = unique_violation on reports_post_device_uniq — this device
    // already reported this post. Treat as idempotent success rather than
    // an error the client would need to handle differently.
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
