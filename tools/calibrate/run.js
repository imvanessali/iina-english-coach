// usage: node tools/calibrate/run.js '<style json>' [label] [text]
// Renders the same subtitle with IINA's libmpv and with the overlay page, then
// prints both glyph layouts and the shift that best aligns the overlay onto mpv.
// Images land in tools/calibrate/out/ (<label>-native.png, -overlay.png, -diff.png).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const PROJECT = path.resolve(__dirname, "../..");
const bin = path.join(__dirname, "build");
const dir = path.join(__dirname, "out");
fs.mkdirSync(dir, { recursive: true });
const style = { font: "sans-serif", fontSize: 55, scale: 1, color: "#FFFFFFFF", outlineColor: "#FF000000", outlineSize: 3,
  shadowColor: "#FF000000", shadowOffset: 0, backColor: "#00000000", borderStyle: "outline-and-shadow",
  marginX: 25, marginY: 22, position: 100, spacing: 0, bold: false, italic: false, alignX: "center", alignY: "bottom", justify: "auto",
  ...JSON.parse(process.argv[2] || "{}") };
const label = process.argv[3] || "case";
const text = process.argv[4] || "That's a great code word\nfor it, thank you.";
const srt = path.join(dir, `${label}.srt`);
fs.writeFileSync(srt, `1\n00:00:00,000 --> 00:00:05,000\n${text}\n`);
const yesno = (v) => (v ? "yes" : "no");
const mpvOptions = {
  "sub-font": style.font, "sub-font-size": style.fontSize, "sub-scale": style.scale, "sub-color": style.color,
  "sub-border-color": style.outlineColor, "sub-border-size": style.outlineSize, "sub-shadow-color": style.shadowColor,
  "sub-shadow-offset": style.shadowOffset, "sub-back-color": style.backColor, "sub-border-style": style.borderStyle,
  "sub-margin-x": style.marginX, "sub-margin-y": style.marginY, "sub-pos": style.position, "sub-spacing": style.spacing,
  "sub-bold": yesno(style.bold), "sub-italic": yesno(style.italic), "sub-align-x": style.alignX, "sub-align-y": style.alignY,
  "sub-justify": style.justify,
};
// mpv 0.38 (IINA 1.4.2) has no sub-border-style option.
delete mpvOptions["sub-border-style"];
const nativePng = path.join(dir, `${label}-native.png`);
const overlayPng = path.join(dir, `${label}-overlay.png`);
fs.rmSync(nativePng, { force: true });
execFileSync(path.join(bin, "mpvshot"), [nativePng, srt, ...Object.entries(mpvOptions).map(([k, v]) => `${k}=${v}`)], { stdio: "inherit" });
delete require.cache[require.resolve(`${PROJECT}/src/index.js`)];
const { buildOverlayStyle, FONT_METRICS_JXA, parseAssLines } = require(`${PROJECT}/src/index.js`);
// What mpv reports as sub-text-ass for SRT markup (<i>, <b>), and the plain text.
const assText = text.replace(/<i>/g, "{\\i1}").replace(/<\/i>/g, "{\\i0}").replace(/<b>/g, "{\\b1}").replace(/<\/b>/g, "{\\b0}").replace(/\n/g, "\\N");
const plainText = text.replace(/<\/?[ib]>/g, "");
// Same font metrics lookup the plugin does at runtime.
const fontName = String(style.font).toLowerCase() === "sans-serif" ? "Helvetica" : String(style.font);
const metrics = JSON.parse(execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", FONT_METRICS_JXA, fontName]).toString());
const payloadFile = path.join(dir, `${label}.json`);
fs.writeFileSync(payloadFile, JSON.stringify({ text: plainText, lines: parseAssLines(assText), style: buildOverlayStyle(style), fontInfo: { metrics: style.bold ? metrics.bold : metrics.regular, italicShear: metrics.italicShear, italic: Boolean(style.italic) } }));
// The paused-subtitle light sweep tints glyphs; hide it so only geometry is compared.
const env = { ...process.env };
if (!env.EXTRA_JS) env.EXTRA_JS = 'const s = document.createElement("style"); s.textContent = ".coach-shine { display: none !important; }"; document.head.appendChild(s);';
const posted = execFileSync(path.join(bin, "webshot"), [`${PROJECT}/ui/overlay.html`, payloadFile, overlayPng], { env }).toString();
if (process.env.SHOW_POSTED) console.log(posted.trim());
console.log(`== ${label} ${JSON.stringify(JSON.parse(process.argv[2] || "{}"))}`);
console.log(execFileSync(path.join(bin, "compare"), [nativePng, overlayPng, path.join(dir, `${label}-diff.png`)]).toString().trim());
