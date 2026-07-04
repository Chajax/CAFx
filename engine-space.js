/* =====================================================================
   SPACE ENGINE — three "worlds" you drop a sound into. No distance model;
   each module is a self-running sound-design space (LFOs/feedback baked into
   the graph). Picked via spaceMode (nebula | alien | anomalies); spaceAmt
   (0..100) is the master intensity. Uses shared host helpers (makeIR,
   makeFieldIR, makeWind) and the generic stopNodes/liveUpdate hooks.

     nebula     — vast, lush, weightless: huge dark reverb + shimmer + sub bloom,
                  everything slowly drifting.
     alien      — exotic, organic-strange: burbling formant resonators, a metallic
                  comb, an alien-wind bed, light reverb.
     anomalies  — unstable spacetime: ring modulation, a warbling filter driven by
                  several detuned LFOs, a glitch feedback delay, irregular gating.
   ===================================================================== */

// Intensity as an equal-power dry/wet crossfade: amt 0 = clean source, 100 = full
// effect, with roughly constant perceived level (so it's a mix, not a volume knob).
function spaceMix(amt){
  const m=Math.max(0,Math.min(1,amt/100));
  return [Math.cos(m*Math.PI/2), Math.sin(m*Math.PI/2)*1.3];   // [dry, wet]
}
// gentle tanh soft-clip so reverb/feedback can't spit nasty peaks
function spaceSoftCurve(){
  // ceiling 0.95; with oversample='none' the output can't exceed the curve max, so
  // the final stays < 1 (no hard clipping) even when slammed at max settings.
  const n=1024, c=new Float32Array(n);
  for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; c[i]=Math.tanh(x*1.6)/Math.tanh(1.6)*0.95; }
  return c;
}
// LFO: osc(freq) -> gain(depth) -> target AudioParam (caller sets the param base).
// returns the oscillator so the caller can register it for teardown.
function spaceLFO(c, freq, depth, target, type){
  const o=c.createOscillator(); o.type=type||'sine'; o.frequency.value=freq;
  const g=c.createGain(); g.gain.value=depth;
  o.connect(g); if(target) g.connect(target);
  o.start();
  return o;
}

/* ---------- Nebula particle cloud (shared by audio + visual) ----------
   One cloud of particles drives BOTH the reverb (each particle = a delay tap in
   a feedback network) and the on-screen dots (drawn by gui.js). Density sets the
   particle count; Movement sets how fast they drift — and that drift continuously
   re-scatters each tap's delay time + pan, which is the diffusion you hear/see.
   Particle field: x in [-1,1] (stereo / screen-x), y in [0,1] (depth: 0 near .. 1 far). */
let nebP=[];
function nebCount(){ return Math.round(10 + (nebDensity/100)*34); }   // 10..44 taps
function nebParticle(){
  return { x:Math.random()*2-1, y:Math.random(),
           vx:Math.random()*2-1, vy:Math.random()*2-1, ph:Math.random()*6.283 };
}
function nebSeed(){ nebP=[]; const n=nebCount(); for(let i=0;i<n;i++) nebP.push(nebParticle()); }
function nebEnsure(){ if(nebP.length!==nebCount()) nebSeed(); }   // re-seed only when count changes
function nebStep(dt){
  const mv=nebMovement/100;
  for(const p of nebP){
    p.ph += dt*(0.25+mv*1.6);
    p.x += (Math.sin(p.ph)*0.0016 + p.vx*0.0026*mv);
    p.y += (Math.cos(p.ph*0.7)*0.0012 + p.vy*0.0020*mv);
    if(p.x<-1) p.x+=2; else if(p.x>1) p.x-=2;          // wrap stereo field
    if(p.y<0)  p.y+=1; else if(p.y>1)  p.y-=1;          // wrap depth
  }
}
// map one particle -> its tap params (delay from depth, pan from x, damping from depth)
function nebApplyTap(tap, p, when, schedule){
  const delay = 0.02 + p.y*0.26;                 // 20..280 ms
  const cut   = 1500 + (1-p.y)*7000;             // near = bright, far = dark
  const pan   = Math.max(-1, Math.min(1, p.x));
  if(schedule){
    tap.dl.delayTime.setValueAtTime(delay, when);
    tap.pan.pan.setValueAtTime(pan, when);
    tap.damp.frequency.setValueAtTime(cut, when);
  }else{
    const r=when+0.07;
    tap.dl.delayTime.linearRampToValueAtTime(delay, r);
    tap.pan.pan.linearRampToValueAtTime(pan, r);
    tap.damp.frequency.linearRampToValueAtTime(cut, r);
  }
}

function buildNebula(c, input, fx, stop){
  const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=110; hp.Q.value=0.5;
  input.connect(hp);
  nebEnsure();
  const n=nebP.length;
  const tapIn=c.createGain();              // reverb input (source + feedback)
  hp.connect(tapIn);
  const wetSum=c.createGain(); wetSum.gain.value=1;
  const tapG=0.7/n;                        // uniform -> stable feedback network
  const nebTaps=[];
  for(let i=0;i<n;i++){
    const dl=c.createDelay(0.6);
    const damp=c.createBiquadFilter(); damp.type='lowpass'; damp.Q.value=0.5;
    const pan=c.createStereoPanner();
    const g=c.createGain(); g.gain.value=tapG;
    tapIn.connect(dl); dl.connect(damp); damp.connect(pan); pan.connect(g); g.connect(wetSum);
    const tap={dl,damp,pan,g}, p0=nebP[i];
    tap.dl.delayTime.value   = 0.02 + p0.y*0.26;          // initial positions (base values)
    tap.pan.pan.value        = Math.max(-1, Math.min(1, p0.x));
    tap.damp.frequency.value = 1500 + (1-p0.y)*7000;
    nebTaps.push(tap);
  }
  // feedback (lowpass-damped) gives the cloud its sustaining tail
  const fbDamp=c.createBiquadFilter(); fbDamp.type='lowpass'; fbDamp.frequency.value=4500;
  const fb=c.createGain(); fb.gain.value=0.66;
  wetSum.connect(fbDamp); fbDamp.connect(fb); fb.connect(tapIn);
  wetSum.connect(fx);
  // deep, weightless sub bloom straight off the source
  const slp=c.createBiquadFilter(); slp.type='lowpass'; slp.frequency.value=120; slp.Q.value=0.7;
  const sg=c.createGain(); sg.gain.value=0.4;
  input.connect(slp); slp.connect(sg); sg.connect(fx);

  // particle convolver — shatters the source into a grain cloud so the
  // "sound particle" texture reads clearly on top of the spatial FDN. Grain
  // count + level track Density.
  const pconv=c.createConvolver(); pconv.buffer=makeParticleIR(c, 2.2, nebDensity/100);
  const pcg=c.createGain(); pcg.gain.value=0.28 + (nebDensity/100)*0.22;
  hp.connect(pconv); pconv.connect(pcg); pcg.connect(fx);

  // OFFLINE render: bake the particle drift across the timeline (no rAF available)
  const offline = (typeof OfflineAudioContext!=='undefined' && c instanceof OfflineAudioContext);
  if(offline){
    const dur=c.length/c.sampleRate, dt=0.05;
    for(let t=0;t<dur;t+=dt){ nebStep(dt*1.0); for(let i=0;i<n;i++) nebApplyTap(nebTaps[i], nebP[i], t, true); }
  }
  return { nebTaps };
}

/* ---------- Alien Planet: a randomly generated ATMOSPHERE ----------
   Each "planet" is a random gas mix (each gas = a resonant band that burbles) plus
   density (absorption/darkness), pressure (comb pitch + reverb size), turbulence
   (wind bed + sweep) and tint (colour/brightness). buildAlien derives the whole
   graph from it; the gui shows the composition and can re-roll a new planet. */
let alienAtmo=null;
function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
function genAtmosphere(){
  const n=3+Math.floor(Math.random()*3);   // 3..5 gases
  const gases=[];
  for(let i=0;i<n;i++) gases.push({
    freq: 110*Math.pow(2, Math.random()*6),          // ~110 Hz .. 7 kHz (log)
    q: 3+Math.random()*13,
    gain: 0.3+Math.random()*0.7,
    rate: 0.03+Math.random()*0.5,                    // burble speed
    depth: Math.random()*Math.random()               // freq wander (biased low)
  });
  gases.sort((a,b)=>a.freq-b.freq);
  const A={ gases, density:Math.random(), pressure:Math.random(),
            turbulence:Math.random()*0.85, tint:Math.random() };
  const dens=A.density>0.66?'dense':A.density<0.33?'thin':'mild';
  const pres=A.pressure>0.66?'high-pressure':A.pressure<0.33?'low-pressure':'temperate';
  const turb=A.turbulence>0.6?'turbulent':A.turbulence<0.25?'still':'breezy';
  A.name=pick(['Xeno','Kryo','Helio','Noct','Ferro','Auric','Cyto','Vanta','Umbra','Zeph'])+'-'+
         pick(['methane','argon haze','silicate fog','ammonia','plasma','ozone','sulfur mist','hydrogen','neon veil','carbon dust'])+
         ' · '+dens+' · '+pres+' · '+turb;
  return A;
}

function buildAlien(c, input, fx, stop){
  const A = alienAtmo || (alienAtmo=genAtmosphere());
  // the gas mix — a bank of resonant bands, each slowly wandering (burble)
  A.gases.forEach(gs=>{
    const bp=c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=gs.freq; bp.Q.value=gs.q;
    const g=c.createGain(); g.gain.value=gs.gain*0.5;
    input.connect(bp); bp.connect(g); g.connect(fx);
    if(gs.depth>0.03) stop.push(spaceLFO(c, gs.rate, gs.freq*gs.depth*0.5, bp.frequency));
  });
  // metallic comb — pitch set by atmospheric pressure, damped by density
  const cd=c.createDelay(0.06); cd.delayTime.value=0.005+A.pressure*0.03;
  const cfb=c.createGain(); cfb.gain.value=0.4+A.pressure*0.35;
  const clp=c.createBiquadFilter(); clp.type='lowpass'; clp.frequency.value=700+(1-A.density)*6500;
  input.connect(cd); cd.connect(cfb); cfb.connect(cd);
  const cg=c.createGain(); cg.gain.value=0.28;
  cd.connect(clp); clp.connect(cg); cg.connect(fx);
  // alien-wind bed — level = turbulence, colour = tint
  const wn=c.createBufferSource(); wn.buffer=makeWind(c, 4); wn.loop=true;
  const wbp=c.createBiquadFilter(); wbp.type='bandpass'; wbp.frequency.value=250+A.tint*2600; wbp.Q.value=0.8+A.turbulence*2;
  const wg=c.createGain(); wg.gain.value=A.turbulence*0.4;
  wn.connect(wbp); wbp.connect(wg); wg.connect(fx);
  stop.push(spaceLFO(c, 0.04+A.turbulence*0.25, 200+A.tint*500, wbp.frequency));
  wn.start(); stop.push(wn);
  // the space itself — reverb size from pressure, darkness from density, colour from tint
  const conv=c.createConvolver(); conv.buffer=makeFieldIR(c, 1.4+A.pressure*3.2, 1.8+A.density*1.6, 0.35+A.tint*0.45);
  const rg=c.createGain(); rg.gain.value=0.22+A.density*0.4;
  input.connect(conv); conv.connect(rg); rg.connect(fx);
}

/* ---------- Chamber: a confined 3D field of moving emitter particles (speakers);
   every CORNER is a receiver (microphone) = one delay tap. Corners are distributed in
   3D on a sphere (a polyhedron), particles drift + bounce inside the 3D ball. Each frame
   every mic's delay (nearest speaker, 3D distance) + level (local cluster) + pan (azimuth)
   wander, and a feedback net gives the confined tail. Corners = tap count (rebuild);
   Size = delay scale; Density = particle count; Movement = particle speed (all live). */
let chP=[], chCorners=[], chEdges=[], chFaces=[];
function chCount(){ return Math.round(6 + (chamberDensity/100)*44); }   // 6..50 particles
// convex-hull faces of the corners (they sit on a sphere => all are hull vertices).
// Outward-oriented (d>0, polyhedron centred at origin); interior points have n·p < d.
function chBuildFaces(){
  const V=chCorners, C=V.length; chFaces=[];
  for(let i=0;i<C;i++) for(let j=i+1;j<C;j++) for(let k=j+1;k<C;k++){
    const ax=V[j].x-V[i].x, ay=V[j].y-V[i].y, az=V[j].z-V[i].z;
    const bx=V[k].x-V[i].x, by=V[k].y-V[i].y, bz=V[k].z-V[i].z;
    let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    const nl=Math.sqrt(nx*nx+ny*ny+nz*nz); if(nl<1e-9) continue; nx/=nl; ny/=nl; nz/=nl;
    let d=nx*V[i].x+ny*V[i].y+nz*V[i].z;
    let pos=0, neg=0;                                        // must have all other corners on one side
    for(let m=0;m<C;m++){ if(m===i||m===j||m===k) continue;
      const t=nx*V[m].x+ny*V[m].y+nz*V[m].z-d;
      if(t>1e-6) pos++; else if(t<-1e-6) neg++;
      if(pos&&neg) break; }
    if(pos&&neg) continue;                                   // interior triangle, not a face
    if(d<0){ nx=-nx; ny=-ny; nz=-nz; d=-d; }                 // orient outward
    chFaces.push({a:i,b:j,c:k, nx,ny,nz,d});
  }
}
// exact Platonic solids for their vertex counts -> 4=tetra, 6=octa, 8=CUBE, 12=icosa,
// 20=dodeca (normalised to the unit sphere); null for other counts (Fibonacci fallback).
function chPlatonic(C){
  const P=(1+Math.sqrt(5))/2, q=1/P; let V=null;
  if(C===4)  V=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]];
  else if(C===6)  V=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  else if(C===8)  V=[[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]];
  else if(C===12) V=[[0,1,P],[0,1,-P],[0,-1,P],[0,-1,-P],[1,P,0],[1,-P,0],[-1,P,0],[-1,-P,0],[P,0,1],[P,0,-1],[-P,0,1],[-P,0,-1]];
  else if(C===20) V=[[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1],[0,q,P],[0,q,-P],[0,-q,P],[0,-q,-P],[q,P,0],[q,-P,0],[-q,P,0],[-q,-P,0],[P,0,q],[P,0,-q],[-P,0,q],[-P,0,-q]];
  if(!V) return null;
  return V.map(v=>{ const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return {x:v[0]/l,y:v[1]/l,z:v[2]/l}; });
}
function chBuildPoly(){
  const C=chamberCorners;
  chCorners = chPlatonic(C);
  if(!chCorners){ chCorners=[]; const ga=Math.PI*(3-Math.sqrt(5));   // Fibonacci fallback
    for(let i=0;i<C;i++){ const y=C>1?1-(i/(C-1))*2:0, r=Math.sqrt(Math.max(0,1-y*y)), th=ga*i;
      chCorners.push({x:Math.cos(th)*r, y, z:Math.sin(th)*r}); } }
  chBuildFaces();
  // wireframe = real polyhedron edges: drop edges whose incident faces are ALL coplanar
  // (triangulation diagonals of square/pentagon faces), so cube/dodeca draw cleanly.
  const emap={};
  for(let fi=0;fi<chFaces.length;fi++){ const f=chFaces[fi];
    [[f.a,f.b],[f.b,f.c],[f.c,f.a]].forEach(([i,j])=>{ const k=i<j?i+'_'+j:j+'_'+i; (emap[k]=emap[k]||[]).push(fi); }); }
  chEdges=[];
  for(const k in emap){ const fis=emap[k], n0=chFaces[fis[0]]; let distinct=false;
    for(let m=1;m<fis.length;m++){ const nm=chFaces[fis[m]];
      if(n0.nx*nm.nx+n0.ny*nm.ny+n0.nz*nm.nz<0.9999){ distinct=true; break; } }   // only exactly-coplanar (Platonic diagonals) merge
    if(distinct){ const p=k.split('_'); chEdges.push([+p[0],+p[1]]); } }
}
// project a point back inside the polyhedron (used at spawn + as a safety net)
function chClamp(p){ for(let it=0;it<3;it++) for(const f of chFaces){
  const s=f.nx*p.x+f.ny*p.y+f.nz*p.z-f.d; if(s>0){ p.x-=s*f.nx; p.y-=s*f.ny; p.z-=s*f.nz; } } }
function chParticle(){
  const u=Math.random()*2-1, th=Math.random()*6.283, r=Math.cbrt(Math.random())*0.8, s=Math.sqrt(1-u*u);
  const sp=0.4+Math.random()*0.9, a=Math.random()*6.283, b=Math.acos(2*Math.random()-1);
  const p={ x:r*s*Math.cos(th), y:r*u, z:r*s*Math.sin(th),
            vx:Math.sin(b)*Math.cos(a)*sp, vy:Math.cos(b)*sp, vz:Math.sin(b)*Math.sin(a)*sp };
  chClamp(p); return p;                                      // ensure it starts inside the object
}
function chSeed(){ chBuildPoly(); chP=[]; const n=chCount(); for(let i=0;i<n;i++) chP.push(chParticle()); }
function chEnsure(){
  if(chCorners.length!==chamberCorners) chBuildPoly();
  const n=chCount();
  if(chP.length<n){ while(chP.length<n) chP.push(chParticle()); }
  else if(chP.length>n) chP.length=n;
}
function chStep(dt){
  const sp=(0.12+chamberMove/100*0.9)*0.012;
  for(const p of chP){
    p.x+=p.vx*sp; p.y+=p.vy*sp; p.z+=p.vz*sp;
    for(const f of chFaces){                                 // reflect off any polyhedron face it crosses
      const s=f.nx*p.x+f.ny*p.y+f.nz*p.z-f.d;
      if(s>0){ const vn=p.vx*f.nx+p.vy*f.ny+p.vz*f.nz;
        if(vn>0){ p.vx-=2*vn*f.nx; p.vy-=2*vn*f.ny; p.vz-=2*vn*f.nz; }
        p.x-=s*f.nx; p.y-=s*f.ny; p.z-=s*f.nz; }
    }
  }
}
function chCornerParams(i){
  const cn=chCorners[i]; let dmin=9, near=0;
  for(const p of chP){ const dx=p.x-cn.x, dy=p.y-cn.y, dz=p.z-cn.z, d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    if(d<dmin) dmin=d; if(d<0.6) near++; }
  const sz=chamberSize/100;
  return { delay:Math.min(0.9, 0.004 + dmin*(0.06+sz*0.34)),   // farther speaker / bigger field = longer delay
           cut:1600 + Math.max(0,1-dmin)*6500,                 // near speaker = brighter
           pan:Math.max(-1,Math.min(1,cn.x)),                  // azimuth -> stereo
           gk:0.35 + Math.min(1, near/4)*0.65 };               // mic with a cluster = louder
}
// PHYSICS field for the worklet: one tap per speaker→mic path.
// delay = 3D distance × room-metres / speed-of-sound (samples); gain = 1/dist falloff × pan.
// (Particles are subsampled so total taps stay within a CPU-safe cap.)
// chamberReverse swaps the roles: normally particles are speakers + corners are mics; when
// reversed, corners emit and the particles are the microphones (pan follows the mic set).
let chamberReverse=false;
// mic activation: false = all mics summed at once; true = round-robin through blocks of
// `chMicGroup` mics (1..n-1). chMicSpeed (0..100) sets how fast groups switch; chMicSmooth
// (0..100) crossfades between the outgoing and incoming group instead of a hard cut.
let chMicRoundRobin=false, chMicGroup=1, chMicSpeed=70, chMicSmooth=30;
const CH_MAX_TAPS=700, CH_SOUND=343, CH_MIC_MINP=0.06, CH_MIC_MAXP=1.6;  // fastest/slowest group dwell (s)
// how many microphones are actually in play right now: corners normally, or the
// (subsample-capped) particle set when roles are reversed. Mirrors chFieldParams' mic set.
function chMicCount(){
  const corners=chCorners.length, np=chP.length;
  if(!chamberReverse) return corners;
  const step=Math.max(1, Math.ceil(np*corners/CH_MAX_TAPS));
  return Math.max(1, Math.ceil(np/step));
}
function chFieldParams(SR){
  const corners=chCorners, parts=chP;
  // subsample the particle set (corners are already bounded ≤50) to cap total taps
  const step=Math.max(1, Math.ceil(parts.length*corners.length/CH_MAX_TAPS));
  const usedParts=[]; for(let i=0;i<parts.length;i+=step) usedParts.push(parts[i]);
  const allMics = chamberReverse ? usedParts : corners;   // receivers: pan + summed
  const spks = chamberReverse ? corners  : usedParts;     // emitters
  // round-robin: a moving block of mics cycling over time; each active mic carries a weight w
  // so groups can crossfade (smoothness) instead of hard-switching.
  let micSet;
  if(chMicRoundRobin && allMics.length>1){
    const G=Math.max(1, Math.min(chMicGroup, allMics.length-1));
    const groups=Math.ceil(allMics.length/G);
    const P=CH_MIC_MINP + (1-chMicSpeed/100)*(CH_MIC_MAXP-CH_MIC_MINP);   // seconds per group
    const now=(typeof performance!=='undefined'?performance.now():Date.now())/1000;
    const phase=now/P, gi=Math.floor(phase), frac=phase-gi;
    const xf=Math.min(0.95, chMicSmooth/100*0.95);                       // crossfade fraction of the dwell
    const grp=g=>{ const s=(((g%groups)+groups)%groups)*G; return allMics.slice(s, s+G); };
    micSet=[];
    if(xf>0.001 && frac>1-xf){                                          // crossfade window near group's end
      const t=(frac-(1-xf))/xf;                                         // 0..1 outgoing->incoming
      const wo=Math.sqrt(1-t), wi=Math.sqrt(t);                         // equal-power: Σw² stays constant
      for(const m of grp(gi))   micSet.push({mic:m, w:wo});
      for(const m of grp(gi+1)) micSet.push({mic:m, w:wi});
    } else {
      for(const m of grp(gi)) micSet.push({mic:m, w:1});
    }
  } else {
    micSet = allMics.map(m=>({mic:m, w:1}));
  }
  const n=micSet.length*spks.length;
  const delay=new Float32Array(n), gainL=new Float32Array(n), gainR=new Float32Array(n);
  const roomM=1.5 + chamberSize/100*18;
  const effMics=micSet.reduce((a,x)=>a+x.w*x.w,0);         // Σw² (power) -> even level through fades
  const norm=1.4/Math.sqrt(Math.max(1, effMics*spks.length));
  let k=0;
  for(const {mic,w} of micSet){
    const pan=Math.max(-1,Math.min(1,mic.x)), ang=(pan+1)*Math.PI/4, pl=Math.cos(ang), pr=Math.sin(ang);
    for(const s of spks){
      const dx=s.x-mic.x, dy=s.y-mic.y, dz=s.z-mic.z, meters=Math.sqrt(dx*dx+dy*dy+dz*dz)*roomM;
      const g=norm/(1+meters*0.5)*w;
      delay[k]=meters/CH_SOUND*SR; gainL[k]=g*pl; gainR[k]=g*pr; k++;
    }
  }
  return {n, delay, gainL, gainR};
}
function chPostField(node, SR){
  const f=chFieldParams(SR);
  node.port.postMessage({type:'field', n:f.n, delay:f.delay, gainL:f.gainL, gainR:f.gainR},
                        [f.delay.buffer, f.gainL.buffer, f.gainR.buffer]);
}
function buildChamber(c, input, fx, stop){
  chEnsure();
  // preferred: the physics worklet (real speaker->mic paths, interference + Doppler)
  if(typeof AudioWorkletNode!=='undefined' && chamberWorkletCtxs.has(c)){
    let node=null;
    try{ node=new AudioWorkletNode(c,'chamber-physics',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}); }catch(e){ node=null; }
    if(node){ input.connect(node); node.connect(fx); chPostField(node, c.sampleRate);
      stop.push({stop:()=>{ try{ node.disconnect(); }catch(e){} }});   // teardown on stopPreview
      onChamberBuild(true);
      return { chNode:node }; }
  }
  onChamberBuild(false);   // worklet unavailable -> the simplified fallback below
  // ---- fallback (no worklet): per-mic delay tap using the nearest speaker + a feedback tail ----
  const C=chamberCorners, tapG=0.7/C;
  const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=90; input.connect(hp);
  const tapIn=c.createGain(); hp.connect(tapIn);
  const wetSum=c.createGain();
  const chTaps=[];
  for(let i=0;i<C;i++){
    const dl=c.createDelay(1.0), lp=c.createBiquadFilter(), pan=c.createStereoPanner(), g=c.createGain();
    lp.type='lowpass'; lp.Q.value=0.5;
    tapIn.connect(dl); dl.connect(lp); lp.connect(pan); pan.connect(g); g.connect(wetSum);
    const pr=chCornerParams(i);
    dl.delayTime.value=pr.delay; lp.frequency.value=pr.cut; pan.pan.value=pr.pan; g.gain.value=tapG*pr.gk;
    chTaps.push({dl,lp,pan,g,tapG});
  }
  const fbDamp=c.createBiquadFilter(); fbDamp.type='lowpass'; fbDamp.frequency.value=4200;
  const fb=c.createGain(); fb.gain.value=0.6;
  wetSum.connect(fbDamp); fbDamp.connect(fb); fb.connect(tapIn);
  const mk=c.createGain(); mk.gain.value=Math.sqrt(C)*0.45;
  wetSum.connect(mk); mk.connect(fx);
  const offline=(typeof OfflineAudioContext!=='undefined' && c instanceof OfflineAudioContext);
  if(offline){ const dur=c.length/c.sampleRate;
    for(let t=0;t<dur;t+=0.05){ chStep(0.05); for(let i=0;i<C;i++){ const pr=chCornerParams(i);
      chTaps[i].dl.delayTime.setValueAtTime(pr.delay,t); chTaps[i].pan.pan.setValueAtTime(pr.pan,t);
      chTaps[i].g.gain.setValueAtTime(tapG*pr.gk,t); } } }
  return { chTaps };
}

function buildAnomalies(c, input, fx, stop){
  const aFx=c.createGain(); aFx.gain.value=1.0;
  const rg=anomRing/100, gl=anomGlitch/100;

  // --- effect cores ---
  // ring modulation — bipolar carrier into a gain's amount => inharmonic sidebands
  const rm=c.createGain(); rm.gain.value=0.0;
  const carrier=c.createOscillator(); carrier.type='sine'; carrier.frequency.value=118;
  carrier.connect(rm.gain); carrier.start(); stop.push(carrier);
  // unstable bandpass — three detuned LFOs sum on the centre frequency (warble)
  const bp=c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=900; bp.Q.value=4;
  stop.push(spaceLFO(c, 0.7, 400, bp.frequency));
  stop.push(spaceLFO(c, 1.3, 250, bp.frequency));
  stop.push(spaceLFO(c, 2.9, 150, bp.frequency));
  // glitch feedback delay with a wobbling delay time (pitch warps)
  const dl=c.createDelay(0.5); dl.delayTime.value=0.13;
  const dfb=c.createGain(); dfb.gain.value=0.3+gl*0.5; dl.connect(dfb); dfb.connect(dl);
  stop.push(spaceLFO(c, 0.23, 0.03, dl.delayTime));

  // --- each effect as a dry+wet INSERT: passes signal at wet=0, so the inserts can
  // be chained in ANY order (the Routing control) without one muting the chain. ---
  function insert(coreIn, coreOut, wetVal){
    const sin=c.createGain(), sout=c.createGain(), wet=c.createGain();
    wet.gain.value=wetVal;
    sin.connect(sout);                            // dry through
    sin.connect(coreIn); coreOut.connect(wet); wet.connect(sout);   // + wet effect
    return {in:sin, out:sout, wet};
  }
  const ring   = insert(rm, rm, rg*0.9);          // X axis = ring/metal
  const filter = insert(bp, bp, rg*0.6);          //   (+ resonant bandpass)
  const glitch = insert(dl, dl, gl*0.8);          // Y axis = glitch/gate

  // --- routing by stage: effects sharing a stage run in PARALLEL; stages chain in
  // SERIES (each stage = its input + the wet of its effects). Stage 0 = off (bypassed). ---
  const sm={ring,filter,glitch};
  let prev=input;
  [1,2,3].forEach(s=>{
    const group=['ring','filter','glitch'].filter(n=>fxStage[n]===s);
    if(!group.length) return;
    const stageOut=c.createGain();
    prev.connect(stageOut);                               // dry through the stage
    group.forEach(n=>{ prev.connect(sm[n].in); sm[n].wet.connect(stageOut); });
    prev=stageOut;
  });
  prev.connect(aFx);

  // irregular gating/dropouts — TRANSPARENT at glitch 0 (base→1, no modulation),
  // deepening dropouts as the Glitch axis rises.
  const gate=c.createGain(); gate.gain.value=1-0.3*gl;
  const go1=c.createOscillator(); go1.frequency.value=0.31; const gg1=c.createGain(); gg1.gain.value=0.45*gl;
  go1.connect(gg1); gg1.connect(gate.gain); go1.start(); stop.push(go1);
  const go2=c.createOscillator(); go2.frequency.value=0.13; const gg2=c.createGain(); gg2.gain.value=0.28*gl;
  go2.connect(gg2); gg2.connect(gate.gain); go2.start(); stop.push(go2);
  aFx.connect(gate); gate.connect(fx);

  // ---- adjustable time-warp / stretch delays ----
  // Two feedback delay lines whose delay TIME is modulated -> pitch warps &
  // time-stretch smears. Driven by the modulator (smooth sines, or the chaos
  // pendulum when Chaos is on); depth = warpAmt. No node-LFOs here — the gui
  // loop / offline bake ramp delayTime so the source is fully driver-controlled.
  const warp1=c.createDelay(0.4); warp1.delayTime.value=0.09;
  const warp2=c.createDelay(0.4); warp2.delayTime.value=0.16;
  const wfb1=c.createGain(); wfb1.gain.value=0.5; warp1.connect(wfb1); wfb1.connect(warp1);
  const wfb2=c.createGain(); wfb2.gain.value=0.45; warp2.connect(wfb2); wfb2.connect(warp2);
  // warp output scales with the Warp amount, so warp 0 = NO warp delay (not a fixed echo)
  const ww=warpAmt/100;
  const wg1=c.createGain(); wg1.gain.value=ww*0.5; const wg2=c.createGain(); wg2.gain.value=ww*0.42;
  input.connect(warp1); warp1.connect(wg1); wg1.connect(aFx);
  input.connect(warp2); warp2.connect(wg2); wg2.connect(aFx);

  // ---- time reversal: backward grains pulled from a reversed copy of the source ----
  // Always built (when a file is loaded) so the Reverse amount is fully live; grains
  // overlay the last fraction of audio played backwards — rewind/stutter anomalies.
  let revBuf=null, revBus=null;
  if(audioBuf){
    revBuf=reverseBuffer(c, audioBuf);
    revBus=c.createGain(); revBus.gain.value=0.95; revBus.connect(fx);
  }else if(liveInput){
    // no file — record the live input and reverse recent slices on the fly
    revBus=c.createGain(); revBus.gain.value=0.95; revBus.connect(fx);
    startRevCapture(c, input, fx);
    stop.push({stop:stopRevCapture});
  }

  const anom={warp1,warp2,bp,carrier,wg1,wg2};
  const fxh={ring:ring.wet, filt:filter.wet, glitch:glitch.wet, dfb, gg1, gg2, gate};
  if(chaosOn) chaosReset();
  // OFFLINE render: bake the modulator (chaos or smooth) + the reverse grains
  const offline=(typeof OfflineAudioContext!=='undefined' && c instanceof OfflineAudioContext);
  if(offline){
    const dur=c.length/c.sampleRate, dt=0.03;
    for(let t=0;t<dur;t+=dt){ anomStep(dt); anomApply(anom, t, true); }
    if(revBuf && revAmt>0){
      const td=audioBuf.duration;
      let t=0.3+Math.random()*0.4;
      while(t<dur-0.1){ const gl=revGapLen(); spawnReverseGrain(c, revBuf, revBus, t, ((t%td)+td)%td, Math.min(gl[1],td), chaosOn?1.05:1); t+=gl[0]; }
    }
  }
  return { anom, fxh, revBuf, revBus };
}

/* ---------- chaos-pendulum modulator (Anomalies) ----------
   A double pendulum — deterministic but chaotic. Its two angles drive the
   time-warp delays (+ bandpass centre + ring carrier) in unpredictable ways.
   When Chaos is off, a bank of smooth sines drives them instead. */
let chaosState=null, chaosState2=null, anomPhase=0;
function newChaos(seed){ return {a1:Math.PI*0.5+0.6+(seed||0), a2:Math.PI*0.5+0.62+(seed||0), w1:0, w2:0}; }
function chaosReset(){ chaosState=newChaos(0); }     // pad 1 (warp × reversal)
function chaosReset2(){ chaosState2=newChaos(0.4); } // pad 2 (ring × glitch) — different start
// double-pendulum derivative (equal mass/length, g=9.8): [da1,da2,dw1,dw2]
function chaosDeriv(a1,a2,w1,w2){
  const g=9.8, d=a1-a2, cd=Math.cos(d), sd=Math.sin(d), den=2-Math.cos(2*d);
  const dw1=(-2*g*Math.sin(a1) - g*Math.sin(a1-2*a2) - 2*sd*(w2*w2 + w1*w1*cd))/den;
  const dw2=( 2*sd*(2*w1*w1 + 2*g*Math.cos(a1) + w2*w2*cd))/den;
  return [w1, w2, dw1, dw2];
}
function chaosStep(s, dt){
  if(!s) return;
  const sub=4, h=Math.min(0.005, dt/sub);
  let a1=s.a1, a2=s.a2, w1=s.w1, w2=s.w2;
  // RK4 — energy-conserving, so the pendulum keeps swinging chaotically forever
  // (NO damping; the old damping was bleeding it to a stop a few seconds in).
  for(let i=0;i<sub;i++){
    const k1=chaosDeriv(a1,a2,w1,w2);
    const k2=chaosDeriv(a1+k1[0]*h/2, a2+k1[1]*h/2, w1+k1[2]*h/2, w2+k1[3]*h/2);
    const k3=chaosDeriv(a1+k2[0]*h/2, a2+k2[1]*h/2, w1+k2[2]*h/2, w2+k2[3]*h/2);
    const k4=chaosDeriv(a1+k3[0]*h,   a2+k3[1]*h,   w1+k3[2]*h,   w2+k3[3]*h);
    a1+=h/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]);
    a2+=h/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]);
    w1+=h/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2]);
    w2+=h/6*(k1[3]+2*k2[3]+2*k3[3]+k4[3]);
  }
  // Hold total energy near a target: numerical integration of a chaotic system
  // drifts (decays or blows up). Rescaling the kinetic part each step pins the
  // energy, so the pendulum keeps swinging chaotically forever — never stops,
  // never runs away. keTarget stays >0 for all angles, so it can't freeze.
  const g=9.8, ETARGET=34, cd=Math.cos(a1-a2);
  const pe=-g*(2*Math.cos(a1)+Math.cos(a2));
  const ke=0.5*(2*w1*w1 + w2*w2 + 2*w1*w2*cd);
  const keT=ETARGET-pe;
  if(ke>0.05 && keT>0.5){ const sc=Math.sqrt(keT/ke); w1*=sc; w2*=sc; }
  w1=Math.max(-22,Math.min(22,w1)); w2=Math.max(-22,Math.min(22,w2));   // safety net
  s.a1=a1; s.a2=a2; s.w1=w1; s.w2=w2;
}
// ---- time-reversal grains: play slices of a reversed copy of the source ----
function reverseBuffer(c, buf){
  const r=c.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for(let ch=0;ch<buf.numberOfChannels;ch++){
    const src=buf.getChannelData(ch), dst=r.getChannelData(ch), n=buf.length;
    for(let i=0;i<n;i++) dst[i]=src[n-1-i];
  }
  return r;
}
// [gap, length] for the next grain, from revAmt (denser + longer as it rises)
function revGapLen(){ const a=revAmt/100; return [(1.2-a*0.95)*(0.55+Math.random()*0.8), 0.12+a*0.20+Math.random()*0.05]; }
// play `len` (original) seconds ending at posSec, backwards, faded, into revBus
function spawnReverseGrain(c, revBuf, revBus, when, posSec, len, rate){
  if(!revBuf||!revBus) return;
  rate=rate||1;
  const dur=revBuf.duration, offset=Math.max(0, Math.min(dur-0.001, dur-posSec));
  len=Math.min(len, dur-offset);
  if(len<0.02) return;
  const realLen=len/rate;
  const g=c.createBufferSource(); g.buffer=revBuf; g.playbackRate.value=rate;
  const env=c.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(0.95, when+0.012);
  env.gain.setValueAtTime(0.95, Math.max(when+0.013, when+realLen-0.03));
  env.gain.linearRampToValueAtTime(0, when+realLen);
  g.connect(env); env.connect(revBus);
  try{ g.start(when, offset, len); g.stop(when+realLen+0.02); }catch(e){}
  return g;
}

// ---- LIVE reverse: there's no file to pre-reverse, so we continuously record the
// incoming signal into a rolling ring and build a reversed slice on demand. This is
// what makes the Reverse effect work on direct/mic input (short bursts included). ----
let revRing=null, revRingW=0, revRingSR=48000, revRecNode=null;
function startRevCapture(c, input, fx){
  stopRevCapture();
  revLatchBuf=null;                                   // drop any burst held from a previous session
  revRingSR=c.sampleRate;
  revRing=new Float32Array(Math.ceil(4*revRingSR));   // last 4 s of live audio
  revRingW=0;
  if(!c.createScriptProcessor) return null;           // no capture path -> reverse just stays silent
  revRecNode=c.createScriptProcessor(2048,1,1);
  revRecNode.onaudioprocess=e=>{
    const inp=e.inputBuffer.getChannelData(0), R=revRing, N=R.length; let w=revRingW;
    for(let i=0;i<inp.length;i++){ R[w]=inp[i]; if(++w>=N) w=0; }
    revRingW=w;
    e.outputBuffer.getChannelData(0).fill(0);          // recorder itself stays silent
  };
  input.connect(revRecNode);
  const mute=c.createGain(); mute.gain.value=0; revRecNode.connect(mute); mute.connect(fx); // keep node alive
  return revRecNode;
}
function stopRevCapture(){
  if(revRecNode){ try{revRecNode.disconnect(); revRecNode.onaudioprocess=null;}catch(e){} revRecNode=null; }
  revRing=null; revRingW=0; revLatchBuf=null;
}
// build a reversed AudioBuffer of the most-recent `len` s of live audio (newest sample first).
// LATCH: when revLatch is on, an active burst is remembered; while the input is silent the
// held burst is replayed reversed instead of reversing silence.
let revLatch=false, revLatchBuf=null;                 // GUI flag + held reversed snapshot
const REV_SILENCE_TH=0.015;                           // peak below this counts as "silent"
function makeLiveRevBuf(c, len){
  if(!revRing) return null;
  const N=revRing.length, sr=revRingSR;
  const n=Math.min(N, Math.floor(Math.max(0,len)*sr));
  if(n<Math.floor(0.02*sr)) return null;              // too little captured yet
  const tmp=new Float32Array(n);
  let idx=revRingW-1, peak=0;                          // newest captured sample first
  for(let i=0;i<n;i++){ if(idx<0) idx+=N; const v=revRing[idx]; tmp[i]=v; const a=v<0?-v:v; if(a>peak)peak=a; idx--; }
  if(revLatch){
    if(peak>=REV_SILENCE_TH){ revLatchBuf=tmp; }       // fresh burst -> remember it
    else if(revLatchBuf){                              // silent -> replay the held burst reversed
      const m=Math.min(revLatchBuf.length, n);
      const out=c.createBuffer(1,m,sr); out.getChannelData(0).set(revLatchBuf.subarray(0,m)); return out;
    }
  }
  const out=c.createBuffer(1, n, sr); out.getChannelData(0).set(tmp);
  return out;
}
// spawn one backward grain from the live ring (no file needed)
function spawnLiveReverseGrain(c, revBus, when, len, rate){
  const buf=makeLiveRevBuf(c, len);
  if(!buf||!revBus) return;
  rate=rate||1;
  const realLen=buf.duration/rate;
  const g=c.createBufferSource(); g.buffer=buf; g.playbackRate.value=rate;
  const env=c.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(0.95, when+0.012);
  env.gain.setValueAtTime(0.95, Math.max(when+0.013, when+realLen-0.03));
  env.gain.linearRampToValueAtTime(0, when+realLen);
  g.connect(env); env.connect(revBus);
  try{ g.start(when); g.stop(when+realLen+0.02); }catch(e){}
  return g;
}
let revAccum=0, revGap=0.6;
function anomStep(dt){ if(chaosOn){ if(!chaosState) chaosReset(); chaosStep(chaosState, dt); } else anomPhase+=dt; }
function anomRead(){
  if(chaosOn){ const s1=Math.sin(chaosState.a1), s2=Math.sin(chaosState.a2);
               return {m1:s1, m2:s2, bp:(s1+s2)*0.5, car:s2}; }
  return { m1:Math.sin(anomPhase*1.7), m2:Math.sin(anomPhase*1.1+1),
           bp:Math.sin(anomPhase*0.6), car:Math.sin(anomPhase*0.9) };
}
function anomApply(anom, when, schedule){
  const w=warpAmt/100, m=anomRead();
  const d1=Math.max(0.005, Math.min(0.39, 0.09 + 0.07*w*m.m1));
  const d2=Math.max(0.005, Math.min(0.39, 0.16 + 0.10*w*m.m2));
  const bpf=Math.max(120, 900 + 650*w*m.bp);
  const car=Math.max(20, 118 + 90*w*m.car);
  if(schedule){
    anom.warp1.delayTime.setValueAtTime(d1, when);
    anom.warp2.delayTime.setValueAtTime(d2, when);
    anom.bp.frequency.setValueAtTime(bpf, when);
    anom.carrier.frequency.setValueAtTime(car, when);
  }else{
    const r=when+0.05;
    anom.warp1.delayTime.linearRampToValueAtTime(d1, r);
    anom.warp2.delayTime.linearRampToValueAtTime(d2, r);
    anom.bp.frequency.linearRampToValueAtTime(bpf, r);
    anom.carrier.frequency.linearRampToValueAtTime(car, r);
    // warp output rides the Warp amount -> warp 0 = silent (no fixed echo)
    if(anom.wg1) anom.wg1.gain.linearRampToValueAtTime(w*0.5, r);
    if(anom.wg2) anom.wg2.gain.linearRampToValueAtTime(w*0.42, r);
  }
}

ENGINES.space = {
  id: 'space',
  name: 'Space',
  tagline: 'Nebula · alien · anomalies',
  blurb: 'Drop in any audio and send it somewhere that was never a place. Four worlds — a drifting reverb Nebula, an alien planet’s shifting atmosphere, unstable time Anomalies, and a confined particle Chamber — each reshaping the sound with its own physics. No stage, no distance; just space.',
  color: '#4d8dff',          // blue — drives accent + ambient star scatter
  glow:  '#a9caff',
  implemented: true,

  // Space ignores distance; params are fixed (intensity is a dry/wet mix, live).
  paramsFor(d){ return { gain:1 }; },

  buildChain(c, p, withCrowd){
    const input=c.createGain();
    const out=c.createGain(); out.gain.value=spaceVol/100;   // master output, independent of intensity
    const dry=c.createGain();                                 // clean source (mixed against fx)
    const fx=c.createGain(); fx.gain.value=1.0;               // summed effect bus
    const amtGain=c.createGain();                             // wet level
    const shaper=c.createWaveShaper(); shaper.curve=spaceSoftCurve(); shaper.oversample='none';
    const sum=c.createGain();                                 // dry + wet summed pre-limiter
    const [dg,wg]=spaceMix(spaceAmt);                         // equal-power dry/wet
    dry.gain.value=dg; amtGain.gain.value=wg;
    input.connect(dry); dry.connect(sum);
    fx.connect(amtGain); amtGain.connect(sum);
    // soft-clip the FULL mix (not just wet) so dry+wet can't exceed unity, then
    // the master Output scales the limited signal -> final stays <=1 (no hard clip).
    sum.connect(shaper); shaper.connect(out);

    const stop=[]; let extra={};
    if(spaceMode==='alien')      buildAlien(c, input, fx, stop);
    else if(spaceMode==='anomalies') extra=buildAnomalies(c, input, fx, stop);
    else if(spaceMode==='chamber')   extra=buildChamber(c, input, fx, stop);
    else                          extra=buildNebula(c, input, fx, stop);

    return Object.assign({ input, out, amtGain, dry, stopNodes:stop }, extra);
  },

  // intensity = dry/wet mix (NOT a volume knob): crossfade clean source vs effect,
  // rides live so the slider stays smooth (no rebuild)
  liveUpdate(chain){
    if(!chain.amtGain) return;
    const t=ctx.currentTime, [dg,wg]=spaceMix(spaceAmt);
    chain.amtGain.gain.linearRampToValueAtTime(wg, t+0.08);
    if(chain.dry) chain.dry.gain.linearRampToValueAtTime(dg, t+0.08);
    if(chain.out) chain.out.gain.linearRampToValueAtTime(spaceVol/100, t+0.08);  // master volume
  },

  // live (preview) driver: push the current particle positions onto the reverb taps.
  // Called by the gui ambient loop so audio scatter == the on-screen cloud.
  driveNebula(chain){
    if(!chain || !chain.nebTaps) return;
    const t=ctx.currentTime, taps=chain.nebTaps;
    for(let i=0;i<taps.length && i<nebP.length;i++) nebApplyTap(taps[i], nebP[i], t, false);
  },

  // live (preview) driver for Anomalies: ramp the warp delays + bandpass + carrier
  // from the current modulator state (gui loop advances it via anomStep).
  driveAnomalies(chain){
    if(!chain || !chain.anom) return;
    anomApply(chain.anom, ctx.currentTime, false);
  },

  // live update of the Ring×Glitch XY pad (ring/filter wets + glitch fb/mix + gate depth)
  applyFx(chain){
    if(!chain || !chain.fxh) return;
    const r=ctx.currentTime+0.06, h=chain.fxh, rg=anomRing/100, gl=anomGlitch/100;
    h.ring.gain.linearRampToValueAtTime(rg*0.9, r);
    h.filt.gain.linearRampToValueAtTime(rg*0.6, r);
    h.glitch.gain.linearRampToValueAtTime(gl*0.8, r);
    h.dfb.gain.linearRampToValueAtTime(0.3+gl*0.5, r);
    h.gg1.gain.linearRampToValueAtTime(0.45*gl, r);
    h.gg2.gain.linearRampToValueAtTime(0.28*gl, r);
    h.gate.gain.linearRampToValueAtTime(1-0.3*gl, r);   // transparent at glitch 0
  },

  // live (preview) driver: recompute the physics field and send it to the worklet
  // (delays glide in the worklet -> Doppler). Fallback path ramps the native taps.
  driveChamber(chain){
    if(!chain) return;
    if(chain.chNode){ chPostField(chain.chNode, ctx.sampleRate); return; }
    if(!chain.chTaps) return;
    const r=ctx.currentTime+0.07;
    for(let i=0;i<chain.chTaps.length && i<chCorners.length;i++){
      const tp=chain.chTaps[i], pr=chCornerParams(i);
      tp.dl.delayTime.linearRampToValueAtTime(pr.delay, r);
      tp.lp.frequency.linearRampToValueAtTime(pr.cut, r);
      tp.pan.pan.linearRampToValueAtTime(pr.pan, r);
      tp.g.gain.linearRampToValueAtTime(tp.tapG*pr.gk, r);
    }
  },

  // live (preview) reverse-grain scheduler: overlays backward slices of the audio
  // tracking the playhead; pitch follows the chaos pendulum when Chaos is on.
  tickReverse(chain, dt){
    if(!chain || revAmt<=0) return;
    // LIVE input: pull backward grains from the rolling capture ring (no file playhead)
    if(liveInput){
      if(!chain.revBus || !revRing) return;
      revAccum+=dt; if(revAccum<revGap) return;
      revAccum=0; const gl=revGapLen(); revGap=gl[0];
      const rate = chaosOn ? (1 + Math.sin(chaosState.a2)*0.18) : (0.97+Math.random()*0.06);
      spawnLiveReverseGrain(ctx, chain.revBus, ctx.currentTime+0.02, gl[1], rate);
      return;
    }
    if(!chain.revBuf || !audioBuf) return;
    revAccum+=dt;
    if(revAccum<revGap) return;
    revAccum=0; const gl=revGapLen(); revGap=gl[0];
    const td=audioBuf.duration, pos=(((ctx.currentTime-previewStart)%td)+td)%td;
    const rate = chaosOn ? (1 + Math.sin(chaosState.a2)*0.18) : (0.97+Math.random()*0.06);
    spawnReverseGrain(ctx, chain.revBuf, chain.revBus, ctx.currentTime+0.02, pos, Math.min(gl[1],td), rate);
  },
};
