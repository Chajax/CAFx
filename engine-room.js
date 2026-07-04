/* =====================================================================
   ROOM ENGINE — (Raum) GPU-accelerated audio RAY-TRACER.
   Sound rays leave one or more speakers, bounce off the room's walls (an
   arbitrary extruded floor-plan polygon + floor + ceiling), losing energy
   per octave band by each surface's material absorption + air attenuation,
   and deposit energy into a per-band echogram whenever they pass either ear.
   The echogram becomes a stereo impulse response (band-limited noise shaped
   by the energy decay + a direct-sound spike) applied by a ConvolverNode.
     - WebGPU compute shader traces the shoebox case with many rays; the CPU
       tracer handles any geometry and is the always-there fallback.
   DOM-free: gui.js owns the panel/editor and calls bakeRoomIR().
   ===================================================================== */

/* ---------- octave bands + air absorption ---------- */
const ROOM_BANDS = [125, 250, 500, 1000, 2000, 4000];
const ROOM_AIR = [0.00035, 0.00069, 0.00115, 0.00219, 0.00426, 0.01117];  // Np/m per band
const ROOM_C = 343;                 // speed of sound m/s
const ROOM_NB = 6;

/* ---------- material library (6-band absorption α, 125…4k) ---------- */
const ROOM_MATERIALS = {
  concrete:{name:'Rough concrete',    a:[0.02,0.03,0.03,0.03,0.04,0.07]},
  painted: {name:'Painted concrete',  a:[0.01,0.01,0.02,0.02,0.02,0.03]},
  brick:   {name:'Unglazed brick',    a:[0.03,0.03,0.03,0.04,0.05,0.07]},
  plaster: {name:'Plaster on lath',   a:[0.14,0.10,0.06,0.05,0.04,0.03]},
  gypsum:  {name:'Gypsum board',      a:[0.29,0.10,0.05,0.04,0.07,0.09]},
  glass:   {name:'Glass (large pane)',a:[0.18,0.06,0.04,0.03,0.02,0.02]},
  wood:    {name:'Wooden floor',      a:[0.15,0.11,0.10,0.07,0.06,0.07]},
  marble:  {name:'Marble / tile',     a:[0.01,0.01,0.01,0.01,0.02,0.02]},
  carpet:  {name:'Heavy carpet',      a:[0.02,0.06,0.14,0.37,0.60,0.65]},
  curtain: {name:'Heavy curtain',     a:[0.14,0.35,0.55,0.72,0.70,0.65]},
  foam:    {name:'Acoustic foam 2in', a:[0.15,0.30,0.75,0.85,0.95,0.90]},
  audience:{name:'Audience (seated)', a:[0.39,0.57,0.80,0.94,0.92,0.87]},
};
const ROOM_WALL_NAMES = ['West','East','South','North','Floor','Ceiling'];

/* ---------- state ---------- */
let roomW=9, roomL=12, roomH=4;                 // shoebox dims (metres)
let roomSrcs=[{x:0.30,y:0.30,z:0.35,lock:false}];   // speakers (fractions of the room bbox)
let roomSelSrc=0;                                   // which speaker the height slider edits
let roomLis={x:0.68,y:0.72,z:0.32,lock:false};      // stereo microphone (fractions)
let roomWalls=['plaster','plaster','plaster','plaster','wood','gypsum'];  // box [W,E,S,N,Floor,Ceiling]
let roomMode='box';                             // 'box' | 'custom'
let roomFloorPoly=null;                         // [[x,y],…] metres, when custom
let roomEdgeMat=[];                             // per-edge material keys, when custom
let roomFloorMat='wood', roomCeilMat='gypsum';  // custom floor/ceiling
let roomWet=42, roomVol=90, roomQuality=55;
let roomIRData=null, roomGPUok=null;
let onRoomBake=()=>{};

/* ---------- geometry helpers ---------- */
function roomRect(){ return [[0,0],[roomW,0],[roomW,roomL],[0,roomL]]; }   // edges: S,E,N,W
// unified geometry: an extruded polygon + per-surface materials
function roomGeom(){
  if(roomMode==='custom' && roomFloorPoly && roomFloorPoly.length>=3){
    const em = (roomEdgeMat.length===roomFloorPoly.length) ? roomEdgeMat
             : roomFloorPoly.map((_,i)=>roomEdgeMat[i]||'plaster');
    return { poly:roomFloorPoly, H:roomH, edgeMat:em, floorMat:roomFloorMat, ceilMat:roomCeilMat };
  }
  // box: rectangle edges S,E,N,W ← named materials W,E,S,N
  return { poly:roomRect(), H:roomH, edgeMat:[roomWalls[2],roomWalls[1],roomWalls[3],roomWalls[0]],
           floorMat:roomWalls[4], ceilMat:roomWalls[5] };
}
function roomIsBox(){ return roomMode!=='custom'; }
function roomBBox(poly){ let a=1e9,b=1e9,c=-1e9,d=-1e9; for(const p of poly){ a=Math.min(a,p[0]);b=Math.min(b,p[1]);c=Math.max(c,p[0]);d=Math.max(d,p[1]); } return {minx:a,miny:b,maxx:c,maxy:d}; }
function roomInPoly(x,y,poly){ let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
  if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi)) inside=!inside; } return inside; }
function roomCentroid(poly){
  let S=0,cx=0,cy=0;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const cr=poly[j][0]*poly[i][1]-poly[i][0]*poly[j][1]; S+=cr; cx+=(poly[j][0]+poly[i][0])*cr; cy+=(poly[j][1]+poly[i][1])*cr; }
  if(Math.abs(S)<1e-9){ cx=0;cy=0; for(const p of poly){cx+=p[0];cy+=p[1];} return [cx/poly.length, cy/poly.length]; }
  return [cx/(3*S), cy/(3*S)];                              // area centroid (interior for room shapes)
}
function roomClampPoly(x,y,poly){
  if(roomInPoly(x,y,poly)) return [x,y];
  let bx=x,by=y,bd=1e18;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const ax=poly[j][0],ay=poly[j][1], ex=poly[i][0]-ax, ey=poly[i][1]-ay, L2=ex*ex+ey*ey||1e-9;
    let t=((x-ax)*ex+(y-ay)*ey)/L2; t=Math.max(0,Math.min(1,t)); const px=ax+ex*t, py=ay+ey*t, dd=(x-px)**2+(y-py)**2; if(dd<bd){bd=dd;bx=px;by=py;} }
  const C=roomCentroid(poly); let p=[bx,by];
  for(let k=0;k<10;k++){ p=[p[0]+(C[0]-p[0])*0.2, p[1]+(C[1]-p[1])*0.2]; if(roomInPoly(p[0],p[1],poly)) return p; }
  return C;                                                  // guaranteed-interior fallback
}
function roomFracToWorld(f){ const g=roomGeom(), bb=roomBBox(g.poly);
  const X=bb.minx+f.x*(bb.maxx-bb.minx), Y=bb.miny+f.y*(bb.maxy-bb.miny), c=roomClampPoly(X,Y,g.poly);
  return [c[0], c[1], (0.06+0.88*f.z)*g.H]; }
function roomSrcsM(){ return roomSrcs.map(roomFracToWorld); }
function roomLisM(){ return roomFracToWorld(roomLis); }
// stereo microphone: two capsules at the listener ± half the separation, along an axis
// rotated by roomMicAngle in the floor plane. Used by the tracers, coherent arrivals + viz.
let roomMicAngle=0;     // stereo-axis rotation, degrees (0 = along +X)
let roomMicSep=0.20;    // L/R capsule separation, metres
function roomMicEars(){ const c=roomLisM(), half=roomMicSep/2, a=roomMicAngle*Math.PI/180, ux=Math.cos(a), uy=Math.sin(a);
  return [ [c[0]-half*ux, c[1]-half*uy, c[2]], [c[0]+half*ux, c[1]+half*uy, c[2]] ]; }
function roomRayCount(){ return Math.round(6000 + roomQuality/100*40000); }   // total budget (split across speakers)
function roomMaxBounces(){ return Math.round(18 + roomQuality/100*46); }
function roomIRSeconds(){ return 1.6; }

/* ---------- coherent early arrivals → WAVE INTERFERENCE between speakers ----------
   Energy (the ray histogram) is phase-less, so summing it across speakers can't interfere.
   These arrivals carry an exact delay + amplitude per path, so when placed as fractional-
   sample impulses in the IR, convolution reproduces real constructive/destructive
   interference (comb filtering / spatial nulls) between speakers. Direct path for any
   geometry; first-order image sources for the shoebox (exact). The energy field skips the
   orders covered here (see `skipB`) so they aren't double-counted. */
function roomCoherentArrivals(srcs, lis){
  const out={L:[],R:[]}, DG=2.0;
  const bro=d=>{ let s=0; for(let b=0;b<ROOM_NB;b++) s+=Math.exp(-ROOM_AIR[b]*d); return s/ROOM_NB; };  // broadband air factor
  for(let ch=0;ch<2;ch++){ const P=lis[ch], dst=ch?out.R:out.L;
    for(const s of srcs){
      const d=Math.hypot(P[0]-s[0],P[1]-s[1],P[2]-s[2]);
      dst.push({t:d/ROOM_C, a:DG*bro(d)/Math.max(0.3,d)});                       // direct
      if(roomIsBox()){                                                            // + 6 first-order image sources
        const W=roomW,L=roomL,H=roomH, imgs=[
          [-s[0],s[1],s[2],roomWalls[0]],[2*W-s[0],s[1],s[2],roomWalls[1]],
          [s[0],-s[1],s[2],roomWalls[2]],[s[0],2*L-s[1],s[2],roomWalls[3]],
          [s[0],s[1],-s[2],roomWalls[4]],[s[0],s[1],2*H-s[2],roomWalls[5]] ];
        for(const im of imgs){ const dd=Math.hypot(P[0]-im[0],P[1]-im[1],P[2]-im[2]);
          const A=(ROOM_MATERIALS[im[3]]||ROOM_MATERIALS.plaster).a; let rf=0; for(let b=0;b<ROOM_NB;b++) rf+=Math.sqrt(1-A[b]); rf/=ROOM_NB;
          dst.push({t:dd/ROOM_C, a:DG*bro(dd)*rf/Math.max(0.3,dd)}); }
      }
    }
  }
  return out;
}

/* =====================================================================
   CPU RAY TRACER (any extruded-polygon room, multiple speakers)
   ===================================================================== */
function roomTraceCPU(SR){
  const g=roomGeom(), poly=g.poly, np=poly.length, H=g.H, bb=roomBBox(poly);
  const nBins=Math.ceil(roomIRSeconds()*SR);
  const vol=Math.max(1,(bb.maxx-bb.minx)*(bb.maxy-bb.miny)*H);
  const lis=roomMicEars();                        // stereo capsules (rotation + separation)
  const rad=Math.max(0.25, Math.cbrt(vol)*0.06), r2=rad*rad;
  const srcs=roomSrcsM(), nSpk=srcs.length;
  const perSpk=Math.max(300, Math.ceil(roomRayCount()/nSpk)), maxB=roomMaxBounces();
  // edge tables (ax,ay = start; ex,ey = edge vector; nx,ny = unit normal)
  const ax=new Float64Array(np),ay=new Float64Array(np),ex=new Float64Array(np),ey=new Float64Array(np),nx=new Float64Array(np),ny=new Float64Array(np);
  for(let i=0;i<np;i++){ const a=poly[i], b=poly[(i+1)%np]; ax[i]=a[0];ay[i]=a[1]; ex[i]=b[0]-a[0]; ey[i]=b[1]-a[1];
    const l=Math.hypot(ey[i],-ex[i])||1; nx[i]=ey[i]/l; ny[i]=-ex[i]/l; }
  const abs=g.edgeMat.map(k=>(ROOM_MATERIALS[k]||ROOM_MATERIALS.plaster).a);
  const floorA=(ROOM_MATERIALS[g.floorMat]||ROOM_MATERIALS.wood).a, ceilA=(ROOM_MATERIALS[g.ceilMat]||ROOM_MATERIALS.gypsum).a;
  const histL=[],histR=[]; for(let b=0;b<ROOM_NB;b++){ histL.push(new Float32Array(nBins)); histR.push(new Float32Array(nBins)); }
  const coh=roomCoherentArrivals(srcs, lis);       // phase-accurate direct (+box 1st order) → interference
  const skipB=roomIsBox()?2:1;                      // energy field starts after the coherently-handled orders
  const GA=Math.PI*(3-Math.sqrt(5)), scatter=0.30;
  let seed=0x2545f4>>>0; const rnd=()=>{ seed=(seed^(seed<<13))>>>0; seed=(seed^(seed>>>17))>>>0; seed=(seed^(seed<<5))>>>0; return seed/4294967296; };

  for(let si=0; si<nSpk; si++){ const S=srcs[si];
    for(let i=0;i<perSpk;i++){
      const up=1-2*(i+0.5)/perSpk, rr=Math.sqrt(Math.max(0,1-up*up)), th=GA*i + si*2.399963;
      let dx=Math.cos(th)*rr, dy=Math.sin(th)*rr, dz=up;         // dx,dy horizontal · dz up
      let px=S[0],py=S[1],pz=S[2], total=0; const en=[1,1,1,1,1,1];
      for(let b=0;b<maxB;b++){
        let tHit=1e9, hit=-1;                                    // -2 floor · -3 ceiling · ≥0 wall edge
        if(dz>1e-9){ const t=(H-pz)/dz; if(t<tHit){tHit=t;hit=-3;} } else if(dz<-1e-9){ const t=-pz/dz; if(t<tHit){tHit=t;hit=-2;} }
        for(let e=0;e<np;e++){
          const det=ex[e]*dy - dx*ey[e]; if(Math.abs(det)<1e-12) continue;
          const rx=ax[e]-px, ry=ay[e]-py;
          const t=(ex[e]*ry - rx*ey[e])/det, s=(dx*ry - dy*rx)/det;
          if(t>1e-6 && s>=-1e-6 && s<=1.000001 && t<tHit){ tHit=t; hit=e; }
        }
        if(hit===-1||tHit>=1e9) break;
        const segLen=tHit, hx=px+dx*tHit, hy=py+dy*tHit, hz=pz+dz*tHit;
        if(b>=skipB) for(let ch=0;ch<2;ch++){ const P=lis[ch];   // direct/1st order handled coherently above
          let tt=(P[0]-px)*dx+(P[1]-py)*dy+(P[2]-pz)*dz; if(tt<0)tt=0; else if(tt>segLen)tt=segLen;
          const cx=px+dx*tt-P[0], cy=py+dy*tt-P[1], cz=pz+dz*tt-P[2];
          if(cx*cx+cy*cy+cz*cz<=r2){ const bin=((total+tt)/ROOM_C*SR)|0; if(bin>=0&&bin<nBins){ const HH=ch?histR:histL;
            for(let bb=0;bb<ROOM_NB;bb++) HH[bb][bin]+=en[bb]*Math.exp(-ROOM_AIR[bb]*tt); } }
        }
        const A = hit===-2?floorA : hit===-3?ceilA : abs[hit];
        let emax=0; for(let bb=0;bb<ROOM_NB;bb++){ en[bb]*=Math.exp(-ROOM_AIR[bb]*segLen)*(1-A[bb]); if(en[bb]>emax)emax=en[bb]; }
        total+=segLen; if(emax<1e-4) break;
        let Nx,Ny,Nz;
        if(hit===-2){ dz=-dz; Nx=0;Ny=0;Nz=1; }
        else if(hit===-3){ dz=-dz; Nx=0;Ny=0;Nz=-1; }
        else { const enx=nx[hit],eny=ny[hit], dot=dx*enx+dy*eny; dx-=2*dot*enx; dy-=2*dot*eny; Nx=enx;Ny=eny;Nz=0; }
        if(dx*Nx+dy*Ny+dz*Nz<0){ Nx=-Nx;Ny=-Ny;Nz=-Nz; }        // orient normal into the room
        if(scatter>0){ let rx=rnd()*2-1, ry=rnd()*2-1, rz=rnd()*2-1; const rl=Math.hypot(rx,ry,rz)||1; rx/=rl;ry/=rl;rz/=rl;
          if(rx*Nx+ry*Ny+rz*Nz<0){ rx=-rx;ry=-ry;rz=-rz; }
          dx+=(rx-dx)*scatter; dy+=(ry-dy)*scatter; dz+=(rz-dz)*scatter;
          const dl=Math.hypot(dx,dy,dz)||1; dx/=dl;dy/=dl;dz/=dl; }
        px=hx+dx*1e-4; py=hy+dy*1e-4; pz=hz+dz*1e-4;
      }
    }
  }
  return {L:histL,R:histR,nBins,sr:SR,coh,rays:perSpk*nSpk,gpu:false};
}

/* ---------- RBJ band-pass ---------- */
function roomBandpass(inp,out,f0,SR){
  const w0=2*Math.PI*f0/SR, cw=Math.cos(w0), sw=Math.sin(w0), Q=1.3, al=sw/(2*Q);
  const b0=al,b2=-al,a0=1+al,a1=-2*cw,a2=1-al, nb0=b0/a0,nb2=b2/a0,na1=a1/a0,na2=a2/a0;
  let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<inp.length;i++){ const x=inp[i]; const y=nb0*x+nb2*x2-na1*y1-na2*y2; x2=x1;x1=x;y2=y1;y1=y; out[i]=y; }
}

/* ---------- echogram → stereo IR (ENERGY-normalised so convolution ≈ unity) ---------- */
function roomSynthIR(hist, SR){
  const nBins=hist.nBins, out={L:new Float32Array(nBins),R:new Float32Array(nBins)};
  const noise=new Float32Array(nBins), band=new Float32Array(nBins);
  let seed=0x9e3779b1>>>0; const rnd=()=>{ seed=(seed^(seed<<13))>>>0; seed=(seed^(seed>>>17))>>>0; seed=(seed^(seed<<5))>>>0; return seed/4294967296*2-1; };
  for(const chan of ['L','R']){
    const dst=out[chan], H=hist[chan];
    for(let b=0;b<ROOM_NB;b++){
      for(let i=0;i<nBins;i++) noise[i]=rnd();
      roomBandpass(noise, band, ROOM_BANDS[b], SR);
      const env=H[b]; let s=0; const k=0.35;
      for(let i=0;i<nBins;i++){ s+=(env[i]-s)*k; dst[i]+=band[i]*Math.sqrt(Math.max(0,s)); }
    }
    // coherent early arrivals (direct + box 1st-order): fractional-sample impulses → real interference
    const coh=hist.coh?hist.coh[chan]:[];
    for(const ar of coh){ const fb=ar.t*SR, i0=Math.floor(fb), fr=fb-i0;
      if(i0>=0 && i0+1<nBins){ dst[i0]+=ar.a*(1-fr); dst[i0+1]+=ar.a*fr; }
      else if(i0>=0 && i0<nBins) dst[i0]+=ar.a; }
  }
  // ENERGY normalisation: convolution RMS gain ≈ ||h||₂, so target combined L2≈1 (was peak-only → ~12× too hot).
  let e2=0, peak=0; for(let i=0;i<nBins;i++){ e2+=out.L[i]*out.L[i]+out.R[i]*out.R[i]; const a=Math.abs(out.L[i]),b=Math.abs(out.R[i]); if(a>peak)peak=a; if(b>peak)peak=b; }
  let g = e2>1e-9 ? 1.0/Math.sqrt(e2) : 1;
  if(peak*g>0.99) g=0.99/peak;                              // also bound the IR peak
  let last=0, thr=0.0006/Math.max(g,1e-6);
  for(let i=0;i<nBins;i++){ if(Math.abs(out.L[i])>thr||Math.abs(out.R[i])>thr) last=i; }
  const len=Math.max(SR*0.15|0, Math.min(nBins, last+(SR*0.03|0)));
  const Lc=new Float32Array(len), Rc=new Float32Array(len);
  for(let i=0;i<len;i++){ Lc[i]=out.L[i]*g; Rc[i]=out.R[i]*g; }
  return {sr:SR, L:Lc, R:Rc, dur:len/SR, gpu:!!hist.gpu, rays:hist.rays||0};
}

/* =====================================================================
   WebGPU compute path (shoebox only; multiple speakers). CPU handles
   custom polygons + is the fallback on any GPU failure.
   ===================================================================== */
const ROOM_WGSL = `
struct P {
  room : vec4<f32>,   // W,L,H, C
  rad  : vec4<f32>,   // w = detector radius
  lisL : vec4<f32>,   // xyz, w=SR
  lisR : vec4<f32>,   // xyz, w=scatter
  cfg  : vec4<u32>,   // perSpk, maxBounces, nBins, nSpk
};
@group(0) @binding(0) var<uniform> u : P;
@group(0) @binding(1) var<storage, read> mats : array<f32>;
@group(0) @binding(2) var<storage, read_write> hist : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> spks : array<vec4<f32>>;
fn hash(x:u32)->u32{ var v=x; v=v^(v>>16u); v=v*0x7feb352du; v=v^(v>>15u); v=v*0x846ca68bu; v=v^(v>>16u); return v; }
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>){
  let idx=gid.x; let perSpk=u.cfg.x; let nSpk=u.cfg.w; let total=perSpk*nSpk;
  if(idx>=total){ return; }
  let W=u.room.x; let L=u.room.y; let H=u.room.z; let C=u.room.w;
  let SR=u.lisL.w; let rad=u.rad.w; let r2=rad*rad; let scatter=u.lisR.w;
  let nBins=u.cfg.z; let maxB=u.cfg.y; let skipB=u32(u.rad.x);   // direct/1st order handled coherently on CPU
  let lis=array<vec3<f32>,2>(u.lisL.xyz, u.lisR.xyz);
  let spk=idx/perSpk; let li=idx%perSpk;
  let GA=3.14159265*(3.0-sqrt(5.0)); let fi=f32(li);
  let up=1.0-2.0*(fi+0.5)/f32(perSpk); let rr=sqrt(max(0.0,1.0-up*up)); let th=GA*fi;
  var dir=vec3<f32>(cos(th)*rr, up, sin(th)*rr);
  var pos=spks[spk].xyz;
  var total_d=0.0; var en=array<f32,6>(1.0,1.0,1.0,1.0,1.0,1.0);
  var rng=hash(idx*747796405u+2891336453u);
  for(var b=0u;b<maxB;b=b+1u){
    var tHit=1e9; var wall=-1;
    if(dir.x>1e-9){ let t=(W-pos.x)/dir.x; if(t<tHit){tHit=t;wall=1;} } else if(dir.x<-1e-9){ let t=(0.0-pos.x)/dir.x; if(t<tHit){tHit=t;wall=0;} }
    if(dir.y>1e-9){ let t=(L-pos.y)/dir.y; if(t<tHit){tHit=t;wall=3;} } else if(dir.y<-1e-9){ let t=(0.0-pos.y)/dir.y; if(t<tHit){tHit=t;wall=2;} }
    if(dir.z>1e-9){ let t=(H-pos.z)/dir.z; if(t<tHit){tHit=t;wall=5;} } else if(dir.z<-1e-9){ let t=(0.0-pos.z)/dir.z; if(t<tHit){tHit=t;wall=4;} }
    if(wall<0){ break; }
    let segLen=tHit; let hit=pos+dir*tHit;
    if(b>=skipB){ for(var ch=0u;ch<2u;ch=ch+1u){
      let Pl=lis[ch]; var tt=dot(Pl-pos,dir); tt=clamp(tt,0.0,segLen);
      let cc=pos+dir*tt-Pl;
      if(dot(cc,cc)<=r2){ let bin=i32(((total_d+tt)/C*SR));
        if(bin>=0 && bin<i32(nBins)){ for(var bb=0u;bb<6u;bb=bb+1u){ let e=en[bb]*exp(-mats[36u+bb]*tt); atomicAdd(&hist[(ch*6u+bb)*nBins+u32(bin)], u32(e*1000000.0)); } } }
    } }
    let wbase=u32(wall)*6u; var emax=0.0;
    for(var bb=0u;bb<6u;bb=bb+1u){ en[bb]=en[bb]*exp(-mats[36u+bb]*segLen)*(1.0-mats[wbase+bb]); emax=max(emax,en[bb]); }
    total_d=total_d+segLen; if(emax<1e-4){ break; }
    if(wall<2){ dir.x=-dir.x; } else if(wall<4){ dir.y=-dir.y; } else { dir.z=-dir.z; }
    if(scatter>0.0){ var n=vec3<f32>(0.0,0.0,0.0);
      if(wall==0){n.x=1.0;} else if(wall==1){n.x=-1.0;} else if(wall==2){n.y=1.0;} else if(wall==3){n.y=-1.0;} else if(wall==4){n.z=1.0;} else {n.z=-1.0;}
      rng=hash(rng); let a=f32(rng)/4294967296.0*2.0-1.0; rng=hash(rng); let b2=f32(rng)/4294967296.0*2.0-1.0; rng=hash(rng); let c2=f32(rng)/4294967296.0*2.0-1.0;
      var rv=vec3<f32>(a,b2,c2); let rl=length(rv); if(rl>0.0){ rv=rv/rl; } if(dot(rv,n)<0.0){ rv=-rv; }
      dir=normalize(mix(dir,rv,scatter)); }
    pos=hit+dir*1e-4;
  }
}`;

let roomGPU=null;
async function roomInitGPU(){
  if(roomGPU) return roomGPU;
  if(typeof navigator==='undefined' || !navigator.gpu){ roomGPUok=false; return null; }
  try{
    const adapter=await navigator.gpu.requestAdapter(); if(!adapter){ roomGPUok=false; return null; }
    const device=await adapter.requestDevice();
    const module=device.createShaderModule({code:ROOM_WGSL});
    const pipeline=device.createComputePipeline({layout:'auto', compute:{module, entryPoint:'main'}});
    roomGPU={device, pipeline}; roomGPUok=true; return roomGPU;
  }catch(e){ roomGPUok=false; return null; }
}
async function roomTraceGPU(SR){
  const g=await roomInitGPU(); if(!g) return null;
  try{
    const {device, pipeline}=g;
    const nBins=Math.ceil(roomIRSeconds()*SR);
    const srcs=roomSrcsM(), nSpk=srcs.length;
    const perSpk=Math.max(300, Math.ceil(roomRayCount()*6/nSpk)), total=perSpk*nSpk, maxB=roomMaxBounces();
    const ears=roomMicEars(), rad=Math.max(0.25, Math.cbrt(roomW*roomL*roomH)*0.06);
    const uf=new Float32Array(20), uu=new Uint32Array(uf.buffer);
    uf[0]=roomW;uf[1]=roomL;uf[2]=roomH;uf[3]=ROOM_C; uf[4]=2; uf[7]=rad;   // rad.x = skipB (box: direct+1st order are coherent)
    uf[8]=ears[0][0];uf[9]=ears[0][1];uf[10]=ears[0][2];uf[11]=SR;
    uf[12]=ears[1][0];uf[13]=ears[1][1];uf[14]=ears[1][2];uf[15]=0.30;
    uu[16]=perSpk;uu[17]=maxB;uu[18]=nBins;uu[19]=nSpk;
    const uBuf=device.createBuffer({size:uf.byteLength, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}); device.queue.writeBuffer(uBuf,0,uf);
    const abs=roomGeom().edgeMat.map(k=>(ROOM_MATERIALS[k]||ROOM_MATERIALS.plaster).a);   // box: 4 edges S,E,N,W
    // map box edges → shader wall order (0 X- ,1 X+ ,2 Y- ,3 Y+ ,4 floor,5 ceil): W,E,S,N + floor,ceil
    const mat=new Float32Array(42), G=roomGeom();
    const wallKeys=[roomWalls[0],roomWalls[1],roomWalls[2],roomWalls[3],G.floorMat,G.ceilMat]; // W,E,S,N,F,C
    for(let w=0;w<6;w++){ const aa=(ROOM_MATERIALS[wallKeys[w]]||ROOM_MATERIALS.plaster).a; for(let b=0;b<6;b++) mat[w*6+b]=aa[b]; }
    for(let b=0;b<6;b++) mat[36+b]=ROOM_AIR[b];
    const mBuf=device.createBuffer({size:mat.byteLength, usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}); device.queue.writeBuffer(mBuf,0,mat);
    const spkArr=new Float32Array(nSpk*4); for(let i=0;i<nSpk;i++){ spkArr[i*4]=srcs[i][0]; spkArr[i*4+1]=srcs[i][1]; spkArr[i*4+2]=srcs[i][2]; }
    const sBuf=device.createBuffer({size:Math.max(16,spkArr.byteLength), usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}); device.queue.writeBuffer(sBuf,0,spkArr);
    const histCount=2*6*nBins, histBytes=histCount*4;
    const hBuf=device.createBuffer({size:histBytes, usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}); device.queue.writeBuffer(hBuf,0,new Uint32Array(histCount));
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0), entries:[
      {binding:0,resource:{buffer:uBuf}},{binding:1,resource:{buffer:mBuf}},{binding:2,resource:{buffer:hBuf}},{binding:3,resource:{buffer:sBuf}} ]});
    const enc=device.createCommandEncoder(); const pass=enc.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0,bind);
    pass.dispatchWorkgroups(Math.ceil(total/64)); pass.end();
    const readBuf=device.createBuffer({size:histBytes, usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    enc.copyBufferToBuffer(hBuf,0,readBuf,0,histBytes); device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ); const raw=new Uint32Array(readBuf.getMappedRange().slice(0)); readBuf.unmap();
    const histL=[],histR=[]; for(let b=0;b<ROOM_NB;b++){ histL.push(new Float32Array(nBins)); histR.push(new Float32Array(nBins)); }
    for(let ch=0;ch<2;ch++) for(let b=0;b<ROOM_NB;b++){ const dst=(ch?histR:histL)[b], base=(ch*6+b)*nBins; for(let i=0;i<nBins;i++) dst[i]=raw[base+i]/1e6; }
    const coh=roomCoherentArrivals(srcs, ears);        // phase-accurate direct + 1st-order → interference
    return {L:histL,R:histR,nBins,sr:SR,coh,rays:total,gpu:true};
  }catch(e){ roomGPUok=false; return null; }
}

/* ---------- bake ---------- */
async function bakeRoomIR(SR){
  SR = SR || (typeof ctx!=='undefined' && ctx ? ctx.sampleRate : 44100);
  let hist = roomIsBox() ? await roomTraceGPU(SR) : null;    // GPU shoebox only
  if(!hist) hist = roomTraceCPU(SR);
  roomIRData = roomSynthIR(hist, SR);
  onRoomBake(roomIRData.gpu, roomIRData.rays, roomIRData.dur);
  return roomIRData;
}
function roomEnsureIRSync(SR){ if(!roomIRData || roomIRData.sr!==SR) roomIRData=roomSynthIR(roomTraceCPU(SR), SR); return roomIRData; }
function roomMakeBuffer(c){ const ir=roomEnsureIRSync(c.sampleRate), buf=c.createBuffer(2, ir.L.length, c.sampleRate); buf.copyToChannel(ir.L,0); buf.copyToChannel(ir.R,1); return buf; }
function roomSoftCurve(){ const n=1024, cv=new Float32Array(n); for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; cv[i]=Math.tanh(x*1.4)*0.98; } return cv; }

/* =====================================================================
   engine registration
   ===================================================================== */
ENGINES.room = {
  id:'room', name:'Room', tagline:'Ray-traced room acoustics',
  blurb:'Drop in any audio and put it inside a room you build. Rays fired from your speakers ricochet off the walls — each material soaking up the highs or throwing them back — and the impulse response they trace is convolved onto your sound. Move the speakers and the stereo mic to hear the space, its reflections, and the interference between them.',
  color:'#2fe08a', glow:'#9bffcf', implemented:true,
  paramsFor(d){ return {}; },
  // input → [dry] + [convolver(IR) → wet] → sum → soft-clip → master out
  buildChain(c,p,withCrowd){
    const input=c.createGain(), out=c.createGain(); out.gain.value=roomVol/100;
    const dry=c.createGain(), wet=c.createGain(), sum=c.createGain();
    const conv=c.createConvolver(); conv.normalize=false; try{ conv.buffer=roomMakeBuffer(c); }catch(e){}
    const shaper=c.createWaveShaper(); shaper.curve=roomSoftCurve(); shaper.oversample='none';
    const [dg,wg]=roomMix(roomWet); dry.gain.value=dg; wet.gain.value=wg;
    input.connect(dry); dry.connect(sum);
    input.connect(conv); conv.connect(wet); wet.connect(sum);
    sum.connect(shaper); shaper.connect(out);
    return { input, out, dry, wet, conv, stopNodes:[] };
  },
  liveUpdate(chain){
    if(!chain||!chain.out) return;
    const t=ctx.currentTime, [dg,wg]=roomMix(roomWet);
    if(chain.dry) chain.dry.gain.linearRampToValueAtTime(dg,t+0.08);
    if(chain.wet) chain.wet.gain.linearRampToValueAtTime(wg,t+0.08);
    chain.out.gain.linearRampToValueAtTime(roomVol/100,t+0.08);
  },
  applyRoomIR(chain){ if(!chain||!chain.conv) return; try{ chain.conv.buffer=roomMakeBuffer(ctx); }catch(e){} },
};
function roomMix(pct){ const x=Math.max(0,Math.min(100,pct))/100; return [Math.cos(x*Math.PI/2), Math.sin(x*Math.PI/2)]; }
