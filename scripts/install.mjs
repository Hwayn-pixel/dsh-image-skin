#!/usr/bin/env node
/**
 * dsh-image-skin — one-command installer.
 *
 *   1. `dsh plugin --profile <name> add -w <plugin-dir>` — registers the bundle
 *      into the target DSH web profile.
 *   2. prints the "restart dsh web" reminder.
 *
 * Usage:
 *   node scripts/install.mjs                  # install into profile `web`
 *   node scripts/install.mjs --profile demo
 *   node scripts/install.mjs --dir /path/to/dsh-image-skin
 *   node scripts/install.mjs --dry-run
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

const args = process.argv.slice(2);
function valueOf(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
const profile = valueOf("--profile") || "web";
const pluginDir = valueOf("--dir") || root;
const skipAdd = args.includes("--skip-add");
const dryRun = args.includes("--dry-run");

function npmGlobalBin() {
  if (isWin) {
    const appData = process.env.APPDATA;
    if (appData) {
      const p = join(appData, "npm", "dsh.cmd");
      if (existsSync(p)) return p;
    }
  }
  return null;
}
function findDsh() {
  const explicit = process.env.DSH || process.env.DSH_CLI;
  if (explicit && existsSync(explicit)) return explicit;
  if (isWin) {
    for (const name of ["dsh.cmd", "dsh"]) {
      const which = spawnSync("where", [name], { shell: true, encoding: "utf8" });
      if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split(/\r?\n/)[0];
    }
  }
  return npmGlobalBin();
}
let dsh = findDsh();
if (!dsh) {
  if (dryRun) {
    dsh = "dsh";
    console.warn("[dsh-image-skin] 警告：未找到 dsh CLI（--dry-run 仅预览）。");
  } else {
    console.error("[dsh-image-skin] 未找到 dsh CLI。请安装 DeepSeek Harness 或把 dsh 加入 PATH。");
    process.exit(1);
  }
}
function run(label, cmd, cmdArgs, opts = {}) {
  console.log(`\n[dsh-image-skin] > ${label}`);
  console.log(`[dsh-image-skin]   $ ${[cmd, ...cmdArgs].join(" ")}`);
  if (dryRun) return;
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    console.error(`[dsh-image-skin] x ${label} 失败（exit ${res.status}）。`);
    process.exit(res.status ?? 1);
  }
  console.log(`[dsh-image-skin] + ${label} 完成`);
}

console.log(`[dsh-image-skin] 安装：profile=${profile} dir=${pluginDir}`);
console.log(`[dsh-image-skin] dsh CLI: ${dsh}`);

if (!skipAdd) {
  const addArgs = ["plugin", "--profile", profile, "add", "-w", pluginDir];
  run("注册 bundle 到 profile", dsh, addArgs, isWin ? { shell: true } : {});
}

console.log("\n[dsh-image-skin] 安装完成。");
console.log("[dsh-image-skin] 下一步：重启 dsh web 让配置生效（dsh web 或 dsh --profile " + profile + "）。");
