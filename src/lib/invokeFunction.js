import { supabase } from './supabase'

// supabase-js's functions.invoke() only populates `data` with the parsed
// response body on a 2xx status — for anything else (400/403/429/500),
// `data` is null and `error` is a generic FunctionsHttpError whose own
// .message is just "Edge Function returned a non-2xx status code", not
// whatever our function actually put in its JSON body. The real message
// (e.g. submit-post's "You've hit today's limit of 3 Spills...") only
// lives in `error.context`, the raw Response object, and has to be read
// asynchronously. Every call site that checked `data?.error` directly was
// silently losing that message and always falling back to a generic
// "something went wrong" — this centralizes the correct extraction so it
// can't be re-broken one call site at a time.
export async function invokeFunction(name, options) {
  const { data, error } = await supabase.functions.invoke(name, options)
  if (!error) return { data, error: null }

  let message = error.message
  if (error.context) {
    try {
      const body = await error.context.clone().json()
      if (body?.error) message = body.error
    } catch {
      // Response body wasn't JSON (or already consumed) — keep error.message.
    }
  }
  return { data, error: message }
}
