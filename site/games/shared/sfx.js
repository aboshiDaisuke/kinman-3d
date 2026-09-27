// ミニゲーム共通の効果音。音源ファイルは使わず Web Audio で合成する。
// 最初のタップ（ユーザー操作）のあとで鳴るようになる。消音はページをまたいで保存される。
const KEY = "kinman-games:muted";

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

// ユーザー操作の前は AudioContext を作らない（ブラウザに止められて警告が出るため）
let unlocked = false;
function ac() {
  if (!unlocked) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
function unlock() {
  unlocked = true;
  return ac();
}
addEventListener("pointerdown", unlock, { passive: true });
addEventListener("keydown", unlock);

function env(g, t, a, peak, d, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + d);
}
function tone({ type = "sine", f0, f1 = f0, dur = 0.2, gain = 0.3, attack = 0.004, when = 0, glide = dur }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  env(g, t, attack, gain, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}
function noise({ dur = 0.2, gain = 0.3, type = "bandpass", f = 2000, f1 = f, q = 0.8, attack = 0.003, when = 0 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const fl = c.createBiquadFilter();
  fl.type = type;
  fl.frequency.setValueAtTime(f, t);
  if (f1 !== f) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  fl.Q.value = q;
  const g = c.createGain();
  env(g, t, attack, gain, dur);
  s.connect(fl).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + attack + dur + 0.05);
}

/** BGM などほかの音から使う出力先（ユーザー操作の前は null） */
export function audioOut() {
  const c = ac();
  return c ? { ctx: c, master } : null;
}

// タブを隠している間は音を止める
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});

export const sfx = {
  get muted() {
    return muted;
  },
  setMuted(v) {
    muted = v;
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {}
    if (master) master.gain.value = v ? 0 : 0.8;
  },
  unlock,
  /** 軽いタップ */
  tap() {
    tone({ type: "triangle", f0: 900, f1: 600, dur: 0.06, gain: 0.18 });
  },
  /** カーソル移動などのごく小さな音 */
  tick() {
    tone({ type: "square", f0: 2400, dur: 0.02, gain: 0.05 });
  },
  /** ドン（着地・置く） */
  thud(size = 1) {
    tone({ f0: 160 * size, f1: 55 * size, dur: 0.25, gain: 0.5, glide: 0.12 });
    noise({ type: "lowpass", f: 900, dur: 0.08, gain: 0.25 });
  },
  /** 太鼓 */
  taiko(pitch = 1) {
    tone({ f0: 150 * pitch, f1: 90 * pitch, dur: 0.6, gain: 0.55, glide: 0.08 });
    tone({ f0: 300 * pitch, f1: 210 * pitch, dur: 0.15, gain: 0.12, glide: 0.06 });
    noise({ type: "lowpass", f: 700, dur: 0.06, gain: 0.3 });
  },
  /** ジュッ（焼き印） */
  sizzle(len = 0.5, gain = 0.28) {
    noise({ type: "highpass", f: 3500, dur: len, gain, attack: 0.01 });
    noise({ type: "bandpass", f: 6500, f1: 4000, q: 1.2, dur: len * 0.8, gain: gain * 0.6, attack: 0.02 });
    tone({ f0: 120, f1: 70, dur: 0.12, gain: 0.35 });
  },
  /** パキッ（割れる） */
  crack() {
    noise({ type: "highpass", f: 1500, dur: 0.09, gain: 0.5, attack: 0.001 });
    for (let i = 0; i < 6; i++) noise({ type: "bandpass", f: 2000 + Math.random() * 3000, q: 3, dur: 0.03, gain: 0.25, when: 0.02 + Math.random() * 0.15 });
    tone({ f0: 180, f1: 60, dur: 0.2, gain: 0.3 });
  },
  /** 風切り */
  whoosh(up = true) {
    noise({ type: "bandpass", f: up ? 400 : 3000, f1: up ? 3000 : 400, q: 1.2, dur: 0.28, gain: 0.22, attack: 0.1 });
  },
  /** ひっくり返す */
  flip() {
    tone({ type: "triangle", f0: 520, f1: 880, dur: 0.1, gain: 0.14 });
    noise({ type: "bandpass", f: 1800, q: 2, dur: 0.05, gain: 0.08 });
  },
  /** 良い判定。level 0..3 で音が上がる */
  good(level = 1) {
    const base = [523, 659, 784, 1047][Math.max(0, Math.min(3, level))];
    tone({ type: "triangle", f0: base, dur: 0.18, gain: 0.2 });
    tone({ type: "triangle", f0: base * 1.5, dur: 0.22, gain: 0.14, when: 0.07 });
    if (level >= 3) tone({ type: "sine", f0: base * 2, dur: 0.4, gain: 0.1, when: 0.14 });
  },
  /** 失敗 */
  bad() {
    tone({ type: "sawtooth", f0: 220, f1: 140, dur: 0.28, gain: 0.12 });
  },
  /** カウントダウン */
  count(last = false) {
    tone({ type: "square", f0: last ? 1320 : 880, dur: last ? 0.35 : 0.12, gain: 0.09 });
  },
  /** 結果発表 */
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: "triangle", f0: f, dur: 0.3, gain: 0.16, when: i * 0.09 }));
    tone({ type: "sine", f0: 1568, dur: 0.8, gain: 0.08, when: 0.36 });
  },
  /** 終了の笛 */
  whistle() {
    tone({ type: "sine", f0: 2100, f1: 1900, dur: 0.45, gain: 0.12 });
  },
};
