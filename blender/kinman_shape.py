"""金萬の形とUV配置の定義（標準ライブラリのみ）。

Blender 側のメッシュ生成 (kinman_build.py) と、テクスチャ生成 (tools/gen_textures.py)
の両方がこれを読み込み、同じ数値を共有する。単位は cm。
"""
import math

R, H = 2.30, 1.62
RB, RT, TAPER, DOME = 0.12, 0.2, 0.025, 0.022


def _profile():
    pts = []
    for i in range(0, 33):                       # 底面
        pts.append(((R - RB) * i / 32, 0.0))
    k_bot = len(pts) - 1
    for i in range(1, 17):                       # 底の角
        a = -math.pi / 2 + (math.pi / 2) * i / 16
        pts.append((R - RB + RB * math.cos(a), RB + RB * math.sin(a)))
    x0, z0, x1, z1 = R, RB, R - TAPER, H - RT * 0.85
    for i in range(1, 17):                       # 側面（わずかに膨らむ）
        t = i / 16
        pts.append((x0 + (x1 - x0) * t + 0.018 * math.sin(math.pi * t), z0 + (z1 - z0) * t))
    cx, cz = x1 - RT, z1
    for i in range(1, 25):                       # 上の角（楕円弧）
        a = (math.pi / 2) * i / 24
        pts.append((cx + RT * math.cos(a), cz + RT * 0.85 * math.sin(a)))
    k_top = len(pts) - 1
    r0 = cx
    for i in range(1, 41):                       # 上面（わずかに盛り上がる）
        r = r0 * (1 - i / 40)
        pts.append((r, top_z(r, r0)))
    return pts, k_bot, k_top, r0


def top_z(r, r0):
    return H + DOME * (1 - (r / r0) ** 2)


PROF, K_BOT, K_TOP, R_TOP = _profile()
R_BOT = R - RB

ARC = [0.0]
for _a, _b in zip(PROF, PROF[1:]):
    ARC.append(ARC[-1] + math.dist(_a, _b))
S_BOT, S_TOP = ARC[K_BOT], ARC[K_TOP]


def profile_at_arc(s):
    """弧長 s（底面の端 S_BOT〜上面の端 S_TOP）における (r, z)。"""
    for k in range(K_BOT, K_TOP):
        if ARC[k + 1] >= s:
            t = (s - ARC[k]) / max(ARC[k + 1] - ARC[k], 1e-9)
            (r0, z0), (r1, z1) = PROF[k], PROF[k + 1]
            return r0 + (r1 - r0) * t, z0 + (z1 - z0) * t
    return PROF[K_TOP]


# ---- 個体差（ゆがみ）----
# seed=0 がサイトで使う基準の1個体。撮影用に seed を変えて別の個体を作れる。
_W_PHASE = (1.3, 4.1, 2.2, 5.6, 0.7)
_W_AMP = (0.007, 0.004, 0.009, 0.006)


def _wobble_params(seed):
    if seed == 0:
        return _W_PHASE, _W_AMP, 1.0
    import random
    rnd = random.Random(seed)
    phase = tuple(rnd.uniform(0, 2 * math.pi) for _ in range(5))
    amp = tuple(a * rnd.uniform(0.6, 1.5) for a in _W_AMP)
    return phase, amp, 1 + rnd.uniform(-0.035, 0.035)   # 厚みの個体差


def wobble(r, z, th, seed=0):
    ph, am, hs = _wobble_params(seed)
    rr = r * (1 + am[0] * math.sin(2 * th + ph[0]) + am[1] * math.sin(3 * th + ph[1]))
    zn = z / H
    zz = z * hs * (1 + am[2] * math.sin(th + ph[2]) * zn)
    # 上面のゆるいうねり（中心ほど大きい）
    if z > H - RT:
        w = min(1.0, (z - (H - RT)) / RT)
        zz += w * am[3] * (math.sin(2.3 * th + ph[3]) * (r / R) + 0.6 * math.cos(1.7 * r + ph[4]))
    return rr, zz


# ---- あん（切り口の断面形）----
# 切り口は xz 平面。s = x（cm）, z = 高さ。超楕円を少しゆがめた形。
AN_AX = R - 0.13
AN_ZLO, AN_ZHI = 0.12, H - 0.13
AN_ZC = (AN_ZLO + AN_ZHI) / 2
AN_AZ = (AN_ZHI - AN_ZLO) / 2
AN_N = 5.0
_AN_MOD = ((2, 0.018, 0.4), (3, 0.012, 2.1), (5, 0.008, 4.4), (7, 0.006, 1.0), (11, 0.004, 5.2))


def an_mod(phi):
    return sum(a * math.sin(k * phi + p) for k, a, p in _AN_MOD)


def an_boundary(t):
    """パラメータ t (0..2π) の境界点 (s, z)。"""
    c, s = math.cos(t), math.sin(t)
    x = math.copysign(abs(c) ** (2 / AN_N), c)
    y = math.copysign(abs(s) ** (2 / AN_N), s)
    phi = math.atan2(y, x)
    m = 1 + an_mod(phi)
    return AN_AX * x * m, AN_ZC + AN_AZ * y * m


def an_rho(s, z):
    """あんの境界を 1 とした、切り口上の点 (s, z) の「あんの内側度」（1 未満があんの中）。"""
    X, Y = s / AN_AX, (z - AN_ZC) / AN_AZ
    rho = (abs(X) ** AN_N + abs(Y) ** AN_N) ** (1 / AN_N)
    return rho / (1 + an_mod(math.atan2(Y, X)))


# ---- 割れ目（手で割った切り口のでこぼこ）----
# 切り口の点を y 方向（切り口の法線方向）にずらす量。割れ目の近くのすべての頂点に
# 同じずらしを掛けるので、2つの半分の切り口はぴったり噛み合い、上面の割れ線も揺れる。
BREAK_FALLOFF = 0.4       # この距離（cm）で切り口から離れるとずらしがなくなる


def _vhash(ix, iz, seed):
    h = (ix * 73856093) ^ (iz * 19349663) ^ (seed * 83492791)
    h &= 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFFFF) / float(0xFFFFFF) * 2 - 1


def vnoise2(x, z, seed):
    """2D バリューノイズ（-1..1）。"""
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    ux, uz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a = _vhash(ix, iz, seed) + ux * (_vhash(ix + 1, iz, seed) - _vhash(ix, iz, seed))
    b = _vhash(ix, iz + 1, seed) + ux * (_vhash(ix + 1, iz + 1, seed) - _vhash(ix, iz + 1, seed))
    return a + uz * (b - a)


def fbm2(x, z, octaves, seed):
    amp, tot, norm = 1.0, 0.0, 0.0
    for o in range(octaves):
        tot += amp * vnoise2(x * 2 ** o + o * 17.13, z * 2 ** o - o * 5.71, seed + o * 101)
        norm += amp
        amp *= 0.5
    return tot / norm


def break_offset(s, z, seed=0):
    """切り口上の点 (s, z)（cm）の y 方向のずらし（cm）。
    大きなうねり（割れ線の揺れ）＋ あんのなだらかなちぎれ ＋ 生地の細かなむしれ。"""
    sd = 7 + seed * 31
    big = 0.06 * fbm2(s / 1.1, z / 0.9, 3, sd)
    t = min(1.0, max(0.0, (an_rho(s, z) - 0.94) / 0.1))
    w_an = 1 - t * t * (3 - 2 * t)                   # あんの中 1、生地 0
    an = 0.05 * fbm2(s / 0.45, z / 0.35, 2, sd + 1)
    crumb = 0.02 * fbm2(s / 0.07, z / 0.07, 2, sd + 2)
    return big + w_an * an + (1 - w_an) * crumb


def break_weight(dy):
    """切り口からの距離 dy（cm）に対するずらしの効き具合（切り口で 1、離れると 0）。"""
    t = min(1.0, abs(dy) / BREAK_FALLOFF)
    return 1 - t * t * (3 - 2 * t)


# ---- UV 配置（BakeUV、0..1）----
TOP_RECT = (0.0, 0.5, 0.5, 1.0)
BOT_RECT = (0.5, 0.75, 0.75, 1.0)
CAP_RECT = (0.5, 0.5, 1.0, 0.75)
STRIP_RECT = (0.0, 0.0, 1.0, 0.48)
DISC_FILL = 0.48          # 円を矩形の 0.5 に対してどこまで広げるか
TOP_UV_R = R_TOP * 1.02
BOT_UV_R = R_BOT * 1.02
STRIP_V_PAD = 0.02
CAP_W = 2 * R * 1.03
CAP_Z0, CAP_ZH = -0.03, H + 0.12


def uv_disc(x, y, radius, rect, flip=False):
    u0, v0, u1, v1 = rect
    s = DISC_FILL / radius
    xx = -x if flip else x
    return (u0 + (u1 - u0) * (0.5 + xx * s), v0 + (v1 - v0) * (0.5 + y * s))


def uv_strip(th, s):
    u0, v0, u1, v1 = STRIP_RECT
    u = th / (2 * math.pi)
    v = (s - S_BOT) / (S_TOP - S_BOT)
    return (u0 + (u1 - u0) * u, v0 + (v1 - v0) * (STRIP_V_PAD + (1 - 2 * STRIP_V_PAD) * v))


def uv_cap(s, z):
    u0, v0, u1, v1 = CAP_RECT
    return (u0 + (u1 - u0) * (0.5 + s / CAP_W), v0 + (v1 - v0) * ((z - CAP_Z0) / CAP_ZH))
