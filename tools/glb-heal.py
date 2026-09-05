"""Close the holes in a GLB: weld what should have been one vertex, fill the rest.

A mesh with an open edge is a mesh you can see through, and one shipped. This
repairs a file that already has them rather than regenerating it, which matters
when the thing that made it is behind a daily quota.

Two passes, in order, because the second is only sound after the first:

 1. Weld with a tolerance. Vertex clustering keyed on a texture coordinate as
    well as a cell — which is what tore this mesh — leaves the two halves of a
    seam as separate vertices at *nearly* the same place, because each half was
    averaged over its own members. An exact weld merges 90 of 4,452 of them; a
    weld with a tolerance of a fraction of the cell merges the pair and the
    crack between them closes with no new geometry at all.

 2. Fill what is left. Trace every boundary loop — the directed edges with no
    partner going the other way — and close each with a fan around its own
    centroid, wound to match the triangle the edge came from so the surface
    stays consistently outward. A fan is not the prettiest filling for a large
    concave hole; every hole here is a crack a few vertices long, and for those
    it is exact.

    node/python tools/glb-heal.py in.glb out.glb [tolerance-as-fraction-of-span]
"""
import struct, json, sys, math
from collections import defaultdict

src, dst = sys.argv[1], sys.argv[2]
TOL = float(sys.argv[3]) if len(sys.argv) > 3 else 0.02

raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off+8])
    if ctype == b'JSON': J = json.loads(raw[off+8:off+8+clen])
    elif ctype == b'BIN\x00': BIN = bytearray(raw[off+8:off+8+clen])
    off += 8 + clen

COMP = {5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4}
NUM = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}
FMT = {5120:'b', 5121:'B', 5122:'h', 5123:'H', 5125:'I', 5126:'f'}
# What a normalised integer attribute means as a real number, so everything can
# be worked on as floats and written back as floats.
SCALE = {5120:127.0, 5121:255.0, 5122:32767.0, 5123:65535.0}

def stride_of(a, bv):
    """How far apart the elements really are.

    A declared byteStride is the answer. Without one the specification says
    tightly packed — but a file can be written padded and simply not say so,
    and reading that at the tight stride drags every element a byte further out
    of place than the last. The only evidence left is that the view is exactly
    as long as a padded array would be, so take the length over the silence.
    Getting this wrong here does not just misread a file, it *bakes* the
    misreading in: whatever comes out is written back as floats, and then the
    original bytes are gone.
    """
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
    vals = []
    for e in range(a['count']):
        vals.extend(struct.unpack_from(f'<{n}{f}', BIN, start + e * stride))
    if a.get('normalized') and a['componentType'] in SCALE:
        s = SCALE[a['componentType']]
        vals = [max(-1.0, v / s) for v in vals]
    return vals, a, n

out = bytearray()
views = []
def add_view(data):
    while len(out) % 4: out.append(0)
    start = len(out)
    out.extend(data)
    views.append({'buffer': 0, 'byteOffset': start, 'byteLength': len(data)})
    return len(views) - 1

# Textures and anything else the materials point at are copied through
# untouched: this pass is about geometry and must not re-encode a picture.
image_view = {}
for im in J.get('images', []):
    bv = J['bufferViews'][im['bufferView']]
    s = bv.get('byteOffset', 0)
    image_view[id(im)] = add_view(bytes(BIN[s:s + bv['byteLength']]))

welded_total = 0
filled_total = 0
for mesh in J['meshes']:
    for prim in mesh['primitives']:
        if 'indices' not in prim: continue
        attrs = {name: read(i) for name, i in prim['attributes'].items()}
        pos, pa, _ = attrs['POSITION']
        idx, ia, _ = read(prim['indices'])
        span = max(pa['max'][i] - pa['min'][i] for i in range(3)) or 1.0
        q = span * TOL

        # 1. Weld.
        weld, wid = {}, [0]*pa['count']
        members = defaultdict(list)
        for v in range(pa['count']):
            xyz = pos[v*3:v*3+3]
            if any(c != c for c in xyz):
                wid[v] = weld.setdefault(('nan', v), len(weld))
                members[wid[v]].append(v)
                continue
            k = tuple(round(c / q) for c in xyz)
            if k not in weld: weld[k] = len(weld)
            wid[v] = weld[k]
            members[wid[v]].append(v)
        welded_total += pa['count'] - len(weld)

        # Every attribute takes the first member's value: averaging positions
        # is what moved the two halves apart in the first place.
        new = {name: [] for name in attrs}
        for w in range(len(weld)):
            first = members[w][0]
            for name, (vals, _acc, n) in attrs.items():
                new[name].extend(vals[first*n:(first+1)*n])

        tris = []
        for t in range(0, len(idx), 3):
            a, b, c = wid[idx[t]], wid[idx[t+1]], wid[idx[t+2]]
            if a == b or b == c or a == c: continue
            tris.append((a, b, c))

        # 2. Fill, and keep filling.
        #
        # One pass is not enough. Closing a loop joins triangles that were not
        # neighbours before, and where two holes met at a shared vertex the
        # leftovers only become a traceable loop once the first is gone. So it
        # runs again on its own output until a pass finds nothing, which on this
        # mesh is four rounds.
        for _round in range(12):
            directed = set()
            for a, b, c in tris:
                directed.update(((a, b), (b, c), (c, a)))
            # Every boundary edge, in a list per vertex rather than one each.
            #
            # A vertex can sit on two holes at once — a thin strip torn along both
            # sides has plenty of them — and keeping one successor per vertex threw
            # the other loop away, so those edges were never filled at all. They are
            # consumed as they are walked instead, so each is used exactly once.
            outgoing = defaultdict(list)
            for a, b in directed:
                if (b, a) not in directed: outgoing[a].append(b)
            loops = []
            for start_v in list(outgoing):
                while outgoing[start_v]:
                    loop, v = [], start_v
                    while outgoing.get(v):
                        loop.append(v)
                        v = outgoing[v].pop()
                        if v == start_v: break
                        if len(loop) > 100000: break
                    if len(loop) >= 3: loops.append(loop)
            if not loops: break
            for loop in loops:
                n = NUM[attrs['POSITION'][1]['type']]
                centre = len(new['POSITION']) // 3
                for name, (vals, _acc, cn) in attrs.items():
                    mean = [sum(new[name][w*cn + c] for w in loop) / len(loop) for c in range(cn)]
                    if name == 'NORMAL':
                        m = math.sqrt(sum(x*x for x in mean)) or 1.0
                        mean = [x / m for x in mean]
                    new[name].extend(mean)
                # Wound against the boundary edge, so the fill faces the same way
                # as the triangle the edge came from.
                for i in range(len(loop)):
                    a = loop[i]
                    b = loop[(i + 1) % len(loop)]
                    tris.append((b, a, centre))
                filled_total += 1

        for name, (vals, acc, n) in attrs.items():
            data = struct.pack(f'<{len(new[name])}f', *new[name])
            a2 = dict(acc)
            a2.update({'componentType': 5126, 'count': len(new[name]) // n,
                       'byteOffset': 0, 'bufferView': add_view(data)})
            a2.pop('normalized', None)
            if name == 'POSITION':
                a2['min'] = [min(new[name][i::3]) for i in range(3)]
                a2['max'] = [max(new[name][i::3]) for i in range(3)]
            J['accessors'][prim['attributes'][name]] = a2
        flat = [i for t in tris for i in t]
        J['accessors'][prim['indices']] = {
            'bufferView': add_view(struct.pack(f'<{len(flat)}I', *flat)),
            'byteOffset': 0, 'componentType': 5125, 'count': len(flat), 'type': 'SCALAR'}

for im in J.get('images', []):
    im['bufferView'] = image_view[id(im)]
for mat in J.get('materials', []):
    mat['doubleSided'] = True
J['bufferViews'] = views
J['buffers'] = [{'byteLength': len(out)}]

blob = json.dumps(J, separators=(',', ':')).encode()
while len(blob) % 4: blob += b' '
while len(out) % 4: out.append(0)
glb = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(blob) + 8 + len(out))
       + struct.pack('<I4s', len(blob), b'JSON') + blob
       + struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out))
open(dst, 'wb').write(glb)
print(f"  welded {welded_total} vertices, filled {filled_total} holes")
print(f"  {len(raw)//1024} KB -> {len(glb)//1024} KB")
