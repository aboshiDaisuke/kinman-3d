"""金萬のメッシュ生成（Blender 内で exec して使う）。

build_kinman(name, theta=(0, 2π)) で旋盤状のメッシュを作る。形とUV配置は kinman_shape.py。
丸ごと1個も、半分ずつも同じ1個体から作るので、割っても形がずれない。
UV は BakeUV の1つだけ（全ピースで1組のテクスチャを共有）。単位はメートル（実寸）。
"""
import bpy, bmesh, math, sys, importlib

sys.path.insert(0, "/Users/daisuke/Desktop/金満/blender")
import kinman_shape as K
importlib.reload(K)

CM = 0.01


def _pos(r, z, th):
    rr, zz = K.wobble(r, z, th)
    return (rr * math.cos(th) * CM, rr * math.sin(th) * CM, zz * CM)


def build_kinman(name, theta=(0.0, 2 * math.pi), steps=256, collection=None):
    th0, th1 = theta
    full = abs((th1 - th0) - 2 * math.pi) < 1e-6
    n_th = steps if full else int(round(steps * (th1 - th0) / (2 * math.pi))) + 1
    th_of = (lambda j: th0 + (th1 - th0) * j / steps) if full else (lambda j: th0 + (th1 - th0) * j / (n_th - 1))

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("BakeUV")

    rings = []
    for (r, z) in K.PROF:
        if r < 1e-6:
            rings.append([bm.verts.new(_pos(0, z, 0))])
        else:
            rings.append([bm.verts.new(_pos(r, z, th_of(j))) for j in range(n_th)])

    jmax = n_th if full else n_th - 1
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        region = "top" if k >= K.K_TOP else ("bot" if k + 1 <= K.K_BOT else "strip")
        for j in range(jmax):
            j2 = (j + 1) % n_th
            if len(A) == 1:
                vs, ks, js = (A[0], B[j], B[j2]), (k, k + 1, k + 1), (j, j, j + 1)
            elif len(B) == 1:
                vs, ks, js = (A[j], A[j2], B[0]), (k, k, k + 1), (j, j + 1, j)
            else:
                vs, ks, js = (A[j], A[j2], B[j2], B[j]), (k, k, k + 1, k + 1), (j, j + 1, j + 1, j)
            f = bm.faces.new(vs)
            f.smooth = True
            f.material_index = 0
            for lp, kk, jj in zip(f.loops, ks, js):
                r, z = K.PROF[kk]
                th = th_of(jj) if not full else 2 * math.pi * jj / steps
                x, y = r * math.cos(th), r * math.sin(th)
                if region == "top":
                    lp[uvl].uv = K.uv_disc(x, y, K.TOP_UV_R, K.TOP_RECT)
                elif region == "bot":
                    lp[uvl].uv = K.uv_disc(x, y, K.BOT_UV_R, K.BOT_RECT, flip=True)
                else:
                    lp[uvl].uv = K.uv_strip(th, K.ARC[kk])

    if not full:
        _add_cut_face(bm, uvl, th0)

    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    _fix_cut_normals(ob, th0)
    return ob


def _add_cut_face(bm, uvl, th0):
    """切り口（皮=material 1）と、少し盛り上がったあん（material 2）。切り口は xz 平面。"""
    ny = -math.cos(th0)                      # 外向き法線の y 成分（th0=0 → -y, th0=π → +y）

    right = [_pos(r, z, 0.0) for (r, z) in K.PROF]
    left = [_pos(r, z, math.pi) for (r, z) in K.PROF if r > 1e-6][::-1]
    cap = [bm.verts.new(c) for c in right + left]
    f = bm.faces.new(cap)
    f.material_index = 1
    f.smooth = False
    for lp in f.loops:
        co = lp.vert.co
        lp[uvl].uv = K.uv_cap(co.x / CM, co.z / CM)
    bmesh.ops.triangulate(bm, faces=[f], quad_method='BEAUTY', ngon_method='BEAUTY')

    nb, nr = 160, 12
    bnd = [K.an_boundary(2 * math.pi * i / nb) for i in range(nb)]
    zc = K.AN_ZC

    def pt(s, z, bulge):
        return (s * CM, bulge * ny * CM, z * CM)

    center = bm.verts.new(pt(0, zc, 0.05))
    center_uv = K.uv_cap(0, zc)
    prev = None
    for k in range(1, nr + 1):
        sc = k / nr
        bulge = 0.006 + 0.044 * (1 - sc ** 2.5)
        ring = [(bm.verts.new(pt(x * sc, zc + (z - zc) * sc, bulge)), K.uv_cap(x * sc, zc + (z - zc) * sc)) for (x, z) in bnd]
        for i in range(nb):
            i2 = (i + 1) % nb
            if prev is None:
                quad = ((center, center_uv), ring[i2], ring[i])
            else:
                quad = (prev[i], prev[i2], ring[i2], ring[i])
            f = bm.faces.new([v for v, _ in quad])
            f.material_index = 2
            f.smooth = True
            for lp, (_, uv) in zip(f.loops, quad):
                lp[uvl].uv = uv
        prev = ring


def _fix_cut_normals(ob, th0):
    ny = -math.cos(th0)
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        if f.material_index in (1, 2) and f.normal.y * ny < 0:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()
