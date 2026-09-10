"""Repaint the islands of skin stranded in the middle of a garment.

Between this jacket's collar and its shoulder there is a wedge of bare skin —
a few triangles, tucked in the crease, painted the colour of a neck. A jacket
does not do that: it goes up to its collar. The surface is closed and the fold
is a normal fold (the same mesh in flat white is smooth there), so what is
wrong is the picture on it.

Four earlier attempts are worth recording, because each failed for a reason
that says something about the file:

  * two classified *vertices* by the one texel their coordinate lands on. On an
    atlas packed edge to edge a vertex sits on a chart's boundary as often as
    not, so the classification was noise — one of them decided the collar
    itself was skin;
  * one took its replacement colour from "the nearest garment", and the nearest
    garment to a wedge under a collar is the *inside* of that collar, which is
    nearly black. It came out a jagged black zigzag;
  * one repainted every texel that passed a colour test, which alternates
    texel by texel near a boundary, so the repair had a sawtooth edge.

What is stable is the shape of the fault, not its colour: it is an *island* —
a small patch of skin entirely surrounded by garment — and an island can be
found by connectivity rather than by threshold. So triangles are classified by
what most of their texels are, joined into runs across shared edges, and any
run of skin small enough to be a wedge rather than a neck is repainted with the
median of the garment that surrounds it. The edges of the repair are the mesh's
own triangle edges, which is why it has no sawtooth.

    python tools/glb-hem.py in.glb out.glb [biggest-island]
"""
import io, json, struct, sys
from collections import defaultdict, deque
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
# A neck is thousands of triangles; a wedge in a crease is tens.
ISLAND = int(sys.argv[3]) if len(sys.argv) > 3 else 400

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
    """Every texel this triangle covers, as (x, y)."""
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
            yield x, y


def is_skin(c):
    """Warm *and* reddest: red clear of green, green clear of blue.

    In proportion rather than in counts, because this same test has to
    recognise skin after tools/glb-shade.py has taken three quarters of the
    light out of it: (181, 105, 68) in a crevice becomes (45, 26, 17), which is
    still plainly skin and fails every fixed margin.

    The obvious test - red well clear of blue - is wrong on this model and was
    wrong for five attempts before this one. The jacket is olive, and olive is
    high red, higher green, low blue: the collar's own (115, 128, 27) passes
    "red minus blue over 45" as comfortably as a cheek does. That is why an
    earlier repair laid a green stripe across the collar and why one before it
    read the sage wing as bare skin. Skin is the only thing here whose red
    leads its green."""
    return c[0] > c[1] * 1.25 and c[1] > c[2] * 1.1 and c[0] > 40


# What each triangle is, decided by most of its own texels rather than by one.
paint = {}
skinny = set()
for t in range(0, len(idx), 3):
    seen = list(texels(t))
    if not seen: continue
    paint[t] = seen
    warm = sum(1 for x, y in seen if is_skin((rgb[0][x, y], rgb[1][x, y], rgb[2][x, y])))
    if warm * 2 > len(seen): skinny.add(t)

# Joined across shared edges, welded so a texture seam does not cut a run in two.
at, weld = {}, [0] * len(pos)
for v, q in enumerate(pos):
    key = (round(q[0], 5), round(q[1], 5), round(q[2], 5))
    if key not in at: at[key] = len(at)
    weld[v] = at[key]
touching = defaultdict(list)
for t in paint:
    a, b, c = (weld[idx[t + k]] for k in range(3))
    for u, v in ((a, b), (b, c), (c, a)):
        touching[(u, v) if u < v else (v, u)].append(t)

islands = []
seen = set()
for start_at in skinny:
    if start_at in seen: continue
    run = [start_at]
    seen.add(start_at)
    queue = deque([start_at])
    while queue:
        t = queue.popleft()
        a, b, c = (weld[idx[t + k]] for k in range(3))
        for u, v in ((a, b), (b, c), (c, a)):
            for other in touching[(u, v) if u < v else (v, u)]:
                if other in skinny and other not in seen:
                    seen.add(other); run.append(other); queue.append(other)
    islands.append(run)
islands.sort(key=len, reverse=True)

painted = 0
mended = 0
for run in islands:
    if len(run) > ISLAND: continue           # this is the neck, or the face
    inside = set(run)
    around = []
    for t in run:
        a, b, c = (weld[idx[t + k]] for k in range(3))
        for u, v in ((a, b), (b, c), (c, a)):
            for other in touching[(u, v) if u < v else (v, u)]:
                if other in inside: continue
                around += [(rgb[0][x, y], rgb[1][x, y], rgb[2][x, y]) for x, y in paint[other]]
    around = [c for c in around if not is_skin(c)]
    if len(around) < 12: continue
    fresh = tuple(sorted(c[ch] for c in around)[len(around) // 2] for ch in range(3))
    for t in run:
        for x, y in paint[t]:
            for ch in range(3): rgb[ch][x, y] = fresh[ch]
            painted += 1
    mended += 1

"""
  The other fault is not paint, and it is not here.

  There is also a band of bare neck showing *below* the collar at the back, and
  five attempts to repaint it live in this file's history. The last of them
  measured why none of them could work: the neck at that height is seen through
  two openings at once — through the slit under the collar from a low camera,
  and over the collar's rim from a high one — so any rule on height or angle
  that greens the first also greens the second, and every threshold drew a hard
  line across a place the eye follows. What is missing there is not colour but
  shadow, and tools/glb-shade.py measures and bakes it.
"""

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
sizes = ', '.join(str(len(r)) for r in islands[:6])
print(f'  {len(skinny)} triangles of skin in {len(islands)} runs (biggest: {sizes})')
print(f'  {mended} of them were islands; {painted} texels repainted')
print(f'{src} {len(raw)} -> {dst} {len(open(dst, "rb").read())} bytes')
