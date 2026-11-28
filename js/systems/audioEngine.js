export const BGM_TRACKS = [
  { id: "auto", name: "🕒 時間帯おまかせ", desc: "昼・夕・夜に合わせて自動切替" },
  { id: "port_breeze", name: "🌊 潮風の港町", desc: "爽やかな昼の港・マリンバ風" },
  { id: "sunset_bossa", name: "🌇 夕凪ボッサ", desc: "穏やかな夕暮れ・ボサノバ風" },
  { id: "moonlight_pier", name: "🌙 月夜の波止場", desc: "静かな夜海・オルゴール＆チル" },
  { id: "tropical_island", name: "🏝️ 南国サンゴ礁", desc: "陽気なリゾート・スティールドラム風" },
  { id: "open_sea", name: "⛵ 大海原の航海", desc: "クルージング向け・爽快な冒険曲" },
  { id: "retro_chiptune", name: "🕹️ レトロ釣り場", desc: "懐かしの8bit携帯ゲーム機風" }
];

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const SONG_DEFS = {
  port_breeze: {
    stepMs: 280,
    leadType: "triangle",
    leadVol: 0.055,
    leadDur: 0.34,
    padType: "sine",
    padVol: 0.024,
    bassType: "triangle",
    bassVol: 0.048,
    chords: [
      [48, 55, 60, 64], // Cmaj
      [45, 52, 57, 60], // Am
      [41, 48, 53, 57], // Fmaj
      [43, 50, 55, 59]  // G
    ],
    melody: [
      72, null, 76, 79, 76, null, 74, 72,
      69, null, 72, 76, 74, null, 72, null,
      69, null, 72, 74, 76, null, 79, 76,
      74, null, 71, 74, 72, null, null, null
    ],
    bassPattern: [0, null, null, 7, 0, null, 7, null]
  },
  sunset_bossa: {
    stepMs: 310,
    leadType: "sine",
    leadVol: 0.060,
    leadDur: 0.45,
    padType: "triangle",
    padVol: 0.020,
    bassType: "sine",
    bassVol: 0.055,
    chords: [
      [41, 53, 57, 60, 64], // Fmaj7
      [40, 52, 55, 59, 62], // Em7
      [38, 50, 53, 57, 60], // Dm7
      [43, 50, 53, 59, 62]  // G7
    ],
    melody: [
      null, 76, null, 74, 72, null, 69, null,
      null, 74, null, 72, 71, null, 67, null,
      null, 72, null, 69, 65, 69, 72, null,
      74, null, 71, null, 67, null, 71, 74
    ],
    bassPattern: [0, null, null, 0, 7, null, null, 7]
  },
  moonlight_pier: {
    stepMs: 390,
    leadType: "sine",
    leadVol: 0.052,
    leadDur: 0.85,
    bellHarmonic: true,
    padType: "sine",
    padVol: 0.026,
    bassType: "sine",
    bassVol: 0.045,
    chords: [
      [45, 52, 57, 59, 60], // Am9
      [41, 48, 53, 57, 60], // Fmaj7
      [38, 45, 50, 52, 53], // Dm9
      [40, 47, 52, 55, 59]  // Em7
    ],
    melody: [
      76, null, null, 79, 76, null, 72, null,
      72, null, 74, null, 76, null, null, null,
      74, null, null, 72, 69, null, 67, null,
      71, null, 76, null, 74, null, 71, null
    ],
    bassPattern: [0, null, null, null, 7, null, null, null]
  },
  tropical_island: {
    stepMs: 255,
    leadType: "triangle",
    leadVol: 0.058,
    leadDur: 0.24,
    bellHarmonic: true,
    padType: "sine",
    padVol: 0.020,
    bassType: "triangle",
    bassVol: 0.050,
    chords: [
      [43, 50, 55, 59], // G
      [40, 47, 52, 55], // Em
      [48, 52, 55, 60], // C
      [38, 45, 50, 54]  // D
    ],
    melody: [
      79, null, 76, 79, 81, null, 79, 74,
      76, null, 74, 71, 76, null, null, null,
      72, null, 76, 79, 76, null, 74, 72,
      74, 76, 79, null, 78, null, 74, null
    ],
    bassPattern: [0, null, 7, null, 0, null, 7, 5]
  },
  open_sea: {
    stepMs: 240,
    leadType: "triangle",
    leadVol: 0.058,
    leadDur: 0.36,
    padType: "sawtooth",
    padVol: 0.014,
    bassType: "triangle",
    bassVol: 0.055,
    chords: [
      [38, 45, 50, 54, 57], // D
      [45, 52, 57, 61, 64], // A
      [47, 54, 59, 62, 66], // Bm
      [43, 50, 55, 59, 62]  // G
    ],
    melody: [
      74, null, 78, 81, 86, null, 81, null,
      81, null, 79, 78, 76, null, null, null,
      71, null, 74, 78, 81, null, 79, 78,
      79, null, 78, 74, 76, null, 78, null
    ],
    bassPattern: [0, null, 0, 7, 0, null, 7, null]
  },
  retro_chiptune: {
    stepMs: 225,
    leadType: "square",
    leadVol: 0.032,
    leadDur: 0.19,
    padType: "square",
    padVol: 0.011,
    bassType: "triangle",
    bassVol: 0.058,
    chords: [
      [48, 52, 55, 60], // C
      [43, 47, 50, 55], // G
      [45, 48, 52, 57], // Am
      [41, 45, 48, 53]  // F
    ],
    melody: [
      72, 76, 79, null, 84, null, 79, 76,
      74, 77, 79, null, 83, null, 79, null,
      81, 79, 76, 72, 76, 79, 81, null,
      77, 76, 74, 72, 74, null, 79, null
    ],
    bassPattern: [0, 7, 12, 7, 0, 7, 12, 7]
  }
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.bgmFilter = null;
    this.seGain = null;
    this.ambGain = null;

    this.muted = localStorage.getItem("sakana_muted") === "1";
    this.volumes = {
      master: 0.70,
      bgm: 0.80,
      se: 0.90,
      ambient: 0.80
    };
    this.bgmTrack = "auto";
    this.vibrationEnabled = true;
    this.loadSavedVolumes();

    this.ambientStarted = false;
    this.rainGain = null;
    this.waveGain = null;
    this.bgmTimer = null;
    this.bgmRunning = false;
    this.bgmStep = 0;
    this.timePhase = "day";
    this.weather = "sunny";
    this.lastReelAt = 0;
    this.lastEngineAt = 0;
    this.lastScrubAt = 0;
    this.lastCrossingAt = 0;
    this.lastTrainClackAt = 0;
    this.lastCrosswalkAt = 0;
    this.lastTrafficSoundAt = 0;
    this.lastStationBellAt = 0;
  }

  loadSavedVolumes() {
    try {
      const raw = localStorage.getItem("sakana_settings_v1");
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.masterVol === "number") this.volumes.master = Math.max(0, Math.min(1, d.masterVol / 100));
      if (typeof d.bgmVol === "number") this.volumes.bgm = Math.max(0, Math.min(1, d.bgmVol / 100));
      if (typeof d.seVol === "number") this.volumes.se = Math.max(0, Math.min(1, d.seVol / 100));
      if (typeof d.ambientVol === "number") this.volumes.ambient = Math.max(0, Math.min(1, d.ambientVol / 100));
      if (typeof d.vibration === "boolean") this.vibrationEnabled = d.vibration;
      if (typeof d.bgmTrack === "string" && (d.bgmTrack === "auto" || SONG_DEFS[d.bgmTrack])) {
        this.bgmTrack = d.bgmTrack;
      }
    } catch (_) {}
  }

  applyGainValues() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, now, 0.04);
    }
    if (this.bgmGain) {
      this.bgmGain.gain.setTargetAtTime(this.volumes.bgm, now, 0.05);
    }
    if (this.seGain) {
      this.seGain.gain.setTargetAtTime(this.volumes.se, now, 0.04);
    }
    if (this.ambGain) {
      this.ambGain.gain.setTargetAtTime(this.volumes.ambient, now, 0.05);
    }
  }

  setVolumes(partial = {}) {
    if (typeof partial.master === "number") this.volumes.master = Math.max(0, Math.min(1, partial.master));
    if (typeof partial.bgm === "number") this.volumes.bgm = Math.max(0, Math.min(1, partial.bgm));
    if (typeof partial.se === "number") this.volumes.se = Math.max(0, Math.min(1, partial.se));
    if (typeof partial.ambient === "number") this.volumes.ambient = Math.max(0, Math.min(1, partial.ambient));
    this.applyGainValues();
  }

  setBgmTrack(trackId, restartNow = false) {
    const valid = trackId === "auto" || Boolean(SONG_DEFS[trackId]);
    const next = valid ? trackId : "auto";
    const changed = this.bgmTrack !== next;
    this.bgmTrack = next;
    if (changed || restartNow) {
      this.bgmStep = 0;
      if (this.bgmRunning) {
        if (this.bgmTimer) {
          clearTimeout(this.bgmTimer);
          this.bgmTimer = null;
        }
        this.scheduleNextBgmStep(true);
      }
    }
  }

  resolveActiveSongKey() {
    if (this.bgmTrack !== "auto" && SONG_DEFS[this.bgmTrack]) {
      return this.bgmTrack;
    }
    if (this.timePhase === "night") return "moonlight_pier";
    if (this.timePhase === "dusk" || this.timePhase === "dawn") return "sunset_bossa";
    return "port_breeze";
  }

  setMuted(flag) {
    this.muted = Boolean(flag);
    localStorage.setItem("sakana_muted", this.muted ? "1" : "0");
    this.applyGainValues();
    if (!this.muted) this.unlock();
    return this.muted;
  }

  setVibration(enabled) {
    this.vibrationEnabled = Boolean(enabled);
  }

  vibrate(pattern) {
    if (!this.vibrationEnabled) return;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(pattern);
      }
    } catch (_) {}
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.bgmFilter = this.ctx.createBiquadFilter();
      this.bgmFilter.type = "lowpass";
      this.bgmFilter.frequency.value = 2800;

      this.seGain = this.ctx.createGain();
      this.ambGain = this.ctx.createGain();

      this.bgmFilter.connect(this.bgmGain);
      this.bgmGain.connect(this.master);
      this.seGain.connect(this.master);
      this.ambGain.connect(this.master);
      this.master.connect(this.ctx.destination);

      this.master.gain.value = this.muted ? 0 : this.volumes.master;
      this.bgmGain.gain.value = this.volumes.bgm;
      this.seGain.gain.value = this.volumes.se;
      this.ambGain.gain.value = this.volumes.ambient;

      this.startAmbient();
      this.startBgm();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    this.applyGainValues();
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  getBusNode(bus = "se") {
    if (bus === "bgm") return this.bgmFilter || this.bgmGain || this.master;
    if (bus === "ambient") return this.ambGain || this.master;
    return this.seGain || this.master;
  }

  updateEnvironment(env) {
    this.timePhase = env.timePhase;
    this.weather = env.weather;
    if (!this.ctx || !this.rainGain || !this.waveGain) return;
    const now = this.ctx.currentTime;
    const isRain = env.weather === "rain" || env.weather === "rough";
    this.rainGain.gain.setTargetAtTime(isRain ? 0.065 : 0.0, now, 0.8);
    const wAmp = typeof env.waveAmp === "number" ? env.waveAmp : (env.weather === "rough" ? 2.1 : 1.0);
    this.waveGain.gain.setTargetAtTime(Math.max(0.045, Math.min(0.20, 0.042 + wAmp * 0.064)), now, 0.8);
  }

  createNoiseBuffer(seconds = 3) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * seconds, sr);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.08) * 0.45;
    }
    return buf;
  }

  startAmbient() {
    if (this.ambientStarted || !this.ctx) return;
    this.ambientStarted = true;
    const noiseBuf = this.createNoiseBuffer(4);
    const ambDest = this.getBusNode("ambient");

    const waveSrc = this.ctx.createBufferSource();
    waveSrc.buffer = noiseBuf; waveSrc.loop = true;
    const waveFilter = this.ctx.createBiquadFilter();
    waveFilter.type = "lowpass"; waveFilter.frequency.value = 340;
    this.waveGain = this.ctx.createGain(); this.waveGain.gain.value = 0.09;

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.14;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(waveFilter.frequency);
    lfo.start();
    waveSrc.connect(waveFilter).connect(this.waveGain).connect(ambDest);
    waveSrc.start();

    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = noiseBuf; rainSrc.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = "bandpass"; rainFilter.frequency.value = 1800;
    this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(ambDest);
    rainSrc.start();
  }

  playBgmNote(freq, dur, type, vol, startOffset = 0, attack = 0.02) {
    if (!this.ctx || !freq) return;
    const now = this.ctx.currentTime + startOffset;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.03, dur));
    osc.connect(g).connect(this.getBusNode("bgm"));
    osc.start(now);
    osc.stop(now + dur + 0.04);
  }

  playBgmStep() {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || this.volumes.bgm <= 0.001) return;
    const songKey = this.resolveActiveSongKey();
    const song = SONG_DEFS[songKey] || SONG_DEFS.port_breeze;
    const step = this.bgmStep % 32;
    const bar = Math.floor(step / 8);
    const beatInBar = step % 8;
    const chord = song.chords[bar % song.chords.length];
    const barDur = (song.stepMs * 8) / 1000;

    // 1. コードパッド（各小節の頭でふんわり鳴らす）
    if (beatInBar === 0 && chord) {
      chord.forEach((midi, idx) => {
        this.playBgmNote(
          midiToHz(midi),
          barDur * 0.96,
          song.padType,
          song.padVol,
          idx * 0.045,
          0.14
        );
      });
    }

    // 2. ベースライン
    const bassSemi = song.bassPattern[beatInBar];
    if (bassSemi !== null && bassSemi !== undefined && chord && chord.length) {
      const baseMidi = chord[0] + bassSemi;
      this.playBgmNote(
        midiToHz(baseMidi),
        (song.stepMs / 1000) * 1.45,
        song.bassType,
        song.bassVol,
        0,
        0.015
      );
    }

    // 3. メロディ
    const melMidi = song.melody[step];
    if (melMidi) {
      this.playBgmNote(
        midiToHz(melMidi),
        song.leadDur,
        song.leadType,
        song.leadVol,
        0,
        0.018
      );
      if (song.bellHarmonic) {
        this.playBgmNote(
          midiToHz(melMidi + 12),
          song.leadDur * 0.65,
          "sine",
          song.leadVol * 0.32,
          0.005,
          0.01
        );
      }
    }

    this.bgmStep = (this.bgmStep + 1) % 32;
  }

  scheduleNextBgmStep(playImmediate = false) {
    if (!this.bgmRunning) return;
    if (playImmediate) this.playBgmStep();
    const song = SONG_DEFS[this.resolveActiveSongKey()] || SONG_DEFS.port_breeze;
    this.bgmTimer = setTimeout(() => {
      this.playBgmStep();
      this.scheduleNextBgmStep(false);
    }, song.stepMs);
  }

  startBgm() {
    if (this.bgmRunning) return;
    this.bgmRunning = true;
    this.scheduleNextBgmStep(false);
  }

  playTone(freq, dur = 0.15, type = "sine", vol = 0.12, delay = 0, bus = "se") {
    if (!this.ctx || this.muted) return;
    if (bus === "se" && this.volumes.se <= 0.001) return;
    if (bus === "ambient" && this.volumes.ambient <= 0.001) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(this.getBusNode(bus));
    osc.start(now); osc.stop(now + dur + 0.02);
  }

  playCast() {
    this.unlock();
    if (!this.ctx || this.muted || this.volumes.se <= 0.001) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.22);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g).connect(this.getBusNode("se"));
    osc.start(now); osc.stop(now + 0.25);
    this.playTone(280, 0.14, "sine", 0.1, 0.32, "se");
    this.playTone(420, 0.12, "sine", 0.07, 0.36, "se");
    this.vibrate(25);
  }
  playNetThrow() { this.unlock(); this.playTone(340, 0.14, "triangle", 0.11, 0, "se"); this.playTone(210, 0.22, "sine", 0.12, 0.12, "se"); this.vibrate(30); }
  playEnginePulse() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastEngineAt < 180) return;
    this.lastEngineAt = now;
    this.playTone(88, 0.14, "sawtooth", 0.032, 0, "ambient");
  }
  playScrub() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastScrubAt < 90) return;
    this.lastScrubAt = now;
    this.playTone(920 + Math.random() * 260, 0.04, "sine", 0.045, 0, "se");
  }
  playBite() { this.unlock(); this.playTone(880, 0.12, "triangle", 0.16, 0, "se"); this.playTone(1174, 0.18, "triangle", 0.16, 0.1, "se"); this.vibrate([45, 35, 65]); }
  playReelTick(tensionPct = 40) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const interval = tensionPct > 75 ? 90 : 140;
    if (now - this.lastReelAt < interval) return;
    this.lastReelAt = now;
    this.playTone(520 + tensionPct * 6, 0.045, "square", 0.035, 0, "se");
  }
  playCatch(rank = "C") {
    this.unlock();
    const notes = (rank === "S" || rank === "A") ? [523.2, 659.2, 783.9, 1046.5, 1318.5] : [523.2, 659.2, 783.9];
    notes.forEach((n, i) => this.playTone(n, 0.28, "triangle", 0.14, i * 0.09, "se"));
    this.vibrate(rank === "S" || rank === "A" ? [50, 40, 80, 40, 100] : [40, 30, 50]);
  }
  playOk() { this.unlock(); this.playTone(784, 0.09, "triangle", 0.11, 0, "se"); this.playTone(1046, 0.12, "triangle", 0.11, 0.06, "se"); }
  playFail() { this.unlock(); this.playTone(300, 0.16, "sawtooth", 0.08, 0, "se"); this.playTone(210, 0.24, "sawtooth", 0.08, 0.12, "se"); this.vibrate(70); }
  playDig() { this.unlock(); this.playTone(190, 0.09, "triangle", 0.12, 0, "se"); this.playTone(260, 0.11, "sine", 0.09, 0.08, "se"); this.vibrate(25); }
  playCash() { this.unlock(); this.playTone(1046, 0.1, "sine", 0.12, 0, "se"); this.playTone(1568, 0.22, "sine", 0.12, 0.08, "se"); }

  // ===== 港町・交通の距離減衰つき環境音（vol: 0.0〜1.0） =====
  playCrossingDing(vol = 0.5) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.02) return;
    const nowMs = performance.now();
    if (nowMs - this.lastCrossingAt < 520) return;
    this.lastCrossingAt = nowMs;
    const v = Math.min(1, vol) * 0.11;
    this.playTone(712, 0.34, "triangle", v, 0, "ambient");
    this.playTone(754, 0.30, "sine", v * 0.85, 0, "ambient");
    this.playTone(1424, 0.14, "sine", v * 0.3, 0, "ambient");
  }

  playTrainClack(vol = 0.5, speed = 12) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.02) return;
    const nowMs = performance.now();
    const interval = Math.max(360, Math.min(820, 7800 / Math.max(4, speed)));
    if (nowMs - this.lastTrainClackAt < interval) return;
    this.lastTrainClackAt = nowMs;
    const v = Math.min(1, vol) * 0.085;
    this.playTone(95, 0.07, "triangle", v, 0, "ambient");
    this.playTone(125, 0.06, "sine", v * 0.75, 0.11, "ambient");
  }

  playStationBell(vol = 0.6) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.03) return;
    const nowMs = performance.now();
    if (nowMs - this.lastStationBellAt < 4000) return;
    this.lastStationBellAt = nowMs;
    const v = Math.min(1, vol) * 0.10;
    this.playTone(587.3, 0.24, "sine", v, 0, "ambient");
    this.playTone(784.0, 0.24, "sine", v, 0.22, "ambient");
    this.playTone(1046.5, 0.42, "triangle", v * 0.9, 0.44, "ambient");
  }

  playCrosswalkChime(vol = 0.5, isBlink = false) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.02) return;
    const nowMs = performance.now();
    const interval = isBlink ? 620 : 1150;
    if (nowMs - this.lastCrosswalkAt < interval) return;
    this.lastCrosswalkAt = nowMs;
    const v = Math.min(1, vol) * 0.065;
    this.playTone(1760, 0.09, "sine", v, 0, "ambient");
    this.playTone(2093, 0.11, "sine", v * 0.9, 0.11, "ambient");
  }

  playTrafficWhoosh(vol = 0.4, isHeavy = false) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.03) return;
    const nowMs = performance.now();
    if (nowMs - this.lastTrafficSoundAt < 260) return;
    this.lastTrafficSoundAt = nowMs;
    const v = Math.min(1, vol) * (isHeavy ? 0.055 : 0.035);
    this.playTone(isHeavy ? 64 : 108, 0.18, "sawtooth", v, 0, "ambient");
  }
}

export const audioEngine = new AudioEngine();
