"""金萬のテクスチャ（色・粗さ・法線）を BakeUV 空間で直接生成する。

各テクセルが金萬の表面のどこに当たるかを kinman_shape から逆算し、
位置に応じた焼き色・気泡・砂糖のきらめき・焼き印・切り口（カステラ生地と白あん）を描く。

出力（textures/、4096px）:
  kinman_color / kinman_rough / kinman_normal           … 焼き印入り（サイト用）
  kinman_color_base / kinman_rough_base / kinman_normal_base … 焼き印なし（撮影用。印は個体ごとにシェーダーで押す）
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
TILT = np.zeros((N, N, 2), np.float32)     # 砂糖の粒の面の向き（法線への加算）
STAMP = np.zeros((N, N), np.float32)       # 焼き印（芯・にじみ・へこみ用のぼかし）
HALO = np.zeros((N, N), np.float32)
SOFT = np.zeros((N, N), np.float32)


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
    sy, sx = max(sigma_px[0], 0.5), max(sigma_px[1], 0.5)
    img = ndimage.gaussian_filter(img, (sy, sx), mode="wrap") * (2 * math.pi * sy * sx)
    return np.clip(img, 0, clip) if clip else img


def facets(shape, density_px, sigma_px, weight=None):
    """きらめく粒: 強さと、粒ごとにばらばらな面の向き (h,w,2)。"""
    h, w = shape
    n = rng.poisson(density_px * h * w)
    ys = rng.integers(0, h, n)
    xs = rng.integers(0, w, n)
    if weight is not None:
        keep = rng.random(n) < weight[ys, xs]
        ys, xs = ys[keep], xs[keep]
    strength = np.zeros(shape, np.float32)
    tilt = np.zeros(shape + (2,), np.float32)
    strength[ys, xs] = rng.uniform(0.5, 1.0, len(ys))
    tilt[ys, xs] = rng.uniform(-1, 1, (len(ys), 2))
    sy, sx = max(sigma_px[0], 0.5), max(sigma_px[1], 0.5)
    k = 2 * math.pi * sy * sx
    strength = np.clip(ndimage.gaussian_filter(strength, (sy, sx), mode="wrap") * k, 0, 1)
    for i in range(2):
        tilt[..., i] = ndimage.gaussian_filter(tilt[..., i], (sy, sx), mode="wrap") * k
    return strength, np.clip(tilt, -1, 1)


# ------------------------------------------------------------------ 表面の焼き色
# 表面に沿った「底の中心からの距離」a で色を決める（上面・側面・底面で連続）
S_BOT, S_TOP = K.S_BOT, K.S_TOP
A_TOPC = S_TOP + K.R_TOP
side_len = S_TOP - S_BOT
A_KEYS = np.array([0.0, S_BOT - 0.3, S_BOT + 0.10, S_BOT + 0.35, S_BOT + side_len * 0.55,
                   S_TOP - 0.45, S_TOP - 0.2, S_TOP - 0.05, S_TOP + 0.1, S_TOP + 0.45, A_TOPC])
A_COLS = np.stack([srgb(198, 134, 64), srgb(206, 146, 70), srgb(232, 190, 104), srgb(234, 190, 104),
                   srgb(222, 156, 70), srgb(216, 150, 70), srgb(234, 186, 112), srgb(242, 204, 146),
                   srgb(238, 192, 128), srgb(232, 180, 112), srgb(236, 186, 120)])
A_ROUGH = np.array([0.62, 0.6, 0.46, 0.4, 0.38, 0.4, 0.42, 0.42, 0.42, 0.42, 0.4])
A_PORES = np.array([5.0, 5.0, 1.5, 0.8, 0.8, 1.0, 2.5, 5.0, 6.0, 6.0, 6.0])     # 気泡の密度 /mm²
A_SPARK = np.array([4.0, 4.0, 2.0, 2.0, 2.0, 3.0, 14.0, 30.0, 36.0, 36.0, 36.0])  # 砂糖の粒 /mm²

stamp_img = np.asarray(Image.open(os.path.join(OUT, "stamp_mask.png")).convert("L"), np.float32) / 255.0
SM = stamp_img.shape[0]
STAMP_TEX_MM = 2 * K.R * 10 / SM
stamp_halo = ndimage.gaussian_filter(stamp_img, 0.10 / STAMP_TEX_MM)
stamp_soft = ndimage.gaussian_filter(stamp_img, 0.03 / STAMP_TEX_MM)


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

    # 焼きムラ（大・中・小）。上面は穏やか、側面はほぼ均一
    m1 = fbm(p, 0.9, 4, seed=11)
    m2 = fbm(p, 6.0, 3, seed=23)
    m3 = fbm(p, 30.0, 2, seed=37)
    bright = 1 + 0.06 * m1 + 0.04 * m2 + 0.025 * m3
    col = col * bright[:, None]
    darker = np.clip(-m1 * 1.6, 0, 1)[:, None] * 0.3
    col = col * (1 - darker) + (col * srgb(236, 196, 170) / srgb(236, 236, 236)) * darker   # 濃い所は赤み寄り
    rough = rough + 0.05 * m2 + 0.03 * m1

    # 気泡（小さなくぼみ）
    tu, tv = texel_mm
    area_px = tu * tv
    wgt = np.zeros((h, w), np.float32)
    wgt[mask] = np.interp(av, A_KEYS, A_PORES) / A_PORES.max()
    pores = (blobs((h, w), A_PORES.max() * area_px, (0.04 / tv, 0.04 / tu), (0.4, 1.0), wgt)
             + blobs((h, w), A_PORES.max() * 0.15 * area_px, (0.09 / tv, 0.09 / tu), (0.5, 1.0), wgt)
             + blobs((h, w), A_PORES.max() * 0.008 * area_px, (0.2 / tv, 0.2 / tu), (0.6, 1.0), wgt))
    pores = np.clip(pores, 0, 1.4)
    grain = fbm(p, 55.0, 2, seed=51)
    pv = pores[mask]
    col = col * (1 - pv[:, None] * np.array([0.045, 0.08, 0.12], np.float32))
    hgt = -0.06 * pv + 0.01 * grain
    rough = rough + 0.08 * np.clip(pv, 0, 1)

    # 白っぽい細かな粒（はじけた気泡の縁や砂糖）。表面が霜が降りたようにざらついて見える
    A_FROST = np.array([2.0, 2.0, 1.0, 0.8, 0.8, 1.2, 6.0, 12.0, 12.0, 10.0, 10.0])
    fwgt = np.zeros((h, w), np.float32)
    fwgt[mask] = np.interp(av, A_KEYS, A_FROST) / A_FROST.max()
    frost = (blobs((h, w), A_FROST.max() * area_px, (0.03 / tv, 0.03 / tu), (0.4, 1.0), fwgt)
             + blobs((h, w), A_FROST.max() * 0.25 * area_px, (0.06 / tv, 0.06 / tu), (0.4, 1.0), fwgt))
    fv = np.clip(frost[mask], 0, 1.2)
    col = col + fv[:, None] * 0.11 * srgb(255, 236, 205)
    hgt = hgt + 0.02 * fv
    rough = rough + 0.05 * fv

    # 砂糖のきらめき: ごく小さな粒が、それぞれ違う向きの平らな面で光を返す
    swgt = np.zeros((h, w), np.float32)
    swgt[mask] = np.interp(av, A_KEYS, A_SPARK) / A_SPARK.max()
    spark, tilt = facets((h, w), A_SPARK.max() * area_px, (0.012 / tv, 0.012 / tu), swgt)
    sp = spark[mask]
    col = col + 0.05 * sp[:, None] * srgb(255, 240, 215)
    rough = rough - 0.3 * sp

    if region == "top":
        STAMP[r0:r1, c0:c1][mask] = sample_stamp(stamp_img, x[mask], y[mask])
        HALO[r0:r1, c0:c1][mask] = sample_stamp(stamp_halo, x[mask], y[mask])
        SOFT[r0:r1, c0:c1][mask] = sample_stamp(stamp_soft, x[mask], y[mask])

    COLOR[r0:r1, c0:c1][mask] = np.clip(col, 0, 1)
    ROUGH[r0:r1, c0:c1][mask] = np.clip(rough, 0.12, 0.95)
    HEIGHT[r0:r1, c0:c1][mask] = hgt
    TILT[r0:r1, c0:c1][mask] = tilt[mask] * 0.9
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

# ---- 切り口（薄い皮・カステラ生地と白あん）----
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
# 包丁で切った跡: 横方向に長く伸びた筋
p_knife = np.stack([sx.ravel() * 1.2, np.zeros(sx.size), z.ravel() * 90.0], 1).astype(np.float32)
knife = fbm(p_knife, 1.0, 3, seed=113).reshape(h, w)

# カステラ生地: 薄い層の中の細かい気泡
crumb_pores = (blobs((h, w), 40 * tu * tv, (0.02 / tv, 0.02 / tu), (0.3, 0.7))
               + blobs((h, w), 6.0 * tu * tv, (0.045 / tv, 0.045 / tu), (0.4, 0.9))
               + blobs((h, w), 0.4 * tu * tv, (0.09 / tv, 0.09 / tu), (0.5, 1.0)))
crumb_pores = np.clip(crumb_pores, 0, 1.2)
crumb = srgb(244, 212, 146)[None, None] * (1 + 0.035 * n1 + 0.02 * n2)[..., None]
crumb = crumb * (1 - crumb_pores[..., None] * np.array([0.03, 0.06, 0.11], np.float32))
skin = smooth(0.05, 0.2, d_out)[..., None]                     # ごく薄い焼き皮の線
crumb = srgb(196, 124, 62)[None, None] * (1 - skin) + crumb * skin
dense = (1 - smooth(0.0, 0.18, d_an_out))[..., None] * 0.35   # あんに接する所は少し詰まる
crumb = crumb * (1 - dense) + srgb(232, 196, 128)[None, None] * dense
crumb_h = -0.05 * crumb_pores + 0.006 * n2
crumb_r = 0.78 - 0.1 * (1 - skin[..., 0]) + 0.04 * n2

# 玉子入り白あん: なめらかで、ごく細かい粒と包丁の筋、まれに豆の皮
specks = blobs((h, w), 0.35 * tu * tv, (0.03 / tv, 0.03 / tu), (0.5, 1.0), clip=1.0)
an_col = srgb(240, 220, 176)[None, None] * (1 + 0.03 * n1 + 0.015 * n2 + 0.015 * n3 + 0.005 * knife)[..., None]
an_col = an_col * (1 - 0.2 * specks)[..., None] + srgb(200, 156, 96)[None, None] * (0.2 * specks)[..., None]
rim = (1 - smooth(0.0, 0.15, d_an_in))[..., None] * 0.35
an_col = an_col * (1 - rim) + srgb(226, 198, 146)[None, None] * rim
an_h = 0.006 * n3 + 0.01 * n2 + 0.03 * n1 + 0.0015 * knife - 0.008 * specks
an_r = 0.42 + 0.04 * n3 + 0.05 * n1 + 0.01 * knife

cap_col = np.where(an[..., None], an_col, crumb)
cap_h = np.where(an, an_h, crumb_h)
cap_r = np.where(an, an_r, crumb_r)
m = inside | an
COLOR[r0:r1, c0:c1][m] = np.clip(cap_col, 0, 1)[m]
HEIGHT[r0:r1, c0:c1][m] = cap_h[m]
ROUGH[r0:r1, c0:c1][m] = np.clip(cap_r, 0.2, 0.95)[m]
VALID[r0:r1, c0:c1][m] = True
TEXEL[r0:r1, c0:c1][m] = (tu, tv)

# ------------------------------------------------------------------ 仕上げ
TEXEL[~VALID] = 0.02
edge = ndimage.binary_erosion(VALID, iterations=2)
_, (IR, IC) = ndimage.distance_transform_edt(~VALID, return_indices=True)


def normal_map(height):
    gy, gx = np.gradient(height)              # 行(下向き)・列(右向き) 方向の変化 mm/px
    du = gx / TEXEL[..., 0]
    dv = -gy / TEXEL[..., 1]                  # 行は v と逆向き
    du = du - TILT[..., 0]
    dv = dv - TILT[..., 1]
    du[~edge] = 0
    dv[~edge] = 0
    n = np.stack([-du, -dv, np.ones_like(du)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def save(name, arr, kind):
    arr = arr[IR, IC]                          # 余白を近くの値で埋める（ミップマップのにじみ対策）
    if kind == "normal":
        arr = arr * 0.5 + 0.5
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name))


log("save base")
save("kinman_color_base.png", COLOR, "color")
save("kinman_rough_base.png", ROUGH, "gray")
save("kinman_normal_base.png", normal_map(HEIGHT), "normal")

# 焼き印: 色を掛け合わせて焦がす（下の気泡や粒が透けて見える）
log("stamp")
core = np.clip(STAMP * 1.4, 0, 1) ** 0.6 * 0.97
halo = np.clip(HALO * 1.4, 0, 1) * 0.5
BURN = srgb(178, 84, 50) / srgb(232, 176, 114)
HALO_MUL = np.array([0.93, 0.85, 0.79], np.float32)
col = COLOR * (1 - halo[..., None] * (1 - HALO_MUL))
col = col * (1 - core[..., None] * (1 - BURN))
rough = ROUGH - 0.06 * SOFT
height = HEIGHT - 0.04 * SOFT
save("kinman_color.png", col, "color")
save("kinman_rough.png", rough, "gray")
save("kinman_normal.png", normal_map(height), "normal")
log("done")
