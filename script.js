/* ============================================================
   Metrónomo Musicala — script.js v2
   Scheduler de alta precisión (PPQ=12)
   Sonidos 100% sintéticos con Web Audio API
   Dark mode · Count-in · BPM Slider · Grooves expandidos
   ============================================================ */
'use strict';

// ──────────────────────────────────────────────
// Audio Context (lazy init para iOS / autoplay policy)
// ──────────────────────────────────────────────
let _actx = null;
function ac() {
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  if (_actx.state === 'suspended') _actx.resume();
  return _actx;
}

// ──────────────────────────────────────────────
// Estado
// ──────────────────────────────────────────────
let isPlaying      = false;
let countInActive  = false;
let activePattern  = 'off';

// Scheduler
let nextNoteTime  = 0;
let currentPPQ    = 0;
let scheduleTimer = null;
const PPQ         = 12;      // pulsos por negra
const LOOKAHEAD   = 25;      // ms entre checks del scheduler
const AHEAD_TIME  = 0.13;    // segundos que programamos hacia adelante

// ──────────────────────────────────────────────
// DOM refs
// ──────────────────────────────────────────────
const $bpm           = document.getElementById('bpm');
const $bpmSlider     = document.getElementById('bpmSlider');
const $bpmUp         = document.getElementById('bpmUp');
const $bpmDown       = document.getElementById('bpmDown');
const $tempoName     = document.getElementById('tempoName');
const $compas        = document.getElementById('compas');
const $subdiv        = document.getElementById('subdivision');
const $sonido        = document.getElementById('sonido');
const $volumen       = document.getElementById('volumen');
const $accent        = document.getElementById('accent');
const $countInChk    = document.getElementById('countInChk');
const $flashChk      = document.getElementById('flashChk');
const $tapBtn        = document.getElementById('tapBtn');
const $tapAvg        = document.getElementById('tapAvg');
const $toggleBtn     = document.getElementById('toggleBtn');
const $resetBtn      = document.getElementById('resetBtn');
const $beatLights    = document.getElementById('beatLights');
const $patternBtns   = document.getElementById('patternButtons');
const $patternNotice = document.getElementById('patternNotice');
const $pendulumArm   = document.getElementById('pendulumArm');
const $flashOverlay  = document.getElementById('flashOverlay');
const $countinDisp   = document.getElementById('countinDisplay');
const $themeToggle   = document.getElementById('themeToggle');

// ──────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────
const clamp  = (n, a, b) => Math.max(a, Math.min(b, n));
const getBPM = () => clamp(parseInt($bpm.value) || 120, 30, 300);
const getVol = () => parseFloat($volumen.value) || 0.8;

// ──────────────────────────────────────────────
// Nombres de tempo
// ──────────────────────────────────────────────
const TEMPOS = [
  [20,   40,  'Larghissimo'],
  [40,   55,  'Grave'],
  [55,   66,  'Largo'],
  [66,   76,  'Larghetto'],
  [76,   92,  'Adagio'],
  [92,  108,  'Andante'],
  [108, 116,  'Andantino'],
  [116, 126,  'Moderato'],
  [126, 140,  'Allegretto'],
  [140, 168,  'Allegro'],
  [168, 188,  'Vivace'],
  [188, 208,  'Presto'],
  [208, 400,  'Prestissimo'],
];
function getTempoName(bpm) {
  for (const [lo, hi, name] of TEMPOS)
    if (bpm >= lo && bpm < hi) return name;
  return 'Prestissimo';
}

// ──────────────────────────────────────────────
// Síntesis de sonidos (Web Audio API)
// ──────────────────────────────────────────────

/** Clic digital: onda cuadrada corta */
function synthClick(t, accent) {
  const ctx = ac(), vol = getVol();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(accent ? vol * .65 : vol * .38, t);
  gain.gain.exponentialRampToValueAtTime(1e-4, t + .05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t); osc.stop(t + .06);
}

/** Madera / clave: sine suave */
function synthWood(t, accent) {
  const ctx = ac(), vol = getVol();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = accent ? 900 : 660;
  gain.gain.setValueAtTime(vol * .9, t);
  gain.gain.exponentialRampToValueAtTime(1e-4, t + .08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t); osc.stop(t + .09);
}

/** Bombo / kick: frecuencia descendente + transiente */
function synthKick(t, vol) {
  const ctx = ac();
  const v = clamp(vol * getVol(), 0, 1);
  // Sub oscillator
  const osc  = ctx.createOscillator();
  const g    = ctx.createGain();
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + .08);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(1e-4, t + .38);
  osc.connect(g).connect(ctx.destination);
  osc.start(t); osc.stop(t + .42);
  // Click transient
  const osc2 = ctx.createOscillator();
  const g2   = ctx.createGain();
  osc2.frequency.value = 90;
  g2.gain.setValueAtTime(v * .55, t);
  g2.gain.exponentialRampToValueAtTime(1e-4, t + .02);
  osc2.connect(g2).connect(ctx.destination);
  osc2.start(t); osc2.stop(t + .025);
}

/** Redoblante / snare: ruido + tono de cuerpo */
function synthSnare(t, vol) {
  const ctx = ac();
  const v   = clamp(vol * getVol(), 0, 1);
  const sr  = ctx.sampleRate;
  // Noise burst
  const len  = Math.floor(sr * .22);
  const buf  = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = .6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(v * .85, t);
  ng.gain.exponentialRampToValueAtTime(1e-4, t + .2);
  src.connect(bp).connect(ng).connect(ctx.destination);
  src.start(t); src.stop(t + .22);
  // Body tone
  const osc = ctx.createOscillator();
  const og  = ctx.createGain();
  osc.frequency.value = 200;
  og.gain.setValueAtTime(v * .3, t);
  og.gain.exponentialRampToValueAtTime(1e-4, t + .09);
  osc.connect(og).connect(ctx.destination);
  osc.start(t); osc.stop(t + .1);
}

/** Hi-hat / platillo: ruido agudo filtrado */
function synthHihat(t, vol) {
  const ctx = ac();
  const v   = clamp(vol * getVol(), 0, 1);
  const sr  = ctx.sampleRate;
  const len = Math.floor(sr * .07);
  const buf = ctx.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v * .5, t);
  g.gain.exponentialRampToValueAtTime(1e-4, t + .065);
  src.connect(hp).connect(g).connect(ctx.destination);
  src.start(t); src.stop(t + .075);
}

/** Count-in: tono brillante */
function synthCountIn(t, beatIndex) {
  const ctx = ac(), vol = getVol();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = beatIndex === 0 ? 1800 : 1300;
  gain.gain.setValueAtTime(vol * .85, t);
  gain.gain.exponentialRampToValueAtTime(1e-4, t + .07);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t); osc.stop(t + .08);
}

/** Dispatcher: elige sonido de clic según selección */
function playClickSound(t, isAccent) {
  switch ($sonido.value) {
    case 'click':      synthClick(t, isAccent);                  break;
    case 'madera':     synthWood(t, isAccent);                   break;
    case 'bombo':      synthKick(t, isAccent ? 1.0 : .75);       break;
    case 'platillo':   synthHihat(t, isAccent ? .9  : .6);       break;
    case 'redoblante': synthSnare(t, isAccent ? 1.0 : .75);      break;
    default:           synthClick(t, isAccent);
  }
}

// ──────────────────────────────────────────────
// Patrones de batería
// ──────────────────────────────────────────────
// grid = número de corcheas por compás
// 4/4 → grid 8 · 3/4 → grid 6
const PATTERNS = {
  groove1: {                            // Groove pop 4/4
    compas: [4], grid: 8,
    parts: { bombo:[0,4], redoblante:[2,6], platillo:[0,1,2,3,4,5,6,7] }
  },
  funk: {                               // Funk sincopado 4/4
    compas: [4], grid: 8,
    parts: { bombo:[0,3,4,7], redoblante:[2,6], platillo:[0,1,2,3,4,5,6,7] }
  },
  rock: {                               // Rock clásico 4/4
    compas: [4], grid: 8,
    parts: { bombo:[0,4], redoblante:[2,6], platillo:[0,2,4,6] }
  },
  bossa: {                              // Bossa Nova 4/4
    compas: [4], grid: 8,
    parts: { bombo:[0,3,5], redoblante:[2,4], platillo:[0,2,4,6] }
  },
  waltz34: {                            // Vals 3/4
    compas: [3], grid: 6,
    parts: { bombo:[0], redoblante:[2,4], platillo:[0,2,4] }
  }
};

// Compás requerido por cada patrón
const PATTERN_METER = { groove1:4, funk:4, rock:4, bossa:4, waltz34:3 };

let patternPPQ       = null;
let muteWhenIncompat = false;

function buildPatternPPQ() {
  if (activePattern === 'off') {
    muteWhenIncompat = false;
    return null;
  }
  const pat   = PATTERNS[activePattern];
  const beats = parseInt($compas.value);
  if (!pat || !pat.compas.includes(beats)) {
    muteWhenIncompat = true;
    return null;
  }
  muteWhenIncompat = false;
  const stepsPerBar = beats * PPQ;
  const qPerCell    = stepsPerBar / pat.grid;
  const m = {};
  for (const part of Object.keys(pat.parts))
    m[part] = new Set(pat.parts[part].map(idx => Math.round(idx * qPerCell)));
  return { ...m, stepsPerBar };
}

// ──────────────────────────────────────────────
// Beat lights (LEDs)
// ──────────────────────────────────────────────
function buildBeatLights() {
  $beatLights.innerHTML = '';
  const beats = parseInt($compas.value);
  for (let i = 0; i < beats; i++) {
    const led = document.createElement('div');
    led.className = 'led' + (i === 0 ? ' first' : '');
    $beatLights.appendChild(led);
  }
  setActiveLed(-1);
}
function setActiveLed(idx) {
  $beatLights.querySelectorAll('.led')
    .forEach((el, i) => el.classList.toggle('on', i === idx));
}

// ──────────────────────────────────────────────
// Flash en tiempo 1
// ──────────────────────────────────────────────
let flashTimer = null;
function doFlash() {
  if (!$flashChk.checked) return;
  clearTimeout(flashTimer);
  $flashOverlay.classList.add('on');
  flashTimer = setTimeout(() => $flashOverlay.classList.remove('on'), 90);
}

// ──────────────────────────────────────────────
// Péndulo
// ──────────────────────────────────────────────
function setPendulumSpeed() {
  document.documentElement.style.setProperty(
    '--beat-sec', (60 / getBPM()).toFixed(4)
  );
}
function pendulumPlay()  { $pendulumArm.classList.add('playing'); }
function pendulumPause() { $pendulumArm.classList.remove('playing'); }
function pendulumResync() {
  $pendulumArm.classList.add('resync');
  void $pendulumArm.offsetWidth; // force reflow
  $pendulumArm.classList.add('reapply');
  setTimeout(() => $pendulumArm.classList.remove('resync', 'reapply'), 0);
}

// ──────────────────────────────────────────────
// Count-in display
// ──────────────────────────────────────────────
let _lastCountBeat = -1;
function showCountBeat(n) {
  if (n === _lastCountBeat) return;
  _lastCountBeat = n;
  if (n < 0) {
    $countinDisp.classList.remove('show');
  } else {
    $countinDisp.textContent = String(n + 1);
    $countinDisp.classList.add('show');
  }
}

// ──────────────────────────────────────────────
// Scheduler principal
// ──────────────────────────────────────────────
function secPerPPQ() { return (60 / getBPM()) / PPQ; }

function scheduleStep(ppqIdx, when) {
  const beats       = parseInt($compas.value);
  const stepsPerBar = beats * PPQ;

  // ── Count-in ──
  if (countInActive) {
    if (ppqIdx < stepsPerBar) {
      // Compás de count-in
      const cBeat = Math.floor(ppqIdx / PPQ);
      if (ppqIdx % PPQ === 0) {
        const delay = Math.max(0, (when - ac().currentTime) * 1000);
        setTimeout(() => showCountBeat(cBeat), delay);
        synthCountIn(when, cBeat);
        if (cBeat === 0) setTimeout(() => pendulumResync(), delay);
      }
      return; // no reproducir sonido normal durante count-in
    } else {
      // Primera nota real: desactivar count-in
      if (ppqIdx === stepsPerBar) {
        countInActive = false;
        const delay = Math.max(0, (when - ac().currentTime) * 1000);
        setTimeout(() => { showCountBeat(-1); _lastCountBeat = -1; }, delay);
      }
    }
  }

  const stepInBar  = ppqIdx % stepsPerBar;
  const stepInBeat = stepInBar % PPQ;
  const beatNum    = Math.floor(stepInBar / PPQ);
  const isBar1     = stepInBar === 0;

  // ── Actualizaciones visuales (con delay preciso) ──
  if (stepInBeat === 0) {
    const delay = Math.max(0, (when - ac().currentTime) * 1000);
    setTimeout(() => setActiveLed(beatNum), delay);
    if (isBar1) {
      setTimeout(() => { pendulumResync(); doFlash(); }, delay);
    }
  }

  // ── Subdivisión del clic ──
  const sub = parseInt($subdiv.value);
  const subStep = sub === 1 ? PPQ
               : sub === 2 ? PPQ / 2
               : sub === 3 ? PPQ / 3
               :              PPQ / 4;
  const isSubHit = (stepInBeat % Math.round(subStep)) === 0;

  // ── Clic (silenciado si hay groove activo) ──
  if (!patternPPQ && !muteWhenIncompat && isSubHit) {
    const isAccent = $accent.checked && stepInBeat === 0 && isBar1;
    playClickSound(when, isAccent);
  }

  // ── Groove de batería ──
  if (patternPPQ) {
    if (patternPPQ.bombo?.has(stepInBar))      synthKick(when, 1.0);
    if (patternPPQ.redoblante?.has(stepInBar)) synthSnare(when, 0.9);
    if (patternPPQ.platillo?.has(stepInBar))   synthHihat(when, 0.75);
  }
}

function scheduler() {
  const ctx = ac();
  while (nextNoteTime < ctx.currentTime + AHEAD_TIME) {
    scheduleStep(currentPPQ, nextNoteTime);
    nextNoteTime += secPerPPQ();
    currentPPQ++;
  }
}

function startScheduler() {
  currentPPQ   = 0;
  nextNoteTime = ac().currentTime + 0.05;
  scheduleTimer = setInterval(scheduler, LOOKAHEAD);
}
function stopScheduler() {
  clearInterval(scheduleTimer);
  scheduleTimer = null;
}

// ──────────────────────────────────────────────
// Control del metrónomo
// ──────────────────────────────────────────────
function startMetronome() {
  if ($countInChk.checked) {
    countInActive  = true;
    _lastCountBeat = -1;
  }
  isPlaying = true;
  $toggleBtn.textContent = '■ Detener';
  $toggleBtn.classList.add('stop');
  pendulumPlay();
  pendulumResync();
  setActiveLed(0);
  startScheduler();
}

function stopMetronome() {
  isPlaying     = false;
  countInActive = false;
  showCountBeat(-1);
  $toggleBtn.textContent = '▶ Iniciar';
  $toggleBtn.classList.remove('stop');
  pendulumPause();
  setActiveLed(-1);
  stopScheduler();
}

function toggleMetronome() {
  isPlaying ? stopMetronome() : startMetronome();
}

function resetAll() {
  stopMetronome();
  $bpm.value          = '120';
  $bpmSlider.value    = '120';
  $subdiv.value       = '2';
  $volumen.value      = '0.8';
  $compas.value       = '4';
  $accent.checked     = true;
  $countInChk.checked = false;
  $flashChk.checked   = true;
  activePattern = 'off';
  setPatternUI('off');
  buildAll();
  updateSliderFills();
}

// ──────────────────────────────────────────────
// Patrones UI
// ──────────────────────────────────────────────
function setPatternUI(id) {
  $patternBtns.querySelectorAll('.pat-btn')
    .forEach(b => b.classList.toggle('sel', b.dataset.pattern === id));
}

function rebuildPattern() {
  patternPPQ = buildPatternPPQ();
  $sonido.disabled = !!patternPPQ;
  $accent.disabled = !!patternPPQ;

  if (activePattern === 'off') {
    $patternNotice.textContent = 'Pista apagada.';
  } else if (muteWhenIncompat) {
    $patternNotice.textContent = `"${activePattern}" no es compatible con el compás actual.`;
  } else if (patternPPQ) {
    $patternNotice.textContent = 'Pista activa y sincronizada al tempo.';
  } else {
    $patternNotice.textContent = 'Incompatible con el compás actual.';
  }
}

// ──────────────────────────────────────────────
// Build all
// ──────────────────────────────────────────────
function buildAll() {
  buildBeatLights();
  setPendulumSpeed();
  rebuildPattern();
  $tempoName.textContent = getTempoName(getBPM());
}

// ──────────────────────────────────────────────
// Actualizar fills de sliders con CSS custom property
// ──────────────────────────────────────────────
function updateSliderFills() {
  const bpmPct = ((getBPM() - 30) / 270 * 100).toFixed(1) + '%';
  $bpmSlider.style.setProperty('--fill', bpmPct);
  const vPct = (getVol() * 100).toFixed(1) + '%';
  $volumen.style.setProperty('--vfill', vPct);
}

// ──────────────────────────────────────────────
// BPM change handler
// ──────────────────────────────────────────────
function onBPMChanged() {
  const v = getBPM();
  $bpm.value       = String(v);
  $bpmSlider.value = String(v);
  $tempoName.textContent = getTempoName(v);
  setPendulumSpeed();
  updateSliderFills();
}

// ──────────────────────────────────────────────
// Tap tempo
// ──────────────────────────────────────────────
let tapTimes = [];
function handleTap() {
  const now = performance.now();
  tapTimes = tapTimes.filter(t => now - t < 3000);
  tapTimes.push(now);
  if (tapTimes.length >= 2) {
    const ints = [];
    for (let i = 1; i < tapTimes.length; i++) ints.push(tapTimes[i] - tapTimes[i-1]);
    const avg  = ints.reduce((a, b) => a + b, 0) / ints.length;
    const calc = clamp(Math.round(60000 / avg), 30, 300);
    $bpm.value       = String(calc);
    $bpmSlider.value = String(calc);
    $tapAvg.textContent = `≈ ${calc} BPM`;
    onBPMChanged();
  } else {
    $tapAvg.textContent = '…';
  }
}

// ──────────────────────────────────────────────
// Tema dark / light
// ──────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $themeToggle.textContent = t === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('metro-theme', t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// ──────────────────────────────────────────────
// Event listeners
// ──────────────────────────────────────────────
$toggleBtn.addEventListener('click', toggleMetronome);
$resetBtn.addEventListener('click', resetAll);
$themeToggle.addEventListener('click', toggleTheme);

$bpmUp.addEventListener('click', () => {
  $bpm.value = String(clamp(getBPM() + 1, 30, 300));
  onBPMChanged();
});
$bpmDown.addEventListener('click', () => {
  $bpm.value = String(clamp(getBPM() - 1, 30, 300));
  onBPMChanged();
});

// BPM input
$bpm.addEventListener('input', () => {
  const raw = parseInt($bpm.value) || 30;
  const v   = clamp(raw, 30, 300);
  $bpmSlider.value = String(v);
  $tempoName.textContent = getTempoName(v);
  setPendulumSpeed();
  updateSliderFills();
});
$bpm.addEventListener('change', onBPMChanged);

// BPM slider
$bpmSlider.addEventListener('input', () => {
  $bpm.value = $bpmSlider.value;
  onBPMChanged();
});

// Volumen
$volumen.addEventListener('input', updateSliderFills);

// Compás
$compas.addEventListener('change', buildAll);

// Tap
$tapBtn.addEventListener('click', handleTap);

// Patrones
$patternBtns.addEventListener('click', e => {
  const btn = e.target.closest('.pat-btn');
  if (!btn) return;
  activePattern = btn.dataset.pattern || 'off';
  setPatternUI(activePattern);
  // Auto-ajuste de compás según groove
  const req = PATTERN_METER[activePattern];
  if (req && parseInt($compas.value) !== req) {
    $compas.value = String(req);
    buildBeatLights();
  }
  rebuildPattern();
});

// Atajos de teclado
window.addEventListener('keydown', e => {
  const inNumber = document.activeElement?.type === 'number';
  if (e.code === 'Space') {
    if (inNumber) return;
    e.preventDefault();
    toggleMetronome();
  } else if (e.code === 'ArrowUp') {
    e.preventDefault();
    const d = e.shiftKey ? 5 : 1;
    $bpm.value = String(clamp(getBPM() + d, 30, 300));
    onBPMChanged();
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    const d = e.shiftKey ? 5 : 1;
    $bpm.value = String(clamp(getBPM() - d, 30, 300));
    onBPMChanged();
  } else if (e.code === 'KeyT' && !inNumber) {
    handleTap();
  }
});

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────
(function init() {
  const savedTheme = localStorage.getItem('metro-theme') || 'dark';
  applyTheme(savedTheme);
  buildAll();
  updateSliderFills();
})();