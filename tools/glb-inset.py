"""Pull a chart's texture coordinates off its own edge, so nothing samples its neighbour.

This atlas is packed edge to edge: 34.7% of it is inside a chart and the rest
is gutter, but where two charts are packed against each other there is no
gutter between them at all. A triangle at the edge of a chart then samples a
texel that straddles the boundary — and if what is packed next door is pale,
which on this figure it often is, the surface draws a hairline of it. That is
the pale streak down the trouser leg, and it is why nothing found it: it is not
in the geometry (the same mesh in flat white with its contrast stretched is
smooth), not a distortion of the mapping (no leg triangle is stretched or
squeezed by so much as a factor of three), and not an outlier among the
trouser's own texels, because the texels drawing it belong to another chart.

Turning filtering off does not fix it, which is worth saying because it sounds
like it should: nearest sampling still picks the one texel the coordinate lands
in, and a coordinate on a chart's edge lands in a texel the boundary runs
through. The fix has to move the coordinate.

So every coordinate that sits on a chart's edge is moved a texel inward, along
the triangle it belongs to. A chart's edge is found from the mesh: an edge
whose two triangles give it different coordinates is a cut in the surface, and
an edge with only one triangle is the mesh's own border. Coordinates inside a
chart are not touched, so nothing shifts across a chart's interior and no facet
edges appear. A texel of 1024 is a millimetre on a figure this size.

    python tools/glb-inset.py in.glb out.glb [texels]
"""
import json, struct, sys
from collections import defaultdict

src, dst = sys.argv[1], sys.argv[2]
TEXELS = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off+8])
    if ctype == b'JSON': J = json.loads(raw[off+8:off+8+clen])
    elif ctype == b'BIN\x00': BIN = bytearray(raw[off+8:off+8+clen])
    off += 8 + clen

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
        5125: ('I', 4), 5126: ('f', 4)}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
prim = J['meshes'][0]['primitives'][0]


def read(index):
    a = J['accessors'][index]
    view = J['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NUM[a['type']]
    base = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    step = view.get('byteStride') or size * n
    return [struct.unpack_from('<' + fmt * n, BIN, base + k * step) for k in range(a['count'])]


idx = [v[0] for v in read(prim['indices'])]
pos = read(prim['attributes']['POSITION'])
uv = [list(v) for v in read(prim['attributes']['TEXCOORD_0'])]

size = 1024
for image in J.get('images', []):
    pass                       # the size is taken from the sampler's picture below
tex = J['textures'][J['materials'][prim['material']]['pbrMetallicRoughness']
                    ['baseColorTexture']['index']]
view = J['bufferViews'][J['images'][tex['source']]['bufferView']]
start = view.get('byteOffset', 0)
head = bytes(BIN[start:start + 32])
if head[:8] == b'\x89PNG\r\n\x1a\n':
    size = struct.unpack('>I', head[16:20])[0]
step = TEXELS / size

# Welded by position, so a cut in the surface can be told from a fold in it.
at, weld = {}, [0] * len(pos)
for v, xyz in enumerate(pos):
    key = (round(xyz[0], 5), round(xyz[1], 5), round(xyz[2], 5))
    if key not in at: at[key] = len(at)
    weld[v] = at[key]

uses = defaultdict(list)
for t in range(0, len(idx), 3):
    a, b, c = idx[t], idx[t+1], idx[t+2]
    for u, v in ((a, b), (b, c), (c, a)):
        wu, wv = weld[u], weld[v]
        uses[(wu, wv) if wu < wv else (wv, wu)].append((u, v, t))

seam = set()
for key, group in uses.items():
    corners = {tuple(sorted((round(uv[u][0], 6), round(uv[u][1], 6)) for u in (a, b)))
               for a, b, _ in group}
    # A cut in the surface, or its border: either way, a chart's edge.
    if len(group) < 2 or len(corners) > 1:
        for a, b, _ in group: seam.add((a, b) if a < b else (b, a))

shift = defaultdict(lambda: [0.0, 0.0, 0])
for t in range(0, len(idx), 3):
    a, b, c = idx[t], idx[t+1], idx[t+2]
    mu = (uv[a][0] + uv[b][0] + uv[c][0]) / 3
    mv = (uv[a][1] + uv[b][1] + uv[c][1]) / 3
    for u, v in ((a, b), (b, c), (c, a)):
        if ((u, v) if u < v else (v, u)) not in seam: continue
        for w in (u, v):
            # Toward the middle of the triangle this coordinate belongs to,
            # which is by construction inside the chart.
            dx, dy = mu - uv[w][0], mv - uv[w][1]
            length = (dx * dx + dy * dy) ** 0.5
            if length < 1e-9: continue
            # Never more than a quarter of the way to the middle of the triangle.
            # A fixed number of texels is a small nudge on a large chart and a
            # large one on a small chart: at five texels flat, the small charts
            # across the back of the jacket shrank far enough to show their own
            # boundaries as hard-edged blocks, while the leg — whose charts are
            # big — was still improving. Capping it lets the leg have five.
            by = min(step, length * 0.25)
            shift[w][0] += dx / length * by
            shift[w][1] += dy / length * by
            shift[w][2] += 1

moved = 0
for w, (dx, dy, n) in shift.items():
    if not n: continue
    uv[w][0] += dx / n
    uv[w][1] += dy / n
    moved += 1

a = J['accessors'][prim['attributes']['TEXCOORD_0']]
view = J['bufferViews'][a['bufferView']]
fmt, wide = COMP[a['componentType']]
base = view.get('byteOffset', 0) + a.get('byteOffset', 0)
stride = view.get('byteStride') or wide * 2
if a['componentType'] != 5126:
    raise SystemExit('texture coordinates are not float; nothing here writes them back')
for k in range(a['count']):
    struct.pack_into('<ff', BIN, base + k * stride, uv[k][0], uv[k][1])

js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
blob = bytes(BIN) + b'\0' * (-len(BIN) % 4)
glb = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
       + struct.pack('<I4s', len(js), b'JSON') + js
       + struct.pack('<I4s', len(blob), b'BIN\x00') + blob)
open(dst, 'wb').write(glb)
print(f'  atlas {size}px; {len(seam)} chart-edge edges; {moved} coordinates pulled '
      f'{TEXELS} texel inward')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
