/* ============================================================
   Metrónomo Musicala — script.js v3
   · Compases simples, compuestos e irregulares con agrupación
   · Rejilla de acentos por pulso (fuerte / normal / silencio)
   · Gap click · Tempo progresivo · Pantalla completa · Samples + síntesis
   · Scheduler con Worker (preciso en segundo plano)
   · Péndulo dibujado con rAF sobre el reloj de audio
   ============================================================ */
'use strict';

// ──────────────────────────────────────────────
// Audio Context + master gain (compartido con sounds.js)
// ──────────────────────────────────────────────
const AC = window.AudioContext || window.webkitAudioContext;
const actx = new AC();
const masterGain = actx.createGain();
masterGain.gain.value = 0.8;
masterGain.connect(actx.destination);

// sounds.js se engancha a estos dos para compartir el mismo reloj.
window.__metroCtx    = actx;
window.__metroMaster = masterGain;

function ac() {
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, () => ac(), { once: true, passive: true })
);

// ──────────────────────────────────────────────
// Constantes de tiempo
// ──────────────────────────────────────────────
const PPQ         = 12;   // ticks por negra
const EIGHTH      = PPQ / 2;
const LOOKAHEAD   = 25;   // ms entre checks del scheduler
const AHEAD_TIME   = 0.20; // segundos programados por adelantado

// ──────────────────────────────────────────────
// Estado
// ──────────────────────────────────────────────
let isPlaying     = false;
let activePattern = 'off';

let tickInBar    = 0;
let barIndex     = 0;
let nextNoteTime = 0;
let countInLeft  = 0;   // compases de count-in pendientes
let tempoRampBase = null;

// ──────────────────────────────────────────────
// DOM refs
// ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

const $bpm           = $('bpm');
const $bpmSlider     = $('bpmSlider');
const $bpmUp         = $('bpmUp');
const $bpmDown       = $('bpmDown');
const $tempoName     = $('tempoName');
const $compas        = $('compas');
const $grouping      = $('grouping');
const $groupingWrap  = $('groupingWrap');
const $bpmUnitHint   = $('bpmUnitHint');
const $subdiv        = $('subdivision');
const $sonido        = $('sonido');
const $volumen       = $('volumen');
const $samplesChk    = $('samplesChk');
const $countInChk    = $('countInChk');
const $countInBars   = $('countInBars');
const $flashChk      = $('flashChk');
const $tapBtn        = $('tapBtn');
const $tapAvg        = $('tapAvg');
const $toggleBtn     = $('toggleBtn');
const $resetBtn      = $('resetBtn');
const $beatLights    = $('beatLights');
const $accentGrid    = $('accentGrid');
const $patternBtns   = $('patternButtons');
const $patternNotice = $('patternNotice');
const $pendulumArm   = $('pendulumArm');
const $flashOverlay  = $('flashOverlay');
const $countinDisp   = $('countinDisplay');
const $themeToggle   = $('themeToggle');
const $barCounter    = $('barCounter');
const $srStatus      = $('srStatus');

// Práctica
const $gapChk      = $('gapChk');
const $gapPlay     = $('gapPlay');
const $gapMute     = $('gapMute');
const $rampChk     = $('rampChk');
const $rampBars    = $('rampBars');
const $rampAmount  = $('rampAmount');
const $rampMax     = $('rampMax');

// Pantalla completa
const $fsMode   = $('fsMode');
const $fsNumber = $('fsNumber');
const $fsCount  = $('fsCount');
const $fsMeter  = $('fsMeter');
const $fsBpm    = $('fsBpm');
const $fsTempo  = $('fsTempo');
const $fsBar    = $('fsBar');
const $fsBpmUnit = $('fsBpmUnit');
const $fsDown   = $('fsDown');
const $fsUp     = $('fsUp');
const $fsSlider = $('fsSlider');
const $fsTap    = $('fsTap');
const $fsBtn    = $('fsBtn');
const $fsExit   = $('fsExit');
const $fsToggle = $('fsToggle');

// ──────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────
const clamp  = (n, a, b) => Math.max(a, Math.min(b, n));
const getBPM = () => clamp(parseInt($bpm.value) || 120, 30, 400);
const getVol = () => {
  const v = parseFloat($volumen.value);
  return Number.isFinite(v) ? v : 0.8;
};
const intOf = (el, def, lo, hi) => clamp(parseInt(el.value) || def, lo, hi);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ──────────────────────────────────────────────
// Modelo de compás
//  unit     = ticks de la figura del denominador (negra 12 · corchea 6)
//  groups   = pulsos del compás, medidos en unidades del denominador
//  bpmTicks = a qué figura se refiere el BPM
//             simple → negra · compuesto → negra con puntillo
//             irregular → corchea (el pulso es desigual)
// ──────────────────────────────────────────────
const METERS = {
  '2/4':  { unit: PPQ,    groups: [1,1],      bpmTicks: PPQ,     type: 'simple',    bpmLabel: '♩'  },
  '3/4':  { unit: PPQ,    groups: [1,1,1],    bpmTicks: PPQ,     type: 'simple',    bpmLabel: '♩'  },
  '4/4':  { unit: PPQ,    groups: [1,1,1,1],  bpmTicks: PPQ,     type: 'simple',    bpmLabel: '♩'  },
  '5/4':  { unit: PPQ,    groups: [1,1,1,1,1],bpmTicks: PPQ,     type: 'simple',    bpmLabel: '♩'  },
  '6/8':  { unit: EIGHTH, groups: [3,3],      bpmTicks: EIGHTH*3,type: 'compound',  bpmLabel: '♩.' },
  '9/8':  { unit: EIGHTH, groups: [3,3,3],    bpmTicks: EIGHTH*3,type: 'compound',  bpmLabel: '♩.' },
  '12/8': { unit: EIGHTH, groups: [3,3,3,3],  bpmTicks: EIGHTH*3,type: 'compound',  bpmLabel: '♩.' },
  '5/8':  { unit: EIGHTH, groups: [3,2],      bpmTicks: EIGHTH,  type: 'irregular', bpmLabel: '♪',
            groupings: ['3+2', '2+3'] },
  '7/8':  { unit: EIGHTH, groups: [2,2,3],    bpmTicks: EIGHTH,  type: 'irregular', bpmLabel: '♪',
            groupings: ['2+2+3', '3+2+2', '2+3+2'] },
  '8/8':  { unit: EIGHTH, groups: [3,3,2],    bpmTicks: EIGHTH,  type: 'irregular', bpmLabel: '♪',
            groupings: ['3+3+2', '3+2+3', '2+3+3'] },
};

function getMeterId()  { return METERS[$compas.value] ? $compas.value : '4/4'; }
function getMeter()    { return METERS[getMeterId()]; }
function isIrregular() { return getMeter().type === 'irregular'; }
function isCompound()  { return getMeter().type === 'compound'; }

/** Grupos efectivos, respetando la agrupación elegida en compases irregulares. */
function getGroups() {
  const m = getMeter();
  if (m.type === 'irregular' && $grouping.value && $grouping.value.includes('+')) {
    const parsed = $grouping.value.split('+').map(n => parseInt(n, 10));
    if (parsed.every(n => n > 0)) return parsed;
  }
  return m.groups.slice();
}

// ──────────────────────────────────────────────
// Plan del compás: pulsos, ticks y mapa de clics
// ──────────────────────────────────────────────
let barPlan  = null;   // { pulses:[{start,len,units}], ticks }
let clickMap = null;   // Map<tickInBar, entrada>
let countSeq = [];     // entradas del compás en orden: 1, &, 2, &, …
let pulseSeq = [];     // pulseSeq[pulso] = índice en countSeq

function buildBarPlan() {
  const m = getMeter();
  const groups = getGroups();
  const pulses = [];
  let t = 0;
  groups.forEach((units, i) => {
    const len = units * m.unit;
    pulses.push({ index: i, start: t, len, units });
    t += len;
  });
  return { pulses, ticks: t };
}

// Sílabas del conteo hablado, en la convención anglosajona que ya usan:
// 2 por pulso → "1 &" · 3 → "1 & a" · 4 → "1 e & a".
// Con 6 por pulso las corcheas llevan el conteo y las semicorcheas
// intermedias van con punto: "1 · & · a ·".
const SUB_SYLLABLES = {
  2: ['&'],
  3: ['&', 'a'],
  4: ['e', '&', 'a'],
  6: ['·', '&', '·', 'a', '·'],
};
function syllable(m, k) {
  const list = SUB_SYLLABLES[m];
  return (list && list[k - 1]) || '·';
}

/** Opciones de subdivisión, dependientes del tipo de compás.
 *  mode 'perPulse' → n notas por pulso · mode 'perTick' → una nota cada N ticks. */
function subdivOptions() {
  const t = getMeter().type;
  if (t === 'compound') return [
    { v: 'p1', label: 'Pulso ♩.',            mode: 'perPulse', n: 1 },
    { v: 'p3', label: 'Corcheas ♪ (3)',      mode: 'perPulse', n: 3 },
    { v: 'p6', label: 'Semicorcheas ♬ (6)',  mode: 'perPulse', n: 6 },
  ];
  if (t === 'irregular') return [
    { v: 'p1', label: 'Solo pulsos',         mode: 'perPulse', n: 1 },
    { v: 't6', label: 'Corcheas ♪',          mode: 'perTick',  ticks: EIGHTH },
    { v: 't3', label: 'Semicorcheas ♬',      mode: 'perTick',  ticks: EIGHTH / 2 },
  ];
  return [
    { v: 'p1', label: 'Negras ♩',            mode: 'perPulse', n: 1 },
    { v: 'p2', label: 'Corcheas ♪',          mode: 'perPulse', n: 2 },
    { v: 'p3', label: 'Tresillos ♪³',        mode: 'perPulse', n: 3 },
    { v: 'p4', label: 'Semicorcheas ♬',      mode: 'perPulse', n: 4 },
  ];
}

function currentSubdiv() {
  const opts = subdivOptions();
  return opts.find(o => o.v === $subdiv.value) || opts[0];
}

/** Construye el mapa de clics y, de paso, la línea de conteo del compás:
 *  cada entrada sabe si es pulso, a qué pulso pertenece y qué etiqueta
 *  se canta en ella ("1", "&", "a", …). */
function buildClickMap(plan) {
  const sd  = currentSubdiv();
  const map = new Map();

  for (const p of plan.pulses) {
    let m, step;
    if (sd.mode === 'perPulse') {
      m = sd.n;
      step = null;                       // repartido proporcionalmente
    } else {
      step = Math.max(1, Math.round(sd.ticks));
      m = Math.max(1, Math.round(p.len / step));
    }
    for (let k = 0; k < m; k++) {
      const off = step === null
        ? p.start + Math.round(k * p.len / m)
        : p.start + k * step;
      if (off >= p.start + p.len || map.has(off)) continue;
      map.set(off, {
        pulse: k === 0,
        pi: p.index,
        label: k === 0 ? String(p.index + 1) : syllable(m, k),
      });
    }
  }

  // Orden por tick: así la línea se lee de izquierda a derecha.
  const seq = [];
  const pulses = [];
  [...map.keys()].sort((a, b) => a - b).forEach(t => {
    const e = map.get(t);
    e.seq = seq.length;
    if (e.pulse) pulses[e.pi] = e.seq;
    seq.push(e);
  });

  countSeq = seq;
  pulseSeq = pulses;
  return map;
}

function buildSubdivOptions() {
  const opts = subdivOptions();
  const prev = $subdiv.value;
  $subdiv.innerHTML = '';
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.v; el.textContent = o.label;
    $subdiv.appendChild(el);
  }
  $subdiv.value = opts.some(o => o.v === prev) ? prev
                : 'p1';
}

function buildGroupingOptions() {
  const m = getMeter();
  if (m.type !== 'irregular') { $groupingWrap.hidden = true; return; }
  $groupingWrap.hidden = false;
  const prev = $grouping.value;
  $grouping.innerHTML = '';
  for (const g of m.groupings) {
    const el = document.createElement('option');
    el.value = g; el.textContent = g;
    $grouping.appendChild(el);
  }
  $grouping.value = m.groupings.includes(prev) ? prev : m.groupings[0];
}

// ──────────────────────────────────────────────
// Rejilla de acentos: 2 fuerte · 1 normal · 0 silencio
// ──────────────────────────────────────────────
let accents = [];

function defaultAccents(n) {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 2 : 1));
}
function ensureAccents(n) {
  if (accents.length !== n) accents = defaultAccents(n);
}

const ACCENT_LABEL = ['silencio', 'normal', 'fuerte'];

function buildAccentGrid() {
  const groups = getGroups();
  ensureAccents(groups.length);
  $accentGrid.innerHTML = '';
  groups.forEach((units, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'acc-cell lvl' + accents[i];
    b.dataset.idx = String(i);
    b.textContent = String(i + 1);
    if (isIrregular()) {
      const s = document.createElement('span');
      s.className = 'acc-units';
      s.textContent = units;
      b.appendChild(s);
    }
    b.title = `Pulso ${i + 1}: ${ACCENT_LABEL[accents[i]]} (clic para cambiar)`;
    b.setAttribute('aria-label', b.title);
    $accentGrid.appendChild(b);
  });
}

$accentGrid.addEventListener('click', e => {
  const cell = e.target.closest('.acc-cell');
  if (!cell) return;
  const i = parseInt(cell.dataset.idx);
  accents[i] = (accents[i] + 1) % 3;      // normal → fuerte → silencio → normal …
  cell.className = 'acc-cell lvl' + accents[i];
  cell.title = `Pulso ${i + 1}: ${ACCENT_LABEL[accents[i]]} (clic para cambiar)`;
  cell.setAttribute('aria-label', cell.title);
  if (fsIsOpen()) buildFsCount();
});

// ──────────────────────────────────────────────
// Nombres de tempo
// ──────────────────────────────────────────────
const TEMPOS = [
  [20,   40,  'Larghissimo'], [40,   55,  'Grave'],
  [55,   66,  'Largo'],       [66,   76,  'Larghetto'],
  [76,   92,  'Adagio'],      [92,  108,  'Andante'],
  [108, 116,  'Andantino'],   [116, 126,  'Moderato'],
  [126, 140,  'Allegretto'],  [140, 168,  'Allegro'],
  [168, 188,  'Vivace'],      [188, 208,  'Presto'],
  [208, 401,  'Prestissimo'],
];
function getTempoName(bpm) {
  for (const [lo, hi, name] of TEMPOS) if (bpm >= lo && bpm < hi) return name;
  return 'Prestissimo';
}

// ──────────────────────────────────────────────
// Síntesis de sonidos (Web Audio API)
// ──────────────────────────────────────────────
function out() { return masterGain; }

function synthClick(t, level) {
  const ctx = ac();
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = level === 2 ? 1500 : 1000;
  gain.gain.setValueAtTime(level === 2 ? .65 : .38, t);
  gain.gain.exponentialRampToValueAtTime(1e-4, t + .05);
  osc.connect(gain).connect(out());
  osc.start(t); osc.stop(t + .06);
}

function synthWood(t, level) {
  const ctx = ac();
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = level === 2 ? 900 : 660;
  gain.gain.setValueAtTime(level === 2 ? .9 : .55, t);
  gain.gain.exponentialRampToValueAtTime(1e-4, t + .08);
  osc.connect(gain).connect(out());
  osc.start(t); osc.stop(t + .09);
}

function synthKick(t, vol) {
  const ctx = ac(), v = clamp(vol, 0, 1);
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + .08);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(1e-4, t + .38);
  osc.connect(g).connect(out());
  osc.start(t); osc.stop(t + .42);
  const osc2 = ctx.createOscillator(), g2 = ctx.createGain();
  osc2.frequency.value = 90;
  g2.gain.setValueAtTime(v * .55, t);
  g2.gain.exponentialRampToValueAtTime(1e-4, t + .02);
  osc2.connect(g2).connect(out());
  osc2.start(t); osc2.stop(t + .025);
}

function synthSnare(t, vol) {
  const ctx = ac(), v = clamp(vol, 0, 1), sr = ctx.sampleRate;
  const len = Math.floor(sr * .22);
  const buf = ctx.createBuffer(1, len, sr), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = .6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(v * .85, t);
  ng.gain.exponentialRampToValueAtTime(1e-4, t + .2);
  src.connect(bp).connect(ng).connect(out());
  src.start(t); src.stop(t + .22);
  const osc = ctx.createOscillator(), og = ctx.createGain();
  osc.frequency.value = 200;
  og.gain.setValueAtTime(v * .3, t);
  og.gain.exponentialRampToValueAtTime(1e-4, t + .09);
  osc.connect(og).connect(out());
  osc.start(t); osc.stop(t + .1);
}

function synthHihat(t, vol) {
  const ctx = ac(), v = clamp(vol, 0, 1), sr = ctx.sampleRate;
  const len = Math.floor(sr * .07);
  const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v * .5, t);
  g.gain.exponentialRampToValueAtTime(1e-4, t + .065);
  src.connect(hp).connect(g).connect(out());
  src.start(t); src.stop(t + .075);
}

function synthCountIn(t, isFirst) {
  const ctx = ac();
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = isFirst ? 1800 : 1300;
  gain.gain.setValueAtTime(.85, t);
  gain.gain.exponentialRampToValueAtTime(1e-4, t + .07);
  osc.connect(gain).connect(out());
  osc.start(t); osc.stop(t + .08);
}

/** Toca un sample precargado si está disponible; si no, cae al sintetizador. */
const SYNTH_FALLBACK = { bombo: synthKick, redoblante: synthSnare, platillo: synthHihat };
function playDrum(name, t, vol) {
  if ($samplesChk.checked && window.drumLoader?.has?.(name)) {
    window.drumLoader.playBuffer(name, t, clamp(vol, 0, 1));
    return;
  }
  SYNTH_FALLBACK[name](t, vol);
}

/** Clic del metrónomo según el sonido elegido y el nivel de acento (1 ó 2). */
function playClickSound(t, level) {
  switch ($sonido.value) {
    case 'madera':     synthWood(t, level); break;
    case 'bombo':      playDrum('bombo',      t, level === 2 ? 1.0 : .70); break;
    case 'platillo':   playDrum('platillo',   t, level === 2 ? 0.9 : .55); break;
    case 'redoblante': playDrum('redoblante', t, level === 2 ? 1.0 : .70); break;
    default:           synthClick(t, level);
  }
}

// ──────────────────────────────────────────────
// Patrones de batería (rejilla en corcheas)
// ──────────────────────────────────────────────
const PATTERNS = {
  groove1: { meters: ['4/4'], grid: 8,
    parts: { bombo:[0,4], redoblante:[2,6], platillo:[0,1,2,3,4,5,6,7] } },
  funk: { meters: ['4/4'], grid: 8,
    parts: { bombo:[0,3,4,7], redoblante:[2,6], platillo:[0,1,2,3,4,5,6,7] } },
  rock: { meters: ['4/4'], grid: 8,
    parts: { bombo:[0,4], redoblante:[2,6], platillo:[0,2,4,6] } },
  bossa: { meters: ['4/4'], grid: 8,
    parts: { bombo:[0,3,5], redoblante:[2,4], platillo:[0,2,4,6] } },
  waltz34: { meters: ['3/4'], grid: 6,
    parts: { bombo:[0], redoblante:[2,4], platillo:[0,2,4] } },
  balada68: { meters: ['6/8'], grid: 6,
    parts: { bombo:[0], redoblante:[3], platillo:[0,1,2,3,4,5] } },
  rock128: { meters: ['12/8'], grid: 12,
    parts: { bombo:[0,6], redoblante:[3,9],
             platillo:[0,1,2,3,4,5,6,7,8,9,10,11] } },
  shuffle12: { meters: ['12/8'], grid: 12,
    parts: { bombo:[0,5,6], redoblante:[3,9],
             platillo:[0,2,3,5,6,8,9,11] } },
  odd78: { meters: ['7/8'], grid: 7,
    parts: { bombo:[0,2], redoblante:[4], platillo:[0,1,2,3,4,5,6] } },
};

const PATTERN_METER = {
  groove1:'4/4', funk:'4/4', rock:'4/4', bossa:'4/4', waltz34:'3/4',
  balada68:'6/8', rock128:'12/8', shuffle12:'12/8', odd78:'7/8',
};

let patternTicks     = null;
let muteWhenIncompat = false;

function buildPatternTicks() {
  if (activePattern === 'off') { muteWhenIncompat = false; return null; }
  const pat = PATTERNS[activePattern];
  if (!pat || !pat.meters.includes(getMeterId())) { muteWhenIncompat = true; return null; }
  muteWhenIncompat = false;
  const m = {};
  for (const part of Object.keys(pat.parts))
    m[part] = new Set(pat.parts[part].map(cell => cell * EIGHTH));
  return m;
}

// ──────────────────────────────────────────────
// LEDs
// ──────────────────────────────────────────────
function buildBeatLights() {
  const groups = getGroups();
  $beatLights.innerHTML = '';
  groups.forEach((units, i) => {
    const led = document.createElement('div');
    led.className = 'led' + (i === 0 ? ' first' : '') + (units === 3 ? ' wide' : '');
    $beatLights.appendChild(led);
  });
  setActiveLed(-1);
}
function setActiveLed(idx) {
  $beatLights.querySelectorAll('.led')
    .forEach((el, i) => el.classList.toggle('on', i === idx));
  renderBig(idx, 'beat');
}

/** Único punto de cambio de BPM: lo usan los botones, el teclado y
 *  el modo pantalla completa, así todo queda sincronizado. */
function bumpBPM(delta) {
  $bpm.value = String(clamp(getBPM() + delta, 30, 400));
  onBPMChanged();
}

/** Pulsación sostenida: un paso al tocar y repetición acelerada al mantener.
 *  Sin esto, subir de 60 a 140 en pantalla completa son ochenta toques. */
function holdToRepeat(btn, step) {
  let delayTimer = null, repeatTimer = null, ticks = 0;

  const stop = () => {
    clearTimeout(delayTimer); clearInterval(repeatTimer);
    delayTimer = repeatTimer = null; ticks = 0;
  };

  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    stop();
    bumpBPM(step);
    delayTimer = setTimeout(() => {
      repeatTimer = setInterval(() => {
        ticks++;
        bumpBPM(step * (ticks > 24 ? 5 : 1));   // tras ~2 s pasa a saltos de 5
      }, 80);
    }, 380);
  });

  // Se escucha en window: si el dedo se levanta fuera del botón, igual para.
  ['pointerup', 'pointercancel'].forEach(ev =>
    window.addEventListener(ev, stop)
  );
  btn.addEventListener('pointerleave', stop);

  // Activación por teclado (Enter sobre el botón enfocado): el click sintético
  // llega con detail 0, así que no se duplica con el del puntero.
  btn.addEventListener('click', e => { if (e.detail === 0) bumpBPM(step); });
}

// ──────────────────────────────────────────────
// Modo pantalla completa
// El número del pulso en grande: se lee desde el fondo del salón.
// ──────────────────────────────────────────────
function fsIsOpen() { return !$fsMode.hidden; }

/** Dibuja la línea de conteo: "1 & 2 & 3 & 4 &".
 *  Si hay demasiadas casillas para que se lean de lejos, deja solo los pulsos. */
let fsDense = false;
function buildFsCount() {
  fsDense = countSeq.length > 16;
  const items = fsDense ? countSeq.filter(e => e.pulse) : countSeq;
  $fsCount.innerHTML = '';
  for (const e of items) {
    const c = document.createElement('div');
    c.className = 'fs-beat lvl' + (accents[e.pi] ?? 1) + (e.pulse ? ' strong' : ' weak');
    c.dataset.seq = String(e.seq);
    c.textContent = e.label;
    $fsCount.appendChild(c);
  }
}

function refreshFsMeta() {
  const bpm = getBPM();
  $fsMeter.textContent   = getMeterId();
  $fsBpm.textContent     = String(bpm);
  $fsBpmUnit.textContent = 'BPM ' + getMeter().bpmLabel;
  $fsTempo.textContent   = getTempoName(bpm);
  if ($fsSlider.value !== String(bpm)) $fsSlider.value = String(bpm);
}

/** Pinta la posición actual del conteo en grande.
 *  seqIdx es el índice dentro de countSeq; kind: 'beat' | 'sub' | 'countin'. */
function renderCount(seqIdx, kind) {
  if (!fsIsOpen()) return;

  if (seqIdx < 0) {
    $fsNumber.textContent = '1';
    $fsNumber.className = 'fs-number lvl0';
    $fsCount.querySelectorAll('.fs-beat').forEach(c => c.classList.remove('on'));
    return;
  }

  const e = countSeq[seqIdx];
  if (!e) return;
  const level = kind === 'countin' ? 2 : (accents[e.pi] ?? 1);

  $fsNumber.textContent = e.label;
  // Reinicia la animación de golpe cambiando la clase con un reflow de por medio.
  $fsNumber.className = 'fs-number';
  void $fsNumber.offsetWidth;
  $fsNumber.className = 'fs-number hit lvl' + level
                      + (e.pulse ? '' : ' sub')
                      + (kind === 'countin' ? ' countin' : '');

  $fsCount.querySelectorAll('.fs-beat')
    .forEach(c => c.classList.toggle('on', c.dataset.seq === String(seqIdx)));
}

/** Atajo para los pulsos, que es lo que conocen los LEDs. */
function renderBig(pulseIdx, kind) {
  if (pulseIdx < 0) { renderCount(-1, kind); return; }
  const seqIdx = pulseSeq[pulseIdx];
  if (seqIdx !== undefined) renderCount(seqIdx, kind);
}

function openBig() {
  $fsMode.hidden = false;
  document.documentElement.classList.add('fs-open');
  buildFsCount();
  refreshFsMeta();
  syncFsToggle();
  $fsBar.textContent = isPlaying ? $barCounter.textContent : '–';
  renderBig(-1);
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  $fsExit.focus();
}

function closeBig() {
  $fsMode.hidden = true;
  document.documentElement.classList.remove('fs-open');
  if (document.fullscreenElement && document.exitFullscreen)
    document.exitFullscreen().catch(() => {});
  else if (document.webkitFullscreenElement && document.webkitExitFullscreen)
    document.webkitExitFullscreen();
  $fsBtn.focus();
}

function syncFsToggle() {
  $fsToggle.textContent = isPlaying ? 'Detener' : 'Iniciar';
  $fsToggle.classList.toggle('stop', isPlaying);
}

holdToRepeat($fsUp, 1);
holdToRepeat($fsDown, -1);
$fsSlider.addEventListener('input', () => {
  $bpm.value = $fsSlider.value;
  onBPMChanged();
});
$fsTap.addEventListener('click', handleTap);

$fsBtn.addEventListener('click', openBig);
$fsExit.addEventListener('click', closeBig);
$fsToggle.addEventListener('click', toggleMetronome);

// Si el usuario sale del modo nativo (Esc, gesto del sistema), cerramos el overlay.
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
  document.addEventListener(ev, () => {
    const native = document.fullscreenElement || document.webkitFullscreenElement;
    if (!native && fsIsOpen()) {
      $fsMode.hidden = true;
      document.documentElement.classList.remove('fs-open');
    }
  })
);

// ──────────────────────────────────────────────
// Flash
// ──────────────────────────────────────────────
let flashTimer = null;
function doFlash() {
  if (!$flashChk.checked || reducedMotion.matches) return;
  clearTimeout(flashTimer);
  $flashOverlay.classList.add('on');
  flashTimer = setTimeout(() => $flashOverlay.classList.remove('on'), 90);
}

// ──────────────────────────────────────────────
// Péndulo dibujado con rAF sobre el reloj de audio
// Cada pulso programado deja su marca; el rAF interpola entre marcas.
// ──────────────────────────────────────────────
const SWING_DEG = 20;
let pulseMarks = [];   // [{t, dur, parity}]
let rafId   = null;
let rafSeen = false;

function markPulse(t, dur, parity) {
  pulseMarks.push({ t, dur, parity });
  if (pulseMarks.length > 32) pulseMarks.splice(0, pulseMarks.length - 32);
}

/** Duración de un pulso en segundos (promedio si el compás es irregular). */
function pulseSeconds() {
  const plan = barPlan || buildBarPlan();
  return (plan.ticks / plan.pulses.length) * secPerTick();
}

/** Alimenta la animación CSS de reserva. */
function setPendulumSpeed() {
  document.documentElement.style.setProperty('--beat-sec', pulseSeconds().toFixed(4));
}

function pendulumFrame() {
  rafId = requestAnimationFrame(pendulumFrame);
  rafSeen = true;
  if (reducedMotion.matches) return;
  const now = actx.currentTime;
  let cur = null;
  for (let i = pulseMarks.length - 1; i >= 0; i--) {
    if (pulseMarks[i].t <= now) { cur = pulseMarks[i]; break; }
  }
  if (!cur) return;
  const phase = clamp((now - cur.t) / cur.dur, 0, 1);
  const dir   = cur.parity ? -1 : 1;
  const angle = dir * SWING_DEG * Math.cos(Math.PI * phase);
  $pendulumArm.style.transform = `rotate(${angle.toFixed(2)}deg)`;
}

function pendulumStart() {
  setPendulumSpeed();
  $pendulumArm.classList.remove('playing');
  $pendulumArm.classList.add('js-driven');
  rafSeen = false;
  if (rafId === null) rafId = requestAnimationFrame(pendulumFrame);
  // Si el entorno no dispara rAF (pestaña sin compositor, WebView exótico),
  // devolvemos el control a la animación CSS para no dejar el brazo quieto.
  setTimeout(() => {
    if (isPlaying && !rafSeen) {
      $pendulumArm.style.transform = '';
      $pendulumArm.classList.remove('js-driven');
      $pendulumArm.classList.add('playing');
    }
  }, 400);
}
function pendulumStop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  pulseMarks = [];
  $pendulumArm.classList.remove('playing');
  $pendulumArm.classList.add('js-driven');
  $pendulumArm.style.transform = `rotate(${-SWING_DEG}deg)`;
}

// ──────────────────────────────────────────────
// Count-in display
// ──────────────────────────────────────────────
function showCountBeat(n) {
  if (n < 0) { $countinDisp.classList.remove('show'); return; }
  $countinDisp.textContent = String(n + 1);
  $countinDisp.classList.add('show');
  renderBig(n, 'countin');
}

// ──────────────────────────────────────────────
// Gap click y tempo progresivo
// ──────────────────────────────────────────────
function isMutedBar(bar) {
  if (!$gapChk.checked) return false;
  const play = intOf($gapPlay, 2, 1, 32);
  const mute = intOf($gapMute, 2, 0, 32);
  const cycle = play + mute;
  if (cycle <= 0) return false;
  return (bar % cycle) >= play;
}

function applyTempoRamp(bar) {
  if (!$rampChk.checked || tempoRampBase === null) return;
  const every  = intOf($rampBars, 4, 1, 64);
  const amount = intOf($rampAmount, 4, 1, 40);
  const top    = intOf($rampMax, 180, 30, 400);
  const steps  = Math.floor(bar / every);
  const target = clamp(Math.min(tempoRampBase + steps * amount, top), 30, 400);
  if (target !== getBPM()) {
    $bpm.value = String(target);
    onBPMChanged({ keepRamp: true });
  }
}

// ──────────────────────────────────────────────
// Scheduler
// ──────────────────────────────────────────────
function secPerTick() { return (60 / getBPM()) / getMeter().bpmTicks; }

/** Programa un tick. Devuelve nada; toda la UI se difiere con setTimeout. */
function scheduleTick(tick, bar, when) {
  const plan = barPlan;
  const spt  = secPerTick();
  const uiDelay = Math.max(0, (when - actx.currentTime) * 1000);

  // ── Count-in ──
  if (countInLeft > 0) {
    const hit = clickMap.get(tick);
    if (hit && hit.pulse) {
      synthCountIn(when, hit.pi === 0);
      const p = plan.pulses[hit.pi];
      markPulse(when, p.len * spt, hit.pi % 2 === 1);
      setTimeout(() => { setActiveLed(hit.pi); showCountBeat(hit.pi); }, uiDelay);
    }
    return;
  }

  const hit    = clickMap.get(tick);
  const muted  = isMutedBar(bar);
  const isBar1 = tick === 0;

  // ── Visual ──
  if (hit && hit.pulse) {
    const p = plan.pulses[hit.pi];
    markPulse(when, p.len * spt, hit.pi % 2 === 1);
    setTimeout(() => {
      setActiveLed(hit.pi);
      if (isBar1) {
        doFlash();
        $barCounter.textContent = String(bar + 1);
        $barCounter.classList.toggle('muted-bar', muted);
        $fsBar.textContent = String(bar + 1);
        $fsMode.classList.toggle('muted-bar', muted);
      }
    }, uiDelay);
  }

  // Las subdivisiones solo se pintan en pantalla completa, que es donde
  // se lee la línea de conteo.
  if (hit && !hit.pulse && fsIsOpen()) {
    const seqIdx = hit.seq;
    setTimeout(() => renderCount(seqIdx, 'sub'), uiDelay);
  }

  if (muted) return;   // gap click: silencio total, la cuenta sigue

  // ── Clic del metrónomo (silenciado si hay groove activo) ──
  if (!patternTicks && !muteWhenIncompat && hit) {
    const level = accents[hit.pi] ?? 1;
    if (level > 0) playClickSound(when, hit.pulse ? level : 1);
  }

  // ── Groove de batería ──
  if (patternTicks) {
    if (patternTicks.bombo?.has(tick))      playDrum('bombo',      when, 1.0);
    if (patternTicks.redoblante?.has(tick)) playDrum('redoblante', when, 0.9);
    if (patternTicks.platillo?.has(tick))   playDrum('platillo',   when, 0.75);
  }
}

function scheduler() {
  const ctx = actx;
  while (nextNoteTime < ctx.currentTime + AHEAD_TIME) {
    scheduleTick(tickInBar, barIndex, nextNoteTime);
    nextNoteTime += secPerTick();
    tickInBar++;
    if (tickInBar >= barPlan.ticks) {
      tickInBar = 0;
      if (countInLeft > 0) {
        countInLeft--;
        if (countInLeft === 0) {
          const d = Math.max(0, (nextNoteTime - ctx.currentTime) * 1000);
          setTimeout(() => showCountBeat(-1), d);
        }
      } else {
        barIndex++;
        applyTempoRamp(barIndex);
      }
    }
  }
}

// Timer en Worker: setInterval en el hilo principal se estrangula a 1 Hz
// cuando la pestaña pierde el foco y el metrónomo se entrecorta.
let timerWorker = null;
function makeTimerWorker() {
  const src = `let id=null;onmessage=e=>{
    if(e.data.cmd==='start'){clearInterval(id);id=setInterval(()=>postMessage('tick'),e.data.interval);}
    else if(e.data.cmd==='stop'){clearInterval(id);id=null;}
  };`;
  try {
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    w.onmessage = () => { if (isPlaying) scheduler(); };
    return w;
  } catch { return null; }
}

let fallbackTimer = null;
function startScheduler() {
  tickInBar    = 0;
  barIndex     = 0;
  nextNoteTime = actx.currentTime + 0.06;
  if (!timerWorker) timerWorker = makeTimerWorker();
  if (timerWorker) timerWorker.postMessage({ cmd: 'start', interval: LOOKAHEAD });
  else fallbackTimer = setInterval(() => { if (isPlaying) scheduler(); }, LOOKAHEAD);
}
function stopScheduler() {
  if (timerWorker) timerWorker.postMessage({ cmd: 'stop' });
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
}

// ──────────────────────────────────────────────
// Control
// ──────────────────────────────────────────────
function startMetronome() {
  ac();
  rebuildTiming();
  countInLeft   = $countInChk.checked ? intOf($countInBars, 1, 1, 4) : 0;
  tempoRampBase = $rampChk.checked ? getBPM() : null;
  isPlaying = true;
  $toggleBtn.querySelector('.play-label').textContent = 'Detener';
  $toggleBtn.classList.add('stop');
  $barCounter.textContent = '1';
  $srStatus.textContent = `Metrónomo iniciado a ${getBPM()} BPM en ${getMeterId()}`;
  syncFsToggle();
  pendulumStart();
  startScheduler();
}

function stopMetronome() {
  isPlaying   = false;
  countInLeft = 0;
  showCountBeat(-1);
  $toggleBtn.querySelector('.play-label').textContent = 'Iniciar';
  $toggleBtn.classList.remove('stop');
  $srStatus.textContent = 'Metrónomo detenido';
  setActiveLed(-1);
  syncFsToggle();
  $fsBar.textContent = '–';
  $fsMode.classList.remove('muted-bar');
  $barCounter.textContent = '–';
  $barCounter.classList.remove('muted-bar');
  pendulumStop();
  stopScheduler();
  if (tempoRampBase !== null) {
    $bpm.value = String(tempoRampBase);
    onBPMChanged();
    tempoRampBase = null;
  }
}

function toggleMetronome() { isPlaying ? stopMetronome() : startMetronome(); }

function resetAll() {
  stopMetronome();
  $bpm.value = '120'; $bpmSlider.value = '120';
  $volumen.value = '0.8';
  $compas.value = '4/4';
  $sonido.value = 'click';
  $countInChk.checked = false;
  $flashChk.checked   = true;
  $samplesChk.checked = true;
  $gapChk.checked     = false;
  $rampChk.checked    = false;
  activePattern = 'off';
  setPatternUI('off');
  accents = [];
  buildAll();
  $subdiv.value = 'p1';
  rebuildTiming();
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
  patternTicks = buildPatternTicks();
  $sonido.disabled = !!patternTicks;

  if (activePattern === 'off')      $patternNotice.textContent = 'Pista apagada.';
  else if (muteWhenIncompat)        $patternNotice.textContent =
    `Esta pista requiere compás de ${PATTERN_METER[activePattern]}.`;
  else if (patternTicks)            $patternNotice.textContent = 'Pista activa y sincronizada al tempo.';
  else                              $patternNotice.textContent = 'Incompatible con el compás actual.';
}

// ──────────────────────────────────────────────
// Build
// ──────────────────────────────────────────────
function rebuildTiming() {
  barPlan  = buildBarPlan();
  clickMap = buildClickMap(barPlan);
  patternTicks = buildPatternTicks();
  setPendulumSpeed();
  if (fsIsOpen()) buildFsCount();
}

function buildAll() {
  buildGroupingOptions();
  buildSubdivOptions();
  buildBeatLights();
  buildAccentGrid();
  rebuildTiming();
  rebuildPattern();
  $tempoName.textContent = getTempoName(getBPM());
  $bpmUnitHint.textContent = getMeter().bpmLabel;
  if (fsIsOpen()) { buildFsCount(); refreshFsMeta(); }
}

function updateSliderFills() {
  const pct = ((getBPM() - 30) / 370 * 100).toFixed(1) + '%';
  $bpmSlider.style.setProperty('--fill', pct);
  $fsSlider.style.setProperty('--fill', pct);
  $volumen.style.setProperty('--vfill', (getVol() * 100).toFixed(1) + '%');
}

function onBPMChanged(opts = {}) {
  const v = getBPM();
  $bpm.value = String(v);
  $bpmSlider.value = String(v);
  $tempoName.textContent = getTempoName(v);
  updateSliderFills();
  setPendulumSpeed();
  refreshFsMeta();
  if (!opts.keepRamp && isPlaying && tempoRampBase !== null) tempoRampBase = v;
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
    for (let i = 1; i < tapTimes.length; i++) ints.push(tapTimes[i] - tapTimes[i - 1]);
    const avg  = ints.reduce((a, b) => a + b, 0) / ints.length;
    const calc = clamp(Math.round(60000 / avg), 30, 400);
    $bpm.value = String(calc);
    $tapAvg.textContent = `≈ ${calc} BPM`;
    onBPMChanged();
  } else {
    $tapAvg.textContent = '…';
  }
}

// ──────────────────────────────────────────────
// Tema
// ──────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $themeToggle.setAttribute('aria-label', t === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  try { localStorage.setItem('metro-theme', t); } catch {}
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// ──────────────────────────────────────────────
// Listeners
// ──────────────────────────────────────────────
$toggleBtn.addEventListener('click', toggleMetronome);
$resetBtn.addEventListener('click', resetAll);
$themeToggle.addEventListener('click', toggleTheme);

holdToRepeat($bpmUp, 1);
holdToRepeat($bpmDown, -1);

$bpm.addEventListener('input', () => {
  const v = clamp(parseInt($bpm.value) || 30, 30, 400);
  $bpmSlider.value = String(v);
  $tempoName.textContent = getTempoName(v);
  updateSliderFills();
});
$bpm.addEventListener('change', () => onBPMChanged());
$bpmSlider.addEventListener('input', () => { $bpm.value = $bpmSlider.value; onBPMChanged(); });

$volumen.addEventListener('input', () => {
  masterGain.gain.setTargetAtTime(getVol(), actx.currentTime, 0.01);
  updateSliderFills();
});

$compas.addEventListener('change', () => { accents = []; buildAll(); });
$grouping.addEventListener('change', () => {
  accents = [];
  buildBeatLights(); buildAccentGrid(); rebuildTiming(); rebuildPattern();
});
$subdiv.addEventListener('change', rebuildTiming);
$samplesChk.addEventListener('change', () => {
  $srStatus.textContent = $samplesChk.checked ? 'Samples activados' : 'Sonidos sintetizados';
});

$tapBtn.addEventListener('click', handleTap);

$patternBtns.addEventListener('click', e => {
  const btn = e.target.closest('.pat-btn');
  if (!btn) return;
  activePattern = btn.dataset.pattern || 'off';
  setPatternUI(activePattern);
  const req = PATTERN_METER[activePattern];
  if (req && getMeterId() !== req) {
    $compas.value = req;
    accents = [];
    buildAll();
  } else {
    rebuildTiming();
    rebuildPattern();
  }
});

window.addEventListener('keydown', e => {
  const el = document.activeElement;
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  if (e.code === 'Space') {
    if (typing && el.type !== 'range') return;
    e.preventDefault(); toggleMetronome();
  } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    if (typing) return;
    e.preventDefault();
    bumpBPM((e.shiftKey ? 5 : 1) * (e.code === 'ArrowUp' ? 1 : -1));
  } else if (e.code === 'KeyT' && !typing) {
    handleTap();
  } else if (e.code === 'KeyF' && !typing) {
    fsIsOpen() ? closeBig() : openBig();
  } else if (e.code === 'Escape' && fsIsOpen()) {
    closeBig();
  }
});

// ──────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────
(function init() {
  let saved = 'dark';
  try { saved = localStorage.getItem('metro-theme') || 'dark'; } catch {}
  applyTheme(saved);
  buildAll();
  $subdiv.value = 'p1';
  rebuildTiming();
  masterGain.gain.value = getVol();
  updateSliderFills();
  pendulumStop();   // deja el brazo en reposo

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // updateViaCache 'none': el navegador no sirve un sw.js viejo desde su caché HTTP.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Solo recargamos si ya había una versión activa: en la primera visita
      // el cambio de controlador es normal y recargar sería molesto.
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });

    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update().catch(() => {});
        // Al volver a la pestaña comprobamos si hay una versión nueva publicada.
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  }
})();
