# Sharp Rainy playing surface: the Classic surface layout (dots, lines, circle, creases, goal-mouth
# bands, same line widths) on plain pale puddle blue, markings in solid white, no outline
# (colors sampled from concept asset_bxXfXczSvy5voeskPTRLgc3j).
import numpy as np
from PIL import Image

CLASSIC = '../../src/assets/table-classic-surface.webp'
PUDDLE = np.array([190, 231, 252], np.float32)
DOT = np.array([150, 196, 226], np.float32)
WHITE = np.array([255, 255, 255], np.float32)
POCKET = np.array([28, 50, 108], np.float32)

cl = np.asarray(Image.open(CLASSIC).convert('RGB')).astype(np.float32)
H, W = cl.shape[:2]
r, g, b = cl[..., 0], cl[..., 1], cl[..., 2]
lum = cl.mean(-1); chroma = cl.max(-1) - cl.min(-1)
navy = (lum < 110) & (b > r)
lines = np.clip((b - r - 20) / 110, 0, 1) * ~navy
dots = np.clip((236 - lum) / 90, 0, 1) * (chroma < 30) * ~navy

img = np.broadcast_to(PUDDLE, (H, W, 3)).astype(np.float32).copy()
img = img * (1 - dots[..., None]) + DOT * dots[..., None]
img = img * (1 - lines[..., None]) + WHITE * lines[..., None]
img[navy] = POCKET
out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
out.save('scripts/surface_rainy.png'); out.resize((256, 516)).save('scripts/sr_small.png')
print('ok', W, H)
