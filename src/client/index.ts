/**
 * dsh-image-skin — Browser half.
 *
 * Binds the `ui-image-skin` settings namespace, applies configured images to
 * their UI regions / sticker anchors, and registers the settings submenu card.
 *
 * Region selectors target DSH's CSS-module class *suffixes* (e.g. `_centerCol`)
 * rather than hashed prefixes, so they survive DSH rebuilds while local names hold.
 */
import * as React from "react";

const NS = "ui-image-skin";
const ROUTE_PREFIX = "/dsh-image-skin";
const BODY_ATTR = "data-dsh-image-skin";
const PANEL_STYLE_ID = "dsh-image-skin-panel";
const IMG_ALPHA_VAR = "--dsh-skin-img-opacity";
/** Keep in step with MAX_UPLOAD_BYTES (32 MB base64 envelope) in the host half. */
const MAX_UPLOAD_MB = 24;

export const inject = ["slots", "settingsScope", "theme"];

type Mode = "light" | "dark";

interface ThemeFace {
  getTheme(): { active: { colorScheme: Mode } };
  setTheme(id: string): void;
}

/** Live editor state shared between the React section and the non-React renderer. */
let currentEditing: string | null = null;
let reapply: (() => void) | null = null;
/** Re-run the accent with a patched value but WITHOUT writing settings - live slider previews. */
let reapplyWith: ((patch: Record<string, unknown>) => void) | null = null;
/** Re-stamp the accent on newly appeared chrome (dialogs, menus, popovers). */
let refreshAccent: (() => void) | null = null;
let finishButton: HTMLElement | null = null;

interface Snapshot<T> {
  status: "loading" | "ready" | "unavailable";
  value: T | undefined;
}
interface Scope<T> {
  getSnapshot(): Snapshot<T>;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<void>;
  unset(field: string): Promise<void>;
}
interface ClientContext {
  effect(fn: () => (() => void) | void, label?: string): unknown;
  on?(event: string, listener: () => void): unknown;
  settingsScope: { bind<T>(spec: { namespace: string }): Scope<T> };
  slots: {
    inject(slot: string, fn: () => unknown): unknown;
    register(options: Record<string, unknown>, component: unknown): unknown;
  };
  theme?: ThemeFace;
  layout?: { selectPanel?: (id: string | null) => void };
}

type SkinValue = Record<string, unknown>;

interface AreaDef {
  id: string;
  label: string;
  hint: string;
  kind: "region" | "sticker";
  sel?: string;
  corner?: "top" | "bl" | "br" | "tr" | "tl";
}

/** Region + sticker registry — keep ids in sync with IMAGE_AREAS in src/index.ts */
const AREAS: AreaDef[] = [
  { id: "window", label: "窗口背景", hint: "整个窗口的底层背景（含左栏）", kind: "region" },
  { id: "center", label: "中栏主区", hint: "对话显示区域", kind: "region" },
  { id: "sidebar", label: "侧边栏", hint: "左栏，适合竖版图", kind: "region" },
  { id: "welcome", label: "欢迎页大图", hint: "新会话空状态", kind: "region" },
  { id: "rightbar", label: "右栏面板", hint: "右侧面板背景", kind: "region" },
  { id: "composer", label: "输入区", hint: "底部输入框所在区域", kind: "region" },
  {
    id: "stickerComposer",
    label: "输入框上侧角标",
    hint: "贴在输入框上方的小贴图",
    kind: "sticker",
    sel: '[class*="_composerSeat"]',
    corner: "top",
  },
  {
    id: "stickerSidebar",
    label: "侧栏底部角标",
    hint: "贴在左栏底部的小贴图",
    kind: "sticker",
    sel: '[class*="_sidebarCol"]',
    corner: "bl",
  },
];

const REGION_SELECTORS: Record<string, string[]> = {
  center: ['[class*="_centerCol"]', "main", '[role="main"]'],
  sidebar: ['[class*="_sidebarCol"]', '[role="tree"]'],
  welcome: ['[class*="_hero"]'],
  rightbar: ['section[class*="_pane"]', '[class*="_panelBody"]'],
  composer: ['[class*="_composerSeat"]'],
};

const STYLE_ID = "dsh-image-skin-styles";
/**
 * Bumped by every apply(). A cleanup from an older instance must not tear down DOM that a
 * newer instance just installed - see the guard in apply().
 */
let applyGeneration = 0;
/** Marks the brief window in which colour-bearing properties transition (theme cross-fade). */
const THEME_ANIM_ATTR = "data-dsh-skin-theme-anim";
const THEME_ANIM_MS = 320;
/** Temporary layer used to cross-fade one wallpaper into the next. */
const WALL_FADE_ID = "dsh-image-skin-wall-fade";

function ensureBaseStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    // ── shell ──────────────────────────────────────────────────────────────────
    ".dshImgSkin-shell{display:flex;flex-direction:column;gap:14px;padding:2px 0 20px}",
    ".dshImgSkin-intro{font-size:12px;line-height:1.6;opacity:.85;margin:0}",
    ".dshImgSkin-banner{font-size:12px;line-height:1.5;border-radius:8px;padding:7px 11px;margin:0;",
    "background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 12%,transparent);",
    "color:var(--dsw-alias-state-error-primary,#d9534f)}",
    ".dshImgSkin-ok{font-size:12px;opacity:.72;margin:0}",

    // ── section card ──────────────────────────────────────────────────────────
    ".dshImgSkin-card{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.26));border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.05);",
    "background:var(--dsw-alias-bg-layer-1,transparent);padding:14px 16px;display:flex;flex-direction:column;gap:12px}",
    ".dshImgSkin-cardhead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}",
    ".dshImgSkin-title{font-weight:600;font-size:13.5px;letter-spacing:.2px}",
    ".dshImgSkin-sub{font-size:11.5px;line-height:1.55;opacity:.84;margin:3px 0 0}",
    ".dshImgSkin-hint{font-size:11.5px;line-height:1.55;opacity:.85;display:block;margin-top:3px}",

    // ── segmented control (mode filter) ───────────────────────────────────────
    ".dshImgSkin-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;",
    "background:color-mix(in srgb,currentColor 9%,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22))}",
    ".dshImgSkin-seg>button{cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;",
    "padding:5px 13px;border-radius:8px;display:inline-flex;align-items:center;gap:6px;opacity:.66;transition:background .15s,opacity .15s}",
    ".dshImgSkin-seg>button:hover{opacity:.9}",
    ".dshImgSkin-seg>button[data-on='true']{opacity:1;font-weight:600;color:rgb(var(--dsh-skin-accent-ink,255,255,255)) !important;background:rgba(var(--dsh-skin-accent,90,167,216),.9) !important;",
    "box-shadow:0 1px 2px rgba(0,0,0,.10)}",

    // ── area grid ─────────────────────────────────────────────────────────────
    ".dshImgSkin-areas{display:flex;flex-direction:column;gap:10px}",
    ".dshImgSkin-area{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px 14px;align-items:center;",
    "border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:12px;padding:10px 12px;",
    "background:var(--dsw-alias-bg-layer-1,transparent);transition:border-color .15s,background .15s}",
    ".dshImgSkin-area>.dshImgSkin-thumb,.dshImgSkin-area>.dshImgSkin-thumblet{grid-row:1 / span 2}",
    ".dshImgSkin-area:hover{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.34))}",
    ".dshImgSkin-area[data-off='true']{opacity:.5}",
    ".dshImgSkin-area[data-editing='true']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
    "box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#5aa7d8) inset}",
    ".dshImgSkin-thumb{width:96px;height:56px;object-fit:cover;border-radius:8px;display:block;",
    "border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));background:color-mix(in srgb,currentColor 6%,transparent)}",
    ".dshImgSkin-thumblet{position:relative;width:96px;height:56px;border-radius:8px;display:grid;place-items:center;",
    "border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.32));font-size:10.5px;opacity:.5}",
    ".dshImgSkin-met{display:flex;flex-direction:column;gap:2px;min-width:0}",
    ".dshImgSkin-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px}",
    ".dshImgSkin-src{font-size:11px;opacity:.76;line-height:1.5}",
    ".dshImgSkin-tag{font-size:10px;font-weight:500;padding:1px 6px;border-radius:99px;letter-spacing:.2px;",
    "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));opacity:.8}",
    ".dshImgSkin-tag[data-kind='mode']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
    "color:var(--dsw-alias-brand-primary,#5aa7d8);opacity:1}",
    ".dshImgSkin-tag[data-kind='none']{opacity:.45}",
    ".dshImgSkin-ops{grid-column:1 / -1;display:flex;gap:6px;align-items:center;flex-wrap:wrap}",

    // ── controls ──────────────────────────────────────────────────────────────
    ".dshImgSkin-btn{cursor:pointer;padding:5px 11px;border-radius:8px;font:inherit;font-size:12px;",
    "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;white-space:nowrap;",
    "transition:background .15s,border-color .15s}",
    ".dshImgSkin-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}",
    ".dshImgSkin-btn[disabled]{opacity:.5;cursor:not-allowed}",
    ".dshImgSkin-btn[data-active='true']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);color:var(--dsw-alias-brand-primary,#5aa7d8)}",
    ".dshImgSkin-btn[data-variant='primary']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);color:var(--dsw-alias-brand-primary,#5aa7d8);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5aa7d8) 10%,transparent)}",
    ".dshImgSkin-btn[data-variant='quiet']{border-color:transparent;opacity:.7}",
    ".dshImgSkin-btn[data-variant='quiet']:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}",
    ".dshImgSkin-switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;opacity:.85;cursor:pointer;user-select:none;white-space:nowrap}",
    ".dshImgSkin-switch input{flex:0 0 auto}",
    ".dshImgSkin-slider{display:flex;flex-direction:column;gap:6px}",
    ".dshImgSkin-slider input[type=range]{width:100%;margin:0}",
    ".dshImgSkin-sliderhead{display:flex;justify-content:space-between;align-items:center;gap:12px}",
    ".dshImgSkin-value{font-size:12px;font-variant-numeric:tabular-nums;opacity:.75}",
    ".dshImgSkin-range{width:100%;margin:2px 0 0;accent-color:rgb(var(--dsh-skin-accent,90,167,216));height:14px;opacity:.85}",
    ".dshImgSkin-range:disabled{opacity:.45}",
    ".dshImgSkin-ticks{display:flex;justify-content:space-between;gap:4px;margin-top:-2px}",
    ".dshImgSkin-tickBtn{cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;font-size:11px;",
    "opacity:.5;padding:2px 6px;border-radius:6px;white-space:nowrap}",
    ".dshImgSkin-tickBtn:hover{opacity:.85}",
    ".dshImgSkin-tickBtn[data-on='true']{opacity:1;font-weight:600;color:rgb(var(--dsh-skin-accent,90,167,216))}",
    ".dshImgSkin-tickBtn:disabled{cursor:default;opacity:.3}",
    ".dshImgSkin-accentCaption{font-size:12px;line-height:1.6;min-height:20px;",
    "transition:opacity .14s ease;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px}",
    ".dshImgSkin-accentCaption[data-visible='false']{opacity:0}",
    ".dshImgSkin-accentLevel{font-weight:600;opacity:.9}",

    // ── level one: the choice screen ──────────────────────────────────────────
    ".dshImgSkin-nav{display:flex;align-items:center;gap:10px}",
    ".dshImgSkin-navTitle{font-size:13.5px;font-weight:600}",
    ".dshImgSkin-entries{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}",
    ".dshImgSkin-entry{display:flex;flex-direction:column;gap:5px;text-align:left;cursor:pointer;font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:14px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,transparent);transition:border-color .15s,background .15s}",
    ".dshImgSkin-entry:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
    "background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}",
    ".dshImgSkin-entry:disabled{opacity:.5;cursor:not-allowed}",
    ".dshImgSkin-entryTop{display:flex;align-items:center;justify-content:space-between;gap:10px}",
    ".dshImgSkin-entryTitle{font-size:14px;font-weight:600}",
    ".dshImgSkin-entryGo{font-size:11.5px;opacity:.68;white-space:nowrap}",
    ".dshImgSkin-entrySub{font-size:11.5px;line-height:1.6;opacity:.78}",
    ".dshImgSkin-lock{font-size:11px;line-height:1.5;opacity:.75;color:var(--dsw-alias-state-warn-primary,#c9881f)}",

    // ── the pre-flight notice ─────────────────────────────────────────────────
    ".dshImgSkin-modal{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;",
    "background:rgba(0,0,0,.46)}",
    ".dshImgSkin-modalCard{width:100%;max-width:520px;max-height:78vh;overflow:auto;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));box-shadow:0 18px 48px rgba(0,0,0,.3)}",
    ".dshImgSkin-modalTitle{font-size:15px;font-weight:700}",
    ".dshImgSkin-modalList{margin:0;padding-left:20px;font-size:12.5px;line-height:1.8;opacity:.85}",
    ".dshImgSkin-modalActions{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:4px}",
    ".dshImgSkin-modalDismiss{cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;",
    "opacity:.55;padding:2px 6px;text-decoration:underline;text-underline-offset:3px}",
    ".dshImgSkin-modalDismiss:hover{opacity:.9}",

    // ── round two: readable surfaces, a sticky way back, and entry state ────
    // The panel-opacity slider makes DSH's own tokens translucent - that is the point out in the
    // app, but inside these screens it turned every card into frosted glass over a wallpaper, and
    // the settings page became the hardest page to read in the product. `--dsh-img-skin-surface`
    // is an opaque colour of the current scheme, so our own screen stays legible.
    ".dshImgSkin-card,.dshImgSkin-entry,.dshImgSkin-area,.dshImgSkin-tipCard{",
    "background-color:var(--dsh-img-skin-surface,var(--dsw-alias-bg-layer-1,transparent))}",
    ".dshImgSkin-nav{position:sticky;top:-1px;z-index:6;",
    "background-color:var(--dsh-img-skin-surface,var(--dsw-alias-bg-layer-1,transparent));",
    "box-shadow:0 1px 0 var(--dsw-alias-border-l1,rgba(128,128,128,.16))}",
    ".dshImgSkin-chev{font-size:17px;line-height:1;opacity:.32}",
    ".dshImgSkin-entry[data-ready='true']:hover .dshImgSkin-chev{opacity:.65}",
    ".dshImgSkin-entryStatus{font-size:11.5px;line-height:1.6;opacity:.8}",
    ".dshImgSkin-tag[data-kind='count']{margin-left:6px;opacity:.6}",
    ".dshImgSkin-tag[data-kind='tip']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
    "color:var(--dsw-alias-brand-primary,#5aa7d8);opacity:1;margin-left:6px}",
    ".dshImgSkin-tipTitle{font-size:12.5px;font-weight:600}",
    ".dshImgSkin-swatch{width:15px;height:15px;border-radius:5px;display:inline-block;box-sizing:border-box;",
    "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.5));box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}",
    ".dshImgSkin-swatchRow{display:flex;flex-direction:column;gap:4px}",
    ".dshImgSkin-swatchRow .dshImgSkin-hint{margin-top:0}",
    ".dshImgSkin-field{display:grid;grid-template-columns:78px minmax(0,1fr);gap:6px 10px;align-items:start}",
    ".dshImgSkin-fieldLabel{font-size:12px;opacity:.68;padding-top:6px}",
    ".dshImgSkin-fieldBody{display:flex;flex-direction:column;gap:4px;min-width:0}",
    ".dshImgSkin-input{cursor:pointer;padding:5px 9px;border-radius:8px;font:inherit;font-size:12.5px;width:100%;",
    "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);",
    "color:inherit}",
    ".dshImgSkin-input:disabled{opacity:.55;cursor:default}",
    ".dshImgSkin-inputNarrow{width:auto;min-width:88px}",
    ".dshImgSkin-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    ".dshImgSkin-promptBox{font-size:11px;line-height:1.6;opacity:.7;padding:8px 10px;border-radius:8px;",
    "background:color-mix(in srgb,currentColor 6%,transparent);word-break:break-word}",
    ".dshImgSkin-textarea{cursor:text;resize:vertical;min-height:76px;line-height:1.6;font-size:12px}",
    ".dshImgSkin-frameCell{display:flex;flex-direction:column;gap:3px;align-items:center}",
    ".dshImgSkin-frameOps{justify-content:center;font-size:11px}",
    ".dshImgSkin-framePreview{width:96px;height:60px;object-fit:cover;border-radius:8px;",
    "border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3))}",
    ".dshImgSkin-frameKnobs{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}",
    ".dshImgSkin-results{display:flex;gap:8px;flex-wrap:wrap}",
    ".dshImgSkin-result{cursor:pointer;padding:0;border-radius:10px;overflow:hidden;",
    "border:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;line-height:0}",
    ".dshImgSkin-result:hover{border-color:var(--dsw-alias-brand-primary,#5aa7d8)}",
    ".dshImgSkin-result[data-on='true']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
    "box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#5aa7d8)}",
    ".dshImgSkin-result img{width:118px;height:74px;object-fit:cover;display:block}",
    ".dshImgSkin-fit{display:inline-flex;align-items:center;gap:5px}",
    ".dshImgSkin-fitlabel{font-size:11.5px;opacity:.76}",
    "[data-dsh-skin-editing='true']{outline:2px dashed var(--dsw-alias-brand-primary,#5aa7d8);outline-offset:2px}",

    // Theme switch: for one short window the palette transitions instead of snapping.
    //
    // background-color / color / border-color are *not* compositor properties: the browser
    // recalculates style and repaints every frame the transition runs. Animating "every
    // element" is therefore fine on a short screen and hopeless on a long conversation, so
    // there are two scopes and startThemeAnimation() picks one by DOM size:
    //   full — body + every descendant (small documents);
    //   lite — body + the big surfaces only, so the panels melt while the thousands of inner
    //          nodes snap instead of dragging the whole frame rate down with them.
    // `fill`/`stroke` are redundant (icons inherit `currentColor`), shadows barely differ
    // between the two palettes, and pseudo-elements doubled the matched-element count.
    `body[${THEME_ANIM_ATTR}="full"],body[${THEME_ANIM_ATTR}="full"] *{`,
    "transition-property:background-color,color,border-color !important;",
    `transition-duration:${THEME_ANIM_MS}ms !important;`,
    "transition-timing-function:cubic-bezier(.4,0,.2,1) !important;",
    "transition-delay:0s !important;}",
    // Large DOM: backgrounds only. Animating `color` on these containers repaints every
    // descendant that inherits `currentColor` (thousands of icons and labels), which is the
    // stutter users feel. A fading background carries almost all of the perceived smoothness;
    // text snapping a beat earlier is not something the eye catches.
    `body[${THEME_ANIM_ATTR}="lite"],`,
    `body[${THEME_ANIM_ATTR}="lite"] [class*="_sidebarCol"],`,
    `body[${THEME_ANIM_ATTR}="lite"] [class*="_centerCol"],`,
    `body[${THEME_ANIM_ATTR}="lite"] [class*="_pane"],`,
    `body[${THEME_ANIM_ATTR}="lite"] [class*="_panelBody"],`,
    `body[${THEME_ANIM_ATTR}="lite"] [class*="_composerSeat"],`,
    `body[${THEME_ANIM_ATTR}="lite"] [class*="_hero"]{`,
    "transition-property:background-color,border-color !important;",
    `transition-duration:${THEME_ANIM_MS}ms !important;`,
    "transition-timing-function:cubic-bezier(.4,0,.2,1) !important;",
    "transition-delay:0s !important;}",
    // Users who ask for reduced motion get a plain switch.
    `@media (prefers-reduced-motion:reduce){body[${THEME_ANIM_ATTR}],body[${THEME_ANIM_ATTR}] *{transition:none !important}}`,
  ].join("");
  document.head.append(style);
}

function fitProps(fit: string): { size: string; repeat: string } {
  if (fit === "contain") return { size: "contain", repeat: "no-repeat" };
  if (fit === "tile") return { size: "auto", repeat: "repeat" };
  return { size: "cover", repeat: "no-repeat" };
}

// ── light / dark aware resolution ───────────────────────────────────────────

/**
 * Current UI scheme. The theme service is authoritative (`theme/change` keeps us in
 * sync when the user switches from DSH's own Appearance setting); the body flag is
 * only a fallback for the moment before the service is readable.
 */
function readMode(theme?: ThemeFace): Mode {
  try {
    const scheme = theme?.getTheme().active.colorScheme;
    if (scheme === "light" || scheme === "dark") return scheme;
  } catch {
    /* fall through to the DOM flag */
  }
  return document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
}

/**
 * Resolve one area's image for a mode: the mode-specific override wins, otherwise the
 * shared field, otherwise nothing. Exported so the offline suite can pin the fallback.
 */
export function resolveAreaImage(value: SkinValue | undefined, id: string, mode: Mode): string {
  const v = value ?? {};
  const specific = String(v[`${id}Image${mode === "dark" ? "Dark" : "Light"}`] ?? "");
  return specific || String(v[`${id}Image`] ?? "");
}

/**
 * Whether the window region carries any artwork at all, in either mode.
 *
 * The ornament work samples its palette from the window image, so the AI screen is gated on this:
 * without a wallpaper there is nothing to sample and nothing to decorate. Exported for the suite.
 */
export function windowHasArtwork(value: SkinValue | undefined): boolean {
  return Boolean(resolveAreaImage(value, "window", "light") || resolveAreaImage(value, "window", "dark"));
}

/** The stored playback rate, clamped to the schema's range. */
function videoRate(value: SkinValue): number {
  const n = Number(value.videoPlaybackRate ?? 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(0.1, n));
}

/** Live-apply a rate to whatever video is currently rendered (slider preview). */
function previewVideoRate(rate: number): void {
  const r = Math.min(4, Math.max(0.1, Number(rate) || 1));
  const layer = document.getElementById(VIDEO_LAYER_ID) as HTMLVideoElement | null;
  if (layer) {
    layer.defaultPlaybackRate = r;
    layer.playbackRate = r;
  }
  document.querySelectorAll<HTMLVideoElement>('[data-dsh-skin-sticker] video').forEach((v) => {
    v.defaultPlaybackRate = r;
    v.playbackRate = r;
  });
}

// ── warming the mode that is not on screen ──────────────────────────────────

/** URLs already warmed (the same artwork is warmed once), and the hidden video preloaders. */
const warmedUrls = new Set<string>();
const warmLoaders: HTMLVideoElement[] = [];
let warmTimer: ReturnType<typeof setTimeout> | null = null;

function warmImage(url: string): void {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  void img.decode?.().catch(() => {});
}

function warmVideo(url: string): void {
  const loader = document.createElement("video");
  loader.preload = "auto";
  loader.muted = true;
  loader.src = url;
  loader.setAttribute("muted", "");
  loader.setAttribute("aria-hidden", "true");
  loader.style.cssText = "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(loader);
  warmLoaders.push(loader);
}

/**
 * Fetch and decode the other mode's artwork while nothing is happening.
 *
 * A light↔dark switch swaps the wallpaper and every per-mode region image, and doing that
 * fetch + decode at that moment is exactly the stall you feel on a multi-MB image. Warming
 * it shortly after the current mode settles means the switch itself has nothing left to pay
 * for. Idempotent: each URL is warmed once, and areas whose artwork is shared between the
 * two modes are skipped entirely.
 */
function scheduleWarmOtherMode(value: SkinValue, mode: Mode): void {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    const other: Mode = mode === "dark" ? "light" : "dark";
    for (const area of AREAS) {
      const url = resolveAreaImage(value, area.id, other);
      if (!url || url === resolveAreaImage(value, area.id, mode) || warmedUrls.has(url)) continue;
      warmedUrls.add(url);
      if (VIDEO_RE.test(url)) warmVideo(url);
      else warmImage(url);
    }
    // Read it, don't just fetch it. A flip re-derives the whole scheme from the other mode's
    // artwork, so a cold sample is the stall that is felt when switching modes. Pre-reading keeps
    // the other mode's palette / light / material in the sampler's cache, so both modes are built
    // up-front and the switch itself has nothing left to compute.
    const otherWallpaper = resolveAreaImage(value, "window", other);
    if (otherWallpaper && otherWallpaper !== resolveAreaImage(value, "window", mode)) void sampleArtwork(otherWallpaper);
  }, 250);
}

function disposeWarmers(): void {
  if (warmTimer) {
    clearTimeout(warmTimer);
    warmTimer = null;
  }
  for (const loader of warmLoaders) loader.remove();
  warmLoaders.length = 0;
  warmedUrls.clear();
}

// ── theme cross-fade ────────────────────────────────────────────────────────

let themeAnimTimer: ReturnType<typeof setTimeout> | null = null;
/** What the window layer is currently showing, so a mode switch can cross-fade from it. */
let paintedWindowImage: string | null = null;
/** Last rendered sticker signature per area, so an unchanged sticker is never rebuilt. */
const stickerSignatures: Record<string, string> = {};

/** Above this many elements the transition is scoped to the big surfaces only. */
const THEME_ANIM_HEAVY_ELEMENTS = 1500;


/**
 * Open a short window in which colours transition. Called immediately *before* the theme
 * changes, so the transition is already in place when new values land.
 *
 * Kept for theme changes we did *not* initiate (e.g. the user flips DSH's own Appearance
 * setting): there a cover would flicker for nothing, and a short scoped transition still helps.
 */
function startThemeAnimation(): void {
  const body = document.body;
  const heavy = body.getElementsByTagName("*").length > THEME_ANIM_HEAVY_ELEMENTS;
  body.setAttribute(THEME_ANIM_ATTR, heavy ? "lite" : "full");
  if (themeAnimTimer) clearTimeout(themeAnimTimer);
  themeAnimTimer = setTimeout(() => {
    themeAnimTimer = null;
    body.removeAttribute(THEME_ANIM_ATTR);
  }, THEME_ANIM_MS + 100);
}

/**
 * Cross-fade the wallpaper from the artwork currently painted to `to`, by fading a copy of
 * the new artwork in on top and only then committing for real. Image -> image only: a video
 * swap needs two live video elements, and the palette fade already covers that case.
 */
function crossFadeWindow(value: SkinValue, from: string, to: string): void {
  document.getElementById(WALL_FADE_ID)?.remove();
  const layer = document.createElement("div");
  layer.id = WALL_FADE_ID;
  layer.setAttribute("aria-hidden", "true");
  const { size, repeat } = fitProps(String(value.windowFit ?? "cover"));
  const dx = Number(value.windowOffsetX ?? 0);
  const dy = Number(value.windowOffsetY ?? 0);
  layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:-1",
    "pointer-events:none",
    "opacity:0",
    `transition:opacity ${THEME_ANIM_MS}ms cubic-bezier(.4,0,.2,1)`,
    `background-image:url("${to}")`,
    `background-size:${size}`,
    `background-repeat:${repeat}`,
    "background-attachment:fixed",
    `background-position:calc(50% + ${Math.round(dx)}px) calc(50% + ${Math.round(dy)}px)`,
  ].join(";");
  document.body.prepend(layer);
  paintedWindowImage = from; // the old artwork stays painted underneath during the fade
  requestAnimationFrame(() => {
    layer.style.opacity = "1";
  });
  setTimeout(() => {
    paintedWindowImage = to;
    // Repaint the real state first (the overlay already shows the new artwork), then drop
    // the overlay — in that order the two are identical, so nothing flashes.
    if (typeof reapply === "function") reapply();
    document.getElementById(WALL_FADE_ID)?.remove();
  }, THEME_ANIM_MS + 40);
}

// ── window (body + sidebar column) ──────────────────────────────────────────

function applyWindowColumns(image: string): void {
  document.querySelectorAll<HTMLElement>('[class*="_sidebarCol"]').forEach((el) => {
    if (!image) {
      el.style.removeProperty("background-image");
      el.style.removeProperty("background-size");
      el.style.removeProperty("background-repeat");
      el.style.removeProperty("background-position");
      el.style.removeProperty("background-attachment");
      return;
    }
    el.style.setProperty("background-image", `url("${image}")`, "important");
    el.style.setProperty("background-size", "cover", "important");
    el.style.setProperty("background-repeat", "no-repeat", "important");
    el.style.setProperty("background-position", "center", "important");
    el.style.setProperty("background-attachment", "fixed", "important");
  });
}

const VIDEO_RE = /\.(mp4|webm)(\?.*)?$/i;
const VIDEO_LAYER_ID = "dsh-image-skin-video";

/**
 * The layer's current frame as a data URL, or "" if it cannot be read yet.
 *
 * Used to hold the outgoing frame on screen across a `src` swap: a bare swap blanks the layer for
 * as long as the incoming clip takes to decode (a local mp4 does *not* come up in one frame), and
 * that blank frame is the flash a light<->dark switch shows - both modes here are videos.
 */
function captureFrame(v: HTMLVideoElement): string {
  try {
    if (!v.videoWidth || !v.videoHeight || v.readyState < 2) return "";
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = Math.max(1, Math.round(480 * (v.videoHeight / v.videoWidth)));
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  }
}

/** Lazily create the full-screen looping <video> backdrop layer. */
function videoLayer(): HTMLVideoElement {
  let v = document.getElementById(VIDEO_LAYER_ID) as HTMLVideoElement | null;
  if (!v) {
    v = document.createElement("video");
    v.id = VIDEO_LAYER_ID;
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("muted", "");
    v.setAttribute("aria-hidden", "true");
    v.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;pointer-events:none;background:transparent;";
    document.body.prepend(v);
  }
  return v;
}

function clearWindowImage(): void {
  const body = document.body;
  body.style.removeProperty("background-image");
  body.style.removeProperty("background-size");
  body.style.removeProperty("background-repeat");
  body.style.removeProperty("background-attachment");
  body.style.removeProperty("background-position");
}

function applyWindow(value: SkinValue, mode: Mode, fade = false): void {
  const body = document.body;
  const image = resolveAreaImage(value, "window", mode);
  const on = value.windowEnabled !== false && value.enabled !== false && image.length > 0;
  const isVideo = on && VIDEO_RE.test(image);
  const existing = document.getElementById(VIDEO_LAYER_ID) as HTMLVideoElement | null;

  // ── still image -> still image: cross-fade instead of swapping in one frame ──
  const from = paintedWindowImage;
  if (fade && on && !isVideo && from && from !== image && !VIDEO_RE.test(from)) {
    crossFadeWindow(value, from, image);
    return;
  }

  // ── video backdrop ──
  if (isVideo) {
    const v = videoLayer();
    if (v.getAttribute("src") !== image) {
      // Freeze the frame that is on screen as the poster, so the swap shows the old picture until
      // the new clip can render its first one - instead of a black hole in between.
      const poster = captureFrame(v);
      if (poster) v.poster = poster;
      v.src = image;
      void v.play?.().catch(() => {});
    }
    // Playback rate applies live, and defaultPlaybackRate keeps it across a src swap.
    v.defaultPlaybackRate = videoRate(value);
    v.playbackRate = videoRate(value);
    // The wallpaper is deliberately NOT dimmed by panelOpacity. That slider exists to
    // reveal the wallpaper, so binding the video to it faded the video out exactly when
    // the user wanted to see it — at 0 the panels AND the video were transparent, and
    // the viewport fell through to the browser's white canvas. Static images never had
    // this problem: they ride on body's background-image, which the slider never touches.
    v.style.setProperty("opacity", "1", "important");
    clearWindowImage();
    applyWindowColumns("");
    paintedWindowImage = image;
    return;
  }
  if (existing) existing.remove();

  // ── (static / gif) image ──
  if (!on) {
    clearWindowImage();
    applyWindowColumns("");
    paintedWindowImage = null;
    return;
  }
  const { size, repeat } = fitProps(String(value.windowFit ?? "cover"));
  const dx = Number(value.windowOffsetX ?? 0);
  const dy = Number(value.windowOffsetY ?? 0);
  body.style.backgroundImage = `url("${image}")`;
  body.style.backgroundSize = size;
  body.style.backgroundRepeat = repeat;
  body.style.backgroundAttachment = "fixed";
  body.style.backgroundPosition = `calc(50% + ${Math.round(dx)}px) calc(50% + ${Math.round(dy)}px)`;
  applyWindowColumns(image);
  paintedWindowImage = image;
}

// ── panel translucency + image alpha (shared slider) ────────────────────────

function applyPanelOpacity(value: SkinValue, mode: Mode): void {
  const style = soleStyle(PANEL_STYLE_ID);
  const opacity = Number(value.panelOpacity ?? 100);
  const a = Math.max(0, Math.min(1, opacity / 100));
  // Take the scheme from the theme service rather than the body flag: on a theme switch
  // the flag is applied a tick later, which would leave the panel tint one mode behind.
  // The slider owns *how much* the panels cover; the hue comes from the sampled scheme (set by the
  // accent pass as --dsh-skin-tone). Falling back to DSH's own neutral keeps this working before the
  // first accent pass has run.
  const rgb = "var(--dsh-skin-tone, 18, 31, 47)";
  const l = (extra: number) => Math.min(1, a + extra).toFixed(3);
  style.textContent = [
    `body[${BODY_ATTR}] {`,
    // Sticker overlays ride the slider so the skin fades with the panel; the wallpaper
    // itself stays full-strength (see applyWindow).
    `  ${IMG_ALPHA_VAR}: ${a.toFixed(3)};`,
    // An opaque surface of the current scheme: our own settings screens read this so they stay
    // legible while the rest of the app goes see-through.
    `  --dsh-img-skin-surface: rgb(${rgb});`,
    `  --dsw-alias-bg-base: rgba(${rgb}, ${l(0)});`,
    `  --dsw-alias-bg-layer-1: rgba(${rgb}, ${l(0.15)});`,
    `  --dsw-alias-bg-layer-2: rgba(${rgb}, ${l(0.1)});`,
    `  --dsw-alias-bg-layer-3: rgba(${rgb}, ${l(0.05)});`,
    `  --dsw-alias-bg-overlay: rgba(${rgb}, ${l(0.2)});`,
    // Declared theme token: "Sidebar column and title-row background". Missing from this
    // list, the sidebar kept its opaque fill and stayed white however low the slider went.
    `  --dsw-specific-sidebar-fill: rgba(${rgb}, ${l(0)});`,
    `  --dsw-specific-app-shell: rgba(${rgb}, ${Math.max(0, a - 0.2).toFixed(3)});`,
    `}`,
    // The settings dialog is where the opacity slider lives, so letting it inherit the slider's
    // translucency made the one screen you configure from the hardest to read - and the wallpaper
    // showed through the panel edges (the "穿模" he pointed at). Inside a dialog the tokens go back
    // to opaque; the rest of the app still follows the slider.
    `body[${BODY_ATTR}] [role="dialog"]{`,
    `  --dsw-alias-bg-base: rgb(${rgb});`,
    `  --dsw-alias-bg-layer-1: rgb(${rgb});`,
    `  --dsw-alias-bg-layer-2: rgba(${rgb}, ${l(0.08)});`,
    `  --dsw-alias-bg-layer-3: rgba(${rgb}, ${l(0.05)});`,
    `  --dsw-alias-bg-overlay: rgba(${rgb}, ${l(0.55)});`,
    `  --dsw-specific-sidebar-fill: rgb(${rgb});`,
    `  --dsw-specific-app-shell: rgb(${rgb});`,
    `}`,
    // A few DSH surfaces paint a hard-coded colour instead of reading the theme tokens, so
    // overriding tokens alone leaves them opaque and the wallpaper invisible behind them.
    // The welcome card is the obvious one: an opaque #fff card sitting right on top of the
    // backdrop. Re-point them at the same token, and they follow the slider like everything
    // else.
    `body[${BODY_ATTR}] [class*="_card"]{`,
    "  background-color: var(--dsw-alias-bg-layer-1, transparent) !important;",
    `}`,
  ].join("\n");
}

// ── accent: decoration for controls, buttons and popovers ───────────────────
//
// The wallpaper alone leaves the UI skeleton looking pasted on: buttons and popovers keep
// their default fill and the whole thing reads as a photo behind a white app. This module
// derives a palette from whatever artwork is on the window, then paints that palette onto the
// small framed things - buttons, rows of controls, dialogs, menus, settings sections - so the
// chrome belongs to the picture.
//
// Levels are deliberately cheap first: 0-2 are computed locally (no network, no key), and only
// level 3 would call an image model.

const ACCENT_STYLE_ID = "dsh-image-skin-accent";

/**
 * The one stylesheet for `id`.
 *
 * Several accent passes can overlap - a theme flip renders while the mutation observer's refresh
 * and the breathing tick are in flight - and every one of them reaches this before any of them has
 * appended, so `getElementById` found nothing and *each* appended its own <style>. `getElementById`
 * then only ever updated the first, while a stale duplicate further down the document won the
 * cascade: the scheme froze on an old palette *and* an old light/dark choice until a reload, which
 * is exactly the "I have to refresh before the tint follows" report. Create it in the same
 * synchronous step it is looked up (no await between), and drop any duplicate left by an earlier run.
 */
function soleStyle(id: string): HTMLStyleElement {
  const all = Array.from(document.querySelectorAll<HTMLStyleElement>(`#${id}`));
  let style = all[0];
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.append(style);
  }
  for (const extra of all.slice(1)) extra.remove();
  return style;
}

/** Drop every stylesheet carrying `id` (there can be strays - see soleStyle). */
function dropStyles(id: string): void {
  document.querySelectorAll<HTMLStyleElement>(`#${id}`).forEach((el) => el.remove());
}
const ACCENT_ATTR = "data-dsh-skin-accent";
const ACCENT_MARK = "data-dsh-accent";
/** Stamped per element: 1 = the picture is busy under this element, so decoration yields. */
const BUSY_ATTR = "data-dsh-skin-busy";
/** The first hue we saw for the current wallpaper; the breathing pass stays near it. */
let breathSeed: { url: string; hue: number | null } | null = null;
/**
 * The wallpaper each mode was last painted from. Per mode, so a *wallpaper switch* can force a
 * re-read while a light↔dark flip does not: the two modes use different artwork, and forcing a
 * fresh sample on every flip made the whole scheme re-read from scratch at the exact moment the
 * user was waiting for it. Tracking per mode lets a flip reuse the reading warmed for that mode.
 */
const lastWallpaper: Record<Mode, string | null> = { light: null, dark: null };

/** The hue the scheme would pick for a palette ("best usable colour"), or null if there is none. */
function seedHueOf(palette: string[]): number | null {
  const ranked = palette
    .slice(0, 6)
    .map((p) => {
      const { r, g, b } = parseTriple(p);
      const c = rgbToHsl(r, g, b);
      return { ...c, rank: c.s < 0.12 ? 0 : c.s * Math.max(0, 1 - Math.abs(c.l - 0.55) * 1.5) };
    })
    .sort((a, b) => b.rank - a.rank);
  const best = ranked[0];
  return best && best.rank > 0.04 ? best.h : null;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

interface AccentLevelDef {
  name: string;
  desc: string;
  ready: boolean;
}

/**
 * The levels are a ladder of *how much decoration*, and who draws it:
 * 0-2 are drawn on this machine (tint -> corner ticks -> a framed panel), 3-4 hand the frame to
 * a generated ornament. The wording has to match what actually happens - an early version claimed
 * the model drew levels 1-2, which was never true.
 */
const ACCENT_LEVELS: AccentLevelDef[] = [
  { name: "取色", desc: "只把按钮与面板染上壁纸的色调（本机计算，不联网）", ready: true },
  { name: "淡", desc: "底色很淡，只把壁纸的颜色接一点到控件上", ready: true },
  { name: "标准", desc: "底色更明显，并带上画面的光（方向 + 冷暖）", ready: true },
  { name: "浓", desc: "颜色最足，面板与弹窗都稳稳接住壁纸的调子", ready: true },
  { name: "呼吸", desc: "和「浓」同色；视频壁纸会跟着画面慢慢漂", ready: true },
];

/** Elements that make up the "skeleton" and deserve the accent. */
const ACCENT_SELECTOR = [
  'button',
  'select',
  'input[type="text"]',
  'input[type="search"]',
  '[role="button"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[data-settings-section]',
  'main > section',
  '[role="main"] > section',
].join(",");

/** Our own chrome and links must never be re-decorated. */
const ACCENT_EXCLUDE = `[data-dsh-skin-chrome],[data-dsh-skin-chrome] *,[data-dsh-skin-sticker],[data-dsh-skin-sticker] *,a,[role="link"]`;

const paletteCache = new Map<string, string[]>();
/** Last palette we wrote to settings, so a lagging snapshot cannot make us write it again. */
let paletteWriteKey: string | null = null;
let accentTargets: HTMLElement[] = [];

/** Everything we read off the artwork in one pass: palette, light, busyness, material. */
interface ArtworkReading {
  palette: string[];
  /** Which of the 3×3 cells is brightest (-1..1 each), and how warm that cell is. */
  light: { dirX: number; dirY: number; warmth: number; brightness: number };
  /** 8×5 grid of local contrast (0..1), so decoration can keep off the busy parts. */
  density: { busy: number; lum: number }[];
  /** A rough read of *what the picture is made of*, used to pick ornament material. */
  material: "sky" | "paper" | "wood" | "water" | "neon" | "plain";
}

const artworkCache = new Map<string, ArtworkReading>();
/** Faded copies of a generated frame, keyed by url + alpha. */
const fadeCache = new Map<string, string>();
/** Generated frames with their flat background knocked out, keyed by url. */
const knockoutCache = new Map<string, string>();

/**
 * Make a generated frame usable as an ornament.
 *
 * Image models draw on a background - usually white - and border-image would carry that band onto
 * the panel, so the ornament arrives as "a white border with some pattern on it". Sample the colour
 * at the centre (the frame's own middle is empty by design) and make everything close to it
 * transparent. If almost nothing matches, the picture is not a frame on a flat background and is
 * left alone rather than eaten.
 */
async function keyOutBackground(url: string): Promise<string> {
  const cached = knockoutCache.get(url);
  if (cached) return cached;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (!w || !h) return url;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return url;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const mid = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
    const bg = [px[mid], px[mid + 1], px[mid + 2]];
    let cleared = 0;
    for (let i = 0; i < px.length; i += 4) {
      const distance =
        Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
      if (distance < 46) {
        px[i + 3] = 0;
        cleared++;
      }
    }
    if (cleared / (px.length / 4) < 0.06) return url;
    ctx.putImageData(data, 0, 0);
    const out = canvas.toDataURL("image/png");
    knockoutCache.set(url, out);
    return out;
  } catch {
    return url;                                    // cross-origin or undecodable: keep as-is
  }
}

/**
 * Read the artwork once and keep the result. A video backdrop is re-read on demand (see the
 * breathing pass in applyAccent) because its frames move.
 */
async function sampleArtwork(url: string, refresh = false): Promise<ArtworkReading | null> {
  if (!refresh) {
    const hit = artworkCache.get(url);
    if (hit) return hit;
  }
  // 160px wide, not 64: at 64 a wallpaper of sky, clouds and a character collapses into two flat
  // blues, which is why the scheme "did not follow" the picture. 160 keeps the small but vivid areas
  // (a pink cloud edge, the character's yellow accents) alive in the histogram.
  const w = 160;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  /** One frame's worth of pixels, painted into the canvas and handed to the caller. */
  const paint = async (draw: (cw: number, ch: number) => void, aspect: number): Promise<void> => {
    const h = Math.max(1, Math.round(w * aspect));
    canvas.width = w;
    canvas.height = h;
    draw(w, h);
  };

  // A video backdrop never decodes into an <img>, so sample real frames instead. Without this the
  // accent silently did nothing at all for anyone using a video wallpaper. Three moments of the clip
  // are merged, so the palette describes the whole loop rather than one instant of it.
  const frames: Uint8ClampedArray[] = [];
  if (VIDEO_RE.test(url)) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("video failed")), { once: true });
        setTimeout(() => reject(new Error("video timed out")), 5000);
      });
    } catch {
      return null;
    }
    const aspect = video.videoHeight / Math.max(1, video.videoWidth);
    const duration = Number.isFinite(video.duration) && video.duration > 0.4 ? video.duration : 1;
    for (const fraction of [0.08, 0.4, 0.72]) {
      try {
        await new Promise<void>((resolve) => {
          video.addEventListener("seeked", () => resolve(), { once: true });
          setTimeout(resolve, 1200);
          video.currentTime = Math.max(0, Math.min(duration - 0.05, duration * fraction));
        });
        await paint((cw, ch) => ctx.drawImage(video, 0, 0, cw, ch), aspect);
        frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      } catch {
        /* a frame that will not seek is simply skipped */
      }
    }
    if (!frames.length) return null;
  } else {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    try {
      await img.decode();
    } catch {
      return null;
    }
    await paint((cw, ch) => ctx.drawImage(img, 0, 0, cw, ch), img.height / Math.max(1, img.width));
    try {
      frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      return null;                                // tainted canvas - treat as "no reading"
    }
  }

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null;                                  // tainted canvas — treat as "no reading"
  }
  const CW = canvas.width;
  const CH = canvas.height;
  const lumAt = (px: number, py: number) => {
    const i = (py * CW + px) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  // ── palette: 4-bit histogram over every sampled frame, scored by "usable as a UI colour" ──
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (const pixels of frames) {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 200) continue;
      const key = `${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`;
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n += 1;
      e.r += pixels[i];
      e.g += pixels[i + 1];
      e.b += pixels[i + 2];
      buckets.set(key, e);
    }
  }
  const score = (r: number, g: number, b: number): number => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lig = (max + min) / 510;
    // The window used to be narrow around mid-lightness, which quietly disqualified exactly the
    // colours a sky, sunset or nebula wallpaper is made of (bright and saturated) in favour of dark
    // navy corners - the theme then never followed the picture. Pale-but-saturated now keeps a real
    // rank; only near-white washes and near-black stay low.
    return sat * Math.max(0.16, 1 - Math.abs(lig - 0.62) * 1.05);
  };
  const totalPixels = frames.reduce((a, p) => a + p.length / 4, 0);
  const palette = [...buckets.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n, s: score(e.r / e.n, e.g / e.n, e.b / e.n) }))
    // Near-grey and vanishingly rare colours are dropped, not ranked: one muddy grey cluster should
    // not decide the whole theme. The floor is low on purpose - a small vivid area is worth keeping,
    // it is often the one colour that makes the picture recognisable.
    .filter((e) => e.s > 0.1 && e.n > Math.max(3, totalPixels / 1200))
    .sort((a, b) => b.n * (0.3 + b.s) - a.n * (0.3 + a.s))
    .slice(0, 6)
    .map((e) => `${Math.round(e.r)}, ${Math.round(e.g)}, ${Math.round(e.b)}`);

  // ── light: brightest 3×3 cell, and how warm that cell is ──
  const cells: { x: number; y: number; lum: number; r: number; g: number; b: number; n: number }[] = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      let sum = 0;
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let py = Math.floor((y * CH) / 3); py < ((y + 1) * CH) / 3; py += 2) {
        for (let px = Math.floor((x * CW) / 3); px < ((x + 1) * CW) / 3; px += 2) {
          const i = (py * CW + px) * 4;
          sum += lumAt(px, py);
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      if (n) cells.push({ x, y, lum: sum / n, r: r / n, g: g / n, b: b / n, n });
    }
  }
  const brightest = cells.reduce((a, b) => (b.lum > a.lum ? b : a), cells[0]);
  const lightness = cells.reduce((a, c) => a + c.lum, 0) / Math.max(1, cells.length);
  const light = {
    dirX: brightest.x - 1,
    dirY: brightest.y - 1,
    warmth: (brightest.r - brightest.b) / 255,
    brightness: lightness / 255,
  };

  // ── density: 8×5 grid of local contrast (how busy the picture is there) ──
  const mx = 8;
  const my = 5;
  const density: { busy: number; lum: number }[] = [];
  const raw: { v: number; lum: number }[] = [];
  for (let y = 0; y < my; y++) {
    for (let x = 0; x < mx; x++) {
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let py = Math.floor((y * CH) / my); py < ((y + 1) * CH) / my; py += 1) {
        for (let px = Math.floor((x * CW) / mx); px < ((x + 1) * CW) / mx; px += 1) {
          const l = lumAt(px, py);
          sum += l;
          sum2 += l * l;
          n++;
        }
      }
      const mean = sum / Math.max(1, n);
      raw.push({ v: Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)), lum: mean });
    }
  }
  const maxV = Math.max(...raw.map((d) => d.v), 1);
  for (const d of raw) density.push({ busy: d.v / maxV, lum: d.lum });

  // ── material: a rough read of what the picture is made of ──
  const avgS = palette.length
    ? palette.reduce((a, p) => a + score(...(p.split(",").map(Number) as [number, number, number])), 0) / palette.length
    : 0;
  const busyAvg = density.reduce((a, d) => a + d.busy, 0) / density.length;
  const cool = light.warmth < -0.02;
  const material: ArtworkReading["material"] =
    palette.length === 0
      ? "plain"
      : avgS > 0.55 && busyAvg > 0.5
        ? "neon"
        : light.brightness > 0.62 && busyAvg < 0.45
          ? "sky"
          : cool && busyAvg > 0.45
            ? "water"
            : light.warmth > 0.05 && busyAvg > 0.45
              ? "wood"
              : busyAvg < 0.4
                ? "paper"
                : "plain";

  const reading: ArtworkReading = { palette, light, density, material };
  artworkCache.set(url, reading);
  return reading;
}

/** Busyness of the picture under a viewport position (0..1), for the "stay off the subject" pass. */
function busyUnder(art: ArtworkReading, fx: number, fy: number): number {
  const x = Math.min(7, Math.max(0, Math.floor(fx * 8)));
  const y = Math.min(4, Math.max(0, Math.floor(fy * 5)));
  return art.density[y * 8 + x]?.busy ?? 0;
}

/**
 * Reduce an image to a handful of representative colours. A 4-bit bucket histogram over a
 * 64px-wide sampling is plenty for tinting chrome and costs a few milliseconds.
 */
async function extractPalette(url: string): Promise<string[]> {
  const reading = await sampleArtwork(url);
  return reading?.palette ?? [];
}
function visible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
}

/**
 * Mark the on-screen skeleton elements, stamping each with the role it plays.
 *
 * Roles matter: a 30px button and a settings section are both "chrome", but they cannot wear the
 * same amount of decoration. `panel` gets the frame, `small` gets a hairline.
 */
function scanAccentTargets(): HTMLElement[] {
  const found = new Set<HTMLElement>();
  const usable = (el: HTMLElement): boolean => !el.closest(ACCENT_EXCLUDE) && visible(el);

  document.querySelectorAll<HTMLElement>(ACCENT_SELECTOR).forEach((el) => {
    if (usable(el)) found.add(el);
  });

  // Fallback sweep: anything small that already draws a border is part of the skeleton too.
  // The named selectors miss icon-only controls and one-off rows; sizing keeps big layout
  // containers (which should stay plain) out of it. Elements we already marked last pass are
  // trusted without re-measuring, so a toolbar that is mid-animation does not flicker out.
  document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
    if (found.has(el)) return;
    if (el.hasAttribute(ACCENT_MARK)) {
      found.add(el);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 360 || rect.height > 220 || rect.width < 6 || rect.height < 6) return;
    if (!usable(el)) return;
    const cs = getComputedStyle(el);
    const bordered = (["Top", "Right", "Bottom", "Left"] as const).some((side) => {
      const w = parseFloat(cs[`border${side}Width` as "borderTopWidth"]);
      const s = cs[`border${side}Style` as "borderTopStyle"];
      return w > 0 && s !== "none";
    });
    if (bordered) found.add(el);
  });

  // Consistency pass: a toolbar is a row of peers, but only some of them draw their own border
  // (an icon-only button often relies on hover). Decorating two of three siblings looks like a
  // bug, so once one member of a row is marked, its button-like siblings join it.
  for (const el of [...found]) {
    const parent = el.parentElement;
    if (!parent) continue;
    const pe = getComputedStyle(parent);
    if (!/flex/.test(pe.display)) continue;
    const siblings = [...parent.children].filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c !== el && c.matches("button, [role='button'], a"),
    );
    if (!siblings.length || siblings.length > 8) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 120 || rect.height > 120) continue;      // only cluster small peers
    for (const sib of siblings) {
      if (usable(sib)) found.add(sib);
    }
  }

  return [...found];
}

/** A surface big enough to carry a frame, versus a control or a card that only wants a hairline. */
function accentRole(el: HTMLElement): "panel" | "small" {
  if (el.matches('[role="dialog"], [role="menu"], [role="listbox"]')) return "panel";
  // Nothing inside a panel is a panel. The dialog already wears the frame; framing its contents too
  // turned the settings screen into a nest of rectangles, which is exactly what read as stiff.
  if (el.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return "small";
  const rect = el.getBoundingClientRect();
  return rect.width >= 480 && rect.height >= 260 ? "panel" : "small";
}

// ── colour ──────────────────────────────────────────────────────────────────
//
// Sampling a wallpaper gives back whatever happened to be in the picture - four unrelated RGB
// triples. Painting those straight onto controls is what made the first attempt look like a
// colour clash: every element got a different hue at a random lightness. So the palette is first
// reduced to *one* hue, and every role is rebuilt from it.

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
  else if (max === gg) h = ((bb - rr) / d + 2) * 60;
  else h = ((rr - gg) / d + 4) * 60;
  return { h, s, l };
}

/** HSL -> "r, g, b" so the rest of the module keeps working in plain rgb triples. */
function hslTriple(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const CONTRAST = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Walk a lightness until the colour actually separates from the surface behind it. A scheme that
 * looks right on a bright wallpaper fails on a dark one, and vice versa - this is the guard.
 */
function fitLightness(hue: number, sat: number, start: number, bgLum: number, minRatio: number, brighten: boolean): number {
  let l = start;
  for (let i = 0; i < 24; i++) {
    const [r, g, b] = hslTriple(hue, sat, l);
    if (CONTRAST(relativeLuminance(r, g, b), bgLum) >= minRatio) break;
    l = Math.min(0.95, Math.max(0.05, l + (brighten ? 0.035 : -0.035)));
  }
  return l;
}

interface AccentScheme {
  /** The single hue every role is built from. */
  hue: number;
  sat: number;
  /** Hairlines and frames. */
  line: string;
  /** Corners, glyphs, denser marks. */
  ink: string;
  /** The surface tint. */
  wash: string;
  tint: number;
  lineAlpha: number;
  /** True when the wallpaper actually offered a colour to build on. */
  fromArtwork: boolean;
  /** The picture's own spark: its most vivid colour, kept for interactive states only. */
  spark: string;
  /** The colour of the light the picture is lit by, for the lit edge and the gradient. */
  lightTint: string;
  /**
   * A second, genuinely different hue from the same picture. One hue reads as a filter laid over the
   * wallpaper; borrowing a second colour is what makes a multi-colour picture feel followed rather
   * than flattened. It dresses the ornament's second rule and the lace, never the surface.
   */
  edge: string;
  /** True when the second hue really came from the picture. */
  edgeFromArtwork: boolean;
  /**
   * 层次感: the tone ramp. One hue, five rungs - window, panel, raised control, hover, pressed -
   * so the interface has depth instead of being one flat tint. Surfaces only whisper the hue;
   * the accent is the one rung that carries it properly.
   */
  appTone: string;
  wellTone: string;
  panelTone: string;
  raisedTone: string;
  raisedHi: string;
  raisedDown: string;
  accent: string;
  /** Text colour to use *on* the accent rung (the only text colour we touch). */
  accentInk: string;
}

/** One hue in, a whole scheme out: three roles, contrast-checked against the surface. */
/**
 * 全套视觉语言: the token layer.
 *
 * DSH's palette hangs off two static scales - a neutral ramp and the brand blue - and every semantic
 * alias derives from them. Re-pointing those two (instead of chasing hundreds of selectors) is what
 * makes *every* surface follow the wallpaper. Each step keeps DSH's own lightness and only takes our
 * hue, so every contrast relationship the design already relied on survives by construction.
 *
 * On top of that, the aliases we can name (fields, menus, tips, buttons, hover states) get a rung of
 * our ladder, and the glass surfaces get a blur - so a panel reads as a pane of tinted glass instead
 * of a sheet of paper.
 */
const DSH_SCALES: [string, number, number, number, boolean][] = [
  ["--dsw-static-neutral-00", 255, 255, 255, false],
  ["--dsw-static-neutral-100", 245, 245, 245, false],
  ["--dsw-static-neutral-1000", 0, 0, 0, false],
  ["--dsw-static-neutral-150", 237, 237, 237, false],
  ["--dsw-static-neutral-200", 229, 229, 229, false],
  ["--dsw-static-neutral-250", 220, 220, 220, false],
  ["--dsw-static-neutral-300", 212, 212, 212, false],
  ["--dsw-static-neutral-400", 162, 164, 166, false],
  ["--dsw-static-neutral-50", 250, 250, 250, false],
  ["--dsw-static-neutral-500", 127, 130, 135, false],
  ["--dsw-static-neutral-550", 101, 103, 107, false],
  ["--dsw-static-neutral-600", 84, 85, 87, false],
  ["--dsw-static-neutral-700", 60, 60, 61, false],
  ["--dsw-static-neutral-800", 41, 41, 41, false],
  ["--dsw-static-neutral-850", 33, 33, 35, false],
  ["--dsw-static-neutral-900", 15, 15, 15, false],
  ["--dsw-static-neutral-bluish-00", 255, 255, 255, false],
  ["--dsw-static-neutral-bluish-100", 235, 238, 242, false],
  ["--dsw-static-neutral-bluish-1000", 15, 17, 21, false],
  ["--dsw-static-neutral-bluish-150", 233, 236, 242, false],
  ["--dsw-static-neutral-bluish-200", 225, 229, 238, false],
  ["--dsw-static-neutral-bluish-300", 207, 211, 214, false],
  ["--dsw-static-neutral-bluish-400", 173, 178, 184, false],
  ["--dsw-static-neutral-bluish-50", 249, 250, 251, false],
  ["--dsw-static-neutral-bluish-500", 151, 157, 166, false],
  ["--dsw-static-neutral-bluish-60", 249, 250, 251, false],
  ["--dsw-static-neutral-bluish-600", 129, 133, 140, false],
  ["--dsw-static-neutral-bluish-700", 97, 102, 107, false],
  ["--dsw-static-neutral-bluish-75", 241, 243, 245, false],
  ["--dsw-static-neutral-bluish-750", 67, 69, 74, false],
  ["--dsw-static-neutral-bluish-800", 53, 54, 56, false],
  ["--dsw-static-neutral-bluish-850", 44, 44, 46, false],
  ["--dsw-static-neutral-bluish-875", 35, 35, 36, false],
  ["--dsw-static-neutral-bluish-900", 27, 27, 28, false],
  ["--dsw-static-neutral-bluish-950", 21, 21, 23, false],
  ["--dsw-static-deepseek-100", 228, 237, 253, true],
  ["--dsw-static-deepseek-200", 211, 226, 255, true],
  ["--dsw-static-deepseek-300", 183, 200, 254, true],
  ["--dsw-static-deepseek-400", 103, 158, 254, true],
  ["--dsw-static-deepseek-450", 86, 134, 254, true],
  ["--dsw-static-deepseek-50", 237, 243, 254, true],
  ["--dsw-static-deepseek-500", 65, 118, 230, true],
  ["--dsw-static-deepseek-600", 72, 104, 178, true],
  ["--dsw-static-deepseek-800", 52, 65, 91, true],
  ["--dsw-static-deepseek-900", 40, 49, 66, true]
];

/** Our own variables, so other rules (and the opacity slider) can compose alphas from the ramp. */
function rampVars(scheme: AccentScheme): string[] {
  return [
    `  --dsh-skin-tone: ${scheme.panelTone};`,
    `  --dsh-skin-tone-app: ${scheme.appTone};`,
    `  --dsh-skin-well: ${scheme.wellTone};`,
    `  --dsh-skin-tone-raised: ${scheme.raisedTone};`,
    `  --dsh-skin-tone-high: ${scheme.raisedHi};`,
    `  --dsh-skin-line: ${scheme.line};`,
    `  --dsh-skin-ink: ${scheme.ink};`,
    `  --dsh-skin-accent: ${scheme.accent};`,
    `  --dsh-skin-accent-ink: ${scheme.accentInk};`,
  ];
}

function tokenLanguage(scheme: AccentScheme, mode: Mode): string {
  const dark = mode === "dark";
  const { hue, sat } = scheme;
  // "primary" keeps its *contrast* meaning (light pill on dark, dark pill on light) and only takes
  // our hue, so DSH's own text colour on it stays readable.
  const contrastFill = hslTriple(hue, dark ? 0.1 : 0.24, dark ? 0.93 : 0.2).join(", ");
  // Roles, not alphas: in a light theme "more transparent" means "whiter", so a rung that only
  // moved alpha turned every inset and hover into a wash. Each role now names the tone it wants.
  const rung = (extra: number) =>
    `rgba(var(--dsh-skin-tone), ${Math.min(1, Math.max(0.06, 0.86 + extra)).toFixed(3)})`;
  const role = (name: "surface" | "raised" | "high" | "well", alpha: number) =>
    `rgba(var(--dsh-skin-${name}), ${alpha.toFixed(3)})`;
  const rootSel = `body[${BODY_ATTR}][${ACCENT_ATTR}]`;
  return [
    `${rootSel} {`,
    ...rampVars(scheme),
    ...DSH_SCALES.map(([name, r, g, b, brand]) => {
      const l = rgbToHsl(r, g, b).l;
      const chroma = brand ? Math.min(0.7, Math.max(0.36, sat)) : dark ? 0.1 : 0.07;
      return `  ${name}: rgb(${hslTriple(hue, chroma, l).join(", ")});`;
    }),
    // named surface aliases: fields sit one rung *below* the surface so a field reads as a field,
    // menus and tips one rung above.
    `  --dsw-specific-input-major: ${role("well", 0.72)} !important;`,
    `  --dsw-specific-login-input: ${role("well", 0.72)} !important;`,
    `  --dsw-specific-selector: ${role("well", 0.8)} !important;`,
    `  --dsw-specific-menu: ${role("surface", 0.9)} !important;`,
    `  --dsw-specific-tip: ${role("raised", 0.94)} !important;`,
    `  --dsw-specific-bubble: ${role("surface", 0.92)} !important;`,
    `  --dsw-specific-bubble-highlight: ${role("raised", 0.95)} !important;`,
    `  --dsw-alias-tooltip-bg: ${role("raised", 0.95)} !important;`,
    `  --dsw-alias-toast-bg: ${role("raised", 0.95)} !important;`,
    `  --dsw-alias-bg-module-platform: ${role("well", 0.8)} !important;`,
    `  --dsw-alias-bg-multi-select: ${role("well", 0.8)} !important;`,
    `  --dsw-alias-bg-skeleton: rgba(var(--dsh-skin-line), .16) !important;`,
    // DSH's own "in use" tag is painted #111; give chips our ink so they belong to the scheme
    `  --dsw-alias-bg-mask-3: rgba(var(--dsh-skin-ink), .82) !important;`,
    `  --dsw-alias-bg-mask-photo: rgba(var(--dsh-skin-ink), .9) !important;`,
    // strokes: our line colour instead of DSH's white-alpha hairlines
    `  --dsw-alias-border-l1: rgba(var(--dsh-skin-line), .2) !important;`,
    `  --dsw-alias-border-l2: rgba(var(--dsh-skin-line), .3) !important;`,
    `  --dsw-alias-border-l2-darkmode-thin: rgba(var(--dsh-skin-line), .24) !important;`,
    `  --dsw-alias-border-l3: rgba(var(--dsh-skin-line), .42) !important;`,
    `  --dsw-alias-border-l4: rgba(var(--dsh-skin-line), .58) !important;`,
    `  --dsw-alias-border-inverted: rgba(var(--dsh-skin-line), .2) !important;`,
    `  --dsw-alias-border-inverted2: rgba(var(--dsh-skin-line), .28) !important;`,
    // states climb a rung
    `  --dsw-alias-interactive-bg-hover: ${role("high", 0.5)} !important;`,
    `  --dsw-alias-interactive-bg-active: ${role("high", 0.72)} !important;`,
    `  --dsw-alias-interactive-bg-hover-solid: ${role("high", 0.9)} !important;`,
    `  --dsw-alias-interactive-bg-hover-accent: rgba(var(--dsh-skin-accent), .26) !important;`,
    // buttons
    `  --dsw-alias-button-tool-bar-fill: ${role("raised", 0.8)} !important;`,
    `  --dsw-alias-button-tool-bar-fill-invisible: ${role("raised", 0.4)} !important;`,
    `  --dsw-alias-button-tool-bar-hover: ${role("high", 0.86)} !important;`,
    `  --dsw-alias-button-elevated-fill: ${role("high", 0.92)} !important;`,
    `  --dsw-alias-button-floating-fill: ${role("raised", 0.97)} !important;`,
    `  --dsw-alias-button-ghost-active-fill: ${role("high", 0.8)} !important;`,
    `  --dsw-alias-button-primary-fill: ${contrastFill} !important;`,
    `  --dsw-alias-button-contrast-fill: ${contrastFill} !important;`,
    `  --dsw-alias-brand-primary: ${contrastFill} !important;`,
    `  --dsw-alias-brand-primary-invert: ${contrastFill} !important;`,
    // the sidebar's own nav states, which the settings dialog also uses
    `  --dsw-specific-sidebar-nav-item-active: ${role("high", 0.92)} !important;`,
    `  --dsh-sidebar-nav-item-active: ${role("high", 0.92)} !important;`,
    `  --dsw-specific-sidebar-nav-item-hover: ${role("raised", 0.8)} !important;`,
    `  --dsw-specific-sidebar-nav-item-active-accent: rgba(var(--dsh-skin-accent), .78) !important;`,
    `}`,
    // 液态玻璃: the surfaces that float above the picture get a blur, so the tint reads as glass
    // rather than paint. Only floating things - not the whole shell (a blur across every row is
    // expensive and makes text mushy).
    `body[${BODY_ATTR}][${ACCENT_ATTR}] [role="dialog"],`,
    `body[${BODY_ATTR}][${ACCENT_ATTR}] [role="menu"],`,
    `body[${BODY_ATTR}][${ACCENT_ATTR}] [role="listbox"],`,
    `body[${BODY_ATTR}][${ACCENT_ATTR}] [role="tooltip"],`,
    `body[${BODY_ATTR}][${ACCENT_ATTR}] input,`,
    `body[${BODY_ATTR}][${ACCENT_ATTR}] textarea,`,
    `body[${BODY_ATTR}][${ACCENT_ATTR}] [data-dsh-accent="panel"] {`,
    `  backdrop-filter: blur(20px) saturate(1.2) !important;`,
    `  -webkit-backdrop-filter: blur(20px) saturate(1.2) !important;`,
    `}`,
  ].join("\n");
}

function deriveScheme(palette: string[], mode: Mode, light?: ArtworkReading["light"], depth = 2): AccentScheme {
  const sampled = palette
    .slice(0, 6)
    .map((p) => {
      const { r, g, b } = parseTriple(p);
      return { ...rgbToHsl(r, g, b) };
    })
    // Trust the sampler's ordering: it already sorted by area x vividness, so entry 0 is the colour
    // the picture actually reads as. Re-ranking by a chroma/luminance formula here is what let a
    // small patch of deep blue outrank a big pink nebula and paint the whole UI blue.
    .map((c) => ({ ...c, rank: c.s < 0.1 ? 0 : c.s * Math.max(0.06, 1 - Math.abs(c.l - 0.62) * 1.05) }));

  const seed = sampled[0];
  const usable = seed && seed.rank > 0.02;
  const hue = seed && seed.h !== undefined ? seed.h : 214;
  // Saturation comes from the most colourful usable entry, not from the seed itself. The seed is
  // usually the *largest* area, which on a night sky or a nebula is a near-black that carries the
  // right hue but almost no colour - clamping to its own saturation is what turned a vivid pink
  // wallpaper into a grey UI.
  const maxSat = sampled.reduce((a, c) => (c.rank > 0.04 ? Math.max(a, c.s) : a), 0);
  const sat = usable ? Math.min(0.62, Math.max(0.34, maxSat || sampled[0].s)) : 0.26;

  const bg = mode === "dark" ? [18, 31, 47] : [255, 253, 252];
  const bgLum = relativeLuminance(bg[0], bg[1], bg[2]);
  const lineL = fitLightness(hue, sat, mode === "dark" ? 0.64 : 0.44, bgLum, 2.3, mode === "dark");
  const inkL = fitLightness(hue, Math.min(0.72, sat + 0.12), mode === "dark" ? 0.82 : 0.32, bgLum, 4.6, mode === "dark");
  const washL = mode === "dark" ? 0.62 : 0.48;

  // The second hue: the most *different* usable colour the picture offered (at least ~40° away, so
  // it reads as a partner rather than a wobble). When the picture only has one hue, one is built by
  // rotating 34° - still in the picture's own family, still visibly a second voice.
  const hueDistance = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };
  const partner = sampled
    .filter((c) => c.rank > 0.03 && hueDistance(c.h, hue) > 40)
    .sort((a, b) => hueDistance(b.h, hue) * b.rank - hueDistance(a.h, hue) * a.rank)[0];
  const edgeHue = partner ? partner.h : (hue + 34) % 360;
  const edgeSat = partner ? Math.min(0.6, Math.max(0.26, partner.s)) : Math.min(0.6, sat + 0.06);
  const edgeL = fitLightness(edgeHue, edgeSat, mode === "dark" ? 0.66 : 0.46, bgLum, 2.1, mode === "dark");

  // The spark: the most vivid colour the picture has (usually not the seed), pushed until it is
  // clearly readable, so it can mark "this is interactive" without shouting anywhere else. If the
  // vivid colour is all but the same hue as the seed, borrow the partner instead - a hover that
  // differs only in lightness is not a signal.
  const vividPick = sampled.find((c) => c.rank > 0.04 && hueDistance(c.h, hue) > 25);
  const vivid = vividPick ?? sampled.find((c) => c.rank > 0.04) ?? sampled[0];
  const sparkL = fitLightness(vivid?.h ?? hue, Math.min(0.85, (vivid?.s ?? sat) + 0.15), mode === "dark" ? 0.78 : 0.44, bgLum, 3.4, mode === "dark");

  // ── 层次感: the tone ladder ────────────────────────────────────────────────────────────────
  // The rung height scales with depth, so the same ladder reads as a whisper at 0 and as a clearly
  // stepped surface at 4. Surfaces get low chroma (a coloured *paper* UI is what looks cheap); the
  // accent gets the full saturation and is contrast-walked, because it has to carry its own text.
  const dark = mode === "dark";
  // Depth works differently in the two modes, and treating them the same is what made the light
  // theme look *dirty*: stepping a light surface downward with almost no chroma produces pale grey,
  // which reads as a washed-out white rather than as colour. In light mode the steps are therefore
  // shallower and the tint deepens faster as the rung rises - the hierarchy comes from the colour
  // getting richer, not from the surface getting grey.
  // A bright wallpaper (sky, clouds, a white backdrop) *bleaches* a translucent light surface: covering
  // white with pale blue still looks white. Light-mode surfaces therefore sit deeper and carry real
  // chroma, so the tint survives both the wallpaper behind them and a lowered opacity slider.
  // Quantified, not by eye: the step between two rungs is a lightness difference of 4-6% (the light
  // ladder used to jump 9%/13.5%, which put a 38-RGB gap between a card and the well inside it - it
  // read as "a coloured block set into the card"). Rung = step size, depth picks which step.
  const rung = dark
    ? [0.016, 0.026, 0.036, 0.046, 0.056][Math.max(0, Math.min(4, depth))] ?? 0.036
    : [0.016, 0.040, 0.052, 0.062, 0.070][Math.max(0, Math.min(4, depth))] ?? 0.052;
  const baseL = dark ? 0.15 : 0.978;
  // In a light theme, HSL saturation near white yields almost no actual colour (the chroma of a
  // colour collapses as it approaches L=1), which is why a "light tint" kept coming out as pale
  // grey. So light mode does not scale the surface chroma down from the seed - it *builds it up* as
  // the rung rises. Hierarchy in light mode = the tint getting richer, not the surface getting grey.
  const toneAt = (i: number, chroma: number): string => {
    const s2 = dark ? Math.min(0.55, sat * chroma) : Math.min(0.62, sat * (0.36 + 0.14 * i));
    const l = dark ? baseL + rung * i : baseL - rung * i;
    return hslTriple(hue, s2, Math.max(0.04, Math.min(0.995, l))).join(", ");
  };
  const accentL = fitLightness(hue, Math.min(0.74, sat + 0.1), dark ? 0.56 : 0.5, bgLum, 3.4, dark);
  const accentRgb = hslTriple(hue, Math.min(0.74, sat + 0.1), accentL);
  const accentInk = relativeLuminance(accentRgb[0], accentRgb[1], accentRgb[2]) > 0.34 ? "16, 20, 28" : "250, 252, 255";

  return {
    hue,
    sat,
    appTone: toneAt(0, 0.18),
    // A well (input, code block, inset) has to be *deeper* than the surface it sits in. In light mode
    // that means a higher rung; in dark mode the darkest one - the direction flips with the theme,
    // which is exactly what an "alpha only" ladder got wrong.
    wellTone: dark ? toneAt(0, 0.18) : toneAt(3, 0.26),
    panelTone: toneAt(2, 0.22),
    raisedTone: toneAt(3, 0.26),
    raisedHi: toneAt(4, 0.30),
    raisedDown: toneAt(1, 0.20),
    accent: accentRgb.join(", "),
    accentInk,
    line: hslTriple(hue, sat, lineL).join(", "),
    ink: hslTriple(hue, Math.min(0.72, sat + 0.12), inkL).join(", "),
    wash: hslTriple(hue, Math.min(0.75, sat + 0.14), washL).join(", "),
    tint: mode === "dark" ? 0.16 : 0.10,
    lineAlpha: mode === "dark" ? 0.5 : 0.4,
    fromArtwork: Boolean(usable),
    edge: hslTriple(edgeHue, edgeSat, edgeL).join(", "),
    edgeFromArtwork: Boolean(partner),
    spark: hslTriple(vivid?.h ?? hue, Math.min(0.85, (vivid?.s ?? sat) + 0.15), sparkL).join(", "),
    // 借光: the *colour of the light* the picture is lit by, not a colour from it.
    lightTint: (light?.warmth ?? 0) > 0.02 ? "255, 236, 205" : "214, 236, 255",
  };
}

/**
 * Build a nine-slice corner ornament as an inline SVG data URI.
 *
 * A CSS gradient can only draw straight lines, which is why an early attempt read as a dashed
 * "disabled" outline. SVG has no such limit - but restraint is the point: `tick` marks the
 * corners, `bracket` adds the hairline and a few edge figures, `rich` doubles the rule. None of
 * them ever paint the middle, so the tinted surface stays visible underneath.
 */
/**
 * Local ornament art, drawn as SVG.
 *
 * Two rules taken from how border-image ornaments are actually built:
 *   1. the source must be square and the corner slices square, or the corners come out smeared;
 *   2. edges must be a *repeatable unit* - `stretch` turns any edge motif into a straight line, which
 *      is exactly what "这个不像纹样" looks like. Hence the CSS says `round` for this art.
 *
 * The four variants are the ladder: a tick, a bracket, a rich rail with scrolls, and an ornate frame
 * with a rosette petal and a scaled edge in each corner.
 */
function frameDataUri(corner: string, edge: string, variant: "tick" | "bracket" | "rich" | "ornate"): string {
  const S = 96;
  const SL = 26; // square corner region
  const rich = variant === "rich" || variant === "ornate";
  const ornate = variant === "ornate";
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
  ];
  if (variant !== "tick") {
    parts.push(`<rect x="2" y="2" width="${S - 4}" height="${S - 4}" rx="18" stroke="${edge}" stroke-width="1.3" opacity=".9"/>`);
  }
  if (rich) {
    parts.push(`<rect x="8" y="8" width="${S - 16}" height="${S - 16}" rx="14" stroke="${edge}" stroke-width=".6" opacity=".4"/>`);
  }

  // The corner design is drawn once in the top-left orientation and placed four times with
  // transforms - mirroring by hand is how corners end up subtly different from each other.
  // The corner design is drawn once in the top-left orientation and placed four times with
  // transforms - mirroring by hand is how corners end up subtly different from each other.
  //
  // Placement note: DSH's panels carry a border-radius (32px on the settings dialog) which is wider
  // than this frame's painted band, and Chromium clips the border image to the rounded box. A motif
  // hugging the source's outer corner therefore gets shaved off. So the corner ornament sits toward
  // the *inner* corner of the tile, where the arc leaves it alone.
  const cornerArt: string[] = [
    `<path d="M 6 ${SL - 2} C 13 ${SL - 6}, 19 19, ${SL - 2} 6" stroke="${edge}" stroke-width="1.3" opacity=".9"/>`,
    `<circle cx="21" cy="21" r="4.6" stroke="${corner}" stroke-width="1.6" fill="none"/>`,
    `<circle cx="21" cy="21" r="1.9" fill="${corner}" stroke="none"/>`,
    `<path d="M 21 13.6 c 2.4 2 2.4 5 0 7.4 c -2.4 -2.4 -2.4 -5.4 0 -7.4" stroke="${edge}" stroke-width="1.1" opacity=".85"/>`,
    `<path d="M 13.6 21 c 2 2.4 5 2.4 7.4 0 c -2.4 -2.4 -5.4 -2.4 -7.4 0" stroke="${edge}" stroke-width="1.1" opacity=".85"/>`,
  ];
  if (ornate) {
    cornerArt.push(
      `<circle cx="21" cy="21" r="7.4" stroke="${edge}" stroke-width=".8" opacity=".55" fill="none"/>`,
      `<path d="M 15 15 l 3 3 l -3 3 l -3 -3 z" fill="${corner}" stroke="none"/>`,
      `<circle cx="9" cy="9" r="2.1" fill="${edge}" opacity=".8" stroke="none"/>`,
    );
  }
  const placed = cornerArt.join("");
  parts.push(`<g>${placed}</g>`);
  parts.push(`<g transform="translate(${S} 0) scale(-1 1)">${placed}</g>`);
  parts.push(`<g transform="translate(0 ${S}) scale(1 -1)">${placed}</g>`);
  parts.push(`<g transform="translate(${S} ${S}) scale(-1 -1)">${placed}</g>`);

  // Edge bands: a bead chain, and for the ornate variant a scalloped lace underneath it. Both are
  // laid out on a period that divides the band evenly, so tiling cannot produce a seam.
  // Edge bands. Each band is `band` long (it tiles along the length) and SL thick, so its motifs must
  // sit *inside* the thickness - drawing them at the source's midline would put them in the middle
  // slice, which border-image throws away. Hence outer=rail from the rects, centre=bead chain,
  // inner=lace. Everything is on a period that divides the band evenly, so tiling cannot seam.
  const band = S - SL * 2; // 44
  const beads = ornate ? 4 : 2; // dense chains read as a dotted outline; fewer, bigger marks read as design
  const step = band / beads;
  const outer = SL / 2; // ~13: the middle of the band's thickness
  for (let k = 0; k < beads; k++) {
    const x = SL + step / 2 + step * k;
    const r = ornate ? 3 : 2.4;
    parts.push(`<circle cx="${x}" cy="${outer}" r="${r}" fill="${edge}" stroke="none"/>`);
    parts.push(`<circle cx="${outer}" cy="${x}" r="${r}" fill="${edge}" stroke="none"/>`);
    if (ornate) {
      parts.push(`<path d="M ${x} ${SL - 5} l 2.6 2.6 l -2.6 2.6 l -2.6 -2.6 z" fill="${corner}" stroke="none"/>`);
      parts.push(`<path d="M ${SL - 5} ${x} l 2.6 2.6 l -2.6 2.6 l -2.6 -2.6 z" fill="${corner}" stroke="none"/>`);
    } else if (rich) {
      parts.push(`<path d="M ${x - step / 2 + 1.5} ${SL - 3} q ${step / 2 - 1.5} -6 ${step - 3} 0" stroke="${edge}" stroke-width=".8" opacity=".5"/>`);
      parts.push(`<path d="M ${SL - 3} ${x - step / 2 + 1.5} q -6 ${step / 2 - 1.5} 0 ${step - 3}" stroke="${edge}" stroke-width=".8" opacity=".5"/>`);
    }
  }
  parts.push(`</g></svg>`);
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(parts.join(""))}")`;
}

/**
 * A very small ortament for controls: one bold curl per corner plus a bead chain, drawn so it still
 * reads when it is painted only a few pixels thick. Painted through border-image, so it costs no
 * layout and cannot displace a neighbour.
 */
function cornerOrnamentDataUri(corner: string, edge: string): string {
  const S = 48;
  const SL = 14;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
  ];
  const cornerArt = [
    `<path d="M 0 ${SL - 4} C 0 4, 4 0, ${SL - 4} 0" stroke="${corner}" stroke-width="2.6"/>`,
    `<path d="M 2.5 ${SL - 2} C 7 ${SL - 3}, 11 7, 11.5 2.5" stroke="${edge}" stroke-width="1.1" opacity=".85"/>`,
    `<circle cx="5" cy="5" r="2" fill="${corner}" stroke="none"/>`,
  ].join("");
  parts.push(`<g>${cornerArt}</g>`);
  parts.push(`<g transform="translate(${S} 0) scale(-1 1)">${cornerArt}</g>`);
  parts.push(`<g transform="translate(0 ${S}) scale(1 -1)">${cornerArt}</g>`);
  parts.push(`<g transform="translate(${S} ${S}) scale(-1 -1)">${cornerArt}</g>`);
  const band = S - SL * 2;
  const mid = SL + band / 2;
  for (let k = 0; k < 2; k++) {
    const x = SL + band / 4 + (band / 2) * k;
    parts.push(`<circle cx="${x}" cy="${mid}" r="1.4" fill="${edge}" stroke="none"/>`);
    parts.push(`<circle cx="${mid}" cy="${x}" r="1.4" fill="${edge}" stroke="none"/>`);
  }
  parts.push(`</g></svg>`);
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(parts.join(""))}")`;
}

/** Palette entries are "r, g, b" triples straight out of the sampler. */
function parseTriple(triple: string): { r: number; g: number; b: number } {
  const [r, g, b] = triple.split(",").map((n) => Number(n.trim()));
  return { r: r || 128, g: g || 128, b: b || 128 };
}

/**
 * Build the decoration rules from one scheme.
 *
 * House rules, learned the hard way:
 *   1. one hue, three roles - never one colour per element;
 *   2. no textures. A diagonal stripe across a translucent panel reads as a placeholder asset and
 *      fights the wallpaper instead of settling into it;
 *   3. decoration scales with surface: a panel can carry a frame, a 30px button cannot. Putting
 *      the same ornament on both is what made the first attempt noisy;
 *   4. the tint always stays low-alpha, so the artwork behind is still the wallpaper.
 */
/** The knob a user gets for an applied frame: how thick, how strong, and where. */
/**
 * How much colour the interface takes on.
 *   wash  - every surface carries the picture's tint (the original route)
 *   marks - surfaces stay neutral, the colour appears only where it means something
 *   duo   - surface leans on the dominant hue, the picture's second hue is the signal colour
 */
type ColourStyle = "wash" | "marks" | "duo";

interface FrameOptions {
  scale: number;
  opacity: number;
  controls: boolean;
}

function accentCss(
  palette: string[],
  level: number,
  mode: Mode,
  chosenFrame: string,
  reading?: ArtworkReading | null,
  frame: FrameOptions = { scale: 1, opacity: 1, controls: false },
  colourStyle: ColourStyle = "wash",
): string {
  const scheme = deriveScheme(palette, mode, reading?.light, level);
  const root = `body[${BODY_ATTR}][${ACCENT_ATTR}]`;
  const small = `${root} [${ACCENT_MARK}="small"]`;
  const panel = `${root} [${ACCENT_MARK}="panel"]`;
  const both = `${small}, ${panel}`;
  const { line, ink, wash, lightTint, spark, edge, panelTone, wellTone, raisedTone, raisedHi, raisedDown, accent, accentInk } = scheme;
  // 只染三处: with the surface neutral, the glass itself carries the picture's colour and we only
  // mark what is interactive - which is also what stops the UI looking like every wallpaper theme.
  const neutralWash = mode === "dark" ? "10,14,22" : "255,255,255";
  const neutralInk = mode === "dark" ? "236,243,255" : "20,26,38";
  // marks keeps the surfaces neutral (the glass carries the colour); wash and duo paint the ladder.
  const painting = colourStyle !== "marks";
  const panelFill = painting ? panelTone : neutralWash;
  const controlFill = painting ? raisedTone : neutralWash;
  const signal = colourStyle === "duo" ? edge : spark;
  // A thin wash of light in every mode - this is 借光, not a colour stain, so even the neutral mode
  // keeps it. Card: only the marks mode leans on it on its own.
  const surfaceGradient = (toDark: string, levelTint: number): string =>
    colourStyle === "marks"
      ? `linear-gradient(to ${toDark}, rgba(${lightTint}, ${(0.10 + levelTint).toFixed(3)}), rgba(0,0,0,0))`
      : `linear-gradient(to ${toDark}, rgba(${lightTint}, ${(0.14 + levelTint).toFixed(3)}), rgba(${wash}, ${(levelTint * 0.35).toFixed(3)}), rgba(${wash}, 0.02))`;
  const lines: string[] = [];
  const finish = (): string => `${lines.join("\n")}\n${tokenLanguage(scheme, mode)}`;

  // Shared base: a low-alpha tint plus one hairline. This is the whole of level 0.
  //
  // The hairline is drawn with `outline` rather than `border`: outline costs no layout, cannot eat
  // a control's existing box-shadow, and `:not(:focus-visible)` keeps DSH's focus ring intact.
  // Softened: a full-strength hairline everywhere read as "disabled outline" rather than design. -1px
  // offset keeps it hugging the shape.
  // How much of the wallpaper the surfaces cover, per rung. Level 0 is a whisper (the hairline is
  // the visible thing); by 4 the ladder is at its most solid. Depth comes from the *steps between*
  // rungs - this knob only decides how much picture stays visible underneath.
  const cover = (mode === "dark" ? [0.06, 0.34, 0.52, 0.64, 0.72] : [0.08, 0.42, 0.6, 0.7, 0.78])[level] ?? 0.06;
  const alpha = [0.22, 0.28, 0.33, 0.38, 0.43][level] ?? 0.22;
  const hairline = (sel: string) =>
    `${sel}:not(:focus-visible) {\n  outline: 1px solid rgba(${line}, ${alpha}) !important;\n  outline-offset: -1px !important;\n}`;

  // 借光 (borrowed light): the surface is lit by the picture's own light. A directional gradient
  // replaces the flat tint, the edge nearest the light catches a bright hairline and the far side
  // sinks. This is what makes the UI belong to the scene instead of sitting on top of it - and it
  // costs nothing but a 3×3 brightness read.
  const fromTop = (reading?.light.dirY ?? -1) <= 0;
  const fromLeft = (reading?.light.dirX ?? -1) <= 0;
  const toDark = `${fromTop ? "bottom" : "top"} ${fromLeft ? "right" : "left"}`;
  const litEdge = fromTop ? "inset 0 1px 0" : "inset 0 -1px 0";
  // Panels sit *below* controls on the ladder, and each rung keeps the picture's light on top of its
  // tone - that is where the layering comes from: two knobs (tone and cover) moving together.
  lines.push(
    `${panel} {`,
    `  background-color: rgba(${panelFill}, ${(cover * 0.92).toFixed(3)}) !important;`,
    `  background-image: ${surfaceGradient(toDark, cover * 0.2)} !important;`,
    `  box-shadow: ${litEdge} rgba(${lightTint}, .30) !important;`,
    `  transition: background-color 4s ease, outline-color 4s ease, box-shadow 4s ease !important;`,
    `}`,
    `${small} {`,
    `  background-color: rgba(${controlFill}, ${cover.toFixed(3)}) !important;`,
    `  background-image: ${surfaceGradient(toDark, cover * 0.24)} !important;`,
    `  box-shadow: ${litEdge} rgba(${lightTint}, .22) !important;`,
    `  transition: background-color .18s ease, filter .18s ease, transform .18s ease, outline-color .18s ease !important;`,
    `}`,
  );
  // 让位 (yield): where the picture is busy, decoration steps back - less tint, no gradient, no
  // frame, and only a quarter-strength line (a control still has to read as a control). This is
  // the fix for ornaments fighting the subject.
  lines.push(
    `${root} [${ACCENT_MARK}][data-dsh-skin-busy="1"] {`,
    `  background-color: rgba(${neutralWash}, ${(cover * 0.22).toFixed(3)}) !important;`,
    `  background-image: none !important;`,
    `  border-image-source: none !important;`,
    `  outline-color: rgba(${line}, ${(alpha * 0.45).toFixed(3)}) !important;`,
    `}`,
  );
  // 火花 (the spark): the picture's most vivid colour is reserved for "you can touch this" -
  // hover, focus, pressed and selected. Used nowhere else, so it stays meaningful.
  lines.push(
    `${root} [${ACCENT_MARK}]:hover { outline-color: rgba(${signal}, .8) !important; border-color: rgba(${signal}, .7) !important; }`,
    `${root} [${ACCENT_MARK}]:focus-visible { outline-color: rgba(${signal}, .85) !important; }`,
    `${root} [${ACCENT_MARK}][aria-pressed="true"], ${root} [${ACCENT_MARK}][aria-selected="true"], ${root} [${ACCENT_MARK}][data-on="true"], ${root} [${ACCENT_MARK}][data-active="true"] {`,
    `  outline-color: rgba(${signal}, .85) !important;`,
    `  border-color: rgba(${signal}, .8) !important;`,
    `}`,
  );

  // Controls get a little craft without touching their own background or shadow: a hover that lifts a
  // pixel and warms very slightly, a press that settles back, and the picture's spark on the edge.
  // (Box-shadow and border are left alone deliberately - DSH's own button styles stay intact.)
  // A control climbs one rung on hover and drops one when pressed - the smallest possible amount of
  // motion that still feels physical.
  lines.push(
    `${small}:hover:not(:disabled) {`,
    `  background-color: rgba(${painting ? raisedHi : neutralWash}, ${Math.min(0.9, cover + 0.12).toFixed(3)}) !important;`,
    `  filter: brightness(1.04) !important;`,
    `  transform: translateY(-1px);`,
    `}`,
    `${small}:active:not(:disabled) {`,
    `  background-color: rgba(${painting ? raisedDown : neutralWash}, ${Math.max(0.18, cover - 0.1).toFixed(3)}) !important;`,
    `  transform: translateY(0);`,
    `}`,
    // The accent rung: a selected tab / pressed toggle / active item takes the picture's colour for
    // real, which is the one place a text colour has to be chosen for it.
    `${root} [${ACCENT_MARK}][aria-pressed="true"], ${root} [${ACCENT_MARK}][aria-selected="true"], ${root} [${ACCENT_MARK}][data-on="true"], ${root} [${ACCENT_MARK}][data-active="true"] {`,
    `  background-color: rgba(${accent}, .78) !important;`,
    `  background-image: none !important;`,
    `  color: rgb(${accentInk}) !important;`,
    `  outline-color: rgba(${accent}, .95) !important;`,
    `  border-color: rgba(${accent}, .9) !important;`,
    `}`,
  );
  if (colourStyle !== "marks") lines.push(hairline(`${small}:not([data-dsh-skin-busy="1"])`));
  else
    lines.push(
      `${small}:focus-visible:not([data-dsh-skin-busy="1"]) {`,
      `  outline: 1px solid rgba(${ink}, .55) !important;`,
      `  outline-offset: -1px !important;`,
      `}`,
    );

  // Some of DSH's own controls paint a colour that never came from a token: the selected preset
  // card is a flat hard blue (`#2464db`), the "in use" chip is near-black (`#111`), and the little
  // code box (`standard`, `ptc`) uses text and background that are almost the same. They read as
  // "pasted on" - a different material from the glass around them. Re-point each at a role from our
  // own scheme, keyed on the class *suffix* so it survives DSH rebuilds.
  lines.push(
    `${root} [class*="_cardMain"][aria-pressed="true"] {`,
    `  background-color: rgba(${accent}, .82) !important;`,
    `  border-color: rgba(${accent}, .95) !important;`,
    `  color: rgb(${accentInk}) !important;`,
    `}`,
    `${root} [class*="_inUse"] {`,
    `  background-color: rgba(${ink}, .88) !important;`,
    `  color: rgb(${raisedHi}) !important;`,
    `}`,
    `${root} code[class*="_cardId"], ${root} [class*="_cardId"] {`,
    `  background-color: rgba(${wellTone}, .72) !important;`,
    `  color: rgb(${ink}) !important;`,
    `}`,
    `${root} [class*="_tag"] {`,
    `  background-color: rgba(${wellTone}, .62) !important;`,
    `  color: rgb(${ink}) !important;`,
    `}`,
  );

  // One quiet line per panel: in marks mode it is a neutral one, so the only colour on screen is
  // something you can act on.
  const panelLine =
    colourStyle === "marks"
      ? hairline(`${panel}:not([data-dsh-skin-busy="1"])`).replace(`rgba(${line}, `, `rgba(${neutralInk}, `).replace(`, ${alpha})`, ", .16)")
      : hairline(`${panel}:not([data-dsh-skin-busy="1"])`);
  if (level === 0) {
    lines.push(panelLine);
    return finish();
  }
  // 纹饰已下线：面板不再套任何花框、控件也不再戴角饰，这一档只调颜色。
  // (The ornament builders below are kept for when this path comes back; nothing calls them.)
  lines.push(panelLine);
  return finish();

}

/** Fade an image's alpha without touching its geometry, so "透明度" can apply to a生成的花纹. */
async function fadeImage(url: string, alpha: number): Promise<string> {
  const key = `${url}@${alpha.toFixed(2)}`;
  const cached = fadeCache.get(key);
  if (cached) return cached;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return url;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, 0, 0);
    const out = canvas.toDataURL("image/png");
    fadeCache.set(key, out);
    return out;
  } catch {
    return url;                                    // cross-origin or undecodable: keep as-is
  }
}

/** Reflect the configured level + artwork onto the skeleton. */
async function applyAccent(value: SkinValue, mode: Mode, commit?: Commit, refresh = false): Promise<void> {
  const style = soleStyle(ACCENT_STYLE_ID);
  const raw = Number(value.accentLevel ?? 0);
  const level = Number.isFinite(raw)
    ? Math.max(0, Math.min(ACCENT_LEVELS.length - 1, Math.round(raw)))
    : 0;
  const wallpaper = resolveAreaImage(value, "window", mode);

  // The raw level goes to the stylesheet: 0-2 choose the local weight, and 3-4 use the generated
  // frame. Capping it here first (as this used to) made the generated ornament unreachable - the
  // `level >= 3` branch inside accentCss could never be true. The body attribute is only a CSS
  // selector flag, so it carries the real level too, which is also nicer to debug.
  const effective = level;

  if (!wallpaper || value.accentEnabled === false) {
    document.body.removeAttribute(ACCENT_ATTR);
    dropStyles(ACCENT_STYLE_ID);
    accentTargets.forEach((el) => el.removeAttribute(ACCENT_MARK));
    accentTargets = [];
    return;
  }

  // A new wallpaper must be read *now*, not when the breathing timer next fires: switching the
  // picture is the one moment the scheme visibly has to change, and a cache hit for a re-uploaded
  // file would keep the old colours.
  // Re-read only when this mode swaps to a *different* piece of artwork. A first paint in a mode -
  // which is exactly what a light<->dark flip is - must NOT force a re-sample: the other mode's
  // artwork was already read by the warm pass, and re-reading it here is the ~0.8s the tint used to
  // spend before moving. A genuine wallpaper swap lands on a cache miss anyway (each upload gets its
  // own key), so nothing is lost.
  const previous = lastWallpaper[mode];
  const wallpaperChanged = previous !== null && previous !== wallpaper;
  lastWallpaper[mode] = wallpaper;
  const reading = await sampleArtwork(wallpaper, refresh || wallpaperChanged);
  const palette = reading?.palette ?? [];
  if (!palette.length) {
    document.body.removeAttribute(ACCENT_ATTR);
    dropStyles(ACCENT_STYLE_ID);
    return;
  }

  // 呼吸: keep the first hue for this wallpaper, and hold rather than jump when a video frame
  // drifts somewhere else entirely. Small drift is the point; a colour swing is not.
  //
  // The guard used to be 25°, which turned out to be tight enough that a wallpaper whose *scene*
  // changes (a clip that cuts from daylight sky to a pink nebula) could never be followed at all -
  // the theme stayed on the first scene's colour for the whole loop. 60° lets a real scene change
  // through while still swallowing frame-to-frame jitter.
  const frameHue = seedHueOf(palette);
  if (!breathSeed || breathSeed.url !== wallpaper) breathSeed = { url: wallpaper, hue: frameHue };
  else if (refresh && breathSeed.hue !== null && frameHue !== null && hueDistance(frameHue, breathSeed.hue) > 60) {
    // A jump this large is a new scene, not drift: adopt it as the new seed and follow on from there.
    breathSeed = { url: wallpaper, hue: frameHue };
  } else if (breathSeed.hue === null && frameHue !== null) {
    breathSeed.hue = frameHue;
  }

  // Hand the sampled colours to the AI half: without them the generation prompt could only say
  // "colours sampled from the wallpaper", which an image model has no way of seeing. Written
  // back through settings so the AI screen sends them.
  //
  // Guarded by a local marker *and* by the stored value, because a write makes the snapshot
  // stale for a moment: without this, each setting change re-entered here, saw the old stored
  // value, and wrote again - a write loop that re-rendered the whole settings panel several times
  // a second and swallowed every click and drag inside it (2026-09-25, "点击不了/拖不动").
  const joined = palette.join("|");
  const writeKey = `${wallpaper}|${joined}`;
  if (commit && paletteWriteKey !== writeKey && String(value.accentPalette ?? "") !== joined) {
    paletteWriteKey = writeKey;
    // 借材: the material read travels with the palette so the AI half can ask for the right kind of
    // ornament (silver for a night sky, gold leaf for paper, ...).
    void commit({ accentPalette: joined, accentMaterial: reading?.material ?? "plain" });
  }

  accentTargets = scanAccentTargets();
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  accentTargets.forEach((el) => {
    el.setAttribute(ACCENT_MARK, accentRole(el));
    // 让位: look up how busy the picture is under this element's centre.
    //
    // Only for chrome that sits *directly* on the picture. A control inside a panel or a dialog has
    // our own tinted surface behind it, so "the picture is busy there" says nothing about it - and
    // treating it as busy stripped the colour off every button in the settings dialog (the buttons
    // fell back to DSH's own faint white fill, which is what read as a compatibility problem).
    const rect = el.getBoundingClientRect();
    const overPicture =
      !el.closest(`[${ACCENT_MARK}="panel"]`) &&
      !el.closest('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]');
    const busy = reading && overPicture ? busyUnder(reading, (rect.left + rect.width / 2) / vw, (rect.top + rect.height / 2) / vh) : 0;
    el.setAttribute(BUSY_ATTR, busy > 0.55 ? "1" : "0");
  });
  document.body.setAttribute(ACCENT_ATTR, String(effective));

  const frameUrl = String(value.accentFrame ?? "");
  // The knobs for an applied frame: thickness, strength, and whether it also clothes controls.
  const frameOpts: FrameOptions = {
    scale: Math.min(1.6, Math.max(0.6, Number(value.accentFrameScale ?? 1) || 1)),
    opacity: Math.min(1, Math.max(0.3, Number(value.accentFrameOpacity ?? 1) || 1)),
    controls: value.accentFrameControls === true,
  };
  // A generated frame gets its flat background knocked out first, or the panel wears a band of
  // whatever colour the model painted behind the ornament (usually white). Fading only happens when
  // the opacity knob asks for it, so an opaque frame is not needlessly re-encoded.
  const artUrl = frameUrl
    ? frameOpts.opacity < 1
      ? await fadeImage(await keyOutBackground(frameUrl), frameOpts.opacity)
      : await keyOutBackground(frameUrl)
    : frameUrl;
  const colourStyle = (String(value.accentMode ?? "wash") as ColourStyle) || "wash";
  style.textContent = accentCss(palette, effective, mode, artUrl, reading, frameOpts, colourStyle);
}

function disposeAccent(): void {
  dropStyles(ACCENT_STYLE_ID);
  document.body.removeAttribute(ACCENT_ATTR);
  document.querySelectorAll<HTMLElement>(`[${ACCENT_MARK}]`).forEach((el) => {
    el.removeAttribute(ACCENT_MARK);
    el.removeAttribute(BUSY_ATTR);
  });
  accentTargets = [];
  breathSeed = null;
  lastWallpaper.light = null;
  lastWallpaper.dark = null;
}

// ── regions ─────────────────────────────────────────────────────────────────

function clearRegionStyle(el: HTMLElement): void {
  el.removeAttribute("data-dsh-skin-region");
  el.style.removeProperty("background-image");
  el.style.removeProperty("background-size");
  el.style.removeProperty("background-repeat");
  el.style.removeProperty("background-position");
}

/** The live surface element for a region id, if it happens to be mounted right now. */
function regionSurface(id: string): HTMLElement | null {
  for (const sel of REGION_SELECTORS[id] ?? []) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

/** True when the mounted surface already carries our image for this region. */
function regionApplied(id: string, image: string): boolean {
  const surface = regionSurface(id);
  if (!surface) return true; // region not mounted — nothing to repair
  if (document.querySelector<HTMLElement>(`[data-dsh-skin-region="${id}"]`) !== surface) return false;
  return surface.style.getPropertyValue("background-image").includes(image);
}

function applyRegionImage(id: string, value: SkinValue, mode: Mode, force = false): void {
  const image = resolveAreaImage(value, id, mode);
  const on = value.enabled !== false && value[`${id}Enabled`] !== false && image.length > 0;
  if (!force && on && regionApplied(id, image)) return; // already painted on the live surface
  document.querySelectorAll<HTMLElement>(`[data-dsh-skin-region="${id}"]`).forEach(clearRegionStyle);
  if (!on) return;
  const surface = regionSurface(id);
  if (!surface) return;
  const { size, repeat } = fitProps(String(value[`${id}Fit`] ?? "cover"));
  const dx = Number(value[`${id}OffsetX`] ?? 0);
  const dy = Number(value[`${id}OffsetY`] ?? 0);
  surface.setAttribute("data-dsh-skin-region", id);
  surface.style.setProperty("background-image", `url("${image}")`, "important");
  surface.style.setProperty("background-size", size, "important");
  surface.style.setProperty("background-repeat", repeat, "important");
  surface.style.setProperty("background-position", `calc(50% + ${Math.round(dx)}px) calc(50% + ${Math.round(dy)}px)`, "important");
}

// ── stickers (draggable / resizable) ────────────────────────────────────────

type Commit = (patch: Record<string, unknown>) => void;

function cornerCss(corner: string): string {
  switch (corner) {
    case "tr":
      return "top:6px;right:6px;";
    case "bl":
      return "bottom:6px;left:6px;";
    case "br":
      return "bottom:6px;right:6px;";
    case "top":
      return "top:-72px;left:8px;";
    default:
      return "top:6px;left:6px;";
  }
}

function attachDrag(
  el: HTMLElement,
  id: string,
  value: SkinValue,
  commit: Commit,
  scaleOf: (base: number) => number,
): void {
  let dragging = false;
  let sx = 0;
  let sy = 0;
  let bx = 0;
  let by = 0;
  el.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).dataset.skinHandle) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    el.setPointerCapture(e.pointerId);
    sx = e.clientX;
    sy = e.clientY;
    bx = Number(value[`${id}OffsetX`] ?? 0);
    by = Number(value[`${id}OffsetY`] ?? 0);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    el.style.translate = `${e.clientX - sx}px ${e.clientY - sy}px`;
  });
  const finish = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    el.style.translate = "";
    commit({ [`${id}OffsetX`]: Math.round(bx + dx), [`${id}OffsetY`]: Math.round(by + dy) });
    scaleOf(1);
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
}

function applySticker(area: AreaDef, value: SkinValue, mode: Mode, editing: boolean, commit: Commit): void {
  const image = resolveAreaImage(value, area.id, mode);
  const on = value.enabled !== false && value[`${area.id}Enabled`] !== false && image.length > 0;
  const scale = Number(value[`${area.id}Scale`] ?? 100) / 100;
  const dx = Number(value[`${area.id}OffsetX`] ?? 0);
  const dy = Number(value[`${area.id}OffsetY`] ?? 0);
  // Rebuilding a sticker re-decodes its image and restarts a sticker video, so if nothing
  // that affects it changed and it is still mounted, leave it exactly where it is.
  const signature = `${on ? image : "-"}|${scale}|${dx}|${dy}|${editing}`;
  const mounted = document.querySelector<HTMLElement>(`[data-dsh-skin-sticker="${area.id}"]`);
  if (stickerSignatures[area.id] === signature && (!on || mounted)) return;
  stickerSignatures[area.id] = signature;
  document.querySelectorAll<HTMLElement>(`[data-dsh-skin-sticker="${area.id}"]`).forEach((el) => el.remove());
  if (!on || !area.sel) return;
  const target = document.querySelector<HTMLElement>(area.sel);
  if (!target) return;
  if (getComputedStyle(target).position === "static") {
    target.style.position = "relative";
    target.setAttribute("data-dsh-skin-sticker-host", "");
  }
  const size = Math.max(8, Math.round(72 * scale));

  // Wrapper div is required: <img> is a void element and cannot hold the resize handle.
  const box = document.createElement("div");
  box.setAttribute("data-dsh-skin-sticker", area.id);
  box.style.cssText = [
    "position:absolute",
    "z-index:40",
    `width:${size}px`,
    `height:${size}px`,
    `opacity:var(${IMG_ALPHA_VAR},1)`,
    `transform:translate(${Math.round(dx)}px, ${Math.round(dy)}px)`,
    cornerCss(area.corner ?? "tl"),
    editing ? "pointer-events:auto;cursor:move;outline:2px dashed #5aa7d8;outline-offset:2px" : "pointer-events:none",
  ].join(";");

  // The upload picker accepts video for every area, so a sticker has to be able to play
  // one too — an <img> pointed at an mp4 renders nothing at all.
  const mediaStyle = "width:100%;height:100%;object-fit:contain;display:block;pointer-events:none";
  let media: HTMLElement;
  if (VIDEO_RE.test(image)) {
    const video = document.createElement("video");
    video.src = image;
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = mediaStyle;
    video.defaultPlaybackRate = videoRate(value);
    video.playbackRate = videoRate(value);
    void video.play?.().catch(() => {});
    media = video;
  } else {
    const img = document.createElement("img");
    img.src = image;
    img.alt = "";
    img.draggable = false;
    img.setAttribute("aria-hidden", "true");
    img.style.cssText = mediaStyle;
    media = img;
  }
  box.append(media);
  target.append(box);
  if (!editing) return;

  attachDrag(box, area.id, value, commit, () => scale);

  // resize handle (bottom-right)
  const handle = document.createElement("span");
  handle.dataset.skinHandle = "1";
  handle.style.cssText =
    "position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;border-radius:50%;background:#5aa7d8;border:2px solid #fff;cursor:nwse-resize;pointer-events:auto;z-index:41";
  box.append(handle);
  let resizing = false;
  let rsx = 0;
  let baseScale = Number(value[`${area.id}Scale`] ?? 100);
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    handle.setPointerCapture(e.pointerId);
    rsx = e.clientX;
    baseScale = Number(value[`${area.id}Scale`] ?? 100);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const next = Math.max(10, Math.min(400, baseScale + (e.clientX - rsx)));
    const s = Math.round(72 * (next / 100));
    box.style.width = `${s}px`;
    box.style.height = `${s}px`;
  });
  const finishResize = (e: PointerEvent) => {
    if (!resizing) return;
    resizing = false;
    const next = Math.max(10, Math.min(400, baseScale + (e.clientX - rsx)));
    commit({ [`${area.id}Scale`]: Math.round(next) });
  };
  handle.addEventListener("pointerup", finishResize);
  handle.addEventListener("pointercancel", finishResize);
}

/** Enter/leave the on-page position editor. */
function setEditing(id: string | null): void {
  currentEditing = id;
  ensureFinishButton();
  reapply?.();
}

function ensureFinishButton(): void {
  if (currentEditing && !finishButton) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "完成";
    btn.setAttribute("data-dsh-skin-chrome", "finish");
    btn.style.cssText = [
      "position:fixed",
      "right:24px",
      "bottom:110px",
      "z-index:2147483000",
      "padding:10px 24px",
      "border:none",
      "border-radius:999px",
      "background:#5aa7d8",
      "color:#fff",
      "font-size:15px",
      "font-weight:600",
      "cursor:pointer",
      "box-shadow:0 8px 24px -6px rgba(0,0,0,.45)",
    ].join(";");
    btn.addEventListener("click", () => setEditing(null));
    document.body.append(btn);
    finishButton = btn;
  } else if (!currentEditing && finishButton) {
    finishButton.remove();
    finishButton = null;
  }
}

// ── apply all ───────────────────────────────────────────────────────────────

function applyAll(value: SkinValue, editingId: string | null, commit: Commit, mode: Mode, fade = false): void {
  applyWindow(value, mode, fade);
  applyPanelOpacity(value, mode);
  for (const area of AREAS) {
    if (area.id === "window") continue;
    if (area.kind === "sticker") applySticker(area, value, mode, editingId === area.id, commit);
    // On a theme switch (fade) only the regions whose image actually changed repaint; a
    // settings edit still forces a repaint so fit/offset changes take effect.
    else applyRegionImage(area.id, value, mode, !fade);
  }
  scheduleWarmOtherMode(value, mode);
  // Fire-and-forget: palette extraction awaits an image decode, and nothing on screen should
  // wait for decoration to catch up.
  void applyAccent(value, mode, commit);
}

// ── repair pass ─────────────────────────────────────────────────────────────
// Region hosts (`_hero`, `_pane`, `_composerSeat`, …) mount and unmount while the
// app runs, and a re-render can replace the element carrying our inline background.
// This throttled pass repaints only what is actually missing, and never touches
// stickers, so an in-progress drag is not interrupted.

const REFRESH_DELAY_MS = 300;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let readSkinValue: (() => SkinValue | undefined) | null = null;
let readSkinMode: (() => Mode) | null = null;

/** Repaint the window columns and every region whose live surface lost its image. */
function refreshRegions(): void {
  const value = readSkinValue?.();
  if (!value) return;
  const mode = readSkinMode ? readSkinMode() : readMode();
  const windowImage = resolveAreaImage(value, "window", mode);
  const columnsOn = value.enabled !== false && value.windowEnabled !== false && windowImage.length > 0 && !VIDEO_RE.test(windowImage);
  if (columnsOn) {
    const columns = Array.from(document.querySelectorAll<HTMLElement>('[class*="_sidebarCol"]'));
    if (columns.some((el) => !el.style.getPropertyValue("background-image"))) applyWindowColumns(windowImage);
  }
  for (const area of AREAS) {
    if (area.kind === "sticker" || area.id === "window") continue;
    applyRegionImage(area.id, value, mode, false);
  }
}

function scheduleRegionRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshRegions();
    refreshAccent?.();
  }, REFRESH_DELAY_MS);
}

// ── settings UI ─────────────────────────────────────────────────────────────

// ── small controls ──────────────────────────────────────────────────────────

/** Subscribable view of the current scheme, so React consumers follow theme changes. */
interface ModeStore {
  get(): Mode;
  pick(mode: Mode): void;
  subscribe(cb: () => void): () => void;
  notify(): void;
}

function makeModeStore(theme?: ThemeFace): ModeStore {
  let listeners: Array<() => void> = [];
  return {
    get: () => readMode(theme),
    pick(mode: Mode) {
      try {
        // Start the transition window up front: `theme/change` usually arrives before the
        // palette is repainted, but we do not want to depend on that ordering.
        startThemeAnimation();
        theme?.setTheme(mode);
      } catch (error) {
        console.error("[dsh-image-skin] could not switch the theme", error);
      }
    },
    subscribe(cb: () => void) {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    notify() {
      for (const l of listeners) l();
    },
  };
}

/** Sun glyph, drawn from primitives (no icon font, no image asset). */
function SunIcon(props: { size: number }): React.ReactElement {
  const h = React.createElement;
  return h(
    "svg",
    { width: props.size, height: props.size, viewBox: "0 0 24 24", "aria-hidden": "true" },
    h("circle", { cx: 12, cy: 12, r: 4.6, fill: "currentColor" }),
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return h("line", {
        key: deg,
        x1: 12 + Math.cos(rad) * 7.3,
        y1: 12 + Math.sin(rad) * 7.3,
        x2: 12 + Math.cos(rad) * 10.2,
        y2: 12 + Math.sin(rad) * 10.2,
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
      });
    }),
  );
}

/** Crescent moon, drawn as a masked disc with a per-instance mask id. */
function MoonIcon(props: { size: number }): React.ReactElement {
  const h = React.createElement;
  const maskId = React.useMemo(() => `dsh-skin-moon-${Math.random().toString(36).slice(2, 8)}`, []);
  return h(
    "svg",
    { width: props.size, height: props.size, viewBox: "0 0 24 24", "aria-hidden": "true" },
    h(
      "mask",
      { id: maskId },
      h("rect", { x: 0, y: 0, width: 24, height: 24, fill: "#fff" }),
      h("circle", { cx: 16.5, cy: 8.5, r: 7.7, fill: "#000" }),
    ),
    h("circle", { cx: 12, cy: 12, r: 8.3, fill: "currentColor", mask: `url(#${maskId})` }),
  );
}

const modeLabel = (m: Mode): string => (m === "dark" ? "深色模式" : "浅色模式");

/**
 * Light/dark control, in two sizes:
 *  - `footer` — the switch beside Settings in the sidebar foot. It measures the tallest
 *    sibling button (the Settings trigger) and matches that height, so the two read as
 *    equally sized neighbours.
 *  - `card` — the two large entry buttons at the top of the plugin's settings page, which
 *    lead into the per-mode image menus.
 */
function ModeSwitch(props: { mode: Mode; onPick: (m: Mode) => void; variant: "footer" | "card" }): React.ReactElement {
  const h = React.createElement;

  if (props.variant === "card") {
    return h(
      "div",
      { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
      ...(["light", "dark"] as Mode[]).map((m) => {
        const active = props.mode === m;
        return h(
          "button",
          {
            key: m,
            type: "button",
            "aria-pressed": active,
            onClick: () => props.onPick(m),
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "18px 12px",
              cursor: "pointer",
              font: "inherit",
              borderRadius: 14,
              border: `1px solid ${active ? "var(--dsw-alias-brand-primary,#5aa7d8)" : "var(--dsw-alias-border-l2,rgba(128,128,128,.3))"}`,
              background: active ? "var(--dsw-alias-brand-primary,#5aa7d8)" : "var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))",
              color: active ? "#fff" : "inherit",
            },
          },
          h(m === "dark" ? MoonIcon : SunIcon, { size: 30 }),
          h("span", { style: { fontWeight: 600 } }, modeLabel(m)),
          h("small", { style: { opacity: 0.75 } }, active ? "正在使用" : "点击进入"),
        );
      }),
    );
  }

  const ref = React.useRef<HTMLButtonElement | null>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  React.useEffect(() => {
    const mine = ref.current;
    if (!mine) return;
    let node: HTMLElement | null = mine.parentElement;
    for (let depth = 0; depth < 3 && node; depth++) {
      const others = Array.from(node.querySelectorAll("button")).filter((b) => b !== mine && !mine!.contains(b));
      if (others.length > 0) {
        const tallest = others.reduce((acc, b) => Math.max(acc, b.getBoundingClientRect().height), 0);
        if (tallest > 0) setHeight(Math.round(tallest));
        break;
      }
      node = node.parentElement;
    }
  }, []);
  const cell = (m: Mode) => {
    const active = props.mode === m;
    return h(
      "span",
      {
        key: m,
        title: modeLabel(m),
        onClick: (e: any) => {
          e.stopPropagation();
          props.onPick(m);
        },
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          alignSelf: "stretch",
          borderRadius: 8,
          background: active ? "var(--dsw-alias-brand-primary,#5aa7d8)" : "transparent",
          color: active ? "#fff" : "var(--dsw-alias-label-secondary,currentColor)",
          transition: "background 160ms ease, color 160ms ease",
        },
      },
      h(m === "dark" ? MoonIcon : SunIcon, { size: 17 }),
    );
  };
  return h(
    "button",
    {
      ref,
      type: "button",
      title: `切换到${props.mode === "dark" ? "浅色" : "深色"}模式`,
      "aria-label": "浅色 / 深色模式",
      onClick: () => props.onPick(props.mode === "dark" ? "light" : "dark"),
      style: {
        display: "inline-flex",
        alignItems: "stretch",
        justifyContent: "center",
        gap: 2,
        padding: 2,
        margin: 0,
        height: height ? `${height}px` : "100%",
        minHeight: 30,
        minWidth: 66,
        alignSelf: "stretch",
        cursor: "pointer",
        borderRadius: 10,
        border: "1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3))",
        background: "var(--dsw-alias-bg-layer-2,rgba(128,128,128,.10))",
      },
    },
    cell("light"),
    cell("dark"),
  );
}

/** Slider row with a debounced commit — used for panel opacity and video rate. */
function SliderRow(props: {
  title: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  onPreview: (n: number) => void;
  onCommit: (n: number) => void;
}): React.ReactElement {
  const h = React.createElement;
  const [draft, setDraft] = React.useState<number>(props.value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    setDraft(props.value);
  }, [props.value]);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const handle = (n: number) => {
    setDraft(n);
    props.onPreview(n);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      props.onCommit(n);
    }, 350);
  };
  return h(
    "div",
    { className: "dshImgSkin-row" },
    h(
      "div",
      { className: "dshImgSkin-head" },
      h(
        "div",
        null,
        h("span", { className: "dshImgSkin-title" }, props.title),
        h("small", { className: "dshImgSkin-hint" }, props.hint),
      ),
      h("span", null, props.format(draft)),
    ),
    h("input", {
      type: "range",
      min: props.min,
      max: props.max,
      step: props.step,
      value: draft,
      onChange: (e: any) => handle(Number(e.target.value)),
    }),
  );
}

/** One area card: thumbnail, source tag, upload (per-mode or shared), clear, fit, sticker editor. */
function AreaRow(props: {
  area: AreaDef;
  value: SkinValue;
  mode: Mode;
  busyField: string | null;
  editing: boolean;
  tip: boolean;
  onPick: (file: File, field: string) => void;
  onSet: (field: string, v: unknown) => void;
  onClear: (field: string) => void;
  onToggleEdit: (id: string) => void;
}): React.ReactElement {
  const h = React.createElement;
  const area = props.area;
  const v = props.value;
  const modeWord = props.mode === "dark" ? "深色" : "浅色";
  const specificField = `${area.id}Image${props.mode === "dark" ? "Dark" : "Light"}`;
  const sharedField = `${area.id}Image`;
  const specific = String(v[specificField] ?? "");
  const sharedImage = String(v[sharedField] ?? "");
  const effective = resolveAreaImage(v, area.id, props.mode);
  const sourceKind = specific ? "mode" : sharedImage ? "shared" : "none";
  const sourceLabel =
    sourceKind === "mode" ? `${modeWord}专用` : sourceKind === "shared" ? "两模式通用" : "未设置";
  const enabled = v[`${area.id}Enabled`] !== false;
  const fit = String(v[`${area.id}Fit`] ?? "cover");
  const isVideo = effective.length > 0 && VIDEO_RE.test(effective);
  const busy = props.busyField === specificField;

  // A file picker bound to one target field. Rendered as a label so the whole button is
  // clickable; the input itself stays hidden.
  const picker = (key: string, label: string, field: string, variant?: string) =>
    h(
      "label",
      { key, className: "dshImgSkin-btn", "data-variant": variant },
      props.busyField === field ? "上传中…" : label,
      h("input", {
        type: "file",
        accept: "image/*,video/*",
        style: { display: "none" },
        onChange: (e: any) => {
          const file = e.target.files?.[0];
          if (file) props.onPick(file, field);
          e.target.value = "";
        },
      }),
    );

  return h(
    "div",
    {
      className: "dshImgSkin-area",
      key: area.id,
      "data-off": String(!enabled),
      "data-editing": String(props.editing),
    },
    // 1) preview
    effective
      ? isVideo
        ? h("video", { className: "dshImgSkin-thumb", src: effective, muted: true, loop: true, autoPlay: true, playsInline: true })
        : h("img", { className: "dshImgSkin-thumb", src: effective, alt: "" })
      : h("div", { className: "dshImgSkin-thumblet" }, "未设置"),
    // 2) name + provenance
    h(
      "div",
      { className: "dshImgSkin-met" },
      h(
        "div",
        { className: "dshImgSkin-name" },
        area.label,
        h("span", { className: "dshImgSkin-tag", "data-kind": sourceKind }, sourceLabel),
        props.tip ? h("span", { className: "dshImgSkin-tag", "data-kind": "tip" }, "从这里开始") : null,
      ),
      h("div", { className: "dshImgSkin-src" }, area.hint),
      props.editing ? h("div", { className: "dshImgSkin-src" }, "拖动图片移动位置，拖右下角圆点缩放。") : null,
    ),
    // 3) controls
    h(
      "div",
      { className: "dshImgSkin-ops" },
      h(
        "label",
        { className: "dshImgSkin-switch" },
        h("input", {
          type: "checkbox",
          checked: enabled,
          onChange: (e: any) => props.onSet(`${area.id}Enabled`, e.target.checked),
        }),
        "启用",
      ),
      picker("up-mode", `上传${modeWord}图`, specificField, "primary"),
      // Only offered when there is no shared image yet - otherwise the 清除 button already
      // covers it, and two near-identical upload buttons side by side just add noise.
      sharedImage ? null : picker("up-shared", "上传通用图", sharedField, "quiet"),
      effective
        ? h(
            "button",
            {
              key: "clear",
              type: "button",
              className: "dshImgSkin-btn",
              "data-variant": "quiet",
              onClick: () => props.onClear(sourceKind === "shared" ? sharedField : specificField),
            },
            sourceKind === "shared" ? "清除通用图" : "清除",
          )
        : null,
      area.kind === "region"
        ? h(
            "span",
            { key: "fit", className: "dshImgSkin-fit" },
            h("span", { className: "dshImgSkin-fitlabel" }, "填充"),
            h(
              "select",
              {
                className: "dshImgSkin-btn",
                value: fit,
                onChange: (e: any) => props.onSet(`${area.id}Fit`, e.target.value),
              },
              h("option", { value: "cover" }, "铺满"),
              h("option", { value: "contain" }, "适应"),
              h("option", { value: "tile" }, "平铺"),
            ),
          )
        : null,
      area.kind === "sticker" && effective
        ? h(
            "button",
            {
              key: "edit-pos",
              type: "button",
              className: "dshImgSkin-btn",
              "data-active": String(props.editing),
              onClick: () => props.onToggleEdit(area.id),
            },
            props.editing ? "完成" : "编辑位置",
          )
        : null,
    ),
  );
}

// ── unused-file collection ──────────────────────────────────────────────────

interface GcReport {
  removed: string[];
  kept: number;
  freedBytes: number;
}

/** Ask the host to delete stored files no area references any more. */
async function collectUnusedFiles(): Promise<GcReport | null> {
  try {
    const resp = await fetch(`${ROUTE_PREFIX}/gc`, { method: "POST" });
    if (!resp.ok) return null;
    return (await resp.json()) as GcReport;
  } catch {
    return null;
  }
}

let gcTimer: ReturnType<typeof setTimeout> | null = null;

/** Collect only after the settings write committed — the host reads the stored value. */
function scheduleCollectUnused(delay = 800): void {
  if (gcTimer) clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    gcTimer = null;
    void collectUnusedFiles();
  }, delay);
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Accent level picker. A slider rather than four buttons, because the levels are ordered by
 * cost and the description changes with the level - so the caption cross-fades as you drag
 * instead of snapping, and a reserved level can say so without looking broken.
 */
function AccentRow(props: {
  level: number;
  enabled: boolean;
  onChange: (n: number) => void;
  onToggle: (on: boolean) => void;
}): React.ReactElement {
  const h = React.createElement;
  const level = Math.max(0, Math.min(ACCENT_LEVELS.length - 1, Math.round(props.level)));
  const [shown, setShown] = React.useState(level);
  const [visible, setVisible] = React.useState(true);
  const fadeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cross-fade the caption: fade the old label out, swap, fade the new one in.
  React.useEffect(() => {
    if (level === shown) return;
    setVisible(false);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setShown(level);
      setVisible(true);
    }, 140);
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [level, shown]);

  React.useEffect(
    () => () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    },
    [],
  );

  const def = ACCENT_LEVELS[shown];
  return h(
    "div",
    { className: "dshImgSkin-slider" },
    h(
      "div",
      { className: "dshImgSkin-sliderhead" },
      h(
        "div",
        null,
        h("span", { className: "dshImgSkin-title" }, "按钮 / 弹窗装饰"),
        h(
          "span",
          { className: "dshImgSkin-hint" },
          "根据窗口壁纸的配色，给按钮、弹窗和设置分区加底纹。颜色染多深由档位决定。",
        ),
      ),
      h(
        "label",
        { className: "dshImgSkin-switch" },
        h("input", {
          type: "checkbox",
          checked: props.enabled,
          onChange: (e: any) => props.onToggle(e.target.checked),
        }),
        "启用",
      ),
    ),
    h("input", {
      className: "dshImgSkin-range",
      type: "range",
      min: 0,
      max: ACCENT_LEVELS.length - 1,
      step: 1,
      value: level,
      disabled: !props.enabled,
      onChange: (e: any) => props.onChange(Number(e.target.value)),
    }),
    h(
      "div",
      { className: "dshImgSkin-ticks" },
      ACCENT_LEVELS.map((l, i) =>
        h(
          "button",
          {
            key: l.name,
            type: "button",
            className: "dshImgSkin-tickBtn",
            "data-on": String(i === level),
            disabled: !props.enabled,
            onClick: () => props.onChange(i),
          },
          l.name,
        ),
      ),
    ),
    h(
      "div",
      { className: "dshImgSkin-accentCaption", "data-visible": String(visible) },
      h("span", { className: "dshImgSkin-accentLevel" }, `${shown} · ${def.name}`),
      def.ready ? " — " : " — ",
      h("span", { className: "dshImgSkin-hint" }, def.desc),
    ),
  );
}

/**
 * The ornament workshop.
 *
 * Four jobs, in the order you actually do them, one card each:
 *   1. who draws it      - provider, key, and a "检查" button that probes the key instead of making
 *                          you wait for a real generation to find out it is wrong;
 *   2. what to ask for   - style chips plus an *editable* prompt (the auto one is a starting point,
 *                          not a cage); material and palette are filled in from the artwork;
 *   3. how many          - count up front, size tucked into 高级 (a border is applied with 9-slice,
 *                          so its pixel size barely matters);
 *   4. what came back    - results are written to settings, so the wall survives leaving the page,
 *                          and each one can be applied, downloaded or deleted on the spot.
 *
 * Progress is real: the host streams stages over SSE (submitted → queued → running → saving), which
 * matters most on Alibaba's asynchronous endpoint where a job can queue for a minute or two.
 */
const STYLE_PRESETS: { name: string; text: string }[] = [
  { name: "极简", text: "minimal, one hairline and a single small corner mark" },
  { name: "巴洛克", text: "baroque scrollwork, dense carving, deep relief" },
  { name: "中式", text: "chinese lattice and cloud motif, fine ink lines" },
  { name: "赛博", text: "cyber neon tubing, thin sharp angles" },
  { name: "自然", text: "organic vine and leaf border, hand-drawn line" },
  { name: "和纸", text: "washi paper fibre edge, soft uneven hand" },
];

interface FrameRecord {
  url: string;
  prompt: string;
  provider: string;
  model: string;
  at: number;
}

function AiAccentPanel(props: {
  value: SkinValue;
  onSet: (field: string, val: unknown) => void;
  strength: number;
}): React.ReactElement {
  const h = React.createElement;
  const v = props.value;
  const [providers, setProviders] = React.useState<Array<Record<string, unknown>> | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<{ kind: "ok" | "err"; text: string; hint?: string } | null>(null);
  const [promptDraft, setPromptDraft] = React.useState<string | null>(null);
  const [autoPrompt, setAutoPrompt] = React.useState<string | null>(null);
  const [keyCheck, setKeyCheck] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [advanced, setAdvanced] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);

  const providerId = String(v.accentProvider ?? "dashscope-wanx");
  const keyMode = String(v.accentKeyMode ?? "env");
  const current = providers?.find((p) => p.id === providerId) ?? null;
  const isCustom = providerId === "custom";

  // Results live in settings, not in component state: leaving this page used to throw the wall away
  // (and the files it pointed at were then collected as orphans).
  const frames: FrameRecord[] = React.useMemo(() => {
    try {
      const parsed = JSON.parse(String(v.accentFrames ?? "[]"));
      return Array.isArray(parsed) ? (parsed as FrameRecord[]).slice(0, 24) : [];
    } catch {
      return [];
    }
  }, [v.accentFrames]);
  const writeFrames = (next: FrameRecord[]) => props.onSet("accentFrames", JSON.stringify(next.slice(0, 24)));

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${ROUTE_PREFIX}/providers`);
        const data = await res.json();
        if (alive) setProviders(Array.isArray(data?.providers) ? data.providers : []);
      } catch {
        if (alive) setProviders([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const keyPayload = () => ({
    providerId,
    baseUrl: String(v.accentBaseUrl ?? ""),
    model: String(v.accentModel ?? ""),
    apiKey: keyMode === "manual" ? String(v.accentApiKey ?? "") : "",
    apiKeyEnv: String(v.accentKeyEnv ?? ""),
  });

  const fetchPrompt = async (): Promise<string> => {
    const res = await fetch(`${ROUTE_PREFIX}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        strength: props.strength,
        style: String(v.accentStyle ?? ""),
        palette: String(v.accentPalette ?? "").split("|").map((s) => s.trim()).filter(Boolean),
        material: String(v.accentMaterial ?? ""),
        extra: String(v.accentPromptExtra ?? ""),
      }),
    });
    const data = await res.json();
    return String(data?.prompt ?? "");
  };

  // The prompt follows the settings live, until the moment you type in it. Before this it was
  // composed once (by "取提示词") and then frozen, so moving the slider afterwards silently changed
  // nothing - which is exactly how "滑块真的在控制画面吗" becomes a fair question.
  const composeKey = [
    props.strength,
    String(v.accentStyle ?? ""),
    String(v.accentPalette ?? ""),
    String(v.accentMaterial ?? ""),
    String(v.accentPromptExtra ?? ""),
  ].join("~");
  React.useEffect(() => {
    if (promptDraft !== null) return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        const text = await fetchPrompt();
        if (alive && text) setAutoPrompt(text);
      })();
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeKey, promptDraft]);

  const preview = async () => {
    try {
      const text = await fetchPrompt();
      setAutoPrompt(text);
      setStatus({ kind: "ok", text: "这就是这次会发出去的字（你改了就按你改的来）。" });
    } catch (error) {
      setStatus({ kind: "err", text: `取不到提示词：${String(error)}` });
    }
  };

  const probeKey = async () => {
    setChecking(true);
    setKeyCheck("检查中…");
    try {
      const res = await fetch(`${ROUTE_PREFIX}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(keyPayload()),
      });
      const data = await res.json();
      setKeyCheck(`${data?.ok ? "✅" : "⚠️"} ${String(data?.detail ?? "")}${data?.hint ? `（${data.hint}）` : ""}`);
    } catch (error) {
      setKeyCheck(`⚠️ 检查失败：${String(error)}`);
    } finally {
      setChecking(false);
    }
  };

  const stageText: Record<string, string> = {
    submitted: "已提交给服务商…",
    queued: "排队中（阿里云常要 1–2 分钟）…",
    running: "正在生成…",
    saving: "正在存图…",
  };

  const generate = async () => {
    setBusy(true);
    setStatus(null);
    setStage("submitted");
    try {
      const prompt = promptDraft ?? (autoPrompt || (await fetchPrompt()));
      const payload = {
        ...keyPayload(),
        prompt,
        count: Number(v.accentCount ?? 2),
        size: String(v.accentSize ?? "1024x1024"),
      };
      // Prefer the streaming route so the stages are real; fall back to the plain one if a DSH
      // version does not have it.
      let urls: string[] = [];
      let failure: { error?: string; hint?: string; detail?: string } | null = null;
      const res = await fetch(`${ROUTE_PREFIX}/gen/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.replace(/^data:\s*/m, "").trim();
            if (!line) continue;
            try {
              const event = JSON.parse(line) as Record<string, unknown>;
              if (typeof event.stage === "string" && event.stage !== "done") setStage(event.stage);
              if (event.stage === "done") {
                urls = Array.isArray(event.urls) ? (event.urls as string[]) : [];
                if (!urls.length) failure = { error: String(event.error ?? "生成失败"), hint: event.hint ? String(event.hint) : undefined, detail: event.detail ? String(event.detail) : undefined };
              }
            } catch {
              /* keep-alive or half a frame; ignore */
            }
          }
        }
      } else {
        const plain = await fetch(`${ROUTE_PREFIX}/gen`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await plain.json();
        urls = Array.isArray(data?.urls) ? data.urls : [];
        if (!urls.length) failure = { error: String(data?.error ?? data?.status ?? "生成失败"), hint: data?.hint, detail: data?.detail };
      }
      if (!urls.length) {
        setStatus({ kind: "err", text: failure?.error ?? "生成失败", hint: failure?.hint ?? failure?.detail });
        return;
      }
      const record: FrameRecord[] = urls.map((url) => ({
        url,
        prompt,
        provider: providerId,
        model: String(current?.model ?? v.accentModel ?? ""),
        at: Date.now(),
      }));
      writeFrames([...record, ...frames]);
      setStatus({ kind: "ok", text: `生成完成 ${urls.length} 张 —— 点缩略图就应用到面板` });
    } catch (error) {
      setStatus({ kind: "err", text: `生成失败：${String(error)}` });
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const field = (key: string, label: string, node: React.ReactElement | null, hint?: string) =>
    h(
      "div",
      { className: "dshImgSkin-field", key },
      h("span", { className: "dshImgSkin-fieldLabel" }, label),
      h("div", { className: "dshImgSkin-fieldBody" }, node, hint ? h("span", { className: "dshImgSkin-hint" }, hint) : null),
    );

  const textInput = (fieldName: string, opts: Record<string, unknown> = {}) =>
    h("input", {
      className: "dshImgSkin-input",
      value: String(v[fieldName] ?? ""),
      ...opts,
      onChange: (e: any) => props.onSet(fieldName, e.target.value),
    });

  const envName = String(current?.keyEnv ?? "");
  const envReady = Boolean(current?.envReady);
  const applied = String(v.accentFrame ?? "");

  return h(
    "div",
    { className: "dshImgSkin-card" },
    h(
      "div",
      { className: "dshImgSkin-cardhead" },
      h(
        "div",
        null,
        h("span", { className: "dshImgSkin-title" }, "生成装饰框"),
        h(
          "p",
          { className: "dshImgSkin-sub" },
          "让生图模型画一张边框花纹。提示词里已经写死了「不要文字 / 人 / 景 / 物」，配色和材质来自你的壁纸。",
        ),
      ),
    ),

    // 1) who draws it
    field(
      "provider",
      "服务商",
      h(
        "div",
        { className: "dshImgSkin-inline" },
        h(
          "select",
          {
            className: "dshImgSkin-input",
            value: providerId,
            onChange: (e: any) => {
              props.onSet("accentProvider", e.target.value);
              setKeyCheck(null);
            },
          },
          (providers ?? []).map((p) => h("option", { key: String(p.id), value: String(p.id) }, String(p.label))),
        ),
        h(
          "button",
          { className: "dshImgSkin-btn", type: "button", disabled: checking, onClick: () => void probeKey() },
          checking ? "检查中…" : "检查",
        ),
      ),
      isCustom ? "自定义：下面填 Base URL 与模型 ID" : `默认模型 ${String(current?.model ?? "")}`,
    ),
    keyCheck ? h("p", { className: "dshImgSkin-ok" }, keyCheck) : null,
    // The address override is shown whenever one is set, not only for 自定义 - otherwise a leftover
    // testing URL stays invisible while the provider is switched back to a preset, and every request
    // quietly goes to the wrong host. (This is exactly how a local mock endpoint kept intercepting a
    // real key.)
    isCustom || String(v.accentBaseUrl ?? "").trim()
      ? field(
          "base",
          "Base URL",
          h(
            "div",
            { className: "dshImgSkin-inline" },
            textInput("accentBaseUrl", {
              placeholder: isCustom ? "https://your-endpoint/v1" : `留空则用官方地址 ${String(current?.baseUrl ?? "")}`,
            }),
            String(v.accentBaseUrl ?? "").trim()
              ? h(
                  "button",
                  { className: "dshImgSkin-btn", type: "button", "data-variant": "quiet", onClick: () => props.onSet("accentBaseUrl", "") },
                  "清空（用官方地址）",
                )
              : null,
          ),
          isCustom
            ? "自定义服务商：Base URL 与模型 ID 都要填"
            : "⚠️ 这里填过地址，它会覆盖该服务商的官方地址（测试用的本地地址就是这样把请求引走的）",
        )
      : null,
    field(
      "model",
      "模型 ID",
      textInput("accentModel", { placeholder: current?.model ? String(current.model) : "your-model-id" }),
      isCustom ? undefined : "留空则用该服务商的默认模型",
    ),
    field(
      "keysrc",
      "API Key",
      h(
        "div",
        { className: "dshImgSkin-inline" },
        ...(["env", "manual"] as const).map((m) =>
          h(
            "button",
            {
              key: m,
              type: "button",
              className: "dshImgSkin-btn",
              "data-active": String(keyMode === m),
              onClick: () => props.onSet("accentKeyMode", m),
            },
            m === "env" ? "环境变量" : "手动输入",
          ),
        ),
      ),
      keyMode === "env"
        ? envReady
          ? `✓ 已检测到 ${envName}（只读，Key 不入设置文件）`
          : `未检测到 ${envName || "对应环境变量"}；可切到手动输入`
        : "Key 存本机设置文件，不会上传；但仍请注意本机安全",
    ),
    keyMode === "env"
      ? field("envname", "变量名", textInput("accentKeyEnv", { placeholder: envName || "ARK_API_KEY", disabled: Boolean(envName) }), "留空则用该服务商的默认变量名")
      : field("key", "Key", textInput("accentApiKey", { type: "password", placeholder: "sk-..." })),

    // 2) what to ask for
    field(
      "style",
      "风格",
      h(
        "div",
        { className: "dshImgSkin-inline" },
        ...STYLE_PRESETS.map((preset) =>
          h(
            "button",
            {
              key: preset.name,
              type: "button",
              className: "dshImgSkin-btn",
              "data-variant": "quiet",
              onClick: () => {
                props.onSet("accentStyle", preset.text);
              },
            },
            preset.name,
          ),
        ),
      ),
      String(v.accentStyle ?? "") ? `当前：${String(v.accentStyle)}` : "点一个词就填进去；也可以留空让模型自由发挥",
    ),
    field(
      "prompt",
      "提示词",
      h("textarea", {
        className: "dshImgSkin-input dshImgSkin-textarea",
        rows: 4,
        value: promptDraft ?? autoPrompt ?? "",
        placeholder: "正在按当前设定拼提示词…你打一个字就会固定下来",
        onChange: (e: any) => setPromptDraft(e.target.value),
      }),
      promptDraft !== null
        ? "已手改（生成用你改的这份）"
        : "跟随上面的设定实时更新；你打一个字就固定下来",
    ),
    h(
      "div",
      { className: "dshImgSkin-inline" },
      h("button", { className: "dshImgSkin-btn", type: "button", onClick: () => void preview() }, "看看会发什么"),
      h(
        "button",
        {
          className: "dshImgSkin-btn",
          type: "button",
          "data-variant": "quiet",
          onClick: () => {
            setPromptDraft(null);
            setStatus(null);
          },
        },
        "恢复跟随设定",
      ),
      h(
        "span",
        { className: "dshImgSkin-fitlabel" },
        `${Number(v.accentCount ?? 2)} 张`,
      ),
      h("input", {
        className: "dshImgSkin-input dshImgSkin-inputNarrow",
        type: "number",
        min: 1,
        max: 4,
        value: String(v.accentCount ?? 2),
        onChange: (e: any) => props.onSet("accentCount", Number(e.target.value)),
      }),
    ),

    // 3) advanced
    h(
      "div",
      { className: "dshImgSkin-inline" },
      h(
        "button",
        { className: "dshImgSkin-btn", type: "button", "data-variant": "quiet", onClick: () => setAdvanced((a) => !a) },
        advanced ? "收起高级 ▴" : "高级 ▾",
      ),
    ),
    advanced
      ? field(
          "size",
          "尺寸",
          h(
            "select",
            {
              className: "dshImgSkin-input dshImgSkin-inputNarrow",
              value: String(v.accentSize ?? "1024x1024"),
              onChange: (e: any) => props.onSet("accentSize", e.target.value),
            },
            ["1024x1024", "1280x720", "720x1280"].map((s) => h("option", { key: s, value: s }, s)),
          ),
          "尺寸影响不大，用默认的就行",
        )
      : null,

    // 4) go
    h(
      "div",
      { className: "dshImgSkin-inline" },
      h(
        "button",
        { className: "dshImgSkin-btn", type: "button", "data-variant": "primary", disabled: busy, onClick: () => void generate() },
        busy ? "生成中…" : "生成装饰",
      ),
      busy && stage ? h("span", { className: "dshImgSkin-hint" }, stageText[stage] ?? stage) : null,
      h("span", { className: "dshImgSkin-hint" }, `本次会话已生成 ${frames.length} 张（会产生费用）`),
    ),
    status
      ? h(
          "p",
          { className: status.kind === "ok" ? "dshImgSkin-ok" : "dshImgSkin-banner" },
          status.text,
          status.hint ? h("span", { className: "dshImgSkin-hint" }, ` ${status.hint}`) : null,
        )
      : null,

    // 5) results
    frames.length
      ? h(
          "div",
          null,
          h(
            "div",
            { className: "dshImgSkin-results" },
            ...frames.map((frame) =>
              h(
                "div",
                { key: frame.url, className: "dshImgSkin-frameCell", onMouseEnter: () => setHovered(frame.url), onMouseLeave: () => setHovered(null) },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dshImgSkin-result",
                    "data-on": String(applied === frame.url),
                    title: applied === frame.url ? "再点一下取消应用" : "点击应用这张",
                    onClick: () => props.onSet("accentFrame", applied === frame.url ? "" : frame.url),
                  },
                  h("img", { src: frame.url, alt: "" }),
                ),
                h(
                  "div",
                  { className: "dshImgSkin-inline dshImgSkin-frameOps" },
                  h("a", { className: "dshImgSkin-btn", "data-variant": "quiet", href: frame.url, download: "" }, "下载"),
                  h(
                    "button",
                    {
                      className: "dshImgSkin-btn",
                      type: "button",
                      "data-variant": "quiet",
                      onClick: () => {
                        if (applied === frame.url) props.onSet("accentFrame", "");
                        writeFrames(frames.filter((f) => f.url !== frame.url));
                      },
                    },
                    "删除",
                  ),
                ),
              ),
            ),
          ),
          hovered && frames.find((f) => f.url === hovered)
            ? h("p", { className: "dshImgSkin-hint" }, `这张的提示词：${frames.find((f) => f.url === hovered)?.prompt ?? ""}`)
            : h("p", { className: "dshImgSkin-hint" }, "点缩略图应用；按一下已应用的那张就能取消。结果会保存，离开也不会丢。"),
        )
      : null,
  );
}

function createSection(scope: Scope<SkinValue>, modeStore: ModeStore): () => React.ReactElement {
  const h = React.createElement;
  return function ImageSkinSection(): React.ReactElement {
    const value = React.useSyncExternalStore(
      (cb) => scope.subscribe(cb),
      () => scope.getSnapshot().value,
    ) as SkinValue | undefined;
    const mode = React.useSyncExternalStore(modeStore.subscribe, modeStore.get);
    const v: SkinValue = value ?? {};
    const [busy, setBusy] = React.useState<string | null>(null);
    const [editingId, setEditingId] = React.useState<string | null>(currentEditing);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [gcStatus, setGcStatus] = React.useState<string | null>(null);

    // Every write to the host goes through here. A tab opened before a DSH restart keeps rendering
    // and keeps accepting clicks, but its token is dead - so writes fail and every control looks
    // broken ("点上去没反应"). Say so on screen instead of leaving a dead UI behind.
    const writeFailedNotice =
      "写不进去：这个页面和 DSH 的连接已经断了（DSH 服务重启过就会这样）。请刷新页面，或用最新打开的那个标签。";
    const apply = (field: string, value: unknown): void => {
      void scope.set(field, value).catch(() => setNotice(writeFailedNotice));
    };

    const upload = async (field: string, file: File) => {
      setNotice(null);
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setNotice(`${file.name} 有 ${formatMb(file.size)} MB，超过 ${MAX_UPLOAD_MB} MB 上限`);
        return;
      }
      setBusy(field);
      try {
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const resp = await fetch(`${ROUTE_PREFIX}/upload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: dataUri }),
        });
        const data = (await resp.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!resp.ok || !data?.url) {
          setNotice(data?.error ?? `上传失败（HTTP ${resp.status}）`);
          return;
        }
        await scope.set(field, data.url);
        scheduleCollectUnused();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        console.error("[dsh-image-skin] upload failed", error);
      } finally {
        setBusy(null);
      }
    };

    const regionAreas = AREAS.filter((a) => a.kind === "region");
    const stickerAreas = AREAS.filter((a) => a.kind === "sticker");

    const rowProps = (area: AreaDef) => ({
      key: area.id,
      area,
      value: v,
      mode,
      busyField: busy,
      editing: editingId === area.id,
      tip: area.id === "window" && configuredAreas === 0,
      onPick: (file: File, field: string) => void upload(field, file),
      onSet: (field: string, val: unknown) => apply(field, val),
      onClear: (field: string) => {
        void (async () => {
          await scope.set(field, "");
          scheduleCollectUnused();
        })();
      },
      onToggleEdit: (id: string) => {
        const next = editingId === id ? null : id;
        setEditingId(next);
        setEditing(next);
      },
    });

    const areaGroup = (title: string, note: string, list: AreaDef[]) =>
      h(
        "div",
        { className: "dshImgSkin-card" },
        h(
          "div",
          { className: "dshImgSkin-cardhead" },
          h(
            "div",
            null,
            h(
              "span",
              { className: "dshImgSkin-title" },
              title,
              h(
                "span",
                { className: "dshImgSkin-tag", "data-kind": "count" },
                `${list.filter((a) => Boolean(v[`${a.id}Image`] || v[`${a.id}ImageLight`] || v[`${a.id}ImageDark`])).length}/${list.length} 已配`,
              ),
            ),
            h("p", { className: "dshImgSkin-sub" }, note),
          ),
        ),
        h("div", { className: "dshImgSkin-areas" }, list.map((area) => h(AreaRow, rowProps(area)))),
      );

    // Mode is a *filter over one page*, not a second screen. Switching changes which set of
    // images you are editing (and flips the live theme so you can see it), while the area list,
    // the global sliders and storage stay exactly where they are.
    const modeSeg = h(
      "div",
      { className: "dshImgSkin-seg" },
      (["light", "dark"] as Mode[]).map((m) =>
        h(
          "button",
          {
            key: m,
            type: "button",
            "data-on": String(mode === m),
            onClick: () => modeStore.pick(m),
          },
          m === "dark" ? h(MoonIcon, { size: 13 }) : h(SunIcon, { size: 13 }),
          modeLabel(m),
        ),
      ),
    );


    // ── two levels ────────────────────────────────────────────────────────────
    // Level one is a choice, level two is a workbench. They live on separate screens because the
    // image editor and the ornament workbench answer different questions - and because the AI
    // half has nothing to do until a wallpaper exists to sample colours from.
    const hasWallpaper = windowHasArtwork(v);
    const [page, setPage] = React.useState<"home" | "images" | "ai">("home");
    const [riskOpen, setRiskOpen] = React.useState(false);

    // Entering the AI screen raises the notice unless it has been silenced. Losing the wallpaper
    // drops you back to the choice screen, so the locked entry never lies about being usable.
    React.useEffect(() => {
      if (page !== "ai") {
        setRiskOpen(false);
        return;
      }
      if (!hasWallpaper) {
        setPage("home");
        return;
      }
      if (v.accentRiskHidden !== true) setRiskOpen(true);
    }, [page, hasWallpaper, v.accentRiskHidden]);

    // The notice is a dialog, so Escape has to close it like one.
    React.useEffect(() => {
      if (!riskOpen) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setRiskOpen(false);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [riskOpen]);

    // How much is set up, in the currency the user thinks in: areas.
    const configuredAreas = AREAS.filter((a) =>
      Boolean(v[`${a.id}Image`] || v[`${a.id}ImageLight`] || v[`${a.id}ImageDark`]),
    ).length;
    const accentIndex = Math.max(0, Math.min(ACCENT_LEVELS.length - 1, Math.round(Number(v.accentLevel ?? 0))));
    const sampledColours = String(v.accentPalette ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    /** Friendly names for the material read (see MATERIALS in the host half). */
    /** One line per colour route, so the switch explains itself. */
    const COLOUR_STYLES: Record<string, string> = {
      wash: "每个面都带色，描边到处都有 —— 像被泡在颜色里",
      marks: "面保持中性，只有选中项 / 焦点框 / 一条分隔线有色",
      duo: "面借主色，交互色用画面里的第二个色相",
    };
    const MATERIAL_LABELS: Record<string, string> = {
      sky: "天空 / 天光",
      paper: "纸 / 和纸",
      wood: "木",
      water: "水 / 波纹",
      neon: "霓虹 / 高饱和",
      plain: "（未识别）",
    };
    const aiStatus =
      v.accentEnabled === false
        ? "装饰未开启"
        : `档位 ${accentIndex} · ${ACCENT_LEVELS[accentIndex]?.name ?? "取色"}${v.accentFrame ? " · 已应用生成图" : ""}`;

    const back = (title: string) =>
      h(
        "div",
        { className: "dshImgSkin-nav" },
        h("button", { className: "dshImgSkin-btn", type: "button", onClick: () => setPage("home") }, "← 返回"),
        h("span", { className: "dshImgSkin-navTitle" }, title),
      );

    const entry = (
      target: "images" | "ai",
      title: string,
      sub: string,
      status: string,
      locked: boolean,
      lockedHint?: string,
    ) =>
      h(
        "button",
        {
          key: target,
          type: "button",
          className: "dshImgSkin-entry",
          disabled: locked,
          "data-ready": String(!locked),
          onClick: () => {
            if (!locked) setPage(target);
          },
        },
        h(
          "span",
          { className: "dshImgSkin-entryTop" },
          h("span", { className: "dshImgSkin-entryTitle" }, title),
          h("span", { className: "dshImgSkin-chev" }, locked ? "🔒" : "›"),
        ),
        h("span", { className: "dshImgSkin-entryStatus" }, status),
        h("span", { className: "dshImgSkin-entrySub" }, sub),
        locked && lockedHint ? h("span", { className: "dshImgSkin-lock" }, lockedHint) : null,
      );

    // Shown before anything is generated, every time you come in, until "不再显示" is ticked.
    // Clicking the dim area closes it like a dialog should: a backdrop that swallows clicks with no
    // way out reads as "the UI is broken", which is exactly how it was reported.
    const riskModal = h(
      "div",
      {
        className: "dshImgSkin-modal",
        role: "dialog",
        "aria-modal": "true",
        onClick: (e: any) => {
          if (e.target === e.currentTarget) setRiskOpen(false);
        },
      },
      h(
        "div",
        {
          className: "dshImgSkin-modalCard",
          style: { background: mode === "dark" ? "#26262b" : "#ffffff" },
        },
        h("span", { className: "dshImgSkin-modalTitle" }, "用 AI 纹样之前，先看这五条"),
        h(
          "ul",
          { className: "dshImgSkin-modalList" },
          h("li", null, "点「生成」时，提示词和壁纸配色会发给你选的第三方生图服务——这部分内容会离开本机。"),
          h("li", null, "每生成一张，都会按你在那家服务的价格计费；张数和尺寸影响花费。"),
          h("li", null, "画成什么样由模型决定，不保证一次满意，可能要试几张才挑到合适的。"),
          h("li", null, "API Key 只存在本机（或读环境变量，界面里只读），不会发给除你选定服务之外的任何地方。"),
          h("li", null, "取色和配色完全在本机算：不联网、不花钱、不需要 key。"),
        ),
        h(
          "div",
          { className: "dshImgSkin-modalActions" },
          h(
            "button",
            { className: "dshImgSkin-btn", type: "button", "data-variant": "primary", onClick: () => setRiskOpen(false) },
            "我明白了",
          ),
          h(
            "button",
            {
              className: "dshImgSkin-modalDismiss",
              type: "button",
              onClick: () => {
                apply("accentRiskHidden", true);
                setRiskOpen(false);
              },
            },
            "不再显示",
          ),
          h("span", { className: "dshImgSkin-hint" }, "点背景或按 Esc 也能关掉"),
        ),
      ),
    );

    const home = h(
      "div",
      { className: "dshImgSkin-shell", "data-dsh-skin-chrome": "settings" },
      h(
        "p",
        { className: "dshImgSkin-intro" },
        "分两步走：先在「贴图」里放上自己的画面，再决定要不要用「AI 纹样」给按钮和弹窗加装饰。图片只存在本机，不会上传。",
      ),
      h(
        "div",
        { className: "dshImgSkin-entries" },
        entry(
          "images",
          "贴图",
          "窗口壁纸、各区域图片 / 视频、角标、面板透明度、存储清理。",
          configuredAreas ? `已配置 ${configuredAreas} / ${AREAS.length} 个区域` : "还没放图 · 建议先配「窗口」",
          false,
        ),
        entry(
          "ai",
          "AI 纹样",
          "给按钮和弹窗加装饰框：档位 0 本机取色，1–4 由生图模型画。",
          aiStatus,
          !hasWallpaper,
          "先给「窗口」放一张贴图才能进——AI 要参考它的配色。",
        ),
      ),
      notice ? h("p", { className: "dshImgSkin-banner" }, notice) : null,
    );

    const imagesPage = h(
      "div",
      { className: "dshImgSkin-shell", "data-dsh-skin-chrome": "settings" },
      back("贴图"),
      h(
        "p",
        { className: "dshImgSkin-intro" },
        "给界面各区域换上你自己的图片或视频；图片只存在本机，不会上传到外部服务。",
      ),
      configuredAreas === 0
        ? h(
            "div",
            { className: "dshImgSkin-tipCard" },
            h("span", { className: "dshImgSkin-tipTitle" }, "第一步：给「窗口」放一张图"),
            h(
              "p",
              { className: "dshImgSkin-sub" },
              "整块底图换掉之后界面立刻不一样；其余区域可以之后再单独配，浅色 / 深色也能各配一套。",
            ),
          )
        : null,
      notice ? h("p", { className: "dshImgSkin-banner" }, notice) : null,
      h(
        "div",
        { className: "dshImgSkin-card" },
        h(
          "div",
          { className: "dshImgSkin-cardhead" },
          h(
            "div",
            null,
            h("span", { className: "dshImgSkin-title" }, "正在编辑"),
            h(
              "p",
              { className: "dshImgSkin-sub" },
              "浅色和深色各有一套图；切换时界面主题也会跟着切，方便边配边看。某个区域没单独配，会回退到「通用图」。",
            ),
          ),
          modeSeg,
        ),
      ),
      areaGroup("界面区域", "整窗口的底图与各块面板的背景。", regionAreas),
      areaGroup("角标贴图", "贴在侧栏 / 输入框上，可拖动、可缩放。", stickerAreas),
      h(
        "div",
        { className: "dshImgSkin-card" },
        h(
          "div",
          { className: "dshImgSkin-cardhead" },
          h(
            "div",
            null,
            h("span", { className: "dshImgSkin-title" }, "全局效果"),
            h("p", { className: "dshImgSkin-sub" }, "两个模式通用，拖动即时生效。"),
          ),
        ),
        h(SliderRow, {
          key: "opacity",
          title: "面板不透明度",
          hint: "越低越能透出壁纸；角标贴图会同步变淡，壁纸本身不受影响",
          value: Number(v.panelOpacity ?? 100),
          min: 0,
          max: 100,
          step: 1,
          format: (n: number) => `${n}%`,
          onPreview: (n: number) => applyPanelOpacity({ ...v, panelOpacity: n }, mode),
          onCommit: (n: number) => apply("panelOpacity", n),
        }),
        h(SliderRow, {
          key: "rate",
          title: "视频播放速率",
          hint: "作用于上传的视频（窗口壁纸与角标视频），拖动即时生效",
          value: Number(v.videoPlaybackRate ?? 1),
          min: 0.25,
          max: 3,
          step: 0.25,
          format: (n: number) => `${n}×`,
          onPreview: (n: number) => previewVideoRate(n),
          onCommit: (n: number) => apply("videoPlaybackRate", n),
        }),
      ),
      h(
        "div",
        { className: "dshImgSkin-card" },
        h(
          "div",
          { className: "dshImgSkin-cardhead" },
          h(
            "div",
            null,
            h("span", { className: "dshImgSkin-title" }, "存储"),
            h(
              "p",
              { className: "dshImgSkin-sub" },
              `图片存在本机的 image-skin 目录，单文件上限 ${MAX_UPLOAD_MB} MB；换图或清除后，不再被引用的旧文件会自动删掉——想留就先存一份`,
            ),
          ),
          h(
            "button",
            {
              className: "dshImgSkin-btn",
              onClick: () => {
                void (async () => {
                  const report = await collectUnusedFiles();
                  if (!report) {
                    setGcStatus("清理失败：宿主未就绪");
                    return;
                  }
                  setGcStatus(
                    report.removed.length
                      ? `已删除 ${report.removed.length} 个未使用文件，释放 ${formatMb(report.freedBytes)} MB`
                      : "没有可清理的文件",
                  );
                })();
              },
            },
            "清理未使用图片",
          ),
        ),
        gcStatus ? h("p", { className: "dshImgSkin-ok" }, gcStatus) : null,
      ),
    );

    const aiPage = h(
      "div",
      { className: "dshImgSkin-shell", "data-dsh-skin-chrome": "settings" },
      back("AI 纹样"),
      h(
        "p",
        { className: "dshImgSkin-intro" },
        "档位只决定颜色染多深：0 最淡（只描一圈细线），往上逐级加深、并跟着画面里的光走。全部在本机完成，不联网。",
      ),
      h(
        "div",
        { className: "dshImgSkin-card" },
        h(AccentRow, {
          key: "accent",
          level: Number(v.accentLevel ?? 0),
          enabled: v.accentEnabled !== false,
          onChange: (n: number) => apply("accentLevel", n),
          onToggle: (on: boolean) => apply("accentEnabled", on),
        }),
        // 配色强度：三条路线的开关，差别一眼就能看出来（原型图见 _proto/routes_*.png）
        h(
          "div",
          { className: "dshImgSkin-row" },
          h(
            "div",
            { className: "dshImgSkin-head" },
            h(
              "div",
              null,
              h("span", { className: "dshImgSkin-title" }, "配色强度"),
              h("small", { className: "dshImgSkin-hint" }, COLOUR_STYLES[String(v.accentMode ?? "wash")] ?? ""),
            ),
          ),
          h(
            "div",
            { className: "dshImgSkin-inline" },
            ...([
              ["wash", "整屏染色"],
              ["marks", "只染三处"],
              ["duo", "双声部"],
            ] as const).map(([id, label]) =>
              h(
                "button",
                {
                  key: id,
                  type: "button",
                  className: "dshImgSkin-btn",
                  "data-active": String(v.accentMode ?? "wash") === id,
                  onClick: () => apply("accentMode", id),
                },
                label,
              ),
            ),
          ),
        ),
        // Show what the scheme is built from. The sampler returns wallpaper colours; the CSS turns
        // them into one hue with three roles, so showing the raw four is an honest preview of the
        // material without pretending it is the result.
        sampledColours.length
          ? h(
              "div",
              { className: "dshImgSkin-swatchRow" },
              h(
                "div",
                { className: "dshImgSkin-inline" },
                h("span", { className: "dshImgSkin-fitlabel" }, "取自壁纸"),
                ...sampledColours.map((c, i) =>
                  h("span", { key: `s${i}`, className: "dshImgSkin-swatch", style: { background: `rgb(${c})` }, title: c }),
                ),
                String(v.accentMaterial ?? "") && String(v.accentMaterial) !== "plain"
                  ? h("span", { className: "dshImgSkin-fitlabel" }, `· 识别到的材质：${MATERIAL_LABELS[String(v.accentMaterial)] ?? String(v.accentMaterial)}`)
                  : null,
              ),
              h("span", { className: "dshImgSkin-hint" }, "档位只决定颜色染多深；配色全部在本机算，不联网"),
            )
          : null,
      ),
      // 纹饰（面板花框）那条路暂时留在 git 里（e19c633 / 34c3002 / b66006e），不再在这页挂一张
      // "已下线"的空卡片了——实测它"看着吓人"，而这条路的价值还没定；这一页现在只做配色。
      riskOpen ? riskModal : null,
    );

    return page === "home" ? home : page === "images" ? imagesPage : aiPage;
  };
}

/** Toggle the live editor outline state on the page (outside React). */
function setEditingLive(id: string | null): void {
  document.querySelectorAll<HTMLElement>("[data-dsh-skin-editing]").forEach((el) => el.removeAttribute("data-dsh-skin-editing"));
  if (!id) return;
  const el =
    document.querySelector<HTMLElement>(`[data-dsh-skin-sticker="${id}"]`) ||
    document.querySelector<HTMLElement>(`[data-dsh-skin-region="${id}"]`);
  if (el) el.setAttribute("data-dsh-skin-editing", "true");
}

/** Undo every DOM side effect this plugin applied, so disabling it restores the UI. */
function disposeSkinDom(): void {
  clearWindowImage();
  applyWindowColumns("");
  document.getElementById(VIDEO_LAYER_ID)?.remove();
  document.getElementById(WALL_FADE_ID)?.remove();
  document.querySelectorAll<HTMLElement>("[data-dsh-skin-sticker]").forEach((el) => el.remove());
  for (const id of Object.keys(stickerSignatures)) delete stickerSignatures[id];
  document.querySelectorAll<HTMLElement>("[data-dsh-skin-region]").forEach(clearRegionStyle);
  document.querySelectorAll<HTMLElement>("[data-dsh-skin-sticker-host]").forEach((el) => {
    el.style.removeProperty("position");
    el.removeAttribute("data-dsh-skin-sticker-host");
  });
  document.querySelectorAll<HTMLElement>("[data-dsh-skin-editing]").forEach((el) => el.removeAttribute("data-dsh-skin-editing"));
  finishButton?.remove();
  finishButton = null;
  currentEditing = null;
  document.getElementById(STYLE_ID)?.remove();
  dropStyles(PANEL_STYLE_ID);
  disposeAccent();
}

export function apply(ctx: ClientContext): void {
  const generation = ++applyGeneration;
  ensureBaseStyles();
  document.body.setAttribute(BODY_ATTR, "");
  const scope = ctx.settingsScope.bind<SkinValue>({ namespace: NS });
  const modeStore = makeModeStore(ctx.theme);
  const section = createSection(scope, modeStore);

  const commit: Commit = (patch) => {
    for (const [k, val] of Object.entries(patch)) void scope.set(k, val);
  };

  const renderSkin = (fade: boolean) => {
    const snapshot = scope.getSnapshot();
    if (snapshot.value) applyAll(snapshot.value, currentEditing, commit, modeStore.get(), fade);
  };
  const render = () => renderSkin(false);
  reapply = render;
  // New chrome appears all the time - dialogs, menus, popovers - and the accent scan has to keep
  // up: the settings dialog itself is the biggest panel we decorate, and it never existed at the
  // moment the last scan ran. Re-running is cheap because the palette is cached.
  refreshAccent = () => {
    const snapshot = scope.getSnapshot();
    if (snapshot.value) void applyAccent(snapshot.value, modeStore.get(), commit);
  };
  reapplyWith = (patch) => {
    const snapshot = scope.getSnapshot();
    if (snapshot.value) void applyAccent({ ...snapshot.value, ...patch }, modeStore.get());
  };
  readSkinValue = () => scope.getSnapshot().value;
  readSkinMode = () => modeStore.get();
  ctx.effect(
    () => {
      const unsubscribe = scope.subscribe(render);
      render();
      // `theme/change` is the sanctioned continuous-sync signal: when the user flips the
      // theme from DSH's own Appearance setting, our per-mode images have to follow.
      let lastScheme = modeStore.get();
      const offTheme = ctx.on?.("theme/change", () => {
        const next = modeStore.get();
        const flipped = next !== lastScheme;
        lastScheme = next;
        // Cross-fade only a real light <-> dark flip (not a font-size-only change), and
        // never the first snapshot, which is just the initial paint.
        if (flipped) startThemeAnimation();
        // Let the palette repaint and the transition start in their own frame before the
        // settings UI re-renders (its thumbnails decode the other mode's images).
        requestAnimationFrame(() => modeStore.notify());
        if (flipped) renderSkin(true);
        else render();
        // `theme/change` *leads* the DOM: for a beat after it fires, the theme flag and the theme
        // service can still report the old scheme, and the accent is derived from an async image
        // read on top of that. Repainting only in that instant is how a light<->dark switch ends up
        // still wearing the previous scheme until a manual reload. Repaint once more after both
        // have settled.
        if (flipped) {
          window.setTimeout(() => {
            if (generation === applyGeneration) renderSkin(true);
          }, 700);
        }
      }) as (() => void) | undefined;
      // 呼吸 (breathing): a video backdrop keeps moving, so re-read a frame now and then and let the
      // accent drift with it - slowly, and only within a small hue distance of the seed (see the
      // guard in applyAccent). Off entirely for still images, and when the accent is off.
      const breatheTimer = window.setInterval(() => {
        const snapshot = scope.getSnapshot();
        const v = snapshot.value;
        if (!v || v.accentEnabled === false || Number(v.accentLevel ?? 0) < 1) return;
        const img = resolveAreaImage(v, "window", modeStore.get());
        if (!img || !VIDEO_RE.test(img)) return;
        void applyAccent(v, modeStore.get(), commit, true);
      }, 8000);
      // Repaint on structural churn (regions mounting/unmounting, re-renders) and on
      // theme flips. Attribute observation stays limited to the theme flag, so our own
      // inline styles and data-* tags can never re-trigger the observer.
      const observer = new MutationObserver(scheduleRegionRefresh);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-ds-dark-theme"],
      });
      return () => {
        unsubscribe();
        if (typeof offTheme === "function") offTheme();
        observer.disconnect();
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        if (gcTimer) {
          clearTimeout(gcTimer);
          gcTimer = null;
        }
        clearInterval(breatheTimer);
        if (themeAnimTimer) {
          clearTimeout(themeAnimTimer);
          themeAnimTimer = null;
        }
        // Everything above is per-instance wiring and always has to go. Everything below owns
        // the DOM, and only the newest instance is allowed to touch it: if a previous apply()
        // has already been superseded, its cleanup used to remove the body flag and panel
        // stylesheet the new instance had just installed, which silently killed every
        // `body[data-dsh-image-skin] …` rule and left the panels opaque.
        if (generation !== applyGeneration) return;
        document.body.removeAttribute(THEME_ANIM_ATTR);
        paintedWindowImage = null;
        disposeWarmers();
        readSkinValue = null;
        readSkinMode = null;
        reapply = null;
        reapplyWith = null;
        refreshAccent = null;
        disposeSkinDom();
        document.body.removeAttribute(BODY_ATTR);
      };
    },
    "dsh-image-skin: apply region images",
  );

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "image-skin",
        order: 25,
        label: () => "图片皮肤",
        inject: () => ({}),
      },
      section,
    ),
  );

  // Light/dark switch beside Settings at the sidebar foot (`sidebar.footer.action`). It
  // measures the Settings button and matches its height, so the two read as peers.
  function ModeAction(): React.ReactElement {
    const mode = React.useSyncExternalStore(modeStore.subscribe, modeStore.get);
    return React.createElement(ModeSwitch, {
      mode,
      variant: "footer",
      onPick: (m: Mode) => modeStore.pick(m),
    });
  }

  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "image-skin-mode",
        order: 30,
        label: () => "图片皮肤：浅色/深色",
      },
      ModeAction,
    ),
  );
}
