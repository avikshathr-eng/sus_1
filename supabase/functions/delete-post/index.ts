// Supabase Edge Function: delete-post
//
// Why this exists: there are no user accounts, only an anonymous per-device
// id — but "delete my own submissions" is a real, honest feature we can
// offer with that alone. The anon key has no delete policy on `posts` (same
// reasoning as submit-post: enforce this server-side, not just hide a
// button client-side), so this function is the only path. It verifies the
// caller's device_id matches the post's stored device_id (set by
// submit-post at creation time) before deleting — using the service-role
// key only after that check passes, never as a blanket bypass.
//
// Deploy: `supabase functions deploy delete-post`

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

    if (!post_id || !device_id) {
      return new Response(JSON.stringify({ error: 'Missing post_id or device_id.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: post, error: fetchError } = await supabaseAdmin
      .from('posts')
      .select('id, device_id')
      .eq('id', post_id)
      .single()

    if (fetchError || !post) {
      return new Response(JSON.stringify({ error: 'Post not found.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!post.device_id || post.device_id !== device_id) {
      return new Response(JSON.stringify({ error: 'This post was not submitted from this device.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: deleteError } = await supabaseAdmin.from('posts').delete().eq('id', post_id)
    if (deleteError) throw deleteError

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
