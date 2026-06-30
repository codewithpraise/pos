// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - PREMIUM SYNTHESIZED SOUND DESIGN
// Powered by HTML5 Web Audio API (Zero external assets required)
// ============================================================================

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.suppressed = false; // Flag to stop failing infinitely
  }

  init() {
    if (this.ctx || this.suppressed) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
        console.log('[SoundEngine] Web Audio Context initialized.');
      }
    } catch (e) {
      console.warn('[SoundEngine] AudioContext suppressed by browser security policy.', e);
      this.suppressed = true;
    }
  }

  playTick() {
    this.init();
    if (!this.ctx || this.suppressed) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1500, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.02, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.015);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.02);
    } catch (e) {}
  }

  playScanSuccess() {
    this.init();
    if (!this.ctx || this.suppressed) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1100, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.045);
      osc.frequency.setValueAtTime(1500, now + 0.05);
      gain.gain.setValueAtTime(0.08, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.13);
    } catch (e) {}
  }

  playScanError() {
    this.init();
    if (!this.ctx || this.suppressed) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.linearRampToValueAtTime(80, now + 0.25);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) {}
  }

  playDrawerOpen() {
    this.init();
    if (!this.ctx || this.suppressed) return;
    try {
      const now = this.ctx.currentTime;
      const frequencies = [880, 1200, 1600, 2200];
      const masterGain = this.ctx.createGain();
      masterGain.connect(this.ctx.destination);
      masterGain.gain.setValueAtTime(0.08, now);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      frequencies.forEach((freq) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(freq, now);
        osc.connect(filter);
        filter.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.8);
      });
    } catch(e) {}
  }

  playSiren() {
    this.init();
    if (!this.ctx || this.suppressed) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.linearRampToValueAtTime(850, now + 0.15);
      osc.frequency.linearRampToValueAtTime(650, now + 0.3);
      osc.frequency.linearRampToValueAtTime(850, now + 0.45);
      osc.frequency.linearRampToValueAtTime(650, now + 0.6);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
      osc.start(now);
      osc.stop(now + 0.7);
    } catch(e) {}
  }
}

// Global window instance
window.sounds = new SoundEngine();
document.addEventListener('click', () => { try { window.sounds.init(); } catch (err) {} }, { once: true });
document.addEventListener('keydown', () => { try { window.sounds.init(); } catch (err) {} }, { once: true });

window.playTone = function(type) {
  if (!window.sounds) return;
  try {
    if (type === 'click') window.sounds.playTick();
    else if (type === 'success' || type === 'login') window.sounds.playScanSuccess();
    else if (type === 'error') window.sounds.playScanError();
    else if (type === 'reset') window.sounds.playSiren();
    else if (type === 'checkout') window.sounds.playDrawerOpen();
  } catch (err) {
    console.warn('[SoundEngine] playTone execution failed:', err);
  }
};
