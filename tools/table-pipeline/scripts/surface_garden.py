# Sharp Cosy Garden playing surface: the Classic surface layout (dots, lines, circle, creases,
# goal-mouth bands) on a wooden deck of lengthwise planks, with a cream fish-bone in the center circle
# and cream paw prints near the four corners (colors sampled from concept asset_fVLLAFSX5FZ2AKxtAnwGRQtv).
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

CLASSIC = '../../src/assets/table-classic-surface.webp'
WOOD = np.array([226, 152, 88], np.float32)  # a touch brighter than sampled: the dots and seams darken it on average
SEAM = np.array([146, 88, 45], np.float32)
DOT = np.array([120, 70, 36], np.float32)
CREAM = (251, 242, 225)
POCKET = np.array([40, 26, 18], np.float32)
HALF_W, HALF_L, PAD = 3.0, 5.25, 0.797

cl = np.asarray(Image.open(CLASSIC).convert('RGB')).astype(np.float32)
H, W = cl.shape[:2]
r, g, b = cl[..., 0], cl[..., 1], cl[..., 2]
lum = cl.mean(-1); chroma = cl.max(-1) - cl.min(-1)
navy = (lum < 110) & (b > r)
lines = np.clip((b - r - 20) / 110, 0, 1) * ~navy
dots = np.clip((236 - lum) / 90, 0, 1) * (chroma < 30) * ~navy

# Deck: 6 lengthwise planks, each a slightly different tone, with soft grain and dark seams.
rng = np.random.default_rng(7)
planks = 6
X = np.arange(W)[None, :].repeat(H, 0).astype(np.float32)
Y = np.arange(H)[:, None].repeat(W, 1).astype(np.float32)
idx = np.minimum((X / (W / planks)).astype(int), planks - 1)
tone = 1 + rng.uniform(-0.06, 0.06, planks)[idx]
grain = np.zeros((H, W), np.float32)
for k in range(5):  # a few long, gently wavy grain streaks per plank
    f = rng.uniform(0.004, 0.012); ph = rng.uniform(0, 6.28); amp = rng.uniform(4, 10)
    grain += np.sin((X + amp * np.sin(Y * f + ph)) * rng.uniform(0.08, 0.2) + ph) * 0.012
img = WOOD[None, None, :] * (tone + grain)[..., None]
seam_d = np.abs(((X + W / planks / 2) % (W / planks)) - W / planks / 2)  # distance to nearest seam
seam = np.clip(1 - (seam_d - 1.2) / 1.5, 0, 1) * (X > 3) * (X < W - 3)
img = img * (1 - seam[..., None]) + SEAM * seam[..., None]
img = img * (1 - dots[..., None]) + DOT * dots[..., None]

# Cream markings from the layout, plus the fish-bone and paw prints (drawn 4x, then scaled down).
S = 4
art = Image.new('L', (W * S, H * S), 0); d = ImageDraw.Draw(art)
cx, cy = W / 2 * S, 1031.5 * S
F = S * 1.4  # fish-bone size (concept scale)
d.rectangle((cx - 60 * F, cy - 3.2 * F, cx + 45 * F, cy + 3.2 * F), fill=255)  # spine
for k in range(4):  # ribs
    x = cx - 36 * F + k * 18 * F
    d.rounded_rectangle((x - 2.8 * F, cy - 16 * F, x + 2.8 * F, cy + 16 * F), radius=2.8 * F, fill=255)
d.ellipse((cx + 38 * F, cy - 15 * F, cx + 72 * F, cy + 15 * F), fill=255)  # head
d.ellipse((cx + 58 * F, cy - 5 * F, cx + 66 * F, cy + 3 * F), fill=0)  # eye
d.polygon([(cx - 56 * F, cy), (cx - 82 * F, cy - 19 * F), (cx - 76 * F, cy), (cx - 82 * F, cy + 19 * F)], fill=255)  # tail

def paw(x, y, s=1.0):
    x *= S; y *= S; u = S * s
    d.ellipse((x - 22 * u, y - 10 * u, x + 22 * u, y + 24 * u), fill=255)
    for dx, dy in ((-24, -16), (-9, -28), (9, -28), (24, -16)):
        d.ellipse((x + dx * u - 8 * u, y + dy * u - 9 * u, x + dx * u + 8 * u, y + dy * u + 9 * u), fill=255)

for zx in (-2.25, 2.25):
    for zz in (-4.25, 4.25):
        px = (zx + HALF_W) / (2 * HALF_W) * W
        py = (1 - (zz + HALF_L + PAD) / (2 * (HALF_L + PAD))) * H
        paw(px, py, 1.4)
art = np.asarray(art.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
center_dot = ((X - W / 2) ** 2 + (Y - 1031.5) ** 2) < 30 ** 2  # the Classic's center spot gives way to the fish
cream_a = np.maximum(lines * ~center_dot, art)
img = img * (1 - cream_a[..., None]) + np.array(CREAM, np.float32) * cream_a[..., None]
img[navy] = POCKET
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('scripts/surface_garden.png')
print('ok', W, H)
