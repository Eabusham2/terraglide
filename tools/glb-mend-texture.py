"""Mend the patches in a scanned texture that are nothing like the body around them.

A generated atlas has bad texels in it. Some are black — the armpits and the
insides of the sleeves, which were in shadow when the reference was made and
came out with no colour at all, and which the moment an arm swings read as a
gash cut into the shoulder. Some are pale — slivers up a trouser leg and across
the toe of a boot where a chart edge caught the background instead of the
garment. They are not holes: the same mesh rendered plain white has neither.

They cannot be found in the picture, because the atlas is cut into thousands of
small charts and two texels side by side are routinely opposite ends of the
figure. They can be found on the *body*. Every texel is put back on the mesh it
came from, and each one is then compared with the other texels within a
centimetre or two of it on the surface — its actual neighbours, wherever they
happen to live in the atlas. A texel far darker or far paler than all of them is
not detail, it is damage, and it is replaced with what its neighbours agree on.

Only outliers are touched. A zip, a pocket flap and a seam all differ from the
cloth beside them by far less than the threshold, so they survive; a black hole
in the middle of an olive sleeve does not.

Usage: glb-mend-texture.py in.glb out.glb [threshold] [radius-as-fraction]
"""
import json, math, struct, sys, io
from collections import defaultdict
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
THRESH = float(sys.argv[3]) if len(sys.argv) > 3 else 42.0
RADIUS = float(sys.argv[4]) if len(sys.argv) > 4 else 0.014
ROUNDS = 2

raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off+8])
    if ctype == b'JSON': J = json.loads(raw[off+8:off+8+clen])
    elif ctype == b'BIN\x00': BIN = bytes(raw[off+8:off+8+clen])
    off += 8 + clen

COMP = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
SCALE = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


def stride_of(a, bv):
    size = COMP[a['componentType']] * NUM[a['type']]
    if bv.get('byteStride'): return bv['byteStride']
    pad = (size + 3) // 4 * 4
    span = bv['byteLength'] - a.get('byteOffset', 0)
    if size % 4 and a['count'] and span == a['count'] * pad: return pad
    return size


def read(i):
    a = J['accessors'][i]
    bv = J['bufferViews'][a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NUM[a['type']]
    stride = stride_of(a, bv)
    f = FMT[a['componentType']]
    vals = [list(struct.unpack_from(f'<{n}{f}', BIN, start + e * stride))
            for e in range(a['count'])]
    if a.get('normalized') and a['componentType'] in SCALE:
        s = SCALE[a['componentType']]
        vals = [[max(c / s, -1.0) for c in row] for row in vals]
    return vals, a


prim = J['meshes'][0]['primitives'][0]
pos, pa = read(prim['attributes']['POSITION'])
uv, _ = read(prim['attributes']['TEXCOORD_0'])
idx = [v[0] for v in read(prim['indices'])[0]]
mat = J['materials'][prim['material']]
image_i = J['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
bv = J['bufferViews'][J['images'][image_i]['bufferView']]
s = bv.get('byteOffset', 0)
img = Image.open(io.BytesIO(BIN[s:s + bv['byteLength']])).convert('RGB')
W, H = img.size
px = img.load()

# Every covered texel, and where on the body it is.
where = {}
for t in range(0, len(idx), 3):
    a, b, c = idx[t], idx[t+1], idx[t+2]
    xs = [uv[a][0] * W, uv[b][0] * W, uv[c][0] * W]
    ys = [uv[a][1] * H, uv[b][1] * H, uv[c][1] * H]
    x0, x1 = max(0, int(min(xs))), min(W - 1, int(max(xs)) + 1)
    y0, y1 = max(0, int(min(ys))), min(H - 1, int(max(ys)) + 1)
    det = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
    if abs(det) < 1e-12: continue
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            l0 = ((ys[1] - ys[2]) * (x + 0.5 - xs[2]) + (xs[2] - xs[1]) * (y + 0.5 - ys[2])) / det
            l1 = ((ys[2] - ys[0]) * (x + 0.5 - xs[2]) + (xs[0] - xs[2]) * (y + 0.5 - ys[2])) / det
            l2 = 1 - l0 - l1
            if l0 < -0.02 or l1 < -0.02 or l2 < -0.02: continue
            where[(x, y)] = tuple(
                pos[a][k] * l0 + pos[b][k] * l1 + pos[c][k] * l2 for k in range(3))

tall = max(pa['max'][i] - pa['min'][i] for i in range(3))
cell = tall * RADIUS
grid = defaultdict(list)
for key, p in where.items():
    grid[(int(p[0] / cell), int(p[1] / cell), int(p[2] / cell))].append(key)
print(f'{len(where)} texels on the body, in {len(grid)} cells of {cell:.4f}')

mended = 0
for round_ in range(ROUNDS):
    # What each cell of the body looks like, worked out once.
    #
    # Comparing every texel against every texel in the twenty-seven cells
    # around it gives the same answer and takes about four hundred million
    # comparisons — minutes of Python for a job that should take seconds. A
    # cell's own middle colour is that same summary, computed once and read
    # back twenty-seven times.
    middle = {}
    for cellkey, members in grid.items():
        rgb = [px[k] for k in members]
        lum = sorted((c[0]*299 + c[1]*587 + c[2]*114) / 1000.0 for c in rgb)
        middle[cellkey] = (
            lum[len(lum) // 2],
            tuple(sorted(c[ch] for c in rgb)[len(rgb) // 2] for ch in range(3)),
            len(rgb),
        )
    changes = {}
    for key, p in where.items():
        base = (int(p[0] / cell), int(p[1] / cell), int(p[2] / cell))
        lums = []
        cols = []
        weight = 0
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    got = middle.get((base[0]+dx, base[1]+dy, base[2]+dz))
                    if not got: continue
                    lums.append(got[0])
                    cols.append(got[1])
                    weight += got[2]
        if weight < 30 or not lums: continue
        lums.sort()
        around = lums[len(lums) // 2]
        me = px[key]
        mine = (me[0]*299 + me[1]*587 + me[2]*114) / 1000.0
        if abs(mine - around) <= THRESH: continue
        changes[key] = tuple(
            sorted(c[ch] for c in cols)[len(cols) // 2] for ch in range(3))
    for key, colour in changes.items(): px[key] = colour
    mended += len(changes)
    print(f'  round {round_ + 1}: mended {len(changes)} texels')

print(f'{mended} texels mended ({100 * mended / max(len(where), 1):.1f}% of the body)')

buf = io.BytesIO()
img.save(buf, 'JPEG', quality=92, optimize=True)
new_image = buf.getvalue()

out = bytearray()
views = []
def add_view(data, **extra):
    while len(out) % 4: out.append(0)
    v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
    v.update(extra)
    out.extend(data)
    views.append(v)
    return len(views) - 1

remap = {}
for i, view in enumerate(J['bufferViews']):
    st = view.get('byteOffset', 0)
    data = new_image if i == J['images'][image_i]['bufferView'] else BIN[st:st + view['byteLength']]
    extra = {k: view[k] for k in ('byteStride', 'target') if k in view}
    remap[i] = add_view(data, **extra)
for acc in J['accessors']:
    if 'bufferView' in acc: acc['bufferView'] = remap[acc['bufferView']]
for im in J.get('images', []):
    if 'bufferView' in im: im['bufferView'] = remap[im['bufferView']]
J['bufferViews'] = views
J['buffers'] = [{'byteLength': len(out)}]

js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
out.extend(b'\0' * (-len(out) % 4))
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out))
glb += struct.pack('<I4s', len(js), b'JSON') + js
glb += struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out)
open(dst, 'wb').write(glb)
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
