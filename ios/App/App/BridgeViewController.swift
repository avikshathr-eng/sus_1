import UIKit
import Capacitor

// UIScrollView.delaysContentTouches defaults to true (Apple's own default,
// never overridden by Capacitor) — it holds a touch for a brief moment
// before deciding whether it's a scroll, so it can cancel a tap cleanly.
// That delay is what a native app wants for a plain content scroller, but
// this app's swipe-card drag (framer-motion, driven entirely by JS touch
// events) needs to see the touch immediately. The delay is barely
// noticeable on a horizontal drag, since it doesn't compete with the
// webview's own (vertical) native scroll gesture — but the upward
// skip-swipe shares that exact axis, so the same delay reads as "slow to
// start, doesn't track the finger" specifically there. This is the
// standard fix for a Capacitor app that owns its own gesture handling.
// Deliberately NOT @objc(BridgeViewController) — Main.storyboard's
// customClass/customModule are plain XML strings, and Storyboard's runtime
// bridge constructs its own legacy-mangled lookup name from them
// (_TtC<module><class>) rather than reading any @objc attribute on the
// class itself; an explicit @objc name replaces the compiler's
// auto-generated legacy alias instead of adding to it, breaking that
// lookup. Plain `class Foo: Bar` gets the legacy alias generated
// automatically, which Storyboard needs.
//
// customModule in Main.storyboard must be "Sus_", not "App" — Xcode
// derives the Swift module name from PRODUCT_NAME ("Sus.") by sanitizing
// invalid identifier characters, so the real module is "Sus_", not the
// target name "App" it's easy to assume instead.
class BridgeViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.delaysContentTouches = false
        // Complementary to the above: once a touch has already been
        // delivered to a subview (the card, via JS touch events),
        // don't let the scroll view yank it away mid-gesture just because
        // the finger's path started to look like a vertical scroll — which
        // is exactly the ambiguity a skip-swipe creates, since it's
        // deliberately a vertical drag.
        webView?.scrollView.canCancelContentTouches = false
    }
}
