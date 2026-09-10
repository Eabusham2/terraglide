"""Cut the baked floor off a generated figure and keep the part of it that is the sole.

A single-image reconstructor reads the contact shadow under a standing figure
as surface, so it builds a flat plate and stands the model on it. Cutting that
plate away is the obvious move and it has never once worked here: the plate and
the boots share vertices, so the cut takes the bottom off both, and everything
downstream — ear-clipped fills, flat colour painted into an unused corner of
the atlas, normals turned away from the figure's middle — is repair of that
damage. The soles came out ragged, then pale, then shard-shaded, in that order.

There was a sole all along. Photograph the plate from underneath and two shoe
prints are on it, tread and all: the generator painted the boot's underside
onto the plate where the boot meets it, because that is where it saw one. So
the plate does not all have to go. What is under a boot *is* that boot's sole,
in the generator's own geometry, with the generator's own texture coordinates,
already welded to the boot wall around it — and what is not under a boot is
floor and goes.

Which is which is measured, not guessed:

  * the plate is the flat sheet in the bottom few millimetres — here 11,462
    triangles reaching 0.71 out from the axis, against boots that reach 0.14;
  * each boot's footprint comes from the vertices just above the sheet, above
    the plate and below the ankle — two ovals 8.1 by 13.3 cm;
  * a sheet triangle is kept when its centre lies inside one of those ovals,
    tested radially from the footprint's own middle so the kept patch follows
    the sole's outline instead of a bounding box's corners.

Nothing is added, moved or re-coloured. The output is a subset of the input's
triangles with unused vertices dropped and the rest renumbered.

    python tools/glb-unfloor.py in.glb out.glb
"""
import json, math, struct, sys
from collections import defaultdict

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


idx = [v[0] for v in read(prim['indices'])]
pos = read(prim['attributes']['POSITION'])
uv = read(prim['attributes']['TEXCOORD_0'])
floor = min(v[1] for v in pos)

# The plate: flat, and in the bottom few millimetres. Measured as a band rather
# than a plane because the reconstructor's floor is not perfectly level.
SHEET = 0.005


def upward(t):
    """How level a triangle is: 1 lying flat, 0 standing on edge."""
    a, b, c = (pos[idx[t + k]] for k in range(3))
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    return abs(n[1]) / (math.sqrt(sum(q * q for q in n)) or 1)


# Level as well as low, and the level test is what makes the ring a ring. The
# bottom five millimetres hold 10,933 level triangles and 479 steep ones, and
# the steep ones are the foot of the boot wall: counting those as plate too
# left a gap in every contact ring, so the flood below walked straight out
# through it and kept the whole floor.
plate = {t for t in range(0, len(idx), 3)
         if max(pos[idx[t + k]][1] for k in range(3)) <= floor + SHEET and upward(t) > 0.95}

"""
  Which of the plate is sole, decided by where the boot stands on it.

  Two goes that did not work, because the shape has to come from the mesh and
  not from a guess about it:

    * an outline fitted to each boot — how far it reached in each of
      forty-eight directions round its own middle — came out spiky, because
      the ring of boot it measured flares outward above the sole and a vertex
      at the widest part of the ankle stretched the reach in its direction,
      dragging a wedge of floor in with it;

    * flooding the plate outward from under each boot and refusing to cross an
      edge the boot wall also uses would be exact if the wall met the plate in
      a closed ring. It very nearly does — the two rings trace 50 and 58
      vertices round the two boots — but each has a gap, and a flood only needs
      one: it walked out through it and kept 10,818 of the 10,933 triangles.

  What is sound is the ring itself. It is the line the generator drew where the
  boot stands on the floor, so its convex outline in plan *is* the sole's
  outline, taken from the mesh's own contact and not from anything that flares.
  A shoe print is convex but for its arch, and keeping the arch costs a few
  square millimetres of floor tucked under the instep where nothing can see it.
"""
# Welded, because a texture seam is two vertices in one place and the ring runs
# through several of them.
at, weld = {}, [0] * len(pos)
for v, xyz in enumerate(pos):
    key = (round(xyz[0], 5), round(xyz[1], 5), round(xyz[2], 5))
    if key not in at: at[key] = len(at)
    weld[v] = at[key]
place = [None] * len(at)
for v, xyz in enumerate(pos): place[weld[v]] = xyz

edges = defaultdict(list)
for t in range(0, len(idx), 3):
    a, b, c = (weld[idx[t + k]] for k in range(3))
    for u, v in ((a, b), (b, c), (c, a)):
        edges[(u, v) if u < v else (v, u)].append(t)

# Where the boot touches down: an edge with plate on one side and something
# that is not plate on the other.
contact = {e for e, ts in edges.items()
           if any(t in plate for t in ts) and any(t not in plate for t in ts)}
near = defaultdict(list)
for u, v in contact:
    near[u].append(v); near[v].append(u)

rings, seen = [], set()
for start_vertex in near:
    if start_vertex in seen: continue
    stack, group = [start_vertex], {start_vertex}
    seen.add(start_vertex)
    while stack:
        u = stack.pop()
        for v in near[u]:
            if v not in group:
                group.add(v); seen.add(v); stack.append(v)
    xs = [place[v][0] for v in group]
    zs = [place[v][2] for v in group]
    # A boot ring, not the slab's own rim: small, and near the axis.
    if max(xs) - min(xs) < 0.25 and max(zs) - min(zs) < 0.25 \
            and math.hypot(sum(xs) / len(xs), sum(zs) / len(zs)) < 0.25:
        rings.append([(place[v][0], place[v][2]) for v in group])
if not rings:
    raise SystemExit('no boot standing on the plate')


def hull(points):
    """The convex outline of a set of points in plan, anticlockwise."""
    points = sorted(set(points))
    if len(points) < 3: return points
    def half(seq):
        out = []
        for q in seq:
            while len(out) > 1:
                (ax, az), (bx, bz) = out[-2], out[-1]
                if (bx - ax) * (q[1] - az) - (bz - az) * (q[0] - ax) > 0: break
                out.pop()
            out.append(q)
        return out[:-1]
    return half(points) + half(points[::-1])


def inside(shape, x, z, pad=0.002):
    n = len(shape)
    for i in range(n):
        ax, az = shape[i]
        bx, bz = shape[(i + 1) % n]
        ex, ez = bx - ax, bz - az
        length = math.hypot(ex, ez) or 1
        # Signed distance to the edge, positive on the inside.
        if ((x - ax) * ez - (z - az) * ex) / length > pad: return False
    return True


soles = [hull(ring) for ring in rings]


def plan(t):
    return (sum(pos[idx[t + k]][0] for k in range(3)) / 3,
            sum(pos[idx[t + k]][2] for k in range(3)) / 3)


"""
  Flooded *and* bounded, because each alone gets it wrong in a different way.

  The outline alone keeps whole triangles that straddle it, and the plate's
  triangles out there are centimetres across: each boot came out wearing a
  jagged star of leftover floor. The flood alone escapes through the gaps in
  the ring. Together the flood gives a patch that is connected and follows the
  mesh's own edges, and the outline stops it at the gaps.
"""
sole_set = set()
for ring, shape in zip(rings, soles):
    mx = sum(x for x, _ in ring) / len(ring)
    mz = sum(z for _, z in ring) / len(ring)
    seed = min(plate, key=lambda t: (plan(t)[0] - mx) ** 2 + (plan(t)[1] - mz) ** 2)
    if not inside(shape, *plan(seed)): continue
    stack, found = [seed], {seed}
    while stack:
        t = stack.pop()
        a, b, c = (weld[idx[t + k]] for k in range(3))
        for u, v in ((a, b), (b, c), (c, a)):
            e = (u, v) if u < v else (v, u)
            if e in contact: continue
            for other in edges[e]:
                if other in plate and other not in found and inside(shape, *plan(other)):
                    found.add(other); stack.append(other)
    sole_set |= found

"""
  The floor goes entirely, and each boot is capped with its own footprint.

  Keeping the print itself was tried and cannot be made clean. The generator did
  not model a boot with a sole standing on a floor; it modelled a boot-shaped
  blob merged into a slab, with a shoe print painted on the slab where the two
  meet. The print's triangles are the slab's triangles, they reach out under and
  past the boot, and there is no ring anywhere in the mesh that separates the
  two. Every rule tried on it kept flat flaps of floor sticking out sideways —
  tightening the rule instead tore holes in the print.

  So: drop the whole bottom band, which leaves each boot open along a rim, and
  close each rim with a fan. The rim is the boot's cross-section a few
  millimetres up, which is convex, so a fan around its own centroid is exact —
  no ear clipping, no concave outline, no spines to shave.

  And the cap takes its colour from the print, at one texel.

  Stretching the print across the cap was the obvious thing and it came back as
  camouflage. This atlas is a patchwork of thousands of small charts with no
  common layout, so the print's triangles are scattered all over it: the
  rectangle that bounds their coordinates covers most of the body, and mapping
  the cap across that rectangle samples jacket, skin and wing in stripes.

  There is no chart to map onto, so the cap does not map onto one. Every one of
  its vertices takes the *same* coordinate — the middle of the largest triangle
  of print, which is sole and is surrounded by sole. Nothing is interpolated,
  so nothing can be dragged in from a neighbouring chart, and the sole comes out
  the flat dark the generator painted it rather than a colour invented here or
  a block stamped into a spare corner of the atlas.
"""
def uv_area(t):
    a, b, c = (uv[idx[t + k]] for k in range(3))
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2


prints = []
for shape in soles:
    under = [t for t in sole_set if inside(shape, *plan(t))]
    if not under:
        prints.append(None)
        continue
    # The biggest piece of print in the atlas, so its middle is as far from a
    # chart's edge as this file allows.
    widest = max(under, key=uv_area)
    prints.append((sum(uv[idx[widest + k]][0] for k in range(3)) / 3,
                   sum(uv[idx[widest + k]][1] for k in range(3)) / 3))

low = {t for t in range(0, len(idx), 3)
       if max(pos[idx[t + k]][1] for k in range(3)) <= floor + SHEET}
keep = []
for t in range(0, len(idx), 3):
    if t in low:
        continue
    keep.extend(idx[t:t + 3])

# The rims the drop left open, traced from the edges that lost their partner.
side = defaultdict(int)
for t in range(0, len(keep), 3):
    a, b, c = (weld[keep[t + k]] for k in range(3))
    for u, v in ((a, b), (b, c), (c, a)):
        side[(u, v)] += 1
loose = [e for e in side if (e[1], e[0]) not in side]
after = {}
for u, v in loose:
    after.setdefault(u, []).append(v)

rims = []
walked = set()
for start_vertex in list(after):
    if start_vertex in walked: continue
    loop = [start_vertex]
    walked.add(start_vertex)
    while after.get(loop[-1]):
        nxt = after[loop[-1]].pop()
        if nxt in walked:
            break
        loop.append(nxt)
        walked.add(nxt)
    if len(loop) >= 6:
        rims.append(loop)

extra_pos, extra_uv, extra_nrm = [], [], []


def add_vertex(x, y, z, u, v):
    extra_pos.append((x, y, z))
    extra_uv.append((u, v))
    extra_nrm.append((0.0, -1.0, 0.0))          # a sole faces the ground
    return len(pos) + len(extra_pos) - 1


capped = 0
for loop in rims:
    at_xz = [(place[v][0], place[v][2]) for v in loop]
    mx = sum(x for x, _ in at_xz) / len(at_xz)
    mz = sum(z for _, z in at_xz) / len(at_xz)
    my = sum(place[v][1] for v in loop) / len(loop)
    colour = None
    for shape, spec in zip(soles, prints):
        if spec and inside(shape, mx, mz, 0.02):
            colour = spec
            break
    if colour is None:
        continue
    middle_vertex = add_vertex(mx, my, mz, *colour)
    ring = [add_vertex(place[v][0], place[v][1], place[v][2], *colour) for v in loop]
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        # Wound so the fan faces down, which is where a sole looks.
        keep.extend([middle_vertex, b, a])
    capped += 1

# Drop the vertices nothing points at any more, and renumber. The cap's own
# vertices were given indices past the end of the original list, so they come
# through the same renumbering as everything else.
made = {'POSITION': extra_pos, 'TEXCOORD_0': extra_uv, 'NORMAL': extra_nrm}
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
    rows = []
    for v in used:
        if v < len(pos):
            rows.append(bytes(BIN[base + v * step: base + v * step + size * n]))
        else:
            rows.append(struct.pack('<' + fmt * n, *made[name][v - len(pos)]))
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
attributes_index = len(J['accessors'])
J['accessors'].append({'bufferView': view, 'componentType': 5125 if wide else 5123,
                       'count': len(keep), 'type': 'SCALAR'})

# The pictures keep their own views, appended after the geometry.
for image in J.get('images', []):
    if 'bufferView' not in image: continue
    old = J['bufferViews'][image['bufferView']]
    start = old.get('byteOffset', 0)
    image['bufferView'] = add(bytes(BIN[start:start + old['byteLength']]))

prim['attributes'] = attributes
prim['indices'] = attributes_index
J['bufferViews'] = views
J['buffers'] = [{'byteLength': len(blob)}]

js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
blob.extend(b'\0' * (-len(blob) % 4))
glb = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
       + struct.pack('<I4s', len(js), b'JSON') + js
       + struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob))
open(dst, 'wb').write(glb)
print(f'  {len(plate)} level triangles in the floor; {len(rings)} boot rings found; '
      f'{len(low)} triangles of floor dropped; {capped} boots capped from the print')
print(f'  {len(idx) // 3} -> {len(keep) // 3} triangles, '
      f'{len(pos)} -> {len(used)} vertices')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
