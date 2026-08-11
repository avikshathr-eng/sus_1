import { getMyPostIds, removeMyPostId } from './myPosts'
import { getSwipesLeft, DAILY_LIMIT } from './dailyLimit'
import { getDeviceId } from './supabase'
import { invokeFunction } from './invokeFunction'

// What's actually stored locally, for the "Manage my data" panel — everything
// here lives only in this browser's localStorage, nothing server-side is
// tied to a person.
export function getLocalDataSummary() {
  return {
    submissionCount: getMyPostIds().length,
    swipesUsedToday: DAILY_LIMIT - getSwipesLeft(),
  }
}

// Deletes every post this device has submitted, one at a time via the
// delete-post Edge Function (the only path that can actually remove a row —
// see supabase/functions/delete-post). Reports progress as it goes so the
// UI can show "3 of 5 deleted" rather than a single opaque spinner.
export async function deleteAllMySubmissions(onProgress) {
  const ids = getMyPostIds()
  const device_id = getDeviceId()
  let deleted = 0
  let failed = 0

  for (const id of ids) {
    const { error } = await invokeFunction('delete-post', {
      body: { post_id: id, device_id },
    })
    if (error) {
      failed += 1
    } else {
      removeMyPostId(id)
      deleted += 1
    }
    onProgress?.({ deleted, failed, total: ids.length })
  }

  return { deleted, failed, total: ids.length }
}

// Honest "delete my account" for an app with no accounts: clears every
// sus_-prefixed key this device has (device id, votes-today count, hidden
// lists, submitted-post ids, onboarding/age-gate flags), which is everything
// sus. has ever stored here. Does NOT delete already-submitted posts — that's
// the separate, explicit "Delete my submissions" action above.
export function resetDevice() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('sus_'))
    .forEach((k) => localStorage.removeItem(k))
}
