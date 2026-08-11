// Lightweight final reranking pass — avoids more than `maxConsecutive`
// cards of the same category in a row when a different category is
// available further down the batch. Deliberately a SWAP, never a drop:
// get_feed's priority ordering (vote_count-driven) is preserved for every
// post in the batch — this only ever changes WHERE in the batch a post
// appears, never WHETHER it appears. "Category diversity is secondary to
// getting under-answered user questions votes... never strand an
// under-answered post purely because of category balancing" — if no
// later card has a different category, the run is left as-is rather than
// dropping anything.
export function diversifyCategories(posts, maxConsecutive = 3) {
  const result = [...posts]
  for (let i = maxConsecutive; i < result.length; i++) {
    let allSame = true
    for (let back = 1; back <= maxConsecutive; back++) {
      if (result[i - back].category !== result[i].category) {
        allSame = false
        break
      }
    }
    if (!allSame) continue

    const swapIndex = result.findIndex((p, idx) => idx > i && p.category !== result[i].category)
    if (swapIndex !== -1) {
      const tmp = result[i]
      result[i] = result[swapIndex]
      result[swapIndex] = tmp
    }
  }
  return result
}
