# Cuts the 3x3 VFX sprite sheet (asset_1DXboeHCk4XrxbDxqgiATUPz, flat magenta background) into
# 128px transparent particle sprites: magenta keyed out with a soft edge and the pink fringe removed.
import numpy as np, sys
from PIL import Image
NAMES = [n.split(',') for n in sys.argv[3].split(';')] if len(sys.argv) > 3 else [['star', 'twinkle', 'golddot'], ['heart', 'sprinkles', 'pinkdot'], ['snowflake', 'frost', 'icedot']]
out = sys.argv[1]
im = np.asarray(Image.open(sys.argv[2] if len(sys.argv) > 2 else 'vfx/sheet.png').convert('RGB')).astype(np.float32)
H, W = im.shape[:2]
r, g, b = im[..., 0], im[..., 1], im[..., 2]
# Magenta = high red and blue, low green. "How magenta" a pixel is -> transparency.
mag = np.clip((np.minimum(r, b) - g - 60) / 120, 0, 1)
alpha = 1 - mag
# Despill: remove the magenta tint left in edge pixels (pull red/blue down toward green where alpha < 1).
spill = np.clip(np.minimum(r, b) - g, 0, None) * mag[..., None].squeeze(-1)
rgb = im.copy()
rgb[..., 0] -= spill * 0.9; rgb[..., 2] -= spill * 0.9
rgb = np.clip(rgb / np.maximum(alpha, 0.05)[..., None] * alpha[..., None] + (1 - alpha[..., None]) * 0, 0, 255)
rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
cw, ch = W // 3, H // 3
for i in range(3):
    for j in range(3):
        cell = Image.fromarray(rgba[i * ch:(i + 1) * ch, j * cw:(j + 1) * cw])
        bb = cell.getchannel('A').point(lambda p: 255 if p > 20 else 0).getbbox()
        cell = cell.crop(bb)
        s = max(cell.size) + 8
        sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.paste(cell, ((s - cell.size[0]) // 2, (s - cell.size[1]) // 2))
        sq.resize((128, 128), Image.LANCZOS).save(f'{out}/{NAMES[i][j]}.png')
        print(NAMES[i][j], bb)
