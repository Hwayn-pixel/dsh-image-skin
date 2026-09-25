/**
 * Offline test suite for the dsh-image-skin host half.
 *
 * Loads lib/index.js, captures the registered web route and drives its handler with fake
 * req/res objects, against a throwaway DSH_HOME. No DSH process, no network, no real storage.
 *
 *   node test/host.test.mjs      # exits non-zero on the first failed assertion set
 */
import { existsSync, mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HOST_ENTRY = fileURLToPath(new URL("../lib/index.js", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "dsh-image-skin-test-"));
process.env.DSH_HOME = home;

const mod = await import(new URL(`file://${HOST_ENTRY}`).href);

let route = null;
let routeDisposed = false;
let capturedDisposer = null;
const fakeSettings = {
  value: { enabled: true, windowImage: "" },
  register: () => ({}),
  get(ns) {
    return ns === "ui-image-skin" ? this.value : undefined;
  },
};
const fakeServer = {
  register(r) {
    route = r;
    return () => {
      routeDisposed = true;
    };
  },
};
const effect = (fn) => {
  const disposer = fn();
  if (typeof disposer === "function") capturedDisposer = disposer;
};
function makeCtx() {
  return {
    settings: fakeSettings,
    webServer: fakeServer,
    get: (n) => (n === "settings" ? fakeSettings : n === "webServer" ? fakeServer : undefined),
    effect,
    inject: (deps, fn) => fn(makeCtx()),
  };
}
const ctx = { ...makeCtx(), effect };

mod.apply(ctx);

// ── fakes ───────────────────────────────────────────────────────────────────
function fakeReq(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)];
  return {
    method,
    url,
    headers,
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
}
async function call(method, url, body, headers) {
  const out = { status: 0, headers: null, body: null, chunks: [] };
  const res = {
    writeHead: (s, h) => ((out.status = s), (out.headers = h)),
    write: (chunk) => (out.chunks.push(String(chunk)), true),
    end: (b) => {
      if (b !== undefined) out.body = b;
    },
  };
  await route.handler(fakeReq(method, url, body, headers), res);
  return out;
}

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}
const json = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};
const listFiles = () => readdirSync(join(home, "image-skin"));

// 1×1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const dataUri = `data:image/png;base64,${PNG}`;

console.log("== schema ==");
{
  const d = mod.ImageSkinSchema({});
  check("defaults unchanged (enabled / panelOpacity)", d.enabled === true && d.panelOpacity === 85, JSON.stringify(d).slice(0, 80));
  check(
    "every area has shared + light + dark image fields",
    mod.IMAGE_AREAS.every((a) => d[`${a}Image`] === "" && d[`${a}ImageLight`] === "" && d[`${a}ImageDark`] === ""),
  );
  check("videoPlaybackRate defaults to 1", d.videoPlaybackRate === 1, String(d.videoPlaybackRate));
}

console.log("== route registration ==");
check("route registered", route !== null);
check("kind is prefix", route?.kind === "prefix", `got ${route?.kind}`);
check("path is /dsh-image-skin", route?.path === "/dsh-image-skin", `got ${route?.path}`);

console.log("== baseline ==");
{
  const r = await call("GET", "/dsh-image-skin/files");
  check("GET /files -> 200", r.status === 200, `got ${r.status}`);
  check("GET /files -> empty list", json(r)?.files?.length === 0, r.body);
}
check("debug probe route is gone", (await call("POST", "/dsh-image-skin/probe", "{}")).status === 404);
check("unknown path -> 404", (await call("GET", "/dsh-image-skin/nope")).status === 404);

console.log("== upload ==");
let urlA = null;
let nameA = null;
{
  const r = await call("POST", "/dsh-image-skin/upload", JSON.stringify({ image: dataUri }), {
    "content-type": "application/json",
  });
  check("small upload -> 200", r.status === 200, `got ${r.status} ${r.body}`);
  urlA = json(r)?.url;
  nameA = urlA?.split("/").pop();
  check("upload returns a png url", /^\/dsh-image-skin\/files\/[0-9a-f-]+\.png$/.test(urlA ?? ""), String(urlA));
  check("file landed on disk", existsSync(join(home, "image-skin", nameA ?? "")));
}
{
  const r = await call("POST", "/dsh-image-skin/upload", "x", { "content-length": String(99 * 1024 * 1024) });
  check("declared oversize -> 413", r.status === 413, `got ${r.status} ${r.body}`);
}
{
  const big = Buffer.alloc(33 * 1024 * 1024, 0x61);
  const r = await call("POST", "/dsh-image-skin/upload", big);
  check("streamed oversize -> 413", r.status === 413, `got ${r.status}`);
}
{
  const r = await call("POST", "/dsh-image-skin/upload", JSON.stringify({ image: "data:image/tiff;base64,AAAA" }));
  check("unsupported image type -> 415", r.status === 415, `got ${r.status} ${r.body}`);
  const r2 = await call("POST", "/dsh-image-skin/upload", JSON.stringify({ image: "data:text/plain;base64,AAAA" }));
  check("non-image data uri -> 400", r2.status === 400, `got ${r2.status} ${r2.body}`);
}
{
  const r = await call("POST", "/dsh-image-skin/upload", JSON.stringify({ image: "nonsense" }));
  check("malformed payload -> 400", r.status === 400, `got ${r.status}`);
}

console.log("== serve ==");
{
  const r = await call("GET", urlA);
  check("GET file -> 200", r.status === 200, `got ${r.status}`);
  check("content-type image/png", r.headers?.["content-type"] === "image/png", String(r.headers?.["content-type"]));
  check(
    "served immutable (a stored UUID never changes under its URL)",
    /immutable/.test(String(r.headers?.["cache-control"] ?? "")),
    String(r.headers?.["cache-control"]),
  );
  check("bytes round-trip", Buffer.compare(Buffer.from(r.body), Buffer.from(PNG, "base64")) === 0);
}
check("traversal filename -> 404", (await call("GET", "/dsh-image-skin/files/..%2F..%2Fsettings.yaml")).status === 404);

console.log("== gc ==");
const backdate = (name) => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(join(home, "image-skin", name), old, old);
};
let urlB = null;
{
  urlB = json(await call("POST", "/dsh-image-skin/upload", JSON.stringify({ image: dataUri })))?.url;
  backdate(urlA.split("/").pop());
  backdate(urlB.split("/").pop());
  fakeSettings.value = { enabled: true, windowImage: urlA };
  const r = await call("POST", "/dsh-image-skin/gc");
  const report = json(r);
  check("gc -> 200", r.status === 200, `got ${r.status}`);
  check("gc removed exactly the unreferenced file", report?.removed?.length === 1 && report.removed[0] === urlB.split("/").pop(), JSON.stringify(report));
  check("gc kept the referenced file", existsSync(join(home, "image-skin", nameA)));
  check("gc freed bytes > 0", (report?.freedBytes ?? 0) > 0);
}
{
  const fresh = json(await call("POST", "/dsh-image-skin/upload", JSON.stringify({ image: dataUri })))?.url;
  fakeSettings.value = { enabled: true, windowImage: urlA };
  const report = json(await call("POST", "/dsh-image-skin/gc"));
  check("gc spares a too-fresh file", existsSync(join(home, "image-skin", fresh.split("/").pop())), JSON.stringify(report));
}
{
  fakeSettings.value = undefined;
  const r = await call("POST", "/dsh-image-skin/gc");
  check("gc with unready settings -> 409", r.status === 409, `got ${r.status}`);
}
console.log("== delete ==");
{
  const r = await call("DELETE", urlA);
  check("DELETE -> 200", r.status === 200, `got ${r.status}`);
  check("file is gone", !existsSync(join(home, "image-skin", nameA)));
  check("second DELETE -> 404", (await call("DELETE", urlA)).status === 404);
}
{
  // The dangerous case: a wiped config (empty keep) must still spare the newest file,
  // because the write that would reference it may not have landed yet.
  fakeSettings.value = { enabled: true, windowImage: "" };
  const r = await call("POST", "/dsh-image-skin/gc");
  check("gc with empty keep spares the newest file", json(r)?.removed?.length === 0, r.body);
  check("newest file still present", listFiles().length === 1, JSON.stringify(listFiles()));
}
{
  // A file referenced only by a per-mode override must survive the sweep — the keep set
  // is scanned generically, so new `${area}Image<Mode>` fields have to be covered too.
  const urlPerMode = json(await call("POST", "/dsh-image-skin/upload", JSON.stringify({ image: dataUri })))?.url;
  const namePerMode = urlPerMode.split("/").pop();
  backdate(namePerMode);
  fakeSettings.value = { enabled: true, centerImageDark: urlPerMode };
  const report = json(await call("POST", "/dsh-image-skin/gc"));
  check("gc keeps a per-mode-only file", existsSync(join(home, "image-skin", namePerMode)), JSON.stringify(report));
  check("gc kept exactly that one reference", report?.kept === 1, JSON.stringify(report));
}

console.log("== ai accent: providers ==");
{
  const r = await call("GET", "/dsh-image-skin/providers");
  const body = json(r);
  check("GET /providers -> 200", r.status === 200, `got ${r.status}`);
  check("eight presets offered", body?.providers?.length === 8, JSON.stringify(body?.providers?.length));
  check("four AI strengths advertised (level 0 is local palette)", body?.strengths === 4, String(body?.strengths));
  const ark = body?.providers?.find((p) => p.id === "ark-seedream");
  check("ark preset carries its env var name", ark?.keyEnv === "ARK_API_KEY", JSON.stringify(ark));
  check("envReady is false while the env var is unset", ark?.envReady === false, JSON.stringify(ark?.envReady));
  check("custom preset ships without a url/model", body?.providers?.find((p) => p.id === "custom")?.baseUrl === "", r.body);
}

console.log("== ai accent: prompt ==");
{
  const r = await call(
    "POST",
    "/dsh-image-skin/prompt",
    JSON.stringify({ style: "rococo", palette: ["17, 34, 51", "170, 187, 204"], strength: 3, material: "sky" }),
  );
  const p = json(r)?.prompt ?? "";
  check("POST /prompt -> 200", r.status === 200, `got ${r.status}`);
  check("prompt carries the palette rgb triplets", p.includes("17, 34, 51") && p.includes("170, 187, 204"), p.slice(0, 140));
  check("prompt forbids text and figures", /no text/.test(p) && /no animals/.test(p), p.slice(-180));
  check("prompt mentions the requested style", /rococo/i.test(p), p.slice(-180));
  // 借材: the material read off the artwork decides what the ornament is made of.
  check("prompt names the borrowed material", /material: fine silver filigree/.test(p), p.slice(-200));
  const noMaterial = json(await call("POST", "/dsh-image-skin/prompt", JSON.stringify({ style: "x", palette: [], strength: 2 })))?.prompt ?? "";
  check("an unknown/absent material adds no line", !/material:/.test(noMaterial), noMaterial.slice(-160));
}

console.log("== ai accent: gen ==");
// The generation route reaches the outside world only through global fetch, so a scripted
// fetch is enough to drive every branch — no key, no network.
const realFetch = globalThis.fetch;
function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return calls;
}
const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
const okGen = { providerId: "custom", baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKey: "k", prompt: "border" };
{
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify({ providerId: "nope", prompt: "x" }));
  check("unknown provider -> 400", r.status === 400, `got ${r.status} ${r.body}`);
}
{
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify({ providerId: "custom", prompt: "x" }));
  check("custom without url/model -> 400", r.status === 400, `got ${r.status} ${r.body}`);
  const r2 = await call(
    "POST",
    "/dsh-image-skin/gen",
    JSON.stringify({ providerId: "custom", baseUrl: "http://127.0.0.1:9/v1", model: "m", prompt: "x" }),
  );
  check("custom without any key -> 400 naming the gap", r2.status === 400 && /API Key/.test(json(r2)?.error ?? ""), r2.body);
}
{
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify({ providerId: "ark-seedream", prompt: "x" }));
  const body = json(r);
  check(
    "preset without an env key -> 400 naming ARK_API_KEY",
    r.status === 400 && /API Key/.test(body?.error ?? "") && /ARK_API_KEY/.test(body?.hint ?? ""),
    r.body,
  );
}
{
  // Happy path with a provider that answers with a data URI: nothing else gets fetched.
  const calls = mockFetch(async () => jsonResponse({ data: [{ b64_json: PNG }] }));
  const before = listFiles().length;
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify({ ...okGen, count: 99, size: "512x512" }));
  const body = json(r);
  check("gen -> 200 with a stored url", r.status === 200 && body?.urls?.length === 1, r.body);
  check("stored url is a served file", /^\/dsh-image-skin\/files\/[0-9a-f-]+\.png$/.test(body?.urls?.[0] ?? ""), String(body?.urls?.[0]));
  check("generated file landed on disk", listFiles().length === before + 1, JSON.stringify(listFiles()));
  check("a manual key is reported as coming from settings", body?.keyFrom === "settings", JSON.stringify(body));
  const sent = JSON.parse(calls[0]?.init?.body ?? "{}");
  check("count is clamped to four", sent.n === 4, JSON.stringify(sent));
  check("size is forwarded", sent.size === "512x512", JSON.stringify(sent));
  check("key travels in the Authorization header", calls[0]?.init?.headers?.authorization === "Bearer k", JSON.stringify(calls[0]?.init?.headers));
  check("openai-shaped body keeps response_format url", sent.response_format === "url", JSON.stringify(sent));
  globalThis.fetch = realFetch;
}
{
  // Ark: key from the environment, a remote image url in the reply, which must then be downloaded.
  process.env.ARK_API_KEY = "env-key";
  const calls = mockFetch(async (url) => {
    if (url.includes("/images/generations")) return jsonResponse({ data: [{ url: "http://127.0.0.1:9/ornament.png" }] });
    return new Response(Buffer.from(PNG, "base64"), { status: 200, headers: { "content-type": "image/png" } });
  });
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify({ providerId: "ark-seedream", prompt: "frame" }));
  const body = json(r);
  check("an env-provided key is preferred over a typed one", r.status === 200 && body?.keyFrom === "env", r.body);
  const sent = JSON.parse(calls[0]?.init?.body ?? "{}");
  check("ark payload asks for a url and no watermark", sent.response_format === "url" && sent.watermark === false, JSON.stringify(sent));
  check("ark model comes from the preset", sent.model === "doubao-seedream-4-0-250828", JSON.stringify(sent));
  check("a remote reply is downloaded and stored", /\/files\/[0-9a-f-]+\.png$/.test(body?.urls?.[0] ?? ""), String(body?.urls?.[0]));
  delete process.env.ARK_API_KEY;
  globalThis.fetch = realFetch;
}
{
  mockFetch(async () => jsonResponse({ data: [] }));
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify(okGen));
  check("a reply without images -> 502", r.status === 502, `${r.status} ${r.body}`);
  globalThis.fetch = realFetch;
}
{
  mockFetch(async () => new Response("denied", { status: 401 }));
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify(okGen));
  check("provider error -> 502 quoting the status", r.status === 502 && /401/.test(json(r)?.error ?? ""), r.body);
  globalThis.fetch = realFetch;
}
{
  mockFetch(async () => {
    throw new Error("ECONNREFUSED");
  });
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify(okGen));
  const body = json(r);
  check(
    "unreachable provider -> 502, friendly error + raw detail",
    r.status === 502 && /连不上/.test(body?.error ?? "") && /ECONNREFUSED/.test(body?.detail ?? ""),
    r.body,
  );
  globalThis.fetch = realFetch;
}
check("global fetch is restored", globalThis.fetch === realFetch);

console.log("== ai accent: dashscope (submit + poll) ==");
{
  // Image synthesis at Alibaba Model Studio is asynchronous: POST the job, then poll the task id.
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/services/aigc/text2image/image-synthesis")) {
      return new Response(JSON.stringify({ output: { task_id: "t-1", task_status: "PENDING" } }), { status: 200 });
    }
    if (u.endsWith("/tasks/t-1")) {
      const polls = calls.filter((c) => c.url.endsWith("/tasks/t-1")).length;
      if (polls < 2) return new Response(JSON.stringify({ output: { task_id: "t-1", task_status: "RUNNING" } }), { status: 200 });
      return new Response(JSON.stringify({ output: { task_id: "t-1", task_status: "SUCCEEDED", results: [{ url: "http://127.0.0.1:9/ornament.png" }] } }), { status: 200 });
    }
    return new Response(Buffer.from(PNG, "base64"), { status: 200, headers: { "content-type": "image/png" } });
  };
  const r = await call(
    "POST",
    "/dsh-image-skin/gen",
    JSON.stringify({ providerId: "dashscope-wanx", apiKey: "k", prompt: "border", count: 2, size: "720x1280" }),
  );
  const body = json(r);
  check("dashscope: submit + poll -> 200 with a stored image", r.status === 200 && body?.urls?.length === 1, `${r.status} ${r.body}`);
  const submit = calls.find((c) => c.url.endsWith("/services/aigc/text2image/image-synthesis"));
  const sent = JSON.parse(submit?.init?.body ?? "{}");
  check("dashscope: sizes use * not x", sent?.parameters?.size === "720*1280", JSON.stringify(sent));
  check("dashscope: prompt rides in input.prompt", sent?.input?.prompt === "border", JSON.stringify(sent));
  check("dashscope: asks for async processing", submit?.init?.headers?.["X-DashScope-Async"] === "enable", JSON.stringify(submit?.init?.headers));
  check("dashscope: the preset model is used by default", sent?.model === "wanx2.1-t2i-turbo", String(sent?.model));
  check("dashscope: polls the task until it succeeds", calls.filter((c) => c.url.endsWith("/tasks/t-1")).length === 2, String(calls.length));
  globalThis.fetch = realFetch;
}
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/services/aigc/text2image/image-synthesis")) {
      return new Response(JSON.stringify({ output: { task_id: "t-2", task_status: "PENDING" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ output: { task_status: "FAILED", code: "DataInspectionFailed", message: "blocked" } }), { status: 200 });
  };
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify({ providerId: "dashscope-wanx", apiKey: "k", prompt: "border" }));
  const body = json(r);
  check("dashscope: a failed task -> 502 quoting the status", r.status === 502 && /FAILED/.test(body?.detail ?? ""), r.body);
  check("dashscope: a failed task gets a hint too", typeof body?.hint === "string" && body.hint.length > 4, JSON.stringify(body?.hint));
  globalThis.fetch = realFetch;
}
{
  globalThis.fetch = async () => new Response(JSON.stringify({ output: { task_status: "PENDING" } }), { status: 200 });
  const r = await call("POST", "/dsh-image-skin/gen", JSON.stringify({ providerId: "dashscope-wanx", apiKey: "k", prompt: "border" }));
  check("dashscope: no task id -> 502 naming it", r.status === 502 && /task_id/.test(json(r)?.detail ?? ""), r.body);
  globalThis.fetch = realFetch;
}

console.log("== ai accent: count means independent jobs ==");
{
  // "2 张" has to mean two separate jobs: one request carrying n=2 comes back as the same picture
  // twice on more than one service, and DashScope does not document `n` at all.
  const calls = [];
  let seq = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/services/aigc/text2image/image-synthesis")) {
      return new Response(JSON.stringify({ output: { task_id: `t-${++seq}`, task_status: "PENDING" } }), { status: 200 });
    }
    const taskId = /\/tasks\/(t-\d+)$/.exec(u)?.[1];
    if (taskId) {
      return new Response(
        JSON.stringify({ output: { task_id: taskId, task_status: "SUCCEEDED", results: [{ url: `http://127.0.0.1:9/${taskId}.png` }] } }),
        { status: 200 },
      );
    }
    return new Response(Buffer.from(PNG, "base64"), { status: 200, headers: { "content-type": "image/png" } });
  };
  const r = await call(
    "POST",
    "/dsh-image-skin/gen",
    JSON.stringify({ providerId: "dashscope-wanx", apiKey: "k", prompt: "border", count: 2 }),
  );
  const body = json(r);
  const submits = calls.filter((c) => c.url.endsWith("/services/aigc/text2image/image-synthesis"));
  check("count=2 -> two submissions", submits.length === 2, String(submits.length));
  check("count=2 -> two stored images", r.status === 200 && body?.urls?.length === 2, `${r.status} ${r.body}`);
  const sent = JSON.parse(submits[0]?.init?.body ?? "{}");
  // n must be explicit: 万相 returns four pictures when it is omitted, so "1 张" would bill for four.
  check("count rides on separate jobs, with n pinned to 1", sent?.parameters?.n === 1, JSON.stringify(sent));
  globalThis.fetch = realFetch;
}

console.log("== ai accent: key probe + streaming ==");
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    return new Response("nope", { status: 500 });
  };
  const good = json(await call("POST", "/dsh-image-skin/test", JSON.stringify({ providerId: "openai-image", apiKey: "k" })));
  check("key probe: a good key reports ok", good?.ok === true, JSON.stringify(good));
  globalThis.fetch = async () => new Response("denied", { status: 401 });
  const bad = json(await call("POST", "/dsh-image-skin/test", JSON.stringify({ providerId: "openai-image", apiKey: "k" })));
  check("key probe: a bad key is reported as such", bad?.ok === false && /401/.test(bad?.detail ?? ""), JSON.stringify(bad));
  const none = json(await call("POST", "/dsh-image-skin/test", JSON.stringify({ providerId: "openai-image" })));
  check("key probe: no key -> ok:false with a hint", none?.ok === false && /API Key/.test(none?.detail ?? ""), JSON.stringify(none));
  globalThis.fetch = realFetch;
}
{
  // The streaming route reports stages, then the same body the plain route would return.
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/services/aigc/text2image/image-synthesis")) {
      return new Response(JSON.stringify({ output: { task_id: "s-1", task_status: "PENDING" } }), { status: 200 });
    }
    if (u.endsWith("/tasks/s-1")) {
      return new Response(JSON.stringify({ output: { task_id: "s-1", task_status: "SUCCEEDED", results: [{ url: "http://127.0.0.1:9/o.png" }] } }), { status: 200 });
    }
    return new Response(Buffer.from(PNG, "base64"), { status: 200, headers: { "content-type": "image/png" } });
  };
  const r = await call("POST", "/dsh-image-skin/gen/stream", JSON.stringify({ providerId: "dashscope-wanx", apiKey: "k", prompt: "border" }));
  const joined = (r.chunks ?? []).join("");
  check("stream: answers with an event stream", /text\/event-stream/.test(String(r.headers?.["content-type"])), String(r.headers?.["content-type"]));
  check("stream: reports the submit stage", joined.includes('"stage":"submitted"'), joined.slice(0, 200));
  check("stream: reports the queued/running stage", /"stage":"(queued|running)"/.test(joined), joined.slice(0, 300));
  check("stream: ends with done + urls", /"stage":"done"/.test(joined) && /\/dsh-image-skin\/files\//.test(joined), joined.slice(-220));
  globalThis.fetch = realFetch;
}

console.log("== disposer ==");
check("effect kept the route disposer", typeof capturedDisposer === "function");
capturedDisposer?.();
check("disposing removes the route", routeDisposed === true);

console.log(`\nfiles left in skin dir: ${listFiles().length}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
