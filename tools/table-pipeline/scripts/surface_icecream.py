# Sharp Ice Cream playing surface: the Classic surface layout (dots, lines, circle, creases, goal-mouth
# bands, same line widths) on vanilla cream, dots and markings in strawberry pink
# (colors sampled from concept asset_7ZGH2ApjJWE93s7svcR3WB85).
import numpy as np
from PIL import Image

CLASSIC = '../../src/assets/table-classic-surface.webp'
VANILLA = np.array([254, 249, 232], np.float32)
DOT = np.array([244, 178, 204], np.float32)
PINK = np.array([244, 92, 158], np.float32)
POCKET = np.array([74, 40, 30], np.float32)  # chocolate

cl = np.asarray(Image.open(CLASSIC).convert('RGB')).astype(np.float32)
H, W = cl.shape[:2]
r, g, b = cl[..., 0], cl[..., 1], cl[..., 2]
lum = cl.mean(-1); chroma = cl.max(-1) - cl.min(-1)
navy = (lum < 110) & (b > r)
lines = np.clip((b - r - 20) / 110, 0, 1) * ~navy
dots = np.clip((236 - lum) / 90, 0, 1) * (chroma < 30) * ~navy

img = np.broadcast_to(VANILLA, (H, W, 3)).astype(np.float32).copy()
img = img * (1 - dots[..., None]) + DOT * dots[..., None]
img = img * (1 - lines[..., None]) + PINK * lines[..., None]
img[navy] = POCKET
out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
out.save('scripts/surface_icecream.png'); out.resize((256, 516)).save('scripts/si_small.png')
print('ok', W, H)
