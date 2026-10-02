# dsh-image-skin

### 把 DSH 的界面，变成**你自己的样子**。

[![npm](https://img.shields.io/npm/v/dsh-image-skin?color=4c8bf5)](https://www.npmjs.com/package/dsh-image-skin)
[![license](https://img.shields.io/npm/l/dsh-image-skin?color=black)](LICENSE)
[![tests](https://github.com/Hwayn-pixel/dsh-image-skin/actions/workflows/test.yml/badge.svg)](https://github.com/Hwayn-pixel/dsh-image-skin/actions/workflows/test.yml)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.1-6b46c1)](#兼容性)

**npm：** [`dsh-image-skin`](https://www.npmjs.com/package/dsh-image-skin) · **一行安装：** `dsh plugin --profile web add dsh-image-skin`

把**你自己的图片、GIF、循环视频**铺到 DeepSeek Harness 网页版的各个区域上，在侧栏和输入框上贴**可拖动的角标**，
让界面**跟着壁纸的颜色**一起变，再决定面板要让出多少透明。
不要账号、不上传、不联网 —— **所有东西都留在你这台机器上。**

English → **[README.md](README.md)**

<img src="docs/shots/ui-nebula-light.jpg" alt="DSH 网页版铺在粉色星云壁纸上：磨砂面板与控件被染成画面的颜色（浅色模式）" />

*插件在用的样子 —— 壁纸在磨砂面板后面，界面的颜色是从这张图里取的。你看到的一切都是本机的：图、色板、角标。*

---

## 它做什么

| | |
|---|---|
| 🖼️ **按区域贴图** | 整窗口底图、中心列、侧栏、欢迎页、右面板、输入框 —— 各自独立配图、各自选填充方式、各自可开关。 |
| 🎬 **动起来** | 窗口底图能用循环 `mp4` / `webm`，任何区域都能用 GIF；一个滑块统管所有视频的播放速率。 |
| 🌗 **浅色 / 深色分开配** | 两套独立的图；切主题时壁纸跟着换，没单独配的区域回退到「通用图」。 |
| 🧸 **角标贴图** | 侧栏和输入框上各一张自由漂浮的图 —— 拖动挪位置、拖角缩放，位置会记住。 |
| 🫧 **面板透明度** | 一个滑块让 DSH 自己的面板透出背景 —— 而**壁纸本身不会被压暗**（这点是刻意的）。 |
| 🎨 **界面跟着画面配色** | 按钮、输入框、弹窗、轨道不再是灰的：从你的壁纸里取一个色相（视频也能取真帧），逐级做对比度校验后染上去。深浅档位**无级可调**。 |
| 🪶 **流畅，且能一直流畅** | 长对话、大 DOM 也不卡：过渡只走合成器能处理的属性，树太重时停掉文字颜色的活儿。 |
| 🔒 **纯本机、可完全撤销** | 文件放在 `$DSH_HOME/image-skin/`。关掉插件，它加过的每一处样式、角标和视频层都会消失。 |

> **曾经有过、现在没有的功能：** 早期版本试过「让生图模型画一圈花纹边框」（AI 纹样）。
> 这条路我们走了一遍、也公开上线过，最后判断**效果不好**（花纹在 30px 的小按钮上会变成色块打架），
> 界面入口已经撤掉。代码留在 git 历史里（`e19c633` / `34c3002` / `b66006e`），**这一版不做这件事。**
> 现在这一页只做一件事：**取色、配色**。

## 为什么用它

同类插件不少，大多做同一件事：拿一张图，生成一套配色。这个插件反过来 ——
**图放哪儿、放多大、透多少，由你说了算** —— 并且多做了几件别人没做的事：

- **要的是"贴图"，不只是"配色"。** 整窗底图、侧栏图、能拖的角标，在这里都是一等公民。
- **一套配色从一个色相长出来。** 取色器把画面收敛成**一个色相**，每个角色
  （细线 / 文字 / 面）都由它推出来并做对比度校验，所以界面是**和画面和声**，不是打架。
  **深浅滑块**只决定这个颜色铺多深（淡 / 标准 / 浓 / 呼吸），**不改变画什么**。
- **为长时间用而做。** 别的实现在长对话里会卡；这个只动画合成器友好的属性。
- **可撤销是设计的一部分。** 关掉就什么都不剩。

<img src="docs/shots/ui-fjord-light.jpg" alt="同一个界面换一张蓝色峡湾壁纸：磨砂面板与配色跟着新图重算" />

*同一个界面，换一张壁纸 —— 面板、细线、文字色全部从新图重算。*

## 安装

DSH 的网页界面由 **profile** 组装，`dsh plugin` 是这个 profile 里 pnpm 的一层薄封装。

```powershell
# 1. 从 npm 装
dsh plugin --profile web add dsh-image-skin

#    ……或者从本地检出装
git clone https://github.com/Hwayn-pixel/dsh-image-skin.git
cd dsh-image-skin
npm install
npm run build
dsh plugin --profile web add -w .

# 2. 重启 web 宿主，让 profile 重新组装
dsh --profile web --no-open

# 3. 浏览器硬刷新（Ctrl+F5）
```

仓库里带了个小工具帮你做第 1–2 步：`node scripts/install.mjs --profile web`
（加 `--dry-run` 只打印它要跑的命令）。

> ⚠️ **桌面端（Electron）用户先看这段。** **≤ 0.4.1** 的版本声明了客户端服务
> `settingsScope`，而 DSH **0.2 已经删掉了它**。DSH 0.2 把"客户端条目始终没激活"当**致命启动错误**，
> 于是桌面端会直接起不来：
> `web boot: 1 entry did not activate — dsh-image-skin: pending (waiting for service: settingsScope)`。
> **0.4.2 及以后都正常。** 如果你的安装器一直给你 0.4.1，请**点名要版本号** —— 钉住版本可以绕开发布年龄策略：
> ```
> dsh plugin --profile web add dsh-image-skin@0.4.8     # 或：pnpm add dsh-image-skin@0.4.8
> ```
> **在桌面端的插件安装框里，也请照样输入 `dsh-image-skin@0.4.8`，别只填包名。**
> 只填包名等于给一个*范围*：pnpm 的 `minimumReleaseAge`（默认**一周**）只会自动挑那么旧的版本，
> 于是它会悄悄装上很老的版本（实测：`0.3.0`），或者在你要求的范围太新时报
> `The latest release of dsh-image-skin is …`。**点名 `包名@版本` 不受这条限制。**
>
> **"我就要最新的"** —— 直接走官方源（国内镜像会滞后几分钟）：
> ```
> npm i dsh-image-skin@latest --registry=https://registry.npmjs.org/
> ```
> （`npm` 没有发布年龄策略，裸包名在它那里没问题。）
> （桌面端那个 **「禁用第三方插件…」** 的恢复按钮也能把你救回来。）

## 用法

**设置 → 图片皮肤。** 两块，可以分开用：

**「贴图」** —— 换画面：

- **正在编辑** —— 一个分段控件，选 浅色模式 / 深色模式，也就是*你现在在配哪一套图*。
  切换时界面主题会跟着切，方便边配边看。
- **界面区域** 和 **角标贴图** —— 每个区域一张卡：缩略图、名字、这张图的来源
  （`浅色专用` / `两模式共用` / `未设置`），以及它的控件。
- **全局效果** —— 面板不透明度、视频播放速率。
- **存储** —— `清理未使用图片`：把不再被任何区域引用的文件收掉。

**「配色」** —— 让界面跟着画面变（**要先进「贴图」给「窗口」放一张图**，颜色是从那张图里取的）：

- **深浅档位（0 – 4，无级）** —— 0 最淡（只描一圈细线），往上逐级加深，并跟着画面里的光走；
  拖动时**立刻**在界面上看到结果。
- **配色强度** —— 三条路线，差别一眼可见：
  - `整屏染色` —— 每个面都带色，描边到处都有，像被泡在颜色里；
  - `只染三处` —— 面保持中性，只有选中项 / 焦点框 / 一条分隔线有色；
  - `双声部` —— 面借主色，交互色用画面里的**第二个**色相。
- **取自壁纸** —— 直接给你看取到的那几个颜色，以及识别出的材质（天空 / 纸 / 木 / 水 / 霓虹）。

| 控件 | 含义 |
|---|---|
| 上传 | 图片、GIF、`mp4` / `webm`（≤ 24 MB） |
| 通用图 | 两个模式共用一张，除非某个模式单独覆盖 |
| 启用 | 按区域开关 |
| 填充 | `cover` / `contain` / `tile`（区域用） |
| 编辑位置 | 角标用 —— 拖动挪位置，拖角缩放 |
| 面板不透明度 | 一个滑块管所有 DSH 面板 |

全部取色与配色**在本机完成**：不联网、不花钱、不需要 key。

## 兼容性

开发与测试环境：`@deepseek-ai/dsh@0.1.5-rc.1`。

DSH 是一个基于 Cordis 的应用：这个插件是 web profile 里的一行，向宿主贡献一个设置命名空间、
向浏览器贡献一个 `settings.section` 页面。区域宿主是靠 **CSS-module 类名后缀**定位的
（`_centerCol`、`_sidebarCol`、`_hero`、`_pane`、`_composerSeat`……），不是靠哈希前缀；
但它们仍然是 DSH 的内部结构：某个版本改了这些名字，区域定位就会失效。
面板透明只覆盖文档里写明的主题 token
（`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2`、`--dsw-alias-bg-overlay`、
`--dsw-specific-sidebar-fill`、`--dsw-specific-app-shell`），别的都不碰。

## 开发

```powershell
npm install
npm run build       # src/index.ts -> lib/index.js（ESM 宿主半）
                    # src/client/index.ts -> lib/client.js（浏览器半，ModuleLoader 格式）
npm run watch       # 改动即重建
npm run typecheck   # tsc --noEmit
npm test            # 离线测试：宿主半 99 条 + 客户端单元 38 条，不需要 DSH 进程、不需要网络
```

`lib/` 是**特意提交进仓库**的 —— DSH 加载的就是构建产物；`prepublishOnly` 会在发布前重建，
所以发出去的包不会和 `src/` 脱节。

## 扩展

1. 在 `src/index.ts` 的 `IMAGE_AREAS` 里加一个 id —— 设置 schema 由它生成；
2. 在 `src/client/index.ts` 的 `AREAS` 里加同样的 id 和标签；
3. 在 `REGION_SELECTORS` 里加一条，如果它要加 DOM，记得在 `disposeSkinDom()` 里清掉。

## 关于维护 🐢

这是一个**学生业余项目**。我是在上课和课业的缝里做它的，所以回复和修复可能慢 —— 请多包涵。

不过：**issue、点子和 PR 都是真心欢迎的**，每一条我都会看。
如果你喜欢这个插件，一个 ⭐ 很有用 —— 它告诉我这件事值得继续做下去。

## Credits / 图片致谢

画廊里的图片不属于插件本体，是用来给文档配图的授权壁纸。

<img src="docs/gallery/gallery.jpg" alt="四张授权壁纸" />

| 文件 | 作者 | 许可 |
|---|---|---|
| `01-aurora-lyngen.jpg` — *Aurora borealis above Storfjorden and the Lyngen Alps in moonlight* | Ximonic | CC BY-SA 3.0 |
| `02-milkyway-la-silla.jpg` — *Milky Way Arching Over La Silla* | P. Horálek / ESO | CC BY 4.0 |
| `03-winter-night-moon.jpg` — *Winter night in mountains with moon* | Maciej Kraus | CC BY 2.0 |
| `04-misty-lake-sunrise.jpg` — *Misty Morning Sunrise, Lake Andes NWR* | USFWS | Public domain |

四张都取自 Wikimedia Commons 并做过缩放；仓库里只放缩放后的副本。

## Authors / 作者

- **Hwayn**（幻弈）— *author* / 作者：设计、实现与主要代码。
- **Yucheng Xiao**（肖宇成）— *contributor* / 协作者：方向、需求、测试，以及让这个项目得以公开。

## License

MIT —— 见 [LICENSE](LICENSE)。
