"""Shrink a TRELLIS GLB into something a browser game can afford to download."""
import struct, json, io, sys
from PIL import Image

src, dst, tex_size, quality = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
# Optional fifth argument: cluster the mesh onto a grid this many cells across
# its longest side before anything else. TRELLIS hands back fifty thousand
# triangles for an object that is held in a fist and covers forty pixels, and
# nothing else in here reduces triangle count at all.
cluster = int(sys.argv[5]) if len(sys.argv) > 5 else 0

raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off+8])
    if ctype == b'JSON': J = json.loads(raw[off+8:off+8+clen])
    elif ctype == b'BIN\x00': BIN = bytearray(raw[off+8:off+8+clen])
    off += 8 + clen

def view_bytes(i):
    bv = J['bufferViews'][i]
    s = bv.get('byteOffset', 0)
    return bytes(BIN[s:s + bv['byteLength']])

COMP0 = {5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4}
NUM0 = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}
def read_acc0(i):
    a = J['accessors'][i]
    bv = J['bufferViews'][a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NUM0[a['type']]; fmt = {5123:'H', 5125:'I', 5126:'f'}[a['componentType']]
    size = COMP0[a['componentType']] * n
    return list(struct.unpack(f'<{a["count"]*n}{fmt}', bytes(BIN[start:start + a['count']*size]))), a

# Rebuild the binary chunk from scratch, so nothing unreferenced survives.
out = bytearray()
def append(data, align=4):
    while len(out) % align: out.append(0)
    start = len(out)
    out.extend(data)
    return start

new_views = []
def add_view(data, **extra):
    start = append(data)
    v = {'buffer': 0, 'byteOffset': start, 'byteLength': len(data)}
    v.update(extra)
    new_views.append(v)
    return len(new_views) - 1

# 0. Materials: paper is not a mirror.
#
# TRELLIS writes metallicFactor 1.0 with a metal-roughness texture on
# everything it makes, which is right for its own renderer and wrong under a
# hemisphere light and a sun: a fully metal surface has no diffuse colour at
# all, so the object arrives as a dark blotch with the photograph barely
# showing through. Nothing this generates is metal — a paper firework, a cloth
# wing, a person — so the map goes and the factor goes with it.
for mat in J.get('materials', []):
    pbr = mat.setdefault('pbrMetallicRoughness', {})
    pbr.pop('metallicRoughnessTexture', None)
    pbr['metallicFactor'] = 0.0
    pbr['roughnessFactor'] = 0.85

# 1. Textures: PNG -> JPEG, downscaled.
used_images = set()
for mat in J.get('materials', []):
    for slot in (mat.get('pbrMetallicRoughness') or {}).values():
        if isinstance(slot, dict) and 'index' in slot:
            used_images.add(J['textures'][slot['index']].get('source'))
for i, im in enumerate(list(J.get('images', []))):
    if i not in used_images:
        continue
    img = Image.open(io.BytesIO(view_bytes(im['bufferView']))).convert('RGB')
    img = img.resize((tex_size, tex_size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True)
    im['bufferView'] = add_view(buf.getvalue())
    im['mimeType'] = 'image/jpeg'

# 1a. Decimate, by clustering vertices onto a grid.
#
# Quadric error metrics would keep silhouettes better and are a great deal more
# code. Clustering is enough here because the things being shrunk are small
# props seen at arm's length: a tube, a cone, a pair of shells. Snap every
# vertex to a cell, average what lands in each, and drop the triangles that
# collapse.
#
# The key carries a coarse quantised UV as well as the cell, so a seam — where
# two vertices sit at the same place in space and opposite ends of the texture
# — is not averaged into a smear across the middle of the picture. That is the
# one artefact clustering reliably produces if you cluster on position alone.
if cluster:
    import math
    for mesh in J['meshes']:
        for prim in mesh['primitives']:
            if 'indices' not in prim: continue
            pos, pacc = read_acc0(prim['attributes']['POSITION'])
            idx, iacc = read_acc0(prim['indices'])
            uv = None
            if 'TEXCOORD_0' in prim['attributes']:
                uv, _ = read_acc0(prim['attributes']['TEXCOORD_0'])
            lo = pacc['min']; hi = pacc['max']
            longest = max(hi[i] - lo[i] for i in range(3)) or 1.0
            cell = longest / cluster
            count = pacc['count']
            key_of = {}
            rep = {}
            for v in range(count):
                cx = int((pos[v*3] - lo[0]) / cell)
                cy = int((pos[v*3+1] - lo[1]) / cell)
                cz = int((pos[v*3+2] - lo[2]) / cell)
                ku = int(uv[v*2] * 6) if uv else 0
                kv = int(uv[v*2+1] * 6) if uv else 0
                k = (cx, cy, cz, ku, kv)
                key_of[v] = k
                rep.setdefault(k, []).append(v)
            order = {k: i for i, k in enumerate(rep)}
            keep = []
            for t in range(0, len(idx), 3):
                a, b, c = (order[key_of[idx[t+i]]] for i in range(3))
                if a == b or b == c or a == c: continue
                keep.extend((a, b, c))
            # Average every attribute over the vertices that landed in a cell.
            for name, ai in prim['attributes'].items():
                vals, acc = read_acc0(ai)
                n = NUM0[acc['type']]
                packed = []
                for k in rep:
                    members = rep[k]
                    for c in range(n):
                        packed.append(sum(vals[v*n + c] for v in members) / len(members))
                if name == 'NORMAL':
                    for i in range(0, len(packed), 3):
                        m = math.sqrt(sum(packed[i+j]**2 for j in range(3))) or 1.0
                        for j in range(3): packed[i+j] /= m
                data = struct.pack(f'<{len(packed)}f', *packed)
                acc['componentType'] = 5126
                acc['count'] = len(rep)
                acc.pop('normalized', None)
                if name == 'POSITION':
                    acc['min'] = [min(packed[i::3]) for i in range(3)]
                    acc['max'] = [max(packed[i::3]) for i in range(3)]
                J['bufferViews'].append({'buffer':0, 'byteOffset':len(BIN), 'byteLength':len(data)})
                acc['bufferView'] = len(J['bufferViews']) - 1
                acc['byteOffset'] = 0
                BIN.extend(data)
            newidx = struct.pack(f'<{len(keep)}I', *keep)
            J['bufferViews'].append({'buffer':0, 'byteOffset':len(BIN), 'byteLength':len(newidx)})
            iacc['bufferView'] = len(J['bufferViews']) - 1
            iacc['byteOffset'] = 0
            iacc['componentType'] = 5125
            iacc['count'] = len(keep)
            BIN.extend(newidx)
            print(f"  clustered {count} vertices to {len(rep)}, "
                  f"{len(idx)//3} triangles to {len(keep)//3}")

# 1b. Cut the baked ground plane.
#
# TRELLIS reconstructs what it sees, and what it saw was a character standing
# on an implied floor — so it built the floor too, as a wide flat slab welded
# under the feet. In the game that is a black rectangle following the player
# around. Drop every triangle lying flat in the bottom slice of the bounding
# box; the only real geometry down there is the underside of the boots, which
# is never visible.
def read_acc(i):
    a = J['accessors'][i]
    bv = J['bufferViews'][a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NUM0[a['type']]; fmt = {5123:'H', 5125:'I', 5126:'f'}[a['componentType']]
    size = COMP0[a['componentType']] * n
    return list(struct.unpack(f'<{a["count"]*n}{fmt}', bytes(BIN[start:start + a['count']*size]))), a

for mesh in J['meshes']:
    for prim in mesh['primitives']:
        if 'indices' not in prim: continue
        pos, pacc = read_acc(prim['attributes']['POSITION'])
        idx, iacc = read_acc(prim['indices'])
        lo = pacc['min'][1]; hi = pacc['max'][1]
        cut = lo + (hi - lo) * 0.02
        keep = []
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t+1], idx[t+2]
            if pos[a*3+1] < cut and pos[b*3+1] < cut and pos[c*3+1] < cut:
                continue
            keep.extend((a, b, c))
        removed = (len(idx) - len(keep)) // 3
        # Compact: drop vertices no surviving triangle references.
        used = sorted(set(keep))
        remap = {old: new for new, old in enumerate(used)}
        keep = [remap[i] for i in keep]
        for name, ai in prim['attributes'].items():
            vals, acc = read_acc(ai)
            n = NUM0[acc['type']]
            packed = [v for old in used for v in vals[old*n:(old+1)*n]]
            fmt = {5123:'H', 5125:'I', 5126:'f'}[acc['componentType']]
            newdata = struct.pack(f'<{len(packed)}{fmt}', *packed)
            acc['count'] = len(used)
            if name == 'POSITION':
                acc['min'] = [min(packed[i::3]) for i in range(3)]
                acc['max'] = [max(packed[i::3]) for i in range(3)]
            bv = J['bufferViews'][acc['bufferView']]
            J['bufferViews'].append({'buffer':0, 'byteOffset':len(BIN), 'byteLength':len(newdata)})
            acc['bufferView'] = len(J['bufferViews']) - 1
            acc['byteOffset'] = 0
            BIN.extend(newdata)
        newidx = struct.pack(f'<{len(keep)}I', *keep)
        J['bufferViews'].append({'buffer':0, 'byteOffset':len(BIN), 'byteLength':len(newidx)})
        iacc['bufferView'] = len(J['bufferViews']) - 1
        iacc['byteOffset'] = 0
        iacc['componentType'] = 5125
        iacc['count'] = len(keep)
        BIN.extend(newidx)
        print(f"  cut {removed} ground triangles, {len(used)} vertices kept")

# 2. Geometry: keep the data, but narrow indices where the vertex count allows.
COMP = {5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4}
NUM = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}
for mesh in J['meshes']:
    for prim in mesh['primitives']:
        for name, acc_i in list(prim['attributes'].items()) + ([('__idx', prim['indices'])] if 'indices' in prim else []):
            acc = J['accessors'][acc_i]
            data = view_bytes(acc['bufferView'])
            stride = COMP[acc['componentType']] * NUM[acc['type']]
            base = acc.get('byteOffset', 0)
            data = data[base: base + acc['count'] * stride]
            # Quantise the attributes glTF lets us store small: normals as
            # signed bytes and UVs as unsigned shorts, both normalised. A
            # normal has no business being three float32s.
            if name == 'NORMAL' and acc['componentType'] == 5126:
                vals = struct.unpack(f'<{acc["count"]*3}f', data)
                packed = bytearray()
                for i in range(acc['count']):
                    for c in vals[i*3:i*3+3]:
                        packed.append(struct.pack('<b', max(-127, min(127, round(c*127))))[0])
                    packed.append(0)          # pad VEC3 int8 to 4 bytes
                data = bytes(packed)
                acc['componentType'] = 5120
                acc['normalized'] = True
                acc.pop('min', None); acc.pop('max', None)
            elif name == 'TEXCOORD_0' and acc['componentType'] == 5126:
                vals = struct.unpack(f'<{acc["count"]*2}f', data)
                data = struct.pack(f'<{len(vals)}H',
                    *[max(0, min(65535, round(v*65535))) for v in vals])
                acc['componentType'] = 5123
                acc['normalized'] = True
                acc.pop('min', None); acc.pop('max', None)

            if name == '__idx' and acc['componentType'] == 5125:
                vals = struct.unpack(f'<{acc["count"]}I', data)
                if max(vals) < 65535:
                    data = struct.pack(f'<{len(vals)}H', *vals)
                    acc['componentType'] = 5123
            acc['byteOffset'] = 0
            acc['bufferView'] = add_view(data, **({'target': 34963} if name == '__idx' else {'target': 34962}))

J['bufferViews'] = new_views
J['buffers'] = [{'byteLength': len(out)}]

js = json.dumps(J, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(out) % 4: out.append(0)
glb = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(out))
glb += struct.pack('<I', len(js)) + b'JSON' + js
glb += struct.pack('<I', len(out)) + b'BIN\x00' + bytes(out)
open(dst, 'wb').write(glb)
print(f"{len(raw)//1024} KB -> {len(glb)//1024} KB")
