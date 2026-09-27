// 金萬ムービーを1コマずつ書き出して mp4 にする。
//   node promo/render.mjs                 → promo/out/kinman_15s.mp4
//   node promo/render.mjs --stills 1,4.8  → 指定秒の静止画だけ（確認用）
// プロジェクトのルートを http://localhost:8790/ で配信しておくこと（python3 -m http.server 8790）。
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const FPS = 30;
const SUB = 4; // 1コマあたりのサブフレーム（モーションブラー用）
const SHUTTER = 0.5; // シャッター角 180°
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "out");
const FRAMES = process.env.FRAMES_DIR || path.join(os.tmpdir(), "kinman_frames");
const URL_ = "http://localhost:8790/promo/index.html?capture";

const args = process.argv.slice(2);
const stillsArg = args.includes("--stills") ? args[args.indexOf("--stills") + 1] : null;

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && console.error("[page]", m.text()));
page.on("pageerror", (e) => console.error("[pageerror]", e));
await page.goto(URL_);
await page.evaluate(() => window.promo.ready);
console.log("GPU:", await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "?";
}));
mkdirSync(OUT, { recursive: true });

if (stillsArg) {
  const dir = process.env.STILLS_DIR || path.join(OUT, "stills");
  mkdirSync(dir, { recursive: true });
  for (const s of stillsArg.split(",").map(Number)) {
    await page.evaluate((t) => window.promo.update(t), s);
    await page.screenshot({ path: path.join(dir, `t${s.toFixed(2)}.png`) });
  }
  console.log("stills →", dir);
  await browser.close();
  process.exit(0);
}

if (existsSync(FRAMES)) rmSync(FRAMES, { recursive: true });
mkdirSync(FRAMES, { recursive: true });
const total = Math.round((await page.evaluate(() => window.promo.DURATION)) * FPS);
const t0 = Date.now();
let n = 0;
for (let f = 0; f < total; f++) {
  for (let k = 0; k < SUB; k++) {
    const t = (f + (k / SUB) * SHUTTER) / FPS;
    await page.evaluate((t) => window.promo.update(t), t);
    await page.screenshot({ path: path.join(FRAMES, `s${String(n++).padStart(5, "0")}.jpg`), type: "jpeg", quality: 95 });
  }
  if (f % 30 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();

// サブフレームを平均してモーションブラーにし、30fps に間引く
const video = path.join(OUT, "kinman_15s_silent.mp4");
const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} failed`);
};
run("ffmpeg", [
  "-y", "-framerate", String(FPS * SUB), "-i", path.join(FRAMES, "s%05d.jpg"),
  "-vf", `tmix=frames=${SUB}:weights='${Array(SUB).fill(1).join(" ")}',select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB,format=yuv420p`,
  "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", video,
]);
const audio = path.join(OUT, "kinman_bgm.wav");
if (existsSync(audio)) {
  run("ffmpeg", [
    "-y", "-i", video, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest",
    "-movflags", "+faststart", path.join(OUT, "kinman_15s.mp4"),
  ]);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
