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
new Function(readFileSync(bundle, "utf8"))();
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
  "inject declares slots + settingsScope + theme",
  Array.isArray(mod.inject) && ["slots", "settingsScope", "theme"].every((s) => mod.inject.includes(s)),
  JSON.stringify(mod.inject),
);
check("resolveAreaImage is exposed", typeof mod.resolveAreaImage === "function");

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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
