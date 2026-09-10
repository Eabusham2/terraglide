"""Widen a neck where it passes through its collar, so no gap shows round it.

Seen from behind and a little above — which is where a chase camera sits — this
figure's collar read as unattached, with bare skin visible inside it. It is not
a hole and not a shadow: the collar is a closed roll and the neck is a closed
cylinder, and the trouble is that the roll's opening is wider than the neck
inside it. The neck also pinches exactly where it leaves the collar — radius
0.024 at 0.73 of the figure's height, against 0.047 just below and 0.040 just
above — so there is a two-centimetre well round it that the eye reads as the
garment not meeting the body.

Filling that well by painting was tried twice and is the wrong tool. The first
go stamped squares of "the nearest garment colour" at each vertex, and the
nearest garment to a vertex under a collar is the inside of that collar, which
is nearly black: it came out a jagged black zigzag. The second went by triangle
with one colour, and the colour test for "garment" also matched the sage wing,
so it laid wing-grey across the collar's top. Neither was a repair of anything;
both were paint over a shape that is wrong.

So the shape is fixed. Every skin vertex in the band is pushed out from the
neck's own axis until it is as wide as the collar around it, tapering back to
its own radius above the collar so the throat keeps its shape. Texture
coordinates are untouched, so the skin stays skin and nothing shifts in the
atlas.

    python tools/glb-neck.py in.glb out.glb
"""
import io, json, math, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]

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


pos = [list(v) for v in read(prim['attributes']['POSITION'])]
uv = read(prim['attributes']['TEXCOORD_0'])
slot = J['materials'][prim['material']]['pbrMetallicRoughness']['baseColorTexture']
view = J['bufferViews'][J['images'][J['textures'][slot['index']]['source']]['bufferView']]
start = view.get('byteOffset', 0)
img = Image.open(io.BytesIO(bytes(BIN[start:start + view['byteLength']]))).convert('RGB')
W, H = img.size
picture = img.load()

floor = min(v[1] for v in pos)
tall = max(v[1] for v in pos) - floor


def skin(v):
    x = min(W - 1, max(0, int(uv[v][0] * W)))
    y = min(H - 1, max(0, int(uv[v][1] * H)))
    r, g, b = picture[x, y]
    return r - b > 45 and r > 90


# The neck's own axis, from the skin well above the collar. Using the figure's
# midline instead would lean the throat, because a scanned body is not centred.
top = [q for v, q in enumerate(pos) if 0.80 <= (q[1] - floor) / tall <= 0.86 and skin(v)]
if len(top) < 20: raise SystemExit('no neck found to measure')
ax = sum(q[0] for q in top) / len(top)
az = sum(q[2] for q in top) / len(top)


def radius(q): return math.hypot(q[0] - ax, q[2] - az)


# How wide the collar's opening is: the garment nearest the axis, just under
# where the neck comes out.
ring = sorted(radius(q) for v, q in enumerate(pos)
              if 0.705 <= (q[1] - floor) / tall <= 0.728 and not skin(v)
              and radius(q) < 0.20)
if len(ring) < 20: raise SystemExit('no collar found to measure')
# The lip of the opening, not the roll's outer surface: a tenth of the way in
# from the axis. Taking a third put it at 5.2 cm, which is the collar's whole
# thickness, and the neck came out a tree trunk with no throat at all.
opening = ring[len(ring) // 10]

# Short, because the point is to close a line of sight and not to redraw the
# throat: full at the collar's lip and gone four centimetres above it.
"""
  The collar is closed onto the neck, not the neck opened onto the collar.

  Pushing the skin out until it filled the opening did close the line of sight
  and it cost the throat: the neck came out a column as wide as the head, with
  no shape between the two. The well is the collar's, so the collar's inner
  wall is what moves — its outer roll, which is the whole read of the garment
  from any distance, is left exactly where the generator put it.
"""
# How wide the neck is at each height, from the skin itself.
step = 0.005
LOW, HIGH = 0.695, 0.760
thick = {}
for v, q in enumerate(pos):
    h = (q[1] - floor) / tall
    if not (LOW - step <= h <= HIGH + step) or not skin(v): continue
    r = radius(q)
    if r > 0.20: continue
    thick.setdefault(round(h / step), []).append(r)
for k in thick: thick[k] = sorted(thick[k])[len(thick[k]) // 2]

# Welded, because a texture seam is two vertices at one place with different
# coordinates, and only one of them passes a test that reads the picture. Moving
# that one and not its partner pulls the seam apart: it opened ten edges.
at = {}
members = {}
for v, q in enumerate(pos):
    key = (round(q[0], 5), round(q[1], 5), round(q[2], 5))
    if key not in at: at[key] = len(at)
    members.setdefault(at[key], []).append(v)

moved = 0
pulled = 0.0
for group in members.values():
    v = group[0]
    q = pos[v]
    h = (q[1] - floor) / tall
    # A place is garment if any vertex there is: the seam's other side carries
    # the same surface.
    if not (LOW <= h <= HIGH) or all(skin(w) for w in group): continue
    r = radius(q)
    # The inner wall of the collar, not its outer roll: the roll's outside is
    # further out than the opening it surrounds.
    if r <= 1e-6 or r > opening * 1.35: continue
    near = [thick.get(round(h / step) + d) for d in (-1, 0, 1)]
    near = [n for n in near if n]
    if not near: continue
    want = sum(near) / len(near) + 0.004      # a few millimetres of clearance
    if want >= r: continue
    # Only round the back, fading out towards the sides. At the front this
    # collar is not a ring at all — it is two lapels lying open on the chest,
    # with the shirt and the zip between them and no well to close. Pulling
    # those toward the neck's axis tore a dark crease across both of them.
    behind = max(0.0, min(1.0, (az - q[2]) / 0.030))
    if behind <= 0: continue
    scale = 1.0 + (want / r - 1.0) * behind
    for w in group:
        pos[w][0] = ax + (pos[w][0] - ax) * scale
        pos[w][2] = az + (pos[w][2] - az) * scale
    pulled = max(pulled, r - want)
    moved += len(group)

a = J['accessors'][prim['attributes']['POSITION']]
view = J['bufferViews'][a['bufferView']]
base = view.get('byteOffset', 0) + a.get('byteOffset', 0)
stride = view.get('byteStride') or 12
for k in range(a['count']):
    struct.pack_into('<fff', BIN, base + k * stride, *pos[k])
a['min'] = [min(q[i] for q in pos) for i in range(3)]
a['max'] = [max(q[i] for q in pos) for i in range(3)]

js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
blob = bytes(BIN) + b'\0' * (-len(BIN) % 4)
glb = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
       + struct.pack('<I4s', len(js), b'JSON') + js
       + struct.pack('<I4s', len(blob), b'BIN\x00') + blob)
open(dst, 'wb').write(glb)
print(f'  neck axis ({ax:+.4f}, {az:+.4f}); collar opening {opening:.4f}; '
      f'{moved} of its inner wall pulled in, by up to {pulled * 100:.1f} cm '
      f'of a figure one unit tall')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
