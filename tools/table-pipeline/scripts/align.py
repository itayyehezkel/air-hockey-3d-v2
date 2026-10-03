# Cuts a theme's turnaround sheet into its four views and lines each one up with the Classic render
# it was painted over (same camera), by matching the table's bounding box.
# Usage: python scripts/align.py THEME path/to/sheet.png
# Writes scripts/THEME_{front,left,back,right}.png (and a copy in viewer/ for bake.html).
from PIL import Image, ImageDraw, ImageFilter
import sys
theme = sys.argv[1]
sheet = Image.open(sys.argv[2]).convert('RGB')
S = sheet.width // 2
mask = lambda im: im.convert('L').point(lambda p: 255 if p < 235 else 0)
for i, n in enumerate(['front', 'left', 'back', 'right']):
    q = sheet.crop(((i % 2) * S, (i // 2) * S, (i % 2) * S + S, (i // 2) * S + S)).resize((2048, 2048), Image.LANCZOS)
    ref = Image.open(f'refs/classic-turnaround/{n}.png').convert('RGB')
    a = mask(q).getbbox(); b = mask(ref).getbbox()
    sx = (b[2] - b[0]) / (a[2] - a[0]); sy = (b[3] - b[1]) / (a[3] - a[1])
    # output pixel (X,Y) samples input (a0 + (X-b0)/sx, a1 + (Y-b1)/sy)
    out = q.transform((2048, 2048), Image.AFFINE, (1 / sx, 0, a[0] - b[0] / sx, 0, 1 / sy, a[1] - b[1] / sy), Image.BICUBIC, fillcolor=(255, 255, 255))
    # Cut the white background out (flood fill from the border), with a few pixels' margin around
    # the table so no background at its outline gets painted onto the model.
    bgmask = out.convert('L').point(lambda p: 255 if p > 238 else 0)
    for seed in ((0, 0), (2047, 0), (0, 2047), (2047, 2047)):
        if bgmask.getpixel(seed) == 255: ImageDraw.floodfill(bgmask, seed, 128)
    alpha = bgmask.point(lambda p: 0 if p == 128 else 255).filter(ImageFilter.MinFilter(7))
    out = out.convert('RGBA'); out.putalpha(alpha)
    out.save(f'scripts/{theme}_{n}.png')
    out.save(f'viewer/{theme}_{n}.png')
    print(n, 'sheet bbox', a, 'ref bbox', b, 'scale %.4f %.4f' % (sx, sy), 'aligned', mask(out).getbbox())
