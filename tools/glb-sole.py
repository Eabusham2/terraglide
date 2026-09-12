"""Turn each boot's sole the right way round.

Photographed from underneath, the soles came out as a starburst: pale wedges
radiating from the middle of the foot with dark slits between them. Tried as a
paint problem and as a lighting problem, and it is neither - on a flat white
body the wedges are white and the slits are still black, and black on a white
body is not shading. Tried as holes, and it is not that either: there is not
one open edge under either boot.

They are back-faces. Of the 513 triangles in the bottom twelve millimetres of
the shipped figure, 108 are wound facing UP - under a boot, which is to say
away from anyone who can see them - and sixty-eight of those carry vertex
normals pointing down, so they were built as sole and only their winding is
wrong. A front-facing renderer culls them and you see straight through the
boot to its dark inside: the slits are the inside of the shoe.

They are the inside of the shoe. The underside is pleated: the cap's wedges
alternate, some facing the ground and some facing back up into the boot, and
the ones facing up are lit from inside the boot, which is to say not at all.

Flipping them over is wrong - this shell is consistently wound everywhere, so
turning a triangle inside it leaves eighty-four edges running the same way as
their neighbours and the mesh stops being closed. Laying a ground-facing copy
on top of each is wrong too: in the same plane the two fight for depth and the
sole comes out hatched, and lifting the copy clear breaks the weld.

What is wrong with them is which way they are lit from, so that is what is
changed: their corners are copied - a corner down here is shared with the welt
going up - and the copies take the cap's single texture coordinate and a normal
pointing at the ground. They sit exactly on top of the originals, so they weld
away and the mesh is as closed as it was. The scan is drawn double-sided, so
these are drawn from underneath, and now they are lit as sole. Triangles
standing on edge in the band are the welt and are left alone.

    python tools/glb-sole.py in.glb out.glb
"""
import json, math, struct, sys
from collections import defaultdict

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

# The underside of a boot, and nothing above it. Twelve millimetres covers the
# cap, the print kept around it and the wedges that were wound the wrong way,
# and stops well short of the ankle.
BAND = 0.012
# How flat a triangle has to be to count as sole rather than welt.
FLAT = 0.5

def flatness(t):
    """Which way the triangle's own corners say it faces: +1 up, -1 down."""
    a, b, c = (pos[idx[t + k]] for k in range(3))
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    return n[1] / (math.sqrt(sum(q * q for q in n)) or 1)


# Flat, and in the bottom of the boot. Anything standing on edge down there is
# the welt round the sole, which is meant to be seen from the side and keeps
# both its winding and its paint.
sole = [t for t in range(0, len(idx), 3)
        if max(pos[idx[t + k]][1] for k in range(3)) < floor + BAND
        and abs(flatness(t)) > FLAT]
if not sole:
    print('glb-sole: nothing flat down there - nothing changed')
    sys.exit(0)


def plan(t):
    return sum(pos[idx[t + k]][0] for k in range(3)) / 3


# The cap's coordinate: whichever triangle down there already has all three
# corners on one texel is unfloor's cap, and that texel is sole.
flat = {}
for t in sole:
    corners = {tuple(uv[idx[t + k]]) for k in range(3)}
    if len(corners) == 1: flat.setdefault(plan(t) < 0, corners.pop())
if len(flat) != 2:
    print(f'glb-sole: found {len(flat)} capped boots, expected two - nothing changed')
    sys.exit(1)

# Nothing is flipped, moved or added.
#
# Flipping the up-facing ones was the obvious move and it is wrong: this shell
# is consistently wound everywhere, so turning a triangle over inside it leaves
# eighty-four edges running the same way as their neighbours, and the file is
# checked for exactly that. Adding a ground-facing copy on top of each is worse
# in a quieter way - laid in the same plane the two fight for depth and the
# sole comes out finely hatched, and lifting the copy clear of the plane breaks
# the weld and the closedness with it.
#
# What is actually wrong with them is the direction they are lit from, and that
# is the normal, which is free to change. Their corners are copied first - a
# corner down here is shared with the welt going up, and the welt is neither
# sole-coloured nor flat - and the copies sit exactly on top of the originals,
# so they weld away and the mesh is as closed afterwards as before.
#
# The scan is drawn double-sided, so a triangle facing up into the boot is
# still drawn from underneath; with a normal pointing at the ground it is lit
# as sole rather than as the inside of a shoe.
"""
  Flattened, not repainted and not turned over.

  Three things were tried on this before the cause was found. Repainting it -
  every triangle down there onto the cap's single texel - changed nothing at
  all. Turning the up-facing ones over opened eighty-four edges, because the
  shell is consistently wound and a triangle turned inside it is a hole by the
  only definition that matters. Laying a ground-facing copy over each one made
  the sole fight itself for depth.

  None of them could have worked, because none of them is what makes the
  pattern. The underside is PLEATED - the cap's wedges alternate up and down
  about the sole's plane by a millimetre or two - and each facet catches the
  light at its own angle. One texel across all of them is still one texel seen
  at thirty different angles, and the starburst is what that looks like.

  So the pleat is ironed out: every corner of every flat triangle under a boot
  is put on that boot's own lowest plane. Vertices move together with everyone
  standing in the same place, so nothing comes apart; a pleat that was a
  millimetre deep becomes a disc; and a disc with one texel and one normal is a
  sole.
"""
floors = {}
for t in sole:
    side = plan(t) < 0
    for k in range(3):
        y = pos[idx[t + k]][1]
        floors[side] = min(floors.get(side, y), y)

flat_at = {}
for t in sole:
    side = plan(t) < 0
    for k in range(3):
        p = pos[idx[t + k]]
        flat_at[(round(p[0], 5), round(p[1], 5), round(p[2], 5))] = floors[side]

made = 0
for p in pos:
    key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
    if key in flat_at and p[1] != flat_at[key]:
        p[1] = flat_at[key]
        made += 1

for t in sole:
    side = plan(t) < 0
    for k in range(3):
        v = idx[t + k]
        uv[v] = list(flat[side])
        nrm[v] = [0.0, -1.0, 0.0]

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
    at2 = len(blob)
    blob.extend(BIN[start:start + view['byteLength']])
    while len(blob) % 4: blob.append(0)
    copy = dict(view)
    copy['byteOffset'] = at2
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
print(f'{len(sole)} flat triangles under the boots; {made} corners ironed onto '
      f'the sole plane, all on the cap texel with a normal at the ground')
print(f'{src} {len(raw)} -> {dst} {len(out)} bytes')
