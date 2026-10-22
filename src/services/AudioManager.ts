/**
 * High-Performance Procedural Audio Engine for Saigon Shipper 3D (Web Audio API)
 * Zero external audio files required, zero latency, 100% device compatible.
 *
 * Provides:
 * 1. Saigon Metropolis Ambient Traffic Soundscape (Plays in Orbit & Shipper modes)
 *    - Continuous road tyre friction & air displacement
 *    - Distant urban exhaust rumble
 *    - Occasional distant scooter honks ("tin tin... bíp bíp!")
 * 2. Player 4-Stroke Scooter Engine (Shipper Mode)
 *    - 85Hz - 320Hz fundamental with rich harmonics (audible on laptop speakers)
 *    - Throttle spooling on W/Up, engine braking on Space/S
 * 3. Authentic Dual-Tone Vietnam Scooter Horn ("Bíp bíp!") on H key
 * 4. Mechanical Turn Signal Relay Click ("Tách - Tắc!") on Q/E/A/D
 */

export class AudioManager {
  private static instance: AudioManager | null = null;

  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private masterGain: GainNode | null = null;

  // City Ambient Traffic Nodes
  private ambientTrafficGain: GainNode | null = null;
  private ambientHumGain: GainNode | null = null;
  private ambientNoiseSource: AudioBufferSourceNode | null = null;
  private ambientOsc1: OscillatorNode | null = null;
  private ambientOsc2: OscillatorNode | null = null;
  private distantHornTimer: any = null;

  // Motorbike Engine Nodes
  private engineMasterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private isEngineRunning: boolean = false;

  // Turn signal state
  private lastBlinkerPhase: boolean = false;

  private constructor() {
    // Check saved mute state, default to unmuted (false)
    const saved = localStorage.getItem('saigon_audio_muted');
    this.isMuted = saved === 'true';

    // Auto-resume AudioContext on ANY first user interaction anywhere in the window
    const unlockAudio = () => {
      this.ensureResumed();
    };

    ['click', 'pointerdown', 'keydown', 'touchstart', 'mousedown'].forEach((evt) => {
      window.addEventListener(evt, unlockAudio, { passive: true });
    });
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /**
   * Initializes or gets the Web Audio Context
   */
  private initContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;

      this.ctx = new AudioContextClass();

      // Master gain node
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0.0 : 0.85, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Start ambient city traffic soundscape immediately
      this.startAmbientTraffic();
    }
    return this.ctx;
  }

  /**
   * Explicitly ensures the AudioContext is resumed from browser suspension
   */
  public async ensureResumed(): Promise<void> {
    const ctx = this.initContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }
  }

  /**
   * Starts rich ambient Saigon street traffic soundscape
   */
  private startAmbientTraffic(): void {
    if (!this.ctx || !this.masterGain) return;

    try {
      // 1. Urban Road Tyre & Traffic Flow Noise
      const sampleRate = this.ctx.sampleRate;
      const bufferLength = sampleRate * 3; // 3-second seamless loop
      const noiseBuffer = this.ctx.createBuffer(2, bufferLength, sampleRate);

      for (let ch = 0; ch < 2; ch++) {
        const data = noiseBuffer.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferLength; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99 * b0 + white * 0.05;
          b1 = 0.96 * b1 + white * 0.11;
          b2 = 0.86 * b2 + white * 0.25;
          data[i] = (b0 + b1 + b2) * 0.35;
        }
      }

      this.ambientNoiseSource = this.ctx.createBufferSource();
      this.ambientNoiseSource.buffer = noiseBuffer;
      this.ambientNoiseSource.loop = true;

      // Bandpass filter centered at 480Hz (audible road roar)
      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(480, this.ctx.currentTime);
      bandpass.Q.setValueAtTime(1.2, this.ctx.currentTime);

      this.ambientTrafficGain = this.ctx.createGain();
      this.ambientTrafficGain.gain.setValueAtTime(0.32, this.ctx.currentTime);

      this.ambientNoiseSource.connect(bandpass);
      bandpass.connect(this.ambientTrafficGain);
      this.ambientTrafficGain.connect(this.masterGain);

      this.ambientNoiseSource.start(0);

      // 2. Distant Engine Rumble (Dual detuned sine/triangle hum)
      this.ambientOsc1 = this.ctx.createOscillator();
      this.ambientOsc1.type = 'triangle';
      this.ambientOsc1.frequency.setValueAtTime(115, this.ctx.currentTime);

      this.ambientOsc2 = this.ctx.createOscillator();
      this.ambientOsc2.type = 'sine';
      this.ambientOsc2.frequency.setValueAtTime(175, this.ctx.currentTime);

      this.ambientHumGain = this.ctx.createGain();
      this.ambientHumGain.gain.setValueAtTime(0.18, this.ctx.currentTime);

      this.ambientOsc1.connect(this.ambientHumGain);
      this.ambientOsc2.connect(this.ambientHumGain);
      this.ambientHumGain.connect(this.masterGain);

      this.ambientOsc1.start();
      this.ambientOsc2.start();

      // 3. Periodic Distant Saigon Scooter Honks
      this.scheduleNextDistantHorn();
    } catch {}
  }

  /**
   * Random realistic distant Saigon traffic honk in the background
   */
  private scheduleNextDistantHorn(): void {
    if (this.distantHornTimer) clearTimeout(this.distantHornTimer);

    const delay = 4500 + Math.random() * 6000; // every 4.5 - 10.5 seconds
    this.distantHornTimer = setTimeout(() => {
      if (!this.isMuted && this.ctx && this.masterGain && this.ctx.state === 'running') {
        this.playDistantHorn();
      }
      this.scheduleNextDistantHorn();
    }, delay);
  }

  private playDistantHorn(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    try {
      const t = this.ctx.currentTime;
      const hornGain = this.ctx.createGain();
      hornGain.gain.setValueAtTime(0.001, t);
      hornGain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      hornGain.gain.setValueAtTime(0.12, t + 0.16);
      hornGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(540, t);
      filter.Q.setValueAtTime(4.0, t);

      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(460, t);

      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(550, t);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(hornGain);
      hornGain.connect(this.masterGain);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.29);
      osc2.stop(t + 0.29);
    } catch {}
  }

  /**
   * Starts procedural motorbike engine synthesis (Honda Lead / AirBlade / SH)
   * Tuned to 85Hz - 340Hz so it is crisp and loud on all laptop speakers.
   */
  public startEngine(): void {
    this.ensureResumed();
    const ctx = this.initContext();
    if (!ctx || !this.masterGain || this.isEngineRunning) return;

    try {
      this.isEngineRunning = true;

      this.engineMasterGain = ctx.createGain();
      this.engineMasterGain.gain.setValueAtTime(0.01, ctx.currentTime);
      this.engineMasterGain.gain.linearRampToValueAtTime(0.48, ctx.currentTime + 0.25);

      // Low pass filter with acoustic resonance for exhaust sound
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.setValueAtTime(750, ctx.currentTime);
      this.engineFilter.Q.setValueAtTime(2.6, ctx.currentTime);

      // Osc 1: Sawtooth fundamental exhaust stroke (85Hz idle ~ 1100 RPM)
      this.engineOsc1 = ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.setValueAtTime(85, ctx.currentTime);

      // Osc 2: Triangle harmonic overtone (170Hz)
      this.engineOsc2 = ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.setValueAtTime(170, ctx.currentTime);

      // Osc 3: Square wave pulse for cylinder ignition pop
      this.engineSubOsc = ctx.createOscillator();
      this.engineSubOsc.type = 'square';
      this.engineSubOsc.frequency.setValueAtTime(42.5, ctx.currentTime);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.22, ctx.currentTime);
      this.engineSubOsc.connect(subGain);
      subGain.connect(this.engineFilter);

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);

      this.engineFilter.connect(this.engineMasterGain);
      this.engineMasterGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();
      this.engineSubOsc.start();
    } catch (e) {
      console.warn('startEngine error:', e);
    }
  }

  /**
   * Updates motorbike engine sound in real time based on speed & throttle
   */
  public updateEngine(speedKmh: number, isThrottling: boolean, isBraking: boolean): void {
    if (!this.isEngineRunning || !this.ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineMasterGain) {
      return;
    }

    const t = this.ctx.currentTime;
    const absSpeed = Math.min(55, Math.abs(speedKmh));
    const speedRatio = absSpeed / 50.0;

    // Fundamental frequency: 85Hz at idle, up to 240Hz at max speed
    let targetFreq = 85 + speedRatio * 135;
    if (isThrottling) targetFreq += 35; // Rev load boost
    if (isBraking && absSpeed > 5) targetFreq *= 0.9;

    // Filter opens up during throttle acceleration (crisp roar)
    let targetFilter = 750 + speedRatio * 1100;
    if (isThrottling) targetFilter += 600;

    // Engine volume
    let targetVol = 0.45 + speedRatio * 0.18;
    if (isThrottling) targetVol += 0.12;

    this.engineOsc1.frequency.setTargetAtTime(targetFreq, t, 0.07);
    this.engineOsc2.frequency.setTargetAtTime(targetFreq * 2.0, t, 0.07);
    if (this.engineSubOsc) {
      this.engineSubOsc.frequency.setTargetAtTime(targetFreq * 0.5, t, 0.07);
    }

    this.engineFilter.frequency.setTargetAtTime(targetFilter, t, 0.09);
    this.engineMasterGain.gain.setTargetAtTime(targetVol, t, 0.07);
  }

  /**
   * Stops engine sound (when switching back to orbit camera)
   */
  public stopEngine(): void {
    if (!this.isEngineRunning || !this.ctx) return;
    this.isEngineRunning = false;

    if (this.engineMasterGain) {
      this.engineMasterGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
    }

    setTimeout(() => {
      try {
        this.engineOsc1?.stop();
        this.engineOsc2?.stop();
        this.engineSubOsc?.stop();
        this.engineOsc1?.disconnect();
        this.engineOsc2?.disconnect();
        this.engineSubOsc?.disconnect();
      } catch {}
      this.engineOsc1 = null;
      this.engineOsc2 = null;
      this.engineSubOsc = null;
    }, 200);
  }

  /**
   * Triggers loud, clear Vietnamese motorcycle dual-tone horn: "Bíp bíp!"
   */
  public playHorn(durationMs = 240): void {
    this.ensureResumed();
    const ctx = this.initContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    try {
      const t = ctx.currentTime;
      const hornGain = ctx.createGain();
      hornGain.gain.setValueAtTime(0.001, t);
      hornGain.gain.linearRampToValueAtTime(0.55, t + 0.015);
      hornGain.gain.setValueAtTime(0.55, t + (durationMs - 30) / 1000);
      hornGain.gain.exponentialRampToValueAtTime(0.001, t + durationMs / 1000);

      // Bandpass filter for metallic diaphragm horn resonance
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(485, t);
      filter.Q.setValueAtTime(3.2, t);

      // Dual tone: 440 Hz (A4) + 540 Hz (C#5)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(440, t);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(540, t);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(hornGain);
      hornGain.connect(this.masterGain);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + durationMs / 1000);
      osc2.stop(t + durationMs / 1000);
    } catch {}
  }

  /**
   * Plays turn signal relay mechanical click (Tách-tắc!)
   */
  public playBlinkerClick(phase: boolean): void {
    if (this.lastBlinkerPhase === phase) return;
    this.lastBlinkerPhase = phase;

    this.ensureResumed();
    const ctx = this.initContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    try {
      const t = ctx.currentTime;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0.28, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.028);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // High click "tách" (1480Hz) vs low click "tắc" (940Hz)
      const freq = phase ? 1480 : 940;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(phase ? 800 : 480, t + 0.025);

      osc.connect(clickGain);
      clickGain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.03);
    } catch {}
  }

  /**
   * Master Mute / Unmute Toggle
   */
  public toggleMute(): boolean {
    this.ensureResumed();
    this.isMuted = !this.isMuted;
    localStorage.setItem('saigon_audio_muted', String(this.isMuted));

    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0.0 : 0.85, this.ctx.currentTime, 0.05);
    }

    // If unmuting, play a friendly confirmation beep
    if (!this.isMuted) {
      this.playHorn(160);
    }

    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  // =========================================================================
  // POLICE PURSUIT SIREN SYNTHESIZER
  // =========================================================================
  private sirenGain: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenLfo: OscillatorNode | null = null;
  private isSirenActive: boolean = false;

  /**
   * Starts wailing police siren ("ú o ú o...")
   */
  public startPoliceSiren(initialDistMeters: number = 25): void {
    this.ensureResumed();
    const ctx = this.initContext();
    if (!ctx || !this.masterGain || this.isSirenActive) return;

    try {
      this.isSirenActive = true;
      const t = ctx.currentTime;

      this.sirenGain = ctx.createGain();
      const initialVol = Math.max(0.05, Math.min(0.7, (1.0 - initialDistMeters / 220.0) * 0.7));
      this.sirenGain.gain.setValueAtTime(0.01, t);
      this.sirenGain.gain.linearRampToValueAtTime(this.isMuted ? 0 : initialVol, t + 0.25);

      // Authentic Vietnamese/European police wail: 640 Hz to 980 Hz periodic modulation
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';

      // Pitch LFO for wailing siren
      this.sirenLfo = ctx.createOscillator();
      this.sirenLfo.type = 'sine';
      this.sirenLfo.frequency.setValueAtTime(0.85, t); // 0.85 Hz wail cycle (~1.18s per full cycle)

      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(175, t); // swing +/- 175 Hz around 800 Hz (625Hz -> 975Hz)

      this.sirenOsc.frequency.setValueAtTime(800, t);
      this.sirenLfo.connect(lfoGain);
      lfoGain.connect(this.sirenOsc.frequency);

      // Bandpass filter to shape metallic emergency siren horn
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(820, t);
      filter.Q.setValueAtTime(2.6, t);

      this.sirenOsc.connect(filter);
      filter.connect(this.sirenGain);
      this.sirenGain.connect(this.masterGain);

      this.sirenLfo.start(t);
      this.sirenOsc.start(t);
    } catch {}
  }

  /**
   * Updates police siren volume dynamically based on distance to player/camera
   */
  public updatePoliceSirenDistance(distMeters: number): void {
    if (!this.isSirenActive || !this.ctx || !this.sirenGain) return;
    const vol = Math.max(0.02, Math.min(0.7, (1.0 - Math.min(1.0, distMeters / 250.0)) * 0.7));
    this.sirenGain.gain.setTargetAtTime(this.isMuted ? 0 : vol, this.ctx.currentTime, 0.1);
  }

  /**
   * Stops police siren with a smooth fade
   */
  public stopPoliceSiren(): void {
    if (!this.isSirenActive || !this.ctx) return;
    this.isSirenActive = false;

    if (this.sirenGain) {
      this.sirenGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
    }

    setTimeout(() => {
      try {
        this.sirenOsc?.stop();
        this.sirenLfo?.stop();
        this.sirenOsc?.disconnect();
        this.sirenLfo?.disconnect();
      } catch {}
      this.sirenOsc = null;
      this.sirenLfo = null;
      this.sirenGain = null;
    }, 350);
  }

  /**
   * Quick police siren chirp ("Woop-woop!")
   */
  public playPoliceChirp(): void {
    this.ensureResumed();
    const ctx = this.initContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    try {
      const t = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.6, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(650, t);
      osc.frequency.exponentialRampToValueAtTime(1150, t + 0.18);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, t);
      filter.Q.setValueAtTime(2.5, t);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.23);
    } catch {}
  }
}

