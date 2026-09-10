"""Paint the bare skin between the collar and the jacket with the garment.

From behind, and from behind and a little above - which is where a chase camera
sits - a band of bare skin shows below the collar. Measured rather than argued:
the nape rendered twice from one camera, once with the atlas and once with
every fragment painted its own place on the body, reads down the middle of the
back as skin to 0.733 of the figure's height, then collar, then SKIN again at
0.690 a centimetre and a half further in, then the jacket's back at 0.694
nearer the camera. So the band is the neck's own tube, seen through the slit
between the collar's lower lip and the yoke. A jacket does not show flesh
there: it goes up to its collar.

Five earlier attempts at this failed on one thing, which is worth keeping
written down. They tested "is this texel skin" as red well clear of blue. This
jacket is olive - high red, higher green, low blue - so the collar's own
(115, 128, 27) passed that test as comfortably as a cheek does, and the repairs
painted the collar instead of the neck. One laid a green stripe across it;
another read the sage wing as bare skin. Skin is the only thing on this figure
whose red leads its *green*, and in proportion rather than by a fixed margin.

The line the neck has to stop at is the collar's rim, and the rim is not one
height: it runs 0.733 of the figure at the back down to 0.677 at the throat,
which is what a collar does. So it is measured every few degrees round the
neck's own axis and interpolated, and every skin texel below it takes the
colour of the garment nearest to it in three dimensions - not the median of
that garment, which is the inside of the collar and nearly black, but its
brighter end, which is the cloth you would actually see through a slit.

    python tools/glb-collar.py in.glb out.glb
"""
import io, json, math, struct, sys
from collections import defaultdict
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
# How far round the neck each rim measurement stands for.
STEP = 5
# How far from the neck's axis counts as the neck rather than a shoulder.
NEAR = 0.09
# And how far out the *collar* stands. The rim has to be measured from the part
# of the collar that hides the neck from outside - its outer wall - because its
# inner wall stands higher than that, and taking the highest garment of any
# kind put the line above the collar's own edge and painted the neck you can
# actually see.
WALL = 0.05
# tools/glb-pad.py fills this atlas's gutter from the charts around it, so the
# texels just outside a chart hold a copy of the skin inside it. Repainting
# only what a triangle covers leaves that copy behind, and it draws every chart
# on the neck in its own original colour - the orange streaks through the first
# green. The paint is carried this far out past the chart edges.
GUTTER = 4
# And stop this far below the rim. The rim is measured from triangles, and the
# collar's real edge is a ragged line through them, so painting right up to it
# put green on the neck you can see - in patches, following that raggedness.
# The band this exists for sits three and a half centimetres below the rim, so
# half a centimetre of margin costs it nothing.
MARGIN = next((float(a[9:]) for a in sys.argv if a.startswith('--margin=')), 0.012)
# How far to look for the garment to copy, and which end of it to take.
LOOK = 0.03
LIT = 0.70

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
slot = J['materials'][prim['material']]['pbrMetallicRoughness']['baseColorTexture']
picture = J['images'][J['textures'][slot['index']]['source']]
view = J['bufferViews'][picture['bufferView']]
start = view.get('byteOffset', 0)
img = Image.open(io.BytesIO(bytes(BIN[start:start + view['byteLength']])))
mode = img.mode
bands = img.split()
W, H = img.size
rgb = [b.load() for b in bands[:3]]


def texels(t):
    """Every texel this triangle covers, with its barycentric weights."""
    a, b, c = (idx[t + k] for k in range(3))
    xs = [uv[v][0] * W for v in (a, b, c)]
    ys = [uv[v][1] * H for v in (a, b, c)]
    det = (ys[1]-ys[2]) * (xs[0]-xs[2]) + (xs[2]-xs[1]) * (ys[0]-ys[2])
    if abs(det) < 1e-9: return
    for y in range(max(0, int(min(ys))), min(H, int(max(ys)) + 1)):
        for x in range(max(0, int(min(xs))), min(W, int(max(xs)) + 1)):
            l0 = ((ys[1]-ys[2]) * (x+.5-xs[2]) + (xs[2]-xs[1]) * (y+.5-ys[2])) / det
            l1 = ((ys[2]-ys[0]) * (x+.5-xs[2]) + (xs[0]-xs[2]) * (y+.5-ys[2])) / det
            if l0 < 0 or l1 < 0 or 1 - l0 - l1 < 0: continue
            yield x, y, l0, l1


def is_skin(c):
    """Warm and reddest - see the note above for why red-minus-blue is not."""
    return c[0] > c[1] * 1.25 and c[1] > c[2] * 1.1 and c[0] > 40


floor = min(q[1] for q in pos)
tall = max(q[1] for q in pos) - floor
here = {}
skinny = set()
for t in range(0, len(idx), 3):
    a, b, c = (idx[t + k] for k in range(3))
    seen = []
    for x, y, l0, l1 in texels(t):
        seen.append((x, y, tuple(pos[a][i] * l0 + pos[b][i] * l1 + pos[c][i] * (1 - l0 - l1)
                                 for i in range(3))))
    if not seen: continue
    here[t] = seen
    warm = sum(1 for x, y, _ in seen if is_skin((rgb[0][x, y], rgb[1][x, y], rgb[2][x, y])))
    if warm * 2 > len(seen): skinny.add(t)

# The neck's own axis, from the skin between the jaw and the collar.
column = [p for t in skinny for _, _, p in here[t]
          if 0.75 <= (p[1] - floor) / tall <= 0.80]
ax = sum(p[0] for p in column) / len(column)
az = sum(p[2] for p in column) / len(column)


def out_from_neck(p): return math.hypot(p[0] - ax, p[2] - az)


def around_neck(p):
    """Degrees round the neck: 0 straight back, +/-180 the throat."""
    return math.degrees(math.atan2(p[0] - ax, az - p[2]))


def lift(p): return (p[1] - floor) / tall


# The rim, every few degrees: the highest the garment reaches close in.
rim = {}
for t in here:
    if t in skinny: continue
    for _, _, p in here[t]:
        if not WALL <= out_from_neck(p) <= 0.085: continue
        if not 0.55 <= lift(p) <= 0.80: continue
        slice_at = round(around_neck(p) / STEP) * STEP
        if slice_at == -180: slice_at = 180
        rim[slice_at] = max(rim.get(slice_at, 0), lift(p))


def rim_at(degrees):
    """Between the two measured slices either side of this angle."""
    low = math.floor(degrees / STEP) * STEP
    a = rim.get(low if low != -180 else 180)
    b = rim.get(low + STEP if low + STEP != -180 else 180)
    if a is None or b is None: return None
    return a + (b - a) * (degrees - low) / STEP


# The garment, in a grid, so the nearest of it to a given place is findable.
CELL = LOOK
cloth = defaultdict(list)
for t in here:
    if t in skinny: continue
    for x, y, p in here[t]:
        cloth[(int(p[0] // CELL), int(p[1] // CELL), int(p[2] // CELL))].append(
            (p, (rgb[0][x, y], rgb[1][x, y], rgb[2][x, y])))

painted = 0
missed = 0
fresh_at = {}
for t in skinny:
    for x, y, p in here[t]:
        if out_from_neck(p) > NEAR: continue
        edge = rim_at(around_neck(p))
        if edge is None or lift(p) >= edge - MARGIN: continue
        cell = (int(p[0] // CELL), int(p[1] // CELL), int(p[2] // CELL))
        nearby = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in (-1, 0, 1):
                    for q, colour in cloth.get((cell[0]+i, cell[1]+j, cell[2]+k), ()):
                        gap = math.dist(p, q)
                        if gap < LOOK: nearby.append((gap, colour))
        if not nearby:
            missed += 1
            continue
        # The brighter end of the cloth nearby, not its middle: the middle of
        # the garment beside a slit is the inside of the collar, which is
        # nearly black, and an earlier repair that took it came out a jagged
        # black zigzag.
        nearby.sort(key=lambda hit: 0.299 * hit[1][0] + 0.587 * hit[1][1] + 0.114 * hit[1][2])
        fresh = nearby[min(len(nearby) - 1, int(len(nearby) * LIT))][1]
        fresh_at[(x, y)] = fresh
        painted += 1

covered = {(x, y) for seen in here.values() for x, y, _ in seen}
for _ in range(GUTTER):
    spread = {}
    for (x, y), colour in fresh_at.items():
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                at = (x + dx, y + dy)
                if at in fresh_at or at in covered: continue
                if not (0 <= at[0] < W and 0 <= at[1] < H): continue
                spread.setdefault(at, []).append(colour)
    for at, colours in spread.items():
        fresh_at[at] = tuple(sum(c[ch] for c in colours) // len(colours) for ch in range(3))
for (x, y), colour in fresh_at.items():
    for ch in range(3): rgb[ch][x, y] = colour[ch]

out = Image.merge(mode, tuple(bands))
buf = io.BytesIO()
out.save(buf, format='PNG', optimize=True)
payload = buf.getvalue()
blob = bytearray()
views = []
for i, old in enumerate(J['bufferViews']):
    while len(blob) % 4: blob.append(0)
    o = old.get('byteOffset', 0)
    data = payload if i == picture['bufferView'] else BIN[o:o + old['byteLength']]
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
open(dst, 'wb').write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
                     + struct.pack('<I4s', len(js), b'JSON') + js
                     + struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob))
print(f'  rim {min(rim.values()):.3f} at the throat to {max(rim.values()):.3f} at the nape')
print(f'  {painted} texels of skin below it took the garment beside them, '
      f'and {len(fresh_at) - painted} more in the gutter around them'
      + (f'; {missed} had no garment within {LOOK * 100:.0f} cm' if missed else ''))
print(f'{src} {len(raw)} -> {dst} {len(open(dst, "rb").read())} bytes')
