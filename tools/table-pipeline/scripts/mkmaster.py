import sys; sys.path.insert(0, 'scripts')
import numpy as np
from glb import write_glb
d = np.load('scripts/master.npz')
write_glb('viewer/master-uv.glb', d['pos'], d['nrm'], d['uv'], d['idx'])
print('ok', d['pos'].shape, d['idx'].shape)
