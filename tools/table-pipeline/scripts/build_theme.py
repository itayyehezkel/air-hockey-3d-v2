# Writes a themed table: the Classic geometry in two parts, the playing surface with its own sharp
# top-down image (the Classic surface layout, 1024x2064) and the rest with the projected texture.
import io, json, struct, sys; sys.path.insert(0, 'scripts')
import numpy as np
from PIL import Image
HALF_W, HALF_L, PAD = 3.0, 5.25, 0.797
theme, surface_png, out = sys.argv[1], sys.argv[2], sys.argv[3]
d = np.load('scripts/master.npz')
names = [str(n) for n in d['names']]
surf = np.array(['table_surface' in n for n in names])[d['part']]
goal = np.array(['goal' in n for n in names])[d['part']]
idx = d['idx'].copy(); idx[goal] = idx[goal][:, [0, 2, 1]]
pos = d['pos'].astype(np.float64); uv = d['uv'].copy()
sv = np.unique(idx[surf])
uv[sv, 0] = (pos[sv, 0] + HALF_W) / (2 * HALF_W)
uv[sv, 1] = 1 - (pos[sv, 2] + HALF_L + PAD) / (2 * (HALF_L + PAD))
flip = np.array([-1, 1, 1]); P = (pos * flip).astype(np.float32); N = (d['nrm'] * flip).astype(np.float32); UV = uv.astype(np.float32)

def jpeg(img, size=None, q=90):
    if size: img = img.resize(size, Image.LANCZOS)
    b = io.BytesIO(); img.convert('RGB').save(b, 'JPEG', quality=q); return b.getvalue()
imgs = [jpeg(Image.open(f'scripts/tex_{theme}.png'), (2048, 2048)), jpeg(Image.open(surface_png), None, 92)]

buf = bytearray(); views = []; accs = []
def view(data, target=None):
    while len(buf) % 4: buf.append(0)
    views.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(data), **({'target': target} if target else {})}); buf.extend(data); return len(views) - 1
def acc(arr, typ, comp, target, mm=False):
    a = {'bufferView': view(arr.tobytes(), target), 'componentType': comp, 'count': len(arr), 'type': typ}
    if mm: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
attrs = {'POSITION': acc(P, 'VEC3', 5126, 34962, True), 'NORMAL': acc(N, 'VEC3', 5126, 34962), 'TEXCOORD_0': acc(UV, 'VEC2', 5126, 34962)}
prims = []
for mat, faces in ((0, idx[~surf]), (1, idx[surf])):
    prims.append({'attributes': attrs, 'indices': acc(faces.astype(np.uint32).reshape(-1), 'SCALAR', 5125, 34963), 'material': mat})
images = [{'bufferView': view(b), 'mimeType': 'image/jpeg'} for b in imgs]
mats = [{'name': n, 'pbrMetallicRoughness': {'baseColorTexture': {'index': i}, 'metallicFactor': 0, 'roughnessFactor': 0.6}, 'extensions': {'KHR_materials_unlit': {}}}
        for i, n in enumerate(['table', 'surface'])]
js = {'asset': {'version': '2.0', 'generator': 'air-smash theme bake'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'table'}],
      'meshes': [{'primitives': prims}], 'materials': mats, 'images': images, 'samplers': [{'minFilter': 9987, 'magFilter': 9729}],
      'textures': [{'source': i, 'sampler': 0} for i in range(2)], 'extensionsUsed': ['KHR_materials_unlit'],
      'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': 0}]}
while len(buf) % 4: buf.append(0)
js['buffers'][0]['byteLength'] = len(buf)
jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * ((4 - len(jb) % 4) % 4)
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(buf))); f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
    f.write(struct.pack('<II', len(buf), 0x004E4942)); f.write(bytes(buf))
print('ok', out)
