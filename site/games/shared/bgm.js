// ファミコン風の BGM。矩形波2つ（デューティ比 12.5 / 25 / 50%）、三角波、ノイズの4音を Web Audio で鳴らす。
//
//   bgm.play("yakiin");   // 同じ曲が鳴っていれば何もしない
//   bgm.tempo(1.15);      // テンポを上げる（1 が元の速さ）
//   bgm.stop(0.6);        // 0.6 秒でフェードアウト
//
// 曲の書き方: 1小節 = 16 分音符 16 個。音名（C4, F#5, Bb3 など）、"-" で前の音を伸ばす、"." で休み。
// 和音の役（harm / bass）は R（根音）T（3度）F（5度）O（オクターブ上）で書き、chords の和音に当てはめる。
// ドラムは1文字ずつ: k キック、s スネア、h ハイハット、o オープンハイハット、. 休み。
import { audioOut } from "./sfx.js";

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  return NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12 * (Number(m[3]) + 1);
}
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

function chordTones(sym, octave) {
  const m = /^([A-G])(#|b)?(m?)$/.exec(sym);
  const root = NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12 * (octave + 1);
  return { R: root, T: root + (m[3] ? 3 : 4), F: root + 7, O: root + 12 };
}

// ---------------------------------------------------------------- 曲
const SONGS = {
  // 焼き印: お祭りの屋台のような、にぎやかな D の五音音階
  yakiin: {
    bpm: 152,
    chords: ["D", "A", "D", "A", "D", "Bm", "G", "A"],
    lead: {
      wave: 0.25, vol: 0.16, decay: 0.18, sustain: 0.55,
      bars: [
        "D5 - F#5 - A5 - - B5 A5 - F#5 - E5 - D5 -",
        "E5 - F#5 - E5 D5 - B4 A4 - - - . . A4 B4",
        "D5 - F#5 - A5 - - D6 B5 - A5 - F#5 - A5 -",
        "B5 - A5 F#5 E5 - D5 - E5 - - - . . . .",
        "A5 - A5 - B5 A5 F#5 - A5 - A5 - D6 - B5 -",
        "A5 - F#5 - E5 - F#5 - A5 - - - . . . .",
        "B5 - B5 - D6 B5 A5 - F#5 - E5 - D5 - E5 -",
        "F#5 - E5 - D5 - - - D5 - - - . . . .",
      ],
    },
    harm: { wave: 0.125, vol: 0.07, decay: 0.08, sustain: 0.3, octave: 4, pattern: ". . T . . . F . . . T . . . F ." },
    bass: { vol: 0.2, octave: 2, pattern: "R . O . F . O . R . O . F . O ." },
    drum: { vol: 0.13, bars: ["k.hhs.hhk.hhs.hh", "k.hhs.hhk.hhs.hh", "k.hhs.hhk.hhs.hh", "k.hhs.hhk.s.ssss"] },
  },

  // 金萬タワー: ぽんぽん弾む、はずむ C
  tower: {
    bpm: 132,
    chords: ["C", "F", "F", "G", "C", "F", "G", "C"],
    lead: {
      wave: 0.125, vol: 0.17, decay: 0.12, sustain: 0.4,
      bars: [
        "C5 . E5 . G5 . E5 . C6 - B5 . G5 . . .",
        "A5 . G5 . E5 . F5 . G5 - - - . . . .",
        "F5 . A5 . C6 . A5 . G5 . E5 . C5 . E5 .",
        "D5 . E5 . F5 . D5 . G5 - - - . . G4 .",
        "C5 . E5 . G5 . C6 . D6 . C6 . A5 . G5 .",
        "F5 . G5 . A5 . F5 . E5 - - - . . . .",
        "D5 . F5 . A5 . D6 . C6 . B5 . A5 . B5 .",
        "C6 - - - G5 . E5 . C5 - - - . . . .",
      ],
    },
    harm: { wave: 0.5, vol: 0.05, decay: 0.1, sustain: 0.3, octave: 4, pattern: ". . T . . . T . . . T . . . T ." },
    bass: { vol: 0.22, octave: 2, pattern: "R . . O F . . O R . . O F . O ." },
    drum: { vol: 0.12, bars: ["k.h.s.h.k.k.s.h.", "k.h.s.h.k.k.s.h.", "k.h.s.h.k.k.s.h.", "k.h.s.h.k.k.ssss"] },
  },

  // お土産箱詰め: のんびりしたお店の F の五音音階。琴のように短く減衰させる
  hako: {
    bpm: 108,
    chords: ["F", "Dm", "F", "C", "F", "C", "F", "F"],
    lead: {
      wave: 0.25, vol: 0.15, decay: 0.35, sustain: 0.35,
      bars: [
        "A5 - - - G5 - F5 - G5 - A5 - C6 - - -",
        "D6 - C6 - A5 - G5 - A5 - - - - - . .",
        "F5 - G5 - A5 - C6 - D6 - C6 - A5 - G5 -",
        "F5 - - - D5 - F5 - G5 - - - - - . .",
        "C6 - - - D6 - C6 - A5 - G5 - A5 - - -",
        "G5 - F5 - D5 - F5 - G5 - - - - - . .",
        "A5 - C6 - D6 - F6 - D6 - C6 - A5 - C6 -",
        "F5 - - - - - - - . . . . . . . .",
      ],
    },
    harm: { wave: 0.125, vol: 0.06, decay: 0.12, sustain: 0.2, octave: 4, pattern: "R . T . F . T . R . T . F . T ." },
    bass: { vol: 0.2, octave: 2, pattern: "R - - - - - . . F - - - - - . ." },
    drum: { vol: 0.08, bars: ["k...h...s...h..."] },
  },

  // パカッと割り: 居合いの緊張感。A の都節音階（A Bb D E F）
  paka: {
    bpm: 144,
    chords: ["Am", "F", "Dm", "E", "Am", "F", "Dm", "E"],
    lead: {
      wave: 0.5, vol: 0.13, decay: 0.2, sustain: 0.6,
      bars: [
        "A5 - - E5 F5 - E5 - D5 - E5 - - - . .",
        "A5 - - E5 F5 - A5 - Bb5 - A5 - - - . .",
        "D6 - Bb5 - A5 - F5 - E5 - F5 - A5 - - -",
        "E5 - F5 - E5 - D5 - Bb4 - A4 - - - . .",
        "A4 . A4 . E5 . A4 . F5 - E5 - D5 - E5 -",
        "A4 . A4 . E5 . A4 . Bb5 - A5 - F5 - E5 -",
        "D6 - - - Bb5 - - - A5 - - - F5 - - -",
        "E5 - F5 - E5 - D5 - E5 - - - - - . .",
      ],
    },
    harm: { wave: 0.125, vol: 0.06, decay: 0.07, sustain: 0.25, octave: 3, pattern: "R . F . O . F . R . F . O . F ." },
    bass: { vol: 0.24, octave: 2, pattern: "R . R . R . R . R . R . O . R ." },
    drum: { vol: 0.14, bars: ["k..kk...k..kk.s.", "k..kk...k..kk.s.", "k..kk...k..kk.s.", "k..kk...k.s.ssss"] },
  },

  // 金萬オセロ: 考えごとの邪魔をしない、ゆったりした G
  othello: {
    bpm: 92,
    chords: ["G", "C", "G", "D", "Am", "D", "Em", "G"],
    lead: {
      wave: 0.5, vol: 0.1, decay: 0.4, sustain: 0.5,
      bars: [
        "B4 - - - D5 - - - G5 - F#5 - D5 - - -",
        "E5 - - - D5 - B4 - A4 - - - - - - -",
        "B4 - - - D5 - - - G5 - A5 - B5 - - -",
        "A5 - G5 - E5 - F#5 - D5 - - - - - - -",
        "C6 - - - B5 - - - A5 - G5 - E5 - - -",
        "D5 - - - E5 - G5 - A5 - - - - - - -",
        "B5 - - - A5 - G5 - E5 - D5 - E5 - G5 -",
        "G5 - - - - - - - . . . . . . . .",
      ],
    },
    harm: { wave: 0.125, vol: 0.05, decay: 0.2, sustain: 0.2, octave: 4, pattern: "R . T . F . T . R . T . F . T ." },
    bass: { vol: 0.17, octave: 2, pattern: "R - - - - - - - F - - - - - - -" },
    drum: { vol: 0.06, bars: ["k...h...s...h..."] },
  },
};

// 1小節ぶんの音符列（16個）を、長さ付きの音符に直す
function parseBar(str, chord, octave) {
  const toks = str.trim().split(/\s+/);
  if (toks.length !== 16) console.warn("bgm: 16 個ではない小節", toks.length, str);
  const tones = chord ? chordTones(chord, octave) : null;
  return toks.map((t) => {
    if (t === "-" || t === ".") return t;
    if (tones && t in tones) return tones[t];
    return midi(t);
  });
}

// 曲を「小節ごとの 16 ステップ」に展開する
function compile(song) {
  const n = song.lead.bars.length;
  const tracks = [];
  const bars = (t, fn) => Array.from({ length: n }, (_, i) => fn(i));
  tracks.push({ kind: "pulse", ...song.lead, steps: bars(song.lead, (i) => parseBar(song.lead.bars[i])) });
  if (song.harm) tracks.push({ kind: "pulse", ...song.harm, steps: bars(song.harm, (i) => parseBar(song.harm.pattern, song.chords[i % song.chords.length], song.harm.octave)) });
  if (song.bass) tracks.push({ kind: "tri", ...song.bass, steps: bars(song.bass, (i) => parseBar(song.bass.pattern, song.chords[i % song.chords.length], song.bass.octave)) });
  if (song.drum) tracks.push({ kind: "noise", ...song.drum, steps: bars(song.drum, (i) => [...song.drum.bars[i % song.drum.bars.length]]) });
  return { bpm: song.bpm, bars: n, tracks };
}

// ---------------------------------------------------------------- 音源
const waves = new Map();
function pulseWave(ctx, duty) {
  const key = duty;
  if (waves.has(key)) return waves.get(key);
  const N = 48;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let k = 1; k < N; k++) real[k] = ((2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty));
  const w = ctx.createPeriodicWave(real, imag);
  waves.set(key, w);
  return w;
}
let noiseLong = null;
let noiseShort = null;
function noiseBuffers(ctx) {
  if (noiseLong) return;
  // ファミコンのノイズと同じく、15 ビットのシフトレジスタで作る（短周期はモード1）
  const make = (short, len) => {
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let reg = 1;
    const per = Math.max(1, Math.round(ctx.sampleRate / 16000));
    for (let i = 0; i < len; i++) {
      if (i % per === 0) {
        const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
        reg = (reg >> 1) | (bit << 14);
      }
      d[i] = reg & 1 ? 0.8 : -0.8;
    }
    return b;
  };
  noiseLong = make(false, ctx.sampleRate);
  noiseShort = make(true, ctx.sampleRate);
}

function playPulse(ctx, out, t, dur, note, tr) {
  const o = ctx.createOscillator();
  o.setPeriodicWave(pulseWave(ctx, tr.wave));
  o.frequency.setValueAtTime(hz(note), t);
  const g = ctx.createGain();
  const peak = tr.vol;
  g.gain.setValueAtTime(peak, t);
  g.gain.setTargetAtTime(peak * tr.sustain, t + 0.005, tr.decay / 3);
  g.gain.setTargetAtTime(0, t + dur - 0.01, 0.012);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.08);
}
function playTri(ctx, out, t, dur, note, tr) {
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(hz(note), t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(tr.vol, t);
  g.gain.setTargetAtTime(0, t + dur - 0.012, 0.01);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.06);
}
function playDrum(ctx, out, t, ch, vol) {
  if (ch === "k") {
    // キックは三角波の音程を急に下げて作る（ファミコンでよくある作り方）
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 2.4, t);
    g.gain.setTargetAtTime(0, t + 0.05, 0.03);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    return;
  }
  const s = ctx.createBufferSource();
  s.buffer = ch === "s" ? noiseLong : noiseShort;
  s.playbackRate.value = ch === "s" ? 0.5 : 1;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = ch === "s" ? 800 : 5000;
  const g = ctx.createGain();
  const len = ch === "s" ? 0.14 : ch === "o" ? 0.18 : 0.035;
  g.gain.setValueAtTime(vol * (ch === "s" ? 1.2 : 0.7), t);
  g.gain.setTargetAtTime(0, t + 0.005, len / 3);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + len * 2 + 0.05);
}

// ---------------------------------------------------------------- 再生
const compiled = {};
let current = null; // { id, song, step, next, timer, gain }
let tempoMul = 1;

function schedule() {
  const a = audioOut();
  if (!a || !current) return;
  const { ctx } = a;
  const cur = current;
  const stepDur = () => 60 / (cur.song.bpm * tempoMul) / 4;
  if (cur.next < ctx.currentTime) cur.next = ctx.currentTime + 0.05;
  while (cur.next < ctx.currentTime + 0.15) {
    const total = cur.song.bars * 16;
    const s = cur.step % total;
    const bar = Math.floor(s / 16);
    const i = s % 16;
    for (const tr of cur.song.tracks) {
      const tok = tr.steps[bar][i];
      if (tok === "-" || tok === "." || tok === undefined) continue;
      if (tr.kind === "noise") {
        playDrum(ctx, cur.gain, cur.next, tok, tr.vol);
        continue;
      }
      // 後ろに続く "-" のぶん伸ばす
      let len = 1;
      for (let k = s + 1; k < s + total; k++) {
        const kk = k % total;
        if (tr.steps[Math.floor(kk / 16)][kk % 16] !== "-") break;
        len++;
      }
      const dur = len * stepDur();
      if (tr.kind === "pulse") playPulse(ctx, cur.gain, cur.next, dur, tok, tr);
      else playTri(ctx, cur.gain, cur.next, dur, tok, tr);
    }
    cur.next += stepDur();
    cur.step++;
  }
}

export const bgm = {
  play(id, { volume = 0.55 } = {}) {
    if (!SONGS[id]) return;
    if (current?.id === id && !current.stopping) return;
    const a = audioOut();
    if (!a) return;
    bgm.stop(0.08);
    noiseBuffers(a.ctx);
    compiled[id] ??= compile(SONGS[id]);
    tempoMul = 1;
    const gain = a.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(a.master);
    current = { id, song: compiled[id], step: 0, next: a.ctx.currentTime + 0.06, gain, stopping: false };
    current.timer = setInterval(schedule, 25);
    schedule();
  },
  stop(fade = 0.5) {
    const cur = current;
    if (!cur) return;
    current = null;
    cur.stopping = true;
    clearInterval(cur.timer);
    const a = audioOut();
    if (a) {
      const t = a.ctx.currentTime;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
      setTimeout(() => cur.gain.disconnect(), (fade + 0.4) * 1000);
    }
  },
  /** テンポの倍率（1 = 元の速さ） */
  tempo(mul) {
    tempoMul = Math.max(0.5, Math.min(2, mul));
  },
  get playing() {
    return current?.id ?? null;
  },
  songs: Object.keys(SONGS),
};
