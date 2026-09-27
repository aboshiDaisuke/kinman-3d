"""金萬ムービーの BGM と効果音（15秒・120BPM）を合成して promo/out/kinman_bgm.wav に書き出す。

映像側（promo.js）のカット・衝撃の時刻に合わせてある:
  0.04 / 0.52 太鼓（秋田・銘菓） 1.0 飛び込み 1.52 着地
  2.0〜 ビート 4.5 / 7.0 / 10.0 ワイプ 7.0〜7.5 ため 7.5 割れる
  10.5〜11.5 数字カウンター 12.4 退場 13.3 着地（エンド） 13.9 光のスイープ
"""
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
DUR = 15.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(7)
out = np.zeros((N, 2))


def t_(dur):
    return np.arange(int(SR * dur)) / SR


def add(sig, at, gain=1.0, pan=0.0):
    """モノラル音を at 秒に置く。pan は -1（左）〜 1（右）。"""
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    out[i : i + len(sig), 0] += sig * gain * l * np.sqrt(2)
    out[i : i + len(sig), 1] += sig * gain * r * np.sqrt(2)


def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, btype=kind, fs=SR, output="sos"), x)


def sweep_sine(f0, f1, dur, curve=8.0):
    t = t_(dur)
    f = f1 + (f0 - f1) * np.exp(-t * curve)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


# ---------------------------------------------------------------- 音色
def kick(gain=1.0):
    t = t_(0.45)
    body = sweep_sine(160, 44, 0.45, 28) * np.exp(-t * 7.5)
    click = filt(rng.standard_normal(len(t)), "highpass", 2500) * np.exp(-t * 180) * 0.35
    return np.tanh((body + click) * 1.6) * gain


def clap():
    t = t_(0.35)
    n = rng.standard_normal(len(t))
    env = np.zeros(len(t))
    for d in (0.0, 0.011, 0.022):
        env += np.where(t >= d, np.exp(-(t - d) * 90), 0)
    env += np.exp(-t * 14) * 0.35
    return filt(filt(n, "highpass", 900), "lowpass", 7000) * env * 0.8


def hat(open_=False):
    t = t_(0.25 if open_ else 0.07)
    n = filt(rng.standard_normal(len(t)), "highpass", 7500, 4)
    return n * np.exp(-t * (14 if open_ else 70)) * 0.35


def taiko(f=95, gain=1.0):
    t = t_(1.2)
    body = sweep_sine(f * 1.6, f, 1.2, 18) * np.exp(-t * 3.2)
    over = sweep_sine(f * 3.1, f * 2.3, 1.2, 20) * np.exp(-t * 9) * 0.3
    skin = filt(rng.standard_normal(len(t)), "lowpass", 900) * np.exp(-t * 30) * 0.9
    return np.tanh((body + over + skin) * 1.4) * gain


def boom(gain=1.0, dur=2.2):
    t = t_(dur)
    sub = sweep_sine(90, 32, dur, 3.5) * np.exp(-t * 1.6)
    rumble = filt(rng.standard_normal(len(t)), "lowpass", 220) * np.exp(-t * 2.4) * 1.2
    hit = filt(rng.standard_normal(len(t)), "bandpass", [300, 5000]) * np.exp(-t * 26) * 0.9
    return np.tanh((sub * 1.3 + rumble + hit) * 1.3) * gain


def crack():
    """割れる音: 鋭いノイズ＋ぱちぱちとした細かい破裂"""
    t = t_(0.6)
    snap = filt(rng.standard_normal(len(t)), "highpass", 1200) * np.exp(-t * 60)
    crackle = np.zeros(len(t))
    for _ in range(70):
        i = int(abs(rng.normal(0, 0.09)) * SR)
        if i < len(t) - 400:
            crackle[i : i + 400] += rng.standard_normal(400) * np.exp(-np.arange(400) / 45) * rng.uniform(0.3, 1)
    crackle = filt(crackle, "highpass", 1500)
    return (snap * 1.1 + crackle * 0.8) * np.exp(-t * 3)


def whoosh(dur, f0, f1, gain=1.0, peak=0.6):
    """帯域の中心を f0→f1 に動かすノイズ。peak は音量が最大になる位置（0〜1）"""
    n = rng.standard_normal(int(SR * dur))
    y = np.zeros_like(n)
    blk = 512
    for s in range(0, len(n), blk):
        p = s / len(n)
        fc = f0 * (f1 / f0) ** p
        sos = butter(2, [max(40, fc * 0.6), min(SR / 2 - 100, fc * 1.6)], btype="bandpass", fs=SR, output="sos")
        seg = n[max(0, s - 2048) : s + blk]
        y[s : s + blk] = sosfilt(sos, seg)[-len(n[s : s + blk]) :]
    p = np.linspace(0, 1, len(n))
    env = np.where(p < peak, (p / peak) ** 2.2, np.exp(-(p - peak) / (1 - peak) * 4))
    return y * env * gain


def riser(dur, gain=1.0):
    t = t_(dur)
    tone = sum(np.sin(2 * np.pi * np.cumsum(220 * k * 2 ** (t * 2.4 / dur)) / SR) / k for k in (1, 2, 3))
    env = (t / dur) ** 2.5
    return (tone * 0.25 + whoosh(dur, 300, 7000, 1.0, 0.98)) * env * gain


def pluck(f, dur=0.6, bright=1.0):
    """琴っぽいはじく音（倍音ごとに減衰を変える）"""
    t = t_(dur)
    bend = 1 + 0.012 * np.exp(-t * 30)
    y = np.zeros(len(t))
    for k, a in enumerate([1, 0.55, 0.38, 0.22, 0.15, 0.1], start=1):
        y += a * np.sin(2 * np.pi * f * k * np.cumsum(bend) / SR) * np.exp(-t * (4 + k * 3.5 / bright))
    y += filt(rng.standard_normal(len(t)), "highpass", 3000) * np.exp(-t * 200) * 0.15
    return y * 0.5


def bass(f, dur):
    t = t_(dur)
    saw = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 12))
    y = filt(saw, "lowpass", 380) + np.sin(2 * np.pi * f * t) * 0.8
    env = np.minimum(1, t * 200) * np.exp(-t * 3.5)
    return np.tanh(y * env * 1.5) * 0.55


def chime(f, dur=2.5):
    t = t_(dur)
    y = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for a, r, d in [(1, 1, 1.6), (0.5, 2.76, 3), (0.3, 5.4, 5), (0.2, 8.9, 8)])
    return y * 0.25


def pad(freqs, dur):
    t = t_(dur)
    y = sum(np.sin(2 * np.pi * f * t + np.sin(2 * np.pi * 0.3 * t + i) * 0.4) for i, f in enumerate(freqs))
    y += sum(np.sin(2 * np.pi * f * 1.004 * t) * 0.5 for f in freqs)
    env = np.minimum(1, t / 0.4) * np.minimum(1, (dur - t) / 0.6)
    return filt(y, "lowpass", 2400) * env * 0.08


def note(name):
    names = {"C": 0, "C#": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
    return 440 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) + 1) - 69) / 12)


# ---------------------------------------------------------------- 構成
# 1) 秋田・銘菓：太鼓の2発
add(taiko(98, 1.0), 0.04)
add(taiko(88, 1.1), 0.52)
add(hat(True), 0.28, 0.6, 0.3)
add(pad([note("D3"), note("A3"), note("D4")], 1.4), 0.0, 0.8)

# 2) 飛び込み → 着地
add(whoosh(0.62, 400, 3500, 0.9, 0.85), 0.92, 1.4, -0.3)
add(boom(1.3), 1.52)
add(kick(1.0), 1.52)
add(chime(note("D6")), 1.52, 0.35, 0.4)

# 3) ビート（2.0〜7.0、7.5〜10.0、10.0〜12.4）
def groove(start, end, claps=True, hats=True):
    b = start
    while b < end - 1e-6:
        add(kick(), b, 0.95)
        if claps and round((b - 2.0) / BEAT) % 2 == 1:
            add(clap(), b, 0.7, 0.1)
        if hats:
            for k in range(4):
                add(hat(k == 2), b + k * BEAT / 4, 0.5 if k % 2 else 0.3, 0.35 * (1 if k % 2 else -1))
        b += BEAT


groove(2.0, 7.0)
groove(7.5, 10.0)
groove(10.0, 12.4)

# ベース（2拍ごとにルート）
roots = ["D2", "Bb1", "C2", "A1"]
b = 2.0
i = 0
while b < 12.4:
    if not (7.0 <= b < 7.5):
        r = note(roots[(i // 4) % 4])
        for k in range(2):
            add(bass(r * (2 if k == 1 else 1), BEAT / 2), b + k * BEAT / 2, 0.9)
    b += BEAT
    i += 1

# 琴のフレーズ（都節音階 D Eb G A Bb）
scale = ["D4", "Eb4", "G4", "A4", "Bb4", "D5", "Eb5", "G5"]
phrase = [5, 3, 4, 2, 3, 1, 2, 0, 5, 4, 7, 5, 6, 4, 5, 3]
b = 2.0
k = 0
while b < 12.4:
    if not (7.0 <= b < 7.75):
        idx = phrase[k % len(phrase)]
        add(pluck(note(scale[idx]), 0.7, 1.2), b, 0.55, 0.45 * np.sin(k * 1.3))
        if k % 4 == 3:
            add(pluck(note(scale[max(0, idx - 2)]) * 2, 0.4, 1.6), b + 0.125, 0.25, -0.4)
    b += 0.25
    k += 1

# 4) ワイプの風切り音
for tc in (4.5, 7.0, 10.0):
    add(whoosh(0.6, 250, 6000, 0.9, 0.55), tc - 0.34, 0.8, -0.5)
    add(whoosh(0.5, 5000, 400, 0.6, 0.2), tc, 0.5, 0.5)

# 焼き印：寄りに合わせた軽い衝撃
add(taiko(120, 0.6), 4.72)
add(chime(note("A5"), 1.5), 4.75, 0.3, 0.5)

# 5) ため → 割れる
add(riser(0.52, 1.8), 6.98)
rattle = np.concatenate([filt(rng.standard_normal(int(SR * 0.03)), "bandpass", [600, 3000]) * np.hanning(int(SR * 0.03)) for _ in range(16)])
add(rattle * np.linspace(0.1, 0.7, len(rattle)), 7.02, 0.6)
add(boom(1.2, 2.6), 7.5)
add(crack(), 7.5, 1.0)
add(taiko(80, 0.9), 7.5)
add(clap(), 8.08, 0.8)
add(boom(0.5, 1.0), 8.08)
for i, f in enumerate(["D6", "A6", "D7", "G6"]):  # しっとり のきらめき
    add(chime(note(f), 1.2), 8.9 + i * 0.1, 0.18, (-1) ** i * 0.5)

# 6) 数字カウンター：だんだん遅くなるカチカチ
tick_t = t_(0.012)
tick = np.sin(2 * np.pi * 3200 * tick_t) * np.exp(-tick_t * 500) * 0.4
for t0, t1 in ((10.52, 11.32), (10.66, 11.46)):
    x = 0.0
    while x < 1:
        at = t0 + (t1 - t0) * (1 - (1 - x) ** 0.35)
        add(tick, at, 0.5, 0.3 if t0 < 10.6 else -0.3)
        x += 0.045
    add(chime(note("A6"), 0.8), t1, 0.25)

# 7) 退場 → エンド着地
add(whoosh(0.55, 300, 8000, 1.0, 0.75), 12.32, 1.0)
fall = sweep_sine(2200, 500, 0.4, 3) * np.linspace(0.05, 0.3, int(SR * 0.4))
add(fall, 12.9, 0.35, 0.2)
add(boom(1.2, 2.2), 13.3)
add(taiko(70, 1.1), 13.3)
add(pad([note("D3"), note("A3"), note("D4"), note("F#4"), note("A4")], 1.7), 13.3, 1.0)
for i, f in enumerate(["D5", "F#5", "A5", "D6", "F#6", "A6"]):  # 光のスイープ
    add(chime(note(f), 1.6), 13.9 + i * 0.07, 0.2, -0.6 + i * 0.24)

# ---------------------------------------------------------------- 仕上げ
# 簡単なリバーブ（減衰するノイズとの畳み込み）
ir_t = t_(1.1)
ir = rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t * 5.5)[:, None]
ir[:, 0] = filt(ir[:, 0], "lowpass", 5000)
ir[:, 1] = filt(ir[:, 1], "lowpass", 5000)
wet = np.stack([fftconvolve(out[:, c], ir[:, c])[:N] for c in range(2)], axis=1)
mix = out + wet * 0.018
mix = filt(mix.T, "highpass", 25).T
# 最後の 0.4 秒でフェードアウト
fade = np.ones(N)
fade[-int(SR * 0.4) :] = np.linspace(1, 0, int(SR * 0.4)) ** 1.5
mix *= fade[:, None]
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.8) / np.tanh(1.8) * 0.89

dst = Path(__file__).parent / "out" / "kinman_bgm.wav"
dst.parent.mkdir(exist_ok=True)
pcm = (mix * 32767).astype("<i2")
import wave

with wave.open(str(dst), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", dst)
