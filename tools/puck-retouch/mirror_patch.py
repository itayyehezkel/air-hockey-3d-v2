# Replaces a broken part of a puck's mesh (a hole / inside-out faces Tripo made on the side it couldn't
# see) with a mirrored copy of the clean opposite side: the puck is round, so the mirror matches.
# Usage: python puck/mirror_patch.py SRC.glb OUT.glb BAD_ANGLE_DEG [HALF_WIDTH_DEG] [MIN_RADIUS]
#   Only faces at least MIN_RADIUS from the axis (the outer wall) are touched, so the top stays original.
#   Faces whose center angle around the puck is within HALF_WIDTH of BAD_ANGLE are dropped and the
#   faces around the opposite angle are mirrored across the plane between them.
import sys, json, struct; sys.path.insert(0, 'puck')
import numpy as np
from texmap import load
src, out, bad = sys.argv[1], sys.argv[2], float(sys.argv[3])
half = float(sys.argv[4]) if len(sys.argv) > 4 else 38
rmin = float(sys.argv[5]) if len(sys.argv) > 5 else 0.42
j, P, N, UV, F = load(src)
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + jl]); bin_ = b[20 + jl + 8:]
cen = P[F].mean(1)
ang = np.degrees(np.arctan2(cen[:, 2], cen[:, 0]))
d = lambda a, c: np.abs((a - c + 180) % 360 - 180)
# The outer wall only: far from the axis, below the top edge and facing sideways (not the crimp or top).
fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
wall = (np.hypot(cen[:, 0], cen[:, 2]) > rmin) & (cen[:, 1] < P[:, 1].max() - 0.04) & (np.abs(fn[:, 1]) < 0.6)
good_src = wall & (d(ang, bad + 180) < half)   # a little overlap so no seam opens
# Nothing is removed: the mirrored piece lies a hair outside the original wall and covers the hole,
# so no crack can open where it meets the original.
drop = np.zeros(len(F), bool)
keep = F
# Mirror plane: through the axis, perpendicular to the direction of `bad`.
t = np.radians(bad); n = np.array([np.cos(t), 0, np.sin(t)])
M = np.eye(3) - 2 * np.outer(n, n)
mf = F[good_src]
ids = np.unique(mf); remap = {v: i + len(P) for i, v in enumerate(ids)}
Pm = P[ids] @ M.T; Pm[:, [0, 2]] *= 1.006
P2 = np.vstack([P, Pm]); N2 = np.vstack([N, N[ids] @ M.T]); UV2 = np.vstack([UV, UV[ids]])
mirrored = np.vectorize(remap.get)(mf)[:, [0, 2, 1]]   # mirroring flips handedness: rewind
F2 = np.vstack([keep, mirrored]).astype(np.uint32)
print('dropped', drop.sum(), 'faces; mirrored in', len(mf))
# Rewrite the primitive's POSITION / NORMAL / TEXCOORD_0 / indices as new buffer views.
prim = js['meshes'][0]['primitives'][0]
blobs = [(prim['attributes']['POSITION'], P2.astype(np.float32), 'VEC3'), (prim['attributes']['NORMAL'], N2.astype(np.float32), 'VEC3'),
         (prim['attributes']['TEXCOORD_0'], UV2.astype(np.float32), 'VEC2'), (prim['indices'], F2.ravel(), 'SCALAR')]
newbin = bytearray(bin_)
for acc_i, arr, typ in blobs:
    while len(newbin) % 4: newbin.append(0)
    off = len(newbin); data = arr.tobytes(); newbin += data
    js['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    a = js['accessors'][acc_i]
    a.update({'bufferView': len(js['bufferViews']) - 1, 'byteOffset': 0, 'count': int(arr.shape[0] if typ != 'SCALAR' else arr.size), 'type': typ,
              'componentType': 5125 if typ == 'SCALAR' else 5126})
    if typ == 'VEC3' and acc_i == prim['attributes']['POSITION']: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    else: a.pop('min', None); a.pop('max', None)
    a.pop('sparse', None)
while len(newbin) % 4: newbin.append(0)
js['buffers'][0]['byteLength'] = len(newbin)
jb = json.dumps(js, separators=(',', ':')).encode()
while len(jb) % 4: jb += b' '
open(out, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(jb) + len(newbin)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(newbin), 0x004E4942) + bytes(newbin))
