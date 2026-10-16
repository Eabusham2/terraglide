"""Take the plate a generated object stands on, and any shell left inside it, out of a GLB.

A single-image reconstructor reads the white it was shown under an object as
something to stand on, so the sword came back from TRELLIS.2 upright on a thin
plate, and with a second, smaller copy of its own surface left inside the
first. Neither is the sword. Both are separate pieces of the mesh - nothing
joins the blade to the plate it stands on - so they can be told apart without
cutting anything:

  * the mesh is welded by position, the way tools/selftest.mjs welds it to
    count open edges (a texture seam is two indices at one place, not a gap),
    and split into its connected pieces;
  * a piece thinner than a fiftieth of the model's height and wider than half
    its span is the plate;
  * a piece lying wholly inside another piece's bounds is a shell;
  * everything else is kept.

Nothing is added, moved or re-coloured. The output is a subset of the input's
triangles with unused vertices dropped and the rest renumbered; the pictures
come through byte for byte.

    python tools/glb-unplate.py in.glb out.glb
"""
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]

raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off+8])
    if ctype == b'JSON': J = json.loads(raw[off+8:off+8+clen])
    elif ctype == b'BIN\x00': BIN = bytearray(raw[off+8:off+8+clen])
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
    return [struct.unpack_from('<' + fmt * n, BIN, base + k * step) for k in range(a['count'])]


pos = read(prim['attributes']['POSITION'])
idx = [i[0] for i in read(prim['indices'])]
lo = [min(p[i] for p in pos) for i in range(3)]
hi = [max(p[i] for p in pos) for i in range(3)]
height = hi[1] - lo[1]
span = max(hi[0] - lo[0], hi[2] - lo[2])

# Welded by position, on the grid the self-test uses.
q = (max(hi[i] - lo[i] for i in range(3)) or 1) * 1e-5
weld, wid = {}, []
for p in pos:
    key = tuple(round(c / q) for c in p)
    wid.append(weld.setdefault(key, len(weld)))

# Connected pieces, by union-find over the welded vertices of each triangle.
parent = list(range(len(weld)))
def find(v):
    while parent[v] != v:
        parent[v] = parent[parent[v]]
        v = parent[v]
    return v
for t in range(0, len(idx), 3):
    a, b, c = (find(wid[idx[t + k]]) for k in range(3))
    if a != b: parent[b] = a
    if a != c: parent[find(c)] = a

pieces = {}
for t in range(0, len(idx), 3):
    root = find(wid[idx[t]])
    piece = pieces.setdefault(root, {'tris': [], 'lo': [float('inf')] * 3, 'hi': [float('-inf')] * 3})
    piece['tris'].append(t)
    for k in range(3):
        p = pos[idx[t + k]]
        for i in range(3):
            piece['lo'][i] = min(piece['lo'][i], p[i])
            piece['hi'][i] = max(piece['hi'][i], p[i])

def inside(a, b):
    """Is box a wholly within box b (and not b itself)?"""
    return a is not b and all(b['lo'][i] <= a['lo'][i] and a['hi'][i] <= b['hi'][i] for i in range(3))

drop = set()
for root, p in pieces.items():
    thick = p['hi'][1] - p['lo'][1]
    wide = max(p['hi'][0] - p['lo'][0], p['hi'][2] - p['lo'][2])
    if thick < height / 50 and wide > span / 2:
        p['why'] = 'plate'
        drop.add(root)
    elif any(inside(p, o) for o in pieces.values()):
        p['why'] = 'shell'
        drop.add(root)
for root, p in sorted(pieces.items(), key=lambda kv: -len(kv[1]['tris'])):
    size = [round(p['hi'][i] - p['lo'][i], 4) for i in range(3)]
    print(f"  piece of {len(p['tris'])} triangles, {size}: {p.get('why', 'kept')}")

keep = []
for root, p in pieces.items():
    if root in drop: continue
    for t in sorted(p['tris']): keep.extend(idx[t:t + 3])

# Drop the vertices nothing points at any more, and renumber.
used = sorted(set(keep))
where = {old: new for new, old in enumerate(used)}
keep = [where[v] for v in keep]

parts = {}
for name, index in prim['attributes'].items():
    a = J['accessors'][index]
    fmt, size = COMP[a['componentType']]
    n = NUM[a['type']]
    view = J['bufferViews'][a['bufferView']]
    base = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    step = view.get('byteStride') or size * n
    rows = [bytes(BIN[base + v * step: base + v * step + size * n]) for v in used]
    parts[name] = (a, fmt, n, size, rows)

blob = bytearray()
views = []


def add(payload, stride=None):
    while len(blob) % 4: blob.append(0)
    view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(payload)}
    if stride: view['byteStride'] = stride
    blob.extend(payload)
    views.append(view)
    return len(views) - 1


J['accessors'] = []
attributes = {}
for name, (a, fmt, n, size, rows) in parts.items():
    payload = b''.join(rows)
    view = add(payload, size * n if size * n % 4 == 0 else None)
    acc = {'bufferView': view, 'componentType': a['componentType'], 'count': len(rows),
           'type': a['type']}
    if a.get('normalized'): acc['normalized'] = True
    if name == 'POSITION':
        kept = [struct.unpack_from('<' + fmt * n, payload, k * size * n) for k in range(len(rows))]
        acc['min'] = [min(v[i] for v in kept) for i in range(3)]
        acc['max'] = [max(v[i] for v in kept) for i in range(3)]
    attributes[name] = len(J['accessors'])
    J['accessors'].append(acc)

wide = len(used) > 65535
payload = struct.pack('<' + ('I' if wide else 'H') * len(keep), *keep)
view = add(payload)
indices = len(J['accessors'])
J['accessors'].append({'bufferView': view, 'componentType': 5125 if wide else 5123,
                       'count': len(keep), 'type': 'SCALAR'})

# The pictures keep their own views, appended after the geometry.
for image in J.get('images', []):
    if 'bufferView' not in image: continue
    old = J['bufferViews'][image['bufferView']]
    start = old.get('byteOffset', 0)
    image['bufferView'] = add(bytes(BIN[start:start + old['byteLength']]))

prim['attributes'] = attributes
prim['indices'] = indices
J['bufferViews'] = views
J['buffers'] = [{'byteLength': len(blob)}]

js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
blob.extend(b'\0' * (-len(blob) % 4))
glb = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
       + struct.pack('<I4s', len(js), b'JSON') + js
       + struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob))
open(dst, 'wb').write(glb)
print(f'  {len(pieces)} pieces, {len(drop)} dropped')
print(f'  {len(idx) // 3} -> {len(keep) // 3} triangles, {len(pos)} -> {len(used)} vertices')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
