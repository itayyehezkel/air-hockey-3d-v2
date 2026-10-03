# Merges the in-game Classic table (game units, exported from the running game) into one mesh and
# gives it a texture layout (xatlas), so a theme can be painted onto the exact same shape.
import json, struct, time
import numpy as np, xatlas
meta = json.load(open('refs/classic_geom.json'))
raw = open('refs/classic_geom.bin', 'rb').read()
off = 0; P = []; N = []; F = []; part = []; base = 0
for pi, m in enumerate(meta):
    nv, ni = m['nv'], m['ni']
    p = np.frombuffer(raw, np.float32, nv * 3, off).reshape(-1, 3); off += nv * 12
    n = np.frombuffer(raw, np.float32, nv * 3, off).reshape(-1, 3); off += nv * 12
    f = np.frombuffer(raw, np.uint32, ni, off).reshape(-1, 3).astype(np.int64); off += ni * 4
    if m['flip']: f = f[:, [0, 2, 1]]  # mirrored under the glTF root: keep one winding throughout
    P.append(p); N.append(n); F.append(f + base); part += [pi] * len(f); base += nv
P = np.concatenate(P); N = np.concatenate(N); F = np.concatenate(F); part = np.array(part)
print('verts', len(P), 'tris', len(F))
t = time.time()
atlas = xatlas.Atlas()
atlas.add_mesh(P, F.astype(np.uint32), N)
co = xatlas.ChartOptions(); co.max_iterations = 2
po = xatlas.PackOptions(); po.resolution = 4096; po.padding = 6; po.bilinear = True; po.bruteForce = False
atlas.generate(co, po)
vmap, idx, uv = atlas[0]
print('unwrap %.1fs' % (time.time() - t), 'out verts', len(vmap), 'charts', atlas.chart_count, 'size', atlas.width, atlas.height)
np.savez('scripts/master.npz', pos=P[vmap], nrm=N[vmap], uv=uv, idx=idx, part=part, names=np.array([m['name'] + '|' + m['mat'] for m in meta]))
