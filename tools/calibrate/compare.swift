import AppKit
// usage: compare native.png overlay.png diff.png
// White glyph fill masks: bounding boxes, per-line rows, and a red/green composite.
func load(_ p: String) -> NSBitmapImageRep { NSBitmapImageRep(data: try! Data(contentsOf: URL(fileURLWithPath: p)))! }
let a = CommandLine.arguments
let n = load(a[1]), o = load(a[2])
let w = min(n.pixelsWide, o.pixelsWide), h = min(n.pixelsHigh, o.pixelsHigh)
func mask(_ r: NSBitmapImageRep) -> [Bool] {
  var m = [Bool](repeating: false, count: w * h)
  var px = [Int](repeating: 0, count: 4)
  for y in 0..<h { for x in 0..<w { r.getPixel(&px, atX: x, y: y); m[y * w + x] = px[0] > 225 && px[1] > 225 && px[2] > 225 } }
  return m
}
let mn = mask(n), mo = mask(o)
func stats(_ m: [Bool], _ name: String) {
  var minX = w, maxX = -1, minY = h, maxY = -1, count = 0
  var rows = [Int](repeating: 0, count: h)
  for y in 0..<h { for x in 0..<w where m[y * w + x] { count += 1; rows[y] += 1; minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
  // line bands: runs of rows with ink, baseline approximated by the last row with > 25% of the band's peak
  var bands: [(Int, Int)] = []; var start = -1
  for y in 0...h { let ink = y < h && rows[y] > 0; if ink && start < 0 { start = y }; if !ink && start >= 0 { if y - start > 8 { bands.append((start, y - 1)) }; start = -1 } }
  let desc = bands.map { b -> String in
    let peak = rows[b.0...b.1].max()!
    let base = (b.0...b.1).last { rows[$0] > peak / 4 }!
    var bx0 = w, bx1 = -1
    for y in b.0...b.1 { for x in 0..<w where m[y * w + x] { bx0 = min(bx0, x); bx1 = max(bx1, x) } }
    return "[top \(b.0) base \(base) bottom \(b.1) x \(bx0)-\(bx1) w \(bx1 - bx0)]"
  }
  print("\(name): ink \(count) bbox x \(minX)-\(maxX) y \(minY)-\(maxY) lines \(desc.joined(separator: " "))")
}
stats(mn, "native ")
stats(mo, "overlay")
var both = 0, onlyN = 0, onlyO = 0
for i in 0..<(w * h) { if mn[i] && mo[i] { both += 1 } else if mn[i] { onlyN += 1 } else if mo[i] { onlyO += 1 } }
print(String(format: "overlap IoU %.3f (both %d, native-only %d, overlay-only %d)", Double(both) / Double(max(1, both + onlyN + onlyO)), both, onlyN, onlyO))
// Best alignment: shift the overlay mask by (dx, dy) and maximize IoU with the native mask.
var best = (iou: -1.0, dx: 0, dy: 0)
var nIdx: [Int] = []; for i in 0..<(w * h) where mn[i] { nIdx.append(i) }
var oIdx: [Int] = []; for i in 0..<(w * h) where mo[i] { oIdx.append(i) }
let nSet = Set(nIdx)
for dy in -10...10 { for dx in -10...10 {
  var inter = 0
  for i in oIdx { let x = i % w + dx, y = i / w + dy; if x >= 0 && x < w && y >= 0 && y < h && nSet.contains(y * w + x) { inter += 1 } }
  let iou = Double(inter) / Double(nIdx.count + oIdx.count - inter)
  if iou > best.iou { best = (iou, dx, dy) }
}}
print(String(format: "best shift to align overlay onto native: dx %+d dy %+d (IoU %.3f)", best.dx, best.dy, best.iou))
if a.count > 3 {
  let out = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  var px = [Int](repeating: 0, count: 3)
  for y in 0..<h { for x in 0..<w { let i = y * w + x; px[0] = mn[i] ? 255 : 30; px[1] = mo[i] ? 255 : 30; px[2] = 30; out.setPixel(&px, atX: x, y: y) } }
  try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[3]))
}
