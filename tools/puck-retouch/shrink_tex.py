# Shrinks a GLB's textures to SIZE px WITHOUT touching its geometry (gltf-transform resize altered
# vertex data on a Tripo model and opened cracks). Usage: python puck/shrink_tex.py SRC.glb OUT.glb SIZE
import sys, json, struct, io
from PIL import Image
src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + jl]); bin_ = b[20 + jl + 8:]
repl = {}
for im in js['images']:
    bv = js['bufferViews'][im['bufferView']]
    img = Image.open(io.BytesIO(bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]))
    img = img.convert('RGB').resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    if im['mimeType'] == 'image/png': img.save(buf, 'PNG', optimize=True)
    else: img.save(buf, 'JPEG', quality=90)
    repl[im['bufferView']] = buf.getvalue()
newbin = bytearray()
for k, v in enumerate(js['bufferViews']):
    d = repl.get(k, bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
    while len(newbin) % 4: newbin.append(0)
    v['byteOffset'] = len(newbin); v['byteLength'] = len(d); newbin += d
while len(newbin) % 4: newbin.append(0)
js['buffers'][0]['byteLength'] = len(newbin)
jb = json.dumps(js, separators=(',', ':')).encode()
while len(jb) % 4: jb += b' '
open(out, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(jb) + len(newbin)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(newbin), 0x004E4942) + bytes(newbin))
print('ok', len(newbin))
