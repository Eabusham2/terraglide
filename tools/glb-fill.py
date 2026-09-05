"""Close the holes in a mesh without touching a single vertex it already has.

tools/glb-heal.py welds first, and a weld is right when the fault *is* two
vertices that should have been one. It is wrong here. A texture seam is stored
as two vertices at one place with different texture coordinates, and welding
those keeps one coordinate and throws the other away — so the picture is
dragged across the atlas at every chart boundary, and a figure that had no
cracks in it comes out covered in them. That is what happened to the character.

This does the second half only. It welds by position to *find* the boundaries,
because an unwelded mesh calls every texture seam a hole, and then fills them
against the original indices: every existing vertex, texture coordinate and
triangle is left exactly as it was, and the fill is triangles and nothing else.

It used to add a point at the middle of each hole and fan around that, and the
point needed a texture coordinate, which was taken as the average of the ones
around the hole. A hole's rim is not a neighbourhood in the atlas — its
vertices can be scattered right across it — so the average landed nowhere in
particular and the fan stretched the whole picture across it. That is what
turned both boot soles into a smeared rainbow starburst. Fanning from a corner
the hole already has needs no new coordinate and cannot invent one.

The holes it is for are the boot soles. The generator built the figure standing
on an implied floor, tools/glb-optimise.py cut the floor away by dropping every
triangle lying flat in the bottom slice of the model, and some of the soles
were lying flat in the bottom slice too.

Usage: glb-fill.py in.glb out.glb
"""
import json, math, struct, sys
from collections import defaultdict

src, dst = sys.argv[1], sys.argv[2]
# How far a triangle may stretch across the atlas, as a multiple of what the
# mesh normally does, before it is treated as unmapped. The body's own spread
# is tight — its ninetieth percentile is 1.1 times its median — so anything
# past about two is not detail, it is a triangle reading a part of the picture
# that has nothing to do with it.
STRETCH = float(sys.argv[3]) if len(sys.argv) > 3 else 2.2

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


def stride_of(a, bv):
    size = COMP[a['componentType']] * NUM[a['type']]
    if bv.get('byteStride'): return bv['byteStride']
    pad = (size + 3) // 4 * 4
    span = bv['byteLength'] - a.get('byteOffset', 0)
    if size % 4 and a['count'] and span == a['count'] * pad: return pad
    return size


def read(i):
    """Raw stored values, in whatever type the file uses. Not un-normalised:
    an int8 normal averaged as an int8 and written back as an int8 is the same
    number it would have been as a float, and never leaves the file's type."""
    a = J['accessors'][i]
    bv = J['bufferViews'][a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NUM[a['type']]
    stride = stride_of(a, bv)
    f = FMT[a['componentType']]
    return [list(struct.unpack_from(f'<{n}{f}', BIN, start + e * stride))
            for e in range(a['count'])], a, stride


out = bytearray()
views = []
def add_view(data, **extra):
    while len(out) % 4: out.append(0)
    v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
    v.update(extra)
    out.extend(data)
    views.append(v)
    return len(views) - 1


for im in J.get('images', []):
    if 'bufferView' not in im: continue
    bv = J['bufferViews'][im['bufferView']]
    s = bv.get('byteOffset', 0)
    im['bufferView'] = add_view(BIN[s:s + bv['byteLength']])

filled = added = 0
for mesh in J.get('meshes', []):
    for prim in mesh['primitives']:
        if 'indices' not in prim: continue
        attrs = {name: read(i) for name, i in prim['attributes'].items()}
        pos, pa, _ = attrs['POSITION']
        idx = [v[0] for v in read(prim['indices'])[0]]
        span = max(pa['max'][i] - pa['min'][i] for i in range(3)) or 1.0
        q = span * 1e-5

        # Weld to find the boundaries, and only to find them.
        weld, wid = {}, [0] * pa['count']
        first = {}
        for v in range(pa['count']):
            k = tuple(round(c / q) for c in pos[v])
            if k not in weld:
                weld[k] = len(weld)
                first[weld[k]] = v
            wid[v] = weld[k]

        tris = [(wid[idx[t]], wid[idx[t+1]], wid[idx[t+2]])
                for t in range(0, len(idx), 3)]
        tris = [t for t in tris if t[0] != t[1] and t[1] != t[2] and t[0] != t[2]]
        new_tris = []
        new_rows = {name: [] for name in attrs}   # kept empty: see below
        for _round in range(12):
            directed = set()
            for a, b, c in tris:
                directed.update(((a, b), (b, c), (c, a)))
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
                for i in range(1, len(loop) - 1):
                    new_tris.append((loop[0], loop[i + 1], loop[i]))
                filled += 1
            # Next round sees the filled surface.
            for loop in loops:
                for i in range(1, len(loop) - 1):
                    tris.append((loop[0], loop[i + 1], loop[i]))
        added += len(new_rows['POSITION'])

        flat = list(idx)
        for a, b, c in new_tris:
            flat.extend((first[a], first[b], first[c]))

        # And flatten the triangles the ground cut left stretched across the
        # atlas.
        #
        # Removing the baked floor leaves a rim joining the sole of a boot to
        # vertices that used to be on the slab, and those still carry the
        # slab's texture coordinates — so a triangle a centimetre across reads
        # a third of the picture. On this figure the worst of them covers three
        # hundred times the atlas area its neighbours do, which is the smeared
        # rainbow starburst on both soles.
        #
        # There is no photograph of the underside of a boot; the generator only
        # ever saw the floor there. So they take the flat colour of the nearest
        # triangle that *is* mapped properly, on copies of their own vertices,
        # so nothing else sharing those vertices is touched.
        uvs = attrs.get('TEXCOORD_0', (None,))[0]
        if uvs:
            out_tris = [tuple(flat[t:t+3]) for t in range(0, len(flat), 3)]
            def spread_of(t):
                u = [uvs[v] if v < len(uvs) else new_rows['TEXCOORD_0'][v - pa['count']]
                     for v in t]
                area = abs((u[1][0]-u[0][0]) * (u[2][1]-u[0][1])
                           - (u[2][0]-u[0][0]) * (u[1][1]-u[0][1])) / 2
                q = [pos[v] if v < len(pos) else new_rows['POSITION'][v - pa['count']]
                     for v in t]
                ax = [q[1][i] - q[0][i] for i in range(3)]
                bx = [q[2][i] - q[0][i] for i in range(3)]
                cr = [ax[1]*bx[2] - ax[2]*bx[1], ax[2]*bx[0] - ax[0]*bx[2],
                      ax[0]*bx[1] - ax[1]*bx[0]]
                return area / max(math.sqrt(sum(c*c for c in cr)) / 2, 1e-12)
            def middle(t):
                q = [pos[v] if v < len(pos) else new_rows['POSITION'][v - pa['count']]
                     for v in t]
                return [sum(c[i] for c in q) / 3 for i in range(3)]
            spreads = [spread_of(t) for t in out_tris]
            typical = sorted(spreads)[len(spreads) // 2]
            bad = [i for i, r in enumerate(spreads) if r > typical * STRETCH]
            good = [i for i, r in enumerate(spreads) if r <= typical * STRETCH]
            if bad and good:
                # One real corner, not the average of three.
                #
                # A triangle's mean texture coordinate is only meaningful if
                # its corners are near each other in the atlas, and on a
                # generated mesh they routinely are not — so the average lands
                # somewhere unrelated and the flattened sole came out in
                # patches of skin and jacket. A single corner of a
                # well-mapped triangle is a real point on the real picture.
                anchors = []
                seen_v = set()
                for i in good:
                    for v in out_tris[i]:
                        if v in seen_v or v >= len(uvs): continue
                        seen_v.add(v)
                        anchors.append((pos[v], list(uvs[v])))
                for i in bad:
                    t = out_tris[i]
                    mid = middle(t)
                    near = min(anchors, key=lambda a: sum(
                        (a[0][k] - mid[k]) ** 2 for k in range(3)))
                    fresh = []
                    for v in t:
                        for name, (vals, acc, _s) in attrs.items():
                            n2 = NUM[acc['type']]
                            row = list(vals[v]) if v < len(vals) else \
                                list(new_rows[name][v - pa['count']])
                            if name == 'TEXCOORD_0': row = list(near[1])
                            if acc['componentType'] != 5126:
                                row = [int(round(x)) for x in row]
                            new_rows[name].append(row)
                        fresh.append(pa['count'] + len(new_rows['POSITION']) - 1)
                    out_tris[i] = tuple(fresh)
                print(f'  flattened {len(bad)} triangles stretched across the atlas')
                flat = [v for t in out_tris for v in t]

        for name, (vals, acc, stride) in attrs.items():
            n = NUM[acc['type']]
            f = FMT[acc['componentType']]
            data = bytearray()
            for row in vals + new_rows[name]:
                data.extend(struct.pack(f'<{n}{f}', *row))
                while len(data) % stride: data.append(0)
            a2 = dict(acc)
            a2['count'] = len(vals) + len(new_rows[name])
            a2['byteOffset'] = 0
            size = COMP[acc['componentType']] * n
            a2['bufferView'] = add_view(bytes(data), target=34962,
                **({'byteStride': stride} if stride != size else {}))
            J['accessors'][prim['attributes'][name]] = a2

        wide = max(flat) > 65535
        J['accessors'][prim['indices']] = {
            'componentType': 5125 if wide else 5123, 'type': 'SCALAR',
            'count': len(flat), 'byteOffset': 0,
            'bufferView': add_view(
                struct.pack(f'<{len(flat)}{"I" if wide else "H"}', *flat),
                target=34963)}

J['bufferViews'] = views
J['buffers'] = [{'byteLength': len(out)}]
js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
out.extend(b'\0' * (-len(out) % 4))
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out))
glb += struct.pack('<I4s', len(js), b'JSON') + js
glb += struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out)
open(dst, 'wb').write(glb)
print(f'filled {filled} holes with {added} new points, every original vertex kept')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
