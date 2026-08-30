/* ===========================================
   Metrónomo Musicala – sounds.js
   Carga y reproduce samples de batería con AudioBuffer.
   Comparte el AudioContext y el master gain de script.js
   (window.__metroCtx / window.__metroMaster) para que los
   tiempos absolutos coincidan con los del scheduler.
   API global: window.drumLoader
   =========================================== */

(function(){
  const ctx = window.__metroCtx
           || (window.drumLoader && window.drumLoader.ctx)
           || new (window.AudioContext || window.webkitAudioContext)();

  // Si script.js ya creó un master, colgamos de él para que el
  // control de volumen afecte también a los samples.
  const master = window.__metroMaster || (() => {
    const g = ctx.createGain();
    g.gain.value = 1.0;
    g.connect(ctx.destination);
    return g;
  })();

  const cache = Object.create(null);

  function unlockAudio() {
    if (ctx.state === "running") return;
    const resume = () => ctx.resume().catch(()=>{});
    ["touchstart","pointerdown","keydown","click"].forEach(ev =>
      window.addEventListener(ev, resume, { once:true, passive:true })
    );
  }
  unlockAudio();

  async function load(name, url){
    if (cache[name]) return cache[name];
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    cache[name] = buf;
    return buf;
  }

  /** Reproduce un buffer en tiempo absoluto del AudioContext. */
  function playBuffer(name, when, gainValue = 0.9, playbackRate = 1.0){
    const buf = cache[name];
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, gainValue));
    src.connect(g).connect(master);
    src.start(Math.max(ctx.currentTime, when));
    return true;
  }

  window.drumLoader = {
    ctx,
    load,
    playBuffer,
    /** ¿Está el sample listo para sonar? script.js lo consulta antes de usarlo. */
    has(name){ return !!cache[name]; },
    async preload(list){
      await Promise.all(list.map(it => load(it.name, it.url)));
    },
  };

  // Precarga. Si falla, script.js sigue con los sonidos sintetizados.
  const start = () => window.drumLoader.preload([
    { name: "bombo",      url: "bombo.wav" },
    { name: "platillo",   url: "platillo.wav" },
    { name: "redoblante", url: "redoblante.wav" },
  ]).catch(err => console.warn("[drumLoader] Precarga fallida:", err));

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();

})();
