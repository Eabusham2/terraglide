"""Put a mesh's shading normals back.

A normal that is not a unit vector is not a direction, and a renderer that is
handed one does not complain: it multiplies it by the light and draws whatever
falls out. Short normals come out dark. Scattered short normals come out as
dark patches that follow nothing you can see in the picture — the smudging.

Two different ways to arrive there, and this mends both.

The first is a file that is written padded and does not say so. glTF wants
every vertex attribute aligned to four bytes, so three signed bytes of normal
are written as four, with a zero on the end. That is correct, but the padding
has to be declared as the bufferView's byteStride, and if it is not, then by
the specification the elements are tightly packed and every reader steps
through them three bytes at a time over data written four bytes apart. The
first normal is right and nothing after it is: each one is dragged a byte
further out of place, mixing one vertex's z with the next one's x, until the
drift wraps and three vertices in four are wrong. The bytes are all still
there, though, so this is recoverable exactly: read at the stride the file was
written at, and declare it on the way out.

The second is not recoverable, because somebody already read the file the wrong
way and wrote the result down as floats. Then the mixed-up directions *are* the
data. Renormalising them only makes unit-length nonsense, so with --rebuild the
normals are thrown away and recomputed from the triangles instead, area
weighted, which is what a mesh's normals would have been had nobody touched
them.

Usage: glb-normals.py in.glb out.glb [--rebuild]
"""
import json, math, struct, sys

src, dst = sys.argv[1], sys.argv[2]
rebuild = '--rebuild' in sys.argv[3:]

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
SCALE = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


def aligned(n):
    return (n + 3) // 4 * 4


def written_stride(acc, bv):
    """How far apart the elements actually are, rather than how far apart the
    file claims. A view with no byteStride is tightly packed by the
    specification, and that is how every reader will take it — but a file can
    be written padded and simply not say so, and then the only evidence left is
    that the view is exactly as long as a padded array would be. The length is
    what the bytes are; the silence is the bug."""
    tight = COMP[acc['componentType']] * NUM[acc['type']]
    if bv.get('byteStride'): return bv['byteStride']
    span = bv['byteLength'] - acc.get('byteOffset', 0)
    if acc['count'] and tight % 4 and span == acc['count'] * aligned(tight):
        return aligned(tight)
    return tight


def read(ai):
    """Every element of an accessor, as floats, taken at the stride the bytes
    are really at and un-normalised if the accessor says they are."""
    acc = J['accessors'][ai]
    bv = J['bufferViews'][acc['bufferView']]
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = written_stride(acc, bv)
    n = NUM[acc['type']]
    f, size = FMT[acc['componentType']], COMP[acc['componentType']]
    out = []
    for i in range(acc['count']):
        o = start + i * stride
        out.extend(struct.unpack_from(f'<{n}{f}', BIN, o))
    if acc.get('normalized') and acc['componentType'] in SCALE:
        s = SCALE[acc['componentType']]
        signed = acc['componentType'] in (5120, 5122)
        out = [max(v / s, -1.0) if signed else v / s for v in out]
    return out, acc


def face_normals(pos, idx, count):
    """Area-weighted normals from the triangles themselves. A face's cross
    product is already twice its area, so summing them unnormalised weights
    each corner by how much surface it is actually part of, which is what stops
    a fan of slivers from shouting down the one big triangle beside it."""
    acc = [0.0] * (count * 3)
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t+1], idx[t+2]
        ax, ay, az = pos[a*3:a*3+3]
        bx, by, bz = pos[b*3:b*3+3]
        cx, cy, cz = pos[c*3:c*3+3]
        ux, uy, uz = bx-ax, by-ay, bz-az
        vx, vy, vz = cx-ax, cy-ay, cz-az
        nx, ny, nz = uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx
        for v in (a, b, c):
            acc[v*3] += nx; acc[v*3+1] += ny; acc[v*3+2] += nz
    return acc


replacements = {}          # bufferView index -> new bytes
report = []

for mesh in J.get('meshes', []):
    for prim in mesh['primitives']:
        if 'NORMAL' not in prim['attributes'] or 'indices' not in prim: continue
        nrm, nacc = read(prim['attributes']['NORMAL'])
        pos, _ = read(prim['attributes']['POSITION'])
        idx = [int(v) for v in read(prim['indices'])[0]]
        count = nacc['count']
        fallback = face_normals(pos, idx, count)

        fixed = []
        degenerate = renormed = 0
        for v in range(count):
            x, y, z = nrm[v*3:v*3+3]
            L = math.sqrt(x*x + y*y + z*z)
            if rebuild or L < 1e-6:
                x, y, z = fallback[v*3:v*3+3]
                L = math.sqrt(x*x + y*y + z*z)
                degenerate += 1
            elif abs(L - 1.0) > 1e-3:
                renormed += 1
            if L < 1e-12:
                # A vertex no triangle uses has no direction to be given. Up is
                # as good as anything and is at least a unit vector.
                x, y, z, L = 0.0, 1.0, 0.0, 1.0
            fixed.extend((x / L, y / L, z / L))

        bv = J['bufferViews'][nacc['bufferView']]
        if nacc['componentType'] == 5120:
            packed = bytearray()
            for c in fixed:
                packed.append(struct.pack('<b', max(-127, min(127, round(c * 127))))[0])
                if len(packed) % 4 == 3: packed.append(0)
            replacements[nacc['bufferView']] = bytes(packed)
            bv['byteStride'] = 4
        else:
            replacements[nacc['bufferView']] = struct.pack(f'<{len(fixed)}f', *fixed)
            bv.pop('byteStride', None)
        nacc['byteOffset'] = 0
        report.append((count, degenerate, renormed))

# Repack the binary chunk in view order, so mending a view in place cannot
# leave its old bytes behind as dead weight in a file people download.
out = bytearray()
for i, bv in enumerate(J['bufferViews']):
    data = replacements.get(i)
    if data is None:
        s = bv.get('byteOffset', 0)
        data = BIN[s:s + bv['byteLength']]
    while len(out) % 4: out.append(0)
    bv['byteOffset'] = len(out)
    bv['byteLength'] = len(data)
    out.extend(data)
J['buffers'] = [{'byteLength': len(out)}]

js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
out.extend(b'\0' * (-len(out) % 4))
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out))
glb += struct.pack('<I4s', len(js), b'JSON') + js
glb += struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out)
open(dst, 'wb').write(glb)

for count, degenerate, renormed in report:
    print(f'{count} normals: {degenerate} recomputed, {renormed} renormalised')
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
