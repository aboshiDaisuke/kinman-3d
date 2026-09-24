"""金萬の焼き印マスクを生成する（白=焼き印、黒=生地）。
テクスチャは上面 [-R, R] の正方形に対応する。"""
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter
import os

FONT = "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/36a81f2dad2ef266c50802d85839e0201fcf4e57.asset/AssetData/ToppanBunkyuMidashiMinchoStdN-ExtraBold.otf"
S = 2048
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")
os.makedirs(OUT, exist_ok=True)

img = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(img)
cx = cy = S / 2

# 小判型（縦長の楕円）の枠
ow, oh = S * 0.34, S * 0.47
ring = int(S * 0.016)
d.ellipse([cx - ow / 2, cy - oh / 2, cx + ow / 2, cy + oh / 2], outline=255, width=ring)

# 「金」「萬」を縦に並べる
font = ImageFont.truetype(FONT, int(S * 0.165))
for ch, dy in (("金", -0.105), ("萬", 0.095)):
    l, t, r, b = d.textbbox((0, 0), ch, font=font)
    x = cx - (l + r) / 2
    y = cy + S * dy - (t + b) / 2
    d.text((x, y), ch, font=font, fill=255)

# 焼き印らしく線を太らせて縁をにじませ、濃淡ムラをつける
img = img.filter(ImageFilter.MaxFilter(11))
img = img.filter(ImageFilter.GaussianBlur(2.2))
noise = Image.effect_noise((S // 16, S // 16), 60).resize((S, S), Image.BICUBIC)
noise = noise.point(lambda v: 150 + v * 0.42)  # 0.6〜1.0 程度の濃さ
img = ImageChops.multiply(img, noise)
img.save(os.path.join(OUT, "stamp_mask.png"))
print("saved", os.path.join(OUT, "stamp_mask.png"))
