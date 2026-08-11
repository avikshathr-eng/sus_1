// Single documented home for the feed-distribution constants — the actual
// filtering/ranking logic lives server-side in the get_feed() Postgres
// function (supabase/migrations/20260809000003_get_feed.sql), since
// eligibility has to be enforced where the data lives, not trusted to the
// client. These are mirrored here so a maintainer changing one number
// doesn't have to go spelunking in SQL to find out what it should be —
// FEED_BATCH_SIZE is also the one of these actually read by client code
// (the `p_limit` passed to every get_feed call below).
//
// FIRST_RESPONSE_TARGET and ANSWER_TARGET are NOT filter thresholds you'll
// find copied literally into a JS conditional anywhere: ANSWER_TARGET (40)
// is the literal vote_count threshold get_feed's "needs opinions" lane
// uses, and FIRST_RESPONSE_TARGET (8) is purely an observability
// benchmark — see admin_time_to_votes' avg_minutes_to_8_votes column
// (supabase/migrations/20260809000007_observability_views.sql). The fresh
// boost lane's own threshold (vote_count < 10) is a separate number by
// design — "just posted" vs. "has gotten SOME traction" aren't the same
// target, even though they're close.
export const FIRST_RESPONSE_TARGET = 8
export const ANSWER_TARGET = 40
export const FEED_BATCH_SIZE = 30
