"""Take the ground out of a generation reference, so the model has no floor.

Every sole repair on the player traces back to one thing in the picture it was
made from: the figure stands on a soft contact shadow. A single-image
reconstructor reads that shadow as surface, so it built a square plate under
the boots and fused the boots into it — 11,857 triangles of floor, and the
soles welded to their top face rather than existing as soles at all.

Cutting the plate out afterwards is what the rest of this directory has been
about, and it cannot win: the plate and the boot share vertices, so the cut
takes the bottom off both, and the fill that closes the hole has no texture to
sample and no outward direction it can be sure of. Removing the shadow *first*
means there is no plate, the boots come back closed, and none of it is needed.

Thresholding on colour alone does not survive contact with the picture. The
shadow is skylight, so it is blue — (102,109,128) at its core — against sage
wings at (180,184,159) and neutral leather at (85,81,82). Blue over red does
pick it out, and it also picks out a few hundred cool highlights on the boots:
run over the whole image it punched white holes in both toes, and run below the
ankles it still bit a notch out of one.

So the figure is found as a *region* and only what is outside it is erased:

  * flood outward from inside a trouser leg through pixels that are both dark
    and neutral, which fills the legs and the boots and stops dead at the
    shadow, whichever of the two happens to be darker;
  * grow that region by eight pixels, because a specular highlight on a boot's
    rim can sit that far from the nearest pixel dark enough to count as
    leather, and it is the rim ones that no hole-fill can recover;
  * erase to white only below the ankle line and only outside the grown region.

What is left is a hairline of shadow hugging each sole — eight pixels of 1024
is fourteen millimetres on a figure 1.8 m tall — which is a contact line and
not a floor. The paper is lifted to true white in the same pass, so the
background is uniform for whatever cut-out the generator runs.

    python tools/ref-clean.py reference.jpg cleaned.png [ankle-row]
"""
import sys
from collections import deque
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
GROUND = int(sys.argv[3]) if len(sys.argv) > 3 else 860

im = Image.open(src).convert('RGB')
w, h = im.size
px = im.load()
out = im.copy()
o = out.load()


def leather(x, y):
    """Dark and neutral: the boots and the trousers, never the blue shadow."""
    r, g, b = px[x, y]
    return max(r, g, b) < 165 and b - r < 12


# Seeded on the darkest pixel of a row that is unambiguously trouser rather
# than on a guessed coordinate — the first guess landed on the paper.
seed = min(((max(px[x, GROUND - 160]), x) for x in range(w)))[1], GROUND - 160
if not leather(*seed):
    raise SystemExit(f'no dark pixel to start from on row {GROUND - 160}')

figure = bytearray(w * h)
queue = deque([seed])
figure[seed[1] * w + seed[0]] = 1
while queue:
    x, y = queue.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and not figure[ny * w + nx] and leather(nx, ny):
            figure[ny * w + nx] = 1
            queue.append((nx, ny))

mask = Image.frombytes('L', (w, h), bytes(255 if v else 0 for v in figure))
grown = mask.filter(ImageFilter.MaxFilter(17)).load()          # eight pixels

erased = paper = 0
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if y >= GROUND and not grown[x, y]:
            if (r, g, b) != (255, 255, 255):
                erased += 1
            o[x, y] = (255, 255, 255)
        elif min(r, g, b) > 232:
            o[x, y] = (255, 255, 255)
            paper += 1
out.save(dst)
print(f'{src} -> {dst}: {sum(figure)} texels of figure, {erased} of ground erased '
      f'below row {GROUND}, {paper} of paper lifted to white')
