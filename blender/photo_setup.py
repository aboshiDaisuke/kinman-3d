"""撮影用のマテリアルとシーン（Blender 内で exec して使う）。

Kinman_Photo マテリアル: 焼き印なしのテクスチャに、個体ごとにランダムな位置・傾き・濃さで
焼き印を押し、焼き色も少しずつ変える（Object Info の Random を使う）。
"""
import bpy, math, sys, importlib, random

sys.path.insert(0, "/Users/daisuke/Desktop/金満/blender")
import kinman_shape as K
importlib.reload(K)

TEX = "/Users/daisuke/Desktop/金満/textures/"
R_M = K.R * 0.01
H_M = K.H * 0.01


def srgb(r, g, b):
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (f(r / 255), f(g / 255), f(b / 255), 1.0)


def image(name, colorspace):
    img = bpy.data.images.get(name)
    if img:
        img.reload()
    else:
        img = bpy.data.images.load(TEX + name)
    img.colorspace_settings.name = colorspace
    return img


def photo_material(name="Kinman_Photo"):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    L = nt.links
    for n in list(nt.nodes):
        nt.nodes.remove(n)

    def node(t, x, y, **kw):
        n = nt.nodes.new(t)
        n.location = (x, y)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def math_(op, a, b, x, y, clamp=False):
        n = node("ShaderNodeMath", x, y, operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    def sock(n, ident, out=False):
        return next(s for s in (n.outputs if out else n.inputs) if s.identifier == ident)

    def mix(blend, fac, a, b, x, y):
        n = node("ShaderNodeMix", x, y, data_type='RGBA', blend_type=blend)
        for ident, v in (("Factor_Float", fac), ("A_Color", a), ("B_Color", b)):
            if isinstance(v, tuple):
                sock(n, ident).default_value = v
            elif isinstance(v, (int, float)):
                sock(n, ident).default_value = v
            else:
                L.new(v, sock(n, ident))
        return sock(n, "Result_Color", out=True)

    out = node("ShaderNodeOutputMaterial", 1400, 0)
    bsdf = node("ShaderNodeBsdfPrincipled", 1100, 0)
    L.new(bsdf.outputs[0], out.inputs[0])

    uv = node("ShaderNodeUVMap", -1600, 200, uv_map="BakeUV")
    def tex(name, cs, x, y, interp='Linear'):
        t = node("ShaderNodeTexImage", x, y, interpolation=interp)
        t.image = image(name, cs)
        L.new(uv.outputs[0], t.inputs["Vector"])
        return t
    base = tex("kinman_color_base.png", "sRGB", -1300, 400, 'Cubic')
    rough = tex("kinman_rough_base.png", "Non-Color", -1300, 100)
    nrm = tex("kinman_normal_base.png", "Non-Color", -1300, -200)

    # 個体ごとの乱数（0..1 を4つ）
    info = node("ShaderNodeObjectInfo", -1900, -600)
    rnd = [info.outputs["Random"]]
    for i, k in enumerate((7.13, 13.71, 29.37)):
        rnd.append(math_('FRACT', math_('MULTIPLY', info.outputs["Random"], k, -1700, -700 - i * 80), 0, -1550, -700 - i * 80))

    # 焼き色の個体差（色相・彩度・明度を少しだけ）
    hsv = node("ShaderNodeHueSaturation", -900, 400)
    L.new(base.outputs["Color"], hsv.inputs["Color"])
    L.new(math_('ADD', math_('MULTIPLY', rnd[1], 0.022, -1100, 650), 0.489, -1000, 650), hsv.inputs["Hue"])
    L.new(math_('ADD', math_('MULTIPLY', rnd[2], 0.16, -1100, 580), 0.92, -1000, 580), hsv.inputs["Saturation"])
    L.new(math_('ADD', math_('MULTIPLY', rnd[3], 0.12, -1100, 510), 0.94, -1000, 510), hsv.inputs["Value"])

    # 焼き印の位置: 物体座標 → 印の画像座標。少し回して、少しずらす
    tc = node("ShaderNodeTexCoord", -1900, -250)
    mp = node("ShaderNodeMapping", -1300, -500, vector_type='POINT')
    L.new(tc.outputs["Object"], mp.inputs["Vector"])
    mp.inputs["Scale"].default_value = (1 / (2 * R_M), 1 / (2 * R_M), 1)
    loc = node("ShaderNodeCombineXYZ", -1450, -450)
    L.new(math_('ADD', math_('MULTIPLY', rnd[1], 0.04, -1600, -380), 0.48, -1520, -380), loc.inputs[0])
    L.new(math_('ADD', math_('MULTIPLY', rnd[2], 0.04, -1600, -440), 0.48, -1520, -440), loc.inputs[1])
    L.new(loc.outputs[0], mp.inputs["Location"])
    rot = node("ShaderNodeCombineXYZ", -1450, -560)
    L.new(math_('MULTIPLY', math_('SUBTRACT', rnd[3], 0.5, -1600, -560), 0.22, -1520, -560), rot.inputs[2])
    L.new(rot.outputs[0], mp.inputs["Rotation"])
    stamp = node("ShaderNodeTexImage", -1100, -450, extension='CLIP')
    stamp.image = image("stamp_mask.png", "Non-Color")
    halo = node("ShaderNodeTexImage", -1100, -700, extension='CLIP')
    halo.image = image("stamp_halo.png", "Non-Color")
    L.new(mp.outputs[0], stamp.inputs["Vector"])
    L.new(mp.outputs[0], halo.inputs["Vector"])

    # 上面だけに押す（物体座標の高さと、面の向き）
    sep = node("ShaderNodeSeparateXYZ", -1600, -900)
    L.new(tc.outputs["Object"], sep.inputs[0])
    geo = node("ShaderNodeNewGeometry", -1600, -1050)
    sepn = node("ShaderNodeSeparateXYZ", -1450, -1050)
    L.new(geo.outputs["Normal"], sepn.inputs[0])
    top = math_('MULTIPLY',
                math_('GREATER_THAN', sep.outputs["Z"], H_M * 0.85, -1300, -900),
                math_('GREATER_THAN', sepn.outputs["Z"], 0.6, -1300, -1050), -1150, -950)
    strength = math_('ADD', math_('MULTIPLY', rnd[0], 0.3, -1150, -1100), 0.72, -1000, -1100)
    k = math_('MULTIPLY', top, strength, -900, -1000)

    core = math_('MULTIPLY', math_('MULTIPLY', math_('POWER', math_('MINIMUM', math_('MULTIPLY', stamp.outputs["Color"], 1.4, -1000, -380), 1.0, -900, -380), 0.6, -850, -450), 0.97, -700, -450), k, -550, -450, clamp=True)
    hal = math_('MULTIPLY', math_('MULTIPLY', math_('MINIMUM', math_('MULTIPLY', halo.outputs["Color"], 1.4, -850, -700), 1.0, -700, -700), 0.5, -600, -700), k, -450, -700)
    burn_hue = srgb(178, 84, 50)
    burn = tuple(burn_hue[i] / srgb(232, 176, 114)[i] for i in range(3)) + (1.0,)
    col = mix('MULTIPLY', hal, hsv.outputs["Color"], (0.86, 0.69, 0.6, 1.0), -300, 300)   # 0.93,0.85,0.79 (sRGB) の線形値
    col = mix('MULTIPLY', core, col, burn, -100, 300)
    L.new(col, bsdf.inputs["Base Color"])

    sepr = node("ShaderNodeSeparateColor", -900, 100)
    L.new(rough.outputs["Color"], sepr.inputs[0])
    L.new(math_('SUBTRACT', sepr.outputs[1], math_('MULTIPLY', core, 0.06, -700, 50), -500, 100), bsdf.inputs["Roughness"])

    nm = node("ShaderNodeNormalMap", -900, -200, uv_map="BakeUV")
    L.new(nrm.outputs["Color"], nm.inputs["Color"])
    bump = node("ShaderNodeBump", 700, -300, invert=True)
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.00004
    L.new(core, bump.inputs["Height"])
    L.new(nm.outputs["Normal"], bump.inputs["Normal"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Specular IOR Level"].default_value = 0.22
    bsdf.inputs["Sheen Weight"].default_value = 0.02
    bsdf.inputs["Sheen Tint"].default_value = (1.0, 0.75, 0.5, 1.0)
    bsdf.inputs["Sheen Roughness"].default_value = 0.4
    bsdf.inputs["Subsurface Weight"].default_value = 0.12
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.6, 0.3)
    bsdf.inputs["Subsurface Scale"].default_value = 0.0006
    return m


def variants(build, collection, n=8):
    """形の違う個体を n 個作る（seed 1..n）。"""
    out = []
    for i in range(1, n + 1):
        name = f"KM_Var{i}"
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        ob = build(name, collection=collection, seed=i)
        out.append(ob)
    return out
