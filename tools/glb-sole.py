"""Paint the white out of the bottom of each boot.

Photographed from underneath, the soles came out as a starburst: pale wedges
radiating from the middle of a black boot. It reads as a lighting fault and it
is not one - sampling the atlas where each of those triangles actually points
gives a median luminance of 52 out of 255, which is the black rubber the
generator painted, and a maximum of 254, which is not. Some of the sole's
triangles are pointing at white.

They are the shoe print that tools/glb-unfloor.py keeps. It drops the baked
floor and keeps the part of it that lies under a boot, which is right - that
part IS the sole, in the generator's own geometry with the generator's own
coordinates. But this atlas is thousands of small charts with no common layout
and no gutter, so a coordinate that lands a texel outside its chart lands
somewhere else entirely, and a few dozen of the print's corners land in white.

So the pale ones are sent to the same texel the cap already uses, which is the
middle of the largest triangle of print and is sole surrounded by sole. Only
the pale ones: a triangle already looking at black is left alone, because the
tread the generator painted is worth keeping wherever it survived.

Their corners are copied first - a corner down here is shared with the boot
wall going up - and the copies sit exactly on top of the originals, so they
weld away and the mesh is as closed afterwards as before.

    python tools/glb-sole.py in.glb out.glb
"""
import json, math, struct, sys, zlib

src, dst = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off + 8])
    if ctype == b'JSON': J = json.loads(raw[off + 8:off + 8 + clen])
    elif ctype == b'BIN\x00': BIN = bytearray(raw[off + 8:off + 8 + clen])
    off += 8 + clen

prim = J['meshes'][0]['primitives'][0]
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
    return [list(struct.unpack_from('<' + fmt * n, BIN, base + k * step))
            for k in range(a['count'])]


idx = [v[0] for v in read(prim['indices'])]
pos = read(prim['attributes']['POSITION'])
uv = read(prim['attributes']['TEXCOORD_0'])
nrm = read(prim['attributes']['NORMAL'])
floor = min(v[1] for v in pos)

# The underside of a boot, lying flat, and nothing above it.
BAND = 0.012
FLAT = 0.5
# Above this the triangle is pointing at something that is not black rubber.
PALE = 0


def picture():
    """The atlas, decoded, so a coordinate can be asked what colour it is."""
    view = J['bufferViews'][J['images'][0]['bufferView']]
    png = bytes(BIN[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
    at, data = 8, b''
    while at < len(png):
        length = struct.unpack('>I', png[at:at + 4])[0]
        kind = png[at + 4:at + 8]
        if kind == b'IHDR': w, h, depth, colour = struct.unpack('>IIBB', png[at + 8:at + 18])
        elif kind == b'IDAT': data += png[at + 8:at + 8 + length]
        at += 12 + length
    lines = zlib.decompress(data)
    step = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour]
    stride = w * step
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        kind = lines[p]; p += 1
        row = bytearray(lines[p:p + stride]); p += stride
        for x in range(stride):
            a = row[x - step] if x >= step else 0
            b = prev[x]
            c = prev[x - step] if x >= step else 0
            if kind == 1: row[x] = (row[x] + a) & 255
            elif kind == 2: row[x] = (row[x] + b) & 255
            elif kind == 3: row[x] = (row[x] + (a + b) // 2) & 255
            elif kind == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                row[x] = (row[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out += row
        prev = row
    return w, h, step, bytes(out)


W, H, STEP, PIX = picture()


def shade(u, v):
    x = min(W - 1, max(0, int(u * W)))
    y = min(H - 1, max(0, int((1 - v) * H)))
    o = (y * W + x) * STEP
    return (PIX[o] + PIX[o + 1] + PIX[o + 2]) // 3


def flatness(t):
    a, b, c = (pos[idx[t + k]] for k in range(3))
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    return n[1] / (math.sqrt(sum(q * q for q in n)) or 1)


sole = [t for t in range(0, len(idx), 3)
        if max(pos[idx[t + k]][1] for k in range(3)) < floor + BAND]


def plan(t):
    return sum(pos[idx[t + k]][0] for k in range(3)) / 3


"""
  The darkest texel this boot actually owns.

  The obvious choice is the one unfloor's cap uses - the middle of the largest
  triangle of print - and it is a middle grey, about 52 of 255. Painting the
  sole with it turns the starburst grey rather than removing it, because what
  is BETWEEN the wedges is the boot itself, which is nearly black. The wedges
  were never the odd ones out for being pale; the gap between them was the odd
  one out for being dark, and matching the dark is what makes a sole.

  So: of every coordinate the bottom of this boot points at, the one the atlas
  is darkest at. It is the boot's own colour by construction - nothing is
  invented and nothing is sampled from another chart.
"""
# Searched over the boot itself, not only its underside: the sole's own
# coordinates bottom out around 30 of 255 and the wall above them goes lower,
# and it is the wall the wedges are being compared against by eye.
WALL = 0.070
wall = [t for t in range(0, len(idx), 3)
        if max(pos[idx[t + k]][1] for k in range(3)) < floor + WALL]
black = {}
for t in wall:
    side = plan(t) < 0
    for k in range(3):
        here = uv[idx[t + k]]
        lit = shade(*here)
        if side not in black or lit < black[side][0]:
            black[side] = (lit, tuple(here))
if len(black) != 2:
    print(f'glb-sole: found {len(black)} boots, expected two - nothing changed')
    sys.exit(1)
for side in black: black[side] = black[side][1]

pale = 0
for t in sole:
    lit = max(shade(*uv[idx[t + k]]) for k in range(3))
    if lit <= PALE: continue
    side = plan(t) < 0
    for k in range(3):
        v = idx[t + k]
        pos.append(list(pos[v]))
        uv.append(list(black[side]))
        nrm.append([0.0, -1.0, 0.0])
        idx[t + k] = len(pos) - 1
    pale += 1

if len(pos) > 65535:
    print('glb-sole: that would need 32-bit indices - nothing changed')
    sys.exit(1)

blob = bytearray()
views = []


def put(values, fmt, stride):
    start = len(blob)
    for v in values: blob.extend(struct.pack('<' + fmt * len(v), *v))
    while len(blob) % 4: blob.append(0)
    views.append({'buffer': 0, 'byteOffset': start, 'byteLength': len(blob) - start})
    if stride: views[-1]['byteStride'] = stride
    return len(views) - 1


posView = put(pos, 'f', 12)
uvView = put(uv, 'f', 8)
nrmView = put(nrm, 'f', 12)
idxView = put([[i] for i in idx], 'H', None)

was = {J['accessors'][prim['attributes'][n]]['bufferView'] for n in prim['attributes']}
was.add(J['accessors'][prim['indices']]['bufferView'])
keep = {}
for i, view in enumerate(J['bufferViews']):
    if i in was: continue
    start = view.get('byteOffset', 0)
    here = len(blob)
    blob.extend(BIN[start:start + view['byteLength']])
    while len(blob) % 4: blob.append(0)
    copy = dict(view)
    copy['byteOffset'] = here
    views.append(copy)
    keep[i] = len(views) - 1
for image in J.get('images', []):
    if 'bufferView' in image: image['bufferView'] = keep[image['bufferView']]

J['bufferViews'] = views
for name, view in (('POSITION', posView), ('TEXCOORD_0', uvView), ('NORMAL', nrmView)):
    a = J['accessors'][prim['attributes'][name]]
    a['bufferView'] = view
    a['count'] = len(pos)
    a.pop('byteOffset', None)
    if name == 'POSITION':
        a['min'] = [min(v[i] for v in pos) for i in range(3)]
        a['max'] = [max(v[i] for v in pos) for i in range(3)]
a = J['accessors'][prim['indices']]
a['bufferView'] = idxView
a['count'] = len(idx)
a.pop('byteOffset', None)
J['buffers'] = [{'byteLength': len(blob)}]

text = json.dumps(J, separators=(',', ':')).encode()
while len(text) % 4: text += b' '
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(text) + 8 + len(blob))
out += struct.pack('<I4s', len(text), b'JSON') + text
out += struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob)
open(dst, 'wb').write(out)
print(f'{len(sole)} flat triangles under the boots; {pale} were pointing at '
      f'something paler than {PALE} and now point at the sole')
print(f'{src} {len(raw)} -> {dst} {len(out)} bytes')
