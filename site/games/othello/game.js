// 金萬オセロ: 石がぜんぶ金萬。焼き印が上なら「表」、底が上なら「裏」。
// どちらも茶色い丸なので見分けにくい、のが売り。盤は番重に和紙を敷いたもの。
import {
  THREE,
  createStage,
  loadKinman,
  randomLook,
  setStamp,
  shadowGround,
  createTweens,
  ease,
  lerp,
  RADIUS,
  HEIGHT,
} from "../shared/kinman.js";
import { createUI, loading, sfx } from "../shared/ui.js";
import { OMOTE, URA, other, initialBoard, flipsOf, canPlace, legalMoves, count, play, cellName } from "./rules.js";
import { chooseStrong, chooseWeak } from "./ai.js";

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get("fast")) || 1); // テスト用: ?fast=8 で演出を早回し
const TEST = params.has("test");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- 寸法（メートル）
const CELL = 0.056;
const BOARD = CELL * 8;
const PAPER = BOARD + 0.022;
const RIM_T = 0.017; // 番重の縁の厚み
const TRAY = PAPER + RIM_T * 2;
const BASE_H = 0.022;
const RIM_H = 0.013; // 紙の上に出る縁の高さ
const PAPER_Y = BASE_H + 0.0006;
const REST_Y = PAPER_Y + HEIGHT / 2;
const DROP_H = 0.13;
// 既定の「少し斜め」。縦長の画面では盤が横幅いっぱいで小さくなるので、少し立てる
const slantElev = () => THREE.MathUtils.degToRad(viewW / viewH < 0.8 ? 58 : 50);
const ELEV_TOP = Math.PI / 2;
let viewW = innerWidth; // キャンバスの大きさ（CSS ピクセル）
let viewH = innerHeight;
// 待機画面（スタート画面の裏で動く絵）の状態
const idle = {
  on: false,
  t: 0,
  next: 1.2,
};

const cellX = (i) => ((i & 7) - 3.5) * CELL;
const cellZ = (i) => ((i >> 3) - 3.5) * CELL;

// ---------------------------------------------------------------- 設定の保存
const PREFS_KEY = "kinman-games:othello:prefs";
const WINS_KEY = "kinman-games:othello:wins";
const readJSON = (k, d) => {
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(k)) ?? {}) };
  } catch {
    return { ...d };
  }
};
const writeJSON = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const prefs = readJSON(PREFS_KEY, { mode: "cpu-weak", side: "omote", mekiki: false, support: false, hints: true, top: false });

// ---------------------------------------------------------------- 画面まわり
const ICON = {
  [OMOTE]:
    '<svg class="ot-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#e6bb85" stroke="#a8743c" stroke-width="1"/><ellipse cx="10" cy="10" rx="3.4" ry="4.8" fill="none" stroke="#8a3b17" stroke-width="1.7"/></svg>',
  [URA]:
    '<svg class="ot-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#c4833c" stroke="#94591f" stroke-width="1"/><circle cx="10" cy="10" r="5.5" fill="#cf924c"/></svg>',
};
const NAME = { [OMOTE]: "表", [URA]: "裏" };

const ui = createUI({
  id: "othello",
  title: "金萬オセロ",
  hud: [
    { key: "omote", label: `${ICON[OMOTE]}表`, value: "2" },
    { key: "ura", label: `${ICON[URA]}裏`, value: "2" },
  ],
  formatBest: (v) => `CPU に通算 ${v} 勝`,
  bestLabel: "これまで",
});
const hudItems = [...document.querySelectorAll(".g-hud-item")];
const hudOf = { [OMOTE]: hudItems[0], [URA]: hudItems[1] };

// 手番の札（上部バーの下）
const turnPill = document.createElement("div");
turnPill.className = "ot-turn";
turnPill.hidden = true;
turnPill.setAttribute("aria-live", "polite");
document.body.append(turnPill);

// 下の切り替えボタン
const controls = document.createElement("div");
controls.className = "g-controls ot-controls";
controls.hidden = true;
const toggles = {
  support: { long: "見分けサポート", short: "目印", key: "M" },
  hints: { long: "置ける場所", short: "ヒント", key: "H" },
  top: { long: "真上から見る", short: "真上", key: "V" },
};
for (const [name, t] of Object.entries(toggles)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "g-btn ot-toggle";
  b.innerHTML = `<span class="ot-dot" aria-hidden="true"></span><span class="ot-long">${t.long}</span><span class="ot-short" aria-hidden="true">${t.short}</span>`;
  b.setAttribute("aria-keyshortcuts", t.key);
  b.title = `${t.long}（${t.key} キー）`;
  b.addEventListener("click", (e) => {
    setPref(name, !prefs[name]);
    sfx.tap();
    if (e.detail > 0) b.blur(); // マウスで押したあとも Enter / Space を盤に使えるように
  });
  t.btn = b;
  controls.append(b);
}
document.body.append(controls);

// ---------------------------------------------------------------- 3D の舞台
const load = loading("盤を支度中…");
const canvas = document.getElementById("view");
const stage = createStage(canvas, { shadows: true, shadowSize: 0.3, exposure: 0.95 });
const { scene, camera } = stage;
stage.lights.key.position.multiplyScalar(3); // 盤が広いので光源を遠くに（落ちてくる石の影も切れないように）
camera.far = 20;
const tweens = createTweens();

/** 経過時間は描画ループで数える（タブが裏に回ると一緒に止まる） */
const after = (sec) => new Promise((res) => tweens.add(sec / SPEED, () => {}, res));

// ---- 木目と和紙はキャンバスで描く
function woodTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#d8b989";
  g.fillRect(0, 0, 1024, 1024);
  for (let k = 0; k < 150; k++) {
    const y0 = Math.random() * 1024;
    const amp = 2 + Math.random() * 7;
    const f = 0.004 + Math.random() * 0.006;
    const ph = Math.random() * 6.28;
    g.strokeStyle = Math.random() < 0.2 ? "rgba(150,100,55,0.35)" : "rgba(170,125,75,0.22)";
    g.lineWidth = 0.6 + Math.random() * 2.4;
    g.beginPath();
    for (let x = 0; x <= 1024; x += 16) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * 0.031 + ph * 2) * 0.8;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  // 細かいざらつき
  const img = g.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
  return t;
}

function paperTexture() {
  const S = 2048;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#f6efe1";
  g.fillRect(0, 0, S, S);
  // 和紙の繊維
  for (let k = 0; k < 2600; k++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * Math.PI;
    const l = 8 + Math.random() * 40;
    g.strokeStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.5)" : "rgba(160,125,85,0.1)";
    g.lineWidth = 0.6 + Math.random() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // マス目（細い線）
  const px = S / PAPER;
  const m = ((PAPER - BOARD) / 2) * px;
  const cs = CELL * px;
  g.strokeStyle = "rgba(96, 58, 30, 0.62)";
  g.lineWidth = 3;
  for (let k = 1; k < 8; k++) {
    g.beginPath();
    g.moveTo(m + k * cs, m);
    g.lineTo(m + k * cs, m + cs * 8);
    g.moveTo(m, m + k * cs);
    g.lineTo(m + cs * 8, m + k * cs);
    g.stroke();
  }
  g.lineWidth = 6;
  g.strokeRect(m, m, cs * 8, cs * 8);
  g.fillStyle = "rgba(96, 58, 30, 0.75)";
  for (const [a, b] of [[2, 2], [2, 6], [6, 2], [6, 6]]) {
    g.beginPath();
    g.arc(m + a * cs, m + b * cs, 9, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
  return t;
}

// ---- 番重（木の盆）と、敷いた和紙
const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.72, metalness: 0 });
woodMat.map.wrapS = woodMat.map.wrapT = THREE.RepeatWrapping;

/** 木目が実寸で貼られる板（木目は長い辺 = X に沿う） */
function woodBox(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const T = 0.32; // テクスチャ 1 枚ぶんの大きさ（メートル）
  // 面の順は +X, -X, +Y, -Y, +Z, -Z。それぞれ (u の長さ, v の長さ)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = geo.attributes.uv;
  const ou = Math.random();
  const ov = Math.random();
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const n = f * 4 + k;
      uv.setXY(n, ou + (uv.getX(n) * dims[f][0]) / T, ov + (uv.getY(n) * dims[f][1]) / T);
    }
  }
  return new THREE.Mesh(geo, woodMat);
}

const tray = new THREE.Group();
{
  const base = woodBox(TRAY, BASE_H, TRAY);
  base.position.y = BASE_H / 2;
  tray.add(base);
  const h = RIM_H + 0.0006;
  for (const s of [-1, 1]) {
    const a = woodBox(TRAY, h, RIM_T);
    a.position.set(0, BASE_H + h / 2, (s * (TRAY - RIM_T)) / 2);
    const b = woodBox(TRAY - RIM_T * 2, h, RIM_T);
    b.rotation.y = Math.PI / 2;
    b.position.set((s * (TRAY - RIM_T)) / 2, BASE_H + h / 2, 0);
    tray.add(a, b);
  }
  tray.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(PAPER, PAPER),
    new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.95, metalness: 0 })
  );
  paper.rotation.x = -Math.PI / 2;
  paper.position.y = PAPER_Y;
  paper.receiveShadow = true;
  tray.add(paper);
}
scene.add(tray, shadowGround(3, 0.22));

// ---- 置ける場所の点・見分けの輪・最後に置いた印・カーソル枠
const flatY = PAPER_Y + 0.0005;
const hintMat = new THREE.MeshBasicMaterial({ color: 0x8a3b17, transparent: true, opacity: 0.5, depthWrite: false });
const hintGeo = new THREE.CircleGeometry(0.0062, 24);
const ringMat = {
  [OMOTE]: new THREE.MeshBasicMaterial({ color: 0xc8321e }),
  [URA]: new THREE.MeshBasicMaterial({ color: 0x264f86 }),
};
const ringR = [RADIUS + 0.0008, RADIUS + 0.0046];
const ringGeo = {
  // 表は切れ目のない輪、裏は点線の輪（色が見分けにくい人にも形でわかるように）
  [OMOTE]: new THREE.RingGeometry(ringR[0], ringR[1], 48),
  [URA]: dashedRing(ringR[0], ringR[1], 8),
};
function dashedRing(r0, r1, n) {
  const parts = [];
  for (let k = 0; k < n; k++) parts.push(new THREE.RingGeometry(r0, r1, 6, 1, (k / n) * Math.PI * 2, (Math.PI * 2) / n * 0.6));
  const pos = [];
  const idx = [];
  for (const p of parts) {
    const off = pos.length / 3;
    pos.push(...p.attributes.position.array);
    for (const v of p.index.array) idx.push(v + off);
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
const lastMat = new THREE.MeshBasicMaterial({ color: 0xc0392b });
const lastMark = new THREE.Mesh(new THREE.CircleGeometry(0.0034, 20), lastMat);
lastMark.rotation.x = -Math.PI / 2;
lastMark.visible = false;
scene.add(lastMark);

const cursorMat = new THREE.MeshBasicMaterial({ color: 0x8a3b17, transparent: true, opacity: 0.9, depthWrite: false });
// 4 分割の輪を 45° 回すと四角い枠になる
const cursor = new THREE.Mesh(new THREE.RingGeometry((CELL / 2 - 0.0024) * Math.SQRT2, (CELL / 2 + 0.0008) * Math.SQRT2, 4, 1, Math.PI / 4), cursorMat);
cursor.rotation.x = -Math.PI / 2;
cursor.position.y = flatY + 0.0002;
cursor.visible = false;
scene.add(cursor);

const cells = [];
for (let i = 0; i < 64; i++) {
  const hint = new THREE.Mesh(hintGeo, hintMat);
  hint.rotation.x = -Math.PI / 2;
  hint.position.set(cellX(i), flatY, cellZ(i));
  hint.visible = false;
  const ring = new THREE.Mesh(ringGeo[OMOTE], ringMat[OMOTE]);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cellX(i), flatY + 0.0001, cellZ(i));
  ring.visible = false;
  scene.add(hint, ring);
  cells.push({ hint, ring, stone: null });
}

// ---------------------------------------------------------------- 石（マスごとに1個、使い回す）
// 表（上面）は淡く、裏（底）は濃い橙色。そのままだと色で見分けがつくので、石の向きに合わせて焼き色を寄せる。
// ふだんは少しだけ、目利きモードではほとんど同じ色になるまで
const FACE_SHADE = {
  normal: { [OMOTE]: [0.97, 0.9, 0.8], [URA]: [1.03, 1.12, 1.45] },
  mekiki: { [OMOTE]: [0.95, 0.85, 0.68], [URA]: [1.05, 1.2, 1.75] },
};
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

let kit = null;
function makeStone(i) {
  const look = randomLook();
  look.strength = 0.62 + Math.random() * 0.26; // 本物より少し控えめ（見分けにくさの下ごしらえ）
  const g = kit.make({ look });
  g.position.set(cellX(i), REST_Y, cellZ(i));
  g.visible = false;
  scene.add(g);
  return {
    i,
    g,
    look,
    face: OMOTE,
    q: new THREE.Quaternion(), // 静止時の向き
    tw: null,
    on: false, // 盤に乗っているか（見た目の上で）
  };
}

function shadeStone(s) {
  const mek = prefs.mekiki && !idle.on;
  const adj = FACE_SHADE[mek ? "mekiki" : "normal"][s.face];
  const sh = s.look.shade;
  setStamp(s.g, {
    strength: mek ? 0.26 + s.look.strength * 0.08 : s.look.strength,
    shade: [sh[0] * adj[0], sh[1] * adj[1], sh[2] * adj[2]],
  });
}

function syncRing(s) {
  const r = cells[s.i].ring;
  r.visible = prefs.support && s.on && !idle.on;
  r.geometry = ringGeo[s.face];
  r.material = ringMat[s.face];
}

/** 向きをすぐに決める（焼き印の傾きは石ごとにばらばら） */
function setFace(s, face) {
  s.face = face;
  s.q.setFromAxisAngle(Y_AXIS, Math.random() * Math.PI * 2);
  if (face === URA) s.q.premultiply(_q.setFromAxisAngle(X_AXIS, Math.PI));
  s.g.quaternion.copy(s.q);
  shadeStone(s);
  syncRing(s);
}

function stopAnim(s) {
  if (s.tw) tweens.cancel(s.tw);
  s.tw = null;
}

/** delay 秒待ってから dur 秒かけて fn(p)。1 本のトゥイーンにまとめて、石ごとに 1 つだけ動かす */
function animate(s, delay, dur, fn, done) {
  stopAnim(s);
  const total = delay + dur;
  let started = false;
  s.tw = tweens.add(
    total,
    (q) => {
      const t = q * total;
      if (t < delay) return;
      const p = Math.min(1, (t - delay) / dur);
      fn(p, !started);
      started = true;
    },
    () => {
      s.tw = null;
      done?.();
    }
  );
}

/** 着地の潰れ（ばねで戻る） */
function squash(s, amount = 0.28) {
  animate(s, 0, 0.55 / SPEED, (p) => {
    const t = p * 0.55;
    const k = amount * Math.exp(-t * 9) * Math.cos(t * 38);
    const sy = 1 - k;
    s.g.scale.set(1 + k * 0.45, sy, 1 + k * 0.45);
    s.g.position.y = PAPER_Y + (HEIGHT / 2) * sy;
  }, () => {
    s.g.scale.set(1, 1, 1);
    s.g.position.y = REST_Y;
  });
}

/** 上から落ちてきてストン */
function dropStone(s, face, delay = 0, { sound = true } = {}) {
  return new Promise((res) => {
    setFace(s, face);
    s.g.scale.set(1, 1, 1);
    s.g.position.y = REST_Y + DROP_H;
    s.g.visible = false;
    animate(
      s,
      delay / SPEED,
      0.26 / SPEED,
      (p, first) => {
        if (first) s.g.visible = true;
        s.g.position.y = REST_Y + DROP_H * (1 - p * p);
        // 落ちながら少しだけ揺れる
        s.g.quaternion.copy(s.q).premultiply(_q.setFromAxisAngle(X_AXIS, (1 - p) * 0.25));
      },
      () => {
        s.g.quaternion.copy(s.q);
        s.on = true;
        syncRing(s);
        refreshCounts();
        if (sound) {
          sfx.thud(1.1);
          ui.shake(2.5);
        }
        squash(s);
        res();
      }
    );
  });
}

/** 置いた場所から離れる向きに、跳ねながら 180° くるっと */
function flipStone(s, from, delay, { sound = true } = {}) {
  return new Promise((res) => {
    const dx = cellX(s.i) - cellX(from);
    const dz = cellZ(s.i) - cellZ(from);
    _axis.set(dz, 0, -dx).normalize();
    if (!Number.isFinite(_axis.x) || _axis.lengthSq() < 0.5) _axis.set(1, 0, 0);
    const axis = _axis.clone();
    const q0 = s.q.clone();
    const to = other(s.face);
    let swapped = false;
    const dur = 0.46 / SPEED;
    animate(
      s,
      delay / SPEED,
      dur,
      (p, first) => {
        if (first && sound) sfx.flip();
        // 少しかがんでから跳ぶ
        const e = ease.inOutCubic(p);
        s.g.quaternion.copy(q0).premultiply(_q.setFromAxisAngle(axis, Math.PI * e));
        s.g.position.y = REST_Y + Math.sin(Math.PI * p) * 0.042 - Math.sin(Math.PI * Math.min(1, p * 5)) * 0.002;
        s.g.scale.setScalar(1 + Math.sin(Math.PI * p) * 0.06);
        if (!swapped && p >= 0.5) {
          swapped = true;
          s.face = to;
          shadeStone(s);
          syncRing(s);
          refreshCounts();
        }
      },
      () => {
        s.q.copy(q0).premultiply(_q.setFromAxisAngle(axis, Math.PI)).normalize();
        s.g.quaternion.copy(s.q);
        squash(s, 0.16);
        res();
      }
    );
  });
}

/** ぴょんと跳ねて消える（盤を片づける） */
function vanishStone(s, delay) {
  return new Promise((res) => {
    if (!s.on && !s.g.visible) return res();
    s.on = false;
    syncRing(s);
    animate(
      s,
      delay / SPEED,
      0.32 / SPEED,
      (p) => {
        s.g.position.y = REST_Y + Math.sin(Math.PI * Math.min(1, p * 1.4)) * 0.03;
        s.g.scale.setScalar(Math.max(0.001, 1 - ease.inExpo(p)));
      },
      () => {
        s.g.visible = false;
        s.g.scale.set(1, 1, 1);
        s.g.position.y = REST_Y;
        res();
      }
    );
  });
}

/** ぽんと出てくる（待機画面） */
function popStone(s, face, delay) {
  setFace(s, face);
  s.g.position.y = REST_Y;
  s.g.scale.setScalar(0.001);
  animate(
    s,
    delay,
    0.4,
    (p, first) => {
      if (first) s.g.visible = true;
      s.g.scale.setScalar(Math.max(0.001, ease.outBack(p)));
    },
    () => {
      s.g.scale.set(1, 1, 1);
      s.on = true;
    }
  );
}

/** その場で小さく跳ねる（終局の波、置けない石をつついたとき） */
function hopStone(s, delay, h = 0.018) {
  animate(
    s,
    delay / SPEED,
    0.32 / SPEED,
    (p) => {
      s.g.position.y = REST_Y + Math.sin(Math.PI * p) * h;
    },
    () => {
      s.g.position.y = REST_Y;
    }
  );
}

let stones = [];

// ---------------------------------------------------------------- 手番・枚数の表示
let shownCount = { [OMOTE]: -1, [URA]: -1 };
function refreshCounts() {
  const n = { [OMOTE]: 0, [URA]: 0 };
  for (const s of stones) if (s.on) n[s.face]++;
  for (const p of [OMOTE, URA]) {
    if (n[p] === shownCount[p]) continue;
    const grew = n[p] > shownCount[p] && shownCount[p] >= 0;
    shownCount[p] = n[p];
    ui.set(p === OMOTE ? "omote" : "ura", String(n[p]));
    if (grew) {
      const it = hudOf[p];
      it.classList.remove("ot-bump");
      void it.offsetWidth;
      it.classList.add("ot-bump");
    }
  }
}

function showTurn(p, text) {
  for (const q of [OMOTE, URA]) hudOf[q].classList.toggle("ot-now", q === p);
  turnPill.innerHTML = p ? `${ICON[p]}<span>${text}</span>` : `<span>${text}</span>`;
  turnPill.hidden = false;
  turnPill.classList.remove("ot-in");
  void turnPill.offsetWidth;
  turnPill.classList.add("ot-in");
  layoutDirty = true;
}

function setPref(name, v) {
  prefs[name] = v;
  writeJSON(PREFS_KEY, prefs);
  syncToggles();
  if (name === "support") for (const s of stones) syncRing(s);
  if (name === "hints") refreshHints();
  if (name === "top") view.elevTarget = v ? ELEV_TOP : slantElev();
  if (name === "support" && v && game) ui.announce("見分けサポートをオンにしました。表は赤い輪、裏は青い点線の輪です");
}
function syncToggles() {
  for (const [name, t] of Object.entries(toggles)) t.btn.setAttribute("aria-pressed", String(!!prefs[name]));
}
syncToggles();

// ---------------------------------------------------------------- カメラ（盤全体が入るように距離と位置を合わせる）
const view = {
  elev: THREE.MathUtils.degToRad(50),
  elevTarget: prefs.top ? ELEV_TOP : slantElev(),
  az: 0,
  zoom: 1, // 1 = 使える範囲いっぱい
  zoomTarget: 1,
};
const corners = [];
// 縁の外側まで入れると盤が小さくなるので、縁の半分くらいまでを画面に収める
const FIT = PAPER / 2 + RIM_T * 0.5;
for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [BASE_H, BASE_H + RIM_H]) corners.push(new THREE.Vector3(x * FIT, y, z * FIT));
const TARGET = new THREE.Vector3(0, PAPER_Y, 0);
const _v = new THREE.Vector3();
let avail = null; // 盤を収める範囲（CSS ピクセル）。目標に向けてなめらかに動かす
let availTarget = { l: 0, t: 0, r: 1, b: 1 };
let layoutDirty = true;

function measureLayout() {
  layoutDirty = false;
  const w = viewW;
  const h = viewH;
  if (idle.on) {
    availTarget = { l: 12, t: 12, r: w - 12, b: h - 12 };
    return;
  }
  // 札は出てくるときに拡大するので、transform の影響を受けない offset で測る
  const topBar = document.querySelector(".g-top").getBoundingClientRect();
  let t = topBar.bottom + 6;
  if (!turnPill.hidden) t = Math.max(t, turnPill.offsetTop + turnPill.offsetHeight + 10);
  const side = w < 640 ? 10 : 24;
  let b = h - 12;
  let r = w - side;
  // 切り替えボタンは下に横並び（背の低い横長の画面では右に縦並び）
  if (!controls.hidden) {
    if (controls.offsetLeft > w / 2) r = controls.offsetLeft - 10;
    else b = controls.offsetTop - 10;
  }
  availTarget = { l: side, t, r, b };
}

function bbox(dist, dir) {
  camera.position.copy(TARGET).addScaledVector(dir, dist);
  camera.lookAt(TARGET);
  camera.updateMatrixWorld();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of corners) {
    _v.copy(c).project(camera);
    const x = ((_v.x + 1) / 2) * viewW;
    const y = ((1 - _v.y) / 2) * viewH;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

const _dir = new THREE.Vector3();
function placeCamera(k) {
  if (layoutDirty) measureLayout();
  if (!avail || k >= 1) avail = { ...availTarget };
  else for (const key in avail) avail[key] = lerp(avail[key], availTarget[key], k);
  const { elev, az } = view;
  _dir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
  camera.up.set(-Math.sin(elev) * Math.sin(az), Math.cos(elev), -Math.sin(elev) * Math.cos(az));
  camera.clearViewOffset();
  const aw = (avail.r - avail.l) * view.zoom;
  const ah = (avail.b - avail.t) * view.zoom;
  let lo = 0.2;
  let hi = 8;
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2;
    const bb = bbox(mid, _dir);
    if (bb.x1 - bb.x0 <= aw && bb.y1 - bb.y0 <= ah) hi = mid;
    else lo = mid;
  }
  const bb = bbox(hi, _dir);
  // 盤の中心を、使える範囲の中心に寄せる
  const ox = (bb.x0 + bb.x1) / 2 - (avail.l + avail.r) / 2;
  const oy = (bb.y0 + bb.y1) / 2 - (avail.t + avail.b) / 2;
  camera.setViewOffset(viewW, viewH, ox, oy, viewW, viewH);
}

stage.onResize((w, h) => {
  viewW = w || innerWidth;
  viewH = h || innerHeight;
  layoutDirty = true;
  avail = null; // 大きさが変わったときはすぐ合わせる
  if (!idle.on && !prefs.top) view.elevTarget = slantElev();
});

// ---------------------------------------------------------------- 待機画面（スタート画面の裏で動く絵）

function idleBoard() {
  // 適当な中盤の局面を作る
  const b = initialBoard();
  let p = OMOTE;
  const n = 22 + Math.floor(Math.random() * 12);
  for (let k = 0; k < n; k++) {
    const m = chooseWeak(b, p);
    if (m < 0) {
      p = other(p);
      continue;
    }
    play(b, m, p);
    p = other(p);
  }
  return b;
}

async function enterIdle() {
  idle.on = true;
  idle.t = 0;
  idle.next = 1.4;
  controls.hidden = true;
  turnPill.hidden = true;
  cursor.visible = false;
  lastMark.visible = false;
  for (const c of cells) c.hint.visible = false;
  for (const q of [OMOTE, URA]) hudOf[q].classList.remove("ot-now");
  layoutDirty = true;
  view.zoomTarget = 1.12;
  const b = idleBoard();
  const had = stones.some((s) => s.on);
  if (had) {
    await Promise.all(stones.map((s) => vanishStone(s, Math.random() * 0.2)));
  }
  shownCount = { [OMOTE]: -1, [URA]: -1 };
  for (const s of stones) {
    if (b[s.i]) popStone(s, b[s.i], 0.05 + ((s.i >> 3) + (s.i & 7)) * 0.025);
    else {
      stopAnim(s);
      s.on = false;
      s.g.visible = false;
    }
    syncRing(s);
  }
  // HUD は待機中も「表 n / 裏 m」を出しておく
  const c = count(b);
  ui.set("omote", String(c.omote));
  ui.set("ura", String(c.ura));
}

function stepIdle(dt, t) {
  view.az = Math.sin(t * 0.13) * 0.42;
  view.elevTarget = slantElev() - 0.12 + Math.sin(t * 0.21) * 0.05;
  idle.t += dt;
  if (idle.t < idle.next) return;
  idle.t = 0;
  idle.next = 0.7 + Math.random() * 0.9;
  // ときどき 1〜3 枚が並んでくるっと
  const on = stones.filter((s) => s.on && !s.tw);
  if (!on.length) return;
  const s0 = on[Math.floor(Math.random() * on.length)];
  const n = 1 + Math.floor(Math.random() * 3);
  const dr = Math.floor(Math.random() * 3) - 1;
  const dc = dr === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.floor(Math.random() * 3) - 1;
  // 並びの手前（仮想の「置いた場所」）から離れる向きに返す
  const from = ((s0.i >> 3) - dr) * 8 + ((s0.i & 7) - dc);
  let r = s0.i >> 3;
  let c = s0.i & 7;
  for (let k = 0; k < n && r >= 0 && r < 8 && c >= 0 && c < 8; k++, r += dr, c += dc) {
    const s = stones[r * 8 + c];
    if (!s.on || s.tw) break;
    flipStone(s, from, k * 0.09, { sound: false });
  }
}

// ---------------------------------------------------------------- 対局
let game = null; // { board, turn, mode, human: Set, cpuLevel, waiting, lastMove, flipsTotal }
let inputResolve = null;
let cursorCell = 27;
let cursorBy = null; // "key" | "mouse" | null

function isHumanTurn() {
  return !!(game && inputResolve && game.human.has(game.turn));
}

function refreshHints() {
  const show = prefs.hints && isHumanTurn();
  for (let i = 0; i < 64; i++) cells[i].hint.visible = show && canPlace(game.board, i, game.turn);
}

function refreshCursor() {
  const show = isHumanTurn() && cursorBy !== null;
  cursor.visible = show;
  if (!show) return;
  cursor.position.x = cellX(cursorCell);
  cursor.position.z = cellZ(cursorCell);
  const ok = canPlace(game.board, cursorCell, game.turn);
  cursorMat.color.set(ok ? 0x8a3b17 : 0x8f7f70);
}

function waitHuman() {
  return new Promise((res) => {
    inputResolve = res;
    refreshHints();
    refreshCursor();
  });
}

/** 判定の文字。画面の端や上の札にかからないように寄せる */
function popAt(text, x, y, kind) {
  const half = Math.min(viewW / 2 - 8, text.length * 22 + 10);
  const top = turnPill.hidden ? 60 : turnPill.getBoundingClientRect().bottom + 30;
  ui.pop(text, Math.min(viewW - half, Math.max(half, x)), Math.max(top, y), kind);
}

function tryPlace(i) {
  if (!isHumanTurn()) return;
  if (canPlace(game.board, i, game.turn)) {
    const r = inputResolve;
    inputResolve = null;
    for (const c of cells) c.hint.visible = false;
    cursor.visible = false;
    r(i);
    return;
  }
  // 置けないところ。石があればつつかれて跳ねるだけ（表か裏かは教えない）
  const s = stones[i];
  if (s.on) {
    hopStone(s, 0, 0.012);
    sfx.tick();
  } else {
    sfx.bad();
    const p = stage.toScreen(new THREE.Vector3(cellX(i), REST_Y, cellZ(i)));
    popAt("置けません", p.x, p.y - 20, "bad");
  }
}

let worker = null;
let workerReq = 0;
try {
  worker = new Worker(new URL("./ai.js", import.meta.url), { type: "module" });
  worker.addEventListener("error", () => (worker = null));
} catch {
  worker = null;
}

function thinkStrong(board, p) {
  if (!worker) return Promise.resolve(chooseStrong(board, p));
  const id = ++workerReq;
  return new Promise((res) => {
    const fallback = setTimeout(() => {
      worker?.removeEventListener("message", on);
      res(chooseStrong(board, p));
    }, 4000);
    const on = (e) => {
      if (e.data.id !== id) return;
      clearTimeout(fallback);
      worker.removeEventListener("message", on);
      res(e.data.move);
    };
    worker.addEventListener("message", on);
    worker.postMessage({ id, board: Array.from(board), p, depth: 4 });
  });
}

async function cpuMove() {
  const b = game.board;
  const p = game.turn;
  const t0 = performance.now();
  const move = game.cpuLevel === "strong" ? await thinkStrong(b, p) : chooseWeak(b, p);
  // すぐ打つと味気ないので、少し考えるふりをする
  const spent = (performance.now() - t0) / 1000;
  const want = (game.cpuLevel === "strong" ? 0.75 : 0.55) + Math.random() * 0.45;
  if (want - spent > 0) await after(want - spent);
  return move;
}

async function doMove(i, p) {
  const flips = flipsOf(game.board, i, p);
  play(game.board, i, p);
  game.lastMove = i;
  lastMark.visible = false;
  const s = stones[i];
  sfx.whoosh(false);
  await dropStone(s, p);
  lastMark.position.set(cellX(i) - CELL * 0.37, flatY + 0.0002, cellZ(i) - CELL * 0.37);
  lastMark.visible = true;

  // 近い順に時間差で
  const dist = (j) => Math.max(Math.abs((j & 7) - (i & 7)), Math.abs((j >> 3) - (i >> 3)));
  const jobs = flips.map((j) => flipStone(stones[j], i, 0.05 + (dist(j) - 1) * 0.085));
  const wp = stage.toScreen(new THREE.Vector3(cellX(i), REST_Y + 0.03, cellZ(i)));
  const corner = i === 0 || i === 7 || i === 56 || i === 63;
  if (flips.length >= 3 || corner) {
    await after(0.12);
    const big = flips.length >= 6;
    if (flips.length >= 3) {
      popAt(`${flips.length}枚返し！`, wp.x, wp.y - 30, big ? "great" : "good");
      sfx.good(big ? 3 : flips.length >= 4 ? 2 : 1);
      if (big) ui.shake(7);
    }
    if (corner) {
      await after(flips.length >= 3 ? 0.25 : 0);
      popAt("角！", wp.x + (flips.length >= 3 ? 40 : 0), wp.y + 14, "great");
      if (flips.length < 3) sfx.good(2);
    }
  }
  await Promise.all(jobs);
  ui.announce(`${NAME[p]}が ${cellName(i)} に置いて ${flips.length} 枚返しました`);
}

function turnText(p) {
  if (game.mode === "pvp") return `${NAME[p]}の番`;
  return game.human.has(p) ? `あなたの番（${NAME[p]}）` : `CPU の番（${NAME[p]}）`;
}

async function playGame(cfg) {
  const human = new Set();
  if (cfg.mode === "pvp") human.add(OMOTE).add(URA);
  else human.add(cfg.side === "ura" ? URA : OMOTE);
  game = {
    board: initialBoard(),
    turn: OMOTE,
    mode: cfg.mode,
    human,
    cpuLevel: cfg.mode === "cpu-strong" ? "strong" : "weak",
    lastMove: -1,
  };
  if (TEST) window.__ot.game = game;
  idle.on = false;
  view.zoomTarget = 1;
  view.az = 0;
  view.elevTarget = prefs.top ? ELEV_TOP : slantElev();
  controls.hidden = false;
  layoutDirty = true;

  // 片づけてから、はじめの 4 枚を落とす
  await Promise.all(stones.map((s) => vanishStone(s, Math.random() * 0.18)));
  for (const s of stones) shadeStone(s);
  shownCount = { [OMOTE]: -1, [URA]: -1 };
  refreshCounts();
  showTurn(OMOTE, turnText(OMOTE));
  await after(0.15);
  const b = game.board;
  let k = 0;
  const drops = [];
  for (const i of [27, 28, 35, 36]) drops.push(dropStone(stones[i], b[i], k++ * 0.14, { sound: true }));
  await Promise.all(drops);
  ui.big("よろしくお願いします", "end ot-small");
  sfx.taiko(1.1);
  await after(0.7);

  while (true) {
    const p = game.turn;
    const moves = legalMoves(game.board, p);
    if (!moves.length) {
      if (!legalMoves(game.board, other(p)).length) break;
      const who = game.mode === "pvp" ? NAME[p] : human.has(p) ? "あなた" : "CPU ";
      showTurn(p, `${who}はパス（置ける場所なし）`);
      ui.big("パス", "end");
      sfx.whoosh(true);
      ui.announce(`${NAME[p]}は置ける場所がないのでパス`);
      await after(1.1);
      game.turn = other(p);
      continue;
    }
    showTurn(p, turnText(p));
    let move;
    if (human.has(p)) {
      if (cursorBy === "key" && !canPlace(game.board, cursorCell, p)) cursorCell = nearestMove(cursorCell, moves);
      move = await waitHuman();
    } else {
      turnPill.classList.add("ot-thinking");
      move = await cpuMove();
      turnPill.classList.remove("ot-thinking");
    }
    turnPill.classList.add("ot-busy");
    await doMove(move, p);
    turnPill.classList.remove("ot-busy");
    game.turn = other(p);
  }

  // 終局
  turnPill.hidden = true;
  for (const q of [OMOTE, URA]) hudOf[q].classList.remove("ot-now");
  layoutDirty = true;
  ui.music.stop(1.2);
  ui.big("終局", "end");
  sfx.taiko(0.9);
  // 盤の真ん中から波のように跳ねる
  for (const s of stones) {
    if (!s.on) continue;
    const d = Math.hypot((s.i & 7) - 3.5, (s.i >> 3) - 3.5);
    hopStone(s, 0.2 + d * 0.07, 0.022);
  }
  await after(1.5);
  return finish();
}

function nearestMove(from, moves) {
  let best = moves[0];
  let bd = Infinity;
  for (const m of moves) {
    const d = Math.hypot((m & 7) - (from & 7), (m >> 3) - (from >> 3));
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

async function finish() {
  const c = count(game.board);
  const winner = c.omote > c.ura ? OMOTE : c.ura > c.omote ? URA : 0;
  const mek = prefs.mekiki ? "（目利きモード）" : "";
  if (game.mode === "pvp") {
    const rank = winner ? `${NAME[winner]}の勝ち` : "引き分け";
    return ui.result({
      score: `${c.omote}<small class="ot-vs">対</small>${c.ura}`,
      label: "表 対 裏",
      rank,
      comment: winner ? "茶色い丸を、最後まで見分けきりました。" : "表と裏、きれいに半分こ。",
      detail: detailTable(c),
      share: `金萬オセロ 2人対戦${mek}、表 ${c.omote} 対 裏 ${c.ura} で${winner ? `${NAME[winner]}の勝ち` : "引き分け"}。表と裏、見分けられますか。`,
      bestValue: null,
    });
  }
  const me = [...game.human][0];
  const mine = me === OMOTE ? c.omote : c.ura;
  const cpu = me === OMOTE ? c.ura : c.omote;
  const level = game.cpuLevel === "strong" ? "つよい" : "よわい";
  const wins = readJSON(WINS_KEY, { weak: 0, strong: 0 });
  const won = winner === me;
  if (won) {
    wins[game.cpuLevel]++;
    writeJSON(WINS_KEY, wins);
  }
  const total = wins.weak + wins.strong;
  const diff = mine - cpu;
  const rank = won ? (prefs.mekiki ? "目利きの勝ち" : "勝ち") : winner === 0 ? "引き分け" : "負け";
  const comment = won
    ? diff >= 20
      ? "焼き印のあるなしを見抜く目、お見事です。"
      : "表も裏も、ちゃんと見えていました。"
    : winner === 0
      ? "表と裏、仲よく半分こ。"
      : "どれが自分の石だったか、もう一度じっくり。";
  return ui.result({
    score: mine,
    unit: `枚 / CPU ${cpu}枚`,
    label: `あなた（${NAME[me]}）`,
    rank,
    comment,
    detail: `${detailTable(c)}<p class="ot-wins">CPU に勝った回数　よわい ${wins.weak} 勝・つよい ${wins.strong} 勝</p>`,
    share: `金萬オセロで CPU（${level}）${mek}に ${mine} 対 ${cpu} で${won ? "勝ちました" : winner === 0 ? "引き分けました" : "負けました"}。表と裏、見分けられますか。`,
    bestValue: total > 0 ? total : null,
    newBestText: `通算 ${total} 勝目！`,
  });
}

function detailTable(c) {
  return `<table><tr><td>${ICON[OMOTE]} 表</td><td>${c.omote} 枚</td></tr><tr><td>${ICON[URA]} 裏</td><td>${c.ura} 枚</td></tr></table>`;
}

// ---------------------------------------------------------------- 入力
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(PAPER_Y + HEIGHT / 2));
const _hit = new THREE.Vector3();
function cellAt(x, y) {
  const r = stage.ray(x, y);
  if (!r.ray.intersectPlane(plane, _hit)) return -1;
  const c = Math.floor(_hit.x / CELL + 4);
  const row = Math.floor(_hit.z / CELL + 4);
  if (c < 0 || c > 7 || row < 0 || row > 7) return -1;
  return row * 8 + c;
}

let down = null;
canvas.addEventListener("pointerdown", (e) => {
  down = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
canvas.addEventListener("pointerup", (e) => {
  if (!down || down.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 14) return;
  const rect = canvas.getBoundingClientRect();
  const i = cellAt(e.clientX - rect.left, e.clientY - rect.top);
  if (i < 0) return;
  if (e.pointerType !== "mouse") cursorBy = null;
  cursorCell = i;
  tryPlace(i);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || !game) return;
  const rect = canvas.getBoundingClientRect();
  const i = cellAt(e.clientX - rect.left, e.clientY - rect.top);
  if (i < 0) {
    if (cursorBy === "mouse") cursorBy = null;
  } else {
    cursorBy = "mouse";
    cursorCell = i;
  }
  refreshCursor();
  canvas.style.cursor = i >= 0 && isHumanTurn() && canPlace(game.board, i, game.turn) ? "pointer" : "";
});
canvas.addEventListener("pointerleave", () => {
  if (cursorBy === "mouse") cursorBy = null;
  refreshCursor();
});

addEventListener("keydown", (e) => {
  if (!ui.overlay.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const onButton = e.target instanceof HTMLElement && e.target.closest("button, a, input");
  if (k === "m" || k === "M") return setPref("support", !prefs.support);
  if (k === "h" || k === "H") return setPref("hints", !prefs.hints);
  if (k === "v" || k === "V") return setPref("top", !prefs.top);
  if (!game || !isHumanTurn()) return;
  const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (mv) {
    e.preventDefault();
    if (cursorBy === null) cursorBy = "key";
    else {
      cursorBy = "key";
      const c = Math.min(7, Math.max(0, (cursorCell & 7) + mv[0]));
      const r = Math.min(7, Math.max(0, (cursorCell >> 3) + mv[1]));
      cursorCell = r * 8 + c;
    }
    sfx.tick();
    refreshCursor();
    ui.announce(`${cellName(cursorCell)}${canPlace(game.board, cursorCell, game.turn) ? "（置けます）" : ""}`);
    return;
  }
  if ((k === "Enter" || k === " ") && !onButton) {
    e.preventDefault();
    if (cursorBy === null) {
      cursorBy = "key";
      cursorCell = nearestMove(cursorCell, legalMoves(game.board, game.turn));
      refreshCursor();
      return;
    }
    tryPlace(cursorCell);
  }
});

// ---------------------------------------------------------------- 毎フレーム
function frame(dt, t) {
  tweens.step(dt * SPEED);
  if (idle.on) stepIdle(dt, t);
  const k = 1 - Math.exp(-dt * (reduceMotion ? 30 : 5));
  view.elev = lerp(view.elev, view.elevTarget, k);
  view.zoom = lerp(view.zoom, view.zoomTarget, k);
  if (!idle.on) view.az = lerp(view.az, 0, k);
  placeCamera(k);
  hintMat.opacity = 0.42 + Math.sin(t * 4) * 0.14;
  cursorMat.opacity = 0.75 + Math.sin(t * 6) * 0.2;
}

// ---------------------------------------------------------------- スタート画面
function startExtra() {
  const radio = (name, value, label, checked) =>
    `<label class="g-option"><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  return `
    <fieldset class="g-options ot-side" data-side>
      <legend>CPU 戦のあなたの石</legend>
      <div class="ot-row">
        ${radio("ot-side", "omote", `${ICON[OMOTE]} 先手・表`, prefs.side !== "ura")}
        ${radio("ot-side", "ura", `${ICON[URA]} 後手・裏`, prefs.side === "ura")}
      </div>
    </fieldset>
    <label class="g-option ot-check"><input type="checkbox" name="ot-mekiki" ${prefs.mekiki ? "checked" : ""}><span>目利きモード</span><small>焼き印が薄くなり、表と裏の焼き色も近づく</small></label>`;
}

async function startScreen() {
  const p = ui.start({
    lead: "石はぜんぶ金萬。焼き印が上なら<strong>表</strong>、底が上なら<strong>裏</strong>。どっちも茶色い丸です。よく見て打ってください。",
    rules: [
      "はさむと、くるっと返って自分の石に",
      "置ける場所には小さな点。置けなければパス",
      "枚数は上の数字でわかります。多いほうが勝ち",
      '<span class="ot-kbd">矢印キーで選んで Enter で置く。M 目印・H ヒント・V 真上</span>',
    ],
    options: [
      { value: "cpu-weak", label: "CPU<br>よわい", checked: prefs.mode === "cpu-weak" },
      { value: "cpu-strong", label: "CPU<br>つよい", checked: prefs.mode === "cpu-strong" },
      { value: "pvp", label: "2人で<br><small>交代で</small>", checked: prefs.mode === "pvp" },
    ],
    optionLabel: "あそびかた",
    extra: startExtra(),
    button: "対局をはじめる",
  });
  // 2人のときは先手・後手の選択を薄くする
  const o = ui.overlay;
  const side = o.querySelector("[data-side]");
  const syncSide = () => {
    const pvp = o.querySelector('input[name="g-opt"]:checked')?.value === "pvp";
    side.disabled = pvp;
    side.classList.toggle("ot-off", pvp);
  };
  o.querySelectorAll('input[name="g-opt"]').forEach((r) => r.addEventListener("change", syncSide));
  syncSide();
  const mode = await p;
  prefs.mode = mode ?? "cpu-weak";
  prefs.side = o.querySelector('input[name="ot-side"]:checked')?.value ?? "omote";
  prefs.mekiki = !!o.querySelector('input[name="ot-mekiki"]')?.checked;
  writeJSON(PREFS_KEY, prefs);
  return { mode: prefs.mode, side: prefs.side };
}

// ---------------------------------------------------------------- はじまり
async function main() {
  try {
    kit = await loadKinman(stage.renderer);
  } catch (err) {
    console.warn(err);
    load.fail("読み込みに失敗しました。再読み込みしてください");
    return;
  }
  stones = Array.from({ length: 64 }, (_, i) => makeStone(i));
  if (TEST) {
    window.__ot = {
      game: null,
      prefs,
      stones,
      /** マス i の画面上の位置（CSS ピクセル） */
      cellScreen: (i) => stage.toScreen(new THREE.Vector3(cellX(i), REST_Y, cellZ(i))),
      canPlace: (i) => !!(game && canPlace(game.board, i, game.turn)),
      waiting: () => isHumanTurn(),
      legal: () => (game ? legalMoves(game.board, game.turn) : []),
      setPref,
      idle,
      view,
      /** 見た目の確認用: 待機を止めて、今の設定で色を塗り直す */
      freeze() {
        idle.on = false;
        view.zoomTarget = 1;
        for (const s of stones) {
          stopAnim(s);
          s.g.quaternion.copy(s.q);
          s.g.position.y = REST_Y;
          s.g.scale.set(1, 1, 1);
          shadeStone(s);
          syncRing(s);
        }
      },
    };
  }
  stage.start(frame);
  await enterIdle();
  load.done();
  while (true) {
    const cfg = await startScreen();
    sfx.unlock();
    const next = await playGame(cfg);
    game = null;
    if (next !== "retry") break;
    await enterIdle();
  }
}
main();
