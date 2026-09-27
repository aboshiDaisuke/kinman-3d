// ミニゲーム共通: 3D の舞台と、金萬のモデル・マテリアル。
//
//   const stage = createStage(canvas, { shadows: true });
//   const kit = await loadKinman(stage.renderer);
//   const k = kit.make({ look: randomLook() });   // 中心が原点の Group
//   stage.scene.add(k);
//   stage.start((dt, t) => { ... });
//
// 焼き印はテクスチャに焼き込まず、シェーダーで上面に押している。
// setStamp(k, { x, y, rot, strength }) で位置・傾き・濃さ（0 で焼き印なし、1 を超えると焦げ）を変えられる。
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export { THREE };

// モデルは実寸（メートル）。直径 4.6cm、厚さ 1.65cm。GLB の原点は底面の中心
export const RADIUS = 0.023;
export const HEIGHT = 0.0165;
export const HALF_CENTROID = (4 * RADIUS) / (3 * Math.PI); // 半円の重心までの距離

const MODEL_URL = new URL("../../models/kinman.glb", import.meta.url).href;
const HDR_URL = new URL("../../env/studio.hdr", import.meta.url).href;
const asset = (name) => new URL(`../assets/${name}`, import.meta.url).href;

// ---------------------------------------------------------------- 舞台
export function createStage(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 0.95;
  if (opts.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
  }

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  new RGBELoader().load(HDR_URL, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentRotation.set(0, -0.6, 0);
    scene.environmentIntensity = 0.75;
    hdr.dispose();
  });

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 30, 1, 0.005, 30);

  const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
  key.position.set(-0.12, 0.24, 0.12);
  if (opts.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = opts.shadowSize ?? 0.12;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.02, far: 1.5 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0002;
    key.shadow.radius = 10;
    key.shadow.blurSamples = 16;
  }
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xffe2c4, 0.9);
  rim.position.set(0.14, 0.1, -0.16);
  const fill = new THREE.DirectionalLight(0xfff4e8, 0.35);
  fill.position.set(0.02, -0.2, 0.08);
  const hemi = new THREE.HemisphereLight(0xfff6ea, 0x7a5a42, 0.35);
  scene.add(rim, fill, hemi);

  const listeners = new Set();
  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const f of listeners) f(w, h, camera.aspect);
  }
  addEventListener("resize", resize);
  resize();

  const raycaster = new THREE.Raycaster();
  let prev = 0;
  let frameFn = null;
  function start(fn) {
    frameFn = fn;
    prev = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      frameFn?.(dt, now / 1000);
      renderer.render(scene, camera);
    });
  }
  const stop = () => renderer.setAnimationLoop(null);

  return {
    renderer,
    scene,
    camera,
    lights: { key, rim, fill, hemi },
    resize,
    onResize: (f) => (listeners.add(f), f(canvas.clientWidth, canvas.clientHeight, camera.aspect)),
    start,
    stop,
    /** ワールド座標 → 画面上の CSS ピクセル（キャンバス左上基準） */
    toScreen(v) {
      const p = v.clone().project(camera);
      return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight, behind: p.z > 1 };
    },
    /** 画面上の点（CSS ピクセル）からのレイ */
    ray(x, y) {
      const rc = raycaster;
      rc.setFromCamera(new THREE.Vector2((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1), camera);
      return rc;
    },
  };
}

/** 影だけを受ける床（y=0） */
export function shadowGround(size = 1, opacity = 0.18) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShadowMaterial({ color: 0x3a2210, opacity }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/** 真下のやわらかい丸い影（影を使わない場面用）。直径 size の板 */
export function blobShadow(size = 0.07, alpha = 0.32) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, `rgba(45,25,10,${alpha})`);
  grd.addColorStop(0.5, `rgba(45,25,10,${alpha * 0.45})`);
  grd.addColorStop(1, "rgba(45,25,10,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -1;
  return m;
}

// ---------------------------------------------------------------- 見た目の個体差
const srgbToLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
// 焼き印の芯の色（焼き色に対する比）と、にじみの色（blender/photo_setup.py と同じ）
const BURN = [178, 84, 50].map((v, i) => srgbToLinear(v) / srgbToLinear([232, 176, 114][i]));
const HALO = [0.86, 0.69, 0.6];

/** 1個ずつの違い（焼き印の位置・傾き・濃さ、焼き色）。rnd は 0..1 を返す関数 */
export function randomLook(rnd = Math.random) {
  const v = 0.94 + rnd() * 0.12;
  const warm = rnd() - 0.5;
  return {
    x: (rnd() - 0.5) * 0.04,
    y: (rnd() - 0.5) * 0.04,
    rot: (rnd() - 0.5) * 0.22,
    strength: 0.72 + rnd() * 0.3,
    shade: [v * (1 + warm * 0.04), v, v * (1 - warm * 0.07)],
  };
}
export const PLAIN_LOOK = { x: 0, y: 0, rot: 0, strength: 0, shade: [1, 1, 1] };

// ---------------------------------------------------------------- モデル
let kitPromise = null;

/** GLB と焼き印なしのテクスチャを読み込む（何度呼んでも1回だけ） */
export function loadKinman(renderer) {
  kitPromise ??= (async () => {
    const texLoader = new THREE.TextureLoader();
    const tex = (name, srgb) =>
      new Promise((res, rej) =>
        texLoader.load(
          asset(name),
          (t) => {
            t.flipY = false; // glTF の UV に合わせる
            if (srgb) t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 4;
            res(t);
          },
          undefined,
          rej
        )
      );
    const plain = (name) =>
      new Promise((res, rej) =>
        texLoader.load(
          asset(name),
          (t) => {
            t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
            res(t);
          },
          undefined,
          rej
        )
      );
    const [gltf, map, normalMap, roughnessMap, stampMap, haloMap] = await Promise.all([
      new GLTFLoader().loadAsync(MODEL_URL),
      tex("kinman_color_base.webp", true),
      tex("kinman_normal_base.webp", false),
      tex("kinman_rough_base.webp", false),
      plain("stamp_mask.png"),
      plain("stamp_halo.png"),
    ]);
    const base = gltf.scene.getObjectByName("KM_Whole").material;
    const textures = { map, normalMap, roughnessMap, stampMap, haloMap };
    const templates = {
      whole: gltf.scene.getObjectByName("KM_Whole"),
      halfA: gltf.scene.getObjectByName("KM_HalfA"),
      halfB: gltf.scene.getObjectByName("KM_HalfB"),
    };
    for (const t of Object.values(templates)) t.removeFromParent();
    return new Kit(templates, textures, base);
  })();
  return kitPromise;
}

class Kit {
  constructor(templates, textures, base) {
    this.templates = templates;
    this.textures = textures;
    this.base = base;
  }

  /** 焼き印を押せるマテリアル（1個ごとに作る。シェーダーは共有される） */
  material(look = randomLook()) {
    const m = new THREE.MeshPhysicalMaterial({
      map: this.textures.map,
      normalMap: this.textures.normalMap,
      roughnessMap: this.textures.roughnessMap,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      sheen: 0.06,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color(0xffc080),
      specularIntensity: 0.3,
    });
    if (this.base?.normalScale) m.normalScale.copy(this.base.normalScale);
    const u = {
      uStamp: { value: new THREE.Vector4() },
      uShade: { value: new THREE.Color(1, 1, 1) },
      uStampMap: { value: this.textures.stampMap },
      uHaloMap: { value: this.textures.haloMap },
    };
    m.userData.stamp = u;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vKmPos;\nvarying vec3 vKmNormal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvKmPos = position;\nvKmNormal = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vKmPos;
varying vec3 vKmNormal;
uniform vec4 uStamp;      // x, y: ずれ（直径比）  z: 傾き（rad）  w: 濃さ（0 = なし, >1 で焦げ）
uniform vec3 uShade;      // 焼き色の個体差
uniform sampler2D uStampMap;
uniform sampler2D uHaloMap;`
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
{
  // 物体座標の上面 → 焼き印の画像座標（画像の上 = -Z）
  vec2 p = vec2(vKmPos.x, -vKmPos.z) / ${(2 * RADIUS).toFixed(5)};
  float c = cos(uStamp.z), s = sin(uStamp.z);
  p = mat2(c, s, -s, c) * p;
  vec2 suv = p + 0.5 + uStamp.xy;
  float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
  float top = step(${(HEIGHT * 0.8).toFixed(5)}, vKmPos.y) * step(0.6, normalize(vKmNormal).y);
  float w = uStamp.w;
  float k = top * inside * min(w, 1.0);
  float st = texture2D(uStampMap, suv).r;
  float ha = texture2D(uHaloMap, suv).r;
  float core = clamp(pow(min(st * 1.4, 1.0), 0.6) * 0.97 * k, 0.0, 1.0);
  float hal = min(ha * 1.4, 1.0) * 0.5 * k;
  float scorch = top * inside * clamp(w - 1.0, 0.0, 1.0);   // 押しすぎの焦げ
  diffuseColor.rgb *= uShade;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(${HALO.map((v) => v.toFixed(3)).join(",")}), clamp(hal + scorch * min(ha * 3.0, 1.0) * 0.8, 0.0, 1.0));
  diffuseColor.rgb *= mix(vec3(1.0), vec3(${BURN.map((v) => v.toFixed(3)).join(",")}), core);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.32, 0.2, 0.15), scorch * clamp(ha * 2.2 + st, 0.0, 1.0));
}`
        );
    };
    m.customProgramCacheKey = () => "kinman-stamp-v1";
    setLook(m, look);
    return m;
  }

  _mesh(template, material, origin) {
    const mesh = template.clone();
    // 半分のモデルは中にメッシュを3つ（皮・切り口・あん）持つ Group なので、中まで配る
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.material = material;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const g = new THREE.Group();
    if (origin === "center") mesh.position.y = -HEIGHT / 2;
    g.add(mesh);
    g.userData.material = material;
    return g;
  }

  /** 金萬1個。origin: "center"（既定。回転の中心がお菓子の真ん中）か "bottom"（底面の中心） */
  make({ look = randomLook(), origin = "center" } = {}) {
    return this._mesh(this.templates.whole, this.material(look), origin);
  }

  /**
   * 半分に割ったもの。a / b は切り口（XY 平面, z=0）で分かれた半分で、それぞれの Group の原点は
   * 丸ごとのときの中心のまま（そのまま並べると丸ごとに見える）。
   */
  makeHalves({ look = randomLook(), origin = "center" } = {}) {
    const m = this.material(look);
    return { a: this._mesh(this.templates.halfA, m, origin), b: this._mesh(this.templates.halfB, m, origin), material: m };
  }
}

function setLook(material, look) {
  const u = material.userData.stamp;
  u.uStamp.value.set(look.x ?? 0, look.y ?? 0, look.rot ?? 0, look.strength ?? 1);
  const s = look.shade ?? [1, 1, 1];
  u.uShade.value.setRGB(s[0], s[1], s[2]);
}

/** 焼き印・焼き色を変える。kinman は make() の戻り値かマテリアル */
export function setStamp(kinman, look) {
  const m = kinman.isMaterial ? kinman : kinman.userData.material;
  const u = m.userData.stamp;
  const cur = { x: u.uStamp.value.x, y: u.uStamp.value.y, rot: u.uStamp.value.z, strength: u.uStamp.value.w, shade: u.uShade.value.toArray() };
  setLook(m, { ...cur, ...look });
}

// ---------------------------------------------------------------- 小道具
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const ease = {
  outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  inExpo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
  outBack: (p, s = 1.70158) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2),
  inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outCubic: (p) => 1 - Math.pow(1 - p, 3),
};

/** 小さなトゥイーン管理。tweens.add(秒, (p) => {...}, onDone) を毎フレーム tweens.step(dt) */
export function createTweens() {
  const list = new Set();
  return {
    add(duration, update, done) {
      const tw = { t: 0, duration, update, done };
      list.add(tw);
      update(0);
      return tw;
    },
    cancel(tw) {
      list.delete(tw);
    },
    step(dt) {
      for (const tw of list) {
        tw.t += dt;
        const p = Math.min(1, tw.t / tw.duration);
        tw.update(p);
        if (p >= 1) {
          list.delete(tw);
          tw.done?.();
        }
      }
    },
    clear() {
      list.clear();
    },
    get size() {
      return list.size;
    },
  };
}
