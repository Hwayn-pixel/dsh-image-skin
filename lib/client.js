window.__ModuleLoader__.load({
	id: "dsh-image-skin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_KEEP_BYTES = exports.UPLOAD_MAX_DIM = exports.ACCENT_ALPHA = exports.ACCENT_COVER = exports.inject = void 0;
exports.createSettingsScope = createSettingsScope;
exports.resolveAreaImage = resolveAreaImage;
exports.windowHasArtwork = windowHasArtwork;
exports.compositedSurfaceLum = compositedSurfaceLum;
exports.readableLabel = readableLabel;
exports.rampLadder = rampLadder;
exports.previewAccentLevel = previewAccentLevel;
exports.shouldOptimizeUpload = shouldOptimizeUpload;
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
/**
 * Bilingual copy. One build serves every UI language: `t(zh, en)` returns the English string when
 * the document (or browser) language is English, otherwise Chinese. The helper is a plain function
 * so it can be called while rendering without a hook, and it is guarded so the offline bundle test
 * (which evaluates this file with no DOM) still runs.
 */
function t(zh, en) {
    try {
        const lang = String((typeof document !== "undefined" && document.documentElement && document.documentElement.lang) ||
            (typeof navigator !== "undefined" && navigator.language) ||
            "zh").toLowerCase();
        return lang.startsWith("en") ? en : zh;
    }
    catch {
        return zh;
    }
}
/**
 * Settings transport, resolved at runtime because the two Host generations expose
 * different faces:
 *  - 0.1 line provides `settingsScope` (`bind({ namespace })` → durable namespace scope).
 *  - 0.2 line (desktop) provides `configForms`, where a namespace *is* the owning plugin
 *    entry's live Config (`get(entryId)` → { getSnapshot, subscribe, set, unset }).
 * `inject` therefore names only the seats that exist in both worlds, and each face is
 * attached through `ctx.inject` once its provider shows up.
 */
exports.inject = ["slots", "theme"];
/** Live editor state shared between the React section and the non-React renderer. */
let currentEditing = null;
let reapply = null;
/** Re-run the accent with a patched value but WITHOUT writing settings - live slider previews. */
let reapplyWith = null;
/** Re-stamp the accent on newly appeared chrome (dialogs, menus, popovers). */
let refreshAccent = null;
let finishButton = null;
/** Present one 0.2-line config form through the {@link Scope} surface the skin code uses. */
function adaptConfigForm(form) {
    return {
        getSnapshot: () => {
            const snapshot = form.getSnapshot();
            const status = snapshot.status === "ready" || snapshot.status === "unavailable" ? snapshot.status : snapshot.value === undefined ? "loading" : "ready";
            return { status, value: snapshot.value };
        },
        subscribe: (listener) => form.subscribe(listener),
        set: (field, value) => Promise.resolve(form.set(field, value)).then(() => undefined),
        unset: (field) => Promise.resolve(form.unset(field)).then(() => undefined),
    };
}
/**
 * Bind whichever settings face this Host provides and keep one {@link Scope} alive over it.
 * The skin code never learns which generation it runs on: it subscribes before the face
 * attaches and is notified both when it appears and on every later value change.
 */
function createSettingsScope(ctx) {
    const listeners = new Set();
    let provider = null;
    const queued = [];
    let snapshot = { status: "loading", value: undefined };
    const notify = () => {
        for (const listener of [...listeners]) {
            try {
                listener();
            }
            catch {
                /* one listener must not break the others */
            }
        }
    };
    const bind = (scope) => {
        provider = scope;
        // Anything the UI asked for before the Host handed us a settings face is applied now, in
        // order. (Rejecting instead - which is what this used to do - showed up as a red
        // "dsh-image-skin: settings are not ready" error right after a fresh install.)
        while (queued.length) {
            const [field, value, isUnset] = queued.shift();
            try {
                if (isUnset)
                    void scope.unset(field);
                else
                    void scope.set(field, value);
            }
            catch {
                /* a queued write must never break the binding */
            }
        }
        const sync = () => {
            const next = scope.getSnapshot();
            snapshot = { status: next.status ?? (next.value === undefined ? "loading" : "ready"), value: next.value };
            notify();
        };
        sync();
        const off = scope.subscribe(sync);
        return () => {
            off();
            if (provider === scope) {
                provider = null;
                snapshot = { status: "loading", value: undefined };
            }
        };
    };
    const inject = ctx.inject?.bind(ctx);
    if (inject === undefined) {
        // A context without `inject` can still hand over an already attached service.
        const forms = ctx.get?.("configForms");
        const scopes = ctx.get?.("settingsScope");
        if (forms !== undefined)
            bind(adaptConfigForm(forms.get(NS)));
        else if (scopes !== undefined)
            bind(scopes.bind({ namespace: NS }));
    }
    else {
        inject(["configForms"], (child) => bind(adaptConfigForm(child.configForms.get(NS))));
        // `settingsScope` was removed in DSH 0.2: bind it only if the Host actually provides it.
        // Declaring it in an `inject` made this whole plugin wait forever on the desktop
        // ("pending (waiting for service: settingsScope)") - no error, but no skin either.
        const legacyScopes = ctx.get?.("settingsScope");
        if (legacyScopes !== undefined)
            bind(legacyScopes.bind({ namespace: NS }));
    }
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        set: (field, value) => {
            if (provider === null) {
                queued.push([field, value, false]);
                return Promise.resolve();
            }
            return provider.set(field, value);
        },
        unset: (field) => {
            if (provider === null) {
                queued.push([field, undefined, true]);
                return Promise.resolve();
            }
            return provider.unset(field);
        },
    };
}
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
function ensureBaseStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
        "body[data-dsh-image-skin]{--fx-r-xs:6px;--fx-r-sm:10px;--fx-r-md:14px;--fx-r-lg:20px;--fx-r-pill:999px;--fx-line:1px solid rgba(128,128,128,.22);--fx-shadow-1:0 1px 2px rgba(0,0,0,.05);--fx-shadow-2:0 8px 24px rgba(0,0,0,.08);--fx-t:.18s ease}",
        // ── shell ──────────────────────────────────────────────────────────────────
        ".dshImgSkin-shell{display:flex;flex-direction:column;gap:14px;padding:2px 0 20px}",
        ".dshImgSkin-intro{font-size:12px;line-height:1.6;opacity:.85;margin:0}",
        ".dshImgSkin-banner{font-size:12px;line-height:1.5;border-radius:var(--fx-r-xs);padding:7px 11px;margin:0;",
        "background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 12%,transparent);",
        "color:var(--dsw-alias-state-error-primary,#d9534f)}",
        ".dshImgSkin-ok{font-size:12px;opacity:.72;margin:0}",
        // ── section card ──────────────────────────────────────────────────────────
        ".dshImgSkin-card{border:var(--fx-line);border-radius:var(--fx-r-md);box-shadow:var(--fx-shadow-1);",
        "background:var(--dsw-alias-bg-layer-1,transparent);padding:14px 16px;display:flex;flex-direction:column;gap:12px}",
        ".dshImgSkin-cardhead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}",
        ".dshImgSkin-packrow{display:flex;gap:8px;flex-wrap:wrap}",
        ".dshImgSkin-title{font-weight:600;font-size:13.5px;letter-spacing:.2px}",
        ".dshImgSkin-sub{font-size:11.5px;line-height:1.55;opacity:.84;margin:3px 0 0}",
        ".dshImgSkin-hint{font-size:11.5px;line-height:1.55;opacity:.85;display:block;margin-top:3px}",
        // ── segmented control (mode filter) ───────────────────────────────────────
        ".dshImgSkin-seg{display:inline-flex;gap:2px;padding:3px;border-radius:var(--fx-r-sm);",
        "background:color-mix(in srgb,currentColor 9%,transparent);border:var(--fx-line)}",
        ".dshImgSkin-seg>button{cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;",
        "padding:5px 13px;border-radius:var(--fx-r-xs);display:inline-flex;align-items:center;gap:6px;opacity:.66;transition:background .15s,opacity .15s}",
        ".dshImgSkin-seg>button:hover{opacity:.9}",
        ".dshImgSkin-seg>button[data-on='true']{opacity:1;font-weight:600;color:rgb(var(--dsh-skin-accent-ink,255,255,255)) !important;background:rgba(var(--dsh-skin-accent,90,167,216),.9) !important;",
        "box-shadow:0 1px 2px rgba(0,0,0,.10)}",
        // ── area grid ─────────────────────────────────────────────────────────────
        ".dshImgSkin-areas{display:flex;flex-direction:column;gap:10px}",
        ".dshImgSkin-area{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px 14px;align-items:center;",
        "border:var(--fx-line);border-radius:var(--fx-r-sm);padding:10px 12px;",
        "background:var(--dsw-alias-bg-layer-1,transparent);transition:border-color .15s,background .15s}",
        ".dshImgSkin-area>.dshImgSkin-thumb,.dshImgSkin-area>.dshImgSkin-thumblet{grid-row:1 / span 2}",
        ".dshImgSkin-area:hover{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.34))}",
        ".dshImgSkin-area[data-off='true']{opacity:.5}",
        ".dshImgSkin-area[data-editing='true']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
        "box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#5aa7d8) inset}",
        ".dshImgSkin-thumb{width:96px;height:56px;object-fit:cover;border-radius:var(--fx-r-xs);display:block;",
        "border:var(--fx-line);background:color-mix(in srgb,currentColor 6%,transparent)}",
        ".dshImgSkin-thumblet{position:relative;width:96px;height:56px;border-radius:var(--fx-r-xs);display:grid;place-items:center;",
        "border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.32));font-size:10.5px;opacity:.5}",
        ".dshImgSkin-met{display:flex;flex-direction:column;gap:2px;min-width:0}",
        ".dshImgSkin-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px}",
        ".dshImgSkin-src{font-size:11px;opacity:.76;line-height:1.5}",
        ".dshImgSkin-tag{font-size:10px;font-weight:500;padding:1px 6px;border-radius:var(--fx-r-pill);letter-spacing:.2px;",
        "border:var(--fx-line);opacity:.8}",
        ".dshImgSkin-tag[data-kind='mode']{border-color:var(--dsw-alias-brand-primary,#5aa7d8);",
        "color:var(--dsw-alias-brand-primary,#5aa7d8);opacity:1}",
        ".dshImgSkin-tag[data-kind='none']{opacity:.45}",
        ".dshImgSkin-ops{grid-column:1 / -1;display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
        // ── controls ──────────────────────────────────────────────────────────────
        ".dshImgSkin-btn{cursor:pointer;padding:5px 11px;border-radius:var(--fx-r-xs);font:inherit;font-size:12px;",
        "border:var(--fx-line);background:transparent;color:inherit;white-space:nowrap;",
        "transition:background .15s,border-color .15s}",
        ".dshImgSkin-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}",
        ".dshImgSkin-btn[disabled]{opacity:.5;cursor:not-allowed}",
        ".dshImgSkin-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5aa7d8);outline-offset:2px}",
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
        "opacity:.5;padding:2px 6px;border-radius:var(--fx-r-xs);white-space:nowrap}",
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
        ".dshImgSkin-entry{display:flex;flex-direction:column;gap:5px;text-align:left;cursor:pointer;font:inherit;color:inherit;border:var(--fx-line);border-radius:var(--fx-r-md);padding:14px 16px;background:var(--dsw-alias-bg-layer-1,transparent);transition:border-color .15s,background .15s}",
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
        ".dshImgSkin-modalCard{width:100%;max-width:520px;max-height:78vh;overflow:auto;border-radius:var(--fx-r-md);padding:18px 20px;display:flex;flex-direction:column;gap:10px;border:var(--fx-line);box-shadow:0 18px 48px rgba(0,0,0,.3)}",
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
        ".dshImgSkin-swatch{width:15px;height:15px;border-radius:var(--fx-r-xs);display:inline-block;box-sizing:border-box;",
        "border:var(--fx-line);box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}",
        ".dshImgSkin-swatchRow{display:flex;flex-direction:column;gap:4px}",
        ".dshImgSkin-swatchRow .dshImgSkin-hint{margin-top:0}",
        ".dshImgSkin-field{display:grid;grid-template-columns:78px minmax(0,1fr);gap:6px 10px;align-items:start}",
        ".dshImgSkin-fieldLabel{font-size:12px;opacity:.68;padding-top:6px}",
        ".dshImgSkin-fieldBody{display:flex;flex-direction:column;gap:4px;min-width:0}",
        ".dshImgSkin-input{cursor:pointer;padding:5px 9px;border-radius:var(--fx-r-xs);font:inherit;font-size:12.5px;width:100%;",
        "border:var(--fx-line);background:var(--dsw-alias-bg-layer-1,transparent);",
        "color:inherit}",
        ".dshImgSkin-input:disabled{opacity:.55;cursor:default}",
        ".dshImgSkin-inputNarrow{width:auto;min-width:88px}",
        ".dshImgSkin-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
        ".dshImgSkin-promptBox{font-size:11px;line-height:1.6;opacity:.7;padding:8px 10px;border-radius:var(--fx-r-xs);",
        "background:color-mix(in srgb,currentColor 6%,transparent);word-break:break-word}",
        ".dshImgSkin-textarea{cursor:text;resize:vertical;min-height:76px;line-height:1.6;font-size:12px}",
        ".dshImgSkin-frameCell{display:flex;flex-direction:column;gap:3px;align-items:center}",
        ".dshImgSkin-frameOps{justify-content:center;font-size:11px}",
        ".dshImgSkin-framePreview{width:96px;height:60px;object-fit:cover;border-radius:var(--fx-r-xs);",
        "border:var(--fx-line)}",
        ".dshImgSkin-frameKnobs{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}",
        ".dshImgSkin-results{display:flex;gap:8px;flex-wrap:wrap}",
        ".dshImgSkin-result{cursor:pointer;padding:0;border-radius:var(--fx-r-sm);overflow:hidden;",
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
/**
 * Whether the window region carries any artwork at all, in either mode.
 *
 * The ornament work samples its palette from the window image, so the AI screen is gated on this:
 * without a wallpaper there is nothing to sample and nothing to decorate. Exported for the suite.
 */
function windowHasArtwork(value) {
    return Boolean(resolveAreaImage(value, "window", "light") || resolveAreaImage(value, "window", "dark"));
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
// ── warming the mode that is not on screen ──────────────────────────────────
/** URLs already warmed (the same artwork is warmed once), and the hidden video preloaders. */
const warmedUrls = new Set();
const warmLoaders = [];
let warmTimer = null;
function warmImage(url) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    void img.decode?.().catch(() => { });
}
function warmVideo(url) {
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
function scheduleWarmOtherMode(value, mode) {
    if (warmTimer)
        clearTimeout(warmTimer);
    warmTimer = setTimeout(() => {
        warmTimer = null;
        const other = mode === "dark" ? "light" : "dark";
        for (const area of AREAS) {
            const url = resolveAreaImage(value, area.id, other);
            if (!url || url === resolveAreaImage(value, area.id, mode) || warmedUrls.has(url))
                continue;
            warmedUrls.add(url);
            if (VIDEO_RE.test(url))
                warmVideo(url);
            else
                warmImage(url);
        }
        // Read it, don't just fetch it. A flip re-derives the whole scheme from the other mode's
        // artwork, so a cold sample is the stall that is felt when switching modes. Pre-reading keeps
        // the other mode's palette / light / material in the sampler's cache, so both modes are built
        // up-front and the switch itself has nothing left to compute.
        const otherWallpaper = resolveAreaImage(value, "window", other);
        if (otherWallpaper && otherWallpaper !== resolveAreaImage(value, "window", mode))
            void sampleArtwork(otherWallpaper);
    }, 250);
}
function disposeWarmers() {
    if (warmTimer) {
        clearTimeout(warmTimer);
        warmTimer = null;
    }
    for (const loader of warmLoaders)
        loader.remove();
    warmLoaders.length = 0;
    warmedUrls.clear();
}
// ── theme cross-fade ────────────────────────────────────────────────────────
let themeAnimTimer = null;
/** What the window layer is currently showing, so a mode switch can cross-fade from it. */
let paintedWindowImage = null;
/** Last rendered sticker signature per area, so an unchanged sticker is never rebuilt. */
const stickerSignatures = {};
/** Above this many elements the transition is scoped to the big surfaces only. */
const THEME_ANIM_HEAVY_ELEMENTS = 1500;
/**
 * Open a short window in which colours transition. Called immediately *before* the theme
 * changes, so the transition is already in place when new values land.
 *
 * Kept for theme changes we did *not* initiate (e.g. the user flips DSH's own Appearance
 * setting): there a cover would flicker for nothing, and a short scoped transition still helps.
 */
function startThemeAnimation() {
    const body = document.body;
    const heavy = body.getElementsByTagName("*").length > THEME_ANIM_HEAVY_ELEMENTS;
    body.setAttribute(THEME_ANIM_ATTR, heavy ? "lite" : "full");
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
/**
 * The layer's current frame as a data URL, or "" if it cannot be read yet.
 *
 * Used to hold the outgoing frame on screen across a `src` swap: a bare swap blanks the layer for
 * as long as the incoming clip takes to decode (a local mp4 does *not* come up in one frame), and
 * that blank frame is the flash a light<->dark switch shows - both modes here are videos.
 */
function captureFrame(v) {
    try {
        if (!v.videoWidth || !v.videoHeight || v.readyState < 2)
            return "";
        const c = document.createElement("canvas");
        c.width = 480;
        c.height = Math.max(1, Math.round(480 * (v.videoHeight / v.videoWidth)));
        const ctx = c.getContext("2d");
        if (!ctx)
            return "";
        ctx.drawImage(v, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.72);
    }
    catch {
        return "";
    }
}
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
            "position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;pointer-events:none;background:transparent;";
        document.body.prepend(v);
    }
    return v;
}
/**
 * A wallpaper video is decoration. When the tab is not visible there is nothing to decorate, and a
 * looping backdrop is the difference between a cool laptop and one with a fan spinning up in a
 * bag. Pause everything we put on screen while the page is hidden, and pick it back up when it
 * returns. No setting for this: it is not a preference, it is manners.
 */
let visibilityGuardInstalled = false;
function installVisibilityGuard() {
    if (visibilityGuardInstalled || typeof document === "undefined")
        return;
    visibilityGuardInstalled = true;
    const owned = () => Array.from(document.querySelectorAll(`#${VIDEO_LAYER_ID}, [data-dsh-skin-sticker] video`));
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            for (const v of owned()) {
                try {
                    v.pause();
                }
                catch {
                    /* a video that will not pause is not worth a crash */
                }
            }
            return;
        }
        for (const v of owned())
            void v.play()?.catch(() => { });
    });
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
            // Freeze the frame that is on screen as the poster, so the swap shows the old picture until
            // the new clip can render its first one - instead of a black hole in between.
            const poster = captureFrame(v);
            if (poster)
                v.poster = poster;
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
// ── auto opacity (fit to how much text is on screen) ────────────────────────
/** Auto-fit bounds: few words -> see-through enough to enjoy the wallpaper; lots -> readable. */
const AUTO_OPACITY_MIN = 45;
const AUTO_OPACITY_MAX = 100;
/** Character counts at which the mapping saturates. */
const AUTO_CHARS_LOW = 300;
const AUTO_CHARS_HIGH = 3500;
/** Rough "how much text is on screen": characters in the main column plus the composer. */
function measureTextVolume() {
    if (typeof document === "undefined")
        return 0;
    let chars = 0;
    const col = document.querySelector('[class*="_centerCol"]') ||
        document.querySelector("main") ||
        document.querySelector('[role="main"]');
    if (col instanceof HTMLElement)
        chars += (col.innerText || "").length;
    const composer = document.querySelector('textarea, [contenteditable="true"]');
    if (composer instanceof HTMLElement)
        chars += (composer.innerText || "").length;
    return chars;
}
/**
 * The opacity that fits the current text volume. Few words -> low (wallpaper shows through);
 * lots of words -> high (the panel turns solid so the text stays legible). Linear between the
 * two thresholds, clamped to the bounds.
 */
function autoPanelOpacity() {
    const chars = measureTextVolume();
    const ratio = Math.max(0, Math.min(1, (chars - AUTO_CHARS_LOW) / (AUTO_CHARS_HIGH - AUTO_CHARS_LOW)));
    return Math.round(AUTO_OPACITY_MIN + ratio * (AUTO_OPACITY_MAX - AUTO_OPACITY_MIN));
}
// ── panel translucency + image alpha (shared slider) ────────────────────────
function applyPanelOpacity(value, mode) {
    const style = soleStyle(PANEL_STYLE_ID);
    const opacity = Number(value.panelOpacity ?? 100);
    const a = Math.max(0, Math.min(1, opacity / 100));
    // Take the scheme from the theme service rather than the body flag: on a theme switch
    // the flag is applied a tick later, which would leave the panel tint one mode behind.
    // The slider owns *how much* the panels cover; the hue comes from the sampled scheme (set by the
    // accent pass as --dsh-skin-tone). Falling back to DSH's own neutral keeps this working before the
    // first accent pass has run.
    const rgb = "var(--dsh-skin-tone, 18, 31, 47)";
    const l = (extra) => Math.min(1, a + extra).toFixed(3);
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
        // The app shell used to sit 0.2 below the panels, so the top bar read as a lighter
        // strip than the content under it. He asked for one level (方案 B): the shell now
        // follows the same opacity as the panels, keeping the layering inside the content
        // rather than between the chrome and the page.
        `  --dsw-specific-app-shell: rgba(${rgb}, ${l(0)});`,
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
        // Careful: `[class*="_card"]` also matches every *sub-part* DSH names `_cardXxx`
        // (`_cardHead`, `_cardName`, `_cardDesc`, `_cardFoot`, `_cardId`) - painting those put a pale
        // panel behind the title / description / code line, which is exactly what read as "文字像 P 上去的".
        // Match only whole card *containers*: a class ending in `_card`, or `_card` followed by another class.
        `body[${BODY_ATTR}] [class$="_card"], body[${BODY_ATTR}] [class*="_card "]{`,
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
function soleStyle(id) {
    const all = Array.from(document.querySelectorAll(`#${id}`));
    let style = all[0];
    if (!style) {
        style = document.createElement("style");
        style.id = id;
        document.head.append(style);
    }
    for (const extra of all.slice(1))
        extra.remove();
    return style;
}
/** Drop every stylesheet carrying `id` (there can be strays - see soleStyle). */
function dropStyles(id) {
    document.querySelectorAll(`#${id}`).forEach((el) => el.remove());
}
const ACCENT_ATTR = "data-dsh-skin-accent";
const ACCENT_MARK = "data-dsh-accent";
/** Stamped per element: 1 = the picture is busy under this element, so decoration yields. */
const BUSY_ATTR = "data-dsh-skin-busy";
/** The first hue we saw for the current wallpaper; the breathing pass stays near it. */
let breathSeed = null;
/**
 * The wallpaper each mode was last painted from. Per mode, so a *wallpaper switch* can force a
 * re-read while a light↔dark flip does not: the two modes use different artwork, and forcing a
 * fresh sample on every flip made the whole scheme re-read from scratch at the exact moment the
 * user was waiting for it. Tracking per mode lets a flip reuse the reading warmed for that mode.
 */
const lastWallpaper = { light: null, dark: null };
/** The hue the scheme would pick for a palette ("best usable colour"), or null if there is none. */
function seedHueOf(palette) {
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
function hueDistance(a, b) {
    const d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
}
/**
 * The levels are a ladder of *how much decoration*, and who draws it:
 * 0-2 are drawn on this machine (tint -> corner ticks -> a framed panel), 3-4 hand the frame to
 * a generated ornament. The wording has to match what actually happens - an early version claimed
 * the model drew levels 1-2, which was never true.
 */
const ACCENT_LEVELS = [
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
const paletteCache = new Map();
/** Last palette we wrote to settings, so a lagging snapshot cannot make us write it again. */
let paletteWriteKey = null;
let accentTargets = [];
const artworkCache = new Map();
/** Faded copies of a generated frame, keyed by url + alpha. */
const fadeCache = new Map();
/** Generated frames with their flat background knocked out, keyed by url. */
const knockoutCache = new Map();
/**
 * Make a generated frame usable as an ornament.
 *
 * Image models draw on a background - usually white - and border-image would carry that band onto
 * the panel, so the ornament arrives as "a white border with some pattern on it". Sample the colour
 * at the centre (the frame's own middle is empty by design) and make everything close to it
 * transparent. If almost nothing matches, the picture is not a frame on a flat background and is
 * left alone rather than eaten.
 */
async function keyOutBackground(url) {
    const cached = knockoutCache.get(url);
    if (cached)
        return cached;
    try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        await img.decode();
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        if (!w || !h)
            return url;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return url;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        const mid = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
        const bg = [px[mid], px[mid + 1], px[mid + 2]];
        let cleared = 0;
        for (let i = 0; i < px.length; i += 4) {
            const distance = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
            if (distance < 46) {
                px[i + 3] = 0;
                cleared++;
            }
        }
        if (cleared / (px.length / 4) < 0.06)
            return url;
        ctx.putImageData(data, 0, 0);
        const out = canvas.toDataURL("image/png");
        knockoutCache.set(url, out);
        return out;
    }
    catch {
        return url; // cross-origin or undecodable: keep as-is
    }
}
/**
 * Read the artwork once and keep the result. A video backdrop is re-read on demand (see the
 * breathing pass in applyAccent) because its frames move.
 */
async function sampleArtwork(url, refresh = false) {
    if (!refresh) {
        const hit = artworkCache.get(url);
        if (hit)
            return hit;
    }
    // 160px wide, not 64: at 64 a wallpaper of sky, clouds and a character collapses into two flat
    // blues, which is why the scheme "did not follow" the picture. 160 keeps the small but vivid areas
    // (a pink cloud edge, the character's yellow accents) alive in the histogram.
    const w = 160;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx)
        return null;
    /** One frame's worth of pixels, painted into the canvas and handed to the caller. */
    const paint = async (draw, aspect) => {
        const h = Math.max(1, Math.round(w * aspect));
        canvas.width = w;
        canvas.height = h;
        draw(w, h);
    };
    // A video backdrop never decodes into an <img>, so sample real frames instead. Without this the
    // accent silently did nothing at all for anyone using a video wallpaper. Three moments of the clip
    // are merged, so the palette describes the whole loop rather than one instant of it.
    const frames = [];
    if (VIDEO_RE.test(url)) {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = url;
        try {
            await new Promise((resolve, reject) => {
                video.addEventListener("loadeddata", () => resolve(), { once: true });
                video.addEventListener("error", () => reject(new Error("video failed")), { once: true });
                setTimeout(() => reject(new Error("video timed out")), 5000);
            });
        }
        catch {
            return null;
        }
        const aspect = video.videoHeight / Math.max(1, video.videoWidth);
        const duration = Number.isFinite(video.duration) && video.duration > 0.4 ? video.duration : 1;
        for (const fraction of [0.08, 0.4, 0.72]) {
            try {
                await new Promise((resolve) => {
                    video.addEventListener("seeked", () => resolve(), { once: true });
                    setTimeout(resolve, 1200);
                    video.currentTime = Math.max(0, Math.min(duration - 0.05, duration * fraction));
                });
                await paint((cw, ch) => ctx.drawImage(video, 0, 0, cw, ch), aspect);
                frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
            }
            catch {
                /* a frame that will not seek is simply skipped */
            }
        }
        if (!frames.length)
            return null;
    }
    else {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        try {
            await img.decode();
        }
        catch {
            return null;
        }
        await paint((cw, ch) => ctx.drawImage(img, 0, 0, cw, ch), img.height / Math.max(1, img.width));
        try {
            frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        }
        catch {
            return null; // tainted canvas - treat as "no reading"
        }
    }
    let data;
    try {
        data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    catch {
        return null; // tainted canvas — treat as "no reading"
    }
    const CW = canvas.width;
    const CH = canvas.height;
    const lumAt = (px, py) => {
        const i = (py * CW + px) * 4;
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    // ── palette: 4-bit histogram over every sampled frame, scored by "usable as a UI colour" ──
    const buckets = new Map();
    for (const pixels of frames) {
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 200)
                continue;
            const key = `${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`;
            const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
            e.n += 1;
            e.r += pixels[i];
            e.g += pixels[i + 1];
            e.b += pixels[i + 2];
            buckets.set(key, e);
        }
    }
    const score = (r, g, b) => {
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
    const cells = [];
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
            if (n)
                cells.push({ x, y, lum: sum / n, r: r / n, g: g / n, b: b / n, n });
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
    const density = [];
    const raw = [];
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
    for (const d of raw)
        density.push({ busy: d.v / maxV, lum: d.lum });
    // ── material: a rough read of what the picture is made of ──
    const avgS = palette.length
        ? palette.reduce((a, p) => a + score(...p.split(",").map(Number)), 0) / palette.length
        : 0;
    const busyAvg = density.reduce((a, d) => a + d.busy, 0) / density.length;
    const cool = light.warmth < -0.02;
    const material = palette.length === 0
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
    const reading = { palette, light, density, material };
    artworkCache.set(url, reading);
    return reading;
}
/** Busyness of the picture under a viewport position (0..1), for the "stay off the subject" pass. */
function busyUnder(art, fx, fy) {
    const x = Math.min(7, Math.max(0, Math.floor(fx * 8)));
    const y = Math.min(4, Math.max(0, Math.floor(fy * 5)));
    return art.density[y * 8 + x]?.busy ?? 0;
}
/**
 * Reduce an image to a handful of representative colours. A 4-bit bucket histogram over a
 * 64px-wide sampling is plenty for tinting chrome and costs a few milliseconds.
 */
async function extractPalette(url) {
    const reading = await sampleArtwork(url);
    return reading?.palette ?? [];
}
function visible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8)
        return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
}
/**
 * Mark the on-screen skeleton elements, stamping each with the role it plays.
 *
 * Roles matter: a 30px button and a settings section are both "chrome", but they cannot wear the
 * same amount of decoration. `panel` gets the frame, `small` gets a hairline.
 */
function scanAccentTargets() {
    const found = new Set();
    const usable = (el) => !el.closest(ACCENT_EXCLUDE) && visible(el);
    document.querySelectorAll(ACCENT_SELECTOR).forEach((el) => {
        if (usable(el))
            found.add(el);
    });
    // Fallback sweep: anything small that already draws a border is part of the skeleton too.
    // The named selectors miss icon-only controls and one-off rows; sizing keeps big layout
    // containers (which should stay plain) out of it. Elements we already marked last pass are
    // trusted without re-measuring, so a toolbar that is mid-animation does not flicker out.
    document.querySelectorAll("body *").forEach((el) => {
        if (found.has(el))
            return;
        if (el.hasAttribute(ACCENT_MARK)) {
            found.add(el);
            return;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width > 360 || rect.height > 220 || rect.width < 6 || rect.height < 6)
            return;
        if (!usable(el))
            return;
        const cs = getComputedStyle(el);
        const bordered = ["Top", "Right", "Bottom", "Left"].some((side) => {
            const w = parseFloat(cs[`border${side}Width`]);
            const s = cs[`border${side}Style`];
            return w > 0 && s !== "none";
        });
        if (bordered)
            found.add(el);
    });
    // Consistency pass: a toolbar is a row of peers, but only some of them draw their own border
    // (an icon-only button often relies on hover). Decorating two of three siblings looks like a
    // bug, so once one member of a row is marked, its button-like siblings join it.
    for (const el of [...found]) {
        const parent = el.parentElement;
        if (!parent)
            continue;
        const pe = getComputedStyle(parent);
        if (!/flex/.test(pe.display))
            continue;
        const siblings = [...parent.children].filter((c) => c instanceof HTMLElement && c !== el && c.matches("button, [role='button'], a"));
        if (!siblings.length || siblings.length > 8)
            continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 120 || rect.height > 120)
            continue; // only cluster small peers
        for (const sib of siblings) {
            if (usable(sib))
                found.add(sib);
        }
    }
    return [...found];
}
/** A surface big enough to carry a frame, versus a control or a card that only wants a hairline. */
function accentRole(el) {
    if (el.matches('[role="dialog"], [role="menu"], [role="listbox"]'))
        return "panel";
    // Nothing inside a panel is a panel. The dialog already wears the frame; framing its contents too
    // turned the settings screen into a nest of rectangles, which is exactly what read as stiff.
    if (el.closest('[role="dialog"], [role="menu"], [role="listbox"]'))
        return "small";
    const rect = el.getBoundingClientRect();
    return rect.width >= 480 && rect.height >= 260 ? "panel" : "small";
}
// ── colour ──────────────────────────────────────────────────────────────────
//
// Sampling a wallpaper gives back whatever happened to be in the picture - four unrelated RGB
// triples. Painting those straight onto controls is what made the first attempt look like a
// colour clash: every element got a different hue at a random lightness. So the palette is first
// reduced to *one* hue, and every role is rebuilt from it.
function rgbToHsl(r, g, b) {
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const l = (max + min) / 2;
    if (max === min)
        return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rr)
        h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
    else if (max === gg)
        h = ((bb - rr) / d + 2) * 60;
    else
        h = ((rr - gg) / d + 4) * 60;
    return { h, s, l };
}
/** HSL -> "r, g, b" so the rest of the module keeps working in plain rgb triples. */
function hslTriple(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}
function relativeLuminance(r, g, b) {
    const lin = (v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const CONTRAST = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/**
 * Walk a lightness until the colour actually separates from the surface behind it. A scheme that
 * looks right on a bright wallpaper fails on a dark one, and vice versa - this is the guard.
 */
function fitLightness(hue, sat, start, bgLum, minRatio, brighten) {
    let l = start;
    for (let i = 0; i < 24; i++) {
        const [r, g, b] = hslTriple(hue, sat, l);
        if (CONTRAST(relativeLuminance(r, g, b), bgLum) >= minRatio)
            break;
        l = Math.min(0.95, Math.max(0.05, l + (brighten ? 0.035 : -0.035)));
    }
    return l;
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
const DSH_SCALES = [
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
function rampVars(scheme) {
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
function tokenLanguage(scheme, mode) {
    const dark = mode === "dark";
    const { hue, sat } = scheme;
    // "primary" keeps its *contrast* meaning (light pill on dark, dark pill on light) and only takes
    // our hue, so DSH's own text colour on it stays readable.
    const contrastFill = hslTriple(hue, dark ? 0.1 : 0.24, dark ? 0.93 : 0.2).join(", ");
    // Roles, not alphas: in a light theme "more transparent" means "whiter", so a rung that only
    // moved alpha turned every inset and hover into a wash. Each role now names the tone it wants.
    const rung = (extra) => `rgba(var(--dsh-skin-tone), ${Math.min(1, Math.max(0.06, 0.86 + extra)).toFixed(3)})`;
    const role = (name, alpha) => `rgba(var(--dsh-skin-${name}), ${alpha.toFixed(3)})`;
    const rootSel = `body[${BODY_ATTR}][${ACCENT_ATTR}]`;
    return [
        `${rootSel} {`,
        ...rampVars(scheme),
        ...DSH_SCALES.map(([name, r, g, b, brand]) => {
            const l = rgbToHsl(r, g, b).l;
            const chroma = brand ? Math.min(0.7, Math.max(0.36, sat)) : dark ? 0.1 : 0.07;
            return `  ${name}: rgb(${hslTriple(hue, chroma, l).join(", ")});`;
        }),
        // 文字 token：按「合成后的真实背景」校准过的四档（见 deriveScheme 里的 labelOn）。
        // 只接管这四档 —— label-primary-foreground / link / error 等语义色各自背景不同，不动。
        `  --dsw-alias-label-primary: rgb(${scheme.labelPrimary}) !important;`,
        `  --dsw-alias-label-secondary: rgb(${scheme.labelSecondary}) !important;`,
        `  --dsw-alias-label-tertiary: rgb(${scheme.labelTertiary}) !important;`,
        `  --dsw-alias-label-caption: rgb(${scheme.labelCaption}) !important;`,
        // named surface aliases: fields sit one rung *below* the surface so a field reads as a field,
        // menus and tips one rung above.
        // `--dsw-specific-input-major` 听起来像输入框，实测**不是**：DSH 里它给的是卡片、附件卡、
        // 提示卡的背景（`.card` / `.fileCard` / `.notice`），真正那个 input 是 `background:0 0`（透明），
        // 底由外层容器给。所以在这里改透明度，滑块当然“没反应”。保持原值，输入框的活交给下面的元素规则。
        `  --dsw-specific-input-major: ${role("well", 0.72)} !important;`,
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
        // 输入框单独一档：**直接画在控件身上**，不经过 DSH 的 token（见上面那条注释）。
        // `background-color` + 自身圆角 = 不动布局、不会变成方块；`:not()` 放掉非文本控件。
        // 变量由滑块直接写（拖拽时即时生效），没写时回退到设置值。
        `body[${BODY_ATTR}][${ACCENT_ATTR}] input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="submit"]):not([type="button"]),`,
        `body[${BODY_ATTR}][${ACCENT_ATTR}] textarea,`,
        `body[${BODY_ATTR}][${ACCENT_ATTR}] select,`,
        // 主输入区在 DSH 里是 `<div role="textbox" contenteditable>`，**不是 textarea**（CDP 实测）。
        // 不写这一条，“文本框看不清”里最该管的那个框反而不在覆盖范围内。
        `body[${BODY_ATTR}][${ACCENT_ATTR}] [contenteditable="true"],`,
        `body[${BODY_ATTR}][${ACCENT_ATTR}] [role="textbox"] {`,
        `  background-color: rgba(var(--dsh-skin-well, 236, 243, 250), var(--dsh-skin-input-alpha, ${scheme.inputAlpha.toFixed(3)})) !important;`,
        `}`,
        // 数字框 / 搜索框之类的小控件自己带圆角，但有的不带；补一个柔和的圆角，免得变成直角色块。
        `body[${BODY_ATTR}][${ACCENT_ATTR}] input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),`,
        `body[${BODY_ATTR}][${ACCENT_ATTR}] textarea,`,
        `body[${BODY_ATTR}][${ACCENT_ATTR}] select {`,
        `  border-radius: var(--dsw-radius-sm, 6px);`,
        `}`,
    ].join("\n");
}
/**
 * Luminance of what actually sits behind the text: the wallpaper, veiled by a panel of
 * `panelAlpha`. This is the number the whole readability pass hangs on — the old code compared
 * text against the *panel colour with the wallpaper ignored*, i.e. it assumed an opaque panel.
 * Exported so the offline test can pin the arithmetic.
 */
function compositedSurfaceLum(artLum, panelAlpha, mode) {
    const clamp = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    const bg = mode === "dark" ? [18, 31, 47] : [255, 253, 252];
    const bgLum = relativeLuminance(bg[0], bg[1], bg[2]);
    const a = clamp(panelAlpha);
    return clamp(artLum) * (1 - a) + bgLum * a;
}
/**
 * 一个能读的文字色：从 startL 出发，沿着远离背景的方向走到达标为止。
 * 方向由背景亮度决定（亮→变深，暗→变浅），不是由主题决定 —— 这样浅色主题撞上深色壁纸也救得回来。
 * 导出给测试：截图里那行“看不见的小字”就是这里没走对比度。
 */
function readableLabel(startL, surfaceLum, target, hue = 214) {
    const brighten = surfaceLum < 0.42;
    const walked = fitLightness(hue, 0.05, startL, surfaceLum, target, brighten);
    const [r, g, b] = hslTriple(hue, 0.05, walked);
    if (CONTRAST(relativeLuminance(r, g, b), surfaceLum) >= target)
        return [r, g, b].join(", ");
    // 黑字与白字的对比度在背景亮度 ≈0.18 附近交叉：只有那一条极窄的带里两者都低于 4.5，
    // 其他任何亮度都有一个胜者。所以走到头还不够时，直接取纯黑/纯白 —— 那是这个背景允许的上限。
    const blackWins = CONTRAST(0, surfaceLum) >= CONTRAST(1, surfaceLum);
    return blackWins ? "0, 0, 0" : "255, 255, 255";
}
function deriveScheme(palette, mode, light, depth = 2, surface = {}) {
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
    // 文字要看的不是“面板色”，也不是“壁纸”，而是两者叠完之后的那个颜色。
    // surfaceLum 就是它：壁纸亮度和面板色亮度按面板不透明度加权。之前用固定的 bg 算对比度，
    // 相当于假定面板是不透明的 —— 一旦面板半透、背后又是一张亮壁纸，所有校验都白做了。
    const artLum = Math.max(0, Math.min(1, surface.artLum ?? 0.5));
    const panelAlpha = Math.max(0, Math.min(1, surface.panelAlpha ?? 1));
    const surfaceLum = compositedSurfaceLum(artLum, panelAlpha, mode);
    // 文字色：只走到达标为止（primary 7:1 / secondary 5:1 / 其余 4.5:1）。
    const labelOn = (startL, target) => readableLabel(startL, surfaceLum, target, hue);
    const lineL = fitLightness(hue, sat, mode === "dark" ? 0.64 : 0.44, bgLum, 2.3, mode === "dark");
    const inkL = fitLightness(hue, Math.min(0.72, sat + 0.12), mode === "dark" ? 0.82 : 0.32, bgLum, 4.6, mode === "dark");
    const washL = mode === "dark" ? 0.62 : 0.48;
    // The second hue: the most *different* usable colour the picture offered (at least ~40° away, so
    // it reads as a partner rather than a wobble). When the picture only has one hue, one is built by
    // rotating 34° - still in the picture's own family, still visibly a second voice.
    const hueDistance = (a, b) => {
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
    const toneAt = (i, chroma) => {
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
        labelPrimary: labelOn(mode === "dark" ? 0.95 : 0.10, 7),
        labelSecondary: labelOn(mode === "dark" ? 0.82 : 0.40, 5),
        labelTertiary: labelOn(mode === "dark" ? 0.70 : 0.52, 4.5),
        labelCaption: labelOn(mode === "dark" ? 0.66 : 0.56, 4.5),
        // 输入框不允许彻底透明：0 会让字重新变回读不清 —— 那正是这个滑块要解决的问题。
        // 下限 25% 保证「拖到最左也有一个看得见的底」，也让人一眼看出滑块确实在动。
        inputAlpha: Math.max(0.25, Math.min(1, surface.inputAlpha ?? 0.95)),
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
function frameDataUri(corner, edge, variant) {
    const S = 96;
    const SL = 26; // square corner region
    const rich = variant === "rich" || variant === "ornate";
    const ornate = variant === "ornate";
    const parts = [
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
    const cornerArt = [
        `<path d="M 6 ${SL - 2} C 13 ${SL - 6}, 19 19, ${SL - 2} 6" stroke="${edge}" stroke-width="1.3" opacity=".9"/>`,
        `<circle cx="21" cy="21" r="4.6" stroke="${corner}" stroke-width="1.6" fill="none"/>`,
        `<circle cx="21" cy="21" r="1.9" fill="${corner}" stroke="none"/>`,
        `<path d="M 21 13.6 c 2.4 2 2.4 5 0 7.4 c -2.4 -2.4 -2.4 -5.4 0 -7.4" stroke="${edge}" stroke-width="1.1" opacity=".85"/>`,
        `<path d="M 13.6 21 c 2 2.4 5 2.4 7.4 0 c -2.4 -2.4 -5.4 -2.4 -7.4 0" stroke="${edge}" stroke-width="1.1" opacity=".85"/>`,
    ];
    if (ornate) {
        cornerArt.push(`<circle cx="21" cy="21" r="7.4" stroke="${edge}" stroke-width=".8" opacity=".55" fill="none"/>`, `<path d="M 15 15 l 3 3 l -3 3 l -3 -3 z" fill="${corner}" stroke="none"/>`, `<circle cx="9" cy="9" r="2.1" fill="${edge}" opacity=".8" stroke="none"/>`);
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
        }
        else if (rich) {
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
function cornerOrnamentDataUri(corner, edge) {
    const S = 48;
    const SL = 14;
    const parts = [
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
function parseTriple(triple) {
    const [r, g, b] = triple.split(",").map((n) => Number(n.trim()));
    return { r: r || 128, g: g || 128, b: b || 128 };
}
/** The rung values per mode: how much wallpaper stays visible, and how strong the hairline is. */
exports.ACCENT_COVER = {
    dark: [0.06, 0.34, 0.52, 0.64, 0.72],
    light: [0.08, 0.42, 0.6, 0.7, 0.78],
};
exports.ACCENT_ALPHA = [0.22, 0.28, 0.33, 0.38, 0.43];
/**
 * The ladder is a *ramp*, not a set of rungs: the level arrives as a float (the slider is
 * stepless), so interpolate between the two neighbouring stops. Indexing the array - which is
 * what this used to do - is exactly what made dragging feel notchy.
 * Exported so it can be pinned by a test: the interruption-free feel is a property of this math.
 */
function rampLadder(stops, x) {
    const i = Math.max(0, Math.min(stops.length - 1, x));
    const lo = Math.floor(i);
    const hi = Math.min(stops.length - 1, lo + 1);
    return stops[lo] + (stops[hi] - stops[lo]) * (i - lo);
}
/**
 * Everything `accentCss` needs apart from the level, kept from the last full pass.
 *
 * Why: a level change used to require a store round-trip, a fresh artwork read and a re-scan of
 * every accent target before anything moved - so the slider arrived and the colour crawled in
 * afterwards. With these cached, a drag can repaint the sheet synchronously, in single-digit ms.
 */
let accentPreviewInputs = null;
/**
 * Repaint the accent sheet for a new level *right now*, reusing the cached palette/artwork.
 * No store write, no artwork read, no target re-scan - this is what makes dragging feel live.
 * The commit (store write) still happens on release, so nothing is lost.
 */
function previewAccentLevel(level) {
    const inputs = accentPreviewInputs;
    if (!inputs)
        return;
    try {
        const style = soleStyle(ACCENT_STYLE_ID);
        style.textContent = accentCss(inputs.palette, level, inputs.mode, inputs.artUrl, inputs.reading, inputs.frameOpts, inputs.colourStyle, inputs.surface);
        document.body.setAttribute(ACCENT_ATTR, String(level));
    }
    catch {
        /* a preview must never break the panel */
    }
}
function accentCss(palette, level, mode, chosenFrame, reading, frame = { scale: 1, opacity: 1, controls: false }, colourStyle = "wash", surface = {}) {
    const scheme = deriveScheme(palette, mode, reading?.light, level, surface);
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
    const surfaceGradient = (toDark, levelTint) => colourStyle === "marks"
        ? `linear-gradient(to ${toDark}, rgba(${lightTint}, ${(0.10 + levelTint).toFixed(3)}), rgba(0,0,0,0))`
        : `linear-gradient(to ${toDark}, rgba(${lightTint}, ${(0.14 + levelTint).toFixed(3)}), rgba(${wash}, ${(levelTint * 0.35).toFixed(3)}), rgba(${wash}, 0.02))`;
    const lines = [];
    const finish = () => `${lines.join("\n")}\n${tokenLanguage(scheme, mode)}`;
    // Shared base: a low-alpha tint plus one hairline. This is the whole of level 0.
    //
    // The hairline is drawn with `outline` rather than `border`: outline costs no layout, cannot eat
    // a control's existing box-shadow, and `:not(:focus-visible)` keeps DSH's focus ring intact.
    // Softened: a full-strength hairline everywhere read as "disabled outline" rather than design. -1px
    // offset keeps it hugging the shape.
    // How much of the wallpaper the surfaces cover, per rung. Level 0 is a whisper (the hairline is
    // the visible thing); by 4 the ladder is at its most solid. Depth comes from the *steps between*
    // rungs - this knob only decides how much picture stays visible underneath.
    //
    // The ladder is a *ramp*, not a set of rungs: the level arrives as a float (the slider is
    // stepless), so interpolate between the two neighbouring stops. Indexing the array - which is
    // what this used to do - is exactly what made dragging feel notchy.
    const ramp = (stops, x) => {
        const i = Math.max(0, Math.min(stops.length - 1, x));
        const lo = Math.floor(i);
        const hi = Math.min(stops.length - 1, lo + 1);
        return stops[lo] + (stops[hi] - stops[lo]) * (i - lo);
    };
    const cover = ramp(exports.ACCENT_COVER[mode] ?? exports.ACCENT_COVER.dark, level);
    const alpha = ramp(exports.ACCENT_ALPHA, level);
    const hairline = (sel) => `${sel}:not(:focus-visible) {\n  outline: 1px solid rgba(${line}, ${alpha}) !important;\n  outline-offset: -1px !important;\n}`;
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
    lines.push(`${panel} {`, `  background-color: rgba(${panelFill}, ${(cover * 0.92).toFixed(3)}) !important;`, `  background-image: ${surfaceGradient(toDark, cover * 0.2)} !important;`, `  box-shadow: ${litEdge} rgba(${lightTint}, .30) !important;`, `  transition: background-color var(--dsh-skin-tint-ms, 4s) ease, outline-color var(--dsh-skin-tint-ms, 4s) ease, box-shadow var(--dsh-skin-tint-ms, 4s) ease !important;`, `}`, `${small} {`, `  background-color: rgba(${controlFill}, ${cover.toFixed(3)}) !important;`, `  background-image: ${surfaceGradient(toDark, cover * 0.24)} !important;`, `  box-shadow: ${litEdge} rgba(${lightTint}, .22) !important;`, 
    // Controls stay snappy; the slow (4s) panel transition is for the breathing drift only.
    `  transition: background-color .18s ease var(--dsh-skin-delay, 0s), filter .18s ease, transform .18s ease, outline-color .18s ease var(--dsh-skin-delay, 0s) !important;`, `}`);
    // 让位 (yield) is intentionally off (方案 B). It used to drop controls that sat over a busy
    // part of the picture to ~1/3 of the normal cover, which read as a random pale patch rather
    // than a deliberate layer. Every control now keeps the same level as its neighbours; the
    // layering comes from the tone/cover ramp, not from where the picture happens to be busy.
    // (BUSY_ATTR is still stamped for diagnostics, it just no longer changes the paint.)
    // 火花 (the spark): the picture's most vivid colour is reserved for "you can touch this" -
    // hover, focus, pressed and selected. Used nowhere else, so it stays meaningful.
    lines.push(`${root} [${ACCENT_MARK}]:hover { outline-color: rgba(${signal}, .8) !important; border-color: rgba(${signal}, .7) !important; }`, `${root} [${ACCENT_MARK}]:focus-visible { outline-color: rgba(${signal}, .85) !important; }`, `${root} [${ACCENT_MARK}][aria-pressed="true"], ${root} [${ACCENT_MARK}][aria-selected="true"], ${root} [${ACCENT_MARK}][data-on="true"], ${root} [${ACCENT_MARK}][data-active="true"] {`, `  outline-color: rgba(${signal}, .85) !important;`, `  border-color: rgba(${signal}, .8) !important;`, `}`);
    // Controls get a little craft without touching their own background or shadow: a hover that lifts a
    // pixel and warms very slightly, a press that settles back, and the picture's spark on the edge.
    // (Box-shadow and border are left alone deliberately - DSH's own button styles stay intact.)
    // A control climbs one rung on hover and drops one when pressed - the smallest possible amount of
    // motion that still feels physical.
    lines.push(`${small}:hover:not(:disabled) {`, `  background-color: rgba(${painting ? raisedHi : neutralWash}, ${Math.min(0.9, cover + 0.12).toFixed(3)}) !important;`, `  filter: brightness(1.04) !important;`, `  transform: translateY(-1px);`, `}`, `${small}:active:not(:disabled) {`, `  background-color: rgba(${painting ? raisedDown : neutralWash}, ${Math.max(0.18, cover - 0.1).toFixed(3)}) !important;`, `  transform: translateY(0);`, `}`, 
    // The accent rung: a selected tab / pressed toggle / active item takes the picture's colour for
    // real, which is the one place a text colour has to be chosen for it.
    `${root} [${ACCENT_MARK}][aria-pressed="true"], ${root} [${ACCENT_MARK}][aria-selected="true"], ${root} [${ACCENT_MARK}][data-on="true"], ${root} [${ACCENT_MARK}][data-active="true"] {`, `  background-color: rgba(${accent}, .78) !important;`, `  background-image: none !important;`, `  color: rgb(${accentInk}) !important;`, `  outline-color: rgba(${accent}, .95) !important;`, `  border-color: rgba(${accent}, .9) !important;`, `}`);
    if (colourStyle !== "marks")
        lines.push(hairline(small));
    else
        lines.push(`${small}:focus-visible {`, `  outline: 1px solid rgba(${ink}, .55) !important;`, `  outline-offset: -1px !important;`, `}`);
    // Some of DSH's own controls paint a colour that never came from a token: the selected preset
    // card is a flat hard blue (`#2464db`), the "in use" chip is near-black (`#111`), and the little
    // code box (`standard`, `ptc`) uses text and background that are almost the same. They read as
    // "pasted on" - a different material from the glass around them. Re-point each at a role from our
    // own scheme, keyed on the class *suffix* so it survives DSH rebuilds.
    lines.push(`${root} [class*="_cardMain"][aria-pressed="true"] {`, `  background-color: rgba(${accent}, .82) !important;`, `  border-color: rgba(${accent}, .95) !important;`, `  color: rgb(${accentInk}) !important;`, `}`, `${root} [class*="_inUse"] {`, `  background-color: rgba(${ink}, .88) !important;`, `  color: rgb(${raisedHi}) !important;`, `}`, `${root} code[class*="_cardId"], ${root} [class*="_cardId"] {`, `  background-color: rgba(${wellTone}, .72) !important;`, `  color: rgb(${ink}) !important;`, `}`, `${root} [class*="_tag"] {`, `  background-color: rgba(${wellTone}, .62) !important;`, `  color: rgb(${ink}) !important;`, `}`);
    // One quiet line per panel: in marks mode it is a neutral one, so the only colour on screen is
    // something you can act on.
    const panelLine = colourStyle === "marks"
        ? hairline(`${panel}`).replace(`rgba(${line}, `, `rgba(${neutralInk}, `).replace(`, ${alpha})`, ", .16)")
        : hairline(`${panel}`);
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
async function fadeImage(url, alpha) {
    const key = `${url}@${alpha.toFixed(2)}`;
    const cached = fadeCache.get(key);
    if (cached)
        return cached;
    try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return url;
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, 0, 0);
        const out = canvas.toDataURL("image/png");
        fadeCache.set(key, out);
        return out;
    }
    catch {
        return url; // cross-origin or undecodable: keep as-is
    }
}
/** Reflect the configured level + artwork onto the skeleton. */
async function applyAccent(value, mode, commit, refresh = false) {
    const style = soleStyle(ACCENT_STYLE_ID);
    const raw = Number(value.accentLevel ?? 0);
    // Keep the fraction: the slider is stepless and the ladder interpolates between stops.
    const level = Number.isFinite(raw) ? Math.max(0, Math.min(ACCENT_LEVELS.length - 1, raw)) : 0;
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
    if (!breathSeed || breathSeed.url !== wallpaper)
        breathSeed = { url: wallpaper, hue: frameHue };
    else if (refresh && breathSeed.hue !== null && frameHue !== null && hueDistance(frameHue, breathSeed.hue) > 60) {
        // A jump this large is a new scene, not drift: adopt it as the new seed and follow on from there.
        breathSeed = { url: wallpaper, hue: frameHue };
    }
    else if (breathSeed.hue === null && frameHue !== null) {
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
    accentTargets.forEach((el, index) => {
        el.setAttribute(ACCENT_MARK, accentRole(el));
        // 层次感 (the layered look): a small per-element delay turns a level change into a wave that
        // travels across the UI instead of every surface snapping at the same instant. Costs nothing
        // per frame - the browser does the tweening (paired with --dsh-skin-tint-ms while dragging).
        el.style.setProperty("--dsh-skin-delay", `${(index % 14) * 16}ms`);
        // 让位: look up how busy the picture is under this element's centre.
        //
        // Only for chrome that sits *directly* on the picture. A control inside a panel or a dialog has
        // our own tinted surface behind it, so "the picture is busy there" says nothing about it - and
        // treating it as busy stripped the colour off every button in the settings dialog (the buttons
        // fell back to DSH's own faint white fill, which is what read as a compatibility problem).
        const rect = el.getBoundingClientRect();
        const overPicture = !el.closest(`[${ACCENT_MARK}="panel"]`) &&
            !el.closest('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]');
        const busy = reading && overPicture ? busyUnder(reading, (rect.left + rect.width / 2) / vw, (rect.top + rect.height / 2) / vh) : 0;
        el.setAttribute(BUSY_ATTR, busy > 0.55 ? "1" : "0");
    });
    document.body.setAttribute(ACCENT_ATTR, String(effective));
    const frameUrl = String(value.accentFrame ?? "");
    // The knobs for an applied frame: thickness, strength, and whether it also clothes controls.
    const frameOpts = {
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
    const colourStyle = String(value.accentMode ?? "wash") || "wash";
    // 合成背景：壁纸的平均亮度 + 面板透明度。文字 token 和输入框档位都靠它 ——
    // 这也是可读性那两条修正的地基（没有这个数，对比度就又只能对着“假设不透明的面板”算）。
    const artLum = reading && reading.density.length
        ? reading.density.reduce((sum, cell) => sum + cell.lum, 0) / reading.density.length
        : 0.5;
    const surface = {
        artLum,
        panelAlpha: Math.max(0, Math.min(1, Number(value.panelOpacity ?? 100) / 100)),
        inputAlpha: Math.max(0, Math.min(1, Number(value.inputOpacity ?? 95) / 100)),
    };
    // Cache what the live preview needs, then paint the real sheet.
    accentPreviewInputs = { palette, mode, artUrl, reading, frameOpts, colourStyle, surface };
    style.textContent = accentCss(palette, effective, mode, artUrl, reading, frameOpts, colourStyle, surface);
}
function disposeAccent() {
    dropStyles(ACCENT_STYLE_ID);
    document.body.removeAttribute(ACCENT_ATTR);
    document.querySelectorAll(`[${ACCENT_MARK}]`).forEach((el) => {
        el.removeAttribute(ACCENT_MARK);
        el.removeAttribute(BUSY_ATTR);
    });
    accentTargets = [];
    breathSeed = null;
    lastWallpaper.light = null;
    lastWallpaper.dark = null;
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
    const image = resolveAreaImage(value, area.id, mode);
    const on = value.enabled !== false && value[`${area.id}Enabled`] !== false && image.length > 0;
    const scale = Number(value[`${area.id}Scale`] ?? 100) / 100;
    const dx = Number(value[`${area.id}OffsetX`] ?? 0);
    const dy = Number(value[`${area.id}OffsetY`] ?? 0);
    // Rebuilding a sticker re-decodes its image and restarts a sticker video, so if nothing
    // that affects it changed and it is still mounted, leave it exactly where it is.
    const signature = `${on ? image : "-"}|${scale}|${dx}|${dy}|${editing}`;
    const mounted = document.querySelector(`[data-dsh-skin-sticker="${area.id}"]`);
    if (stickerSignatures[area.id] === signature && (!on || mounted))
        return;
    stickerSignatures[area.id] = signature;
    document.querySelectorAll(`[data-dsh-skin-sticker="${area.id}"]`).forEach((el) => el.remove());
    if (!on || !area.sel)
        return;
    const target = document.querySelector(area.sel);
    if (!target)
        return;
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
        // On a theme switch (fade) only the regions whose image actually changed repaint; a
        // settings edit still forces a repaint so fit/offset changes take effect.
        else
            applyRegionImage(area.id, value, mode, !fade);
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
        refreshAccent?.();
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
            border: "var(--fx-line)",
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
/** One area card: thumbnail, source tag, upload (per-mode or shared), clear, fit, sticker editor. */
function AreaRow(props) {
    const h = React.createElement;
    const area = props.area;
    const v = props.value;
    const modeWord = props.mode === "dark" ? "深色" : "浅色";
    const modeWordEn = props.mode === "dark" ? "dark" : "light";
    const specificField = `${area.id}Image${props.mode === "dark" ? "Dark" : "Light"}`;
    const sharedField = `${area.id}Image`;
    const specific = String(v[specificField] ?? "");
    const sharedImage = String(v[sharedField] ?? "");
    const effective = resolveAreaImage(v, area.id, props.mode);
    const sourceKind = specific ? "mode" : sharedImage ? "shared" : "none";
    const sourceLabel = sourceKind === "mode" ? `${modeWord}专用` : sourceKind === "shared" ? "两模式通用" : "未设置";
    const enabled = v[`${area.id}Enabled`] !== false;
    const fit = String(v[`${area.id}Fit`] ?? "cover");
    const isVideo = effective.length > 0 && VIDEO_RE.test(effective);
    const busy = props.busyField === specificField;
    // A file picker bound to one target field. Rendered as a focusable `label` (role=button) so it
    // is reachable by keyboard too: a bare `<label>` wrapping a hidden input is invisible to Tab, so
    // a keyboard-only user could never upload at all. Enter / Space opens the picker, exactly like a
    // real button; the input itself stays hidden.
    const picker = (key, label, field, variant) => h("label", {
        key,
        className: "dshImgSkin-btn",
        "data-variant": variant,
        role: "button",
        tabIndex: 0,
        onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                e.currentTarget.querySelector('input[type="file"]')?.click();
            }
        },
    }, props.busyField === field ? t("上传中…", "Uploading…") : label, h("input", {
        type: "file",
        accept: "image/*,video/*",
        style: { display: "none" },
        onChange: (e) => {
            const file = e.target.files?.[0];
            if (file)
                props.onPick(file, field);
            e.target.value = "";
        },
    }));
    return h("div", {
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
    h("div", { className: "dshImgSkin-met" }, h("div", { className: "dshImgSkin-name" }, area.label, h("span", { className: "dshImgSkin-tag", "data-kind": sourceKind }, sourceLabel), props.tip ? h("span", { className: "dshImgSkin-tag", "data-kind": "tip" }, "从这里开始") : null), h("div", { className: "dshImgSkin-src" }, area.hint), props.editing ? h("div", { className: "dshImgSkin-src" }, "拖动图片移动位置，拖右下角圆点缩放。") : null), 
    // 3) controls
    h("div", { className: "dshImgSkin-ops" }, h("label", { className: "dshImgSkin-switch" }, h("input", {
        type: "checkbox",
        checked: enabled,
        onChange: (e) => props.onSet(`${area.id}Enabled`, e.target.checked),
    }), "启用"), picker("up-mode", t(`上传${modeWord}图`, `Upload ${modeWordEn} image`), specificField, "primary"), 
    // Only offered when there is no shared image yet - otherwise the 清除 button already
    // covers it, and two near-identical upload buttons side by side just add noise.
    sharedImage ? null : picker("up-shared", t("上传通用图", "Upload shared image"), sharedField, "quiet"), effective
        ? h("button", {
            key: "clear",
            type: "button",
            className: "dshImgSkin-btn",
            "data-variant": "quiet",
            onClick: () => props.onClear(sourceKind === "shared" ? sharedField : specificField),
        }, sourceKind === "shared" ? "清除通用图" : "清除")
        : null, area.kind === "region"
        ? h("span", { key: "fit", className: "dshImgSkin-fit" }, h("span", { className: "dshImgSkin-fitlabel" }, "填充"), h("select", {
            className: "dshImgSkin-btn",
            value: fit,
            onChange: (e) => props.onSet(`${area.id}Fit`, e.target.value),
        }, h("option", { value: "cover" }, "铺满"), h("option", { value: "contain" }, "适应"), h("option", { value: "tile" }, "平铺")))
        : null, area.kind === "sticker" && effective
        ? h("button", {
            key: "edit-pos",
            type: "button",
            className: "dshImgSkin-btn",
            "data-active": String(props.editing),
            onClick: () => props.onToggleEdit(area.id),
        }, props.editing ? "完成" : "编辑位置")
        : null));
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
// ── upload optimisation ─────────────────────────────────────────────────────
//
// The host stores whatever bytes it is given, and every area <img> decodes the full picture even
// when it is painted 96px wide. A camera shot therefore costs ~8 MB of disk and a big decode on
// every settings render. So the browser does the shrinking, before anything crosses the wire:
// longest edge capped, re-encoded as WebP. No native dependency, no server-side image library.
/** Longest edge kept for a stored upload. */
exports.UPLOAD_MAX_DIM = 2560;
/** Below this size and within the cap, the original bytes are kept (a re-encode would only lose). */
exports.UPLOAD_KEEP_BYTES = 700 * 1024;
/** Only formats a canvas can safely re-encode: an animated GIF would lose its animation (one frame). */
const REENCODABLE = /^image\/(png|jpeg|webp|avif)$/i;
/** Whether this upload is worth re-encoding. Exported so the offline test can pin the rule. */
function shouldOptimizeUpload(type, bytes, width, height) {
    if (!REENCODABLE.test(type))
        return false;
    if (Math.max(width, height) > exports.UPLOAD_MAX_DIM)
        return true;
    return bytes > exports.UPLOAD_KEEP_BYTES;
}
function readAsDataUri(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}
/**
 * Downscale + re-encode one upload. Every failure path returns the original file unchanged:
 * an unoptimised upload is a small problem, a refused upload is a big one.
 */
async function prepareUpload(file) {
    const untouched = async () => ({ dataUri: await readAsDataUri(file), note: "" });
    let bitmap = null;
    try {
        if (typeof createImageBitmap !== "function" || !REENCODABLE.test(file.type))
            return untouched();
        bitmap = await createImageBitmap(file);
        const { width, height } = bitmap;
        if (!shouldOptimizeUpload(file.type, file.size, width, height)) {
            bitmap.close?.();
            return untouched();
        }
        const scale = Math.min(1, exports.UPLOAD_MAX_DIM / Math.max(width, height));
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) {
            bitmap.close?.();
            return untouched();
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        bitmap.close?.();
        bitmap = null;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
        // A re-encode that grows the file is a loss on every axis; keep the original instead.
        if (!blob || blob.size >= file.size)
            return untouched();
        const saved = file.size - blob.size;
        const percent = Math.round((saved / file.size) * 100);
        return {
            dataUri: await readAsDataUri(blob),
            note: `${formatMb(file.size)} MB → ${formatMb(blob.size)} MB（省 ${percent}%）`,
        };
    }
    catch {
        bitmap?.close?.();
        return untouched();
    }
}
// ── skin pack (export / import) ─────────────────────────────────────────────
/** Download the whole skin as one JSON file. */
async function exportSkinPack() {
    try {
        const resp = await fetch(`${ROUTE_PREFIX}/export`);
        if (!resp.ok)
            return { ok: false, error: `导出失败（HTTP ${resp.status}）` };
        const blob = await resp.blob();
        const files = Number(resp.headers.get("x-dsh-skin-files") ?? "0") || 0;
        const stamp = new Date().toISOString().slice(0, 10);
        const href = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = href;
        link.download = `dsh-image-skin-${stamp}.pack.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
        return { ok: true, files };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
/**
 * Restore a pack: the host lands the files and returns the settings, then we write only the
 * fields that actually differ. Writing all ~60 fields would mean ~60 settings commits and 60
 * full re-renders of the panel for a pack identical to what is already stored.
 */
async function importSkinPack(file, scope, current) {
    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    }
    catch {
        return { ok: false, message: "这个文件不是有效的 JSON" };
    }
    let resp;
    try {
        resp = await fetch(`${ROUTE_PREFIX}/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(parsed),
        });
    }
    catch (error) {
        return { ok: false, message: `连不上宿主：${error instanceof Error ? error.message : String(error)}` };
    }
    const data = (await resp.json().catch(() => null));
    if (!resp.ok || !data)
        return { ok: false, message: data?.error ?? `导入失败（HTTP ${resp.status}）` };
    const settings = data.settings ?? {};
    let written = 0;
    for (const [field, value] of Object.entries(settings)) {
        if (JSON.stringify((current ?? {})[field]) === JSON.stringify(value))
            continue;
        await scope.set(field, value);
        written++;
    }
    scheduleCollectUnused();
    const files = `恢复 ${data.restored ?? 0} 个文件`;
    const skipped = data.skipped ? `（${data.skipped} 个已存在，跳过）` : "";
    const rej = data.rejected ? `，${data.rejected} 个无效项被拒绝` : "";
    return { ok: true, message: `${files}${skipped}，写入 ${written} 项设置${rej}` };
}
/**
 * Accent level picker. A slider rather than four buttons, because the levels are ordered by
 * cost and the description changes with the level - so the caption cross-fades as you drag
 * instead of snapping, and a reserved level can say so without looking broken.
 */
function AccentRow(props) {
    const h = React.createElement;
    const level = Math.max(0, Math.min(ACCENT_LEVELS.length - 1, Number.isFinite(props.level) ? props.level : 0));
    // The label names the *nearest* rung; the value itself stays fractional, so the slider is stepless.
    const nearest = Math.round(level);
    // 拖拽节流：设置一写，宿主就要重读 + 整面板重渲染 + 整张染色表重建（这才是“卡”的来源）。
    // 所以拖拽期间最多 ~120ms 写一次，松手时再补最后一次——拖动立刻有反应，但不每像素都落盘。
    const [dragging, setDragging] = React.useState(null);
    const shownLevel = dragging ?? level;
    const latest = React.useRef(null);
    const lastWrite = React.useRef(0);
    const writeTimer = React.useRef(null);
    const settleTimer = React.useRef(null);
    const onDrag = (v) => {
        setDragging(v);
        latest.current = v;
        // While the hand is moving, panels must not crawl along their 4s breathing transition
        // (that crawl is the "slider first, colour afterwards" the user reported).
        document.body.style.setProperty("--dsh-skin-tint-ms", "320ms");
        if (settleTimer.current !== null)
            clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
            document.body.style.removeProperty("--dsh-skin-tint-ms");
            settleTimer.current = null;
        }, 800);
        // 立即出效果：用缓存重画样式表（同步、毫秒级）。
        //
        // 拖动期间**不写设置** —— 这是关键：每写一次宿主就带着（落后的）档位重画一次，
        // 于是“实时预览（当前值）”和“落盘重画（旧值）”两个画家互相打断，颜色就会乱飘。
        // 所以：拖动只画，松手才写（见 commitDrag）。
        previewAccentLevel(v);
    };
    const commitDrag = () => {
        if (writeTimer.current !== null) {
            clearTimeout(writeTimer.current);
            writeTimer.current = null;
        }
        if (latest.current !== null) {
            props.onChange(latest.current);
            latest.current = null;
        }
        setDragging(null);
    };
    const nearestShown = Math.round(shownLevel);
    const [shown, setShown] = React.useState(nearest);
    const [visible, setVisible] = React.useState(true);
    const fadeTimer = React.useRef(null);
    // Cross-fade the caption: fade the old label out, swap, fade the new one in.
    React.useEffect(() => {
        if (nearest === shown)
            return;
        setVisible(false);
        if (fadeTimer.current)
            clearTimeout(fadeTimer.current);
        fadeTimer.current = setTimeout(() => {
            setShown(nearest);
            setVisible(true);
        }, 140);
        return () => {
            if (fadeTimer.current)
                clearTimeout(fadeTimer.current);
        };
    }, [nearest, shown]);
    React.useEffect(() => () => {
        if (fadeTimer.current)
            clearTimeout(fadeTimer.current);
    }, []);
    const def = ACCENT_LEVELS[shown];
    return h("div", { className: "dshImgSkin-slider" }, h("div", { className: "dshImgSkin-sliderhead" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "按钮 / 弹窗装饰"), h("span", { className: "dshImgSkin-hint" }, "根据窗口壁纸的配色，给按钮、弹窗和设置分区加底纹。颜色染多深由档位决定。")), h("label", { className: "dshImgSkin-switch" }, h("input", {
        type: "checkbox",
        checked: props.enabled,
        onChange: (e) => props.onToggle(e.target.checked),
    }), "启用")), h("input", {
        className: "dshImgSkin-range",
        type: "range",
        min: 0,
        max: ACCENT_LEVELS.length - 1,
        step: 0.01,
        value: shownLevel,
        disabled: !props.enabled,
        onChange: (e) => onDrag(Number(e.target.value)),
        onPointerUp: commitDrag,
        onKeyUp: commitDrag,
        onBlur: commitDrag,
    }), h("div", { className: "dshImgSkin-ticks" }, ACCENT_LEVELS.map((l, i) => h("button", {
        key: l.name,
        type: "button",
        className: "dshImgSkin-tickBtn",
        "data-on": String(i === nearestShown),
        disabled: !props.enabled,
        onClick: () => props.onChange(i),
    }, l.name))), h("div", { className: "dshImgSkin-accentCaption", "data-visible": String(visible) }, h("span", { className: "dshImgSkin-accentLevel" }, `${shown} · ${def.name}`), def.ready ? " — " : " — ", h("span", { className: "dshImgSkin-hint" }, def.desc)));
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
const STYLE_PRESETS = [
    { name: "极简", text: "minimal, one hairline and a single small corner mark" },
    { name: "巴洛克", text: "baroque scrollwork, dense carving, deep relief" },
    { name: "中式", text: "chinese lattice and cloud motif, fine ink lines" },
    { name: "赛博", text: "cyber neon tubing, thin sharp angles" },
    { name: "自然", text: "organic vine and leaf border, hand-drawn line" },
    { name: "和纸", text: "washi paper fibre edge, soft uneven hand" },
];
function AiAccentPanel(props) {
    const h = React.createElement;
    const v = props.value;
    const [providers, setProviders] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [stage, setStage] = React.useState(null);
    const [status, setStatus] = React.useState(null);
    const [promptDraft, setPromptDraft] = React.useState(null);
    const [autoPrompt, setAutoPrompt] = React.useState(null);
    const [keyCheck, setKeyCheck] = React.useState(null);
    const [checking, setChecking] = React.useState(false);
    const [advanced, setAdvanced] = React.useState(false);
    const [hovered, setHovered] = React.useState(null);
    const providerId = String(v.accentProvider ?? "dashscope-wanx");
    const keyMode = String(v.accentKeyMode ?? "env");
    const current = providers?.find((p) => p.id === providerId) ?? null;
    const isCustom = providerId === "custom";
    // Results live in settings, not in component state: leaving this page used to throw the wall away
    // (and the files it pointed at were then collected as orphans).
    const frames = React.useMemo(() => {
        try {
            const parsed = JSON.parse(String(v.accentFrames ?? "[]"));
            return Array.isArray(parsed) ? parsed.slice(0, 24) : [];
        }
        catch {
            return [];
        }
    }, [v.accentFrames]);
    const writeFrames = (next) => props.onSet("accentFrames", JSON.stringify(next.slice(0, 24)));
    React.useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const res = await fetch(`${ROUTE_PREFIX}/providers`);
                const data = await res.json();
                if (alive)
                    setProviders(Array.isArray(data?.providers) ? data.providers : []);
            }
            catch {
                if (alive)
                    setProviders([]);
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
    const fetchPrompt = async () => {
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
        if (promptDraft !== null)
            return;
        let alive = true;
        const timer = setTimeout(() => {
            void (async () => {
                const text = await fetchPrompt();
                if (alive && text)
                    setAutoPrompt(text);
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
        }
        catch (error) {
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
        }
        catch (error) {
            setKeyCheck(`⚠️ 检查失败：${String(error)}`);
        }
        finally {
            setChecking(false);
        }
    };
    const stageText = {
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
            let urls = [];
            let failure = null;
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
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    const parts = buffer.split("\n\n");
                    buffer = parts.pop() ?? "";
                    for (const part of parts) {
                        const line = part.replace(/^data:\s*/m, "").trim();
                        if (!line)
                            continue;
                        try {
                            const event = JSON.parse(line);
                            if (typeof event.stage === "string" && event.stage !== "done")
                                setStage(event.stage);
                            if (event.stage === "done") {
                                urls = Array.isArray(event.urls) ? event.urls : [];
                                if (!urls.length)
                                    failure = { error: String(event.error ?? "生成失败"), hint: event.hint ? String(event.hint) : undefined, detail: event.detail ? String(event.detail) : undefined };
                            }
                        }
                        catch {
                            /* keep-alive or half a frame; ignore */
                        }
                    }
                }
            }
            else {
                const plain = await fetch(`${ROUTE_PREFIX}/gen`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(payload),
                });
                const data = await plain.json();
                urls = Array.isArray(data?.urls) ? data.urls : [];
                if (!urls.length)
                    failure = { error: String(data?.error ?? data?.status ?? "生成失败"), hint: data?.hint, detail: data?.detail };
            }
            if (!urls.length) {
                setStatus({ kind: "err", text: failure?.error ?? "生成失败", hint: failure?.hint ?? failure?.detail });
                return;
            }
            const record = urls.map((url) => ({
                url,
                prompt,
                provider: providerId,
                model: String(current?.model ?? v.accentModel ?? ""),
                at: Date.now(),
            }));
            writeFrames([...record, ...frames]);
            setStatus({ kind: "ok", text: `生成完成 ${urls.length} 张 —— 点缩略图就应用到面板` });
        }
        catch (error) {
            setStatus({ kind: "err", text: `生成失败：${String(error)}` });
        }
        finally {
            setBusy(false);
            setStage(null);
        }
    };
    const field = (key, label, node, hint) => h("div", { className: "dshImgSkin-field", key }, h("span", { className: "dshImgSkin-fieldLabel" }, label), h("div", { className: "dshImgSkin-fieldBody" }, node, hint ? h("span", { className: "dshImgSkin-hint" }, hint) : null));
    const textInput = (fieldName, opts = {}) => h("input", {
        className: "dshImgSkin-input",
        value: String(v[fieldName] ?? ""),
        ...opts,
        onChange: (e) => props.onSet(fieldName, e.target.value),
    });
    const envName = String(current?.keyEnv ?? "");
    const envReady = Boolean(current?.envReady);
    const applied = String(v.accentFrame ?? "");
    return h("div", { className: "dshImgSkin-card" }, h("div", { className: "dshImgSkin-cardhead" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "生成装饰框"), h("p", { className: "dshImgSkin-sub" }, "让生图模型画一张边框花纹。提示词里已经写死了「不要文字 / 人 / 景 / 物」，配色和材质来自你的壁纸。"))), 
    // 1) who draws it
    field("provider", "服务商", h("div", { className: "dshImgSkin-inline" }, h("select", {
        className: "dshImgSkin-input",
        value: providerId,
        onChange: (e) => {
            props.onSet("accentProvider", e.target.value);
            setKeyCheck(null);
        },
    }, (providers ?? []).map((p) => h("option", { key: String(p.id), value: String(p.id) }, String(p.label)))), h("button", { className: "dshImgSkin-btn", type: "button", disabled: checking, onClick: () => void probeKey() }, checking ? "检查中…" : "检查")), isCustom ? "自定义：下面填 Base URL 与模型 ID" : `默认模型 ${String(current?.model ?? "")}`), keyCheck ? h("p", { className: "dshImgSkin-ok" }, keyCheck) : null, 
    // The address override is shown whenever one is set, not only for 自定义 - otherwise a leftover
    // testing URL stays invisible while the provider is switched back to a preset, and every request
    // quietly goes to the wrong host. (This is exactly how a local mock endpoint kept intercepting a
    // real key.)
    isCustom || String(v.accentBaseUrl ?? "").trim()
        ? field("base", "Base URL", h("div", { className: "dshImgSkin-inline" }, textInput("accentBaseUrl", {
            placeholder: isCustom ? "https://your-endpoint/v1" : `留空则用官方地址 ${String(current?.baseUrl ?? "")}`,
        }), String(v.accentBaseUrl ?? "").trim()
            ? h("button", { className: "dshImgSkin-btn", type: "button", "data-variant": "quiet", onClick: () => props.onSet("accentBaseUrl", "") }, "清空（用官方地址）")
            : null), isCustom
            ? "自定义服务商：Base URL 与模型 ID 都要填"
            : "⚠️ 这里填过地址，它会覆盖该服务商的官方地址（测试用的本地地址就是这样把请求引走的）")
        : null, field("model", "模型 ID", textInput("accentModel", { placeholder: current?.model ? String(current.model) : "your-model-id" }), isCustom ? undefined : "留空则用该服务商的默认模型"), field("keysrc", "API Key", h("div", { className: "dshImgSkin-inline" }, ...["env", "manual"].map((m) => h("button", {
        key: m,
        type: "button",
        className: "dshImgSkin-btn",
        "data-active": String(keyMode === m),
        onClick: () => props.onSet("accentKeyMode", m),
    }, m === "env" ? "环境变量" : "手动输入"))), keyMode === "env"
        ? envReady
            ? `✓ 已检测到 ${envName}（只读，Key 不入设置文件）`
            : `未检测到 ${envName || "对应环境变量"}；可切到手动输入`
        : "Key 存本机设置文件，不会上传；但仍请注意本机安全"), keyMode === "env"
        ? field("envname", "变量名", textInput("accentKeyEnv", { placeholder: envName || "ARK_API_KEY", disabled: Boolean(envName) }), "留空则用该服务商的默认变量名")
        : field("key", "Key", textInput("accentApiKey", { type: "password", placeholder: "sk-..." })), 
    // 2) what to ask for
    field("style", "风格", h("div", { className: "dshImgSkin-inline" }, ...STYLE_PRESETS.map((preset) => h("button", {
        key: preset.name,
        type: "button",
        className: "dshImgSkin-btn",
        "data-variant": "quiet",
        onClick: () => {
            props.onSet("accentStyle", preset.text);
        },
    }, preset.name))), String(v.accentStyle ?? "") ? `当前：${String(v.accentStyle)}` : "点一个词就填进去；也可以留空让模型自由发挥"), field("prompt", "提示词", h("textarea", {
        className: "dshImgSkin-input dshImgSkin-textarea",
        rows: 4,
        value: promptDraft ?? autoPrompt ?? "",
        placeholder: "正在按当前设定拼提示词…你打一个字就会固定下来",
        onChange: (e) => setPromptDraft(e.target.value),
    }), promptDraft !== null
        ? "已手改（生成用你改的这份）"
        : "跟随上面的设定实时更新；你打一个字就固定下来"), h("div", { className: "dshImgSkin-inline" }, h("button", { className: "dshImgSkin-btn", type: "button", onClick: () => void preview() }, "看看会发什么"), h("button", {
        className: "dshImgSkin-btn",
        type: "button",
        "data-variant": "quiet",
        onClick: () => {
            setPromptDraft(null);
            setStatus(null);
        },
    }, "恢复跟随设定"), h("span", { className: "dshImgSkin-fitlabel" }, `${Number(v.accentCount ?? 2)} 张`), h("input", {
        className: "dshImgSkin-input dshImgSkin-inputNarrow",
        type: "number",
        min: 1,
        max: 4,
        value: String(v.accentCount ?? 2),
        onChange: (e) => props.onSet("accentCount", Number(e.target.value)),
    })), 
    // 3) advanced
    h("div", { className: "dshImgSkin-inline" }, h("button", { className: "dshImgSkin-btn", type: "button", "data-variant": "quiet", onClick: () => setAdvanced((a) => !a) }, advanced ? "收起高级 ▴" : "高级 ▾")), advanced
        ? field("size", "尺寸", h("select", {
            className: "dshImgSkin-input dshImgSkin-inputNarrow",
            value: String(v.accentSize ?? "1024x1024"),
            onChange: (e) => props.onSet("accentSize", e.target.value),
        }, ["1024x1024", "1280x720", "720x1280"].map((s) => h("option", { key: s, value: s }, s))), "尺寸影响不大，用默认的就行")
        : null, 
    // 4) go
    h("div", { className: "dshImgSkin-inline" }, h("button", { className: "dshImgSkin-btn", type: "button", "data-variant": "primary", disabled: busy, onClick: () => void generate() }, busy ? "生成中…" : "生成装饰"), busy && stage ? h("span", { className: "dshImgSkin-hint" }, stageText[stage] ?? stage) : null, h("span", { className: "dshImgSkin-hint" }, `本次会话已生成 ${frames.length} 张（会产生费用）`)), status
        ? h("p", { className: status.kind === "ok" ? "dshImgSkin-ok" : "dshImgSkin-banner" }, status.text, status.hint ? h("span", { className: "dshImgSkin-hint" }, ` ${status.hint}`) : null)
        : null, 
    // 5) results
    frames.length
        ? h("div", null, h("div", { className: "dshImgSkin-results" }, ...frames.map((frame) => h("div", { key: frame.url, className: "dshImgSkin-frameCell", onMouseEnter: () => setHovered(frame.url), onMouseLeave: () => setHovered(null) }, h("button", {
            type: "button",
            className: "dshImgSkin-result",
            "data-on": String(applied === frame.url),
            title: applied === frame.url ? "再点一下取消应用" : "点击应用这张",
            onClick: () => props.onSet("accentFrame", applied === frame.url ? "" : frame.url),
        }, h("img", { src: frame.url, alt: "" })), h("div", { className: "dshImgSkin-inline dshImgSkin-frameOps" }, h("a", { className: "dshImgSkin-btn", "data-variant": "quiet", href: frame.url, download: "" }, "下载"), h("button", {
            className: "dshImgSkin-btn",
            type: "button",
            "data-variant": "quiet",
            onClick: () => {
                if (applied === frame.url)
                    props.onSet("accentFrame", "");
                writeFrames(frames.filter((f) => f.url !== frame.url));
            },
        }, "删除"))))), hovered && frames.find((f) => f.url === hovered)
            ? h("p", { className: "dshImgSkin-hint" }, `这张的提示词：${frames.find((f) => f.url === hovered)?.prompt ?? ""}`)
            : h("p", { className: "dshImgSkin-hint" }, "点缩略图应用；按一下已应用的那张就能取消。结果会保存，离开也不会丢。"))
        : null);
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
        const [packStatus, setPackStatus] = React.useState(null);
        const packFile = React.useRef(null);
        // Every write to the host goes through here. A tab opened before a DSH restart keeps rendering
        // and keeps accepting clicks, but its token is dead - so writes fail and every control looks
        // broken ("点上去没反应"). Say so on screen instead of leaving a dead UI behind.
        const writeFailedNotice = "写不进去：这个页面和 DSH 的连接已经断了（DSH 服务重启过就会这样）。请刷新页面，或用最新打开的那个标签。";
        const apply = (field, value) => {
            void scope.set(field, value).catch(() => setNotice(writeFailedNotice));
        };
        const upload = async (field, file) => {
            setNotice(null);
            if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
                setNotice(`${file.name} 有 ${formatMb(file.size)} MB，超过 ${MAX_UPLOAD_MB} MB 上限`);
                return;
            }
            setBusy(field);
            try {
                const prepared = await prepareUpload(file);
                const resp = await fetch(`${ROUTE_PREFIX}/upload`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ image: prepared.dataUri }),
                });
                const data = (await resp.json().catch(() => null));
                if (!resp.ok || !data?.url) {
                    setNotice(data?.error ?? `上传失败（HTTP ${resp.status}）`);
                    return;
                }
                await scope.set(field, data.url);
                scheduleCollectUnused();
                if (prepared.note)
                    setNotice(`${file.name}：${prepared.note}`);
            }
            catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                console.error("[dsh-image-skin] upload failed", error);
            }
            finally {
                setBusy(null);
            }
        };
        const regionAreas = AREAS.filter((a) => a.kind === "region");
        const stickerAreas = AREAS.filter((a) => a.kind === "sticker");
        const rowProps = (area) => ({
            key: area.id,
            area,
            value: v,
            mode,
            busyField: busy,
            editing: editingId === area.id,
            tip: area.id === "window" && configuredAreas === 0,
            onPick: (file, field) => void upload(field, file),
            onSet: (field, val) => apply(field, val),
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
        });
        const areaGroup = (title, note, list) => h("div", { className: "dshImgSkin-card" }, h("div", { className: "dshImgSkin-cardhead" }, h("div", null, h("span", { className: "dshImgSkin-title" }, title, h("span", { className: "dshImgSkin-tag", "data-kind": "count" }, `${list.filter((a) => Boolean(v[`${a.id}Image`] || v[`${a.id}ImageLight`] || v[`${a.id}ImageDark`])).length}/${list.length} 已配`)), h("p", { className: "dshImgSkin-sub" }, note))), h("div", { className: "dshImgSkin-areas" }, list.map((area) => h(AreaRow, rowProps(area)))));
        // Mode is a *filter over one page*, not a second screen. Switching changes which set of
        // images you are editing (and flips the live theme so you can see it), while the area list,
        // the global sliders and storage stay exactly where they are.
        const modeSeg = h("div", { className: "dshImgSkin-seg" }, ["light", "dark"].map((m) => h("button", {
            key: m,
            type: "button",
            "data-on": String(mode === m),
            onClick: () => modeStore.pick(m),
        }, m === "dark" ? h(MoonIcon, { size: 13 }) : h(SunIcon, { size: 13 }), modeLabel(m))));
        // ── two screens ───────────────────────────────────────────────────────────
        // Screen one is a choice, screen two is a workbench. They live apart because the image editor
        // and the colour screen answer different questions - and because the colour screen has nothing
        // to do until a wallpaper exists to sample its palette from.
        const hasWallpaper = windowHasArtwork(v);
        const [page, setPage] = React.useState("home");
        // Losing the wallpaper drops you back to the choice screen, so the locked entry never lies
        // about being usable.
        React.useEffect(() => {
            if (page === "colour" && !hasWallpaper)
                setPage("home");
        }, [page, hasWallpaper]);
        // How much is set up, in the currency the user thinks in: areas.
        const configuredAreas = AREAS.filter((a) => Boolean(v[`${a.id}Image`] || v[`${a.id}ImageLight`] || v[`${a.id}ImageDark`])).length;
        // Returning users already have art configured, so drop them straight onto the workbench -
        // the choice screen exists for first-timers who have nothing to work on yet. One-shot: it
        // never fights a later manual navigation, and it never fires before the settings have loaded
        // (while loading, every area reads empty, so `configuredAreas` is 0 and the effect just waits).
        const landedOnWorkbench = React.useRef(false);
        React.useEffect(() => {
            if (landedOnWorkbench.current || configuredAreas === 0)
                return;
            landedOnWorkbench.current = true;
            setPage((p) => (p === "home" ? "images" : p));
        }, [configuredAreas]);
        const accentIndex = Math.max(0, Math.min(ACCENT_LEVELS.length - 1, Math.round(Number(v.accentLevel ?? 0))));
        const sampledColours = String(v.accentPalette ?? "")
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);
        /** Friendly names for the material read (see MATERIALS in the host half). */
        /** One line per colour route, so the switch explains itself. */
        const COLOUR_STYLES = {
            wash: "每个面都带色，描边到处都有 —— 像被泡在颜色里",
            marks: "面保持中性，只有选中项 / 焦点框 / 一条分隔线有色",
            duo: "面借主色，交互色用画面里的第二个色相",
        };
        const MATERIAL_LABELS = {
            sky: "天空 / 天光",
            paper: "纸 / 和纸",
            wood: "木",
            water: "水 / 波纹",
            neon: "霓虹 / 高饱和",
            plain: "（未识别）",
        };
        const colourStatus = v.accentEnabled === false
            ? "配色未开启"
            : `档位 ${accentIndex} · ${ACCENT_LEVELS[accentIndex]?.name ?? "取色"}`;
        const back = (title) => h("div", { className: "dshImgSkin-nav" }, h("button", { className: "dshImgSkin-btn", type: "button", onClick: () => setPage("home") }, "← 返回"), h("span", { className: "dshImgSkin-navTitle" }, title));
        const entry = (target, title, sub, status, locked, lockedHint) => h("button", {
            key: target,
            type: "button",
            className: "dshImgSkin-entry",
            disabled: locked,
            "data-ready": String(!locked),
            onClick: () => {
                if (!locked)
                    setPage(target);
            },
        }, h("span", { className: "dshImgSkin-entryTop" }, h("span", { className: "dshImgSkin-entryTitle" }, title), h("span", { className: "dshImgSkin-chev" }, locked ? "🔒" : "›")), h("span", { className: "dshImgSkin-entryStatus" }, status), h("span", { className: "dshImgSkin-entrySub" }, sub), locked && lockedHint ? h("span", { className: "dshImgSkin-lock" }, lockedHint) : null);
        const home = h("div", { className: "dshImgSkin-shell", "data-dsh-skin-chrome": "settings" }, h("p", { className: "dshImgSkin-intro" }, "两块可以分开用：先在「贴图」里放上自己的画面，再决定要不要让界面「跟着画面配色」。图片只存在本机，不会上传。"), h("div", { className: "dshImgSkin-entries" }, entry("images", "贴图", "窗口壁纸、各区域图片 / 视频、角标、面板透明度、存储清理。", configuredAreas ? `已配置 ${configuredAreas} / ${AREAS.length} 个区域` : "还没放图 · 建议先配「窗口」", false), entry("colour", "配色", "把画面里的颜色染到按钮、输入框和弹窗上；档位只决定深浅，不改变画什么。", colourStatus, !hasWallpaper, "先给「窗口」放一张贴图才能进——颜色要从那张图里取。")), notice ? h("p", { className: "dshImgSkin-banner" }, notice) : null);
        /**
         * Seed the other mode from this one — filling only the slots that are still empty.
         * Setting up eight regions twice is the tedious part of this plugin; this turns the second pass
         * into a few tweaks instead of a repeat. It only ever *adds*: a slot you already filled is left
         * alone, so nothing you configured can be overwritten (and nothing gets garbage-collected
         * behind your back).
         */
        const otherMode = mode === "dark" ? "light" : "dark";
        const mySuffix = mode === "dark" ? "Dark" : "Light";
        const otherSuffix = otherMode === "dark" ? "Dark" : "Light";
        const fillable = AREAS.filter((a) => {
            const mine = String(v[`${a.id}Image${mySuffix}`] ?? "").trim();
            const theirs = String(v[`${a.id}Image${otherSuffix}`] ?? "").trim();
            return mine.length > 0 && theirs.length === 0;
        });
        const seedRow = h("div", { className: "dshImgSkin-row" }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "补齐另一个模式"), h("small", { className: "dshImgSkin-hint" }, fillable.length
            ? `把「${modeLabel(mode)}」这套复制给「${modeLabel(otherMode)}」——只填还没配的 ${fillable.length} 个区域，已经配好的不动。`
            : `「${modeLabel(otherMode)}」已经没有空缺了。`)), h("button", {
            className: "dshImgSkin-btn",
            type: "button",
            disabled: fillable.length === 0,
            onClick: () => {
                for (const a of fillable) {
                    const from = String(v[`${a.id}Image${mySuffix}`] ?? "").trim();
                    if (from)
                        apply(`${a.id}Image${otherSuffix}`, from);
                }
            },
        }, "补齐")));
        const imagesPage = h("div", { className: "dshImgSkin-shell", "data-dsh-skin-chrome": "settings" }, back("贴图"), h("p", { className: "dshImgSkin-intro" }, "给界面各区域换上你自己的图片或视频；图片只存在本机，不会上传到外部服务。"), configuredAreas === 0
            ? h("div", { className: "dshImgSkin-tipCard" }, h("span", { className: "dshImgSkin-tipTitle" }, "第一步：给「窗口」放一张图"), h("p", { className: "dshImgSkin-sub" }, "整块底图换掉之后界面立刻不一样；其余区域可以之后再单独配，浅色 / 深色也能各配一套。"))
            : null, notice ? h("p", { className: "dshImgSkin-banner" }, notice) : null, h("div", { className: "dshImgSkin-card" }, h("div", { className: "dshImgSkin-cardhead" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "正在编辑"), h("p", { className: "dshImgSkin-sub" }, "浅色和深色各有一套图；切换时界面主题也会跟着切，方便边配边看。某个区域没单独配，会回退到「通用图」。")), modeSeg), seedRow), areaGroup("界面区域", "整窗口的底图与各块面板的背景。", regionAreas), areaGroup("角标贴图", "贴在侧栏 / 输入框上，可拖动、可缩放。", stickerAreas), h("div", { className: "dshImgSkin-card" }, h("div", { className: "dshImgSkin-cardhead" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "全局效果"), h("p", { className: "dshImgSkin-sub" }, "两个模式通用，拖动即时生效。"))), h(SliderRow, {
            key: "opacity",
            title: "面板不透明度",
            hint: "越低越能透出壁纸；角标贴图会同步变淡，壁纸本身不受影响",
            value: Number(v.panelOpacity ?? 100),
            min: 0,
            max: 100,
            step: 1,
            format: (n) => `${n}%`,
            onPreview: (n) => applyPanelOpacity({ ...v, panelOpacity: n }, mode),
            onCommit: (n) => apply("panelOpacity", n),
        }), h(SliderRow, {
            key: "inputOpacity",
            title: "输入框不透明度",
            hint: "输入框 / 下拉框 / 文本域单独一档 —— 面板可以很透，但你正在读、正在打的字要看得清",
            value: Number(v.inputOpacity ?? 95),
            min: 25,
            max: 100,
            step: 1,
            format: (n) => `${n}%`,
            // 拖动直接改 CSS 变量：即时生效，不用等整张染色表重建。
            onPreview: (n) => document.body.style.setProperty("--dsh-skin-input-alpha", String(Math.max(0, Math.min(1, n / 100)))),
            onCommit: (n) => {
                apply("inputOpacity", n);
                // 设置写入会触发一次全量重绘（带上新值），之后就交给样式表，把临时变量收回去。
                window.setTimeout(() => document.body.style.removeProperty("--dsh-skin-input-alpha"), 1200);
            },
        }), h("div", { className: "dshImgSkin-row" }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "自动适配"), h("small", { className: "dshImgSkin-hint" }, "开启后按当前对话的文字量实时调整面板不透明度 —— 字少更透（看到壁纸），字多更实（读得清），不用手动管")), h("label", { className: "dshImgSkin-switch" }, h("input", {
            type: "checkbox",
            checked: v.autoOpacity === true,
            onChange: (e) => apply("autoOpacity", e.target.checked),
        }), "开启"))), h(SliderRow, {
            key: "rate",
            title: "视频播放速率",
            hint: "作用于上传的视频（窗口壁纸与角标视频），拖动即时生效",
            value: Number(v.videoPlaybackRate ?? 1),
            min: 0.25,
            max: 3,
            step: 0.25,
            format: (n) => `${n}×`,
            onPreview: (n) => previewVideoRate(n),
            onCommit: (n) => apply("videoPlaybackRate", n),
        })), h("div", { className: "dshImgSkin-card" }, h("div", { className: "dshImgSkin-cardhead" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "存储"), h("p", { className: "dshImgSkin-sub" }, `图片存在本机的 image-skin 目录，单文件上限 ${MAX_UPLOAD_MB} MB；换图或清除后，不再被引用的旧文件会自动删掉——想留就先存一份`)), h("button", {
            className: "dshImgSkin-btn",
            onClick: () => {
                // Files on disk, gone for good - so ask first. The hint promises this can never
                // touch a file some area still references, but the user should still be the one
                // to pull the trigger.
                if (!window.confirm(t("清理未被引用的图片文件？用不到的旧文件会被永久删除，无法恢复。", "Delete stored image files that no longer belong to any area? They are erased permanently and cannot be recovered."))) {
                    return;
                }
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
        }, t("清理未使用图片", "Clean up unused images"))), gcStatus ? h("p", { className: "dshImgSkin-ok" }, gcStatus) : null), h("div", { className: "dshImgSkin-card" }, h("div", { className: "dshImgSkin-cardhead" }, h("div", null, h("span", { className: "dshImgSkin-title" }, t("皮肤包", "Skin pack")), h("p", { className: "dshImgSkin-sub" }, t("把这套皮肤（图片 + 全部设置）导出成一个文件：备份、换电脑、送给朋友都行。导入会补齐缺的图，并覆盖当前的皮肤设置——API Key 不会进包，也不会被覆盖。", "Export this whole skin (images + every setting) as one file: back it up, move machines, or hand it to a friend. Import restores missing images and replaces the current skin settings. API keys never travel in a pack and are never overwritten."))), h("div", { className: "dshImgSkin-packrow" }, h("button", {
            className: "dshImgSkin-btn",
            onClick: () => {
                void (async () => {
                    setPackStatus(t("导出中…", "Exporting…"));
                    const result = await exportSkinPack();
                    setPackStatus("error" in result ? result.error : `已导出，含 ${result.files} 个文件`);
                })();
            },
        }, t("导出", "Export")), h("button", { className: "dshImgSkin-btn", onClick: () => packFile.current?.click() }, t("导入", "Import")), h("input", {
            ref: packFile,
            type: "file",
            accept: ".json,application/json",
            style: { display: "none" },
            onChange: (e) => {
                const picked = e.target.files?.[0];
                e.target.value = "";
                if (!picked)
                    return;
                // Importing replaces the skin settings wholesale, so ask first - the same courtesy
                // the cleanup button gets. Stored images are only added, never deleted.
                if (!window.confirm(t("导入会覆盖当前的图片皮肤设置（图片文件只补不删）。继续？", "Import replaces the current skin settings (stored images are added, never deleted). Continue?"))) {
                    return;
                }
                void (async () => {
                    setPackStatus(t("导入中…", "Importing…"));
                    const result = await importSkinPack(picked, scope, v);
                    setPackStatus(result.message);
                })();
            },
        }))), packStatus ? h("p", { className: "dshImgSkin-ok" }, packStatus) : null));
        const colourPage = h("div", { className: "dshImgSkin-shell", "data-dsh-skin-chrome": "settings" }, back("配色"), h("p", { className: "dshImgSkin-intro" }, "档位只决定颜色染多深：0 最淡（只描一圈细线），往上逐级加深、并跟着画面里的光走。全部在本机完成，不联网。"), h("div", { className: "dshImgSkin-card" }, h(AccentRow, {
            key: "accent",
            level: Number(v.accentLevel ?? 0),
            enabled: v.accentEnabled !== false,
            onChange: (n) => apply("accentLevel", n),
            onToggle: (on) => apply("accentEnabled", on),
        }), 
        // 配色强度：三条路线的开关，差别一眼就能看出来（原型图见 _proto/routes_*.png）
        h("div", { className: "dshImgSkin-row" }, h("div", { className: "dshImgSkin-head" }, h("div", null, h("span", { className: "dshImgSkin-title" }, "配色强度"), h("small", { className: "dshImgSkin-hint" }, COLOUR_STYLES[String(v.accentMode ?? "wash")] ?? ""))), h("div", { className: "dshImgSkin-inline" }, ...[
            ["wash", "整屏染色"],
            ["marks", "只染三处"],
            ["duo", "双声部"],
        ].map(([id, label]) => h("button", {
            key: id,
            type: "button",
            className: "dshImgSkin-btn",
            "data-active": String(v.accentMode ?? "wash") === id,
            onClick: () => apply("accentMode", id),
        }, label)))), 
        // Show what the scheme is built from. The sampler returns wallpaper colours; the CSS turns
        // them into one hue with three roles, so showing the raw four is an honest preview of the
        // material without pretending it is the result.
        sampledColours.length
            ? h("div", { className: "dshImgSkin-swatchRow" }, h("div", { className: "dshImgSkin-inline" }, h("span", { className: "dshImgSkin-fitlabel" }, "取自壁纸"), ...sampledColours.map((c, i) => h("span", { key: `s${i}`, className: "dshImgSkin-swatch", style: { background: `rgb(${c})` }, title: c })), String(v.accentMaterial ?? "") && String(v.accentMaterial) !== "plain"
                ? h("span", { className: "dshImgSkin-fitlabel" }, `· 识别到的材质：${MATERIAL_LABELS[String(v.accentMaterial)] ?? String(v.accentMaterial)}`)
                : null), h("span", { className: "dshImgSkin-hint" }, "档位只决定颜色染多深；配色全部在本机算，不联网"))
            : null));
        return page === "home" ? home : page === "images" ? imagesPage : colourPage;
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
    for (const id of Object.keys(stickerSignatures))
        delete stickerSignatures[id];
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
    dropStyles(PANEL_STYLE_ID);
    disposeAccent();
}
function apply(ctx) {
    const generation = ++applyGeneration;
    ensureBaseStyles();
    installVisibilityGuard();
    document.body.setAttribute(BODY_ATTR, "");
    const scope = createSettingsScope(ctx);
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
    // New chrome appears all the time - dialogs, menus, popovers - and the accent scan has to keep
    // up: the settings dialog itself is the biggest panel we decorate, and it never existed at the
    // moment the last scan ran. Re-running is cheap because the palette is cached.
    refreshAccent = () => {
        const snapshot = scope.getSnapshot();
        if (snapshot.value)
            void applyAccent(snapshot.value, modeStore.get(), commit);
    };
    reapplyWith = (patch) => {
        const snapshot = scope.getSnapshot();
        if (snapshot.value)
            void applyAccent({ ...snapshot.value, ...patch }, modeStore.get());
    };
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
            const flipped = next !== lastScheme;
            lastScheme = next;
            // Cross-fade only a real light <-> dark flip (not a font-size-only change), and
            // never the first snapshot, which is just the initial paint.
            if (flipped)
                startThemeAnimation();
            // Let the palette repaint and the transition start in their own frame before the
            // settings UI re-renders (its thumbnails decode the other mode's images).
            requestAnimationFrame(() => modeStore.notify());
            if (flipped)
                renderSkin(true);
            else
                render();
            // `theme/change` *leads* the DOM: for a beat after it fires, the theme flag and the theme
            // service can still report the old scheme, and the accent is derived from an async image
            // read on top of that. Repainting only in that instant is how a light<->dark switch ends up
            // still wearing the previous scheme until a manual reload. Repaint once more after both
            // have settled.
            if (flipped) {
                window.setTimeout(() => {
                    if (generation === applyGeneration)
                        renderSkin(true);
                }, 700);
            }
        });
        // 呼吸 (breathing): a video backdrop keeps moving, so re-read a frame now and then and let the
        // accent drift with it - slowly, and only within a small hue distance of the seed (see the
        // guard in applyAccent). Off entirely for still images, and when the accent is off.
        const breatheTimer = window.setInterval(() => {
            const snapshot = scope.getSnapshot();
            const v = snapshot.value;
            if (!v || v.accentEnabled === false || Number(v.accentLevel ?? 0) < 1)
                return;
            const img = resolveAreaImage(v, "window", modeStore.get());
            if (!img || !VIDEO_RE.test(img))
                return;
            void applyAccent(v, modeStore.get(), commit, true);
        }, 8000);
        // 自动不透明度: with the switch on, follow how much text is on screen and keep the panel
        // opacity in step - few words -> see-through, lots -> readable. Throttled: it only writes
        // when the value actually moves by a whole percent.
        const autoOpacityTimer = window.setInterval(() => {
            const snapshot = scope.getSnapshot();
            const v = snapshot.value;
            if (!v || v.autoOpacity !== true)
                return;
            const n = autoPanelOpacity();
            if (Math.abs(n - Number(v.panelOpacity ?? 85)) < 1)
                return;
            applyPanelOpacity({ ...v, panelOpacity: n }, modeStore.get());
            commit({ panelOpacity: n });
        }, 1200);
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
            clearInterval(breatheTimer);
            clearInterval(autoOpacityTimer);
            if (themeAnimTimer) {
                clearTimeout(themeAnimTimer);
                themeAnimTimer = null;
            }
            // Everything above is per-instance wiring and always has to go. Everything below owns
            // the DOM, and only the newest instance is allowed to touch it: if a previous apply()
            // has already been superseded, its cleanup used to remove the body flag and panel
            // stylesheet the new instance had just installed, which silently killed every
            // `body[data-dsh-image-skin] …` rule and left the panels opaque.
            if (generation !== applyGeneration)
                return;
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
    // ── the reasoning-effort slider (folded in from its own plugin) ─────────────
    // It activates only when its services exist (locale / sessions / modelDirectories …). If a
    // generation does not provide them it simply never appears; the rest of the skin is untouched.
    try {
        activateEffortSlider(ctx);
    }
    catch (error) {
        console.warn("dsh-image-skin: effort slider not activated", error);
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateEffortSlider = activateEffortSlider;
/**
 * Effort slider, folded into dsh-image-skin (2026-10-11).
 *
 * Ported verbatim from dsh-codex-effort-slider's browser half. Everything lives inside this one
 * function, so none of its names (NS, CSS, apply, inject, ...) collide with image-skin's own.
 * `React` and `require` resolve to the wrapping bundle scope, which image-skin already provides.
 *
 * @param ctx - the image-skin client context, already injected with the slider's services.
 */
function activateEffortSlider(ctx) {
    /**
     * dsh-codex-effort-slider - Browser half.
     *
     * A reproduction of **Codex's reasoning-effort card** for the DSH composer:
     * the dark rounded panel with the lightning mark, the `Ultra ›` / model-name
     * block, the fat pill track that fades blue-violet into deep violet, the white
     * round thumb parked at the right, the starfield inside the track and the
     * status ring on the right.
     *
     * Fidelity notes - the reference is Codex's own effort UI, and every constant
     * that Codex publishes in source is kept verbatim:
     *
     *  - the two accented tiers are `max` (`rgb(255,178,66)` on dark,
     *    `rgb(176,98,0)` on light) and `ultra` (`rgb(186,130,255)` /
     *    `rgb(124,58,217)`), with prompt glyphs `\u203A` and `\u00BB`; every other
     *    level stays neutral and carries no glyph (`codex-rs/tui/src/bottom_pane/effort_ignition.rs`);
     *  - the track gradient walks Codex's Ultra hue triple - `rgb(120,170,255)`
     *    blue into `rgb(186,130,255)` violet - which is exactly the blue-to-violet
     *    ramp the reference card shows;
     *  - the glyph "charges" from neutral into the accent over Codex's `CHARGE`
     *    (150 ms), capped at `PROMPT_ACCENT_ALPHA` (0.86);
     *  - a change into an accented tier replays Codex's one-shot ignition
     *    (Wave / Aurora / Pulse) with the same hues, the same 900/1250, 1000/1300
     *    and 1300/1600 ms durations, the same 33 ms frame tick, the same
     *    `ease_in_out` easing and the same `crest` falloff - the band maths below
     *    is a literal port of `effort_ignition_styles.rs`;
     *  - Codex's stepper bindings `alt(,)` / `alt(.)` step the focused control.
     *
     * Everything the card needs comes from existing plugins: `slots`, `locale`,
     * `theme`, `sessions` and the `modelDirectories` service owned by
     * `@deepseek-ai/dsh-client-ui-model-selection`. This half owns no durable state
     * beyond the in-flight drag.
     */
    /** Dictionary namespace owned by this plugin. */
    const NS = 'codex-effort';
    /** Injected client services; the card renders once all of them exist. */
    const inject = ['slots', 'locale', 'sessions', 'theme', 'remote', 'remote.session'];
    //#region Codex fidelity constants
    /** Codex's accented tiers: primary accent (dark / light) plus the three ignition hues. */
    const TIERS = {
        max: {
            glyph: '\u203A',
            label: 'MAX',
            accent: [255, 178, 66],
            accentLight: [176, 98, 0],
            hues: [[255, 178, 66], [255, 214, 120], [255, 120, 60]],
        },
        ultra: {
            glyph: '\u00BB',
            label: 'ULTRA',
            accent: [186, 130, 255],
            accentLight: [124, 58, 217],
            hues: [[186, 130, 255], [255, 120, 220], [120, 170, 255]],
        },
    };
    /**
     * The card's track ramp per tier. Codex only publishes the Ultra triple, so the
     * Ultra ramp *is* that triple walked blue -> violet; the Max ramp walks the Max
     * triple warm -> hot; every unaccented level stays cool grey.
     */
    const TRACK_RAMPS = {
        /** Owner's spec (2026-10-06): blue -> violet at the top, solid blue below it. */
        solid: { dark: ['#3B82F6', '#3B82F6'], light: ['#2563EB', '#2563EB'] },
        ultra: { dark: ['#3D6FE8', '#A46BFF'], light: ['#2F6FE0', '#9257F0'] },
        max: { dark: ['#FFD678', '#FF783C'], light: ['#E8A64A', '#B06200'] },
        neutral: { dark: ['#8E92A0', '#C9CBD4'], light: ['#C9C9CF', '#9A9AA4'] },
    };
    /** Ids that mean "no thinking". Rendered dim, with no accent and no glyph. */
    const OFF_EFFORT_IDS = ['off', 'none', 'disabled', 'minimal'];
    /** Starfield inside the track: `[fraction along the track, radius px, opacity]`. */
    const SPARKS = [
        [0.06, 1.1, 0.9],
        [0.15, 0.7, 0.55],
        [0.24, 1.2, 0.85],
        [0.33, 0.8, 0.45],
        [0.42, 0.6, 0.35],
        [0.51, 1.0, 0.6],
        [0.6, 0.7, 0.4],
        [0.69, 0.9, 0.5],
        [0.78, 0.6, 0.3],
        [0.88, 0.8, 0.45],
    ];
    /**
     * One copy of the moving starfield: `SPARKS` thinned 1-in-2 so the field reads as travel
     * rather than shimmer (dots ~52px apart). Each dot is a comet - bright head on the lead side
     * (right, the way the row travels) with a soft tail trailing left, so the eye reads direction.
     * The row renders two identical copies so sliding by one copy loops without a jump.
     */
    function flowDots(keyPrefix) {
        return SPARKS.filter((entry, index) => index % 2 === 0).map((spark, index) => React.createElement('div', {
            key: `${keyPrefix}:${index}`,
            className: 'dshCodexEffort_flowDot',
            style: {
                left: `${(spark[0] * 100).toFixed(1)}%`,
                width: `${(spark[1] * 6).toFixed(1)}px`,
                height: `${(spark[1] * 2).toFixed(1)}px`,
                opacity: Math.min(0.95, 0.46 + spark[2] * 0.54),
            },
        }));
    }
    /**
     * Classify an adapter-owned effort id into a Codex tier.
     * @param effortId - adapter-owned reasoning effort id.
     * @returns the accented tier key, or null for a neutral level.
     */
    function tierOf(effortId) {
        const id = String(effortId === undefined || effortId === null ? '' : effortId).toLowerCase();
        if (id.includes('ultra'))
            return 'ultra';
        if (id.includes('max') || id === 'xhigh' || id === 'extreme')
            return 'max';
        return null;
    }
    /** Ignition style specification: per-tier total duration and band table (launch/speed, travel/phase, strength/hue). */
    const IGNITION = {
        wave: { total: { max: 1000, ultra: 1300 }, bands: { max: [[0.1, 0.75, 1.0]], ultra: [[0.1, 0.7, 1.0], [0.35, 0.55, 1.0]] } },
        aurora: {
            total: { max: 1300, ultra: 1600 },
            bands: { max: [[0.35, 0.15, 0], [-0.5, 0.6, 1]], ultra: [[0.35, 0.15, 0], [-0.5, 0.6, 1], [0.75, 0.35, 2]] },
        },
        pulse: { total: { max: 900, ultra: 1250 }, bands: { max: [[0.1, 0.6, 1.0]], ultra: [[0.1, 0.55, 0.8], [0.45, 0.55, 1.1]] } },
    };
    /** Codex's `IGNITION_FRAME_TICK`: one rendered frame every 33 ms. */
    const FRAME_MS = 33;
    /** Codex's `CHARGE`: how long the prompt glyph takes to reach its accent. */
    const CHARGE_MS = 150;
    /** Codex's `PROMPT_ACCENT_ALPHA`: the glyph never reaches the full accent. */
    const PROMPT_ACCENT_ALPHA = 0.86;
    /** `WAVE_HALF_WIDTH` from effort_ignition_styles.rs, in sampled columns. */
    const WAVE_HALF_WIDTH = 9;
    /** `PULSE_HALF_WIDTH` from effort_ignition_styles.rs, in sampled columns. */
    const PULSE_HALF_WIDTH = 4.5;
    /** Sampled columns per ignition frame; the gradient is rebuilt from these. */
    const IGNITION_COLUMNS = 28;
    /** Ignition style order; a real tier change never repeats the previous style (Codex `IgnitionStyle::random`). */
    const IGNITION_STYLES = ['wave', 'aurora', 'pulse'];
    /** Thumb diameter in px; the track's horizontal inset is half of it. */
    const THUMB_SIZE = 24;
    /** Track height in px. */
    const TRACK_HEIGHT = 30;
    /**
     * `crest` from effort_ignition_styles.rs.
     * @param distance - normalised distance from the band centre.
     * @returns the band weight at that distance.
     */
    function crest(distance) {
        if (distance >= 1)
            return 0;
        return 0.5 * (1 + Math.cos(Math.PI * distance));
    }
    /**
     * `ease_in_out` from effort_ignition_styles.rs.
     * @param progress - normalised progress in 0..1.
     * @returns the eased progress.
     */
    function easeInOut(progress) {
        const p = Math.min(1, Math.max(0, progress));
        if (p < 0.5)
            return 4 * p * p * p;
        const inverse = -2 * p + 2;
        return 1 - (inverse * inverse * inverse) / 2;
    }
    /**
     * `envelope` from effort_ignition_styles.rs (Aurora's fade in/out).
     * @param elapsed - seconds since the animation started.
     * @param total - total animation seconds.
     * @param fadeIn - fade-in seconds.
     * @param fadeOut - fade-out seconds.
     * @returns the envelope weight.
     */
    function envelope(elapsed, total, fadeIn, fadeOut) {
        if (elapsed <= 0 || elapsed >= total)
            return 0;
        const value = Math.min(elapsed / Math.max(fadeIn, Number.EPSILON), (total - elapsed) / Math.max(fadeOut, Number.EPSILON));
        return Math.min(1, Math.max(0, value));
    }
    /**
     * `band_sample` from effort_ignition_styles.rs.
     * @param style - ignition style key.
     * @param band - the band tuple.
     * @param elapsed - seconds since the animation started.
     * @param column - sampled column index.
     * @param width - sampled column count.
     * @returns `[hueIndex, strength]`.
     */
    function bandSample(style, band, elapsed, column, width) {
        const first = band[0];
        const second = band[1];
        const third = band[2];
        if (style === 'wave') {
            const progress = (elapsed - first) / second;
            if (!(progress >= 0 && progress <= 1))
                return [0, 0];
            const center = easeInOut(progress) * (width + 2 * WAVE_HALF_WIDTH) - WAVE_HALF_WIDTH;
            return [0, crest(Math.abs(column - center) / WAVE_HALF_WIDTH)];
        }
        if (style === 'aurora') {
            const center = (0.5 + 0.38 * Math.sin(2 * Math.PI * (first * elapsed + second))) * width;
            const halfWidth = Math.max(width * 0.22, 4);
            return [third, crest(Math.abs(column - center) / halfWidth)];
        }
        const progress = (elapsed - first) / second;
        if (!(progress >= 0 && progress <= 1))
            return [0, 0];
        const inverse = 1 - progress;
        const radius = (1 - inverse * inverse * inverse) * (width / 2 + 2 * PULSE_HALF_WIDTH);
        const distance = Math.abs(column - width / 2);
        return [0, crest(Math.abs(distance - radius) / PULSE_HALF_WIDTH) * third * (1 - 0.6 * progress)];
    }
    /**
     * Repaint one ignition frame as a CSS gradient - the web counterpart of
     * `paint_bands` + `Canvas::tint_column`.
     * @param style - ignition style key.
     * @param tier - accented tier key (`max` | `ultra`).
     * @param elapsedMs - milliseconds since the animation started.
     * @returns a `linear-gradient(...)` value, or null when nothing is lit.
     */
    function ignitionGradient(style, tier, elapsedMs) {
        const spec = IGNITION[style];
        const totalSeconds = spec.total[tier] / 1000;
        const elapsed = elapsedMs / 1000;
        const hues = TIERS[tier].hues;
        const bands = spec.bands[tier];
        const fade = style === 'aurora' ? envelope(elapsed, totalSeconds, 0.25, 0.4) : 1;
        const stops = [];
        let lit = false;
        for (let column = 0; column < IGNITION_COLUMNS; column += 1) {
            const weights = [0, 0, 0];
            for (const band of bands) {
                const sample = bandSample(style, band, elapsed, column, IGNITION_COLUMNS);
                if (style === 'aurora')
                    weights[sample[0]] += sample[1];
                else
                    weights[sample[0]] = Math.max(weights[sample[0]], sample[1]);
            }
            const weight = weights[0] + weights[1] + weights[2];
            const position = (((column + 0.5) / IGNITION_COLUMNS) * 100).toFixed(2);
            if (weight <= 0.01) {
                stops.push(`rgba(0, 0, 0, 0) ${position}%`);
                continue;
            }
            lit = true;
            let red = 0;
            let green = 0;
            let blue = 0;
            for (let index = 0; index < 3; index += 1) {
                red += weights[index] * hues[index][0];
                green += weights[index] * hues[index][1];
                blue += weights[index] * hues[index][2];
            }
            const alpha = style === 'aurora' ? Math.min(weight * 0.4, 0.5) * fade : weight * 0.55;
            stops.push(`rgba(${Math.round(red / weight)}, ${Math.round(green / weight)}, ${Math.round(blue / weight)}, ${alpha.toFixed(3)}) ${position}%`);
        }
        return lit ? `linear-gradient(90deg, ${stops.join(', ')})` : null;
    }
    //#endregion
    //#region Pure selection helpers
    /**
     * Resolve the reasoning metadata for the session's effective selection.
     * @param state - the shared model directory snapshot.
     * @returns `{current, model, reasoning, efforts}`, all possibly null/empty.
     */
    function modelFacts(state) {
        const current = state === undefined || state === null ? null : state.current;
        if (current === null || current === undefined)
            return { current: null, model: null, reasoning: null, efforts: [] };
        const groups = state.groups === undefined ? [] : state.groups;
        for (const group of groups) {
            if (group.id !== current.provider)
                continue;
            for (const model of group.models) {
                if (model.id !== current.model)
                    continue;
                const reasoning = model.reasoning === undefined || model.reasoning === null ? null : model.reasoning;
                const efforts = reasoning === null || reasoning.efforts === undefined ? [] : reasoning.efforts;
                return { current, model, reasoning, efforts };
            }
        }
        return { current, model: null, reasoning: null, efforts: [] };
    }
    /**
     * The level a session is actually on: the durable selection, else the model's default.
     * @param current - the session's effective selection, or null.
     * @param reasoning - the active model's reasoning metadata, or null.
     * @returns the effective effort id, or null when the adapter names no level.
     */
    function effectiveEffortId(current, reasoning) {
        if (current !== null && current !== undefined && current.reasoningEffort !== undefined)
            return current.reasoningEffort;
        if (reasoning === null || reasoning === undefined || reasoning.defaultEffort === undefined)
            return null;
        return reasoning.defaultEffort;
    }
    /**
     * Fractional thumb position for a discrete index.
     * @param index - active index.
     * @param count - number of stops.
     * @returns a unitless fraction in 0..1.
     */
    function fractionOf(index, count) {
        if (count <= 1)
            return 0;
        const clamped = Math.min(count - 1, Math.max(0, index));
        return clamped / (count - 1);
    }
    /**
     * Nearest stop for a pointer offset.
     * @param clientX - pointer x in viewport coordinates.
     * @param rect - the track's bounding client rect.
     * @param count - number of stops.
     * @param inset - horizontal inset of the usable span, in px.
     * @returns the snapped index.
     */
    function indexAt(clientX, rect, count, inset) {
        if (count <= 1)
            return 0;
        const pad = Math.min(inset === undefined ? THUMB_SIZE / 2 : inset, rect.width / 2);
        const usable = Math.max(1, rect.width - pad * 2);
        const ratio = (clientX - rect.left - pad) / usable;
        const raw = Math.round(ratio * (count - 1));
        return Math.min(count - 1, Math.max(0, raw));
    }
    /**
     * The complete `ModelSelection` a level writes.
     * @param current - the session's effective selection.
     * @param effort - the chosen level.
     * @returns the selection to submit, or null when there is no model to keep.
     */
    function selectionFor(current, effort) {
        if (current === null || current === undefined)
            return null;
        return {
            provider: current.provider,
            model: current.model,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
        };
    }
    /**
     * Blend two rgb triples the way Codex's `blend` does.
     * @param from - source triple.
     * @param to - target triple.
     * @param amount - 0..1 mix towards `to`.
     * @returns the mixed triple.
     */
    function blend(from, to, amount) {
        const t = Math.min(1, Math.max(0, amount));
        return [
            Math.round(from[0] + (to[0] - from[0]) * t),
            Math.round(from[1] + (to[1] - from[1]) * t),
            Math.round(from[2] + (to[2] - from[2]) * t),
        ];
    }
    /**
     * A tier's accent triple for the active colour scheme (Codex `accent_rgb`).
     * @param tier - accented tier key.
     * @param colorScheme - `light` or `dark`.
     * @returns the rgb triple.
     */
    function accentTuple(tier, colorScheme) {
        return colorScheme === 'light' ? TIERS[tier].accentLight : TIERS[tier].accent;
    }
    /**
     * The accent value for one level.
     * @param effort - the active advertised level, or null.
     * @param colorScheme - `light` or `dark`.
     * @returns a CSS colour (a literal `rgb(...)`, or a theme token for neutral levels).
     */
    function accentFor(effort, colorScheme) {
        if (effort === null || effort === undefined)
            return 'var(--dsw-alias-label-primary)';
        const tier = tierOf(effort.id);
        if (tier !== null)
            return `rgb(${accentTuple(tier, colorScheme).join(', ')})`;
        if (OFF_EFFORT_IDS.includes(String(effort.id).toLowerCase()))
            return 'var(--dsw-alias-label-secondary)';
        return 'var(--dsw-alias-label-primary)';
    }
    /**
     * The track's fill ramp for one level.
     * @param effort - the active advertised level, or null.
     * @param colorScheme - `light` or `dark`.
     * @returns a CSS `linear-gradient(...)` value.
     */
    function trackGradient(effort, colorScheme) {
        const tier = effort === null ? null : tierOf(effort.id);
        // Unaccented levels keep the owner's solid blue; the accented top tier gets the blue -> violet run.
        const ramp = TRACK_RAMPS[tier === null ? 'solid' : 'ultra'][colorScheme === 'light' ? 'light' : 'dark'];
        return `linear-gradient(90deg, ${ramp[0]} 0%, ${ramp[1]} 100%)`;
    }
    //#endregion
    //#region Styles
    const STYLE_ID = 'dsh-codex-effort-slider';
    const CSS = `
.dshCodexEffort{position:relative;margin-left:auto;--dsh-codex-effort-accent:var(--dsw-alias-label-primary);width:100%;max-width:344px;display:flex;flex-direction:column;gap:10px;padding:14px 16px 12px;border-radius:18px;background:var(--dsh-codex-effort-card,#212124);border:1px solid var(--dsh-codex-effort-card-line,rgba(255,255,255,.08));box-shadow:0 8px 24px rgba(0,0,0,.34),0 1px 0 rgba(255,255,255,.05) inset;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;user-select:none;-webkit-user-select:none;box-sizing:border-box}
/* owner's ask (2026-10-07): park the card on the RIGHT of the composer dock, not the left edge.
   Target the dock's direct child that holds the card, so it survives whatever wrapper the slot adds. */
[data-slot="conversation.input.dock"] > *:has(.dshCodexEffort){margin-left:auto}
/* The card is not part of the composer until asked for: the official model + reasoning seat
   in the input row is the switch. Nothing is shown until that seat is pressed. */
.dshCodexEffort:not([data-open="true"]){display:none}
.dshCodexEffort[data-disabled="true"]{opacity:.5;pointer-events:none}
.dshCodexEffort_mark{display:flex;align-items:center;justify-content:space-between;height:16px;color:var(--dsh-codex-effort-accent)}
.dshCodexEffort_markIcon{display:block;flex:none;filter:drop-shadow(0 0 6px color-mix(in srgb,var(--dsh-codex-effort-accent) 55%,transparent))}
.dshCodexEffort_head{display:flex;flex-direction:column;align-items:center;text-align:center;gap:1px}
.dshCodexEffort_title{display:inline-flex;align-items:center;gap:3px;font-size:15px;font-weight:600;line-height:22px;letter-spacing:.2px;color:var(--dsh-codex-effort-accent)}
.dshCodexEffort_glyph{font-weight:700;font-size:15px;line-height:1;transition:color .15s ease}
.dshCodexEffort_model{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dshCodexEffort_modelBtn{display:inline-flex;align-items:center;gap:4px;margin:0;padding:1px 6px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.dshCodexEffort_modelBtn:hover{background:rgba(255,255,255,.07)}
.dshCodexEffort_modelCaret{font-size:10px;line-height:1;opacity:.7}
.dshCodexEffort_modelWrap{position:relative;display:inline-flex;flex-direction:column;align-items:center;max-width:100%}
.dshCodexEffort_picker{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:5;min-width:190px;max-width:min(300px,78vw);max-height:min(320px,55vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px;padding:5px;border-radius:12px;background:var(--dsh-codex-effort-card,#212124);border:1px solid var(--dsh-codex-effort-card-line,rgba(255,255,255,.12));box-shadow:0 14px 34px rgba(0,0,0,.45)}
.dshCodexEffort_pick{display:block;width:100%;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.dshCodexEffort_pick:hover{background:rgba(255,255,255,.09)}
.dshCodexEffort_pick.is-on{color:var(--dsh-codex-effort-accent);font-weight:600}
.dshCodexEffort_flow{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .45s ease;contain:paint}
.dshCodexEffort_flowRow{position:absolute;top:0;left:0;height:100%;width:200%;will-change:transform;transform:translate3d(0,0,0);animation:dshCodexEffortFlow 6.5s linear infinite}
.dshCodexEffort_flowHalf{position:absolute;top:0;left:0;height:100%;width:50%}
.dshCodexEffort_flowHalf.is-b{left:50%}
.dshCodexEffort_flowDot{position:absolute;top:50%;border-radius:999px;background:radial-gradient(circle at 90% 50%,rgba(255,255,255,.95) 0 34%,rgba(255,255,255,0) 72%),linear-gradient(270deg,rgba(255,255,255,.8) 0%,rgba(255,255,255,.34) 45%,rgba(255,255,255,0) 100%);transform:translate(-50%,-50%)}
/* The starfield is drawn twice side by side and slid by exactly one copy, so the loop never jumps:
   the whole track is one conveyor - the dots travel right, toward the thumb, they do not blink in place.
   Transform only, so it rides the compositor instead of repainting the track every frame. */
@keyframes dshCodexEffortFlow{from{transform:translate3d(-50%,0,0)}to{transform:translate3d(0,0,0)}}
.dshCodexEffort[data-tier="max"] .dshCodexEffort_flow,.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_flow{opacity:1}
/* (the first pass hid the model seat; it is visible again and now opens the card) */
.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_trackBed::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(100deg,rgba(255,255,255,0) 18%,rgba(255,255,255,.9) 46%,rgba(255,255,255,0) 72%);transform:translateX(-130%);animation:dshCodexEffortSweep .9s cubic-bezier(.25,.9,.3,1) 1 forwards}
@keyframes dshCodexEffortSweep{to{transform:translateX(130%)}}
.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_thumb{box-shadow:0 2px 6px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.06),0 0 16px 4px rgba(186,130,255,.6);animation:dshCodexEffortThumbPop .66s cubic-bezier(.18,1.6,.36,1) 1}
@keyframes dshCodexEffortThumbPop{0%{transform:scale(1)}32%{transform:scale(1.45)}70%{transform:scale(.97)}100%{transform:scale(1)}}
.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_thumb::after{content:'';position:absolute;inset:-3px;border-radius:50%;pointer-events:none;border:2px solid rgba(205,160,255,.9);animation:dshCodexEffortRing .95s ease-out 1 forwards}
@keyframes dshCodexEffortRing{0%{transform:scale(.55);opacity:.95}70%{opacity:.35}100%{transform:scale(3);opacity:0}}
.dshCodexEffort[data-tier="ultra"]{animation:dshCodexEffortCardGlow 2.6s ease-in-out infinite}
@keyframes dshCodexEffortCardGlow{0%,100%{box-shadow:0 8px 24px rgba(0,0,0,.34),0 0 0 rgba(170,120,255,0)}50%{box-shadow:0 8px 24px rgba(0,0,0,.34),0 0 30px rgba(170,120,255,.34)}}
/* each flow dot carries its own soft glow, so the moving layer never runs a per-frame filter */
.dshCodexEffort_rail{position:relative;display:flex;align-items:center;gap:10px}
.dshCodexEffort_track{position:relative;flex:1 1 auto;height:${THUMB_SIZE}px;cursor:pointer;touch-action:none;outline:none}
.dshCodexEffort_track:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-codex-effort-accent) 60%,transparent);border-radius:${TRACK_HEIGHT / 2 + 6}px}
.dshCodexEffort_trackBed{position:absolute;left:0;right:0;top:50%;height:${TRACK_HEIGHT}px;transform:translateY(-50%);border-radius:${TRACK_HEIGHT / 2}px;background:var(--dsh-codex-effort-bed,rgba(255,255,255,.12));overflow:hidden}
.dshCodexEffort_fill{position:absolute;left:0;top:0;bottom:0;width:calc(var(--dsh-codex-effort-p,0) * 100% + ${THUMB_SIZE / 2}px);border-radius:${TRACK_HEIGHT / 2}px;background:var(--dsh-codex-effort-ramp);transition:width .1s linear}
.dshCodexEffort[data-tier="max"] .dshCodexEffort_fill::after,.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_fill::after{opacity:1}
/* (the old in-place twinkling sparks are gone - the dots now travel) */
.dshCodexEffort_ignition{position:absolute;left:0;right:0;top:50%;height:${TRACK_HEIGHT + 4}px;transform:translateY(-50%);border-radius:${(TRACK_HEIGHT + 4) / 2}px;opacity:0;pointer-events:none;will-change:background,opacity;mix-blend-mode:screen}
.dshCodexEffort_thumb{position:absolute;top:50%;left:calc(var(--dsh-codex-effort-p,0) * (100% - ${THUMB_SIZE}px) + ${THUMB_SIZE / 2}px);width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;margin:-${THUMB_SIZE / 2}px 0 0 -${THUMB_SIZE / 2}px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.06);transition:left .1s linear,transform .12s ease}
.dshCodexEffort_track:hover .dshCodexEffort_thumb{transform:scale(1.06)}
.dshCodexEffort_track[data-drag="true"] .dshCodexEffort_thumb{transform:scale(1.1);box-shadow:0 3px 10px rgba(0,0,0,.5),0 0 0 5px color-mix(in srgb,var(--dsh-codex-effort-accent) 20%,transparent)}
.dshCodexEffort_track[data-error="true"] .dshCodexEffort_trackBed{background:var(--dsw-alias-state-error-primary)}
.dshCodexEffort_ring{flex:none;width:16px;height:16px;color:var(--dsh-codex-effort-accent);opacity:.75}
.dshCodexEffort[data-busy="true"] .dshCodexEffort_ring{opacity:1;animation:dshCodexEffortSpin 1s linear infinite}
@keyframes dshCodexEffortSpin{to{transform:rotate(360deg)}}
`;
    /** Inject the plugin stylesheet once per document (the module loader's own idempotence is per materialization). */
    function ensureStyles() {
        if (typeof document === 'undefined')
            return;
        if (document.querySelector(`style[data-plugin-css=${JSON.stringify(`${STYLE_ID}/client.css`)}]`) !== null)
            return;
        const tag = document.createElement('style');
        tag.dataset.plugin = STYLE_ID;
        tag.dataset.pluginCss = `${STYLE_ID}/client.css`;
        tag.textContent = CSS;
        document.head.appendChild(tag);
    }
    //#endregion
    //#region Component
    /**
     * Subscribe to a snapshot store without assuming React 18's `useSyncExternalStore` shims.
     * @param store - a store exposing `subscribe` + `getSnapshot`.
     * @returns the current snapshot.
     */
    function useStore(store) {
        const subscribe = React.useCallback((listener) => store.subscribe(listener), [store]);
        const getSnapshot = React.useCallback(() => store.getSnapshot(), [store]);
        return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }
    /** The card's lightning mark (Codex's spark, drawn as a bolt with a soft glow). */
    function MarkIcon() {
        return React.createElement('svg', {
            className: 'dshCodexEffort_markIcon',
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            'aria-hidden': true,
        }, React.createElement('path', {
            d: 'M9.1 1.2 3.4 8.6c-.3.4 0 .9.4.9H7l-.9 5.3c-.1.5.6.8.9.4l5.7-7.4c.3-.4 0-.9-.4-.9H9l.9-5.3c.1-.5-.6-.8-.8-.4Z',
            fill: 'currentColor',
        }));
    }
    /** The right-hand status ring; it spins while a selection is in flight. */
    function StatusRing() {
        return React.createElement('svg', {
            className: 'dshCodexEffort_ring',
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            'aria-hidden': true,
        }, React.createElement('circle', {
            cx: 8,
            cy: 8,
            r: 6,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeDasharray: '28 10',
            opacity: 0.9,
        }));
    }
    /**
     * Render the Codex-style reasoning-effort card.
     * @param props - the injected directory face, the theme mode store and the translator.
     * @returns the card, or null while the active model advertises no levels.
     */
    function EffortCard(props) {
        const directory = props.directory;
        const mode = props.mode;
        const translate = props.t;
        const state = useStore(directory);
        const colorScheme = useStore(mode);
        const facts = modelFacts(state);
        const efforts = facts.efforts;
        const current = facts.current;
        const loadRef = React.useRef(false);
        React.useEffect(() => {
            if (loadRef.current)
                return;
            loadRef.current = true;
            props.load();
        }, [props]);
        const [dragIndex, setDragIndex] = React.useState(null);
        const [pickOpen, setPickOpen] = React.useState(false);
        /** Every model the catalog offers for this session (owner's ask: pick it right here). */
        const modelChoices = React.useMemo(() => {
            const groups = state !== null && state !== undefined && Array.isArray(state.groups) ? state.groups : [];
            return groups.flatMap((group) => (group.models || []).map((model) => ({
                provider: group.id,
                model: model.id,
                name: model.name || model.id,
                reasoning: model.reasoning,
            })));
        }, [state]);
        const isChosen = (choice) => state !== null && state !== undefined && state.current !== null && state.current !== undefined &&
            state.current.provider === choice.provider && state.current.model === choice.model;
        const chooseModel = (choice) => {
            const selection = { provider: choice.provider, model: choice.model };
            if (choice.reasoning !== undefined && choice.reasoning !== null && choice.reasoning.defaultEffort !== undefined) {
                selection.reasoningEffort = choice.reasoning.defaultEffort;
            }
            setPickOpen(false);
            try {
                props.select(selection);
            }
            catch { /* the seat reports failures itself */ }
        };
        const [pendingIndex, setPendingIndex] = React.useState(null);
        const [failed, setFailed] = React.useState(false);
        const [busy, setBusy] = React.useState(false);
        const trackRef = React.useRef(null);
        const ignitionRef = React.useRef(null);
        const storeIndex = React.useMemo(() => {
            if (efforts.length === 0)
                return -1;
            const id = effectiveEffortId(current, facts.reasoning);
            if (id === null)
                return -1;
            return efforts.findIndex((effort) => effort.id === id);
        }, [efforts, current, facts.reasoning]);
        React.useEffect(() => {
            if (pendingIndex !== null && storeIndex === pendingIndex)
                setPendingIndex(null);
        }, [pendingIndex, storeIndex]);
        // Codex's ignition: one-shot, random style that never repeats, 33 ms frames.
        const ignition = React.useRef({ timer: null, style: null, start: 0, tier: null });
        const stopIgnition = React.useCallback(() => {
            const live = ignition.current;
            if (live.timer !== null)
                clearTimeout(live.timer);
            live.timer = null;
            if (ignitionRef.current !== null) {
                ignitionRef.current.style.opacity = '0';
                ignitionRef.current.style.background = 'none';
            }
        }, []);
        React.useEffect(() => stopIgnition, [stopIgnition]);
        const playIgnition = React.useCallback((tier) => {
            if (typeof window === 'undefined')
                return;
            stopIgnition();
            const live = ignition.current;
            const options = IGNITION_STYLES.filter((style) => style !== live.style);
            const style = options[Math.floor(Math.random() * options.length)];
            live.style = style;
            live.start = window.performance === undefined ? Date.now() : window.performance.now();
            const total = IGNITION[style].total[tier];
            const paint = () => {
                const node = ignitionRef.current;
                const now = window.performance === undefined ? Date.now() : window.performance.now();
                const elapsed = now - live.start;
                if (node === null || elapsed >= total) {
                    stopIgnition();
                    return;
                }
                const gradient = ignitionGradient(style, tier, elapsed);
                node.style.background = gradient === null ? 'none' : gradient;
                node.style.opacity = gradient === null ? '0' : '1';
                live.timer = window.setTimeout(paint, FRAME_MS);
            };
            paint();
        }, [stopIgnition]);
        const activeIndex = dragIndex !== null ? dragIndex : pendingIndex !== null ? pendingIndex : storeIndex;
        const activeEffort = activeIndex >= 0 && activeIndex < efforts.length ? efforts[activeIndex] : null;
        // Owner's spec (2026-10-06): accent whatever the model's TOP level is. Codex names only max/ultra,
        // so a ladder that ends at xhigh (or anything else) must still get the violet run - hence position,
        // not id. This is what makes the card adapt to every model's own effort list.
        const isTopLevel = activeIndex >= 0 && efforts.length > 0 && activeIndex === efforts.length - 1;
        const activeTier = activeEffort === null ? null : (isTopLevel ? 'ultra' : tierOf(activeEffort.id));
        const accent = React.useMemo(() => accentFor(activeEffort, colorScheme), [activeEffort, colorScheme]);
        const ramp = React.useMemo(() => trackGradient(activeEffort, colorScheme), [activeEffort, colorScheme]);
        const commit = React.useCallback((index) => {
            if (index < 0 || index >= efforts.length)
                return;
            const effort = efforts[index];
            if (current === null || current === undefined)
                return;
            if (index === storeIndex)
                return;
            const selection = selectionFor(current, effort.id);
            if (selection === null)
                return;
            setPendingIndex(index);
            setFailed(false);
            setBusy(true);
            const tier = tierOf(effort.id);
            if (tier !== null)
                playIgnition(tier);
            Promise.resolve(props.select(selection)).then((ok) => {
                setBusy(false);
                if (ok === false) {
                    setPendingIndex(null);
                    setFailed(true);
                    window.setTimeout(() => setFailed(false), 1200);
                }
            }, () => {
                setBusy(false);
                setPendingIndex(null);
                setFailed(true);
                window.setTimeout(() => setFailed(false), 1200);
            });
        }, [efforts, current, storeIndex, props, playIgnition]);
        const indexFromEvent = React.useCallback((event) => {
            const node = trackRef.current;
            if (node === null)
                return activeIndex < 0 ? 0 : activeIndex;
            return indexAt(event.clientX, node.getBoundingClientRect(), efforts.length, THUMB_SIZE / 2);
        }, [efforts.length, activeIndex]);
        const onPointerDown = React.useCallback((event) => {
            if (event.button !== 0 && event.pointerType === 'mouse')
                return;
            event.preventDefault();
            const node = trackRef.current;
            if (node === null)
                return;
            try {
                node.setPointerCapture(event.pointerId);
            }
            catch {
                /* capture is best-effort; dragging still works without it */
            }
            setDragIndex(indexFromEvent(event));
        }, [indexFromEvent]);
        const onPointerMove = React.useCallback((event) => {
            if (dragIndex === null)
                return;
            const next = indexFromEvent(event);
            if (next !== dragIndex)
                setDragIndex(next);
        }, [dragIndex, indexFromEvent]);
        const onPointerUp = React.useCallback((event) => {
            if (dragIndex === null)
                return;
            const target = indexFromEvent(event);
            const node = trackRef.current;
            if (node !== null) {
                try {
                    node.releasePointerCapture(event.pointerId);
                }
                catch {
                    /* the pointer may already be released */
                }
            }
            setDragIndex(null);
            commit(target);
        }, [dragIndex, indexFromEvent, commit]);
        const onKeyDown = React.useCallback((event) => {
            const key = event.key;
            const last = efforts.length - 1;
            const base = activeIndex < 0 ? 0 : activeIndex;
            let next = null;
            if (key === 'ArrowRight' || key === 'ArrowUp')
                next = Math.min(last, base + 1);
            else if (key === 'ArrowLeft' || key === 'ArrowDown')
                next = Math.max(0, base - 1);
            else if (key === 'Home')
                next = 0;
            else if (key === 'End')
                next = last;
            else if (key === 'PageUp')
                next = Math.min(last, base + 2);
            else if (key === 'PageDown')
                next = Math.max(0, base - 2);
            // Codex's own bindings: increase_reasoning_effort = alt('.'), decrease = alt(',').
            else if (event.altKey && key === '.')
                next = Math.min(last, base + 1);
            else if (event.altKey && key === ',')
                next = Math.max(0, base - 1);
            if (next === null)
                return;
            event.preventDefault();
            commit(next);
        }, [efforts.length, activeIndex, commit]);
        if (!props.available || efforts.length === 0)
            return null;
        const fraction = fractionOf(activeIndex < 0 ? 0 : activeIndex, efforts.length);
        const valueLabel = activeEffort === null ? translate('value.default') : activeEffort.name;
        const modelLabel = facts.model !== null && facts.model.name !== undefined
            ? facts.model.name
            : current === null ? '' : current.model;
        const track = React.createElement('div', {
            ref: trackRef,
            className: 'dshCodexEffort_track',
            role: 'slider',
            tabIndex: 0,
            'aria-label': translate('aria.label'),
            'aria-valuemin': 0,
            'aria-valuemax': Math.max(0, efforts.length - 1),
            'aria-valuenow': activeIndex < 0 ? 0 : activeIndex,
            'aria-valuetext': valueLabel,
            title: activeEffort === null || activeEffort.description === undefined
                ? translate('tip.drag')
                : `${valueLabel} - ${activeEffort.description} (${translate('tip.drag')})`,
            'data-drag': dragIndex !== null ? 'true' : 'false',
            'data-error': failed ? 'true' : 'false',
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onKeyDown,
            style: { '--dsh-codex-effort-p': String(fraction) },
        }, React.createElement('div', { className: 'dshCodexEffort_trackBed' }, React.createElement('div', { className: 'dshCodexEffort_fill' }), React.createElement('div', { className: 'dshCodexEffort_flow' }, React.createElement('div', { className: 'dshCodexEffort_flowRow' }, React.createElement('div', { className: 'dshCodexEffort_flowHalf' }, ...flowDots('a')), React.createElement('div', { className: 'dshCodexEffort_flowHalf is-b' }, ...flowDots('b'))))), React.createElement('div', { ref: ignitionRef, className: 'dshCodexEffort_ignition' }), React.createElement('div', { className: 'dshCodexEffort_thumb' }));
        return React.createElement('div', {
            className: 'dshCodexEffort',
            'data-tier': activeTier === null ? 'neutral' : activeTier,
            'data-disabled': failed ? 'true' : 'false',
            'data-busy': busy ? 'true' : 'false',
            style: {
                '--dsh-codex-effort-accent': accent,
                '--dsh-codex-effort-ramp': ramp,
                '--dsh-codex-effort-card': colorScheme === 'light' ? '#FFFFFF' : '#212124',
                '--dsh-codex-effort-card-line': colorScheme === 'light' ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.08)',
                '--dsh-codex-effort-bed': colorScheme === 'light' ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.1)',
            },
        }, React.createElement('div', { className: 'dshCodexEffort_mark' }, React.createElement(MarkIcon)), React.createElement('div', { className: 'dshCodexEffort_head' }, React.createElement('span', { className: 'dshCodexEffort_title' }, valueLabel, activeTier === null ? null : React.createElement('span', {
            className: 'dshCodexEffort_glyph',
            style: { color: `rgba(${accentTuple(activeTier, colorScheme).join(', ')}, ${PROMPT_ACCENT_ALPHA})` },
            'aria-hidden': true,
        }, TIERS[activeTier].glyph)), modelLabel === '' ? null : React.createElement('div', { className: 'dshCodexEffort_modelWrap' }, React.createElement('button', {
            type: 'button',
            className: 'dshCodexEffort_modelBtn',
            title: translate('tip.model'),
            onClick: (event) => { event.preventDefault(); event.stopPropagation(); setPickOpen((open) => !open); },
        }, React.createElement('span', { className: 'dshCodexEffort_model' }, modelLabel), React.createElement('span', { className: 'dshCodexEffort_modelCaret' }, '\u25be')), pickOpen && modelChoices.length > 0 ? React.createElement('div', { className: 'dshCodexEffort_picker' }, modelChoices.map((choice) => React.createElement('button', {
            key: `${choice.provider}:${choice.model}`,
            type: 'button',
            className: 'dshCodexEffort_pick' + (isChosen(choice) ? ' is-on' : ''),
            onClick: (event) => { event.preventDefault(); event.stopPropagation(); chooseModel(choice); },
        }, choice.name))) : null)), React.createElement('div', { className: 'dshCodexEffort_rail' }, track, React.createElement(StatusRing)));
    }
    //#endregion
    //#region Plugin
    /**
     * Compose the card's theme-mode store: a stable primitive snapshot plus the
     * `theme/change` event as its notification source.
     * @param ctx - the client root context.
     * @returns `{getSnapshot, subscribe}`.
     */
    function createModeStore(ctx) {
        const listeners = new Set();
        ctx.effect(() => ctx.on('theme/change', () => {
            for (const listener of [...listeners])
                listener();
        }), 'codex-effort-slider: theme/change');
        return {
            getSnapshot: () => {
                try {
                    const snapshot = ctx.theme.getTheme();
                    return snapshot !== undefined && snapshot.active !== undefined ? snapshot.active.colorScheme : 'dark';
                }
                catch {
                    return 'dark';
                }
            },
            subscribe: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        };
    }
    /**
     * Client plugin body: register this plugin's dictionaries, then occupy the
     * composer's ambient dock below the composer card with the effort card.
     * @param ctx - client root context.
     * @returns nothing.
     */
    function apply(ctx) {
        ensureStyles();
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codex-effort-slider: dictionaries');
        const t = ctx.locale.bind(NS);
        const mode = createModeStore(ctx);
        // Owner's ask (2026-10-07, second pass): the card must NOT sit in the composer all the time.
        // The official model + reasoning seat stays visible and acts as the switch: pressing it opens
        // the card; pressing outside, Escape, or the seat again closes it.
        ctx.effect(() => {
            const card = () => document.querySelector('.dshCodexEffort');
            const isOpen = () => { const el = card(); return el !== null && el.getAttribute('data-open') === 'true'; };
            const setOpen = (open) => { const el = card(); if (el !== null)
                el.setAttribute('data-open', open ? 'true' : 'false'); };
            const wired = new WeakSet();
            const wire = () => {
                const seats = document.querySelectorAll('[data-slot="conversation.input.model"]');
                for (const seat of seats) {
                    // undo the first pass, which hid the seat
                    seat.classList.remove('dshCodexEffort_seatHidden');
                    delete seat.dataset.dshEffortReplaced;
                    if (wired.has(seat))
                        continue;
                    wired.add(seat);
                    seat.addEventListener('click', (event) => {
                        // keep the official menu from opening as well: React listens at the root, so stopping
                        // propagation on the seat is enough.
                        event.preventDefault();
                        event.stopPropagation();
                        setOpen(!isOpen());
                    });
                }
            };
            wire();
            const observer = new MutationObserver(() => wire());
            observer.observe(document.body, { childList: true, subtree: true });
            const onDocumentClick = (event) => {
                if (!isOpen())
                    return;
                const el = card();
                if (el !== null && event.target instanceof Node && el.contains(event.target))
                    return;
                if (event.target instanceof Element && event.target.closest('[data-slot="conversation.input.model"]') !== null)
                    return;
                setOpen(false);
            };
            const onKeyDown = (event) => { if (event.key === 'Escape')
                setOpen(false); };
            document.addEventListener('click', onDocumentClick, true);
            document.addEventListener('keydown', onKeyDown);
            return () => {
                observer.disconnect();
                document.removeEventListener('click', onDocumentClick, true);
                document.removeEventListener('keydown', onKeyDown);
            };
        }, 'codex-effort-slider: the seat opens the card');
        ctx.inject(['slots', 'modelDirectories'], (scope) => {
            const models = scope.modelDirectories;
            const sessions = scope.sessions;
            scope.slots.inject('conversation.input.dock', () => scope.slots.register({
                name: 'conversation.input.dock',
                id: 'codex-effort-slider',
                order: 10,
                locale: NS,
                inject: (sessionId) => {
                    // Resolve the model directory lazily: it is owned by another client plugin, and gating the
                    // whole registration on it meant this card silently never appeared.
                    // directoryFor() runs loud on an unknown session, so keep it guarded.
                    let directory = null;
                    try {
                        directory = models.directoryFor(sessionId);
                    }
                    catch {
                        directory = null;
                    }
                    if (!directory)
                        return { available: false, directory: { getSnapshot: () => null, subscribe: () => () => { } }, mode, load: () => { }, select: () => Promise.resolve(false) };
                    const available = sessions.subagentAddress(sessionId) === undefined;
                    return {
                        available,
                        directory: directory.store,
                        mode,
                        load: () => {
                            if (available)
                                directory.load().catch(() => { });
                        },
                        select: (selection) => (available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false)),
                    };
                },
            }, (props) => EffortCard({ ...props, t })));
        });
    }
    /** Localized copy owned by this plugin. */
    const zh = {
        label: '\u63a8\u7406\u5f3a\u5ea6',
        'aria.label': '\u63a8\u7406\u5f3a\u5ea6',
        'tip.drag': '\u62d6\u52a8\u8c03\u6574\uff1b\u2325. \u63d0\u9ad8\u3001\u2325, \u964d\u4f4e',
        'tip.model': '\u9009\u62e9\u6a21\u578b',
        'value.default': '\u9ed8\u8ba4',
    };
    const en = {
        label: 'Reasoning',
        'aria.label': 'Reasoning effort',
        'tip.drag': 'drag, \u2325. up, \u2325, down',
        'tip.model': 'choose model',
        'value.default': 'Default',
    };
    //#endregion
    // Mirror the old plugin's activation: wait for its services, then run apply() on that scope.
    ctx.inject(inject, (scope) => apply(scope));
}


		return module.exports;
	}
});
