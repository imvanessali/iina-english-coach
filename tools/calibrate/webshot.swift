import AppKit
import WebKit
// usage: webshot overlay.html payload.json out.png
// Loads the overlay page offscreen at 960x480 points, emits render-subtitle with the
// payload exactly like IINA's bridge does, paints a gray background, snapshots at 2x.
let args = CommandLine.arguments
let pageURL = URL(fileURLWithPath: args[1])
let payload = try! String(contentsOfFile: args[2])
let outURL = URL(fileURLWithPath: args[3])
let pw = Double(ProcessInfo.processInfo.environment["PW"] ?? "960")!, ph = Double(ProcessInfo.processInfo.environment["PH"] ?? "480")!
let bridge = """
window.iina = { listeners: {}, _emit(name, data) { const cb = this.listeners[name]; if (typeof cb === "function") cb.call(null, data ? JSON.parse(data) : undefined); },
  onMessage(name, cb) { this.listeners[name] = cb; }, postMessage(name, data) { window.__posted = (window.__posted || []).concat([[name, data]]); } };
"""
class Delegate: NSObject, WKNavigationDelegate {
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let js = "document.documentElement.style.background = '#404040'; document.body.style.background = '#404040'; window.iina._emit('render-subtitle', \(String(reflecting: payload)));"
    webView.evaluateJavaScript(js) { _, error in
      if let error { print("js error: \(error)") }
      if let extra = ProcessInfo.processInfo.environment["EXTRA_JS"] { webView.evaluateJavaScript(extra) { r, e in if let e { print("extra error: \(e)") } } }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        let config = WKSnapshotConfiguration()
        config.snapshotWidth = NSNumber(value: pw)
        webView.takeSnapshot(with: config) { image, error in
          guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { print("snapshot failed: \(String(describing: error))"); exit(1) }
          try! rep.representation(using: .png, properties: [:])!.write(to: outURL)
          let probe = "(() => { const el = document.getElementById('coach-subtitle'); const r = document.createRange(); r.selectNodeContents(el); const cs = getComputedStyle(el); return JSON.stringify({ posted: window.__posted || [], texts: [...document.querySelectorAll('.coach-line')].map(l => { const r = document.createRange(); r.selectNodeContents(l); return l.textContent + ' = ' + r.getBoundingClientRect().width.toFixed(1); }), maxw: document.getElementById('coach-wrap').getBoundingClientRect().width, lines: [...r.getClientRects()].map(q => [q.top, q.bottom, q.left, q.right].map(v => +v.toFixed(2))), box: (b => [b.top, b.bottom].map(v => +v.toFixed(2)))(el.getBoundingClientRect()), lh: cs.lineHeight, fs: cs.fontSize, top: cs.top, vars: [el.style.getPropertyValue('--em-ratio'), el.style.getPropertyValue('--baseline-shift')] }); })()"
          webView.evaluateJavaScript(probe) { result, _ in
            print(result ?? "")
            exit(0)
          }
        }
      }
    }
  }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let config = WKWebViewConfiguration()
config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: pw, height: ph), styleMask: [.borderless], backing: .buffered, defer: false)
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: pw, height: ph), configuration: config)
window.contentView = webView
let delegate = Delegate()
webView.navigationDelegate = delegate
webView.loadFileURL(pageURL, allowingReadAccessTo: pageURL.deletingLastPathComponent().deletingLastPathComponent())
app.run()
