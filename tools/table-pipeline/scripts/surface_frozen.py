# Sharp Frozen playing surface: the Classic surface layout (dots, lines, circle, creases, goal-mouth
# bands, same line widths) on plain pale ice, markings in solid deeper ice blue, no outline
# (colors sampled from concept asset_4THRMSEvGfH97HHDH23hEoXf).
import numpy as np
from PIL import Image

CLASSIC = '../../src/assets/table-classic-surface.webp'
ICE = np.array([210, 240, 253], np.float32)
DOT = np.array([150, 204, 232], np.float32)
LINE = np.array([30, 160, 245], np.float32)
POCKET = np.array([22, 52, 100], np.float32)

cl = np.asarray(Image.open(CLASSIC).convert('RGB')).astype(np.float32)
H, W = cl.shape[:2]
r, g, b = cl[..., 0], cl[..., 1], cl[..., 2]
lum = cl.mean(-1); chroma = cl.max(-1) - cl.min(-1)
navy = (lum < 110) & (b > r)
lines = np.clip((b - r - 20) / 110, 0, 1) * ~navy
dots = np.clip((236 - lum) / 90, 0, 1) * (chroma < 30) * ~navy

# A soft frosty sheen: slightly lighter toward the middle of the table.
Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
d = np.sqrt(((X - W / 2) / (W / 2)) ** 2 + ((Y - H / 2) / (H / 2)) ** 2)
img = ICE[None, None, :] + (np.clip(1 - d, 0, 1) * 8)[..., None]
img = img * (1 - dots[..., None]) + DOT * dots[..., None]
img = img * (1 - lines[..., None]) + LINE * lines[..., None]
img[navy] = POCKET
out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
out.save('scripts/surface_frozen.png'); out.resize((256, 516)).save('scripts/sf_small.png')
print('ok', W, H)
