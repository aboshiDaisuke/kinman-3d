// 金萬のメッシュを平面で2つに切る。切り口は凸包でふさぎ、断面の色（皮・カステラ生地・白あん）はシェーダーで塗る。
// 金萬は凸な形なので、平面との交わりは1つの凸多角形になる（交点の凸包でふさげる）。
import { THREE } from "../shared/kinman.js";

const ATTRS = ["position", "normal", "uv", "tangent"];

/**
 * geometry（インデックス付き）を plane で切る。どちらも geometry と同じ座標のまま返す。
 * 戻り値: { neg, pos, points }  neg は plane の負の側（distance < 0）、points は切り口の交点
 */
export function sliceGeometry(geometry, plane) {
  const src = {};
  for (const k of ATTRS) if (geometry.attributes[k]) src[k] = geometry.attributes[k];
  const index = geometry.index;
  const pos = src.position;
  const nv = pos.count;
  const dist = new Float32Array(nv);
  const v = new THREE.Vector3();
  for (let i = 0; i < nv; i++) dist[i] = plane.distanceToPoint(v.fromBufferAttribute(pos, i));

  const out = { neg: newBuf(src), pos: newBuf(src) };
  const points = [];
  const triCount = index ? index.count / 3 : nv / 3;
  const ids = [0, 0, 0];
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) ids[k] = index ? index.getX(t * 3 + k) : t * 3 + k;
    const d0 = dist[ids[0]];
    const d1 = dist[ids[1]];
    const d2 = dist[ids[2]];
    if (d0 <= 0 && d1 <= 0 && d2 <= 0) {
      pushTri(out.neg, src, ids.map((i) => vtx(src, i)));
      continue;
    }
    if (d0 >= 0 && d1 >= 0 && d2 >= 0) {
      pushTri(out.pos, src, ids.map((i) => vtx(src, i)));
      continue;
    }
    // 平面をまたぐ三角形: 1つだけ反対側にある頂点 lone を見つけて、3つに割る
    const ds = [d0, d1, d2];
    const neg = ds.map((d) => d < 0);
    const nNeg = neg.filter(Boolean).length;
    const loneIdx = nNeg === 1 ? neg.indexOf(true) : neg.indexOf(false);
    const a = ids[loneIdx];
    const b = ids[(loneIdx + 1) % 3];
    const c = ids[(loneIdx + 2) % 3];
    const va = vtx(src, a);
    const vb = vtx(src, b);
    const vc = vtx(src, c);
    const pab = lerpVtx(va, vb, dist[a] / (dist[a] - dist[b]));
    const pac = lerpVtx(va, vc, dist[a] / (dist[a] - dist[c]));
    points.push(pab.position, pac.position);
    const loneSide = dist[a] < 0 ? out.neg : out.pos;
    const otherSide = dist[a] < 0 ? out.pos : out.neg;
    // 頂点の並び（表裏）を保つ
    pushTri(loneSide, src, [va, pab, pac]);
    pushTri(otherSide, src, [pab, vb, vc]);
    pushTri(otherSide, src, [pab, vc, pac]);
  }
  return { neg: toGeometry(out.neg), pos: toGeometry(out.pos), points };
}

function newBuf(src) {
  const b = {};
  for (const k of Object.keys(src)) b[k] = [];
  return b;
}
function vtx(src, i) {
  const o = {};
  for (const k of Object.keys(src)) {
    const a = src[k];
    o[k] = Array.from({ length: a.itemSize }, (_, j) => a.getComponent(i, j));
  }
  o.position = new THREE.Vector3(o.position[0], o.position[1], o.position[2]);
  return o;
}
function lerpVtx(p, q, t) {
  const o = {};
  for (const k of Object.keys(p)) {
    if (k === "position") o.position = p.position.clone().lerp(q.position, t);
    else if (k === "tangent") o[k] = [0, 1, 2].map((j) => p[k][j] + (q[k][j] - p[k][j]) * t).concat([p[k][3]]);
    else o[k] = p[k].map((x, j) => x + (q[k][j] - x) * t);
  }
  if (o.normal) {
    const n = new THREE.Vector3(...o.normal).normalize();
    o.normal = [n.x, n.y, n.z];
  }
  return o;
}
function pushTri(buf, src, vs) {
  for (const vx of vs)
    for (const k of Object.keys(src)) {
      if (k === "position") buf.position.push(vx.position.x, vx.position.y, vx.position.z);
      else buf[k].push(...vx[k]);
    }
}
function toGeometry(buf) {
  const g = new THREE.BufferGeometry();
  const size = { position: 3, normal: 3, uv: 2, tangent: 4 };
  for (const k of Object.keys(buf)) g.setAttribute(k, new THREE.Float32BufferAttribute(buf[k], size[k]));
  g.computeBoundingSphere();
  return g;
}

/**
 * 切り口のふた。points（平面上の交点）の凸包を扇形に三角形分割する。
 * normal はふたの表が向く方向（切った片の外側）。
 */
export function capGeometry(points, plane, normal) {
  if (points.length < 3) return null;
  // 平面上の 2D 座標系（e1 は水平、e2 は e1 と平面の法線に直交）
  const n = plane.normal.clone();
  const e1 = new THREE.Vector3(0, 1, 0).cross(n);
  if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0);
  e1.normalize();
  const e2 = n.clone().cross(e1).normalize();
  const o = points[0];
  const p2 = points.map((p) => {
    const d = p.clone().sub(o);
    return { x: d.dot(e1), y: d.dot(e2), p };
  });
  const hull = convexHull(p2);
  if (hull.length < 3) return null;
  const c = new THREE.Vector3();
  for (const h of hull) c.add(h.p);
  c.divideScalar(hull.length);
  const verts = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i].p;
    const b = hull[(i + 1) % hull.length].p;
    // 表が normal を向くよう並びを決める
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    if (face.dot(normal) >= 0) verts.push(a, b, c);
    else verts.push(a, c, b);
  }
  const g = new THREE.BufferGeometry().setFromPoints(verts);
  const nrm = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) nrm.set([normal.x, normal.y, normal.z], i * 3);
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// ---------------------------------------------------------------- 断面のマテリアル
// 位置（GLB の座標: 底面の中心が原点、m）から、皮・カステラ生地・白あんを塗り分ける。
// 白あんの形は blender/kinman_shape.py と同じ超楕円体（半径 2.17cm、高さ 1.2〜14.9mm、n=5）
export function cutMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCutPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCutPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vCutPos;
float cutHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float cutNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cutHash(i), cutHash(i + vec3(1,0,0)), f.x), mix(cutHash(i + vec3(0,1,0)), cutHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cutHash(i + vec3(0,0,1)), cutHash(i + vec3(1,0,1)), f.x), mix(cutHash(i + vec3(0,1,1)), cutHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  vec3 p = vCutPos;
  float r = length(p.xz);
  float y = p.y;
  // 白あん（超楕円体）
  float X = r / 0.0217;
  float Y = (y - 0.00805) / 0.00685;
  float rho = pow(pow(abs(X), 5.0) + pow(abs(Y), 5.0), 0.2);
  float wob = 0.02 * sin(atan(p.z, p.x) * 3.0 + y * 400.0);
  float anMask = 1.0 - smoothstep(0.985, 1.015, rho + wob);
  // 外側の皮: 外形までの距離（側面・上面・底面のいちばん近いもの）
  float topY = 0.0162 + 0.00022 * (1.0 - min(1.0, (r * r) / (0.021 * 0.021)));
  float edge = min(0.02305 - r, min(topY - y, y));
  float crust = 1.0 - smoothstep(0.0004, 0.0011, edge);
  // カステラ生地の気泡・白あんのざらつき
  float n1 = cutNoise(p * 3200.0);
  float n2 = cutNoise(p * 900.0);
  // テクスチャの色より少し差をつける（光が当たると白あんとカステラ生地が同じ色に見えるため）
  vec3 castella = vec3(0.93, 0.56, 0.16) * (0.86 + 0.2 * n1) * (0.95 + 0.08 * n2);
  vec3 bean = vec3(0.86, 0.76, 0.56) * (0.97 + 0.05 * n2) * (0.985 + 0.03 * n1);
  vec3 crustC = vec3(0.46, 0.15, 0.035) * (0.9 + 0.2 * n2);
  vec3 col = mix(castella, bean, anMask);
  col = mix(col, crustC, crust);
  diffuseColor.rgb = col;
}`
      );
  };
  m.customProgramCacheKey = () => "kinman-cut-v1";
  return m;
}
