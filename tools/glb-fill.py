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
triangle is left exactly as it was, and the only new geometry is one point per
hole and a fan around it. Attributes are re-encoded in whatever type the file
already uses, so a quantised mesh stays quantised.

The holes it is for are the boot soles. The generator built the figure standing
on an implied floor, tools/glb-optimise.py cut the floor away by dropping every
triangle lying flat in the bottom slice of the model, and some of the soles
were lying flat in the bottom slice too.

Usage: glb-fill.py in.glb out.glb
"""
import json, math, struct, sys
from collections import defaultdict

src, dst = sys.argv[1], sys.argv[2]

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
        new_rows = {name: [] for name in attrs}
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
                centre = pa['count'] + len(new_rows['POSITION'])
                for name, (vals, acc, _s) in attrs.items():
                    n = NUM[acc['type']]
                    mean = [sum(vals[first[w]][c] for w in loop) / len(loop)
                            for c in range(n)]
                    if name == 'NORMAL':
                        m = math.sqrt(sum(x * x for x in mean)) or 1.0
                        top = 127.0 if acc['componentType'] == 5120 else 1.0
                        mean = [x / m * top for x in mean]
                    if acc['componentType'] != 5126:
                        mean = [int(round(x)) for x in mean]
                    new_rows[name].append(mean)
                for i in range(len(loop)):
                    new_tris.append((loop[(i + 1) % len(loop)], loop[i], centre))
                tris.append((loop[0], loop[1], centre))   # so the round ends
                filled += 1
            # Re-derive from the real triangle list next round.
            tris = tris[:-len(loops)] + [
                (loop[(i + 1) % len(loop)], loop[i], pa['count'] + k)
                for k, loop in enumerate(loops, start=len(new_rows['POSITION']) - len(loops))
                for i in range(len(loop))]
        added += len(new_rows['POSITION'])

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

        flat = list(idx)
        for a, b, c in new_tris:
            flat.extend((first[a], first[b], c) if c >= pa['count']
                        else (first[a], first[b], first[c]))
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
