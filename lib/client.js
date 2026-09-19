window.__ModuleLoader__.load({
	id: "dsh-image-skin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = void 0;
exports.resolveAreaImage = resolveAreaImage;
exports.apply = apply;
/**
 * dsh-image-skin — Browser half.
 *
 * Binds the `ui-image-skin` settings namespace, applies configured images to
 * their UI regions / sticker anchors, and registers the settings submenu card.
 *
 * Region selectors target DSH's CSS-module class *suffixes* (e.g. `_centerCol`)
 * rather than hashed prefixes, so they survive DSH rebuilds while local names hold.
 */
const React = require("react");
const NS = "ui-image-skin";
const ROUTE_PREFIX = "/dsh-image-skin";
const BODY_ATTR = "data-dsh-image-skin";
const PANEL_STYLE_ID = "dsh-image-skin-panel";
const IMG_ALPHA_VAR = "--dsh-skin-img-opacity";
/** Keep in step with MAX_UPLOAD_BYTES (32 MB base64 envelope) in the host half. */
const MAX_UPLOAD_MB = 24;
exports.inject = ["slots", "settingsScope", "theme"];
/** Live editor state shared between the React section and the non-React renderer. */
let currentEditing = null;
let reapply = null;
let finishButton = null;
/** Region + sticker registry — keep ids in sync with IMAGE_AREAS in src/index.ts */
const AREAS = [
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
const REGION_SELECTORS = {
    center: ['[class*="_centerCol"]', "main", '[role="main"]'],
    sidebar: ['[class*="_sidebarCol"]', '[role="tree"]'],
    welcome: ['[class*="_hero"]'],
    rightbar: ['section[class*="_pane"]', '[class*="_panelBody"]'],
    composer: ['[class*="_composerSeat"]'],
};
const STYLE_ID = "dsh-image-skin-styles";
/** Marks the brief window in which colour-bearing properties transition (theme cross-fade). */
const THEME_ANIM_ATTR = "data-dsh-skin-theme-anim";
const THEME_ANIM_MS = 320;
/** Temporary layer used to cross-fade one wallpaper into the next. */
const WALL_FADE_ID = "dsh-image-skin-wall-fade";
function ensureBaseStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
        ".dshImgSkin-shell{display:flex;flex-direction:column;gap:10px;padding:4px 0 16px}",
        ".dshImgSkin-row{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1,transparent)}",
        ".dshImgSkin-head{display:flex;justify-content:space-between;align-items:center;gap:12px}",
        ".dshImgSkin-title{font-weight:600}",
        ".dshImgSkin-hint{font-size:12px;opacity:.65;display:block;margin-top:3px}",
        ".dshImgSkin-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
        ".dshImgSkin-thumb{width:140px;height:78px;object-fit:cover;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));background:rgba(128,128,128,.08)}",
        ".dshImgSkin-btn{cursor:pointer;padding:5px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit}",
        ".dshImgSkin-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}",
        ".dshImgSkin-btn[disabled]{opacity:.5;cursor:not-allowed}",
        ".dshImgSkin-btn[data-active='true']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);color:var(--dsw-alias-brand-primary,#5aa7d8)}",
        "[data-dsh-skin-editing='true']{outline:2px dashed var(--dsw-alias-brand-primary,#5aa7d8);outline-offset:2px}",
        // Theme switch: for one short window, every colour-bearing property transitions, so
        // light <-> dark cross-fades instead of snapping. Animations are untouched; only the
        // transition longhands are forced, and only while the attribute is present.
        `body[${THEME_ANIM_ATTR}],body[${THEME_ANIM_ATTR}] *,body[${THEME_ANIM_ATTR}] *::before,body[${THEME_ANIM_ATTR}] *::after{`,
        "transition-property:background-color,color,border-color,outline-color,fill,stroke,box-shadow !important;",
        `transition-duration:${THEME_ANIM_MS}ms !important;`,
        "transition-timing-function:cubic-bezier(.4,0,.2,1) !important;",
        "transition-delay:0s !important;}",
    ].join("");
    document.head.append(style);
}
function fitProps(fit) {
    if (fit === "contain")
        return { size: "contain", repeat: "no-repeat" };
    if (fit === "tile")
        return { size: "auto", repeat: "repeat" };
    return { size: "cover", repeat: "no-repeat" };
}
// ── light / dark aware resolution ───────────────────────────────────────────
/**
 * Current UI scheme. The theme service is authoritative (`theme/change` keeps us in
 * sync when the user switches from DSH's own Appearance setting); the body flag is
 * only a fallback for the moment before the service is readable.
 */
function readMode(theme) {
    try {
        const scheme = theme?.getTheme().active.colorScheme;
        if (scheme === "light" || scheme === "dark")
            return scheme;
    }
    catch {
        /* fall through to the DOM flag */
    }
    return document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
}
/**
 * Resolve one area's image for a mode: the mode-specific override wins, otherwise the
 * shared field, otherwise nothing. Exported so the offline suite can pin the fallback.
 */
function resolveAreaImage(value, id, mode) {
    const v = value ?? {};
    const specific = String(v[`${id}Image${mode === "dark" ? "Dark" : "Light"}`] ?? "");
    return specific || String(v[`${id}Image`] ?? "");
}
/** The stored playback rate, clamped to the schema's range. */
function videoRate(value) {
    const n = Number(value.videoPlaybackRate ?? 1);
    if (!Number.isFinite(n))
        return 1;
    return Math.min(4, Math.max(0.1, n));
}
/** Live-apply a rate to whatever video is currently rendered (slider preview). */
function previewVideoRate(rate) {
    const r = Math.min(4, Math.max(0.1, Number(rate) || 1));
    const layer = document.getElementById(VIDEO_LAYER_ID);
    if (layer) {
        layer.defaultPlaybackRate = r;
        layer.playbackRate = r;
    }
    document.querySelectorAll('[data-dsh-skin-sticker] video').forEach((v) => {
        v.defaultPlaybackRate = r;
        v.playbackRate = r;
    });
}
// ── theme cross-fade ────────────────────────────────────────────────────────
let themeAnimTimer = null;
/** What the window layer is currently showing, so a mode switch can cross-fade from it. */
let paintedWindowImage = null;
/**
 * Open a short window in which colour-bearing properties transition. Called immediately
 * *before* the theme changes, so the transition is already in place when new values land.
 */
function startThemeAnimation() {
    const body = document.body;
    body.setAttribute(THEME_ANIM_ATTR, "");
    if (themeAnimTimer)
        clearTimeout(themeAnimTimer);
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
function crossFadeWindow(value, from, to) {
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
        if (typeof reapply === "function")
            reapply();
        document.getElementById(WALL_FADE_ID)?.remove();
    }, THEME_ANIM_MS + 40);
}
// ── window (body + sidebar column) ──────────────────────────────────────────
function applyWindowColumns(image) {
    document.querySelectorAll('[class*="_sidebarCol"]').forEach((el) => {
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
function videoLayer() {
    let v = document.getElementById(VIDEO_LAYER_ID);
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
function clearWindowImage() {
    const body = document.body;
    body.style.removeProperty("background-image");
    body.style.removeProperty("background-size");
    body.style.removeProperty("background-repeat");
    body.style.removeProperty("background-attachment");
    body.style.removeProperty("background-position");
}
function applyWindow(value, mode, fade = false) {
    const body = document.body;
    const image = resolveAreaImage(value, "window", mode);
    const on = value.windowEnabled !== false && value.enabled !== false && image.length > 0;
    const isVideo = on && VIDEO_RE.test(image);
    const existing = document.getElementById(VIDEO_LAYER_ID);
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
            void v.play?.().catch(() => { });
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
    if (existing)
        existing.remove();
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
function applyPanelOpacity(value, mode) {
    let style = document.getElementById(PANEL_STYLE_ID);
    const opacity = Number(value.panelOpacity ?? 100);
    const a = Math.max(0, Math.min(1, opacity / 100));
    // Take the scheme from the theme service rather than the body flag: on a theme switch
    // the flag is applied a tick later, which would leave the panel tint one mode behind.
    const rgb = mode === "dark" ? "18, 31, 47" : "255, 255, 252";
    const l = (extra) => Math.min(1, a + extra).toFixed(3);
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
    ].join("\n");
}
// ── regions ─────────────────────────────────────────────────────────────────
function clearRegionStyle(el) {
    el.removeAttribute("data-dsh-skin-region");
    el.style.removeProperty("background-image");
    el.style.removeProperty("background-size");
    el.style.removeProperty("background-repeat");
    el.style.removeProperty("background-position");
}
/** The live surface element for a region id, if it happens to be mounted right now. */
function regionSurface(id) {
    for (const sel of REGION_SELECTORS[id] ?? []) {
        const el = document.querySelector(sel);
        if (el)
            return el;
    }
    return null;
}
/** True when the mounted surface already carries our image for this region. */
function regionApplied(id, image) {
    const surface = regionSurface(id);
    if (!surface)
        return true; // region not mounted — nothing to repair
    if (document.querySelector(`[data-dsh-skin-region="${id}"]`) !== surface)
        return false;
    return surface.style.getPropertyValue("background-image").includes(image);
}
function applyRegionImage(id, value, mode, force = false) {
    const image = resolveAreaImage(value, id, mode);
    const on = value.enabled !== false && value[`${id}Enabled`] !== false && image.length > 0;
    if (!force && on && regionApplied(id, image))
        return; // already painted on the live surface
    document.querySelectorAll(`[data-dsh-skin-region="${id}"]`).forEach(clearRegionStyle);
    if (!on)
        return;
    const surface = regionSurface(id);
    if (!surface)
        return;
    const { size, repeat } = fitProps(String(value[`${id}Fit`] ?? "cover"));
    const dx = Number(value[`${id}OffsetX`] ?? 0);
    const dy = Number(value[`${id}OffsetY`] ?? 0);
    surface.setAttribute("data-dsh-skin-region", id);
    surface.style.setProperty("background-image", `url("${image}")`, "important");
    surface.style.setProperty("background-size", size, "important");
    surface.style.setProperty("background-repeat", repeat, "important");
    surface.style.setProperty("background-position", `calc(50% + ${Math.round(dx)}px) calc(50% + ${Math.round(dy)}px)`, "important");
}
function cornerCss(corner) {
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
function attachDrag(el, id, value, commit, scaleOf) {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let bx = 0;
    let by = 0;
    el.addEventListener("pointerdown", (e) => {
        if (e.target.dataset.skinHandle)
            return;
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
        if (!dragging)
            return;
        el.style.translate = `${e.clientX - sx}px ${e.clientY - sy}px`;
    });
    const finish = (e) => {
        if (!dragging)
            return;
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
function applySticker(area, value, mode, editing, commit) {
    document.querySelectorAll(`[data-dsh-skin-sticker="${area.id}"]`).forEach((el) => el.remove());
    const image = resolveAreaImage(value, area.id, mode);
    const on = value.enabled !== false && value[`${area.id}Enabled`] !== false && image.length > 0;
    if (!on || !area.sel)
        return;
    const target = document.querySelector(area.sel);
    if (!target)
        return;
    if (getComputedStyle(target).position === "static") {
        target.style.position = "relative";
        target.setAttribute("data-dsh-skin-sticker-host", "");
    }
    const scale = Number(value[`${area.id}Scale`] ?? 100) / 100;
    const dx = Number(value[`${area.id}OffsetX`] ?? 0);
    const dy = Number(value[`${area.id}OffsetY`] ?? 0);
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
    let media;
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
        void video.play?.().catch(() => { });
        media = video;
    }
    else {
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
    if (!editing)
        return;
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
        if (!resizing)
            return;
        const next = Math.max(10, Math.min(400, baseScale + (e.clientX - rsx)));
        const s = Math.round(72 * (next / 100));
        box.style.width = `${s}px`;
        box.style.height = `${s}px`;
    });
    const finishResize = (e) => {
        if (!resizing)
            return;
        resizing = false;
        const next = Math.max(10, Math.min(400, baseScale + (e.clientX - rsx)));
        commit({ [`${area.id}Scale`]: Math.round(next) });
    };
    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
}
/** Enter/leave the on-page position editor. */
function setEditing(id) {
    currentEditing = id;
    ensureFinishButton();
    reapply?.();
}
function ensureFinishButton() {
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
    }
    else if (!currentEditing && finishButton) {
        finishButton.remove();
        finishButton = null;
    }
}
// ── apply all ───────────────────────────────────────────────────────────────
function applyAll(value, editingId, commit, mode, fade = false) {
    applyWindow(value, mode, fade);
    applyPanelOpacity(value, mode);
    for (const area of AREAS) {
        if (area.id === "window")
            continue;
        if (area.kind === "sticker")
            applySticker(area, value, mode, editingId === area.id, commit);
        else
            applyRegionImage(area.id, value, mode, true);
    }
}
// ── repair pass ─────────────────────────────────────────────────────────────
// Region hosts (`_hero`, `_pane`, `_composerSeat`, …) mount and unmount while the
// app runs, and a re-render can replace the element carrying our inline background.
// This throttled pass repaints only what is actually missing, and never touches
// stickers, so an in-progress drag is not interrupted.
const REFRESH_DELAY_MS = 300;
let refreshTimer = null;
let readSkinValue = null;
let readSkinMode = null;
/** Repaint the window columns and every region whose live surface lost its image. */
function refreshRegions() {
    const value = readSkinValue?.();
    if (!value)
        return;
    const mode = readSkinMode ? readSkinMode() : readMode();
    const windowImage = resolveAreaImage(value, "window", mode);
    const columnsOn = value.enabled !== false && value.windowEnabled !== false && windowImage.length > 0 && !VIDEO_RE.test(windowImage);
    if (columnsOn) {
        const columns = Array.from(document.querySelectorAll('[class*="_sidebarCol"]'));
        if (columns.some((el) => !el.style.getPropertyValue("background-image")))
            applyWindowColumns(windowImage);
    }
    for (const area of AREAS) {
        if (area.kind === "sticker" || area.id === "window")
            continue;
        applyRegionImage(area.id, value, mode, false);
    }
}
function scheduleRegionRefresh() {
    if (refreshTimer)
        return;
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshRegions();
    }, REFRESH_DELAY_MS);
}
function makeModeStore(theme) {
    let listeners = [];
    return {
        get: () => readMode(theme),
        pick(mode) {
            try {
                // Start the transition window up front: `theme/change` usually arrives before the
                // palette is repainted, but we do not want to depend on that ordering.
                startThemeAnimation();
                theme?.setTheme(mode);
            }
            catch (error) {
                console.error("[dsh-image-skin] could not switch the theme", error);
            }
        },
        subscribe(cb) {
            listeners.push(cb);
            return () => {
                listeners = listeners.filter((l) => l !== cb);
            };
        },
        notify() {
            for (const l of listeners)
                l();
        },
    };
}
/** Sun glyph, drawn from primitives (no icon font, no image asset). */
function SunIcon(props) {
    const h = React.createElement;
    return h("svg", { width: props.size, height: props.size, viewBox: "0 0 24 24", "aria-hidden": "true" }, h("circle", { cx: 12, cy: 12, r: 4.6, fill: "currentColor" }), ...[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
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
    }));
}
/** Crescent moon, drawn as a masked disc with a per-instance mask id. */
function MoonIcon(props) {
    const h = React.createElement;
    const maskId = React.useMemo(() => `dsh-skin-moon-${Math.random().toString(36).slice(2, 8)}`, []);
    return h("svg", { width: props.size, height: props.size, viewBox: "0 0 24 24", "aria-hidden": "true" }, h("mask", { id: maskId }, h("rect", { x: 0, y: 0, width: 24, height: 24, fill: "#fff" }), h("circle", { cx: 16.5, cy: 8.5, r: 7.7, fill: "#000" })), h("circle", { cx: 12, cy: 12, r: 8.3, fill: "currentColor", mask: `url(#${maskId})` }));
}
const modeLabel = (m) => (m === "dark" ? "深色模式" : "浅色模式");
/**
 * Light/dark control, in two sizes:
 *  - `footer` — the switch beside Settings in the sidebar foot. It measures the tallest
 *    sibling button (the Settings trigger) and matches that height, so the two read as
 *    equally sized neighbours.
 *  - `card` — the two large entry buttons at the top of the plugin's settings page, which
 *    lead into the per-mode image menus.
 */
function ModeSwitch(props) {
    const h = React.createElement;
    if (props.variant === "card") {
        return h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, ...["light", "dark"].map((m) => {
            const active = props.mode === m;
            return h("button", {
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
            }, h(m === "dark" ? MoonIcon : SunIcon, { size: 30 }), h("span", { style: { fontWeight: 600 } }, modeLabel(m)), h("small", { style: { opacity: 0.75 } }, active ? "正在使用" : "点击进入"));
        }));
    }
    const ref = React.useRef(null);
    const [height, setHeight] = React.useState(null);
    React.useEffect(() => {
        const mine = ref.current;
        if (!mine)
            return;
        let node = mine.parentElement;
        for (let depth = 0; depth < 3 && node; depth++) {
            const others = Array.from(node.querySelectorAll("button")).filter((b) => b !== mine && !mine.contains(b));
            if (others.length > 0) {
                const tallest = others.reduce((acc, b) => Math.max(acc, b.getBoundingClientRect().height), 0);
                if (tallest > 0)
                    setHeight(Math.round(tallest));
                break;
            }
            node = node.parentElement;
        }
    }, []);
    const cell = (m) => {
        const active = props.mode === m;
        return h("span", {
            key: m,
            title: modeLabel(m),
            onClick: (e) => {
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
        }, h(m === "dark" ? MoonIcon : SunIcon, { size: 17 }));
    };
    return h("button", {
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
    }, cell("light"), cell("dark"));
}
/** Slider row with a debounced commit — used for panel opacity and video rate. */
function SliderRow(props) {
    const h = React.createElement;
    const [draft, setDraft] = React.useState(props.value);
    const timer = React.useRef(null);
    React.useEffect(() => {
        setDraft(props.value);
    }, [props.value]);
    React.useEffect(() => () => {
        if (timer.current)
            clearTimeout(timer.current);
    }, []);
    const handle = (n) => {
        setDraft(n);
        props.onPreview(n);
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            props.onCommit(n);
        }, 350);
    };
    return h("div", { className: "dshImgSkin-row" }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, props.title), h("small", { className: "dshImgSkin-hint" }, props.hint)), h("span", null, props.format(draft))), h("input", {
        type: "range",
        min: props.min,
        max: props.max,
        step: props.step,
        value: draft,
        onChange: (e) => handle(Number(e.target.value)),
    }));
}
/** One area row: mode-aware thumbnail, upload target, clear, fit, sticker editor. */
function AreaRow(props) {
    const h = React.createElement;
    const area = props.area;
    const v = props.value;
    const modeWord = props.mode === "dark" ? "深色" : "浅色";
    const specificField = `${area.id}Image${props.mode === "dark" ? "Dark" : "Light"}`;
    const sharedField = `${area.id}Image`;
    const specific = String(v[specificField] ?? "");
    const sharedImage = String(v[sharedField] ?? "");
    const effective = resolveAreaImage(v, area.id, props.mode);
    const source = specific ? `${modeWord}专用` : sharedImage ? "共用图（两个模式都用）" : "未设置";
    const enabled = v[`${area.id}Enabled`] !== false;
    const fit = String(v[`${area.id}Fit`] ?? "cover");
    const isVideo = effective.length > 0 && VIDEO_RE.test(effective);
    const button = (key, label, onClick, active = false) => h("button", { key, type: "button", className: "dshImgSkin-btn", "data-active": String(active), onClick }, label);
    return h("div", { className: "dshImgSkin-row", key: area.id }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, area.label), h("small", { className: "dshImgSkin-hint" }, `${area.hint} · 生效来源：${source}`)), h("label", { className: "dshImgSkin-actions" }, h("input", {
        type: "checkbox",
        checked: enabled,
        onChange: (e) => props.onSet(`${area.id}Enabled`, e.target.checked),
    }), "启用")), effective
        ? isVideo
            ? h("video", { className: "dshImgSkin-thumb", src: effective, muted: true, loop: true, autoPlay: true, playsInline: true })
            : h("img", { className: "dshImgSkin-thumb", src: effective, alt: "" })
        : null, h("div", { className: "dshImgSkin-actions" }, h("label", { className: "dshImgSkin-btn" }, props.busyField === specificField ? "上传中…" : `上传${modeWord}模式图片/视频`, h("input", {
        type: "file",
        accept: "image/*,video/*",
        style: { display: "none" },
        onChange: (e) => {
            const file = e.target.files?.[0];
            if (file)
                props.onPick(file, specificField);
            e.target.value = "";
        },
    })), specific ? button("clear-mode", "清除", () => props.onClear(specificField)) : null, !specific && sharedImage ? button("clear-shared", "清除共用图", () => props.onClear(sharedField)) : null, area.kind === "region"
        ? h("select", {
            key: "fit",
            className: "dshImgSkin-btn",
            value: fit,
            onChange: (e) => props.onSet(`${area.id}Fit`, e.target.value),
        }, h("option", { value: "cover" }, "铺满"), h("option", { value: "contain" }, "适应"), h("option", { value: "tile" }, "平铺"))
        : null, area.kind === "sticker" && effective
        ? button("edit-pos", props.editing ? "完成" : "编辑位置", () => props.onToggleEdit(area.id), props.editing)
        : null), props.editing ? h("small", { className: "dshImgSkin-hint" }, "拖动图片移动位置，拖右下角圆点缩放。") : null);
}
/** Ask the host to delete stored files no area references any more. */
async function collectUnusedFiles() {
    try {
        const resp = await fetch(`${ROUTE_PREFIX}/gc`, { method: "POST" });
        if (!resp.ok)
            return null;
        return (await resp.json());
    }
    catch {
        return null;
    }
}
let gcTimer = null;
/** Collect only after the settings write committed — the host reads the stored value. */
function scheduleCollectUnused(delay = 800) {
    if (gcTimer)
        clearTimeout(gcTimer);
    gcTimer = setTimeout(() => {
        gcTimer = null;
        void collectUnusedFiles();
    }, delay);
}
function formatMb(bytes) {
    return (bytes / 1024 / 1024).toFixed(1);
}
function createSection(scope, modeStore) {
    const h = React.createElement;
    return function ImageSkinSection() {
        const value = React.useSyncExternalStore((cb) => scope.subscribe(cb), () => scope.getSnapshot().value);
        const mode = React.useSyncExternalStore(modeStore.subscribe, modeStore.get);
        const v = value ?? {};
        const [busy, setBusy] = React.useState(null);
        const [editingId, setEditingId] = React.useState(currentEditing);
        const [notice, setNotice] = React.useState(null);
        const [gcStatus, setGcStatus] = React.useState(null);
        // Level 2 = the mode picker (plus the global sliders); level 3 = one mode's image menu.
        const [view, setView] = React.useState("menu");
        const upload = async (field, file) => {
            setNotice(null);
            if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
                setNotice(`${file.name} 有 ${formatMb(file.size)} MB，超过 ${MAX_UPLOAD_MB} MB 上限`);
                return;
            }
            setBusy(field);
            try {
                const dataUri = await new Promise((resolve, reject) => {
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
                const data = (await resp.json().catch(() => null));
                if (!resp.ok || !data?.url) {
                    setNotice(data?.error ?? `上传失败（HTTP ${resp.status}）`);
                    return;
                }
                await scope.set(field, data.url);
                scheduleCollectUnused();
            }
            catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                console.error("[dsh-image-skin] upload failed", error);
            }
            finally {
                setBusy(null);
            }
        };
        return h("div", { className: "dshImgSkin-shell" }, h("p", { className: "dshImgSkin-hint" }, "给每个区域/角标上传图片。图片只存在本机（$DSH_HOME/image-skin），不会上传到外部服务。角标可点「编辑位置」后拖动/缩放。"), notice ? h("p", { className: "dshImgSkin-hint", style: { color: "#d9534f" } }, notice) : null, view === "menu"
            ? h("div", { className: "dshImgSkin-row" }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "选择要配置的模式"), h("small", { className: "dshImgSkin-hint" }, "浅色和深色各有一套独立的图，互不影响。点下面的按钮会同时把界面切到该模式，边配边看。"))), h(ModeSwitch, {
                mode,
                variant: "card",
                onPick: (m) => {
                    modeStore.pick(m);
                    setView("mode");
                },
            }))
            : h("div", { className: "dshImgSkin-row" }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, `${mode === "dark" ? "深色" : "浅色"}模式 · 区域配图`), h("small", { className: "dshImgSkin-hint" }, "这里的每一项都只作用于当前模式；点「返回」回到模式选择。")), h("button", { className: "dshImgSkin-btn", type: "button", onClick: () => setView("menu") }, "← 返回"))), view === "menu"
            ? h(SliderRow, {
                key: "opacity",
                title: "面板不透明度",
                hint: "越低越能透出壁纸；角标贴图会同步变淡，壁纸本身不受影响",
                value: Number(v.panelOpacity ?? 100),
                min: 0,
                max: 100,
                step: 1,
                format: (n) => `${n}%`,
                onPreview: (n) => applyPanelOpacity({ ...v, panelOpacity: n }, mode),
                onCommit: (n) => void scope.set("panelOpacity", n),
            })
            : null, view === "menu"
            ? h(SliderRow, {
                key: "rate",
                title: "视频播放速率",
                hint: "作用于上传的视频（窗口壁纸与角标视频），拖动即时生效",
                value: Number(v.videoPlaybackRate ?? 1),
                min: 0.25,
                max: 3,
                step: 0.25,
                format: (n) => `${n}×`,
                onPreview: (n) => previewVideoRate(n),
                onCommit: (n) => void scope.set("videoPlaybackRate", n),
            })
            : null, view === "menu" &&
            h("div", { className: "dshImgSkin-row" }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "存储"), h("small", { className: "dshImgSkin-hint" }, `图片存在 $DSH_HOME/image-skin，单文件上限 ${MAX_UPLOAD_MB} MB；换图或清除后不再被引用的旧文件会自动删除`)), h("button", {
                className: "dshImgSkin-btn",
                onClick: () => {
                    void (async () => {
                        const report = await collectUnusedFiles();
                        if (!report) {
                            setGcStatus("清理失败：宿主未就绪");
                            return;
                        }
                        setGcStatus(report.removed.length
                            ? `已删除 ${report.removed.length} 个未使用文件，释放 ${formatMb(report.freedBytes)} MB`
                            : "没有可清理的文件");
                    })();
                },
            }, "清理未使用图片")), gcStatus ? h("small", { className: "dshImgSkin-hint" }, gcStatus) : null), view === "mode" &&
            AREAS.map((area) => h(AreaRow, {
                key: area.id,
                area,
                value: v,
                mode,
                busyField: busy,
                editing: editingId === area.id,
                onPick: (file, field) => void upload(field, file),
                onSet: (field, val) => void scope.set(field, val),
                onClear: (field) => {
                    void (async () => {
                        await scope.set(field, "");
                        scheduleCollectUnused();
                    })();
                },
                onToggleEdit: (id) => {
                    const next = editingId === id ? null : id;
                    setEditingId(next);
                    setEditing(next);
                },
            })));
    };
}
/** Toggle the live editor outline state on the page (outside React). */
function setEditingLive(id) {
    document.querySelectorAll("[data-dsh-skin-editing]").forEach((el) => el.removeAttribute("data-dsh-skin-editing"));
    if (!id)
        return;
    const el = document.querySelector(`[data-dsh-skin-sticker="${id}"]`) ||
        document.querySelector(`[data-dsh-skin-region="${id}"]`);
    if (el)
        el.setAttribute("data-dsh-skin-editing", "true");
}
/** Undo every DOM side effect this plugin applied, so disabling it restores the UI. */
function disposeSkinDom() {
    clearWindowImage();
    applyWindowColumns("");
    document.getElementById(VIDEO_LAYER_ID)?.remove();
    document.getElementById(WALL_FADE_ID)?.remove();
    document.querySelectorAll("[data-dsh-skin-sticker]").forEach((el) => el.remove());
    document.querySelectorAll("[data-dsh-skin-region]").forEach(clearRegionStyle);
    document.querySelectorAll("[data-dsh-skin-sticker-host]").forEach((el) => {
        el.style.removeProperty("position");
        el.removeAttribute("data-dsh-skin-sticker-host");
    });
    document.querySelectorAll("[data-dsh-skin-editing]").forEach((el) => el.removeAttribute("data-dsh-skin-editing"));
    finishButton?.remove();
    finishButton = null;
    currentEditing = null;
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(PANEL_STYLE_ID)?.remove();
}
function apply(ctx) {
    ensureBaseStyles();
    document.body.setAttribute(BODY_ATTR, "");
    const scope = ctx.settingsScope.bind({ namespace: NS });
    const modeStore = makeModeStore(ctx.theme);
    const section = createSection(scope, modeStore);
    const commit = (patch) => {
        for (const [k, val] of Object.entries(patch))
            void scope.set(k, val);
    };
    const renderSkin = (fade) => {
        const snapshot = scope.getSnapshot();
        if (snapshot.value)
            applyAll(snapshot.value, currentEditing, commit, modeStore.get(), fade);
    };
    const render = () => renderSkin(false);
    reapply = render;
    readSkinValue = () => scope.getSnapshot().value;
    readSkinMode = () => modeStore.get();
    ctx.effect(() => {
        const unsubscribe = scope.subscribe(render);
        render();
        // `theme/change` is the sanctioned continuous-sync signal: when the user flips the
        // theme from DSH's own Appearance setting, our per-mode images have to follow.
        let lastScheme = modeStore.get();
        const offTheme = ctx.on?.("theme/change", () => {
            const next = modeStore.get();
            modeStore.notify();
            // Cross-fade only a real light <-> dark flip (not a font-size-only change), and
            // never the first snapshot, which is just the initial paint.
            if (next !== lastScheme) {
                lastScheme = next;
                startThemeAnimation();
                renderSkin(true);
                return;
            }
            render();
        });
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
            if (typeof offTheme === "function")
                offTheme();
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
            document.body.removeAttribute(THEME_ANIM_ATTR);
            paintedWindowImage = null;
            readSkinValue = null;
            readSkinMode = null;
            reapply = null;
            disposeSkinDom();
            document.body.removeAttribute(BODY_ATTR);
        };
    }, "dsh-image-skin: apply region images");
    ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "image-skin",
        order: 25,
        label: () => "图片皮肤",
        inject: () => ({}),
    }, section));
    // Light/dark switch beside Settings at the sidebar foot (`sidebar.footer.action`). It
    // measures the Settings button and matches its height, so the two read as peers.
    function ModeAction() {
        const mode = React.useSyncExternalStore(modeStore.subscribe, modeStore.get);
        return React.createElement(ModeSwitch, {
            mode,
            variant: "footer",
            onPick: (m) => modeStore.pick(m),
        });
    }
    ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "image-skin-mode",
        order: 30,
        label: () => "图片皮肤：浅色/深色",
    }, ModeAction));
}


		return module.exports;
	}
});
