import { useLayoutEffect, useRef, useState } from 'react'

// Descending ladder within the spec's suggested bands (short ~30-34, medium
// ~26-29, long ~22-25, minimum ~19-20) — real layout measurement picks the
// largest one that actually fits, rather than guessing from character count.
const SIZES = [32, 29, 26, 23, 21, 19]

// Shrinks a text block to fit its container by actually measuring layout
// (scrollHeight vs. the container's own fixed height), not by estimating
// from character count — a short sentence with several line breaks can
// overflow just as easily as a long one without any. Re-measures on text
// change and on container resize.
export function useFitText(text) {
  const containerRef = useRef(null)
  const [fontSize, setFontSize] = useState(SIZES[0])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    function fit() {
      for (const size of SIZES) {
        el.style.fontSize = `${size}px`
        if (el.scrollHeight <= el.clientHeight + 1) {
          setFontSize(size)
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
