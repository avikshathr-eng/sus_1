// Shared reference distance for anything that maps horizontal drag distance
// to a 0–1 progress value (the page-fold reveal, shape parallax, the
// wordmark period). SwipeCard's actual vote *decision* still measures the
// real card width at drag time — this is just the proportional scale other
// decorative elements animate against, so they don't need the card's DOM
// node to compute a sensible response.
export const COMPLETION_DISTANCE = 120
