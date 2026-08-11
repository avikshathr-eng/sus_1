// Supabase Edge Function: submit-post
//
// Why this exists: the original approach ran the content filter in the
// browser (src/lib/moderation.js) and let the anon key insert straight into
// `posts`. That's bypassable by anyone calling the REST API directly, which
// is fine for a handful of friends but not for Apple/Google's "hold
// objectionable content for review" requirement (App Store Guideline 1.2 /
// Google Play UGC policy) once this is a real submitted app. This function
// re-runs the same checks server-side, using the service-role key, and is
// the ONLY way to create an approved post — the anon key's insert policy on
// `posts` is intentionally removed in schema.sql so this can't be skipped.
//
// Deploy: `supabase functions deploy submit-post`
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically —
// no manual secret setup needed.)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Filter } from 'npm:bad-words@4.0.0'

const ALLOWED_CATEGORIES = [
  'relationship', 'friendship', 'career', 'family', 'other',
]

// Must match src/lib/moderation.js's MAX_CONFESSION_LENGTH — Deno functions
// can't import from the frontend, so this is the one place it's duplicated
// rather than centralized.
const MAX_CONFESSION_LENGTH = 300

const PHONE_REGEX = /(\+?\d[\d\s-]{8,}\d)/
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/
const HANDLE_REGEX = /[@#][\w.]{2,}/
const URL_REGEX = /(https?:\/\/|www\.)\S+/i

const filter = new Filter()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function validate(text: string, category: string) {
  const trimmed = (text || '').trim()

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return { ok: false, reason: 'Invalid category.' }
  }
  if (trimmed.length < 5) return { ok: false, reason: 'A little more detail, please.' }
  if (trimmed.length > MAX_CONFESSION_LENGTH) return { ok: false, reason: `Keep it under ${MAX_CONFESSION_LENGTH} characters.` }
  if (PHONE_REGEX.test(trimmed)) return { ok: false, reason: 'No phone numbers — keep it anonymous.' }
  if (EMAIL_REGEX.test(trimmed)) return { ok: false, reason: 'No email addresses — keep it anonymous.' }
  if (HANDLE_REGEX.test(trimmed)) return { ok: false, reason: 'No @handles or hashtags — keep it anonymous.' }
  if (URL_REGEX.test(trimmed)) return { ok: false, reason: 'No links allowed.' }
  if (filter.isProfane(trimmed)) return { ok: false, reason: 'Keep it clean — try rewording.' }

  return { ok: true, text: trimmed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { text, category, device_id } = await req.json()
    const check = validate(text, category)

    if (!check.ok) {
      return new Response(JSON.stringify({ error: check.reason }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const normalizedDeviceId = typeof device_id === 'string' ? device_id.slice(0, 128) : null
    if (normalizedDeviceId) {
      // No daily submission cap — devices can Spill as many questions as
      // they want. The only server-side gate left is banned_devices (see
      // its migration for how a device actually gets banned — hand-run
      // SQL, no admin UI — and why this exists: App Store Guideline 1.2
      // expects the ability to remove abusive users, not just their
      // content).
      const { data: banRow, error: banError } = await supabaseAdmin
        .from('banned_devices')
        .select('device_id')
        .eq('device_id', normalizedDeviceId)
        .maybeSingle()

      if (banError) throw banError

      if (banRow) {
        return new Response(
          JSON.stringify({ error: 'This device is not permitted to submit posts.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const { data, error } = await supabaseAdmin
      .from('posts')
      .insert({
        text: check.text,
        category,
        status: 'approved',
        source: 'user_submitted',
        device_id: normalizedDeviceId,
      })
      .select()
      .single()

    if (error) throw error

    return new Response(JSON.stringify({ post: data }), {
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
