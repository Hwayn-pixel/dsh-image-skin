# dsh-image-skin 🦊

Image skin for the **DSH (DeepSeek Harness) web UI**: give the big regions of the interface your own
images — including a looping **video** backdrop — and stick draggable, resizable stickers onto the
sidebar and the composer. Everything is configured from a settings submenu and stays on your machine.

> 中文说明见下方 [中文](#中文说明)。

## Features

- **Per-region artwork** — window backdrop (static image, GIF, or `mp4`/`webm` video), center column,
  sidebar, welcome / empty state, right panel, composer area.
- **Per-mode artwork** — a compact sun/moon slider (in the settings page **and** beside Settings at the
  sidebar foot) switches the real DSH theme. Every area can hold a light-only image, a dark-only
  image, or one shared image; a mode-specific image wins and the shared one is the fallback.
- **Video playback rate** — one slider sets the playback speed of every video the plugin renders
  (window wallpaper and sticker videos), applied live and remembered across restarts.
- **Two draggable stickers** — anchor an image to the composer seat or the sidebar column; drag to
  move, drag the corner handle to scale. Offsets and scale are persisted in settings.
- **Panel opacity slider** — makes DSH's own surfaces translucent so the wallpaper shows through.
  The wallpaper itself is deliberately **not** dimmed by this slider.
- **Local-only storage** — uploads are written to `$DSH_HOME/image-skin/` and served back from
  `/dsh-image-skin/files/<name>`; nothing is uploaded to any third party.
- **Automatic clean-up** — files that no area references any more are collected (after every image
  change, and from the *清理未使用图片* button in the settings page).
- **Bounded uploads** — 32 MB request cap enforced while the body is read, plus a 24 MB pre-check in
  the browser with a visible error message.
- **Fully reversible** — disabling the plugin removes every style, sticker, video layer and injected
  element it added.
- **Extensible** — adding an area means one entry in the host's `IMAGE_AREAS` and one in the client's
  `AREAS`; the settings schema, upload route and submenu row follow automatically.

## Install

DSH composes its web UI from a **profile**, and `dsh plugin` is a thin passthrough to pnpm inside
that profile.

```powershell
# 1. from npm
dsh plugin --profile web add dsh-image-skin

#    ...or from a local checkout
git clone https://github.com/CHANGE-ME/dsh-image-skin.git
cd dsh-image-skin
npm install
npm run build
dsh plugin --profile web add -w .

# 2. restart the web host so the profile is recomposed
dsh --profile web --no-open

# 3. hard-refresh the browser (Ctrl+F5)
```

The bundled helper does steps 1–2 for you: `node scripts/install.mjs --profile web`
(add `--dry-run` to preview the commands it would run).

## Usage

**Settings → 图片皮肤 / Image skin.** One row per area, each with:

| Control | Meaning |
|---|---|
| Upload | image, GIF, `mp4` / `webm` (≤ 24 MB) |
| Enable | per-area on/off |
| Fill | `cover` / `contain` / `tile` (regions only) |
| 编辑位置 / Edit position | stickers only — drag to move, corner handle to scale |
| 面板不透明度 / Panel opacity | one slider for all DSH surfaces |

## Compatibility

Developed and tested against `@deepseek-ai/dsh@0.1.5-rc.1`.

DSH is a Cordis-based app: this plugin is one row in the web profile, contributing a settings
namespace (host) and a `settings.section` page (browser). Region hosts are located through
**CSS-module class-name suffixes** (`_centerCol`, `_sidebarCol`, `_hero`, `_pane`,
`_composerSeat`, …) rather than hashed prefixes, but they are still DSH internals: a release that
renames them can break region targeting. Panel translucency overrides the documented theme tokens
(`--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1/2`, `--dsw-alias-bg-overlay`,
`--dsw-specific-sidebar-fill`, `--dsw-specific-app-shell`) and nothing else.

## Development

```powershell
npm install
npm run build       # src/index.ts -> lib/index.js (ESM host half)
                    # src/client/index.ts -> lib/client.js (browser half, ModuleLoader format)
npm run watch       # rebuild on change
npm run typecheck   # tsc --noEmit
npm test            # offline host-half suite (32 assertions, no DSH process, no network)
```

`lib/` is committed on purpose — DSH loads the built halves — and `prepublishOnly` rebuilds it so a
published artifact can never drift from `src/`.

## Extending

1. add an id to `IMAGE_AREAS` in `src/index.ts` — the settings schema is generated from it;
2. add the same id and a label to `AREAS` in `src/client/index.ts`;
3. add a `REGION_SELECTORS` entry, and clean it up in `disposeSkinDom()` if it adds DOM.

## License

MIT — see [LICENSE](LICENSE).

---

## 中文说明

DSH（DeepSeek Harness）Web UI 的**通用图片皮肤插件**：只改「几个大块区域」，给窗口背景 / 中栏 /
侧边栏 / 欢迎页 / 右栏 / 输入区换上你自己的图片或视频，另外可以往侧栏和输入框贴两个能拖动、能缩放的角标。
配置全部在设置里，图片只存本机。

**特性**

- 按区域换图：窗口背景（支持 `mp4`/`webm` 循环视频）、中栏主区、侧边栏、欢迎页、右栏、输入区
- 两个角标贴图：可拖动定位、拖右下角圆点缩放，位置与缩放会存进设置
- 面板不透明度滑块：调低让 DSH 面板变半透明，透出壁纸；**壁纸本身不会被这个滑块调暗**
- 本机存储：文件落在 `$DSH_HOME/image-skin/`，不联网、不上传
- 不再被引用的旧文件会自动回收（换图/清除后触发，设置页也有「清理未使用图片」按钮）
- 单文件上限 24 MB，超出会在设置页给出明确报错
- 完全可还原：插件卸载后不会残留样式、贴图、视频层

**安装**：`dsh plugin --profile web add dsh-image-skin`，然后**重启** DSH、浏览器 `Ctrl+F5`。
本地开发用 `dsh plugin --profile web add -w .`；也可以直接跑 `node scripts/install.mjs --profile web`。

**结构**

| 文件 | 作用 |
|------|------|
| `src/index.ts` | Host 半：注册 `ui-image-skin` 设置命名空间 + 图片上传/存储/回收/服务路由 `/dsh-image-skin/*` |
| `src/client/index.ts` | 浏览器半：绑定设置、把图片贴到对应区域、注册设置二级菜单 |
| `cordis.patch.yml` | bundle patch：把插件注册进 web profile |
| `build.mjs` | 把 TS 编译成 `lib/index.js` + `lib/client.js` |
| `test/host.test.mjs` | 宿主半离线测试（路由 / 上传上限 / GC / 路径穿越） |

**扩展新区域**：`src/index.ts` 的 `IMAGE_AREAS` 加一个 id（schema 自动生成字段）→
`src/client/index.ts` 的 `AREAS` 加同 id + 标签 → 加 `REGION_SELECTORS` 并在 `disposeSkinDom()` 里清理。
其余（设置菜单、上传路由、存储、回收）自动生效。
