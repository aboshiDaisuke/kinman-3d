"""金萬の焼き印マスクを生成する（白=焼き印、黒=生地）。
テクスチャは上面 [-R, R]（直径 D = 4.6cm）の正方形に対応する。
寸法は公式写真から読み取った比率（D に対する割合）。"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/2b7cea021df336d26a89f699c8469a51c721e9a2.asset/AssetData/Kyokasho.ttc"
FONT_INDEX = 1  # YuKyokasho Bold
S = 2048
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")
os.makedirs(OUT, exist_ok=True)

OVAL_W, OVAL_H = 0.355, 0.495   # 小判型の枠（外径）
OVAL_N = 2.35                   # 超楕円の指数（2 = 楕円。少しだけ角張らせる）
RING = 0.015                    # 枠線の太さ
GLYPH_H = 0.19                  # 1文字の高さ
GLYPH_GAP = 0.008               # 金と萬のすき間


def superellipse(cx, cy, a, b, n, k=720):
    pts = []
    for i in range(k):
        t = 2 * math.pi * i / k
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / n), c), cy + b * math.copysign(abs(s) ** (2 / n), s)))
    return pts


img = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(img)
cx = cy = S / 2
a, b = OVAL_W * S / 2, OVAL_H * S / 2
d.polygon(superellipse(cx, cy, a, b, OVAL_N), fill=255)
d.polygon(superellipse(cx, cy, a - RING * S, b - RING * S, OVAL_N), fill=0)

# 文字は別レイヤーで描いてから高さをそろえて貼る
font = ImageFont.truetype(FONT, 400, index=FONT_INDEX)
glyphs = []
for ch in "金萬":
    layer = Image.new("L", (600, 600), 0)
    ImageDraw.Draw(layer).text((100, 60), ch, font=font, fill=255)
    glyphs.append(layer.crop(layer.getbbox()))
target_h = GLYPH_H * S
total = target_h * 2 + GLYPH_GAP * S
y = cy - total / 2
for g in glyphs:
    k = target_h / g.height
    g = g.resize((round(g.width * k), round(g.height * k)), Image.LANCZOS)
    img.paste(255, (round(cx - g.width / 2), round(y)), g)
    y += target_h + GLYPH_GAP * S

# 焼きごての当たり方のムラ: 線が少し太り、縁はにじみ、濃さはまだらになる
img = img.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(2.2))
rng = np.random.default_rng(3)
low = np.asarray(Image.fromarray((rng.random((32, 32)) * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255
mid = np.asarray(Image.fromarray((rng.random((160, 160)) * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255
fine = rng.random((S, S)).astype(np.float32)
fine = np.asarray(Image.fromarray((fine * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
m = np.asarray(img, np.float32) / 255
m = m * (0.72 + 0.28 * low) * (0.85 + 0.15 * mid) * (0.88 + 0.24 * fine)
m = np.clip(m, 0, 1)
Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(OUT, "stamp_mask.png"))
# 焦げのにじみ用（撮影用シェーダーで使う）。0.1mm ほどぼかす
halo = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.10 / (46.0 / S)))
halo.save(os.path.join(OUT, "stamp_halo.png"))
print("saved stamp_mask.png, stamp_halo.png")
