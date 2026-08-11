-- Indexes for get_feed()'s actual query shapes. Checked existing indexes
-- first (schema.sql already has posts_status_idx, posts_category_idx,
-- votes_post_idx) — these are new, complementary column combinations, not
-- duplicates.

-- get_feed's `voted`/`skipped`/`blocked` CTEs, and get_my_voted_post_ids —
-- all filter by device_id then need post_id, so device_id-leading
-- composite indexes cover both.
create index idx_votes_device_post on votes (device_id, post_id);
create index idx_post_skips_device_post on post_skips (device_id, post_id);
create index idx_author_blocks_device on author_blocks (device_id);

-- Fresh Boost lane: status='approved', source='user_submitted',
-- vote_count < 10 (FIRST_RESPONSE_TARGET), ordered by created_at desc.
-- The `10` here is tied to FIRST_RESPONSE_TARGET in get_feed() — if that
-- constant ever changes, this partial index's predicate should change
-- with it to stay effective (a mismatch doesn't break correctness, the
-- planner just falls back to a fuller scan).
create index idx_posts_fresh_boost on posts (created_at desc)
  where status = 'approved' and source = 'user_submitted' and vote_count < 10;

-- Needs Opinions lane: same filter shape but vote_count < 40
-- (ANSWER_TARGET), ordered by vote_count asc then created_at asc — the
-- lane's exact sort, so the index can serve it without a separate sort step.
create index idx_posts_needs_opinions on posts (vote_count asc, created_at asc)
  where status = 'approved' and source = 'user_submitted' and vote_count < 40;

-- Mature User lane (vote_count >= 40) and Seed lane both order by
-- random() — an index can't accelerate random ordering itself, only the
-- filtering step that finds the eligible row set first, so these are
-- plain partial indexes on the predicate rather than a sort column.
create index idx_posts_mature_user on posts (id)
  where status = 'approved' and source = 'user_submitted' and vote_count >= 40;
create index idx_posts_seed on posts (id)
  where status = 'approved' and source = 'seed';
