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
    ".dshImgSkin-intro{font-size:12px;line-height:1.6;opacity:.62;margin:0}",
    ".dshImgSkin-banner{font-size:12px;line-height:1.5;border-radius:8px;padding:7px 11px;margin:0;",
    "background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 12%,transparent);",
    "color:var(--dsw-alias-state-error-primary,#d9534f)}",
    ".dshImgSkin-ok{font-size:12px;opacity:.72;margin:0}",

    // ── section card ──────────────────────────────────────────────────────────
    ".dshImgSkin-card{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:14px;",
    "background:var(--dsw-alias-bg-layer-1,transparent);padding:14px 16px;display:flex;flex-direction:column;gap:12px}",
    ".dshImgSkin-cardhead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}",
    ".dshImgSkin-title{font-weight:600;font-size:13.5px;letter-spacing:.2px}",
    ".dshImgSkin-sub{font-size:11.5px;line-height:1.55;opacity:.58;margin:3px 0 0}",
    ".dshImgSkin-hint{font-size:11.5px;line-height:1.55;opacity:.58;display:block;margin-top:3px}",

    // ── segmented control (mode filter) ───────────────────────────────────────
    ".dshImgSkin-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;",
    "background:color-mix(in srgb,currentColor 9%,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22))}",
    ".dshImgSkin-seg>button{cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;",
    "padding:5px 13px;border-radius:8px;display:inline-flex;align-items:center;gap:6px;opacity:.66;transition:background .15s,opacity .15s}",
    ".dshImgSkin-seg>button:hover{opacity:.9}",
    ".dshImgSkin-seg>button[data-on='true']{opacity:1;font-weight:600;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));",
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
    ".dshImgSkin-src{font-size:11px;opacity:.55;line-height:1.5}",
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
    ".dshImgSkin-btn[data-variant='primary']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);color:var(--dsw-alias-brand-primary,#5aa7d8)}",
    ".dshImgSkin-btn[data-variant='quiet']{border-color:transparent;opacity:.7}",
    ".dshImgSkin-btn[data-variant='quiet']:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}",
    ".dshImgSkin-switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;opacity:.85;cursor:pointer;user-select:none}",
    ".dshImgSkin-slider{display:flex;flex-direction:column;gap:6px}",
    ".dshImgSkin-slider input[type=range]{width:100%;margin:0}",
    ".dshImgSkin-sliderhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}",
    ".dshImgSkin-value{font-size:12px;font-variant-numeric:tabular-nums;opacity:.75}",
    ".dshImgSkin-range{width:100%;margin:2px 0 0}",
    ".dshImgSkin-range:disabled{opacity:.45}",
    ".dshImgSkin-ticks{display:flex;justify-content:space-between;gap:4px;margin-top:-2px}",
    ".dshImgSkin-tickBtn{cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;font-size:11px;",
    "opacity:.5;padding:2px 6px;border-radius:6px;white-space:nowrap}",
    ".dshImgSkin-tickBtn:hover{opacity:.85}",
    ".dshImgSkin-tickBtn[data-on='true']{opacity:1;font-weight:600}",
    ".dshImgSkin-tickBtn:disabled{cursor:default;opacity:.3}",
    ".dshImgSkin-accentCaption{font-size:12px;line-height:1.6;min-height:20px;",
    "transition:opacity .14s ease;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px}",
    ".dshImgSkin-accentCaption[data-visible='false']{opacity:0}",
    ".dshImgSkin-accentLevel{font-weight:600;opacity:.9}",
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
    ".dshImgSkin-results{display:flex;gap:8px;flex-wrap:wrap}",
    ".dshImgSkin-result{cursor:pointer;padding:0;border-radius:10px;overflow:hidden;",
    "border:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;line-height:0}",
    ".dshImgSkin-result:hover{border-color:var(--dsw-alias-brand-primary,#5aa7d8)}",
    ".dshImgSkin-result[data-on='true']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
    "box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#5aa7d8)}",
    ".dshImgSkin-result img{width:118px;height:74px;object-fit:cover;display:block}",
    ".dshImgSkin-fit{display:inline-flex;align-items:center;gap:5px}",
    ".dshImgSkin-fitlabel{font-size:11.5px;opacity:.55}",
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
      "position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;pointer-events:none;background:#000;";
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
  let style = document.getElementById(PANEL_STYLE_ID) as HTMLStyleElement | null;
  const opacity = Number(value.panelOpacity ?? 100);
  const a = Math.max(0, Math.min(1, opacity / 100));
  // Take the scheme from the theme service rather than the body flag: on a theme switch
  // the flag is applied a tick later, which would leave the panel tint one mode behind.
  const rgb = mode === "dark" ? "18, 31, 47" : "255, 255, 252";
  const l = (extra: number) => Math.min(1, a + extra).toFixed(3);
  if (!style) {
    style = document.createElement("style");
    style.id = PANEL_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = [
    `body[${BODY_ATTR}] {`,
    // Sticker overlays ride the slider so the skin fades with the panel; the wallpaper
    // itself stays full-strength (see applyWindow).
    `  ${IMG_ALPHA_VAR}: ${a.toFixed(3)};`,
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
const ACCENT_ATTR = "data-dsh-skin-accent";
const ACCENT_MARK = "data-dsh-accent";

interface AccentLevelDef {
  name: string;
  desc: string;
  ready: boolean;
}

/** Level 0 is local palette extraction; levels 1..4 ask the image model to generate an ornament. */
const ACCENT_LEVELS: AccentLevelDef[] = [
  { name: "取色", desc: "只把按钮与面板染成壁纸的色调（本机计算，不联网）", ready: true },
  { name: "轻纹样", desc: "AI 生成：一条细边框线 + 小角饰", ready: true },
  { name: "标准", desc: "AI 生成：完整装饰框，角花 + 连续边饰", ready: true },
  { name: "华丽", desc: "AI 生成：多层纹样，繁复卷草", ready: true },
  { name: "极致", desc: "AI 生成：浮雕质感 + 珠宝式角饰", ready: true },
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
let accentTargets: HTMLElement[] = [];

/**
 * Reduce an image to a handful of representative colours. A 4-bit bucket histogram over a
 * 64px-wide sampling is plenty for tinting chrome and costs a few milliseconds.
 */
async function extractPalette(url: string): Promise<string[]> {
  const cached = paletteCache.get(url);
  if (cached) return cached;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return [];
  }
  const w = 64;
  const h = Math.max(1, Math.round((64 * img.height) / Math.max(1, img.width)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return [];                                  // tainted canvas — treat as "no palette"
  }
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1;
    e.r += data[i];
    e.g += data[i + 1];
    e.b += data[i + 2];
    buckets.set(key, e);
  }
  // Pick colours by *presence in the picture* x *how usable they are as a tint*, not by raw
  // pixel count. A night sky is mostly near-black, so "the most common colour" is usually a
  // muddy dark grey that makes the whole UI look dirty; the aurora's green is far rarer but is
  // the colour a person actually sees in that image.
  const score = (r: number, g: number, b: number): number => {
    const col = [r, g, b];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;           // chroma, 0..1
    const lig = (max + min) / 510;                           // lightness, 0..1
    const mid = Math.max(0, 1 - Math.abs(lig - 0.55) * 1.8); // prefer mid-tones
    return sat * mid;
  };
  const palette = [...buckets.values()]
    .map((e) => {
      const r = e.r / e.n;
      const g = e.g / e.n;
      const b = e.b / e.n;
      return { r, g, b, n: e.n, weight: e.n * (0.25 + score(r, g, b)) };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((e) => `${Math.round(e.r)}, ${Math.round(e.g)}, ${Math.round(e.b)}`);
  paletteCache.set(url, palette);
  return palette;
}

function visible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
}

/** Mark the on-screen skeleton elements, stamping each with the accent attribute. */
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

/**
 * Build a nine-slice decoration frame as an inline SVG data URI.
 *
 * A CSS gradient can only draw straight lines, which is why the first attempt read as a dashed
 * "disabled" outline rather than ornament. SVG has no such limit: corners get a motif, edges get
 * a repeating figure, and the whole thing is parameterised by the wallpaper palette. Used with
 * `border-image`, the frame sits *outside* the element (border-image-outset) so it decorates
 * without disturbing layout.
 *
 * @param corner  corner motif colour (rgba string)
 * @param edge    edge figure colour (rgba string)
 * @param ornate  true for the busier motif used by the higher level
 */
function frameDataUri(corner: string, edge: string, ornate: boolean): string {
  const S = 96;          // slice artwork size; border-image-slice below must match
  const C = 28;          // corner cell
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
  ];

  // Edge figures: a row of small lozenges along the top and left.
  for (let i = C + 8; i < S - C - 4; i += 16) {
    parts.push(`<path d="M ${i} 3 l 5 5 l -5 5 l -5 -5 z" fill="${edge}" stroke="none" opacity=".85"/>`);
    parts.push(`<path d="M 3 ${i} l 5 5 l -5 5 l -5 -5 z" fill="${edge}" stroke="none" opacity=".85"/>`);
  }
  if (ornate) {
    // A second, offset row for the richer level.
    for (let i = C + 16; i < S - C - 4; i += 16) {
      parts.push(`<circle cx="${i}" cy="11" r="1.7" fill="${corner}" stroke="none" opacity=".7"/>`);
      parts.push(`<circle cx="11" cy="${i}" r="1.7" fill="${corner}" stroke="none" opacity=".7"/>`);
    }
  }

  // Corner motif: a quarter rosette plus a short diagonal flourish.
  parts.push(`<path d="M 4 4 h ${C - 6} a 6 6 0 0 1 6 6 v ${C - 6}" stroke="${corner}" stroke-width="2"/>`);
  parts.push(`<path d="M 10 10 h ${ornate ? 10 : 7} M 10 10 v ${ornate ? 10 : 7}" stroke="${corner}" stroke-width="1.4" opacity=".8"/>`);
  parts.push(
    ornate
      ? `<circle cx="19" cy="19" r="2.6" fill="${corner}" stroke="none"/><circle cx="26" cy="12" r="1.6" fill="${edge}" stroke="none"/>`
      : `<circle cx="19" cy="19" r="1.8" fill="${corner}" stroke="none"/>`,
  );

  parts.push(`</g></svg>`);
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(parts.join(""))}")`;
}

function hexToRgb(triple: string): { r: number; g: number; b: number } {
  const [r, g, b] = triple.split(",").map((n) => Number(n.trim()));
  return { r: r || 128, g: g || 128, b: b || 128 };
}

/**
 * Build the decoration rules. Levels 1 and 2 are pure CSS patterns so they cost nothing, need
 * no assets and survive any resolution.
 */
function accentCss(palette: string[], level: number, mode: Mode, chosenFrame: string): string {
  const base = palette[0] ?? (mode === "dark" ? "90, 110, 140" : "150, 165, 190");
  const alt = palette[1] ?? base;
  const { r, g, b } = hexToRgb(base);
  const { r: a2, g: g2, b: b2 } = hexToRgb(alt);
  const tint = mode === "dark" ? 0.16 : 0.13;

  const lines = [
    `body[${BODY_ATTR}][${ACCENT_ATTR}] [${ACCENT_MARK}]{`,
    `  border-color: rgba(${r}, ${g}, ${b}, .42) !important;`,
    `}`,
  ];

  if (level === 0) {
    lines.push(
      `body[${BODY_ATTR}][${ACCENT_ATTR}] [${ACCENT_MARK}]{`,
      `  background-color: rgba(${r}, ${g}, ${b}, ${tint}) !important;`,
      `}`,
    );
  } else {
    // A user-picked generated frame wins over anything we can draw: real ornament is art, and a
    // model draws it far better than a gradient can. Otherwise fall back to the built-in SVG
    // frame so the level still does something before the first generation.
    const chosen = chosenFrame;
    const frame = chosen
      ? `url("${chosen}")`
      : frameDataUri(`rgba(${r}, ${g}, ${b}, .92)`, `rgba(${a2}, ${g2}, ${b2}, .8)`, level >= 3);
    const thick = chosen ? (level >= 3 ? 16 : level >= 2 ? 13 : 10) : level >= 2 ? 14 : 11;
    lines.push(
      `body[${BODY_ATTR}][${ACCENT_ATTR}] [${ACCENT_MARK}]{`,
      `  background-color: rgba(${r}, ${g}, ${b}, ${tint}) !important;`,
      `  background-image:`,
      `    repeating-linear-gradient(45deg, rgba(${r}, ${g}, ${b}, .12) 0 1px, transparent 1px 9px) !important;`,
      `  background-size: auto !important;`,
      // The frame rides outside the box (outset) and is far thicker than the border itself, so
      // it reads as ornament rather than as a state outline - and it costs no layout space.
      `  border: 2px solid transparent !important;`,
      `  border-image-source: ${frame} !important;`,
      `  border-image-slice: ${chosen ? "30" : "28"} ${chosen ? "30" : "28"} ${chosen ? "30" : "28"} ${chosen ? "30" : "28"} fill !important;`,
      `  border-image-width: ${thick}px !important;`,
      `  border-image-outset: ${level >= 2 ? "5px" : "4px"} !important;`,
      `  border-image-repeat: stretch !important;`,
      `}`,
    );
  }
  return lines.join("\n");
}

/** Reflect the configured level + artwork onto the skeleton. */
async function applyAccent(value: SkinValue, mode: Mode): Promise<void> {
  let style = document.getElementById(ACCENT_STYLE_ID) as HTMLStyleElement | null;
  const raw = Number(value.accentLevel ?? 0);
  const level = Number.isFinite(raw) ? Math.max(0, Math.min(3, Math.round(raw))) : 0;
  const wallpaper = resolveAreaImage(value, "window", mode);

  // Level 3 is not implemented yet: fall back to the richest local level rather than
  // pretending to have decorated anything.
  const effective = level === 3 ? 2 : level;

  if (!wallpaper || value.accentEnabled === false) {
    document.body.removeAttribute(ACCENT_ATTR);
    style?.remove();
    accentTargets.forEach((el) => el.removeAttribute(ACCENT_MARK));
    accentTargets = [];
    return;
  }

  const palette = await extractPalette(wallpaper);
  if (!palette.length) {
    document.body.removeAttribute(ACCENT_ATTR);
    style?.remove();
    return;
  }

  accentTargets = scanAccentTargets();
  accentTargets.forEach((el) => el.setAttribute(ACCENT_MARK, ""));
  document.body.setAttribute(ACCENT_ATTR, String(effective));

  if (!style) {
    style = document.createElement("style");
    style.id = ACCENT_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = accentCss(palette, effective, mode, String(value.accentFrame ?? ""));
}

function disposeAccent(): void {
  document.getElementById(ACCENT_STYLE_ID)?.remove();
  document.body.removeAttribute(ACCENT_ATTR);
  document.querySelectorAll<HTMLElement>(`[${ACCENT_MARK}]`).forEach((el) => el.removeAttribute(ACCENT_MARK));
  accentTargets = [];
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
  void applyAccent(value, mode);
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
    sourceKind === "mode" ? `${modeWord}专用` : sourceKind === "shared" ? "两模式共用" : "未设置";
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
      sharedImage ? null : picker("up-shared", "上传共用图", sharedField, "quiet"),
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
            sourceKind === "shared" ? "清除共用图" : "清除",
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
          "根据窗口壁纸的配色，给按钮、弹窗和设置分区加底纹。档位越高越复杂；前几档在本机算，不联网。",
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
 * AI ornament panel: pick a provider, supply a key, choose a strength, generate, keep one.
 *
 * The key may come from an environment variable (read-only here, never persisted) or from this
 * box. Everything network-facing happens in the host half - this component only sends the chosen
 * provider id and, when in manual mode, the typed key.
 */
function AiAccentPanel(props: {
  value: SkinValue;
  onSet: (field: string, val: unknown) => void;
  strength: number;
}): React.ReactElement {
  const h = React.createElement;
  const v = props.value;
  const [providers, setProviders] = React.useState<Array<Record<string, unknown>> | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<string[]>([]);
  const [promptPreview, setPromptPreview] = React.useState<string | null>(null);

  const providerId = String(v.accentProvider ?? "ark-seedream");
  const keyMode = String(v.accentKeyMode ?? "env");
  const current = providers?.find((p) => p.id === providerId) ?? null;
  const isCustom = providerId === "custom";

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

  const promptBody = () => ({
    strength: props.strength,
    style: String(v.accentStyle ?? ""),
    palette: String(v.accentPalette ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    extra: String(v.accentPromptExtra ?? ""),
  });

  const fetchPrompt = async (): Promise<string> => {
    const res = await fetch(`${ROUTE_PREFIX}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promptBody()),
    });
    const data = await res.json();
    return String(data?.prompt ?? "");
  };

  const preview = async () => {
    try {
      setPromptPreview(await fetchPrompt());
    } catch (error) {
      setPromptPreview(`无法获取：${String(error)}`);
    }
  };

  const generate = async () => {
    setBusy(true);
    setStatus("生成中…（一般 10-60 秒）");
    setResults([]);
    try {
      const prompt = await fetchPrompt();
      const res = await fetch(`${ROUTE_PREFIX}/gen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId,
          baseUrl: String(v.accentBaseUrl ?? ""),
          model: String(v.accentModel ?? ""),
          apiKey: keyMode === "manual" ? String(v.accentApiKey ?? "") : "",
          apiKeyEnv: String(v.accentKeyEnv ?? ""),
          prompt,
          count: Number(v.accentCount ?? 1),
          size: String(v.accentSize ?? "1024x1024"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`失败：${String(data?.error ?? res.status)}`);
        return;
      }
      const urls: string[] = Array.isArray(data?.urls) ? data.urls : [];
      setResults(urls);
      setStatus(urls.length ? `生成完成 ${urls.length} 张 —— 点一下就用它作装饰框` : "没有返回图片");
    } catch (error) {
      setStatus(`失败：${String(error)}`);
    } finally {
      setBusy(false);
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
      onChange: (e: any) => props.onSet(fieldName, e.target.value),
      ...opts,
    });

  const envReady = Boolean(current?.envReady);
  const envName = String(current?.keyEnv ?? "");

  return h(
    "div",
    { className: "dshImgSkin-card" },
    h(
      "div",
      { className: "dshImgSkin-cardhead" },
      h(
        "div",
        null,
        h("span", { className: "dshImgSkin-title" }, "AI 纹样（生成装饰）"),
        h("p", { className: "dshImgSkin-sub" }, "用绘图模型生成真正的花纹，用作按钮与弹窗的装饰框；只生成纹样，不含内容。"),
      ),
      h("button", { className: "dshImgSkin-btn", type: "button", onClick: () => void preview() }, "预览提示词"),
    ),

    field(
      "prov",
      "服务商",
      h(
        "select",
        {
          className: "dshImgSkin-input",
          value: providerId,
          onChange: (e: any) => props.onSet("accentProvider", e.target.value),
        },
        (providers ?? []).map((p) => h("option", { key: String(p.id), value: String(p.id) }, String(p.label))),
      ),
      current ? (isCustom ? "自定义：下面填 Base URL 与模型 ID" : `默认模型 ${String(current.model)}`) : "加载中…",
    ),

    isCustom ? field("base", "Base URL", textInput("accentBaseUrl", { placeholder: "https://your-endpoint/v1" })) : null,
    isCustom ? field("model", "模型 ID", textInput("accentModel", { placeholder: "your-model-id" })) : null,

    field(
      "keysrc",
      "API Key",
      h(
        "div",
        { className: "dshImgSkin-seg" },
        (["env", "manual"] as const).map((m) =>
          h(
            "button",
            {
              key: m,
              type: "button",
              "data-on": String(keyMode === m),
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
      ? field(
          "envname",
          "变量名",
          textInput("accentKeyEnv", { placeholder: envName || "ARK_API_KEY", disabled: Boolean(envName) }),
          "留空则用该服务商的默认变量名",
        )
      : field("key", "Key", textInput("accentApiKey", { type: "password", placeholder: "sk-..." })),

    field(
      "count",
      "张数 / 尺寸",
      h(
        "div",
        { className: "dshImgSkin-inline" },
        h("input", {
          className: "dshImgSkin-input dshImgSkin-inputNarrow",
          type: "number",
          min: 1,
          max: 4,
          value: String(v.accentCount ?? 1),
          onChange: (e: any) => props.onSet("accentCount", Number(e.target.value)),
        }),
        h("span", { className: "dshImgSkin-hint" }, "张（1-4）"),
        h(
          "select",
          {
            className: "dshImgSkin-input dshImgSkin-inputNarrow",
            value: String(v.accentSize ?? "1024x1024"),
            onChange: (e: any) => props.onSet("accentSize", e.target.value),
          },
          ["1024x1024", "1280x720", "720x1280"].map((s) => h("option", { key: s, value: s }, s)),
        ),
      ),
    ),

    field("style", "风格（可选）", textInput("accentStyle", { placeholder: "art nouveau / 赛博霓虹 / 水墨 …" })),

    promptPreview ? h("div", { className: "dshImgSkin-promptBox" }, promptPreview) : null,
    status ? h("p", { className: "dshImgSkin-ok" }, status) : null,

    h(
      "div",
      { className: "dshImgSkin-ops" },
      h(
        "button",
        {
          className: "dshImgSkin-btn",
          type: "button",
          "data-variant": "primary",
          disabled: busy,
          onClick: () => void generate(),
        },
        busy ? "生成中…" : "生成装饰",
      ),
    ),

    results.length
      ? h(
          "div",
          { className: "dshImgSkin-results" },
          results.map((url, i) =>
            h(
              "button",
              {
                key: `${url}-${i}`,
                type: "button",
                className: "dshImgSkin-result",
                "data-on": String(String(v.accentFrame ?? "") === url),
                title: "点击应用这张",
                onClick: () => props.onSet("accentFrame", url),
              },
              h("img", { src: url, alt: "" }),
            ),
          ),
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
      onPick: (file: File, field: string) => void upload(field, file),
      onSet: (field: string, val: unknown) => void scope.set(field, val),
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
            h("span", { className: "dshImgSkin-title" }, title),
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

    return h(
      "div",
      { className: "dshImgSkin-shell" },
      h(
        "p",
        { className: "dshImgSkin-intro" },
        "给界面各区域换上你自己的图片或视频；图片只存在本机（$DSH_HOME/image-skin），不会上传到外部服务。",
      ),
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
              "浅色和深色各有一套图；切换时界面主题也会跟着切，方便边配边看。某个区域没单独配，会回退到「共用图」。",
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
            h("p", { className: "dshImgSkin-sub" }, "两个模式共用，拖动即时生效。"),
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
          onCommit: (n: number) => void scope.set("panelOpacity", n),
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
          onCommit: (n: number) => void scope.set("videoPlaybackRate", n),
        }),
        h(AccentRow, {
          key: "accent",
          level: Number(v.accentLevel ?? 0),
          enabled: v.accentEnabled !== false,
          onChange: (n: number) => void scope.set("accentLevel", n),
          onToggle: (on: boolean) => void scope.set("accentEnabled", on),
        }),
      ),
      h(AiAccentPanel, {
        value: v,
        strength: Math.max(1, Number(v.accentLevel ?? 1)),
        onSet: (field: string, val: unknown) => void scope.set(field, val),
      }),
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
              `图片存在 $DSH_HOME/image-skin，单文件上限 ${MAX_UPLOAD_MB} MB；换图或清除后不再被引用的旧文件会自动删除`,
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
  document.getElementById(PANEL_STYLE_ID)?.remove();
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
      }) as (() => void) | undefined;
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
