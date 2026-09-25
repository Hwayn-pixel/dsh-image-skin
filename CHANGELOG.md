# Changelog

> 每个版本号下方先给中文摘要，随后是详细英文条目。
> Each version starts with a Chinese summary, followed by the detailed English entries.

## 0.4.0 — 2026-09-25

**中文摘要** — 装饰纹样 + AI 纹样：①插件现在能给界面“骨架”（按钮 / 输入框 / 弹窗 / 它们背后的轨）染色，颜色从
你的壁纸里提取——**档位 0** 完全本机计算、不联网；②**档位 1–4** 接任意 OpenAI 兼容的生图接口，让模型画一张真正的
装饰边框（角花 + 连续边饰，提示词里锁死“不要文字/人/景/物”），生成后放进图墙，点一下就当装饰框用；Key 支持
“环境变量（只读）”或“手动填”，只存本机；③内置 8 个服务商预设（火山方舟 Seedream / 通义万相 / 智谱 / 混元 /
OpenAI / FLUX / Stability / 自定义），设置页里能检测环境变量有没有 key；④新增 `tools/demo-provider.mjs`
（`npm run demo:provider`）——本机假生图服务，**没 key 也能把“生成→图墙→应用”整条链路跑通**；
⑤离线测试从 32 条扩到 68 条，覆盖 AI 通路的成功与失败分支；⑥修掉欢迎页 `_card` 写死白底导致透明度滑块无效、
以及 `apply()` 被调两次时旧实例会把新实例的 DOM 拆掉两个真 bug。

> 裓位设计上把“纹样”交给模型、而不是用 CSS 硬画：CSS 渐变做出来的边框视觉上像虚线 / 禁用态，不像装饰。

An accent pass over the interface skeleton, plus AI-generated ornament borders.

### Changed
- **The accent is a scheme now, not a coat of paint.** The first version painted the sampled wallpaper
  colours straight onto the skeleton — one hue per element, plus a diagonal stripe texture and a thick
  ornament frame around every button, including 30px ones. It read as a colour clash, and fairly so.
  What replaced it:
  - the sampler's four colours are reduced to **one hue**, and every role is rebuilt from it, with
    lightness walked until each colour actually separates from the surface behind it;
  - **no textures** — a single soft sheen on controls at most;
  - control hairlines are drawn with `outline` + `:not(:focus-visible)`, so they cost no layout, never
    eat a control's own box-shadow, and leave the focus ring alone;
  - **ornament goes where there is room**: panels (dialogs, menus, settings sections) wear the frame,
    controls never do;
  - the ladder is visible step by step now: tint and hairline strength rise per level, panels go
    tick → bracket → generated ornament.
- **The settings dialog is decorated at last.** The scan only ran on a settings change or theme flip,
  so chrome that appeared later — the settings dialog, menus, popovers — was never marked. The
  throttled repaint pass now re-stamps the accent too.
- **The level descriptions match what actually happens**: 0-2 are drawn on your machine, 3-4 hand the
  frame to the generated ornament. The old copy credited the model for all four.

### Added
- **通义万相 / 千问（阿里云百炼）now works.** DashScope image synthesis is *not* OpenAI-shaped: you
  submit a job, poll the task id, and the pictures come back as short-lived OSS urls, with sizes
  written `1024*1024`. A small adapter speaks that protocol, and the preset points at it — the old
  entry aimed at a “compatible-mode” endpoint that does not serve image models, so it would have
  failed on the first real key.
- **The model id is editable for presets too** (the placeholder shows the default), so trying
  `wanx2.1-t2i-plus` or `wan2.2-t2i-plus` no longer means switching to 自定义 and retyping everything.
- **Entry cards carry state.** Level one answers "where am I up to?" without a click: the 贴图 card shows
  how many areas are configured, the AI card shows the current level (or that decoration is off).
  Group headers carry the same count as `1/6 已配`, a dashed card and a 从这里开始 tag mark the first
  step when nothing is set yet, and the back bar sticks to the top while you scroll.
- **Two-level settings screen.** Level one is a choice — 「贴图」for the artwork, 「AI 纹样」for the
  ornament — instead of everything stacked on one page. The AI entry is locked while the window
  region has no image (the ornament samples its palette from that image), and entering it raises a
  five-line pre-flight notice about what leaves the machine, what costs money and what stays local;
  「不再显示」persists that choice. The generator itself is no longer visible from level one.
- **Accent (level 0, local).** A palette is extracted from whatever artwork is on the window and
  painted onto the skeleton — buttons, inputs, dialogs, rails. Extraction weights colours by
  **saturation × mid-lightness** rather than raw pixel count, so a night sky does not turn the whole
  UI grey. Offline, no key.
- **AI ornament (levels 1–4).** A real ornamental frame — corner flourishes, a repeating edge — from
  any OpenAI-compatible text-to-image API, used as the border. The prompt is composed on the host
  and hard-locks `no text / no letters / no people / no animals / no scenery / no objects / no
  watermark`, so the model returns decoration only.
- **Provider presets** (`GET /dsh-image-skin/providers`): 火山方舟 Seedream (Doubao), 通义万相,
  智谱 CogView, 腾讯混元, OpenAI, FLUX, Stability, and a generic `自定义（OpenAI 兼容）`. The response
  reports `envReady`, so the settings page can say whether an environment key is present. Keys come
  from an environment variable (read-only in the UI) or a field you type; either way they stay local.
- **`POST /dsh-image-skin/prompt`** — compose and preview the exact prompt without generating.
- **`POST /dsh-image-skin/gen`** — generate, download the result and store it next to your other
  images; the settings page turns the replies into a click-to-apply wall.
- **`tools/demo-provider.mjs`** + `npm run demo:provider` — a dependency-free stand-in image API
  that draws an ornament locally from the prompt’s palette, so the whole chain can be exercised
  with no key and no network.

### Fixed
- **The generated ornament could never appear.** `applyAccent` clamped the level to 2 before handing
  it to the stylesheet, so the `level >= 3` branch inside `accentCss` — the only path that uses the
  chosen generated frame — was unreachable. Levels 3-4 always fell back to the local art, which made
  the headline feature quietly dead. The raw level now goes through, and the body attribute carries
  it too (it is only a selector flag, but it is also the first thing you check when debugging).
- **An applied ornament could not be taken off again.** There was no way back from "应用": clicking
  the wall now toggles, so the applied thumbnail un-applies (the title says so).
- **The settings screen was the least readable screen in the product.** The panel-opacity slider
  re-points DSH's own background tokens — which is exactly the point out in the app, but it turned our
  own cards into frosted glass over the wallpaper. Our surfaces now read one opaque colour of the
  current scheme, so the screens you configure things from stay legible at any opacity.
- **The accent did nothing at all for a video wallpaper.** Palette extraction decoded an `<img>`, which
  never succeeds for an `mp4`/`webm`, so the whole local half silently no-opped for anyone using the
  feature the plugin is proudest of. It now samples a real frame from the video.
- **The generated ornament never received the palette.** The prompt could only say "colours sampled
  from the wallpaper", which is a thing an image model has no way of seeing. The sampled colours are
  now written back with the settings and travel with the prompt as `r, g, b` triplets.
- **The accent no longer decorates our own settings chrome** (`data-dsh-skin-chrome`), which the
  exclusion list always intended but the settings section never opted into.
- **The welcome-page card ignored the theme.** `_card` used a hard-coded white background instead of
  the theme token, so it stayed opaque no matter what panel opacity you chose.
- **Re-applying the plugin could tear down the instance it had just built.** `apply()` called twice
  (settings re-registering on a re-render) let the previous instance’s cleanup remove the new one’s
  DOM; a generation guard now keeps the two apart.

### Tests
- The offline host suite grew from 32 to 68 assertions: `GET /providers`, `POST /prompt` and
  `POST /gen` are driven through a scripted `fetch`, covering the happy path (data URI and remote
  URL, clamped count, forwarded size, key precedence) and the failure paths (unknown provider,
  custom without URL/model, no key anywhere, a reply with no images, 401, unreachable host).
- The browser suite grew from 11 to 19: the AI gate (`windowHasArtwork`) is pinned for a shared
  image, a light-only image, a dark-only image, an empty string, and for other regions that must
  *not* unlock the AI screen.
- The host suite grew from 68 to 76 with the DashScope path: submit → poll (RUNNING then SUCCEEDED)
  → download, the `*`-style size, the async header, the preset model, a FAILED task, and a reply
  with no task id.

## 0.3.0 — 2026-09-24

**中文摘要** — 设置页重做 + 切换更顺：①取消「先选模式、再跳进另一个页面」的两级结构，改成**一屏到底**：顶部分段控件只当「正在编辑哪一套图」的过滤器，界面区域 / 角标 / 全局效果 / 存储全部常驻；②补上原本缺失的「**上传共用图**」入口（以前只能清、不能设）；③每个区域一行卡片：缩略图 + 名称 + **来源标签**（浅色专用 / 两模式共用 / 未设置）+ 操作；④修掉大页面上切浅/深色时的卡顿——不再让浏览器过渡 `color`（容器里几千个继承 `currentColor` 的图标会跟着全量重绘），大 DOM 下只过渡背景与描边。

> 版本号从 0.1.1 跳到 0.3.0：0.2.0 曾用于一次已撤回的发布（npm 上已弃用），不再复用。

A settings-page rebuild plus a smoother theme switch.

### Changed
- **Settings is one screen now.** The old flow was two levels: a mode picker, then a separate page per mode,
  with the global sliders vanishing while you were in there. Mode is now a segmented control at the top that
  only chooses *which set of images you are editing*; the area groups, the global sliders and storage stay put.
- **Every area is a card**: thumbnail, name, a provenance tag (`浅色专用` / `两模式共用` / `未设置`), and its controls —
  the previous layout left the middle column starved of width once the buttons grew, which wrapped the label
  one character per line.
- Controls are quieter: the shared-image upload only appears when there is no shared image yet, and clear only
  when there is something to clear.

### Added
- **Shared-image upload.** A per-mode image already fell back to `<area>Image`, but nothing in the UI could ever
  *set* that fallback — it could only be cleared. Each area now offers it directly.

### Fixed
- **Stutter when flipping light/dark on a large page.** The transition animated `background-color`, `color` and
  `border-color` on the big surfaces; because thousands of descendants inherit `currentColor`, animating `color`
  repainted all of them every frame. On a large DOM the transition now covers backgrounds and borders only —
  which is where nearly all of the perceived smoothness comes from — while text switches a frame earlier, which
  the eye does not catch.

## 0.1.1 — 2026-09-19

**中文摘要** — 元数据与文档修正，无功能改动：README 顶部明确本插件与 GitHub 上几个同名 `dsh-image-skin` 项目的区别（我们是「区域 + 角标」那个，不是自动配色器）；修掉安装段残留的 `CHANGE-ME` 占位链接；整理 `package.json` 元数据（`repository` / `bugs` / `homepage` 指向真实仓库，补 `image` / `gif` / `video` 关键词）。

Metadata and documentation only — no behaviour change.

- README: state the difference from the other GitHub projects sharing the `dsh-image-skin` name (this one paints regions and stickers; it is not a palette adapter).
- README: replace the leftover `CHANGE-ME` placeholder clone URL in the install section.
- package.json: point `repository`, `bugs` and `homepage` at the real repository, normalise `repository.url` to the `git+` form, and add `image` / `gif` / `video` keywords.

## 0.1.0 — 2026-09-13

**中文摘要** — 首个公开版本。项目最初是私人作品（宿主半：设置命名空间 + 本地上传/存储/服务；浏览器半：区域贴图、可拖拽角标、设置二级菜单），本次为公开发布做了加固，并为宿主半补上离线测试。

- **新增**：未被引用的图片自动回收（`POST /dsh-image-skin/gc` + 设置页按钮）；上传流式上限（32 MB，超出时在 body 读完前就回 `413`，浏览器侧另有 24 MB 预检与明确报错）；**浅色/深色按模式独立配图**（设置页两级：先选模式、再进同一套菜单，进入模式同时切换实时主题）+ 侧栏底部日/月切换按钮；**平滑的明暗切换**（约 320 ms 过渡窗口，调色板交叉淡化，壁纸若两模式不同则做真正的交叉淡化）；**视频播放速率**滑块；离线测试套件（48 条断言，无需 DSH 进程与网络）。
- **修复**：UI 重渲染后区域图消失（新增节流的修复重绘）；`panelOpacity` 为 0 时界面变白（壁纸不再跟随滑块透明度）；侧边栏始终不透明（补上 `--dsw-specific-sidebar-fill` 覆盖）；禁用插件后仍残留（teardown 更彻底）；上传失败静默（现在在设置页显示原因）；移除一次性 DOM 探针。

（以下为详细英文条目。 / Detailed English entries below.）

First public release.

The plugin started as a private project: a host half (settings namespace + local upload/storage/serve
routes) and a browser half (region painting, draggable stickers, settings submenu). This release
hardens it for public use, with an offline test suite for the host half.

### Added

- `POST /dsh-image-skin/gc` — collects stored files that no area references any more. Called
  automatically after every image change and exposed as **清理未使用图片** in the settings page.
  The keep set is computed on the host from the resolved settings, and a 60-second cooldown protects
  a file that was just uploaded but not committed to settings yet.
- Streaming upload cap (`MAX_UPLOAD_BYTES`, 32 MB request body) answering `413` while the body is
  still arriving, plus a matching 24 MB pre-check and a visible error message in the settings page.
- **Per-mode artwork.** The settings page became two levels: two large **浅色模式 / 深色模式** buttons at
  the top of the plugin page open one identical image menu per mode, so each scheme has its own set of
  images. Entering a mode also switches the live theme, so what you configure is what you see. Every
  area gained `<area>ImageLight` / `<area>ImageDark` next to the shared `<area>Image`; resolution is
  mode-specific first, shared as the fallback, so a config written before this change keeps working.
  A sun/moon switch lives in `sidebar.footer.action` (beside Settings, sized to match it), writes the
  DSH theme preference through `setTheme`, and follows `theme/change` when the theme is switched
  elsewhere.
- **Smooth light/dark switch.** A theme flip used to snap in one frame. Now the plugin opens a short
  transition window (`body[data-dsh-skin-theme-anim]`, 320 ms) in which `background-color`, `color` and
  `border-color` transition, so DSH's palette and the plugin's own tint cross-fade. When the wallpaper
  differs per mode and both sides are still images, a temporary layer cross-fades the two, committing
  only once the fade lands (image → video keeps the palette fade only: a video swap would need two live
  video elements). The window is opened from the switch itself and from `theme/change`, and is skipped
  for font-size-only changes and for the first snapshot.
- **Kept it cheap.** Those three properties are non-composited, so the scope adapts to the DOM: above
  ~1500 elements the window switches to a `lite` scope that transitions only `body` and the big
  surfaces instead of every descendant, and `prefers-reduced-motion` disables it. On the plugin's side,
  regions repaint only when their image really changed, an unchanged sticker is no longer torn down and
  re-decoded (which also stopped sticker videos from restarting on unrelated edits), and the settings
  UI re-render is deferred one frame so it does not compete with the palette repaint.
- **No more stall on the image itself.** Switching modes used to fetch *and* decode the incoming
  artwork at that exact moment. Two changes remove it: stored files are now served
  `cache-control: public, max-age=31536000, immutable` (a stored file is addressed by a UUID minted
  per upload, so it can never change under its URL — previously `no-cache` made the browser re-fetch
  a multi-MB wallpaper on every switch), and the browser half warms the *other* mode's artwork —
  `Image.decode()` for images, a hidden `preload="auto"` element for videos — shortly after the
  current mode settles, so the switch has nothing left to pay for. Warming is keyed by URL (each
  artwork once) and skips areas whose image the two modes share.
- **Video playback rate.** `videoPlaybackRate` drives `playbackRate` / `defaultPlaybackRate` on the
  window video and on sticker videos. Sticker areas now render a `<video>` for video URLs instead of
  an `<img>` that silently showed nothing.
- `test/` suite — 48 assertions in two offline files: `host.test.mjs` (upload round-trip, byte
  fidelity, both oversize paths, unsupported type, malformed payload, path traversal, GC keep /
  collect / fresh-file / per-mode-only semantics, `409` on unresolved settings, idempotent delete,
  route disposer) and `client-units.test.mjs` (per-mode image resolution, evaluated from the built
  bundle with a stub React — no DOM, no browser). No DSH process, no network.
- Explicit `kind: "prefix"` on the route registration, and the `register()` disposer is now returned
  to `ctx.effect`, so unloading the plugin actually removes the routes.

### Fixed

- **Region images disappeared after the UI re-rendered.** Repainting only happened on settings or
  theme changes, so regions whose host mounts later (welcome hero, right panel) never received their
  image. A throttled repair pass now repaints whatever is missing, without touching stickers.
- **`panelOpacity` at 0 blanked the interface to white.** The video wallpaper inherited the slider's
  alpha and faded to `opacity: 0` while the panels went transparent, leaving the browser's white
  canvas exposed; static images were unaffected because they ride on `body`'s `background-image`.
  The wallpaper is now always full-strength.
- **The sidebar stayed opaque.** `--dsw-specific-sidebar-fill` (a documented theme token: "Sidebar
  column and title-row background") was not overridden, so the sidebar kept an opaque fill however
  low the slider went.
- **Disabling the plugin left visible residue.** Teardown now also removes the window backdrop, the
  video layer, sticker elements, the `position: relative` added to sticker hosts and the injected
  styles.
- **Silent upload failures.** Non-OK responses were only logged to the console; the reason is now
  shown in the settings page.
- Removed the one-off DOM probe (`POST /dsh-image-skin/probe` and its client helper) and the panel
  opacity debounce timer is cleared on unmount.
