// 焼き印: ベルトで流れてくる金萬に、焼きごてで焼き印を押す 30 秒のゲーム。
// 長押しで焼きごてが下り、押している間はベルトが止まる。押した長さで濃さが決まる（短いと薄い、長いと焦げ）。
import {
  createStage,
  loadKinman,
  randomLook,
  setStamp,
  shadowGround,
  createTweens,
  ease,
  lerp,
  clamp01,
  THREE,
  RADIUS,
  HEIGHT,
} from "../shared/kinman.js";
import { createUI, loading, sfx, wait } from "../shared/ui.js";

const GAME_TIME = 30;
const CONTACT = { thin: 0.12, burnt: 0.5, max: 0.9, auto: 1.1 }; // 押している長さ（秒）の区切り
const POS_MM = { perfect: 3, good: 6.5, ok: 11 }; // 真ん中からのずれ（mm）。ベルトの速さで 30〜40ms ほどの幅
const POINTS = { 極上: 100, 上: 60, 並: 30, 失敗: 0 };
const BELT_W = 0.078;
const BELT_L = 1.6;
const IRON_REST = HEIGHT + 0.032; // 焼きごての面の高さ（待機）
const IRON_HIT = HEIGHT - 0.0006; // 金萬に当たる高さ

const canvas = document.getElementById("view");
const gaugeEl = document.getElementById("gauge");
const gaugeLabel = document.getElementById("gauge-label");
const hintEl = document.getElementById("hint");
const load = loading();
const stage = createStage(canvas, { shadows: true, shadowSize: 0.3, fov: 32 });
const { scene, camera } = stage;
const tweens = createTweens();
const ui = createUI({
  id: "yakiin",
  title: "焼き印",
  hud: [
    { key: "time", label: "のこり", value: String(GAME_TIME) },
    { key: "score", label: "スコア", value: "0" },
    { key: "combo", label: "コンボ", value: "-" },
  ],
  formatBest: (v) => `${v}点`,
});

// ---------------------------------------------------------------- ベルト
// ベルトは beltGroup のローカル +X 方向に流れる。縦長の画面では奥から手前へ流れるよう回す
const beltGroup = new THREE.Group();
scene.add(beltGroup);
const floor = shadowGround(4, 0.14);
floor.position.y = -0.03;
scene.add(floor);

const beltTex = (() => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#4a423c";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#3a332e";
  g.fillRect(0, 0, 10, 64);
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.fillRect(10, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(BELT_L / 0.012, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
})();
const belt = new THREE.Mesh(
  new THREE.BoxGeometry(BELT_L, 0.012, BELT_W),
  [
    new THREE.MeshStandardMaterial({ color: 0x3a332e, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x3a332e, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0x2c2622, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x3a332e, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x3a332e, roughness: 0.9 }),
  ]
);
belt.position.y = -0.006;
belt.receiveShadow = true;
beltGroup.add(belt);

const railMat = new THREE.MeshStandardMaterial({ color: 0xc9c4bc, metalness: 0.7, roughness: 0.35 });
for (const z of [-1, 1]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(BELT_L, 0.012, 0.007), railMat);
  rail.position.set(0, 0.0, z * (BELT_W / 2 + 0.0035));
  rail.castShadow = rail.receiveShadow = true;
  beltGroup.add(rail);
  // 押す位置の目印（レールの上の三角）
  const tri = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.006, 0), new THREE.Vector2(0.006, 0), new THREE.Vector2(0, -0.009 * z)])),
    new THREE.MeshBasicMaterial({ color: 0xb4451c })
  );
  tri.rotation.x = -Math.PI / 2;
  tri.position.set(0, 0.0062, z * (BELT_W / 2 + 0.0035) + z * 0.0035);
  beltGroup.add(tri);
}
// 押す位置の点線
const guide = (() => {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const g = c.getContext("2d");
  for (let y = 0; y < 64; y += 16) {
    g.fillStyle = "rgba(230,150,90,0.8)";
    g.fillRect(0, y, 8, 9);
  }
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.0016, BELT_W), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0002;
  return m;
})();
beltGroup.add(guide);

// ---------------------------------------------------------------- 焼きごて
const iron = new THREE.Group();
const ironMat = new THREE.MeshStandardMaterial({ color: 0x6a625c, metalness: 0.85, roughness: 0.36 });
const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0135, 0.011, 48), ironMat);
head.scale.z = 1.38;
head.position.y = 0.0055;
head.castShadow = true;
iron.add(head);
const glow = new THREE.Mesh(
  new THREE.CircleGeometry(0.0128, 40),
  new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.5, depthWrite: false })
);
glow.scale.y = 1.38;
glow.rotation.x = Math.PI / 2;
glow.position.y = -0.0002;
iron.add(glow);
// 熱を帯びた縁（下の縁がほんのり赤い）
const hotRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.0132, 0.0011, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.8 })
);
hotRim.rotation.x = Math.PI / 2;
hotRim.scale.y = 1.38;
hotRim.position.y = 0.0009;
iron.add(hotRim);
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0034, 0.028, 16), ironMat);
neck.position.y = 0.011 + 0.014;
neck.castShadow = true;
iron.add(neck);
// 柄は上＋ローカル -Z（横長の画面では奥、縦長では右）へ伸ばし、流れてくる金萬を隠さない
const handleDir = new THREE.Vector3(0, 0.72, -0.7).normalize();
const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.12, 12), ironMat);
rod.castShadow = true;
const grip = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0055, 0.006, 0.09, 20),
  new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.7 })
);
grip.castShadow = true;
const rodStart = new THREE.Vector3(0, 0.038, 0);
rod.position.copy(rodStart).addScaledVector(handleDir, 0.06);
rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), handleDir);
grip.position.copy(rodStart).addScaledVector(handleDir, 0.165);
grip.quaternion.copy(rod.quaternion);
iron.add(rod, grip);
iron.position.y = IRON_REST;
beltGroup.add(iron);

// ---------------------------------------------------------------- 湯気・焦げ跡
const steamTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const steam = Array.from({ length: 36 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false;
  s.userData = { life: 0, max: 1, vel: new THREE.Vector3() };
  beltGroup.add(s);
  return s;
});
let steamCursor = 0;
function puff(at, n = 1, strength = 1) {
  for (let i = 0; i < n; i++) {
    const s = steam[steamCursor++ % steam.length];
    s.visible = true;
    s.position.set(at.x + (Math.random() - 0.5) * 0.02, at.y + 0.002, at.z + (Math.random() - 0.5) * 0.02);
    s.userData.life = 0;
    s.userData.max = 0.7 + Math.random() * 0.6;
    s.userData.vel.set((Math.random() - 0.5) * 0.01, 0.025 + Math.random() * 0.02 * strength, (Math.random() - 0.5) * 0.01);
    s.userData.size = 0.005 + Math.random() * 0.005;
  }
}
function stepSteam(dt) {
  for (const s of steam) {
    if (!s.visible) continue;
    const u = s.userData;
    u.life += dt;
    const p = u.life / u.max;
    if (p >= 1) {
      s.visible = false;
      continue;
    }
    s.position.addScaledVector(u.vel, dt);
    s.scale.setScalar(u.size * (1 + p * 2.5));
    s.material.opacity = 0.32 * Math.sin(Math.PI * p) * (1 - p * 0.3);
  }
}

// 空押しの焦げ跡（ベルトと一緒に流れていく）
const scorchTex = (() => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 88;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 44, 4, 32, 44, 34);
  grd.addColorStop(0, "rgba(20,10,5,0.75)");
  grd.addColorStop(0.7, "rgba(20,10,5,0.35)");
  grd.addColorStop(1, "rgba(20,10,5,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(32, 44, 30, 42, 0, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
})();
const scorches = Array.from({ length: 5 }, () => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.036), new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0003;
  m.visible = false;
  beltGroup.add(m);
  return m;
});
let scorchCursor = 0;

// ---------------------------------------------------------------- 画面の向き・カメラ
let vertical = null;
function frame(w, h, aspect) {
  const v = aspect < 0.9;
  if (v !== vertical) {
    vertical = v;
    beltGroup.rotation.y = v ? -Math.PI / 2 : 0;
    for (const it of items) it.obj.rotation.y = kinmanYaw() + (it.flipped ? 0 : 0);
  }
  if (mode === "tray") return frameTray(aspect);
  camera.fov = v ? 40 : 32;
  const el = v ? 0.98 : 0.86;
  const wantW = v ? 0.165 : 0.27;
  const dist = wantW / 2 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
  const ty = 0.012;
  const tz = v ? 0.012 : 0;
  camera.position.set(0, ty + Math.sin(el) * dist, tz + Math.cos(el) * dist);
  camera.lookAt(0, ty, tz);
  camera.updateProjectionMatrix();
  const k = stage.lights.key;
  k.position.set(-0.1, 0.3, 0.14);
  k.target.position.set(0, 0, 0);
}
// 金萬は beltGroup の中に置くので、焼き印の向きが画面に対してまっすぐになるよう打ち消す
const kinmanYaw = () => (vertical ? Math.PI / 2 : 0);

// ---------------------------------------------------------------- 金萬
let kit = null;
const items = [];
const pool = [];
function spawn(s, flipped = false) {
  let obj = pool.pop();
  const look = { ...randomLook(), strength: 0 };
  if (obj) setStamp(obj, look);
  else {
    obj = kit.make({ look });
    obj.traverse((o) => (o.castShadow = true));
  }
  obj.visible = true;
  obj.scale.set(1, 1, 1);
  obj.rotation.set(flipped ? Math.PI : 0, kinmanYaw(), 0);
  const lateral = (Math.random() - 0.5) * 0.003;
  obj.position.set(s, HEIGHT / 2, lateral);
  beltGroup.add(obj);
  const it = { obj, s, lateral, flipped, look, stamped: false, judged: false, grade: null, reason: "", bounce: 0 };
  items.push(it);
  return it;
}
function despawn(it) {
  it.obj.visible = false;
  beltGroup.remove(it.obj);
  pool.push(it.obj);
  items.splice(items.indexOf(it), 1);
}

// ---------------------------------------------------------------- 状態
let mode = "attract"; // attract / countdown / play / end / tray
let speed = 0.06;
let spawnGap = 0.1;
let nextSpawnIn = 0;
let timeLeft = GAME_TIME;
let elapsed = 0;
let score = 0;
let combo = 0;
let maxCombo = 0;
let beltOffset = 0;
const tally = { 極上: 0, 上: 0, 並: 0, 失敗: 0, 押し忘れ: 0, 見送り: 0, 空押し: 0 };
const made = []; // 焼き印を押したもの（結果のお盆に並べる）

const ironState = { phase: "up", t: 0, contact: 0, target: null, releaseQueued: false, auto: false, hitY: IRON_HIT, offset: new THREE.Vector2() };

function spawnRange() {
  return vertical ? { from: -0.27, to: 0.3 } : { from: -0.22, to: 0.24 };
}

function resetRound() {
  for (const it of [...items]) despawn(it);
  for (const sc of scorches) sc.visible = false;
  speed = 0.06;
  spawnGap = 0.1;
  timeLeft = GAME_TIME;
  elapsed = 0;
  score = 0;
  combo = 0;
  maxCombo = 0;
  for (const k of Object.keys(tally)) tally[k] = 0;
  made.length = 0;
  Object.assign(ironState, { phase: "up", t: 0, contact: 0, target: null, releaseQueued: false, auto: false });
  iron.position.y = IRON_REST;
  ui.set("time", String(GAME_TIME));
  ui.set("score", "0");
  ui.set("combo", "-");
  // 最初から何個か流れている状態にする
  const r = spawnRange();
  for (let s = -0.07; s > r.from; s -= 0.1) spawn(s);
  nextSpawnIn = 0.1 - (r.from - Math.min(...items.map((i) => i.s)));
}

// ---------------------------------------------------------------- 押す
function press(auto = false) {
  if (ironState.phase !== "up") return;
  if (mode !== "play" && !(mode === "attract" && auto)) return;
  ironState.phase = "down";
  ironState.t = 0;
  ironState.auto = auto;
  // 下り切るまでに真下へ来る金萬があれば金萬の上面、なければベルトまで下ろす
  const ahead = speed * 0.07;
  ironState.hitY = items.some((it) => Math.abs(it.s + ahead) < RADIUS + 0.002) ? IRON_HIT : IRON_HIT - HEIGHT;
  ironState.releaseQueued = false;
  if (!auto) sfx.whoosh(false);
}
function release() {
  if (ironState.phase === "down") ironState.releaseQueued = true;
  else if (ironState.phase === "hold") finishPress();
}

function contactStrength(c) {
  if (c < 0.1) return lerp(0.3, 0.6, c / 0.1);
  if (c < 0.2) return lerp(0.6, 1.0, (c - 0.1) / 0.1);
  if (c <= CONTACT.burnt) return 1.0;
  return lerp(1.0, 1.9, clamp01((c - CONTACT.burnt) / 0.45));
}

function beginContact() {
  ironState.phase = "hold";
  ironState.contact = 0;
  // 焼きごての真下にある金萬
  let target = null;
  let best = Infinity;
  for (const it of items) {
    const d = Math.abs(it.s);
    if (d < RADIUS + 0.002 && d < best) {
      best = d;
      target = it;
    }
  }
  ironState.target = target;
  ironState.hitY = target ? IRON_HIT : IRON_HIT - HEIGHT;
  const at = new THREE.Vector3(0, HEIGHT, 0);
  if (target) {
    // 金萬の上面での焼き印の中心（直径比のずれ）。beltGroup のローカル座標で計算
    const dx = -target.s;
    const dz = -target.lateral;
    // 金萬のヨー（kinmanYaw）で beltGroup の回転を打ち消しているので、物体座標は世界の向きに揃っている
    const w = new THREE.Vector3(dx, 0, dz).applyAxisAngle(new THREE.Vector3(0, 1, 0), beltGroup.rotation.y);
    ironState.offset.set(-w.x / (2 * RADIUS), w.z / (2 * RADIUS));
    ironState.rot = (Math.random() - 0.5) * 0.08;
    ironState.wasStamped = target.stamped;
    if (!target.flipped) {
      setStamp(target.obj, { x: ironState.offset.x, y: ironState.offset.y, rot: ironState.rot, strength: target.stamped ? 1.9 : 0.3 });
    }
    target.stamped = true;
    sfx.sizzle(0.45, 0.3);
    puff(at, 6);
    ui.shake(3);
  } else {
    // 空押し: ベルトに焦げ跡
    const sc = scorches[scorchCursor++ % scorches.length];
    sc.visible = true;
    sc.position.x = 0;
    sc.userData.s = 0;
    sfx.thud(1.3);
    sfx.sizzle(0.25, 0.18);
    puff(new THREE.Vector3(0, 0, 0), 4);
  }
}

function finishPress() {
  const c = ironState.contact;
  const target = ironState.target;
  ironState.phase = "rise";
  ironState.t = 0;
  if (mode === "play") judge(target, c);
  else if (target && !target.flipped) target.grade = "極上";
  ironState.target = null;
}

// ---------------------------------------------------------------- 判定
function popAt(it, text, kind) {
  const p = it ? it.obj.getWorldPosition(new THREE.Vector3()) : iron.getWorldPosition(new THREE.Vector3());
  p.y += 0.02;
  const s = stage.toScreen(p);
  ui.pop(text, s.x, s.y - 30, kind);
}
function addScore(points) {
  score += Math.round(points);
  ui.set("score", String(score));
}
function breakCombo() {
  combo = 0;
  ui.set("combo", "-");
}
function judge(it, c) {
  if (!it) {
    tally.空押し++;
    breakCombo();
    sfx.bad();
    popAt(null, "空押し", "bad");
    return;
  }
  it.judged = true;
  if (it.flipped) {
    it.grade = "失敗";
    it.reason = "裏に押した";
    tally.失敗++;
    breakCombo();
    sfx.bad();
    ui.shake(6);
    popAt(it, "裏に押した！", "bad");
    return;
  }
  if (ironState.wasStamped) {
    it.grade = "失敗";
    it.reason = "二度押し";
    tally.失敗++;
    breakCombo();
    sfx.bad();
    popAt(it, "二度押し", "bad");
    recordMade(it);
    return;
  }
  const mm = Math.hypot(ironState.offset.x, ironState.offset.y) * 2 * RADIUS * 1000;
  const pos = mm <= POS_MM.perfect ? 3 : mm <= POS_MM.good ? 2 : mm <= POS_MM.ok ? 1 : 0;
  const str = c < CONTACT.thin ? "thin" : c <= CONTACT.burnt ? "good" : "burnt";
  let grade;
  let reason = "";
  if (str === "burnt") {
    grade = "失敗";
    reason = "焦げ";
  } else if (pos === 0) {
    grade = "失敗";
    reason = "はみ出し";
  } else if (str === "thin") {
    grade = "並";
    reason = "うすい";
  } else grade = pos === 3 ? "極上" : pos === 2 ? "上" : "並";
  it.grade = grade;
  it.reason = reason;
  tally[grade]++;
  recordMade(it);
  if (grade === "極上" || grade === "上") {
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    ui.set("combo", combo >= 2 ? `×${combo}` : "-");
    const mult = 1 + Math.min(combo - 1, 10) * 0.1;
    addScore(POINTS[grade] * mult);
    sfx.good(grade === "極上" ? 3 : 2);
    popAt(it, grade === "極上" ? (combo >= 3 ? `極上！ ${combo}連` : "極上！") : "上", grade === "極上" ? "great" : "good");
    if (grade === "極上") ui.shake(5);
  } else if (grade === "並") {
    addScore(POINTS.並);
    breakCombo();
    sfx.good(0);
    popAt(it, reason ? `並（${reason}）` : "並", "ok");
  } else {
    breakCombo();
    sfx.bad();
    popAt(it, reason === "焦げ" ? "焦げた！" : "はみ出し", "bad");
    if (reason === "焦げ") puff(new THREE.Vector3(it.s, HEIGHT, it.lateral), 10, 1.6);
  }
}
function recordMade(it) {
  made.push({ look: { ...it.look, x: ironState.offset.x, y: ironState.offset.y, rot: ironState.rot, strength: it.reason === "二度押し" ? 1.9 : contactStrength(ironState.contact) }, grade: it.grade });
}

// 押し忘れ・見送りの判定（焼きごてを通り過ぎたとき）
function checkPassed(it) {
  if (it.judged || it.s < RADIUS + 0.012) return;
  it.judged = true;
  if (mode !== "play") return;
  if (it.stamped) return;
  if (it.flipped) {
    tally.見送り++;
    addScore(20);
    sfx.good(1);
    popAt(it, "見送り +20", "ok");
  } else {
    tally.押し忘れ++;
    breakCombo();
    sfx.bad();
    popAt(it, "押し忘れ", "bad");
  }
}

// ---------------------------------------------------------------- 毎フレーム
const tmp = new THREE.Vector3();
function update(dt) {
  tweens.step(dt);
  stepSteam(dt);
  const heat = 0.5 + 0.5 * Math.sin(performance.now() / 180);
  glow.material.opacity = 0.35 + 0.15 * heat;
  hotRim.material.opacity = 0.55 + 0.35 * heat;

  if (mode === "tray") return;

  // 焼きごて
  const st = ironState;
  if (st.phase === "down") {
    st.t += dt;
    const p = clamp01(st.t / 0.07);
    iron.position.y = lerp(IRON_REST, st.hitY, ease.inExpo(p) * 0.7 + p * 0.3);
    if (p >= 1) {
      beginContact();
      if (st.releaseQueued) st.contact = 0.001;
    }
  } else if (st.phase === "hold") {
    st.contact += dt;
    iron.position.y = (st.target ? IRON_HIT : IRON_HIT - HEIGHT) + Math.sin(st.contact * 70) * 0.00015;
    const t = st.target;
    if (t && !t.flipped) {
      const strength = st.wasStamped ? 1.9 : contactStrength(st.contact);
      setStamp(t.obj, { strength });
      t.obj.scale.y = 1 - 0.06 * Math.min(1, st.contact / 0.08);
      if (Math.random() < dt * 14) puff(new THREE.Vector3(t.s, HEIGHT, t.lateral), 1, st.contact > CONTACT.burnt ? 1.8 : 1);
    }
    if (st.contact > CONTACT.burnt && !st.burntSound) {
      st.burntSound = true;
      sfx.sizzle(0.5, 0.22);
    }
    const autoRelease = st.auto ? st.contact > 0.28 : st.contact > CONTACT.auto;
    if (st.releaseQueued || autoRelease) finishPress();
  } else if (st.phase === "rise") {
    st.t += dt;
    const p = clamp01(st.t / 0.14);
    iron.position.y = lerp(st.hitY, IRON_REST, ease.outCubic(p));
    if (p >= 1) {
      st.phase = "up";
      st.burntSound = false;
    }
  }
  updateGauge();

  // ベルト（焼きごてを下ろしている間は止まる）
  const moving = st.phase === "up" || st.phase === "rise";
  if (mode === "play" || mode === "attract") {
    if (mode === "play") {
      elapsed += dt;
      timeLeft = Math.max(0, GAME_TIME - elapsed);
      speed = lerp(0.07, 0.14, clamp01(elapsed / GAME_TIME));
      ui.set("time", String(Math.ceil(timeLeft)));
      ui.music.tempo(timeLeft < 10 ? 1.12 : 1); // 残り10秒で急かす
      if (timeLeft <= 0) endGame();
    }
    if (moving) {
      const ds = speed * dt;
      beltOffset += ds;
      beltTex.offset.x = -beltOffset / 0.012;
      for (const it of items) it.s += ds;
      for (const sc of scorches) if (sc.visible) sc.position.x += ds;
      nextSpawnIn -= ds;
      if (nextSpawnIn <= 0) {
        const r = spawnRange();
        const late = mode === "play" ? clamp01(elapsed / GAME_TIME) : 0;
        const flipped = mode === "play" && elapsed > 7 && Math.random() < 0.16;
        spawn(r.from, flipped);
        const tight = mode === "play" && elapsed > 12 && Math.random() < 0.25;
        nextSpawnIn = tight ? 0.058 + Math.random() * 0.01 : lerp(0.1, 0.075, late) + Math.random() * 0.05;
      }
    }
  }
  const r = spawnRange();
  for (const it of [...items]) {
    it.obj.position.set(it.s, HEIGHT / 2, it.lateral);
    if (!(st.phase === "hold" && st.target === it)) it.obj.scale.y += (1 - it.obj.scale.y) * Math.min(1, dt * 18);
    checkPassed(it);
    if (it.s > r.to) despawn(it);
  }
  for (const sc of scorches) if (sc.visible && sc.position.x > r.to) sc.visible = false;

  // 待機中は自動で押して見せる
  if (mode === "attract" && st.phase === "up") {
    const lead = speed * 0.07;
    if (items.some((it) => !it.stamped && !it.flipped && it.s > -lead - 0.0015 && it.s < -lead + 0.002)) press(true);
  }
}

function updateGauge() {
  const st = ironState;
  const show = mode === "play" && (st.phase === "hold" || st.phase === "down");
  gaugeEl.hidden = !show;
  if (!show) return;
  const p = iron.getWorldPosition(tmp);
  p.y = HEIGHT + 0.012;
  const sp = stage.toScreen(p);
  const off = vertical ? { x: -84, y: 8 } : { x: -96, y: -12 };
  gaugeEl.style.transform = `translate(${sp.x + off.x}px, ${sp.y + off.y}px)`;
  const c = st.phase === "hold" ? st.contact : 0;
  const frac = Math.min(1, c / CONTACT.max);
  gaugeEl.style.setProperty("--p", `${(frac * 100).toFixed(1)}%`);
  const zone = c < CONTACT.thin ? "thin" : c <= CONTACT.burnt ? "good" : "burnt";
  gaugeEl.style.setProperty("--fill", zone === "thin" ? "#8a8078" : zone === "good" ? "#d9a24e" : "#b8321f");
  gaugeLabel.textContent = st.phase === "down" ? "" : zone === "thin" ? "うすい" : zone === "good" ? "ちょうど" : "焦げる！";
}

// ---------------------------------------------------------------- 入力
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  press();
});
addEventListener("pointerup", release);
addEventListener("pointercancel", release);
addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && mode === "play") {
    e.preventDefault();
    if (!e.repeat) press();
  }
});
addEventListener("keyup", (e) => {
  if (e.code === "Space" || e.code === "Enter") release();
});

// ---------------------------------------------------------------- 終了とお盆
const tray = new THREE.Group();
tray.visible = false;
scene.add(tray);
const trayBoard = new THREE.Mesh(
  new THREE.BoxGeometry(0.33, 0.01, 0.2),
  new THREE.MeshStandardMaterial({ color: 0xb07a45, roughness: 0.75 })
);
trayBoard.position.y = -0.005;
trayBoard.receiveShadow = true;
tray.add(trayBoard);
const trayItems = [];

function frameTray(aspect) {
  const v = aspect < 0.9;
  camera.fov = v ? 40 : 30;
  const wantW = v ? 0.24 : 0.42;
  const dist = Math.max(wantW / 2 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect), 0.3);
  const el = 1.05;
  camera.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist + (v ? 0 : 0.015));
  camera.lookAt(0, 0, v ? 0 : 0.012);
  camera.updateProjectionMatrix();
}

async function endGame() {
  if (mode !== "play") return;
  mode = "end";
  release();
  hintEl.hidden = true;
  sfx.whistle();
  ui.music.stop(0.8);
  ui.big("おしまい！", "end");
  await wait(1300);
  showTray();
  await wait(600 + Math.min(made.length, 15) * 90);
  const rank = score >= 3000 ? "伝説の焼き手" : score >= 2200 ? "名人" : score >= 1400 ? "職人" : score >= 700 ? "焼き手" : "見習い";
  const comment =
    tally.極上 >= 15 ? "ほとんど全部が売り物の出来。" : tally.失敗 + tally.押し忘れ > tally.極上 + tally.上 ? "焦らず、輪が金色になるのを待って。" : "いい焼き色です。";
  const detail = `<table>
    <tr><td>極上</td><td>${tally.極上}</td></tr>
    <tr><td>上</td><td>${tally.上}</td></tr>
    <tr><td>並</td><td>${tally.並}</td></tr>
    <tr><td>失敗・押し忘れ</td><td>${tally.失敗 + tally.押し忘れ}</td></tr>
    <tr><td>裏を見送り</td><td>${tally.見送り}</td></tr>
    <tr><td>最大コンボ</td><td>${maxCombo}</td></tr>
  </table>`;
  const next = await ui.result({
    score,
    unit: "点",
    rank,
    comment,
    detail,
    share: `金萬ミニゲーム「焼き印」 ${score}点（極上${tally.極上}個・${rank}）`,
  });
  if (next === "retry") restart();
}

function showTray() {
  mode = "tray";
  beltGroup.visible = false;
  floor.visible = false;
  tray.visible = true;
  for (const t of trayItems) tray.remove(t);
  trayItems.length = 0;
  // 最後に押した 15 個（5×3）を並べる
  const list = made.slice(-15);
  const cols = 5;
  list.forEach((m, i) => {
    const k = kit.make({ look: m.look });
    k.traverse((o) => (o.castShadow = true));
    const c = i % cols;
    const r = Math.floor(i / cols);
    k.position.set((c - (cols - 1) / 2) * 0.058, HEIGHT / 2, (r - 1) * 0.056);
    k.scale.setScalar(0.0001);
    tray.add(k);
    trayItems.push(k);
    setTimeout(() => {
      sfx.tick();
      tweens.add(0.35, (p) => k.scale.setScalar(Math.max(0.0001, ease.outBack(p, 2.2))));
    }, 200 + i * 90);
  });
  frameTray(camera.aspect);
}

async function restart() {
  for (const t of trayItems) tray.remove(t);
  trayItems.length = 0;
  tray.visible = false;
  beltGroup.visible = true;
  floor.visible = true;
  mode = "countdown";
  frame(0, 0, camera.aspect);
  resetRound();
  await ui.countdown();
  startPlay();
}

function startPlay() {
  mode = "play";
  hintEl.hidden = false;
  ui.announce("スタート");
}

// ---------------------------------------------------------------- 起動
(async () => {
  try {
    kit = await loadKinman(stage.renderer);
  } catch (e) {
    console.error(e);
    load.fail();
    return;
  }
  stage.onResize(frame);
  resetRound();
  stage.start(update);
  load.done();
  await ui.start({
    lead: "流れてくる金萬に、焼きごてで「金萬」の焼き印を押そう。",
    rules: [
      "金萬が目印（赤い三角）に来たら、長押しで焼きごてを下ろす",
      "ジュッと鳴って、輪が金色のうちに離す。短いとうすく、長いと焦げる",
      "真ん中に近いほど高得点。「極上」が続くとコンボ",
      "裏返しの金萬には押さずに見送る",
      "30秒勝負。Space キーでも押せます",
    ],
  });
  await restart();
})();
