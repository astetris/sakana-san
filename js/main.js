import { GameState } from './state/gameState.js';
import { TimeSystem } from './systems/timeSystem.js';
import { MarketSystem } from './systems/marketSystem.js';
import { FishingPhysics } from './systems/fishingPhysics.js';
import { FishingScene3D } from './scenes/fishingScene3D.js';

// 簡易Web Audio効果音（ドラグ音・着水音・ヒット音）
class SoundFX {
  constructor() {
    this.ctx = null;
    this.lastDragClick = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playSplash() {
    if (!this.ctx) return;
    const len = this.ctx.sampleRate * 0.22;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.35));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 850;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.25;
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start();
  }

  playBite() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(980, this.ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.22, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.18);
  }

  tickDragSlip() {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastDragClick < 55) return;
    this.lastDragClick = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1650 + Math.random() * 250, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.07, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.025);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.025);
  }
}

async function init() {
  const [fishMaster, tackleMaster] = await Promise.all([
    fetch('./data/fish.json').then((r) => r.json()),
    fetch('./data/tackle.json').then((r) => r.json())
  ]);

  const state = new GameState();
  state.load();

  const sound = new SoundFX();
  const market = new MarketSystem(state, fishMaster);
  const timeSys = new TimeSystem(state, () => market.refreshDailyMarket());
  const scene3D = new FishingScene3D(document.getElementById('canvas-container'));
  scene3D.setQuality(state.quality);

  const equippedTackle = {
    rod: tackleMaster.rods[0],
    reel: tackleMaster.reels[0],
    line: tackleMaster.lines[0],
    lure: tackleMaster.lures[0]
  };

  let pendingCatch = null;

  const physics = new FishingPhysics(fishMaster, equippedTackle, {
    onSplash: (x, z, intensity) => {
      scene3D.spawnSplash(x, z, intensity);
      sound.playSplash();
    },
    onBite: () => sound.playBite(),
    onDragSlip: (slipping) => {
      if (slipping) sound.tickDragSlip();
    },
    onCaught: (fish) => {
      pendingCatch = fish;
      showCatchModal(fish);
    },
    onLost: () => {}
  });

  // DOM要素
  const elTime = document.getElementById('hud-time');
  const elMoney = document.getElementById('hud-money');
  const elFishCount = document.getElementById('hud-fish-count');
  const elQualityBtn = document.getElementById('btn-quality');
  const elDist = document.getElementById('info-dist');
  const elDepth = document.getElementById('info-depth');
  const elStatus = document.getElementById('info-status');
  const elCastWrap = document.getElementById('cast-power-wrap');
  const elCastFill = document.getElementById('cast-power-fill');
  const elLineFill = document.getElementById('gauge-line-fill');
  const elRodFill = document.getElementById('gauge-rod-fill');
  const elReelFill = document.getElementById('gauge-reel-fill');
  const elDragVal = document.getElementById('drag-val');
  const elSpeedVal = document.getElementById('speed-val');
  const elReelBtn = document.getElementById('btn-reel');
  const elReelLabel = document.getElementById('reel-btn-label');

  // 品質切替（最高品質 / 超軽量）
  const updateQualityLabel = () => {
    elQualityBtn.textContent = state.quality === 'high' ? '画質: 最高' : '画質: 超軽量';
  };
  updateQualityLabel();

  elQualityBtn.addEventListener('click', () => {
    state.quality = state.quality === 'high' ? 'low' : 'high';
    scene3D.setQuality(state.quality);
    state.save();
    updateQualityLabel();
  });

  // キャスト / 巻取りメインボタン（タッチ＆マウス両対応）
  const onReelDown = (e) => {
    e.preventDefault();
    sound.unlock();
    elReelBtn.classList.add('active');
    physics.startReelPress();
  };
  const onReelUp = (e) => {
    e.preventDefault();
    elReelBtn.classList.remove('active');
    physics.endReelPress();
  };

  elReelBtn.addEventListener('pointerdown', onReelDown);
  elReelBtn.addEventListener('pointerup', onReelUp);
  elReelBtn.addEventListener('pointercancel', onReelUp);
  elReelBtn.addEventListener('pointerleave', onReelUp);

  // ドラグ＆スピード
  document.getElementById('btn-drag-minus').addEventListener('click', () => {
    sound.unlock();
    physics.setDrag(-1);
    elDragVal.textContent = `${physics.dragLevel}/8`;
  });
  document.getElementById('btn-drag-plus').addEventListener('click', () => {
    sound.unlock();
    physics.setDrag(1);
    elDragVal.textContent = `${physics.dragLevel}/8`;
  });
  document.getElementById('btn-speed').addEventListener('click', () => {
    sound.unlock();
    physics.cycleSpeed();
    elSpeedVal.textContent = String(physics.retrieveSpeed);
  });

  // アワセ・ポンピングボタン
  document.getElementById('btn-rod-action').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.unlock();
    physics.triggerRodAction();
  });

  // 左パッドのドラッグ照準＆上スワイプアクション
  const leftPad = document.getElementById('touch-pad-left');
  let padStart = null;
  leftPad.addEventListener('pointerdown', (e) => {
    sound.unlock();
    padStart = { x: e.clientX, y: e.clientY };
  });
  leftPad.addEventListener('pointermove', (e) => {
    if (!padStart) return;
    const dx = e.clientX - padStart.x;
    const dy = e.clientY - padStart.y;
    if (physics.phase === 'IDLE' || physics.phase === 'CHARGING') {
      physics.adjustAim(dx * 0.04);
      padStart.x = e.clientX;
    } else if (dy < -32) {
      physics.triggerRodAction();
      padStart.y = e.clientY;
    }
  });
  leftPad.addEventListener('pointerup', () => { padStart = null; });
  leftPad.addEventListener('pointercancel', () => { padStart = null; });

  // 釣果モーダル
  const modalCatch = document.getElementById('modal-catch');
  function showCatchModal(fish) {
    const estPrice = market.getSellPrice({ fishId: fish.id, weightKg: fish.weightKg });
    document.getElementById('catch-title').textContent = `🐟 ${fish.name} [${fish.rarity}]`;
    document.getElementById('catch-details').innerHTML = `
      <div>重さ：<strong>${fish.weightKg} kg</strong></div>
      <div>本日の市場査定：<strong>¥${estPrice.toLocaleString()}</strong></div>
    `;
    modalCatch.classList.remove('hidden');
  }

  document.getElementById('btn-catch-keep').addEventListener('click', () => {
    if (pendingCatch) {
      state.cooler.push({
        uid: Date.now(),
        fishId: pendingCatch.id,
        name: pendingCatch.name,
        rarity: pendingCatch.rarity,
        weightKg: pendingCatch.weightKg,
        caughtDay: state.day
      });
      state.save();
      pendingCatch = null;
    }
    modalCatch.classList.add('hidden');
  });

  document.getElementById('btn-catch-release').addEventListener('click', () => {
    pendingCatch = null;
    modalCatch.classList.add('hidden');
  });

  // 市場モーダル
  const modalMarket = document.getElementById('modal-market');
  function renderMarket() {
    document.getElementById('market-trend').textContent = state.marketNews;
    const list = document.getElementById('market-list');
    if (!state.cooler.length) {
      list.innerHTML = '<div class="market-row">クーラーボックスは空です。魚を釣って持ち帰ろう！</div>';
      return;
    }
    list.innerHTML = state.cooler
      .map((item) => {
        const price = market.getSellPrice(item);
        const rate = state.marketRates[item.fishId] || 1.0;
        return `
          <div class="market-row">
            <div>
              <strong>${item.name}</strong> (${item.weightKg}kg)
              <small>本日相場 x${rate}</small>
            </div>
            <strong>¥${price.toLocaleString()}</strong>
          </div>
        `;
      })
      .join('');
  }

  document.getElementById('btn-market').addEventListener('click', () => {
    renderMarket();
    modalMarket.classList.remove('hidden');
  });
  document.getElementById('btn-close-market').addEventListener('click', () => {
    modalMarket.classList.add('hidden');
  });
  document.getElementById('btn-sell-all').addEventListener('click', () => {
    const earned = market.sellAll();
    if (earned > 0) {
      physics.statusText = `市場で ¥${earned.toLocaleString()} 稼いだ！`;
    }
    renderMarket();
  });

  // ゲージ色ヘルパー
  function updateGauge(el, val) {
    const pct = Math.min(100, Math.max(0, val * 100));
    el.style.height = `${pct}%`;
    el.style.backgroundColor = pct > 82 ? '#f04438' : pct > 55 ? '#fdb022' : '#32d583';
  }

  // メインループ
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    timeSys.update(dt);
    physics.update(dt, timeSys.getHour(), state.weather);
    scene3D.update(dt, physics, timeSys.getHour(), state.weather);

    // HUD更新
    elTime.textContent = timeSys.getFormatted();
    elMoney.textContent = `¥${state.money.toLocaleString()}`;
    elFishCount.textContent = String(state.cooler.length);
    elDist.textContent = `${Math.abs(physics.lure.z).toFixed(1)}m`;
    elDepth.textContent = `${Math.abs(physics.lure.y).toFixed(1)}m`;
    elStatus.textContent = physics.statusText;

    elCastWrap.classList.toggle('hidden', physics.phase !== 'CHARGING');
    elCastFill.style.width = `${physics.castPower * 100}%`;

    elReelLabel.textContent =
      physics.phase === 'IDLE' || physics.phase === 'CHARGING' ? 'キャスト' : '巻く';

    updateGauge(elLineFill, physics.lineLoad);
    updateGauge(elRodFill, physics.rodLoad);
    updateGauge(elReelFill, physics.reelLoad);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

init();
