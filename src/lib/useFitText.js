import { useLayoutEffect, useRef, useState } from 'react'

// Descending ladder within the spec's suggested bands (short ~30-34, medium
// ~26-29, long ~22-25, minimum ~19-20) — real layout measurement (below)
// still picks the size that's actually used, this is only a starting guess.
const SIZES = [32, 29, 26, 23, 21, 19]

// Cheap, no-DOM-measurement starting guess so the common case only needs
// ONE layout read to confirm — avoids walking the whole ladder (up to 6
// forced synchronous reflows) on every single card mount, which was
// blocking paint for longer-text cards right as their entrance animation
// was trying to start (the actual cause of "some cards swipe in slow").
function guessStartIndex(text) {
  const len = text?.length ?? 0
  if (len <= 45) return 0
  if (len <= 75) return 1
  if (len <= 105) return 2
  if (len <= 135) return 3
  if (len <= 160) return 4
  return 5
}

// Shrinks a text block to fit its container by actually measuring layout
// (scrollHeight vs. the container's own fixed height), not by trusting the
// guess alone — a short sentence with several line breaks can overflow just
// as easily as a long one without any. Re-measures on text change and on
// container resize.
export function useFitText(text) {
  const containerRef = useRef(null)
  const [fontSize, setFontSize] = useState(() => SIZES[guessStartIndex(text)])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    function fits(size) {
      el.style.fontSize = `${size}px`
      return el.scrollHeight <= el.clientHeight + 1
    }

    function fit() {
      const guess = guessStartIndex(text)

      if (fits(SIZES[guess])) {
        // Guess already fits — that's the overwhelmingly common case, and
        // we're done in a single measurement. Don't bother searching for a
        // marginally-larger size that would also fit; correctness (no
        // overflow) matters far more here than squeezing out one more
        // notch of size.
        setFontSize(SIZES[guess])
        return
      }

      // Guess overflowed (an unusually dense or line-break-heavy card) —
      // step down from there until something fits. Rare path, so a plain
      // linear walk over the remaining (short) tail is fine.
      for (let i = guess + 1; i < SIZES.length; i++) {
        if (fits(SIZES[i])) {
          setFontSize(SIZES[i])
          return
        }
      }
      // Even the minimum size overflows (an unusually long pre-existing
      // card) — settle on the minimum and let .card-text's own overflow-y
      // handle the rest inside the card, rather than shrinking further into
      // illegibility.
      setFontSize(SIZES[SIZES.length - 1])
    }

    fit()

    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  return { containerRef, fontSize }
}
