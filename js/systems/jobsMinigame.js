import { audioEngine } from "./audioEngine.js?v=20261128_042032";

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
  let timeLeft = 15, hits = 0, activeIdx = Math.floor(Math.random() * 9);
  const icon = new Date().getHours() >= 19 || new Date().getHours() < 5 ? "💡" : "📦";
  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud"><span>⏱ 残り <strong id="p-time">15</strong>秒</span><span>完了 <strong id="p-hits">0</strong>/10件</span></div>
      <div class="muted">光っている場所を素早くタップして回ろう！</div>
      <div id="p-grid" class="patrol-grid"></div>
    </div>
  `;
  const paint = () => {
    const g = container.querySelector("#p-grid");
    if (!g) return;
    g.innerHTML = Array.from({ length: 9 }, (_, i) => `<button class="patrol-cell ${i === activeIdx ? "active" : ""}" data-cell="${i}">${i === activeIdx ? icon : "・"}</button>`).join("");
    g.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => {
        if (Number(btn.dataset.cell) === activeIdx) {
          hits++; audioEngine.playOk();
          let next = Math.floor(Math.random() * 9);
          if (next === activeIdx) next = (next + 1) % 9;
          activeIdx = next;
          const hEl = container.querySelector("#p-hits"); if (hEl) hEl.textContent = hits;
          paint();
        } else audioEngine.playFail();
      };
    });
  };
  paint();
  const timer = setInterval(() => {
    timeLeft--; const tEl = container.querySelector("#p-time"); if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopActiveJobGame();
      const passed = hits >= 10;
      onFinish({ passed, perfect: hits >= 18, extraMult: passed ? Math.min(0.45, (hits - 10) * 0.045) : 0, detail: `対応完了 ${hits}件` });
    }
  }, 1000);
  activeCleanup = () => clearInterval(timer);
}
