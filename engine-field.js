/* =====================================================================
   FIELD ENGINE — festival / open-air distance model.
   The original Festival Distance physics + Web Audio graph, registered as
   one of the three FxRxS engines. This is the layer mirrored by the JUCE
   VST PluginProcessor. Uses shared host helpers from audio-engine.js
   (generators makeIR/makeCrowd/..., TUNINGS, and the env/scene globals).
   ===================================================================== */

ENGINES.field = {
  id: 'field',
  name: 'Field',
  tagline: 'Open-air distance renderer',
  blurb: 'Drop in any audio and walk it away from the stage. Distance rolls off the highs, swells the low end, soaks the tail in open-air reverb, and folds the crowd into the gaps — the way sound actually carries across a festival ground at night.',
  color: '#ff5e3a',          // orange — drives accent + ambient particles
  glow:  '#ffd166',
  implemented: true,

/* ---------- distance -> acoustic params ----------
   Tuned, not linear. Returns the parameter set used both for
   live preview and offline render so they stay identical. */
  paramsFor(d){
  d = Math.max(1, d);
  const n = Math.min(1, Math.log10(d/2)/Math.log10(400)); // 0 at 2m, ~1 at 800m

  // ---- atmospheric absorption, modulated by weather ----
  // Base air absorption ~ f^2 (~5 dB/100m at 8kHz, dry, 20C). Humidity LOWERS
  // HF absorption (humid air absorbs less high end); cold air absorbs a touch
  // more. Pressure/altitude: thinner air (low hPa) absorbs slightly less but
  // also carries slightly less level.
  const humF   = 1 - (envHumidity-50)/100*0.6;   // 50%RH neutral; humid -> less absorption
  const tempF  = 1 + (20-envTemp)/100;           // colder -> a bit more absorption
  const absK   = (5/100) * humF * tempF;          // dB/m at 8kHz, weather-adjusted

  // clarity tilt: + opens highs / shallower filtering, - muffles ('underwater')
  const clar   = envClarity/100;                  // -1..1
  const lpScale = Math.pow(2, clar*1.4);          // up to ~2.6x cutoff when bright
  let lp = Math.min(20000, Math.max(180,
           8000 * Math.sqrt(8 / Math.max(1, absK*d)) * lpScale));

  // ---- ground / crowd effect: density drives notch depth + HF scatter ----
  const dens   = envDensity/100;                  // 0..1
  const gN     = Math.min(1, Math.max(0,(d-8)/200));
  const notchDepth = -(5 + 7*dens) * gN * (1 - clar*0.5); // denser crowd = deeper dip
  const scatter    = -(2 + 6*dens) * n;           // HF scatter grows with density+dist

  // ---- wind: downwind brightens & lifts, upwind = shadow zone (refraction) ----
  // windDir 0deg = blowing toward listener (downwind), 180 = away (upwind).
  const windComp = Math.cos(envWindDir*Math.PI/180);    // +1 downwind .. -1 upwind
  const windMag  = envWindSpeed;                        // m/s
  // level effect grows with distance (~0.8 dB per m/s per ~150m), capped near +/-20dB
  const windDb   = Math.max(-20, Math.min(8,
                   windComp * windMag * (d/150) * 0.8));
  // upwind also dulls highs (shadow zone loses HF); downwind opens them slightly
  const windLp   = windComp>=0 ? (1 + windComp*0.15*Math.min(1,windMag/10))
                               : (1 + windComp*0.4*Math.min(1,windMag/10)); // <1 upwind
  lp = Math.min(20000, Math.max(150, lp*windLp));

  // ---- gust/turbulence: time-varying wobble in level + cutoff ----
  // gustPhase advances in liveUpdate(); here we sample it for a smooth wander.
  const gust = envGust/100;
  const gustLvl = gust * 2.5 * Math.sin(gustPhase*1.3) * Math.min(1,windMag/4); // dB
  const gustLp  = 1 + gust*0.15*Math.sin(gustPhase*0.7);

  // ---- pressure / density of air ----
  const presF = envPressure/1013;                 // ~1 at sea level
  const presDb = (presF-1)*6;                      // thinner air slightly quieter

  // ---- HF shelf: residual air absorption + crowd scatter + wind, tilt-able ----
  const hsBase = -(absK*d)*1.2;
  const highshelf = Math.max(-30, (hsBase + scatter)*(1-clar*0.6) + (windComp>=0?windComp*windMag*0.2:0));

  // ---- geometric spreading (line->point) + PA + weather level terms ----
  const spreadDb = -(3 + 3*Math.min(1,Math.max(0,(d-120)/700))) * Math.log2(Math.max(d,4)/4);
  const gain = Math.pow(10, (spreadDb + windDb + gustLvl + presDb)/20)
             * Math.pow(10, (paLevel-100)/40);

  return {
    lowpass: lp*gustLp,
    highshelf,
    highshelfFreq: 3500,
    // bass only lifts once highs start being absorbed (negligible <~40m)
    bassGain: 7 * Math.pow(Math.max(0,(n-0.25)/0.75), 1.5),
    bassFreq: 90,
    groundFreq: 500 - 200*gN,
    groundGain: notchDepth,
    // direct field dominates near the source; reverb onsets late (quadratic).
    // ~3% wet at 10m instead of 31% — outdoors has no walls to fill in early.
    wet: Math.min(0.6, 0.02 + 0.6*Math.pow(n,2.2) + dens*0.05),
    gain,
    crowd: Math.min(0.45, 0.04 + 0.4*n + dens*0.12),
    predelay: Math.min(0.09, d/3430)
  };
  },

/* ---------- build processing graph on a given context ----------
   Works for both AudioContext (live) and OfflineAudioContext (render). */
  buildChain(c, p, withCrowd){
  const input=c.createGain();

  const lp=c.createBiquadFilter();
  lp.type='lowpass'; lp.frequency.value=p.lowpass; lp.Q.value=0.5;

  const lp2=c.createBiquadFilter();   // cascade -> 24 dB/oct, kills highs convincingly
  lp2.type='lowpass'; lp2.frequency.value=p.lowpass; lp2.Q.value=0.5;

  const hs=c.createBiquadFilter();    // pulls down any surviving air/presence
  hs.type='highshelf'; hs.frequency.value=p.highshelfFreq; hs.gain.value=p.highshelf;

  const bass=c.createBiquadFilter();
  bass.type='lowshelf'; bass.frequency.value=p.bassFreq; bass.gain.value=p.bassGain;

  // ground-effect dip: destructive interference grazing over the crowd (200-600Hz)
  const ground=c.createBiquadFilter();
  ground.type='peaking'; ground.frequency.value=p.groundFreq; ground.Q.value=1.2; ground.gain.value=p.groundGain;

  const pre=c.createDelay(0.2); pre.delayTime.value=p.predelay;

  const dry=c.createGain(); dry.gain.value=1-p.wet;
  const wet=c.createGain(); wet.gain.value=p.wet;

  // ---- diffuse field: the late, scattered energy. Character is switchable
  // via reverbMode (current | spectral | reflections | minimal). ----
  const nn=Math.min(1, Math.log10(Math.max(1,distanceM)/2)/Math.log10(400)); // 0 near..1 far
  const conv=c.createConvolver();
  let wetLP=null;        // optional dark-tail lowpass (spectral / minimal)
  let reflNodes=[];      // optional discrete distant reflections
  if(reverbMode==='spectral'){
    // longer, dark, low-dominant tail that decays faster at HF than LF
    conv.buffer=makeFieldIR(c, 1.2+nn*1.4, 3.2, 0.5);
    wetLP=c.createBiquadFilter(); wetLP.type='lowpass'; wetLP.Q.value=0.5;
    wetLP.frequency.value=wetCutoff(p.lowpass,'spectral');
  }else if(reverbMode==='minimal'){
    // short, dark wash — barely-there outdoor diffusion
    conv.buffer=makeIR(c, 1.0, 4.5);
    wetLP=c.createBiquadFilter(); wetLP.type='lowpass'; wetLP.Q.value=0.5;
    wetLP.frequency.value=wetCutoff(p.lowpass,'minimal');
  }else{
    // 'current' + 'reflections' share the original long, even open-air tail
    conv.buffer=makeIR(c, 2.2, 3.0);
  }
  if(reverbMode==='reflections'){
    // discrete slap-back off distant boundaries (other stages / treeline / hills);
    // they ride the wet gain so they grow with distance like the rest of the field.
    [{t:0.06+nn*0.05, g:0.32},{t:0.12+nn*0.10, g:0.22},{t:0.20+nn*0.14, g:0.13}].forEach(tp=>{
      const dl=c.createDelay(0.6); dl.delayTime.value=Math.min(0.59,tp.t);
      const g=c.createGain(); g.gain.value=tp.g;
      reflNodes.push({dl,g});
    });
  }

  const out=c.createGain(); out.gain.value=p.gain;

  // ---- speaker tuning: a cascade of EQ bands the PA is voiced with ----
  // ---- input 5-band EQ: the very first thing, before tuning/distance ----
  const eqNodes=[];
  let eqOut=input;
  for(let i=0;i<5;i++){
    const f=c.createBiquadFilter();
    f.type=EQ_TYPES[i]; f.frequency.value=EQ_FREQS[i];
    if(EQ_TYPES[i]==='peaking') f.Q.value=1.0;
    f.gain.value=eqGains[i];
    eqOut.connect(f); eqOut=f; eqNodes.push(f);
  }

  // This shapes the source BEFORE distance processing (it's what leaves the rig).
  const tune=TUNINGS[tuneId]||TUNINGS.flat;
  let tuneOut=eqOut;
  tune.bands.forEach(b=>{
    const f=c.createBiquadFilter();
    f.type=b.type; f.frequency.value=b.f; f.gain.value=b.g;
    if(b.Q) f.Q.value=b.Q;
    tuneOut.connect(f); tuneOut=f;
  });

  // ---- drum boost: kick punch + snare/attack, on the source so it travels ----
  // Two thirds of the boost goes to low punch, one third to attack crack.
  const kick=c.createBiquadFilter();
  kick.type='peaking'; kick.frequency.value=80; kick.Q.value=1.1; kick.gain.value=drumOn?drumBoost:0;
  const snare=c.createBiquadFilter();
  snare.type='peaking'; snare.frequency.value=3500; snare.Q.value=0.9; snare.gain.value=drumOn?drumBoost*0.5:0;
  tuneOut.connect(kick); kick.connect(snare); tuneOut=snare;

  // routing: input -> [tuning] -> [drum] -> bass -> ground -> lp -> lp2 -> hs -> [dry] + [wet send] -> out
  tuneOut.connect(bass); bass.connect(ground); ground.connect(lp); lp.connect(lp2); lp2.connect(hs);
  hs.connect(dry); dry.connect(out);
  // wet send: hs -> predelay -> convolver -> (optional dark-tail LP) -> wet -> out
  hs.connect(pre); pre.connect(conv);
  if(wetLP){ conv.connect(wetLP); wetLP.connect(wet); } else { conv.connect(wet); }
  wet.connect(out);
  // distant reflections (reflections mode): extra delayed taps into the wet bus
  reflNodes.forEach(r=>{ pre.connect(r.dl); r.dl.connect(r.g); r.g.connect(wet); });

  let crowdNode=null, crowdGainNode=null;
  // Constant bed plays only when no explicit regions are defined; once you set
  // start/end regions, the crowd is driven by those instead (see scheduleCrowdRegions).
  if(withCrowd && crowdOn && p.crowd>0.001 && crowdRegions.length===0){
    const cb=Math.pow(10, crowdBoostDb/20);  // crowd boost multiplier
    const bed = activeCrowd!=null ? crowdBeds.find(b=>b.id===activeCrowd) : null;
    const cs=c.createBufferSource();
    if(bed && bed.buffer){
      cs.buffer=bed.buffer;        // selected crowd recording
      cs.loop=true;
      const cg=c.createGain(); cg.gain.value=p.crowd*1.6*cb; // real crowd needs more headroom
      cs.connect(cg); cg.connect(out); crowdGainNode=cg;
    }else{
      cs.buffer=makeCrowd(c, Math.max(2, audioBuf.duration)); // synthetic fallback
      cs.loop=true;
      const cg=c.createGain(); cg.gain.value=p.crowd*cb;
      const clp=c.createBiquadFilter(); clp.type='lowpass'; clp.frequency.value=2000;
      cs.connect(clp); clp.connect(cg); cg.connect(out); crowdGainNode=cg;
    }
    crowdNode=cs;
  }

  // ---- weather beds: wind noise + rain (loop continuously, like the crowd) ----
  let windNode=null, windGain=null, rainNode=null, rainGain=null;
  if(withCrowd){
    const dur=Math.max(2, audioBuf?audioBuf.duration:4);
    // wind noise: scales with wind speed AND the wind-noise control. Brighter +
    // louder as it blows harder; gusts add movement (handled in liveUpdate).
    const windAmt=(envWindNoise/100) * (0.25 + envWindSpeed/20*0.9);
    if(windAmt>0.001){
      const wn=c.createBufferSource(); wn.buffer=makeWind(c,dur); wn.loop=true;
      const wlp=c.createBiquadFilter(); wlp.type='lowpass';
      wlp.frequency.value=300 + envWindSpeed*120;   // faster wind = more HF "rush"
      const wbp=c.createBiquadFilter(); wbp.type='bandpass';
      wbp.frequency.value=500 + envWindSpeed*80; wbp.Q.value=0.6; // whistle band
      const wg=c.createGain(); wg.gain.value=windAmt;
      wn.connect(wlp); wlp.connect(wbp); wbp.connect(wg); wg.connect(out);
      windNode=wn; windGain=wg;
    }
    // rain: dense bandpassed hiss, intensity = envRain. Heavier rain = louder,
    // a touch brighter. Goes through distance 'out' so far rain is duller.
    if(envRain>0.001){
      const rn=c.createBufferSource(); rn.buffer=makeRain(c,dur); rn.loop=true;
      const rhp=c.createBiquadFilter(); rhp.type='highpass'; rhp.frequency.value=800;
      const rlp=c.createBiquadFilter(); rlp.type='lowpass';
      rlp.frequency.value=3000 + (envRain/100)*5000;
      const rg=c.createGain(); rg.gain.value=(envRain/100)*0.5;
      rn.connect(rhp); rhp.connect(rlp); rlp.connect(rg); rg.connect(out);
      rainNode=rn; rainGain=rg;
    }
  }
  return {input,out,lp,lp2,hs,bass,ground,conv,wetLP,dry,wet,outGain:out,pre,crowdNode,crowdGainNode,kick,snare,eqNodes,windNode,windGain,rainNode,rainGain,baseCrowd:p.crowd};
  }
};
