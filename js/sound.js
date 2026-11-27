/* مؤثرات صوتية مولّدة بـ Web Audio (بدون ملفات) + الاهتزاز */
window.WB = window.WB || {};

WB.Sound = (() => {
  let ctx = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function enabled() { return WB.Store.settings.sound && WB.Store.settings.volume > 0; }

  function tone(freq, { dur = 0.12, type = "sine", gain = 0.25, delay = 0, slide = 0 } = {}) {
    const a = ac();
    if (!a) return;
    const vol = (WB.Store.settings.volume / 100) * gain;
    const t = a.currentTime + delay;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  const sounds = {
    tap: () => tone(520, { dur: 0.05, type: "triangle", gain: 0.12 }),
    reveal: () => { tone(440, { dur: 0.12, type: "triangle" }); tone(660, { dur: 0.18, type: "triangle", delay: 0.09 }); },
    start: () => { tone(392, { dur: 0.1 }); tone(523, { dur: 0.1, delay: 0.1 }); tone(784, { dur: 0.22, delay: 0.2 }); },
    tick: () => tone(1100, { dur: 0.04, type: "square", gain: 0.06 }),
    tickHard: () => tone(1400, { dur: 0.06, type: "square", gain: 0.1 }),
    timeUp: () => { tone(220, { dur: 0.5, type: "sawtooth", gain: 0.18, slide: -80 }); tone(180, { dur: 0.5, type: "sawtooth", gain: 0.12, delay: 0.05 }); },
    got: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, { dur: 0.16, type: "triangle", delay: i * 0.07 })),
    miss: () => { tone(330, { dur: 0.18, type: "triangle" }); tone(247, { dur: 0.3, type: "triangle", delay: 0.14 }); },
    win: () => [523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, { dur: 0.22, type: "triangle", gain: 0.22, delay: i * 0.12 })),
    join: () => tone(880, { dur: 0.1, type: "sine", gain: 0.12 })
  };

  function play(name) {
    if (!enabled()) return;
    try { sounds[name] && sounds[name](); } catch { /* تجاهل */ }
  }

  function vibrate(pattern) {
    if (!WB.Store.settings.vibrate) return;
    // المتصفح يمنع الاهتزاز قبل أول لمسة من المستخدم
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* تجاهل */ }
  }

  // فتح سياق الصوت بعد أول لمسة (متطلب المتصفحات)
  window.addEventListener("pointerdown", () => { if (enabled()) ac(); }, { once: true });

  return { play, vibrate };
})();
