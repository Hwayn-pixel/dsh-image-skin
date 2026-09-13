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
  const out = { status: 0, headers: null, body: null };
  const res = { writeHead: (s, h) => ((out.status = s), (out.headers = h)), end: (b) => (out.body = b) };
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

console.log("== disposer ==");
check("effect kept the route disposer", typeof capturedDisposer === "function");
capturedDisposer?.();
check("disposing removes the route", routeDisposed === true);

console.log(`\nfiles left in skin dir: ${listFiles().length}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
