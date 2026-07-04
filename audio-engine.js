/* =====================================================================
   Festival Distance — AUDIO ENGINE
   DOM-free. Owns the physics model, the Web Audio processing graph,
   the weather/cheer/crowd generators, live preview, and offline render.
   This is the layer mirrored by the JUCE VST (PluginProcessor.cpp).
   The GUI (gui.js) drives it: it sets `distanceM`, mutates the scene
   state (cheers/regions/beds/env vars), and assigns the UI hooks below.
   ===================================================================== */

// distance in metres — the GUI keeps this in sync with the distance slider.
let distanceM = 40;

// UI feedback hooks. No-ops here so the engine has zero DOM dependencies;
// gui.js overrides them to update the play/render buttons and visuals.
let onPreviewStart = () => {};
let onPreviewStop  = () => {};
let onRenderStart  = () => {};
let onRenderEnd    = () => {};
// Chamber build hook: fires with true when the physics AudioWorklet is used, false when the
// simplified fallback runs (GUI shows an indicator). No-op by default.
let onChamberBuild = () => {};

/* ---------- engine registry (FxRxS) ----------
   Each engine provides paramsFor(d) + buildChain(c,p,withCrowd). engine-field.js
   registers the real Field engine; engine-room.js / engine-space.js are stubs
   (implemented:false). The GUI's FxRxS wheel calls setEngine() to switch. */
const ENGINES = {};
let activeEngine = null;
let onEngineChange = () => {};   // GUI hook: refresh wheel + lock/unlock controls

function setEngine(id){
  if(!ENGINES[id] || (activeEngine && activeEngine.id===id)) return;
  if(playing) stopPreview();      // never leave audio running across a switch
  activeEngine = ENGINES[id];
  onEngineChange(activeEngine);
}

/* ---------- audio + scene state ---------- */
let audioBuf=null, audioRaw=null, ctx=null, srcNode=null, chain=null, playing=false, fileName='';
// live (direct) input: a mic / line-in stream processed in real time instead of a file
let liveInput=false, micStream=null, micSourceNode=null;
let onLiveInputChange = () => {};   // GUI hook: reflect live-input on/off state
let paLevel=100, tuneId='flat';
let drumBoost=0, crowdBoostDb=0;  // dB; drum = source kick/punch EQ, crowd = crowd-layer gain
let drumOn=true;                  // drum boost on/off
let reverbMode='current';         // diffuse-field character: current|spectral|reflections|minimal
let spaceMode='nebula';           // Space engine module: nebula|alien|anomalies
let spaceAmt=60;                  // Space effect intensity (dry/wet mix) 0..100
let spaceVol=90;                  // Space master output level 0..100 (independent of intensity)
let nebDensity=55;                // Nebula: particle count / packing 0..100
let nebMovement=45;               // Nebula: particle drift -> reverb scatter 0..100
let warpBase=50, revBase=30;      // Anomalies XY-pad position the user drags to (warp x, reversal y)
let warpAmt=50;                   // effective time-warp/stretch depth (= base, or chaos-modulated)
let revAmt=30;                    // effective time-reversal amount (= base, or chaos-modulated)
let chaosOn=false;                // Anomalies: chaos pendulum modulates the XY position
let anomRingBase=50, anomGlitchBase=45;  // Ring×Glitch pad base (user-dragged)
let anomRing=50, anomGlitch=45;   // effective ring/glitch (= base, or chaos-2 modulated)
let chaos2On=false;               // 2nd chaos pendulum modulating the Ring×Glitch pad
// Anomalies routing: each effect gets a STAGE (0=off, 1/2/3). Same stage = parallel,
// higher stage = later in the chain. So all-1 = parallel; 1/2/3 = series; e.g. ring&filter=1,
// glitch=2 = (ring‖filter)→glitch; glitch=1, ring&filter=2 = glitch→(ring‖filter).
let fxStage={ring:1, filter:1, glitch:1};
// Chamber (confined particle field): a polygon whose corners are audio receivers,
// fed by randomly-moving emitter particles inside it.
let chamberCorners=6;   // 4..50 polyhedron corners (= microphones)
let chamberSize=55;     // 0..100 -> room size in metres (delay = distance/speed-of-sound)
let chamberDensity=50;  // 0..100 -> number of emitter particles (speakers)
let chamberMove=45;     // 0..100 -> particle speed

/* ---------- Chamber physics AudioWorklet ----------
   A multi-tap fractional-delay summer: every speaker→mic path is one tap
   (delay = distance/speed-of-sound, gain = 1/distance × pan). Each mic sums all
   its speaker paths -> real wave addition/cancellation; delays glide toward their
   targets as speakers move -> real Doppler. Loaded via a Blob URL so it works from
   file:// (addModule can't fetch a file:// URL directly). */
const CHAMBER_WORKLET_CODE = `
class ChamberPhysics extends AudioWorkletProcessor {
  constructor(){ super();
    this.L=Math.ceil(sampleRate*0.7)+256; this.ring=new Float32Array(this.L); this.wp=0;
    this.n=0; this.dCur=new Float32Array(0); this.dTar=new Float32Array(0);
    this.gL=new Float32Array(0); this.gR=new Float32Array(0); this.glide=0.0008;
    this.port.onmessage=(e)=>{ const d=e.data; if(d.type==='field'){
      this.n=d.n; this.dTar=d.delay; this.gL=d.gainL; this.gR=d.gainR;
      if(this.dCur.length!==this.dTar.length) this.dCur=Float32Array.from(this.dTar); }; };
  }
  process(inputs,outputs){
    const inCh=inputs[0], out=outputs[0], outL=out[0], outR=out[1];
    const in0=inCh&&inCh[0], in1=inCh&&inCh[1], nb=outL.length;
    const ring=this.ring,L=this.L,n=this.n,dCur=this.dCur,dTar=this.dTar,gL=this.gL,gR=this.gR,glide=this.glide;
    for(let s=0;s<nb;s++){
      let x=in0?in0[s]:0; if(in1) x=(x+in1[s])*0.5;
      let wp=this.wp+1; if(wp>=L) wp=0; this.wp=wp; ring[wp]=x;
      let aL=0,aR=0;
      for(let k=0;k<n;k++){
        const dc=dCur[k]+(dTar[k]-dCur[k])*glide; dCur[k]=dc;
        let rp=wp-dc; if(rp<0) rp+=L;
        const i0=rp|0, fr=rp-i0; let i1=i0+1; if(i1>=L) i1=0;
        const v=ring[i0]+(ring[i1]-ring[i0])*fr;
        aL+=v*gL[k]; aR+=v*gR[k];
      }
      outL[s]=aL; if(outR) outR[s]=aR;
    }
    return true;
  }
}
registerProcessor('chamber-physics', ChamberPhysics);
`;
const chamberWorkletCtxs = new WeakSet();
async function ensureChamberWorklet(c){
  if(!c || !c.audioWorklet) return false;
  if(chamberWorkletCtxs.has(c)) return true;
  try{
    const url=URL.createObjectURL(new Blob([CHAMBER_WORKLET_CODE],{type:'application/javascript'}));
    await c.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    chamberWorkletCtxs.add(c); return true;
  }catch(e){ return false; }
}
let eqGains=[0,0,0,0,0];           // input 5-band EQ gains (dB)
// environmental / atmospheric controls (physically grounded)
let envClarity   = 0;     // -100..100 : air/clarity tilt (fixes 'underwater')
let envTemp      = 20;    // deg C
let envHumidity  = 50;    // % relative humidity
let envPressure  = 1013;  // hPa (sea level ~1013)
let envDensity   = 50;    // crowd density 0..100 %
let envWindSpeed = 0;     // m/s
let envWindDir   = 0;     // degrees: 0 = downwind (toward listener), 180 = upwind
let envGust      = 0;     // 0..100 % turbulence
let gustPhase    = 0;     // running phase for gust modulation
let gustTimer    = null;  // interval that animates gusts during preview
// weather sound beds
let envWindNoise = 0;     // 0..100 % wind noise level (also scales with wind speed)
let envRain      = 0;     // 0..100 % rain intensity
let envThunder   = 0;     // 0..100 % thunderstorm activity (0 = off)
let thunderTimer = null;  // schedules thunder claps
let inAnalyser=null, outAnalyser=null, visualRAF=null; // waveform + particle analysers
const EQ_FREQS=[80,250,1000,4000,10000];
const EQ_TYPES=['lowshelf','peaking','peaking','peaking','highshelf'];
let crowdBeds=[];     // {id, name, buffer}
let activeCrowd=null; // id of the active bed, or null for synthetic/none
let crowdOn=true;     // master crowd switch — off when track already has crowd
let crowdSeq=0;
let trackCues=[];     // parsed markers from the main track (embedded cues only)
let regionMarkers=[]; // start-of-track + cues + end-of-track, for region selectors
let cheers=[];        // {id, kind, name, time, gain, buffer}
let cheerSeq=0;
let uploadedClips=[]; // {key, name, buffer} reusable uploaded cheer clips
let crowdRegions=[];  // {id, bedId, start, end(null=track end), gain, label}
let regionSeq=0;
let previewStart=0;   // ctx.currentTime when preview began, for scheduling

/* ---------- WAV cue-point (marker) parser ----------
   Reads embedded markers from a RIFF/WAVE ArrayBuffer. Cue positions live in
   the 'cue ' chunk as sample offsets; optional labels live in a LIST/adtl
   chunk of 'labl' sub-chunks keyed by cue id. Returns [{time, label}] in
   seconds, or [] if the file isn't a WAV or has no cues. */
function parseWavCues(ab){
  const dv=new DataView(ab);
  if(dv.byteLength<12) return [];
  const tag=(o)=>String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));
  if(tag(0)!=='RIFF' || tag(8)!=='WAVE') return [];
  let rate=44100, cues=[], labels={};
  let p=12;
  while(p+8<=dv.byteLength){
    const id=tag(p), size=dv.getUint32(p+4,true), body=p+8;
    if(id==='fmt '){
      rate=dv.getUint32(body+4,true) || 44100;
    }else if(id==='cue '){
      const n=dv.getUint32(body,true);
      let q=body+4;
      for(let i=0;i<n && q+24<=dv.byteLength;i++){
        const cueId=dv.getUint32(q,true);
        const sampleOffset=dv.getUint32(q+20,true); // 'Sample Offset' field
        cues.push({cueId, sample:sampleOffset});
        q+=24;
      }
    }else if(id==='LIST'){
      const listType=tag(body);
      if(listType==='adtl'){
        let q=body+4;
        while(q+8<=body+size){
          const sid=tag(q), ssize=dv.getUint32(q+4,true), sbody=q+8;
          if(sid==='labl' || sid==='note'){
            const cueId=dv.getUint32(sbody,true);
            let str='';
            for(let k=sbody+4;k<sbody+ssize;k++){
              const ch=dv.getUint8(k); if(ch===0) break; str+=String.fromCharCode(ch);
            }
            if(str) labels[cueId]=str;
          }
          q+=8+ssize+(ssize&1); // chunks are word-aligned
        }
      }
    }
    p=body+size+(size&1);
  }
  return cues.map(c=>({
    time: c.sample/rate,
    label: labels[c.cueId] || ''
  })).sort((a,b)=>a.time-b.time);
}


const TUNINGS={
  flat:  {desc:'Even response — what a well-balanced festival system aims for.',
          bands:[]},
  dance: {desc:'Scooped mids, lifted sub and air — the classic club/dance curve. Big lows, crisp top, mids pulled back.',
          bands:[{type:'lowshelf',f:80,g:5},{type:'peaking',f:600,g:-5,Q:1},{type:'highshelf',f:9000,g:4}]},
  bass:  {desc:'Sub-heavy rig — extra weight below 100 Hz for a chest-hitting low end, top end eased off.',
          bands:[{type:'lowshelf',f:70,g:8},{type:'peaking',f:120,g:3,Q:1.2},{type:'highshelf',f:8000,g:-3}]},
  vocal: {desc:'Mid-forward voicing — presence lifted so vocals and leads cut through, lows kept tight.',
          bands:[{type:'peaking',f:2500,g:5,Q:0.9},{type:'peaking',f:300,g:-2,Q:1},{type:'lowshelf',f:80,g:-2}]}
};

/* ---------- built-in synthetic cheer generators ----------
   Each returns an AudioBuffer rendered on the given context. They're crude
   but read clearly once processed: roar = filtered noise swell, whoop =
   noise + voice-like formant peaks, applause = dense random claps, airhorn
   = stacked sawtooth tones. */
const CHEER_LABELS={roar:'Crowd roar',whoop:'Whoops & whistles',applause:'Applause burst',airhorn:'Air horn'};

function synthCheer(c, kind){
  const rate=c.sampleRate;
  const dur={roar:3.2,whoop:2.4,applause:3.0,airhorn:1.6}[kind]||2.5;
  const len=Math.floor(rate*dur);
  const buf=c.createBuffer(2,len,rate);
  for(let ch=0;ch<2;ch++){
    const d=buf.getChannelData(ch);
    if(kind==='roar'){
      let lp=0;
      for(let i=0;i<len;i++){
        const t=i/len;
        const env=Math.sin(Math.PI*Math.min(1,t*1.4))*Math.pow(1-t,0.4);
        lp=lp*0.96+(Math.random()*2-1)*0.04;          // low-passed noise = throaty roar
        d[i]=(lp*3 + (Math.random()*2-1)*0.15)*env;
      }
    }else if(kind==='whoop'){
      for(let i=0;i<len;i++){
        const t=i/len;
        const env=Math.pow(Math.sin(Math.PI*t),0.6);
        // a couple of swept whistle tones + breathy noise
        const f1=900+600*Math.sin(t*7+ch), f2=1500+800*Math.sin(t*5+1);
        const tone=Math.sin(2*Math.PI*f1*t*dur)*0.18+Math.sin(2*Math.PI*f2*t*dur)*0.12;
        d[i]=(tone+(Math.random()*2-1)*0.2)*env;
      }
    }else if(kind==='applause'){
      // dense randomized claps, each a fast noise transient
      for(let i=0;i<len;i++) d[i]=0;
      const claps=Math.floor(dur*180);
      for(let k=0;k<claps;k++){
        const pos=Math.floor(Math.random()*(len-400));
        const amp=0.3+Math.random()*0.5;
        const env=Math.sin(Math.PI*Math.min(1,(pos/len)*1.3))*Math.pow(1-pos/len,0.3);
        for(let j=0;j<200;j++){
          d[pos+j]+=(Math.random()*2-1)*amp*Math.pow(1-j/200,3)*env*0.5;
        }
      }
    }else if(kind==='airhorn'){
      const base=ch?233:220; // slight detune across channels
      for(let i=0;i<len;i++){
        const t=i/len;
        const env=t<0.05?t/0.05:Math.pow(1-(t-0.05)/0.95,0.5);
        let s=0;
        for(let h=1;h<=8;h++) s+=Math.sin(2*Math.PI*base*h*t*dur)/h; // sawtooth stack
        d[i]=s*0.18*env;
      }
    }
  }
  return buf;
}

/* ---------- impulse for convolution reverb ---------- */
function makeIR(ctx, seconds, decay){
  const rate=ctx.sampleRate, len=rate*seconds;
  const ir=ctx.createBuffer(2,len,rate);
  for(let c=0;c<2;c++){
    const ch=ir.getChannelData(c);
    for(let i=0;i<len;i++){
      ch[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);
    }
  }
  return ir;
}

/* Wet-bus lowpass target: the diffuse tail always sits below the direct cutoff
   (p.lowpass already folds in distance/humidity/wind); minimal is darker still,
   and a denser crowd scatters/darkens it further. Lets the tail TONE track the
   air live (ramped in liveUpdate) even though the IR itself is baked. */
function wetCutoff(lp, mode, dens){
  const k = mode==='minimal' ? 0.42 : 0.62;
  const d = (dens==null?envDensity:dens)/100;
  return Math.max(380, Math.min(7000, lp*k*(1-d*0.25)));
}

/* ---------- granular "sound particle" impulse (Nebula convolver) ----------
   Not a smooth tail — a *cloud of grains*: hundreds of short windowed bursts
   scattered through time, each at a random pitch. Convolving the source with it
   shatters the sound into a shimmering particle wash. `density` 0..1 scales the
   grain count, so it tracks the Nebula Density control. */
function makeParticleIR(ctx, secs, density){
  const rate=ctx.sampleRate, len=Math.floor(rate*secs);
  const ir=ctx.createBuffer(2,len,rate);
  const grains=Math.floor(50 + density*420);
  for(let ch=0;ch<2;ch++){
    const d=ir.getChannelData(ch);
    for(let k=0;k<grains;k++){
      const pos=Math.floor(Math.random()*(len-1));
      const dur=Math.floor(rate*(0.003+Math.random()*0.022));   // 3..25 ms grain
      const freq=180+Math.random()*4200;
      const tonal=Math.random()<0.7;                            // most grains pitched
      const amp=(0.25+Math.random()*0.75)*Math.pow(1-pos/len,1.4);
      for(let i=0;i<dur && pos+i<len;i++){
        const w=Math.sin(Math.PI*i/dur);                        // Hann-ish window
        const s=tonal ? Math.sin(2*Math.PI*freq*i/rate) : (Math.random()*2-1);
        d[pos+i]+=s*w*amp*0.14;
      }
    }
  }
  let peak=1e-6;
  for(let ch=0;ch<2;ch++){ const d=ir.getChannelData(ch); for(let i=0;i<d.length;i++) peak=Math.max(peak,Math.abs(d[i])); }
  const g=0.85/peak;
  for(let ch=0;ch<2;ch++){ const d=ir.getChannelData(ch); for(let i=0;i<d.length;i++) d[i]*=g; }
  return ir;
}

/* ---------- spectrally-shaped diffuse-field impulse ----------
   Models an OUTDOOR late field rather than a room tail: dark and low-dominant,
   with HF decaying faster than LF (air absorption + scattering). The one-pole
   cutoff falls as the tail ages (HF dies first); a slow second pole keeps a
   persistent low body. `bright` (0..1) sets the early-tail openness. */
function makeFieldIR(ctx, seconds, decay, bright){
  const rate=ctx.sampleRate, len=Math.floor(rate*seconds);
  const ir=ctx.createBuffer(2,len,rate);
  for(let c=0;c<2;c++){
    const ch=ir.getChannelData(c);
    let lp1=0, lp2=0;
    for(let i=0;i<len;i++){
      const t=i/len;
      const env=Math.pow(1-t, decay);
      const w=Math.random()*2-1;
      const a=Math.max(0.02, bright*(1-t)*(1-t));  // brighter early, darker late
      lp1 += a*(w-lp1);
      lp2 += 0.06*(lp1-lp2);                        // persistent low body
      ch[i]=(lp1*0.55 + lp2*1.9)*env;
    }
  }
  let peak=1e-6;
  for(let c=0;c<2;c++){ const ch=ir.getChannelData(c); for(let i=0;i<ch.length;i++) peak=Math.max(peak,Math.abs(ch[i])); }
  const g=0.9/peak;
  for(let c=0;c<2;c++){ const ch=ir.getChannelData(c); for(let i=0;i<ch.length;i++) ch[i]*=g; }
  return ir;
}

/* ---------- pink-ish noise buffer for crowd bed ---------- */
function makeCrowd(ctx, seconds){
  const rate=ctx.sampleRate, len=rate*seconds;
  const buf=ctx.createBuffer(1,len,rate);
  const ch=buf.getChannelData(0);
  let b0=0,b1=0,b2=0;
  for(let i=0;i<len;i++){
    const w=Math.random()*2-1;
    b0=0.99765*b0+w*0.0990460;
    b1=0.96300*b1+w*0.2965164;
    b2=0.57000*b2+w*1.0526913;
    ch[i]=(b0+b1+b2+w*0.1848)*0.05;
  }
  return buf;
}

/* ---------- weather sound beds ---------- */
// Wind: low brown-noise rumble + a slowly wandering band-passed "whistle".
function makeWind(ctx, seconds){
  const rate=ctx.sampleRate, len=Math.floor(rate*seconds);
  const buf=ctx.createBuffer(1,len,rate);
  const ch=buf.getChannelData(0);
  let last=0;
  for(let i=0;i<len;i++){
    const w=Math.random()*2-1;
    last=(last+0.02*w)/1.02;          // brown noise (integrated)
    ch[i]=last*3.5;
  }
  return buf;
}

// Rain: dense hiss (many drops) — white noise we'll bandpass; the patter comes
// from amplitude texture. Returns a seamless loopable buffer.
function makeRain(ctx, seconds){
  const rate=ctx.sampleRate, len=Math.floor(rate*seconds);
  const buf=ctx.createBuffer(1,len,rate);
  const ch=buf.getChannelData(0);
  for(let i=0;i<len;i++){
    // base hiss
    let s=(Math.random()*2-1)*0.5;
    // sparse brighter droplets give it a "patter" texture
    if(Math.random()<0.004) s+=(Math.random()*2-1)*0.9;
    ch[i]=s;
  }
  return buf;
}

// One thunder clap: a low rumble swell with an initial crack, decaying over ~secs.
// Realistic thunder. Real thunder isn't one burst: acoustic energy arrives from
// along the whole lightning channel, so it's a SEQUENCE of cracks and rolls over
// several seconds, dominated by heavily low-passed sub-bass with irregular,
// lumpy amplitude (the "rolling"). `intensity` 0..1 morphs distant->close:
//  distant = slow build, pure low rumble, no crack;
//  close   = sharp ripping crack up front, then a long rumble.
function makeThunderClap(ctx, secs, intensity){
  intensity = intensity==null ? 0.6 : Math.max(0,Math.min(1,intensity));
  const rate=ctx.sampleRate, len=Math.floor(rate*secs);
  const buf=ctx.createBuffer(1,len,rate);
  const ch=buf.getChannelData(0);

  // cascaded one-pole lowpasses -> steep rolloff for the deep rumble body
  let l1=0,l2=0,l3=0;
  // a few resonant sub tones give the rumble a "body" pitch that wanders
  const sub1=38+Math.random()*14, sub2=70+Math.random()*30;

  // build an irregular sequence of "arrival" bursts along the channel.
  // closer strikes get a strong early crack; all get scattered rumble peaks.
  const bursts=[];
  // initial crack (only prominent when close)
  bursts.push({t:0.0, amp:0.4+intensity*1.4, sharp:0.85*intensity+0.05});
  const nRolls=4+Math.floor(Math.random()*5);
  for(let k=0;k<nRolls;k++){
    bursts.push({
      t: 0.15 + Math.random()*secs*0.75,           // scattered through the roll
      amp: (0.3+Math.random()*0.9)*(0.6+intensity*0.6),
      sharp: 0.02+Math.random()*0.12               // rolls are soft, not sharp
    });
  }

  // slow overall swell+decay envelope; distant strikes build more gently
  const attack = 0.04 + (1-intensity)*0.5;          // seconds to peak

  for(let i=0;i<len;i++){
    const t=i/rate;
    // white source for this sample
    const w=Math.random()*2-1;

    // sum burst envelopes -> drives both crack content and rumble loudness
    let crack=0, drive=0;
    for(const b of bursts){
      const dt=t-b.t;
      if(dt<0) continue;
      const sharpEnv=Math.exp(-dt*(60-50*b.sharp)); // sharp bursts decay fast
      const bodyEnv=Math.exp(-dt*2.2);
      crack += w*sharpEnv*b.sharp*b.amp;
      drive += bodyEnv*b.amp;
    }

    // overall swell (gentle build for distant, immediate for close) * long decay
    const swell=Math.min(1, t/attack);
    const tail=Math.exp(-t*(0.7+0.5*(1-intensity)));
    const ampEnv=swell*tail;

    // heavily lowpassed rumble, amplitude shaped by the rolling burst drive
    const target=w*(0.7+drive);
    l1=l1*0.93+target*0.07;
    l2=l2*0.93+l1*0.07;
    l3=l3*0.90+l2*0.10;
    let rumble=l3*8.0;

    // wandering sub-bass body
    const body=(Math.sin(2*Math.PI*sub1*t)*0.6+Math.sin(2*Math.PI*sub2*t)*0.3)
               * (0.4+drive*0.5) * Math.exp(-t*1.2);

    // close strikes keep some mid "rip"; distant ones almost none
    const rip = crack * (0.3+0.7*intensity);

    ch[i]=(rumble*ampEnv + body*ampEnv + rip) * 0.5;
  }

  // normalise to avoid clipping while keeping dynamics
  let peak=1e-6; for(let i=0;i<len;i++) peak=Math.max(peak,Math.abs(ch[i]));
  const g=0.9/peak;
  for(let i=0;i<len;i++) ch[i]*=g;
  return buf;
}

/* ---------- schedule cheers into a chain on a given context ----------
   startAt = the context-time the track playhead is at t=0. Each cheer plays
   at startAt + its timestamp, fed into chain.input so it gets the full
   tuning + distance treatment. Built-in kinds are synthesized on the spot;
   uploaded clips use their decoded buffer. Returns the source nodes so the
   caller can start/stop them (online) — offline starts them itself. */
function scheduleCheers(c, chain, startAt){
  const nodes=[];
  cheers.forEach(ch=>{
    const b = ch.buffer || synthCheer(c, ch.kind);
    if(!b) return;
    const s=c.createBufferSource(); s.buffer=b;
    const g=c.createGain(); g.gain.value=ch.gain;
    s.connect(g); g.connect(chain.input);
    const when=startAt+ch.time;
    try{ s.start(when); }catch(e){ try{s.start();}catch(_){} }
    nodes.push(s);
  });
  return nodes;
}

/* ---------- schedule crowd regions into a chain ----------
   A region plays a crowd bed looping across [start, end) on the track
   timeline (end null = run to track end), fed through chain.input so it gets
   the full distance + rig treatment. Short fades avoid clicks at the edges.
   Uses the bed referenced by the region (or synthetic if missing). */
function scheduleCrowdRegions(c, chain, startAt){
  const nodes=[];
  if(!crowdOn) return nodes;   // crowd master off — skip all region playback
  const trackEnd = audioBuf ? audioBuf.duration : 0;
  const p = activeEngine.paramsFor(distanceM);
  crowdRegions.forEach(r=>{
    const start=Math.max(0, r.start);
    const end = (r.end==null ? trackEnd : r.end);
    if(end<=start) return;
    const bed = r.bedId!=null ? crowdBeds.find(b=>b.id===r.bedId) : null;
    const s=c.createBufferSource();
    if(bed && bed.buffer){ s.buffer=bed.buffer; }
    else { s.buffer=makeCrowd(c, Math.max(2, end-start)); }
    s.loop=true;
    const g=c.createGain();
    const level=p.crowd*1.6*r.gain*Math.pow(10,crowdBoostDb/20); // distance × region gain × crowd boost
    const t0=startAt+start, t1=startAt+end, fade=Math.min(0.05,(end-start)/4);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0+fade);
    g.gain.setValueAtTime(level, Math.max(t0+fade, t1-fade));
    g.gain.linearRampToValueAtTime(0, t1);
    s.connect(g); g.connect(chain.input);
    try{ s.start(t0); s.stop(t1); }catch(e){ try{s.start();}catch(_){} }
    nodes.push(s);
  });
  return nodes;
}

/* ---------- direct (live) audio input ----------
   Grabs a mic / line-in stream via getUserMedia and feeds it straight into the
   active engine's chain — no file needed. Processing DSP is disabled on the
   capture so the raw signal reaches our own graph untouched. */
async function enableLiveInput(){
  ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
  await ctx.resume();
  if(playing) stopPreview();
  try{
    micStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false },
      video:false
    });
  }catch(err){ liveInput=false; onLiveInputChange(false, err); return false; }
  micSourceNode = ctx.createMediaStreamSource(micStream);
  liveInput = true;
  onLiveInputChange(true, null);
  return true;
}
function disableLiveInput(){
  if(playing) stopPreview();
  if(micSourceNode){ try{micSourceNode.disconnect()}catch(e){} micSourceNode=null; }
  if(micStream){ micStream.getTracks().forEach(t=>{try{t.stop()}catch(e){}}); micStream=null; }
  liveInput=false;
  onLiveInputChange(false, null);
}

/* ---------- live preview ---------- */
let cheerNodes=[], regionNodes=[];
function startPreview(){
  if(!liveInput && !audioBuf) return;
  if(!activeEngine || !activeEngine.implemented) return;
  ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
  ctx.resume();
  if(liveInput){
    // direct input: the mic/line-in stream is the source (no buffer, no loop)
    srcNode=micSourceNode;
  }else{
    srcNode=ctx.createBufferSource();
    srcNode.buffer=audioBuf; srcNode.loop=true;
  }
  const p=activeEngine.paramsFor(distanceM);
  chain=activeEngine.buildChain(ctx,p,true);
  // analyser taps: input (pre-processing) and output (post-processing)
  inAnalyser=ctx.createAnalyser();  inAnalyser.fftSize=1024;
  outAnalyser=ctx.createAnalyser(); outAnalyser.fftSize=1024;
  srcNode.connect(inAnalyser);      // tap the dry source
  srcNode.connect(chain.input);
  chain.out.connect(outAnalyser);   // tap the processed output
  chain.out.connect(ctx.destination);
  previewStart=ctx.currentTime+0.06;
  if(!liveInput) srcNode.start(previewStart);   // stream sources have no start()
  if(chain.crowdNode) chain.crowdNode.start(previewStart);
  if(chain.windNode) chain.windNode.start(previewStart);
  if(chain.rainNode) chain.rainNode.start(previewStart);
  if(!liveInput){
    cheerNodes=scheduleCheers(ctx, chain, previewStart); // fire each at its timestamp (first pass)
    regionNodes=scheduleCrowdRegions(ctx, chain, previewStart); // crowd across start/end spans
  }
  playing=true; onPreviewStart();
  if(gustTimer) clearInterval(gustTimer);
  gustTimer=setInterval(()=>{ if(playing && (envGust>0 || envWindNoise>0)) liveUpdate(); }, 90);
  startThunder();
  srcNode.onended=()=>{};
}

// Thunder: fire claps at random intervals; rate + loudness scale with intensity.
function scheduleNextThunder(){
  if(!playing || envThunder<=0){ thunderTimer=null; return; }
  const intensity=envThunder/100;
  // higher intensity -> shorter gaps (3s..25s)
  const gap=(3 + (1-intensity)*22) * (0.5+Math.random());
  thunderTimer=setTimeout(()=>{
    if(playing && envThunder>0 && chain){
      fireThunder(intensity);
    }
    scheduleNextThunder();
  }, gap*1000);
}
function startThunder(){
  if(thunderTimer){ clearTimeout(thunderTimer); thunderTimer=null; }
  if(envThunder>0) scheduleNextThunder();
}
function fireThunder(intensity){
  try{
    const clap=ctx.createBufferSource();
    // closer storm = shorter, sharper; distant = longer, slow rolling
    const dur = 4 + (1-intensity)*5 + Math.random()*2;
    clap.buffer=makeThunderClap(ctx, dur, intensity);
    const g=ctx.createGain();
    g.gain.value=(0.4+intensity*0.8);
    // thunder rolls in from a distance: lowpass + reverb. Distant = darker + wetter.
    const lp=ctx.createBiquadFilter(); lp.type='lowpass';
    lp.frequency.value=350 + intensity*2200; // closer storm = brighter crack
    clap.connect(lp); lp.connect(g); g.connect(chain.out);
    if(chain.pre){ const ts=ctx.createGain(); ts.gain.value=0.3+(1-intensity)*0.4; lp.connect(ts); ts.connect(chain.pre); }
    clap.start();
  }catch(e){}
}

function stopPreview(){
  // a MediaStreamSource has no stop() and is reused — just disconnect it
  if(srcNode===micSourceNode){ if(srcNode){try{srcNode.disconnect()}catch(e){}} }
  else if(srcNode){try{srcNode.stop()}catch(e){}}
  if(chain&&chain.crowdNode){try{chain.crowdNode.stop()}catch(e){}}
  if(chain&&chain.windNode){try{chain.windNode.stop()}catch(e){}}
  if(chain&&chain.rainNode){try{chain.rainNode.stop()}catch(e){}}
  // engines may register extra sources/LFOs (e.g. Space) to tear down
  if(chain&&chain.stopNodes) chain.stopNodes.forEach(n=>{try{n.stop()}catch(e){}});
  if(thunderTimer){ clearTimeout(thunderTimer); thunderTimer=null; }
  cheerNodes.forEach(n=>{try{n.stop()}catch(e){}});
  regionNodes.forEach(n=>{try{n.stop()}catch(e){}});
  cheerNodes=[]; regionNodes=[];
  playing=false;
  if(gustTimer){ clearInterval(gustTimer); gustTimer=null; }
  onPreviewStop();
}

/* live param update without restarting */
function liveUpdate(){
  if(!playing||!chain) return;
  gustPhase += 0.08;  // advance turbulence wander
  // engines with a non-Field chain shape (e.g. Space) handle their own live params
  if(activeEngine && activeEngine.liveUpdate){ activeEngine.liveUpdate(chain); return; }
  const p=activeEngine.paramsFor(distanceM), t=ctx.currentTime, g=0.08;
  chain.lp.frequency.linearRampToValueAtTime(p.lowpass,t+g);
  chain.lp2.frequency.linearRampToValueAtTime(p.lowpass,t+g);
  chain.hs.gain.linearRampToValueAtTime(p.highshelf,t+g);
  chain.bass.gain.linearRampToValueAtTime(p.bassGain,t+g);
  chain.ground.frequency.linearRampToValueAtTime(p.groundFreq,t+g);
  chain.ground.gain.linearRampToValueAtTime(p.groundGain,t+g);
  if(chain.eqNodes) chain.eqNodes.forEach((f,i)=>f.gain.linearRampToValueAtTime(eqGains[i],t+g));
  chain.dry.gain.linearRampToValueAtTime(1-p.wet,t+g);
  chain.wet.gain.linearRampToValueAtTime(p.wet,t+g);
  chain.outGain.gain.linearRampToValueAtTime(p.gain,t+g);
  chain.pre.delayTime.linearRampToValueAtTime(p.predelay,t+g);
  // diffuse-tail tone tracks the air live (spectral/minimal modes only)
  if(chain.wetLP) chain.wetLP.frequency.linearRampToValueAtTime(wetCutoff(p.lowpass,reverbMode),t+g);
  // drum boost EQ (kick + half on snare)
  if(chain.kick) chain.kick.gain.linearRampToValueAtTime(drumOn?drumBoost:0,t+g);
  if(chain.snare) chain.snare.gain.linearRampToValueAtTime(drumOn?drumBoost*0.5:0,t+g);
  // crowd boost on the constant bed (regions are scheduled, so they pick it up on rebuild)
  if(chain.crowdGainNode){
    const bed = activeCrowd!=null ? crowdBeds.find(b=>b.id===activeCrowd) : null;
    const baseFactor = (bed && bed.buffer) ? 1.6 : 1;
    const lvl = p.crowd*baseFactor*Math.pow(10,crowdBoostDb/20);
    chain.crowdGainNode.gain.linearRampToValueAtTime(lvl,t+g);
  }
  // wind noise gusts: level wobbles with the same turbulence phase as the air
  if(chain.windGain){
    const baseWind=(envWindNoise/100)*(0.25+envWindSpeed/20*0.9);
    const gustMod=1 + (envGust/100)*0.8*Math.sin(gustPhase*1.1);
    chain.windGain.gain.linearRampToValueAtTime(Math.max(0,baseWind*gustMod),t+g);
  }
}

/* ---------- offline render to WAV ---------- */
async function render(){
  if(!activeEngine || !activeEngine.implemented) return;
  onRenderStart();
  const p=activeEngine.paramsFor(distanceM);
  const tail=2.5;
  // make sure a cheer near/after the end still fits (its time + ~4s clip + tail)
  let latest=audioBuf.duration;
  cheers.forEach(c=>{ latest=Math.max(latest, c.time+4); });
  crowdRegions.forEach(r=>{ latest=Math.max(latest, r.end==null?audioBuf.duration:r.end); });
  const totalSec=latest+tail;
  const frames=Math.ceil(totalSec*audioBuf.sampleRate);
  const oc=new OfflineAudioContext(2, frames, audioBuf.sampleRate);
  await ensureChamberWorklet(oc);   // so a Chamber render can use the physics worklet (static field)
  const src=oc.createBufferSource(); src.buffer=audioBuf;
  const ch=activeEngine.buildChain(oc,p,true);
  src.connect(ch.input); ch.out.connect(oc.destination);
  src.start(0);
  if(ch.crowdNode) ch.crowdNode.start(0);
  if(ch.windNode) ch.windNode.start(0);
  if(ch.rainNode) ch.rainNode.start(0);
  // offline thunder: pre-schedule claps across the render at the chosen rate
  if(envThunder>0){
    const intensity=envThunder/100;
    let tt=1+Math.random()*3;
    while(tt<totalSec-1){
      const dur=4+(1-intensity)*5+Math.random()*2;
      const clap=oc.createBufferSource();
      clap.buffer=makeThunderClap(oc, dur, intensity);
      const g=oc.createGain(); g.gain.value=0.4+intensity*0.8;
      const lp=oc.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=350+intensity*2200;
      clap.connect(lp); lp.connect(g); g.connect(ch.out);
      if(ch.pre){ const ts=oc.createGain(); ts.gain.value=0.3+(1-intensity)*0.4; lp.connect(ts); ts.connect(ch.pre); }
      clap.start(tt);
      tt += (3 + (1-intensity)*22) * (0.5+Math.random());
    }
  }
  scheduleCheers(oc, ch, 0);        // cheers at their timestamps
  scheduleCrowdRegions(oc, ch, 0);  // crowd across start/end spans
  const rendered=await oc.startRendering();
  const wav=encodeWAV(rendered);
  // hand the encoded WAV to the GUI, which owns the browser download.
  onRenderEnd(wav, fileName.replace(/\.[^.]+$/,'')+`_${distanceM}m.wav`);
}

function encodeWAV(buf){
  const nc=buf.numberOfChannels, len=buf.length, rate=buf.sampleRate;
  const ab=new ArrayBuffer(44+len*nc*2), v=new DataView(ab);
  const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF'); v.setUint32(4,36+len*nc*2,true); w(8,'WAVE'); w(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nc,true);
  v.setUint32(24,rate,true); v.setUint32(28,rate*nc*2,true);
  v.setUint16(32,nc*2,true); v.setUint16(34,16,true); w(36,'data');
  v.setUint32(40,len*nc*2,true);
  let off=44;
  const chans=[]; for(let c=0;c<nc;c++) chans.push(buf.getChannelData(c));
  for(let i=0;i<len;i++){
    for(let c=0;c<nc;c++){
      let s=Math.max(-1,Math.min(1,chans[c][i]));
      v.setInt16(off, s<0?s*0x8000:s*0x7FFF, true); off+=2;
    }
  }
  return ab;
}
