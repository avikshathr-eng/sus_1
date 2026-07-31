// The "." is a permanent coral-pink brand mark — it never inherits the
// current onboarding slide's background color or any other contextual
// color, on purpose (see --brand-period in styles.css). Only "sus" itself
// takes the near-black ink color.
export default function SusWordmark({ className }) {
  return (
    <span className={className ? `sus-wordmark ${className}` : 'sus-wordmark'}>
      sus<span className="sus-wordmark-dot">.</span>
    </span>
  )
}
