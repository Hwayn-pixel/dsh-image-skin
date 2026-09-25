#!/usr/bin/env node
/**
 * Offline stand-in for a text-to-image service, for testing the AI-ornament flow without a key.
 *
 * It speaks just enough of the OpenAI shape that the plugin's `自定义（OpenAI 兼容）` provider can
 * point at it:
 *
 *   node tools/demo-provider.mjs            # listens on http://127.0.0.1:8899/v1
 *   node tools/demo-provider.mjs 9000       # ...or another port
 *
 * Then in DSH: 设置 → 图片皮肤 → AI 纹样 → 服务商「自定义」, Base URL
 * `http://127.0.0.1:8899/v1`, 模型 ID `demo`, Key 随便填一个字, 点「生成装饰」.
 *
 * The ornament is drawn locally from the colour palette in the prompt (`colour palette r, g, b / ...`),
 * so it is deterministic: same prompt in, same picture out. `n` pictures come back as n *variants*
 * (a bigger centre mark each), because a demo that returns the same file n times is indistinguishable
 * from a bug in the plugin. No network, no key, no cost.
 */
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const PORT = Number(process.argv[2] ?? process.env.DEMO_PROVIDER_PORT ?? 8899);
const SIZE = 512;

// ── a very small PNG writer (no dependencies) ────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** Encode an RGBA buffer (width*height*4) as a PNG. */
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── a deterministic ornament drawn from the requested palette ────────────────────────────────
class Canvas {
  constructor(size) {
    this.size = size;
    this.data = Buffer.alloc(size * size * 4);
  }
  put(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size || a <= 0) return;
    const i = (y * this.size + x) * 4;
    const src = a / 255;
    const dst = this.data[i + 3] / 255;
    const out = src + dst * (1 - src);
    if (out <= 0) return;
    for (let c = 0; c < 3; c++) {
      this.data[i + c] = Math.round(([r, g, b][c] * src + this.data[i + c] * dst * (1 - src)) / out);
    }
    this.data[i + 3] = Math.round(out * 255);
  }
  bar(x, y, w, h, colour) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.put(x + dx, y + dy, colour);
  }
  frame(x, y, w, h, t, colour) {
    this.bar(x, y, w, t, colour);
    this.bar(x, y + h - t, w, t, colour);
    this.bar(x, y, t, h, colour);
    this.bar(x + w - t, y, t, h, colour);
  }
  dot(cx, cy, radius, colour) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) this.put(cx + dx, cy + dy, colour);
      }
    }
  }
  diamond(cx, cy, radius, colour) {
    for (let dy = -radius; dy <= radius; dy++) {
      const span = radius - Math.abs(dy);
      for (let dx = -span; dx <= span; dx++) this.put(cx + dx, cy + dy, colour);
    }
  }
  /** A straight (or stepped) run of dots - the only curve primitive this toy canvas needs. */
  line(x1, y1, x2, y2, thickness, colour) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      this.dot(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), thickness, colour);
    }
  }
  /** Dots around a circle: rosettes, bead chains, and anything that has to read as "worked". */
  ring(cx, cy, radius, count, dotRadius, colour, alpha = 255) {
    const tinted = [...colour.slice(0, 3), alpha];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.dot(Math.round(cx + Math.cos(a) * radius), Math.round(cy + Math.sin(a) * radius), dotRadius, tinted);
    }
  }
  /** A scallop: one arc's worth of dots, the classic lace edge. */
  scallop(cx, cy, radius, count, dotRadius, colour, alpha = 255) {
    const tinted = [...colour.slice(0, 3), alpha];
    for (let i = 0; i <= count; i++) {
      const a = Math.PI + (i / count) * Math.PI;
      this.dot(Math.round(cx + Math.cos(a) * radius), Math.round(cy + Math.sin(a) * radius), dotRadius, tinted);
    }
  }
}

/** Pull the palette the plugin put in the prompt; fall back to a neutral pair. */
function paletteFromPrompt(prompt) {
  const match = /colour palette ([^.]*)/i.exec(prompt);
  const colours = [];
  if (match) {
    for (const part of match[1].split("/")) {
      const rgb = part.match(/(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
      if (rgb) colours.push([Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), 255]);
    }
  }
  if (!colours.length) colours.push([150, 165, 190, 255]);
  if (!colours[1]) colours[1] = colours[0].map((v, i) => (i === 3 ? v : Math.max(0, v - 60)));
  return colours;
}

/**
 * Draw the ornament for a prompt.
 *
 * Strength picks the ladder the plugin also draws locally: 1-2 a plain rail, 3 a worked frame
 * (beaded rails, corner rosettes, a lace edge), 4 an ornate one (a second beaded rail, ringed
 * rosettes, edge lozenges, a centre medallion). `variant` moves the motifs so two pictures from one
 * prompt are never confusable.
 */
function drawOrnament(prompt, variant = 0) {
  const [base, alt] = paletteFromPrompt(prompt);
  const strength = /embossed|jewelled/i.test(prompt) ? 4 : /rich layered|ornate corner flourishes/i.test(prompt) ? 3 : /clear corner motif/i.test(prompt) ? 2 : 1;
  const faint = (c, a) => [...c.slice(0, 3), a];
  const c = new Canvas(SIZE);
  const inset = 12 + (variant % 2) * 6;
  const worked = strength >= 3;
  const ornate = strength >= 4;

  // rails
  c.frame(inset, inset, SIZE - inset * 2, SIZE - inset * 2, worked ? 8 : 7, base);
  c.frame(inset + 22, inset + 22, SIZE - (inset + 22) * 2, SIZE - (inset + 22) * 2, 3, alt);
  if (worked) {
    c.frame(inset + 40, inset + 40, SIZE - (inset + 40) * 2, SIZE - (inset + 40) * 2, 1, faint(alt, 180));
  }

  const lo = inset + 14;
  const hi = SIZE - inset - 15;
  const mid = (lo + hi) / 2;
  const corners = [
    [inset + 44, inset + 44],
    [SIZE - inset - 45, inset + 44],
    [inset + 44, SIZE - inset - 45],
    [SIZE - inset - 45, SIZE - inset - 45],
  ];

  if (worked) {
    // corner rosettes: the single motif that makes a frame read as an ornament
    for (const [cx, cy] of corners) {
      c.ring(cx, cy, 16, ornate ? 12 : 8, ornate ? 4 : 5, base);
      c.diamond(cx, cy, ornate ? 11 : 8, alt);
      if (ornate) c.ring(cx, cy, 30, 16, 2, faint(alt, 150));
    }
    // a beaded chain along both rails, plus a lace edge underneath it
    const beadGap = worked ? 34 : 40;
    for (let t = lo + 24; t <= hi - 24; t += beadGap) {
      c.dot(t, inset + 40, 5, base);
      c.dot(t, SIZE - inset - 41, 5, base);
      c.dot(inset + 40, t, 5, base);
      c.dot(SIZE - inset - 41, t, 5, base);
      c.dot(t, inset + 40, 2, alt);
      c.dot(inset + 40, t, 2, alt);
      if (ornate) {
        c.scallop(t + beadGap / 2, inset + 33, 11, 8, 2, faint(alt, 170));
        c.scallop(inset + 33, t + beadGap / 2, 11, 8, 2, faint(alt, 170));
      }
    }
    if (ornate) {
      for (let t = lo + 40; t <= hi - 40; t += 48) {
        // edge lozenges, alternating with the bead chain
        c.diamond(t, inset + 40, 5, alt);
        c.diamond(inset + 40, t, 5, alt);
      }
    }
  } else {
    const steps = (strength >= 3 ? 9 : 6) + (variant % 3);
    for (let i = 1; i < steps; i++) {
      const t = Math.round((SIZE / steps) * i);
      const r = 4;
      c.dot(t, inset + 34, r, alt);
      c.dot(t, SIZE - inset - 35, r, alt);
      c.dot(inset + 34, t, r, alt);
      c.dot(SIZE - inset - 35, t, r, alt);
    }
  }

  // a centre medallion, so a full picture is complete on its own; its size carries the variant
  const medallion = ornate ? 46 + variant * 6 : worked ? 30 + variant * 5 : 14 + variant * 4;
  if (worked) {
    c.ring(mid, mid, medallion, ornate ? 20 : 12, 3, faint(alt, 200));
    c.diamond(mid, mid, Math.round(medallion / 3.2), base);
    if (ornate) c.ring(mid, mid, medallion - 10, 8, 6, alt);
  } else if (variant > 0) {
    c.diamond(mid, mid, 10 + variant * 4, base);
    c.diamond(mid, mid, 5 + variant * 2, alt);
    c.dot(mid, mid, 2 + variant, base);
  }
  return encodePng(c.data, SIZE, SIZE);
}

// ── the HTTP half ────────────────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const tasks = new Map();          // DashScope-style job ids -> { png, polls, count, prompt }
let taskSeq = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, model: "demo", openai: "/v1/images/generations", dashscope: "/api/v1/services/aigc/text2image/image-synthesis" }));
    return;
  }

  // ── DashScope: submit a job, then poll its task id (通义万相/千问走的就是这套） ──
  if (req.method === "POST" && /\/services\/aigc\/text2image\/image-synthesis$/.test(url.pathname)) {
    let prompt = "";
    let count = 1;
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      prompt = String(body?.input?.prompt ?? body?.prompt ?? "");
      count = Math.max(1, Math.min(4, Math.round(Number(body?.parameters?.n ?? body?.n) || 1)));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "InvalidParameter", message: "bad json" }));
      return;
    }
    const id = `demo-task-${++taskSeq}`;
    // Each job starts at a different variant: two independent jobs are two different samples on a
    // real service, and a demo that answers with the same picture twice hides plugin bugs.
    tasks.set(id, { seed: taskSeq % 4, polls: 0, count, prompt });    console.log(`[demo-provider] dashscope job ${id}: ${count} 张 · ${prompt.slice(0, 50)}…`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ request_id: `demo-${id}`, output: { task_id: id, task_status: "PENDING" } }));
    return;
  }
  const taskMatch = /\/tasks\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (req.method === "GET" && taskMatch) {
    const job = tasks.get(taskMatch[1]);
    if (!job) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ output: { task_status: "UNKNOWN" } }));
      return;
    }
    // Answer RUNNING once, so the poll loop is genuinely exercised.
    job.polls += 1;
    if (job.polls < 2) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ output: { task_id: taskMatch[1], task_status: "RUNNING" } }));
      return;
    }
    const results = Array.from({ length: job.count }, (_, i) => ({ url: `http://127.0.0.1:${PORT}/ornament/${taskMatch[1]}-${i}.png` }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ request_id: `demo-${taskMatch[1]}`, output: { task_id: taskMatch[1], task_status: "SUCCEEDED", results } }));
    return;
  }
  const ornamentMatch = /\/ornament\/([A-Za-z0-9_-]+)\.png$/.exec(url.pathname);
  if (req.method === "GET" && ornamentMatch) {
    // `<id>.png` is variant 0; `<id>-<n>.png` is the n-th picture of that job.
    const name = ornamentMatch[1];
    const suffix = /-(\d+)$/.exec(name);
    const exact = tasks.get(name);
    const job = exact ?? (suffix ? tasks.get(name.slice(0, -suffix[0].length)) : undefined);
    const index = !exact && suffix ? Number(suffix[1]) : 0;
    const variant = job ? ((job.seed ?? 0) + index) % 4 : 0;
    res.writeHead(200, { "content-type": "image/png" });
    res.end(job ? drawOrnament(job.prompt, variant) : drawOrnament(""));
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/images/generations") {
    let prompt = "";
    let count = 1;
    let requested = SIZE;
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      prompt = String(body.prompt ?? "");
      count = Math.max(1, Math.min(4, Math.round(Number(body.n) || 1)));
      const size = /^(\d{2,4})x(\d{2,4})$/.exec(String(body.size ?? ""));
      if (size) requested = Number(size[1]);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad json" } }));
      return;
    }
    const data = Array.from({ length: count }, (_, i) => ({
      b64_json: drawOrnament(prompt, i).toString("base64"),
      revised_prompt: `demo ornament #${i + 1} of ${count} at ${requested}px`,
    }));
    console.log(`[demo-provider] ${count} × ${requested}px for prompt: ${prompt.slice(0, 60)}…`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ created: Math.floor(Date.now() / 1000), data }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "demo provider only serves POST /v1/images/generations" } }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[demo-provider] listening on http://127.0.0.1:${PORT}/v1`);
  console.log(`[demo-provider] point the plugin at  Base URL = http://127.0.0.1:${PORT}/v1 , 模型 ID = demo , Key = 任意`);
});
