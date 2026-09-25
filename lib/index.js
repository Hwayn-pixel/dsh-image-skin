/// <reference types="node" />
/**
 * dsh-image-skin — Host half.
 *
 * Registers the durable `ui-image-skin` settings namespace and owns the image
 * upload / storage / serve routes under `/dsh-image-skin`. Uploaded images live
 * as files in `$DSH_HOME/image-skin/`; the settings document stores only the
 * returned URL (never the multi-MB payload).
 *
 * Storage hygiene: uploads are size-capped, and `POST /gc` deletes stored files
 * that no area references any more (the client calls it after every image
 * change, and the settings page exposes it as an explicit button).
 */
import z from "@deepseek-ai/schemastery";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
export const name = "dsh-image-skin";
export const SETTINGS_NAMESPACE = "ui-image-skin";
/** Largest accepted upload body (the base64 JSON envelope), i.e. ~24 MB of file. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
/** Never collect a file younger than this: an in-flight upload may not be committed yet. */
export const GC_MIN_AGE_MS = 60 * 1000;
/** Large UI regions this skin can decorate. Add an id here (+ client AREAS) to extend. */
export const IMAGE_AREAS = ["window", "center", "sidebar", "welcome", "rightbar", "composer", "stickerComposer", "stickerSidebar"];
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
function settingsNamespace(value) {
    if (!NAMESPACE_PATTERN.test(value)) {
        throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
    }
    return value;
}
// Data-driven schema: a couple of globals plus a handful of fields per area.
// Every area carries a *shared* image plus two optional per-mode overrides
// (light / dark). Resolution order is `<area>Image<Mode>` then `<area>Image`, so a
// stored config written before per-mode support existed keeps working unchanged.
const shape = {
    enabled: z.boolean().default(true).description("总开关：关闭后所有图片皮肤失效"),
    panelOpacity: z.number().min(0).max(100).default(85).role("slider").description("UI 面板不透明度（越低越能透出背景图）"),
    videoPlaybackRate: z.number().min(0.1).max(4).default(1).role("slider").description("视频播放速率（作用于所有上传的视频：窗口壁纸与角标）"),
};
for (const area of IMAGE_AREAS) {
    shape[`${area}Image`] = z.string().default("").description(`${area} 共用图片 URL（浅色/深色都用，可被专用图覆盖）`);
    shape[`${area}ImageLight`] = z.string().default("").description(`${area} 浅色模式专用图片 URL（留空则回退共用图）`);
    shape[`${area}ImageDark`] = z.string().default("").description(`${area} 深色模式专用图片 URL（留空则回退共用图）`);
    shape[`${area}Enabled`] = z.boolean().default(true).description(`${area} 区域启用`);
    shape[`${area}Fit`] = z
        .union([z.const("cover"), z.const("contain"), z.const("tile")])
        .default("cover")
        .description(`${area} 填充方式`);
    shape[`${area}OffsetX`] = z.number().default(0).description(`${area} 水平偏移(px)`);
    shape[`${area}OffsetY`] = z.number().default(0).description(`${area} 垂直偏移(px)`);
    shape[`${area}Scale`] = z.number().min(10).max(400).default(100).description(`${area} 缩放(%)`);
}
export const ImageSkinSchema = z.object(shape).description("DSH 图片皮肤：按区域替换 Web UI 的大块图片");
const ROUTE_PREFIX = "/dsh-image-skin";
const DIR_NAME = "image-skin";
const EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
};
const FILE_RE = /^[0-9a-f-]+\.(png|jpg|jpeg|gif|webp|svg|avif|mp4|webm)$/i;
const FILE_URL_RE = /\/dsh-image-skin\/files\/([^/?#"\s]+)/g;
const PROVIDERS = [
    { id: "ark-seedream", label: "火山方舟 Seedream（豆包）", kind: "ark",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-4-0-250828", keyEnv: "ARK_API_KEY" },
    { id: "dashscope-wanx", label: "通义万相（阿里）", kind: "openai",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "wanx2.1-t2i-turbo", keyEnv: "DASHSCOPE_API_KEY" },
    { id: "zhipu-cogview", label: "智谱 CogView", kind: "openai",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "cogview-3-plus", keyEnv: "ZHIPUAI_API_KEY" },
    { id: "hunyuan-image", label: "腾讯混元生图", kind: "openai",
        baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-image", keyEnv: "HUNYUAN_API_KEY" },
    { id: "openai-image", label: "OpenAI gpt-image", kind: "openai",
        baseUrl: "https://api.openai.com/v1", model: "gpt-image-1", keyEnv: "OPENAI_API_KEY" },
    { id: "flux-bfl", label: "FLUX（Black Forest Labs）", kind: "openai",
        baseUrl: "https://api.bfl.ai/v1", model: "flux-pro-1.1", keyEnv: "BFL_API_KEY" },
    { id: "stability", label: "Stability（SD 系列）", kind: "openai",
        baseUrl: "https://api.stability.ai/v2beta", model: "sd3.5-large", keyEnv: "STABILITY_API_KEY" },
    { id: "custom", label: "自定义（OpenAI 兼容）", kind: "openai", baseUrl: "", model: "" },
];
/** Generation strength: how busy the ornament should be. Maps to prompt wording, nothing else. */
const STRENGTHS = [
    "a restrained thin border line with a small corner motif",
    "an ornamental border frame with a clear corner motif and a repeating edge figure",
    "a rich layered ornamental border with ornate corner flourishes and an intricate repeating edge",
    "an elaborate ornamental frame with embossed depth, dense scrollwork and jewelled corner pieces",
];
const GEN_SUBJECT = [
    "seamless decorative border pattern",
    "flat vector ornament",
    "perfectly symmetrical corners",
    "uniform repeating edges",
    "no text", "no letters", "no numbers", "no people", "no animals", "no faces",
    "no scenery", "no objects", "no watermark", "no signature",
].join(", ");
/** Compose the prompt for one generation. Kept here so the wording is versionable. */
function buildPrompt(style, palette, strength, extra) {
    const colours = palette.length ? `colour palette ${palette.join(" / ")}` : "colours sampled from the wallpaper";
    return [
        STRENGTHS[Math.max(0, Math.min(STRENGTHS.length - 1, strength - 1))] ?? STRENGTHS[1],
        GEN_SUBJECT,
        colours,
        style ? `style: ${style}` : "",
        extra ? `notes: ${extra}` : "",
    ].filter(Boolean).join(". ");
}
/** Resolve a provider by id, letting an inline override replace the preset's URL/model. */
function resolveProvider(req) {
    const preset = PROVIDERS.find((p) => p.id === (req.providerId ?? "")) ?? null;
    if (!preset)
        return null;
    const baseUrl = (req.baseUrl ?? "").trim() || preset.baseUrl;
    const model = (req.model ?? "").trim() || preset.model;
    if (!baseUrl || !model)
        return null; // custom without both is unusable
    return { ...preset, baseUrl, model };
}
/**
 * Read the key for a provider: an env var (Windows and POSIX casing both tried) first, then the
 * value the user typed. Env vars are the safer source because the key never enters the settings
 * file at all.
 */
function resolveKey(req, provider) {
    const names = [req.apiKeyEnv, provider.keyEnv].filter((n) => Boolean(n));
    for (const name of names) {
        const value = process.env[name] ?? process.env[name.toUpperCase()] ?? process.env[name.toLowerCase()];
        if (value && value.trim())
            return { key: value.trim(), from: "env" };
    }
    const typed = (req.apiKey ?? "").trim();
    if (typed)
        return { key: typed, from: "settings" };
    return { key: "", from: "none" };
}
/** POST one generation request and normalise whatever comes back into image bytes. */
async function callProvider(provider, key, body) {
    const url = `${provider.baseUrl.replace(/\/+$/, "")}/images/generations`;
    const payload = provider.kind === "ark"
        ? { model: provider.model, prompt: body.prompt, size: body.size, response_format: "url", watermark: false }
        : { model: provider.model, prompt: body.prompt, n: body.count, size: body.size, response_format: "url" };
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(120_000),
        });
    }
    catch (error) {
        return { ok: false, error: `请求失败：${error.message}` };
    }
    const text = await res.text();
    if (!res.ok) {
        return { ok: false, error: `${provider.label} 返回 ${res.status}：${text.slice(0, 300)}` };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { ok: false, error: `无法解析响应：${text.slice(0, 200)}` };
    }
    const items = parsed?.data ?? parsed?.images ?? parsed?.output ?? [];
    const images = [];
    for (const item of items) {
        if (typeof item === "string")
            images.push(item);
        else if (typeof item?.url === "string")
            images.push(item.url);
        else if (typeof item?.b64_json === "string")
            images.push(`data:image/png;base64,${item.b64_json}`);
    }
    if (!images.length)
        return { ok: false, error: `响应里没有图片：${text.slice(0, 200)}` };
    return { ok: true, images };
}
/** Save a remote image or data URI into the skin directory and return its public URL. */
async function storeImage(src) {
    let bytes;
    let ext = "png";
    if (src.startsWith("data:")) {
        const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/s.exec(src);
        if (!m)
            return null;
        ext = EXTENSIONS[`image/${m[1].toLowerCase()}`] ?? "png";
        bytes = Buffer.from(m[2], "base64");
    }
    else {
        try {
            const res = await fetch(src, { signal: AbortSignal.timeout(60_000) });
            if (!res.ok)
                return null;
            const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
            ext = EXTENSIONS[type] ?? "png";
            bytes = Buffer.from(await res.arrayBuffer());
        }
        catch {
            return null;
        }
    }
    if (!bytes.length)
        return null;
    const filename = `${randomUUID()}.${ext}`;
    writeFileSync(join(skinDir(), filename), bytes);
    return { url: `${ROUTE_PREFIX}/files/${filename}`, filename };
}
function skinDir() {
    const base = process.env.DSH_HOME || join(homedir(), ".dsh");
    const dir = join(base, DIR_NAME);
    mkdirSync(dir, { recursive: true });
    return dir;
}
/** Read a request body into a string, refusing anything past `limit` bytes. */
async function readBody(req, limit) {
    const declared = Number(req?.headers?.["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
        const error = new Error(`payload too large: ${declared} > ${limit}`);
        error.code = "E_TOO_LARGE";
        throw error;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > limit) {
            const error = new Error(`payload too large: > ${limit}`);
            error.code = "E_TOO_LARGE";
            throw error;
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
}
/** Every stored filename referenced by any string inside the resolved settings value. */
function referencedFiles(value) {
    const keep = new Set();
    const visit = (node, depth) => {
        if (depth > 3 || node === null || typeof node !== "object")
            return;
        for (const entry of Object.values(node)) {
            if (typeof entry === "string") {
                FILE_URL_RE.lastIndex = 0;
                let match;
                while ((match = FILE_URL_RE.exec(entry)) !== null)
                    keep.add(match[1]);
            }
            else if (typeof entry === "object") {
                visit(entry, depth + 1);
            }
        }
    };
    visit(value, 0);
    return keep;
}
/** Delete stored files nothing references any more; returns a small report. */
function collectUnused(value) {
    const keep = referencedFiles(value);
    let names = [];
    try {
        names = readdirSync(skinDir()).filter((n) => FILE_RE.test(n));
    }
    catch {
        /* empty */
    }
    const removed = [];
    let freedBytes = 0;
    const cutoff = Date.now() - GC_MIN_AGE_MS;
    for (const filename of names) {
        if (keep.has(filename))
            continue;
        const file = join(skinDir(), filename);
        try {
            const stats = statSync(file);
            if (stats.mtimeMs > cutoff)
                continue; // too fresh to judge
            unlinkSync(file);
            removed.push(filename);
            freedBytes += stats.size;
        }
        catch {
            /* already gone or unreadable — nothing to do */
        }
    }
    return { removed, kept: keep.size, freedBytes };
}
export function apply(ctx) {
    ctx.inject(["settings"], (settingsCtx) => {
        settingsCtx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), ImageSkinSchema);
    });
    ctx.inject(["webServer"], (httpCtx) => {
        const server = httpCtx.webServer;
        /** Resolve the settings service lazily: it may attach after this route does. */
        const readSettings = () => ((httpCtx.get ? httpCtx.get("settings") : undefined) ?? (ctx.get ? ctx.get("settings") : undefined));
        httpCtx.effect(() => server.register({
            kind: "prefix",
            path: ROUTE_PREFIX,
            handler: async (req, res) => {
                const url = new URL(req.url ?? "/", "http://local");
                const ok = (status, body) => {
                    const payload = JSON.stringify(body);
                    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
                    res.end(payload);
                };
                try {
                    // GET /dsh-image-skin/providers — presets plus which ones already have a key.
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/providers`) {
                        const list = PROVIDERS.map((p) => {
                            const envNames = [p.keyEnv].filter((n) => Boolean(n));
                            const envFound = envNames.find((n) => {
                                const v = process.env[n] ?? process.env[n.toUpperCase()] ?? process.env[n.toLowerCase()];
                                return Boolean(v && v.trim());
                            });
                            return {
                                id: p.id,
                                label: p.label,
                                kind: p.kind,
                                baseUrl: p.baseUrl,
                                model: p.model,
                                keyEnv: p.keyEnv ?? null,
                                envReady: Boolean(envFound),
                            };
                        });
                        return ok(200, { providers: list, strengths: STRENGTHS.length });
                    }
                    // POST /dsh-image-skin/gen — generate ornament with the chosen provider.
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/gen`) {
                        let body;
                        try {
                            body = await readBody(req, 256 * 1024);
                        }
                        catch (error) {
                            if (error.code === "E_TOO_LARGE")
                                return ok(413, { error: "请求过大" });
                            throw error;
                        }
                        const payload = JSON.parse(body);
                        if (!payload?.prompt || typeof payload.prompt !== "string") {
                            return ok(400, { error: "missing prompt" });
                        }
                        const provider = resolveProvider(payload);
                        if (!provider)
                            return ok(400, { error: "未知的服务商，或自定义服务商缺少 Base URL / 模型 ID" });
                        const { key, from } = resolveKey(payload, provider);
                        if (!key) {
                            return ok(400, {
                                error: `没有找到 ${provider.label} 的 API Key：请在上面填入，或设置环境变量 ${provider.keyEnv ?? "（自定义）"}`,
                            });
                        }
                        const count = Math.max(1, Math.min(4, Math.round(Number(payload.count) || 1)));
                        const size = typeof payload.size === "string" && /^\d{2,4}x\d{2,4}$/.test(payload.size) ? payload.size : "1024x1024";
                        const result = await callProvider(provider, key, { prompt: payload.prompt, count, size });
                        if ("error" in result)
                            return ok(502, { error: result.error, keyFrom: from });
                        const saved = [];
                        for (const src of result.images) {
                            const stored = await storeImage(src);
                            if (stored)
                                saved.push(stored.url);
                        }
                        if (!saved.length)
                            return ok(502, { error: "生成成功但图片保存失败（可能是无法访问的临时链接）" });
                        return ok(200, { urls: saved, provider: provider.id, model: provider.model, keyFrom: from });
                    }
                    // POST /dsh-image-skin/prompt — compose the prompt without generating (preview in UI).
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/prompt`) {
                        const body = await readBody(req, 64 * 1024);
                        const p = JSON.parse(body);
                        const prompt = buildPrompt(String(p.style ?? ""), Array.isArray(p.palette) ? p.palette.slice(0, 6).map(String) : [], Number(p.strength) || 2, String(p.extra ?? ""));
                        return ok(200, { prompt });
                    }
                    // POST /dsh-image-skin/upload { image: "data:image/png;base64,..." }
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/upload`) {
                        let body;
                        try {
                            body = await readBody(req, MAX_UPLOAD_BYTES);
                        }
                        catch (error) {
                            if (error.code === "E_TOO_LARGE") {
                                return ok(413, { error: `文件过大：单次上传上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB` });
                            }
                            throw error;
                        }
                        const payload = JSON.parse(body);
                        const match = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,(.+)$/s.exec(payload.image ?? "");
                        if (!match)
                            return ok(400, { error: "expected data:image/*;base64 payload" });
                        const ext = EXTENSIONS[match[1].toLowerCase()];
                        if (!ext)
                            return ok(415, { error: `unsupported image type ${match[1]}` });
                        const filename = `${randomUUID()}.${ext}`;
                        writeFileSync(join(skinDir(), filename), Buffer.from(match[2], "base64"));
                        return ok(200, { url: `${ROUTE_PREFIX}/files/${filename}` });
                    }
                    // POST /dsh-image-skin/gc — delete stored files no area references any more.
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/gc`) {
                        const value = readSettings()?.get(SETTINGS_NAMESPACE);
                        if (value === null || typeof value !== "object") {
                            return ok(409, { error: "settings namespace is not ready" });
                        }
                        return ok(200, collectUnused(value));
                    }
                    // GET /dsh-image-skin/files — list stored images (newest first)
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/files`) {
                        let files = [];
                        try {
                            files = readdirSync(skinDir()).filter((n) => FILE_RE.test(n));
                        }
                        catch {
                            /* empty */
                        }
                        const list = files
                            .map((filename) => {
                            let size = 0;
                            let updatedAt = 0;
                            try {
                                const st = statSync(join(skinDir(), filename));
                                size = st.size;
                                updatedAt = st.mtimeMs;
                            }
                            catch {
                                /* skip */
                            }
                            return { filename, url: `${ROUTE_PREFIX}/files/${filename}`, size, updatedAt };
                        })
                            .filter((e) => e.updatedAt > 0)
                            .sort((a, b) => b.updatedAt - a.updatedAt);
                        return ok(200, { files: list });
                    }
                    // DELETE /dsh-image-skin/files/<file>
                    if (req.method === "DELETE" && url.pathname.startsWith(`${ROUTE_PREFIX}/files/`)) {
                        const filename = url.pathname.slice(`${ROUTE_PREFIX}/files/`.length);
                        if (!FILE_RE.test(filename))
                            return ok(404, { error: "not found" });
                        const file = join(skinDir(), filename);
                        if (!existsSync(file))
                            return ok(404, { error: "not found" });
                        unlinkSync(file);
                        return ok(200, { ok: true });
                    }
                    // GET /dsh-image-skin/files/<file> — serve file
                    if (req.method === "GET" && url.pathname.startsWith(`${ROUTE_PREFIX}/files/`)) {
                        const filename = url.pathname.slice(`${ROUTE_PREFIX}/files/`.length);
                        if (!FILE_RE.test(filename)) {
                            res.writeHead(404, { "content-type": "text/plain" });
                            res.end("not found");
                            return;
                        }
                        const file = join(skinDir(), filename);
                        if (!existsSync(file)) {
                            res.writeHead(404, { "content-type": "text/plain" });
                            res.end("not found");
                            return;
                        }
                        const ext = filename.split(".").pop().toLowerCase();
                        const type = ext === "svg" ? "image/svg+xml" : ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : `image/${ext === "jpg" ? "jpeg" : ext}`;
                        // A stored file never changes under its URL (the name is a UUID minted per
                        // upload), so let the browser keep it: without this the mode switch re-fetched
                        // the whole wallpaper every time, which is the stall you feel on a big image.
                        res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
                        res.end(readFileSync(file));
                        return;
                    }
                    return ok(404, { error: "not found" });
                }
                catch (error) {
                    return ok(500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }), "dsh-image-skin: image routes");
    });
}
