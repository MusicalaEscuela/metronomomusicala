/* ===========================================
   Metrónomo Musicala – script.js (versión pro)
   - Scheduler Web Audio con PPQ=12 (alta precisión)
   - Péndulo sincronizado al beat (play/pause/re-sync)
   - Grooves 4/4 y 3/4 exactos, independientes de la subdivisión UI
   - Auto-ajuste de compás según groove seleccionado
   - “Vals 3/4” se silencia si el compás no es 3/4 (con aviso) —aunque autoajustamos
   - El clic se silencia si una pista está activa o si hay incompatibilidad
   =========================================== */

let isPlaying = false;

// ===== Web Audio =====
const audioContext = (window.drumLoader?.ctx) || new (window.AudioContext || window.webkitAudioContext)();

// ===== DOM =====
const bpmInput   = document.getElementById("bpm");
const compasSel  = document.getElementById("compas");
const subdivSel  = document.getElementById("subdivision");
const sonidoSel  = document.getElementById("sonido");
const toggleBtn  = document.getElementById("toggleBtn");
const resetBtn   = document.getElementById("resetBtn");
const bpmUpBtn   = document.getElementById("bpmUp");
const bpmDownBtn = document.getElementById("bpmDown");
const tapBtn     = document.getElementById("tapBtn");
const tapAvgEl   = document.getElementById("tapAvg");
const volumeEl   = document.getElementById("volumen");
const accentEl   = document.getElementById("accent");
const beatLightsWrap = document.getElementById("beatLights");
const patternButtons = document.getElementById("patternButtons");
const patternNotice  = document.getElementById("patternNotice");
const pendulumArm    = document.querySelector(".arm");

// ===== Util =====
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const bpm   = ()=> clamp(Number(bpmInput.value)||120,30,300);

// ====== Tap tempo ======
let tapTimes = [];
function handleTap(){
  const now = performance.now();
  tapTimes = tapTimes.filter(t => now - t < 2500);
  tapTimes.push(now);
  if (tapTimes.length>=2){
    const ints=[]; for(let i=1;i<tapTimes.length;i++) ints.push(tapTimes[i]-tapTimes[i-1]);
    const avg = ints.reduce((a,b)=>a+b,0)/ints.length;
    const calc = clamp(Math.round(60000/avg),30,300);
    bpmInput.value = String(calc);
    tapAvgEl.textContent = `${calc} BPM`;
    onTempoChanged();
  } else {
    tapAvgEl.textContent = "—";
  }
}

// ====== Beat lights ======
function buildBeatLights(){
  beatLightsWrap.innerHTML="";
  const beats = Number(compasSel.value);
  for(let i=0;i<beats;i++){
    const d=document.createElement("div");
    d.className="led"; if(i===0) d.classList.add("first");
    beatLightsWrap.appendChild(d);
  }
  setActiveBeatLight(-1);
}
function setActiveBeatLight(index){
  const leds = beatLightsWrap.querySelectorAll(".led");
  leds.forEach((el,i)=> el.classList.toggle("on", i===index));
}

// ====== Péndulo ======
function setPendulumSpeed(){
  const beatSec = 60 / bpm();
  document.documentElement.style.setProperty("--beat-sec", `${beatSec}`);
}
function pendulumPlay(){
  if (!pendulumArm) return;
  pendulumArm.classList.add("playing");
}
function pendulumPause(){
  if (!pendulumArm) return;
  pendulumArm.classList.remove("playing");
}
function pendulumResync(){
  // “Reinicia” la animación justo en el 1 del compás
  if (!pendulumArm) return;
  pendulumArm.classList.add("resync");
  // Forzamos reflow y re-aplicamos animación
  void pendulumArm.offsetWidth;
  pendulumArm.classList.add("reapply");
  // Limpiamos para siguientes resyncs
  setTimeout(()=>{ pendulumArm.classList.remove("resync","reapply"); },0);
}

// ====== Click / sonidos ======
function playClickAt(time, isAccent){
  const vol = Number(volumeEl.value);
  const osc = audioContext.createOscillator();
  const gain= audioContext.createGain();
  osc.type="square";
  osc.frequency.value = isAccent ? 1400 : 1000;
  gain.gain.value = clamp(isAccent ? vol*0.7 : vol*0.45, 0, 1);
  osc.connect(gain).connect(audioContext.destination);
  osc.start(time);
  osc.stop(time+0.04);
}

const Drum = {
  loaded: false,
  async ensure(){
    // Si drumLoader ya precargó (wav o mp3), esto devuelve de cache por nombre.
    if (!window.drumLoader){ this.loaded=false; return; }
    if (this.loaded) return;
    await Promise.all([
      drumLoader.load("bombo","bombo.mp3"),
      drumLoader.load("platillo","platillo.mp3"),
      drumLoader.load("redoblante","redoblante.mp3"),
    ]).catch(()=>{}); // si ya están cacheados con .wav, no pasa nada
    this.loaded=true;
  },
  play(name, time, gain=0.9){
    if (window.drumLoader && this.loaded){
      drumLoader.playBuffer(name, time, gain);
    } else {
      // fallback simple si no hay buffers: funcional pero menos preciso
      const a = new Audio(`${name}.mp3`);
      a.volume = clamp(Number(volumeEl.value),0,1);
      a.play();
    }
  }
};

// ====== Grooves ======
// Definidos en CUENTAS MUSICALES (corcheas por compás)
// 4/4 -> grid 8; 3/4 -> grid 6
const PATTERNS = {
  groove1: { compas:[4], grid:8,
    parts:{
      bombo:[0,4], redoblante:[2,6], platillo:[0,1,2,3,4,5,6,7]
    }
  },
  groove2: { compas:[4], grid:8,
    parts:{
      bombo:[0,3,4,7], redoblante:[2,6], platillo:[0,1,2,3,4,5,6,7]
    }
  },
  // Vals 3/4: ride/HH en negras, BD en 1, SN en 2 y 3
  waltz34: { compas:[3], grid:6,
    parts:{
      bombo:[0], redoblante:[2,4], platillo:[0,2,4]
    }
  }
};
let activePattern="off";

// Reglas de auto-métrica por groove
const PATTERN_METER = {
  groove1: 4,
  groove2: 4,
  waltz34: 3
};

// Mapeo a PPQ (12 por negra). Para 4/4 => 48 ppq por compás; para 3/4 => 36.
const PPQ = 12;
let patternPPQ = null;

// Si un patrón es incompatible con el compás, forzamos silencio total y mostramos aviso.
let muteWhenIncompatible = false;

// Devuelve Sets con pasos PPQ exactos para el compás actual
function mapPatternToPPQ(){
  if (activePattern==="off") {
    muteWhenIncompatible = false;
    patternNotice && (patternNotice.textContent = "Pista apagada.");
    return null;
  }
  const pat = PATTERNS[activePattern];
  const beats = Number(compasSel.value);

  // Incompatible con el compás actual
  if (!pat || !pat.compas.includes(beats)) {
    if (activePattern === "waltz34") {
      muteWhenIncompatible = true; // silencio total (ni clic ni groove)
      patternNotice && (patternNotice.textContent = "“Vals 3/4” solo se puede activar en compás 3/4.");
    } else {
      muteWhenIncompatible = false;
      patternNotice && (patternNotice.textContent = "Esta pista no coincide con el compás actual.");
    }
    return null;
  }

  // Compatible
  muteWhenIncompatible = false;

  const stepsPerBar = beats * PPQ;              // p.ej. 4*12 = 48
  const qPerCell    = stepsPerBar / pat.grid;   // p.ej. 48/8 = 6 (corchea)

  const m = {};
  for (const part of Object.keys(pat.parts)){
    m[part] = new Set(pat.parts[part].map(idx => Math.round(idx*qPerCell)) );
  }
  patternNotice && (patternNotice.textContent = "Pista activa y sincronizada al tempo.");
  return { ...m, stepsPerBar };
}

// UI pista
function setPatternSelectedUI(id){
  if (!patternButtons) return;
  [...patternButtons.querySelectorAll(".pat-btn")].forEach(btn=>{
    btn.classList.toggle("selected", btn.dataset.pattern===id);
  });
}
function updateClickControlsDisabled(disabled){
  sonidoSel.disabled = disabled;
  accentEl.disabled  = disabled;
}

// ====== Scheduler (alta precisión) ======
// Reloj maestro: PPQ=12 -> cada "tick" = (60/BPM)/12 segundos
let nextNoteTime = 0;   // en segundos (audioContext)
let currentPPQ   = 0;   // posición PPQ absoluta
let scheduleTimer = null;

const scheduleAheadTime = 0.12; // programa ~120 ms hacia delante
const lookahead         = 25;    // chequea cada 25 ms

function secondsPerPPQ(){ return (60 / bpm()) / PPQ; }

function scheduler(){
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime){
    scheduleStep(currentPPQ, nextNoteTime);
    nextNoteTime += secondsPerPPQ(); // avanza al siguiente tick PPQ
    currentPPQ++;
  }
}

function scheduleStep(ppqIndex, when){
  const beats = Number(compasSel.value);
  const stepsPerBar = beats * PPQ;
  const stepInBar = ppqIndex % stepsPerBar;
  const stepInBeat = stepInBar % PPQ;

  // ¿qué subdivisión de clic queremos oír?
  const subMode = Number(subdivSel.value); // 1=negras, 2=corcheas, 3=tresillos, 4=semicorcheas
  const subStep = (subMode===1)? PPQ
               : (subMode===2)? PPQ/2
               : (subMode===3)? PPQ/3
               : (subMode===4)? PPQ/4
               : PPQ; // fallback negras

  const isSubHit = (stepInBeat % subStep) === 0;
  const isFirstOfBar = (stepInBar===0);
  const showAccent = accentEl.checked;

  // Beat lights y resync péndulo cada primer pulso del compás
  if (isSubHit && stepInBeat===0){
    const beatNumber = Math.floor(stepInBar / PPQ) % beats;
    setTimeout(()=> setActiveBeatLight(beatNumber), Math.max(0, (when - audioContext.currentTime)*1000));
    if (beatNumber===0) {
      setTimeout(()=> pendulumResync(), Math.max(0, (when - audioContext.currentTime)*1000));
    }
  }

  // Silencio si: hay pista activa (patternPPQ) o el patrón es incompatible y forzamos mute
  const clickMuted = !!patternPPQ || muteWhenIncompatible;

  if (!clickMuted && isSubHit){
    const isAccent = showAccent && (stepInBeat===0) && isFirstOfBar;
    const useName = sonidoSel.value;
    if (useName==="click") playClickAt(when, isAccent);
    else {
      Drum.play(useName, when, clamp(Number(volumeEl.value)*(isAccent?1:0.85),0,1));
    }
  }

  // PATRONES DE BATERÍA (independientes de subdiv de clic)
  if (patternPPQ){
    if (patternPPQ.bombo.has(stepInBar))      Drum.play("bombo", when, Number(volumeEl.value));
    if (patternPPQ.redoblante.has(stepInBar)) Drum.play("redoblante", when, Number(volumeEl.value)*0.95);
    if (patternPPQ.platillo.has(stepInBar))   Drum.play("platillo", when, Number(volumeEl.value)*0.9);
  }
}

function startScheduler(){
  if (audioContext.state==="suspended") audioContext.resume();
  Drum.ensure().catch(()=>{}); // Preload (no bloquea si ya está)
  currentPPQ = 0;
  nextNoteTime = audioContext.currentTime + 0.05; // pequeño offset
  scheduleTimer = setInterval(scheduler, lookahead);
}

function stopScheduler(){
  clearInterval(scheduleTimer);
  scheduleTimer = null;
}

// ====== Controles ======
function onTempoChanged(){
  setPendulumSpeed();
  // el scheduler se ajusta solo porque cada run usa secondsPerPPQ()
}

function buildAll(){
  buildBeatLights();
  onTempoChanged();
  patternPPQ = mapPatternToPPQ();
  updateClickControlsDisabled(!!patternPPQ); // deshabilita clic si hay pista válida
  setActiveBeatLight(-1);

  // Mensaje por si quedó muteado por incompatibilidad
  if (muteWhenIncompatible && activePattern === "waltz34") {
    patternNotice && (patternNotice.textContent = "“Vals 3/4” solo se puede activar en compás 3/4.");
  } else if (!patternPPQ && activePattern !== "off" && !muteWhenIncompatible) {
    patternNotice && (patternNotice.textContent = "Pista apagada.");
  }
}

// ====== Botones ======
function startMetronome(){
  isPlaying = true;
  toggleBtn.textContent = "Detener";
  pendulumPlay();
  // luces al beat 1 inmediato
  setActiveBeatLight(0);
  pendulumResync();
  startScheduler();
}
function stopMetronome(){
  isPlaying = false;
  toggleBtn.textContent = "Iniciar";
  pendulumPause();
  setActiveBeatLight(-1);
  stopScheduler();
}
function toggleMetronome(){ isPlaying ? stopMetronome() : startMetronome(); }

function resetMetronome(){
  stopMetronome();
  bpmInput.value = "120";
  subdivSel.value = "2"; // corcheas por defecto
  accentEl.checked = true;
  volumeEl.value = "0.8";
  activePattern = "off";
  setPatternSelectedUI("off");
  buildAll();
}

// ====== Eventos UI ======
toggleBtn.addEventListener("click", toggleMetronome);
resetBtn.addEventListener("click", resetMetronome);

bpmUpBtn.addEventListener("click", ()=>{ bpmInput.value=String(clamp(Number(bpmInput.value)+1,30,300)); onTempoChanged(); });
bpmDownBtn.addEventListener("click", ()=>{ bpmInput.value=String(clamp(Number(bpmInput.value)-1,30,300)); onTempoChanged(); });
bpmInput.addEventListener("change", onTempoChanged);

subdivSel.addEventListener("change", ()=>{ /* clic se ajusta solo */ });

// Al cambiar compás manualmente desde el selector
compasSel.addEventListener("change", ()=>{ buildAll(); });

tapBtn.addEventListener("click", handleTap);

// Pistas (auto-ajuste de compás)
if (patternButtons){
  patternButtons.addEventListener("click",(e)=>{
    const btn = e.target.closest(".pat-btn");
    if (!btn) return;

    const newPattern = btn.dataset.pattern || "off";
    activePattern = newPattern;
    setPatternSelectedUI(activePattern);

    // Si hay una métrica preferida para el patrón, la aplicamos
    const requiredBeats = PATTERN_METER[activePattern];
    if (requiredBeats) {
      const currentBeats = Number(compasSel.value);
      if (currentBeats !== requiredBeats) {
        compasSel.value = String(requiredBeats);
        patternNotice && (patternNotice.textContent = `Compás ajustado automáticamente a ${requiredBeats}/4 por el groove seleccionado.`);
      }
    }

    // Recalcular todo con el compás posiblemente actualizado
    buildAll();

    // Mensaje actualizado según estado
    if (muteWhenIncompatible && activePattern === "waltz34") {
      patternNotice && (patternNotice.textContent = "“Vals 3/4” solo se puede activar en compás 3/4.");
    } else if (patternPPQ) {
      patternNotice && (patternNotice.textContent = "Pista activa y sincronizada al tempo.");
    } else if (activePattern === "off") {
      patternNotice && (patternNotice.textContent = "Pista apagada.");
    } else {
      patternNotice && (patternNotice.textContent = "Esta pista no coincide con el compás actual.");
    }
  });
}

// Atajos
window.addEventListener("keydown",(e)=>{
  if (e.code==="Space"){ e.preventDefault(); toggleMetronome(); return; }
  if (e.code==="ArrowUp"){ e.preventDefault(); const d=e.shiftKey?5:1; bpmInput.value=String(clamp(Number(bpmInput.value)+d,30,300)); onTempoChanged(); return; }
  if (e.code==="ArrowDown"){ e.preventDefault(); const d=e.shiftKey?5:1; bpmInput.value=String(clamp(Number(bpmInput.value)-d,30,300)); onTempoChanged(); return; }
});

// ====== Init ======
buildAll();
