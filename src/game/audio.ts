/**
 * Sound, made the same way the pictures are: from nothing.
 *
 * Every effect is synthesised on the fly with the Web Audio API — noise
 * bursts through filters for cracks, splashes and crunches, short tones
 * with envelopes for chimes and thuds — so there are no audio files to
 * ship, license or wait for. The music is a slow winter piece:
 * a soft pad and a bass through four chords, a written music-box melody
 * looping over them, and a breath of wind underneath.
 *
 * Browsers only let audio start after the player has touched something,
 * so the context is created lazily on the first gesture. Two switches,
 * remembered in the browser: sound effects and music.
 */

type Kind = 'sfx' | 'music';

const STORE_KEY = 'pog.audio';

interface Prefs {
  sfx: boolean;
  music: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { sfx: p.sfx !== false, music: p.music !== false };
    }
  } catch {
    /* fall through */
  }
  return { sfx: true, music: true };
}

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private prefs: Prefs = loadPrefs();
  private musicTimer: number | null = null;
  private musicRunning = false;
  private nextBeat = 0;
  private beat = 0;
  private tense = false;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    // the first touch anywhere wakes the audio engine
    const wake = () => {
      this.ensure();
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  /* ---------------- the switches ---------------- */

  get sfxOn() {
    return this.prefs.sfx;
  }
  get musicOn() {
    return this.prefs.music;
  }

  toggle(kind: Kind) {
    this.prefs = { ...this.prefs, [kind]: !this.prefs[kind] };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* private mode */
    }
    this.apply();
    this.listeners.forEach((fn) => fn());
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A different mood for the arena: a pulse under the pad. */
  setTense(on: boolean) {
    this.tense = on;
  }

  /* ---------------- plumbing ---------------- */

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.master);
      // a second of white noise, reused by every crack and crunch
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.apply();
      return ctx;
    } catch {
      return null;
    }
  }

  private apply() {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.prefs.sfx ? 1 : 0, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.prefs.music ? 1 : 0, t, 0.3);
    if (this.prefs.music) this.startMusic();
    else this.stopMusic();
  }

  /** Call once the game is on screen; the music waits for the first gesture. */
  begin() {
    if (this.ensure()) this.apply();
  }

  /* ---------------- primitives ---------------- */

  private tone(
    freq: number,
    ms: number,
    opts: { type?: OscillatorType; gain?: number; to?: number; attack?: number; at?: number; bus?: GainNode | null } = {}
  ) {
    const ctx = this.ensure();
    const bus = opts.bus ?? this.sfxBus;
    if (!ctx || !bus) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + ms / 1000);
    const peak = opts.gain ?? 0.25;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  private noise(
    ms: number,
    opts: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; gain?: number; at?: number; attack?: number; bus?: GainNode | null } = {}
  ) {
    const ctx = this.ensure();
    const bus = opts.bus ?? this.sfxBus;
    if (!ctx || !bus || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + ms / 1000);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    src.connect(f).connect(g).connect(bus);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + ms / 1000 + 0.02);
  }

  private vary(base: number, spread = 0.08) {
    return base * (1 + (Math.random() * 2 - 1) * spread);
  }

  /* ---------------- the world ---------------- */

  /** An axe biting into a pine. */
  chop() {
    this.tone(this.vary(95), 140, { type: 'triangle', to: 55, gain: 0.35 });
    this.noise(70, { freq: this.vary(1400), q: 0.8, gain: 0.35 });
    this.noise(30, { type: 'highpass', freq: 3000, gain: 0.12, at: 0.01 });
  }

  /** The pine gives way: a creak, then it hits the snow. */
  felled() {
    this.tone(120, 420, { type: 'sawtooth', to: 70, gain: 0.08 });
    this.noise(160, { type: 'lowpass', freq: 500, gain: 0.35, at: 0.36, attack: 0.02 });
    this.tone(60, 300, { to: 35, gain: 0.4, at: 0.36 });
    this.noise(220, { type: 'highpass', freq: 2500, gain: 0.08, at: 0.4 });
  }

  /** A pick into ice: bright and brittle. */
  iceHit() {
    this.noise(60, { type: 'highpass', freq: 3200, gain: 0.35 });
    this.tone(this.vary(2400, 0.12), 110, { gain: 0.16, to: 1900 });
    this.tone(this.vary(160), 80, { type: 'triangle', to: 90, gain: 0.2 });
  }

  /** The block comes free in a shower of shards. */
  iceBreak() {
    this.noise(140, { type: 'highpass', freq: 2600, gain: 0.4 });
    for (let i = 0; i < 6; i++) {
      this.tone(this.vary(3200 - i * 300, 0.1), 120, { gain: 0.1, at: 0.03 + i * 0.045, to: 2200 });
    }
    this.tone(110, 200, { type: 'triangle', to: 60, gain: 0.25 });
  }

  /** The line goes out and lands in the water. */
  cast() {
    this.noise(320, { freq: 500, to: 2600, q: 0.7, gain: 0.18, attack: 0.05 });
    this.noise(220, { type: 'lowpass', freq: 900, gain: 0.35, at: 0.42, attack: 0.01 });
    this.tone(260, 160, { to: 520, gain: 0.08, at: 0.44 });
  }

  /** Something pulls. */
  bite() {
    this.noise(140, { type: 'lowpass', freq: 800, gain: 0.3 });
    this.tone(300, 90, { to: 180, gain: 0.12 });
  }

  /** Landed — the rarer, the longer the flourish. */
  catchFish(rarity: string) {
    const notes = [523, 659, 784, 1047, 1319];
    const n = rarity === 'legendary' ? 5 : rarity === 'epic' || rarity === 'rare' ? 4 : rarity === 'uncommon' ? 3 : 2;
    for (let i = 0; i < n; i++) this.tone(notes[i], 220, { type: 'triangle', gain: 0.16, at: i * 0.09 });
    if (n >= 4) this.tone(1568, 500, { type: 'sine', gain: 0.1, at: n * 0.09 });
  }

  /** It got away: a slack line and a sigh. */
  escape() {
    this.tone(440, 160, { to: 330, gain: 0.1 });
    this.tone(330, 260, { to: 220, gain: 0.08, at: 0.14 });
  }

  /** A coin in the pocket. */
  coin() {
    this.tone(988, 90, { gain: 0.18 });
    this.tone(1319, 260, { gain: 0.18, at: 0.07 });
  }

  /** Hammer on the workbench. */
  craft() {
    for (let i = 0; i < 3; i++) {
      this.tone(this.vary(1800, 0.05), 60, { gain: 0.1, at: i * 0.11 });
      this.noise(40, { freq: 3000, gain: 0.2, at: i * 0.11 });
    }
    this.tone(880, 300, { type: 'triangle', gain: 0.12, at: 0.36 });
  }

  /** Fish over the fire. */
  cook() {
    this.noise(600, { type: 'lowpass', freq: 1200, gain: 0.12, attack: 0.05 });
    this.tone(659, 200, { type: 'triangle', gain: 0.1, at: 0.3 });
    this.tone(988, 320, { type: 'triangle', gain: 0.1, at: 0.42 });
  }

  /** The igloo goes up. */
  build() {
    this.noise(500, { type: 'lowpass', freq: 400, to: 1400, gain: 0.3, attack: 0.1 });
    for (const [f, at] of [
      [392, 0.35],
      [494, 0.45],
      [587, 0.55],
      [784, 0.65],
    ] as Array<[number, number]>) {
      this.tone(f, 500, { type: 'triangle', gain: 0.12, at });
    }
  }

  /** Something set down inside, or picked back up. */
  place() {
    this.tone(220, 120, { type: 'triangle', to: 140, gain: 0.2 });
    this.noise(60, { type: 'lowpass', freq: 700, gain: 0.2 });
  }

  /** Through a doorway. */
  door() {
    this.noise(260, { freq: 300, to: 1200, q: 0.6, gain: 0.14, attack: 0.05 });
  }

  /** An offering at the cairn: a low bell. */
  offer() {
    this.tone(330, 900, { gain: 0.14 });
    this.tone(495, 900, { gain: 0.08, at: 0.02 });
    this.tone(660, 700, { gain: 0.06, at: 0.04 });
  }

  /** A quest cleared. */
  fanfare() {
    for (const [f, at] of [
      [659, 0],
      [784, 0.1],
      [988, 0.2],
      [1319, 0.32],
    ] as Array<[number, number]>) {
      this.tone(f, 260, { type: 'triangle', gain: 0.14, at });
    }
    this.tone(1319, 600, { gain: 0.08, at: 0.5 });
  }

  /** Feet on snow, or a slide on ice. */
  step(onIce: boolean) {
    if (onIce) this.noise(120, { type: 'highpass', freq: 1800, gain: 0.05, attack: 0.03 });
    else this.noise(70, { type: 'lowpass', freq: this.vary(650), gain: 0.09 });
  }

  /* ---------------- the interface ---------------- */

  click() {
    this.tone(1200, 40, { gain: 0.08 });
  }

  open() {
    this.tone(660, 80, { gain: 0.08 });
    this.tone(880, 120, { gain: 0.08, at: 0.05 });
  }

  close() {
    this.tone(880, 70, { gain: 0.06 });
    this.tone(660, 110, { gain: 0.06, at: 0.05 });
  }

  buy() {
    this.tone(784, 80, { gain: 0.1 });
    this.tone(1047, 160, { gain: 0.1, at: 0.08 });
    this.noise(60, { freq: 2500, gain: 0.1, at: 0.08 });
  }

  error() {
    this.tone(180, 180, { type: 'square', gain: 0.05 });
    this.tone(150, 220, { type: 'square', gain: 0.05, at: 0.12 });
  }

  chat() {
    this.tone(1500, 50, { gain: 0.05 });
  }

  /* ---------------- the arena ---------------- */

  throwBall(lob: boolean) {
    this.noise(lob ? 360 : 240, { freq: 600, to: lob ? 1800 : 3200, q: 0.6, gain: 0.2, attack: 0.03 });
  }

  jump() {
    this.tone(300, 140, { to: 620, gain: 0.08, type: 'triangle' });
  }

  land() {
    this.noise(70, { type: 'lowpass', freq: 500, gain: 0.18 });
  }

  splat() {
    this.noise(160, { type: 'lowpass', freq: 1400, gain: 0.5 });
    this.tone(120, 160, { type: 'triangle', to: 60, gain: 0.3 });
    this.noise(120, { type: 'highpass', freq: 2800, gain: 0.12, at: 0.02 });
  }

  countdown(last: boolean) {
    this.tone(last ? 1047 : 660, last ? 500 : 140, { type: 'square', gain: last ? 0.12 : 0.06 });
  }

  win() {
    for (const [f, at] of [
      [523, 0],
      [659, 0.12],
      [784, 0.24],
      [1047, 0.36],
      [1319, 0.6],
    ] as Array<[number, number]>) {
      this.tone(f, 400, { type: 'triangle', gain: 0.14, at });
    }
  }

  lose() {
    for (const [f, at] of [
      [392, 0],
      [370, 0.25],
      [349, 0.5],
      [294, 0.8],
    ] as Array<[number, number]>) {
      this.tone(f, 500, { type: 'triangle', gain: 0.1, at });
    }
  }

  /* ---------------- the music ---------------- */

  private startMusic() {
    if (this.musicRunning || !this.ctx) return;
    this.musicRunning = true;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beat = 0;
    this.wind();
    this.musicTimer = window.setInterval(() => this.schedule(), 200);
  }

  private stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicRunning = false;
  }

  /** A slow, breathy bed under everything — a breath, not a hiss. */
  private wind() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.022;
    src.connect(f).connect(g).connect(this.musicBus);
    src.start();
    lfo.start();
    // stops with the context; the switch just mutes the bus
  }

  /**
   * The piece itself: four bars of C, G, Am, F under a written melody,
   * looping. Composed rather than rolled — a random walk over a scale
   * sounds like a phone left off the hook after a minute. A note is
   * occasionally left out so the loop breathes.
   */
  private static readonly CHORDS = [
    { bass: 130.8, pad: [261.6, 329.6, 392.0] }, // C
    { bass: 98.0, pad: [196.0, 246.9, 293.7] }, // G
    { bass: 110.0, pad: [220.0, 261.6, 329.6] }, // Am
    { bass: 87.3, pad: [174.6, 220.0, 261.6] }, // F
  ];

  /** One note (Hz) or a rest per beat, eight beats a chord. */
  private static readonly MELODY: Array<number | null> = [
    659.3, null, 784.0, null, 659.3, 587.3, 523.3, null, // over C
    587.3, null, 493.9, null, 587.3, null, 392.0, null, // over G
    440.0, null, 523.3, null, 659.3, 587.3, 523.3, null, // over Am
    440.0, null, 523.3, null, 440.0, 392.0, 329.6, null, // over F, leading home
  ];

  /**
   * Look a little ahead and queue what falls due: a chord and its bass
   * every eight beats, the melody's note for this beat, a pulse in the
   * arena.
   */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const BEAT = this.tense ? 0.5 : 0.9; // seconds
    const LOOP = Sound.MELODY.length;
    while (this.nextBeat < ctx.currentTime + 0.6) {
      const t = this.nextBeat;
      const step = this.beat % LOOP;
      const chord = Sound.CHORDS[Math.floor(step / 8)];
      if (step % 8 === 0) {
        this.pad(chord.pad, t, BEAT * 8.3);
        this.bass(chord.bass, t, BEAT * 8);
      }
      const note = Sound.MELODY[step];
      // the second time round, let a note or two go so it does not grind
      const rest = Math.floor(this.beat / LOOP) % 2 === 1 && Math.random() < 0.18;
      if (note && !rest) this.bell(note, t);
      if (this.tense && step % 2 === 0) this.pulse(t);
      this.nextBeat += BEAT;
      this.beat++;
    }
  }

  private pad(freqs: number[], at: number, dur: number) {
    const ctx = this.ctx!;
    const bus = this.musicBus!;
    for (const f of freqs) {
      for (const detune of [-2.5, 2.5]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.detune.value = detune;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 520;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.02, at + 2.2);
        g.gain.setValueAtTime(0.02, at + dur - 1.6);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(lp).connect(g).connect(bus);
        osc.start(at);
        osc.stop(at + dur + 0.05);
      }
    }
  }

  /** A soft root under each chord, so the pad has a floor to stand on. */
  private bass(freq: number, at: number, dur: number) {
    const ctx = this.ctx!;
    const bus = this.musicBus!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.05, at + 0.6);
    g.gain.setValueAtTime(0.05, at + dur - 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /** A music-box note: a sine with a soft edge and an octave whisper. */
  private bell(freq: number, at: number) {
    const ctx = this.ctx!;
    const bus = this.musicBus!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const oct = ctx.createOscillator();
    oct.type = 'sine';
    oct.frequency.value = freq * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.05, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.9);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.008, at);
    og.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    osc.connect(g).connect(bus);
    oct.connect(og).connect(bus);
    osc.start(at);
    oct.start(at);
    osc.stop(at + 2);
    oct.stop(at + 0.8);
  }

  private pulse(at: number) {
    const ctx = this.ctx!;
    const bus = this.musicBus!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.16, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + 0.25);
  }
}

export const sound = new Sound();
