# Sharp Picnic playing surface: the Classic surface layout (dots, lines, circle, creases, goal-mouth
# bands, same line widths) on a soft pale pink and cream gingham, with the markings in solid coral
# (colors sampled from concept asset_txdQLNJPr5TwbGY3YD9N9YZW).
import numpy as np
from PIL import Image

CLASSIC = '../../src/assets/table-classic-surface.webp'
CREAM = np.array([252, 241, 238], np.float32)
STRIPE = np.array([250, 222, 220], np.float32)  # one gingham band
CROSS = np.array([248, 206, 206], np.float32)   # where two bands cross
DOT = np.array([226, 168, 168], np.float32)
CORAL = np.array([246, 88, 80], np.float32)
POCKET = np.array([70, 36, 40], np.float32)
HALF_W, HALF_L, PAD = 3.0, 5.25, 0.797
SQUARES = 10  # gingham squares across the width

cl = np.asarray(Image.open(CLASSIC).convert('RGB')).astype(np.float32)
H, W = cl.shape[:2]
r, g, b = cl[..., 0], cl[..., 1], cl[..., 2]
lum = cl.mean(-1); chroma = cl.max(-1) - cl.min(-1)
navy = (lum < 110) & (b > r)
lines = np.clip((b - r - 20) / 110, 0, 1) * ~navy
dots = np.clip((236 - lum) / 90, 0, 1) * (chroma < 30) * ~navy

# Gingham in table units, centered on the table so it is symmetric end to end.
X = (np.arange(W)[None, :] + 0.5) / W * 2 * HALF_W - HALF_W
Z = HALF_L + PAD - (np.arange(H)[:, None] + 0.5) / H * 2 * (HALF_L + PAD)
sq = 2 * HALF_W / SQUARES
px = 2 * HALF_W / W


def band(v):
    # 1 on every other square, with a one-pixel soft edge.
    ph = np.mod(v / sq, 2.0)
    return np.clip(np.minimum(ph, 1 - ph) / (px / sq) + 0.5, 0, 1)


bx = np.broadcast_to(band(X), (H, W)); bz = np.broadcast_to(band(Z), (H, W))
img = (CREAM * ((1 - bx) * (1 - bz))[..., None] + STRIPE * ((bx * (1 - bz)) + (bz * (1 - bx)))[..., None]
       + CROSS * (bx * bz)[..., None])
img = img * (1 - dots[..., None]) + DOT * dots[..., None]
img = img * (1 - lines[..., None]) + CORAL * lines[..., None]
img[navy] = POCKET
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('scripts/surface_picnic.png')
print('ok', W, H)
