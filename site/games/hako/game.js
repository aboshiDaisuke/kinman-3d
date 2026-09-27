// お土産箱詰め: 作業台に出てくる金萬を表に返し、焼き印の文字をまっすぐにして、12マスの箱に詰める。
//
// 金萬の向きは quaternion ひとつで持つ。回す = 世界の Y 軸まわり、裏返す = 世界の X 軸まわりに半回転。
// 焼き印の上方向はモデルの -Z なので、それを床に写した向きが画面の上（-Z）からどれだけずれているかで採点する。
import { createStage, loadKinman, randomLook, setStamp, shadowGround, createTweens, ease, lerp, THREE, HEIGHT } from "../shared/kinman.js";
import { createUI, loading, wait, sfx } from "../shared/ui.js";

const { degToRad, radToDeg } = THREE.MathUtils;

// ---------------------------------------------------------------- 寸法（メートル）
const COLS = 3;
const ROWS = 4;
const N = COLS * ROWS;
const CELL = 0.052; // 1マス（金萬は直径 4.6cm）
const WALL = 0.006;
const BOX_H = 0.026;
const FLOOR = 0.003; // 底板の厚み。敷き紙はこの上
const DIV_H = 0.015; // 仕切りの高さ
const W_IN = CELL * COLS;
const D_IN = CELL * ROWS;
const W_OUT = W_IN + WALL * 2;
const D_OUT = D_IN + WALL * 2;
const LID_W = W_OUT + 0.005;
const LID_D = D_OUT + 0.005;
const LID_H = 0.018;
const LID_Y = BOX_H - LID_H + 0.004; // 閉まったときの蓋の下端
const TRAY_R = 0.044;
const TRAY_H = 0.006;
const WORK_SCALE = 1.2; // 手元の金萬は少し大きく見せる
const TILT = degToRad(22); // カメラの、真上からの傾き
const FLIP_TIME = 0.34;
const FLY_TIME = 0.42;
const APPEAR_TIME = 0.28;

// ---------------------------------------------------------------- 採点
const GRADES = [
  { key: "beauty", max: 5, label: "美しい", pop: "美しい！", mark: "美", pts: 100, kind: "great" },
  { key: "fine", max: 15, label: "きれい", pop: "きれい", mark: "良", pts: 70, kind: "good" },
  { key: "fair", max: 30, label: "まあまあ", pop: "まあまあ", mark: "可", pts: 40, kind: "ok" },
  { key: "warp", max: 181, label: "ゆがみ", pop: "ゆがみ…", mark: "歪", pts: 10, kind: "bad" },
];
const URA = { key: "ura", label: "裏", pop: "裏です！", mark: "裏", pts: 0, kind: "bad" };
const TIME_PAR = 60; // これより早いぶんが時間ボーナス（見栄えの割合をかける）
const TIME_RATE = 10; // 1秒あたりの点
const TIME_MAX = 500;
const RANKS = [
  { min: 1450, name: "百貨店級", comment: "そのまま売り場の棚に並べられそうな仕上がり。焼き印がぴしっと揃っています。" },
  { min: 1200, name: "包装名人", comment: "速くて、きれい。開けた人が思わず声を上げる箱です。" },
  { min: 900, name: "包装上手", comment: "安心して任せられる腕前。あと少し角度を詰めれば名人です。" },
  { min: 500, name: "店番", comment: "向きがところどころ揃っていません。焼き印の文字をよく見て。" },
  { min: 0, name: "見習い", comment: "まずは表に返して、文字をまっすぐ上に。焦らずいきましょう。" },
];

// ---------------------------------------------------------------- 画面まわり
const ui = createUI({
  id: "hako",
  title: "お土産箱詰め",
  hud: [
    { key: "count", label: "個数", value: `0/${N}` },
    { key: "time", label: "タイム", value: "0.0" },
  ],
  formatBest: (v) => `${v}点`,
});
const load = loading("箱を組み立て中…");

// 左回りの矢印（右回りは左右反転して使う）
const ROT_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M7.2 8.2A7 7 0 1 1 5 13.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3.6 4.6l.9 5.2 5.2-.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const coarse = matchMedia("(pointer: coarse)").matches;
const controls = document.createElement("div");
controls.className = "g-controls hako-controls";
controls.hidden = true;
controls.innerHTML = `
  <button type="button" class="g-btn hako-rot" data-rot="1" aria-label="左に回す">${ROT_ICON}</button>
  <button type="button" class="g-btn" data-act="flip">裏返す</button>
  <button type="button" class="g-btn g-primary" data-act="pack">詰める</button>
  <button type="button" class="g-btn hako-rot" data-rot="-1" aria-label="右に回す"><span class="hako-mirror">${ROT_ICON}</span></button>`;
const hint = document.createElement("p");
hint.className = "g-hint hako-hint";
hint.hidden = true;
hint.textContent = coarse ? "なぞって回す　上へはらって裏返す　下へはらって詰める" : "ドラッグ・←→で回す　↑・F で裏返す　Space・↓ で詰める";
document.body.append(controls, hint);

// ---------------------------------------------------------------- 舞台
const canvas = document.getElementById("view");
const stage = createStage(canvas, { shadows: true, shadowSize: 0.2 });
const { scene, camera } = stage;
camera.up.set(0, 0, -1); // 画面の上 = 箱の上（-Z）。真上から見ても向きが決まるように
const tweens = createTweens();

const ground = shadowGround(2, 0.2);
scene.add(ground);

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(X, Math.PI);

// 和紙の地紋（繊維とムラ）
function paperFibers(g, w, h, rgb, amount = 1) {
  for (let i = 0; i < 900 * amount; i++) {
    g.fillStyle = `rgba(${rgb},${Math.random() * 0.045})`;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 12, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = "round";
  for (let i = 0; i < 320 * amount; i++) {
    g.strokeStyle = `rgba(${rgb},${0.05 + Math.random() * 0.13})`;
    g.lineWidth = 0.5 + Math.random() * 1.1;
    const x = Math.random() * w;
    const y = Math.random() * h;
    const a = Math.random() * Math.PI * 2;
    const l = 6 + Math.random() * 30;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
}
function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
  return t;
}
function washi(base, rgb, size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  paperFibers(g, size, size, rgb);
  paperFibers(g, size, size, "255,255,255", 0.6);
  return canvasTexture(c);
}

// ---------------------------------------------------------------- 箱
const box = new THREE.Group();
scene.add(box);
const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x6a2612, roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.4 });
const paper = new THREE.MeshStandardMaterial({ map: washi("#f7f0e3", "120,90,50"), roughness: 0.95 });
const card = new THREE.MeshStandardMaterial({ color: 0xf2e9d9, roughness: 0.85 });
const gold = new THREE.MeshStandardMaterial({ color: 0xc9953f, metalness: 0.75, roughness: 0.35 });

function slab(parent, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
slab(box, W_OUT, FLOOR, D_OUT, lacquer, 0, FLOOR / 2, 0);
slab(box, W_OUT, BOX_H, WALL, lacquer, 0, BOX_H / 2, -D_OUT / 2 + WALL / 2);
slab(box, W_OUT, BOX_H, WALL, lacquer, 0, BOX_H / 2, D_OUT / 2 - WALL / 2);
slab(box, WALL, BOX_H, D_IN, lacquer, -W_OUT / 2 + WALL / 2, BOX_H / 2, 0);
slab(box, WALL, BOX_H, D_IN, lacquer, W_OUT / 2 - WALL / 2, BOX_H / 2, 0);
// 外まわりの金の細線
for (const s of [-1, 1]) {
  slab(box, W_OUT + 0.0006, 0.0012, 0.0004, gold, 0, BOX_H - 0.005, s * (D_OUT / 2 + 0.0002));
  slab(box, 0.0004, 0.0012, D_OUT + 0.0006, gold, s * (W_OUT / 2 + 0.0002), BOX_H - 0.005, 0);
}
// 敷き紙と、内側に貼った紙
const liner = new THREE.Mesh(new THREE.PlaneGeometry(W_IN, D_IN), paper);
liner.rotation.x = -Math.PI / 2;
liner.position.y = FLOOR + 0.0002;
liner.receiveShadow = true;
box.add(liner);
const IN_H = BOX_H - FLOOR - 0.0015;
for (const s of [-1, 1]) {
  slab(box, W_IN, IN_H, 0.0006, paper, 0, FLOOR + IN_H / 2, s * (D_IN / 2 - 0.0003));
  slab(box, 0.0006, IN_H, D_IN, paper, s * (W_IN / 2 - 0.0003), FLOOR + IN_H / 2, 0);
}
// 仕切り
for (let c = 1; c < COLS; c++) slab(box, 0.0012, DIV_H, D_IN - 0.0012, card, -W_IN / 2 + c * CELL, FLOOR + DIV_H / 2, 0);
for (let r = 1; r < ROWS; r++) slab(box, W_IN - 0.0012, DIV_H, 0.0012, card, 0, FLOOR + DIV_H / 2, -D_IN / 2 + r * CELL);

const cellPos = (i, out) => out.set(((i % COLS) - (COLS - 1) / 2) * CELL, FLOOR + HEIGHT / 2 + 0.0004, (Math.floor(i / COLS) - (ROWS - 1) / 2) * CELL);

// ---------------------------------------------------------------- 蓋（掛け紙つき）
const lid = new THREE.Group();
lid.visible = false;
scene.add(lid);
const lidTop = new THREE.Mesh(new THREE.PlaneGeometry(LID_W, LID_D), new THREE.MeshStandardMaterial({ color: 0x6a2612, roughness: 0.8 }));
lidTop.rotation.x = -Math.PI / 2;
lidTop.position.y = LID_H + 0.0001;
lidTop.receiveShadow = true;
lid.add(lidTop);
slab(lid, LID_W, 0.002, LID_D, lacquer, 0, LID_H - 0.001, 0);
for (const s of [-1, 1]) {
  slab(lid, LID_W, LID_H, 0.002, lacquer, 0, LID_H / 2, s * (LID_D / 2 - 0.001));
  slab(lid, 0.002, LID_H, LID_D - 0.004, lacquer, s * (LID_W / 2 - 0.001), LID_H / 2, 0);
}

async function drawLid() {
  const img = new Image();
  img.src = new URL("../assets/stamp_mask.png", import.meta.url).href;
  await Promise.all([
    img.decode().catch(() => null),
    Promise.race([document.fonts.load('800 100px "Shippori Mincho B1"', "金萬御土産"), wait(3000)]).catch(() => null),
  ]);
  const W = 900;
  const H = Math.round((W * LID_D) / LID_W);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  // 地: えんじの和紙に金の二重枠
  g.fillStyle = "#74291a";
  g.fillRect(0, 0, W, H);
  paperFibers(g, W, H, "255,214,170", 1.6);
  g.strokeStyle = "rgba(222,178,98,0.9)";
  g.lineWidth = 5;
  g.strokeRect(28, 28, W - 56, H - 56);
  g.lineWidth = 2;
  g.strokeRect(42, 42, W - 84, H - 84);
  // 掛け紙（縦の帯）
  const bw = Math.round(W * 0.46);
  const bx = (W - bw) / 2;
  g.save();
  g.shadowColor = "rgba(30,10,0,0.45)";
  g.shadowBlur = 18;
  g.fillStyle = "#f7f0e2";
  g.fillRect(bx, 0, bw, H);
  g.restore();
  g.save();
  g.beginPath();
  g.rect(bx, 0, bw, H);
  g.clip();
  paperFibers(g, W, H, "140,100,60", 0.8);
  g.restore();
  g.fillStyle = "#b3321e";
  g.fillRect(bx + 16, 0, 4, H);
  g.fillRect(bx + bw - 20, 0, 4, H);
  // 文字（縦書き）
  const ink = "#2a1a10";
  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const cx = W / 2;
  const small = Math.round(bw * 0.13);
  g.font = `800 ${small}px "Shippori Mincho B1", "Hiragino Mincho ProN", serif`;
  ["御", "土", "産"].forEach((ch, i) => g.fillText(ch, cx, H * 0.085 + small * 0.6 + i * small * 1.08));
  const big = Math.round(bw * 0.64);
  g.font = `800 ${big}px "Shippori Mincho B1", "Hiragino Mincho ProN", serif`;
  const top = H * 0.085 + small * 3.6 + big * 0.55;
  g.fillText("金", cx, top);
  g.fillText("萬", cx, top + big * 1.04);
  // 朱の印（焼き印の形を借りる）
  if (img.naturalWidth) {
    const s = 256;
    const t = document.createElement("canvas");
    t.width = t.height = s;
    const tg = t.getContext("2d");
    tg.drawImage(img, 0, 0, s, s);
    const d = tg.getImageData(0, 0, s, s);
    for (let i = 0; i < d.data.length; i += 4) {
      const a = d.data[i];
      d.data[i] = 186;
      d.data[i + 1] = 44;
      d.data[i + 2] = 26;
      d.data[i + 3] = a;
    }
    tg.putImageData(d, 0, 0);
    const size = bw * 0.62;
    g.globalAlpha = 0.92;
    g.drawImage(t, cx - size / 2, H * 0.855 - size / 2, size, size);
    g.globalAlpha = 1;
  }
  const tex = canvasTexture(c);
  lidTop.material.map = tex;
  lidTop.material.color.set(0xffffff);
  lidTop.material.needsUpdate = true;
}

// ---------------------------------------------------------------- 作業台（丸い塗りのお盆）
const tray = new THREE.Group();
scene.add(tray);
const trayMat = new THREE.MeshPhysicalMaterial({ color: 0x23140e, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
{
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(TRAY_R, TRAY_R * 0.96, TRAY_H, 72), trayMat);
  disc.position.y = TRAY_H / 2;
  disc.castShadow = disc.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(TRAY_R - 0.0022, 0.0024, 12, 72), trayMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = TRAY_H;
  rim.castShadow = true;
  // 上下の目印（金の三角と線）。焼き印の上をここに合わせる
  const tri = new THREE.Shape();
  tri.moveTo(0, 0.0046);
  tri.lineTo(-0.0034, -0.0014);
  tri.lineTo(0.0034, -0.0014);
  tri.closePath();
  const mark = new THREE.Mesh(new THREE.ShapeGeometry(tri), gold);
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(0, TRAY_H + 0.0002, -(TRAY_R - 0.0085));
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.0012, 0.006), gold);
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, TRAY_H + 0.0002, TRAY_R - 0.009);
  tray.add(disc, rim, mark, line);
}
const workPos = (out) => out.set(tray.position.x, TRAY_H + (HEIGHT / 2) * WORK_SCALE + 0.0004, tray.position.z);

// ---------------------------------------------------------------- 向きの計算
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const faceUp = (q) => _v.set(0, 1, 0).applyQuaternion(q).y > 0;
/** 焼き印（-Z）を床に写した向き。画面の上から反時計回りを正 */
function yawOf(q) {
  _v.set(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-_v.x, -_v.z);
}
/** 焼き印の文字の傾き（rad）。焼き印そのものの傾き look.rot は画面上で逆回りに見える */
const stampAngle = (q, look) => wrapPi(yawOf(q) - look.rot);
/** 表に返したときの傾き */
function uprightAngle(q, look) {
  if (faceUp(q)) return stampAngle(q, look);
  _q2.setFromAxisAngle(X, -Math.PI).multiply(q);
  return stampAngle(_q2, look);
}

// ---------------------------------------------------------------- 金萬
const kit = await loadKinman(stage.renderer).catch(() => null);
if (!kit) {
  load.fail();
  await new Promise(() => {}); // 読み込めなければここで止める
}
const lidReady = drawLid();

const pieces = [];
for (let i = 0; i < N; i++) {
  const obj = kit.make({ look: randomLook() });
  obj.visible = false;
  scene.add(obj);
  pieces.push({ obj, q: obj.quaternion, look: null, state: "off", cell: i, scale: 1, sq: 9, sqA: 0, appear: 1, t: 0, from: new THREE.Vector3(), grade: null });
}

function newLook(p) {
  p.look = randomLook();
  p.look.rot *= 0.6;
  setStamp(p.obj, p.look);
}
/** 作業台に1個出す */
function spawn(p) {
  newLook(p);
  const down = Math.random() < 0.3;
  do {
    p.q.setFromAxisAngle(Y, (Math.random() * 2 - 1) * Math.PI);
    if (down) p.q.multiply(Q_FLIP);
  } while (Math.abs(uprightAngle(p.q, p.look)) < degToRad(25));
  p.state = "work";
  p.appear = 0;
  p.scale = WORK_SCALE * 0.5;
  p.sqA = 0;
  p.obj.visible = true;
  workPos(p.obj.position);
  cur = p;
}
/** 箱のマスにまっすぐ置いた状態にする（待機画面用） */
function placeInBox(p, i, errDeg = 0) {
  newLook(p);
  p.q.setFromAxisAngle(Y, degToRad(errDeg) + p.look.rot);
  p.cell = i;
  cellPos(i, p.obj.position);
  p.state = "box";
  p.scale = 1;
  p.sqA = 0;
  p.obj.visible = true;
}
function popOut(p) {
  if (p.state === "off") return;
  p.state = "out";
  p.t = 0;
  p.from.set(p.scale, 0, 0);
}
function hideAll() {
  for (const p of pieces) {
    p.state = "off";
    p.obj.visible = false;
  }
  cur = null;
  flip = null;
}

// ---------------------------------------------------------------- 状態
let mode = "idle"; // idle | count | play | ending
let cur = null; // 作業台の金萬
let flip = null; // 裏返し中 { t }
const flipQ0 = new THREE.Quaternion();
let pendingPack = false;
let packed = 0;
let landed = 0;
let elapsed = 0;
let timing = false;
let streak = 0;
let grades = [];
let timeText = "";
const loud = () => mode === "play" || mode === "ending";

function rotateBy(d) {
  if (!cur || flip || mode !== "play") return;
  cur.q.premultiply(_q.setFromAxisAngle(Y, d));
  tickAcc += Math.abs(d);
  const now = performance.now();
  if (tickAcc > degToRad(7) && now - lastTick > 35) {
    tickAcc = 0;
    lastTick = now;
    sfx.tick();
  }
}
let tickAcc = 0;
let lastTick = 0;

function startFlip() {
  if (!cur || flip) return;
  if (mode !== "play" && mode !== "idle") return;
  flip = { t: 0 };
  flipQ0.copy(cur.q);
  if (loud()) sfx.flip();
}

function launch(p) {
  p.state = "fly";
  p.t = 0;
  p.from.copy(p.obj.position);
  p.fromScale = p.scale;
}

function judge(p) {
  if (!faceUp(p.q)) return { ...URA, err: 180 };
  const err = Math.abs(radToDeg(stampAngle(p.q, p.look)));
  return { ...GRADES.find((g) => err < g.max), err };
}

function pack() {
  if (mode !== "play" || !cur) return;
  if (flip) {
    pendingPack = true;
    return;
  }
  const p = cur;
  cur = null;
  p.grade = judge(p);
  p.cell = packed;
  grades.push(p.grade);
  launch(p);
  packed++;
  ui.set("count", `${packed}/${N}`);
  sfx.whoosh(false);
  if (packed < N) spawn(pieces[packed]);
  else timing = false;
}

function land(p) {
  p.state = "box";
  cellPos(p.cell, p.obj.position);
  p.scale = 1;
  p.sq = 0;
  p.sqA = 0.22;
  if (mode !== "play" || !p.grade) return;
  landed++;
  const g = p.grade;
  streak = g.key === "beauty" ? streak + 1 : 0;
  let sub = "";
  if (g.key !== "ura") sub = g.err < 0.5 ? "ぴったり" : `ずれ ${Math.round(g.err)}°`;
  if (streak >= 2) sub += `　${streak}連続`;
  const s = stage.toScreen(p.obj.position);
  ui.pop(`${g.pop}${sub ? `<small>${sub}</small>` : ""}`, s.x, Math.max(s.y - 18, 100), g.kind); // 上の段でも HUD に隠れないように
  sfx.thud(1.3);
  if (g.key === "beauty") {
    sfx.good(3);
    ui.shake(streak >= 3 ? 5 : 3);
  } else if (g.key === "fine") sfx.good(2);
  else if (g.key === "fair") sfx.good(0);
  else {
    sfx.bad();
    ui.shake(g.key === "ura" ? 10 : 6);
  }
  ui.announce(g.pop);
  if (landed === N) finale();
}

// ---------------------------------------------------------------- 毎フレーム
function updateWork(dt) {
  const p = cur;
  if (!p) return;
  workPos(p.obj.position);
  if (p.appear < 1) {
    p.appear = Math.min(1, p.appear + dt / APPEAR_TIME);
    p.scale = WORK_SCALE * (0.5 + 0.5 * ease.outBack(p.appear, 2.4));
    p.obj.position.y += (1 - ease.outCubic(p.appear)) * 0.05;
    if (p.appear >= 1) {
      p.scale = WORK_SCALE;
      p.sq = 0;
      p.sqA = 0.1;
    }
  }
  if (flip) {
    flip.t += dt;
    const k = Math.min(1, flip.t / FLIP_TIME);
    p.q.setFromAxisAngle(X, -Math.PI * ease.inOutCubic(k)).multiply(flipQ0);
    p.obj.position.y += Math.sin(Math.PI * k) * 0.034;
    if (k >= 1) {
      flip = null;
      p.sq = 0;
      p.sqA = 0.16;
      if (loud()) sfx.thud(2.2);
      if (pendingPack) {
        pendingPack = false;
        pack();
      }
    }
  }
}

function updatePiece(p, dt) {
  if (p.state === "fly") {
    p.t += dt;
    const k = Math.min(1, p.t / FLY_TIME);
    const e = ease.outCubic(k);
    cellPos(p.cell, _v2);
    p.obj.position.set(lerp(p.from.x, _v2.x, e), lerp(p.from.y, _v2.y, k) + 0.075 * 4 * k * (1 - k), lerp(p.from.z, _v2.z, e));
    p.scale = lerp(p.fromScale, 1, e);
    if (k >= 1) land(p);
  } else if (p.state === "out") {
    p.t += dt / 0.26;
    const k = Math.min(1, p.t);
    p.scale = p.from.x * (1 - ease.inExpo(k)) * (1 + 0.25 * Math.sin(Math.PI * k));
    p.obj.position.y += dt * 0.12;
    if (k >= 1) {
      p.state = "off";
      p.obj.visible = false;
    }
  }
  if (p.state === "off") return;
  p.sq += dt;
  const w = p.sqA * Math.exp(-p.sq * 9) * Math.cos(p.sq * 32);
  const s = p.scale;
  p.obj.scale.set(s * (1 + w * 0.5), s * (1 - w), s * (1 + w * 0.5));
}

// ---------------------------------------------------------------- 待機中の実演（一覧のサムネイルにもなる）
const demo = { phase: "wait", t: 0, from: 0, n: 6 };
function startDemo() {
  hideAll();
  for (let i = 0; i < 6; i++) placeInBox(pieces[i], i, (Math.random() - 0.5) * 4);
  demo.n = 6;
  demoNext();
}
function demoNext() {
  spawn(pieces[demo.n]);
  // 最初の1個は必ず裏から見せる
  if (demo.n === 6 && faceUp(cur.q)) cur.q.multiply(Q_FLIP);
  demo.phase = "wait";
  demo.t = 0;
}
function updateDemo(dt) {
  demo.t += dt;
  const p = cur;
  if (!p && demo.phase !== "fly" && demo.phase !== "full" && demo.phase !== "refill") return;
  switch (demo.phase) {
    case "wait":
      if (demo.t > 0.7) {
        if (!faceUp(p.q)) {
          startFlip();
          demo.phase = "flip";
        } else demo.phase = "turn0";
        demo.t = 0;
      }
      break;
    case "flip":
      if (!flip && demo.t > 0.5) {
        demo.phase = "turn0";
        demo.t = 0;
      }
      break;
    case "turn0":
      demo.from = stampAngle(p.q, p.look);
      demo.phase = "turn";
      demo.t = 0;
      break;
    case "turn": {
      const k = Math.min(1, demo.t / 1.3);
      p.q.setFromAxisAngle(Y, demo.from * (1 - ease.inOutCubic(k)) + p.look.rot);
      if (k >= 1) {
        demo.phase = "hold";
        demo.t = 0;
      }
      break;
    }
    case "hold":
      if (demo.t > 0.45) {
        cur = null;
        p.grade = null;
        p.cell = demo.n;
        launch(p);
        demo.phase = "fly";
        demo.t = 0;
      }
      break;
    case "fly":
      if (demo.t > FLY_TIME + 0.5) {
        demo.n++;
        if (demo.n >= N) {
          demo.phase = "full";
          demo.t = 0;
        } else demoNext();
      }
      break;
    case "full":
      if (demo.t > 1.6) {
        for (let i = 6; i < N; i++) popOut(pieces[i]);
        demo.n = 6;
        demo.phase = "refill";
        demo.t = 0;
      }
      break;
    case "refill":
      if (demo.t > 0.5) demoNext();
      break;
  }
}

// ---------------------------------------------------------------- カメラ
// 見せたい点がすべて、HUD と操作ボタンを避けた範囲に収まる距離を探す
const cam = { mix: 0, play: { target: new THREE.Vector3(), dist: 0.8 }, top: { target: new THREE.Vector3(), dist: 0.8 } };
const _t = new THREE.Vector3();
function placeCamera(target, dist, tilt, az = 0) {
  camera.position.set(target.x + Math.sin(az) * Math.sin(tilt) * dist, target.y + Math.cos(tilt) * dist, target.z + Math.cos(az) * Math.sin(tilt) * dist);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}
function fitView(pts, tilt, safe, out) {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  const x0 = (safe.l / w) * 2 - 1;
  const x1 = 1 - (safe.r / w) * 2;
  const y1 = 1 - (safe.t / h) * 2;
  const y0 = -1 + (safe.b / h) * 2;
  const center = new THREE.Vector3();
  for (const p of pts) center.add(p);
  center.divideScalar(pts.length);
  const tan = Math.tan(degToRad(camera.fov / 2));
  const tryDist = (d) => {
    _t.copy(center);
    let ok = false;
    for (let it = 0; it < 5; it++) {
      placeCamera(_t, d, tilt);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        _v.copy(p).project(camera);
        minX = Math.min(minX, _v.x);
        maxX = Math.max(maxX, _v.x);
        minY = Math.min(minY, _v.y);
        maxY = Math.max(maxY, _v.y);
      }
      const ox = (x0 + x1) / 2 - (minX + maxX) / 2;
      const oy = (y0 + y1) / 2 - (minY + maxY) / 2;
      _t.x -= ox * d * tan * camera.aspect;
      _t.z += (oy * d * tan) / Math.cos(tilt);
      ok = maxX - minX <= x1 - x0 && maxY - minY <= y1 - y0;
    }
    return ok;
  };
  let lo = 0.1;
  let hi = 6;
  for (let i = 0; i < 24; i++) {
    const d = (lo + hi) / 2;
    if (tryDist(d)) hi = d;
    else lo = d;
  }
  tryDist(hi);
  out.target.copy(_t);
  out.dist = hi;
}
const corners = (cx, cz, hw, hd, ys, list) => {
  for (const y of ys) for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push(new THREE.Vector3(cx + sx * hw, y, cz + sz * hd));
  return list;
};

let portrait = false;
function layout(w, h) {
  portrait = w / h < 1;
  if (portrait) tray.position.set(0, 0, D_OUT / 2 + TRAY_R + 0.018);
  else tray.position.set(W_OUT / 2 + TRAY_R + 0.03, 0, 0.035);
  const pts = corners(0, 0, W_OUT / 2, D_OUT / 2, [0, BOX_H], []);
  corners(tray.position.x, tray.position.z, TRAY_R, TRAY_R, [0, 0.03], pts);
  const small = w < 640;
  const short = h < 520; // 横向きのスマホなど。説明の一行は隠して、ボタンの分だけ空ける
  fitView(pts, TILT, { l: 14, r: 14, t: small || short ? 62 : 76, b: short ? 70 : small ? 118 : 112 }, cam.play);
  const top = corners(0, 0, LID_W / 2 + 0.004, LID_D / 2 + 0.004, [LID_Y + LID_H], []);
  fitView(top, 0, { l: 20, r: 20, t: small ? 76 : 86, b: 36 }, cam.top);
  // 影を落とす光は見せる範囲の真ん中へ
  const { key } = stage.lights;
  key.target.position.copy(cam.play.target);
  key.position.copy(cam.play.target).add(_v.set(-0.12, 0.24, 0.12));
  if (cur) workPos(cur.obj.position);
}
stage.onResize(layout);

// ---------------------------------------------------------------- 入力
const drag = { id: null, a: 0, x: 0, y: 0, x0: 0, y0: 0, t0: 0, q0: new THREE.Quaternion(), piece: null };
function pieceScreen() {
  return cur ? stage.toScreen(cur.obj.position) : { x: innerWidth / 2, y: innerHeight / 2 };
}
canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "play" || drag.id !== null) return;
  drag.id = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  const c = pieceScreen();
  drag.a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
  drag.x = drag.x0 = e.clientX;
  drag.y = drag.y0 = e.clientY;
  drag.t0 = performance.now();
  drag.piece = cur;
  if (cur) drag.q0.copy(cur.q);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== drag.id) return;
  const c = pieceScreen();
  const dx = e.clientX - c.x;
  const dy = e.clientY - c.y;
  const a = Math.atan2(dy, dx);
  // 金萬のまわりをなぞると、その向きに回る。真ん中付近では左右の動きで回す
  const d = Math.hypot(dx, dy) > 34 ? -wrapPi(a - drag.a) : -(e.clientX - drag.x) * 0.012;
  drag.a = a;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (cur && cur === drag.piece) rotateBy(d);
});
function endDrag(e) {
  if (e.pointerId !== drag.id) return;
  drag.id = null;
  if (e.type !== "pointerup" || mode !== "play") return;
  // すばやく上下にはらったら、裏返す・詰める（なぞった回転は取り消す）
  const DX = e.clientX - drag.x0;
  const DY = e.clientY - drag.y0;
  if (performance.now() - drag.t0 < 260 && Math.abs(DY) > 48 && Math.abs(DY) > Math.abs(DX) * 2) {
    if (cur && cur === drag.piece && !flip) cur.q.copy(drag.q0);
    if (DY < 0) startFlip();
    else pack();
  }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener(
  "wheel",
  (e) => {
    if (mode !== "play") return;
    e.preventDefault();
    rotateBy(-Math.sign(e.deltaY) * degToRad(2));
  },
  { passive: false }
);

// 押しっぱなしで回す（キーとボタン共通）。最初は1°、少し待ってからだんだん速く
let holdDir = 0;
let holdT = 0;
let holdKey = null;
const holdSpeed = (t) => (t < 0.2 ? 0 : Math.min(220, 24 + (t - 0.2) * 280)); // °/秒
function holdStart(dir, key = null) {
  holdDir = dir;
  holdT = 0;
  holdKey = key;
  rotateBy(dir * degToRad(1));
}
for (const b of controls.querySelectorAll("[data-rot]")) {
  const dir = Number(b.dataset.rot);
  b.addEventListener("pointerdown", (e) => {
    if (mode !== "play") return;
    b.setPointerCapture(e.pointerId);
    holdStart(dir);
  });
  const stop = () => holdKey === null && (holdDir = 0);
  b.addEventListener("pointerup", () => (stop(), b.blur()));
  b.addEventListener("pointercancel", stop);
  b.addEventListener("lostpointercapture", stop);
  b.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      rotateBy(dir * degToRad(3));
    }
  });
}
// 指やマウスで押したあとはフォーカスを外す（そのあとの Space がボタンに取られないように）
for (const [act, fn] of [["flip", startFlip], ["pack", pack]]) {
  const b = controls.querySelector(`[data-act="${act}"]`);
  b.addEventListener("click", (e) => {
    if (e.detail > 0) b.blur();
    fn();
  });
}

addEventListener("keydown", (e) => {
  if (mode !== "play") return;
  if ((e.key === " " || e.key === "Enter") && e.target.closest?.(".hako-controls")) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === "ArrowLeft" || k === "a" || k === "ArrowRight" || k === "d") {
    e.preventDefault();
    if (!e.repeat) holdStart(k === "ArrowLeft" || k === "a" ? 1 : -1, k);
  } else if (k === "ArrowUp" || k === "f" || k === "w") {
    e.preventDefault();
    if (!e.repeat) startFlip();
  } else if (k === "ArrowDown" || k === " " || k === "s") {
    e.preventDefault();
    if (!e.repeat) pack();
  }
});
addEventListener("keyup", (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === holdKey) {
    holdKey = null;
    holdDir = 0;
  }
});
addEventListener("blur", () => {
  holdKey = null;
  holdDir = 0;
});

// ---------------------------------------------------------------- ループ
stage.start((dt, t) => {
  tweens.step(dt);
  if (mode === "idle") updateDemo(dt);
  if (holdDir && mode === "play") {
    holdT += dt;
    const sp = holdSpeed(holdT);
    if (sp) rotateBy(holdDir * degToRad(sp) * dt);
  }
  updateWork(dt);
  for (const p of pieces) updatePiece(p, dt);
  if (timing) {
    elapsed += dt;
    const s = elapsed.toFixed(1);
    if (s !== timeText) ui.set("time", (timeText = s));
  }
  const m = ease.inOutCubic(cam.mix);
  _t.lerpVectors(cam.play.target, cam.top.target, m);
  const sway = mode === "idle" ? 1 : 0;
  placeCamera(_t, lerp(cam.play.dist, cam.top.dist, m), lerp(TILT, 0.0001, m) + sway * Math.sin(t * 0.31) * 0.03, sway * Math.sin(t * 0.23) * 0.05);
});

// ---------------------------------------------------------------- 流れ
async function play() {
  packed = 0;
  landed = 0;
  elapsed = 0;
  streak = 0;
  grades = [];
  pendingPack = false;
  timeText = "0.0";
  ui.set("count", `0/${N}`);
  ui.set("time", "0.0");
  controls.hidden = false;
  hint.hidden = false;
  mode = "count";
  await ui.countdown();
  mode = "play";
  timing = true;
  spawn(pieces[0]);
}

async function finale() {
  mode = "ending";
  holdDir = 0;
  holdKey = null;
  await wait(250);
  controls.hidden = true;
  hint.hidden = true;
  ui.music.stop(0.8);
  ui.big("おしまい！", "end");
  sfx.whistle();
  tweens.add(0.45, (p) => tray.scale.setScalar(Math.max(0.001, 1 - ease.inExpo(p))), () => (tray.visible = false));
  await wait(750);
  // 真上から箱を見せる
  tweens.add(1.1, (p) => (cam.mix = p));
  await wait(1250);
  // 1個ずつ見返して、検品の印を押す
  const marks = [];
  for (const p of pieces) {
    const s = stage.toScreen(p.obj.position);
    const m = document.createElement("div");
    m.className = `g-pop mark ${p.grade.kind}`;
    m.textContent = p.grade.mark;
    m.style.left = `${s.x}px`;
    m.style.top = `${s.y}px`;
    m.style.setProperty("--r", `${(Math.random() - 0.5) * 16}deg`);
    ui.fxLayer.append(m);
    marks.push(m);
    p.sq = 0;
    p.sqA = 0.12;
    if (p.grade.key === "beauty") sfx.good(1);
    else sfx.tick();
    await wait(90);
  }
  await wait(800);
  // 蓋が上から落ちてきて閉まる
  await lidReady;
  for (const m of marks) m.classList.add("leave");
  setTimeout(() => marks.forEach((m) => m.remove()), 400);
  lid.visible = true;
  sfx.whoosh(false);
  await new Promise((res) =>
    tweens.add(
      0.5,
      (p) => {
        const e = p * p * p;
        lid.position.y = lerp(LID_Y + 0.3, LID_Y, e);
        lid.rotation.y = (1 - e) * 0.22;
      },
      res
    )
  );
  sfx.taiko(0.9);
  sfx.thud(0.8);
  ui.shake(12);
  tweens.add(0.3, (p) => {
    lid.position.y = LID_Y + Math.sin(Math.PI * p) * 0.004 * (1 - p);
    box.scale.set(1 + 0.02 * Math.sin(Math.PI * p), 1 - 0.05 * Math.sin(Math.PI * p), 1 + 0.02 * Math.sin(Math.PI * p));
  });
  ui.big("完成！", "go");
  await wait(1500);
  showResult();
}

async function showResult() {
  const count = { beauty: 0, fine: 0, fair: 0, warp: 0, ura: 0 };
  let looks = 0;
  for (const g of grades) {
    count[g.key]++;
    looks += g.pts;
  }
  const ratio = looks / (N * 100);
  const bonus = Math.round(Math.min(TIME_MAX, Math.max(0, (TIME_PAR - elapsed) * TIME_RATE)) * ratio);
  const total = looks + bonus;
  const rank = RANKS.find((r) => total >= r.min);
  const time = elapsed.toFixed(1);
  const sum = [...GRADES, URA].map((g) => `<span>${g.label}<b>×${count[g.key]}</b></span>`).join("");
  const detail = `<p class="hako-sum">${sum}</p>
    <table>
      <tr><td>見栄え</td><td>${looks}点</td></tr>
      <tr><td>時間ボーナス（${time}秒）</td><td>+${bonus}点</td></tr>
    </table>`;
  const r = await ui.result({
    score: total,
    unit: "点",
    rank: rank.name,
    comment: rank.comment,
    detail,
    share: `金萬ミニゲーム「お土産箱詰め」で${total}点、称号は「${rank.name}」。美しい×${count.beauty}、タイム${time}秒。`,
  });
  if (r === "retry") restart();
}

async function restart() {
  mode = "count";
  tweens.add(0.4, (p) => (lid.position.y = LID_Y + ease.inExpo(p) * 0.35), () => (lid.visible = false));
  await wait(250);
  for (const p of pieces) popOut(p);
  tray.visible = true;
  tweens.add(0.5, (p) => tray.scale.setScalar(Math.max(0.001, ease.outBack(p))));
  tweens.add(0.9, (p) => (cam.mix = 1 - p));
  await wait(950);
  box.scale.set(1, 1, 1);
  play();
}

// 動作確認用（Playwright から状態を見る）
globalThis.__hako = { get cur() { return cur; }, get mode() { return mode; }, pieces, stampAngle, faceUp, cam, setStamp, THREE, camera };

startDemo();
load.done();
await ui.start({
  lead: "お土産の箱に、金萬を12個。表に返して、焼き印の文字をまっすぐ上に揃えてから詰めましょう。",
  rules: [
    "<b>回す</b>：金萬のまわりをなぞる／←→キー／回転ボタン",
    "<b>裏返す</b>：上へはらう／↑・F キー／「裏返す」",
    "<b>詰める</b>：下へはらう／Space・↓ キー／「詰める」",
    "ずれ5°未満で「美しい」。裏のまま詰めると0点。早く詰め終わるほどボーナス。",
  ],
});
mode = "count";
for (const p of pieces) popOut(p);
cur = null;
flip = null;
await wait(300);
play();

