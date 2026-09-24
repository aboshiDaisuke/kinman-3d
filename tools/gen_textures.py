"""金萬のテクスチャ（色・粗さ・法線）を BakeUV 空間で直接生成する。

各テクセルが金萬の表面のどこに当たるかを kinman_shape から逆算し、
位置に応じた焼き色・気泡・焼き印・切り口（カステラ生地と白あん）を描く。
出力: textures/kinman_color.png, kinman_rough.png, kinman_normal.png（4096px）
"""
import math, os, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "blender"))
import kinman_shape as K  # noqa: E402

N = int(os.environ.get("KINMAN_TEX", 4096))
OUT = os.path.join(ROOT, "textures")
rng = np.random.default_rng(20260924)
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def srgb(*c):
    return np.array(c, dtype=np.float32) / 255.0


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ noise
def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.uint32) * np.uint32(73856093)) ^ (iy.astype(np.uint32) * np.uint32(19349663)) \
        ^ (iz.astype(np.uint32) * np.uint32(83492791)) ^ np.uint32(seed * 2654435761 & 0xFFFFFFFF)
    h ^= h >> np.uint32(13)
    h *= np.uint32(1274126177)
    h ^= h >> np.uint32(16)
    return (h & np.uint32(0xFFFFFF)).astype(np.float32) / float(0xFFFFFF) * 2 - 1


def vnoise(p, seed):
    """3D バリューノイズ（-1..1）。p: (M,3)"""
    i = np.floor(p).astype(np.int64)
    f = (p - i).astype(np.float32)
    u = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                out = out + wx * wy * wz * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, freq, octaves=4, gain=0.5, seed=1):
    amp, tot, norm = 1.0, 0, 0
    for o in range(octaves):
        tot = tot + amp * vnoise(p * freq * (2.0 ** o) + o * 17.13, seed + o * 101)
        norm += amp
        amp *= gain
    return tot / norm


# ------------------------------------------------------------------ canvas
COLOR = np.zeros((N, N, 3), np.float32)
ROUGH = np.zeros((N, N), np.float32)
HEIGHT = np.zeros((N, N), np.float32)      # mm
VALID = np.zeros((N, N), bool)
TEXEL = np.zeros((N, N, 2), np.float32)    # (u方向, v方向) 1テクセルの実寸 mm


def rect_px(rect):
    u0, v0, u1, v1 = rect
    c0, c1 = int(round(u0 * N)), int(round(u1 * N))
    r0, r1 = int(round((1 - v1) * N)), int(round((1 - v0) * N))
    return r0, r1, c0, c1


def local_uv(rect):
    r0, r1, c0, c1 = rect_px(rect)
    rows, cols = np.mgrid[r0:r1, c0:c1]
    u = (cols + 0.5) / N
    v = 1 - (rows + 0.5) / N
    u0, v0, u1, v1 = rect
    return (r0, r1, c0, c1), (u - u0) / (u1 - u0), (v - v0) / (v1 - v0)


def blobs(shape, density_px, sigma_px, amp, weight=None, clip=None):
    """ランダムな点にガウスの粒を置いた画像（気泡・斑点）。
    density_px: 1テクセルあたりの個数, sigma_px: (sy, sx), amp: (lo, hi)"""
    h, w = shape
    n = rng.poisson(density_px * h * w)
    ys = rng.integers(0, h, n)
    xs = rng.integers(0, w, n)
    a = rng.uniform(amp[0], amp[1], n).astype(np.float32)
    if weight is not None:
        keep = rng.random(n) < weight[ys, xs]
        ys, xs, a = ys[keep], xs[keep], a[keep]
    img = np.zeros(shape, np.float32)
    np.add.at(img, (ys, xs), a)
    sy, sx = sigma_px
    img = ndimage.gaussian_filter(img, (sy, sx), mode="wrap") * (2 * math.pi * sy * sx)
    return np.clip(img, 0, clip) if clip else img


# ------------------------------------------------------------------ 表面の焼き色
# 表面に沿った「底の中心からの距離」a で色を決める（上面・側面・底面で連続）
S_BOT, S_TOP = K.S_BOT, K.S_TOP
A_TOPC = S_TOP + K.R_TOP
side_len = S_TOP - S_BOT
A_KEYS = np.array([0.0, S_BOT - 0.3, S_BOT + 0.10, S_BOT + 0.35, S_BOT + side_len * 0.55,
                   S_TOP - 0.45, S_TOP - 0.15, S_TOP + 0.12, S_TOP + 0.55, A_TOPC])
A_COLS = np.stack([srgb(196, 124, 60), srgb(204, 134, 66), srgb(230, 180, 106), srgb(240, 200, 126),
                   srgb(232, 170, 96), srgb(220, 146, 76), srgb(212, 140, 80), srgb(210, 140, 84),
                   srgb(222, 158, 100), srgb(228, 166, 108)])
A_ROUGH = np.array([0.62, 0.6, 0.5, 0.44, 0.42, 0.44, 0.46, 0.5, 0.5, 0.48])
A_PORES = np.array([5.0, 5.0, 2.0, 1.2, 1.2, 1.6, 3.0, 6.0, 6.0, 6.0])   # 気泡の密度 /mm²

stamp = np.asarray(Image.open(os.path.join(OUT, "stamp_mask.png")).convert("L"), np.float32) / 255.0
SM = stamp.shape[0]
STAMP_TEX_MM = 2 * K.R * 10 / SM
stamp_halo = ndimage.gaussian_filter(stamp, 0.14 / STAMP_TEX_MM)
stamp_soft = ndimage.gaussian_filter(stamp, 0.035 / STAMP_TEX_MM)


def sample_stamp(img, x, y):
    col = (x / (2 * K.R) + 0.5) * SM - 0.5
    row = (1 - (y / (2 * K.R) + 0.5)) * SM - 0.5
    return ndimage.map_coordinates(img, [row, col], order=1, mode="constant", cval=0.0)


def crust(region, rect, x, y, z, a, texel_mm, mask):
    """焼き面（上面・側面・底面）。x,y,z は cm、a は表面距離 cm。"""
    (r0, r1, c0, c1) = rect_px(rect)
    h, w = r1 - r0, c1 - c0
    p = np.stack([x[mask], y[mask], z[mask]], 1).astype(np.float32)
    av = a[mask]
    col = np.stack([np.interp(av, A_KEYS, A_COLS[:, i]) for i in range(3)], 1)
    rough = np.interp(av, A_KEYS, A_ROUGH).astype(np.float32)

    # 焼きムラ（大・中・小）
    m1 = fbm(p, 0.9, 4, seed=11)
    m2 = fbm(p, 6.0, 3, seed=23)
    m3 = fbm(p, 30.0, 2, seed=37)
    bright = 1 + 0.08 * m1 + 0.055 * m2 + 0.03 * m3
    col = col * bright[:, None]
    darker = np.clip(-m1 * 1.6, 0, 1)[:, None] * 0.35
    col = col * (1 - darker) + (col * srgb(236, 196, 170) / srgb(236, 236, 236)) * darker   # 濃い所は赤み寄り
    rough = rough + 0.05 * m2 + 0.04 * m1

    # 気泡（小さなくぼみ）と、白っぽい粒
    tu, tv = texel_mm
    dens_mm2 = np.zeros((h, w), np.float32)
    dens_mm2[mask] = np.interp(av, A_KEYS, A_PORES)
    area_px = tu * tv
    wgt = dens_mm2 / A_PORES.max()
    pores = (blobs((h, w), A_PORES.max() * area_px, (0.045 / tv, 0.045 / tu), (0.4, 1.0), wgt)
             + blobs((h, w), A_PORES.max() * 0.18 * area_px, (0.10 / tv, 0.10 / tu), (0.5, 1.0), wgt)
             + blobs((h, w), A_PORES.max() * 0.01 * area_px, (0.22 / tv, 0.22 / tu), (0.6, 1.0), wgt))
    pores = np.clip(pores, 0, 1.4)
    specks = blobs((h, w), 0.35 * area_px, (0.05 / tv, 0.05 / tu), (0.5, 1.0), clip=1.0)
    grain = fbm(p, 55.0, 2, seed=51)
    pv, sv = pores[mask], specks[mask]
    col = col * (1 - pv[:, None] * np.array([0.05, 0.09, 0.14], np.float32)) + 0.07 * sv[:, None] * srgb(255, 236, 200)
    hgt = -0.07 * pv + 0.012 * grain + 0.02 * sv
    rough = rough + 0.08 * np.clip(pv, 0, 1)

    if region == "top":
        m = sample_stamp(stamp, x[mask], y[mask])
        halo = sample_stamp(stamp_halo, x[mask], y[mask])
        soft = sample_stamp(stamp_soft, x[mask], y[mask])
        burn_edge = np.clip(halo * 1.5, 0, 1) * 0.5
        col = col * (1 - burn_edge[:, None]) + srgb(176, 96, 50) * burn_edge[:, None]
        core = np.clip(m, 0, 1) ** 0.8 * 0.93
        col = col * (1 - core[:, None]) + srgb(104, 40, 17) * core[:, None]
        hgt = hgt - 0.06 * soft
        rough = rough - 0.07 * soft

    COLOR[r0:r1, c0:c1][mask] = np.clip(col, 0, 1)
    ROUGH[r0:r1, c0:c1][mask] = np.clip(rough, 0.2, 0.95)
    HEIGHT[r0:r1, c0:c1][mask] = hgt
    VALID[r0:r1, c0:c1][mask] = True
    TEXEL[r0:r1, c0:c1][mask] = (tu, tv)


# ---- 上面 ----
log("top")
rect, lu, lv = local_uv(K.TOP_RECT)
x = (lu - 0.5) / K.DISC_FILL * K.TOP_UV_R
y = (lv - 0.5) / K.DISC_FILL * K.TOP_UV_R
r = np.hypot(x, y)
mask = r <= K.TOP_UV_R * 1.01
rc = np.minimum(r, K.R_TOP)
z = K.top_z(rc, K.R_TOP)
a = S_TOP + (K.R_TOP - rc)
tex = K.TOP_UV_R / K.DISC_FILL / ((K.TOP_RECT[2] - K.TOP_RECT[0]) * N) * 10
crust("top", K.TOP_RECT, x, y, z, a, (tex, tex), mask)

# ---- 底面 ----
log("bottom")
rect, lu, lv = local_uv(K.BOT_RECT)
x = -(lu - 0.5) / K.DISC_FILL * K.BOT_UV_R
y = (lv - 0.5) / K.DISC_FILL * K.BOT_UV_R
r = np.hypot(x, y)
mask = r <= K.BOT_UV_R * 1.01
a = np.minimum(r, S_BOT)
tex = K.BOT_UV_R / K.DISC_FILL / ((K.BOT_RECT[2] - K.BOT_RECT[0]) * N) * 10
crust("bot", K.BOT_RECT, x, y, np.zeros_like(x), a, (tex, tex), mask)

# ---- 側面（帯）----
log("side")
rect, lu, lv = local_uv(K.STRIP_RECT)
th = lu * 2 * math.pi
s = S_BOT + (lv - K.STRIP_V_PAD) / (1 - 2 * K.STRIP_V_PAD) * side_len
s = np.clip(s, S_BOT, S_TOP)
arc = np.array(K.ARC[K.K_BOT:K.K_TOP + 1])
pr = np.array([p[0] for p in K.PROF[K.K_BOT:K.K_TOP + 1]])
pz = np.array([p[1] for p in K.PROF[K.K_BOT:K.K_TOP + 1]])
rr = np.interp(s, arc, pr)
z = np.interp(s, arc, pz)
x, y = rr * np.cos(th), rr * np.sin(th)
tu = 2 * math.pi * 2.2 / ((K.STRIP_RECT[2] - K.STRIP_RECT[0]) * N) * 10
tv = side_len / (1 - 2 * K.STRIP_V_PAD) / ((K.STRIP_RECT[3] - K.STRIP_RECT[1]) * N) * 10
crust("side", K.STRIP_RECT, x, y, z, s, (tu, tv), np.ones_like(x, bool))

# ---- 切り口（カステラ生地と白あん）----
log("cut")
rect, lu, lv = local_uv(K.CAP_RECT)
(r0, r1, c0, c1) = rect
sx = (lu - 0.5) * K.CAP_W
z = K.CAP_Z0 + lv * K.CAP_ZH
tu = K.CAP_W / ((K.CAP_RECT[2] - K.CAP_RECT[0]) * N) * 10
tv = K.CAP_ZH / ((K.CAP_RECT[3] - K.CAP_RECT[1]) * N) * 10
zt = K.PROF[K.K_TOP][1]
rmax = np.interp(np.clip(z, 0, zt), pz, pr)
inside = (z >= 0) & (np.abs(sx) <= rmax) & (z <= zt)
inside |= (z > zt) & (np.abs(sx) <= K.R_TOP) & (z <= K.top_z(np.minimum(np.abs(sx), K.R_TOP), K.R_TOP))
d_out = ndimage.distance_transform_edt(inside, sampling=(tv, tu))        # 外周からの距離 mm

X = sx / K.AN_AX
Y = (z - K.AN_ZC) / K.AN_AZ
rho = (np.abs(X) ** K.AN_N + np.abs(Y) ** K.AN_N) ** (1 / K.AN_N)
phi = np.arctan2(Y, X)
mod = sum(a_ * np.sin(k_ * phi + p_) for k_, a_, p_ in K._AN_MOD)
an = rho < 1 + mod
d_an_in = ndimage.distance_transform_edt(an, sampling=(tv, tu))           # あんの縁からの距離（内側）
d_an_out = ndimage.distance_transform_edt(~an, sampling=(tv, tu))         # 同（外側）

h, w = sx.shape
p3 = np.stack([sx.ravel(), np.zeros(sx.size), z.ravel()], 1).astype(np.float32)
n1 = fbm(p3, 3.0, 4, seed=71).reshape(h, w)
n2 = fbm(p3, 40.0, 3, seed=83).reshape(h, w)
n3 = fbm(p3, 160.0, 2, seed=97).reshape(h, w)

# カステラ生地: 細かい気泡の集まり
crumb_pores = (blobs((h, w), 30 * tu * tv, (0.028 / tv, 0.028 / tu), (0.3, 0.8))
               + blobs((h, w), 5.0 * tu * tv, (0.06 / tv, 0.06 / tu), (0.4, 0.9))
               + blobs((h, w), 0.35 * tu * tv, (0.13 / tv, 0.13 / tu), (0.5, 1.0)))
crumb_pores = np.clip(crumb_pores, 0, 1.2)
crumb = srgb(247, 221, 150)[None, None] * (1 + 0.04 * n1 + 0.025 * n2)[..., None]
crumb = crumb * (1 - crumb_pores[..., None] * np.array([0.035, 0.065, 0.13], np.float32))
skin = smooth(0.18, 0.55, d_out)[..., None]                    # 外側の焼き皮の線
crumb = srgb(186, 112, 52)[None, None] * (1 - skin) + crumb * skin
dense = (1 - smooth(0.0, 0.35, d_an_out))[..., None] * 0.5    # あんに接する所は少し詰まって色が濃い
crumb = crumb * (1 - dense) + srgb(226, 184, 110)[None, None] * dense
crumb_h = -0.06 * crumb_pores + 0.008 * n2
crumb_r = 0.82 - 0.1 * (1 - skin[..., 0]) + 0.04 * n2

# 玉子入り白あん: きめの細かい粒と、ごくまれな豆の皮の粒
specks = blobs((h, w), 0.5 * tu * tv, (0.035 / tv, 0.035 / tu), (0.5, 1.0), clip=1.0)
an_col = srgb(244, 224, 178)[None, None] * (1 + 0.035 * n1 + 0.03 * n2 + 0.035 * n3)[..., None]
an_col = an_col * (1 - 0.25 * specks)[..., None] + srgb(196, 150, 90)[None, None] * (0.25 * specks)[..., None]
rim = (1 - smooth(0.0, 0.3, d_an_in))[..., None] * 0.4
an_col = an_col * (1 - rim) + srgb(222, 192, 140)[None, None] * rim
an_h = 0.015 * n3 + 0.02 * n2 + 0.04 * n1 - 0.01 * specks
an_r = 0.42 + 0.05 * n3 + 0.05 * n1

cap_col = np.where(an[..., None], an_col, crumb)
cap_h = np.where(an, an_h, crumb_h)
cap_r = np.where(an, an_r, crumb_r)
m = inside | an
COLOR[r0:r1, c0:c1][m] = np.clip(cap_col, 0, 1)[m]
HEIGHT[r0:r1, c0:c1][m] = cap_h[m]
ROUGH[r0:r1, c0:c1][m] = np.clip(cap_r, 0.2, 0.95)[m]
VALID[r0:r1, c0:c1][m] = True
TEXEL[r0:r1, c0:c1][m] = (tu, tv)

# ------------------------------------------------------------------ 法線マップ
log("normal")
TEXEL[~VALID] = 0.02
gy, gx = np.gradient(HEIGHT)              # 行(下向き)・列(右向き) 方向の変化 mm/px
du = gx / TEXEL[..., 0]
dv = -gy / TEXEL[..., 1]                  # 行は v と逆向き
edge = ndimage.binary_erosion(VALID, iterations=2)
du[~edge] = 0
dv[~edge] = 0
STRENGTH = 1.0
nrm = np.stack([-du * STRENGTH, -dv * STRENGTH, np.ones_like(du)], -1)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)

# ------------------------------------------------------------------ 余白を近くの色で埋める（ミップマップのにじみ対策）
log("pad")
_, (ir, ic) = ndimage.distance_transform_edt(~VALID, return_indices=True)
COLOR = COLOR[ir, ic]
ROUGH = ROUGH[ir, ic]
nrm = nrm[ir, ic]

log("save")
Image.fromarray((COLOR * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "kinman_color.png"))
Image.fromarray((ROUGH * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "kinman_rough.png"))
Image.fromarray(((nrm * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "kinman_normal.png"))
log("done")
