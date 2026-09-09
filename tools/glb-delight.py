"""Take the baked-in shadow out of a scanned texture.

The generator bakes the light it saw into the base colour. On this figure that
means the armpits, the inside of the sleeves and the folds behind the knees are
near black in the atlas, and the moment an arm swings the camera sees straight
into one — the black gashes across both shoulders. They are not holes and not
lighting. A plain white render of the same mesh in the same pose has neither.

Removing shading from a photograph is only possible approximately, and the
approximation that works is this: real lighting varies slowly over a body,
while the things worth keeping — a zip, a seam, the weave — vary quickly. So
estimate the slow part and divide it out, leaving the fast part alone.

The estimate is made in *space*, not in the picture. Blurring the atlas would
be wrong: it is cut into thousands of small charts and neighbouring texels are
routinely opposite ends of the body, so a blur mixes a boot into a collar. Each
texel is instead placed back on the mesh it came from, luminance is averaged
into a coarse grid of the figure's own volume, and that grid — smoothed, then
read back per texel — is the light. Every texel is then lifted toward the level
most of the body is already at.

It only ever brightens, and never past a set multiple, so a face already in the
light is left where it is and nothing can be pushed to white.

Usage: glb-delight.py in.glb out.glb [target-percentile] [max-gain]
"""
import json, math, struct, sys, io
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
PERCENTILE = float(sys.argv[3]) if len(sys.argv) > 3 else 0.55
MAX_GAIN = float(sys.argv[4]) if len(sys.argv) > 4 else 1.7
GRID = 26

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
tex_i = mat['pbrMetallicRoughness']['baseColorTexture']['index']
image_i = J['textures'][tex_i]['source']
bv = J['bufferViews'][J['images'][image_i]['bufferView']]
s = bv.get('byteOffset', 0)
img = Image.open(io.BytesIO(BIN[s:s + bv['byteLength']])).convert('RGB')
W, H = img.size
px = img.load()

lo = pa['min']
hi = pa['max']
span = [max(hi[i] - lo[i], 1e-9) for i in range(3)]

# 1. Put every covered texel back on the body, and collect the light there.
sums = [0.0] * (GRID ** 3)
hits = [0] * (GRID ** 3)
place = {}                      # texel -> grid cell
def cell_of(p):
    c = [min(GRID - 1, max(0, int((p[i] - lo[i]) / span[i] * GRID))) for i in range(3)]
    return (c[2] * GRID + c[1]) * GRID + c[0]

for t in range(0, len(idx), 3):
    a, b, c = idx[t], idx[t+1], idx[t+2]
    ua, ub, uc = uv[a], uv[b], uv[c]
    xs = [ua[0] * W, ub[0] * W, uc[0] * W]
    ys = [ua[1] * H, ub[1] * H, uc[1] * H]
    x0, x1 = max(0, int(min(xs))), min(W - 1, int(max(xs)) + 1)
    y0, y1 = max(0, int(min(ys))), min(H - 1, int(max(ys)) + 1)
    if x1 < x0 or y1 < y0: continue
    det = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
    if abs(det) < 1e-12: continue
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            l0 = ((ys[1] - ys[2]) * (x + 0.5 - xs[2]) + (xs[2] - xs[1]) * (y + 0.5 - ys[2])) / det
            l1 = ((ys[2] - ys[0]) * (x + 0.5 - xs[2]) + (xs[0] - xs[2]) * (y + 0.5 - ys[2])) / det
            l2 = 1 - l0 - l1
            if l0 < -0.02 or l1 < -0.02 or l2 < -0.02: continue
            p = [pos[a][k] * l0 + pos[b][k] * l1 + pos[c][k] * l2 for k in range(3)]
            g = cell_of(p)
            place[(x, y)] = p
            r, gg, bb = px[x, y]
            lum = (r * 299 + gg * 587 + bb * 114) / 1000.0
            sums[g] += lum
            hits[g] += 1

print(f'{len(place)} texels placed on the body, '
      f'{sum(1 for h in hits if h)} of {GRID ** 3} cells used')

light = [sums[i] / hits[i] if hits[i] else 0.0 for i in range(GRID ** 3)]
# 2. Smooth the grid, so the estimate is the slow part and only the slow part.
for _pass in range(6):
    nxt = list(light)
    for z in range(GRID):
        for y in range(GRID):
            for x in range(GRID):
                tot = 0.0
                n = 0
                for dz in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            a2, b2, c2 = x + dx, y + dy, z + dz
                            if not (0 <= a2 < GRID and 0 <= b2 < GRID and 0 <= c2 < GRID): continue
                            g = (c2 * GRID + b2) * GRID + a2
                            if not hits[g]: continue
                            tot += light[g]
                            n += 1
                if n: nxt[(z * GRID + y) * GRID + x] = tot / n
    light = nxt

lit = sorted(light[g] for g in range(GRID ** 3) if hits[g] and light[g] > 0)
target = lit[int(len(lit) * PERCENTILE)]
print(f'light across the body: {lit[0]:.0f} to {lit[-1]:.0f}, lifting toward {target:.0f}')

# 3. Lift. Never darken, never past MAX_GAIN, never past white.
#
# Read smoothly between cells, not out of one. A grid this coarse sampled
# cell-by-cell gives every cell its own gain and the body comes out in
# rectangular patches of different brightness, which is worse than the shadow
# it was removing — the first version of this did exactly that.
def light_at(p):
    f = [(p[i] - lo[i]) / span[i] * GRID - 0.5 for i in range(3)]
    b = [min(GRID - 2, max(0, int(math.floor(f[i])))) for i in range(3)]
    t = [min(1.0, max(0.0, f[i] - b[i])) for i in range(3)]
    total = 0.0
    weight = 0.0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                g = ((b[2] + dz) * GRID + (b[1] + dy)) * GRID + (b[0] + dx)
                if not hits[g] or light[g] <= 0: continue
                w = ((t[0] if dx else 1 - t[0]) * (t[1] if dy else 1 - t[1])
                     * (t[2] if dz else 1 - t[2]))
                total += light[g] * w
                weight += w
    return total / weight if weight > 1e-6 else 0.0

lifted = 0
for (x, y), where in place.items():
    here = light_at(where)
    if here <= 1e-3: continue
    gain = min(MAX_GAIN, max(1.0, target / here))
    if gain <= 1.0001: continue
    r, gg, bb = px[x, y]
    px[x, y] = (min(255, int(r * gain)), min(255, int(gg * gain)), min(255, int(bb * gain)))
    lifted += 1
print(f'{lifted} texels lifted ({100 * lifted / max(len(place), 1):.0f}% of the body)')

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
