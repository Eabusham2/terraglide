"""Shrink a TRELLIS GLB into something a browser game can afford to download."""
import math, struct, json, io, sys
from PIL import Image

src, dst, tex_size, quality = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
# Optional fifth argument: cluster the mesh onto a grid this many cells across
# its longest side before anything else. TRELLIS hands back fifty thousand
# triangles for an object that is held in a fist and covers forty pixels, and
# nothing else in here reduces triangle count at all.
cluster = int(sys.argv[5]) if len(sys.argv) > 5 else 0
# A texture size of 0 means leave the pictures and the numbers exactly as they
# are and only take the floor out.
#
# Halving the atlas is what made the shipped character soft: the generator hands
# back a 1024-pixel PNG and this wrote a 512-pixel JPEG, so three quarters of
# the picture went, along with everything JPEG does to a hard edge. That was
# worth it when the file had to be under a megabyte and is not worth it for an
# asset nobody downloads unless they ask for it. Quantising goes with it, since
# the whole point of this mode is that nothing is approximated.
KEEP_EVERYTHING = tex_size == 0

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
    n = NUM0[a['type']]
    fmt = {5120:'b', 5121:'B', 5122:'h', 5123:'H', 5125:'I', 5126:'f'}[a['componentType']]
    size = COMP0[a['componentType']] * n
    return list(struct.unpack(f'<{a["count"]*n}{fmt}', bytes(BIN[start:start + a['count']*size]))), a


def boundary_edges(J, BIN):
    """Edges used by one triangle, after welding vertices that share a place."""
    from collections import defaultdict
    total_open = 0
    total = 0
    for mesh in J.get('meshes', []):
        for prim in mesh['primitives']:
            if 'indices' not in prim: continue
            pos, pa = read_acc0(prim['attributes']['POSITION'])
            idx, _ = read_acc0(prim['indices'])
            span = max(pa['max'][i] - pa['min'][i] for i in range(3)) or 1.0
            q = span * 1e-5
            weld = {}
            wid = [0] * pa['count']
            bad = False
            for v in range(pa['count']):
                xyz = pos[v*3:v*3+3]
                # A mesh can carry a vertex that is not a number. It is not a
                # place, so it cannot be welded to one; the whole primitive is
                # simply not measurable and saying so beats guessing.
                if any(c != c or c in (float('inf'), float('-inf')) for c in xyz):
                    bad = True
                    break
                k = tuple(round(c / q) for c in xyz)
                wid[v] = weld.setdefault(k, len(weld))
            if bad: continue
            seen = defaultdict(int)
            for t in range(0, len(idx), 3):
                a, b, c = wid[idx[t]], wid[idx[t+1]], wid[idx[t+2]]
                if a == b or b == c or a == c: continue
                for u, v in ((a, b), (b, c), (c, a)):
                    seen[(min(u, v), max(u, v))] += 1
            total_open += sum(1 for n in seen.values() if n == 1)
            total += len(seen)
    return total_open, total

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
    # A single-sided shell shows nothing at all where you are looking at its
    # back, which reads as a hole whether or not there is one. These are small
    # props: drawing both faces costs nothing and removes a whole class of
    # "there is a gap in it".
    mat['doubleSided'] = True

# 1. Textures: PNG -> JPEG, downscaled. Skipped entirely when keeping everything.
used_images = set()
for mat in J.get('materials', []):
    for slot in (mat.get('pbrMetallicRoughness') or {}).values():
        if isinstance(slot, dict) and 'index' in slot:
            used_images.add(J['textures'][slot['index']].get('source'))
for i, im in enumerate(list(J.get('images', []))):
    if i not in used_images:
        continue
    if KEEP_EVERYTHING:
        # Carried across byte for byte — but it still has to be *carried*. The
        # buffer is rebuilt from scratch below, so an image left pointing at
        # the view it used to live in ends up pointing at somebody else's
        # numbers, and the file loads with no picture at all.
        im['bufferView'] = add_view(view_bytes(im['bufferView']))
        continue
    img = Image.open(io.BytesIO(view_bytes(im['bufferView']))).convert('RGB')
    img = img.resize((tex_size, tex_size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True)
    im['bufferView'] = add_view(buf.getvalue())
    im['mimeType'] = 'image/jpeg'

# Anything no material points at goes, rather than being left in the file
# pointing at a view that is no longer there. The metal-roughness map is
# exactly that: the material stage above drops it, and it is two thirds of a
# megabyte of picture nothing reads.
if J.get('images'):
    keep = [i for i in range(len(J['images'])) if i in used_images]
    dropped = len(J['images']) - len(keep)
    moved = {old: new for new, old in enumerate(keep)}
    J['images'] = [J['images'][i] for i in keep]
    # And the texture entries that pointed at them, or the file is left naming
    # a picture that is not in it any more.
    live = [t for t in range(len(J.get('textures', [])))
            if J['textures'][t].get('source') in moved]
    slot = {old: new for new, old in enumerate(live)}
    J['textures'] = [J['textures'][t] for t in live]
    for tex in J['textures']:
        tex['source'] = moved[tex['source']]
    for mat in J.get('materials', []):
        for name, value in list((mat.get('pbrMetallicRoughness') or {}).items()):
            if isinstance(value, dict) and 'index' in value:
                mat['pbrMetallicRoughness'][name]['index'] = slot[value['index']]
    print(f'  {len(keep)} picture(s) kept, {dropped} dropped as unread')

# 1a. Decimate, by clustering vertices onto a grid.
#
# Quadric error metrics would keep silhouettes better and are a great deal more
# code. Clustering is enough here because the things being shrunk are small
# props seen at arm's length: a tube, a cone, a pair of shells. Snap every
# vertex to a cell, average what lands in each, and drop the triangles that
# collapse.
#
# The key is the cell and nothing else, which is what makes it watertight: every
# vertex at a given place becomes the same vertex, so no triangle is left with
# an edge nobody shares. Adding a quantised UV to the key was tried, to stop a
# seam being averaged into a smear across the middle of the texture, and it
# tears the mesh open — two vertices at one place with different UVs stay two
# vertices, and every UV chart boundary becomes a crack you can see through.
# Holes are far worse than a smear.
#
# The smear is dealt with where it belongs: positions and normals are averaged
# over the cell, and the texture coordinate is *taken* from one member rather
# than averaged. A cell straddling a seam then reads one side's texture, which
# is a small local discontinuity, instead of the midpoint of two distant places
# in the picture, which is a streak.
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
                k = (cx, cy, cz)
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
                    if name == 'TEXCOORD_0':
                        # Taken, not averaged. See the note above.
                        first = members[0]
                        packed.extend(vals[first*n:(first+1)*n])
                        continue
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
    n = NUM0[a['type']]
    fmt = {5120:'b', 5121:'B', 5122:'h', 5123:'H', 5125:'I', 5126:'f'}[a['componentType']]
    size = COMP0[a['componentType']] * n
    return list(struct.unpack(f'<{a["count"]*n}{fmt}', bytes(BIN[start:start + a['count']*size]))), a

for mesh in J['meshes']:
    for prim in mesh['primitives']:
        if 'indices' not in prim: continue
        pos, pacc = read_acc(prim['attributes']['POSITION'])
        idx, iacc = read_acc(prim['indices'])
        lo = pacc['min'][1]; hi = pacc['max'][1]
        cut = lo + (hi - lo) * 0.02
        # How wide the figure itself is down there, measured rather than
        # assumed: the radius of everything standing in the slice just above
        # the cut, which on this mesh is a pair of boots at 0.135 against a
        # floor that reaches 0.5.
        foot = 0.0
        for v in range(pacc['count']):
            y = pos[v*3+1]
            if cut <= y < cut + (hi - lo) * 0.03:
                foot = max(foot, math.hypot(pos[v*3], pos[v*3+2]))
        foot = foot or (hi - lo) * 0.2

        def upward(a, b, c):
            """How level the triangle lies, as |n.y| of its unit normal."""
            q = [pos[v*3:v*3+3] for v in (a, b, c)]
            u = [q[1][i] - q[0][i] for i in range(3)]
            w = [q[2][i] - q[0][i] for i in range(3)]
            n = [u[1]*w[2] - u[2]*w[1], u[2]*w[0] - u[0]*w[2], u[0]*w[1] - u[1]*w[0]]
            m = math.sqrt(sum(x*x for x in n))
            return abs(n[1]) / m if m else 1.0

        # Height alone took the boots with the floor.
        #
        # Two per cent of this figure is three and a half centimetres, and a
        # boot is taller than that — so a rule that drops everything below the
        # line sliced a horizontal band off the bottom of both boots and left a
        # ragged stepped rim where it happened to cross their triangles. That
        # rim is what the fill then closed, and a notched outline at the toe is
        # what it looked like: not compression, not aliasing, a cut in the
        # wrong place.
        #
        # What is actually down there is a floor, and a floor is *flat*. So a
        # triangle below the line goes only if it lies level, or if it is
        # further out than the figure's own footprint — which catches the lip
        # where the slab turns down at its edge, half a body-length away from
        # anything real. The boots keep their walls, the hole left is the
        # outline of a sole rather than a slice through one, and the fill has
        # something sensible to close.
        keep = []
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t+1], idx[t+2]
            if pos[a*3+1] < cut and pos[b*3+1] < cut and pos[c*3+1] < cut:
                level = upward(a, b, c) > 0.966            # within 15 degrees
                away = min(math.hypot(pos[v*3], pos[v*3+2])
                           for v in (a, b, c)) > foot * 1.5
                if level or away: continue
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
            fmt = {5120:'b', 5121:'B', 5122:'h', 5123:'H', 5125:'I',
                   5126:'f'}[acc['componentType']]
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

# And say whether the thing is still closed.
#
# Clustering welds vertices and drops the triangles that collapse, and if the
# key it welds on splits two vertices that sit at the same place — a texture
# seam, say — the triangles either side of that seam stop sharing an edge and
# the surface tears. Measured on positions rather than on indices, because a
# seam is two indices at one place and an index-based test calls that a hole
# when it is not.
_open, _edges = boundary_edges(J, BIN)
print(f"  open edges {_open} of {_edges} ({100 * _open / max(1, _edges):.1f}%)"
      + ("  <- HOLES" if _open > _edges * 0.01 else ""))

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
            stride_for = None
            # Quantise the attributes glTF lets us store small: normals as
            # signed bytes and UVs as unsigned shorts, both normalised. A
            # normal has no business being three float32s.
            if name == 'NORMAL' and acc['componentType'] == 5126 and not KEEP_EVERYTHING:
                vals = struct.unpack(f'<{acc["count"]*3}f', data)
                packed = bytearray()
                for i in range(acc['count']):
                    x, y, z = vals[i*3:i*3+3]
                    # A normal that is not a unit vector is not a direction. The
                    # generator does not always hand back unit ones, and a short
                    # one draws dark, so it is made unit here rather than hoping.
                    m = math.sqrt(x*x + y*y + z*z) or 1.0
                    for c in (x/m, y/m, z/m):
                        packed.append(struct.pack('<b', max(-127, min(127, round(c*127))))[0])
                    packed.append(0)          # pad VEC3 int8 to 4 bytes
                data = bytes(packed)
                acc['componentType'] = 5120
                acc['normalized'] = True
                acc.pop('min', None); acc.pop('max', None)
                # ...and say that it is padded.
                #
                # Three signed bytes must be written as four, because glTF wants
                # every vertex attribute aligned to four. But a bufferView that
                # does not declare a byteStride means tightly packed, and then
                # every reader steps three bytes at a time through data written
                # four apart: the first normal is right and each one after is
                # dragged a byte further out of place, mixing one vertex's z
                # into the next one's x. Half of them come back as garbage
                # directions of no particular length, and short normals draw
                # black — which is what the smudging over the scanned player
                # was, all of it. The padding was right; not declaring it was
                # the bug.
                stride_for = 4
            elif name == 'TEXCOORD_0' and acc['componentType'] == 5126 and not KEEP_EVERYTHING:
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
            extra = {'target': 34963} if name == '__idx' else {'target': 34962}
            if stride_for: extra['byteStride'] = stride_for
            acc['bufferView'] = add_view(data, **extra)

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

