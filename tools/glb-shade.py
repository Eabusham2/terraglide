"""Bake the shadow that the collar casts on the neck into the atlas.

The fault this is for: looking down at the back of the figure there is a band
of bare skin *below* the collar. Measured — the nape rendered twice from one
camera, once with the atlas and once with every fragment painted its own place
on the body — it is the neck itself, at 0.69 of the figure's height and 1.4 cm
in front of the jacket's back, seen through the slit between the collar's lower
lip and the yoke. A jacket does not show flesh there.

Four attempts to *repaint* it failed, and the last of them says why the whole
approach was wrong: the neck at that height is also visible from a steeper
camera, over the collar's rim, inside the collar. It is one surface seen
through two openings, so no rule on height or angle can green one and leave the
other, and every threshold put a hard line across a place the eye follows.

What is actually missing is light. The generator baked none: a crevice a
centimetre deep is painted the same brightness as a cheek, so the slit reads as
flesh rather than as a fold. So this measures the thing that is missing —
for each texel on the neck, the fraction of its own hemisphere that the rest of
the model blocks — and multiplies it into the colour. Deep in the slit that is
most of the sky and the band goes dark; on the exposed throat it is almost
none and nothing changes. There is no threshold anywhere in it, which is why
there is no line: the fold darkens the way a fold does.

Ambient occlusion is normalised so that the *open* neck keeps its own colour —
the brightest fifth of the region is taken as unoccluded — and floored, so the
deepest crevice keeps a tenth of its colour rather than going to black.

    python tools/glb-shade.py in.glb out.glb [rays]

Wants numpy (pip install numpy) as well as Pillow: it is a few hundred million
ray-triangle tests and pure Python is hours.
"""
import io, json, math, struct, sys
from collections import defaultdict
from PIL import Image
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
RAYS = int(sys.argv[3]) if len(sys.argv) > 3 else 96
# How far a blocker counts. The collar is a centimetre away; the chest is not
# what makes the side of a neck dark, and counting it darkened the whole
# throat. Five centimetres on a figure 0.77 units tall is about a hand's width
# on a person.
REACH = 0.05
# What counts as open sky - the brightest tenth of the region keeps its own
# colour - and how dark the deepest crevice is allowed to go.
OPEN = 0.90
FLOOR = 0.15
# A hemisphere sampled 96 times still has speckle in it, and speckle on a neck
# reads as dirt. Averaged over the texels around each one, twice.
SMOOTH = 2

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
    return np.array([struct.unpack_from('<' + fmt * n, BIN, base + k * step)
                     for k in range(a['count'])], dtype=np.float64)


idx = read(prim['indices'])[:, 0].astype(np.int64)
pos = read(prim['attributes']['POSITION'])
uv = read(prim['attributes']['TEXCOORD_0'])
tri = idx.reshape(-1, 3)
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
    """Every texel triangle t covers, with its barycentric weights."""
    a, b, c = tri[t]
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
    """Warm and reddest — see tools/glb-hem.py for why red-minus-blue is not."""
    return c[0] > c[1] + 25 and c[1] > c[2] + 5 and c[0] > 90


middle = pos[tri].mean(axis=1)
floor = pos[:, 1].min()
tall = pos[:, 1].max() - floor
lift = (middle[:, 1] - floor) / tall

# The neck's own axis, from the skin between the jaw and the collar.
warm = np.zeros(len(tri), dtype=bool)
covers = {}
for t in range(len(tri)):
    seen = list(texels(t))
    if not seen: continue
    covers[t] = seen
    hot = sum(1 for x, y, _, _ in seen if is_skin((rgb[0][x, y], rgb[1][x, y], rgb[2][x, y])))
    warm[t] = hot * 2 > len(seen)
column = middle[warm & (lift >= 0.75) & (lift <= 0.80)]
ax, az = column[:, 0].mean(), column[:, 2].mean()
out_from_neck = np.hypot(middle[:, 0] - ax, middle[:, 2] - az)

# What gets shaded: the neck, from the jaw down to where the jacket closes over
# it. Not the face, not the hands, and nothing that is not skin.
# The head goes in with it. Shading the neck alone put a step across the jaw:
# the skin below it knew the collar was there and the skin above it did not.
target = np.where(warm & (out_from_neck < 0.13) & (lift >= 0.55))[0]
print(f'  {len(target)} triangles of neck and head to shade, '
      f'axis at x {ax:+.4f} z {az:+.4f}')

# Every triangle is a possible blocker; a grid keeps the near ones findable.
v0 = pos[tri[:, 0]]; e1 = pos[tri[:, 1]] - v0; e2 = pos[tri[:, 2]] - v0
CELL = 0.04
grid = defaultdict(list)
lows = np.floor(pos[tri].min(axis=1) / CELL).astype(int)
highs = np.floor(pos[tri].max(axis=1) / CELL).astype(int)
for t in range(len(tri)):
    for i in range(lows[t, 0], highs[t, 0] + 1):
        for j in range(lows[t, 1], highs[t, 1] + 1):
            for k in range(lows[t, 2], highs[t, 2] + 1):
                grid[(i, j, k)].append(t)

# A cosine-weighted fan of directions about +Z, spun into each normal's frame.
turn = np.arange(RAYS) + 0.5
phi = turn * math.pi * (3 - 5 ** 0.5)
cosine = np.sqrt(1 - turn / RAYS)
sine = np.sqrt(1 - cosine ** 2)
fan = np.stack([sine * np.cos(phi), sine * np.sin(phi), cosine], axis=1)


def near(point):
    lo = np.floor((point - REACH) / CELL).astype(int)
    hi = np.floor((point + REACH) / CELL).astype(int)
    out = set()
    for i in range(lo[0], hi[0] + 1):
        for j in range(lo[1], hi[1] + 1):
            for k in range(lo[2], hi[2] + 1):
                out.update(grid.get((i, j, k), ()))
    close = np.fromiter(out, dtype=np.int64, count=len(out))
    # A cell is coarser than the reach, so most of what it hands back is out of
    # range. Dropping those here is what keeps this minutes rather than hours.
    if len(close):
        span = np.linalg.norm(middle[close] - point, axis=1)
        close = close[span < REACH + 0.03]
    return close


def blocked(points, normals, candidates):
    """Fraction of each point's hemisphere that the candidates cover."""
    up = np.tile(np.array([0.0, 0.0, 1.0]), (len(points), 1))
    flip = np.abs(normals[:, 2]) > 0.9
    up[flip] = np.array([1.0, 0.0, 0.0])
    side = np.cross(up, normals); side /= np.linalg.norm(side, axis=1, keepdims=True)
    other = np.cross(normals, side)
    # rays[p, r] — the fan turned into point p's frame
    rays = (fan[None, :, 0, None] * side[:, None, :]
            + fan[None, :, 1, None] * other[:, None, :]
            + fan[None, :, 2, None] * normals[:, None, :])
    a = v0[candidates]; b = e1[candidates]; c = e2[candidates]
    hit = np.zeros((len(points), RAYS), dtype=bool)
    for chunk in range(0, len(candidates), 2048):
        A = a[chunk:chunk+2048]; B = b[chunk:chunk+2048]; C = c[chunk:chunk+2048]
        # Moller-Trumbore, every ray against every triangle in the chunk
        p = np.cross(rays[:, :, None, :], C[None, None, :, :])
        det = np.einsum('ijkl,kl->ijk', p, B)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        s = points[:, None, None, :] - A[None, None, :, :]
        u = np.einsum('ijkl,ijkl->ijk', s, p) * inv
        q = np.cross(s, B[None, None, :, :])
        v = np.einsum('ijkl,ijl->ijk', q, rays) * inv
        t = np.einsum('ijkl,kl->ijk', q, C) * inv
        near_enough = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-4) & (t < REACH)
        hit |= near_enough.any(axis=2)
    return hit.mean(axis=1)


shade = {}
for n, t in enumerate(target):
    seen = covers.get(t)
    if not seen: continue
    a, b, c = tri[t]
    points = np.array([pos[a] * l0 + pos[b] * l1 + pos[c] * (1 - l0 - l1)
                       for _, _, l0, l1 in seen])
    face = np.cross(pos[b] - pos[a], pos[c] - pos[a])
    face = face / (np.linalg.norm(face) + 1e-12)
    normals = np.tile(face, (len(points), 1))
    points = points + face * 1e-4
    candidates = near(points.mean(axis=0))
    if not len(candidates): continue
    open_sky = 1.0 - blocked(points, normals, candidates)
    for (x, y, _, _), sky in zip(seen, open_sky):
        shade[(x, y)] = sky
    if n % 100 == 0: print(f'    {n}/{len(target)}', flush=True)

for _ in range(SMOOTH):
    smoothed = {}
    for (x, y), value in shade.items():
        total, n = 0.0, 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                other = shade.get((x + dx, y + dy))
                if other is not None: total += other; n += 1
        smoothed[(x, y)] = total / n
    shade = smoothed

if shade:
    sky = np.array(list(shade.values()))
    print(f'  {len(shade)} texels measured; open sky '
          f'{sky.min():.2f}..{sky.max():.2f}, median {np.median(sky):.2f}')
    reference = np.quantile(sky, OPEN)
    for (x, y), value in shade.items():
        keep = max(FLOOR, min(1.0, (value / reference) ** 1.5))
        for ch in range(3):
            rgb[ch][x, y] = int(round(rgb[ch][x, y] * keep))

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
print(f'{src} {len(raw)} -> {dst} {len(open(dst, "rb").read())} bytes')
