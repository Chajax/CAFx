/* =====================================================================
   Festival Distance — GUI
   DOM refs, visuals (particles + heatmap waveforms), input EQ sliders,
   atmosphere/weather binding, cheer/marker/region/bed lists, file
   handling, and all event wiring. Calls into audio-engine.js.
   ===================================================================== */

const $ = s => document.querySelector(s);
const els={
  drop:$('#drop'), file:$('#file'), loaded:$('#loaded'),
  liveInBtn:$('#liveInBtn'), liveInNote:$('#liveInNote'),
  controls:$('#controls'), dist:$('#dist'), distNum:$('#distNum'),
  zoneTag:$('#zoneTag'), play:$('#play'), render:$('#render'),
  note:$('#note'), listenerG:$('#listenerG'), waves:$('#waves'),
  dropCrowd:$('#dropCrowd'), fileCrowd:$('#fileCrowd'),
  bedList:$('#bedList'), crowdCap:$('#crowdCap'),
  crowdOn:$('#crowdOn'), crowdOnTxt:$('#crowdOnTxt'), crowdSection:$('#crowdSection'),
  pa:$('#pa'), paVal:$('#paVal'), tunes:$('#tunes'), tuneDesc:$('#tuneDesc'),
  dfields:$('#dfields'), dfieldDesc:$('#dfieldDesc'),
  spaceModes:$('#spaceModes'), spaceDesc:$('#spaceDesc'), spaceAmt:$('#spaceAmt'), spaceAmtVal:$('#spaceAmtVal'),
  alienCtl:$('#alienCtl'), atmoCanvas:$('#atmoCanvas'), atmoReadout:$('#atmoReadout'), genAtmoBtn:$('#genAtmoBtn'),
  chamberCtl:$('#chamberCtl'), chamberCanvas:$('#chamberCanvas'),
  chReverseBtn:$('#chReverseBtn'), chRolesLabel:$('#chRolesLabel'),
  chMicModeBtn:$('#chMicModeBtn'), chMicRRControls:$('#chMicRRControls'), chMicGroup:$('#chMicGroup'), chMicGroupVal:$('#chMicGroupVal'),
  chMicGroupMax:$('#chMicGroupMax'), chMicSpeed:$('#chMicSpeed'), chMicSpeedVal:$('#chMicSpeedVal'),
  chMicSmooth:$('#chMicSmooth'), chMicSmoothVal:$('#chMicSmoothVal'), chFallbackNote:$('#chFallbackNote'),
  chCorners:$('#chCorners'), chCornersVal:$('#chCornersVal'), chSize:$('#chSize'), chSizeVal:$('#chSizeVal'),
  chDensity:$('#chDensity'), chDensityVal:$('#chDensityVal'), chMove:$('#chMove'), chMoveVal:$('#chMoveVal'),
  spaceVol:$('#spaceVol'), spaceVolVal:$('#spaceVolVal'),
  nebulaCtl:$('#nebulaCtl'), nebDensity:$('#nebDensity'), nebDensityVal:$('#nebDensityVal'),
  nebMovement:$('#nebMovement'), nebMovementVal:$('#nebMovementVal'),
  anomCtl:$('#anomCtl'), xyPad:$('#xyPad'), warpAmtVal:$('#warpAmtVal'), revAmtVal:$('#revAmtVal'),
  xyPad2:$('#xyPad2'), anomRingVal:$('#anomRingVal'), anomGlitchVal:$('#anomGlitchVal'), fxRoute:$('.fx-route'),
  chaosBtn:$('#chaosBtn'), chaosCanvas:$('#chaosCanvas'), chaosBtn2:$('#chaosBtn2'), chaosCanvas2:$('#chaosCanvas2'),
  revLatchBtn:$('#revLatchBtn'),
  drum:$('#drum'), drumVal:$('#drumVal'), drumOn:$('#drumOn'), crowdBoost:$('#crowdBoost'), crowdBoostVal:$('#crowdBoostVal'),
  cheerKind:$('#cheerKind'), cheerTime:$('#cheerTime'), cheerAdd:$('#cheerAdd'),
  uploadedGroup:$('#uploadedGroup'),
  cheerFile:$('#cheerFile'), cheerList:$('#cheerList'), cheerEmpty:$('#cheerEmpty'),
  markersPanel:$('#markersPanel'), markerStrip:$('#markerStrip'), markerCount:$('#markerCount'),
  markerMode:$('#markerMode'), markerSound:$('#markerSound'), markerImport:$('#markerImport'),
  cheerImportRow:$('#cheerImportRow'), regionAddRow:$('#regionAddRow'),
  regStart:$('#regStart'), regEnd:$('#regEnd'), regionAdd:$('#regionAdd'), regionList:$('#regionList'),
  wxPlace:$('#wxPlace'), wxFetch:$('#wxFetch'), wxStatus:$('#wxStatus'),
  roomCanvas:$('#roomCanvas'), roomBakeNote:$('#roomBakeNote'), roomMats:$('#roomMats'), roomMatsCustom:$('#roomMatsCustom'),
  roomShape:$('#roomShape'), roomBoxDims:$('#roomBoxDims'), roomCustom:$('#roomCustom'), roomPresets:$('#roomPresets'), roomPlanCanvas:$('#roomPlanCanvas'),
  roomSpkList:$('#roomSpkList'), roomSpkCount:$('#roomSpkCount'),
  roomWSl:$('#roomWSl'), roomWVal:$('#roomWVal'), roomLSl:$('#roomLSl'), roomLVal:$('#roomLVal'), roomHSl:$('#roomHSl'), roomHVal:$('#roomHVal'),
  srcZ:$('#srcZ'), srcZVal:$('#srcZVal'), lisZ:$('#lisZ'), lisZVal:$('#lisZVal'), micLock:$('#micLock'),
  micAng:$('#micAng'), micAngVal:$('#micAngVal'), micSep:$('#micSep'), micSepVal:$('#micSepVal'),
  roomQual:$('#roomQual'), roomQualVal:$('#roomQualVal'), roomWetSl:$('#roomWetSl'), roomWetVal:$('#roomWetVal'), roomVolSl:$('#roomVolSl'), roomVolVal:$('#roomVolVal'),
  engineWheel:$('#engineWheel'), engineName:$('#engineName'), engineTag:$('#engineTag'),
  engineSoon:$('#engineSoon'), eyebrow:$('#eyebrow'), h1name:$('#h1name'), sub:$('.sub')
};

// ---- UI feedback hooks the engine calls (keeps audio-engine.js DOM-free) ----
onPreviewStart = () => { els.play.textContent='■ Stop'; startVisuals(); };
onPreviewStop  = () => { els.play.textContent='▶ Preview'; stopVisuals(); els.chFallbackNote.classList.add('hidden'); };
// Chamber build reports whether the physics worklet or the simplified fallback is running
onChamberBuild = (usingWorklet) => { els.chFallbackNote.classList.toggle('hidden', !!usingWorklet); };
onRenderStart  = () => { els.render.disabled=true; els.render.textContent='Rendering…'; };
onRenderEnd    = (wav, name) => {
  // trigger the browser download for the WAV the engine just produced
  const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));
  const a=document.createElement('a');
  a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
  els.render.textContent='Render & download'; els.render.disabled=false;
};

/* ---------- FxRxS circular engine selector (segmented wheel) ---------- */
// three 120° donut arcs; Field on top, Room lower-left, Space lower-right.
const ENGINE_ORDER = ['field','room','space'];
const ENGINE_ANGLE = { field:-90, room:150, space:30 };   // segment-centre, degrees
function arcSeg(cx,cy,rO,rI,aC){
  const a0=(aC-60)*Math.PI/180, a1=(aC+60)*Math.PI/180;
  const pt=(r,a)=>[(cx+r*Math.cos(a)).toFixed(2),(cy+r*Math.sin(a)).toFixed(2)];
  const [x0,y0]=pt(rO,a0),[x1,y1]=pt(rO,a1),[x2,y2]=pt(rI,a1),[x3,y3]=pt(rI,a0);
  return `M${x0} ${y0} A${rO} ${rO} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${rI} ${rI} 0 0 0 ${x3} ${y3} Z`;
}
// an open arc (no fill) at radius r, centred on cDeg, that the curved label
// rides along. Lower-half segments are swept the other way so text stays upright.
function labelArc(cx,cy,r,cDeg,half){
  const lower = Math.sin(cDeg*Math.PI/180) > 0.01;
  const a0d = lower ? cDeg+half : cDeg-half;
  const a1d = lower ? cDeg-half : cDeg+half;
  const sweep = lower ? 0 : 1;
  const P=d=>{const a=d*Math.PI/180; return [(cx+r*Math.cos(a)).toFixed(2),(cy+r*Math.sin(a)).toFixed(2)];};
  const [x0,y0]=P(a0d),[x1,y1]=P(a1d);
  return `M${x0} ${y0} A${r} ${r} 0 0 ${sweep} ${x1} ${y1}`;
}
function renderEngineWheel(){
  if(!els.engineWheel) return;
  const cx=100, cy=100, rO=92, rI=50, rL=(rO+rI)/2;
  let defs='', html='';
  ENGINE_ORDER.forEach(id=>{
    const e=ENGINES[id]; if(!e) return;
    const aC=ENGINE_ANGLE[id], active=activeEngine && activeEngine.id===id;
    const segCls='seg'+(active?' active':'')+(e.implemented?'':' stub');
    const lblCls='seg-label'+(active?' active':(e.implemented?'':' stub'));
    const lid='lbl-'+id;
    defs+=`<path id="${lid}" fill="none" d="${labelArc(cx,cy,rL,aC,34)}"></path>`;
    html+=`<path class="${segCls}" style="--c:${e.color}" data-engine="${id}" d="${arcSeg(cx,cy,rO,rI,aC)}"></path>`;
    html+=`<text class="${lblCls}" data-engine="${id}"><textPath href="#${lid}" startOffset="50%">${e.name}</textPath></text>`;
  });
  els.engineWheel.innerHTML=`<defs>${defs}</defs>${html}`;
}
els.engineWheel.addEventListener('click',e=>{
  const t=e.target.closest('[data-engine]'); if(!t) return;
  setEngine(t.dataset.engine);
});

// play/render are usable only with a loaded file AND a built engine
function updateTransport(){
  const built = !!activeEngine && activeEngine.implemented;
  els.play.disabled   = !((!!audioBuf || liveInput) && built);
  els.render.disabled = !(!!audioBuf && built);   // offline render still needs a file
}

// engine switch: repaint wheel, retitle, lock controls for unbuilt engines.
// (assignment, not declaration — onEngineChange is the host's hook variable)
onEngineChange = function(engine){
  // theme accent + ambient background follow the engine's colour
  document.documentElement.style.setProperty('--accent', engine.color);
  document.documentElement.style.setProperty('--accent-glow', engine.glow);
  setAmbient(engine);
  renderEngineWheel();
  els.h1name.textContent = engine.name;
  els.eyebrow.textContent = engine.tagline;
  if(els.sub && engine.blurb) els.sub.textContent = engine.blurb;   // per-engine intro (Field's was legacy for all)
  els.engineName.textContent = engine.name;
  els.engineTag.textContent = engine.tagline;
  els.engineSoon.classList.toggle('hidden', engine.implemented);
  els.controls.classList.toggle('engine-locked', !engine.implemented);
  els.controls.classList.toggle('mode-space', engine.id==='space');  // swap Field<->Space controls
  els.controls.classList.toggle('mode-room', engine.id==='room');    // swap in the Room ray-tracer panel
  els.crowdSection.style.display = (engine.id==='field') ? '' : 'none';  // crowd beds are Field-only
  if(engine.id==='space') syncSpaceModeUI();
  if(engine.id==='room') initRoomUI();
  updateTransport();
  document.title = engine.name + ' — FxRxS';
};

/* ---------- ambient engine background (always animating, behind the UI) ----------
   Field = drifting particles, Room = streaming lines. Space is per-module:
   Nebula = the reverb particle cloud, Alien = drifting organic orbs,
   Anomalies = an unstable glitch field. Tinted with the active engine's colour. */
let ambCanvas, ambCtx, ambMode='field', ambColor='#ff5e3a', ambGlow='#ffd166';
let ambParts=[], ambLines=[], ambStars=[], ambOrbs=[], ambGlitch=[], ambRAF=null, nebTick=0;
function hexRgb(h){ const n=parseInt(h.slice(1),16); return `${(n>>16)&255},${(n>>8)&255},${n&255}`; }
// Nebula cloud: the same particles that form the reverb taps, drawn as drifting dots.
// x -> screen x (stereo), y -> depth down the screen (near = big & bright).
function drawNebula(W,H){
  const rgb=hexRgb(ambColor), cx=W/2;
  for(const p of nebP){
    const sx=cx + p.x*(W*0.46), sy=H*0.12 + p.y*(H*0.76), near=1-p.y;
    const r=2+near*7, al=0.12+near*0.5;
    const g=ambCtx.createRadialGradient(sx,sy,0,sx,sy,r*2.6);
    g.addColorStop(0,`rgba(${rgb},${al.toFixed(3)})`); g.addColorStop(1,`rgba(${rgb},0)`);
    ambCtx.fillStyle=g; ambCtx.beginPath(); ambCtx.arc(sx,sy,r*2.6,0,6.283); ambCtx.fill();
  }
}
// a chaos pendulum drawn (centred) in a square panel canvas with a fading tip trail.
let chaosTrail=[], chaosTrail2=[];
function drawPendulum(cv, st, trail){
  if(!cv || !st) return;
  const w=cv.clientWidth||320, h=cv.clientHeight||w;   // square (aspect-ratio:1/1)
  if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  const cx=cv.getContext('2d'); if(!cx) return;
  cx.clearRect(0,0,w,h);
  const rgb=hexRgb(ambColor), L=h*0.22, ox=w*0.5, oy=h*0.5;   // pivot centred
  const x1=ox+L*Math.sin(st.a1), y1=oy+L*Math.cos(st.a1);
  const x2=x1+L*Math.sin(st.a2), y2=y1+L*Math.cos(st.a2);
  trail.push([x2,y2]); if(trail.length>140) trail.shift();
  cx.globalCompositeOperation='lighter';
  for(let i=1;i<trail.length;i++){
    const a=(i/trail.length)*0.6;
    cx.strokeStyle=`rgba(${rgb},${a.toFixed(3)})`; cx.lineWidth=1.5;
    cx.beginPath(); cx.moveTo(trail[i-1][0],trail[i-1][1]); cx.lineTo(trail[i][0],trail[i][1]); cx.stroke();
  }
  cx.strokeStyle=`rgba(${rgb},0.85)`; cx.lineWidth=2;
  cx.beginPath(); cx.moveTo(ox,oy); cx.lineTo(x1,y1); cx.lineTo(x2,y2); cx.stroke();
  [[ox,oy,3],[x1,y1,5],[x2,y2,7]].forEach(([x,y,r])=>{
    const g=cx.createRadialGradient(x,y,0,x,y,r*2);
    g.addColorStop(0,`rgba(${rgb},0.95)`); g.addColorStop(1,`rgba(${rgb},0)`);
    cx.fillStyle=g; cx.beginPath(); cx.arc(x,y,r*2,0,6.283); cx.fill();
  });
  cx.globalCompositeOperation='source-over';
}
function drawChaosInline(){  drawPendulum(els.chaosCanvas,  chaosState,  chaosTrail);  }
function drawChaosInline2(){ drawPendulum(els.chaosCanvas2, chaosState2, chaosTrail2); }
// how far (in %) the chaos pendulum can drag the XY point from its base
const CHAOS_XY=30;
// the Warp × Time-reversal pad: grid, the dragged base (ring), and the live point
// (filled dot) which the chaos pendulum pulls around when engaged.
function drawXYPad(){
  const cv=els.xyPad; if(!cv) return;
  const w=cv.clientWidth||300, h=cv.clientHeight||190;
  if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  const cx=cv.getContext('2d'); if(!cx) return;
  cx.clearRect(0,0,w,h);
  const rgb=hexRgb(ambColor);
  cx.strokeStyle='rgba(255,255,255,0.06)'; cx.lineWidth=1;
  for(let i=1;i<4;i++){ const gx=w*i/4, gy=h*i/4;
    cx.beginPath(); cx.moveTo(gx,0); cx.lineTo(gx,h); cx.stroke();
    cx.beginPath(); cx.moveTo(0,gy); cx.lineTo(w,gy); cx.stroke(); }
  cx.fillStyle='rgba(230,237,243,0.30)'; cx.font='10px "Spline Sans Mono",monospace';
  cx.fillText('WARP →', 8, h-7); cx.fillText('↑ REVERSAL', 8, 14);
  const toX=v=>v/100*w, toY=v=>h-(v/100*h);
  const bx=toX(warpBase), by=toY(revBase);     // base (where you dragged)
  cx.strokeStyle=`rgba(${rgb},0.5)`; cx.lineWidth=1.5;
  cx.beginPath(); cx.arc(bx,by,7,0,6.283); cx.stroke();
  const lx=toX(warpAmt), ly=toY(revAmt);        // live (chaos-modulated)
  if(chaosOn){ cx.strokeStyle=`rgba(${rgb},0.3)`; cx.beginPath(); cx.moveTo(bx,by); cx.lineTo(lx,ly); cx.stroke(); }
  cx.globalCompositeOperation='lighter';
  const g=cx.createRadialGradient(lx,ly,0,lx,ly,13);
  g.addColorStop(0,`rgba(${rgb},0.95)`); g.addColorStop(1,`rgba(${rgb},0)`);
  cx.fillStyle=g; cx.beginPath(); cx.arc(lx,ly,13,0,6.283); cx.fill();
  cx.fillStyle=`rgba(${rgb},1)`; cx.beginPath(); cx.arc(lx,ly,3.5,0,6.283); cx.fill();
  cx.globalCompositeOperation='source-over';
}
// the Ring × Glitch pad: base ring (dragged) + live dot (pulled by chaos pendulum 2)
function drawXYPad2(){
  const cv=els.xyPad2; if(!cv) return;
  const w=cv.clientWidth||300, h=cv.clientHeight||190;
  if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  const cx=cv.getContext('2d'); if(!cx) return;
  cx.clearRect(0,0,w,h);
  const rgb=hexRgb(ambColor);
  cx.strokeStyle='rgba(255,255,255,0.06)'; cx.lineWidth=1;
  for(let i=1;i<4;i++){ const gx=w*i/4, gy=h*i/4;
    cx.beginPath(); cx.moveTo(gx,0); cx.lineTo(gx,h); cx.stroke();
    cx.beginPath(); cx.moveTo(0,gy); cx.lineTo(w,gy); cx.stroke(); }
  cx.fillStyle='rgba(230,237,243,0.30)'; cx.font='10px "Spline Sans Mono",monospace';
  cx.fillText('RING →', 8, h-7); cx.fillText('↑ GLITCH', 8, 14);
  const toX=v=>v/100*w, toY=v=>h-(v/100*h);
  const bx=toX(anomRingBase), by=toY(anomGlitchBase);    // base (where you dragged)
  cx.strokeStyle=`rgba(${rgb},0.5)`; cx.lineWidth=1.5;
  cx.beginPath(); cx.arc(bx,by,7,0,6.283); cx.stroke();
  const lx=toX(anomRing), ly=toY(anomGlitch);            // live (chaos-2 modulated)
  if(chaos2On){ cx.strokeStyle=`rgba(${rgb},0.3)`; cx.beginPath(); cx.moveTo(bx,by); cx.lineTo(lx,ly); cx.stroke(); }
  cx.globalCompositeOperation='lighter';
  const g=cx.createRadialGradient(lx,ly,0,lx,ly,13);
  g.addColorStop(0,`rgba(${rgb},0.95)`); g.addColorStop(1,`rgba(${rgb},0)`);
  cx.fillStyle=g; cx.beginPath(); cx.arc(lx,ly,13,0,6.283); cx.fill();
  cx.fillStyle=`rgba(${rgb},1)`; cx.beginPath(); cx.arc(lx,ly,3.5,0,6.283); cx.fill();
  cx.globalCompositeOperation='source-over';
}
function ambResize(){
  ambCanvas=document.getElementById('ambient'); if(!ambCanvas) return;
  ambCanvas.width=window.innerWidth; ambCanvas.height=window.innerHeight;
  ambCtx=ambCanvas.getContext('2d');
  seedAmbient();
}
// scatter=true: born anywhere (initial full-screen fill); else born near centre
// and flung outward, so stars keep streaming out from the middle of the field.
function newStar(W,H,scatter){
  const cx=W/2, cy=H/2;
  const x = scatter ? Math.random()*W : cx+(Math.random()-0.5)*36;
  const y = scatter ? Math.random()*H : cy+(Math.random()-0.5)*36;
  const dx=x-cx, dy=y-cy, d=Math.hypot(dx,dy)||1, sp=0.18+Math.random()*1.15;
  return {x,y, vx:dx/d*sp, vy:dy/d*sp, r:0.4+Math.random()*1.6,
          life: scatter ? Math.random()*1.2 : 0};
}
function seedAmbient(){
  const W=ambCanvas?ambCanvas.width:1280, H=ambCanvas?ambCanvas.height:800;
  ambParts=[]; for(let i=0;i<72;i++) ambParts.push({
    x:Math.random()*W, y:Math.random()*H, vy:-(0.12+Math.random()*0.45),
    r:1+Math.random()*2.4, a:0.12+Math.random()*0.4, tw:Math.random()*6.28});
  ambLines=[]; for(let i=0;i<16;i++) ambLines.push({
    x:Math.random()*W, y:Math.random()*H, len:120+Math.random()*300,
    vx:0.35+Math.random()*1.3, a:0.05+Math.random()*0.13, slope:(Math.random()-0.5)*0.5});
  ambStars=[]; for(let i=0;i<190;i++) ambStars.push(newStar(W,H,true));
  // Alien: a few big drifting organic orbs that wobble + pulse
  ambOrbs=[]; for(let i=0;i<11;i++) ambOrbs.push({
    x:Math.random()*W, y:Math.random()*H, r:40+Math.random()*90,
    vx:(Math.random()-0.5)*0.3, vy:(Math.random()-0.5)*0.25, ph:Math.random()*6.28});
  // Anomalies: short horizontal "glitch" dashes that jitter + jump erratically
  ambGlitch=[]; for(let i=0;i<70;i++) ambGlitch.push({
    x:Math.random()*W, y:Math.random()*H, w:6+Math.random()*40, a:0.1+Math.random()*0.5});
}
function setAmbient(engine){ ambMode=engine.id; ambColor=engine.color; ambGlow=engine.glow||engine.color; }
function drawAmbParticles(W,H){
  const rgb=hexRgb(ambColor);
  for(const p of ambParts){
    p.tw+=0.012; p.y+=p.vy; p.x+=Math.sin(p.tw)*0.25;
    if(p.y<-6){ p.y=H+6; p.x=Math.random()*W; }
    const R=p.r*4, al=(p.a*(0.55+0.45*Math.sin(p.tw*1.7))).toFixed(3);
    const g=ambCtx.createRadialGradient(p.x,p.y,0,p.x,p.y,R);
    g.addColorStop(0,`rgba(${rgb},${al})`); g.addColorStop(1,`rgba(${rgb},0)`);
    ambCtx.fillStyle=g; ambCtx.beginPath(); ambCtx.arc(p.x,p.y,R,0,6.283); ambCtx.fill();
  }
}
function drawAmbLines(W,H){
  const rgb=hexRgb(ambColor); ambCtx.lineWidth=1.5;
  for(const l of ambLines){
    l.x+=l.vx; if(l.x-l.len>W){ l.x=-Math.random()*220; l.y=Math.random()*H; }
    const x2=l.x, y2=l.y, x1=l.x-l.len, y1=l.y+l.len*l.slope;
    const grad=ambCtx.createLinearGradient(x1,y1,x2,y2);
    grad.addColorStop(0,`rgba(${rgb},0)`);
    grad.addColorStop(0.5,`rgba(${rgb},${l.a.toFixed(3)})`);
    grad.addColorStop(1,`rgba(${rgb},0)`);
    ambCtx.strokeStyle=grad; ambCtx.beginPath(); ambCtx.moveTo(x1,y1); ambCtx.lineTo(x2,y2); ambCtx.stroke();
  }
}
function drawAmbStars(W,H){
  const rgb=hexRgb(ambColor);
  for(const s of ambStars){
    s.x+=s.vx; s.y+=s.vy; s.vx*=1.012; s.vy*=1.012; s.life+=0.006;
    if(s.x<-10||s.x>W+10||s.y<-10||s.y>H+10||s.life>1.5){ Object.assign(s,newStar(W,H,false)); }
    const al=Math.min(0.9, s.life)*0.95;
    ambCtx.fillStyle=`rgba(${rgb},${al.toFixed(3)})`;
    ambCtx.beginPath(); ambCtx.arc(s.x,s.y,s.r,0,6.283); ambCtx.fill();
  }
}
// Alien: slow, soft, wobbling orbs drifting like an exotic atmosphere / lifeforms
function drawAmbOrbs(W,H){
  const rgb=hexRgb(ambColor);
  for(const o of ambOrbs){
    o.ph+=0.008; o.x+=o.vx+Math.sin(o.ph)*0.35; o.y+=o.vy+Math.cos(o.ph*0.7)*0.28;
    if(o.x<-o.r) o.x+=W+2*o.r; else if(o.x>W+o.r) o.x-=W+2*o.r;
    if(o.y<-o.r) o.y+=H+2*o.r; else if(o.y>H+o.r) o.y-=H+2*o.r;
    const r=o.r*(0.82+0.18*Math.sin(o.ph*1.3));
    const g=ambCtx.createRadialGradient(o.x,o.y,0,o.x,o.y,r);
    g.addColorStop(0,`rgba(${rgb},0.10)`); g.addColorStop(0.6,`rgba(${rgb},0.05)`); g.addColorStop(1,`rgba(${rgb},0)`);
    ambCtx.fillStyle=g; ambCtx.beginPath(); ambCtx.arc(o.x,o.y,r,0,6.283); ambCtx.fill();
  }
}
// Anomalies: an unstable glitch field — dashes flicker, jitter, and jump; occasional streaks
function drawAmbGlitch(W,H){
  const rgb=hexRgb(ambColor);
  for(const g of ambGlitch){
    if(Math.random()<0.05){ g.x=Math.random()*W; g.y=Math.random()*H; g.w=6+Math.random()*40; }  // jump
    const jy=g.y+(Math.random()-0.5)*2, jx=g.x+(Math.random()-0.5)*3;
    ambCtx.fillStyle=`rgba(${rgb},${(g.a*(0.4+Math.random()*0.6)).toFixed(3)})`;
    ambCtx.fillRect(jx, jy, g.w, 1.5);
  }
  if(Math.random()<0.12){  // brief horizontal glitch streak
    const y=Math.random()*H;
    ambCtx.fillStyle=`rgba(${rgb},0.10)`; ambCtx.fillRect(0, y, W, 1+Math.random()*2);
  }
}
function ambientFrame(){
  if(!ambCtx){ ambResize(); }
  if(ambCtx){
    const W=ambCanvas.width, H=ambCanvas.height;
    ambCtx.clearRect(0,0,W,H);
    ambCtx.globalCompositeOperation='lighter';
    if(ambMode==='room'){ drawAmbLines(W,H); drawRoomInline(); drawRoomPlan(); }
    else if(ambMode==='space'){
      if(spaceMode==='nebula'){
        nebEnsure(); nebStep(1/60); drawNebula(W,H);
        // the visible cloud IS the reverb: push positions onto the taps (~30Hz)
        if(playing && activeEngine && activeEngine.driveNebula && ((nebTick++ & 1)===0)) activeEngine.driveNebula(chain);
      } else if(spaceMode==='anomalies'){
        drawAmbGlitch(W,H);                   // unstable glitch field
        anomStep(1/60);                       // advance pad-1 modulator (chaos or smooth)
        // pad-1 pendulum drags the Warp × Reversal point around its base
        if(chaosOn && chaosState){
          warpAmt=Math.max(0,Math.min(100, warpBase + Math.sin(chaosState.a1)*CHAOS_XY));
          revAmt =Math.max(0,Math.min(100, revBase  + Math.sin(chaosState.a2)*CHAOS_XY));
        } else { warpAmt=warpBase; revAmt=revBase; }
        // pad-2 pendulum drags the Ring × Glitch point around its base
        if(chaos2On){
          if(!chaosState2) chaosReset2(); chaosStep(chaosState2, 1/60);
          anomRing  =Math.max(0,Math.min(100, anomRingBase   + Math.sin(chaosState2.a1)*CHAOS_XY));
          anomGlitch=Math.max(0,Math.min(100, anomGlitchBase + Math.sin(chaosState2.a2)*CHAOS_XY));
          if(playing && activeEngine && activeEngine.applyFx && ((nebTick & 1)===0)) activeEngine.applyFx(chain);
        } else { anomRing=anomRingBase; anomGlitch=anomGlitchBase; }
        drawXYPad(); drawXYPad2();
        if(chaosOn)  drawChaosInline();       // pad-1 pendulum
        if(chaos2On) drawChaosInline2();      // pad-2 pendulum
        if(playing && activeEngine && activeEngine.driveAnomalies && ((nebTick++ & 1)===0)) activeEngine.driveAnomalies(chain);
        if(playing && activeEngine && activeEngine.tickReverse) activeEngine.tickReverse(chain, 1/60);  // backward grains
      } else if(spaceMode==='chamber'){
        drawAmbStars(W,H); chEnsure(); chStep(1/60); drawChamberInline();
        if(playing && activeEngine && activeEngine.driveChamber && ((nebTick++ & 1)===0)) activeEngine.driveChamber(chain);
      } else { drawAmbOrbs(W,H); drawAtmo(); }  // alien: drifting orbs + gas-resonance spectrum
    }
    else drawAmbParticles(W,H);
    ambCtx.globalCompositeOperation='source-over';
  }
  ambRAF=requestAnimationFrame(ambientFrame);
}
function startAmbient(){ ambResize(); if(!ambRAF) ambRAF=requestAnimationFrame(ambientFrame); }
window.addEventListener('resize', ambResize);

function zone(d){
  if(d<=5) return 'ON<br>THE RAIL';
  if(d<=30) return 'FRONT<br>OF HOUSE';
  if(d<=120) return 'MID<br>CROWD';
  if(d<=350) return 'BACK<br>FIELD';
  return 'CAR<br>PARK';
}

/* ---------- visuals: input-energy particles + vertical heatmap waveforms ---------- */
const particles=[];
let pcanvas, pctx, waveInCtx, waveOutCtx, waveInBuf, waveOutBuf;
let energyAvg=0, energyAvgO=0;

function resizeVisualCanvases(){
  pcanvas=document.getElementById('particles');
  if(pcanvas){
    pcanvas.width=window.innerWidth; pcanvas.height=window.innerHeight;
    pctx=pcanvas.getContext('2d');
  }
  ['waveIn','waveOut'].forEach(id=>{
    const c=document.getElementById(id); if(!c) return;
    const r=c.getBoundingClientRect();
    c.width=Math.max(40, r.width); c.height=Math.max(120, r.height);
  });
  const wi=document.getElementById('waveIn'), wo=document.getElementById('waveOut');
  if(wi) waveInCtx=wi.getContext('2d');
  if(wo) waveOutCtx=wo.getContext('2d');
}
window.addEventListener('resize',resizeVisualCanvases);

// amplitude -> heatmap colour: quiet = cool/dim, loud = hot (orange -> white)
function heat(amp){               // amp 0..1 — heatmap tinted with the active engine's colour
  const a=Math.min(1,amp);
  const c=hexRgb(ambColor).split(',').map(Number);        // accent as [r,g,b]
  if(a<0.5){                      // dim accent -> full accent (cool -> lit)
    const t=a/0.5, k=0.28+0.72*t;                          // brightness 0.28..1
    return `rgb(${Math.round(c[0]*k)},${Math.round(c[1]*k)},${Math.round(c[2]*k)})`;
  } else {                        // full accent -> hot glow/white
    const t=(a-0.5)/0.5, w=hexRgb(ambGlow).split(',').map(Number);
    // accent -> glow at t=0.6, then push to white at the top
    const gt=Math.min(1,t/0.6), wt=Math.max(0,(t-0.6)/0.4);
    const r=(c[0]+(w[0]-c[0])*gt), g=(c[1]+(w[1]-c[1])*gt), b=(c[2]+(w[2]-c[2])*gt);
    return `rgb(${Math.round(r+(255-r)*wt)},${Math.round(g+(255-g)*wt)},${Math.round(b+(255-b)*wt)})`;
  }
}

function spawnParticles(energy, side){
  // side 'in' -> left half of screen, 'out' -> right half. Two separate fields,
  // each driven by its own analyser's energy.
  const n=Math.floor(2+energy*22);
  const W=pcanvas.width, H=pcanvas.height;
  const x0 = side==='in' ? 0 : W*0.5;
  const span = W*0.5;
  for(let i=0;i<n;i++){
    if(particles.length>700) break;
    const ang=Math.random()*Math.PI*2, spd=(0.6+energy*5)*(0.4+Math.random());
    // IN field leans neutral (raw source); OUT field takes the engine's colour (after the rig)
    const acc=hexRgb(ambColor), glow=hexRgb(ambGlow);
    let hue;
    if(side==='in'){
      hue = Math.random()<0.5 ? '139,151,166' : (Math.random()<0.6 ? glow : '255,255,255');
    } else {
      hue = Math.random()<0.5 ? acc : (Math.random()<0.6 ? glow : '255,255,255');
    }
    particles.push({
      x:x0+Math.random()*span,
      y:Math.random()*H,
      vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd-0.4,
      life:1, decay:0.005+Math.random()*0.008,
      size:2+Math.random()*4+energy*5,
      hue, glow:0.5+energy*0.5
    });
  }
}

// vertical scrolling waveform with amplitude heatmap.
// New audio enters at the TOP, existing rows scroll DOWN.
// `boost` lifts the colour mapping so a quieter (processed) signal still shows hue.
function drawWaveV(cx, analyser, buf, boost){
  if(!cx||!analyser) return;
  const W=cx.canvas.width, H=cx.canvas.height;
  analyser.getByteTimeDomainData(buf);
  const step=2;
  const img=cx.getImageData(0,0,W,H-step);
  cx.clearRect(0,0,W,H);
  cx.putImageData(img,0,step);
  let mn=255,mx=0;
  for(let i=0;i<buf.length;i++){ if(buf[i]<mn)mn=buf[i]; if(buf[i]>mx)mx=buf[i]; }
  const amp=Math.max(Math.abs(mx-128),Math.abs(mn-128))/128;   // 0..1
  const half=(amp*0.92)*(W/2);
  const cxm=W/2;
  cx.fillStyle='#0a0e14'; cx.fillRect(0,0,W,step);
  // heatmap colour uses boosted amplitude so OUT (attenuated) still colourises
  cx.fillStyle=heat(Math.min(1, amp*(boost||1)));
  cx.fillRect(cxm-half,0,half*2,step);
  cx.fillStyle=`rgba(255,255,255,${(0.15+amp*0.5).toFixed(2)})`;
  cx.fillRect(cxm-Math.max(1,half*0.12),0,Math.max(2,half*0.24),step);
}

function visualFrame(){
  if(!playing){ visualRAF=null; return; }
  // --- IN energy -> left particle field ---
  if(inAnalyser){
    if(!waveInBuf) waveInBuf=new Uint8Array(inAnalyser.fftSize);
    inAnalyser.getByteTimeDomainData(waveInBuf);
    let sum=0; for(let i=0;i<waveInBuf.length;i++){ const v=(waveInBuf[i]-128)/128; sum+=v*v; }
    const rms=Math.sqrt(sum/waveInBuf.length);
    const transient=Math.max(0, rms-energyAvg);
    energyAvg=energyAvg*0.88+rms*0.12;
    if(pctx) spawnParticles(rms*2 + transient*10, 'in');
  }
  // --- OUT energy -> right particle field ---
  if(outAnalyser){
    if(!waveOutBuf) waveOutBuf=new Uint8Array(outAnalyser.fftSize);
    outAnalyser.getByteTimeDomainData(waveOutBuf);
    let sum=0; for(let i=0;i<waveOutBuf.length;i++){ const v=(waveOutBuf[i]-128)/128; sum+=v*v; }
    const rmsO=Math.sqrt(sum/waveOutBuf.length);
    const transO=Math.max(0, rmsO-energyAvgO);
    energyAvgO=energyAvgO*0.88+rmsO*0.12;
    // OUT is quieter (distance attenuation) so scale up a touch to stay lively
    if(pctx) spawnParticles(rmsO*3 + transO*12, 'out');
  }
  // --- particles (additive glow) ---
  if(pctx){
    pctx.clearRect(0,0,pcanvas.width,pcanvas.height);
    pctx.globalCompositeOperation='lighter';
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.008; p.life-=p.decay;
      if(p.life<=0){ particles.splice(i,1); continue; }
      const r=p.size*p.life;
      const g=pctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r*2.5);
      g.addColorStop(0,`rgba(${p.hue},${(p.life*p.glow).toFixed(3)})`);
      g.addColorStop(1,`rgba(${p.hue},0)`);
      pctx.fillStyle=g;
      pctx.beginPath(); pctx.arc(p.x,p.y,r*2.5,0,Math.PI*2); pctx.fill();
    }
    pctx.globalCompositeOperation='source-over';
  }
  // --- vertical heatmap waveforms (OUT gets a colour boost so it stays vivid) ---
  drawWaveV(waveInCtx, inAnalyser, waveInBuf, 1.0);
  drawWaveV(waveOutCtx, outAnalyser, waveOutBuf, 2.2);
  visualRAF=requestAnimationFrame(visualFrame);
}

function startVisuals(){
  resizeVisualCanvases();
  // clear waveform canvases to their bg
  [waveInCtx,waveOutCtx].forEach(cx=>{ if(cx){ cx.fillStyle='#0a0e14'; cx.fillRect(0,0,cx.canvas.width,cx.canvas.height); }});
  if(!visualRAF) visualRAF=requestAnimationFrame(visualFrame);
}
function stopVisuals(){
  if(visualRAF){ cancelAnimationFrame(visualRAF); visualRAF=null; }
  const fade=()=>{
    if(!pctx){ return; }
    pctx.clearRect(0,0,pcanvas.width,pcanvas.height);
    pctx.globalCompositeOperation='lighter';
    let alive=false;
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.life-=0.025;
      if(p.life<=0){ particles.splice(i,1); continue; }
      alive=true;
      const r=p.size*p.life;
      const g=pctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r*2.5);
      g.addColorStop(0,`rgba(${p.hue},${(p.life*p.glow).toFixed(3)})`);
      g.addColorStop(1,`rgba(${p.hue},0)`);
      pctx.fillStyle=g; pctx.beginPath(); pctx.arc(p.x,p.y,r*2.5,0,Math.PI*2); pctx.fill();
    }
    pctx.globalCompositeOperation='source-over';
    if(alive) requestAnimationFrame(fade);
  };
  fade();
}

/* ---------- field visual ---------- */
function drawField(){
  const d=+els.dist.value;
  const x = 20 + Math.min(1, Math.log10(d/2)/Math.log10(400)) * 520;
  els.listenerG.setAttribute('transform',`translate(${x},0)`);
  // wavefronts
  const n=4, frag=[];
  for(let i=0;i<n;i++){
    const r=20+i*((x-13)/n);
    const op=(0.5*(1-i/n)).toFixed(2);
    frag.push(`<ellipse cx="13" cy="60" rx="${r}" ry="${r*0.55}" fill="none" stroke="var(--stage)" stroke-width="1" opacity="${op}"/>`);
  }
  els.waves.innerHTML=frag.join('');
}

/* ---------- cheers: timestamp parsing + list management ---------- */
function parseTime(str){
  str=(str||'').trim();
  if(!str) return null;
  let sec;
  if(str.includes(':')){
    const parts=str.split(':').map(Number);
    if(parts.some(isNaN)) return null;
    sec = parts.length===3 ? parts[0]*3600+parts[1]*60+parts[2]
        : parts[0]*60+parts[1];
  }else{
    sec=Number(str);
  }
  return (isNaN(sec)||sec<0) ? null : sec;
}
function fmtTime(sec){
  const m=Math.floor(sec/60), s=(sec-m*60);
  return `${m}:${s.toFixed(1).padStart(4,'0')}`;
}

function renderCheerList(){
  cheers.sort((a,b)=>a.time-b.time);
  els.cheerEmpty.style.display = cheers.length ? 'none' : '';
  els.cheerList.innerHTML = cheers.map(c=>`
    <div class="cheer-row" data-id="${c.id}">
      <span class="ct">${fmtTime(c.time)}</span>
      <span class="cn">${c.name}</span>
      <span class="cg">
        <input type="range" min="0" max="1.5" step="0.05" value="${c.gain}" data-id="${c.id}">
        <span>${Math.round(c.gain*100)}%</span>
      </span>
      <button class="del" data-id="${c.id}" title="Remove">×</button>
    </div>`).join('');
}

function addCheer(kind, name, buffer){
  const time=parseTime(els.cheerTime.value);
  if(time===null){ els.cheerTime.focus(); els.cheerTime.style.borderColor='var(--stage)'; return; }
  els.cheerTime.style.borderColor='';
  cheers.push({id:++cheerSeq, kind, name, time, gain:0.9, buffer:buffer||null});
  renderCheerList();
  if(playing){stopPreview();startPreview();} // reschedule so the new cheer is heard
}

// uploaded cheer clips become reusable options in the dropdown
function refreshUploadedGroup(selectKey){
  els.uploadedGroup.innerHTML = uploadedClips
    .map(c=>`<option value="clip:${c.key}">${c.name}</option>`).join('');
  els.uploadedGroup.label = uploadedClips.length ? 'Uploaded clips' : '';
  els.uploadedGroup.style.display = uploadedClips.length ? '' : 'none';
  if(selectKey) els.cheerKind.value=`clip:${selectKey}`;
}

/* ---------- WAV markers: show + import ---------- */
function markerLabel(c, i){
  return c.label ? c.label : `Marker ${i+1}`;
}
function renderMarkerBar(){
  if(!audioBuf){ els.markersPanel.classList.add('hidden'); return; }
  els.markersPanel.classList.remove('hidden');
  const dur=audioBuf.duration;

  // region markers = start of track + embedded cues + end of track
  regionMarkers = [
    {time:0, label:'Start of track', synthetic:true},
    ...trackCues.map((c,i)=>({time:c.time, label:c.label||`Marker ${i+1}`})),
    {time:dur, label:'End of track', synthetic:true}
  ].sort((a,b)=>a.time-b.time);

  // strip shows the embedded cues (the synthetic ones are just the edges)
  els.markerStrip.innerHTML = trackCues.map((c,i)=>{
    const pct=Math.max(0,Math.min(100,(c.time/dur)*100));
    return `<span class="mk" style="left:${pct}%" title="${c.label||('Marker '+(i+1))} @ ${fmtTime(c.time)}"></span>`;
  }).join('');

  els.markerCount.textContent = trackCues.length
    ? `${trackCues.length} embedded marker${trackCues.length>1?'s':''} found. Import them as one-shot cheers, or pick a start/end pair below to run a crowd bed across that span.`
    : `No embedded markers in this file — but you can still run a crowd bed from start to end of track using the region controls below.`;

  // cheer import only makes sense with real embedded cues
  els.cheerImportRow.querySelector('#markerImport').disabled = trackCues.length===0;

  // region selectors index into regionMarkers
  const opts = regionMarkers.map((m,i)=>`<option value="${i}">${m.label} · ${fmtTime(m.time)}</option>`).join('');
  els.regStart.innerHTML = opts;
  els.regEnd.innerHTML = `<option value="end">— end of track —</option>` + opts;
  els.regStart.value='0';        // start of track
  els.regEnd.value='end';        // default: to end of track
}

function importMarkers(){
  if(!trackCues.length) return;
  const sound=els.markerSound.value;
  trackCues.forEach((c,i)=>{
    const name = (c.label?`${c.label} · `:'') + (CHEER_LABELS[sound]||sound);
    cheers.push({id:++cheerSeq, kind:sound, name, time:c.time, gain:0.9, buffer:null});
  });
  renderCheerList();
  if(playing){stopPreview();startPreview();}
}

/* ---------- crowd regions defined by start/end markers ---------- */
function renderRegionList(){
  els.regionList.innerHTML = crowdRegions.map(r=>{
    const bed = r.bedId!=null ? crowdBeds.find(b=>b.id===r.bedId) : null;
    const bedName = bed ? bed.name : 'Synthetic bed';
    const endTxt = r.end==null ? 'end' : fmtTime(r.end);
    return `
    <div class="region-row" data-id="${r.id}">
      <span class="rspan">${fmtTime(r.start)} → ${endTxt}</span>
      <span class="rn">${bedName}</span>
      <span class="cg">
        <input type="range" min="0" max="1.5" step="0.05" value="${r.gain}" data-id="${r.id}">
        <span>${Math.round(r.gain*100)}%</span>
      </span>
      <button class="del" data-id="${r.id}" title="Remove">×</button>
    </div>`;
  }).join('');
}

function addRegion(){
  if(!regionMarkers.length || !audioBuf) return;
  const si=+els.regStart.value;
  const start = regionMarkers[si] ? regionMarkers[si].time : 0;
  const ev=els.regEnd.value;
  // "end" sentinel = run to end of track (stored as null so it tracks track length)
  const end = ev==='end' ? null : (regionMarkers[+ev] ? regionMarkers[+ev].time : null);
  const endResolved = end==null ? audioBuf.duration : end;
  if(endResolved<=start){ els.regEnd.style.borderColor='var(--stage)'; return; }
  els.regEnd.style.borderColor='';
  crowdRegions.push({id:++regionSeq, bedId:activeCrowd, start, end, gain:1.0});
  renderRegionList();
  if(playing){stopPreview();startPreview();} // bed becomes region-driven now
}

/* ---------- file handling ---------- */
function loadFile(f){
  if(!f) return;
  fileName=f.name;
  // create + unlock the AudioContext inside the user gesture (iOS needs this here, not later)
  ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
  if(ctx.resume) ctx.resume();
  els.loaded.classList.remove('hidden'); els.loaded.innerHTML=`Loading <b>${fileName}</b>…`;
  const fr=new FileReader();
  fr.onerror=()=>{ els.loaded.innerHTML=`Couldn't read that file.`; };
  fr.onload=e=>{
    const raw=e.target.result;
    // parse cues from a copy first — decodeAudioData detaches the buffer
    trackCues = parseWavCues(raw.slice(0));
    const onOK=buf=>{
      audioBuf=buf;
      const cueNote = trackCues.length ? ` · <b>${trackCues.length} marker${trackCues.length>1?'s':''}</b> found` : '';
      els.loaded.innerHTML=`Loaded <b>${fileName}</b> · ${audioBuf.duration.toFixed(1)}s · ${audioBuf.numberOfChannels}ch${cueNote}`;
      els.controls.classList.remove('hidden');
      resizeVisualCanvases();
      updateTransport();    // enable play/render only if the active engine is built
      renderMarkerBar();
      drawField();
    };
    const onErr=()=>{ els.loaded.innerHTML=`Couldn't decode <b>${fileName}</b>. Try WAV, MP3, or M4A (FLAC isn't supported on iOS).`; };
    // callback form of decodeAudioData — reliable on iOS Safari (the Promise form can hang there)
    try{ const p=ctx.decodeAudioData(raw, onOK, onErr); if(p && p.catch) p.catch(onErr); }
    catch(err){ onErr(); }
  };
  fr.readAsArrayBuffer(f);
}

function renderBedList(){
  const synthActive = activeCrowd==null;
  let html = `
    <div class="bed ${synthActive?'active':''}" data-bed="synth">
      <span class="radio"></span>
      <span class="bn">Synthetic bed</span>
      <span class="bd">generated</span>
    </div>`;
  html += crowdBeds.map(b=>`
    <div class="bed ${activeCrowd===b.id?'active':''}" data-bed="${b.id}">
      <span class="radio"></span>
      <span class="bn">${b.name}</span>
      <span class="bd">${b.buffer.duration.toFixed(1)}s</span>
      <button class="del" data-bed="${b.id}" title="Remove">×</button>
    </div>`).join('');
  els.bedList.innerHTML=html;
}

function loadCrowdFiles(files){
  if(!files || !files.length) return;
  ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
  if(ctx.resume) ctx.resume();                       // unlock within the gesture (iOS)
  Array.from(files).forEach(f=>{
    const fr=new FileReader();
    fr.onload=e=>{
      const onOK=buf=>{
        const id=++crowdSeq;
        crowdBeds.push({id, name:f.name, buffer:buf});
        if(activeCrowd==null) activeCrowd=id;         // first real bed becomes active
        renderBedList();
        if(playing){stopPreview();startPreview();}
      };
      // callback form — reliable on iOS Safari
      try{ const p=ctx.decodeAudioData(e.target.result, onOK, ()=>{}); if(p && p.catch) p.catch(()=>{}); }
      catch(err){ /* skip undecodable file */ }
    };
    fr.readAsArrayBuffer(f);
  });
}

/* ---------- events ---------- */
els.file.addEventListener('change',e=>loadFile(e.target.files[0]));
['dragover','dragenter'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.add('over')}));
['dragleave','drop'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.remove('over')}));
els.drop.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));

// crowd beds — multiple, one active at a time
els.crowdOn.addEventListener('change',()=>{
  crowdOn=els.crowdOn.checked;
  els.crowdOnTxt.textContent = crowdOn ? 'Crowd on' : 'Crowd off';
  // dim the bed/region controls when off (they don't do anything then)
  els.dropCrowd.classList.toggle('crowd-off', !crowdOn);
  els.bedList.classList.toggle('crowd-off', !crowdOn);
  if(playing){stopPreview();startPreview();}
});
els.fileCrowd.addEventListener('change',e=>{ loadCrowdFiles(e.target.files); els.fileCrowd.value=''; });
['dragover','dragenter'].forEach(ev=>els.dropCrowd.addEventListener(ev,e=>{e.preventDefault();els.dropCrowd.classList.add('over')}));
['dragleave','drop'].forEach(ev=>els.dropCrowd.addEventListener(ev,e=>{e.preventDefault();els.dropCrowd.classList.remove('over')}));
els.dropCrowd.addEventListener('drop',e=>loadCrowdFiles(e.dataTransfer.files));
els.bedList.addEventListener('click',e=>{
  const del=e.target.closest('.del');
  if(del){
    e.stopPropagation();
    const id=+del.dataset.bed;
    crowdBeds=crowdBeds.filter(b=>b.id!==id);
    if(activeCrowd===id) activeCrowd = crowdBeds.length ? crowdBeds[0].id : null;
    renderBedList();
    if(playing){stopPreview();startPreview();}
    return;
  }
  const row=e.target.closest('.bed'); if(!row) return;
  activeCrowd = row.dataset.bed==='synth' ? null : +row.dataset.bed;
  renderBedList();
  if(playing){stopPreview();startPreview();}
});

// cheers
els.cheerKind.addEventListener('change',()=>{
  if(els.cheerKind.value==='__upload__'){ els.cheerFile.click(); }
});
els.cheerAdd.addEventListener('click',()=>{
  const val=els.cheerKind.value;
  if(val==='__upload__'){ els.cheerFile.click(); return; }
  if(val.startsWith('clip:')){
    const key=val.slice(5);
    const clip=uploadedClips.find(c=>c.key===key);
    if(!clip) return;
    addCheer('upload', clip.name, clip.buffer);
  }else{
    addCheer(val, CHEER_LABELS[val]||val, null);
  }
});
els.cheerFile.addEventListener('change',e=>{
  const f=e.target.files[0];
  els.cheerFile.value='';
  if(!f){ els.cheerKind.value='roar'; return; } // cancelled picker
  const fr=new FileReader();
  fr.onload=async ev=>{
    ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
    try{
      const buf=await ctx.decodeAudioData(ev.target.result);
      const key='u'+(++cheerSeq);
      uploadedClips.push({key, name:f.name, buffer:buf});
      refreshUploadedGroup(key);  // store + select it; user sets time then clicks Add
    }catch(err){ alert("Couldn't decode that clip. Try a wav or mp3."); els.cheerKind.value='roar'; }
  };
  fr.readAsArrayBuffer(f);
});
els.cheerTime.addEventListener('keydown',e=>{ if(e.key==='Enter') els.cheerAdd.click(); });
els.cheerList.addEventListener('click',e=>{
  const btn=e.target.closest('.del'); if(!btn) return;
  const id=+btn.dataset.id;
  cheers=cheers.filter(c=>c.id!==id);
  renderCheerList();
  if(playing){stopPreview();startPreview();}
});
els.cheerList.addEventListener('input',e=>{
  if(e.target.type!=='range') return;
  const id=+e.target.dataset.id;
  const c=cheers.find(x=>x.id===id); if(!c) return;
  c.gain=+e.target.value;
  e.target.nextElementSibling.textContent=Math.round(c.gain*100)+'%';
  if(playing){stopPreview();startPreview();}
});

// markers
els.markerImport.addEventListener('click', importMarkers);
els.regionAdd.addEventListener('click', addRegion);
els.markerMode.addEventListener('click',e=>{
  const btn=e.target.closest('.mm'); if(!btn) return;
  els.markerMode.querySelectorAll('.mm').forEach(b=>b.classList.toggle('active',b===btn));
  const crowd = btn.dataset.mode==='crowd';
  els.cheerImportRow.classList.toggle('hidden', crowd);
  els.regionAddRow.classList.toggle('hidden', !crowd);
});
els.regionList.addEventListener('click',e=>{
  const btn=e.target.closest('.del'); if(!btn) return;
  const id=+btn.dataset.id;
  crowdRegions=crowdRegions.filter(r=>r.id!==id);
  renderRegionList();
  if(playing){stopPreview();startPreview();}
});
els.regionList.addEventListener('input',e=>{
  if(e.target.type!=='range') return;
  const id=+e.target.dataset.id;
  const r=crowdRegions.find(x=>x.id===id); if(!r) return;
  r.gain=+e.target.value;
  e.target.nextElementSibling.textContent=Math.round(r.gain*100)+'%';
  if(playing){stopPreview();startPreview();}
});

els.dist.addEventListener('input',()=>{
  const d=+els.dist.value;
  distanceM=d;                 // keep the engine's distance in sync
  els.distNum.textContent=d;
  els.zoneTag.innerHTML=zone(d);
  drawField();
  liveUpdate();
});

// PA level — live via output gain, no rebuild needed
els.pa.addEventListener('input',()=>{
  paLevel=+els.pa.value;
  els.paVal.textContent=`${paLevel} dB SPL`;
  liveUpdate();
});

// drum boost — live EQ ramp, value shown on the readout
els.drum.addEventListener('input',()=>{
  drumBoost=+els.drum.value;
  els.drumVal.textContent=`${drumBoost>0?'+':''}${drumBoost} dB`;
  liveUpdate();
});
els.drumOn.addEventListener('change',()=>{
  drumOn=els.drumOn.checked;
  els.drum.closest('.boost').classList.toggle('dim', !drumOn);
  liveUpdate();
});
// input 5-band EQ — custom pointer-driven vertical sliders (no native range
// quirks). Geometry: slot is 220px tall, thumb-centre travels 11px..209px.
const EQ_TOP=11, EQ_BOT=209, EQ_SPAN=EQ_BOT-EQ_TOP; // px positions of +18 / -18
function eqValToY(v){ return EQ_TOP + (18 - v)/36 * EQ_SPAN; }      // dB -> px from slot top
function eqYToVal(y){ return 18 - (y - EQ_TOP)/EQ_SPAN * 36; }      // px -> dB

function renderEq(slot, i){
  const v = eqGains[i];
  const y = eqValToY(v);
  const thumb = slot.querySelector('.eq-thumb');
  const fill  = slot.querySelector('.eq-fill');
  const vl    = document.getElementById('eq'+i+'v');
  thumb.style.top = y+'px';
  // fill from centre (0 dB, y=110) to the thumb
  const cy = eqValToY(0);
  const top = Math.min(cy, y), h = Math.abs(y - cy);
  fill.style.top = top+'px';
  fill.style.height = h+'px';
  const r = Math.round(v*10)/10;
  vl.textContent = (r>0?'+':'')+r;
}

function setEqFromPointer(slot, i, clientY){
  const rect = slot.getBoundingClientRect();
  let y = clientY - rect.top;
  y = Math.max(EQ_TOP, Math.min(EQ_BOT, y));   // clamp to travel
  let v = eqYToVal(y);
  v = Math.round(v/0.25)*0.25;                 // snap to 0.25 dB
  v = Math.max(-18, Math.min(18, v));
  eqGains[i] = v;
  renderEq(slot, i);
  liveUpdate();
}

for(let i=0;i<5;i++){
  const slot=document.getElementById('eq'+i);
  if(!slot) continue;
  let dragging=false;
  const down=e=>{ dragging=true; slot.setPointerCapture(e.pointerId);
                  setEqFromPointer(slot,i,e.clientY); e.preventDefault(); };
  const move=e=>{ if(dragging) setEqFromPointer(slot,i,e.clientY); };
  const up=e=>{ dragging=false; try{slot.releasePointerCapture(e.pointerId);}catch(_){} };
  slot.addEventListener('pointerdown',down);
  slot.addEventListener('pointermove',move);
  slot.addEventListener('pointerup',up);
  slot.addEventListener('pointercancel',up);
  slot.addEventListener('dblclick',()=>{ eqGains[i]=0; renderEq(slot,i); liveUpdate(); });
  renderEq(slot,i); // initial
}

// ---- environmental / atmosphere controls ----
function windDirLabel(deg){
  if(deg<=20) return 'downwind';
  if(deg<=70) return 'cross-down';
  if(deg<110) return 'crosswind';
  if(deg<160) return 'cross-up';
  return 'upwind';
}
function updateEnvNote(){
  const bits=[];
  bits.push(envWindSpeed<0.5 ? 'Still air' :
            (Math.cos(envWindDir*Math.PI/180)>=0?'Downwind':'Upwind')+` ~${envWindSpeed} m/s`);
  bits.push(envHumidity<35?'dry':envHumidity>70?'humid':'mild');
  bits.push(envTemp<5?'cold':envTemp>28?'hot':`${envTemp}°C`);
  if(envDensity>70) bits.push('packed crowd');
  else if(envDensity<25) bits.push('sparse crowd');
  if(envGust>40) bits.push('gusty');
  const el=document.getElementById('envNote');
  if(el) el.textContent = bits.join(' · ') + '. The filtering and level shift to match.';
}
function bindEnv(id, fn, fmt){
  const sl=document.getElementById(id), vl=document.getElementById(id+'V');
  if(!sl) return;
  sl.addEventListener('input',()=>{
    fn(+sl.value);
    if(vl&&fmt) vl.textContent=fmt(+sl.value);
    updateEnvNote();
    liveUpdate();
  });
}
bindEnv('clarity', v=>envClarity=v,  v=> (v>0?'+':'')+v );
bindEnv('temp',    v=>envTemp=v,     v=> v+'°C' );
bindEnv('hum',     v=>envHumidity=v, v=> v+'%' );
bindEnv('pres',    v=>envPressure=v, v=> v+' hPa' );
bindEnv('dens',    v=>envDensity=v,  v=> v+'%' );
bindEnv('wind',    v=>envWindSpeed=v,v=> v+' m/s' );
bindEnv('windDir', v=>envWindDir=v,  v=> windDirLabel(v) );
bindEnv('gust',    v=>envGust=v,     v=> v+'%' );
// weather sound beds: changing these adds/removes audio nodes, so rebuild
function rebuildPreview(){
  if(!playing) return;
  const wasPlaying=true;
  stopPreview();
  startPreview();
}
function bindWeather(id, fn, fmt){
  const sl=document.getElementById(id), vl=document.getElementById(id+'V');
  if(!sl) return;
  let rebuildT=null;
  sl.addEventListener('input',()=>{
    fn(+sl.value);
    if(vl&&fmt) vl.textContent=fmt(+sl.value);
    updateEnvNote();
    // debounce rebuilds so dragging stays smooth
    if(rebuildT) clearTimeout(rebuildT);
    rebuildT=setTimeout(rebuildPreview, 140);
  });
}
bindWeather('windNoise', v=>envWindNoise=v, v=> v+'%' );
bindWeather('rain',      v=>envRain=v,      v=> v+'%' );
bindWeather('thunder',   v=>envThunder=v,   v=> v<=0?'off':v+'%' );
updateEnvNote();

/* ---------- live weather -> atmosphere (Open-Meteo, no API key needed) ---------- */
// Set a slider to a real value, snapping to its range/step, and fire its normal handler
// (updates the env var, label, note, and live/rebuild) — so real data drives the same path.
function setEnvSlider(id, val){
  const sl=document.getElementById(id); if(!sl || val==null || !isFinite(val)) return;
  const mn=+sl.min, mx=+sl.max, st=+sl.step||1;
  let v=Math.max(mn, Math.min(mx, val)); v=Math.round(v/st)*st;
  sl.value=v; sl.dispatchEvent(new Event('input'));
}
// WMO weather code -> short label
function wmoDesc(c){
  if(c===0) return 'clear sky'; if(c<=3) return 'partly cloudy';
  if(c===45||c===48) return 'fog'; if(c<=57) return 'drizzle';
  if(c<=67) return 'rain'; if(c<=77) return 'snow';
  if(c<=82) return 'rain showers'; if(c<=86) return 'snow showers';
  if(c>=95) return 'thunderstorm'; return 'overcast';
}
// map an Open-Meteo `current` block onto the atmosphere controls
function applyWeather(c){
  const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  const code=c.weather_code||0;
  const wind=c.wind_speed_10m||0, gust=c.wind_gusts_10m!=null?c.wind_gusts_10m:wind, precip=c.precipitation||0;
  setEnvSlider('temp', c.temperature_2m);
  setEnvSlider('hum',  c.relative_humidity_2m);
  setEnvSlider('pres', c.surface_pressure);
  setEnvSlider('wind', wind);
  if(c.wind_direction_10m!=null){ const d=c.wind_direction_10m; setEnvSlider('windDir', d>180?360-d:d); }
  const gustExcess = wind>0.5 ? (gust-wind)/wind : gust/5;   // turbulence = how much gusts exceed steady wind
  setEnvSlider('gust', cl(gustExcess*70,0,100));
  setEnvSlider('windNoise', cl(wind/15*100,0,100));
  let rain=cl(precip/7*100,0,100);                            // ~7 mm/h reads as a downpour
  if(rain<20 && ((code>=51&&code<=67)||(code>=80&&code<=82)||code>=95)) rain=20;  // wet code w/ tiny mm
  setEnvSlider('rain', rain);
  setEnvSlider('thunder', code>=99?90 : code>=95?70 : 0);
  const clar = code===0?25 : code<=3?5 : (code===45||code===48?-55 : (precip>0?-15:0));
  setEnvSlider('clarity', clar);
}
async function fetchWeather(){
  const place=els.wxPlace.value.trim();
  els.wxStatus.classList.remove('err');
  if(!place){ els.wxStatus.textContent='Type a place name first.'; els.wxStatus.classList.add('err'); return; }
  els.wxFetch.disabled=true; els.wxStatus.textContent='Looking up “'+place+'”…';
  try{
    const geo=await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name='+encodeURIComponent(place)).then(r=>r.json());
    if(!geo.results||!geo.results.length){ els.wxStatus.textContent='Couldn’t find “'+place+'”. Try a city name.'; els.wxStatus.classList.add('err'); els.wxFetch.disabled=false; return; }
    const g=geo.results[0];
    const wx=await fetch('https://api.open-meteo.com/v1/forecast?wind_speed_unit=ms&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code&latitude='+g.latitude+'&longitude='+g.longitude).then(r=>r.json());
    const c=wx.current;
    if(!c){ throw new Error('no current data'); }
    applyWeather(c);
    const loc=g.name+(g.admin1&&g.admin1!==g.name?', '+g.admin1:'')+(g.country?', '+g.country:'');
    els.wxStatus.textContent='✓ '+loc+' · '+Math.round(c.temperature_2m)+'°C · wind '+(c.wind_speed_10m||0).toFixed(1)+' m/s · '+wmoDesc(c.weather_code||0)+' — atmosphere set.';
  }catch(err){
    els.wxStatus.textContent='Couldn’t reach the weather service — check your internet connection.';
    els.wxStatus.classList.add('err');
  }
  els.wxFetch.disabled=false;
}
els.wxFetch.addEventListener('click', fetchWeather);
els.wxPlace.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); fetchWeather(); } });

els.crowdBoost.addEventListener('input',()=>{
  crowdBoostDb=+els.crowdBoost.value;
  els.crowdBoostVal.textContent=`${crowdBoostDb>0?'+':''}${crowdBoostDb} dB`;
  liveUpdate();
});
els.crowdBoost.addEventListener('change',()=>{
  if(playing && crowdRegions.length){ stopPreview(); startPreview(); }
});

// Speaker tuning — changes EQ nodes, so rebuild the graph if playing
els.tunes.addEventListener('click',e=>{
  const btn=e.target.closest('.tune'); if(!btn) return;
  tuneId=btn.dataset.tune;
  els.tunes.querySelectorAll('.tune').forEach(b=>b.classList.toggle('active',b===btn));
  els.tuneDesc.textContent=TUNINGS[tuneId].desc;
  if(playing){stopPreview();startPreview();}
});

// Diffuse-field character — switches the reverb network, so rebuild if playing
const DFIELD_DESC={
  current:    'The original open-air wash — one long, even diffuse tail (the look you had before).',
  spectral:   'A dark, low-dominant tail whose highs die before its lows, with length and tone reacting to distance, humidity and crowd — the most realistic outdoor diffuse field.',
  reflections:'The open tail plus discrete late echoes bouncing back from distant boundaries (other stages, treeline, hills) — that festival "slap from across the field" cue. Echoes spread out with distance.',
  minimal:    'A short, dark wash — barely-there diffusion for a tight, dry, up-close feel.'
};
els.dfields.addEventListener('click',e=>{
  const btn=e.target.closest('.tune'); if(!btn) return;
  reverbMode=btn.dataset.df;
  els.dfields.querySelectorAll('.tune').forEach(b=>b.classList.toggle('active',b===btn));
  els.dfieldDesc.textContent=DFIELD_DESC[reverbMode]||'';
  if(playing){stopPreview();startPreview();}   // mode changes nodes -> rebuild
});

// Space module picker — each is a distinct graph, so rebuild on change
const SPACE_DESC={
  nebula:    'A vast, weightless cloud — huge shimmering reverb, a deep sub bloom, everything slowly drifting.',
  alien:     'An exotic world — burbling formant resonators, a metallic comb ring, and an alien-wind bed wandering underneath.',
  anomalies: 'Unstable spacetime — ring-modulated sidebands, a filter warbling under detuned LFOs, glitchy feedback and irregular dropouts.',
  chamber:   'A confined 3D field: each particle is a speaker emitting your audio, drifting and bouncing inside a polyhedron; every corner is a microphone. The sound moves through 3D space as the swarm shifts.'
};
function syncSpaceModeUI(){
  els.nebulaCtl.style.display = (spaceMode==='nebula')    ? 'block' : 'none';
  els.anomCtl.style.display   = (spaceMode==='anomalies') ? 'block' : 'none';
  els.alienCtl.style.display  = (spaceMode==='alien')     ? 'block' : 'none';
  els.chamberCtl.style.display= (spaceMode==='chamber')   ? 'block' : 'none';
  if(spaceMode==='alien'){ if(!alienAtmo) alienAtmo=genAtmosphere(); updateAtmoReadout(); }
}
// the confined 3D particle field: a rotating polyhedron of corner-microphones with
// emitter particles (speakers) drifting inside. Perspective-projected, depth-sorted.
function chProj(p, ay, ax, ox, oy, R){
  const x1=p.x*Math.cos(ay)+p.z*Math.sin(ay), z1=-p.x*Math.sin(ay)+p.z*Math.cos(ay);
  const y2=p.y*Math.cos(ax)-z1*Math.sin(ax), z2=p.y*Math.sin(ax)+z1*Math.cos(ax);
  const persp=1.7/(1.7-z2*0.55);
  return { sx:ox+x1*R*persp, sy:oy+y2*R*persp, depth:z2, sc:persp };
}
// 2D convex hull (monotone chain) of projected corners -> the object's screen silhouette
function chHull2D(pts){
  if(pts.length<3) return pts.slice();
  const p=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[]; for(const q of p){ while(lo.length>=2 && cr(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop(); lo.push(q); }
  const up=[]; for(let i=p.length-1;i>=0;i--){ const q=p[i]; while(up.length>=2 && cr(up[up.length-2],up[up.length-1],q)<=0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// Spherical sound wavefronts emitted by the speaker-particles. Each grows outward at
// the (visual) speed of sound; where fronts overlap, additive blending reads as
// interference — the same add/cancel physics the audio worklet computes.
let chWaves=[], chWaveAccum=0;
function chEmitWaves(dt){
  // emit from the speakers: normally the particles, but the corners when roles are reversed
  const emitters = chamberReverse ? chCorners : chP;
  if(!emitters || !emitters.length) return;
  const live = playing && activeEngine && activeEngine.id==='space' && spaceMode==='chamber';
  const interval = (live?0.24:0.7) * (1 - Math.min(0.6, chamberMove/200));  // more motion -> denser
  chWaveAccum+=dt;
  if(chWaveAccum>=interval){
    chWaveAccum=0;
    const k = live ? 3 : 1;                          // audio flowing -> several speakers fire
    for(let i=0;i<k;i++){ const s=emitters[(Math.random()*emitters.length)|0];
      chWaves.push({x:s.x,y:s.y,z:s.z, r:0.02, life:1}); }
  }
  const grow=1.9*dt;                                 // world units / s (wave speed on screen)
  for(const wv of chWaves){ wv.r+=grow; wv.life-=dt*0.7; }
  chWaves=chWaves.filter(wv=>wv.life>0 && wv.r<2.6);
  if(chWaves.length>140) chWaves.splice(0, chWaves.length-140);
}
function drawChamberInline(){
  const cv=els.chamberCanvas; if(!cv) return;
  const w=cv.clientWidth||300, h=cv.clientHeight||w;
  if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  const cx=cv.getContext('2d'); if(!cx) return;
  cx.clearRect(0,0,w,h);
  chEnsure();
  const rgb=hexRgb(ambColor), ox=w/2, oy=h/2, R=Math.min(w,h)*0.30*(0.55+chamberSize/100*0.7);
  const t=performance.now()/1000, ay=t*0.28, ax=Math.sin(t*0.16)*0.5;
  const cp=chCorners.map((c,i)=>{ const pr=chProj(c,ay,ax,ox,oy,R); pr.i=i; return pr; });
  // wireframe edges (depth-shaded)
  cx.lineWidth=1;
  for(const [a,b] of chEdges){ const A=cp[a], B=cp[b]; const dep=(A.depth+B.depth)/2;
    cx.strokeStyle=`rgba(${rgb},${(0.10+0.18*(dep+1)/2).toFixed(3)})`;
    cx.beginPath(); cx.moveTo(A.sx,A.sy); cx.lineTo(B.sx,B.sy); cx.stroke(); }
  // --- expanding sound wavefronts from the speakers, clipped to the object silhouette ---
  chEmitWaves(1/60);
  if(chWaves.length && cp.length>=3){
    const hull=chHull2D(cp.map(p=>[p.sx,p.sy]));
    cx.save();
    if(hull.length>=3){ cx.beginPath(); hull.forEach(([x,y],i)=> i?cx.lineTo(x,y):cx.moveTo(x,y)); cx.closePath(); cx.clip(); }
    cx.globalCompositeOperation='lighter';
    for(const wv of chWaves){
      const pr=chProj(wv,ay,ax,ox,oy,R), sr=wv.r*R*pr.sc;
      if(sr<=0.5) continue;
      const a=Math.max(0,wv.life)*0.30*(0.4+0.6*(pr.depth+1)/2);
      if(a<0.01) continue;
      cx.strokeStyle=`rgba(${rgb},${a.toFixed(3)})`; cx.lineWidth=Math.max(0.6,1.3*pr.sc);
      cx.beginPath(); cx.arc(pr.sx,pr.sy,sr,0,6.283); cx.stroke();
    }
    cx.restore();
  }
  cx.globalCompositeOperation='lighter';
  // particles (speakers), far -> near
  const pp=chP.map(p=>chProj(p,ay,ax,ox,oy,R)).sort((m,n)=>m.depth-n.depth);
  for(const q of pp){ const r=(1.8+2.2*q.sc)*(0.6+0.4*(q.depth+1)/2), al=(0.35+0.5*(q.depth+1)/2);
    const g=cx.createRadialGradient(q.sx,q.sy,0,q.sx,q.sy,r); g.addColorStop(0,`rgba(${rgb},${al.toFixed(2)})`); g.addColorStop(1,`rgba(${rgb},0)`);
    cx.fillStyle=g; cx.beginPath(); cx.arc(q.sx,q.sy,r,0,6.283); cx.fill(); }
  // corner mics, near ones brighter; glow with cluster activity
  cx.font='9px "Spline Sans Mono",monospace';
  for(const C of cp.slice().sort((m,n)=>m.depth-n.depth)){
    const pr=chCornerParams(C.i), r=(2.5+pr.gk*5)*C.sc, al=(0.3+pr.gk*0.6)*(0.55+0.45*(C.depth+1)/2);
    const g=cx.createRadialGradient(C.sx,C.sy,0,C.sx,C.sy,r*2);
    g.addColorStop(0,`rgba(${rgb},${al.toFixed(2)})`); g.addColorStop(1,`rgba(${rgb},0)`);
    cx.fillStyle=g; cx.beginPath(); cx.arc(C.sx,C.sy,r*2,0,6.283); cx.fill();
  }
  cx.globalCompositeOperation='source-over';
}
// ---- Alien Planet atmosphere: readout + gas-resonance spectrum ----
function fmtHz(f){ return f>=1000 ? (f/1000).toFixed(1)+'k' : Math.round(f); }
function updateAtmoReadout(){
  if(!alienAtmo) return;
  const res=alienAtmo.gases.map(g=>fmtHz(g.freq)).join(' · ');
  els.atmoReadout.innerHTML='<b>'+alienAtmo.name+'</b><br>'+alienAtmo.gases.length+' gases · resonances '+res+' Hz';
}
function drawAtmo(){
  const cv=els.atmoCanvas; if(!cv || !alienAtmo) return;
  const w=cv.clientWidth||300, h=cv.clientHeight||96;
  if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  const cx=cv.getContext('2d'); if(!cx) return;
  cx.clearRect(0,0,w,h);
  const rgb=hexRgb(ambColor), t=performance.now()/1000;
  const logx=f=>{ const lo=Math.log(80), hi=Math.log(9000); return (Math.log(f)-lo)/(hi-lo)*w; };
  cx.globalCompositeOperation='lighter';
  for(const g of alienAtmo.gases){
    const x=logx(g.freq), amp=g.gain*(0.7+0.3*Math.sin(t*g.rate*6+g.freq));   // gentle burble
    const bh=(h-12)*Math.min(1,amp);
    const grad=cx.createLinearGradient(0,h,0,h-bh);
    grad.addColorStop(0,`rgba(${rgb},0.12)`); grad.addColorStop(1,`rgba(${rgb},0.85)`);
    cx.fillStyle=grad; cx.fillRect(x-2.5, h-bh, 5, bh);
    cx.fillStyle=`rgba(${rgb},0.9)`; cx.beginPath(); cx.arc(x, h-bh, 2.5+2*(g.q/16), 0, 6.283); cx.fill();
  }
  cx.globalCompositeOperation='source-over';
}
els.spaceModes.addEventListener('click',e=>{
  const btn=e.target.closest('.tune'); if(!btn) return;
  spaceMode=btn.dataset.sm;
  els.spaceModes.querySelectorAll('.tune').forEach(b=>b.classList.toggle('active',b===btn));
  els.spaceDesc.textContent=SPACE_DESC[spaceMode]||'';
  syncSpaceModeUI();
  if(playing){stopPreview();startPreview();}
});
els.spaceAmt.addEventListener('input',()=>{
  spaceAmt=+els.spaceAmt.value;
  els.spaceAmtVal.textContent=spaceAmt+'%';
  liveUpdate();   // rides the dry/wet mix live (no rebuild)
});
// Chamber: Corners changes the tap count -> rebuild (on release); Size/Density/Movement live
// with the physics worklet, every control is live (the field is re-sent each frame) —
// corners just rebuilds the polyhedron; density/size/movement feed the field directly.
els.chCorners.addEventListener('input',()=>{ chamberCorners=+els.chCorners.value; els.chCornersVal.textContent=chamberCorners; chBuildPoly(); updateChMicRange(); });
els.chSize.addEventListener('input',()=>{ chamberSize=+els.chSize.value; els.chSizeVal.textContent=chamberSize+'%'; });
els.chDensity.addEventListener('input',()=>{ chamberDensity=+els.chDensity.value; els.chDensityVal.textContent=chamberDensity+'%'; updateChMicRange(); });
els.chMove.addEventListener('input',()=>{ chamberMove=+els.chMove.value; els.chMoveVal.textContent=chamberMove+'%'; });
// Reverse roles: swap speakers <-> mics (particles become the microphones, corners emit)
function updateChRolesLabel(){
  els.chRolesLabel.textContent = chamberReverse
    ? 'Confined 3D field — corners are speakers, particles are microphones'
    : 'Confined 3D field — particles are speakers, corners are microphones';
}
els.chReverseBtn.addEventListener('click',()=>{
  chamberReverse=!chamberReverse;
  els.chReverseBtn.classList.toggle('active', chamberReverse);
  els.chReverseBtn.textContent = '⇄ Reverse roles — ' + (chamberReverse?'on':'off');
  updateChRolesLabel();
  updateChMicRange();          // n flips between corner count and particle count
  if(playing && activeEngine && activeEngine.driveChamber) activeEngine.driveChamber(chain); // worklet re-posts live
});
// Mic activation: all at once, or round-robin between groups of `chMicGroup` mics (1..n-1)
// where n = corners (or particles when roles are reversed).
function updateChMicRange(){
  chEnsure();                                   // make sure chP reflects current density
  const n=chMicCount(), maxG=Math.max(1, n-1);
  els.chMicGroup.max=maxG;
  if(chMicGroup>maxG){ chMicGroup=maxG; els.chMicGroup.value=maxG; }
  els.chMicGroupVal.textContent=chMicGroup;
  els.chMicGroupMax.textContent='up to '+maxG+' (n='+n+')';
}
function updateChMicUI(){
  const rr=chMicRoundRobin;
  els.chMicModeBtn.classList.toggle('active', rr);
  els.chMicModeBtn.textContent = rr ? '◉ Mics — round-robin groups' : '◉ Mics — all at once';
  els.chMicRRControls.classList.toggle('dim', !rr);
  updateChMicRange();
}
els.chMicModeBtn.addEventListener('click',()=>{
  chMicRoundRobin=!chMicRoundRobin; updateChMicUI();
});
els.chMicGroup.addEventListener('input',()=>{ chMicGroup=+els.chMicGroup.value; els.chMicGroupVal.textContent=chMicGroup; });
els.chMicSpeed.addEventListener('input',()=>{ chMicSpeed=+els.chMicSpeed.value; els.chMicSpeedVal.textContent=chMicSpeed+'%'; });
els.chMicSmooth.addEventListener('input',()=>{ chMicSmooth=+els.chMicSmooth.value; els.chMicSmoothVal.textContent=chMicSmooth+'%'; });
// Alien Planet: roll a new random atmosphere -> new gas mix drives every effect (rebuild)
els.genAtmoBtn.addEventListener('click',()=>{
  alienAtmo=genAtmosphere();
  updateAtmoReadout();
  seedAmbient();                       // refresh the orb field to match the new world
  if(playing){stopPreview();startPreview();}
});
// Output: master volume, independent of Intensity
els.spaceVol.addEventListener('input',()=>{
  spaceVol=+els.spaceVol.value;
  els.spaceVolVal.textContent=spaceVol+'%';
  liveUpdate();
});
// Nebula Density: changes the particle/tap count. Update value + visual live on drag;
// rebuild the audio network only on release (count change == new nodes).
els.nebDensity.addEventListener('input',()=>{
  nebDensity=+els.nebDensity.value;
  els.nebDensityVal.textContent=nebDensity+'%';   // ambient loop reseeds the cloud
});
els.nebDensity.addEventListener('change',()=>{ if(playing){stopPreview();startPreview();} });
// Nebula Movement: pure scatter rate — fully live, no rebuild
els.nebMovement.addEventListener('input',()=>{
  nebMovement=+els.nebMovement.value;
  els.nebMovementVal.textContent=nebMovement+'%';
});
// Anomalies Warp depth — fully live (the driver reads warpAmt each frame)
// Warp × Time-reversal XY pad: drag sets the base point (warpBase x, revBase y).
// When Chaos is on the pendulum wanders the live point around that base (see loop).
function xyFromPointer(e){
  const r=els.xyPad.getBoundingClientRect();
  warpBase=Math.max(0,Math.min(100, Math.round((e.clientX-r.left)/r.width*100)));
  revBase =Math.max(0,Math.min(100, Math.round((1-(e.clientY-r.top)/r.height)*100)));
  els.warpAmtVal.textContent=warpBase+'%';
  els.revAmtVal.textContent=revBase+'%';
  if(!chaosOn){ warpAmt=warpBase; revAmt=revBase; }   // immediate when not modulated
}
let xyDrag=false;
els.xyPad.addEventListener('pointerdown',e=>{ xyDrag=true; els.xyPad.setPointerCapture(e.pointerId); xyFromPointer(e); e.preventDefault(); });
els.xyPad.addEventListener('pointermove',e=>{ if(xyDrag) xyFromPointer(e); });
els.xyPad.addEventListener('pointerup',e=>{ xyDrag=false; try{els.xyPad.releasePointerCapture(e.pointerId);}catch(_){} });
els.xyPad.addEventListener('pointercancel',()=>{ xyDrag=false; });

// Ring × Glitch XY pad: drag sets the base; chaos pendulum 2 wanders it (see loop)
function xy2FromPointer(e){
  const r=els.xyPad2.getBoundingClientRect();
  anomRingBase  =Math.max(0,Math.min(100, Math.round((e.clientX-r.left)/r.width*100)));
  anomGlitchBase=Math.max(0,Math.min(100, Math.round((1-(e.clientY-r.top)/r.height)*100)));
  els.anomRingVal.textContent=anomRingBase+'%';
  els.anomGlitchVal.textContent=anomGlitchBase+'%';
  if(!chaos2On){ anomRing=anomRingBase; anomGlitch=anomGlitchBase;
    if(playing && activeEngine && activeEngine.applyFx) activeEngine.applyFx(chain); }
}
let xy2Drag=false;
els.xyPad2.addEventListener('pointerdown',e=>{ xy2Drag=true; els.xyPad2.setPointerCapture(e.pointerId); xy2FromPointer(e); e.preventDefault(); });
els.xyPad2.addEventListener('pointermove',e=>{ if(xy2Drag) xy2FromPointer(e); });
els.xyPad2.addEventListener('pointerup',e=>{ xy2Drag=false; try{els.xyPad2.releasePointerCapture(e.pointerId);}catch(_){} });
els.xyPad2.addEventListener('pointercancel',()=>{ xy2Drag=false; });

// Routing — per-effect stage (0=off,1/2/3); same stage = parallel, higher = later.
// Changes the graph topology, so rebuild if playing.
els.fxRoute.addEventListener('change',e=>{
  const sel=e.target.closest('select'); if(!sel) return;
  fxStage[sel.dataset.fx]=+sel.value;
  if(playing){stopPreview();startPreview();}
});
// Chaos toggle (pad 1: warp × reversal) — modulator source, live, no rebuild
els.chaosBtn.addEventListener('click',()=>{
  chaosOn=!chaosOn;
  if(chaosOn){ chaosReset(); chaosTrail=[]; }
  els.chaosBtn.classList.toggle('active', chaosOn);
  els.chaosBtn.textContent = '⚛ Chaos pendulum — ' + (chaosOn?'on':'off');
  els.chaosCanvas.style.display = chaosOn ? 'block' : 'none';
});
// Chaos toggle (pad 2: ring × glitch) — second independent pendulum
els.chaosBtn2.addEventListener('click',()=>{
  chaos2On=!chaos2On;
  if(chaos2On){ chaosReset2(); chaosTrail2=[]; }
  els.chaosBtn2.classList.toggle('active', chaos2On);
  els.chaosBtn2.textContent = '⚛ Chaos pendulum — ' + (chaos2On?'on':'off');
  els.chaosCanvas2.style.display = chaos2On ? 'block' : 'none';
});

// --- direct (live) audio input ---
// host calls this back after getUserMedia resolves (or fails)
onLiveInputChange = (on, err) => {
  els.liveInBtn.classList.toggle('active', on);
  els.liveInBtn.textContent = on ? '🎙 Live input on — click to stop' : '🎙 Use live input — mic / line-in';
  if(err){
    els.liveInNote.textContent = 'Microphone access was blocked. Allow it in the browser, or open over http/https (file:// may deny it).';
  }else if(on){
    els.liveInNote.innerHTML = 'Live — your mic / line-in is now the source. Hit <b>Preview</b> to hear it processed. Use headphones to avoid feedback.';
    els.controls.classList.remove('hidden');   // expose engine params even without a file
    resizeVisualCanvases();
  }else{
    els.liveInNote.textContent = 'Processes your mic or line-in in real time. Use headphones to avoid feedback.';
  }
  updateTransport();
};
els.liveInBtn.addEventListener('click',async ()=>{
  if(liveInput){ disableLiveInput(); return; }
  els.liveInBtn.textContent = '🎙 Requesting mic…';
  await enableLiveInput();
});

// Latch-to-last (live reverse): hold the last sound and keep replaying it reversed
els.revLatchBtn.addEventListener('click',()=>{
  revLatch=!revLatch;
  els.revLatchBtn.classList.toggle('active', revLatch);
  els.revLatchBtn.textContent = '⇄ Latch to last — ' + (revLatch?'on':'off');
});

/* ---------- ROOM engine: materials · dims · positions · 3D view · IR bake ---------- */
let roomMatsFilled=false, roomInited=false, roomBakeT=null;
// --- shoebox named materials (West/East/South/North/Floor/Ceiling) ---
function fillRoomMats(){
  if(roomMatsFilled) return; roomMatsFilled=true;
  const opts=Object.keys(ROOM_MATERIALS).map(k=>`<option value="${k}">${ROOM_MATERIALS[k].name}</option>`).join('');
  els.roomMats.querySelectorAll('select').forEach(sel=>{
    sel.innerHTML=opts; sel.value=roomWalls[+sel.dataset.wall];
    sel.addEventListener('change',()=>{ roomWalls[+sel.dataset.wall]=sel.value; scheduleRoomBake(); });
  });
}
// --- custom per-edge materials (Wall 1..N + Floor + Ceiling), rebuilt when the polygon changes ---
function buildCustomMats(){
  ensureCustomInit();
  if(roomEdgeMat.length!==roomFloorPoly.length) roomEdgeMat=roomFloorPoly.map((_,i)=>roomEdgeMat[i]||'plaster');
  const opts=Object.keys(ROOM_MATERIALS).map(k=>`<option value="${k}">${ROOM_MATERIALS[k].name}</option>`).join('');
  let html=roomEdgeMat.map((m,i)=>`<label>Wall ${i+1}<select data-edge="${i}">${opts}</select></label>`).join('');
  html+=`<label>Floor<select data-floor="1">${opts}</select></label><label>Ceiling<select data-ceil="1">${opts}</select></label>`;
  els.roomMatsCustom.innerHTML=html;
  els.roomMatsCustom.querySelectorAll('select').forEach(sel=>{
    if(sel.dataset.edge!=null) sel.value=roomEdgeMat[+sel.dataset.edge];
    else if(sel.dataset.floor!=null) sel.value=roomFloorMat; else sel.value=roomCeilMat;
    sel.addEventListener('change',()=>{
      if(sel.dataset.edge!=null) roomEdgeMat[+sel.dataset.edge]=sel.value;
      else if(sel.dataset.floor!=null) roomFloorMat=sel.value; else roomCeilMat=sel.value;
      scheduleRoomBake();
    });
  });
}
function ensureCustomInit(){ if(!roomFloorPoly || roomFloorPoly.length<3){
  roomFloorPoly=[[0,0],[roomW,0],[roomW,roomL],[0,roomL]]; roomEdgeMat=['plaster','plaster','plaster','plaster']; } }
// debounce IR bakes (a compute pass); swap the fresh IR into a live convolver
function scheduleRoomBake(){
  els.roomBakeNote.textContent='Baking impulse response…'; els.roomBakeNote.classList.remove('err');
  if(roomBakeT) clearTimeout(roomBakeT);
  roomBakeT=setTimeout(async ()=>{
    await bakeRoomIR(ctx?ctx.sampleRate:44100);
    if(playing && activeEngine && activeEngine.applyRoomIR) activeEngine.applyRoomIR(chain);
  }, 220);
}
onRoomBake=(gpu, rays, dur)=>{
  els.roomBakeNote.innerHTML='✓ IR '+dur.toFixed(2)+'s · '+rays.toLocaleString()+' rays · '+
    (gpu?'<b>GPU</b> (WebGPU)':(roomMode==='custom'?'CPU (custom geometry)':'CPU — WebGPU unavailable'));
};
function bindRoomSlider(el, valEl, fn, fmt, rebake){
  if(!el) return;
  el.addEventListener('input',()=>{ fn(+el.value); if(valEl&&fmt) valEl.textContent=fmt(+el.value);
    if(rebake) scheduleRoomBake();
    else if(playing && activeEngine && activeEngine.liveUpdate) activeEngine.liveUpdate(chain); });
}
// selected-speaker XYZ (edits roomSrcs[roomSelSrc])
function bindSpkSlider(el, valEl, key){ if(!el) return;
  el.addEventListener('input',()=>{ roomSrcs[roomSelSrc][key]=(+el.value)/100; valEl.textContent=(+el.value)+'%'; scheduleRoomBake(); }); }
bindRoomSlider(els.roomWSl, els.roomWVal, v=>roomW=v, v=>v+' m', true);
bindRoomSlider(els.roomLSl, els.roomLVal, v=>roomL=v, v=>v+' m', true);
bindRoomSlider(els.roomHSl, els.roomHVal, v=>roomH=v, v=>v+' m', true);
bindSpkSlider(els.srcZ, els.srcZVal, 'z');                        // speaker/mic XY come from dragging; only height is a slider
bindRoomSlider(els.lisZ, els.lisZVal, v=>roomLis.z=v/100, v=>v+'%', true);
bindRoomSlider(els.micAng, els.micAngVal, v=>roomMicAngle=v, v=>v+'°', true);       // rotate the stereo axis
bindRoomSlider(els.micSep, els.micSepVal, v=>roomMicSep=v/100, v=>v+'cm', true);    // L/R capsule separation
bindRoomSlider(els.roomQual, els.roomQualVal, v=>roomQuality=v, v=>v+'%', true);
bindRoomSlider(els.roomWetSl, els.roomWetVal, v=>roomWet=v, v=>v+'%', false);
bindRoomSlider(els.roomVolSl, els.roomVolVal, v=>roomVol=v, v=>v+'%', false);

// --- speaker list (add / remove / select) ---
function renderSpkList(){
  let html=roomSrcs.map((s,i)=>`<span class="room-spk${i===roomSelSrc?' active':''}${s.lock?' locked':''}" data-i="${i}">Spk ${i+1} <span class="lockbtn" data-lock="${i}" title="lock position">${s.lock?'🔒':'🔓'}</span>${roomSrcs.length>1?` <span class="x" data-del="${i}" title="remove">×</span>`:''}</span>`).join('');
  html+=`<button class="room-spk-add" id="roomSpkAdd">+ speaker</button>`;
  els.roomSpkList.innerHTML=html;
  els.roomSpkCount.textContent='· '+roomSrcs.length;
}
function syncSrcSliders(){ const s=roomSrcs[roomSelSrc];   // only height is a slider now (XY = drag)
  els.srcZ.value=Math.round(s.z*100); els.srcZVal.textContent=Math.round(s.z*100)+'%'; }
function addSpeaker(){ roomSrcs.push({x:0.5+(Math.random()-0.5)*0.3, y:0.5+(Math.random()-0.5)*0.3, z:0.4, lock:false});
  roomSelSrc=roomSrcs.length-1; renderSpkList(); syncSrcSliders(); scheduleRoomBake(); }
function removeSpeaker(i){ if(roomSrcs.length<=1) return; roomSrcs.splice(i,1); roomSelSrc=Math.min(roomSelSrc, roomSrcs.length-1);
  renderSpkList(); syncSrcSliders(); scheduleRoomBake(); }
els.roomSpkList.addEventListener('click', e=>{
  const lk=e.target.closest('[data-lock]'); if(lk){ const i=+lk.dataset.lock; roomSrcs[i].lock=!roomSrcs[i].lock; renderSpkList(); drawRoomPlan(); e.stopPropagation(); return; }
  const del=e.target.closest('[data-del]'); if(del){ removeSpeaker(+del.dataset.del); e.stopPropagation(); return; }
  if(e.target.id==='roomSpkAdd'){ addSpeaker(); return; }
  const chip=e.target.closest('[data-i]'); if(chip){ roomSelSrc=+chip.dataset.i; renderSpkList(); syncSrcSliders(); }
});
// stereo-mic lock
els.micLock.addEventListener('click', ()=>{ roomLis.lock=!roomLis.lock; els.micLock.textContent=roomLis.lock?'🔒':'🔓'; drawRoomPlan(); });

// --- shape toggle + presets ---
function setRoomShape(mode){
  roomMode=mode;
  els.roomShape.querySelectorAll('.tune').forEach(b=>b.classList.toggle('active', b.dataset.shape===mode));
  els.roomBoxDims.style.display = mode==='box'?'':'none';
  els.roomCustom.style.display  = mode==='custom'?'':'none';
  els.roomMats.style.display       = mode==='box'?'grid':'none';
  els.roomMatsCustom.style.display = mode==='custom'?'grid':'none';
  if(mode==='custom'){ ensureCustomInit(); buildCustomMats(); drawRoomPlan(); }
  scheduleRoomBake();
}
els.roomShape.addEventListener('click', e=>{ const b=e.target.closest('[data-shape]'); if(b) setRoomShape(b.dataset.shape); });
function applyPreset(name){
  const W=roomW, L=roomL, cx=W/2, cy=L/2, r=Math.min(W,L)/2;
  if(name==='rect') roomFloorPoly=[[0,0],[W,0],[W,L],[0,L]];
  else if(name==='ell') roomFloorPoly=[[0,0],[W,0],[W,L*0.5],[W*0.45,L*0.5],[W*0.45,L],[0,L]];
  else if(name==='hex'){ roomFloorPoly=[]; for(let i=0;i<6;i++){ const a=Math.PI/6+i*Math.PI/3; roomFloorPoly.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]); } }
  else if(name==='oct'){ roomFloorPoly=[]; for(let i=0;i<8;i++){ const a=Math.PI/8+i*Math.PI/4; roomFloorPoly.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]); } }
  roomEdgeMat=roomFloorPoly.map(()=>'plaster'); buildCustomMats(); drawRoomPlan(); scheduleRoomBake();
}
els.roomPresets.addEventListener('click', e=>{ const b=e.target.closest('[data-preset]'); if(b) applyPreset(b.dataset.preset); });

// --- top-down placement / floor-plan editor: drag speakers + listener (both modes),
//     drag/insert/remove vertices (custom mode only) ---
let planT=null, planDrag=null, planDragI=-1;
function drawLockRing(cx,x,y,r){ cx.strokeStyle='rgba(230,237,243,0.75)'; cx.lineWidth=1.4; cx.beginPath(); cx.arc(x,y,r,0,6.283); cx.stroke();
  cx.fillStyle='rgba(230,237,243,0.9)'; cx.font='9px "Spline Sans Mono",monospace'; cx.fillText('🔒', x+r*0.8, y-r*0.8); }
function drawRoomPlan(){
  const cv=els.roomPlanCanvas; if(!cv) return;
  const w=cv.clientWidth||280, h=cv.clientHeight||w; if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
  const cx=cv.getContext('2d'); if(!cx) return; cx.clearRect(0,0,w,h);
  const poly=roomGeom().poly; if(!poly||poly.length<3) return;   // rectangle in box mode, polygon in custom
  const bb=roomBBox(poly), pad=24, bw=(bb.maxx-bb.minx)||1, bh=(bb.maxy-bb.miny)||1, scale=Math.min((w-2*pad)/bw,(h-2*pad)/bh);
  const ox=(w-bw*scale)/2 - bb.minx*scale, oy=(h-bh*scale)/2 - bb.miny*scale; planT={ox,oy,scale};
  const M2P=(x,y)=>[ox+x*scale, oy+y*scale], rgb=hexRgb(ambColor);
  cx.beginPath(); poly.forEach((p,i)=>{ const q=M2P(p[0],p[1]); i?cx.lineTo(q[0],q[1]):cx.moveTo(q[0],q[1]); }); cx.closePath();
  cx.fillStyle=`rgba(${rgb},0.06)`; cx.fill(); cx.strokeStyle=`rgba(${rgb},0.7)`; cx.lineWidth=1.5; cx.stroke();
  if(roomMode==='custom') poly.forEach(p=>{ const q=M2P(p[0],p[1]); cx.fillStyle=`rgba(${rgb},0.9)`; cx.beginPath(); cx.arc(q[0],q[1],4,0,6.283); cx.fill(); });
  // speakers (warm, draggable unless locked)
  roomSrcsM().forEach((s,i)=>{ const q=M2P(s[0],s[1]); const sel=(i===roomSelSrc);
    const g=cx.createRadialGradient(q[0],q[1],0,q[0],q[1],11); g.addColorStop(0,'rgba(255,220,150,0.9)'); g.addColorStop(1,'rgba(255,220,150,0)');
    cx.fillStyle=g; cx.beginPath(); cx.arc(q[0],q[1],11,0,6.283); cx.fill();
    cx.fillStyle='rgba(255,235,180,1)'; cx.beginPath(); cx.arc(q[0],q[1],sel?6:5,0,6.283); cx.fill();
    if(sel && roomSrcs.length>1){ cx.strokeStyle='rgba(255,235,180,0.9)'; cx.lineWidth=1.5; cx.beginPath(); cx.arc(q[0],q[1],9,0,6.283); cx.stroke(); }
    if(roomSrcs[i].lock) drawLockRing(cx,q[0],q[1],10); });
  // stereo microphone (accent): centre + L/R capsules along the rotated axis, at the set separation
  const lm=roomLisM(), lq=M2P(lm[0],lm[1]), ears=roomMicEars(), Lp=M2P(ears[0][0],ears[0][1]), Rp=M2P(ears[1][0],ears[1][1]);
  const lg=cx.createRadialGradient(lq[0],lq[1],0,lq[0],lq[1],12); lg.addColorStop(0,`rgba(${rgb},0.85)`); lg.addColorStop(1,`rgba(${rgb},0)`);
  cx.fillStyle=lg; cx.beginPath(); cx.arc(lq[0],lq[1],12,0,6.283); cx.fill();
  // forward tick (perpendicular to the L↔R axis) shows the rotation
  const ar=roomMicAngle*Math.PI/180;
  cx.strokeStyle=`rgba(${rgb},0.5)`; cx.lineWidth=1.2; cx.beginPath(); cx.moveTo(lq[0],lq[1]); cx.lineTo(lq[0]-Math.sin(ar)*13, lq[1]+Math.cos(ar)*13); cx.stroke();
  cx.strokeStyle=`rgba(${rgb},0.7)`; cx.lineWidth=1.5; cx.beginPath(); cx.moveTo(Lp[0],Lp[1]); cx.lineTo(Rp[0],Rp[1]); cx.stroke();
  cx.fillStyle=`rgba(${rgb},1)`; cx.beginPath(); cx.arc(Lp[0],Lp[1],3.4,0,6.283); cx.fill(); cx.beginPath(); cx.arc(Rp[0],Rp[1],3.4,0,6.283); cx.fill();
  cx.fillStyle=`rgba(${rgb},0.55)`; cx.font='8px "Spline Sans Mono",monospace'; cx.fillText('L',Lp[0]-2,Lp[1]-5); cx.fillText('R',Rp[0]-2,Rp[1]-5);
  if(roomLis.lock) drawLockRing(cx,lq[0],lq[1],14);
}
function planToM(px,py){ return planT?[(px-planT.ox)/planT.scale, (py-planT.oy)/planT.scale]:[0,0]; }
function planP2(x,y){ return [planT.ox+x*planT.scale, planT.oy+y*planT.scale]; }
els.roomPlanCanvas.addEventListener('pointerdown', e=>{
  if(!planT) return; const r=els.roomPlanCanvas.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
  // 1) a speaker dot? (clicking selects it; only drags if unlocked)
  const srcs=roomSrcsM();
  for(let i=0;i<srcs.length;i++){ const q=planP2(srcs[i][0],srcs[i][1]); if(Math.hypot(q[0]-px,q[1]-py)<15){
    roomSelSrc=i; renderSpkList(); syncSrcSliders();
    if(!roomSrcs[i].lock){ planDrag='spk'; planDragI=i; try{els.roomPlanCanvas.setPointerCapture(e.pointerId);}catch(_){} } return; } }
  // 2) the stereo mic? (only drags if unlocked)
  const lm=roomLisM(), lq=planP2(lm[0],lm[1]); if(Math.hypot(lq[0]-px,lq[1]-py)<15){
    if(!roomLis.lock){ planDrag='lis'; try{els.roomPlanCanvas.setPointerCapture(e.pointerId);}catch(_){} } return; }
  // 3) custom geometry: drag a vertex, or click an edge to insert one
  if(roomMode==='custom'){
    let vi=-1, vd=12; roomFloorPoly.forEach((p,i)=>{ const q=planP2(p[0],p[1]); const d=Math.hypot(q[0]-px,q[1]-py); if(d<vd){vd=d;vi=i;} });
    if(vi>=0){ planDrag='vertex'; planDragI=vi; try{els.roomPlanCanvas.setPointerCapture(e.pointerId);}catch(_){} return; }
    const [mx,my]=planToM(px,py); let bd=1e9, bi=-1, bp=null;
    for(let i=0;i<roomFloorPoly.length;i++){ const a=roomFloorPoly[i], b=roomFloorPoly[(i+1)%roomFloorPoly.length], ex=b[0]-a[0], ey=b[1]-a[1], L2=ex*ex+ey*ey||1e-9;
      let t=((mx-a[0])*ex+(my-a[1])*ey)/L2; t=Math.max(0,Math.min(1,t)); const qx=a[0]+ex*t, qy=a[1]+ey*t, d=Math.hypot(mx-qx,my-qy); if(d<bd){bd=d;bi=i;bp=[qx,qy];} }
    if(bi>=0 && bd < 16/planT.scale){ roomFloorPoly.splice(bi+1,0,bp); roomEdgeMat.splice(bi+1,0, roomEdgeMat[bi]||'plaster'); buildCustomMats(); drawRoomPlan(); scheduleRoomBake(); }
  }
});
els.roomPlanCanvas.addEventListener('pointermove', e=>{
  if(!planDrag||!planT) return; const r=els.roomPlanCanvas.getBoundingClientRect(), m=planToM(e.clientX-r.left, e.clientY-r.top);
  if(planDrag==='vertex'){ roomFloorPoly[planDragI]=[Math.round(m[0]*10)/10, Math.round(m[1]*10)/10]; }
  else {                                                        // speaker / listener → store as fraction of the room bbox (clamped inside on use)
    const bb=roomBBox(roomGeom().poly);
    let fx=(m[0]-bb.minx)/((bb.maxx-bb.minx)||1), fy=(m[1]-bb.miny)/((bb.maxy-bb.miny)||1);
    fx=Math.max(0,Math.min(1,fx)); fy=Math.max(0,Math.min(1,fy));
    const tgt = planDrag==='spk' ? roomSrcs[planDragI] : roomLis; tgt.x=fx; tgt.y=fy;
  }
  drawRoomPlan(); scheduleRoomBake();
});
els.roomPlanCanvas.addEventListener('pointerup', e=>{ if(planDrag){ planDrag=null; planDragI=-1; try{els.roomPlanCanvas.releasePointerCapture(e.pointerId);}catch(_){} } });
els.roomPlanCanvas.addEventListener('dblclick', e=>{ if(roomMode!=='custom'||!planT) return; const r=els.roomPlanCanvas.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
  let vi=-1, vd=12; roomFloorPoly.forEach((p,i)=>{ const q=planP2(p[0],p[1]); const d=Math.hypot(q[0]-px,q[1]-py); if(d<vd){vd=d;vi=i;} });
  if(vi>=0 && roomFloorPoly.length>3){ roomFloorPoly.splice(vi,1); roomEdgeMat.splice(vi,1); buildCustomMats(); drawRoomPlan(); scheduleRoomBake(); } });

function initRoomUI(){ fillRoomMats(); renderSpkList(); syncSrcSliders(); drawRoomPlan(); if(!roomInited){ roomInited=true; scheduleRoomBake(); } }

// ---- rotating perspective 3D room view (polygon walls + rays + speakers/mic) ----
function roomProj(x,y,z, ay,ax, ox,oy,R){          // y is up
  const x1=x*Math.cos(ay)+z*Math.sin(ay), z1=-x*Math.sin(ay)+z*Math.cos(ay);
  const y2=y*Math.cos(ax)-z1*Math.sin(ax), z2=y*Math.sin(ax)+z1*Math.cos(ax);
  const persp=1.9/(1.9-z2*0.5);
  return { sx:ox+x1*R*persp, sy:oy-y2*R*persp, depth:z2, sc:persp };
}
// sample ray path through the current polygon (for the 3D view)
function roomRayPathPoly(S, dx,dy,dz, poly, H, bounces){
  const pts=[[S[0],S[1],S[2]]]; let px=S[0],py=S[1],pz=S[2], ddx=dx,ddy=dy,ddz=dz, np=poly.length;
  for(let b=0;b<bounces;b++){
    let tH=1e9, hit=-1, nx=0, ny=0;
    if(ddz>1e-9){ const t=(H-pz)/ddz; if(t<tH){tH=t;hit=-3;} } else if(ddz<-1e-9){ const t=-pz/ddz; if(t<tH){tH=t;hit=-2;} }
    for(let e=0;e<np;e++){ const a=poly[e], bb=poly[(e+1)%np], ex=bb[0]-a[0], ey=bb[1]-a[1], det=ex*ddy-ddx*ey; if(Math.abs(det)<1e-12) continue;
      const rx=a[0]-px, ry=a[1]-py, t=(ex*ry-rx*ey)/det, s=(ddx*ry-ddy*rx)/det;
      if(t>1e-6 && s>=-1e-6 && s<=1.000001 && t<tH){ tH=t; hit=e; const l=Math.hypot(ey,-ex)||1; nx=ey/l; ny=-ex/l; } }
    if(hit===-1) break;
    px+=ddx*tH; py+=ddy*tH; pz+=ddz*tH; pts.push([px,py,pz]);
    if(hit<0) ddz=-ddz; else { const dot=ddx*nx+ddy*ny; ddx-=2*dot*nx; ddy-=2*dot*ny; }
    px+=ddx*1e-4; py+=ddy*1e-4; pz+=ddz*1e-4;   // nudge inward so the next segment can't leak past an edge/corner
  }
  return pts;
}
function drawRoomInline(){
  const cv=els.roomCanvas; if(!cv) return;
  const w=cv.clientWidth||300, h=cv.clientHeight||Math.round(w*0.75);
  if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
  const cx=cv.getContext('2d'); if(!cx) return; cx.clearRect(0,0,w,h);
  const g=roomGeom(), poly=g.poly, H=g.H, bb=roomBBox(poly);
  const cX=(bb.minx+bb.maxx)/2, cY=(bb.miny+bb.maxy)/2, mx=Math.max(bb.maxx-bb.minx, bb.maxy-bb.miny, H, 1);
  const rgb=hexRgb(ambColor), ox=w/2, oy=h/2, t=performance.now()/1000, ay=t*0.20, axr=-0.5, R=Math.min(w,h)*0.60;
  const PM=(X,Y,Z)=>roomProj((X-cX)/mx, (Z-H/2)/mx, (Y-cY)/mx, ay,axr,ox,oy,R);
  const flo=poly.map(p=>PM(p[0],p[1],0)), cei=poly.map(p=>PM(p[0],p[1],H)), nB=poly.length;
  cx.lineWidth=1;
  const loop=(pts,al)=>{ for(let i=0;i<pts.length;i++){ const A=pts[i], B=pts[(i+1)%pts.length], dep=(A.depth+B.depth)/2;
    cx.strokeStyle=`rgba(${rgb},${(al*(0.5+0.5*(dep+1)/2)).toFixed(3)})`; cx.beginPath(); cx.moveTo(A.sx,A.sy); cx.lineTo(B.sx,B.sy); cx.stroke(); } };
  loop(flo,0.30); loop(cei,0.30);
  for(let i=0;i<nB;i++){ const A=flo[i], B=cei[i], dep=(A.depth+B.depth)/2; cx.strokeStyle=`rgba(${rgb},${(0.10+0.14*(dep+1)/2).toFixed(3)})`; cx.beginPath(); cx.moveTo(A.sx,A.sy); cx.lineTo(B.sx,B.sy); cx.stroke(); }
  cx.globalCompositeOperation='lighter';
  const GA=Math.PI*(3-Math.sqrt(5)), srcs=roomSrcsM(), NR=Math.max(6, Math.round(16/srcs.length));
  srcs.forEach((S,si)=>{ for(let i=0;i<NR;i++){ const up=1-2*(i+0.5)/NR, rr=Math.sqrt(Math.max(0,1-up*up)), th=GA*i+t*0.3+si;
    const path=roomRayPathPoly(S, Math.cos(th)*rr, Math.sin(th)*rr, up, poly, H, 3);
    cx.strokeStyle=`rgba(${rgb},0.12)`; cx.lineWidth=1; cx.beginPath();
    for(let p=0;p<path.length;p++){ const P=PM(path[p][0],path[p][1],path[p][2]); if(p===0)cx.moveTo(P.sx,P.sy);else cx.lineTo(P.sx,P.sy); }
    cx.stroke(); } });
  const drawNode=(M,rad,warm,sel)=>{ const P=PM(M[0],M[1],M[2]), r=rad*P.sc, col=warm?'255,235,180':rgb;
    const gr=cx.createRadialGradient(P.sx,P.sy,0,P.sx,P.sy,r*2.4); gr.addColorStop(0,`rgba(${col},0.95)`); gr.addColorStop(1,`rgba(${col},0)`);
    cx.fillStyle=gr; cx.beginPath(); cx.arc(P.sx,P.sy,r*2.4,0,6.283); cx.fill();
    cx.fillStyle=`rgba(${col},1)`; cx.beginPath(); cx.arc(P.sx,P.sy,r*0.7,0,6.283); cx.fill();
    if(sel){ cx.strokeStyle=`rgba(${col},0.8)`; cx.lineWidth=1; cx.beginPath(); cx.arc(P.sx,P.sy,r*1.7,0,6.283); cx.stroke(); } };
  srcs.forEach((S,i)=> drawNode(S,3.6,true, i===roomSelSrc && srcs.length>1));
  drawNode(roomLisM(),4,false,false);
  cx.globalCompositeOperation='source-over';
}

els.play.addEventListener('click',async ()=>{
  if(playing){ stopPreview(); return; }
  // Chamber uses an AudioWorklet — make sure its module is loaded on ctx before we build
  if(activeEngine && activeEngine.id==='space' && spaceMode==='chamber'){
    ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
    await ensureChamberWorklet(ctx);
  }
  // Room: bake the IR at the context's sample rate (GPU if available) before building
  if(activeEngine && activeEngine.id==='room'){
    ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
    if(!roomIRData || roomIRData.sr!==ctx.sampleRate) await bakeRoomIR(ctx.sampleRate);
  }
  startPreview();
});
els.render.addEventListener('click',render);

distanceM=+els.dist.value;     // sync engine to the slider's initial value
startAmbient();                // engine-themed background animation (always on)
setEngine('field');            // default engine: paints the FxRxS wheel + transport state
renderBedList();
refreshUploadedGroup();
drawField();
resizeVisualCanvases();
updateChMicRange();            // set the round-robin group-size max to n−1 (corners by default)
