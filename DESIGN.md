# dsh-image-skin — design notes

> 下方先给中文摘要，正文为详细英文设计笔记。
> Chinese summary first; the body is the detailed English design notes.

## 中文摘要

给 DSH（DeepSeek Harness）Web UI 做一层**粗粒度皮肤**：把界面上少数几个大区域换成用户自己的图（含循环视频），
角标可拖动 / 缩放，全部在设置二级菜单里配置，且**不改 DSH 源码、可一键还原**。

- **组成**：`package.json` 声明 `dsh.bundle.patch` 与 `dsh.client.platform`；`cordis.patch.yml` 插入 `ui-image-skin` 行；
  宿主半（`src/index.ts`）注册设置命名空间与 `/dsh-image-skin/*` 路由；浏览器半（`src/client/index.ts`）绑定设置、绘制区域、
  注册 `settings.section` 设置页。`lib/` 是 DSH 实际加载的产物，所以入库提交。
- **设置**：`IMAGE_AREAS` 是唯一真源，schemastery 结构由它生成（每个区域 6 个字段 + 全局 `enabled` / `panelOpacity`），
  因此新增区域无需改 schema。只持久化 URL，不存图片本体；文件落在 `$DSH_HOME/image-skin/`。
- **上传**：`POST /upload` 收 data URI，流式上限 32 MB（超出时 body 未读完即回 `413`），类型白名单决定扩展名，
  文件名用 UUID，客户端提供的文件名永远落不到磁盘。
- **回收**：`POST /gc` 删除已无引用的文件；**保留集在宿主侧**由设置解析得出（客户端无法要求删别人的文件）；
  60 秒内的新文件不回收；设置尚不可解析时返回 `409`。
- **绘制**：区域以 CSS Modules **类名后缀**定位（`_centerCol`、`_sidebarCol`、`_hero`、`_pane`、`_composerSeat`…），
  打 `data-dsh-skin-region` 标记实现幂等；`MutationObserver` 做 300 ms 节流修复，**只修区域、不动角标**；
  角标用 `<div>` 包裹（`<img>` 是空元素，带不了缩放手柄）；面板不透明度写一个作用于
  `body[data-dsh-image-skin]` 的 `<style>` 覆盖主题 token，**壁纸本身不跟随该滑块**。
- **明暗**：以 `theme` 服务的 `colorScheme` 为准；`theme/change` 持续同步；切换时开一个 320 ms 过渡窗口交叉淡化调色板，
  壁纸（两边都是静态图时）做真正的交叉淡化（图→视频只走调色板）；另一模式的素材用 `Image.decode()` / 隐藏 `<video>` 预热。
- **已知限制**：区域宿主是 DSH 内部实现，改名即失效；文件路由不支持 `Range`；上传走 base64（体积膨胀 ~33%）。
- **作者**：**Hwayn**（幻弈）—— 设计与实现；**Yucheng Xiao**（肖宇成）—— 协作者（方向、需求、测试与发布）。

（详细英文设计见下。 / Detailed English design notes below.）

## Goal

Give the DSH web UI a **coarse** skin: replace the few large regions of the interface with the user's
own artwork, configured from a settings submenu, without patching DSH itself.

Non-goals: pixel-level theming (borders, bubbles, per-component colours), remote content, or any
change that is not reversible by disabling the plugin.

## Composition

DSH composes its web UI from a **profile**, and this package is one row in it:

- `package.json` declares `dsh.bundle.patch: ./cordis.patch.yml` and `dsh.client.platform: web`, so
  the loader mounts both halves of the plugin.
- `cordis.patch.yml` inserts the row `ui-image-skin`.
- **Host half** (`src/index.ts`) registers the durable settings namespace and owns every
  `/dsh-image-skin/*` route.
- **Browser half** (`src/client/index.ts`) binds that namespace, paints the regions, and registers
  the `settings.section` page.

`lib/index.js` (ESM) and `lib/client.js` (CommonJS wrapped in the client-modules
`window.__ModuleLoader__.load({ id, factory })` envelope) are the artifacts DSH actually loads, so
`lib/` is committed and `prepublishOnly` rebuilds it.

## Settings

`IMAGE_AREAS` in `src/index.ts` is the single source of truth: the schemastery shape is generated
from it, producing `${area}Image`, `${area}Enabled`, `${area}Fit`, `${area}OffsetX`, `${area}OffsetY`
and `${area}Scale` per area, plus the globals `enabled` and `panelOpacity`. Adding an area therefore
never needs a schema edit.

Only URLs are persisted — never payloads. Uploads live as files in `$DSH_HOME/image-skin/`
(`DSH_HOME` defaults to `~/.dsh`) and are served back from `/dsh-image-skin/files/<uuid>.<ext>`.

## Upload path

`POST /dsh-image-skin/upload` accepts `{ image: "data:<type>;base64,…" }`. The body is read through a
**streaming** cap (`MAX_UPLOAD_BYTES`, 32 MB of base64 envelope ≈ 24 MB of file) so an oversized
upload is rejected with `413` while it is still arriving, instead of being buffered first. The type
whitelist (`EXTENSIONS`) decides the extension; filenames are generated UUIDs, so a client-supplied
name can never reach the filesystem. The browser mirrors the limit with a pre-check and renders the
rejection reason in the settings page.

Trade-off: base64 inflates the payload by ~33 % and makes the browser hold a copy as a string. That
is why the limit exists at all; a future revision should post raw bytes with
`fetch(..., { body: file })` and stream straight to disk.

## Garbage collection

`POST /dsh-image-skin/gc` deletes stored files that no area references any more.

- The **keep set is computed on the host**, from the resolved settings value of the namespace
  (`settings.get`) — the client never supplies it, so a buggy or hostile client cannot ask for
  someone else's file to be deleted.
- A file younger than `GC_MIN_AGE_MS` (60 s) is never collected: between an upload and the settings
  write that references it, the file is legitimately unreferenced.
- If the namespace is not resolvable yet, the route answers `409` instead of treating "no settings"
  as "keep nothing".

The client triggers it after every image change (debounced, so the write has committed) and exposes
the same call as an explicit button.

## Painting the UI

**Regions.** `REGION_SELECTORS` maps an area id to one or more candidate selectors, tried in order.
The element that received the image is tagged `data-dsh-skin-region="<id>"`, which makes painting
idempotent: `regionApplied()` compares the tagged element with the currently mounted surface and the
inline `background-image` with the expected URL, so a repaint happens only when it is actually
needed. The window backdrop is special-cased: a video URL switches to a full-screen
`<video autoplay muted loop>` layer, anything else rides on `body`'s `background-image` and is
mirrored onto the sidebar column.

**Repair pass.** Region hosts mount and unmount while the app runs (`_hero` only exists on an empty
session, `_pane` only while the right panel is open), and a re-render can replace the element
carrying the inline style. A `MutationObserver` on `document.body` therefore schedules a throttled
(300 ms) repair. Two deliberate constraints:

- it observes `childList` + `subtree` and *only* the `data-ds-dark-theme` attribute, so the plugin's
  own inline styles and `data-*` tags can never re-trigger it (no feedback loop);
- it repaints **regions only** — never stickers — so an in-progress drag or resize is not
  interrupted by an unrelated DOM mutation.

**Stickers.** An `<img>` cannot carry a resize handle, so each sticker is a positioned `<div>`
wrapper appended to its host (`_composerSeat`, `_sidebarCol`). The host is given
`position: relative` when computed `static`, and marked so teardown can undo exactly that.

**Panel opacity.** `applyPanelOpacity()` writes one `<style>` block scoped to
`body[data-dsh-image-skin]` that overrides the documented surface tokens with `rgba(…, a)` where
`a = panelOpacity / 100`. The wallpaper is intentionally excluded from `a`: the slider exists to
reveal the wallpaper, so binding the video's opacity to it faded the backdrop out exactly when the
user wanted to see it. Sticker opacity does follow the slider, as an overlay that fades with the
chrome it sits on.

**Light / dark.** The scheme comes from the `theme` service (`getTheme().active.colorScheme`), not
from the body flag: the flag is applied a tick after a switch, which would leave the panel tint one
mode behind. `theme/change` is the continuous-sync signal, so images follow a switch made from DSH's
own Appearance setting, and the sun/moon slider writes back through `setTheme` — the documented single
preference-write entry — rather than styling around it. Every area resolves its image as
`<area>Image<Mode>` → `<area>Image` → nothing, so the per-mode fields are purely additive and the
shared field stays the lightweight default. `resolveAreaImage` is exported purely so the offline
client test can pin that fallback order.

The settings page is deliberately two-level: a mode picker (two large buttons) that also switches the
live theme — so configuring light mode shows light mode — leading into one identical image menu per
mode. The sidebar-foot switch is the same state source in a different size: registered in
`sidebar.footer.action`, it measures the tallest sibling button (the Settings trigger) and matches
that height so the two read as equally sized neighbours.

**Video speed.** One `videoPlaybackRate` value is applied to every video the plugin renders — the
window layer and sticker videos — on both `playbackRate` (live) and `defaultPlaybackRate` (survives a
`src` swap). The slider previews it against the live elements before the debounced write lands.

**Cross-fading a mode switch.** DSH repaints its palette in one frame, so a theme flip reads as a cut.
The plugin therefore opens a transition window *before* the switch: an attribute on `body`
(`data-dsh-skin-theme-anim`) makes colour-bearing properties transition for 320 ms, which covers
DSH's own chrome and our panel tint (CSS variables are not animatable themselves, but their consumers
are). It is opened both by the switch and by `theme/change`, and only for a real light↔dark change —
never on the first snapshot or a font-size-only change. The wallpaper gets a genuine cross-fade: a
temporary fixed layer holds the incoming artwork and fades in over the outgoing one, and the real
repaint happens only after the fade lands, in that order, so nothing flashes. Image → video falls back
to the palette fade, because swapping video sources in place would need two live `<video>` elements.

That transition is expensive by construction — `background-color`, `color` and `border-color` are not
compositor properties, so the browser recalculates style and repaints every frame the window is open.
Three things keep it affordable: the property list is only what actually shifts between the palettes
(`fill`/`stroke` are redundant because icons inherit `currentColor`, shadows barely differ, and
pseudo-elements doubled the matched-element count); the scope adapts to the DOM — above ~1500 elements
the attribute becomes `lite` and only `body` plus the big surfaces (`_sidebarCol`, `_centerCol`,
`_pane`, `_panelBody`, `_composerSeat`, `_hero`) are transitioned, so a long conversation cannot drag
the frame rate down; and `prefers-reduced-motion` switches the animation off entirely. The same frame
is kept light on our side too: regions repaint only when their resolved image changed, an unchanged
sticker is never torn down and re-decoded, and the settings UI's re-render is deferred one frame.

**Loading the artwork ahead of the switch.** The remaining stall was not the animation but the artwork
itself: a mode switch swaps the wallpaper and every per-mode region image, so the browser fetched and
decoded them at that instant. Two changes remove it. Stored files are served
`cache-control: public, max-age=31536000, immutable` — a file is addressed by a UUID minted per upload,
so its bytes can never change under that URL, and the previous `no-cache` forced a full re-fetch of a
multi-MB wallpaper on every switch. And the browser half *warms* the mode that is not on screen: about
250 ms after the current mode settles it pulls the other mode's artwork through `Image.decode()` (or a
hidden `preload="auto"` element for a video), so nothing is left to decode at switch time. Warming is
keyed by URL — each artwork once — and areas whose image both modes share are skipped.

## Teardown contract

Everything the plugin adds is registered on its own fiber and undone in `disposeSkinDom()`: window
background, sidebar mirror, video layer, sticker elements, the `position: relative` it added, the
editing affordance, and both injected `<style>` blocks. The settings namespace and the routes are
disposed with the fiber (`ctx.effect` returns the route disposer).

## Known limitations

- Region hosts are DSH internals addressed by CSS-module **class-name suffix**; a DSH release that
  renames them breaks region targeting (the settings page keeps working).
- The file route serves whole files without `Range` support and with `no-cache`; fine for a wallpaper,
  not a media server.
- Uploads are base64 data URIs (see above).
- `panelOpacity` overrides theme tokens globally for as long as the plugin is enabled: at very low
  values the UI is translucent, which is the point, but it does reduce contrast.
