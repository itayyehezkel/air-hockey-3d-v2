# Recolours a UI icon's navy outline to a button's own text-outline colour and bakes a deeper shade underneath
# (the same look as the button text's shadow outline), so no runtime filter is needed.
# Usage: python ui/tint_icon.py SRC.webp OUT.webp EDGE_HEX DEEP_HEX
import sys, numpy as np
from PIL import Image
src, out, edge, deep = sys.argv[1:5]
hexrgb = lambda h: np.array([int(h.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
im = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)
rgb, a = im[..., :3], im[..., 3:]
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
lum = 0.3 * r + 0.59 * g + 0.11 * b
# Navy outline: dark and bluish. Weight by darkness so anti-aliased edges blend smoothly into white.
navy = np.clip((150 - lum) / 90, 0, 1) * (b > r + 10)
e = hexrgb(edge)
rgb = rgb * (1 - navy[..., None]) + e * navy[..., None]
# Bolder outline: grow the silhouette by ~3% of the icon height and fill the grown rim with the edge colour.
from scipy import ndimage
grow = max(1, round(im.shape[0] * 0.03))
yy, xx = np.mgrid[-grow:grow + 1, -grow:grow + 1]
disk = (xx * xx + yy * yy) <= grow * grow
P = grow + 1
ap = np.pad(a[..., 0], P)
grown = ndimage.grey_dilation(ap, footprint=disk)
rgbp = np.pad(rgb, ((P, P), (P, P), (0, 0)))
ta0 = (ap / 255)[..., None]
rgb = rgbp * ta0 + e * (1 - ta0)
a = grown[..., None]
im = np.dstack([rgb, a])
# Deeper shade: the icon's silhouette shifted down by ~5% of its height, under everything.
h = im.shape[0]
dy = max(2, round(h * 0.05))
pad = np.zeros((h + dy, im.shape[1], 4), np.float32)
pad[dy:, :, :3] = hexrgb(deep)
pad[dy:, :, 3:] = a
top = np.zeros_like(pad)
top[:h, :, :3] = rgb
top[:h, :, 3:] = a
ta = top[..., 3:] / 255
outrgb = top[..., :3] * ta + pad[..., :3] * (1 - ta)
outa = top[..., 3:] + pad[..., 3:] * (1 - ta)
res = np.dstack([outrgb, outa]).clip(0, 255).astype(np.uint8)
Image.fromarray(res).save(out, 'WEBP', quality=92, method=6)
print(out, res.shape[1], res.shape[0])
