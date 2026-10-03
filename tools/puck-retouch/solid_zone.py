# Paints a zone of a model one even color (the zone's median), keeping only texels of a chosen accent
# (e.g. yellow seeds on a red mallet base): removes seams, smudges and spill in one go.
# Usage: python puck/solid_zone.py SRC.glb OUT.glb RMIN RMAX YMAX   (model width normalized to 1)
import sys, json, struct, io; sys.path.insert(0, 'puck')
import numpy as np
from PIL import Image, ImageFilter
from texmap import texel_map
src, out = sys.argv[1], sys.argv[2]
rmin, rmax, ymax = map(float, sys.argv[3:6])
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + jl]); bin_ = b[20 + jl + 8:]
ci = [k for k, im in enumerate(js['images']) if im['name'].startswith('Color')][0]
bv = js['bufferViews'][js['images'][ci]['bufferView']]
col = np.asarray(Image.open(io.BytesIO(bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')).astype(np.float32)
_, P, pos, nrm, hit = texel_map(src, col.shape[0])
w = max(np.ptp(P[:, 0]), np.ptp(P[:, 2]))
r = np.hypot(pos[..., 0], pos[..., 2]) / w; y = pos[..., 1] / w
zone = hit & (r > rmin) & (r < rmax) & (y < ymax)
R, G, B = col[..., 0], col[..., 1], col[..., 2]
seed = (R > 170) & (G > 140) & (B < 130)            # the yellow seeds
seed = np.asarray(Image.fromarray((seed * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
paint = zone & ~seed
fill = np.median(col[paint], 0)
# Also the gutter pixels just outside each texture piece (mipmaps and texture filtering read them, so
# their old colour showed as thin seam lines), but never pixels that belong to other parts.
grow = np.asarray(Image.fromarray((paint * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
paint = paint | (grow & ~hit)
new = col.copy(); new[paint] = fill
print('painted', int(paint.sum()), 'texels', fill, 'kept seeds', int((zone & seed).sum()))
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
