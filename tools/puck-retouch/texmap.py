# Maps each texel of the puck texture to its 3D position/normal (by rasterizing the triangles in UV space).
import json, struct, io, numpy as np
from PIL import Image
def load(path):
    b=open(path,'rb').read(); jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl]); bin_=b[20+jl+8:]
    def acc(i):
        a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]; dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
        off=bv.get('byteOffset',0)+a.get('byteOffset',0)
        return np.frombuffer(bin_,dt,a['count']*n,off).reshape(-1,n) if n>1 else np.frombuffer(bin_,dt,a['count'],off)
    prim=j['meshes'][0]['primitives'][0]
    return j, acc(prim['attributes']['POSITION']), acc(prim['attributes']['NORMAL']), acc(prim['attributes']['TEXCOORD_0']), acc(prim['indices']).reshape(-1,3)
def texel_map(path, T):
    j,P,N,UV,F=load(path)
    pos=np.zeros((T,T,3),np.float32); nrm=np.zeros((T,T,3),np.float32); hit=np.zeros((T,T),bool)
    uv=UV*T
    for f in F:
        a=uv[f]; x0,y0=np.maximum(np.floor(a.min(0)).astype(int),0); x1,y1=np.minimum(np.ceil(a.max(0)).astype(int),T-1)
        m=np.array([[a[1,0]-a[0,0],a[2,0]-a[0,0]],[a[1,1]-a[0,1],a[2,1]-a[0,1]]])
        if x1<x0 or y1<y0 or abs(np.linalg.det(m))<1e-12: continue
        inv=np.linalg.inv(m); X,Y=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
        s=inv[0,0]*(X-a[0,0])+inv[0,1]*(Y-a[0,1]); t=inv[1,0]*(X-a[0,0])+inv[1,1]*(Y-a[0,1])
        ins=(s>=-.01)&(t>=-.01)&(s+t<=1.01)
        if not ins.any(): continue
        yy,xx=np.nonzero(ins); s,t=s[yy,xx],t[yy,xx]; p=P[f]; n=N[f].mean(0)
        pos[y0+yy,x0+xx]=p[0]+s[:,None]*(p[1]-p[0])+t[:,None]*(p[2]-p[0]); nrm[y0+yy,x0+xx]=n; hit[y0+yy,x0+xx]=True
    return j,P,pos,nrm,hit
