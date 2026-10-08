/* global iina */

const runtime = typeof iina !== "undefined" ? iina : null;

// mpv 0.38 defaults, used only when an option cannot be read.
const DEFAULT_SUBTITLE_STYLE = {
  font: "sans-serif",
  fontSize: 55,
  scale: 1,
  color: "#FFFFFFFF",
  outlineColor: "#FF000000",
  outlineSize: 3,
  shadowColor: "#FF000000",
  shadowOffset: 0,
  backColor: "#00000000",
  borderStyle: "outline-and-shadow",
  marginX: 25,
  marginY: 22,
  position: 100,
  spacing: 0,
  bold: false,
  italic: false,
  alignX: "center",
  alignY: "bottom",
  justify: "auto",
};

function finiteNumber(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function cssColor(value, fallback) {
  const color = String(value || "").trim();
  const argb = color.match(/^#([0-9a-f]{2})([0-9a-f]{6})$/i);
  if (argb) return `#${argb[2]}${argb[1]}`;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;

  const parts = color.split("/").map(Number);
  if ((parts.length === 1 || parts.length === 2) && parts.every(Number.isFinite)) {
    const gray = Math.round(Math.max(0, Math.min(1, parts[0])) * 255);
    const alpha = parts.length === 2 ? Math.max(0, Math.min(1, parts[1])) : 1;
    return `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
  }
  if ((parts.length === 3 || parts.length === 4) && parts.every(Number.isFinite)) {
    const rgb = parts.slice(0, 3).map((part) => Math.round(Math.max(0, Math.min(1, part)) * 255));
    const alpha = parts.length === 4 ? Math.max(0, Math.min(1, parts[3])) : 1;
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }
  return fallback;
}

// True when an mpv color is fully transparent (#AARRGGBB with AA=00, or r/g/b/a with a=0).
function isTransparentColor(value) {
  const color = String(value || "").trim();
  const argb = color.match(/^#([0-9a-f]{2})[0-9a-f]{6}$/i);
  if (argb) return argb[1] === "00";
  const parts = color.split("/").map(Number);
  if ((parts.length === 2 || parts.length === 4) && parts.every(Number.isFinite)) return parts[parts.length - 1] === 0;
  return false;
}

// libass resolves generic families through CoreText the same way on every Mac;
// WebKit picks generics by page language instead, so name the real fonts.
const LIBASS_GENERIC_FONTS = { "sans-serif": "Helvetica", serif: "Times", monospace: "Courier" };

// Families whose regular face libass picks differently from WebKit.
const LIBASS_REGULAR_FACES = { avenir: "Avenir-Roman" };

// Parses an mpv color ("#AARRGGBB", "#RRGGBB" or "r/g/b[/a]" floats) into
// [alpha, red, green, blue] bytes, or null.
function parseMpvColor(value) {
  const color = String(value || "").trim();
  let match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (match) return match.slice(1).map((part) => Number.parseInt(part, 16));
  match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (match) return [255, ...match.slice(1).map((part) => Number.parseInt(part, 16))];
  const parts = color.split("/").map(Number);
  if (parts.length >= 3 && parts.length <= 4 && parts.every(Number.isFinite)) {
    const [r, g, b, a = 1] = parts.map((part) => Math.round(Math.max(0, Math.min(1, part)) * 255));
    return [a, r, g, b];
  }
  if (parts.length >= 1 && parts.length <= 2 && parts.every(Number.isFinite)) {
    const [gray, a = 1] = parts.map((part) => Math.round(Math.max(0, Math.min(1, part)) * 255));
    return [a, gray, gray, gray];
  }
  return null;
}

function sameMpvColor(left, right) {
  const a = parseMpvColor(left);
  const b = parseMpvColor(right);
  return Boolean(a && b) && a.every((value, index) => Math.abs(value - b[index]) <= 1);
}

// While paused the native subtitle is hidden by making its colors fully
// transparent. Each option gets a distinctive marker value, so a color the user
// picks in IINA (even a transparent one) is never mistaken for the plugin's own.
const HIDDEN_COLORS = {
  color: "#00010203",
  outlineColor: "#00010204",
  shadowColor: "#00010205",
  backColor: "#00010206",
};

function cssFontFamily(value, bold = false) {
  const font = String(value || "").trim() || "sans-serif";
  const generic = LIBASS_GENERIC_FONTS[font.toLowerCase()];
  const name = generic || (!bold && LIBASS_REGULAR_FACES[font.toLowerCase()]) || font;
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}", ${generic ? font.toLowerCase() : "sans-serif"}`;
}

// mpv sizes text subtitles in "scaled pixels": units of 1/720 of the window height.
function scaledPixels(value, scale = 1) {
  return `${(finiteNumber(value, 0) * finiteNumber(scale, 1) / 7.2).toFixed(4)}vh`;
}

// Reads the vertical metrics libass uses for a font (OS/2 winAscent/winDescent,
// or hhea when there is no usable OS/2 table) through CoreText, via osascript.
// Prints {"regular": [em/line, baseline/line], "bold": [...], "italicShear":
// 0 when libass uses a real italic face, else its synthetic slant (tan),
// "syntheticBold": true when libass emboldens the regular face itself}.
const FONT_METRICS_JXA = "ObjC.import(\"CoreText\");\nObjC.import(\"Foundation\");\n// Prints libass's vertical metrics for a font name: [em size / line height, baseline / line height]\n// for the regular and bold faces. libass sizes text so OS/2 winAscent + winDescent equals the font\n// size (falling back to hhea when a font has no usable OS/2 table).\nfunction metrics(font) {\n  const upm = $.CTFontGetUnitsPerEm(font);\n  const data = ObjC.castRefToObject($.CTFontCopyTable(font, 0x4F532F32, 0));\n  if (data && !data.isNil() && data.length >= 78) {\n    // usWinAscent and usWinDescent are big-endian uint16 at byte offsets 74 and 76.\n    const slice = data.subdataWithRange($.NSMakeRange(74, 4));\n    const hex = ObjC.unwrap(slice.description).replace(/^.*bytes = 0x|[<>{}\\s]/g, \"\").replace(/[^0-9a-f]/gi, \"\");\n    const winAscent = parseInt(hex.slice(0, 4), 16);\n    const winDescent = parseInt(hex.slice(4, 8), 16);\n    if (winAscent + winDescent > 0) return [upm / (winAscent + winDescent), winAscent / (winAscent + winDescent)];\n  }\n  const ascent = $.CTFontGetAscent(font), descent = $.CTFontGetDescent(font); // font is 1000 pt\n  return [1000 / (ascent + descent), ascent / (ascent + descent)];\n}\nfunction hasTable(font, tag) {\n  const data = ObjC.castRefToObject($.CTFontCopyTable(font, tag, 0));\n  return Boolean(data && !data.isNil() && data.length > 0);\n}\nfunction traits(font) {\n  return $.CTFontGetSymbolicTraits(font);\n}\nfunction run(argv) {\n  const name = argv[0];\n  const font = $.CTFontCreateWithName($(name), 1000, null);\n  const family = ObjC.unwrap(ObjC.castRefToObject($.CTFontCopyFamilyName(font)));\n  // libass matches a font name against family, full and PostScript names. A\n  // family name brings the whole family (real italic/bold faces); a face name\n  // brings only that face, which libass then slants or emboldens itself.\n  const isFamily = String(family).toLowerCase() === String(name).toLowerCase();\n  const italicFace = isFamily ? $.CTFontCreateCopyWithSymbolicTraits(font, 0, null, 1, 1) : null;\n  const italicObject = italicFace ? ObjC.castRefToObject(italicFace) : null;\n  const hasItalic = Boolean(traits(font) & 1) || Boolean(italicObject && !italicObject.isNil() && (traits(italicFace) & 1));\n  const boldFace = isFamily ? $.CTFontCreateCopyWithSymbolicTraits(font, 0, null, 2, 2) : null;\n  const boldObject = boldFace ? ObjC.castRefToObject(boldFace) : null;\n  const hasBold = Boolean(traits(font) & 2) || Boolean(boldObject && !boldObject.isNil() && (traits(boldFace) & 2));\n  // libass's synthetic italic shear: tan(10deg) for PostScript (CFF) outlines,\n  // 0x5700/0x10000 (about 18.77deg, like GDI) for TrueType outlines. Some\n  // system fonts hide their outline tables, so only a visible glyf table counts\n  // as TrueType (PingFang, for one, is CFF behind the scenes).\n  const cff = !hasTable(font, 0x676C7966);\n  return JSON.stringify({\n    regular: metrics(font),\n    bold: hasBold ? metrics(boldFace) : metrics(font),\n    italicShear: hasItalic ? 0 : (cff ? 0x2d24 : 0x5700) / 0x10000,\n    syntheticBold: !hasBold,\n  });\n}";

const DEFAULT_FRAME = {
  w: 1, h: 1, mt: 0, mb: 0, ml: 0, mr: 0,
  useMargins: true, scaleWithWindow: true, scaleByWindow: true,
};

// Converts mpv's subtitle settings into overlay CSS, following libass 0.17 and
// mpv 0.38 (sd_ass.c configure_ass, ass_render.c y2scr_* / x2scr_*). `frame`
// describes the video inside the window (mpv osd-dimensions, device pixels).
function buildOverlayStyle(style = {}, frameInfo = {}) {
  const settings = { ...DEFAULT_SUBTITLE_STYLE, ...style };
  const frame = { ...DEFAULT_FRAME, ...frameInfo };
  const W = Math.max(1, finiteNumber(frame.w, 1));
  const H = Math.max(1, finiteNumber(frame.h, 1));
  const mt = Math.max(0, finiteNumber(frame.mt, 0)) / H;
  const mb = Math.max(0, finiteNumber(frame.mb, 0)) / H;
  const ml = Math.max(0, finiteNumber(frame.ml, 0)) / W;
  const mr = Math.max(0, finiteNumber(frame.mr, 0)) / W;
  const videoW = Math.max(0.01, 1 - ml - mr); // fractions of the window
  const videoH = Math.max(0.01, 1 - mt - mb);
  const windowAspect = W / H;
  const videoAspect = (videoW * W) / (videoH * H);
  // libass's "fit" box: the window shrunk to the video's aspect ratio.
  const fitW = videoAspect < windowAspect ? videoAspect / windowAspect : 1;
  const fitH = videoAspect > windowAspect ? windowAspect / videoAspect : 1;
  // Glyphs, outlines, shadows and spacing scale with the font; margins do not.
  const fontScreenH = frame.useMargins ? fitH : videoH;
  const fontFactor = fontScreenH
    * (frame.scaleWithWindow ? 1 / videoH : 1)
    * (frame.scaleByWindow ? 1 : 720 / H);
  const scale = finiteNumber(settings.scale, 1) * fontFactor;
  const alignX = ["left", "center", "right"].includes(settings.alignX) ? settings.alignX : "center";
  const alignY = ["top", "center", "bottom"].includes(settings.alignY) ? settings.alignY : "bottom";
  const justify = ["left", "center", "right"].includes(settings.justify) ? settings.justify : alignX;
  const vh = (value) => `${(value * 100).toFixed(4)}vh`;
  const vw = (value) => `${(value * 100).toFixed(4)}vw`;

  // Vertical margin in script pixels (PlayResY 288), mapped onto the fit box
  // (subtitles may use the black bars) or onto the video itself.
  const marginV = Math.trunc(Math.max(0, finiteNumber(settings.marginY, 22)) * 288 / 720) / 288
    * (frame.useMargins ? fitH : videoH);
  // sub-pos moves bottom subtitles up by (100 - pos)% of the distance between the
  // bottom margin line and the top of the subtitle area.
  const linePosition = (100 - Math.max(0, Math.min(150, finiteNumber(settings.position, 100)))) / 100;
  const areaTop = frame.useMargins ? 0 : mt;
  const areaBottom = frame.useMargins ? 0 : mb;
  const bottom = areaBottom + marginV + (1 - areaTop - areaBottom - marginV) * linePosition;
  const vertical = alignY === "top"
    ? `top: ${vh(areaTop + marginV)};`
    : alignY === "center"
      ? `top: ${vh(frame.useMargins ? 0.5 : mt + videoH / 2)}; transform: translateY(-50%);`
      : `bottom: ${vh(bottom)};`;
  // Horizontal margins: trunc(margin * 0.4) script pixels, rescaled by mpv's
  // PlayResX / 384 adjustment, i.e. 1/384 of the fit (or video) width each.
  const marginH = Math.trunc(Math.max(0, finiteNumber(settings.marginX, 25)) * 288 / 720) / 384
    * (frame.useMargins ? fitW : videoW);
  const left = (frame.useMargins ? 0 : ml) + marginH;
  const right = (frame.useMargins ? 0 : mr) + marginH;

  const outline = finiteNumber(settings.outlineSize, 0);
  const shadowOffset = finiteNumber(settings.shadowOffset, 0);
  const boxed = settings.borderStyle === "opaque-box" || settings.borderStyle === "background-box";
  // libass draws the outline entirely outside the glyph; a CSS stroke is centered
  // on the glyph edge and paint-order hides its inner half, so double the width.
  // background-box keeps the outline; opaque-box turns the outline into the box.
  const stroke = settings.borderStyle === "opaque-box" || outline <= 0
    ? "0 transparent"
    : `${scaledPixels(outline * 2, scale)} ${cssColor(settings.outlineColor, "#000000")}`;
  const shadow = boxed || shadowOffset === 0
    ? "none"
    : `${scaledPixels(shadowOffset, scale)} ${scaledPixels(shadowOffset, scale)} 0 ${cssColor(settings.shadowColor, "#000000")}`;
  // opaque-box fills the box with the outline color, background-box with the back color.
  const box = settings.borderStyle === "opaque-box"
    ? cssColor(settings.outlineColor, "#000000")
    : settings.borderStyle === "background-box" ? cssColor(settings.backColor, "transparent") : "transparent";
  // The box reaches one outline width beyond the text; a spread shadow draws that
  // margin without moving the text.
  const boxSpread = boxed ? `0 0 0 ${scaledPixels(Math.max(outline, 0), scale)} ${box}` : "none";

  return `
  * { box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: transparent;
  }
  #coach-wrap {
    position: absolute;
    left: ${vw(left)};
    right: ${vw(right)};
    ${vertical}
    display: flex;
    justify-content: ${alignX === "left" ? "flex-start" : alignX === "right" ? "flex-end" : "center"};
    pointer-events: none;
  }
  #coach-subtitle {
    /* --ass-size is libass's font size, which is also the height of one line.
       The overlay page sets --em-ratio (CSS font size per libass size) and
       --baseline-shift (measured offset to libass's baseline). */
    --ass-size: ${scaledPixels(settings.fontSize, scale)};
    position: relative;
    top: var(--baseline-shift, 0px);
    /* libass glyphs land one device pixel right of WebKit's (measured). */
    left: var(--device-pixel, 0.5px);
    max-width: 100%;
    color: ${cssColor(settings.color, "#FFFFFF")};
    font-family: ${cssFontFamily(settings.font, settings.bold)};
    font-size: calc(var(--ass-size) * var(--em-ratio, 0.85));
    font-weight: ${settings.bold ? 700 : 400};
    font-style: ${settings.italic ? "italic" : "normal"};
    line-height: var(--ass-size);
    letter-spacing: ${scaledPixels(settings.spacing, scale)};
    /* libass leaves kerning off by default (VSFilter compatibility). */
    font-kerning: none;
    /* macOS font smoothing thickens stems; libass renders plain grayscale coverage. */
    -webkit-font-smoothing: antialiased;
    text-align: ${justify};
    white-space: pre-line;
    text-wrap: balance;
    cursor: text;
    pointer-events: auto;
    user-select: text;
    -webkit-user-select: text;
    -webkit-text-stroke: ${stroke};
    paint-order: stroke fill;
    stroke-linejoin: round;
    text-shadow: ${shadow};
    background: ${box};
    box-shadow: ${boxSpread};
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  /* One block per subtitle line, exactly one libass line tall: WebKit rounds
     line-height to whole pixels, min-height keeps the fractional pitch. */
  .coach-line { display: block; min-height: var(--ass-size); }
`;
}

function cleanSubtitle(value) {
  return String(value || "")
    .replace(/\\N/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Parses mpv's sub-text-ass (ASS-formatted subtitle text, e.g. SRT <i> tags
// become {\i1}...{\i0}) into lines of styled runs: [[{ t, i, b }]], where i/b
// are true/false when overridden and null when the subtitle style applies.
function parseAssLines(ass) {
  const lines = [[]];
  let italic = null;
  let bold = null;
  const push = (text) => {
    if (!text) return;
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && last.i === italic && last.b === bold) last.t += text;
    else line.push({ t: text, i: italic, b: bold });
  };
  const tokens = String(ass || "").match(/\{[^}]*\}|\\[Nn]|\\h|[^{\\]+|[{\\]/g) || [];
  for (const token of tokens) {
    if (token === "\\N" || token === "\\n") lines.push([]);
    else if (token === "\\h") push(" ");
    else if (token[0] === "{" && token[token.length - 1] === "}") {
      for (const tag of token.slice(1, -1).match(/\\(?:r|i\d*|b\d*)(?![a-z])/g) || []) {
        if (tag === "\\r") {
          italic = null;
          bold = null;
        } else if (tag[1] === "i") {
          const value = tag.slice(2);
          italic = value === "" ? null : value !== "0";
        } else {
          const value = tag.slice(2);
          bold = value === "" ? null : value === "1" || Number(value) >= 600;
        }
      }
    } else push(token.replace(/[ \t]+/g, " "));
  }
  // Trim each line and drop empty runs.
  return lines.map((line) => {
    if (line.length) {
      line[0].t = line[0].t.replace(/^ +/, "");
      line[line.length - 1].t = line[line.length - 1].t.replace(/ +$/, "");
    }
    return line.filter((run) => run.t);
  }).filter((line, index, all) => line.length || (index > 0 && index < all.length - 1));
}

// Parses SRT text into cues: [{ text }] in file order (tags removed).
function parseSrt(content) {
  return String(content || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n"))
    .map((lines) => {
      const timing = lines.findIndex((line) => line.includes("-->"));
      return timing < 0 ? null : lines.slice(timing + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
    })
    .filter((text) => text)
    .map((text) => ({ text }));
}

// The cues around the current line, for context: { before: [...], after: [...] }.
function subtitleContext(cues, current, before = 2, after = 1) {
  const wanted = String(current || "").replace(/\s+/g, " ").trim();
  const index = cues.findIndex((cue) => cue.text === wanted);
  if (index < 0) return { before: [], after: [] };
  return {
    before: cues.slice(Math.max(0, index - before), index).map((cue) => cue.text),
    after: cues.slice(index + 1, index + 1 + after).map((cue) => cue.text),
  };
}

// Large-model providers for in-context explanations. Most speak the OpenAI
// chat-completions format; Claude uses Anthropic's Messages API. Default models
// are suggestions: the model field in the plugin's preferences overrides them.
const LLM_PROVIDERS = {
  anthropic: { name: "Claude (Anthropic)", kind: "anthropic", url: "https://api.anthropic.com/v1/messages", model: "claude-opus-5-5" },
  openai: { name: "OpenAI", kind: "openai", base: "https://api.openai.com/v1", model: "gpt-5-mini" },
  gemini: { name: "Google Gemini", kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  deepseek: { name: "DeepSeek", kind: "openai", base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  moonshot: { name: "Kimi (Moonshot)", kind: "openai", base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  qwen: { name: "通义千问 (阿里云百炼)", kind: "openai", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  zhipu: { name: "智谱 GLM", kind: "openai", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  doubao: { name: "豆包 (火山方舟)", kind: "openai", base: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
  siliconflow: { name: "硅基流动", kind: "openai", base: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
  openrouter: { name: "OpenRouter", kind: "openai", base: "https://openrouter.ai/api/v1", model: "openai/gpt-5-mini" },
  xai: { name: "xAI Grok", kind: "openai", base: "https://api.x.ai/v1", model: "grok-3-mini" },
  mistral: { name: "Mistral", kind: "openai", base: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  custom: { name: "自定义（OpenAI 兼容）", kind: "openai", base: "", model: "" },
};

const LLM_SYSTEM = [
  "You help a native Chinese speaker who is learning English while watching an English-language show with English subtitles.",
  "They paused and selected part of the current subtitle line. Answer in Simplified Chinese, briefly and concretely.",
  "meaning: what the selected words mean in this exact line, including slang, idiom or tone; one or two sentences.",
  "sentence: a natural Chinese translation of the whole current line, the way a good subtitle translator would write it.",
  "notes: slang, idioms, wordplay or cultural references in the line worth knowing (people, shows, brands, customs, US-specific things), explained for someone outside that culture; an empty string when there is nothing notable.",
  "Use the surrounding lines and the show title only to understand the context.",
].join("\n");

const LLM_JSON_INSTRUCTION = 'Reply with only a JSON object of the form {"meaning": "...", "sentence": "...", "notes": "..."}, with no other text.';

const LLM_SCHEMA = {
  type: "object",
  properties: {
    meaning: { type: "string" },
    sentence: { type: "string" },
    notes: { type: "string" },
  },
  required: ["meaning", "sentence", "notes"],
  additionalProperties: false,
};

function llmPrompt({ selection, sentence, context = { before: [], after: [] }, title = "" }) {
  return [
    title ? `Show: ${title}` : null,
    context.before.length ? `Previous lines:\n${context.before.join("\n")}` : null,
    `Current line: ${sentence}`,
    context.after.length ? `Next line:\n${context.after.join("\n")}` : null,
    `Selected: ${selection}`,
  ].filter(Boolean).join("\n\n");
}

// Resolves the provider settings: { id, kind, url, model } or null when unusable.
function llmSettings({ provider = "anthropic", model = "", baseURL = "" } = {}) {
  const preset = LLM_PROVIDERS[provider] || LLM_PROVIDERS.anthropic;
  const chosenModel = String(model || "").trim() || preset.model;
  if (!chosenModel) return null;
  if (preset.kind === "anthropic") return { id: provider, kind: "anthropic", url: preset.url, model: chosenModel };
  const base = (String(baseURL || "").trim() || preset.base).replace(/\/+$/, "");
  if (!base) return null;
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  return { id: provider, kind: "openai", url, model: chosenModel };
}

// Builds the HTTP request for a provider: { url, headers: [...], body }.
function llmRequest(settings, key, question) {
  const prompt = llmPrompt(question);
  if (settings.kind === "anthropic") {
    return {
      url: settings.url,
      headers: [
        `x-api-key: ${key}`,
        "anthropic-version: 2023-06-01",
        "anthropic-beta: server-side-fallback-2026-07-01",
        "content-type: application/json",
      ],
      body: {
        model: settings.model,
        max_tokens: 16000,
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: LLM_SCHEMA } },
        system: LLM_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      },
    };
  }
  return {
    url: settings.url,
    headers: [`authorization: Bearer ${key}`, "content-type: application/json"],
    body: {
      model: settings.model,
      messages: [
        { role: "system", content: `${LLM_SYSTEM}\n${LLM_JSON_INSTRUCTION}` },
        { role: "user", content: prompt },
      ],
    },
  };
}

// The first JSON object in a model's reply (some wrap it in ``` fences or prose).
function extractJSONObject(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有按格式回答");
  return JSON.parse(source.slice(start, end + 1));
}

function apiErrorMessage(error, status) {
  const message = String(error && (error.message || error.msg || error.type) || "");
  if (status === 401 || status === 403 || /auth|api[ _-]?key|unauthori[sz]ed|invalid.*key|permission/i.test(message)) return "API 密钥无效或没有权限";
  if (status === 404 || /model.*(not|exist|found)|not.*found/i.test(message)) return `找不到这个模型或地址${message ? `：${message.slice(0, 80)}` : ""}`;
  if (status === 429 || /rate|quota|insufficient|balance|余额/i.test(message)) return `额度不足或请求太频繁${message ? `：${message.slice(0, 80)}` : ""}`;
  return message ? message.slice(0, 120) : "请求失败";
}

// Returns { meaning, sentence, notes } or throws with a short Chinese reason.
function parseLLMResponse(kind, response, status = 200) {
  // Gemini's OpenAI-compatible endpoint wraps errors in an array.
  if (Array.isArray(response)) response = response[0];
  if (!response || typeof response !== "object") throw new Error("服务没有返回内容");
  const error = response.error || (response.type === "error" ? response : null);
  if (error || status >= 400) throw new Error(apiErrorMessage(typeof error === "object" ? error : { message: error }, status));
  let text;
  if (kind === "anthropic") {
    if (response.stop_reason === "refusal") throw new Error("模型拒绝回答这句");
    text = (response.content || []).filter((block) => block.type === "text").map((block) => block.text).join("");
  } else {
    const message = response.choices && response.choices[0] && response.choices[0].message;
    text = message && (typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content) ? message.content.map((part) => part.text || "").join("") : "");
  }
  const parsed = extractJSONObject(text);
  return {
    meaning: String(parsed.meaning || "").trim(),
    sentence: String(parsed.sentence || "").trim(),
    notes: String(parsed.notes || "").trim(),
  };
}

// Google Translate (translate_a/single) response helpers.
function googleText(result) {
  return Array.isArray(result && result[0])
    ? result[0].map((segment) => segment && segment[0] || "").join("").trim()
    : "";
}

const PART_OF_SPEECH = {
  noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词", pronoun: "代词",
  preposition: "介词", conjunction: "连词", interjection: "感叹词", abbreviation: "缩写",
  phrase: "短语", prefix: "前缀", suffix: "后缀", article: "冠词",
};

// Dictionary senses from a dt=bd response: [{ pos: "名词", terms: ["霰弹枪", ...] }].
function googleSenses(result) {
  const entries = Array.isArray(result && result[1]) ? result[1] : [];
  return entries
    .filter((entry) => Array.isArray(entry) && Array.isArray(entry[1]) && entry[1].length)
    .map((entry) => ({ pos: PART_OF_SPEECH[entry[0]] || String(entry[0] || ""), terms: entry[1].slice(0, 5) }))
    .slice(0, 4);
}

function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

function subtitleHTML(text) {
  return `<div id="coach-wrap"><div id="coach-subtitle" data-clickable>${escapeHTML(text)}</div></div>`;
}

if (runtime) {
  const { console, core, event, file, http, mpv, overlay, preferences, utils } = runtime;
  const state = {
    enabled: true,
    overlayReady: false,
    overlayRequested: false,
    subtitle: "",
    translationRequestID: 0,
    nativeSubtitleStyle: null,
    nativeSubtitleSuppressed: false,
    pauseRenderGeneration: 0,
    styleWatchGeneration: 0,
    fontMetrics: {},
  };

  function readSubtitle() {
    try {
      return cleanSubtitle(mpv.getString("sub-text"));
    } catch (error) {
      console.log(`English Coach subtitle read error: ${error}`);
      return "";
    }
  }

  // Styled lines of the current subtitle (italic/bold from SRT tags), or null.
  function readSubtitleLines() {
    try {
      const ass = mpv.getString("sub-text-ass");
      return ass ? parseAssLines(ass) : null;
    } catch (error) {
      return null;
    }
  }

  function readOption(name, fallback) {
    try {
      const value = mpv.getString(`options/${name}`);
      return value === null || typeof value === "undefined" || value === "" ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function readNumberOption(name, fallback) {
    try {
      const value = mpv.getNumber(`options/${name}`);
      return Number.isFinite(value) ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function readFlagOption(name) {
    try {
      return mpv.getFlag(`options/${name}`);
    } catch (error) {
      return false;
    }
  }

  function hasOption(name) {
    try {
      const value = mpv.getString(`options/${name}`);
      return value !== null && typeof value !== "undefined" && value !== "";
    } catch (error) {
      return false;
    }
  }

  // mpv 0.39 renamed sub-border-* to sub-outline-*; IINA 1.4.2 ships mpv 0.38.
  function outlineOption(suffix) {
    const modern = `sub-outline-${suffix}`;
    return hasOption(modern) ? modern : `sub-border-${suffix}`;
  }

  // While paused, the plugin hides native subtitles by writing these mpv options.
  // Everything else is only read, so IINA's settings stay the single source of truth.
  function managedOptions() {
    // Only colors are written: sizes stay exactly as the user set them, so any
    // size change made while paused (including setting the outline to 0) is real.
    const options = {
      color: "sub-color",
      outlineColor: outlineOption("color"),
      backColor: "sub-back-color",
    };
    // IINA 1.4.2 writes the shadow color to sub-shadow-color; newer mpv folds it into sub-back-color.
    if (hasOption("sub-shadow-color")) options.shadowColor = "sub-shadow-color";
    return options;
  }

  function isHiddenValue(field, value) {
    return sameMpvColor(value, HIDDEN_COLORS[field]);
  }

  function readNativeSubtitleStyle() {
    const options = managedOptions();
    return {
      font: readOption("sub-font", DEFAULT_SUBTITLE_STYLE.font),
      fontSize: readNumberOption("sub-font-size", DEFAULT_SUBTITLE_STYLE.fontSize),
      scale: readNumberOption("sub-scale", DEFAULT_SUBTITLE_STYLE.scale),
      color: readOption(options.color, DEFAULT_SUBTITLE_STYLE.color),
      outlineColor: readOption(options.outlineColor, DEFAULT_SUBTITLE_STYLE.outlineColor),
      outlineSize: readOption(outlineOption("size"), String(DEFAULT_SUBTITLE_STYLE.outlineSize)),
      shadowColor: readOption(options.shadowColor || options.backColor, DEFAULT_SUBTITLE_STYLE.shadowColor),
      backColor: readOption(options.backColor, DEFAULT_SUBTITLE_STYLE.backColor),
      shadowOffset: readNumberOption("sub-shadow-offset", DEFAULT_SUBTITLE_STYLE.shadowOffset),
      borderStyleOption: hasOption("sub-border-style") ? readOption("sub-border-style", null) : null,
      marginX: readNumberOption("sub-margin-x", DEFAULT_SUBTITLE_STYLE.marginX),
      marginY: readNumberOption("sub-margin-y", DEFAULT_SUBTITLE_STYLE.marginY),
      position: readNumberOption("sub-pos", DEFAULT_SUBTITLE_STYLE.position),
      spacing: readNumberOption("sub-spacing", DEFAULT_SUBTITLE_STYLE.spacing),
      bold: readFlagOption("sub-bold"),
      italic: readFlagOption("sub-italic"),
      alignX: readOption("sub-align-x", DEFAULT_SUBTITLE_STYLE.alignX),
      alignY: readOption("sub-align-y", DEFAULT_SUBTITLE_STYLE.alignY),
      justify: readOption("sub-justify", DEFAULT_SUBTITLE_STYLE.justify),
    };
  }

  // mpv 0.38 has no sub-border-style: a non-transparent sub-back-color turns on
  // the background box. Decided from the real (not the hidden) back color.
  function withBorderStyle(style) {
    style.borderStyle = style.borderStyleOption
      || (isTransparentColor(style.backColor) ? "outline-and-shadow" : "background-box");
    return style;
  }

  function writeManagedOptions(values) {
    const options = managedOptions();
    for (const field of Object.keys(options)) {
      if (typeof values[field] !== "undefined") mpv.set(options[field], values[field]);
    }
  }

  // Reads IINA's current subtitle style. While the native subtitle is hidden, the
  // managed options hold the plugin's transparent values; any other value there
  // means the user just changed that setting, so adopt it and hide it again.
  function syncNativeSubtitleStyle() {
    const live = readNativeSubtitleStyle();
    if (!state.nativeSubtitleSuppressed || !state.nativeSubtitleStyle) {
      state.nativeSubtitleStyle = withBorderStyle(live);
      return false;
    }
    let userChangedManaged = false;
    for (const field of Object.keys(managedOptions())) {
      if (isHiddenValue(field, live[field])) live[field] = state.nativeSubtitleStyle[field];
      else if (live[field] !== state.nativeSubtitleStyle[field]) userChangedManaged = true;
    }
    state.nativeSubtitleStyle = withBorderStyle(live);
    return userChangedManaged;
  }

  // IINA's sidebar changes colors, fonts and flags without any event or window
  // change. While (and only while) the native subtitle is hidden, compare the
  // style once a second and follow any change. Nothing runs during playback.
  function styleSnapshot() {
    try {
      return JSON.stringify(readNativeSubtitleStyle());
    } catch (error) {
      return "";
    }
  }

  function watchStyleWhilePaused() {
    const generation = ++state.styleWatchGeneration;
    let previous = styleSnapshot();
    const tick = () => {
      if (generation !== state.styleWatchGeneration || !state.nativeSubtitleSuppressed || !core.status.paused) return;
      const current = styleSnapshot();
      if (current !== previous) {
        previous = current;
        refreshPausedStyle();
        previous = styleSnapshot();
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  function restoreNativeSubtitle() {
    if (!state.nativeSubtitleSuppressed) return;
    try {
      if (state.nativeSubtitleStyle) writeManagedOptions(state.nativeSubtitleStyle);
    } catch (error) {
      console.log(`English Coach subtitle restore error: ${error}`);
    }
    state.nativeSubtitleStyle = null;
    state.nativeSubtitleSuppressed = false;
    state.styleWatchGeneration += 1;
  }

  function hideNativeSubtitle() {
    try {
      writeManagedOptions(HIDDEN_COLORS);
      state.nativeSubtitleSuppressed = true;
      watchStyleWhilePaused();
    } catch (error) {
      console.log(`English Coach subtitle visibility error: ${error}`);
    }
  }

  function clearOverlay() {
    if (!state.overlayReady) return;
    state.translationRequestID += 1;
    overlay.postMessage("clear", {});
    overlay.setClickable(false);
    restoreNativeSubtitle();
  }

  // Where mpv draws the video inside the window, plus the options that decide
  // whether subtitles are laid out against the window or the video.
  function readFrame() {
    const frame = {};
    for (const key of ["w", "h", "mt", "mb", "ml", "mr"]) {
      try {
        frame[key] = mpv.getNumber(`osd-dimensions/${key}`);
      } catch (error) {
        frame[key] = 0;
      }
    }
    if (!(frame.w > 0 && frame.h > 0)) return {};
    const flag = (name, fallback) => (hasOption(name) ? readFlagOption(name) : fallback);
    frame.useMargins = flag("sub-use-margins", true);
    frame.scaleWithWindow = flag("sub-scale-with-window", true);
    frame.scaleByWindow = flag("sub-scale-by-window", true);
    return frame;
  }

  // libass sizes glyphs from font metrics a web page cannot read, so ask
  // CoreText once per font and re-style when the answer arrives.
  function fontMetricsFor(style) {
    const font = String(style && style.font || "sans-serif");
    const cached = state.fontMetrics[font];
    if (cached === undefined) {
      state.fontMetrics[font] = null;
      const name = font.toLowerCase() === "sans-serif" ? "Helvetica" : font;
      Promise.resolve()
        .then(() => utils.exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", FONT_METRICS_JXA, name]))
        .then(({ status, stdout }) => {
          if (status !== 0) throw new Error(`osascript exited with ${status}`);
          const parsed = JSON.parse(String(stdout).trim());
          if (!Array.isArray(parsed.regular) || !Array.isArray(parsed.bold)) throw new Error("unexpected output");
          state.fontMetrics[font] = parsed;
          refreshPausedStyle();
        })
        .catch((error) => console.log(`English Coach font metrics error for ${font}: ${error}`));
      return null;
    }
    if (!cached) return null;
    return {
      metrics: style.bold ? cached.bold : cached.regular,
      italicShear: Number(cached.italicShear) || 0,
      italic: Boolean(style.italic),
    };
  }

  function postStyle(message, extra = {}) {
    overlay.postMessage(message, {
      ...extra,
      style: buildOverlayStyle(state.nativeSubtitleStyle, readFrame()),
      fontInfo: fontMetricsFor(state.nativeSubtitleStyle),
    });
  }

  function renderPausedSubtitle() {
    if (!state.overlayReady || !state.enabled || !core.status.paused) {
      clearOverlay();
      return;
    }
    const nextSubtitle = readSubtitle();
    if (nextSubtitle !== state.subtitle) state.translationRequestID += 1;
    state.subtitle = nextSubtitle;
    if (!state.subtitle) {
      clearOverlay();
      return;
    }
    if (!state.nativeSubtitleSuppressed) {
      syncNativeSubtitleStyle();
      hideNativeSubtitle();
    }
    postStyle("render-subtitle", { text: state.subtitle, lines: readSubtitleLines() });
    overlay.setClickable(true);
  }

  // Follows subtitle setting changes made while paused without resetting the
  // current selection: only the stylesheet is replaced.
  function refreshPausedStyle() {
    if (!state.overlayReady || !state.nativeSubtitleStyle || !core.status.paused) return;
    if (syncNativeSubtitleStyle()) hideNativeSubtitle();
    postStyle("render-style");
  }

  function schedulePausedSubtitleRender(generation, attempt = 0) {
    // mpv can emit pause.changed before its subtitle-text property catches up.
    // Retry only twice after pausing; normal updates remain event-driven.
    setTimeout(() => {
      if (generation !== state.pauseRenderGeneration || !core.status.paused) return;
      renderPausedSubtitle();
      if (!state.subtitle && attempt < 1) {
        schedulePausedSubtitleRender(generation, attempt + 1);
      }
    }, attempt === 0 ? 60 : 140);
  }

  function schedulePauseStateRefresh(generation) {
    // pause.changed can arrive before core.status.paused reflects the new state.
    setTimeout(() => {
      if (generation !== state.pauseRenderGeneration) return;
      if (!core.status.paused) {
        state.subtitle = "";
        renderPausedSubtitle();
        return;
      }
      renderPausedSubtitle();
      if (!state.subtitle) schedulePausedSubtitleRender(generation);
    }, 60);
  }

  function onOverlayLoaded() {
    // IINA 1.4 silently ignores overlay.onMessage() and overlay.show() until the
    // page has loaded, and loadFile() clears every listener registered before it.
    // Wire the overlay up only after IINA reports that the page is ready.
    overlay.onMessage("translate-selection", (data) => translateSelection(data));
    overlay.onMessage("overlay-error", (data) => {
      console.log(`English Coach overlay error: ${JSON.stringify(data)}`);
    });
    overlay.show();
    overlay.setClickable(false);
    if (state.overlayReady) return;
    state.overlayReady = true;
    renderPausedSubtitle();
    if (core.status.paused && !state.subtitle) {
      schedulePausedSubtitleRender(++state.pauseRenderGeneration);
    }
  }

  // Loads the overlay page into the player window. Called when the plugin
  // starts in a loaded window, and again whenever a window or file is (re)loaded
  // after the overlay was torn down, e.g. when IINA reuses a closed player.
  function setupOverlay() {
    if (state.overlayRequested) return;
    state.overlayRequested = true;
    overlay.setClickable(false);
    overlay.loadFile("ui/overlay.html");
  }

  const srtCache = { path: null, cues: [] };

  function currentContext(sentence) {
    try {
      const path = mpv.getString("current-tracks/sub/external-filename");
      if (!path) return { before: [], after: [] };
      if (srtCache.path !== path) {
        srtCache.path = path;
        srtCache.cues = /\.srt$/i.test(path) ? parseSrt(file.read(path)) : [];
      }
      return subtitleContext(srtCache.cues, sentence);
    } catch (error) {
      return { before: [], after: [] };
    }
  }

  // The large-model settings from the plugin's preferences page. Older
  // versions stored a Claude key as claude_api_key; it still works.
  function llmConfig() {
    try {
      const get = (name) => preferences.get(name);
      if (get("llm_enabled") === false || get("claude_enabled") === false) return null;
      const provider = String(get("llm_provider") || "anthropic");
      const key = String(get("llm_api_key") || (provider === "anthropic" ? get("claude_api_key") : "") || "").trim();
      if (!key) {
        // A provider was picked but no key reached the plugin: say so precisely.
        const chosen = get("llm_provider");
        return chosen && LLM_PROVIDERS[chosen] ? { missingKey: LLM_PROVIDERS[chosen].name } : null;
      }
      const settings = llmSettings({ provider, model: get("llm_model"), baseURL: get("llm_base_url") });
      return settings ? { ...settings, key } : { error: "请在设置里填写模型名称或服务地址" };
    } catch (error) {
      return null;
    }
  }

  // Calls the model with curl. The key and request go through files in the
  // plugin's temporary folder, so the key never appears in a process's command
  // line; both files are deleted right after the call.
  async function askModel(config, question) {
    const request = llmRequest(config, config.key, question);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const headersPath = `@tmp/llm-${id}.headers`;
    const bodyPath = `@tmp/llm-${id}.json`;
    file.write(headersPath, request.headers.join("\n"));
    file.write(bodyPath, JSON.stringify(request.body));
    try {
      const { status, stdout } = await utils.exec("/usr/bin/curl", [
        "-sS", "--max-time", "60",
        "-w", "\n%{http_code}",
        "-H", `@${utils.resolvePath(headersPath)}`,
        "--data-binary", `@${utils.resolvePath(bodyPath)}`,
        request.url,
      ]);
      if (status !== 0) throw new Error("网络请求失败");
      const output = String(stdout);
      const split = output.lastIndexOf("\n");
      const httpStatus = Number(output.slice(split + 1)) || 0;
      let json = null;
      try { json = JSON.parse(output.slice(0, split)); } catch (error) { /* not JSON */ }
      if (!json) throw new Error(httpStatus >= 400 ? apiErrorMessage(null, httpStatus) : "服务返回了无法识别的内容");
      return parseLLMResponse(config.kind, json, httpStatus);
    } finally {
      try { file.delete(headersPath); } catch (error) { /* already gone */ }
      try { file.delete(bodyPath); } catch (error) { /* already gone */ }
    }
  }

  // Google's free endpoints throttle bursts (HTTP 429), so requests go one at
  // a time, are cached, retried once, and fall back to a second endpoint.
  const translationCache = new Map();
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function getJSON(url, params) {
    const response = await http.get(url, { params });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Object.assign(new Error(`HTTP ${response.statusCode}`), { statusCode: response.statusCode });
    }
    return JSON.parse(response.text);
  }

  async function googleRequest(text, dt) {
    const key = `${dt}:${text}`;
    if (translationCache.has(key)) return translationCache.get(key);
    const primary = () => getJSON("https://translate.googleapis.com/translate_a/single", {
      client: "gtx", sl: "en", tl: "zh-CN", dt, q: text,
    });
    let result;
    try {
      result = await primary();
    } catch (error) {
      if (dt !== "t") {
        await pause(600);
        result = await primary();
      } else {
        // The browser-extension endpoint returns just ["译文"] and is throttled separately.
        const fallback = await getJSON("https://clients5.google.com/translate_a/t", {
          client: "dict-chrome-ex", sl: "en", tl: "zh-CN", q: text,
        }).catch(async () => {
          await pause(600);
          return primary();
        });
        result = Array.isArray(fallback) && typeof fallback[0] === "string" ? [[[fallback[0], text]]] : fallback;
      }
    }
    translationCache.set(key, result);
    if (translationCache.size > 300) translationCache.delete(translationCache.keys().next().value);
    return result;
  }

  async function translateSelection(data) {
    const text = String(data && data.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text || !state.overlayReady || !core.status.paused) return;

    const requestID = ++state.translationRequestID;
    const point = data && data.point || null;
    const sentence = String(state.subtitle || "").replace(/\s+/g, " ").trim();
    const card = { requestID, point, selection: text, quick: null, sentence: null, status: "loading" };
    const stillCurrent = () => requestID === state.translationRequestID && core.status.paused;
    overlay.postMessage("lookup", { ...card });

    const wordCount = text.split(" ").length;
    const publish = () => { if (stillCurrent()) overlay.postMessage("lookup", { ...card }); };
    const errors = [];
    const googleLookups = (async () => {
      try {
        card.quick = googleText(await googleRequest(text, "t")) || null;
        publish();
      } catch (error) { errors.push(error); }
      if (sentence && sentence.toLowerCase() !== text.toLowerCase()) {
        try {
          card.sentence = card.sentence || googleText(await googleRequest(sentence, "t")) || null;
          publish();
        } catch (error) { errors.push(error); }
      }
      if (wordCount <= 3) {
        try {
          card.senses = googleSenses(await googleRequest(text, "bd"));
          publish();
        } catch (error) { errors.push(error); }
      }
    })();
    const lookups = [googleLookups];
    const model = llmConfig();
    const key = Boolean(model);
    if (model && model.missingKey) {
      card.llmNotice = `已选择 ${model.missingKey}，但插件没有读到 API 密钥。请在设置里重新粘贴，看到“已保存”后再试`;
    } else if (model && model.error) {
      card.llmError = model.error;
    } else if (model) {
      card.explaining = true;
      lookups.push(askModel(model, ({
        selection: text,
        sentence: sentence || text,
        context: currentContext(sentence),
        title: (() => { try { return mpv.getString("media-title") || ""; } catch (error) { return ""; } })(),
      })).then((answer) => {
        card.meaning = answer.meaning || null;
        card.notes = answer.notes || null;
        if (answer.sentence) card.sentence = answer.sentence;
        card.explaining = false;
        if (stillCurrent()) overlay.postMessage("lookup", { ...card });
      }, (error) => {
        card.explaining = false;
        card.llmError = String(error && error.message || error);
        throw error;
      }));
    }
    const results = await Promise.allSettled(lookups);
    if (!stillCurrent()) return;
    results.filter((result) => result.status === "rejected").forEach((result) => errors.push(result.reason));
    errors.forEach((error) => console.log(`English Coach lookup error: ${error && error.message || error}`));
    const throttled = errors.some((error) => error && error.statusCode === 429);
    card.status = card.quick || card.meaning ? "done" : "error";
    card.hint = card.llmNotice
      ? card.llmNotice
      : card.llmError
      ? `语境解释失败：${card.llmError}`
      : card.quick || card.meaning
        ? (key ? null : "在 IINA 设置 → 插件 → English Coach 选择大模型并填入 API 密钥，可获得语境和文化背景解释")
        : throttled ? "Google 翻译暂时限流了，过一会儿再试" : "暂时无法翻译，请检查网络";
    overlay.postMessage("lookup", { ...card });
  }

  console.log("English Coach 0.3.21 starting");

  event.on("mpv.pause.changed", () => {
    const generation = ++state.pauseRenderGeneration;
    // Prevent mouse hit-testing from leaking into playback during the brief
    // state transition; the settled state is handled on the next tick.
    overlay.setClickable(false);
    state.subtitle = "";
    clearOverlay();
    schedulePauseStateRefresh(generation);
  });
  // IINA observes mpv properties as numbers, so string properties such as
  // sub-text never fire change events. sub-start/sub-end change with every line.
  const renderIfPaused = () => {
    if (core.status.paused) renderPausedSubtitle();
  };
  event.on("mpv.sub-start.changed", renderIfPaused);
  event.on("mpv.sub-end.changed", renderIfPaused);
  event.on("mpv.sid.changed", () => {
    if (core.status.paused) renderPausedSubtitle();
  });
  // Numeric subtitle settings fire change events immediately. Colors, fonts and
  // flags cannot be observed by IINA, so they are re-read when the player window
  // becomes main again (for example after closing IINA's settings window).
  [
    "sub-font-size", "sub-scale", "sub-border-size", "sub-outline-size", "sub-shadow-offset",
    "sub-spacing", "sub-margin-x", "sub-margin-y", "sub-pos",
  ].forEach((name) => event.on(`mpv.${name}.changed`, refreshPausedStyle));
  event.on("iina.window-main.changed", refreshPausedStyle);
  // Black bars change with the window shape, which moves libass's margins.
  event.on("iina.window-resized", refreshPausedStyle);
  event.on("iina.window-fs.changed", refreshPausedStyle);
  event.on("iina.plugin-overlay-loaded", onOverlayLoaded);
  event.on("iina.file-loaded", () => {
    state.subtitle = "";
    if (!state.overlayRequested && core.window && core.window.loaded) setupOverlay();
    renderPausedSubtitle();
  });
  // Closing a video keeps the player (IINA reuses it for the next file), so the
  // overlay is reset rather than hidden: IINA 1.4.2 overlays may stay invisible
  // after hide() and show(). The next file or window load sets it up again.
  event.on("iina.window-will-close", () => {
    restoreNativeSubtitle();
    if (state.overlayReady) {
      overlay.postMessage("clear", {});
      overlay.setClickable(false);
    }
    state.overlayReady = false;
    state.overlayRequested = false;
    state.subtitle = "";
  });
  event.on("iina.window-loaded", setupOverlay);

  // Restored playback windows can already be loaded before the plugin entry runs,
  // in which case iina.window-loaded has already fired and would never be observed.
  if (core.window && core.window.loaded) setupOverlay();
}

if (typeof module !== "undefined") {
  module.exports = { LLM_PROVIDERS, llmSettings, llmRequest, parseLLMResponse, extractJSONObject, parseSrt, subtitleContext, googleText, googleSenses, parseAssLines, FONT_METRICS_JXA, buildOverlayStyle, parseMpvColor, sameMpvColor, cleanSubtitle, cssColor, escapeHTML, subtitleHTML };
}
