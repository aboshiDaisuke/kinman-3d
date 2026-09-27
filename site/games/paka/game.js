// パカッと割り: 小皿の上の金萬を、点線にそってスワイプして真っ二つに割る。8ラウンド。
//
// 判定はスワイプの軌跡を「金萬の上面の高さの水平面」にレイキャストし、金萬の座標系（滑ったり回ったり
// していても金萬から見た位置）に直してから行う。角度・中心からのずれ・まっすぐさ・速さで 100 点満点。
import { THREE, createStage, loadKinman, randomLook, setStamp, createTweens, ease, clamp01, lerp, RADIUS, HEIGHT } from "../shared/kinman.js";
import { createUI, loading, wait, sfx } from "../shared/ui.js";
import { sliceGeometry, capGeometry, cutMaterial } from "./slice.js";

const R = RADIUS;
const H = HEIGHT;
const PLATE_Y = 0.006; // 小皿の見込み（平らなところ）の高さ
const FLAT_R = 0.031; // 見込みの半径
const CENTER_Y = PLATE_Y + H / 2;
const TOP_Y = PLATE_Y + H; // スワイプを当てる平面
const DEG = Math.PI / 180;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ラウンドごとの難しさ。guide: show（出たまま）/ flash（一瞬だけ）/ none（なし）
// move: sway（ゆらゆら）/ circle（円を描く）/ zigzag（止まっては急に動く）、slide: 動く幅、speed: 動く速さ
// spin: 回る速さ（rad/s）、wobble: 回る向きが行ったり来たりする、time: 制限時間（秒）
const ROUNDS = [
  { guide: "show", move: "sway", slide: 1, speed: 1, spin: 0.5, time: 4, note: "金萬がゆらゆら動く", hint: "動く点線にそってなぞる" },
  { guide: "show", move: "circle", slide: 1, speed: 1, spin: -0.9, time: 3.5, note: "回りながら、ぐるっと滑る", hint: "回る点線にあわせてなぞる" },
  { guide: "show", move: "zigzag", slide: 1, speed: 1, spin: 0.7, time: 3.5, note: "止まっては、急に動く", hint: "止まった瞬間をねらう" },
  { guide: "show", move: "sway", slide: 0.6, speed: 1.3, spin: 2.2, time: 3, note: "高速回転！", hint: "すばやく、まっすぐ" },
  { guide: "flash", move: "circle", slide: 0.8, speed: 1.2, spin: 0.9, time: 3.5, note: "点線は一瞬だけ。焼き印が目印", hint: "焼き印を目印に、さっきの向きで" },
  { guide: "show", move: "zigzag", slide: 1, speed: 1.5, spin: 1.2, wobble: true, time: 3, note: "右へ左へ、回る向きも変わる", hint: "動きを読んでなぞる" },
  { guide: "flash", move: "zigzag", slide: 1, speed: 1.4, spin: 1.5, time: 3, note: "一瞬だけ＋ジグザグ＋回転", hint: "焼き印を目印に、点線の向きで" },
  { guide: "none", move: "circle", slide: 1, speed: 1.7, spin: -1.6, time: 2.5, note: "点線なし。まんなかを通せ", hint: "向きは自由。まんなかを通す" },
];

// ---------------------------------------------------------------- 舞台
const canvas = document.getElementById("view");
const fxCanvas = document.getElementById("fx");
const fx2d = fxCanvas.getContext("2d");
const flashEl = document.getElementById("flash");
const load = loading();

const ui = createUI({
  id: "paka",
  title: "パカッと割り",
  hud: [
    { key: "round", label: "ラウンド", value: "-" },
    { key: "score", label: "スコア", value: "0" },
  ],
  formatBest: (v) => `${v}点`,
});

const stage = createStage(canvas, { shadows: true, shadowSize: 0.09, fov: 30 });
const { scene, camera, renderer } = stage;
const tweens = createTweens();
const delay = (s) => new Promise((res) => tweens.add(s, () => {}, res));

// 見下ろす角度（水平から）と、画面に入れたい範囲（メートル）
const CAM_ELEV = 66 * DEG;
const camTarget = new THREE.Vector3(0, TOP_Y, 0.001);
let camZoom = 1; // 割れた瞬間に少し寄る
function placeCamera() {
  const t = Math.tan((camera.fov / 2) * DEG);
  const needW = 0.086;
  const needH = 0.11;
  const d = Math.max(needH / (2 * t), needW / (2 * t * camera.aspect)) * camZoom;
  camera.position.set(camTarget.x, camTarget.y + Math.sin(CAM_ELEV) * d, camTarget.z + Math.cos(CAM_ELEV) * d);
  camera.lookAt(camTarget);
}
let fxW = 1;
let fxDirty = true;
let fxH = 1;
stage.onResize((w, h) => {
  placeCamera();
  const dpr = Math.min(devicePixelRatio, 2);
  fxW = w;
  fxH = h;
  fxCanvas.width = Math.round(w * dpr);
  fxCanvas.height = Math.round(h * dpr);
  fx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxDirty = true;
});

// ---- 木の板（まな板）
function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#cfa77a";
  g.fillRect(0, 0, 1024, 1024);
  // 木目: ゆるく波打つ細い線を重ねる
  for (let i = 0; i < 170; i++) {
    const y0 = Math.random() * 1024;
    const amp = 4 + Math.random() * 14;
    const f = 0.002 + Math.random() * 0.004;
    const ph = Math.random() * 6.28;
    const dark = Math.random() < 0.55;
    g.strokeStyle = dark ? `rgba(120,76,40,${0.05 + Math.random() * 0.12})` : `rgba(255,236,205,${0.05 + Math.random() * 0.1})`;
    g.lineWidth = 0.6 + Math.random() * (dark ? 2.4 : 3.5);
    g.beginPath();
    for (let x = -10; x <= 1034; x += 16) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.25;
      x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const board = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.012, 0.42),
  new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.78, metalness: 0 })
);
board.position.y = -0.006;
board.receiveShadow = true;
scene.add(board);

// ---- 小皿（白磁に藍の線）。旋盤で回した形。底の裏から外へ、縁を回って見込みの中心へ
const platePts = [];
const P = (r, y) => platePts.push(new THREE.Vector2(r, y));
P(0.0001, 0.0022);
P(0.024, 0.0022);
P(0.0245, 0);
P(0.029, 0);
P(0.0296, 0.0024);
P(0.036, 0.0036);
P(0.043, 0.0068);
P(0.0462, 0.0112);
P(0.0466, 0.0119);
P(0.0461, 0.0122);
for (let i = 0; i <= 10; i++) {
  const t = i / 10;
  P(lerp(0.0452, FLAT_R, t), PLATE_Y + 0.0058 * Math.pow(1 - t, 1.7));
}
P(0.0001, PLATE_Y);
const plate = new THREE.Mesh(
  new THREE.LatheGeometry(platePts, 96),
  new THREE.MeshPhysicalMaterial({ color: 0xf4efe6, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.18 })
);
plate.castShadow = true;
plate.receiveShadow = true;
scene.add(plate);
const indigo = new THREE.MeshStandardMaterial({ color: 0x2e4a78, roughness: 0.4 });
const rimLine = new THREE.Mesh(new THREE.TorusGeometry(0.0461, 0.00055, 6, 96), indigo);
rimLine.rotation.x = -Math.PI / 2;
rimLine.position.y = 0.0121;
const innerLine = new THREE.Mesh(new THREE.RingGeometry(FLAT_R + 0.0012, FLAT_R + 0.0019, 96), indigo);
innerLine.rotation.x = -Math.PI / 2;
innerLine.position.y = PLATE_Y + 0.00012;
innerLine.receiveShadow = true;
scene.add(rimLine, innerLine);

// ---- 金萬まわりの入れ物
// mover（滑る・回る）> wholeYaw（焼き印の向き）> whole
//                                            > cutRoot > 割ったかけら2つ
//                    > guideG（ガイドの点線）
const mover = new THREE.Group();
const wholeYaw = new THREE.Group();
const cutRoot = new THREE.Group();
const guideG = new THREE.Group();
wholeYaw.add(cutRoot);
mover.add(wholeYaw, guideG);
scene.add(mover);

// 点線のガイド（上から見て X 軸方向。両端に内向きの矢じり）
function lineTexture(kind) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 64;
  const g = c.getContext("2d");
  const mid = 32;
  const tri = (x, dir) => {
    g.beginPath();
    g.moveTo(x, mid);
    g.lineTo(x - dir * 44, mid - 20);
    g.lineTo(x - dir * 44, mid + 20);
    g.closePath();
  };
  const pass = (stroke, width, fill) => {
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = stroke;
    g.lineWidth = width;
    if (kind === "guide") {
      g.setLineDash([34, 22]);
      g.beginPath();
      g.moveTo(96, mid);
      g.lineTo(928, mid);
      g.stroke();
      g.setLineDash([]);
      tri(76, 1);
      g.fillStyle = fill;
      if (width > 20) g.stroke();
      g.fill();
      tri(948, -1);
      if (width > 20) g.stroke();
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(40, mid);
      g.lineTo(984, mid);
      g.stroke();
      tri(1000, 1);
      g.fillStyle = fill;
      if (width > 20) g.stroke();
      g.fill();
    }
  };
  pass("rgba(58,26,8,0.6)", 24, "rgba(58,26,8,0.6)");
  pass(kind === "guide" ? "#fffaf0" : "#ffd9a8", 13, kind === "guide" ? "#fffaf0" : "#ffd9a8");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const overlayMat = (map) =>
  new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
const GUIDE_LEN = R * 2.9;
const guideMat = overlayMat(lineTexture("guide"));
const guide = new THREE.Mesh(new THREE.PlaneGeometry(GUIDE_LEN, GUIDE_LEN * (64 / 1024)), guideMat);
guide.rotation.x = -Math.PI / 2;
guide.renderOrder = 10;
guideG.position.y = TOP_Y + 0.0006;
guideG.add(guide);

// キーボード用の狙いの線（世界の向きで持つので mover の外）
const aimG = new THREE.Group();
const aimMat = overlayMat(lineTexture("aim"));
const aim = new THREE.Mesh(new THREE.PlaneGeometry(R * 3.1, R * 3.1 * (64 / 1024)), aimMat);
aim.rotation.x = -Math.PI / 2;
aim.renderOrder = 11;
aimG.add(aim);
aimG.visible = false;
scene.add(aimG);

// ---- かけら（InstancedMesh を使い回す）
const CRUMB_MAX = 160;
const crumbMesh = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(1, 0),
  new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }),
  CRUMB_MAX
);
crumbMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
crumbMesh.castShadow = true;
crumbMesh.frustumCulled = false;
scene.add(crumbMesh);
const CRUST = [0xb8743a, 0xc98b4c, 0xa8622b, 0xd49a5c].map((c) => new THREE.Color(c));
const BEAN = [0xf1e6cc, 0xeadbb6, 0xf6eedb].map((c) => new THREE.Color(c));
const crumbs = Array.from({ length: CRUMB_MAX }, () => ({
  on: false,
  rest: false,
  p: new THREE.Vector3(),
  v: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  w: new THREE.Vector3(),
  s: new THREE.Vector3(),
  k: 1,
}));
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _eu = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < CRUMB_MAX; i++) {
  crumbMesh.setMatrixAt(i, ZERO);
  crumbMesh.setColorAt(i, CRUST[0]);
}
let crumbCursor = 0;
let crumbFade = 0; // 0 より大きい間、かけらを縮めて片付ける

/** 局所座標の線（u, v, 角度 a）に沿ってかけらを n 個飛ばす */
function spawnCrumbs(n, line, big = 0) {
  const { cu, cv, a } = line;
  const du = Math.cos(a);
  const dv = Math.sin(a);
  for (let i = 0; i < n; i++) {
    const idx = crumbCursor;
    const c = crumbs[idx];
    crumbCursor = (crumbCursor + 1) % CRUMB_MAX;
    // 割れ目の上のどこか（金萬の中だけ）
    const half = Math.sqrt(Math.max(0, R * R - (cu * cu + cv * cv - (cu * du + cv * dv) ** 2)));
    const along = (Math.random() * 2 - 1) * Math.max(half, R * 0.3) * 0.9 - (cu * du + cv * dv);
    const u = cu + du * along;
    const v = cv + dv * along;
    const side = Math.random() < 0.5 ? -1 : 1;
    // 局所 → 世界
    _v.set(u, TOP_Y - Math.random() * H * 0.6, -v);
    mover.localToWorld(_v);
    c.p.copy(_v);
    // 割れ目から左右へ弾ける
    const sp = 0.05 + Math.random() * 0.16;
    _v2.set(-dv * side * sp + du * (Math.random() - 0.5) * 0.08, 0, -(du * side * sp) - dv * (Math.random() - 0.5) * 0.08);
    _v2.applyAxisAngle(THREE.Object3D.DEFAULT_UP, mover.rotation.y);
    c.v.set(_v2.x, 0.12 + Math.random() * 0.22, _v2.z);
    c.q.setFromEuler(_eu.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    c.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(40);
    const size = (0.0008 + Math.random() * 0.0014) * (1 + big * Math.random() * 0.9);
    c.s.set(size * (0.8 + Math.random() * 0.6), size * (0.45 + Math.random() * 0.35), size * (0.8 + Math.random() * 0.6));
    c.k = 1;
    c.on = true;
    c.rest = false;
    const bean = Math.random() < 0.42;
    const pal = bean ? BEAN : CRUST;
    crumbMesh.setColorAt(idx, pal[(Math.random() * pal.length) | 0]);
  }
  crumbMesh.instanceColor.needsUpdate = true;
}
function floorAt(x, z) {
  const r = Math.hypot(x, z);
  if (r < FLAT_R) return PLATE_Y;
  if (r < 0.046) return PLATE_Y + (r - FLAT_R) * 0.38;
  return 0;
}
const GRAV = 2.6; // ゆっくり落ちるほうが見映えがいい
function stepCrumbs(dt) {
  if (crumbFade > 0) crumbFade = Math.max(0, crumbFade - dt);
  for (let i = 0; i < CRUMB_MAX; i++) {
    const c = crumbs[i];
    if (!c.on) continue;
    if (!c.rest) {
      c.v.y -= GRAV * dt;
      c.p.addScaledVector(c.v, dt);
      const f = floorAt(c.p.x, c.p.z) + c.s.y * 0.5;
      if (c.p.y < f) {
        c.p.y = f;
        c.v.y *= -0.28;
        c.v.x *= 0.55;
        c.v.z *= 0.55;
        c.w.multiplyScalar(0.5);
        if (Math.abs(c.v.y) < 0.02 && c.v.x * c.v.x + c.v.z * c.v.z < 0.0004) c.rest = true;
      }
      _v.copy(c.w).multiplyScalar(dt);
      const ang = _v.length();
      if (ang > 0) c.q.premultiply(_q.setFromAxisAngle(_v.divideScalar(ang), ang));
    }
    if (crumbFade > 0) c.k = Math.min(c.k, crumbFade / 0.3);
    if (c.k <= 0) {
      c.on = false;
      crumbMesh.setMatrixAt(i, ZERO);
      continue;
    }
    _m4.compose(c.p, c.q, _sc.copy(c.s).multiplyScalar(c.k));
    crumbMesh.setMatrixAt(i, _m4);
  }
  crumbMesh.instanceMatrix.needsUpdate = true;
}
function clearCrumbsNow() {
  for (let i = 0; i < CRUMB_MAX; i++) {
    crumbs[i].on = false;
    crumbMesh.setMatrixAt(i, ZERO);
  }
  crumbMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- 2D の効果（刃の軌跡・斬撃・集中線・フラッシュ）
const TRAIL_MAX = 96;
const trail = Array.from({ length: TRAIL_MAX }, () => ({ x: 0, y: 0, t: -1, brk: false }));
let trailHead = 0;
let clock = 0; // 実時間（秒）
function trailPush(x, y, brk = false) {
  const p = trail[trailHead];
  p.x = x;
  p.y = y;
  p.t = clock;
  p.brk = brk;
  trailHead = (trailHead + 1) % TRAIL_MAX;
}
const slash = { on: false, t: 0, x1: 0, y1: 0, x2: 0, y2: 0, power: 1 };
const focus = { on: false, t: 0, x: 0, y: 0, r0: 100, dur: 0.45, n: 48, power: 1 };
const TRAIL_LIFE = 0.24;

function drawFx() {
  const g = fx2d;
  let any = false;
  // 残っている軌跡があるか
  for (let i = 0; i < TRAIL_MAX; i++) if (trail[i].t >= 0 && clock - trail[i].t < TRAIL_LIFE) any = true;
  if (slash.on && clock - slash.t > 0.34) slash.on = false;
  if (focus.on && clock - focus.t > focus.dur) focus.on = false;
  if (!any && !slash.on && !focus.on && !fxDirty) return;
  fxDirty = any || slash.on || focus.on;
  g.clearRect(0, 0, fxW, fxH);

  // 集中線: 画面の外から切り口へ向かう細い三角形。毎フレーム少しずつ変えてちらつかせる
  if (focus.on) {
    const p = (clock - focus.t) / focus.dur;
    const a = (1 - p) * 0.55 * focus.power;
    const far = Math.hypot(fxW, fxH);
    g.fillStyle = `rgba(43,29,20,${a})`;
    g.beginPath();
    for (let i = 0; i < focus.n; i++) {
      const th = (i / focus.n) * Math.PI * 2 + Math.random() * 0.1;
      const w = 0.004 + Math.random() * 0.014;
      const r0 = focus.r0 * (1.05 + Math.random() * 0.5 + p * 0.4);
      g.moveTo(focus.x + Math.cos(th) * r0, focus.y + Math.sin(th) * r0);
      g.lineTo(focus.x + Math.cos(th - w) * far, focus.y + Math.sin(th - w) * far);
      g.lineTo(focus.x + Math.cos(th + w) * far, focus.y + Math.sin(th + w) * far);
      g.closePath();
    }
    g.fill();
  }

  // 刃の軌跡: 新しいほど太く、古いほど細く薄く
  g.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k < TRAIL_MAX; k++) {
      const i1 = (trailHead - k + TRAIL_MAX) % TRAIL_MAX;
      const i0 = (trailHead - k - 1 + TRAIL_MAX) % TRAIL_MAX;
      const p1 = trail[i1];
      const p0 = trail[i0];
      if (p1.t < 0 || p0.t < 0 || p1.brk) continue;
      const age = clock - p1.t;
      if (age > TRAIL_LIFE) continue;
      const f = 1 - age / TRAIL_LIFE;
      g.strokeStyle = pass === 0 ? `rgba(138,59,23,${0.35 * f})` : `rgba(255,251,242,${0.95 * f})`;
      g.lineWidth = (pass === 0 ? 11 : 5) * f + 1;
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
  }

  // 斬撃: 割れ目にそった光の筋が、画面を横切って細くなって消える
  if (slash.on) {
    const p = (clock - slash.t) / 0.34;
    const dx = slash.x2 - slash.x1;
    const dy = slash.y2 - slash.y1;
    const e = ease.outExpo(Math.min(1, p * 2.2));
    const w = 14 * slash.power * Math.pow(1 - p, 2) + 1;
    g.save();
    g.lineCap = "round";
    g.shadowColor = "rgba(255,210,150,0.9)";
    g.shadowBlur = 24;
    g.strokeStyle = `rgba(255,252,244,${1 - p})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(slash.x1 + dx * (0.5 - 0.5 * e), slash.y1 + dy * (0.5 - 0.5 * e));
    g.lineTo(slash.x1 + dx * (0.5 + 0.5 * e), slash.y1 + dy * (0.5 + 0.5 * e));
    g.stroke();
    g.restore();
  }
}

function flash(x, y, amount) {
  if (reduceMotion) return;
  flashEl.style.setProperty("--fx", `${x}px`);
  flashEl.style.setProperty("--fy", `${y}px`);
  flashEl.style.setProperty("--fa", String(amount));
  flashEl.classList.remove("on");
  void flashEl.offsetWidth;
  flashEl.classList.add("on");
}

// ---------------------------------------------------------------- ラウンドの見出しと下のひとこと
const banner = document.createElement("div");
banner.className = "pk-banner";
banner.hidden = true;
banner.setAttribute("aria-hidden", "true");
document.body.append(banner);
let bannerTimer = 0;
function showBanner(i, note) {
  banner.innerHTML = `<div class="pk-banner-num"><small>ラウンド</small>${i + 1}<em>/${ROUNDS.length}</em></div><div class="pk-banner-note">${note}</div>`;
  banner.hidden = false;
  banner.classList.remove("on");
  void banner.offsetWidth;
  banner.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (banner.hidden = true), 1800);
}
const hint = document.createElement("div");
hint.className = "pk-hint";
hint.hidden = true;
hint.innerHTML = `<div class="pk-hint-main"></div><div class="pk-hint-keys"><kbd>←</kbd><kbd>→</kbd> で向きを変えて <kbd>Space</kbd> で割る</div>`;
document.body.append(hint);
const hintMain = hint.querySelector(".pk-hint-main");

// 制限時間のゲージ
const timerEl = document.createElement("div");
timerEl.className = "pk-timer";
timerEl.hidden = true;
timerEl.innerHTML = "<i></i>";
document.body.append(timerEl);
let timeLeft = 0;
let lastTick = -1;

// ---------------------------------------------------------------- 状態
let kit = null;
let whole = null; // 丸ごと
let pieces = []; // 割ったかけら { g, geos, c0, m, samples, ... }
let cutMat = null;
let look = null;
let wholePsi = 0; // 丸ごとの焼き印の向き
let guideTheta = 0; // ガイドの角度（mover の中での向き）
let state = "boot"; // boot / idle / intro / aim / cut / done
let cfg = ROUNDS[0];
let moveT = 0;
const motion = { ph1: 0, ph2: 0, rot0: 0 };
let hitStop = 0;
let runToken = 0;
let aimAngle = 0; // キーボードの狙い（世界の向き）
let aimUsed = false;
const keys = { left: false, right: false };
let pendingCut = null; // 割るのを待っている Promise の resolve
let guideFade = null;

// 皿の平らなところからはみ出さない範囲（中心のずれ 9mm まで）で動かす
function setMotion(t) {
  const A = 0.009 * (cfg.slide ?? 0);
  const f = cfg.speed ?? 1;
  let x = 0;
  let z = 0;
  if (cfg.move === "sway") {
    x = A * Math.sin(t * 2.3 * f + motion.ph1);
    z = A * 0.4 * Math.sin(t * 1.7 * f + motion.ph2);
  } else if (cfg.move === "circle") {
    x = A * Math.cos(t * 2.1 * f + motion.ph1);
    z = A * Math.sin(t * 2.1 * f + motion.ph1);
  } else if (cfg.move === "zigzag") {
    // 区間の前半でさっと動いて、後半は止まる
    const seg = 0.62 / f;
    const k = Math.floor(t / seg);
    const u = t / seg - k;
    const e = ease.inOutCubic(Math.min(1, u / 0.42));
    const pt = (n) => {
      const a = hash01(n * 12.9898 + motion.ph1) * Math.PI * 2;
      const r = A * Math.sqrt(0.35 + 0.65 * hash01(n * 78.233 + motion.ph2));
      return [r * Math.cos(a), r * Math.sin(a)];
    };
    const [x0, z0] = pt(k);
    const [x1, z1] = pt(k + 1);
    x = lerp(x0, x1, e);
    z = lerp(z0, z1, e);
  }
  mover.position.set(x, 0, z);
  const spin = cfg.spin ?? 0;
  mover.rotation.y = motion.rot0 + (cfg.wobble ? (spin / 1.3) * 1.6 * Math.sin(t * 1.3) : spin * t);
}
const hash01 = (n) => {
  const v = Math.sin(n) * 43758.5453;
  return v - Math.floor(v);
};

function disposePieces() {
  for (const p of pieces) {
    p.g.removeFromParent();
    for (const g of p.geos) g.dispose();
  }
  pieces = [];
}

/** 円を中心から d 離れた弦で切ったとき、小さいほうの面積の割合 */
function segmentFrac(d) {
  const x = Math.min(1, Math.abs(d) / R);
  return (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

// ---------------------------------------------------------------- 1個出す・割る・片付ける
function resetTable() {
  tweens.clear();
  clearCrumbsNow();
  crumbFade = 0;
  hitStop = 0;
  camZoom = 1;
  placeCamera();
  whole.visible = false;
  disposePieces();
  guideG.visible = false;
  aimG.visible = false;
  slash.on = false;
  focus.on = false;
  guideFade = null;
}

/** 新しい金萬を皿に落とす。着地したら resolve */
function present(round, quiet = false) {
  cfg = round;
  look = randomLook();
  wholePsi = Math.random() * Math.PI * 2;
  guideTheta = Math.random() * Math.PI;
  setStamp(whole, look);
  whole.visible = true;
  whole.scale.set(1, 1, 1);
  whole.position.set(0, 0.07, 0);
  whole.rotation.set(0, 0, 0);
  wholeYaw.rotation.y = wholePsi;
  wholeYaw.position.set(0, CENTER_Y, 0);
  wholeYaw.visible = true;
  disposePieces();
  motion.ph1 = Math.random() * 6.28;
  motion.ph2 = Math.random() * 6.28;
  motion.rot0 = Math.random() * 6.28;
  moveT = 0;
  setMotion(0);
  guideG.visible = false;
  guideG.rotation.y = guideTheta;
  guideMat.opacity = 1;
  guideFade = null;
  crumbFade = 0.3;

  return new Promise((res) => {
    tweens.add(0.36, (p) => {
      const e = p * p;
      whole.position.y = lerp(0.07, 0, e);
      whole.rotation.x = (1 - e) * 0.5;
      whole.rotation.z = (1 - e) * -0.3;
    }, () => {
      if (!quiet) {
        sfx.thud(1.5);
        ui.shake(3);
      }
      // 着地のつぶれ
      tweens.add(0.42, (p) => {
        const s = Math.sin(p * Math.PI) * (1 - p) * 0.9;
        whole.scale.set(1 + s * 0.1, 1 - s * 0.22, 1 + s * 0.1);
      });
      if (cfg.guide !== "none") {
        guideG.visible = true;
        guide.scale.set(0.001, 1, 1);
        tweens.add(0.32, (p) => guide.scale.set(Math.max(0.001, ease.outBack(p)), 1, 1));
        if (!quiet) sfx.tick();
        if (cfg.guide === "flash") {
          // 一瞬だけ見せて消す
          guideFade = tweens.add(1.25, (p) => {
            guideMat.opacity = p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
            if (p >= 1) guideG.visible = false;
          });
        }
      }
      res();
    });
  });
}

/**
 * 割れる演出。res は判定に使った局所座標の線、j は判定。
 * なぞった線の位置と向きで金萬のメッシュを実際に切るので、中心から外れれば大小のかけらになる。
 * まっすぐでない・遅いなぞり方では、切り口が斜めになる。
 */
function breakOpen(res, j, quiet = false) {
  const line = res.line;
  const alpha = line.a;
  disposePieces();
  const mesh = whole.children[0];
  const material = whole.userData.material;
  // 線を mover の座標から金萬のメッシュの座標へ（wholeYaw の回転を打ち消す）
  const UP = THREE.Object3D.DEFAULT_UP;
  const P = new THREE.Vector3(line.cu, H / 2, -line.cv).applyAxisAngle(UP, -wholePsi);
  const D = new THREE.Vector3(Math.cos(alpha), 0, -Math.sin(alpha)).applyAxisAngle(UP, -wholePsi);
  const N = new THREE.Vector3(D.z, 0, -D.x);
  const rough = j.level < 1; // ボロッ
  const tilt = Math.min(0.55, res.dev * 1.5 + (j.slow ? 0.3 : 0) + (rough ? 0.12 : 0)) * (Math.random() < 0.5 ? -1 : 1);
  N.applyAxisAngle(D, tilt).normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(N, P);
  const cut = sliceGeometry(mesh.geometry, plane);

  // 金萬の中心が平面のどちら側か → 大きいほうのかけら
  const dCenter = plane.distanceToPoint(new THREE.Vector3(0, H / 2, 0));
  const small = segmentFrac(dCenter);
  const fracNeg = dCenter < 0 ? 1 - small : small;
  j.ratio = [Math.round((1 - small) * 100), Math.round(small * 100)];

  const makePiece = (geo, outward, frac) => {
    const cap = capGeometry(cut.points, plane, outward);
    const g = new THREE.Group();
    geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    for (const part of [new THREE.Mesh(geo, material), cap && new THREE.Mesh(cap, cutMat)]) {
      if (!part) continue;
      part.castShadow = part.receiveShadow = true;
      part.position.copy(c).negate();
      g.add(part);
    }
    const c0 = c.clone();
    c0.y -= H / 2;
    g.position.copy(c0);
    // 皿にめり込まない高さを出すための頂点（重心から見た位置）
    const pa = geo.attributes.position;
    const step = Math.max(1, Math.floor(pa.count / 1200));
    const samples = [];
    for (let i = 0; i < pa.count; i += step) samples.push(new THREE.Vector3().fromBufferAttribute(pa, i).sub(c));
    const axis = outward.clone().setY(0).normalize().cross(UP).normalize();
    const f = clamp01((frac - 0.08) / 0.84);
    let theta = lerp(1.35, 0.5, f);
    if (rough) theta *= 0.75 + Math.random() * 0.3;
    const away = outward.clone().setY(0).normalize().negate();
    cutRoot.add(g);
    return {
      g,
      geos: [geo, cap].filter(Boolean),
      c0,
      samples,
      axis,
      theta,
      away,
      sep: lerp(0.016, 0.008, f) + (rough ? 0.002 : 0),
      yaw: (Math.random() - 0.5) * (rough ? 0.5 : 0.12),
    };
  };
  pieces = [makePiece(cut.neg, N.clone(), fracNeg), makePiece(cut.pos, N.clone().negate(), 1 - fracNeg)];
  whole.visible = false;

  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const pose = (p, s, hop) => {
    qTilt.setFromAxisAngle(p.axis, p.theta * s);
    qYaw.setFromAxisAngle(UP, p.yaw * s);
    p.g.quaternion.copy(qYaw).multiply(qTilt);
    let low = Infinity;
    for (const v of p.samples) {
      const y = _v.copy(v).applyQuaternion(p.g.quaternion).y;
      if (y < low) low = y;
    }
    const rest = -H / 2 - low; // 皿の上（wholeYaw の中で y = -H/2）に接する高さ
    p.g.position.set(p.c0.x + p.away.x * p.sep * s, lerp(p.c0.y, rest, Math.min(1, Math.max(0, s))) + hop, p.c0.z + p.away.z * p.sep * s);
  };
  for (const p of pieces) pose(p, 0, 0);
  hitStop = quiet ? 0 : 0.06 + j.level * 0.015;
  tweens.add(0.62, (p) => {
    const s = ease.outBack(p, rough ? 1.2 : 2.2);
    const hop = Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.005;
    pieces.forEach((pc, i) => pose(pc, s, hop * (i ? 0.9 : 1)));
  });

  // かけら: 中心から外れるほど、曲がるほど、遅いほど多い
  const n = Math.round(12 + res.off * 70 + res.dev * 60 + (j.slow ? 14 : 0) + (rough ? 20 : 0));
  spawnCrumbs(Math.min(90, n), line, rough ? 1 : 0);
  guideFade && tweens.cancel(guideFade);
  const g0 = guideMat.opacity;
  tweens.add(0.18, (p) => (guideMat.opacity = g0 * (1 - p)), () => (guideG.visible = false));

  // 画面の効果
  const c = stage.toScreen(mover.getWorldPosition(_v).setY(TOP_Y));
  const rpx = screenRadius();
  const L = R * 3.2;
  _v.set(line.cu + Math.cos(alpha) * -L, TOP_Y, -(line.cv + Math.sin(alpha) * -L));
  const s1 = stage.toScreen(mover.localToWorld(_v));
  _v.set(line.cu + Math.cos(alpha) * L, TOP_Y, -(line.cv + Math.sin(alpha) * L));
  const s2 = stage.toScreen(mover.localToWorld(_v));
  Object.assign(slash, { on: true, t: clock, x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y, power: 0.6 + j.level * 0.25 });
  Object.assign(focus, { on: true, t: clock, x: c.x, y: c.y, r0: rpx * 1.25, dur: 0.5, n: 44 + j.level * 8, power: quiet ? 0.7 : 1 });
  fxDirty = true;
  if (!quiet) {
    flash(c.x, c.y, 0.5 + j.level * 0.15);
    sfx.crack();
    if (j.fast) sfx.whoosh(false);
    ui.shake(rough ? 12 : 5 + j.level * 1.5);
  }
  // カメラを少し寄せて戻す
  tweens.add(0.7, (p) => {
    camZoom = 1 - 0.06 * Math.sin(Math.min(1, p * 1.6) * Math.PI * 0.5) * (1 - ease.inOutCubic(Math.max(0, (p - 0.4) / 0.6)));
    placeCamera();
  });
}

/** 空振り: 金萬がぷるっと揺れるだけ */
function whiff() {
  guideFade && tweens.cancel(guideFade);
  tweens.add(0.5, (p) => {
    const s = Math.sin(p * Math.PI * 5) * (1 - p);
    whole.rotation.z = s * 0.12;
    whole.position.y = Math.abs(s) * 0.002;
  });
}

/** 皿の上を片付ける（半分や丸ごとが右へ飛んでいく） */
function clearTable(quiet = false) {
  if (!quiet) sfx.whoosh(true);
  crumbFade = 0.3;
  const obj = wholeYaw;
  const x0 = obj.position.x;
  const y0 = obj.position.y;
  const r0 = obj.rotation.y;
  // 画面右へ（mover の回転を打ち消して世界の +X へ）
  const dir = new THREE.Vector3(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -mover.rotation.y);
  return new Promise((res) =>
    tweens.add(0.34, (p) => {
      const e = ease.inExpo(p) * 0.9 + p * 0.1;
      obj.position.set(x0 + dir.x * 0.16 * e, y0 + Math.sin(p * Math.PI) * 0.012, dir.z * 0.16 * e);
      obj.rotation.y = r0 - e * 1.2;
    }, () => {
      obj.visible = false;
      obj.position.set(0, obj === wholeYaw ? CENTER_Y : 0, 0);
      obj.rotation.y = r0;
      aimG.visible = false;
      res();
    })
  );
}

function screenRadius() {
  const c = stage.toScreen(_v2.set(mover.position.x, TOP_Y, mover.position.z));
  const e = stage.toScreen(_v2.set(mover.position.x + R, TOP_Y, mover.position.z));
  return Math.hypot(e.x - c.x, e.y - c.y);
}

// ---------------------------------------------------------------- 判定
/**
 * res: { kind: "cut", line: {cu, cv, a}, off, dev, speed, key } か { kind: "miss" }
 * off / dev は金萬の半径に対する比、speed は「直径ぶんを1秒に何回」
 */
function judge(res) {
  if (res.kind === "miss") return { pts: 0, label: res.label ?? "空振り", kind: "bad", level: -1, tags: [] };
  const noGuide = cfg.guide === "none";
  let dAng = Math.abs((res.line.a - guideTheta) % Math.PI);
  if (dAng > Math.PI / 2) dAng = Math.PI - dAng;
  dAng /= DEG;
  // 角度 35・中心 40・まっすぐ 15・速さ 10。中心から外れると、ほかの点も目減りする（ボロッと割れる）
  const angPts = noGuide ? 35 : 35 * clamp01(1 - (dAng - 2) / 25);
  const cen = clamp01(1 - (res.off - 0.05) / (noGuide ? 0.38 : 0.45));
  let strPts = 15 * clamp01(1 - (res.dev - 0.04) / 0.26);
  let spdPts;
  const fast = !res.key && res.speed >= 5;
  const slow = !res.key && res.speed < 1.2;
  let cenPts = 40 * cen;
  if (res.key) {
    spdPts = 5;
    cenPts *= 0.8;
    strPts *= 0.8;
  } else if (fast) spdPts = 10;
  else if (slow) spdPts = 0;
  else spdPts = 3 + (6 * (res.speed - 1.2)) / 3.8;
  let pts = (angPts + strPts + spdPts) * (0.55 + 0.45 * cen) + cenPts;
  if (slow) pts = Math.min(pts * 0.8, 64); // ぐにゃっと割れたら、よくてまあまあ
  pts = Math.round(Math.min(100, pts));
  const tags = [];
  if (fast) tags.push(["スパッ！", "great"]);
  if (slow) tags.push(["ぐにゃ…", "bad"]);
  if (!res.key && res.off < 0.05) tags.push(["ど真ん中", "good"]);
  else if (!noGuide && dAng < 1.5) tags.push(["角度ぴったり", "good"]);
  let label, kind, level;
  if (pts >= 90) [label, kind, level] = ["完璧！", "great", 3];
  else if (pts >= 72) [label, kind, level] = ["きれい！", "good", 2];
  else if (pts >= 45) [label, kind, level] = ["まあまあ", "ok", 1];
  else [label, kind, level] = ["ボロッ…", "bad", 0];
  return { pts, label, kind, level, tags, fast, slow, dAng };
}

// ---------------------------------------------------------------- 入力（スワイプ）
const raycaster = new THREE.Raycaster();
const swipePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
/** 画面の点 → 金萬の局所座標 (u, v)。u は金萬の右、v は奥（上から見て反時計回りが正の角度） */
function toLocal(x, y, out) {
  _ndc.set((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  if (!raycaster.ray.intersectPlane(swipePlane, _hit)) return false;
  const dx = _hit.x - mover.position.x;
  const dz = _hit.z - mover.position.z;
  const r = mover.rotation.y;
  const lx = dx * Math.cos(r) - dz * Math.sin(r);
  const lz = dx * Math.sin(r) + dz * Math.cos(r);
  out.u = lx;
  out.v = -lz;
  return true;
}

const stroke = { on: false, id: -1, prev: null, entered: false, inside: [], len: 0, sx: 0, sy: 0, lx: 0, ly: 0 };
const HIT_R = R * 1.02;

/** 線分 q→p と金萬の円の交点のパラメータ（0..1）。なければ空 */
function circleHits(q, p) {
  const du = p.u - q.u;
  const dv = p.v - q.v;
  const A = du * du + dv * dv;
  if (A < 1e-12) return [];
  const B = 2 * (q.u * du + q.v * dv);
  const C = q.u * q.u + q.v * q.v - HIT_R * HIT_R;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((s) => s >= 0 && s <= 1);
}
const lerpPt = (q, p, s) => ({ u: lerp(q.u, p.u, s), v: lerp(q.v, p.v, s), t: lerp(q.t, p.t, s) });
const inCircle = (p) => p.u * p.u + p.v * p.v <= HIT_R * HIT_R;

function addPoint(x, y, t) {
  const p = { u: 0, v: 0, t };
  if (!toLocal(x, y, p)) return;
  trailPush(x, y, stroke.prev === null);
  stroke.len += Math.hypot(x - stroke.lx, y - stroke.ly);
  stroke.lx = x;
  stroke.ly = y;
  const q = stroke.prev;
  stroke.prev = p;
  if (!q) {
    if (inCircle(p)) {
      stroke.entered = true;
      stroke.inside.push(p);
    }
    return;
  }
  if (!stroke.entered) {
    const hs = circleHits(q, p);
    if (!hs.length) return;
    stroke.entered = true;
    stroke.inside.push(lerpPt(q, p, hs[0]));
    if (hs.length === 2) {
      stroke.inside.push(lerpPt(q, p, hs[1]));
      finishStroke(true);
    } else stroke.inside.push(p);
    return;
  }
  if (inCircle(p)) stroke.inside.push(p);
  else {
    const hs = circleHits(q, p);
    stroke.inside.push(hs.length ? lerpPt(q, p, hs[hs.length - 1]) : p);
    finishStroke(true);
  }
}

/** なぞった点列から、線・ずれ・まっすぐさ・速さを出す */
function analyze(pts) {
  let cu = 0;
  let cv = 0;
  for (const p of pts) {
    cu += p.u;
    cv += p.v;
  }
  cu /= pts.length;
  cv /= pts.length;
  let a;
  if (pts.length < 3) a = Math.atan2(pts[pts.length - 1].v - pts[0].v, pts[pts.length - 1].u - pts[0].u);
  else {
    // 主成分の向き
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const x = p.u - cu;
      const y = p.v - cv;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  }
  const du = Math.cos(a);
  const dv = Math.sin(a);
  const off = Math.abs(cu * dv - cv * du) / R;
  let dev = 0;
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    dev = Math.max(dev, Math.abs((pts[i].u - cu) * dv - (pts[i].v - cv) * du));
    if (i) len += Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v);
  }
  const dt = Math.max(0.008, pts[pts.length - 1].t - pts[0].t);
  // 線の向きは 0..π にそろえる
  a = ((a % Math.PI) + Math.PI) % Math.PI;
  return { line: { cu, cv, a }, off, dev: dev / R, len: len / R, speed: len / (2 * R) / dt };
}

function finishStroke(crossed) {
  if (!stroke.on) return;
  stroke.on = false;
  const pts = stroke.inside;
  if (!crossed && stroke.entered) {
    // 金萬の上で止めた: 半分以上なぞっていれば割れたことにする
    const r = analyze(pts);
    if (r.len < 1.3) {
      popAtKinman("最後までなぞって", "ok", -1.2);
      return;
    }
    return resolveCut({ kind: "cut", ...r });
  }
  if (!stroke.entered) {
    if (stroke.len > 40) resolveCut({ kind: "miss", label: "空振り" });
    return;
  }
  const r = analyze(pts);
  if (r.off > 0.8) return resolveCut({ kind: "miss", label: "かすった", graze: r });
  resolveCut({ kind: "cut", ...r });
}

function resolveCut(res) {
  if (state !== "aim" || !pendingCut) return;
  const f = pendingCut;
  pendingCut = null;
  state = "cut";
  f(res);
}

canvas.addEventListener("pointerdown", (e) => {
  if (state !== "aim" || stroke.on) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  // 指やマウスで割る人には、キーボードの狙いの線を出さない
  aimUsed = false;
  aimG.visible = false;
  Object.assign(stroke, { on: true, id: e.pointerId, prev: null, entered: false, inside: [], len: 0, lx: e.clientX, ly: e.clientY });
  addPoint(e.clientX, e.clientY, e.timeStamp / 1000);
});
canvas.addEventListener("pointermove", (e) => {
  if (!stroke.on || e.pointerId !== stroke.id) return;
  const list = e.getCoalescedEvents?.() ?? [];
  if (list.length) for (const c of list) {
    if (!stroke.on) break;
    addPoint(c.clientX, c.clientY, c.timeStamp / 1000);
  }
  else addPoint(e.clientX, e.clientY, e.timeStamp / 1000);
});
const endStroke = (e) => {
  if (!stroke.on || e.pointerId !== stroke.id) return;
  if (e.type === "pointerup") addPoint(e.clientX, e.clientY, e.timeStamp / 1000);
  if (stroke.on) finishStroke(false);
};
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", (e) => {
  if (e.pointerId === stroke.id) stroke.on = false;
});

// ---- キーボード: ← → で狙いを回し、Space で中心を通して割る
addEventListener("keydown", (e) => {
  if (state === "boot" || state === "idle" || state === "done") return;
  const k = e.key;
  if (k === "ArrowLeft" || k === "ArrowRight") {
    e.preventDefault();
    if (!aimUsed || !aimG.visible) {
      aimUsed = true;
      aimG.visible = state === "aim" || state === "intro";
    }
    if (!e.repeat) aimAngle += (k === "ArrowLeft" ? 1 : -1) * 1.5 * DEG;
    keys[k === "ArrowLeft" ? "left" : "right"] = true;
  } else if (k === " " || k === "Enter") {
    e.preventDefault();
    if (state !== "aim" || stroke.on) return;
    aimG.visible = true;
    // 狙いの向き（世界）を金萬の中の向きに直す
    let a = aimAngle - mover.rotation.y;
    a = ((a % Math.PI) + Math.PI) % Math.PI;
    resolveCut({ kind: "cut", key: true, line: { cu: 0, cv: 0, a }, off: 0, dev: 0, speed: 3 });
  }
});
addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft") keys.left = false;
  if (e.key === "ArrowRight") keys.right = false;
});
addEventListener("blur", () => (keys.left = keys.right = false));

// ---------------------------------------------------------------- 画面に文字を出す
function popAtKinman(text, kind, dy = 0, dx = 0) {
  const c = stage.toScreen(_v.set(mover.position.x, TOP_Y, mover.position.z));
  const r = screenRadius();
  ui.pop(text, c.x + dx * r, c.y + dy * r * 0.8, kind);
}

// ---------------------------------------------------------------- 毎フレーム
function frame(dt) {
  clock += dt;
  let gdt = dt;
  if (hitStop > 0) {
    hitStop -= dt;
    gdt = 0;
  }
  tweens.step(gdt);
  if (state === "aim" || state === "intro") {
    moveT += gdt;
    setMotion(moveT);
  }
  if (keys.left || keys.right) aimAngle += (keys.left ? 1 : -1) * 75 * DEG * dt;
  if (aimG.visible) {
    aimG.position.set(mover.position.x, TOP_Y + 0.0008, mover.position.z);
    aimG.rotation.y = aimAngle;
  }
  // 制限時間（割れる前だけ進む。なぞっている途中なら、なぞり終わるまで待つ）
  if (state === "aim" && cfg.time) {
    timeLeft = Math.max(0, timeLeft - dt);
    const p = timeLeft / cfg.time;
    timerEl.hidden = false;
    timerEl.style.setProperty("--p", p.toFixed(3));
    timerEl.classList.toggle("low", timeLeft < 1);
    const tick = Math.ceil(timeLeft * 4);
    if (timeLeft < 1 && tick !== lastTick && timeLeft > 0) sfx.tick();
    lastTick = tick;
    if (timeLeft <= 0 && !stroke.on) resolveCut({ kind: "miss", label: "時間切れ" });
  } else timerEl.hidden = true;
  // 出たままの点線は、ゆっくり明滅させる
  if (state === "aim" && cfg.guide === "show" && guideG.visible) guideMat.opacity = 0.8 + 0.2 * Math.sin(clock * 5);
  stepCrumbs(gdt);
  drawFx();
}

// ---------------------------------------------------------------- 待機中のデモ（一覧のサムネイルにもなる）
async function attract(token) {
  const alive = () => token === runToken;
  while (alive()) {
    await present(ROUNDS[0], true);
    if (!alive()) return;
    await delay(0.9);
    if (!alive()) return;
    // 見えない指が、点線から少しだけずれてスッとなぞる
    const a = guideTheta + (Math.random() - 0.5) * 4 * DEG;
    const off = (Math.random() - 0.5) * 0.08 * R;
    const cu = -Math.sin(a) * off;
    const cv = Math.cos(a) * off;
    const L = R * 1.6;
    await new Promise((res) =>
      tweens.add(0.16, (p) => {
        const s = lerp(-L, L, p);
        _v.set(cu + Math.cos(a) * s, TOP_Y, -(cv + Math.sin(a) * s));
        const sc = stage.toScreen(mover.localToWorld(_v));
        trailPush(sc.x, sc.y, p === 0);
        fxDirty = true;
      }, res)
    );
    if (!alive()) return;
    const res = { kind: "cut", line: { cu, cv, a: ((a % Math.PI) + Math.PI) % Math.PI }, off: Math.abs(off) / R, dev: 0.02, speed: 6 };
    breakOpen(res, judge(res), true);
    await delay(3.2);
    if (!alive()) return;
    await clearTable(true);
  }
}

// ---------------------------------------------------------------- ゲームの流れ
async function playRound(i, log) {
  const round = ROUNDS[i];
  ui.set("round", `${i + 1}/${ROUNDS.length}`);
  showBanner(i, round.note);
  hintMain.textContent = round.hint;
  state = "intro";
  aimG.visible = aimUsed;
  const cutP = new Promise((res) => (pendingCut = res));
  await present(round);
  timeLeft = round.time ?? 0;
  lastTick = -1;
  state = "aim";
  const res = await cutP;
  const j = judge(res);
  log.push(j);
  if (res.kind === "miss") {
    whiff();
    if (res.graze) spawnCrumbs(8, res.graze.line);
    sfx.bad();
    ui.shake(4);
    popAtKinman(j.label, "bad", -1.35);
    await delay(1.0);
  } else {
    breakOpen(res, j);
    await delay(0.12);
    popAtKinman(j.label, j.kind, -1.35);
    if (j.level >= 1) sfx.good(j.level);
    else sfx.bad();
    await delay(0.22);
    popAtKinman(`+${j.pts}`, j.level >= 2 ? "good" : "ok", 1.45);
    if (j.ratio) {
      await delay(0.16);
      const even = j.ratio[1] >= 46;
      popAtKinman(`${j.ratio[0]} : ${j.ratio[1]}`, even ? "good" : j.ratio[1] >= 30 ? "ok" : "bad", -0.35, innerWidth < innerHeight ? 0 : -1.9);
    }
    ui.set("score", String(log.reduce((s, x) => s + x.pts, 0)));
    if (j.tags[0]) {
      await delay(0.18);
      const tall = innerWidth < innerHeight;
      popAtKinman(j.tags[0][0], j.tags[0][1], tall ? 2.3 : 0.1, tall ? 0 : 1.9);
    }
    await delay(1.25);
  }
  const total = log.reduce((s, x) => s + x.pts, 0);
  ui.set("score", String(total));
  ui.announce(`ラウンド${i + 1} ${j.label} ${j.pts}点`);
  if (i < ROUNDS.length - 1) await clearTable();
}

const RANKS = [
  [740, "一刀両断", "線も真ん中もぴたり。まな板の上の達人です。"],
  [620, "パカッと名人", "ほとんど狂いなし。断面がどれもきれいでした。"],
  [460, "割り上手", "おやつの取り分けを任せられる腕前です。"],
  [280, "割り見習い", "まずは中心を通すことから。速く、まっすぐがコツ。"],
  [0, "ボロボロさん", "かけらもまたおいしい、ということで。"],
];

async function startGame() {
  runToken++;
  resetTable();
  hint.hidden = true;
  ui.set("round", `-/${ROUNDS.length}`);
  ui.set("score", "0");
  state = "idle";
  attract(runToken);
  await ui.start({
    lead: "小皿の上の金萬を、点線にそって指でスッとなぞって、真っ二つに割ろう。",
    rules: [
      "点線の向きに、金萬の上をひと息になぞる",
      "角度・中心・まっすぐ・速さで1回100点",
      "速いと「スパッ」、遅いと「ぐにゃ」",
      "金萬の上を通らないと空振り",
      "金萬はずっと動いている。時間内に割ろう",
      "全8回。後半ほど速く、点線も消える",
      "キーボードは ← → で向き、Space で割る",
    ],
  });
  runToken++;
  resetTable();
  state = "intro";
  aimUsed = false;
  await ui.countdown();
  hint.hidden = false;
  const log = [];
  for (let i = 0; i < ROUNDS.length; i++) await playRound(i, log);
  state = "done";
  hint.hidden = true;
  aimG.visible = false;
  ui.music.stop(0.8);
  ui.big("おしまい！", "end");
  sfx.whistle();
  await wait(1300);

  const total = log.reduce((s, x) => s + x.pts, 0);
  const [, rank, comment] = RANKS.find(([min]) => total >= min);
  const count = (lv) => log.filter((x) => x.level === lv).length;
  const detail = `<div class="pk-log">${log
    .map((x, i) => `<div class="pk-log-row"><span class="pk-log-n">${i + 1}</span><span class="pk-log-j ${x.kind}">${x.label.replace(/[！…]/g, "")}</span><span class="pk-log-p">${x.pts}</span></div>`)
    .join("")}</div><p class="pk-sum">${[
    [3, "完璧"],
    [2, "きれい"],
    [1, "まあまあ"],
    [0, "ボロッ"],
    [-1, "空振り"],
  ]
    .filter(([lv]) => count(lv))
    .map(([lv, name]) => `${name} ${count(lv)}`)
    .join("・")}</p>`;
  const next = await ui.result({
    score: total,
    unit: "点",
    label: `${ROUNDS.length * 100}点満点中`,
    rank,
    comment,
    detail,
    share: `金萬ミニゲーム「パカッと割り」で ${total}点（${ROUNDS.length * 100}点満点）、称号は「${rank}」。完璧に割れたのは${count(3)}回。`,
  });
  if (next === "retry") startGame();
}

// ---------------------------------------------------------------- 動作確認用（?debug のときだけ）
if (new URLSearchParams(location.search).has("debug")) {
  window.__paka = {
    get state() {
      return state;
    },
    /** 点線（ガイド）上の2点を画面座標で。ext は半径の何倍まで伸ばすか、off は中心からのずらし（半径比） */
    guideScreen(ext = 1.6, off = 0, dAng = 0) {
      const a = guideTheta + dAng * DEG;
      const n = [-Math.sin(a) * off * R, Math.cos(a) * off * R];
      return [-ext, ext].map((s) => {
        const w = mover.localToWorld(new THREE.Vector3(n[0] + Math.cos(a) * s * R, TOP_Y, -(n[1] + Math.sin(a) * s * R)));
        return stage.toScreen(w);
      });
    },
  };
}

// ---------------------------------------------------------------- 起動
try {
  kit = await loadKinman(renderer);
  whole = kit.make({ origin: "center" });
  wholeYaw.add(whole);
  cutMat = cutMaterial();
  resetTable();
  stage.start(frame);
  load.done();
  startGame();
} catch (err) {
  console.error(err);
  load.fail();
}
