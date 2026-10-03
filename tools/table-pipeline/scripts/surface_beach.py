# Sharp Beach playing surface: the Classic surface layout (dots, lines, circle, creases, goal-mouth
# bands, same line widths) on plain soft sand, markings in solid ocean blue, no shells or starfish
# (colors sampled from concept asset_FUmbQ9dgmCX5XwDmxt1kLjKy).
import numpy as np
from PIL import Image, ImageFilter

CLASSIC = '../../src/assets/table-classic-surface.webp'
SAND = np.array([252, 236, 180], np.float32)
DOT = np.array([214, 184, 128], np.float32)
OCEAN = np.array([28, 156, 240], np.float32)
POCKET = np.array([22, 62, 96], np.float32)

cl = np.asarray(Image.open(CLASSIC).convert('RGB')).astype(np.float32)
H, W = cl.shape[:2]
r, g, b = cl[..., 0], cl[..., 1], cl[..., 2]
lum = cl.mean(-1); chroma = cl.max(-1) - cl.min(-1)
navy = (lum < 110) & (b > r)
lines = np.clip((b - r - 20) / 110, 0, 1) * ~navy
dots = np.clip((236 - lum) / 90, 0, 1) * (chroma < 30) * ~navy

# Sand: a very soft, large-scale tone variation so it isn't flat, calm enough for the puck to read.
rng = np.random.default_rng(3)
n = Image.fromarray((rng.random((H // 64, W // 64)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
n = np.asarray(n.filter(ImageFilter.GaussianBlur(40))).astype(np.float32) / 255 - 0.5
img = SAND[None, None, :] * (1 + 0.035 * n[..., None])
img = img * (1 - dots[..., None]) + DOT * dots[..., None]
img = img * (1 - lines[..., None]) + OCEAN * lines[..., None]
img[navy] = POCKET
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('scripts/surface_beach.png')
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((256, 516)).save('scripts/sb_small.png')
print('ok', W, H)
