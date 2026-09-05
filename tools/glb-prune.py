"""Drop everything in a GLB that nothing in it reads.

A generator writes what its pipeline produces, not what a renderer will ask
for, so a file arrives carrying pictures no material points at. Usually that
is a metal-roughness map on a figure whose metalness has been set to zero, and
it is merely weight. Sometimes it is worse: `assets/rocket.glb` shipped an
image declared `image/png` whose bytes are not a PNG at all — they are a run
of little-endian sixteen-bit numbers, geometry that ended up under an image
entry — and every reader that decodes images eagerly rather than on demand
has to survive it. three.js decodes lazily and never touched it, which is why
it sat there for four commits, in the file, being served to everyone.

So this walks the file the way a renderer walks it: from the meshes to their
materials, from the materials to the textures they name, from the textures to
their images and samplers, and from every accessor to its buffer view. What is
never reached is dropped, the surviving indices are renumbered, and the binary
chunk is rebuilt out of only the views that are still pointed at. Nothing that
is reachable is re-encoded or moved: geometry and pictures come out byte for
byte as they went in.

    python tools/glb-prune.py in.glb out.glb
"""
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]

raw = open(src, 'rb').read()
off, J, BIN = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack('<I4s', raw[off:off+8])
    if ctype == b'JSON': J = json.loads(raw[off+8:off+8+clen])
    elif ctype == b'BIN\x00': BIN = bytes(raw[off+8:off+8+clen])
    off += 8 + clen

# What the renderer can reach.
materials = set()
for mesh in J.get('meshes', []):
    for prim in mesh['primitives']:
        if 'material' in prim: materials.add(prim['material'])

textures = set()
def note_texture(slot):
    if isinstance(slot, dict) and 'index' in slot: textures.add(slot['index'])
for m in materials:
    mat = J['materials'][m]
    pbr = mat.get('pbrMetallicRoughness', {})
    for slot in ('baseColorTexture', 'metallicRoughnessTexture'):
        note_texture(pbr.get(slot))
    for slot in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
        note_texture(mat.get(slot))

images, samplers = set(), set()
for t in textures:
    tex = J['textures'][t]
    if 'source' in tex: images.add(tex['source'])
    if 'sampler' in tex: samplers.add(tex['sampler'])

views = set()
for acc in J.get('accessors', []):
    if 'bufferView' in acc: views.add(acc['bufferView'])
for i in images:
    im = J['images'][i]
    if 'bufferView' in im: views.add(im['bufferView'])

dropped = {
    'materials': len(J.get('materials', [])) - len(materials),
    'textures': len(J.get('textures', [])) - len(textures),
    'images': len(J.get('images', [])) - len(images),
    'samplers': len(J.get('samplers', [])) - len(samplers),
    'bufferViews': len(J.get('bufferViews', [])) - len(views),
}

# Renumber what is left, in the order it already had.
def compact(name, keep):
    old = J.get(name, [])
    order = [i for i in range(len(old)) if i in keep]
    J[name] = [old[i] for i in order]
    return {o: n for n, o in enumerate(order)}

# The binary chunk is rebuilt from the views that survived, so their bytes have
# to be lifted out before the offsets are rewritten.
kept_views = sorted(views)
bytes_of = {i: BIN[J['bufferViews'][i].get('byteOffset', 0):
                   J['bufferViews'][i].get('byteOffset', 0)
                   + J['bufferViews'][i]['byteLength']] for i in kept_views}

view_of = compact('bufferViews', views)
image_of = compact('images', images)
sampler_of = compact('samplers', samplers)
texture_of = compact('textures', textures)
material_of = compact('materials', materials)

blob = bytearray()
for old in kept_views:
    while len(blob) % 4: blob.append(0)
    bv = J['bufferViews'][view_of[old]]
    bv['byteOffset'] = len(blob)
    blob.extend(bytes_of[old])

for acc in J.get('accessors', []):
    if 'bufferView' in acc: acc['bufferView'] = view_of[acc['bufferView']]
for im in J['images']:
    if 'bufferView' in im: im['bufferView'] = view_of[im['bufferView']]
for tex in J['textures']:
    if 'source' in tex: tex['source'] = image_of[tex['source']]
    if 'sampler' in tex: tex['sampler'] = sampler_of[tex['sampler']]
for mat in J['materials']:
    pbr = mat.get('pbrMetallicRoughness', {})
    for slot in ('baseColorTexture', 'metallicRoughnessTexture'):
        if slot in pbr: pbr[slot]['index'] = texture_of[pbr[slot]['index']]
    for slot in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
        if slot in mat: mat[slot]['index'] = texture_of[mat[slot]['index']]
for mesh in J.get('meshes', []):
    for prim in mesh['primitives']:
        if 'material' in prim: prim['material'] = material_of[prim['material']]

J['buffers'] = [{'byteLength': len(blob)}]
js = json.dumps(J, separators=(',', ':')).encode('utf8')
js += b' ' * (-len(js) % 4)
blob.extend(b'\0' * (-len(blob) % 4))
glb = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob))
       + struct.pack('<I4s', len(js), b'JSON') + js
       + struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob))
open(dst, 'wb').write(glb)
print('  dropped ' + ', '.join(f'{n} {k}' for k, n in dropped.items() if n))
print(f'{src} {len(raw)} -> {dst} {len(glb)} bytes')
