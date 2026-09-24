# Changelog

> 每个版本号下方先给中文摘要，随后是详细英文条目。
> Each version starts with a Chinese summary, followed by the detailed English entries.

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
