# Repaints spilled-color texels inside a radius / height zone of a puck or mallet model with the median
# of the zone's other texels (e.g. yellow seed color that Tripo spilled inside a mallet's base ring).
# Usage: python puck/recolor_zone.py SRC.glb OUT.glb RMIN RMAX YMAX   (model units, width normalized to 1)
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
T = col.shape[0]
_, P, pos, nrm, hit = texel_map(src, T)
w = max(np.ptp(P[:, 0]), np.ptp(P[:, 2]))
r = np.hypot(pos[..., 0], pos[..., 2]) / w; y = pos[..., 1] / w
R, G, B = col[..., 0], col[..., 1], col[..., 2]
# Anything in the zone that isn't the zone's main color (red here): yellow seeds, orange streaks,
# a greenish tint. Measured as distance from the zone's median color.
spill = None
zone = hit & (r > rmin) & (r < rmax) & (y < ymax)
ref = np.median(col[zone], 0)
hue_off = (G / np.maximum(R, 1) > ref[1] / max(ref[0], 1) + 0.12) | (B / np.maximum(R, 1) > ref[2] / max(ref[0], 1) + 0.12)
bad = zone & hue_off
bad = (np.asarray(Image.fromarray((bad * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0) & zone
fill = np.median(col[zone & ~bad], 0)
new = col.copy(); new[bad] = fill
print('repainted', bad.sum(), 'texels with', fill)
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
