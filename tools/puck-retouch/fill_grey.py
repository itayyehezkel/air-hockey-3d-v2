# Repaints the grey texels Tripo leaves on the unseen back of a puck: each one takes the median color of
# the good (colored) texels at the same height, radius and facing elsewhere on the puck.
# Usage: python puck/fill_grey.py SRC.glb OUT.glb
import sys, json, struct, io; sys.path.insert(0, 'puck')
import numpy as np
from PIL import Image, ImageFilter
from texmap import texel_map
src, out = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + jl]); bin_ = b[20 + jl + 8:]
ci = [k for k, im in enumerate(js['images']) if im['name'].startswith('Color')][0]
bv = js['bufferViews'][js['images'][ci]['bufferView']]
col = np.asarray(Image.open(io.BytesIO(bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')).astype(np.float32)
T = col.shape[0]
_, P, pos, nrm, hit = texel_map(src, T)
mx = col.max(-1); mn = col.min(-1); sat = (mx - mn) / np.maximum(mx, 1)
grey = hit & (sat < 0.25) & (mx > 90) & (mx < 235)   # flat grey fill, not the bright highlights
good = hit & ~grey
grey_img = Image.fromarray((grey * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
grey = np.asarray(grey_img) > 0
grey &= hit
y = pos[..., 1]; r = np.hypot(pos[..., 0], pos[..., 2]); ny = nrm[..., 1]
def key(m):
    return (np.clip(((y[m] + 0.16) / 0.32 * 24).astype(int), 0, 23) * 1000
            + np.clip((r[m] / 0.5 * 16).astype(int), 0, 15) * 10
            + np.clip(((ny[m] + 1) / 2 * 5).astype(int), 0, 4))
gk = key(good); gc = col[good]
order = np.argsort(gk); gk = gk[order]; gc = gc[order]
uk, start = np.unique(gk, return_index=True)
med = {k: np.median(gc[s:e], 0) for k, s, e in zip(uk, start, list(start[1:]) + [len(gk)])}
fallback = np.median(gc, 0)
ys, xs = np.nonzero(grey)
keys = key(grey)
new = col.copy()
for (yy, xx, k) in zip(ys, xs, keys):
    new[yy, xx] = med.get(int(k), fallback)
print('repainted', len(ys), 'texels; fallback', fallback)
buf = io.BytesIO(); Image.fromarray(np.clip(new, 0, 255).astype(np.uint8)).save(buf, 'JPEG', quality=92)
data = buf.getvalue(); js['images'][ci]['mimeType'] = 'image/jpeg'
newbin = bytearray()
for k_, v in enumerate(js['bufferViews']):
    d = data if k_ == js['images'][ci]['bufferView'] else bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    while len(newbin) % 4: newbin.append(0)
    v['byteOffset'] = len(newbin); v['byteLength'] = len(d); newbin += d
while len(newbin) % 4: newbin.append(0)
js['buffers'][0]['byteLength'] = len(newbin)
jb = json.dumps(js, separators=(',', ':')).encode()
while len(jb) % 4: jb += b' '
open(out, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(jb) + len(newbin)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(newbin), 0x004E4942) + bytes(newbin))
