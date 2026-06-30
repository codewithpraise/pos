// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - PREMIUM SYNTHESIZED SOUND DESIGN
// Powered by HTML5 Web Audio API (Zero external assets required)
// ============================================================================

class SoundEngine {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) return;
    // Create audio context lazily on user interaction to satisfy browser policies
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();
    console.log('[SoundEngine] Web Audio Context initialized.');
  }

  // Key click click feedback (High frequency, rapid transient decay)
  playTick() {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, this.ctx.currentTime);
    
    // Tactile envelope
    gain.gain.setValueAtTime(0.02, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.015);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.02);
  }

  // High-performance barcode scanner beep (Double chirp chime)
  playScanSuccess() {
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = 'sine';
    
    // Chime 1
    osc.frequency.setValueAtTime(1100, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.045);
    
    // Chime 2
    osc.frequency.setValueAtTime(1500, now + 0.05);
    gain.gain.setValueAtTime(0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    osc.start(now);
    osc.stop(now + 0.13);
  }

  // Barcode scanner error / invalid operation (Low pitch square hum)
  playScanError() {
    this.init();
    if (!this.ctx) return;

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
  }

  // Cash register opening (Metallic bell chime)
  playDrawerOpen() {
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // Create multiple oscillators to create a rich metal-hitting timbre
    const frequencies = [880, 1200, 1600, 2200];
    const oscillators = [];
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
      oscillators.push(osc);
    });
  }

  // Manager Authorization alert (dual-frequency warble siren)
  playSiren() {
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = 'triangle';
    
    // Warble effect (LFO simulation)
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.linearRampToValueAtTime(850, now + 0.15);
    osc.frequency.linearRampToValueAtTime(650, now + 0.3);
    osc.frequency.linearRampToValueAtTime(850, now + 0.45);
    osc.frequency.linearRampToValueAtTime(650, now + 0.6);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

    osc.start(now);
    osc.stop(now + 0.7);
  }
}

// Global window instance
window.sounds = new SoundEngine();
document.addEventListener('click', () => window.sounds.init(), { once: true });
document.addEventListener('keydown', () => window.sounds.init(), { once: true });

window.playTone = function(type) {
  if (!window.sounds) return;
  if (type === 'click') window.sounds.playTick();
  else if (type === 'success' || type === 'login') window.sounds.playScanSuccess();
  else if (type === 'error') window.sounds.playScanError();
  else if (type === 'reset') window.sounds.playSiren();
  else if (type === 'checkout') window.sounds.playDrawerOpen();
};
