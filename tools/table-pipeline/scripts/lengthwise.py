# Rails whose paint runs along their length (stripes, wood grain): each texel's color depends only on
# its angle around the pipe. Every rail stretch takes, per angle, the median color along its whole
# length, then paints that evenly: stray bits (surface dots and lines caught at the rail's edge
# where the concept and the model differ slightly) drop out and the stripes run straight.
import numpy as np

HALF_W, HALF_L = 3.0, 5.25
BINS = 144


def paint_lengthwise_rails(tex, d):
    """tex: float RGBA (T, T, 4), painted in place."""
    T = tex.shape[0]
    names = [str(n) for n in d['names']]
    rail = np.array(['table_rail' in n for n in names])[d['part']]
    pos, uv = d['pos'], d['uv'] * T
    faces = d['idx'][rail]
    cen = pos[faces].mean(1)
    # Stretches: the two side rails (along z) and the four end-rail pieces beside the goals (along x).
    stretches = {
        'side+': (cen[:, 0] > 2.6) & (np.abs(cen[:, 2]) < HALF_L - 0.9),
        'side-': (cen[:, 0] < -2.6) & (np.abs(cen[:, 2]) < HALF_L - 0.9),
        'end+': (cen[:, 2] > HALF_L - 0.1) & (np.abs(cen[:, 0]) < HALF_W - 0.9),
        'end-': (cen[:, 2] < -(HALF_L - 0.1)) & (np.abs(cen[:, 0]) < HALF_W - 0.9),
    }
    for key, sel in stretches.items():
        fs = faces[sel]
        if len(fs) == 0:
            continue
        vs = pos[np.unique(fs)]
        along = 2 if key.startswith('side') else 0   # the rail's own axis
        across = 0 if along == 2 else 2
        c_across = (vs[:, across].min() + vs[:, across].max()) / 2
        c_y = (vs[:, 1].min() + vs[:, 1].max()) / 2
        sign = 1 if key.endswith('+') else -1         # mirror so both sides share one orientation
        texels = []  # (y, x, bin)
        for f in fs:
            a = uv[f]
            x0, y0 = np.maximum(np.floor(a.min(0)).astype(int) - 1, 0); x1, y1 = np.minimum(np.ceil(a.max(0)).astype(int) + 1, T - 1)
            m = np.array([[a[1, 0] - a[0, 0], a[2, 0] - a[0, 0]], [a[1, 1] - a[0, 1], a[2, 1] - a[0, 1]]])
            if x1 < x0 or y1 < y0 or abs(np.linalg.det(m)) < 1e-9:
                continue
            inv = np.linalg.inv(m)
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            s = inv[0, 0] * (X - a[0, 0]) + inv[0, 1] * (Y - a[0, 1]); t = inv[1, 0] * (X - a[0, 0]) + inv[1, 1] * (Y - a[0, 1])
            ins = (s >= -0.02) & (t >= -0.02) & (s + t <= 1.02)
            if not ins.any():
                continue
            yy, xx = np.nonzero(ins); s, t = s[yy, xx], t[yy, xx]
            p = pos[f]; P = p[0] + s[:, None] * (p[1] - p[0]) + t[:, None] * (p[2] - p[0])
            ang = np.arctan2(P[:, 1] - c_y, sign * (P[:, across] - c_across))
            b = ((ang + np.pi) / (2 * np.pi) * BINS).astype(int) % BINS
            texels.append(np.stack([y0 + yy, x0 + xx, b], 1))
        if not texels:
            continue
        tx = np.concatenate(texels)
        cols = tex[tx[:, 0], tx[:, 1]]
        painted = cols[:, 3] > 0.5
        table = np.zeros((BINS, 3), np.float32); have = np.zeros(BINS, bool)
        for k in range(BINS):
            sel_k = painted & (tx[:, 2] == k)
            if sel_k.sum() >= 5:
                table[k] = np.median(cols[sel_k, :3], 0); have[k] = True
        if not have.any():
            continue
        # Angles nobody saw take the nearest seen angle's color.
        idx = np.arange(BINS)
        seen = idx[have]
        for k in idx[~have]:
            dist = np.minimum(np.abs(seen - k), BINS - np.abs(seen - k))
            table[k] = table[seen[np.argmin(dist)]]
        tex[tx[:, 0], tx[:, 1], :3] = table[tx[:, 2]]
        tex[tx[:, 0], tx[:, 1], 3] = 1
