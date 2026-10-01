/**
 * Offline unit test for the browser half's pure helpers.
 *
 * `lib/client.js` is a CommonJS factory wrapped in `window.__ModuleLoader__.load({...})`,
 * so it can be evaluated in Node with a fake loader and a stub `react`: no DOM, no browser.
 * Only the pure helpers are exercised here — rendering is covered by using the plugin.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundle = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const bundleSource = readFileSync(bundle, "utf8");

const reactStub = {
  createElement: () => null,
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useMemo: (fn) => fn(),
  useSyncExternalStore: () => undefined,
};

let definition = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (d) => {
      definition = d;
    },
  },
};
new Function(bundleSource)();
if (!definition) {
  console.error("FAIL  the client bundle never called window.__ModuleLoader__.load");
  process.exit(1);
}
const mod = definition.factory((name) => {
  if (name === "react") return reactStub;
  throw new Error(`unexpected require("${name}")`);
});

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

console.log("== bundle ==");
check("factory exports apply()", typeof mod.apply === "function");
check(
  "inject declares only the seats both Host generations provide",
  Array.isArray(mod.inject) && mod.inject.length === 2 && ["slots", "theme"].every((s) => mod.inject.includes(s)),
  JSON.stringify(mod.inject),
);
check("resolveAreaImage is exposed", typeof mod.resolveAreaImage === "function");
check("createSettingsScope is exposed", typeof mod.createSettingsScope === "function");

// A 0.2-line Host refuses a settings write to any path its Config schema does not
// declare, so every field this half reads or writes has to exist in the Host schema.
// Only unambiguous names are checked: explicit `onSet("x")`/`apply("x")` literals plus
// the `accent…` family this half owns (the `v.<name>` reads also hit DOM/video objects,
// whose properties are not settings fields).
{
  const host = await import(new URL("../lib/index.js", import.meta.url).href);
  const declared = new Set(host.SKIN_FIELDS);
  const writes = new Set();
  for (const m of bundleSource.matchAll(/\b(?:onSet|apply|scope\.set)\(\s*"([A-Za-z][A-Za-z0-9]*)"/g)) writes.add(m[1]);
  for (const m of bundleSource.matchAll(/\b(?:v|value)\.(accent[A-Za-z0-9]*)/g)) writes.add(m[1]);
  const undeclared = [...writes].filter((field) => !declared.has(field)).sort();
  check("every settings field this half touches is declared by the Host", undeclared.length === 0, `undeclared: ${undeclared.join(", ")}`);
  check("the accent family is actually covered by the cross-check", writes.has("accentLevel") && writes.has("accentCount"), [...writes].length);
}

console.log("== settings transport across Host generations ==");
/** Cordis-shaped fake: `inject` runs the callback for every service it already has. */
function fakeContext(services) {
  return {
    effect: () => {},
    inject: (deps, fn) => {
      if (deps.every((dep) => services[dep] !== undefined)) return fn({ ...services, inject: undefined, get: (name) => services[name] });
      return undefined;
    },
    get: (name) => services[name],
  };
}
function fakeScope(initial) {
  const listeners = new Set();
  let value = initial;
  let status = "ready";
  return {
    scope: {
      getSnapshot: () => ({ status, value }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set: (field, next) => {
        value = { ...value, [field]: next };
        for (const listener of listeners) listener();
        return Promise.resolve();
      },
      unset: () => Promise.resolve(),
    },
    publish(next) {
      value = next;
      status = next === undefined ? "loading" : "ready";
      for (const listener of listeners) listener();
    },
    written: () => value,
  };
}

// 0.2-line Host: the namespace is the entry's live Config, reached through `configForms`.
{
  const fake = fakeScope({ enabled: true, windowImage: "a.png" });
  const calls = [];
  const form = {
    getSnapshot: () => fake.scope.getSnapshot(),
    subscribe: (listener) => fake.scope.subscribe(listener),
    set: (field, value) => (calls.push(["set", field, value]), fake.scope.set(field, value)),
    unset: (field) => (calls.push(["unset", field]), fake.scope.unset(field)),
  };
  const scope = mod.createSettingsScope(fakeContext({ configForms: { get: (ns) => (calls.push(["get", ns]), form) } }));
  let notified = 0;
  scope.subscribe(() => notified++);
  check("configForms: the namespace is the plugin entry id", calls[0]?.[0] === "get" && calls[0]?.[1] === "ui-image-skin", JSON.stringify(calls[0]));
  check("configForms: the initial value is read", scope.getSnapshot().value?.windowImage === "a.png" && scope.getSnapshot().status === "ready");
  fake.publish({ enabled: true, windowImage: "b.png" });
  check("configForms: a value change notifies subscribers", notified === 1 && scope.getSnapshot().value?.windowImage === "b.png");
  void scope.set("windowImage", "c.png");
  check("configForms: set() writes through the form", calls.at(-1)?.[0] === "set" && fake.written().windowImage === "c.png");
}

// 0.1-line Host: a durable namespace bound through `settingsScope`.
{
  const fake = fakeScope({ enabled: false, windowImage: "old.png" });
  const binds = [];
  const scope = mod.createSettingsScope(
    fakeContext({
      settingsScope: {
        bind: (spec) => (binds.push(spec), fake.scope),
      },
    }),
  );
  check("settingsScope: the namespace is bound", binds[0]?.namespace === "ui-image-skin", JSON.stringify(binds[0]));
  check("settingsScope: the initial value is read", scope.getSnapshot().value?.windowImage === "old.png");
  fake.publish(undefined);
  check("settingsScope: a cleared value reports loading", scope.getSnapshot().status === "loading" && scope.getSnapshot().value === undefined);
}

// Neither face: the skin stays inert instead of throwing.
{
  const scope = mod.createSettingsScope(fakeContext({}));
  check("no settings face: the snapshot stays empty", scope.getSnapshot().status === "loading" && scope.getSnapshot().value === undefined);
  let resolved = true;
  await scope.set("windowImage", "x.png").then(
    () => {},
    () => {
      resolved = false;
    },
  );
  // 契约变更（2026-10-01）：设置还没绑定时**排队等就绪**，不再 reject ——
  // 旧行为会在“刚装完第一次启动”时往控制台丢一个红色 “settings are not ready” 错误。
  check("no settings face: set() queues instead of rejecting", resolved);
}

console.log("== per-mode image resolution ==");
const full = { centerImage: "shared.png", centerImageLight: "light.png", centerImageDark: "dark.png" };
check("dark picks the dark override", mod.resolveAreaImage(full, "center", "dark") === "dark.png");
check("light picks the light override", mod.resolveAreaImage(full, "center", "light") === "light.png");
check(
  "an empty override falls back to the shared image",
  mod.resolveAreaImage({ centerImage: "shared.png", centerImageDark: "" }, "center", "dark") === "shared.png",
);
check("no override at all falls back to shared", mod.resolveAreaImage({ centerImage: "shared.png" }, "center", "light") === "shared.png");
check("an override only affects its own mode", mod.resolveAreaImage({ centerImageDark: "dark.png" }, "center", "light") === "");
check("nothing configured resolves empty", mod.resolveAreaImage({}, "center", "dark") === "");
check("an undefined value is tolerated", mod.resolveAreaImage(undefined, "window", "light") === "");
check("an unknown area resolves empty", mod.resolveAreaImage(full, "nope", "dark") === "");

console.log("== the AI gate ==");
check("windowHasArtwork is exposed", typeof mod.windowHasArtwork === "function");
check("no value at all -> locked", mod.windowHasArtwork(undefined) === false);
check("an empty value -> locked", mod.windowHasArtwork({}) === false);
check("a shared window image -> unlocked", mod.windowHasArtwork({ windowImage: "w.png" }) === true);
check("a light-only window image -> unlocked", mod.windowHasArtwork({ windowImageLight: "l.png" }) === true);
check("a dark-only window image -> unlocked", mod.windowHasArtwork({ windowImageDark: "d.png" }) === true);
check("an empty string does not unlock", mod.windowHasArtwork({ windowImage: "", windowImageDark: "" }) === false);
check(
  "other regions never unlock the AI screen",
  mod.windowHasArtwork({ centerImage: "c.png", stickerSidebarImage: "s.png" }) === false,
);

// ── 染色阶梯是一条“坡”，不是“台阶” ────────────────────────────────────────────
// The slider is stepless, so the level can be 2.5. When the ladder indexed its arrays the tint
// snapped between rungs and dragging felt notchy (小肖 reported "一卡一卡的"). Pin the math.
console.log("\n== accent ramp ==");
{
  const ramp = mod.rampLadder;
  const alpha = mod.ACCENT_ALPHA;
  const cover = mod.ACCENT_COVER.dark;
  check("rampLadder is exposed", typeof ramp === "function");
  check("hits the stops exactly", ramp(alpha, 2) === 0.33 && ramp(alpha, 3) === 0.38, `${ramp(alpha, 2)}/${ramp(alpha, 3)}`);
  check("interpolates halfway (2.5)", Math.abs(ramp(alpha, 2.5) - 0.355) < 1e-9, String(ramp(alpha, 2.5)));
  check("interpolates a quarter step (2.25)", Math.abs(ramp(alpha, 2.25) - 0.3425) < 1e-9, String(ramp(alpha, 2.25)));
  check("is monotonic between rungs", ramp(alpha, 0) < ramp(alpha, 1.5) && ramp(alpha, 1.5) < ramp(alpha, 4), "");
  check("clamps out-of-range input", ramp(alpha, -3) === alpha[0] && ramp(alpha, 99) === alpha[4], "");
  check("cover ramp interpolates too", Math.abs(ramp(cover, 0.5) - 0.2) < 1e-9, String(ramp(cover, 0.5)));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
