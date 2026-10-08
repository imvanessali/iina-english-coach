const test = require("node:test");
const assert = require("node:assert/strict");

const { llmSettings, llmRequest, parseLLMResponse, parseSrt, subtitleContext, googleSenses, parseAssLines, buildOverlayStyle, cleanSubtitle, cssColor, escapeHTML, subtitleHTML } = require("../src/index.js");

test("cleans common subtitle formatting", () => {
  assert.equal(cleanSubtitle("{\\an8}<i>Hello</i>\\Nworld"), "Hello\nworld");
});

test("renders safe selectable subtitle markup", () => {
  const html = subtitleHTML("Don't <stop>\nnow");
  assert.ok(html.includes("data-clickable"));
  assert.ok(html.includes("Don&#39;t"));
  assert.ok(html.includes("&lt;stop&gt;<br>now"));
  assert.equal(html.includes("coach-hint"), false);
  assert.equal(escapeHTML('a&"b'), "a&amp;&quot;b");
});

test("converts mpv colors and builds native-matched CSS", () => {
  assert.equal(cssColor("#8044AAFF", "fallback"), "#44AAFF80");
  assert.equal(cssColor("1/0.5/0/0.75", "fallback"), "rgba(255, 128, 0, 0.75)");
  const css = buildOverlayStyle({ font: "Avenir Next", fontSize: 50, scale: 1.2, position: 95 });
  assert.ok(css.includes("white-space: pre-line"), "keeps the subtitle's own line breaks");
  assert.ok(css.includes('font-family: "Avenir Next"'));
  assert.ok(css.includes("--ass-size: 8.3333vh"), "50 scaled pixels at sub-scale 1.2");
  assert.ok(css.includes("line-height: var(--ass-size)"), "one line is exactly libass's font size tall");
  // margin 22 -> trunc(8.8) = 8 of 288 script pixels; sub-pos 95 adds 5% of the rest.
  assert.ok(css.includes("bottom: 7.6389vh"), "sub-pos 95 lifts the subtitle by 5% of the space above the margin");
  assert.ok(buildOverlayStyle({ alignY: "top", marginY: 34 }).includes("top: 4.5139vh"), "mpv truncates the 34px margin to 13 ASS pixels");
  const boxed = buildOverlayStyle({ borderStyle: "opaque-box", outlineColor: "#FF112233" });
  assert.ok(boxed.includes("background: #112233FF"));
  assert.ok(boxed.includes("-webkit-text-stroke: 0 transparent"));
});

test("follows libass when the video has black bars", () => {
  // Fullscreen 2:1 video on a 16:10 screen: 1470x919 window, 735 px tall video.
  const letterbox = { w: 1470, h: 919, mt: 92, mb: 92, ml: 0, mr: 0 };
  const css = buildOverlayStyle({ fontSize: 55, marginY: 22 }, letterbox);
  assert.ok(css.includes("--ass-size: 7.6389vh"), "the font still scales with the window height");
  // The margin is measured against the video height: 8/288 of 735/919.
  assert.ok(css.includes("bottom: 2.2216vh"), "the bottom margin scales with the video height");
  const inVideo = buildOverlayStyle({ marginY: 22 }, { ...letterbox, useMargins: false });
  assert.ok(inVideo.includes("bottom: 12.2325vh"), "without sub-use-margins the subtitle sits on the video's bottom edge");
});

test("parses SRT italics/bold as reported by mpv's sub-text-ass", () => {
  assert.deepEqual(parseAssLines("{\\i1}I call shotgun!{\\i0} Okay\\Nthen go."), [
    [{ t: "I call shotgun!", i: true, b: null }, { t: " Okay", i: false, b: null }],
    [{ t: "then go.", i: false, b: null }],
  ]);
  assert.deepEqual(parseAssLines("{\\an8}Plain"), [[{ t: "Plain", i: null, b: null }]]);
});

test("reads dictionary senses from Google Translate", () => {
  assert.deepEqual(googleSenses([null, [["verb", ["射击"]], ["noun", ["霰弹枪", "滑膛枪"]]]]), [
    { pos: "动词", terms: ["射击"] },
    { pos: "名词", terms: ["霰弹枪", "滑膛枪"] },
  ]);
  assert.deepEqual(googleSenses([[["x"]]]), []);
});

test("finds the subtitle lines around the current one in an SRT file", () => {
  const cues = parseSrt("1\r\n00:00:01,000 --> 00:00:02,000\r\nWho's driving?\r\n\r\n2\n00:00:02,500 --> 00:00:03,000\n<i>Okay, I call</i>\nshotgun!\n\n3\n00:00:04,000 --> 00:00:05,000\nFine.\n");
  assert.deepEqual(cues.map((cue) => cue.text), ["Who's driving?", "Okay, I call shotgun!", "Fine."]);
  assert.deepEqual(subtitleContext(cues, "Okay, I call\nshotgun!"), { before: ["Who's driving?"], after: ["Fine."] });
  assert.deepEqual(subtitleContext(cues, "not there"), { before: [], after: [] });
});

const QUESTION = {
  selection: "shotgun",
  sentence: "Okay, I call shotgun!",
  context: { before: ["Who's driving?"], after: ["Fine."] },
  title: "Example Show S01E01",
};

test("builds a Claude request with the line, its context and a JSON schema", () => {
  const settings = llmSettings({ provider: "anthropic" });
  const { url, headers, body } = llmRequest(settings, "fake-key", QUESTION);
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.ok(headers.includes("x-api-key: fake-key"));
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.output_config.format.type, "json_schema");
  for (const part of ["Example Show S01E01", "Who's driving?", "Current line: Okay, I call shotgun!", "Fine.", "Selected: shotgun"]) {
    assert.ok(body.messages[0].content.includes(part), part);
  }
});

test("builds OpenAI-compatible requests for other providers", () => {
  const deepseek = llmSettings({ provider: "deepseek" });
  assert.deepEqual([deepseek.url, deepseek.model], ["https://api.deepseek.com/v1/chat/completions", "deepseek-chat"]);
  const { headers, body } = llmRequest(deepseek, "fake-key", QUESTION);
  assert.ok(headers.includes("authorization: Bearer fake-key"));
  assert.equal(body.messages[0].role, "system");
  assert.ok(body.messages[0].content.includes('"meaning"'), "asks for JSON in the prompt");
  assert.equal(llmSettings({ provider: "openai", model: "gpt-5" }).model, "gpt-5", "the model field overrides the default");
  assert.equal(llmSettings({ provider: "custom", model: "m", baseURL: "https://proxy.example/v1/" }).url, "https://proxy.example/v1/chat/completions");
  assert.equal(llmSettings({ provider: "custom", model: "m" }), null, "custom needs an address");
  assert.equal(llmSettings({ provider: "doubao" }), null, "doubao needs a model / endpoint id");
});

test("reads answers from both formats and reports failures briefly", () => {
  const answer = { meaning: "抢副驾驶座", sentence: "好，副驾驶归我了！", notes: "美国习俗" };
  assert.deepEqual(parseLLMResponse("anthropic", { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }] }), answer);
  assert.deepEqual(parseLLMResponse("openai", { choices: [{ message: { content: "```json\n" + JSON.stringify(answer) + "\n```" } }] }), answer, "tolerates code fences");
  assert.throws(() => parseLLMResponse("anthropic", { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401), /密钥/);
  assert.throws(() => parseLLMResponse("openai", { error: { message: "Incorrect API key provided" } }, 401), /密钥/);
  assert.throws(() => parseLLMResponse("openai", { error: { message: "The model `x` does not exist" } }, 404), /模型/);
  assert.throws(() => parseLLMResponse("anthropic", { stop_reason: "refusal", content: [] }), /拒绝/);
  assert.throws(() => parseLLMResponse("openai", [{ error: { code: 400, message: "Please pass a valid API key" } }], 400), /密钥/, "Gemini wraps errors in an array");
});
