const test = require("node:test");
const assert = require("node:assert/strict");

// A small IINA 1.4.2 stand-in. mpv options live in one map: mpv.set() writes
// into it and reads see the written value, like the real player.
function loadPlugin(initialOptions, { subtitle = "" } = {}) {
  const eventHandlers = {};
  const overlayHandlers = {};
  const timers = [];
  const mpvSetCalls = [];
  const messages = [];
  const options = { ...initialOptions };
  const harness = { paused: false, subtitle, options, mpvSetCalls, messages, eventHandlers, overlayHandlers, prefs: {}, files: {} };

  const overlay = {
    // loadFile() clears listeners; onMessage()/show()/postMessage() are ignored
    // until the page has loaded.
    file: "",
    style: "",
    content: "",
    clickable: false,
    visible: false,
    loaded: false,
    onMessage(name, callback) { if (this.loaded) overlayHandlers[name] = callback; },
    postMessage(name, data) {
      if (!this.loaded) return;
      messages.push({ name, data });
      if (name === "render-subtitle") {
        this.content = data.text;
        this.style = data.style;
      }
      if (name === "render-style") this.style = data.style;
      if (name === "clear") this.content = "";
    },
    loadFile(path) {
      this.file = path;
      for (const name of Object.keys(overlayHandlers)) delete overlayHandlers[name];
    },
    setClickable(value) { this.clickable = value; },
    show() { if (this.loaded) this.visible = true; },
    hide() { if (this.loaded) this.visible = false; },
  };
  harness.overlay = overlay;

  global.iina = {
    console: { log() {} },
    core: { window: { loaded: true }, status: { get paused() { return harness.paused; } }, osd() {} },
    event: { on(name, callback) { eventHandlers[name] = callback; } },
    http: {
      async get(url, options) {
        const { dt, q } = options.params;
        if (dt === "bd") return { statusCode: 200, text: JSON.stringify([null, [["noun", ["霰弹枪", "滑膛枪"]]]]) };
        return { statusCode: 200, text: JSON.stringify([[[`译:${q}`, q]]]) };
      },
    },
    utils: {
      resolvePath(path) { return path.replace("@tmp/", "/tmp/plugin/"); },
      async exec(file, args) {
        if (file === "/usr/bin/curl") {
          harness.curlCalls = (harness.curlCalls || []).concat([{
            args,
            headers: harness.files[args[args.indexOf("-H") + 1].slice(1).replace("/tmp/plugin/", "@tmp/")],
            body: JSON.parse(harness.files[args[args.indexOf("--data-binary") + 1].slice(1).replace("/tmp/plugin/", "@tmp/")]),
          }]);
          const answer = JSON.stringify({ meaning: "抢副驾驶座", sentence: "好，副驾驶归我了！", notes: "美国朋友间的习惯说法" });
          const url = args[args.length - 1];
          const response = url.includes("anthropic.com")
            ? { stop_reason: "end_turn", content: [{ type: "text", text: answer }] }
            : { choices: [{ message: { content: answer } }] };
          return { status: 0, stdout: `${JSON.stringify(response)}\n200`, stderr: "" };
        }
        harness.execCalls = (harness.execCalls || []).concat([[file, args[args.length - 1]]]);
        return { status: 0, stdout: '{"regular":[0.6313,0.8131],"bold":[0.6079,0.8152]}', stderr: "" };
      },
    },
    preferences: { get(key) { return harness.prefs[key]; } },
    file: {
      write(path, content) { harness.files[path] = content; },
      read(path) { return harness.files[path]; },
      delete(path) { delete harness.files[path]; },
    },
    mpv: {
      getString(name) {
        if (name === "sub-text") return harness.subtitle;
        const value = options[name.replace(/^options\//, "")];
        return typeof value === "undefined" ? undefined : String(value);
      },
      getNumber(name) {
        const value = Number(options[name.replace(/^options\//, "")]);
        return Number.isFinite(value) ? value : 0;
      },
      getFlag(name) { return options[name.replace(/^options\//, "")] === "yes"; },
      set(name, value) {
        mpvSetCalls.push({ name, value });
        options[name] = value;
      },
    },
    overlay,
  };

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => { timers.push(callback); return String(timers.length); };
  const modulePath = require.resolve("../src/index.js");
  delete require.cache[modulePath];
  require(modulePath);

  // Runs pending timers, including ones they schedule, up to a bound: the
  // paused-only style watcher reschedules itself every second.
  harness.runTimers = (limit = 20) => {
    for (let i = 0; i < limit && timers.length; i += 1) timers.shift()();
  };
  harness.pageLoaded = () => {
    overlay.loaded = true;
    eventHandlers["iina.plugin-overlay-loaded"]();
  };
  harness.pause = () => {
    harness.paused = true;
    eventHandlers["mpv.pause.changed"]();
    harness.runTimers();
  };
  harness.play = () => {
    harness.paused = false;
    eventHandlers["mpv.pause.changed"]();
    harness.runTimers();
  };
  harness.cleanup = () => {
    global.setTimeout = originalSetTimeout;
    delete global.iina;
  };
  return harness;
}

const MODERN_OPTIONS = {
  "sub-font": "Helvetica Neue",
  "sub-font-size": "48",
  "sub-scale": "1.1",
  "sub-color": "#FFFFFFFF",
  "sub-outline-color": "#FF101010",
  "sub-outline-size": "2",
  "sub-back-color": "#A0000000",
  "sub-shadow-offset": "1",
  "sub-margin-x": "20",
  "sub-margin-y": "36",
  "sub-pos": "95",
  "sub-spacing": "0.5",
  "sub-bold": "yes",
  "sub-italic": "no",
  "sub-align-x": "center",
  "sub-justify": "left",
};

// IINA 1.4.2 ships mpv 0.38: sub-border-* names and a separate sub-shadow-color.
const IINA_142_OPTIONS = {
  "sub-font": "sans-serif",
  "sub-font-size": "38",
  "sub-scale": "1",
  "sub-color": "#FFFFFFFF",
  "sub-border-color": "#FF000000",
  "sub-border-size": "3",
  "sub-shadow-color": "#80000000",
  "sub-back-color": "#00000000",
  "sub-shadow-offset": "0",
  "sub-margin-y": "34",
  "sub-pos": "100",
};

test("is event-driven, selectable only while paused, and mirrors native subtitle styling", () => {
  const h = loadPlugin(MODERN_OPTIONS);
  try {
    assert.equal(h.overlay.file, "ui/overlay.html");
    assert.equal(h.overlay.file, "ui/overlay.html", "initializes immediately when the window is already loaded");
    assert.equal(typeof h.eventHandlers["iina.window-loaded"], "function", "and again for windows loaded later");
    assert.equal(h.overlay.visible, false, "show() before the page loads would be ignored by IINA");
    h.pageLoaded();
    assert.equal(typeof h.overlayHandlers["translate-selection"], "function", "listens for selections after the page loads");
    assert.equal(h.overlay.visible, true);
    assert.equal(h.overlay.clickable, false);

    // mpv may report the pause before sub-text catches up; the plugin retries briefly.
    h.paused = true;
    h.eventHandlers["mpv.pause.changed"]();
    assert.equal(h.overlay.clickable, false, "disables hit-testing during the pause transition");
    h.subtitle = "Yeah. I need some marquee dates for new acts,";
    h.runTimers();
    assert.equal(h.overlay.clickable, true);
    assert.equal(h.overlay.content, "Yeah. I need some marquee dates for new acts,");
    assert.ok(h.overlay.style.includes('font-family: "Helvetica Neue"'));
    assert.ok(h.overlay.style.includes("font-weight: 700"));
    assert.ok(h.overlay.style.includes("text-align: left"));
    assert.equal(h.options["sub-color"], "#00010203", "native text is transparent while paused");
    assert.equal(h.options["sub-outline-color"], "#00010204", "native outline is transparent while paused");
    assert.equal(h.options["sub-outline-size"], "2", "outline width is never written");

    assert.equal(typeof h.eventHandlers["mpv.sub-text.changed"], "undefined", "IINA cannot observe string properties");
    h.subtitle = "It looks like junk\nfrom a mall kiosk.";
    h.eventHandlers["mpv.sub-start.changed"]();
    assert.equal(h.overlay.content, "It looks like junk\nfrom a mall kiosk.", "seeking to another line while paused re-renders");

    h.play();
    assert.equal(h.overlay.content, "", "playing clears all custom UI");
    assert.equal(h.overlay.clickable, false, "playing stops hit-testing");
    assert.equal(h.options["sub-color"], "#FFFFFFFF");
    assert.equal(h.options["sub-outline-size"], "2");
    assert.equal(h.options["sub-outline-color"], "#FF101010");
    assert.equal(h.options["sub-back-color"], "#A0000000");
    assert.equal(h.mpvSetCalls.some((call) => call.name === "sub-font" || call.name === "sub-font-size"), false, "font settings are never written");
  } finally {
    h.cleanup();
  }
});

test("hides and restores the native subtitle with mpv 0.38 option names", () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Hello there" });
  try {
    h.pageLoaded();
    h.pause();
    assert.equal(h.options["sub-border-color"], "#00010204");
    assert.equal(h.options["sub-border-size"], "3", "outline width is never written");
    assert.equal(h.options["sub-shadow-color"], "#00010205", "IINA's shadow color option is hidden too");
    assert.ok(h.overlay.style.includes("-webkit-text-stroke: 0.8333vh #000000FF"), "the CSS stroke is twice libass's outline width");
    h.play();
    assert.equal(h.options["sub-border-color"], "#FF000000");
    assert.equal(h.options["sub-shadow-color"], "#80000000");
  } finally {
    h.cleanup();
  }
});

test("adopts subtitle settings changed while paused and keeps them after resuming", () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Hello there" });
  try {
    h.pageLoaded();
    h.pause();
    // The user picks yellow text in IINA's settings; IINA writes it to mpv, which
    // makes the native subtitle visible again until the plugin re-syncs.
    h.options["sub-color"] = "#FFFFFF00";
    h.options["sub-italic"] = "yes";
    h.eventHandlers["iina.window-main.changed"]();
    assert.equal(h.options["sub-color"], "#00010203", "the native subtitle is hidden again");
    assert.ok(h.overlay.style.includes("color: #FFFF00FF"), "the overlay uses the new color");
    assert.ok(h.overlay.style.includes("font-style: italic"));
    h.play();
    assert.equal(h.options["sub-color"], "#FFFFFF00", "resuming keeps the user's new color");
  } finally {
    h.cleanup();
  }
});

test("follows numeric subtitle settings live while paused without resetting the selection", () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Hello there" });
  try {
    h.pageLoaded();
    h.pause();
    const renders = h.messages.filter((message) => message.name === "render-subtitle").length;
    h.options["sub-font-size"] = "55";
    h.eventHandlers["mpv.sub-font-size.changed"]();
    assert.ok(h.overlay.style.includes("--ass-size: 7.6389vh"), "55 scaled pixels of a 720-line window");
    assert.equal(h.messages.filter((message) => message.name === "render-subtitle").length, renders, "only the stylesheet changes");
    h.options["sub-border-size"] = "5";
    h.eventHandlers["mpv.sub-border-size.changed"]();
    assert.ok(h.overlay.style.includes("-webkit-text-stroke: 1.3889vh"), "the overlay outline follows the new width");
    h.play();
    assert.equal(h.options["sub-border-size"], "5");
  } finally {
    h.cleanup();
  }
});

test("an outline set to 0 while paused stays 0 after resuming", () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Hello there" });
  try {
    h.pageLoaded();
    h.pause();
    // IINA's sidebar writes the new width straight to mpv.
    h.options["sub-border-size"] = "0";
    h.eventHandlers["mpv.sub-border-size.changed"]();
    assert.ok(h.overlay.style.includes("-webkit-text-stroke: 0 transparent"), "the overlay drops its outline");
    h.play();
    assert.equal(h.options["sub-border-size"], "0", "the plugin never writes the old width back");
    assert.equal(h.options["sub-border-color"], "#FF000000");
  } finally {
    h.cleanup();
  }
});

test("follows a color picked in IINA's sidebar while paused, even a transparent one", () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Hello there" });
  try {
    h.pageLoaded();
    h.pause();
    h.options["sub-border-color"] = "#00000000"; // user makes the outline invisible
    h.options["sub-color"] = "#FFFFFF00";
    h.runTimers(3); // the paused-only style check notices within a second
    assert.ok(h.overlay.style.includes("color: #FFFF00FF"));
    assert.equal(h.options["sub-border-color"], "#00010204", "hidden again while paused");
    h.play();
    assert.equal(h.options["sub-color"], "#FFFFFF00");
    assert.equal(h.options["sub-border-color"], "#00000000", "the user's transparent outline is kept");
  } finally {
    h.cleanup();
  }
});

test("reads libass font metrics once per font and sends them to the overlay", async () => {
  const h = loadPlugin({ ...IINA_142_OPTIONS, "sub-font": "Axiforma-Regular" }, { subtitle: "Hey, um," });
  try {
    h.pageLoaded();
    h.pause();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.execCalls, [["/usr/bin/osascript", "Axiforma-Regular"]]);
    const last = h.messages.filter((message) => message.name === "render-style").pop();
    assert.deepEqual(last.data.fontInfo.metrics, [0.6313, 0.8131], "the regular face metrics reach the page");
    h.options["sub-font-size"] = "50";
    h.eventHandlers["mpv.sub-font-size.changed"]();
    assert.equal(h.execCalls.length, 1, "metrics are cached per font");
  } finally {
    h.cleanup();
  }
});

test("a selection is translated together with its whole subtitle line", async () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Okay, I call shotgun!" });
  try {
    h.pageLoaded();
    h.pause();
    await h.overlayHandlers["translate-selection"]({ text: "shotgun", point: { x: 1, y: 2 } });
    const cards = h.messages.filter((message) => message.name === "lookup").map((message) => message.data);
    assert.equal(cards[0].status, "loading", "the card opens immediately");
    const last = cards[cards.length - 1];
    assert.equal(last.status, "done");
    assert.equal(last.quick, "译:shotgun");
    assert.deepEqual(last.senses, [{ pos: "名词", terms: ["霰弹枪", "滑膛枪"] }]);
    assert.equal(last.sentence, "译:Okay, I call shotgun!");
  } finally {
    h.cleanup();
  }
});

test("with a Claude key, the card adds the meaning in context and cultural notes", async () => {
  const h = loadPlugin({ ...IINA_142_OPTIONS, "current-tracks/sub/external-filename": "/show/ep.srt", "media-title": "Example Show S01E01" }, { subtitle: "Okay, I call shotgun!" });
  try {
    h.prefs.claude_api_key = "fake-test-key";
    h.files["/show/ep.srt"] = "1\n00:00:01,000 --> 00:00:02,000\nWho's driving?\n\n2\n00:00:02,000 --> 00:00:03,000\nOkay, I call shotgun!\n";
    h.pageLoaded();
    h.pause();
    await h.overlayHandlers["translate-selection"]({ text: "shotgun", point: { x: 1, y: 2 } });
    const [call] = h.curlCalls;
    assert.ok(call.headers.includes("x-api-key: fake-test-key"), "the key goes in a header file");
    assert.equal(call.args.some((arg) => arg.includes("fake-test-key")), false, "the key is never a command-line argument");
    assert.ok(call.body.messages[0].content.includes("Who's driving?"), "the previous line is sent as context");
    assert.ok(call.body.messages[0].content.includes("Example Show S01E01"));
    assert.equal(Object.keys(h.files).filter((path) => path.startsWith("@tmp/")).length, 0, "temporary files are deleted");
    const last = h.messages.filter((message) => message.name === "lookup").pop().data;
    assert.equal(last.meaning, "抢副驾驶座");
    assert.equal(last.sentence, "好，副驾驶归我了！", "Claude's translation replaces Google's literal one");
    assert.equal(last.notes, "美国朋友间的习惯说法");
    assert.equal(last.status, "done");
  } finally {
    h.cleanup();
  }
});

test("other providers are called with the OpenAI format and a bearer key", async () => {
  const h = loadPlugin({ ...IINA_142_OPTIONS }, { subtitle: "Okay, I call shotgun!" });
  try {
    Object.assign(h.prefs, { llm_provider: "deepseek", llm_api_key: "fake-deepseek-key" });
    h.pageLoaded();
    h.pause();
    await h.overlayHandlers["translate-selection"]({ text: "shotgun", point: { x: 1, y: 2 } });
    const [call] = h.curlCalls;
    assert.equal(call.args[call.args.length - 1], "https://api.deepseek.com/v1/chat/completions");
    assert.ok(call.headers.includes("authorization: Bearer fake-deepseek-key"));
    assert.equal(call.body.model, "deepseek-chat");
    assert.equal(h.messages.filter((message) => message.name === "lookup").pop().data.meaning, "抢副驾驶座");
  } finally {
    h.cleanup();
  }
});

test("without a key, the card points to the large-model settings, not to one provider", async () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Okay, I call shotgun!" });
  try {
    h.pageLoaded();
    h.pause();
    await h.overlayHandlers["translate-selection"]({ text: "shotgun", point: { x: 1, y: 2 } });
    const hint = h.messages.filter((message) => message.name === "lookup").pop().data.hint;
    assert.ok(hint.includes("大模型"), hint);
    assert.equal(/Claude/.test(hint), false, hint);
  } finally {
    h.cleanup();
  }
});

test("closing the video and opening another one brings the selectable subtitle back", () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Hello there" });
  try {
    h.pageLoaded();
    h.pause();
    assert.equal(h.overlay.clickable, true);
    // The user closes the window; IINA keeps this player for the next file.
    h.eventHandlers["iina.window-will-close"]();
    assert.equal(h.options["sub-color"], "#FFFFFFFF", "the native subtitle is restored");
    assert.equal(h.overlay.visible, true, "the overlay is not hidden (IINA may not show it again)");
    h.overlay.file = "";
    h.paused = false;
    h.eventHandlers["iina.file-loaded"]();
    assert.equal(h.overlay.file, "ui/overlay.html", "the overlay page is loaded again");
    h.pageLoaded();
    h.pause();
    assert.equal(h.overlay.clickable, true, "pausing the new video shows the selectable subtitle");
    assert.equal(h.overlay.content, "Hello there");
  } finally {
    h.cleanup();
  }
});

test("a chosen provider without a key gets a precise hint", async () => {
  const h = loadPlugin(IINA_142_OPTIONS, { subtitle: "Okay, I call shotgun!" });
  try {
    h.prefs.llm_provider = "deepseek";
    h.pageLoaded();
    h.pause();
    await h.overlayHandlers["translate-selection"]({ text: "shotgun", point: { x: 1, y: 2 } });
    const hint = h.messages.filter((message) => message.name === "lookup").pop().data.hint;
    assert.ok(hint.includes("DeepSeek") && hint.includes("没有读到 API 密钥"), hint);
  } finally {
    h.cleanup();
  }
});
