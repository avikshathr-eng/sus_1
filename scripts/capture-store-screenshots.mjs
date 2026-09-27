// Captures real App Store screenshots against a running local dev server
// (npm run dev) at an Apple-accepted display size. The previous batch
// (store-assets/screenshots/*, 1320x2868) used the 6.9" iPhone profile;
// Apple's screenshot uploader was rejecting them, so this captures at
// 1284x2778 instead — the 6.5"/6.7" size class (iPhone 12/13 Pro Max
// viewport: 428x926 CSS px @ deviceScaleFactor 3 = 1284x2778 physical px).
// The other three sizes the user listed (1242x2688, 2688x1242, 2778x1284)
// are the same display-size family in portrait/landscape/older-model form —
// swap VIEWPORT/DSF below to produce any of them.
//
// Usage: node scripts/capture-store-screenshots.mjs [devServerURL]

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.argv[2] || 'http://localhost:5183'
const OUT_DIR = path.join(__dirname, '..', 'store-assets', 'screenshots-6.7in')

const VIEWPORT = { width: 428, height: 926 } // CSS px
const DEVICE_SCALE_FACTOR = 3 // -> 1284 x 2778 physical px

mkdirSync(OUT_DIR, { recursive: true })

function seedLocalStorage(page) {
  return page.addInitScript(() => {
    localStorage.setItem('sus_onboarded', 'true')
    localStorage.setItem('sus_age_confirmed', 'true')
    localStorage.setItem('sus_tos_accepted_at', new Date().toISOString())
  })
}

async function shoot(page, name) {
  const file = path.join(OUT_DIR, name)
  await page.screenshot({ path: file })
  console.log('saved', file)
}

async function main() {
  const browser = await chromium.launch()

  // --- Onboarding (fresh device, no localStorage seeded) ---
  {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.onboard-headline')
    await page.waitForTimeout(500) // let decorative entrance motion settle
    await shoot(page, '01-onboarding-opinions.png')

    await page.click('.onboard-next-btn')
    await page.waitForTimeout(600)
    await shoot(page, '02-onboarding-swipe.png')

    await page.click('.onboard-next-btn')
    await page.waitForTimeout(600)
    await shoot(page, '03-onboarding-ask.png')

    await context.close()
  }

  // --- Feed / Crowd Picks / Spill / Red Flag result (onboarding + age gate pre-seeded) ---
  {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()
    await seedLocalStorage(page)
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })

    await page.waitForSelector('.card-stack .swipe-card', { timeout: 15000 })
    await page.waitForTimeout(500)
    await shoot(page, '04-feed.png')

    // Trigger real Red Flag votes via the tap-fallback button (more reliable
    // under automation than simulating the drag gesture) and capture the
    // full-screen result takeover (FullScreenAgreementResult, rendered by
    // App.jsx) while it's visible. It only mounts once BOTH the exit-timer
    // gate (RESULT_ENTER_DELAY, 220ms) and the real vote-percentage fetch
    // have resolved (see maybeRevealResult in CardStack.jsx), so poll for
    // its class rather than guessing a fixed delay.
    //
    // A single vote can land on a post with a near-50/50 real split, which
    // reads as an unresolved/uninteresting result for a store screenshot.
    // get_feed's distribution ladder favors low-vote-count posts (see
    // supabase/migrations/20260809000003_get_feed.sql), so there's no
    // reliable way to request a specific post — instead, vote Red Flag on
    // several real cards in a row and keep whichever genuine result reads
    // most decisively (percentage farthest from 50), discarding the rest.
    // Every candidate is still an authentic vote against the real project,
    // not a fabricated number.
    page.on('console', (msg) => { if (msg.type() === 'error') console.log('[browser]', msg.text()) })
    const MAX_VOTE_ATTEMPTS = 6
    let best = null
    for (let i = 0; i < MAX_VOTE_ATTEMPTS; i++) {
      await page.click('button[aria-label="Red Flag"]')
      await page.waitForSelector('.vote-result-fullscreen', { timeout: 8000 })
      await page.waitForTimeout(150) // let the reveal's own entrance transition settle
      const pctText = await page.textContent('.vote-result-pct')
      const pct = parseInt(pctText, 10)
      const buf = await page.screenshot()
      const decisiveness = Math.abs(pct - 50)
      console.log(`vote ${i + 1}/${MAX_VOTE_ATTEMPTS}: ${pct}% red flag`)
      if (!best || decisiveness > best.decisiveness) best = { buf, pct, decisiveness }
      await page.waitForSelector('.vote-result-fullscreen', { state: 'detached', timeout: 5000 }).catch(() => {})
      if (i < MAX_VOTE_ATTEMPTS - 1) {
        await page.waitForSelector('.card-stack .swipe-card', { timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(150)
      }
    }
    writeFileSync(path.join(OUT_DIR, '05-red-flag-result.png'), best.buf)
    console.log(`kept ${best.pct}% (most decisive of ${MAX_VOTE_ATTEMPTS} real votes) -> 05-red-flag-result.png`)

    await page.click('button[aria-label="Crowd Picks"]')
    await page.waitForTimeout(800)
    await shoot(page, '06-crowd-picks.png')

    await page.click('button[aria-label="Spill"]')
    await page.waitForTimeout(500)
    await shoot(page, '07-spill.png')

    await context.close()
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
