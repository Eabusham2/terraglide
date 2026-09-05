"""Repaint a patch of a scanned atlas that came back with no light in it.

The generator saw this figure from outside, so the surfaces that face inward
were never lit: the armpits and the undersides of the shoulders came back at a
luminance of 15 against 83 for the sleeve an inch away. Standing still nothing
sees them. In a glide the arms swing a hundred and forty degrees and both of
them are pointed at the camera, which is the pair of black gashes across the
shoulders.

It is not a hole and not a mistake in the mapping — those triangles have the
same texture-area-to-surface-area ratio as their neighbours, so they are
looking exactly where they should. There is simply nothing there.

So it is painted, from the only honest source available: the lit texels of the
same part of the same body. A box is given in the figure's own proportions,
every texel inside it that is darker than the threshold takes the colour of the
lit texels nearest it in space, and everything else in the file is untouched.
That is a repair by hand, and it is described as one rather than dressed up as
an algorithm that found something.

  glb-repaint.py in.glb out.glb x0 x1 y0 y1 [threshold]

with x measured from the midline and y from the sole, both as fractions of the
height of the head — the same numbers src/player/avatar.js lays its joints out
in, so a region can be named from what is wrong on screen.
"""
import json, struct, sys, io
from collections import defaultdict
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
X0, X1, Y0, Y1 = (float(v) for v in sys.argv[3:7])
DARK = float(sys.argv[7]) if len(sys.argv) > 7 else 40.0

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


def read(i):
    a = J['accessors'][i]
    bv = J['bufferViews'][a['bufferView']]
    n = NUM[a['type']]
    size = COMP[a['componentType']] * n
    stride = bv.get('byteStride') or size
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
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
image_i = J['textures'][J['materials'][prim['material']]
                        ['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
bv = J['bufferViews'][J['images'][image_i]['bufferView']]
s = bv.get('byteOffset', 0)
img = Image.open(io.BytesIO(BIN[s:s + bv['byteLength']])).convert('RGB')
W, H = img.size
px = img.load()

# The figure's own frame: midline, sole, and the top of the head for a unit.
lo, hi = pa['min'], pa['max']
tall = hi[1] - lo[1]
cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
crown = max(p[1] for p in pos if abs(p[0] - cx) < tall * 0.06)
scale = 1.0 / (crown - lo[1])

inside = []
for t in range(0, len(idx), 3):
    tri = idx[t:t+3]
    mx = sum(abs((pos[v][0] - cx) * scale) for v in tri) / 3
    my = sum((pos[v][1] - lo[1]) * scale for v in tri) / 3
    if X0 <= mx <= X1 and Y0 <= my <= Y1: inside.append(tri)
print(f'{len(inside)} triangles in the region')

lit = defaultdict(list)      # coarse cell -> lit colours
dim = []
CELL = 0.010 / scale         # a centimetre of the figure, in file units
def cell_of(v):
    return (int(pos[v][0] / CELL), int(pos[v][1] / CELL), int(pos[v][2] / CELL))

for tri in inside:
    for v in tri:
        x = min(int(uv[v][0] * W), W - 1)
        y = min(int(uv[v][1] * H), H - 1)
        c = px[x, y]
        lum = (c[0]*299 + c[1]*587 + c[2]*114) / 1000
        if lum >= DARK: lit[cell_of(v)].append(c)

painted = 0
for tri in inside:
    xs = [uv[v][0] * W for v in tri]
    ys = [uv[v][1] * H for v in tri]
    det = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
    if abs(det) < 1e-12: continue
    # What this triangle's own neighbourhood is lit like.
    near = []
    for v in tri:
        base = cell_of(v)
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                for dz in (-2, -1, 0, 1, 2):
                    near.extend(lit.get((base[0]+dx, base[1]+dy, base[2]+dz), ()))
    if len(near) < 6: continue
    want = tuple(sorted(c[ch] for c in near)[len(near) // 2] for ch in range(3))
    x0, x1 = max(0, int(min(xs))), min(W - 1, int(max(xs)) + 1)
    y0, y1 = max(0, int(min(ys))), min(H - 1, int(max(ys)) + 1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            l0 = ((ys[1]-ys[2]) * (x+0.5-xs[2]) + (xs[2]-xs[1]) * (y+0.5-ys[2])) / det
            l1 = ((ys[2]-ys[0]) * (x+0.5-xs[2]) + (xs[0]-xs[2]) * (y+0.5-ys[2])) / det
            if l0 < -0.02 or l1 < -0.02 or 1 - l0 - l1 < -0.02: continue
            c = px[x, y]
            lum = (c[0]*299 + c[1]*587 + c[2]*114) / 1000
            if lum >= DARK: continue
            # Kept dim, because it is still the inside of a shoulder — just not
            # a hole cut in one.
            px[x, y] = tuple(min(255, int(want[ch] * 0.72)) for ch in range(3))
            painted += 1
print(f'{painted} texels repainted')

buf = io.BytesIO()
was = (J['images'][image_i].get('mimeType') or '').lower()
img.save(buf, 'PNG', optimize=True) if 'png' in was else \
    img.save(buf, 'JPEG', quality=95, optimize=True)
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
