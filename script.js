/* ===========================================
   Metrónomo Musicala – script.js (versión sin swing ni conteo previo)
   - Tap tempo
   - Volumen maestro
   - Péndulo animado
   - LEDs por compás
   - Acento en primer pulso
   - Cambios de BPM en caliente (se aplican al instante)
   - Atajos: Space (Play/Stop), ↑/↓ (BPM ±1), Shift+↑/↓ (±5)
   - NUEVO: fallback que registra los .wav si sounds.js no existe
   =========================================== */

let isPlaying = false;
let timerId = null;

let beatIndex = 0; // índice de pulso dentro del compás (0..n-1)
let subIndex  = 0; // índice de subdivisión dentro del pulso (0..subdiv-1)

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// ====== Fallback para cargar .wav si no existe sounds.js ======
(function ensureSonidos(){
  if (window.sonidos) return; // ya lo hizo sounds.js

  const files = {
    bombo: 'bombo.wav',
    platillo: 'platillo.wav',
    redoblante: 'redoblante.wav',
    // "click" queda sintético (null)
    click: null
  };

  const sonidos = {};
  Object.entries(files).forEach(([key, url]) => {
    if (!url) return;
    const a = new Audio();
    a.src = url;        // mismo directorio que index.html
    a.preload = 'auto';
    a.load();
    sonidos[key] = a;
  });
  window.sonidos = sonidos;
})();

// === DOM ===
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

// === Colores (por si existe #metronome-circle de layouts previos) ===
const COLOR_ACCENT = "#18a999";
const COLOR_PULSE  = "#3b82f6";
const COLOR_IDLE   = "gray";
const metronomeCircle = document.getElementById("metronome-circle");

// === Estado para Tap Tempo ===
let tapTimes = [];

/* ---------- Utilidades de tiempo ---------- */
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function beatMs() {
  const bpm = clamp(Number(bpmInput.value) || 120, 30, 300);
  return (60 / bpm) * 1000; // duración de una negra en ms
}

function baseIntervalMs() {
  const sub = Number(subdivSel.value); // 1=negras, 2=corcheas, 3=tresillos, 4=semis
  return beatMs() / sub;
}

/* ---------- Sonido ---------- */
function playSample(name, isAccent) {
  const vol = Number(volumeEl.value);
  const map = (window.sonidos || {});
  const audio = map[name];

  if (audio && audio instanceof HTMLAudioElement) {
    // Reinicia para golpear inmediatamente aunque esté sonando
    audio.currentTime = 0;
    audio.volume = clamp(isAccent ? vol : vol * 0.85, 0, 1);
    audio.play();
    return;
  }

  // Fallback: clic digital sintético si no hay sample .wav
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = "square";
  osc.frequency.value = isAccent ? 1400 : 1000;
  gain.gain.value = clamp(isAccent ? vol * 0.7 : vol * 0.45, 0, 1);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.04);
}

/* ---------- Visual ---------- */
function updatePendulumAnim() {
  const beatSec = beatMs() / 1000;
  document.documentElement.style.setProperty("--beat-sec", `${beatSec}`);
}

function buildBeatLights() {
  beatLightsWrap.innerHTML = "";
  const beats = Number(compasSel.value);
  for (let i = 0; i < beats; i++) {
    const d = document.createElement("div");
    d.className = "led";
    if (i === 0) d.classList.add("first");
    beatLightsWrap.appendChild(d);
  }
  setActiveBeatLight(-1);
}

function setActiveBeatLight(index) {
  const leds = beatLightsWrap.querySelectorAll(".led");
  leds.forEach((el, i) => el.classList.toggle("on", i === index));
}

function pulseCircle(isAccent) {
  if (!metronomeCircle) return;
  metronomeCircle.style.transform = isAccent ? "scale(1.18)" : "scale(1.06)";
  metronomeCircle.style.backgroundColor = isAccent ? COLOR_ACCENT : COLOR_PULSE;
  setTimeout(() => {
    metronomeCircle.style.backgroundColor = COLOR_IDLE;
    metronomeCircle.style.transform = "scale(1)";
  }, 100);
}

/* ---------- Motor ---------- */
function tick() {
  const beatsPerMeasure = Number(compasSel.value);
  const sub = Number(subdivSel.value);
  const doAccent = accentEl.checked;

  // ¿Acento? Solo cuando es primer pulso del compás y primera subdivisión
  const isAccent = doAccent && (beatIndex % beatsPerMeasure === 0) && (subIndex === 0);

  const name = sonidoSel.value || "click";
  playSample(name, isAccent);

  if (subIndex === 0) setActiveBeatLight(beatIndex % beatsPerMeasure);
  pulseCircle(isAccent);

  // Avance
  subIndex++;
  if (subIndex >= sub) {
    subIndex = 0;
    beatIndex = (beatIndex + 1) % beatsPerMeasure;
  }

  // Siguiente tick con el intervalo actual (BPM en caliente)
  timerId = setTimeout(tick, baseIntervalMs());
}

function startMetronome() {
  if (audioContext.state === "suspended") audioContext.resume();
  clearTimeout(timerId);
  isPlaying = true;
  toggleBtn.textContent = "Detener";

  // Reset y arranque inmediato
  beatIndex = 0;
  subIndex = 0;
  setActiveBeatLight(0);
  updatePendulumAnim();

  timerId = setTimeout(tick, baseIntervalMs());
}

function stopMetronome() {
  clearTimeout(timerId);
  isPlaying = false;
  toggleBtn.textContent = "Iniciar";
  setActiveBeatLight(-1);
}

function toggleMetronome() { isPlaying ? stopMetronome() : startMetronome(); }

function resetMetronome() {
  stopMetronome();
  bpmInput.value = "120";
  subdivSel.value = "1";
  accentEl.checked = true;
  volumeEl.value = "0.8";
  buildBeatLights();
  updatePendulumAnim();
}

/* ---------- Tap tempo ---------- */
function handleTap() {
  const now = performance.now();
  // Limpiamos taps > 2.5s de antigüedad
  tapTimes = tapTimes.filter(t => now - t < 2500);
  tapTimes.push(now);

  if (tapTimes.length >= 2) {
    let intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = clamp(Math.round(60000 / avg), 30, 300);
    bpmInput.value = String(bpm);
    tapAvgEl.textContent = `${bpm} BPM`;
    applyTempoChangeLive();
  } else {
    tapAvgEl.textContent = "—";
  }
}

/* ---------- Cambios “en caliente” ---------- */
function applyTempoChangeLive() {
  updatePendulumAnim();
  if (isPlaying) {
    // Reprograma el siguiente tick con el nuevo intervalo
    clearTimeout(timerId);
    timerId = setTimeout(tick, baseIntervalMs());
  }
}

/* ---------- Eventos UI ---------- */
toggleBtn.addEventListener("click", toggleMetronome);
resetBtn.addEventListener("click", resetMetronome);

bpmUpBtn.addEventListener("click", () => {
  bpmInput.value = String(clamp(Number(bpmInput.value) + 1, 30, 300));
  applyTempoChangeLive();
});
bpmDownBtn.addEventListener("click", () => {
  bpmInput.value = String(clamp(Number(bpmInput.value) - 1, 30, 300));
  applyTempoChangeLive();
});
bpmInput.addEventListener("change", applyTempoChangeLive);

subdivSel.addEventListener("change", () => {
  // Reinicia la subdivisión respetando el compás actual
  subIndex = 0;
  if (isPlaying) {
    clearTimeout(timerId);
    timerId = setTimeout(tick, baseIntervalMs());
  }
});

compasSel.addEventListener("change", () => {
  buildBeatLights();
  // Asegura que el acento caiga en el tiempo 1
  beatIndex = 0;
  subIndex = 0;
  setActiveBeatLight(0);
});

volumeEl.addEventListener("input", () => { /* el volumen se lee en playSample */ });

tapBtn.addEventListener("click", handleTap);

// Atajos de teclado
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    toggleMetronome();
    return;
  }
  if (e.code === "ArrowUp") {
    e.preventDefault();
    const delta = e.shiftKey ? 5 : 1;
    bpmInput.value = String(clamp(Number(bpmInput.value) + delta, 30, 300));
    applyTempoChangeLive();
    return;
  }
  if (e.code === "ArrowDown") {
    e.preventDefault();
    const delta = e.shiftKey ? 5 : 1;
    bpmInput.value = String(clamp(Number(bpmInput.value) - delta, 30, 300));
    applyTempoChangeLive();
    return;
  }
});

/* ---------- Init ---------- */
buildBeatLights();
updatePendulumAnim();
setActiveBeatLight(-1);
