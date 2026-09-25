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
 * so it is deterministic: same prompt in, same picture out. No network, no key, no cost.
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

function drawOrnament(prompt) {
  const [base, alt] = paletteFromPrompt(prompt);
  const strength = /embossed|jewelled/i.test(prompt) ? 4 : /rich layered|ornate corner flourishes/i.test(prompt) ? 3 : /clear corner motif/i.test(prompt) ? 2 : 1;
  const c = new Canvas(SIZE);
  const inset = 12;
  // outer and inner rail
  c.frame(inset, inset, SIZE - inset * 2, SIZE - inset * 2, 7, base);
  c.frame(inset + 22, inset + 22, SIZE - (inset + 22) * 2, SIZE - (inset + 22) * 2, 3, alt);
  // corner motifs
  for (const [cx, cy] of [
    [inset + 40, inset + 40],
    [SIZE - inset - 41, inset + 40],
    [inset + 40, SIZE - inset - 41],
    [SIZE - inset - 41, SIZE - inset - 41],
  ]) {
    c.diamond(cx, cy, strength >= 3 ? 18 : 12, base);
    c.diamond(cx, cy, strength >= 3 ? 10 : 6, alt);
    if (strength >= 4) c.dot(cx, cy, 4, base);
  }
  // repeating edge figures
  const steps = strength >= 3 ? 9 : 6;
  for (let i = 1; i < steps; i++) {
    const t = Math.round((SIZE / steps) * i);
    const r = strength >= 3 ? 5 : 4;
    c.dot(t, inset + 34, r, alt);
    c.dot(t, SIZE - inset - 35, r, alt);
    c.dot(inset + 34, t, r, alt);
    c.dot(SIZE - inset - 35, t, r, alt);
  }
  // a second, denser rail for the busier strengths
  if (strength >= 3) {
    c.frame(inset + 40, inset + 40, SIZE - (inset + 40) * 2, SIZE - (inset + 40) * 2, 1, alt);
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, model: "demo", endpoint: "/v1/images/generations" }));
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
    const png = drawOrnament(prompt);
    // The demo always returns one picture, repeated — enough to exercise the wall and the n clamp.
    const data = Array.from({ length: count }, (_, i) => ({
      b64_json: png.toString("base64"),
      revised_prompt: `demo ornament #${i + 1} at ${requested}px`,
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
