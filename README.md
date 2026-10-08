# IINA English Coach / 暂停查词

给 IINA 的英文字幕学习插件。播放时完全隐藏；暂停后原生字幕会无缝变成可选字幕，并自动跟随 IINA 当前的字幕样式。

An IINA plugin for learning English from subtitles: when you pause, the subtitle becomes selectable in place (pixel-aligned with IINA's own rendering), and selecting a word or phrase shows its Chinese translation, plus in-context meaning and cultural notes from an LLM of your choice.

## 使用

1. 从 [Releases](https://github.com/imvanessali/iina-english-coach/releases) 下载最新的 `.iinaplgz`，双击安装，或在 IINA 的“设置 → 插件”中导入。
2. 打开带英文软字幕的视频并暂停。
3. 暂停后，字幕变成银灰色，并有一道白色高光从左到右反复扫过（仿 React Bits 的 ShinyText，速度放慢 30%，扫一趟的时长随句子宽度变化），表示它已变成可选字幕。框选单词或短语，选区旁会弹出卡片：选中部分的翻译、词典义项（短语不超过三个词时），以及整句字幕的翻译。
4. 想要语境和文化背景解释：在 IINA「设置 → 插件 → English Coach → 偏好设置」选择服务商并填入 API 密钥。之后卡片会多出“这里的意思”“背景”，整句也换成大模型的自然译法。

   支持 Claude、OpenAI、Google Gemini、DeepSeek、Kimi、通义千问、智谱 GLM、豆包（火山方舟）、硅基流动、OpenRouter、xAI Grok、Mistral，以及任意 OpenAI 兼容接口（自定义地址）。每家都有默认模型，可在“模型”栏改成别的；豆包需要填接入点 ID 或模型名。
5. 恢复播放后，浮层立即清空并停止接收鼠标事件。

## 让 IINA 记住字幕样式

- 想每次打开都一样：在 IINA「设置 → 字幕 → 文本字幕」里调字号、颜色、描边、背景、字体、位置和边距。这里是全局设置，会一直保存。
- 播放窗口侧边「字幕」面板里的「文字样式」（字号、颜色、边框宽度、背景、字体）只影响当前这次播放，关掉 IINA 就丢失。
- 侧边面板里的「缩放」和「位置」会按文件记进续播记录：只对这一集生效，换一集又是全局值。想统一，就把缩放点回重置、位置拉回 100%，在设置里改全局值。

## 设计原则

- 不修改 IINA 的字幕字体、字号、描边粗细或持久设置；暂停时只把原生字幕的文字、描边、阴影和背景颜色临时换成特殊标记的透明色，播放后恢复原值。暂停期间在 IINA 里改的任何值（包括把描边设为 0、选透明色）都会被识别为你的修改并保留。
- 不使用常驻侧边栏或固定面板。
- 暂停时不显示额外面板、背景或提示条，字形、位置、描边与原生字幕一致，SRT 里的斜体和粗体也照样显示；只用 ShinyText 流光提示“这是可选字幕”。流光画在每行字幕的副本上，不会被点中或选中。系统开启“减弱动态效果”时流光静止。
- 播放时不轮询字幕；只监听 IINA/mpv 的暂停与字幕事件。
- 暂停后只做最多两次短延迟读取，避开 mpv 暂停事件早于当前字幕文本更新的时序；不会在播放时运行。
- 如果插件启动时 IINA 已恢复视频窗口，会直接初始化叠层，不依赖已经错过的窗口加载事件。
- 暂停状态切换后延迟读取一次 IINA 的暂停状态，避免事件先于状态值更新。
- 插件自动待命，不需要开关；只有暂停且有字幕时才可交互。
- 暂停字幕会读取 IINA 当前的字体、字号、缩放、颜色、描边、阴影、背景框、粗体、斜体、间距、对齐与位置，不写死字体。
- 暂停中修改字号、缩放、描边粗细、阴影距离、间距、边距或位置会立即跟随；颜色、字体、粗斜体无法被监听，暂停期间每秒比对一次（播放时不运行）。暂停中改过的设置在恢复播放后保留。
- 选中的英文和它所在的整句字幕会发送到 Google Translate，固定译为简体中文；不会发送整份字幕或影片信息。Google 对俚语、习语和文化梗基本是直译（如 break a leg → “打断腿”），这类需要大模型才能解释。
- 翻译仅在暂停并选中字幕时请求，不轮询、不预取。Google 的免费接口会对密集请求限流（HTTP 429），所以几个请求依次发出、结果缓存、失败重试一次，并在限流时改用 clients5.google.com 的备用接口。
- 释义使用短小的原生风格 tooltip，不打开固定面板。
- 使用完整 overlay 文档以便在选词后提供翻译；仍只在暂停字幕上启用交互。

## IINA 1.4.2 兼容要点

- 叠层网页加载完成（`iina.plugin-overlay-loaded`）后才注册消息监听并调用 `show()`；IINA 在此之前会静默忽略这两个调用，而 `loadFile()` 还会清空已注册的监听。
- IINA 以数值格式监听 mpv 属性，`sub-text` 这类字符串属性不会触发变化事件；插件改为监听 `sub-start`/`sub-end` 来感知换句。
- IINA 内置 mpv 0.38，描边选项名是 `sub-border-*`，阴影颜色在 `sub-shadow-color`，没有 `sub-border-style`（背景色不透明即为背景框）；插件会自动选择可用的选项名。
- 打包时（`npm run pack`）只放 `Info.json`、`src/`、`ui/` 等运行文件，避免把旧的 `.iinaplgz` 和开发文件一起打进去。

## 与原生字幕对齐

暂停字幕按 mpv 0.38 和 libass 0.17 的排版规则计算，而不是按经验系数：

- 字号：libass 让字体的 OS/2 winAscent + winDescent 等于字号，网页按 em 排字，所以按字体换算。插件通过系统自带的 `osascript` 调用 CoreText 读取当前字体的这组度量（每种字体只读一次），因此用户自装的字体（如 Axiforma）也能对齐；读取失败时退回内置表和网页实测。
- 基线与行高：每行单独成块、行高精确等于 libass 行高，并在网页中实测基线后对齐，避开 WebKit 的取整。
- 边距与位置：复现 mpv 把边距截断为整数 ASS 像素的行为，以及 `sub-pos` 的位移公式；画面有黑边时（如全屏）按 `sub-use-margins` 规则相对窗口或视频计算。
- 折行：复现 libass 的智能折行（先贪心折行，再把上一行末尾的单词挪到下一行以缩小宽度差）。
- 描边：libass 描边完全在字形外侧，网页描边宽度取两倍并只露出外侧一半。
- 笔画粗细与字距：关闭 macOS 字体平滑（它会加粗笔画）和字距调整（libass 默认不做），并补偿 libass 一个设备像素的水平偏移。
- 斜体与粗体：读取 mpv 的 `sub-text-ass`，按 SRT 的 `<i>`/`<b>` 分段渲染。字体设置写的是具体字形名（如 Axiforma-Regular）或字体没有斜体字形时，libass 会自己把正体斜切（PostScript 轮廓 10°，TrueType 约 18.8°），插件按同样角度斜切；斜体切回正体时复现 libass 补的那段间距。

`tools/calibrate/` 用 IINA 自带的 libmpv 和离屏 WebKit 逐像素对比两种渲染，目前在各种字号、缩放、字体、粗斜体、描边、阴影、边距、位置、对齐和多行折行下，垂直误差为 0、水平误差不超过 1 个设备像素。

## 权限

- `video-overlay`：在视频上显示可选字幕。
- `network-request`：把选中的英文发给 Google Translate。
- `file-system`：运行 `/usr/bin/osascript` 读取字幕字体的度量；读取当前 SRT 字幕文件，取前后几句作为语境；填了大模型密钥时，用 `/usr/bin/curl` 调用所选服务商的接口（密钥和请求写在插件临时目录，调用后立即删除，不出现在命令行参数里）。

## 数据与隐私

只有用户暂停并选中文字后，所选文字和它所在的那句字幕才会发送给 Google Translate 以获取简体中文翻译。填了大模型密钥时，还会把这句、前两句和后一句字幕以及剧名发给所选服务商，按其 API 用量计费。播放中不会发起网络请求。

## 开发

```bash
npm install
npm test
npm run pack        # 只打包运行所需文件，输出到 dist/
/Applications/IINA.app/Contents/MacOS/iina-plugin link "$(pwd)"
```

要求 IINA 1.4 或更新版本。图像字幕（例如部分 DVD/蓝光 PGS）和烧录在画面里的硬字幕无法读取。
