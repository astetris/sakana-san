class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem("sakana_muted") === "1";
    this.ambientStarted = false;
    this.rainGain = null;
    this.waveGain = null;
    this.bgmTimer = null;
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

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(this.ctx.destination);
      this.startAmbient();
      this.startBgm();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem("sakana_muted", this.muted ? "1" : "0");
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.08);
    }
    if (!this.muted) this.unlock();
    return this.muted;
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
    waveSrc.connect(waveFilter).connect(this.waveGain).connect(this.master);
    waveSrc.start();

    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = noiseBuf; rainSrc.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = "bandpass"; rainFilter.frequency.value = 1800;
    this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rainSrc.start();
  }

  startBgm() {
    if (this.bgmTimer) return;
    const dayChords = [
      [261.6, 329.6, 392.0, 493.9],
      [220.0, 261.6, 329.6, 392.0],
      [174.6, 220.0, 261.6, 329.6],
      [196.0, 246.9, 293.7, 392.0]
    ];
    const nightChords = [
      [220.0, 261.6, 329.6, 493.9],
      [174.6, 220.0, 261.6, 329.6],
      [146.8, 220.0, 261.6, 329.6],
      [164.8, 246.9, 293.7, 392.0]
    ];
    this.bgmTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== "running" || this.muted) return;
      const isNight = this.timePhase === "night" || this.timePhase === "dusk";
      const chords = isNight ? nightChords : dayChords;
      const chord = chords[this.bgmStep % chords.length];
      this.bgmStep++;
      const now = this.ctx.currentTime;
      chord.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = idx === 0 ? "sine" : "triangle";
        osc.frequency.value = freq;
        const start = now + idx * 0.14;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(isNight ? 0.024 : 0.03, start + 0.25);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 3.4);
        osc.connect(gain).connect(this.master);
        osc.start(start); osc.stop(start + 3.5);
      });
    }, 3600);
  }

  playTone(freq, dur = 0.15, type = "sine", vol = 0.12, delay = 0) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + dur + 0.02);
  }

  playCast() {
    this.unlock();
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.22);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + 0.25);
    this.playTone(280, 0.14, "sine", 0.1, 0.32);
    this.playTone(420, 0.12, "sine", 0.07, 0.36);
  }
  playNetThrow() { this.unlock(); this.playTone(340, 0.14, "triangle", 0.11, 0); this.playTone(210, 0.22, "sine", 0.12, 0.12); }
  playEnginePulse() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastEngineAt < 180) return;
    this.lastEngineAt = now;
    this.playTone(88, 0.14, "sawtooth", 0.032, 0);
  }
  playScrub() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastScrubAt < 90) return;
    this.lastScrubAt = now;
    this.playTone(920 + Math.random() * 260, 0.04, "sine", 0.045, 0);
  }
  playBite() { this.unlock(); this.playTone(880, 0.12, "triangle", 0.16, 0); this.playTone(1174, 0.18, "triangle", 0.16, 0.1); }
  playReelTick(tensionPct = 40) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const interval = tensionPct > 75 ? 90 : 140;
    if (now - this.lastReelAt < interval) return;
    this.lastReelAt = now;
    this.playTone(520 + tensionPct * 6, 0.045, "square", 0.035, 0);
  }
  playCatch(rank = "C") {
    this.unlock();
    const notes = (rank === "S" || rank === "A") ? [523.2, 659.2, 783.9, 1046.5, 1318.5] : [523.2, 659.2, 783.9];
    notes.forEach((n, i) => this.playTone(n, 0.28, "triangle", 0.14, i * 0.09));
  }
  playOk() { this.unlock(); this.playTone(784, 0.09, "triangle", 0.11, 0); this.playTone(1046, 0.12, "triangle", 0.11, 0.06); }
  playFail() { this.unlock(); this.playTone(300, 0.16, "sawtooth", 0.08, 0); this.playTone(210, 0.24, "sawtooth", 0.08, 0.12); }
  playDig() { this.unlock(); this.playTone(190, 0.09, "triangle", 0.12, 0); this.playTone(260, 0.11, "sine", 0.09, 0.08); }
  playCash() { this.unlock(); this.playTone(1046, 0.1, "sine", 0.12, 0); this.playTone(1568, 0.22, "sine", 0.12, 0.08); }

  // ===== 港町・交通の距離減衰つき環境音（vol: 0.0〜1.0） =====
  playCrossingDing(vol = 0.5) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.02) return;
    const nowMs = performance.now();
    if (nowMs - this.lastCrossingAt < 520) return;
    this.lastCrossingAt = nowMs;
    const v = Math.min(1, vol) * 0.11;
    // 日本の踏切らしい2音重ねの金属音（カン・カン）
    this.playTone(712, 0.34, "triangle", v, 0);
    this.playTone(754, 0.30, "sine", v * 0.85, 0);
    this.playTone(1424, 0.14, "sine", v * 0.3, 0);
  }

  playTrainClack(vol = 0.5, speed = 12) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.02) return;
    const nowMs = performance.now();
    const interval = Math.max(360, Math.min(820, 7800 / Math.max(4, speed)));
    if (nowMs - this.lastTrainClackAt < interval) return;
    this.lastTrainClackAt = nowMs;
    const v = Math.min(1, vol) * 0.085;
    // ガタン・ゴトンの2連リズム
    this.playTone(95, 0.07, "triangle", v, 0);
    this.playTone(125, 0.06, "sine", v * 0.75, 0.11);
  }

  playStationBell(vol = 0.6) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.03) return;
    const nowMs = performance.now();
    if (nowMs - this.lastStationBellAt < 4000) return;
    this.lastStationBellAt = nowMs;
    const v = Math.min(1, vol) * 0.10;
    // 海辺のローカル駅風 発車チャイム
    this.playTone(587.3, 0.24, "sine", v, 0);
    this.playTone(784.0, 0.24, "sine", v, 0.22);
    this.playTone(1046.5, 0.42, "triangle", v * 0.9, 0.44);
  }

  playCrosswalkChime(vol = 0.5, isBlink = false) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.02) return;
    const nowMs = performance.now();
    const interval = isBlink ? 620 : 1150;
    if (nowMs - this.lastCrosswalkAt < interval) return;
    this.lastCrosswalkAt = nowMs;
    const v = Math.min(1, vol) * 0.065;
    // 日本の歩行者青信号「ピヨ・ピヨ」
    this.playTone(1760, 0.09, "sine", v, 0);
    this.playTone(2093, 0.11, "sine", v * 0.9, 0.11);
  }

  playTrafficWhoosh(vol = 0.4, isHeavy = false) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || vol <= 0.03) return;
    const nowMs = performance.now();
    if (nowMs - this.lastTrafficSoundAt < 260) return;
    this.lastTrafficSoundAt = nowMs;
    const v = Math.min(1, vol) * (isHeavy ? 0.055 : 0.035);
    this.playTone(isHeavy ? 64 : 108, 0.18, "sawtooth", v, 0);
  }

}

export const audioEngine = new AudioEngine();
