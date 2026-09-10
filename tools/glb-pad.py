"""Fill the gutter round every chart in an atlas, so no seam draws a bright line.

A UV atlas is a patchwork: the surface is cut into charts and packed flat, and
between the charts is a gutter that no triangle covers. What is in that gutter
matters anyway, because a renderer does not sample one texel — it blends the
four nearest, and at every mip level it blends more. A triangle whose edge lies
against the gutter therefore reads whatever was left there, and on this atlas
what was left there is white: 6,722 of the 98,126 texels in the one-texel ring
outside the charts are near-white, against a body whose median is 55.

That is the pale hairline down the trouser leg, and it is why nothing found it.
It is not in the geometry — the same mesh in flat white with its contrast
stretched is smooth. It is not a distortion of the mapping — no triangle on the
leg is stretched or squeezed by so much as a factor of three. It is not even in
the *trouser*: the offending texels are outside the trouser's charts, so a test
that compares a triangle's own texels with its neighbours' can never see them,
which is exactly what happened at every threshold tried.

So the gutter is filled from the charts rather than left as whatever the packer
wrote. Every uncovered texel next to a covered one takes the average of its
covered neighbours, and that repeats outward: after a few rounds each chart is
surrounded by a band of its own colour, blending across a seam gives the
chart's colour back, and the seam disappears at every mip level a browser is
going to use. Nothing a triangle actually samples is touched — the charts
themselves come out byte for byte.

    python tools/glb-pad.py in.glb out.glb [rounds]
"""
import io, json, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
ROUNDS = int(sys.argv[3]) if len(sys.argv) > 3 else 8

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


def read(index):
    a = J['accessors'][index]
    view = J['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NUM[a['type']]
    base = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    step = view.get('byteStride') or size * n
    rows = [struct.unpack_from('<' + fmt * n, BIN, base + k * step) for k in range(a['count'])]
    if a.get('normalized'):
        top = {5121: 255.0, 5123: 65535.0, 5120: 127.0, 5122: 32767.0}[a['componentType']]
        rows = [tuple(c / top for c in r) for r in rows]
    return rows


# The picture every material actually reads, opened as stored: this one is RGBA
# with a real alpha channel, and converting it to RGB threw that away once
# already — nothing on screen changed and the shipped file quietly stopped
# being the generator's.
picture = None
for mat in J.get('materials', []):
    slot = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
    if slot: picture = J['textures'][slot['index']]['source']
if picture is None: raise SystemExit('no base colour texture to pad')
view = J['bufferViews'][J['images'][picture]['bufferView']]
start = view.get('byteOffset', 0)
img = Image.open(io.BytesIO(bytes(BIN[start:start + view['byteLength']])))
mode, size = img.mode, img.size
W, H = size
bands = img.split()
rgb = [b.load() for b in bands[:3]]

covered = bytearray(W * H)
for mesh in J.get('meshes', []):
    for prim in mesh['primitives']:
        if prim.get('indices') is None: continue
        uv = read(prim['attributes']['TEXCOORD_0'])
        idx = [v[0] for v in read(prim['indices'])]
        for t in range(0, len(idx), 3):
            xs = [uv[idx[t + k]][0] * W for k in range(3)]
            # v runs down from the top of the picture, the way a row index
            # does. Not flipped: it was written flipped first, on the reasoning
            # that three.js turns a texture over on load, and the padding then
            # filled the charts instead of the gutter and took the trousers'
            # median from 22 to 2. Measured rather than reasoned about in the
            # end — sampled this way the wings come out sage (94,103,89) and
            # the shins near-black (25,13,6); flipped, both come back grey mush.
            ys = [uv[idx[t + k]][1] * H for k in range(3)]
            det = (ys[1]-ys[2]) * (xs[0]-xs[2]) + (xs[2]-xs[1]) * (ys[0]-ys[2])
            if abs(det) < 1e-9: continue
            for y in range(max(0, int(min(ys))), min(H, int(max(ys)) + 1)):
                for x in range(max(0, int(min(xs))), min(W, int(max(xs)) + 1)):
                    l0 = ((ys[1]-ys[2]) * (x+.5-xs[2]) + (xs[2]-xs[1]) * (y+.5-ys[2])) / det
                    l1 = ((ys[2]-ys[0]) * (x+.5-xs[2]) + (xs[0]-xs[2]) * (y+.5-ys[2])) / det
                    if l0 < 0 or l1 < 0 or 1 - l0 - l1 < 0: continue
                    covered[y * W + x] = 1

inside = sum(covered)
filled = 0
for _ in range(ROUNDS):
    fresh = []
    for y in range(H):
        row = y * W
        for x in range(W):
            if covered[row + x]: continue
            total = [0, 0, 0]
            n = 0
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= H: continue
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if xx < 0 or xx >= W or not covered[yy * W + xx]: continue
                    for c in range(3): total[c] += rgb[c][xx, yy]
                    n += 1
            if n: fresh.append((x, y, tuple(v // n for v in total)))
    if not fresh: break
    for x, y, colour in fresh:
        for c in range(3): rgb[c][x, y] = colour[c]
        covered[y * W + x] = 1
    filled += len(fresh)

out = Image.merge(mode, tuple(bands))
buf = io.BytesIO()
out.save(buf, format='PNG', optimize=True)
payload = buf.getvalue()

blob = bytearray()
views = []
for i, old in enumerate(J['bufferViews']):
    while len(blob) % 4: blob.append(0)
    o = old.get('byteOffset', 0)
    data = payload if i == J['images'][picture]['bufferView'] else BIN[o:o + old['byteLength']]
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
print(f'  {inside} texels inside a chart, {filled} of gutter filled in {ROUNDS} rounds')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
