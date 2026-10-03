# Paints the playing surface texels straight from a top-down surface image (sharp), triangle by
# triangle: each texel's table position comes from its triangle's barycentric coordinates.
# The image covers x in [-HALF_W, HALF_W] and z in [-(HALF_L + PAD), HALF_L + PAD], z+ at the top.
import numpy as np
from PIL import Image
HALF_W, HALF_L, PAD = 3.0, 5.25, 0.797
def paint_surface(tex, d, image_path):
    """tex: float RGBA array (T, T, 4), painted in place (alpha set to 1 where painted)."""
    T = tex.shape[0]
    img = np.asarray(Image.open(image_path).convert('RGB')).astype(np.float32) / 255
    H, W = img.shape[:2]
    names = [str(n) for n in d['names']]
    surf = np.array(['table_surface' in n for n in names])[d['part']]
    uv = d['uv'] * T; pos = d['pos']
    for f in d['idx'][surf]:
        a, b, c = uv[f]
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int) - 1
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, T - 1), min(y1, T - 1)
        if x1 < x0 or y1 < y0: continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        m = np.array([[b[0] - a[0], c[0] - a[0]], [b[1] - a[1], c[1] - a[1]]])
        if abs(np.linalg.det(m)) < 1e-9: continue
        inv = np.linalg.inv(m)
        s = inv[0, 0] * (X - a[0]) + inv[0, 1] * (Y - a[1]); t = inv[1, 0] * (X - a[0]) + inv[1, 1] * (Y - a[1])
        e = 0.6 / max(1.0, np.abs(m).max())  # a hair outside the edge, so neighbours meet without gaps
        ins = (s >= -e) & (t >= -e) & (s + t <= 1 + e)
        if not ins.any(): continue
        p = pos[f]
        wx = p[0, 0] + s * (p[1, 0] - p[0, 0]) + t * (p[2, 0] - p[0, 0])
        wz = p[0, 2] + s * (p[1, 2] - p[0, 2]) + t * (p[2, 2] - p[0, 2])
        u = (wx + HALF_W) / (2 * HALF_W); v = (wz + HALF_L + PAD) / (2 * (HALF_L + PAD))
        px = np.clip((u * W).astype(int), 0, W - 1); py = np.clip(((1 - v) * H).astype(int), 0, H - 1)
        yy, xx = np.nonzero(ins)
        tex[y0 + yy, x0 + xx, :3] = img[py[yy, xx], px[yy, xx]]
        tex[y0 + yy, x0 + xx, 3] = 1
