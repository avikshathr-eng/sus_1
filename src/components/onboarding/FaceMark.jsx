// A minimal abstract "face" mark — a circle with two dot eyes — used
// wherever the onboarding needs to gesture at "a person" without drawing an
// actual person. Reused across screens 1 and 3 rather than duplicated.
export default function FaceMark({ size = 22, bg = '#221e1a', eyeColor = '#ffffff', style }) {
  const eye = Math.max(2, Math.round(size * 0.14))
  const eyeOffsetX = size * 0.22
  const eyeOffsetY = size * 0.06

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        position: 'relative',
        flexShrink: 0,
        ...style,
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: eye,
          height: eye,
          borderRadius: '50%',
          background: eyeColor,
          top: `calc(50% - ${eyeOffsetY}px)`,
          left: `calc(50% - ${eyeOffsetX}px)`,
          transform: 'translate(-50%, -50%)',
        }}
      />
      <span
        style={{
          position: 'absolute',
          width: eye,
          height: eye,
          borderRadius: '50%',
          background: eyeColor,
          top: `calc(50% - ${eyeOffsetY}px)`,
          left: `calc(50% + ${eyeOffsetX}px)`,
          transform: 'translate(-50%, -50%)',
        }}
      />
    </div>
  )
}
