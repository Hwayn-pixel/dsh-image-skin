# dsh-image-skin

### Your DSH web UI — but it finally looks like *yours*.

[![npm](https://img.shields.io/npm/v/dsh-image-skin?color=4c8bf5)](https://www.npmjs.com/package/dsh-image-skin)
[![license](https://img.shields.io/npm/l/dsh-image-skin?color=black)](LICENSE)
[![tests](https://github.com/Hwayn-pixel/dsh-image-skin/actions/workflows/test.yml/badge.svg)](https://github.com/Hwayn-pixel/dsh-image-skin/actions/workflows/test.yml)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.1-6b46c1)](#compatibility)

**npm:** [`dsh-image-skin`](https://www.npmjs.com/package/dsh-image-skin) · **one-line install:** `dsh plugin --profile web add dsh-image-skin`

> ⚠️ **Desktop app (Electron) users — read this first.** Versions **≤ 0.4.1** declare the client service
> `settingsScope`, which DSH **0.2 removed**. DSH 0.2 treats a client entry that never activates as a
> **fatal boot error**, so the desktop app refuses to start:
> `web boot: 1 entry did not activate — dsh-image-skin: pending (waiting for service: settingsScope)`.
> **0.4.2 and newer are fine.** If your installer only offers 0.4.1, that is the package manager's
> *minimum release age* policy holding back the newer versions — either install with `npm`
> (`npm i dsh-image-skin@latest`), or add this to the DSH profile's `pnpm-workspace.yaml`:
> ```yaml
> minimumReleaseAgeExclude:
>   - dsh-image-skin@0.4.6
> ```
> then restart the app. (The app's own **“禁用第三方插件… / disable third-party plugins”** recovery
> button also gets you back in.)

Drop your own **images, GIFs and looping video** onto the big regions of the DeepSeek Harness web
UI, stick **draggable stickers** on the sidebar and composer, tint the whole interface with
**colours pulled from your wallpaper**, and decide how much the panels let through.
No account, no upload, no cloud — **everything stays on your machine.**

中文说明 → **[README.zh-CN.md](README.zh-CN.md)**

<img src="docs/shots/ui-nebula-light.jpg" alt="The DSH web UI over a pink nebula wallpaper: frosted panels and controls tinted to match the artwork (light theme)" />

*The plugin at work — a wallpaper behind frosted panels, with the UI's colours sampled from the
picture. Everything you see here is local: the image, the palette, the stickers.*

---

## Highlights

| | |
|---|---|
| 🖼️ **Per-region artwork** | Window backdrop, center column, sidebar, welcome/empty state, right panel, composer — each with its own image, fit mode and on/off switch. |
| 🎬 **Motion** | A looping `mp4`/`webm` as the window backdrop, GIFs anywhere, one slider for playback rate. |
| 🌗 **Light *and* dark, configured separately** | Two independent sets of artwork; flipping the theme swaps the wallpaper too, and a shared image is the fallback. |
| 🧸 **Stickers** | Two free-floating images on the sidebar and the composer — drag to move, drag the corner to scale, positions persist. |
| 🫧 **Panel translucency** | One slider makes DSH's own surfaces see-through so the wallpaper shows through — while the wallpaper itself is deliberately *not* dimmed. |
| 🎨 **Colour from your picture** | The interface stops looking grey: buttons, inputs, dialogs and rails are painted with a single hue sampled from your wallpaper (a real frame, even for video) and every step is contrast-checked. |
| ✨ **Optional AI ornament** | A separate switch asks a text-to-image model for a real ornamental frame and wears it as a panel frame — any OpenAI-compatible API, key stays local. |
| 🪶 **Smooth, and it stays smooth** | Big DOM, long conversation — the cross-fade only animates what a compositor can, and stops touching text colour when the tree gets heavy. |
| 🔒 **Local-only, and reversible** | Files live in `$DSH_HOME/image-skin/`. Disable the plugin and every style, sticker and video layer it added goes away. |

## Why this one

There are several plugins in this space, and most of them do the same thing: take one picture and
generate a colour palette from it. This one takes the opposite approach — **you place artwork
exactly where you want it** — and does a few things the others do not:

- **Artwork, not just a palette.** A window backdrop, a sidebar image, a sticker you can drag — these
  are first-class here. (A single auto-picked colour scheme is *not* what this is.)
- **The whole scheme from one hue.** The sampler's colours are reduced to a single hue; every role
  (hairline / ink / surface) is derived from it and contrast-checked, so the UI *harmonises* instead
  of clashing. The **depth slider** only decides how deeply the colour is laid on
  (淡 / 标准 / 浓 / 呼吸), never *what* gets drawn.
- **Built for the long haul.** Other implementations stutter on a long conversation; this one only
  animates compositor-friendly properties and drops text-colour work on heavy trees.
- **Reversible by design.** Turn it off and nothing is left behind.

<img src="docs/shots/ui-fjord-light.jpg" alt="The same UI over a blue fjord wallpaper — the frosted panels and palette follow the new picture" />

*Same interface, another wallpaper — panels, hairlines and ink all re-derive from the new picture.*

## Install

DSH composes its web UI from a **profile**, and `dsh plugin` is a thin passthrough to pnpm inside
that profile.

```powershell
# 1. from npm
dsh plugin --profile web add dsh-image-skin

#    ...or from a local checkout
git clone https://github.com/Hwayn-pixel/dsh-image-skin.git
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

**Settings → 图片皮肤 / Image skin.** Two levels:

*Level one — choose a workbench.* 「贴图」edits artwork; 「AI 纹样」decorates the skeleton. The AI
entry stays **locked until the window region has an image**, because the ornament samples its
colours from that image; and it raises a short pre-flight notice when you go in (five lines about
what leaves the machine, what costs money, and what stays local) — 不再显示 silences it for good.

*贴图 / Images* — one screen:

- **正在编辑 / Editing** — a segmented control for 浅色模式 / 深色模式, i.e. *which set of images you
  are editing*. Flipping it also flips the live theme, so you configure what you see.
- **界面区域 / Regions** and **角标贴图 / Stickers** — one card per area: thumbnail, name, where
  its artwork comes from (`浅色专用` / `两模式共用` / `未设置`), and its controls.
- **全局效果 / Global** — panel opacity, video playback rate.
- **存储 / Storage** — `清理未使用图片` collects stored files no area references any more.

*AI 纹样 / AI ornament* — the colour-depth slider (0 = a single hairline … 4 = deepest), the three
colour routes (wash / marks / duo), the sampled palette and material read, plus the generator:
provider, key, count, size, style, a prompt preview, and the wall of results.

| Control | Meaning |
|---|---|
| Upload | image, GIF, `mp4` / `webm` (≤ 24 MB) |
| Shared image | one image used by both modes unless a mode overrides it |
| 启用 | per-area on/off |
| 填充 | `cover` / `contain` / `tile` (regions only) |
| 编辑位置 | stickers only — drag to move, corner handle to scale |
| 面板不透明度 | one slider for all DSH surfaces |

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
npm test            # offline host-half suite (68 assertions, no DSH process, no network)
npm run demo:provider   # fake image API on 127.0.0.1:8899 — exercise the AI ornament flow with no key
```

`lib/` is committed on purpose — DSH loads the built halves — and `prepublishOnly` rebuilds it so a
published artifact can never drift from `src/`.

### Trying the AI ornament without a key

`tools/demo-provider.mjs` is a dependency-free stand-in for a text-to-image service: it answers
`POST /v1/images/generations` with an ornament drawn locally from the colours in the prompt, so the
whole chain (prompt → generate → wall → apply) can be tested offline.

```powershell
npm run demo:provider          # http://127.0.0.1:8899/v1
```

Then 设置 → 图片皮肤 → AI 纹样 → 服务商 `自定义（OpenAI 兼容）`, Base URL `http://127.0.0.1:8899/v1`,
模型 ID `demo`, Key 任意, and press 生成装饰. The same route is covered headlessly: the offline
suite drives `/providers`, `/prompt` and `/gen` with a scripted `fetch`, including the failure
branches (bad provider, missing key, non-JSON reply, 401, unreachable host).

## Extending

1. add an id to `IMAGE_AREAS` in `src/index.ts` — the settings schema is generated from it;
2. add the same id and a label to `AREAS` in `src/client/index.ts`;
3. add a `REGION_SELECTORS` entry, and clean it up in `disposeSkinDom()` if it adds DOM.

## A note on maintenance 🐢

This is a **student side-project**. I build it in the gaps between classes and coursework, so
replies and fixes can be slow — please bear with me.

That said: **issues, ideas and pull requests are genuinely welcome**, and I read every one.
If you enjoy the plugin, a ⭐ helps a lot — it tells me the thing is worth coming back to.

## Credits / 图片致谢

The gallery images are not part of the plugin; they are licensed wallpapers used to illustrate the
docs.

<img src="docs/gallery/gallery.jpg" alt="Four licensed wallpapers" />

| File | Author | License |
|---|---|---|
| `01-aurora-lyngen.jpg` — *Aurora borealis above Storfjorden and the Lyngen Alps in moonlight* | Ximonic | CC BY-SA 3.0 |
| `02-milkyway-la-silla.jpg` — *Milky Way Arching Over La Silla* | P. Horálek / ESO | CC BY 4.0 |
| `03-winter-night-moon.jpg` — *Winter night in mountains with moon* | Maciej Kraus | CC BY 2.0 |
| `04-misty-lake-sunrise.jpg` — *Misty Morning Sunrise, Lake Andes NWR* | USFWS | Public domain |

All four were retrieved from Wikimedia Commons and resized; only the resized copies live in this
repository.

## Authors / 作者

- **Hwayn**（幻弈）— *author* / 作者：设计、实现与主要代码。
- **Yucheng Xiao**（肖宇成）— *contributor* / 协作者：方向、需求、测试，以及让这个项目得以公开。

## License

MIT — see [LICENSE](LICENSE).
