# Fills the unpainted texels (hidden spots, chart gaps) with nearby painted colors (push-pull),
# then writes the themed table: the Classic geometry + this texture.
import io, sys; sys.path.insert(0, 'scripts')
import numpy as np
from PIL import Image
from glb import write_glb
theme = sys.argv[1]
from PIL import ImageDraw, ImageFilter
d = np.load('scripts/master.npz')
im = np.asarray(Image.open(f'refs/bake_{theme}.png').convert('RGBA')).astype(np.float32) / 255
# Goals are painted from the front/back views only (a theme sheet can mix up the goal colors in its
# side views): their texels come from that bake.
fb = f'refs/bake_{theme}_fb.png'
try:
    fbim = np.asarray(Image.open(fb).convert('RGBA')).astype(np.float32) / 255
    goal_face = np.array(['goal' in str(n) for n in d['names']])[d['part']]
    T = im.shape[0]; mask = Image.new('L', (T, T), 0); dr = ImageDraw.Draw(mask)
    for f in d['idx'][goal_face]:
        dr.polygon([(d['uv'][k][0] * T, d['uv'][k][1] * T) for k in f], fill=255)
    m = np.asarray(mask.filter(ImageFilter.MaxFilter(5)))[..., None] > 0
    im = np.where(m, fbim, im)
except FileNotFoundError:
    pass
# Side rails from one view each (continuous painted details around the pipe, like bamboo rings).
# Rails with lengthwise stripes (color set by the angle around the pipe) skip it: RAILS_ONE_VIEW=0.
import os
from rails import paint_rails
vw = {k: np.asarray(Image.open(f'scripts/{theme}_{k}.png' if theme != 'view' else f'scripts/view_{k}.png').convert('RGBA')).astype(np.float32) / 255 for k in ('left', 'right')}
# RAILS: 'oneview' (details around the pipe, e.g. bamboo rings), 'lengthwise' (stripes / grain along
# the rail: straight, clean), or 'bake' (as projected).
rails_mode = os.environ.get('RAILS', 'oneview' if os.environ.get('RAILS_ONE_VIEW', '1') == '1' else 'bake')
if rails_mode == 'oneview':
    im = im.copy(); paint_rails(im, d, vw)
elif rails_mode == 'lengthwise':
    from lengthwise import paint_lengthwise_rails
    im = im.copy(); paint_lengthwise_rails(im, d)
# Optional sharp top-down surface image (third argument).
if len(sys.argv) > 2:
    from surface import paint_surface
    im = im.copy(); paint_surface(im, d, sys.argv[2])
# Spots no view saw well (undersides, goal backs, inner leg sides) take their own part's main color
# (bark for legs, the goal's color for a goal...), not whatever lies next to them in the texture.
T = im.shape[0]
for pi in range(len(d['names'])):
    pm = Image.new('L', (T, T), 0); dr = ImageDraw.Draw(pm)
    for f in d['idx'][d['part'] == pi]:
        dr.polygon([(d['uv'][k][0] * T, d['uv'][k][1] * T) for k in f], fill=255)
    pm = np.asarray(pm) > 0
    seen = pm & (im[..., 3] > 0.5)
    if seen.sum() < 50: continue
    im[pm & ~seen, :3] = np.median(im[seen, :3], 0)
    im[pm & ~seen, 3] = 1
rgb, a = im[..., :3], (im[..., 3:] > 0.5).astype(np.float32)

def down(c, w):  # weighted 2x downsample
    H, W = w.shape[:2]; c = c[:H // 2 * 2, :W // 2 * 2]; w = w[:H // 2 * 2, :W // 2 * 2]
    cw = (c * w).reshape(H // 2, 2, W // 2, 2, 3).sum((1, 3)); ww = w.reshape(H // 2, 2, W // 2, 2, 1).sum((1, 3))
    return cw / np.maximum(ww, 1e-6), np.minimum(ww, 1)
levels = [(rgb * a, a)]
while levels[-1][1].shape[0] > 1:
    c, w = levels[-1]; levels.append(down(c, w))
c, w = levels[-1]
for lc, lw in reversed(levels[:-1]):
    up = np.repeat(np.repeat(c, 2, 0), 2, 1)[:lc.shape[0], :lc.shape[1]]
    c = lc * lw + up * (1 - lw); w = lw
out = Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8))
out.save(f'scripts/tex_{theme}.png')
b = io.BytesIO(); out.resize((2048, 2048), Image.LANCZOS).save(b, 'JPEG', quality=90)
# Babylon's glTF loader maps (x, y, z) to (-x, y, z): store x negated so the table loads exactly where
# it was baked (the loader's mirroring also takes care of the winding).
flipz = np.array([-1, 1, 1], np.float32)
# The goals came from a mirrored glTF node; their triangles were rewound for the bake, which the
# loader's own mirroring then undoes: put them back.
goal = np.array(['goal' in str(n) for n in d['names']])[d['part']]
idx = d['idx'].copy(); idx[goal] = idx[goal][:, [0, 2, 1]]
write_glb(f'scripts/table-{theme}.glb', d['pos'] * flipz, d['nrm'] * flipz, d['uv'], idx, b.getvalue(), 'image/jpeg', unlit=True)
print('ok', len(b.getvalue()) // 1024, 'KB texture')
