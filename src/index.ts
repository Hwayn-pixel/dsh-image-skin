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
export const IMAGE_AREAS = ["window", "center", "sidebar", "welcome", "rightbar", "composer", "stickerComposer", "stickerSidebar"] as const;

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
function settingsNamespace(value: string): string {
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
  }
  return value;
}

// Data-driven schema: a couple of globals plus a handful of fields per area.
// Every area carries a *shared* image plus two optional per-mode overrides
// (light / dark). Resolution order is `<area>Image<Mode>` then `<area>Image`, so a
// stored config written before per-mode support existed keeps working unchanged.
const shape: Record<string, unknown> = {
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
export const ImageSkinSchema = z.object(shape as never).description("DSH 图片皮肤：按区域替换 Web UI 的大块图片");

const ROUTE_PREFIX = "/dsh-image-skin";
const DIR_NAME = "image-skin";
const EXTENSIONS: Record<string, string> = {
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

// ── text-to-image providers ─────────────────────────────────────────────────
//
// The accent feature needs ornamental artwork, which code cannot draw convincingly: a CSS
// gradient reads as a dashed "disabled" outline, while a real ornament needs art. So the levels
// are generation *strength*, and the drawing is delegated to a model the user picks.
//
// Almost every service now exposes an OpenAI-shaped /images/generations endpoint, so one adapter
// covers most of them; Ark (Volcengine Seedream) is close enough to reuse it with a different
// body. "custom" lets the user point at anything else with the same shape - provider hubs in
// particular - without shipping an adapter for each.

type ProviderKind = "openai" | "ark" | "dashscope";

interface ProviderDef {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  /** Env var that may hold the key; when set, the key box in the UI is read-only. */
  keyEnv?: string;
  docs?: string;
}

const PROVIDERS: ProviderDef[] = [
  { id: "ark-seedream", label: "火山方舟 Seedream（豆包）", kind: "ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-4-0-250828", keyEnv: "ARK_API_KEY" },
  { id: "dashscope-wanx", label: "通义万相 / 千问（阿里云百炼）", kind: "dashscope",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1", model: "wanx2.1-t2i-turbo", keyEnv: "DASHSCOPE_API_KEY" },
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

/**
 * 借材 (borrowed material): the picture's own material decides what the ornament should be *made of*,
 * so an aurora over mountains comes back as silver filigree and a washi-textured backdrop as gold
 * leaf. The client reads the material off the artwork and sends the name; the wording lives here.
 */
const MATERIALS: Record<string, string> = {
  sky: "material: fine silver filigree, thin and airy",
  paper: "material: gold leaf on textured paper",
  wood: "material: carved wood, shallow relief",
  water: "material: rippling water lines, flowing and thin",
  neon: "material: thin glowing neon tubing, high contrast",
  plain: "",
};

/** Compose the prompt for one generation. Kept here so the wording is versionable. */
function buildPrompt(style: string, palette: string[], strength: number, extra: string, material = ""): string {
  const colours = palette.length ? `colour palette ${palette.join(" / ")}` : "colours sampled from the wallpaper";
  return [
    STRENGTHS[Math.max(0, Math.min(STRENGTHS.length - 1, strength - 1))] ?? STRENGTHS[1],
    GEN_SUBJECT,
    colours,
    MATERIALS[material] ?? "",
    style ? `style: ${style}` : "",
    extra ? `notes: ${extra}` : "",
  ].filter(Boolean).join(". ");
}

interface GenRequest {
  providerId?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  prompt: string;
  count?: number;
  size?: string;
}

/** Resolve a provider by id, letting an inline override replace the preset's URL/model. */
function resolveProvider(req: GenRequest): ProviderDef | null {
  const preset = PROVIDERS.find((p) => p.id === (req.providerId ?? "")) ?? null;
  if (!preset) return null;
  const baseUrl = (req.baseUrl ?? "").trim() || preset.baseUrl;
  const model = (req.model ?? "").trim() || preset.model;
  if (!baseUrl || !model) return null;                 // custom without both is unusable
  return { ...preset, baseUrl, model };
}

/**
 * Read the key for a provider: an env var (Windows and POSIX casing both tried) first, then the
 * value the user typed. Env vars are the safer source because the key never enters the settings
 * file at all.
 */
function resolveKey(req: GenRequest, provider: ProviderDef): { key: string; from: "env" | "settings" | "none" } {
  const names = [req.apiKeyEnv, provider.keyEnv].filter((n): n is string => Boolean(n));
  for (const name of names) {
    const value = process.env[name] ?? process.env[name.toUpperCase()] ?? process.env[name.toLowerCase()];
    if (value && value.trim()) return { key: value.trim(), from: "env" };
  }
  const typed = (req.apiKey ?? "").trim();
  if (typed) return { key: typed, from: "settings" };
  return { key: "", from: "none" };
}

/** POST one generation request and normalise whatever comes back into image bytes. */
async function callProvider(
  provider: ProviderDef,
  key: string,
  body: { prompt: string; count: number; size: string },
  stage?: (s: string) => void,
): Promise<{ ok: true; images: string[] } | { ok: false; error: string }> {
  const url = `${provider.baseUrl.replace(/\/+$/, "")}/images/generations`;
  // DashScope is its own protocol (submit + poll); everything else here is OpenAI-shaped.
  if (provider.kind === "dashscope") return callDashscope(provider, key, body, stage);
  const payload = provider.kind === "ark"
    ? { model: provider.model, prompt: body.prompt, size: body.size, response_format: "url", watermark: false }
    : { model: provider.model, prompt: body.prompt, n: body.count, size: body.size, response_format: "url" };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    return { ok: false, error: `请求失败：${(error as Error).message}` };
  }
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `${provider.label} 返回 ${res.status}：${text.slice(0, 300)}` };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `无法解析响应：${text.slice(0, 200)}` };
  }
  const items: any[] = parsed?.data ?? parsed?.images ?? parsed?.output ?? [];
  const images: string[] = [];
  for (const item of items) {
    if (typeof item === "string") images.push(item);
    else if (typeof item?.url === "string") images.push(item.url);
    else if (typeof item?.b64_json === "string") images.push(`data:image/png;base64,${item.b64_json}`);
  }
  if (!images.length) return { ok: false, error: `响应里没有图片：${text.slice(0, 200)}` };
  return { ok: true, images };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * DashScope (阿里云百炼：通义万相 / 千问图像) image generation.
 *
 * Deliberately *not* OpenAI-shaped, which is why the preset used to fail: image synthesis there is
 * asynchronous - you POST the job, get a task id, then poll until it finishes, and the pictures come
 * back as short-lived OSS urls. Sizes are written "1024*1024" rather than "1024x1024". Auth and JSON
 * are ordinary HTTP, so this is a small adapter rather than a dependency.
 */
async function callDashscope(
  provider: ProviderDef,
  key: string,
  body: { prompt: string; count: number; size: string },
  stage?: (s: string) => void,
): Promise<{ ok: true; images: string[] } | { ok: false; error: string }> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  // One image per request. DashScope's `n` is not something we can rely on (and a single request
  // with n>1 tends to come back as the same picture n times), so "2 张" means two independent
  // jobs: each is its own sampling, which is the only way the count actually shows.
  const jobs = Math.max(1, Math.min(4, Math.round(body.count || 1)));

  interface SubmitResult {
    ok: boolean;
    taskId?: string;
    images?: string[];
    error?: string;
  }

  const submitOne = async (): Promise<SubmitResult> => {
    let submitted: Response;
    try {
      submitted = await fetch(`${base}/services/aigc/text2image/image-synthesis`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
          model: provider.model,
          input: { prompt: body.prompt },
          parameters: { size: body.size.replace(/x/i, "*") },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return { ok: false, error: `请求失败：${(error as Error).message}` };
    }
    const text = await submitted.text();
    if (!submitted.ok) {
      return { ok: false, error: `${provider.label} 返回 ${submitted.status}：${text.slice(0, 300)}` };
    }
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, error: `无法解析响应：${text.slice(0, 200)}` };
    }
    const immediate = collectDashscopeImages(payload);
    if (immediate.length) return { ok: true, images: immediate };
    const taskId = payload?.output?.task_id ?? payload?.task_id;
    if (!taskId) return { ok: false, error: `响应里没有 task_id：${text.slice(0, 200)}` };
    return { ok: true, taskId: String(taskId) };
  };

  const images: string[] = [];
  const waiting = new Set<string>();
  for (let i = 0; i < jobs; i++) {
    const one = await submitOne();
    if (!one.ok) return { ok: false, error: one.error ?? "提交失败" };
    if (one.images?.length) images.push(...one.images);
    else if (one.taskId) waiting.add(one.taskId);
  }
  if (!waiting.size) {
    return images.length ? { ok: true, images } : { ok: false, error: "服务商没有返回图片" };
  }

  // Poll every job each round, so N pictures cost one wait rather than N. Bounded at ~150s so a
  // stuck job cannot hold the request open forever.
  for (let attempt = 0; attempt < 60 && waiting.size; attempt++) {
    await sleep(2_500);
    stage?.(attempt === 0 ? "queued" : "running");
    for (const taskId of [...waiting]) {
      let poll: Response;
      try {
        poll = await fetch(`${base}/tasks/${taskId}`, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        return { ok: false, error: `轮询失败：${(error as Error).message}` };
      }
      const pollText = await poll.text();
      let state: any;
      try {
        state = JSON.parse(pollText);
      } catch {
        return { ok: false, error: `无法解析轮询响应：${pollText.slice(0, 200)}` };
      }
      const status = String(state?.output?.task_status ?? state?.task_status ?? "").toUpperCase();
      if (status === "SUCCEEDED") {
        const got = collectDashscopeImages(state);
        if (!got.length) return { ok: false, error: `任务成功但没有图片：${pollText.slice(0, 200)}` };
        images.push(...got);
        waiting.delete(taskId);
      } else if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
        return { ok: false, error: `任务未完成（${status}）：${pollText.slice(0, 300)}` };
      }
    }
  }
  if (waiting.size) {
    return { ok: false, error: `等待超时（约 2.5 分钟）：还有 ${waiting.size} 张在排队，稍后再试一次` };
  }
  return { ok: true, images };
}

/** Image urls out of either DashScope reply shape: `output.results[]` or the messages style. */
function collectDashscopeImages(payload: any): string[] {
  const out: string[] = [];
  const results = payload?.output?.results ?? payload?.results;
  if (Array.isArray(results)) {
    for (const item of results) {
      if (typeof item === "string") out.push(item);
      else if (typeof item?.url === "string") out.push(item.url);
      else if (typeof item?.image === "string") out.push(item.image);
    }
  }
  const choices = payload?.output?.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      for (const part of choice?.message?.content ?? []) {
        if (typeof part?.image === "string") out.push(part.image);
      }
    }
  }
  return out;
}

/** Turn a provider failure into something a human can act on. */
function describeFailure(provider: ProviderDef, detail: string): { error: string; hint: string; retryable: boolean } {
  const status = Number(/返回 (\d{3})/.exec(detail)?.[1] ?? NaN);
  if (status === 401 || /invalid.?api.?key|unauthor/i.test(detail)) {
    return { error: "Key 没通过验证（401）", hint: "回头检查一下 Key：是不是复制少了字符，或已经过期。", retryable: false };
  }
  if (status === 403) {
    return { error: "这个 Key 没有权限（403）", hint: `要么没开通 ${provider.model} 这个模型，要么账号被限制。`, retryable: false };
  }
  if (status === 404) {
    return { error: "地址或模型不对（404）", hint: "检查「模型 ID」和 Base URL：多数 404 都是这两个填错。", retryable: false };
  }
  if (status === 429) {
    return { error: "被限流了（429）", hint: "等一两分钟再试，或降低张数。", retryable: true };
  }
  if (status >= 500) {
    return { error: `服务端故障（${status}）`, hint: "不是你的问题，稍后重试。", retryable: true };
  }
  if (/超时|timeout|排队/i.test(detail)) {
    return { error: "还没等到结果", hint: "服务在排队；稍后再试一次，或换极速版模型。", retryable: true };
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|连不上/i.test(detail)) {
    return { error: "连不上这个服务", hint: "Base URL 写错了？或者本机网络/代理拦住了。", retryable: true };
  }
  return { error: "生成失败", hint: "下面的原文里通常有线索；改完再试一次。", retryable: true };
}

/** Cheap key probe: does the service accept this key at all? (No image is requested.) */
async function testKey(provider: ProviderDef, key: string): Promise<{ ok: boolean; detail: string }> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  try {
    if (provider.kind === "dashscope") {
      const res = await fetch(`${base}/tasks/dsh-image-skin-probe`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, detail: "服务返回 401/403：Key 不对、或没开通这项服务" };
      return { ok: true, detail: `服务应答 ${res.status}，Key 被接受` };
    }
    const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) return { ok: false, detail: "服务返回 401/403：Key 不对或已过期" };
    if (!res.ok) return { ok: true, detail: `服务应答 ${res.status}（这个服务不支持预检，直接生成时才知道）` };
    return { ok: true, detail: "Key 可用" };
  } catch (error) {
    return { ok: false, detail: `连不上：${(error as Error).message}` };
  }
}

interface GenOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The whole generation flow (validate → call → store), shared by the plain route and the
 * streaming one. `stage` lets a caller report progress while a slow job is running.
 */
async function runGeneration(payload: GenRequest, stage?: (s: string) => void): Promise<GenOutcome> {
  if (!payload?.prompt || typeof payload.prompt !== "string") return { status: 400, body: { error: "缺少提示词" } };
  const provider = resolveProvider(payload);
  if (!provider) return { status: 400, body: { error: "未知的服务商，或自定义服务商缺少 Base URL / 模型 ID" } };
  const { key, from } = resolveKey(payload, provider);
  if (!key) {
    return {
      status: 400,
      body: {
        error: `没有找到 ${provider.label} 的 API Key`,
        hint: `在上面填入，或设环境变量 ${provider.keyEnv ?? "（自定义）"}。`,
        retryable: false,
      },
    };
  }
  const count = Math.max(1, Math.min(4, Math.round(Number(payload.count) || 1)));
  const size = typeof payload.size === "string" && /^\d{2,4}x\d{2,4}$/.test(payload.size) ? payload.size : "1024x1024";
  stage?.("submitted");
  const result = await callProvider(provider, key, { prompt: payload.prompt, count, size }, stage);
  if ("error" in result) {
    const friendly = describeFailure(provider, result.error);
    return { status: 502, body: { ...friendly, detail: result.error, provider: provider.id, keyFrom: from } };
  }
  stage?.("saving");
  const saved: string[] = [];
  for (const src of result.images) {
    const stored = await storeImage(src);
    if (stored) saved.push(stored.url);
  }
  if (!saved.length) {
    return { status: 502, body: { error: "生成成功，但图片存不下来", hint: "服务返回的临时链接可能已过期，再试一次。", retryable: true } };
  }
  return { status: 200, body: { urls: saved, provider: provider.id, model: provider.model, keyFrom: from } };
}

/** Save a remote image or data URI into the skin directory and return its public URL. */
async function storeImage(src: string): Promise<{ url: string; filename: string } | null> {
  let bytes: Buffer;
  let ext = "png";
  if (src.startsWith("data:")) {
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/s.exec(src);
    if (!m) return null;
    ext = EXTENSIONS[`image/${m[1].toLowerCase()}`] ?? "png";
    bytes = Buffer.from(m[2], "base64");
  } else {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return null;
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      ext = EXTENSIONS[type] ?? "png";
      bytes = Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  if (!bytes.length) return null;
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(join(skinDir(), filename), bytes);
  return { url: `${ROUTE_PREFIX}/files/${filename}`, filename };
}

function skinDir(): string {
  const base = process.env.DSH_HOME || join(homedir(), ".dsh");
  const dir = join(base, DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface HostContext {
  inject(services: readonly string[], fn: (ctx: HostContext) => void): unknown;
  effect(fn: () => (() => void) | void, label?: string): unknown;
  get?(name: string): unknown;
}

/** Read a request body into a string, refusing anything past `limit` bytes. */
async function readBody(req: any, limit: number): Promise<string> {
  const declared = Number(req?.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    const error = new Error(`payload too large: ${declared} > ${limit}`) as Error & { code?: string };
    error.code = "E_TOO_LARGE";
    throw error;
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > limit) {
      const error = new Error(`payload too large: > ${limit}`) as Error & { code?: string };
      error.code = "E_TOO_LARGE";
      throw error;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Every stored filename referenced by any string inside the resolved settings value. */
function referencedFiles(value: unknown): Set<string> {
  const keep = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 3 || node === null || typeof node !== "object") return;
    for (const entry of Object.values(node as Record<string, unknown>)) {
      if (typeof entry === "string") {
        FILE_URL_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = FILE_URL_RE.exec(entry)) !== null) keep.add(match[1]);
      } else if (typeof entry === "object") {
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
  return keep;
}

/** Delete stored files nothing references any more; returns a small report. */
function collectUnused(value: unknown): { removed: string[]; kept: number; freedBytes: number } {
  const keep = referencedFiles(value);
  let names: string[] = [];
  try {
    names = readdirSync(skinDir()).filter((n) => FILE_RE.test(n));
  } catch {
    /* empty */
  }
  const removed: string[] = [];
  let freedBytes = 0;
  const cutoff = Date.now() - GC_MIN_AGE_MS;
  for (const filename of names) {
    if (keep.has(filename)) continue;
    const file = join(skinDir(), filename);
    try {
      const stats = statSync(file);
      if (stats.mtimeMs > cutoff) continue; // too fresh to judge
      unlinkSync(file);
      removed.push(filename);
      freedBytes += stats.size;
    } catch {
      /* already gone or unreadable — nothing to do */
    }
  }
  return { removed, kept: keep.size, freedBytes };
}

export function apply(ctx: HostContext): void {
  ctx.inject(["settings"], (settingsCtx) => {
    (settingsCtx as unknown as { settings: { register(ns: string, schema: unknown): unknown } }).settings.register(
      settingsNamespace(SETTINGS_NAMESPACE),
      ImageSkinSchema,
    );
  });

  ctx.inject(["webServer"], (httpCtx) => {
    const server = (
      httpCtx as unknown as {
        webServer: { register(r: { kind: "prefix"; path: string; handler: (req: any, res: any) => void | Promise<void> }): () => void };
      }
    ).webServer;
    /** Resolve the settings service lazily: it may attach after this route does. */
    const readSettings = (): { get(ns: string): unknown } | undefined =>
      ((httpCtx.get ? httpCtx.get("settings") : undefined) ?? (ctx.get ? ctx.get("settings") : undefined)) as
        | { get(ns: string): unknown }
        | undefined;

    httpCtx.effect(
      () =>
        server.register({
          kind: "prefix",
          path: ROUTE_PREFIX,
          handler: async (req: any, res: any) => {
            const url = new URL(req.url ?? "/", "http://local");
            const ok = (status: number, body: unknown) => {
              const payload = JSON.stringify(body);
              res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
              res.end(payload);
            };
            try {
              // GET /dsh-image-skin/providers — presets plus which ones already have a key.
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/providers`) {
                const list = PROVIDERS.map((p) => {
                  const envNames = [p.keyEnv].filter((n): n is string => Boolean(n));
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
                let body: string;
                try {
                  body = await readBody(req, 256 * 1024);
                } catch (error) {
                  if ((error as { code?: string }).code === "E_TOO_LARGE") return ok(413, { error: "请求过大" });
                  throw error;
                }
                const out = await runGeneration(JSON.parse(body) as GenRequest);
                return ok(out.status, out.body);
              }
              // POST /dsh-image-skin/gen/stream — same flow, but reports progress as it goes.
              // A text-to-image job can queue for minutes; without this the UI could only say
              // "生成中…" and hope. Half a dozen small events, then the same result body.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/gen/stream`) {
                let body: string;
                try {
                  body = await readBody(req, 256 * 1024);
                } catch (error) {
                  if ((error as { code?: string }).code === "E_TOO_LARGE") return ok(413, { error: "请求过大" });
                  throw error;
                }
                res.writeHead(200, {
                  "content-type": "text/event-stream; charset=utf-8",
                  "cache-control": "no-store",
                  connection: "keep-alive",
                });
                const send = (obj: unknown) => {
                  try {
                    res.write(`data: ${JSON.stringify(obj)}\n\n`);
                  } catch {
                    /* client went away; the run finishes and is stored anyway */
                  }
                };
                try {
                  const out = await runGeneration(JSON.parse(body) as GenRequest, (stageName) => send({ stage: stageName }));
                  send({ stage: "done", ...out.body, status: out.status });
                } catch (error) {
                  send({ stage: "done", status: 500, error: "生成过程中出错了", detail: String(error) });
                }
                res.end();
                return;
              }
              // POST /dsh-image-skin/test — check the key without spending a generation.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/test`) {
                const body = await readBody(req, 32 * 1024);
                const payload = JSON.parse(body) as GenRequest;
                const provider = resolveProvider(payload);
                if (!provider) return ok(200, { ok: false, detail: "未知的服务商，或自定义服务商缺少 Base URL / 模型 ID" });
                const { key, from } = resolveKey(payload, provider);
                if (!key) {
                  return ok(200, {
                    ok: false,
                    detail: `没有找到 ${provider.label} 的 API Key`,
                    hint: `填入，或设环境变量 ${provider.keyEnv ?? "（自定义）"}。`,
                  });
                }
                const check = await testKey(provider, key);
                return ok(200, { ...check, provider: provider.id, keyFrom: from });
              }
              // POST /dsh-image-skin/prompt — compose the prompt without generating (preview in UI).
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/prompt`) {
                const body = await readBody(req, 64 * 1024);
                const p = JSON.parse(body) as { style?: string; palette?: string[]; strength?: number; extra?: string; material?: string };
                const prompt = buildPrompt(
                  String(p.style ?? ""),
                  Array.isArray(p.palette) ? p.palette.slice(0, 6).map(String) : [],
                  Number(p.strength) || 2,
                  String(p.extra ?? ""),
                  String(p.material ?? ""),
                );
                return ok(200, { prompt });
              }
              // POST /dsh-image-skin/upload { image: "data:image/png;base64,..." }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/upload`) {
                let body: string;
                try {
                  body = await readBody(req, MAX_UPLOAD_BYTES);
                } catch (error) {
                  if ((error as { code?: string }).code === "E_TOO_LARGE") {
                    return ok(413, { error: `文件过大：单次上传上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB` });
                  }
                  throw error;
                }
                const payload = JSON.parse(body) as { image?: string };
                const match = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,(.+)$/s.exec(payload.image ?? "");
                if (!match) return ok(400, { error: "expected data:image/*;base64 payload" });
                const ext = EXTENSIONS[match[1].toLowerCase()];
                if (!ext) return ok(415, { error: `unsupported image type ${match[1]}` });
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
                let files: string[] = [];
                try {
                  files = readdirSync(skinDir()).filter((n) => FILE_RE.test(n));
                } catch {
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
                    } catch {
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
                if (!FILE_RE.test(filename)) return ok(404, { error: "not found" });
                const file = join(skinDir(), filename);
                if (!existsSync(file)) return ok(404, { error: "not found" });
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
                const ext = filename.split(".").pop()!.toLowerCase();
                const type =
                  ext === "svg" ? "image/svg+xml" : ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : `image/${ext === "jpg" ? "jpeg" : ext}`;
                // A stored file never changes under its URL (the name is a UUID minted per
                // upload), so let the browser keep it: without this the mode switch re-fetched
                // the whole wallpaper every time, which is the stall you feel on a big image.
                res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
                res.end(readFileSync(file));
                return;
              }
              return ok(404, { error: "not found" });
            } catch (error) {
              return ok(500, { error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      "dsh-image-skin: image routes",
    );
  });
}
