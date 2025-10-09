/* ===========================================
   Metrónomo Musicala – sounds.js (preciso)
   - Carga y reproduce samples con AudioBuffer
   - Autounlock de AudioContext en primer gesto
   - Precarga de bombo/platillo/redoblante
   - API global: window.drumLoader
   =========================================== */

(function(){
  // ---- AudioContext (compartido con script.js si existe) ----
  const ctx = (window.drumLoader?.ctx) || new (window.AudioContext || window.webkitAudioContext)();

  // ---- Master gain (por si quieres controlar volumen global de samples) ----
  const master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(ctx.destination);

  // ---- Cache de buffers ----
  const cache = Object.create(null);

  // ---- Desbloqueo en móviles (iOS/Android) ----
  function unlockAudio() {
    if (ctx.state === "running") return;
    const resume = () => ctx.resume().catch(()=>{});
    window.addEventListener("touchstart", resume, { once:true, passive:true });
    window.addEventListener("pointerdown", resume, { once:true, passive:true });
    window.addEventListener("keydown", resume, { once:true, passive:true });
    window.addEventListener("click", resume, { once:true, passive:true });
  }
  unlockAudio();

  // ---- Util para cargar y decodificar ----
  async function load(name, url){
    if (cache[name]) return cache[name];
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    cache[name] = buf;
    return buf;
  }

  // ---- Reproducir un buffer a tiempo absoluto (segundos) ----
  function playBuffer(name, when, gainValue = 0.9, playbackRate = 1.0){
    const buf = cache[name];
    if (!buf) return; // aún no cargado
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;

    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, gainValue));

    src.connect(g).connect(master);
    src.start(Math.max(ctx.currentTime, when));
  }

  // ---- API Pública ----
  window.drumLoader = {
    ctx,
    load,
    playBuffer,

    /** Precarga múltiple: { name: "bombo", url: "bombo.mp3" }, ... */
    async preload(list){
      await Promise.all(list.map(it => load(it.name, it.url)));
    },

    /** Cambia el volumen master de TODOS los samples (0..1) */
    setMasterGain(v){
      master.gain.value = Math.max(0, Math.min(1, Number(v) || 0));
    }
  };

  // ---- Precarga por defecto (puedes ajustar extensiones/rutas) ----
  // Comenta si prefieres cargar on-demand.
  document.addEventListener("DOMContentLoaded", () => {
    window.drumLoader.preload([
      { name: "bombo",      url: "bombo.wav" },
      { name: "platillo",   url: "platillo.wav" },
      { name: "redoblante", url: "redoblante.wav" },
    ]).catch(err => {
      // Si falla la precarga no rompemos nada; script.js hará fallback.
      console.warn("[drumLoader] Precarga fallida:", err);
    });
  });

})();
