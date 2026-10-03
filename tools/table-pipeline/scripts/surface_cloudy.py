# Sharp Cloudy playing surface: the Classic surface layout (dots, lines, circle, creases, goal-mouth
# bands) on pale sky blue, with a soft pastel rainbow arc over the center circle (colors sampled from
# concept asset_U25M8r6HiVUq4LebQ6g3vgw7).
import numpy as np
from PIL import Image

CLASSIC = '../../src/assets/table-classic-surface.webp'
BASE = np.array([191, 231, 253], np.float32)
DOT = np.array([130, 198, 246], np.float32)
WHITE = np.array([255, 255, 255], np.float32)
POCKET = np.array([28, 50, 108], np.float32)
# Rainbow bands, outside in, as see-through pastels over the sky.
BANDS = [(255, 160, 205), (255, 236, 140), (170, 238, 165), (150, 214, 255), (200, 176, 246)]
BAND_ALPHA = 0.5
HALF_W, HALF_L, PAD = 3.0, 5.25, 0.797

cl = np.asarray(Image.open(CLASSIC).convert('RGB')).astype(np.float32)
H, W = cl.shape[:2]
r, g, b = cl[..., 0], cl[..., 1], cl[..., 2]
lum = cl.mean(-1); chroma = cl.max(-1) - cl.min(-1)
navy = (lum < 110) & (b > r)
lines = np.clip((b - r - 20) / 110, 0, 1) * ~navy
dots = np.clip((236 - lum) / 90, 0, 1) * (chroma < 30) * ~navy

# Table coordinates of every pixel (x across, z along; z+ is the far end, at the top).
X = (np.arange(W)[None, :] + 0.5) / W * 2 * HALF_W - HALF_W
Z = HALF_L + PAD - (np.arange(H)[:, None] + 0.5) / H * 2 * (HALF_L + PAD)
img = np.broadcast_to(BASE, (H, W, 3)).astype(np.float32).copy()

# The arc: circles around a point toward the player's end, so it bows over the center circle.
cz, outer, width = -3.6, 4.2, 0.36
dist = np.sqrt(X ** 2 + (Z - cz) ** 2)
px = 2 * HALF_W / W  # one pixel in table units, for smooth band edges
for k, col in enumerate(BANDS):
    r0, r1 = outer - (k + 1) * width, outer - k * width
    a = np.clip((dist - r0) / px + 0.5, 0, 1) * np.clip((r1 - dist) / px + 0.5, 0, 1)
    a = a * np.clip((Z - (cz + 0.8)) / 1.8, 0, 1) * BAND_ALPHA  # the upper arc, its ends fading out
    img = img * (1 - a[..., None]) + np.array(col, np.float32) * a[..., None]

img = img * (1 - dots[..., None]) + DOT * dots[..., None]
img = img * (1 - lines[..., None]) + WHITE * lines[..., None]
img[navy] = POCKET
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('scripts/surface_cloudy.png')
print('ok', W, H)
