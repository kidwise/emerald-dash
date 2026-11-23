// Small procedural sound engine: everything is synthesised, no audio files.
export function createAudio() {
  let ctx = null, master = null, n = null;
  const api = { muted: false };

  const noiseBuffer = () => {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  };
  const loopNoise = (buf, type, freq, q, gain) => {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(master); src.start();
    return { f, g };
  };

  api.start = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = api.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    const buf = noiseBuffer();
    n = { buf };
    n.rain = loopNoise(buf, 'highpass', 2400, 0.4, 0.035);
    n.rain2 = loopNoise(buf, 'bandpass', 520, 0.6, 0.03);
    n.road = loopNoise(buf, 'bandpass', 900, 0.5, 0.0);
    n.skid = loopNoise(buf, 'bandpass', 1700, 5, 0.0);
    // electric drivetrain whine
    n.o1 = ctx.createOscillator(); n.o1.type = 'sawtooth';
    n.o2 = ctx.createOscillator(); n.o2.type = 'triangle';
    n.lp = ctx.createBiquadFilter(); n.lp.type = 'lowpass'; n.lp.frequency.value = 500; n.lp.Q.value = 2;
    n.eg = ctx.createGain(); n.eg.gain.value = 0;
    n.o1.connect(n.lp); n.o2.connect(n.lp); n.lp.connect(n.eg).connect(master);
    n.o1.start(); n.o2.start();
  };

  api.update = (s) => {
    if (!ctx) return;
    const t = ctx.currentTime, sp = s.speed;
    const k = Math.min(1, sp / 38);
    n.o1.frequency.setTargetAtTime(48 + sp * 9.5 + (s.boost ? 40 : 0), t, 0.06);
    n.o2.frequency.setTargetAtTime((48 + sp * 9.5) * 2.02, t, 0.06);
    n.lp.frequency.setTargetAtTime(260 + sp * 55 + s.throttle * 500, t, 0.08);
    n.eg.gain.setTargetAtTime(s.active ? 0.018 + 0.05 * k + 0.03 * Math.max(0, s.throttle) : 0, t, 0.1);
    n.road.g.gain.setTargetAtTime(s.active ? 0.02 + 0.22 * k : 0, t, 0.1);
    n.road.f.frequency.setTargetAtTime(700 + sp * 60, t, 0.1);
    n.skid.g.gain.setTargetAtTime(s.active ? Math.min(0.20, Math.max(0, s.slip - 2.2) * 0.035) : 0, t, 0.05);
    n.skid.f.frequency.setTargetAtTime(1400 + s.slip * 60, t, 0.05);
  };

  const tone = (freq, dur, type = 'sine', gain = 0.2, when = 0, slideTo = null) => {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  };
  const burst = (dur, type, f0, f1, gain = 0.3, when = 0) => {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = n.buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  };

  api.play = (name, v = 1) => {
    if (!ctx) return;
    switch (name) {
      case 'throw': burst(0.28, 'bandpass', 2600, 500, 0.22); break;
      case 'good': tone(784, 0.22, 'triangle', 0.2); tone(1175, 0.34, 'triangle', 0.2, 0.09); break;
      case 'perfect': tone(784, 0.2, 'triangle', 0.22); tone(1175, 0.2, 'triangle', 0.22, 0.08); tone(1568, 0.5, 'triangle', 0.24, 0.16); tone(2349, 0.6, 'sine', 0.08, 0.16); break;
      case 'miss': tone(180, 0.25, 'square', 0.07, 0, 90); burst(0.18, 'lowpass', 500, 120, 0.2); break;
      case 'thud': burst(0.12, 'lowpass', 700, 150, 0.22); break;
      case 'crash': burst(0.4, 'lowpass', 1800, 90, Math.min(0.6, 0.25 + v * 0.03)); tone(90, 0.3, 'sine', 0.3, 0, 40); break;
      case 'boost': tone(300, 0.5, 'sawtooth', 0.09, 0, 1400); burst(0.6, 'bandpass', 500, 4000, 0.16); break;
      case 'bell': tone(1318, 0.9, 'sine', 0.12); tone(1975, 0.7, 'sine', 0.05); tone(1318, 0.9, 'sine', 0.12, 0.32); tone(1975, 0.7, 'sine', 0.05, 0.32); break;
      case 'place': tone(523, 0.3, 'sine', 0.1); tone(659, 0.3, 'sine', 0.1, 0.1); tone(784, 0.5, 'sine', 0.1, 0.2); break;
      case 'tick': tone(1000, 0.05, 'square', 0.05); break;
      case 'start': tone(392, 0.15, 'triangle', 0.16); tone(523, 0.15, 'triangle', 0.16, 0.14); tone(784, 0.4, 'triangle', 0.2, 0.28); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, 'triangle', 0.2, i * 0.12)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, 0.5, 'triangle', 0.16, i * 0.18)); break;
    }
  };

  api.toggleMute = () => { api.muted = !api.muted; if (master) master.gain.setTargetAtTime(api.muted ? 0 : 0.8, ctx.currentTime, 0.05); return api.muted; };
  return api;
}
