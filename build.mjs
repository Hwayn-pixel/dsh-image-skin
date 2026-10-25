/**
 * dsh-image-skin build script.
 *
 *  - src/index.ts        -> lib/index.js   (ESM, imports preserved — Host half)
 *  - src/client/index.ts -> lib/client.js  (CommonJS body wrapped in the
 *    client-modules loader format: window.__ModuleLoader__.load({ id, factory }))
 */
import { readFileSync, writeFileSync, watch, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, "src");
const libDir = join(root, "lib");

function transpile(file, moduleKind) {
  const source = readFileSync(join(srcDir, file), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: moduleKind,
      esModuleInterop: false,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      sourceMap: false,
    },
    fileName: file,
  });
  return result.outputText;
}

const CLIENT_ID = "dsh-image-skin";
const clientBanner = [
  `window.__ModuleLoader__.load({`,
  `\tid: ${JSON.stringify(CLIENT_ID)},`,
  `\tfactory: (require) => {`,
  `\t\tvar module = { exports: {} };`,
  `\t\tvar exports = module.exports;`,
  `\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
].join("\n");
const clientFooter = `\n\t\treturn module.exports;\n\t}\n});\n`;

function build() {
  mkdirSync(libDir, { recursive: true });
  const host = transpile("index.ts", ts.ModuleKind.ESNext);
  writeFileSync(join(libDir, "index.js"), host);
  const client = transpile(join("client", "index.ts"), ts.ModuleKind.CommonJS);
  // The effort slider is ported in from its own plugin: the loader runs a single factory, so the
  // ported module has to be appended into the same bundle file. It defines `activateEffortSlider`,
  // which index.ts calls (hoisted function declaration in the shared factory scope).
  const effort = transpile(join("client", "effort.js"), ts.ModuleKind.CommonJS);
  writeFileSync(join(libDir, "client.js"), `${clientBanner}\n${client}\n${effort}\n${clientFooter}`);
  console.log("dsh-image-skin: built lib/index.js + lib/client.js");
}

build();

if (process.argv.includes("--watch")) {
  console.log("dsh-image-skin: watching src/ for changes…");
  watch(srcDir, { recursive: true }, () => {
    try {
      build();
    } catch (error) {
      console.error("build failed:", error);
    }
  });
}
