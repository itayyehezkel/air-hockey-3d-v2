# Smooths a zone of a model: flattens its normal (bump) map there, so baked wrinkles disappear.
# Usage: python puck/flatten_zone.py SRC.glb OUT.glb RMIN RMAX YMAX   (model width normalized to 1)
import sys, json, struct, io; sys.path.insert(0, 'puck')
import numpy as np
from PIL import Image, ImageFilter
from texmap import texel_map
src, out = sys.argv[1], sys.argv[2]
rmin, rmax, ymax = map(float, sys.argv[3:6])
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + jl]); bin_ = b[20 + jl + 8:]
ni = [k for k, im in enumerate(js['images']) if im['name'].startswith('Normal')][0]
bv = js['bufferViews'][js['images'][ni]['bufferView']]
nm = np.asarray(Image.open(io.BytesIO(bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')).astype(np.float32)
_, P, pos, nrm, hit = texel_map(src, nm.shape[0])
w = max(np.ptp(P[:, 0]), np.ptp(P[:, 2]))
r = np.hypot(pos[..., 0], pos[..., 2]) / w; y = pos[..., 1] / w
zone = hit & (r > rmin) & (r < rmax) & (y < ymax)
a = np.asarray(Image.fromarray((zone * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32)[..., None] / 255
nm = nm * (1 - a) + np.array([128, 128, 255], np.float32) * a
print('flattened', int(zone.sum()), 'texels')
buf = io.BytesIO(); Image.fromarray(np.clip(nm, 0, 255).astype(np.uint8)).save(buf, 'PNG', optimize=True)
data = buf.getvalue()
newbin = bytearray()
for k_, v in enumerate(js['bufferViews']):
    d = data if k_ == js['images'][ni]['bufferView'] else bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    while len(newbin) % 4: newbin.append(0)
    v['byteOffset'] = len(newbin); v['byteLength'] = len(d); newbin += d
while len(newbin) % 4: newbin.append(0)
js['buffers'][0]['byteLength'] = len(newbin)
jb = json.dumps(js, separators=(',', ':')).encode()
while len(jb) % 4: jb += b' '
open(out, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(jb) + len(newbin)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(newbin), 0x004E4942) + bytes(newbin))
