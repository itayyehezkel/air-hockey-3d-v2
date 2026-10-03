# Paints the two sparkle stars out of the Snowflake puck's top (colour + normal textures), filling each patch
# from a smooth top-down blend of the surrounding ice, and writes puck/snowflake-clean.glb.
import sys; sys.path.insert(0,'puck')
import numpy as np, json, struct
from PIL import Image, ImageFilter
from texmap import texel_map
T=2048
j,P,pos,nrm,hit=texel_map('puck/snowflake-src.glb',T)
col=np.asarray(Image.open('puck/tex/src_1.png')).astype(np.float32)
nm=np.asarray(Image.open('puck/tex/src_0.png')).astype(np.float32)
x,z=pos[...,0],pos[...,2]; top=hit&(nrm[...,1]>0.3)
S=799; mask=np.zeros((T,T),bool)
for sx,sz in [(600/S-0.5,290/S-0.5),(205/S-0.5,450/S-0.5)]:
    mask|=top&(np.sqrt((x-sx)**2+(z-sz)**2)<0.072)
G=512
img=np.zeros((G,G,3),np.float32); w=np.zeros((G,G),np.float32)
keep=top&~mask&(nrm[...,1]>0.8)
ys,xs=np.nonzero(keep)
gx=np.clip(((x[ys,xs]+0.5)*(G-1)).round().astype(int),0,G-1); gz=np.clip(((z[ys,xs]+0.5)*(G-1)).round().astype(int),0,G-1)
np.add.at(img,(gz,gx),col[ys,xs]); np.add.at(w,(gz,gx),1)
c=img/np.maximum(w,1)[...,None]; a=(w>0).astype(np.float32)
def down(c,a):
    H=c.shape[0]//2; cw=(c*a[...,None]).reshape(H,2,H,2,3).sum((1,3)); aw=a.reshape(H,2,H,2).sum((1,3))
    return cw/np.maximum(aw,1e-6)[...,None], np.minimum(aw,1)
levels=[(c,a)]
while levels[-1][0].shape[0]>1: levels.append(down(*levels[-1]))
fc=levels[-1][0]
for c_,a_ in reversed(levels[:-1]):
    up=np.repeat(np.repeat(fc,2,0),2,1)[:c_.shape[0],:c_.shape[1]]
    fc=c_*a_[...,None]+up*(1-a_[...,None])
fc=np.asarray(Image.fromarray(np.clip(fc,0,255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
m=Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
al=(np.asarray(m).astype(np.float32)/255*top)
yy,xx=np.nonzero(al>0)
gx=np.clip(((x[yy,xx]+0.5)*(G-1)).round().astype(int),0,G-1); gz=np.clip(((z[yy,xx]+0.5)*(G-1)).round().astype(int),0,G-1)
out=col.copy(); k=al[yy,xx][:,None]
out[yy,xx]=col[yy,xx]*(1-k)+fc[gz,gx]*k
nout=nm.copy(); nout[yy,xx]=nm[yy,xx]*(1-k)+np.array([128,128,255],np.float32)*k
Image.fromarray(np.clip(out,0,255).astype(np.uint8)).save('puck/tex/new_color.jpg',quality=92)
Image.fromarray(np.clip(nout,0,255).astype(np.uint8)).save('puck/tex/new_normal.png')
S2=800; prev=np.full((S2,S2,3),40,np.uint8)
up_=hit&(nrm[...,1]>0.6); ys,xs=np.nonzero(up_)
prev[((z[ys,xs]+0.5)*(S2-1)).astype(int),((x[ys,xs]+0.5)*(S2-1)).astype(int)]=out[ys,xs].astype(np.uint8)
Image.fromarray(prev).crop((100,100,700,700)).save('puck/top_after4.png')
b=open('puck/snowflake-src.glb','rb').read(); jl=struct.unpack('<I',b[12:16])[0]; js=json.loads(b[20:20+jl]); bin_=b[20+jl+8:]
repl={}
for im in js['images']:
    if im['name'].startswith('Color'): repl[im['bufferView']]=open('puck/tex/new_color.jpg','rb').read(); im['mimeType']='image/jpeg'
    if im['name'].startswith('NormalGL'): repl[im['bufferView']]=open('puck/tex/new_normal.png','rb').read(); im['mimeType']='image/png'
newbin=bytearray()
for k_,bv in enumerate(js['bufferViews']):
    data=repl.get(k_, bin_[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']])
    while len(newbin)%4: newbin.append(0)
    bv['byteOffset']=len(newbin); bv['byteLength']=len(data); newbin+=data
while len(newbin)%4: newbin.append(0)
js['buffers'][0]['byteLength']=len(newbin)
jb=json.dumps(js,separators=(',',':')).encode()
while len(jb)%4: jb+=b' '
glb=struct.pack('<III',0x46546C67,2,12+8+len(jb)+8+len(newbin))+struct.pack('<II',len(jb),0x4E4F534A)+jb+struct.pack('<II',len(newbin),0x004E4942)+bytes(newbin)
open('puck/snowflake-clean.glb','wb').write(glb); print('glb',len(glb))
