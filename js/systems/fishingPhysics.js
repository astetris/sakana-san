export class FishingPhysics {
  constructor(fishMaster, tackle, callbacks) {
    this.fishMaster = fishMaster;
    this.tackle = tackle;
    this.callbacks = callbacks; // { onSplash, onBite, onDragSlip, onCaught, onLost }

    this.phase = 'IDLE'; // IDLE | CHARGING | CASTING | RETRIEVING | FIGHTING
    this.castPower = 0;
    this.castDir = 1;
    this.aimX = 0; // -12 ~ +12m

    // ルアー座標（x: 左右, y: 水深 0=水面 マイナス=水中, z: 手前0→沖マイナス）
    this.lure = { x: 0, y: 0, z: -2 };
    this.castTargetZ = -25;
    this.castProgress = 0;
    this.maxDepthAtPoint = 12;

    // 操作入力
    this.isReeling = false;
    this.retrieveSpeed = 2; // 1~4
    this.dragLevel = 4;     // 1~8
    this.rodLift = 0;       // 0~1（ポンピング・アクション）
    this.actionImpulse = 0;

    // Fishing Planet風 3本ゲージ (0 ~ 1.0)
    this.lineLoad = 0;
    this.rodLoad = 0;
    this.reelLoad = 0;

    // ファイト中の魚状態
    this.activeFish = null;
    this.fishStamina = 0;
    this.fishBurstTimer = 0;
    this.fishIsRunning = false;
    this.zeroTensionTimer = 0;
    this.biteCheckAcc = 0;
    this.statusText = '右ボタン長押しでキャスト';
  }

  setDrag(delta) {
    this.dragLevel = Math.max(1, Math.min(8, this.dragLevel + delta));
  }

  cycleSpeed() {
    this.retrieveSpeed = (this.retrieveSpeed % 4) + 1;
  }

  adjustAim(dx) {
    if (this.phase === 'IDLE' || this.phase === 'CHARGING') {
      this.aimX = Math.max(-10, Math.min(10, this.aimX + dx));
    }
  }

  triggerRodAction() {
    if (this.phase === 'RETRIEVING') {
      this.actionImpulse = 1.0;
      this.lure.y = Math.min(-0.3, this.lure.y + 1.1);
      this.statusText = 'しゃくり / トゥイッチ！';
    } else if (this.phase === 'FIGHTING') {
      this.rodLift = 1.0;
      this.statusText = 'ポンピング！竿を立てて寄せる！';
    }
  }

  startReelPress() {
    if (this.phase === 'IDLE') {
      this.phase = 'CHARGING';
      this.castPower = 0.05;
      this.castDir = 1;
      this.statusText = '離してキャスト！';
    } else if (this.phase === 'RETRIEVING' || this.phase === 'FIGHTING') {
      this.isReeling = true;
    }
  }

  endReelPress() {
    if (this.phase === 'CHARGING') {
      this.launchCast();
    }
    this.isReeling = false;
  }

  launchCast() {
    this.phase = 'CASTING';
    this.castProgress = 0;
    const minDist = 12;
    const maxDist = 48 * this.tackle.rod.castBonus;
    this.castTargetZ = -(minDist + (maxDist - minDist) * this.castPower);
    this.lure = { x: this.aimX * 0.2, y: 1.5, z: -2.2 };
    this.statusText = 'キャスト中…';
  }

  update(dt, currentHour, weather) {
    this.actionImpulse = Math.max(0, this.actionImpulse - dt * 2.5);
    this.rodLift = Math.max(0, this.rodLift - dt * 1.4);

    if (this.phase === 'CHARGING') {
      this.castPower += dt * 1.35 * this.castDir;
      if (this.castPower >= 1) {
        this.castPower = 1;
        this.castDir = -1;
      } else if (this.castPower <= 0.08) {
        this.castPower = 0.08;
        this.castDir = 1;
      }
      return;
    }

    if (this.phase === 'CASTING') {
      this.castProgress += dt * 1.15;
      const t = Math.min(1, this.castProgress);
      this.lure.z = -2.2 + (this.castTargetZ + 2.2) * t;
      this.lure.x = this.aimX * t;
      this.lure.y = Math.sin(t * Math.PI) * (5 + this.castPower * 7);

      if (t >= 1) {
        this.lure.y = -0.2;
        this.phase = 'RETRIEVING';
        this.statusText = '巻取り＆しゃくりで誘おう';
        if (this.callbacks.onSplash) this.callbacks.onSplash(this.lure.x, this.lure.z, 1.0);
      }
      return;
    }

    if (this.phase === 'RETRIEVING') {
      this.updateRetrieving(dt, currentHour, weather);
      return;
    }

    if (this.phase === 'FIGHTING') {
      this.updateFighting(dt);
      return;
    }

    // IDLE時はゲージを戻す
    this.lineLoad = Math.max(0, this.lineLoad - dt * 3);
    this.rodLoad = Math.max(0, this.rodLoad - dt * 3);
    this.reelLoad = Math.max(0, this.reelLoad - dt * 3);
  }

  updateRetrieving(dt, currentHour, weather) {
    const dist = Math.abs(this.lure.z);
    // 沖に行くほど水深が深い地形
    this.maxDepthAtPoint = Math.min(15, 2.5 + dist * 0.25);

    if (this.isReeling) {
      const pull = this.tackle.reel.retrieveSpeed * (0.65 + this.retrieveSpeed * 0.45) * dt;
      this.lure.z = Math.min(-2.0, this.lure.z + pull);
      this.lure.x *= 1 - dt * 0.15;
      // 巻くと浮き上がる
      this.lure.y = Math.min(-0.2, this.lure.y + pull * 0.22);
      this.lineLoad = 0.08 + this.retrieveSpeed * 0.03;
      this.rodLoad = this.lineLoad * 0.7;
      this.reelLoad = this.lineLoad * 0.6;
    } else {
      // 巻かないと沈下（フォール）
      this.lure.y = Math.max(-this.maxDepthAtPoint, this.lure.y - this.tackle.lure.sinkRate * dt);
      this.lineLoad = Math.max(0.02, this.lineLoad - dt * 2);
      this.rodLoad = Math.max(0, this.rodLoad - dt * 2);
      this.reelLoad = Math.max(0, this.reelLoad - dt * 2);
    }

    // 回収完了
    if (this.lure.z >= -2.3) {
      this.resetToIdle('回収完了。もう一度キャストしよう');
      return;
    }

    // バイト判定（0.5秒ごと）
    this.biteCheckAcc += dt;
    if (this.biteCheckAcc >= 0.5) {
      this.biteCheckAcc = 0;
      this.tryTriggerBite(currentHour, weather);
    }
  }

  tryTriggerBite(currentHour, weather) {
    const depth = Math.abs(this.lure.y);
    const candidates = this.fishMaster.filter((f) => depth >= f.minDepth - 1.0 && depth <= f.maxDepth + 1.5);
    if (!candidates.length) return;

    const actionBonus = this.actionImpulse > 0.1 ? 1.8 : this.isReeling ? 1.25 : 0.85;
    const weatherBonus = weather === 'rain' ? 1.25 : weather === 'rough' ? 1.15 : 1.0;

    for (const fish of candidates) {
      const inActiveTime = fish.activeHours.includes(currentHour) ? 1.6 : 0.65;
      const prob = 0.055 * inActiveTime * actionBonus * weatherBonus * this.tackle.lure.attract;
      if (Math.random() < prob) {
        this.startFight(fish);
        return;
      }
    }
  }

  startFight(fishMasterItem) {
    const weightKg = Number(
      (fishMasterItem.minKg + Math.random() * (fishMasterItem.maxKg - fishMasterItem.minKg)).toFixed(2)
    );
    const sizeScale = weightKg / fishMasterItem.maxKg;

    this.activeFish = {
      ...fishMasterItem,
      weightKg,
      effectivePull: fishMasterItem.pullPower * (0.75 + sizeScale * 0.55)
    };
    this.fishStamina = fishMasterItem.stamina * (0.8 + sizeScale * 0.45);
    this.fishBurstTimer = 1.8;
    this.fishIsRunning = true;
    this.zeroTensionTimer = 0;
    this.phase = 'FIGHTING';
    this.statusText = `ヒット！！ ${this.activeFish.name} の強烈な引き！`;

    if (this.callbacks.onBite) this.callbacks.onBite();
    if (this.callbacks.onSplash) this.callbacks.onSplash(this.lure.x, this.lure.z, 1.5);
  }

  updateFighting(dt) {
    const fish = this.activeFish;
    if (!fish) return;

    // 魚のAI：突っ込みと休憩を切り替え
    this.fishBurstTimer -= dt;
    if (this.fishBurstTimer <= 0) {
      this.fishIsRunning = !this.fishIsRunning;
      this.fishBurstTimer = this.fishIsRunning ? 1.5 + Math.random() * 2.2 : 1.2 + Math.random() * 1.6;
    }

    const dragForceKg = this.tackle.reel.maxDragKg * (this.dragLevel / 8);
    const fatigueFactor = Math.max(0.28, this.fishStamina / fish.stamina);
    const fishPullKg = fish.effectivePull * (this.fishIsRunning ? 1.25 : 0.45) * fatigueFactor;

    // プレイヤーが与えるテンション
    const reelInput = this.isReeling ? 1.0 : 0.0;
    const pumpBonus = this.rodLift * 0.9;
    const rawTensionKg = Math.min(
      dragForceKg + (this.isReeling ? 0.65 : 0) + pumpBonus * 0.6,
      fishPullKg + reelInput * 1.2 + pumpBonus
    );

    // 3本ゲージの正規化負荷
    this.lineLoad = Math.min(1.08, rawTensionKg / this.tackle.line.breakLoadKg);
    this.rodLoad = Math.min(1.08, (rawTensionKg * (1 + this.rodLift * 0.18)) / this.tackle.rod.maxLoadKg);
    this.reelLoad = Math.min(1.08, (rawTensionKg * (this.isReeling ? 1.05 : 0.85)) / this.tackle.reel.maxDragKg);

    // ドラグが滑る判定（魚の引き > ドラグ力）
    if (fishPullKg > dragForceKg) {
      const runOut = (fishPullKg - dragForceKg) * fish.speed * 0.55 * dt;
      this.lure.z -= runOut;
      this.lure.x += (Math.sin(performance.now() * 0.004) * 3.5) * dt;
      this.statusText = 'ジジジッ！ドラグが滑っている！';
      if (this.callbacks.onDragSlip) this.callbacks.onDragSlip(true);
    } else {
      if (this.callbacks.onDragSlip) this.callbacks.onDragSlip(false);
      // 巻取り＆ポンピングで寄せる
      const pullIn = (reelInput * (1.2 + this.retrieveSpeed * 0.35) + this.rodLift * 2.1) * dt;
      const netMove = Math.max(-0.5 * dt, pullIn - (fishPullKg * 0.28 * dt));
      this.lure.z = Math.min(-1.8, this.lure.z + netMove);
      this.lure.x += Math.sin(performance.now() * 0.003) * 1.5 * dt;
      this.statusText = this.fishIsRunning ? '魚が暴れている！張力に注意' : 'チャンス！巻いて寄せよう！';
    }

    // 水面近くでは水しぶき
    this.lure.y = -Math.max(0.2, Math.abs(this.lure.z) * 0.12);
    if (Math.random() < dt * (this.fishIsRunning ? 2.5 : 0.6)) {
      if (this.callbacks.onSplash) this.callbacks.onSplash(this.lure.x, this.lure.z, 0.9);
    }

    // 魚のスタミナ消費（テンションが乗っているほど削れる）
    if (this.lineLoad > 0.25) {
      this.fishStamina = Math.max(0, this.fishStamina - (1.8 + this.lineLoad * 4.5) * dt);
    }

    // 失敗判定①：負荷MAXでラインブレイク
    if (this.lineLoad >= 1.02 || this.rodLoad >= 1.04) {
      if (this.callbacks.onDragSlip) this.callbacks.onDragSlip(false);
      this.resetToIdle('ラインブレイク！ドラグを少し緩めよう');
      if (this.callbacks.onLost) this.callbacks.onLost('負荷オーバーでラインが切れた！');
      return;
    }

    // 失敗判定②：ライン出し切り
    if (Math.abs(this.lure.z) >= this.tackle.line.lengthM) {
      if (this.callbacks.onDragSlip) this.callbacks.onDragSlip(false);
      this.resetToIdle('ラインを全部出されてしまった！');
      if (this.callbacks.onLost) this.callbacks.onLost('ラインを全て引き出された！');
      return;
    }

    // 失敗判定③：たるみすぎでバラシ
    if (this.lineLoad < 0.12) {
      this.zeroTensionTimer += dt;
      if (this.zeroTensionTimer >= 3.2) {
        if (this.callbacks.onDragSlip) this.callbacks.onDragSlip(false);
        this.resetToIdle('糸がたるんでバラしてしまった…');
        if (this.callbacks.onLost) this.callbacks.onLost('テンション抜けで針が外れた！');
        return;
      }
    } else {
      this.zeroTensionTimer = Math.max(0, this.zeroTensionTimer - dt * 2);
    }

    // 成功判定：手前3m以内まで寄せた
    if (this.lure.z >= -3.0) {
      if (this.callbacks.onDragSlip) this.callbacks.onDragSlip(false);
      const caught = { ...this.activeFish };
      this.resetToIdle(`${caught.name} を釣り上げた！`);
      if (this.callbacks.onCaught) this.callbacks.onCaught(caught);
    }
  }

  resetToIdle(msg) {
    this.phase = 'IDLE';
    this.isReeling = false;
    this.activeFish = null;
    this.lure = { x: 0, y: 0, z: -2.2 };
    this.lineLoad = 0;
    this.rodLoad = 0;
    this.reelLoad = 0;
    this.statusText = msg;
  }
}
