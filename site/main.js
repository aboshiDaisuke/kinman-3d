import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

// モデルは実寸（メートル）。直径 4.6cm、厚さ 1.6cm。原点は底面の中心。
const RADIUS = 0.023;
const HEIGHT = 0.0165;
const HALF_CENTROID = (4 * RADIUS) / (3 * Math.PI); // 半円の重心までの距離
const FLOAT_Y = 0.036;          // 手に持って眺めるイメージで、少し宙に浮かせる
const ELEVATION = THREE.MathUtils.degToRad(20);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
// スタジオのHDRI（Poly Haven, CC0）で映り込みと柔らかい環境光を作る
new RGBELoader().load("env/studio.hdr", (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentRotation.set(0, -0.6, 0);
  scene.environmentIntensity = 0.75;
  hdr.dispose();
});

// カメラは正面やや上に固定し、動かすのはお菓子のほう
const camera = new THREE.PerspectiveCamera(30, 1, 0.002, 5);
const LOOK_AT = new THREE.Vector3(0, FLOAT_Y - 0.004, 0);
const VIEW_DIR = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION)); // 注視点 → カメラ
const SCREEN_UP = new THREE.Vector3(0, Math.cos(ELEVATION), -Math.sin(ELEVATION));
const ZOOM = { min: 0.075, max: 0.32 };
let dist = 0.3;
let distTarget = 0.17;

// ---------------------------------------------------------------- lights
const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
key.position.set(-0.12, 0.24, 0.12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.09, right: 0.09, top: 0.09, bottom: -0.09, near: 0.05, far: 0.6 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.0002;
key.shadow.radius = 14;
key.shadow.blurSamples = 20;
scene.add(key);

const rim = new THREE.DirectionalLight(0xffe2c4, 0.9);
rim.position.set(0.14, 0.1, -0.16);
scene.add(rim);

const under = new THREE.DirectionalLight(0xfff4e8, 0.35); // 底を向けたとき用の弱い照り返し
under.position.set(0.02, -0.2, 0.08);
scene.add(under);

scene.add(new THREE.HemisphereLight(0xfff6ea, 0x7a5a42, 0.35));

// ---------------------------------------------------------------- ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1.2, 1.2),
  new THREE.ShadowMaterial({ color: 0x3a2210, opacity: 0.16 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 真下のやわらかい影
const blob = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(45,25,10,0.32)");
  grd.addColorStop(0.5, "rgba(45,25,10,0.14)");
  grd.addColorStop(1, "rgba(45,25,10,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0003;
  return m;
})();
scene.add(blob);

// ---------------------------------------------------------------- model
// root: 回転の中心（お菓子の真ん中）。body: 底面原点のモデルを中心へずらす。
const root = new THREE.Group();
root.position.y = FLOAT_Y;
scene.add(root);
const body = new THREE.Group();
body.position.y = -HEIGHT / 2;
root.add(body);
const pivotA = new THREE.Group();
const pivotB = new THREE.Group();
body.add(pivotA, pivotB);
let whole = null;

const loadingEl = document.getElementById("loading");
new GLTFLoader().load(
  "models/kinman.glb",
  (gltf) => {
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      for (const k of ["map", "normalMap", "roughnessMap"]) {
        if (m[k]) m[k].anisotropy = maxAniso;
      }
      // 焼き菓子のふんわりした表面の照り（ベルベット状の反射）
      if (m.isMeshPhysicalMaterial) {
        m.sheen = 0.35;
        m.sheenRoughness = 0.5;
        m.sheenColor = new THREE.Color(0xffe2bc);
        m.specularIntensity = 0.45;
      }
    });
    whole = gltf.scene.getObjectByName("KM_Whole");
    const halfA = gltf.scene.getObjectByName("KM_HalfA");
    const halfB = gltf.scene.getObjectByName("KM_HalfB");
    body.add(whole);
    // 半分それぞれの重心を回転の中心にする
    pivotA.add(halfA);
    pivotB.add(halfB);
    halfA.position.set(0, 0, HALF_CENTROID);
    halfB.position.set(0, 0, -HALF_CENTROID);
    setSplitVisual(0);

    loadingEl.classList.add("done");
    root.quaternion.copy(ORIENT.front).premultiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -0.9));
    turnTo(ORIENT.front, 1800);
  },
  undefined,
  (err) => {
    console.error(err);
    loadingEl.querySelector("span:last-child").textContent = "読み込みに失敗しました";
  }
);

// ---------------------------------------------------------------- tweens
const tweens = new Set();
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function tween(duration, onUpdate, onDone) {
  const tw = { start: performance.now(), duration: reduceMotion ? 1 : duration, onUpdate, onDone };
  tweens.add(tw);
  return tw;
}
function stepTweens(now) {
  for (const tw of tweens) {
    const t = Math.min(1, (now - tw.start) / tw.duration);
    tw.onUpdate(easeInOut(t));
    if (t >= 1) {
      tweens.delete(tw);
      tw.onDone?.();
    }
  }
}

// ---------------------------------------------------------------- 向きのプリセット
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
// お菓子の +Y（上面）を faceDir へ、焼き印の上方向（-Z）を画面の上へ向ける回転
function facing(faceDir, textUp) {
  const y = faceDir.clone().normalize();
  const z = textUp.clone().negate().normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const ORIENT = {
  front: new THREE.Quaternion().setFromAxisAngle(X_AXIS, 0.38),
  top: facing(VIEW_DIR, SCREEN_UP),
  side: new THREE.Quaternion().setFromAxisAngle(X_AXIS, -ELEVATION),
  bottom: facing(VIEW_DIR.clone().negate(), SCREEN_UP),
  cut: new THREE.Quaternion().setFromAxisAngle(X_AXIS, 0.22),
};

let turnTween = null;
function turnTo(q, duration = 1000) {
  const from = root.quaternion.clone();
  spinVel.set(0, 0, 0);
  if (turnTween) tweens.delete(turnTween);
  turnTween = tween(duration, (t) => root.quaternion.slerpQuaternions(from, q, t), () => (turnTween = null));
}
function zoomTo(d, duration = 1000) {
  const from = distTarget;
  tween(duration, (t) => (distTarget = THREE.MathUtils.lerp(from, d, t)));
}

const viewButtons = [...document.querySelectorAll("[data-view]")];
function setPressedView(name) {
  for (const b of viewButtons) b.setAttribute("aria-pressed", String(b.dataset.view === name));
}
for (const b of viewButtons) {
  b.addEventListener("click", () => {
    setPressedView(b.dataset.view);
    if (b.dataset.view !== "front") setAutoRotate(false);
    turnTo(ORIENT[b.dataset.view]);
  });
}

// ---------------------------------------------------------------- 自由回転（仮想トラックボール）
// ドラッグした方向に、画面に対してそのまま転がす。どの向きにも回り、離すと惰性で回り続ける。
const ROT_PER_PX = 0.009;
const pointers = new Map();
const spinVel = new THREE.Vector3(); // ワールド座標の角速度（rad/s）
let lastMoveTime = 0;
let pinch = null;

function cameraAxis(dx, dy) {
  // 画面上の移動 (dx, dy) に対する回転軸（カメラ空間 → ワールド）
  return new THREE.Vector3(dy, dx, 0).applyQuaternion(camera.quaternion);
}
function rotateWorld(axis, angle) {
  if (angle === 0 || axis.lengthSq() === 0) return;
  root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle));
}
function userTookOver() {
  if (turnTween) {
    tweens.delete(turnTween);
    turnTween = null;
  }
  setPressedView(null);
  setAutoRotate(false);
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  spinVel.set(0, 0, 0);
  userTookOver();
  if (pointers.size === 2) pinch = pinchState();
});
canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const now = performance.now();
  if (pointers.size === 1) {
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const axis = cameraAxis(dx, dy);
    const angle = Math.hypot(dx, dy) * ROT_PER_PX;
    rotateWorld(axis, angle);
    const dt = Math.max(8, now - lastMoveTime) / 1000;
    spinVel.copy(axis.normalize().multiplyScalar(Math.min(angle / dt, 14)));
    lastMoveTime = now;
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 2 && pinch) {
    // 2本指: ピンチで拡大縮小、ひねりで画面内回転
    const next = pinchState();
    distTarget = THREE.MathUtils.clamp(distTarget * (pinch.len / next.len), ZOOM.min, ZOOM.max);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    rotateWorld(forward, -(next.ang - pinch.ang));
    pinch = next;
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  // 最後の動きから時間が空いていたら惰性なし
  if (performance.now() - lastMoveTime > 80) spinVel.set(0, 0, 0);
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
function pinchState() {
  const [a, b] = [...pointers.values()];
  return { len: Math.hypot(b.x - a.x, b.y - a.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    distTarget = THREE.MathUtils.clamp(distTarget * Math.exp(e.deltaY * 0.0012), ZOOM.min, ZOOM.max);
  },
  { passive: false }
);
canvas.addEventListener("dblclick", () => {
  setPressedView("front");
  turnTo(ORIENT.front);
});

// キーボード（矢印で回転、+/- で拡大縮小）
canvas.tabIndex = 0;
canvas.addEventListener("keydown", (e) => {
  const step = 0.18;
  const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (map[e.key]) {
    e.preventDefault();
    userTookOver();
    const [dx, dy] = map[e.key];
    rotateWorld(cameraAxis(dx, dy), step);
  } else if (e.key === "+" || e.key === "=") {
    distTarget = Math.max(ZOOM.min, distTarget * 0.85);
  } else if (e.key === "-") {
    distTarget = Math.min(ZOOM.max, distTarget / 0.85);
  }
});

// ---------------------------------------------------------------- split
// 割ったときの配置: 奥の半分(A)は切り口が手前を向いたまま左へ、手前の半分(B)は半回転して右へ
const SPLIT = {
  a: { x: -0.027, z: -0.012, ry: 0.3 },
  b: { x: 0.027, z: 0.004, ry: Math.PI - 0.3 },
  lift: 0.01,
};
let splitAmount = 0;
let splitOpen = false;
let splitTween = null;

function setSplitVisual(s) {
  splitAmount = s;
  const on = s > 0.0001;
  if (whole) whole.visible = !on;
  pivotA.visible = pivotB.visible = on;

  const lift = SPLIT.lift * Math.sin(Math.PI * s);
  pivotA.position.set(SPLIT.a.x * s, lift, -HALF_CENTROID + SPLIT.a.z * s);
  pivotA.rotation.set(0, SPLIT.a.ry * s, -0.25 * Math.sin(Math.PI * s));
  pivotB.position.set(SPLIT.b.x * s, lift * 1.2, HALF_CENTROID + SPLIT.b.z * s);
  pivotB.rotation.set(0, SPLIT.b.ry * s, 0.25 * Math.sin(Math.PI * s));
  blob.scale.setScalar(1 + 0.7 * s);
}

const splitBtn = document.getElementById("split");
splitBtn.addEventListener("click", () => {
  splitOpen = !splitOpen;
  splitBtn.setAttribute("aria-pressed", String(splitOpen));
  const from = splitAmount;
  const to = splitOpen ? 1 : 0;
  if (splitTween) tweens.delete(splitTween);
  splitTween = tween(1300, (t) => setSplitVisual(THREE.MathUtils.lerp(from, to, t)), () => (splitTween = null));
  setAutoRotate(false);
  setPressedView(null);
  turnTo(splitOpen ? ORIENT.cut : ORIENT.front, 1300);
  zoomTo(splitOpen ? 0.215 : 0.17, 1300);
});

// ---------------------------------------------------------------- autorotate
const spinBtn = document.getElementById("spin");
let autoRotate = !reduceMotion;
function setAutoRotate(on) {
  autoRotate = on;
  spinBtn.setAttribute("aria-pressed", String(on));
}
setAutoRotate(autoRotate);
spinBtn.addEventListener("click", () => setAutoRotate(!autoRotate));

// ---------------------------------------------------------------- loop
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦長の画面では少し広角にして全体を収める
  camera.fov = camera.aspect < 1 ? 42 : 30;
  // 縦長では、題字と下の操作部のあいだの空きの真ん中に来るよう表示位置をずらす
  if (camera.aspect < 1) {
    const top = document.querySelector(".masthead").getBoundingClientRect().bottom;
    const bottom = document.querySelector(".bottom").getBoundingClientRect().top;
    const shift = h / 2 - (top + bottom) / 2;
    camera.setViewOffset(w, h, 0, shift, w, h);
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

let prev = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  stepTweens(now);

  if (pointers.size === 0) {
    // 惰性で回り、ゆっくり止まる
    if (spinVel.lengthSq() > 1e-6) {
      rotateWorld(spinVel, spinVel.length() * dt);
      spinVel.multiplyScalar(Math.exp(-dt * 3.2));
    } else if (autoRotate && !turnTween) {
      rotateWorld(Y_AXIS, 0.45 * dt);
    }
  }

  // カメラの距離はなめらかに追従
  dist += (distTarget - dist) * (1 - Math.exp(-dt * 8));
  const fit = camera.aspect < 1 ? Math.min(1.6, 1 / camera.aspect) : 1;
  camera.position.copy(VIEW_DIR).multiplyScalar(dist * fit).add(LOOK_AT);
  camera.lookAt(LOOK_AT);

  renderer.render(scene, camera);
});
