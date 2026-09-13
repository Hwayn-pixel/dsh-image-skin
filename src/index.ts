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

// Data-driven schema: a couple of globals plus four fields per area.
const shape: Record<string, unknown> = {
  enabled: z.boolean().default(true).description("总开关：关闭后所有图片皮肤失效"),
  panelOpacity: z.number().min(0).max(100).default(85).role("slider").description("UI 面板不透明度（越低越能透出背景图）"),
};
for (const area of IMAGE_AREAS) {
  shape[`${area}Image`] = z.string().default("").description(`${area} 区域图片 URL`);
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
                res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
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
