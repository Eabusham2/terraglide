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

The holes it is for are the boot soles. The generator built the figure standing
on an implied floor, tools/glb-optimise.py cut the floor away by dropping every
triangle lying flat in the bottom slice of the model, and the soles were lying
flat in the bottom slice too. What is left is one long concave outline per
boot, which is why this went through three wrong answers before the right one:

  * A point in the middle of the hole, fanned around, needed a texture
    coordinate, and the average of the rim's landed nowhere in particular
    because a rim is not a neighbourhood in the atlas. Smeared rainbow.
  * A fan from a corner the hole already had needs no new coordinate — but a
    fan is only exact on a crack a few vertices long. Across a boot sole it
    lays skinny overlapping triangles on top of each other, some of them
    facing backwards: the pitted black mess.
  * Flattening whatever triangle stretched furthest across the atlas caught
    the sole and 169 pieces of thigh, hem and shoulder with it, each one a
    real part of the photograph replaced by a colour from somewhere else.

So: ear clipping for the shape, and one colour per *hole* rather than per
triangle for the paint. A hole either has a rim that sits in one part of the
picture — in which case its own corners are the right coordinates and nothing
is repainted — or it does not, and then the honest answer is a single flat
colour, taken from the one point on the rim that the rest of the rim is
nearest to. There is no photograph of the underside of a boot to use instead;
the generator only ever saw the floor there.

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



def triangulate(loop, first, pos):
    """Close one boundary loop, wound so the fill faces the way the surface does.

    A fan from one corner is exact on a crack a few vertices long and wrong on
    anything else: a boot sole is a long concave outline, and a fan across it
    lays skinny overlapping triangles over each other, some of them facing
    backwards, which is the pitted black mess that survived every attempt to
    fix it by changing what colour the sole was painted. Ear clipping is the
    fix, and it is a fix to the *shape* rather than to the paint.

    The loop is walked backwards because the boundary edges belong to the
    triangles on the other side of them: the surface uses (a, b), so the patch
    must use (b, a) to face the same way. Newell's normal of that reversed
    outline is the plane it is flattened onto, so the ears come out wound to
    match without having to be checked afterwards.
    """
    rev = list(reversed(loop))
    p = [pos[first[v]] for v in rev]
    n = [0.0, 0.0, 0.0]
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    ln = math.sqrt(sum(c * c for c in n))
    if ln < 1e-20:      # a degenerate outline has no plane to flatten onto
        return ([(loop[0], loop[i + 1], loop[i])
                 for i in range(1, len(loop) - 1)], None)
    n = [c / ln for c in n]
    up = [0.0, 0.0, 1.0] if abs(n[2]) < 0.9 else [1.0, 0.0, 0.0]
    e1 = [up[1]*n[2] - up[2]*n[1], up[2]*n[0] - up[0]*n[2], up[0]*n[1] - up[1]*n[0]]
    m = math.sqrt(sum(c * c for c in e1)) or 1.0
    e1 = [c / m for c in e1]
    e2 = [n[1]*e1[2] - n[2]*e1[1], n[2]*e1[0] - n[0]*e1[2], n[0]*e1[1] - n[1]*e1[0]]
    flatten = [(sum(q[k] * e1[k] for k in range(3)),
                sum(q[k] * e2[k] for k in range(3))) for q in p]

    def cross(o, a, b):
        return ((a[0]-o[0]) * (b[1]-o[1])) - ((a[1]-o[1]) * (b[0]-o[0]))

    def inside(a, b, c, q):
        d1, d2, d3 = cross(a, b, q), cross(b, c, q), cross(c, a, q)
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

    live = list(range(len(rev)))
    out = []
    normal = n
    guard = 0
    while len(live) > 3 and guard < len(rev) * len(rev) + 16:
        guard += 1
        for k in range(len(live)):
            i0, i1, i2 = live[k - 1], live[k], live[(k + 1) % len(live)]
            a, b, c = flatten[i0], flatten[i1], flatten[i2]
            if cross(a, b, c) <= 0: continue          # reflex, not an ear
            if any(inside(a, b, c, flatten[j]) for j in live
                   if j not in (i0, i1, i2)): continue
            out.append((rev[i0], rev[i1], rev[i2]))
            live.pop(k)
            break
        else:
            break                                     # no ear left: fan the rest
    for k in range(1, len(live) - 1):
        out.append((rev[live[0]], rev[live[k]], rev[live[k + 1]]))
    return out, normal


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
        # Shave the spikes off the rim before tracing it.
        #
        # A cut across a surface never lands on a tidy line: it leaves single
        # triangles hanging on by one corner, and a rim made of those is a
        # fringe of little spines. They are easy to name — a triangle with two
        # or three of its own edges on the boundary is attached to the surface
        # by at most one edge, which is not attached at all — and taking one
        # away can expose the next, so it goes round until a pass finds none.
        shaved = 0
        for _pass in range(8):
            edges = defaultdict(int)
            for a, b, c in tris:
                for e in ((a, b), (b, c), (c, a)):
                    edges[(min(e), max(e))] += 1
            loose = [t for t in tris
                     if sum(1 for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]))
                            if edges[(min(e), max(e))] == 1) >= 2]
            if not loose: break
            drop = set(map(tuple, loose))
            tris = [t for t in tris if tuple(t) not in drop]
            shaved += len(loose)
        if shaved: print(f'  shaved {shaved} spikes off the cut')

        patches = []          # the rim of each hole, in welded ids
        plane = {}            # and the flat it was closed on
        new_tris = []         # (which patch, triangle) for every triangle added
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
                patch = len(patches)
                patches.append(loop)
                shape, plane[patch] = triangulate(loop, first, pos)
                for tri in shape:
                    new_tris.append((patch, tri))
                    tris.append(tri)
                filled += 1

        # A hole has no picture, so give it the middle of its own rim.
        #
        # The fan's corners are real vertices carrying real texture
        # coordinates, which is right when a hole sits inside one chart and
        # very wrong when it does not: the rim of a boot sole is stitched from
        # pieces scattered right across the atlas, so a fan across it drags the
        # whole photograph over the sole in a smeared rainbow. There is no
        # photograph of the underside of a boot to drag there instead — the
        # generator only ever saw the floor — so the honest answer is one flat
        # colour, and the least arbitrary flat colour available is a real point
        # on the rim that the rest of the rim is nearest to.
        #
        # It is decided per hole rather than per triangle. A threshold applied
        # to single triangles is what put flat patches on the thigh, the hem
        # and the shoulder of a mesh whose only unmapped surface was under its
        # boots: 169 of them, each a real piece of the picture replaced with a
        # colour from somewhere else. A hole either has a usable rim or it does
        # not, and its triangles are all the same case.
        uvs = attrs.get('TEXCOORD_0', (None,))[0]
        spot = {}
        if uvs and new_tris:
            sides = []
            for t in range(0, len(idx), 3):
                u = [uvs[v] for v in idx[t:t+3]]
                sides.append(max(math.dist(u[i], u[j])
                                 for i in range(3) for j in range(i + 1, 3)))
            usual = sorted(sides)[len(sides) // 2]
            for patch, loop in enumerate(patches):
                rim = [uvs[first[v]] for v in loop]
                wide = max(max(u[k] for u in rim) - min(u[k] for u in rim)
                           for k in range(2))
                if wide < usual * 4: continue     # inside one chart: keep it
                spot[patch] = min(rim, key=lambda a: sum(
                    math.dist(a, b) for b in rim))

        new_rows = {name: [] for name in attrs}
        painted = {}
        def repaint(patch, v):
            """A copy of vertex v carrying the patch's one texture coordinate,
            so nothing else sharing that vertex is touched."""
            if (patch, v) in painted: return painted[(patch, v)]
            src_v = first[v]
            for name, (vals, acc, _s) in attrs.items():
                row = list(vals[src_v])
                # read() hands back what the file stores, so a normalised
                # integer coordinate is copied as that integer and never has
                # to be scaled back into it.
                if name == 'TEXCOORD_0': row = list(spot[patch])
                # And the flat it was closed on, rather than the rim's own
                # normals: those lean outward along the side of the boot, so a
                # sole wearing them shades like the wall it was cut from.
                if name == 'NORMAL' and plane.get(patch):
                    room = 127.0 if acc['componentType'] == 5120 else 1.0
                    row = [int(round(c * room)) for c in plane[patch]] \
                        + row[3:] if acc['componentType'] != 5126 else \
                        list(plane[patch]) + row[3:]
                new_rows[name].append(row)
            painted[(patch, v)] = pa['count'] + len(new_rows['POSITION']) - 1
            return painted[(patch, v)]

        flat = list(idx)
        for patch, (a, b, c) in new_tris:
            if patch in spot:
                flat.extend((repaint(patch, a), repaint(patch, b), repaint(patch, c)))
            else:
                flat.extend((first[a], first[b], first[c]))
        added = len(new_rows['POSITION'])
        if spot:
            print(f'  {len(spot)} of {len(patches)} holes had no usable rim '
                  f'and took one colour from it')

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
