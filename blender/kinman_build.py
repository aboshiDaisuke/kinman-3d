"""金萬のメッシュ生成（Blender 内で exec して使う）。

build_kinman(name, theta=(0, 2π)) で旋盤状のメッシュを作る。形とUV配置は kinman_shape.py。
丸ごと1個も、半分ずつも同じ1個体（seed）から作るので、割っても形がずれない。
UV は BakeUV の1つだけ（全ピースで1組のテクスチャを共有）。単位はメートル（実寸）。
"""
import bpy, bmesh, math, sys, importlib

sys.path.insert(0, "/Users/daisuke/Desktop/金満/blender")
import kinman_shape as K
importlib.reload(K)

CM = 0.01


def _pos(r, z, th, seed=0):
    rr, zz = K.wobble(r, z, th, seed)
    return (rr * math.cos(th) * CM, rr * math.sin(th) * CM, zz * CM)


def build_kinman(name, theta=(0.0, 2 * math.pi), steps=256, collection=None, seed=0):
    th0, th1 = theta
    full = abs((th1 - th0) - 2 * math.pi) < 1e-6
    n_th = steps if full else int(round(steps * (th1 - th0) / (2 * math.pi))) + 1
    th_of = (lambda j: th0 + (th1 - th0) * j / steps) if full else (lambda j: th0 + (th1 - th0) * j / (n_th - 1))

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("BakeUV")

    rings = []
    for (r, z) in K.PROF:
        if r < 1e-6:
            rings.append([bm.verts.new(_pos(0, z, 0, seed))])
        else:
            rings.append([bm.verts.new(_pos(r, z, th_of(j), seed)) for j in range(n_th)])

    jmax = n_th if full else n_th - 1
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        region = "top" if k >= K.K_TOP else ("bot" if k + 1 <= K.K_BOT else "strip")
        for j in range(jmax):
            j2 = (j + 1) % n_th
            if len(A) == 1:              # 底の中心: 四角形と同じ向き（外向き）に巻く
                vs, ks, js = (A[0], B[j2], B[j]), (k, k + 1, k + 1), (j, j + 1, j)
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
        _add_cut_face(bm, uvl, th0, seed)
        _break(bm, seed)

    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    _fix_cut_normals(ob, th0)
    return ob


def _add_cut_face(bm, uvl, th0, seed=0):
    """切り口。中心から放射状に輪を重ねたメッシュで、外側の輪（皮に接する生地 = material 1）と
    内側（あん = material 2）に分ける。外周は側面の頂点と同じ位置に置くので隙間はできない。"""
    right = [_pos(r, z, 0.0, seed) for (r, z) in K.PROF]
    left = [_pos(r, z, math.pi, seed) for (r, z) in K.PROF if r > 1e-6][::-1]
    outer = [(x / CM, z / CM) for (x, _y, z) in right + left]
    zc = K.AN_ZC

    # 中心から見た向き phi ごとの、あんの境界までの距離（境界線を細かく引いて角度で補間）
    samples = []
    for i in range(2048):
        s_, z_ = K.an_boundary(2 * math.pi * i / 2048)
        samples.append((math.atan2(z_ - zc, s_), math.hypot(s_, z_ - zc)))
    samples.sort()
    samples = [(a - 2 * math.pi, d) for a, d in samples[-2:]] + samples + [(a + 2 * math.pi, d) for a, d in samples[:2]]

    def an_dist(phi):
        lo, hi = 0, len(samples) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if samples[mid][0] <= phi:
                lo = mid
            else:
                hi = mid
        (a0, d0), (a1, d1) = samples[lo], samples[hi]
        return d0 + (d1 - d0) * (phi - a0) / max(a1 - a0, 1e-9)

    NC, NA = 6, 22                            # 生地の輪の数、あんの輪の数
    rings = []                                # 外側 → 内側。各輪は外周と同じ数の点
    for (xo, zo) in outer:
        phi = math.atan2(zo - zc, xo)
        da = min(an_dist(phi), math.hypot(xo, zo - zc) - 0.02)
        xa, za = da * math.cos(phi), zc + da * math.sin(phi)
        col = []
        for k in range(NC + 1):               # 外周 → あんの境界
            t = k / NC
            col.append((xo + (xa - xo) * t, zo + (za - zo) * t))
        for k in range(1, NA):                # あんの境界 → 中心の手前（内側ほど細かく）
            t = (k / NA) ** 0.85
            col.append((xa * (1 - t), za + (zc - za) * t))
        rings.append(col)

    def vert(sz):
        v = bm.verts.new((sz[0] * CM, 0.0, sz[1] * CM))
        return v, K.uv_cap(*sz)

    grid = [[vert(p) for p in col] for col in rings]
    center = vert((0.0, zc))
    n = len(outer)
    depth = len(rings[0])
    for i in range(n):
        i2 = (i + 1) % n
        for k in range(depth):
            mat = 1 if k < NC else 2
            if k + 1 < depth:
                quad = (grid[i][k], grid[i2][k], grid[i2][k + 1], grid[i][k + 1])
            else:
                quad = (grid[i][k], grid[i2][k], center)
            f = bm.faces.new([v for v, _ in quad])
            f.material_index = mat
            f.smooth = True
            for lp, (_, uv) in zip(f.loops, quad):
                lp[uvl].uv = uv


def _break(bm, seed=0):
    """割れ目のでこぼこ: 切り口の近くの頂点を y 方向にずらす（kinman_shape.break_offset）。"""
    for v in bm.verts:
        w = K.break_weight(v.co.y / CM)
        if w > 0:
            v.co.y += K.break_offset(v.co.x / CM, v.co.z / CM, seed) * w * CM


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
