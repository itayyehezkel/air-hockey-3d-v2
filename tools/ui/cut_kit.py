# Cuts a UI kit on a flat key colour into transparent WebP sprites: keys the background out (soft edge, despilled)
# and splits the result into its separate pieces (connected blobs), named left-to-right / top-to-bottom.
# Usage: python ui/cut_kit.py KIT.png OUT_DIR name1,name2,name3   (names in reading order: top row L->R, then below)
# Options (env):
#   KEY=green      the kit is on pure green #00FF00 instead of magenta #FF00FF (use it when the kit has purple/pink
#                  parts, which a magenta key would eat into).
#   MERGE_ROWS=1   merge blobs that share a row into one piece (text sheets: a word with a space is 2 blobs).
#   MIN_AREA=4000  ignore blobs smaller than this many pixels.
#   SKIP=-         a name of "-" skips that piece.
import os, sys, numpy as np
from PIL import Image
from scipy import ndimage
src, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
rgb = im.copy()
if os.environ.get('KEY', 'magenta') == 'green':
    key = np.clip((g - np.maximum(r, b) - 60) / 120, 0, 1)
    spill = np.clip(g - np.maximum(r, b), 0, None) * key
    rgb[..., 1] -= spill * 0.9
else:
    key = np.clip((np.minimum(r, b) - g - 60) / 120, 0, 1)
    spill = np.clip(np.minimum(r, b) - g, 0, None) * key
    rgb[..., 0] -= spill * 0.9; rgb[..., 2] -= spill * 0.9
alpha = 1 - key
rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
lab, n = ndimage.label(alpha > 0.5)
min_area = int(os.environ.get('MIN_AREA', 4000))
boxes = []  # [y0, y1, x0, x1]
for i, s in enumerate(ndimage.find_objects(lab)):
    if (lab[s] == i + 1).sum() > min_area:
        boxes.append([s[0].start, s[0].stop, s[1].start, s[1].stop])
if os.environ.get('MERGE_ROWS'):
    boxes.sort(key=lambda bx: bx[0])
    merged = []
    for bx in boxes:
        m = merged[-1] if merged else None
        if m and bx[0] < m[1] - (m[1] - m[0]) * 0.3:  # overlaps the previous row vertically
            m[:] = [min(m[0], bx[0]), max(m[1], bx[1]), min(m[2], bx[2]), max(m[3], bx[3])]
        else:
            merged.append(list(bx))
    boxes = merged
# Reading order: group pieces into rows (a piece joins a row when its vertical centre falls inside the row's first
# piece), rows top to bottom, pieces left to right.
boxes.sort(key=lambda bx: (bx[0] + bx[1]) / 2)
rows = []
for bx in boxes:
    cy = (bx[0] + bx[1]) / 2
    if rows and rows[-1][0][0] <= cy <= rows[-1][0][1]:
        rows[-1].append(bx)
    else:
        rows.append([bx])
boxes = [bx for row in rows for bx in sorted(row, key=lambda bx: bx[2])]
if os.environ.get("DEBUG"): print(boxes)
assert len(boxes) == len(names), (len(boxes), names, boxes)
for (y0, y1, x0, x1), name in zip(boxes, names):
    if name == '-':
        continue
    pad = 6
    y0, y1, x0, x1 = max(y0 - pad, 0), min(y1 + pad, im.shape[0]), max(x0 - pad, 0), min(x1 + pad, im.shape[1])
    crop = Image.fromarray(rgba[y0:y1, x0:x1])
    crop.save(f'{out}/{name}.webp', 'WEBP', quality=92, method=6)
    print(name, crop.size)
