// 金萬タワー: 左右に揺れる金萬を落として、どこまで高く積めるか。
//
// 塔は段ごとに「置いた位置 x」を持ち、表示ではそこに揺れ（根元を固定した弓なりの曲がり）を足す。
// 各段について「その段より上の重心」が「すぐ下の段の中心」から RADIUS*0.9 以上ずれたら崩れる。
// 判定は表示の位置（揺れ込み）で行うので、見えている通りに崩れる。
import { THREE, createStage, loadKinman, randomLook, setStamp, shadowGround, createTweens, ease, clamp01, lerp, RADIUS, HEIGHT } from "../shared/kinman.js";
import { createUI, loading, wait, sfx, getBest } from "../shared/ui.js";

const ID = "tower";
const PERFECT = 0.003; // これより小さいずれは「ぴったり」（往復の速さで 30ms ほどの幅）
const STICK = RADIUS * 0.7; // これ以上ずれると縁から落ちる（乗ったとたんに崩れるほどのずれは落とす）
const TOPPLE = RADIUS * 0.9; // 重心がこれ以上外に出ると崩れる
const GAP = 0.045; // 揺れている金萬の底と、てっぺんとの隙間
const BASE_Y = 0.0004; // 懐紙の厚み
const DROP_G = 5.5; // 落とすときの重力（見やすいよう実際より弱い）
const WORLD_G = 9.8;
const START_LIVES = 3;
const MAX_LIVES = 5;
const BONUS_EVERY = 5; // ぴったりがこの回数続くと、のこり +1
const RULER_X = -0.08;
const RULER_Z = -0.036;
const RULER_SEG = 0.2; // 定規 1本の長さ（20cm）
const ELEVATION = THREE.MathUtils.degToRad(15);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const RANKS = [
  { min: 30, title: "天まで金萬", comment: "もはや名所。見上げても、てっぺんが見えない。" },
  { min: 20, title: "秋田タワー", comment: "見上げるほどの高さ。積むたびに手がふるえる。" },
  { min: 12, title: "銘菓の塔", comment: "立派な塔になってきた。重心のずれに気をつけて。" },
  { min: 5, title: "おやつ時", comment: "おやつにちょうどいい高さ。ここからが本番。" },
  { min: 0, title: "ぐらぐら", comment: "まずは土台づくりから。真ん中をよく見て落とそう。" },
];

const cm = (m) => (m * 100).toFixed(1);

// ---------------------------------------------------------------- 画面まわり
const ld = loading();
const ui = createUI({
  id: ID,
  title: "金萬タワー",
  hud: [
    { key: "level", label: "段", value: "0" },
    { key: "height", label: "高さ cm", value: "0.0" },
    { key: "life", label: "のこり", value: String(START_LIVES) },
  ],
  formatBest: (v) => `${v}段`,
});
const hint = document.createElement("p");
hint.className = "g-hint t-hint";
hint.innerHTML = 'タップ<span class="t-key">・<kbd>Space</kbd></span> で落とす';
hint.hidden = true;
document.body.append(hint);

// ---------------------------------------------------------------- 舞台
const canvas = document.getElementById("view");
const stage = createStage(canvas, { shadows: true, shadowSize: 0.16 });
const { scene, camera } = stage;
const key = stage.lights.key;
const KEY_DIR = key.position.clone().normalize();
key.shadow.camera.far = 3;
camera.far = 20;
camera.updateProjectionMatrix();

const tweens = createTweens();
const ground = shadowGround(6, 0.2);
scene.add(ground);

let kit = null;
const pool = [];
function takeKinman() {
  const look = randomLook();
  let k = pool.pop();
  if (k) setStamp(k, look);
  else k = kit.make({ look });
  k.position.set(0, 0, 0);
  k.quaternion.identity();
  k.scale.set(1, 1, 1);
  k.visible = true;
  scene.add(k);
  return k;
}
function releaseKinman(k) {
  if (!k) return;
  scene.remove(k);
  pool.push(k);
}

// ---------------------------------------------------------------- 状態
let mode = "load"; // load / idle / count / play / collapse / end
let timeScale = 1;
let clock = 0;
let finish = null; // プレイ終了を知らせる
const tower = []; // { k, x, s, sv, jit, ry, dx, cy }
const bodies = []; // 崩れて転がる金萬
const sway = { th: 0, v: 0 };
let topY = BASE_Y;
let danger = 0;
let warned = false;
let drops = 0;
const stats = { level: 0, lives: START_LIVES, perfect: 0, combo: 0, maxCombo: 0, miss: 0, beatBest: false };
let best = getBest(ID) ?? 0;

const hover = { k: null, phase: 0, x: 0, prevX: 0, y: 0, vy: 0, state: "none", appear: 1 };
const squashQueue = []; // 着地の衝撃が下の段へ伝わる予定

// ---------------------------------------------------------------- 小道具（懐紙・定規・目印）
function paperTexture(w, h, fill, fibers) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = fill;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < fibers; i++) {
    g.strokeStyle = `rgba(160,130,95,${0.04 + Math.random() * 0.06})`;
    g.lineWidth = 0.6 + Math.random();
    const x = Math.random() * w;
    const y = Math.random() * h;
    const a = Math.random() * Math.PI;
    const l = 6 + Math.random() * 18;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeKaishi() {
  const g = new THREE.Group();
  const tex = paperTexture(256, 256, "#fbf6ec", 260);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: 0xffffff });
  // 二つ折りの懐紙: 下の一枚を少しずらして見せる
  const under = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.12), mat);
  under.rotation.x = -Math.PI / 2;
  under.position.set(0.006, 0.0001, 0.006);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.12), mat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0003;
  under.receiveShadow = top.receiveShadow = true;
  g.add(under, top);
  g.rotation.y = 0.14;
  return g;
}
scene.add(makeKaishi());

// 竹の定規。20cm ごとの板をつなげて、塔の高さに合わせて足していく
const rulerGroup = new THREE.Group();
rulerGroup.position.set(RULER_X, 0, RULER_Z);
scene.add(rulerGroup);
const rulerGeo = new THREE.BoxGeometry(0.02, RULER_SEG, 0.004);
const bambooMat = new THREE.MeshStandardMaterial({ color: 0xd9b979, roughness: 0.65 });
let rulerTop = 0;
let fontsReady = false;

function rulerTexture(startCm) {
  const W = 192;
  const H = 2048;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, "#dcbc7c");
  grd.addColorStop(0.35, "#efd6a0");
  grd.addColorStop(1, "#e2c386");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // 竹の筋
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(140,100,50,${0.04 + Math.random() * 0.06})`;
    g.fillRect(Math.random() * W, 0, 1 + Math.random() * 2, H);
  }
  const px = H / (RULER_SEG * 1000); // 1mm あたり
  g.fillStyle = "#3a2414";
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (let mm = 0; mm <= RULER_SEG * 1000; mm++) {
    const y = H - mm * px;
    const cmNow = startCm + mm / 10;
    const major = mm % 10 === 0;
    const half = mm % 5 === 0;
    const len = major ? (cmNow % 5 === 0 ? 92 : 66) : half ? 42 : 20;
    const w = major ? 3.2 : half ? 2.4 : 1.4;
    g.fillStyle = "#3a2414";
    g.fillRect(W - len, y - w / 2, len, w);
    if (major && cmNow > 0) {
      const big = cmNow % 5 === 0;
      g.font = `800 ${big ? 50 : 36}px "Shippori Mincho B1", "Hiragino Mincho ProN", serif`;
      g.fillStyle = big ? "#8a3b17" : "#3a2414";
      g.fillText(String(cmNow), W - (big ? 100 : 74), y + 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
  return t;
}
function ensureRuler(h) {
  if (!fontsReady) return;
  while (rulerTop < h) {
    const front = new THREE.MeshStandardMaterial({ map: rulerTexture(Math.round(rulerTop * 100)), roughness: 0.6 });
    const seg = new THREE.Mesh(rulerGeo, [bambooMat, bambooMat, bambooMat, bambooMat, front, bambooMat]);
    seg.position.y = rulerTop + RULER_SEG / 2;
    // VSM では receiveShadow の物も影を落とすので、定規は影にかかわらせない
    rulerGroup.add(seg);
    rulerTop += RULER_SEG;
  }
}

// 定規の横の「今の高さ」の目印（三角）
const pointer = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.009, 0.0045);
  s.lineTo(0.009, -0.0045);
  s.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: 0x8a3b17, toneMapped: false }));
  m.position.set(RULER_X + 0.0105, 0, RULER_Z + 0.0025);
  scene.add(m);
  return m;
})();

// ベスト記録の線と札
const bestMark = (() => {
  const g = new THREE.Group();
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.0007),
    new THREE.MeshBasicMaterial({ color: 0xc98a3e, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
  );
  line.position.x = 0.1;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.036, 0.009),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
  );
  label.position.set(0.02, 0.0062, 0);
  g.add(line, label);
  g.position.set(RULER_X + 0.01, 0, RULER_Z + 0.003);
  g.visible = false;
  scene.add(g);
  g.userData.draw = (v) => {
    const x = c.getContext("2d");
    x.clearRect(0, 0, 256, 64);
    x.fillStyle = "#c98a3e";
    x.beginPath();
    x.roundRect(0, 4, 256, 56, 28);
    x.fill();
    x.fillStyle = "#fff";
    x.font = `800 38px "Shippori Mincho B1", "Hiragino Mincho ProN", serif`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(`ベスト ${v}段`, 128, 34);
    tex.needsUpdate = true;
  };
  return g;
})();
function updateBestMark() {
  best = getBest(ID) ?? 0;
  bestMark.visible = best > 0;
  if (best > 0) {
    bestMark.userData.draw(best);
    bestMark.position.y = BASE_Y + best * HEIGHT;
  }
}

// 落とす位置の目安（点線）
const guide = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  geo.setAttribute("lineDistance", new THREE.BufferAttribute(new Float32Array(2), 1));
  const line = new THREE.Line(
    geo,
    new THREE.LineDashedMaterial({ color: 0x8a3b17, dashSize: 0.0022, gapSize: 0.0022, transparent: true, opacity: 0.45, depthWrite: false })
  );
  line.frustumCulled = false;
  scene.add(line);
  return line;
})();
function updateGuide(x, y0, y1, show) {
  guide.visible = show;
  if (!show) return;
  const p = guide.geometry.attributes.position;
  p.setXYZ(0, x, y0, 0.0001);
  p.setXYZ(1, x, y1, 0.0001);
  p.needsUpdate = true;
  const d = guide.geometry.attributes.lineDistance;
  d.setX(1, y0 - y1);
  d.needsUpdate = true;
}

// ぴったりのときに広がる輪
const rings = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xc98a3e, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  scene.add(m);
  rings.push(m);
}
let ringNext = 0;
function burstRing(x, y, color = 0xc98a3e, size = 2.8) {
  const m = rings[ringNext++ % rings.length];
  m.material.color.setHex(color);
  m.position.set(x, y, 0);
  m.visible = true;
  tweens.add(0.5, (p) => {
    const e = ease.outCubic(p);
    m.scale.setScalar(RADIUS * lerp(1.02, size, e));
    m.material.opacity = 0.9 * (1 - p);
    if (p >= 1) m.visible = false;
  });
}

// ---------------------------------------------------------------- 塔
/** 高さ h での揺れによる横ずれ（根元は動かず、上ほど大きく曲がる） */
function swayOffset(h, href) {
  return (sway.th * h * h) / href;
}

function layout() {
  const n = tower.length;
  const href = Math.max(0.05, n * HEIGHT);
  const tremble = mode === "play" ? Math.max(0, danger - 0.72) * 0.006 : 0;
  let y = BASE_Y;
  for (let i = 0; i < n; i++) {
    const L = tower[i];
    const h = HEIGHT * L.s;
    const cy = y + h / 2;
    L.cy = cy;
    L.dx = L.x + swayOffset(cy, href) + L.jit + (tremble ? Math.sin(clock * 47 + i * 1.7) * tremble * (cy / href) : 0);
    const slope = (2 * sway.th * cy) / href;
    L.k.position.set(L.dx, cy, 0);
    L.k.rotation.set(0, L.ry, -Math.atan(slope));
    const bulge = 1 + (1 - L.s) * 0.55;
    L.k.scale.set(bulge, L.s, bulge);
    y += h;
  }
  topY = y;
}

/** 最も危ない段 j（その段より上の重心が、下の段からどれだけずれているか）と、その比 */
function imbalance() {
  let worst = 0;
  let wj = -1;
  let sum = 0;
  const n = tower.length;
  for (let j = n - 1; j >= 1; j--) {
    sum += tower[j].dx;
    const r = Math.abs(sum / (n - j) - tower[j - 1].dx) / TOPPLE;
    if (r > worst) {
      worst = r;
      wj = j;
    }
  }
  return { worst, j: wj };
}

function stepSway(dt) {
  if (mode === "idle" || mode === "load") {
    sway.th = 0.02 * Math.sin(clock * 1.6) + 0.006 * Math.sin(clock * 3.7);
    sway.v = 0;
    return;
  }
  const n = tower.length;
  const w = 2 * Math.PI * lerp(1.7, 0.7, clamp01(n / 35));
  const zeta = 0.075 * (1 - 0.5 * clamp01(danger));
  const sub = 3;
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    sway.v += (-w * w * sway.th - 2 * zeta * w * sway.v) * h;
    sway.th += sway.v * h;
  }
}

function stepSquash(dt) {
  for (let i = squashQueue.length - 1; i >= 0; i--) {
    const q = squashQueue[i];
    q.t -= dt;
    if (q.t <= 0) {
      const L = tower[q.i];
      if (L) L.sv -= q.amp;
      squashQueue.splice(i, 1);
    }
  }
  for (const L of tower) {
    L.sv += (-(L.s - 1) * 650 - L.sv * 17) * dt;
    L.s += L.sv * dt;
    L.s = Math.min(1.12, Math.max(0.7, L.s));
    L.jit *= Math.exp(-dt * 16);
  }
}

// ---------------------------------------------------------------- 揺れている金萬
function hoverAmp() {
  return RADIUS * 1.75;
}
function hoverPeriod() {
  return Math.max(0.95, 2.3 - stats.level * 0.048);
}
function hoverCenter() {
  return tower.length ? tower[tower.length - 1].x : 0;
}
function wave(p) {
  // ほぼ等速の往復。端だけ少し丸める
  return 0.78 * (2 / Math.PI) * Math.asin(Math.sin(p)) + 0.22 * Math.sin(p);
}

function spawnHover() {
  hover.k = takeKinman();
  hover.k.rotation.y = (Math.random() - 0.5) * 0.5;
  hover.state = "ready";
  hover.vy = 0;
  hover.appear = 0;
  // 端から動き出す
  hover.phase = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
  sfx.whoosh(true);
  tweens.add(0.32, (p) => (hover.appear = ease.outBack(p, 2.2)));
}

function stepHover(dt) {
  if (!hover.k) {
    updateGuide(0, 0, 0, false);
    return;
  }
  const baseY = topY + HEIGHT / 2 + GAP;
  if (hover.state === "ready") {
    hover.phase += (dt * 2 * Math.PI) / (mode === "idle" ? 2.6 : hoverPeriod());
    hover.prevX = hover.x;
    hover.x = hoverCenter() + hoverAmp() * wave(hover.phase);
    hover.y = baseY + Math.sin(clock * 5.2) * 0.0012 + (1 - hover.appear) * 0.03;
    const vel = dt > 0 ? (hover.x - hover.prevX) / dt : 0;
    hover.k.rotation.z = THREE.MathUtils.clamp(-vel * 0.9, -0.14, 0.14);
    hover.k.rotation.x = 0;
    hover.k.scale.setScalar(Math.max(0.001, hover.appear));
    updateGuide(hover.x, hover.y - HEIGHT / 2 - 0.002, topY + 0.0008, mode === "play" || mode === "count");
  } else if (hover.state === "falling") {
    hover.vy -= DROP_G * dt;
    hover.y += hover.vy * dt;
    hover.k.rotation.z *= Math.exp(-dt * 20);
    hover.k.scale.set(0.96, 1.06, 0.96); // 落ちながら少し伸びる
    updateGuide(0, 0, 0, false);
    if (hover.y - HEIGHT / 2 <= topY) {
      hover.y = topY + HEIGHT / 2;
      hover.k.position.set(hover.x, hover.y, 0);
      land();
      return;
    }
  }
  hover.k.position.set(hover.x, hover.y, 0);
}

function drop() {
  if (mode !== "play" || hover.state !== "ready" || hover.appear < 0.6) return;
  hover.state = "falling";
  hover.vy = -0.35;
  if (++drops >= 3) hint.hidden = true;
  sfx.tap();
}

// ---------------------------------------------------------------- 着地
const _v = new THREE.Vector3();
function screenAt(x, y) {
  return stage.toScreen(_v.set(x, y, 0));
}

function land() {
  const n = tower.length;
  const topDx = n ? tower[n - 1].dx : 0;
  const d = hover.x - topDx;
  const miss = n === 0 ? Math.abs(d) > 0.06 : Math.abs(d) >= STICK;
  if (miss) return slideOff(d);

  const perfect = Math.abs(d) < PERFECT;
  const staticTop = n ? tower[n - 1].x : 0;
  const L = { k: hover.k, x: perfect ? staticTop : staticTop + d, s: 0.74, sv: 0, jit: 0, ry: hover.k.rotation.y, dx: 0, cy: 0 };
  hover.k = null;
  hover.state = "none";
  tower.push(L);
  ui.music.tempo(1 + Math.min(tower.length, 30) * 0.007); // 高くなるほど曲も少し速く
  layout();
  L.jit = hover.x - L.dx; // 落ちた場所からなめらかに収まる（ぴったりは中心へ吸い付く）
  layout();

  // 衝撃が下へ伝わる
  for (let i = n - 1; i >= 0 && i >= n - 12; i--) squashQueue.push({ i, t: (n - i) * 0.022, amp: 2.6 * Math.pow(0.8, n - i) });

  // 揺れ: 高いほど、ずれが大きいほど強く揺れる
  const hf = THREE.MathUtils.clamp((tower.length * HEIGHT) / 0.2, 0.2, 1.6);
  const ad = Math.abs(d) / RADIUS;
  if (perfect) {
    sway.v *= 0.35;
    sway.th *= 0.6;
  } else {
    sway.v += Math.sign(d) * (0.04 + 0.36 * ad) * hf;
  }

  // その場で崩れるか（崩れたらこの段は数えない）
  const im = imbalance();
  danger = im.worst;
  const breaks = im.worst >= 1;
  stats.level = breaks ? tower.length - 1 : tower.length;
  const p = screenAt(L.dx, topY + 0.004);
  const pp = { x: p.x, y: p.y - 34 };
  if (perfect) {
    stats.perfect++;
    stats.combo++;
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
    ui.pop("ぴったり！", pp.x, pp.y, "great");
    if (stats.combo >= 2) setTimeout(() => ui.pop(`${stats.combo}連続`, pp.x + 70, pp.y + 42, "good"), 110);
    sfx.good(3);
    sfx.thud(1.25);
    burstRing(L.dx, topY + 0.0006);
    ui.shake(3);
    if (stats.combo % BONUS_EVERY === 0 && stats.lives < MAX_LIVES) {
      stats.lives++;
      setTimeout(() => {
        ui.pop("のこり ＋1", pp.x, pp.y - 56, "great");
        sfx.good(2);
      }, 260);
    }
  } else {
    stats.combo = 0;
    const mm = Math.abs(d) * 1000;
    const [text, kind, lv] = mm < 5 ? ["おしい！", "good", 2] : mm < 11 ? ["よし", "ok", 1] : ["ぎりぎり…", "bad", 0];
    ui.pop(text, pp.x, pp.y, kind);
    sfx.good(lv);
    sfx.thud(1.1);
    ui.shake(lv === 0 ? 4 : 2);
  }

  // 節目
  if (breaks) {
    // 何も出さない
  } else if (stats.level % 10 === 0) {
    setTimeout(() => {
      ui.big(`${stats.level}段！`, "go");
      sfx.taiko(1);
    }, 200);
  } else if (best > 0 && !stats.beatBest && stats.level === best + 1) {
    stats.beatBest = true;
    setTimeout(() => {
      ui.pop("ベスト超え！", innerWidth / 2, innerHeight * 0.3, "great");
      sfx.taiko(1.2);
    }, 200);
  }
  updateHUD();
  ensureRuler(topY + 0.5);

  if (breaks) {
    setTimeout(() => mode === "play" && collapse(im.j), 160);
    return;
  }
  setTimeout(() => mode === "play" && !hover.k && spawnHover(), 260);
}

function slideOff(d) {
  const k = hover.k;
  hover.k = null;
  hover.state = "none";
  const s = Math.sign(d) || 1;
  const edge = tower.length > 0 && Math.abs(d) < RADIUS * 2;
  const b = addBody(k);
  if (edge) {
    // 縁に引っかかって、外側へ傾きながら落ちる
    b.v.set(s * 0.32, 0.12, (Math.random() - 0.5) * 0.08);
    b.w.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, -s * 11);
    sway.v -= s * 0.12;
  } else {
    b.v.set(s * 0.05, hover.vy, 0);
    b.w.set((Math.random() - 0.5) * 2, 0, -s * 3);
  }
  stats.combo = 0;
  stats.miss++;
  stats.lives--;
  updateHUD();
  const p = screenAt(hover.x, topY + 0.01);
  ui.pop("ポロッ", p.x, p.y - 30, "bad");
  sfx.bad();
  sfx.whoosh(false);
  ui.shake(6);
  if (stats.lives <= 0) {
    mode = "end";
    finish?.("lives");
    return;
  }
  setTimeout(() => mode === "play" && !hover.k && spawnHover(), 520);
}

// ---------------------------------------------------------------- 崩壊
function collapse(jWorst) {
  mode = "collapse";
  const n = tower.length;
  // 見せ場なので、危なかった段より下からまとめて倒す（上の 4 割以上は必ず崩れる）
  let j = Math.min(jWorst, n - Math.max(2, Math.ceil(n * 0.4)));
  for (let i = 1; i < jWorst; i++) {
    let sum = 0;
    for (let k = i; k < n; k++) sum += tower[k].dx;
    if (Math.abs(sum / (n - i) - tower[i - 1].dx) / TOPPLE > 0.6) {
      j = Math.min(j, i);
      break;
    }
  }
  j = Math.max(1, j);
  // 倒れる向きは、いちばん危なかった段の重心が出た側
  let sum = 0;
  for (let i = jWorst; i < n; i++) sum += tower[i].dx;
  const side = Math.sign(sum / (n - jWorst) - tower[jWorst - 1].dx) || Math.sign(sway.th) || 1;
  const pivot = new THREE.Vector3(tower[j - 1].dx + side * RADIUS, tower[j].cy - (HEIGHT * tower[j].s) / 2, 0);
  const wz = -side * (1.6 + Math.sqrt(n - j) * 0.35);
  for (let i = j; i < n; i++) {
    const L = tower[i];
    const b = addBody(L.k);
    const rx = b.p.x - pivot.x;
    const ry = b.p.y - pivot.y;
    const f = (i - j + 1) / (n - j);
    b.v.set(-wz * ry + side * Math.random() * 0.08, wz * rx, (Math.random() - 0.5) * 0.35 * f);
    b.w.set((Math.random() - 0.5) * 4 * f, (Math.random() - 0.5) * 3, wz * (0.8 + Math.random() * 0.8));
  }
  tower.length = j;
  squashQueue.length = 0;
  sway.v -= side * 0.5;
  layout();

  // 残った金萬も消す
  if (hover.k) {
    const k = hover.k;
    hover.k = null;
    hover.state = "none";
    tweens.add(0.25, (p) => k.scale.setScalar(Math.max(0.001, 1 - p)), () => releaseKinman(k));
  }

  // スローモーションで見せる
  if (!reduceMotion) {
    timeScale = 0.28;
    tweens.add(1.6, (p) => (timeScale = lerp(0.28, 1, ease.inOutCubic(p))));
  }
  ui.music.stop(0.25);
  ui.big("くずれた！", "go t-crash");
  ui.shake(14);
  sfx.crack();
  sfx.whoosh(false);
  setTimeout(() => sfx.taiko(0.7), 120);
  finish?.("collapse");
}

// ---------------------------------------------------------------- 転がる金萬（簡単な剛体）
function addBody(k) {
  const b = {
    k,
    p: k.position.clone(),
    q: k.quaternion.clone(),
    v: new THREE.Vector3(),
    w: new THREE.Vector3(),
    still: 0,
    sleep: false,
  };
  k.scale.set(1, 1, 1);
  bodies.push(b);
  return b;
}

const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
let lastThud = 0;

function stepBodies(dt) {
  for (const b of bodies) {
    if (b.sleep) continue;
    b.v.y -= WORLD_G * dt;
    b.p.addScaledVector(b.v, dt);
    const wl = b.w.length();
    if (wl > 1e-5) {
      _q.setFromAxisAngle(_t.copy(b.w).divideScalar(wl), wl * dt);
      b.q.premultiply(_q).normalize();
    }
    _a.set(0, 1, 0).applyQuaternion(b.q);
    const ay = Math.min(1, Math.abs(_a.y));
    const reach = RADIUS * Math.sqrt(1 - ay * ay) + (HEIGHT / 2) * ay;

    // 残った塔にぶつかる: 真上なら乗り、横なら押し出す
    let floor = 0;
    const n = tower.length;
    if (n > 0 && b.p.y - reach < topY + 0.002) {
      const idx = Math.min(n - 1, Math.max(0, Math.floor((b.p.y - BASE_Y) / HEIGHT)));
      const top = tower[n - 1];
      const hx = b.p.x - top.dx;
      if (Math.hypot(hx, b.p.z) < RADIUS * 0.8 && b.p.y > topY) floor = topY;
      else if (b.p.y < topY + HEIGHT * 0.5) {
        const L = tower[idx];
        const ex = b.p.x - L.dx;
        const dist = Math.hypot(ex, b.p.z);
        const minD = RADIUS + reach * 0.9;
        if (dist < minD) {
          const nx = dist > 1e-5 ? ex / dist : Math.sign(ex) || 1;
          const nz = dist > 1e-5 ? b.p.z / dist : 0;
          b.p.x = L.dx + nx * minD;
          b.p.z = nz * minD;
          const vn = b.v.x * nx + b.v.z * nz;
          if (vn < 0) {
            b.v.x -= 1.4 * vn * nx;
            b.v.z -= 1.4 * vn * nz;
          }
        }
      }
    }

    const low = b.p.y - reach;
    if (low < floor) {
      b.p.y += floor - low;
      if (b.v.y < 0) {
        const imp = -b.v.y;
        b.v.y = imp > 0.12 ? imp * 0.3 : 0;
        if (imp > 0.25 && clock - lastThud > 0.06) {
          lastThud = clock;
          sfx.thud(0.75 + Math.random() * 0.5);
        }
        // 床に当たると回転が向きを変える
        b.w.x += (Math.random() - 0.5) * imp * 6;
        b.w.z *= 0.6;
      }
      const fr = Math.exp(-6 * dt);
      b.v.x *= fr;
      b.v.z *= fr;
      b.w.multiplyScalar(Math.exp(-5 * dt));
      // 平らに倒れて落ち着く
      _q2.setFromUnitVectors(_a, _a.y >= 0 ? UP : DOWN);
      _qi.identity().slerp(_q2, 1 - Math.exp(-7 * dt));
      b.q.premultiply(_qi);
      if (b.v.lengthSq() < 0.0006 && wl < 0.6) b.still += dt;
      else b.still = 0;
      if (b.still > 0.5) {
        b.sleep = true;
        b.q.premultiply(_q2);
        _a.set(0, 1, 0).applyQuaternion(b.q);
        b.p.y = floor + HEIGHT / 2;
      }
    }
    b.k.position.copy(b.p);
    b.k.quaternion.copy(b.q);
  }
  // 床の上で重ならないよう、横に押し分ける
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.p.y > HEIGHT * 1.3) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const c = bodies[j];
      if (c.p.y > HEIGHT * 1.3) continue;
      const dx = c.p.x - a.p.x;
      const dz = c.p.z - a.p.z;
      const d = Math.hypot(dx, dz);
      const minD = RADIUS * 1.9;
      if (d < minD && d > 1e-6) {
        const push = (minD - d) * 0.5 * Math.min(1, dt * 12);
        a.p.x -= (dx / d) * push;
        a.p.z -= (dz / d) * push;
        c.p.x += (dx / d) * push;
        c.p.z += (dz / d) * push;
        a.k.position.copy(a.p);
        c.k.position.copy(c.p);
      }
    }
  }
}

// ---------------------------------------------------------------- カメラ
const view = { x: 0, y: 0.08, vh: 0.12, az: 0, init: false };
const goal = { x: 0, y: 0.08, vh: 0.12, vw: 0.1, az: 0 };
const _look = new THREE.Vector3();

function computeGoal() {
  const aspect = camera.aspect;
  if (mode === "end" || (mode === "collapse" && bodies.length)) {
    // 全体を見せる
    let x0 = RULER_X - 0.02;
    let x1 = 0.05;
    let y1 = topY + 0.02;
    for (const b of bodies) {
      x0 = Math.min(x0, b.p.x - RADIUS);
      x1 = Math.max(x1, b.p.x + RADIUS);
      y1 = Math.max(y1, b.p.y + RADIUS);
    }
    for (const L of tower) {
      x0 = Math.min(x0, L.dx - RADIUS);
      x1 = Math.max(x1, L.dx + RADIUS);
    }
    x0 = Math.max(x0, -0.5);
    x1 = Math.min(x1, 0.5);
    const hy = Math.max(topY, 0.05);
    goal.vw = (x1 - x0) / 2 + 0.03;
    goal.vh = Math.max(0.09, hy / 2 + 0.05);
    goal.x = (x0 + x1) / 2;
    goal.y = hy / 2 + 0.01;
    goal.az = mode === "end" ? Math.sin(clock * 0.25) * 0.28 : 0;
    return;
  }
  if (mode === "idle" || mode === "load") {
    goal.vw = 0.1;
    goal.vh = Math.max(0.1, (topY + GAP + HEIGHT * 2) / 2 + 0.028);
    goal.x = -0.012;
    goal.y = (topY + GAP + HEIGHT) / 2 - 0.004;
    goal.az = Math.sin(clock * 0.3) * 0.22;
    return;
  }
  // プレイ中: てっぺんを追う
  goal.vw = 0.098;
  goal.vh = 0.125;
  const vhEff = Math.max(goal.vh, goal.vw / aspect);
  const hoverY = topY + GAP + HEIGHT;
  goal.y = Math.max(hoverY - 0.42 * vhEff, vhEff * 0.55);
  goal.x = hoverCenter() * 0.6 - 0.01;
  goal.az = 0;
}

function updateCamera(dt) {
  computeGoal();
  const k = view.init ? 1 - Math.exp(-dt * (mode === "end" ? 1.6 : 3.2)) : 1;
  view.init = true;
  const aspect = camera.aspect;
  const vhGoal = Math.max(goal.vh, goal.vw / aspect);
  view.x += (goal.x - view.x) * k;
  view.y += (goal.y - view.y) * k;
  view.vh += (vhGoal - view.vh) * k;
  view.az += (goal.az - view.az) * k;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = view.vh / tanH;
  const ce = Math.cos(ELEVATION);
  camera.position.set(view.x + Math.sin(view.az) * ce * dist, view.y + Math.sin(ELEVATION) * dist, Math.cos(view.az) * ce * dist);
  _look.set(view.x, view.y, 0);
  camera.lookAt(_look);

  // 影を落とす範囲をカメラに合わせて動かす
  const s = Math.max(0.14, view.vh * 1.25);
  const sc = key.shadow.camera;
  if (Math.abs(sc.top - s) > 0.002) {
    Object.assign(sc, { left: -s, right: s, top: s, bottom: -s });
    sc.updateProjectionMatrix();
  }
  key.target.position.set(view.x, Math.max(0, view.y - view.vh * 0.3), 0);
  key.position.copy(key.target.position).addScaledVector(KEY_DIR, 1.2);
}
stage.onResize(() => {
  view.init = false;
});

// ---------------------------------------------------------------- 進行
function updateHUD() {
  ui.set("level", String(stats.level));
  ui.set("height", cm(stats.level * HEIGHT));
  ui.set("life", String(Math.max(0, stats.lives)));
}

function clearAll() {
  for (const L of tower) releaseKinman(L.k);
  tower.length = 0;
  for (const b of bodies) releaseKinman(b.k);
  bodies.length = 0;
  if (hover.k) releaseKinman(hover.k);
  hover.k = null;
  hover.state = "none";
  squashQueue.length = 0;
  tweens.clear();
  for (const r of rings) r.visible = false;
  sway.th = sway.v = 0;
  timeScale = 1;
  danger = 0;
  warned = false;
  layout();
}

function buildIdle() {
  clearAll();
  // 少しずつずれた塔
  const xs = [0, 0.003, -0.002, 0.004, 0.001, -0.004, -0.001, 0.003, 0.005];
  for (const x of xs) {
    const k = takeKinman();
    tower.push({ k, x, s: 1, sv: 0, jit: 0, ry: (Math.random() - 0.5) * 0.5, dx: x, cy: 0 });
  }
  layout();
  ensureRuler(0.6);
  hover.k = takeKinman();
  hover.state = "ready";
  hover.appear = 1;
  hover.phase = 0.6;
}

function resetGame() {
  clearAll();
  Object.assign(stats, { level: 0, lives: START_LIVES, perfect: 0, combo: 0, maxCombo: 0, miss: 0, beatBest: false });
  updateHUD();
  updateBestMark();
}

function checkDanger() {
  if (mode !== "play" || tower.length < 2) {
    if (mode === "play") danger = 0;
    return;
  }
  const im = imbalance();
  danger = im.worst;
  if (im.worst >= 1) {
    collapse(im.j);
    return;
  }
  if (im.worst > 0.78 && !warned) {
    warned = true;
    const t = tower[tower.length - 1];
    const p = screenAt(t.dx, topY + 0.01);
    ui.pop("ぐらぐら…", p.x - 60, p.y - 70, "bad");
    sfx.tick();
  } else if (im.worst < 0.6) warned = false;
}

function frame(rdt) {
  const dt = rdt * timeScale;
  clock += rdt;
  tweens.step(rdt);
  stepSway(dt);
  stepSquash(dt);
  layout();
  checkDanger();
  stepHover(dt);
  stepBodies(dt);
  pointer.position.y = topY;
  updateCamera(rdt);
}

function onKey(e) {
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowDown") {
    if (mode === "play" || mode === "count") {
      e.preventDefault();
      drop();
    }
  }
}
addEventListener("keydown", onKey);
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  drop();
});

function rankOf(level) {
  return RANKS.find((r) => level >= r.min);
}

async function playRound() {
  resetGame();
  document.activeElement?.blur?.();
  mode = "count";
  spawnHover();
  await ui.countdown();
  mode = "play";
  drops = 0;
  hint.hidden = false;
  const reason = await new Promise((res) => (finish = res));
  finish = null;
  hint.hidden = true;
  await wait(reason === "collapse" ? 2000 : 1100);
  mode = "end";
  sfx.whistle();
  ui.music.stop(0.8);
  ui.big("おしまい！", "end");
  await wait(1900);

  const level = stats.level;
  const h = cm(level * HEIGHT);
  const r = rankOf(level);
  return ui.result({
    score: level,
    unit: "段",
    label: "積んだ高さ",
    rank: r.title,
    comment: `高さ ${h}cm。${r.comment}`,
    detail: `<table>
      <tr><td>ぴったり</td><td>${stats.perfect}回</td></tr>
      <tr><td>最大連続</td><td>${stats.maxCombo}回</td></tr>
      <tr><td>落とした数</td><td>${stats.miss}個</td></tr>
      <tr><td>おわり方</td><td>${reason === "collapse" ? "塔がくずれた" : "のこりがなくなった"}</td></tr>
    </table>`,
    share: `金萬タワー ${level}段（高さ${h}cm）#金萬ミニゲーム`,
  });
}

async function main() {
  try {
    kit = await loadKinman(stage.renderer);
    try {
      await Promise.race([document.fonts.load('800 40px "Shippori Mincho B1"'), wait(2500)]);
    } catch {}
    fontsReady = true;
    mode = "idle";
    buildIdle();
    updateBestMark();
    stage.start(frame);
    ld.done();
  } catch (err) {
    console.warn(err);
    ld.fail();
    return;
  }
  await ui.start({
    lead: "左右に揺れる金萬を、タイミングよく落として積み上げよう。",
    rules: [
      "タップ・<b>Space</b> で落とす。ど真ん中なら「ぴったり！」",
      `ぴったりが${BONUS_EVERY}回続くと、のこりが1つ増える`,
      "縁からはみ出すと落ちる。のこりは3つ",
      "ずれるほど塔は揺れる。重心が外に出ると崩れる",
    ],
  });
  for (;;) {
    const next = await playRound();
    if (next !== "retry") break;
  }
}
main();
