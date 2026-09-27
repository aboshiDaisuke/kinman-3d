import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// 金萬の15秒紹介ムービー。update(t) で t 秒目の1コマが決まる（書き出しは render.mjs）。
// 120BPM（1拍 0.5 秒）の拍に合わせてカット・衝撃を置いている。

const W = 1920;
const H = 1080;
const DURATION = 15;
const CAPTURE = new URLSearchParams(location.search).has("capture");

const INK = "#2b1d14";
const BURNT = "#8a3b17";
const GOLD = "#e3ac5c";
const PAPER = "#f4ede2";
const CREAM = "#fbf4e6";
const HONEY_BG = "#f5e3bf";
const STAMP_BG = "#6a2a10";
const SPLIT_BG = "#e8a53a";
const END_BG = "#1c110a";
const NIGHT = "#170e08";

// ---------------------------------------------------------------- math
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const expoOut = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const expoIn = (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10));
const expoInOut = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2;
const cubicInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const backOut = (p, s = 1.70158) => (p <= 0 ? 0 : 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2));
const elasticOut = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// t0 以降に指数で減衰するインパルス
const decay = (t, t0, k) => (t < t0 ? 0 : Math.exp(-(t - t0) * k));
const BEATS_S2 = [2.0, 2.5, 3.0, 3.5, 4.0];

// ---------------------------------------------------------------- stage
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const camEl = $("cam");
function fitStage() {
  const s = CAPTURE ? 1 : Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `scale(${s})`;
}
addEventListener("resize", fitStage);
fitStage();

// ---------------------------------------------------------------- three
const RADIUS = 0.023;
const HEIGHT = 0.0165;
const HALF_CENTROID = (4 * RADIUS) / (3 * Math.PI);

const renderer = new THREE.WebGLRenderer({
  canvas: $("gl"),
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: CAPTURE,
});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(30, W / H, 0.002, 10);

const key = new THREE.DirectionalLight(0xfff1e0, 2.6);
key.position.set(-0.12, 0.24, 0.16);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffd2a0, 1.0);
rim.position.set(0.16, 0.12, -0.16);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xfff4e8, 0.4);
fill.position.set(0.05, -0.15, 0.2);
scene.add(fill);
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x7a5a42, 0.35));

// root: お菓子の中心。body: 底面原点のモデルを中心へずらす
const root = new THREE.Group();
scene.add(root);
const body = new THREE.Group();
body.position.y = -HEIGHT / 2;
root.add(body);
const pivotA = new THREE.Group();
const pivotB = new THREE.Group();
body.add(pivotA, pivotB);
let whole = null;

const clones = [];
const clonesGroup = new THREE.Group();
scene.add(clonesGroup);
const GRID = { cols: 5, rows: 3, sx: 0.062, sy: 0.054 };

// 割ったときに飛ぶかけら（カステラ生地・焼き目・白あん）
const CRUMBS = 90;
const crumbs = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(1, 0),
  new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }),
  CRUMBS
);
{
  const cols = [0xf2c25a, 0xf6d98a, 0x9a5a25, 0xf3e6c4];
  const c = new THREE.Color();
  for (let i = 0; i < CRUMBS; i++) crumbs.setColorAt(i, c.set(cols[Math.floor(hash(i * 3.1) * cols.length)]));
}
crumbs.frustumCulled = false;
scene.add(crumbs);

const SPLIT = { a: { x: -0.027, z: -0.012, ry: 0.3 }, b: { x: 0.027, z: 0.004, ry: Math.PI - 0.3 }, lift: 0.01 };
function setSplit(s) {
  const on = s > 0.0001;
  if (whole) whole.visible = !on;
  pivotA.visible = pivotB.visible = on;
  const lift = SPLIT.lift * Math.sin(Math.PI * Math.min(1, s));
  const tilt = 0.25 * Math.sin(Math.PI * Math.min(1, s));
  pivotA.position.set(SPLIT.a.x * s, lift, -HALF_CENTROID + SPLIT.a.z * s);
  pivotA.rotation.set(0, SPLIT.a.ry * Math.min(1, s), -tilt);
  pivotB.position.set(SPLIT.b.x * s, lift * 1.2, HALF_CENTROID + SPLIT.b.z * s);
  pivotB.rotation.set(0, SPLIT.b.ry * Math.min(1, s), tilt);
}

const loaded = new Promise((resolve, reject) => {
  new RGBELoader().load("../site/env/studio.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentRotation.set(0, -0.6, 0);
    scene.environmentIntensity = 0.8;
    hdr.dispose();
    new GLTFLoader().load(
      "../site/models/kinman.glb",
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          for (const k of ["map", "normalMap", "roughnessMap"]) if (m[k]) m[k].anisotropy = 8;
          if (m.isMeshPhysicalMaterial) {
            m.sheen = 0.06;
            m.sheenRoughness = 0.4;
            m.sheenColor = new THREE.Color(0xffc080);
            m.specularIntensity = 0.3;
          }
        });
        whole = gltf.scene.getObjectByName("KM_Whole");
        const halfA = gltf.scene.getObjectByName("KM_HalfA");
        const halfB = gltf.scene.getObjectByName("KM_HalfB");
        body.add(whole);
        pivotA.add(halfA);
        pivotB.add(halfB);
        halfA.position.set(0, 0, HALF_CENTROID);
        halfB.position.set(0, 0, -HALF_CENTROID);
        for (let i = 0; i < GRID.cols * GRID.rows; i++) {
          const g = new THREE.Group();
          const w = whole.clone();
          w.position.y = -HEIGHT / 2;
          g.add(w);
          clonesGroup.add(g);
          clones.push(g);
        }
        resolve();
      },
      undefined,
      reject
    );
  });
});

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const qa = (axis, ang) => new THREE.Quaternion().setFromAxisAngle(axis, ang);
// 左から順に掛ける（最後の引数がいちばん内側＝お菓子自身の回転）
const qmul = (...qs) => qs.reduce((acc, q) => acc.multiply(q), new THREE.Quaternion());

function placeCamera({ dist, az = 0, el = 0, tx = 0, ty = 0, tz = 0, roll = 0 }) {
  const target = new THREE.Vector3(tx, ty, tz);
  camera.position.set(
    tx + dist * Math.sin(az) * Math.cos(el),
    ty + dist * Math.sin(el),
    tz + dist * Math.cos(az) * Math.cos(el)
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.rotateZ(roll);
  camera.updateMatrixWorld();
}
const mixCam = (a, b, p) => {
  const o = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = lerp(a[k] ?? 0, b[k] ?? 0, p);
  return o;
};

function project(v) {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
}
// お菓子の中心と画面上の半径
function kinmanOnScreen() {
  const c = root.getWorldPosition(new THREE.Vector3());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(RADIUS * root.scale.x);
  const a = project(c);
  const b = project(c.clone().add(right));
  return { x: a.x, y: a.y, r: Math.hypot(b.x - a.x, b.y - a.y) };
}

// ---------------------------------------------------------------- 3D timeline
const S2_CAM = (t) => ({ dist: lerp(0.172, 0.152, seg(t, 2, 4.5)), el: 0.32, az: 0.12 * Math.sin(t * 0.9), tx: 0.025, ty: -0.001 });

function update3D(t) {
  root.visible = true;
  clonesGroup.visible = false;
  crumbs.visible = false;
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  setSplit(0);
  rim.intensity = 1.0;
  key.intensity = 2.6;
  let cam;

  if (t < 2.0) {
    // 奥から回転しながら飛び込んでくる
    if (t < 0.98) root.visible = false;
    const e = expoOut(seg(t, 1.0, 1.55));
    root.position.set(lerp(-0.05, 0, e), lerp(0.04, 0, e) + 0.0012 * Math.sin(t * 3) * e, lerp(-1.6, 0, e));
    const tumble = qa(new THREE.Vector3(1, 0.4, 0.8).normalize(), (1 - e) * 9);
    root.quaternion.copy(qmul(tumble, qa(X, 0.5), qa(Y, 1.2 * t)));
    const c1 = { dist: 0.15, el: 0.3, tx: 0, ty: 0 };
    cam = mixCam(c1, S2_CAM(t), expoInOut(seg(t, 1.8, 2.25)));
  } else if (t < 4.5) {
    // 拍ごとに 120° ずつ回し込む
    let spin = 1.2 * t;
    let tiltKick = 0;
    let pulse = 0;
    for (const b of BEATS_S2) {
      spin += ((Math.PI * 2) / 3) * expoOut(seg(t, b, b + 0.34));
      tiltKick += 0.2 * decay(t, b, 7) * Math.sin((t - b) * 22);
      pulse += 0.045 * decay(t, b, 11);
    }
    root.quaternion.copy(qmul(qa(X, 0.5 + tiltKick), qa(Y, spin)));
    root.scale.setScalar(1 + pulse);
    root.position.x = expoIn(seg(t, 4.22, 4.5)) * 0.13;
    root.position.y = 0.0012 * Math.sin(t * 3);
    cam = S2_CAM(t);
  } else if (t < 7.0) {
    // 焼き印を正面から。画面内で回りながら寄る
    const e = expoOut(seg(t, 4.5, 5.35));
    const a = -Math.PI * 1.3 * (1 - e) + 0.05 * (t - 5.35) * e;
    const flip = expoIn(seg(t, 6.45, 6.95));
    root.quaternion.copy(qmul(qa(Z, a), qa(Y, flip * Math.PI * 1.5), qa(X, Math.PI / 2 - 0.1 + 0.06 * Math.sin(t * 1.3))));
    cam = {
      dist: lerp(0.42, 0.108, e) - 0.012 * cubicInOut(seg(t, 5.35, 6.45)) + 0.25 * flip,
      tx: 0.0145,
      ty: 0.0005,
    };
  } else if (t < 10.0) {
    // 震えてから、ぱかっと割れる
    const pre = seg(t, 7.0, 7.5);
    const shake = t < 7.5 ? Math.sin(t * 75) * 0.06 * pre * pre : 0;
    const s = t < 7.5 ? 0 : backOut(seg(t, 7.5, 7.88), 1.3) + 0.18 * cubicInOut(seg(t, 7.9, 9.9));
    setSplit(s);
    const drop = expoOut(seg(t, 7.0, 7.3));
    root.position.y = lerp(0.03, 0, drop) + 0.007 * Math.sin(Math.PI * seg(t, 7.5, 7.95));
    root.quaternion.copy(qmul(qa(Y, 0.08 * Math.sin(t * 1.4)), qa(Z, shake), qa(X, 0.22)));
    root.scale.set(1 + 0.05 * pre * pre, 1 - 0.07 * pre * pre, 1 + 0.05 * pre * pre);
    if (t >= 7.5) root.scale.setScalar(1 + 0.06 * decay(t, 7.5, 9));
    const punch = expoOut(seg(t, 7.5, 7.95));
    cam = {
      dist: lerp(0.215, 0.158, punch) - 0.02 * cubicInOut(seg(t, 7.95, 9.9)),
      el: 0.35,
      az: lerp(0, 0.2, cubicInOut(seg(t, 7.5, 9.9))),
      ty: lerp(-0.004, -0.009, punch),
      roll: 0.03 * decay(t, 7.5, 5) * Math.sin((t - 7.5) * 30),
    };
    // かけら
    if (t >= 7.5 && t < 9.4) {
      crumbs.visible = true;
      const dt = t - 7.5;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e3 = new THREE.Euler();
      for (let i = 0; i < CRUMBS; i++) {
        const th = hash(i + 1.3) * Math.PI * 2;
        const sp = 0.05 + hash(i + 7.7) * 0.2;
        const vy = 0.06 + hash(i + 2.9) * 0.22;
        const travel = (1 - Math.exp(-dt * 3.2)) / 3.2;
        const pos = new THREE.Vector3(
          Math.cos(th) * sp * travel * 1.4,
          vy * travel - 0.09 * dt * dt,
          Math.sin(th) * sp * travel + 0.01
        );
        const size = (0.0006 + hash(i + 5.1) * 0.0011) * (1 - seg(dt, 0.9, 1.9)) * seg(dt, 0, 0.04);
        e3.set(dt * (4 + hash(i) * 8), dt * 6 * hash(i + 3), 0);
        q.setFromEuler(e3);
        m.compose(pos, q, new THREE.Vector3(size, size * 0.8, size));
        crumbs.setMatrixAt(i, m);
      }
      crumbs.instanceMatrix.needsUpdate = true;
    }
  } else if (t < 12.8) {
    // 15個並べてウェーブ
    root.visible = false;
    clonesGroup.visible = true;
    const fly = expoIn(seg(t, 12.35, 12.8));
    clones.forEach((g, i) => {
      const c = i % GRID.cols;
      const r = Math.floor(i / GRID.cols);
      const x0 = (c - (GRID.cols - 1) / 2) * GRID.sx;
      const y0 = ((GRID.rows - 1) / 2 - r) * GRID.sy;
      const d = (c + r) * 0.045;
      const pop = backOut(seg(t, 10.02 + d, 10.34 + d), 2.2);
      const wave = expoInOut(seg(t, 11.05 + c * 0.075 + r * 0.03, 11.6 + c * 0.075 + r * 0.03));
      const wave2 = expoInOut(seg(t, 11.9 + (4 - c) * 0.05, 12.35 + (4 - c) * 0.05));
      g.position.set(x0 * (1 + fly * 3), y0 * (1 + fly * 3), fly * (0.34 + hash(i) * 0.1));
      g.scale.setScalar(Math.max(0.0001, pop));
      g.quaternion.copy(
        qmul(
          qa(new THREE.Vector3(hash(i + 4) - 0.5, hash(i + 8) - 0.5, 0.3).normalize(), fly * 5),
          qa(X, wave * Math.PI * 2),
          qa(Z, wave2 * Math.PI * 2 * (c % 2 ? 1 : -1)),
          qa(X, Math.PI / 2 - 0.42),
          qa(Y, t * 0.8 + i)
        )
      );
    });
    cam = {
      dist: lerp(0.41, 0.35, cubicInOut(seg(t, 10.0, 12.4))),
      el: 0.06,
      roll: lerp(-0.1, 0.05, cubicInOut(seg(t, 10.0, 12.4))),
      ty: 0.002,
    };
  } else {
    // エンドカード。上から落ちてきて着地
    const p = seg(t, 12.8, 13.3);
    const bounce = 0.006 * Math.abs(Math.sin((t - 13.3) * 11)) * decay(t, 13.3, 6);
    root.position.y = 0.072 * (1 - p) * (1 - p) + (t > 13.3 ? bounce : 0);
    const spin = 0.55 * t + 7 * (1 - expoOut(seg(t, 12.8, 13.6)));
    root.quaternion.copy(qmul(qa(X, 0.5 + 0.25 * (1 - p)), qa(Y, spin)));
    root.scale.set(1 + 0.08 * decay(t, 13.3, 12), 1 - 0.1 * decay(t, 13.3, 12), 1 + 0.08 * decay(t, 13.3, 12));
    rim.intensity = 2.4;
    key.intensity = 2.8;
    cam = { dist: lerp(0.172, 0.152, cubicInOut(seg(t, 13.3, 15))), el: 0.3, tx: 0.029, ty: 0.001 };
  }
  placeCamera(cam);
}

// ---------------------------------------------------------------- DOM helpers
const fg = $("fg");
const FONT = {
  mincho: '"Shippori Mincho B1", "Hiragino Mincho ProN", serif',
  gothic: '"Zen Kaku Gothic New", "Hiragino Sans", sans-serif',
  anton: '"Anton", "Impact", sans-serif',
};
const ALL_TEXT = [];
function txt(text, o) {
  const el = document.createElement("div");
  el.className = "t" + (o.cls ? " " + o.cls : "");
  Object.assign(el.style, {
    left: o.x + "px",
    top: o.y + "px",
    fontSize: o.size + "px",
    fontFamily: FONT[o.font || "mincho"],
    fontWeight: o.weight || 800,
    color: o.color || "#fff",
    letterSpacing: o.ls || "0",
  });
  const chars = [];
  for (const ch of text) {
    const s = document.createElement("span");
    s.textContent = ch === " " ? " " : ch;
    el.append(s);
    chars.push(s);
  }
  (o.parent || fg).append(el);
  ALL_TEXT.push(text);
  return { el, chars };
}
function box(o) {
  const el = document.createElement("div");
  el.className = "box";
  Object.assign(el.style, {
    left: o.x - o.w / 2 + "px",
    top: o.y - o.h / 2 + "px",
    width: o.w + "px",
    height: o.h + "px",
    background: o.color,
  });
  (o.parent || fg).append(el);
  return el;
}
function put(el, o = {}, center = true) {
  const op = o.o ?? 1;
  if (op <= 0.002) {
    el.style.visibility = "hidden";
    return;
  }
  el.style.visibility = "";
  el.style.opacity = op;
  const sx = o.sx ?? o.s ?? 1;
  const sy = o.sy ?? o.s ?? 1;
  el.style.transform =
    (center ? "translate(-50%,-50%) " : "") +
    `translate(${(o.x || 0).toFixed(2)}px,${(o.y || 0).toFixed(2)}px) rotate(${(o.r || 0).toFixed(3)}deg) skewX(${(o.skew || 0).toFixed(2)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
  const f = [];
  if (o.blur > 0.05) f.push(`blur(${o.blur.toFixed(2)}px)`);
  if (o.filter) f.push(o.filter);
  el.style.filter = f.length ? f.join(" ") : "none";
  const sh = [];
  if (o.rgb > 0.3) sh.push(`${(-o.rgb).toFixed(1)}px 0 rgba(255,30,90,.7)`, `${o.rgb.toFixed(1)}px 0 rgba(0,200,255,.7)`);
  if (o.shadow) sh.push(o.shadow);
  el.style.textShadow = sh.join(",");
  el.style.clipPath = o.clip || "none";
}
const off = (T) => put(T.el ?? T, { o: 0 });

// 大きく叩きつける登場
function slam(t, t0, { dur = 0.42, from = 3.2, blur = 26, rgb = 22 } = {}) {
  const p = seg(t, t0, t0 + dur);
  const e = expoOut(p);
  return { s: lerp(from, 1, e), o: t < t0 ? 0 : Math.min(1, p * 7), blur: blur * (1 - e) ** 2, rgb: rgb * (1 - e) };
}
// 数フレームだけ横にずれて帯状に欠けるグリッチ
function glitch(t, t0, dur, seed, amp = 40) {
  if (t < t0 || t > t0 + dur) return { x: 0, clip: null, on: false };
  const k = Math.floor(t * 30);
  const top = hash(k + seed) * 60;
  const h = 18 + hash(k * 1.7 + seed + 9) * 40;
  const cut = hash(k + seed + 5) > 0.4;
  return {
    x: (hash(k + seed + 3) - 0.5) * 2 * amp,
    clip: cut ? `inset(${top.toFixed(1)}% -20% ${Math.max(0, 100 - top - h).toFixed(1)}% -20%)` : null,
    on: true,
  };
}

const items = [];
const item = (f) => items.push(f);

// ---------------------------------------------------------------- S1 秋田 / 銘菓
const t1a = txt("秋田", { x: 650, y: 500, size: 320, color: GOLD });
const t1b = txt("銘菓", { x: 1270, y: 500, size: 320, color: GOLD });
const t1c = txt("AKITA  MEIKA", { x: 960, y: 790, size: 46, font: "anton", weight: 400, color: "#b98a52" });
const t1line = box({ x: 960, y: 715, w: 980, h: 3, color: "#b98a52" });
item((t) => {
  const out = expoIn(seg(t, 0.9, 1.16));
  for (const [T, t0, dir] of [
    [t1a, 0.04, -1],
    [t1b, 0.52, 1],
  ]) {
    if (t < t0 || t > 1.18) {
      off(T);
      continue;
    }
    const S = slam(t, t0, { from: 3.6 });
    const g = glitch(t, t0 + 0.03, 0.14, t0 * 100, 55);
    put(T.el, {
      ...S,
      s: S.s * (1 + out * 2.5),
      x: g.x + dir * out * 380,
      o: S.o * (1 - out),
      blur: S.blur + out * 30,
      clip: g.clip,
      rgb: S.rgb + (g.on ? 16 : 0),
    });
  }
  if (t < 0.28 || t > 1.18) {
    off(t1c);
    off(t1line);
  } else {
    const p = expoOut(seg(t, 0.28, 0.95));
    t1c.el.style.letterSpacing = lerp(1.4, 0.5, p) + "em";
    put(t1c.el, { o: seg(t, 0.28, 0.45) * (1 - out), blur: (1 - p) * 8 });
    t1line.style.transformOrigin = "50% 50%";
    put(t1line, { sx: expoOut(seg(t, 0.3, 0.8)), o: 1 - out }, false);
  }
});

// ---------------------------------------------------------------- S2 蜂蜜 × 卵 カステラ生地
const t2a = txt("蜂蜜", { x: 1185, y: 385, size: 225, color: BURNT });
const t2x = txt("×", { x: 1468, y: 395, size: 120, font: "gothic", weight: 900, color: GOLD });
const t2b = txt("卵", { x: 1648, y: 385, size: 225, color: BURNT });
const t2bar = box({ x: 1415, y: 632, w: 820, h: 160, color: INK });
const t2c = txt("カステラ生地", { x: 1415, y: 632, size: 108, font: "gothic", weight: 900, color: PAPER });
t2c.el.style.overflow = "hidden";
t2c.el.style.padding = "0.08em 0";
const t2d = txt("HONEY & EGG CASTELLA", { x: 1415, y: 790, size: 46, font: "anton", weight: 400, color: BURNT });
item((t) => {
  if (t < 1.99 || t > 4.6) {
    [t2a, t2x, t2b, t2c, t2d, t2bar].forEach(off);
    return;
  }
  const ex = expoIn(seg(t, 4.18, 4.45));
  const exit = { x: -ex * 520, blur: ex * 24, skew: ex * 20 };
  const bump = (t0) => 1 + 0.06 * BEATS_S2.filter((b) => b > t0 + 0.2).reduce((a, b) => a + decay(t, b, 12), 0);

  const A = slam(t, 2.0, { from: 3.4 });
  const gA = glitch(t, 2.02, 0.12, 21, 45);
  put(t2a.el, { ...A, s: A.s * bump(2.0), x: gA.x + exit.x, clip: gA.clip, blur: A.blur + exit.blur, skew: exit.skew, rgb: A.rgb + (gA.on ? 14 : 0) });

  const px = seg(t, 2.5, 2.85);
  put(t2x.el, { s: backOut(px, 2.5) * bump(2.5), r: lerp(-220, 0, expoOut(px)), o: t < 2.5 ? 0 : 1, x: exit.x, blur: exit.blur, skew: exit.skew });

  const B = slam(t, 3.0, { from: 3.4 });
  const gB = glitch(t, 3.02, 0.12, 37, 45);
  put(t2b.el, { ...B, s: B.s * bump(3.0), x: gB.x + exit.x, clip: gB.clip, blur: B.blur + exit.blur, skew: exit.skew, rgb: B.rgb + (gB.on ? 14 : 0) });

  t2bar.style.transformOrigin = "0% 50%";
  put(t2bar, { sx: expoOut(seg(t, 3.38, 3.62)), o: t < 3.38 ? 0 : 1, x: exit.x, skew: -12 + exit.skew }, false);
  put(t2c.el, { o: t < 3.45 ? 0 : 1, x: exit.x, blur: exit.blur, skew: exit.skew });
  t2c.chars.forEach((c, i) => {
    const p = expoOut(seg(t, 3.45 + i * 0.035, 3.8 + i * 0.035));
    put(c, { y: (1 - p) * 140, r: (1 - p) * 20 }, false);
  });
  const pd = expoOut(seg(t, 3.72, 4.25));
  t2d.el.style.letterSpacing = lerp(0.9, 0.22, pd) + "em";
  put(t2d.el, { o: seg(t, 3.72, 3.85), blur: (1 - pd) * 10 + exit.blur, x: exit.x });
});

// ---------------------------------------------------------------- S3 焼き印
const t3a = txt("焼き印", { x: 1480, y: 540, size: 230, color: PAPER, cls: "v", ls: "0.04em" });
const t3b = txt("香ばしい焼き色", { x: 1700, y: 560, size: 60, font: "gothic", weight: 700, color: GOLD, cls: "v", ls: "0.12em" });
const t3line = box({ x: 1330, y: 540, w: 3, h: 760, color: "rgba(244,237,226,.55)" });
const t3en = txt("YAKI-IN", { x: 250, y: 150, size: 64, font: "anton", weight: 400, color: "rgba(244,237,226,.85)", ls: "0.3em" });
item((t) => {
  if (t < 4.5 || t > 7.0) {
    [t3a, t3b, t3line, t3en].forEach(off);
    return;
  }
  const ex = seg(t, 6.35, 6.75);
  put(t3a.el, {});
  t3a.chars.forEach((c, i) => {
    const t0 = 4.72 + i * 0.13;
    const p = seg(t, t0, t0 + 0.5);
    const g = glitch(t, t0 + 0.05, 0.12, 50 + i * 7, 30);
    const e = expoIn(seg(ex, i * 0.12, i * 0.12 + 0.6));
    put(
      c,
      {
        y: lerp(-520, 0, backOut(p, 1.4)) - e * 900,
        x: g.x,
        r: (1 - expoOut(p)) * (i % 2 ? 30 : -30) + e * (i % 2 ? 25 : -25),
        o: t < t0 ? 0 : 1,
        blur: 18 * (1 - expoOut(p)) ** 2 + e * 30,
        clip: g.clip,
        rgb: g.on ? 12 : 0,
      },
      false
    );
  });
  put(t3b.el, { o: 1 - ex, y: -ex * 120, blur: ex * 20 });
  t3b.chars.forEach((c, i) => {
    const t0 = 5.35 + i * 0.075;
    const p = seg(t, t0, t0 + 0.2);
    put(c, { s: backOut(p, 3), o: t < t0 ? 0 : 1 }, false);
  });
  t3line.style.transformOrigin = "50% 0%";
  put(t3line, { sy: expoOut(seg(t, 4.65, 5.3)) * (1 - expoIn(ex)), o: t < 4.65 ? 0 : 1 }, false);
  const pe = expoOut(seg(t, 5.0, 5.8));
  t3en.el.style.letterSpacing = lerp(0.9, 0.3, pe) + "em";
  put(t3en.el, { o: seg(t, 5.0, 5.2) * (1 - ex), blur: (1 - pe) * 8 });
});

// ---------------------------------------------------------------- S4 割ると、玉子入り白あん
const t4a = txt("割ると、", { x: 960, y: 175, size: 132, font: "gothic", weight: 900, color: INK });
const t4b = txt("玉子入り", { x: 560, y: 860, size: 100, font: "gothic", weight: 900, color: BURNT });
const t4c = txt("白あん", { x: 1110, y: 850, size: 260, color: "#fffaf0", cls: "stroke" });
const t4d = txt("しっとり", { x: 1560, y: 220, size: 118, color: BURNT });
item((t) => {
  if (t < 7.0 || t > 10.05) {
    [t4a, t4b, t4c, t4d].forEach(off);
    return;
  }
  const ex = expoIn(seg(t, 9.7, 9.98));
  // 割ると、：落ちてきて震え、割れた瞬間に弾け飛ぶ
  if (t < 7.85) {
    put(t4a.el, {});
    const pre = seg(t, 7.15, 7.5);
    const burst = seg(t, 7.5, 7.82);
    t4a.chars.forEach((c, i) => {
      const t0 = 7.0 + i * 0.05;
      const p = seg(t, t0, t0 + 0.3);
      const k = Math.floor(t * 40);
      const jit = pre * pre * 10;
      const dir = i - 1.5;
      put(
        c,
        {
          y: lerp(-220, 0, backOut(p, 2)) + (hash(k + i) - 0.5) * jit - expoOut(burst) * (200 + hash(i) * 200),
          x: (hash(k + i + 9) - 0.5) * jit + expoOut(burst) * dir * 330,
          r: expoOut(burst) * dir * 50,
          s: 1 + expoOut(burst) * 0.8,
          o: (t < t0 ? 0 : 1) * (1 - burst),
          blur: expoOut(burst) * 16,
        },
        false
      );
    });
  } else off(t4a);

  put(t4b.el, { y: ex * 300, blur: ex * 20 });
  t4b.chars.forEach((c, i) => {
    const t0 = 7.82 + i * 0.055;
    const p = seg(t, t0, t0 + 0.3);
    put(c, { s: backOut(p, 2.6), r: (1 - expoOut(p)) * -40, o: t < t0 ? 0 : 1 }, false);
  });

  const C = slam(t, 8.08, { from: 3.8, rgb: 26 });
  const gC = glitch(t, 8.1, 0.13, 88, 50);
  put(t4c.el, {
    ...C,
    x: gC.x,
    y: ex * 320,
    clip: gC.clip,
    rgb: C.rgb + (gC.on ? 16 : 0),
    blur: C.blur + ex * 20,
    shadow: "14px 14px 0 #e8a53a",
    s: C.s * (1 + 0.03 * cubicInOut(seg(t, 8.5, 9.7))),
  });

  put(t4d.el, { r: -9 + 1.5 * Math.sin(t * 5), y: -ex * 300, blur: ex * 20 });
  t4d.chars.forEach((c, i) => {
    const t0 = 8.86 + i * 0.07;
    const p = seg(t, t0, t0 + 0.7);
    put(c, { y: lerp(-130, 0, elasticOut(p)) + 6 * Math.sin(t * 7 + i), o: t < t0 ? 0 : 1 }, false);
  });
});

// ---------------------------------------------------------------- S5 寸法カウンター（斜めの帯）
const BAND_ROT = -5;
const BAND_TAN = Math.tan((-BAND_ROT * Math.PI) / 180);
const bandY = (x) => 540 - (x - 960) * BAND_TAN;
const t5band = box({ x: 960, y: 540, w: 2500, h: 236, color: INK });
const t5l1 = txt("直径 約", { x: 360, y: bandY(360) + 8, size: 52, font: "gothic", weight: 700, color: GOLD });
const t5n1 = txt("4.6", { x: 610, y: bandY(610), size: 196, font: "anton", weight: 400, color: PAPER });
const t5u1 = txt("cm", { x: 790, y: bandY(790) + 36, size: 72, font: "anton", weight: 400, color: GOLD });
const t5l2 = txt("厚さ 約", { x: 1130, y: bandY(1130) + 8, size: 52, font: "gothic", weight: 700, color: GOLD });
const t5n2 = txt("1.6", { x: 1375, y: bandY(1375), size: 196, font: "anton", weight: 400, color: PAPER });
const t5u2 = txt("cm", { x: 1555, y: bandY(1555) + 36, size: 72, font: "anton", weight: 400, color: GOLD });
const t5tag = box({ x: 960, y: 952, w: 760, h: 132, color: BURNT });
const t5top = txt("ころん、とまあるい。", { x: 960, y: 952, size: 76, color: PAPER });
const COUNTERS = [
  [t5n1, 4.6, 10.52],
  [t5n2, 1.6, 10.66],
];
item((t) => {
  const all = [t5band, t5l1, t5n1, t5u1, t5l2, t5n2, t5u2, t5top, t5tag];
  if (t < 10.0 || t > 12.9) {
    all.forEach(off);
    return;
  }
  const outP = seg(t, 12.18, 12.42);
  if (t < 12.18) {
    t5band.style.transformOrigin = "0% 50%";
    put(t5band, { sx: expoOut(seg(t, 10.22, 10.5)), r: BAND_ROT, y: 1250 * BAND_TAN, o: t < 10.22 ? 0 : 1 }, false);
  } else {
    t5band.style.transformOrigin = "100% 50%";
    put(t5band, { sx: 1 - expoIn(outP), r: BAND_ROT, y: -1250 * BAND_TAN }, false);
  }
  const hideIn = 1 - expoIn(seg(t, 12.1, 12.3));
  [
    [t5l1, 10.42],
    [t5u1, 10.6],
    [t5l2, 10.56],
    [t5u2, 10.74],
  ].forEach(([T, t0]) => {
    const p = expoOut(seg(t, t0, t0 + 0.35));
    put(T.el, { r: BAND_ROT, x: (1 - p) * -80, o: seg(t, t0, t0 + 0.1) * hideIn, blur: (1 - p) * 10 });
  });
  for (const [T, v, t0] of COUNTERS) {
    const p = expoOut(seg(t, t0, t0 + 0.8));
    const lock = decay(t, t0 + 0.8, 10);
    T.chars.forEach((c) => (c.textContent = ""));
    T.chars[0].textContent = (v * p).toFixed(1);
    const g = glitch(t, t0 + 0.78, 0.1, t0 * 13, 20);
    put(T.el, {
      r: BAND_ROT,
      y: (1 - expoOut(seg(t, t0, t0 + 0.3))) * 140,
      o: seg(t, t0, t0 + 0.08) * hideIn,
      s: 1 + 0.12 * lock,
      x: g.x,
      rgb: g.on ? 12 : 0,
      shadow: lock > 0.05 ? `0 0 ${(40 * lock).toFixed(1)}px rgba(227,172,92,${lock.toFixed(2)})` : "",
    });
  }
  put(t5top.el, {});
  t5tag.style.transformOrigin = "50% 50%";
  const tagIn = expoOut(seg(t, 11.0, 11.25));
  const tagOut = expoIn(seg(t, 12.12, 12.38));
  put(t5tag, { sx: tagIn * (1 - tagOut), r: -2, o: t < 11.0 ? 0 : 1 }, false);
  t5top.chars.forEach((c, i) => {
    const t0 = 11.1 + i * 0.045;
    const p = seg(t, t0, t0 + 0.4);
    const e = expoIn(seg(t, 12.15 + i * 0.015, 12.4 + i * 0.015));
    put(c, { y: lerp(90, 0, backOut(p, 2)) - e * 200, r: (1 - expoOut(p)) * 25, o: (t < t0 ? 0 : seg(t, t0, t0 + 0.12)) * (1 - e) }, false);
  });
});

// ---------------------------------------------------------------- S6 エンドカード
const TX = 1335;
const t6k = txt("秋田銘菓", { x: TX, y: 345, size: 50, font: "gothic", weight: 700, color: "#d9b27a" });
const t6kl = box({ x: TX - 300, y: 345, w: 150, h: 2, color: "#b98a52" });
const t6kr = box({ x: TX + 300, y: 345, w: 150, h: 2, color: "#b98a52" });
const t6t = txt("金萬", { x: TX, y: 560, size: 310 });
t6t.chars.forEach((c) => c.classList.add("goldfill"));
const t6r = txt("きんまん", { x: TX, y: 790, size: 54, font: "gothic", weight: 500, color: "#e8cfa6" });
const t6c = txt("非公式ファンメイド3D", { x: 1745, y: 1040, size: 20, font: "gothic", weight: 500, color: "rgba(232,207,166,.55)", ls: "0.1em" });
item((t) => {
  if (t < 12.9) {
    [t6k, t6kl, t6kr, t6t, t6r, t6c].forEach(off);
    return;
  }
  const hold = 1 + 0.035 * cubicInOut(seg(t, 13.4, 15));
  put(t6t.el, { s: hold, filter: "drop-shadow(0 10px 30px rgba(0,0,0,.45))" });
  const sweep = cubicInOut(seg(t, 13.9, 14.6));
  t6t.chars.forEach((c, i) => (c.style.backgroundPosition = `${lerp(115 + i * 45, -60 + i * 45, sweep)}% 0`));
  t6t.chars.forEach((c, i) => {
    const t0 = 13.22 + i * 0.09;
    const S = slam(t, t0, { from: 3.6, blur: 30, rgb: 0 });
    const g = glitch(t, t0 + 0.02, 0.1, 120 + i, 40);
    put(c, { ...S, x: g.x + (1 - expoOut(seg(t, t0, t0 + 0.4))) * (i ? 260 : -260), clip: g.clip }, false);
  });

  const pk = expoOut(seg(t, 13.45, 13.95));
  t6k.el.style.letterSpacing = lerp(1.2, 0.6, pk) + "em";
  put(t6k.el, { o: seg(t, 13.45, 13.6) * hold, blur: (1 - pk) * 10, s: hold });
  for (const [el, origin] of [
    [t6kl, "100% 50%"],
    [t6kr, "0% 50%"],
  ]) {
    el.style.transformOrigin = origin;
    put(el, { sx: expoOut(seg(t, 13.55, 14.05)), o: t < 13.55 ? 0 : 1 }, false);
  }
  const pr = expoOut(seg(t, 13.62, 14.3));
  t6r.el.style.letterSpacing = lerp(1.6, 0.85, pr) + "em";
  put(t6r.el, { o: seg(t, 13.62, 13.8), blur: (1 - pr) * 10, y: (1 - pr) * 30 });
  put(t6c.el, { o: seg(t, 14.05, 14.4) });
});

// ---------------------------------------------------------------- 背景・図形レイヤー
const bgEl = $("bg");
const sunburst = $("sunburst");
const stripes = $("stripes");
const disc = $("disc");
const ringA = $("ring-a");
const ringB = $("ring-b");

function makeMarquee(el, text, size) {
  el.textContent = text.repeat(8);
  el.style.fontSize = size + "px";
}
const mqMid = $("mq-mid");
const mqTop = $("mq-top");
const mqBot = $("mq-bot");
makeMarquee(mqMid, "KINMAN ・ 金萬 ・ ", 400);
makeMarquee(mqTop, "AKITA MEIKA ・ KINMAN ・ ", 170);
makeMarquee(mqBot, "金萬 ・ KINMAN ・ 秋田銘菓 ・ ", 170);
let mqUnit = { mid: 2000, top: 2000, bot: 2000 };

function marquee(el, unit, x, y, o, stroke) {
  if (o <= 0.002) return (el.style.visibility = "hidden");
  el.style.visibility = "visible";
  el.style.opacity = o;
  el.style.webkitTextStroke = stroke;
  el.style.transform = `translate(${(((x % unit) + unit) % unit) - unit}px, ${y}px)`;
}

function bgColorAt(t) {
  if (t < 1.2) return NIGHT;
  if (t < 4.5) return HONEY_BG;
  if (t < 7.0) return STAMP_BG;
  if (t < 7.5) return SPLIT_BG;
  if (t < 10.0) return CREAM;
  if (t < 12.7) return PAPER;
  return END_BG;
}

function updateLayers(t, km) {
  bgEl.style.background =
    t >= 12.7
      ? `radial-gradient(60% 80% at 34% 52%, #4a2a14 0%, ${END_BG} 70%)`
      : t >= 4.5 && t < 7.0
        ? `radial-gradient(70% 90% at 38% 50%, #8d3a16 0%, ${STAMP_BG} 75%)`
        : bgColorAt(t);

  // 放射状の光（焼き印・エンド）
  if (t >= 4.5 && t < 7.0) {
    sunburst.style.visibility = "visible";
    sunburst.style.opacity = 1;
    sunburst.style.background = `repeating-conic-gradient(from ${(t * 14).toFixed(2)}deg at ${km.x.toFixed(1)}px ${km.y.toFixed(1)}px, rgba(255,200,140,.075) 0deg 5deg, transparent 5deg 10deg)`;
  } else if (t >= 12.7) {
    sunburst.style.visibility = "visible";
    sunburst.style.opacity = seg(t, 13.25, 13.8);
    sunburst.style.background = `repeating-conic-gradient(from ${(-t * 8).toFixed(2)}deg at ${km.x.toFixed(1)}px ${km.y.toFixed(1)}px, rgba(227,172,92,.07) 0deg 4deg, transparent 4deg 9deg)`;
  } else sunburst.style.visibility = "hidden";

  // 斜めストライプ（並びのシーン）
  if (t >= 10.0 && t < 12.7) {
    stripes.style.visibility = "visible";
    stripes.style.backgroundPosition = `${(t * 90).toFixed(1)}px 0`;
  } else stripes.style.visibility = "hidden";

  // お菓子の後ろの円
  let d = null;
  if (t >= 1.3 && t < 4.5) {
    let pulse = 0;
    for (const b of BEATS_S2) pulse += 0.07 * decay(t, b, 9);
    const grow = backOut(seg(t, 1.45, 1.85), 1.6);
    d = { r: km.r * 1.55 * grow * (1 + pulse), bg: "#eab65a", o: 1 };
  } else if (t >= 7.0 && t < 7.5) {
    d = { r: km.r * 1.9 * backOut(seg(t, 7.0, 7.25), 2), bg: "#f6c86a", o: 1 };
  } else if (t >= 12.7) {
    d = { r: km.r * 2.3 * (1 + 0.04 * Math.sin(t * 2)), bg: "radial-gradient(closest-side, rgba(227,172,92,.38), rgba(227,172,92,0))", o: seg(t, 13.2, 13.7) };
  }
  if (d && d.r > 1) {
    disc.style.visibility = "visible";
    disc.style.opacity = d.o;
    disc.style.width = disc.style.height = `${(d.r * 2).toFixed(1)}px`;
    disc.style.transform = `translate(${(40 + km.x - d.r).toFixed(1)}px, ${(40 + km.y - d.r).toFixed(1)}px)`;
    disc.style.background = d.bg;
  } else disc.style.visibility = "hidden";

  // 流れる大きな文字
  marquee(mqMid, mqUnit.mid, -t * 520, 40 + 540 - 200, t < 1.45 ? 0 : seg(t, 1.45, 1.8) * (1 - seg(t, 4.3, 4.5)), "2px rgba(138,59,23,.22)");
  const endO = t < 12.7 ? 0 : seg(t, 12.75, 13.3);
  marquee(mqTop, mqUnit.top, -t * 110, 40 + 40, endO * 0.9, "1.5px rgba(227,172,92,.2)");
  marquee(mqBot, mqUnit.bot, t * 110 - 600, 40 + 1080 - 210, endO * 0.9, "1.5px rgba(227,172,92,.2)");

  // 焼き印を囲む輪 / エンドの輪
  let ring = null;
  if (t >= 4.7 && t < 7.0) ring = { draw: expoOut(seg(t, 4.75, 5.45)), o: 1 - seg(t, 6.35, 6.6), color: "rgba(244,237,226,.7)", k: 1.12 };
  else if (t >= 13.25) ring = { draw: expoOut(seg(t, 13.3, 14.1)), o: 1, color: "rgba(227,172,92,.55)", k: 1.35 };
  if (ring && ring.o > 0.002) {
    for (const [c, k, w, dash] of [
      [ringA, ring.k, 3, null],
      [ringB, ring.k + 0.12, 2, "4 14"],
    ]) {
      const r = km.r * k;
      const len = 2 * Math.PI * r;
      c.setAttribute("cx", km.x);
      c.setAttribute("cy", km.y);
      c.setAttribute("r", r);
      c.style.visibility = "visible";
      c.style.opacity = ring.o;
      c.style.stroke = ring.color;
      c.style.strokeWidth = w;
      c.style.transformOrigin = `${km.x}px ${km.y}px`;
      c.style.transform = `rotate(${(dash ? t * 40 : -90).toFixed(2)}deg)`;
      c.style.strokeDasharray = dash ? dash : `${len} ${len}`;
      c.style.strokeDashoffset = dash ? 0 : len * (1 - ring.draw);
      if (dash) c.style.opacity = ring.o * ring.draw;
    }
  } else {
    ringA.style.visibility = ringB.style.visibility = "hidden";
  }
}

// ---------------------------------------------------------------- 2D エフェクト（集中線・放射・きらめき）
const fx = $("fx").getContext("2d");
function concentration(cx, cy, { count, inner, jitter, color, alpha, width, t, seed = 0 }) {
  const k = Math.floor(t * 24);
  fx.fillStyle = color;
  fx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const a = ((i + hash(i + seed) * 0.8) / count) * Math.PI * 2;
    const r0 = inner + hash(i * 3.3 + k * 0.71 + seed) * jitter;
    const r1 = 1500;
    const w = width * (0.3 + hash(i + 17 + seed));
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    fx.beginPath();
    fx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    fx.lineTo(cx + Math.cos(a) * r1 + nx * w, cy + Math.sin(a) * r1 + ny * w);
    fx.lineTo(cx + Math.cos(a) * r1 - nx * w, cy + Math.sin(a) * r1 - ny * w);
    fx.closePath();
    fx.fill();
  }
  fx.globalAlpha = 1;
}
function sparkle(x, y, size, alpha) {
  fx.globalAlpha = alpha;
  fx.beginPath();
  fx.moveTo(x, y - size);
  fx.quadraticCurveTo(x, y, x + size, y);
  fx.quadraticCurveTo(x, y, x, y + size);
  fx.quadraticCurveTo(x, y, x - size, y);
  fx.quadraticCurveTo(x, y, x, y - size);
  fx.fill();
  fx.globalAlpha = 1;
}
function updateFx(t, km) {
  fx.clearRect(0, 0, W, H);
  // 飛び込みのスピード線
  if (t >= 1.0 && t < 1.75) {
    const a = seg(t, 1.0, 1.1) * (1 - seg(t, 1.45, 1.75));
    concentration(960, 540, { count: 90, inner: 330, jitter: 300, color: "#c98a3e", alpha: 0.55 * a, width: 9, t, seed: 3 });
  }
  // 割れた瞬間の集中線
  if (t >= 7.5 && t < 10.0) {
    const a = t < 8.7 ? 1 - 0.65 * seg(t, 8.0, 8.7) : 0.35 * (1 - seg(t, 9.6, 9.95));
    concentration(km.x, km.y + 30, { count: 130, inner: 420, jitter: 280, color: INK, alpha: 0.88 * a, width: 7, t, seed: 11 });
  }
  // しっとり のきらめき
  if (t >= 8.9 && t < 10.0) {
    fx.fillStyle = "#fff6dc";
    for (let i = 0; i < 7; i++) {
      const t0 = 8.95 + i * 0.1;
      const p = seg(t, t0, t0 + 0.5);
      const tw = Math.sin(Math.PI * p);
      const x = 1330 + hash(i + 40) * 480;
      const y = 110 + hash(i + 50) * 240;
      if (tw > 0) {
        fx.fillStyle = i % 2 ? "#fff6dc" : GOLD;
        sparkle(x, y, 10 + 22 * tw * hash(i + 60) + 8 * tw, tw * (1 - seg(t, 9.7, 9.95)));
      }
    }
  }
  // 数字が止まったときの小さなきらめき
  for (const [, , t0] of COUNTERS) {
    const tt = t0 + 0.8;
    if (t >= tt && t < tt + 0.5) {
      const p = seg(t, tt, tt + 0.5);
      fx.fillStyle = GOLD;
      const cx = t0 < 10.6 ? 610 : 1375;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6;
        sparkle(cx + Math.cos(a) * (90 + p * 70), bandY(cx) + Math.sin(a) * (80 + p * 60), 14 * Math.sin(Math.PI * p), 1 - p);
      }
    }
  }
  // 着地の放射線
  if (t >= 13.3 && t < 14.2) {
    const p = seg(t, 13.3, 14.2);
    fx.strokeStyle = GOLD;
    fx.lineCap = "round";
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + hash(i) * 0.1;
      const r0 = km.r * 1.1 + expoOut(p) * (380 + hash(i + 2) * 260);
      const len = (1 - p) * (60 + hash(i + 5) * 120);
      fx.globalAlpha = (1 - p) * 0.9;
      fx.lineWidth = 3 + hash(i + 9) * 4;
      fx.beginPath();
      fx.moveTo(km.x + Math.cos(a) * r0, km.y + Math.sin(a) * r0);
      fx.lineTo(km.x + Math.cos(a) * (r0 + len), km.y + Math.sin(a) * (r0 + len));
      fx.stroke();
    }
    fx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- トランジション
const iris = [$("iris-a"), $("iris-b")];
function updateIris(t) {
  const set = (el, p, color) => {
    if (p <= 0.001) return (el.style.visibility = "hidden");
    el.style.visibility = "visible";
    el.style.background = color;
    el.style.transform = `scale(${p.toFixed(4)})`;
  };
  if (t >= 0.94 && t < 1.2) {
    set(iris[0], expoOut(seg(t, 0.94, 1.3)), GOLD);
    set(iris[1], expoOut(seg(t, 1.0, 1.28)), HONEY_BG);
  } else if (t >= 12.45 && t < 12.7) {
    set(iris[0], expoOut(seg(t, 12.45, 12.75)), GOLD);
    set(iris[1], expoOut(seg(t, 12.5, 12.72)), END_BG);
  } else {
    iris[0].style.visibility = iris[1].style.visibility = "hidden";
  }
}

const wipes = $("wipes");
const BAR_N = 6;
const bars = [...Array(BAR_N)].map((_, i) => {
  const d = document.createElement("div");
  d.style.top = (i * 100) / BAR_N + "%";
  d.style.height = 100 / BAR_N + 0.3 + "%";
  // 帯が画面を覆っている間も動きが見えるよう、中に文字を流す
  const label = document.createElement("span");
  label.textContent = "金萬 KINMAN ".repeat(12);
  d.append(label);
  wipes.append(d);
  return d;
});
// tc の瞬間に画面が完全に覆われ、その下で場面が切り替わる
const WIPES = [
  { tc: 4.5, angle: -28, colors: [BURNT, GOLD, INK, "#b4561f", GOLD, BURNT] },
  { tc: 7.0, angle: 62, colors: [GOLD, "#f6c86a", INK, SPLIT_BG, BURNT, GOLD] },
  { tc: 10.0, angle: 152, colors: [INK, GOLD, PAPER, BURNT, INK, GOLD] },
];
const sineInOut = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
function updateWipes(t) {
  const w = WIPES.find((w) => t >= w.tc - 0.4 && t < w.tc + 0.4);
  if (!w) return (wipes.style.visibility = "hidden");
  wipes.style.visibility = "visible";
  wipes.style.transform = `rotate(${w.angle}deg)`;
  bars.forEach((b, i) => {
    const d = (i - (BAR_N - 1) / 2) * 0.008;
    const x = lerp(-101, 101, sineInOut(seg(t, w.tc - 0.35 + d, w.tc + 0.35 + d)));
    b.style.background = w.colors[i % w.colors.length];
    b.style.transform = `translateX(${x.toFixed(2)}%)`;
    b.firstChild.style.transform = `translateX(${((i % 2 ? 1 : -1) * (t - w.tc) * 2600 - 1400).toFixed(1)}px)`;
  });
}

// ---------------------------------------------------------------- カメラの揺れ・フラッシュ
const IMPACTS = [
  { t: 0.04, a: 10, f: 0.35 },
  { t: 0.52, a: 12, f: 0.35 },
  { t: 1.52, a: 16, f: 0.45 },
  ...BEATS_S2.map((b) => ({ t: b, a: 5, f: 0 })),
  { t: 3.0, a: 9, f: 0.2 },
  { t: 7.5, a: 30, f: 1.0 },
  { t: 8.08, a: 12, f: 0.25 },
  { t: 11.32, a: 5, f: 0 },
  { t: 13.3, a: 20, f: 0.55 },
];
const flashEl = $("flash");
const grain = $("grain");
function updateCam(t) {
  let x = 0;
  let y = 0;
  let r = 0;
  let s = 1;
  let f = 0;
  for (const im of IMPACTS) {
    const d = decay(t, im.t, 8);
    if (d <= 0.001) continue;
    const u = t - im.t;
    x += im.a * d * Math.sin(u * 71 + im.t * 10);
    y += im.a * d * Math.sin(u * 53 + 1.3 + im.t * 7);
    r += im.a * 0.02 * d * Math.sin(u * 47 + 2.1);
    s += im.a * 0.0022 * decay(t, im.t, 14);
    f += im.f * decay(t, im.t, 16);
  }
  camEl.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
  flashEl.style.opacity = Math.min(1, f).toFixed(3);
  const k = Math.floor(t * 24);
  grain.style.transform = `translate(${(hash(k) * 100 - 50).toFixed(0)}px, ${(hash(k + 3) * 100 - 50).toFixed(0)}px)`;
}

// ---------------------------------------------------------------- frame
function update(t) {
  t = Math.max(0, Math.min(DURATION - 1e-4, t));
  update3D(t);
  const km = kinmanOnScreen();
  updateLayers(t, km);
  updateFx(t, km);
  for (const f of items) f(t);
  updateIris(t);
  updateWipes(t);
  updateCam(t);
  renderer.render(scene, camera);
}

const ready = (async () => {
  await loaded;
  const sample = ALL_TEXT.join("") + "0123456789.KINMAN・金萬AKITAMEIKA";
  await Promise.all([
    document.fonts.load(`800 100px "Shippori Mincho B1"`, sample),
    document.fonts.load(`900 100px "Zen Kaku Gothic New"`, sample),
    document.fonts.load(`700 100px "Zen Kaku Gothic New"`, sample),
    document.fonts.load(`500 100px "Zen Kaku Gothic New"`, sample),
    document.fonts.load(`400 100px "Anton"`, sample),
  ]);
  await document.fonts.ready;
  // 流れる文字の1周ぶんの幅
  const unitOf = (el, text, size) => {
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:Anton,Impact,sans-serif;font-size:${size}px`;
    probe.textContent = text;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  mqUnit = {
    mid: unitOf(mqMid, "KINMAN ・ 金萬 ・ ", 400),
    top: unitOf(mqTop, "AKITA MEIKA ・ KINMAN ・ ", 170),
    bot: unitOf(mqBot, "金萬 ・ KINMAN ・ 秋田銘菓 ・ ", 170),
  };
  update(0);
})();

window.promo = { ready, update, DURATION };

// プレビュー: クリックで音つき再生、スペースで一時停止、?t=秒 で静止
if (!CAPTURE) {
  const params = new URLSearchParams(location.search);
  const still = params.get("t");
  ready.then(() => {
    if (still !== null) return update(parseFloat(still));
    const audio = new Audio("out/kinman_bgm.wav");
    let start = performance.now();
    let paused = false;
    let pausedAt = 0;
    addEventListener("click", () => {
      start = performance.now();
      audio.currentTime = 0;
      audio.play().catch(() => {});
    });
    addEventListener("keydown", (e) => {
      if (e.code !== "Space") return;
      paused = !paused;
      if (paused) {
        pausedAt = performance.now() - start;
        audio.pause();
      } else {
        start = performance.now() - pausedAt;
        audio.play().catch(() => {});
      }
    });
    const loop = (now) => {
      if (!paused) {
        const t = ((now - start) / 1000) % DURATION;
        update(t);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
