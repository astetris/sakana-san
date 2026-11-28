import { audioEngine } from "./audioEngine.js?v=20261128_045938";

let activeCleanup = null;

export function stopActiveJobGame() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

export function runJobMinigame(container, job, onFinish) {
  stopActiveJobGame();
  const map = {
    clean:  runAquariumCleanGame,
    feed:   runAquariumFeedGame,
    sort:   runSortGame,
    timing: runTimingGame,
    ice:    runIcePackGame,
    repair: runNetRepairGame,
    patrol: runPatrolGame
  };
  (map[job.gameType] || runSortGame)(container, job, onFinish);
}

function runAquariumCleanGame(container, job, onFinish) {
  let timeLeft = 18, cleanPct = 0, drawing = false;
  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud">
        <span>⏱ 残り <strong id="c-time">18</strong>秒</span>
        <span>✨ 清掃率 <strong id="c-pct">0</strong>% (ノルマ80%)</span>
      </div>
      <div class="muted">水槽のコケを指でこすって綺麗に落とそう！</div>
      <div class="clean-wrap">
        <div class="clean-bg-fish"><span>🐠</span><span>🐟</span><span>🐡</span></div>
        <canvas id="clean-canvas" width="280" height="180"></canvas>
      </div>
      <button id="c-finish-now" class="btn-sub hidden">✅ ノルマ達成！今すぐ完了してスピードボーナス</button>
    </div>
  `;
  const canvas = container.querySelector("#clean-canvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(48, 86, 52, 0.86)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 45; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(35, 72, 38, 0.9)" : "rgba(84, 102, 46, 0.85)";
    ctx.beginPath();
    ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, 10 + Math.random() * 18, 0, Math.PI * 2);
    ctx.fill();
  }
  const calcCleanPct = () => {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0, cleared = 0;
    for (let y = 0; y < canvas.height; y += 6) {
      for (let x = 0; x < canvas.width; x += 6) {
        total++;
        if (img[(y * canvas.width + x) * 4 + 3] < 40) cleared++;
      }
    }
    return Math.round((cleared / total) * 100);
  };
  const finish = () => {
    stopActiveJobGame();
    const passed = cleanPct >= 80;
    const perfect = cleanPct >= 97;
    const speedBonus = passed && timeLeft >= 5 ? 0.2 : 0;
    const extraMult = passed ? Math.max(0, (cleanPct - 80) * 0.015) : 0;
    onFinish({ passed, perfect, extraMult: extraMult + speedBonus, detail: `清掃率 ${cleanPct}%（残り${timeLeft}秒）` + (speedBonus ? "・スピード完了！" : "") });
  };
  const scrub = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    audioEngine.playScrub();
    cleanPct = calcCleanPct();
    const pctEl = container.querySelector("#c-pct");
    if (pctEl) pctEl.textContent = cleanPct;
    if (cleanPct >= 80) container.querySelector("#c-finish-now")?.classList.remove("hidden");
    if (cleanPct >= 98) finish();
  };
  canvas.addEventListener("pointerdown", (e) => { drawing = true; scrub(e); });
  canvas.addEventListener("pointermove", (e) => { if (drawing) scrub(e); });
  const endDraw = () => { drawing = false; };
  window.addEventListener("pointerup", endDraw);
  container.querySelector("#c-finish-now").onclick = finish;
  const timer = setInterval(() => {
    timeLeft--;
    const tEl = container.querySelector("#c-time");
    if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) finish();
  }, 1000);
  activeCleanup = () => { clearInterval(timer); window.removeEventListener("pointerup", endDraw); };
}

function runAquariumFeedGame(container, job, onFinish) {
  let timeLeft = 15, fed = 0, miss = 0, board = [];
  const rollBoard = () => {
    board = Array.from({ length: 9 }, () => { const r = Math.random(); return r < 0.34 ? "hungry" : r < 0.52 ? "shark" : "full"; });
    if (!board.includes("hungry")) board[Math.floor(Math.random() * 9)] = "hungry";
  };
  rollBoard();
  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud"><span>⏱ 残り <strong id="f-time">15</strong>秒</span><span>🍤 給餌 <strong id="f-fed">0</strong>/8匹 (ミス<span id="f-miss">0</span>)</span></div>
      <div class="muted">ペコペコ魚(😋🐟)だけをタップしてエサやり！サメ(🦈)はNG</div>
      <div id="f-grid" class="patrol-grid"></div>
    </div>
  `;
  const paint = () => {
    const grid = container.querySelector("#f-grid");
    if (!grid) return;
    grid.innerHTML = board.map((t, i) => `<button class="patrol-cell ${t === "hungry" ? "good" : t === "shark" ? "danger" : ""}" data-idx="${i}">${t === "hungry" ? "😋🐟" : t === "shark" ? "🦈" : "😌"}</button>`).join("");
    grid.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.idx);
        if (board[idx] === "hungry") { fed++; board[idx] = "full"; audioEngine.playOk(); if (!board.includes("hungry")) rollBoard(); }
        else { miss++; audioEngine.playFail(); }
        const fEl = container.querySelector("#f-fed"), mEl = container.querySelector("#f-miss");
        if (fEl) fEl.textContent = fed; if (mEl) mEl.textContent = miss;
        paint();
      };
    });
  };
  paint();
  const shuffle = setInterval(() => { rollBoard(); paint(); }, 2200);
  const timer = setInterval(() => {
    timeLeft--; const tEl = container.querySelector("#f-time"); if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopActiveJobGame();
      const passed = fed >= 8;
      onFinish({ passed, perfect: passed && miss === 0 && fed >= 12, extraMult: passed ? Math.max(0, (fed - 8) * 0.05 - miss * 0.04) : 0, detail: `給餌 ${fed}匹 / ミス ${miss}回` });
    }
  }, 1000);
  activeCleanup = () => { clearInterval(timer); clearInterval(shuffle); };
}

function runSortGame(container, job, onFinish) {
  const pool = [
    { label: "🐟 マダイ", type: "A" }, { label: "🐟 マアジ", type: "A" }, { label: "🐟 クロマグロ", type: "A" },
    { label: "🐟 ノドグロ", type: "A" }, { label: "🦑 アオリイカ", type: "A" }, { label: "🐚 アサリ", type: "B" },
    { label: "🐚 ホタテ", type: "B" }, { label: "🐚 クロアワビ", type: "B" }, { label: "🧰 浮き・仕掛け", type: "B" }, { label: "🕸️ 漁網ロープ", type: "B" }
  ];
  let timeLeft = 15, ok = 0, combo = 0, miss = 0;
  let current = pool[Math.floor(Math.random() * pool.length)];
  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud"><span>⏱ 残り <strong id="job-time">15</strong>秒</span><span>仕分け <strong id="job-score">0</strong>/10 (🔥<span id="job-combo">0</span>)</span></div>
      <div class="muted">荷物を正しい箱へ素早く仕分けよう！</div>
      <div id="sort-card" class="sort-card">${current.label}</div>
      <div class="sort-btns"><button id="sort-a" class="btn-primary">🐟 鮮魚・イカ箱</button><button id="sort-b" class="btn-warn">🐚 貝・漁具箱</button></div>
    </div>
  `;
  const answer = (pick) => {
    if (pick === current.type) { ok++; combo++; audioEngine.playOk(); } else { combo = 0; miss++; audioEngine.playFail(); }
    current = pool[Math.floor(Math.random() * pool.length)];
    const card = container.querySelector("#sort-card"), sc = container.querySelector("#job-score"), cb = container.querySelector("#job-combo");
    if (card) card.textContent = current.label; if (sc) sc.textContent = ok; if (cb) cb.textContent = combo;
  };
  container.querySelector("#sort-a").onclick = () => answer("A");
  container.querySelector("#sort-b").onclick = () => answer("B");
  const timer = setInterval(() => {
    timeLeft--; const tEl = container.querySelector("#job-time"); if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopActiveJobGame();
      const passed = ok >= 10;
      onFinish({ passed, perfect: passed && miss === 0 && ok >= 14, extraMult: passed ? Math.max(0, (ok - 10) * 0.045 - miss * 0.04) : 0, detail: `仕分け ${ok}件 / ミス ${miss}回` });
    }
  }, 1000);
  activeCleanup = () => clearInterval(timer);
}

function runTimingGame(container, job, onFinish) {
  let round = 1, maxRounds = 5, perfect = 0, good = 0, pos = 0, dir = 1, speed = 1.9, zoneStart = 38, zoneWidth = 24, rafId = null;
  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud"><span>🦪 <strong id="t-round">1</strong> / ${maxRounds} 個目</span><span>成功 <strong id="t-ok">0</strong>/3 (✨完璧:<span id="t-perf">0</span>)</span></div>
      <div class="muted">黄色バーが緑ゾーンに入ったらタップして殻を開けよう！</div>
      <div class="timing-track"><div id="t-zone" class="timing-zone" style="left:${zoneStart}%;width:${zoneWidth}%;"></div><div id="t-cursor" class="timing-cursor" style="left:0%;"></div></div>
      <div id="t-msg" class="muted">集中してタイミングを合わせよう…</div>
      <button id="t-tap" class="btn-primary" style="height:52px;font-size:1rem;">🔪 今だ！殻をむく</button>
    </div>
  `;
  const step = () => {
    pos += dir * speed;
    if (pos >= 96) { pos = 96; dir = -1; }
    if (pos <= 0) { pos = 0; dir = 1; }
    const cur = container.querySelector("#t-cursor"); if (cur) cur.style.left = `${pos}%`;
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
  const nextRound = () => {
    round++;
    if (round > maxRounds) {
      stopActiveJobGame();
      const passed = (perfect + good) >= 3;
      onFinish({ passed, perfect: perfect >= 4, extraMult: passed ? (perfect * 0.08 + good * 0.03) : 0, detail: `完璧 ${perfect}回 / 良好 ${good}回（全${maxRounds}個）` });
      return;
    }
    speed = 1.9 + round * 0.25; zoneWidth = Math.max(16, 26 - round * 2); zoneStart = 18 + Math.floor(Math.random() * (68 - zoneWidth));
    const zEl = container.querySelector("#t-zone"), rEl = container.querySelector("#t-round");
    if (zEl) { zEl.style.left = `${zoneStart}%`; zEl.style.width = `${zoneWidth}%`; }
    if (rEl) rEl.textContent = round;
  };
  container.querySelector("#t-tap").onclick = () => {
    const center = pos + 2, msg = container.querySelector("#t-msg");
    if (center >= zoneStart && center <= zoneStart + zoneWidth) { perfect++; audioEngine.playOk(); if (msg) msg.textContent = "✨ 完璧！"; }
    else if (center >= zoneStart - 10 && center <= zoneStart + zoneWidth + 10) { good++; audioEngine.playDig(); if (msg) msg.textContent = "👍 良好！出荷OK"; }
    else { audioEngine.playFail(); if (msg) msg.textContent = "💦 殻が欠けてしまった…"; }
    const pEl = container.querySelector("#t-perf"), oEl = container.querySelector("#t-ok");
    if (pEl) pEl.textContent = perfect; if (oEl) oEl.textContent = perfect + good;
    nextRound();
  };
  activeCleanup = () => { if (rafId) cancelAnimationFrame(rafId); };
}

function runIcePackGame(container, job, onFinish) {
  let timeLeft = 15, cooled = 0, spoiled = 0;
  const boxes = [{ name: "🐟 マダイ箱", temp: 3.0 }, { name: "🐟 ブリ箱", temp: 4.5 }, { name: "🦑 イカ箱", temp: 2.5 }, { name: "🐚 ホタテ箱", temp: 5.0 }];
  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud"><span>⏱ 残り <strong id="i-time">15</strong>秒</span><span>🧊 保冷 <strong id="i-ok">0</strong>/8 (過熱:<span id="i-bad">0</span>)</span></div>
      <div class="muted">10℃以上になる前に箱をタップして氷を補充しよう！</div>
      <div id="i-grid" class="ice-grid"></div>
    </div>
  `;
  const paint = () => {
    const g = container.querySelector("#i-grid");
    if (!g) return;
    g.innerHTML = boxes.map((b, i) => `<button class="ice-box ${b.temp >= 7.5 ? "hot" : ""}" data-box="${i}"><strong>${b.name}</strong><span style="font-size:1.15rem;font-weight:800;">${b.temp.toFixed(1)} ℃</span><span class="muted">${b.temp >= 7.5 ? "🔥 急いで氷！" : "❄️ 適温"}</span></button>`).join("");
    g.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => {
        const b = boxes[Number(btn.dataset.box)]; b.temp = Math.max(0.5, b.temp - 4.8); cooled++; audioEngine.playOk();
        const oEl = container.querySelector("#i-ok"); if (oEl) oEl.textContent = cooled;
        paint();
      };
    });
  };
  paint();
  const heatTick = setInterval(() => {
    boxes.forEach((b) => {
      b.temp += 0.45 + Math.random() * 0.55;
      if (b.temp >= 10.5) { spoiled++; b.temp = 5.0; audioEngine.playFail(); const bEl = container.querySelector("#i-bad"); if (bEl) bEl.textContent = spoiled; }
    });
    paint();
  }, 450);
  const timer = setInterval(() => {
    timeLeft--; const tEl = container.querySelector("#i-time"); if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopActiveJobGame();
      const passed = cooled >= 8 && spoiled === 0;
      onFinish({ passed, perfect: passed && cooled >= 14, extraMult: passed ? Math.min(0.4, (cooled - 8) * 0.04) : 0, detail: `氷補充 ${cooled}回 / 過熱ミス ${spoiled}回` });
    }
  }, 1000);
  activeCleanup = () => { clearInterval(timer); clearInterval(heatTick); };
}

function runNetRepairGame(container, job, onFinish) {
  let timeLeft = 15, fixedNets = 0, holes = new Set();
  const makeNet = () => { holes = new Set(); const count = 3 + (fixedNets % 2); while (holes.size < count) holes.add(Math.floor(Math.random() * 9)); };
  makeNet();
  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud"><span>⏱ 残り <strong id="r-time">15</strong>秒</span><span>🕸️ 修繕済 <strong id="r-done">0</strong>/3枚</span></div>
      <div class="muted">破れた穴(🕳️)をすべてタップして縫い直そう！</div>
      <div id="r-grid" class="patrol-grid"></div>
    </div>
  `;
  const paint = () => {
    const g = container.querySelector("#r-grid");
    if (!g) return;
    g.innerHTML = Array.from({ length: 9 }, (_, i) => `<button class="patrol-cell ${holes.has(i) ? "active" : ""}" data-cell="${i}">${holes.has(i) ? "🕳️" : "🕸️"}</button>`).join("");
    g.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.cell);
        if (holes.has(idx)) {
          holes.delete(idx); audioEngine.playOk();
          if (holes.size === 0) { fixedNets++; const dEl = container.querySelector("#r-done"); if (dEl) dEl.textContent = fixedNets; makeNet(); }
          paint();
        } else audioEngine.playFail();
      };
    });
  };
  paint();
  const timer = setInterval(() => {
    timeLeft--; const tEl = container.querySelector("#r-time"); if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopActiveJobGame();
      const passed = fixedNets >= 3;
      onFinish({ passed, perfect: fixedNets >= 6, extraMult: passed ? Math.min(0.45, (fixedNets - 3) * 0.1) : 0, detail: `修繕完了 ${fixedNets}枚` });
    }
  }, 1000);
  activeCleanup = () => clearInterval(timer);
}

function runPatrolGame(container, job, onFinish) {
  const GOAL_DIST = 1100;
  let timeLeft = 54.0;
  let dist = 0;
  let speed = 18;
  let truckX = 140;
  let freshness = 100;
  let integrity = 100;
  let safetyScore = 0;
  let delivered = 0;
  let finished = false;

  const stops = [
    { at: 360,  name: "🐟 港の魚市場", done: false },
    { at: 730,  name: "🍣 寿司処 凪",  done: false },
    { at: 1080, name: "🚉 駅前鮮魚店", done: false }
  ];

  // 信号・踏切を距離ベースで事前予告（130m手前からカウントダウン＆黄→赤の段階変化）
  const events = [
    { type: "signal", at: 310, warnAt: 180, spawned: false, done: false },
    { type: "rail",   at: 640, warnAt: 500, spawned: false, done: false },
    { type: "signal", at: 910, warnAt: 780, spawned: false, done: false }
  ];

  const cars = [];
  let spawnTimer = 1.0;
  let signalEvent = null; // { y, state: 'yellow'|'red'|'green', yellowTimer, redTimer, passed, rewarded }
  let railEvent = null;   // { y, closed, trainX, timer, passed, rewarded }
  let bannerMsg = "🚚 アクセルで出発！信号・踏切は130m手前から予告が出ます";

  const ctrl = { left: false, right: false, gas: false, brake: false };

  container.innerHTML = `
    <div class="job-stage" style="text-align:center;">
      <div class="job-hud" style="font-size:11px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
        <span>⏱ <strong id="tr-time">54</strong>s</span>
        <span>📍 残<strong id="tr-rem">1100</strong>m</span>
        <span>🐟 鮮度<strong id="tr-fresh">100</strong>%</span>
        <span>🚚 <strong id="tr-spd">18</strong>km/h</span>
      </div>
      <div id="tr-warn-bar" style="display:none;padding:4px 8px;border-radius:7px;font-size:12px;font-weight:800;margin-bottom:4px;background:rgba(245,158,11,0.28);color:#fde047;border:1px solid rgba(250,204,21,0.6);"></div>
      <div id="tr-msg" style="font-size:11px;color:#38bdf8;min-height:16px;margin-bottom:4px;">${bannerMsg}</div>
      <canvas id="truck-drive-cv" width="280" height="230" style="width:100%;max-width:300px;height:230px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);background:#1e293b;display:block;margin:0 auto;touch-action:none;"></canvas>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:8px;user-select:none;">
        <button type="button" id="tr-btn-l" class="btn-sub" style="height:46px;font-size:16px;touch-action:none;">◀ 左</button>
        <button type="button" id="tr-btn-r" class="btn-sub" style="height:46px;font-size:16px;touch-action:none;">右 ▶</button>
        <button type="button" id="tr-btn-brk" class="btn-sub" style="height:46px;font-size:13px;background:rgba(239,68,68,0.28);touch-action:none;">🛑 減速</button>
        <button type="button" id="tr-btn-gas" class="btn-primary" style="height:46px;font-size:13px;touch-action:none;">⚡ 加速</button>
      </div>
    </div>
  `;

  const cv = container.querySelector("#truck-drive-cv");
  const ctx = cv.getContext("2d");
  const LANE_XS = [68, 140, 212];
  let rafId = null;
  let lastTs = performance.now();
  let roadScroll = 0;

  const bindHold = (sel, key) => {
    const el = container.querySelector(sel);
    if (!el) return;
    const on = (e) => { e.preventDefault(); ctrl[key] = true; };
    const off = () => { ctrl[key] = false; };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointerleave", off);
    el.addEventListener("pointercancel", off);
  };
  bindHold("#tr-btn-l", "left");
  bindHold("#tr-btn-r", "right");
  bindHold("#tr-btn-gas", "gas");
  bindHold("#tr-btn-brk", "brake");

  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") ctrl.left = true;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") ctrl.right = true;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") ctrl.gas = true;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S" || e.key === " ") ctrl.brake = true;
  };
  const onKeyUp = (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") ctrl.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") ctrl.right = false;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") ctrl.gas = false;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S" || e.key === " ") ctrl.brake = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const cleanupAll = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };

  const endGame = (cleared) => {
    if (finished) return;
    finished = true;
    cleanupAll();
    stopActiveJobGame();
    const passed = cleared && freshness >= 45 && integrity >= 30;
    const perfect = passed && freshness >= 85 && safetyScore >= 1;
    const extraMult = passed ? Math.max(0, (freshness - 60) * 0.008 + safetyScore * 0.12 + (timeLeft > 12 ? 0.15 : 0)) : 0;
    onFinish({
      passed,
      perfect,
      extraMult,
      detail: cleared
        ? `3拠点へ配送完了！鮮度${Math.round(freshness)}%・安全ボーナス×${safetyScore}`
        : `配送途中終了（残り${Math.max(0, Math.round(GOAL_DIST - dist))}m / 鮮度${Math.round(freshness)}%）`
    });
  };

  const loop = (now) => {
    if (finished) return;
    if (!document.body.contains(cv)) { cleanupAll(); return; }
    const dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;

    timeLeft = Math.max(0, timeLeft - dt);

    // ブレーキ性能を強化し、予告を見て確実に気持ちよく止まれるようにする
    if (ctrl.gas) speed = Math.min(88, speed + 52 * dt);
    else if (ctrl.brake) speed = Math.max(0, speed - 135 * dt);
    else speed = Math.max(10, speed - 22 * dt);

    const steerSpd = 128 + speed * 0.65;
    if (ctrl.left) truckX -= steerSpd * dt;
    if (ctrl.right) truckX += steerSpd * dt;
    truckX = Math.max(46, Math.min(234, truckX));

    const moveM = (speed * 0.42) * dt;
    dist += moveM;
    roadScroll = (roadScroll + moveM * 6.0) % 40;
    freshness = Math.max(0, freshness - dt * 0.42);

    for (const s of stops) {
      if (!s.done && dist >= s.at) {
        s.done = true;
        delivered += 1;
        bannerMsg = `✅ ${s.name}へ鮮魚を納品完了！（${delivered}/3）`;
        audioEngine.playOk?.();
      }
    }

    // 事前予告の判定＆イベント生成（画面上部に出現するのは予告から十分あと）
    let activeWarn = null;
    for (const ev of events) {
      if (ev.done) continue;
      const remM = Math.max(0, Math.round(ev.at - dist));
      if (!ev.spawned && dist >= ev.warnAt) {
        activeWarn = { type: ev.type, remM };
        if (remM <= 26) {
          ev.spawned = true;
          if (ev.type === "signal") {
            signalEvent = { y: -24, state: "yellow", yellowTimer: 1.3, redTimer: 3.1, passed: false, rewarded: false, refEv: ev };
          } else {
            railEvent = { y: -24, closed: true, trainX: -220, timer: 3.6, passed: false, rewarded: false, refEv: ev };
          }
        }
      }
    }

    if (signalEvent) {
      signalEvent.y += moveM * 6.0;
      if (signalEvent.state === "yellow") {
        signalEvent.yellowTimer -= dt;
        if (signalEvent.yellowTimer <= 0) signalEvent.state = "red";
      } else if (signalEvent.state === "red") {
        signalEvent.redTimer -= dt;
        if (signalEvent.redTimer <= 0) {
          signalEvent.state = "green";
          bannerMsg = "🟢 青信号！発進しよう！";
          audioEngine.playOk?.();
        }
        if (!signalEvent.rewarded && signalEvent.y >= 95 && signalEvent.y <= 165 && speed < 5) {
          signalEvent.rewarded = true;
          safetyScore += 1;
          bannerMsg = "👏 安全停止ナイス！青になるのを待とう";
        }
      }
      if (!signalEvent.passed && signalEvent.y > 180) {
        signalEvent.passed = true;
        if (signalEvent.state === "red" && speed > 12) {
          freshness = Math.max(0, freshness - 12);
          bannerMsg = "🚨 赤信号通過！急ハンドルで鮮度ダウン (-12%)";
          audioEngine.playFail?.();
        }
      }
      if (signalEvent.y > 260) {
        if (signalEvent.refEv) signalEvent.refEv.done = true;
        signalEvent = null;
      }
    }

    if (railEvent) {
      railEvent.y += moveM * 6.0;
      if (railEvent.closed) {
        railEvent.timer -= dt;
        railEvent.trainX += 165 * dt;
        if (railEvent.y >= 90 && railEvent.y <= 165 && speed < 5 && !railEvent.rewarded) {
          railEvent.rewarded = true;
          safetyScore += 1;
          bannerMsg = "🚆 踏切で安全一時停止！電車通過待ち…";
        }
        if (railEvent.timer <= 0) {
          railEvent.closed = false;
          bannerMsg = "🚧 遮断機が上がった！安全に通過しよう";
          audioEngine.playOk?.();
        }
      }
      if (!railEvent.passed && railEvent.y > 180) {
        railEvent.passed = true;
        if (railEvent.closed) {
          integrity = Math.max(0, integrity - 25);
          freshness = Math.max(0, freshness - 16);
          speed = 10;
          bannerMsg = "💥 遮断機に接触！鮮度＆車体にダメージ！";
          audioEngine.playFail?.();
        }
      }
      if (railEvent.y > 260) {
        if (railEvent.refEv) railEvent.refEv.done = true;
        railEvent = null;
      }
    }

    // 予告中・信号・踏切の前後には他車を出さない（安全に減速に集中できる）
    spawnTimer -= dt;
    if (spawnTimer <= 0 && !activeWarn && !signalEvent && !railEvent) {
      spawnTimer = 1.2 + Math.random() * 0.9;
      const lane = LANE_XS[Math.floor(Math.random() * LANE_XS.length)];
      const isBus = Math.random() < 0.24;
      cars.push({
        x: lane, y: -45, w: isBus ? 30 : 24, h: isBus ? 56 : 38,
        spd: isBus ? 18 : (24 + Math.random() * 14),
        col: isBus ? "#0284c7" : (Math.random() < 0.5 ? "#ef4444" : "#cbd5e1")
      });
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      c.y += ((speed - c.spd) * 0.42) * 6.0 * dt;
      if (Math.abs(c.x - truckX) < (c.w / 2 + 12) && Math.abs(c.y - 178) < (c.h / 2 + 19)) {
        integrity = Math.max(0, integrity - 20);
        freshness = Math.max(0, freshness - 12);
        speed = Math.max(8, speed * 0.4);
        bannerMsg = "💥 接触事故！鮮度-12% 気をつけて運転しよう";
        audioEngine.playFail?.();
        cars.splice(i, 1);
        continue;
      }
      if (c.y > 290 || c.y < -120) cars.splice(i, 1);
    }

    // ===== 描画 =====
    ctx.fillStyle = "#0369a1"; ctx.fillRect(0, 0, 32, 230);
    ctx.fillStyle = "#475569"; ctx.fillRect(248, 0, 32, 230);
    ctx.fillStyle = "#27303d"; ctx.fillRect(32, 0, 216, 230);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(34, 0, 3, 230);
    ctx.fillRect(243, 0, 3, 230);
    ctx.fillStyle = "rgba(226,232,240,0.65)";
    for (let y = -40 + roadScroll; y < 240; y += 40) {
      ctx.fillRect(103, y, 3, 20);
      ctx.fillRect(175, y, 3, 20);
    }

    // 予告中の路面マーキング表示
    if (activeWarn) {
      const blink = Math.floor(now / 260) % 2 === 0;
      ctx.fillStyle = blink ? "rgba(250,204,21,0.92)" : "rgba(245,158,11,0.65)";
      ctx.fillRect(42, 8, 196, 24);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        activeWarn.type === "signal"
          ? `🚦 もうすぐ信号！あと ${activeWarn.remM}m`
          : `🚧 もうすぐ踏切！あと ${activeWarn.remM}m`,
        140, 24
      );
      ctx.textAlign = "left";
    }

    if (signalEvent) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(38, signalEvent.y, 204, 5);
      ctx.fillStyle = "#111827";
      ctx.fillRect(236, signalEvent.y - 36, 20, 46);
      ctx.beginPath(); ctx.arc(246, signalEvent.y - 27, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = signalEvent.state === "red" ? "#ef4444" : "#3f1d1d"; ctx.fill();
      ctx.beginPath(); ctx.arc(246, signalEvent.y - 13, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = signalEvent.state === "yellow" ? "#facc15" : "#3b3214"; ctx.fill();
      ctx.beginPath(); ctx.arc(246, signalEvent.y + 1, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = signalEvent.state === "green" ? "#22c55e" : "#143523"; ctx.fill();
    }

    if (railEvent) {
      ctx.fillStyle = "#57534e";
      ctx.fillRect(0, railEvent.y - 10, 280, 20);
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(0, railEvent.y - 5, 280, 2);
      ctx.fillRect(0, railEvent.y + 4, 280, 2);
      if (railEvent.closed) {
        ctx.fillStyle = "#facc15";
        ctx.fillRect(32, railEvent.y + 12, 216, 4);
        ctx.fillStyle = "#0e7490";
        ctx.fillRect(railEvent.trainX, railEvent.y - 9, 145, 18);
        ctx.fillStyle = "#fef9e7";
        ctx.fillRect(railEvent.trainX + 6, railEvent.y - 6, 133, 6);
      }
    }

    for (const c of cars) {
      ctx.fillStyle = c.col;
      ctx.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(c.x - c.w / 2 + 3, c.y - c.h / 2 + 5, c.w - 6, 9);
    }

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(truckX - 13, 166, 26, 28);
    ctx.fillStyle = "#0284c7";
    ctx.fillRect(truckX - 13, 178, 26, 5);
    ctx.fillRect(truckX - 12, 152, 24, 14);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(truckX - 9, 155, 18, 6);
    if (ctrl.brake) {
      ctx.fillStyle = "#ff2e2e";
      ctx.fillRect(truckX - 12, 193, 7, 3);
      ctx.fillRect(truckX + 5, 193, 7, 3);
    }

    const tEl = container.querySelector("#tr-time");
    const rEl = container.querySelector("#tr-rem");
    const fEl = container.querySelector("#tr-fresh");
    const sEl = container.querySelector("#tr-spd");
    const mEl = container.querySelector("#tr-msg");
    const wEl = container.querySelector("#tr-warn-bar");
    if (tEl) tEl.textContent = Math.ceil(timeLeft);
    if (rEl) rEl.textContent = Math.max(0, Math.round(GOAL_DIST - dist));
    if (fEl) fEl.textContent = Math.round(freshness);
    if (sEl) sEl.textContent = Math.round(speed);
    if (mEl) mEl.textContent = bannerMsg;
    if (wEl) {
      if (activeWarn) {
        wEl.style.display = "block";
        wEl.textContent = activeWarn.type === "signal"
          ? `⚠️ 予告：${activeWarn.remM}m先に信号あり！減速の準備をしよう`
          : `⚠️ 予告：${activeWarn.remM}m先に踏切あり！減速して一時停止しよう`;
      } else {
        wEl.style.display = "none";
      }
    }

    if (dist >= GOAL_DIST) { endGame(true); return; }
    if (timeLeft <= 0 || integrity <= 0 || freshness <= 0) { endGame(false); return; }

    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);
}
