let isPlaying = false;
let interval = null;
let beatCount = 0;
let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let metronomeCircle = document.getElementById("metronome-circle");

function playClick(isAccent, soundType) {
    if (soundType === "click") {
        // Clic Digital con oscilador
        let osc = audioContext.createOscillator();
        let gain = audioContext.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(isAccent ? 1200 : 800, audioContext.currentTime);
        gain.gain.setValueAtTime(isAccent ? 0.7 : 0.4, audioContext.currentTime);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start();
        osc.stop(audioContext.currentTime + 0.05);
    } else {
        // Sonidos Reales
        let sound = sonidos[soundType];
        if (sound) {
            sound.currentTime = 0;
            sound.play();
        }
    }

    // Efecto de movimiento
    metronomeCircle.style.transform = isAccent ? "scale(1.2)" : "scale(1)";
    metronomeCircle.style.backgroundColor = isAccent ? "green" : "blue";
    setTimeout(() => {
        metronomeCircle.style.backgroundColor = "gray";
        metronomeCircle.style.transform = "scale(1)";
    }, 100);
}

function startMetronome() {
    let bpm = document.getElementById("bpm").value;
    let beatsPerMeasure = document.getElementById("compas").value;
    let subdivision = document.getElementById("subdivision").value;
    let soundType = document.getElementById("sonido").value;
    let intervalTime = (60 / bpm) * 1000 / subdivision;

    interval = setInterval(() => {
        playClick(beatCount % beatsPerMeasure === 0, soundType);
        beatCount++;
    }, intervalTime);

    isPlaying = true;
}

function toggleMetronome() {
    if (isPlaying) {
        clearInterval(interval);
        isPlaying = false;
        beatCount = 0;
        metronomeCircle.style.transform = "scale(1)";
    } else {
        startMetronome();
    }
}
