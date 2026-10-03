# Repaints the two side rails from ONE view each (the side view facing it), so their painted
# details (e.g. bamboo rings) stay continuous around the pipe. Faces that view can't see well take
# the color of the rail's top at the same position along the rail.
import os, sys; sys.path.insert(0, 'scripts')
import numpy as np
from PIL import Image
HALF_W, HALF_L = 3.0, 5.25

def camera(alpha, beta=1.05, r=30, target=(0, -1.95, 0), fov=0.5):
    t = np.array(target, float)
    eye = t + r * np.array([np.cos(alpha) * np.sin(beta), np.cos(beta), np.sin(alpha) * np.sin(beta)])
    zax = (t - eye) / np.linalg.norm(t - eye)                     # Babylon LookAtLH
    xax = np.cross([0, 1, 0], zax); xax /= np.linalg.norm(xax)
    yax = np.cross(zax, xax)
    f = 1 / np.tan(fov / 2)
    def project(p):  # -> pixel coords in a square image of size S (fraction of width/height)
        d = p - eye
        x, y, z = d @ xax, d @ yax, d @ zax
        return np.stack([(f * x / z) * 0.5 + 0.5, 1 - ((f * y / z) * 0.5 + 0.5)], -1)
    return eye, project

def paint_rails(tex, d, views):
    """tex: float RGBA (T,T,4) in place; views: {'left': img, 'right': img} (float arrays)."""
    T = tex.shape[0]
    names = [str(n) for n in d['names']]
    rail = np.array(['table_rail' in n for n in names])[d['part']]
    pos, nrm, uv = d['pos'], d['nrm'], d['uv'] * T
    faces = d['idx'][rail]
    cen = pos[faces].mean(1)
    side = (np.abs(cen[:, 0]) > 2.6) & (np.abs(cen[:, 2]) < HALF_L - 0.2)
    rv = np.unique(faces[side]); top_y = pos[rv, 1].max()
    top_x = np.abs(pos[rv][pos[rv, 1] > top_y - 0.05, 0]).mean()
    mirror = os.environ.get('RAILS_MIRROR', '0') == '1'
    for sgn, view, alpha in ((1, views['left'], 0.0), (-1, views['right'], np.pi)):
        eye, project = camera(alpha)
        H, W = view.shape[:2]
        sf = faces[side & (np.sign(cen[:, 0]) == sgn)]
        cx = pos[np.unique(sf), 0].mean()  # the pipe's center plane
        for f in sf:
            a = uv[f]
            x0, y0 = np.maximum(np.floor(a.min(0)).astype(int) - 1, 0); x1, y1 = np.minimum(np.ceil(a.max(0)).astype(int) + 1, T - 1)
            m = np.array([[a[1, 0] - a[0, 0], a[2, 0] - a[0, 0]], [a[1, 1] - a[0, 1], a[2, 1] - a[0, 1]]])
            if x1 < x0 or y1 < y0 or abs(np.linalg.det(m)) < 1e-9: continue
            inv = np.linalg.inv(m)
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            s = inv[0, 0] * (X - a[0, 0]) + inv[0, 1] * (Y - a[0, 1]); t = inv[1, 0] * (X - a[0, 0]) + inv[1, 1] * (Y - a[0, 1])
            ins = (s >= -0.02) & (t >= -0.02) & (s + t <= 1.02)
            if not ins.any(): continue
            yy, xx = np.nonzero(ins); s, t = s[yy, xx], t[yy, xx]
            p = pos[f]; P = p[0] + s[:, None] * (p[1] - p[0]) + t[:, None] * (p[2] - p[0])
            n = nrm[f].mean(0); n /= np.linalg.norm(n)
            facing = n @ ((eye - p.mean(0)) / np.linalg.norm(eye - p.mean(0)))
            if mirror and facing < 0.35 and sgn * (P[:, 0].mean() - cx) < 0:
                # Inner side (toward the playing surface): its view pixels sit next to the surface
                # and pick it up; take the mirrored outer side instead, clearly seen, same pattern.
                P = np.stack([2 * cx - P[:, 0], P[:, 1], P[:, 2]], -1)
            elif facing < 0.02:
                P = np.stack([np.full(len(P), sgn * top_x), np.full(len(P), top_y), P[:, 2]], -1)
            q = project(P)
            px = np.clip((q[:, 0] * W).astype(int), 0, W - 1); py = np.clip((q[:, 1] * H).astype(int), 0, H - 1)
            c = view[py, px]
            ok = c[:, 3] > 0.5  # background pixels (cut out) leave the texel to the other passes
            tex[y0 + yy[ok], x0 + xx[ok], :3] = c[ok, :3]
            tex[y0 + yy[ok], x0 + xx[ok], 3] = 1
