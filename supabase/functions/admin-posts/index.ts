// Supabase Edge Function: admin-posts
//
// Why this exists: the moderation dashboard needs to list posts across every
// status (pending/approved/rejected/flagged) with report counts, and change
// a post's status — none of which the anon key can do (RLS only allows
// reading approved posts, and there's no update policy at all, by design).
// This is the one deliberate bypass of that: it runs with the service-role
// key, but only after checking a shared passphrase set as an Edge Function
// secret (ADMIN_PASSPHRASE) — never shipped in any client bundle. This is a
// lightweight gate, not real auth; treat the passphrase like a password and
// don't share the admin page's URL.
//
// Actions:
//   list           — posts + vote results + report stats (open count, oldest
//                     open report age — see reports_lifecycle migration).
//   update_status  — approve/reject/flag a single post.
//   resolve_reports — mark a post's open reports resolved without banning
//                     anyone (use when a report doesn't hold up).
//   ban_author     — Apple Guideline 1.2's "remove content + eject the
//                     user" in one step: resolves the post's device_id
//                     server-side, inserts it into banned_devices (which
//                     submit-post and record-vote already both check), pulls
//                     the post itself down (status='rejected'), and resolves
//                     its reports. Previously this whole path was "run SQL
//                     by hand in the Supabase dashboard" — not fast enough
//                     to reliably hit a 24h SLA, hence this action.
//
// Deploy: `supabase functions deploy admin-posts`
// Then set the secret once: Supabase Dashboard → Project Settings → Edge
// Functions → Secrets → add ADMIN_PASSPHRASE (or `supabase secrets set
// ADMIN_PASSPHRASE=...` via the CLI).

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'flagged']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { passphrase, action } = body

    const expected = Deno.env.get('ADMIN_PASSPHRASE')
    if (!expected || passphrase !== expected) {
      return new Response(JSON.stringify({ error: 'Not authorized.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    if (action === 'list') {
      const { data: posts, error } = await supabaseAdmin
        .from('posts')
        .select('id, text, category, status, safety_flag, flag_reason, flagged_at, source, created_at, device_id')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error

      const ids = (posts ?? []).map((p) => p.id)

      const [{ data: results }, { data: reports }] = await Promise.all([
        supabaseAdmin.from('post_results').select('post_id, red_flag_count, relax_count, total_votes').in('post_id', ids),
        supabaseAdmin.from('reports').select('post_id, reason, status, created_at').in('post_id', ids),
      ])

      const resultsById = Object.fromEntries((results ?? []).map((r) => [r.post_id, r]))
      const reportCountById: Record<string, number> = {}
      const openReportCountById: Record<string, number> = {}
      // Oldest still-open report per post — what the 24h SLA actually
      // measures against (a resolved report isn't a clock still running).
      const oldestOpenReportAtById: Record<string, string> = {}
      for (const r of reports ?? []) {
        reportCountById[r.post_id] = (reportCountById[r.post_id] ?? 0) + 1
        if (r.status === 'open') {
          openReportCountById[r.post_id] = (openReportCountById[r.post_id] ?? 0) + 1
          const existing = oldestOpenReportAtById[r.post_id]
          if (!existing || r.created_at < existing) oldestOpenReportAtById[r.post_id] = r.created_at
        }
      }

      const merged = (posts ?? []).map((p) => ({
        ...p,
        result: resultsById[p.id] ?? { red_flag_count: 0, relax_count: 0, total_votes: 0 },
        report_count: reportCountById[p.id] ?? 0,
        open_report_count: openReportCountById[p.id] ?? 0,
        oldest_open_report_at: oldestOpenReportAtById[p.id] ?? null,
      }))

      return new Response(JSON.stringify({ posts: merged }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'update_status') {
      const { post_id, status, flag_reason } = body

      if (!post_id || !VALID_STATUSES.includes(status)) {
        return new Response(JSON.stringify({ error: 'Missing/invalid post_id or status.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const update: Record<string, unknown> = { status }
      if (status === 'flagged') {
        update.flag_reason = typeof flag_reason === 'string' ? flag_reason.slice(0, 300) : null
        update.flagged_at = new Date().toISOString()
      } else {
        update.flag_reason = null
        update.flagged_at = null
      }

      const { error } = await supabaseAdmin.from('posts').update(update).eq('id', post_id)
      if (error) throw error

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'resolve_reports') {
      const { post_id } = body
      if (!post_id) {
        return new Response(JSON.stringify({ error: 'Missing post_id.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error } = await supabaseAdmin
        .from('reports')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('post_id', post_id)
        .eq('status', 'open')
      if (error) throw error

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'ban_author') {
      const { post_id, reason } = body
      if (!post_id) {
        return new Response(JSON.stringify({ error: 'Missing post_id.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: post, error: postError } = await supabaseAdmin
        .from('posts')
        .select('id, device_id')
        .eq('id', post_id)
        .single()
      if (postError) throw postError

      // Seed content has no submitting device — nothing to eject. The post
      // itself can still be rejected via the ordinary update_status action.
      if (!post?.device_id) {
        return new Response(
          JSON.stringify({ error: 'This post has no submitting device (seed content) — nothing to restrict.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const banReason = typeof reason === 'string' && reason.trim()
        ? reason.trim().slice(0, 300)
        : `Removed via admin dashboard for post ${post_id}`

      // Apple's rejection language is "removing the content and ejecting the
      // user" — singular content, but a user who submitted one offending
      // post and is being ejected for it shouldn't get to keep every OTHER
      // post live. Resolve every post this device has ever submitted, not
      // just the one that was reported.
      const { data: authorPosts, error: authorPostsError } = await supabaseAdmin
        .from('posts')
        .select('id')
        .eq('device_id', post.device_id)
      if (authorPostsError) throw authorPostsError
      const authorPostIds = (authorPosts ?? []).map((p) => p.id)

      // Order matters for auditability, not correctness: ban first (closes
      // the door on further submissions/votes from this device immediately),
      // then pull down all of this device's content, then close out every
      // one of its reports.
      const { error: banError } = await supabaseAdmin
        .from('banned_devices')
        .upsert({ device_id: post.device_id, reason: banReason }, { onConflict: 'device_id', ignoreDuplicates: true })
      if (banError) throw banError

      const { error: rejectError } = await supabaseAdmin
        .from('posts')
        .update({ status: 'rejected', flag_reason: null, flagged_at: null })
        .in('id', authorPostIds)
        .neq('status', 'rejected')
      if (rejectError) throw rejectError

      const { error: resolveError } = await supabaseAdmin
        .from('reports')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .in('post_id', authorPostIds)
        .eq('status', 'open')
      if (resolveError) throw resolveError

      return new Response(
        JSON.stringify({ ok: true, device_id: post.device_id, removed_post_count: authorPostIds.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(JSON.stringify({ error: 'Unknown action.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Something went wrong — try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
