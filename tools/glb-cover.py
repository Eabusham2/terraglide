"""Paint the garment over the skin a garment should be covering.

The generator modelled this jacket's collar as a raised roll and its back as a
lower line, and left a band of bare neck between the two. On the figure that
reads as the collar not being attached to anything: from behind, and from
behind and above, a strip of skin runs right across under the collar with
jacket above it and jacket below it.

It is not a hole — the mesh is closed there — and it is not shadow, so nothing
that lifts darkness touches it. The surface is simply painted as skin where a
collar's underside should be.

Which skin is measured rather than boxed. A vertex qualifies when it is skin,
when there is garment both above and below it within a hand's breadth, and when
it is round the back: the front of a neck under an open collar is *meant* to be
bare, and this figure's is, with the shirt showing below it. Those texels then
take the colour of the garment nearest them in space, so the band comes out the
jacket's own green rather than a colour invented here.

    python tools/glb-cover.py in.glb out.glb [back-of]
"""
import io, json, math, struct, sys
from collections import defaultdict
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
# Everything behind this in the file's own z is "round the back". The model
# faces +z here; the loader turns it about Y to face the camera.
BACK = float(sys.argv[3]) if len(sys.argv) > 3 else -0.01

raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off+8])
    if ctype == b'JSON': J = json.loads(raw[off+8:off+8+clen])
    elif ctype == b'BIN\x00': BIN = bytearray(raw[off+8:off+8+clen])
    off += 8 + clen

COMP = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
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
uv = read(prim['attributes']['TEXCOORD_0'])

image = J['images'][J['textures'][prim['material']]['source']] \
    if isinstance(J['textures'][0], dict) and 'source' in J['textures'][0] else None
slot = J['materials'][prim['material']]['pbrMetallicRoughness']['baseColorTexture']
image = J['images'][J['textures'][slot['index']]['source']]
view = J['bufferViews'][image['bufferView']]
start = view.get('byteOffset', 0)
img = Image.open(io.BytesIO(bytes(BIN[start:start + view['byteLength']])))
mode = img.mode
bands = img.split()
W, H = img.size
rgb = [b.load() for b in bands[:3]]

floor = min(v[1] for v in pos)
tall = max(v[1] for v in pos) - floor


def at(v):
    return (min(W - 1, max(0, int(uv[v][0] * W))), min(H - 1, max(0, int(uv[v][1] * H))))


def colour(v):
    x, y = at(v)
    return (rgb[0][x, y], rgb[1][x, y], rgb[2][x, y])


def is_skin(c): return c[0] - c[2] > 45 and c[0] > 90
def is_garment(c): return c[1] >= c[0] and c[1] > c[2] + 12


skin, garment = [], []
for v, q in enumerate(pos):
    h = (q[1] - floor) / tall
    if not 0.55 <= h <= 0.95: continue
    c = colour(v)
    if is_skin(c): skin.append((v, q, h))
    elif is_garment(c): garment.append((q, h, c))

# Bucketed, so "is there garment above and below this" is a lookup rather than
# a walk over every garment vertex for every skin one.
cell = 0.05
near = defaultdict(list)
for q, h, c in garment:
    near[(int(q[0] / cell), int(q[2] / cell))].append((q, h, c))

wanted = []
for v, q, h in skin:
    if q[2] > BACK: continue                       # the front is meant to be bare
    above = below = False
    close = []
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            close += near.get((int(q[0] / cell) + dx, int(q[2] / cell) + dz), [])
    for g, gh, c in close:
        if math.hypot(q[0] - g[0], q[2] - g[2]) > 0.05: continue
        if gh > h + 0.005: above = True
        if gh < h - 0.005: below = True
    if above and below: wanted.append((v, q, close))

"""
  Painted over the triangles, not stamped round the vertices.

  The first go took the median of the garment nearest each vertex and stamped a
  five-texel square at the vertex's own coordinate. Both halves were wrong: the
  nearest garment to a vertex under a collar is the *inside* of that collar,
  which is nearly black, and a square in the atlas is not the shape of anything
  on the body. It came out as a jagged black zigzag round the neck.

  So the colour is taken once, from the lit outside of the collar — the upper
  half by luminance of the garment in the band just above the skin, which is
  the surface this strip is pretending to be part of — and it is laid down by
  rasterising the triangles themselves.
"""
cover = {v for v, _, _ in wanted}
lit = sorted((0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], c)
             for q, h, c in garment if h > 0.70)
if not lit:
    raise SystemExit('no collar to take a colour from')
fresh = lit[len(lit) * 3 // 4][1]

painted = 0
for t in range(0, len(idx), 3):
    corners = [idx[t + k] for k in range(3)]
    if sum(1 for v in corners if v in cover) < 2: continue
    xs = [uv[v][0] * W for v in corners]
    ys = [uv[v][1] * H for v in corners]
    det = (ys[1]-ys[2]) * (xs[0]-xs[2]) + (xs[2]-xs[1]) * (ys[0]-ys[2])
    if abs(det) < 1e-9: continue
    for y in range(max(0, int(min(ys)) - 1), min(H, int(max(ys)) + 2)):
        for x in range(max(0, int(min(xs)) - 1), min(W, int(max(xs)) + 2)):
            l0 = ((ys[1]-ys[2]) * (x+.5-xs[2]) + (xs[2]-xs[1]) * (y+.5-ys[2])) / det
            l1 = ((ys[2]-ys[0]) * (x+.5-xs[2]) + (xs[0]-xs[2]) * (y+.5-ys[2])) / det
            # A texel's worth of slack, so no seam of skin is left along an edge.
            if l0 < -0.08 or l1 < -0.08 or 1 - l0 - l1 < -0.08: continue
            for ch in range(3): rgb[ch][x, y] = fresh[ch]
            painted += 1

out = Image.merge(mode, tuple(bands))
buf = io.BytesIO()
out.save(buf, format='PNG', optimize=True)
payload = buf.getvalue()

blob = bytearray()
views = []
for i, old in enumerate(J['bufferViews']):
    while len(blob) % 4: blob.append(0)
    o = old.get('byteOffset', 0)
    data = payload if i == image['bufferView'] else BIN[o:o + old['byteLength']]
    fresh = dict(old)
    fresh['byteOffset'] = len(blob)
    fresh['byteLength'] = len(data)
    blob.extend(data)
    views.append(fresh)
J['bufferViews'] = views
J['buffers'] = [{'byteLength': len(blob)}]
js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
blob.extend(b'\0' * (-len(blob) % 4))
glb = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
       + struct.pack('<I4s', len(js), b'JSON') + js
       + struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob))
open(dst, 'wb').write(glb)
print(f'  {len(skin)} skin vertices, {len(garment)} of garment; {len(cover)} in the exposed band, {painted} texels painted {fresh}')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
