import { audioEngine } from "./audioEngine.js";

let activeCleanup = null;

export function stopActiveJobGame() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

export function runJobMinigame(container, job, onFinish) {
  stopActiveJobGame();
  if (job.gameType === "sort") runSortGame(container, job, onFinish);
  else if (job.gameType === "timing") runTimingGame(container, job, onFinish);
  else runPatrolGame(container, job, onFinish);
}

function calcReward(job, ratio) {
  const clamped = Math.max(0.4, Math.min(1.6, ratio));
  let grade = "B";
  if (clamped >= 1.35) grade = "S";
  else if (clamped >= 1.05) grade = "A";
  const pay = Math.round(job.basePay * clamped);
  return { pay, grade };
}

// 1) 高速仕分け（12秒）
function runSortGame(container, job, onFinish) {
  const pool = [
    { label: "🐟 マダイ", type: "A" },
    { label: "🐟 マアジ", type: "A" },
    { label: "🐟 クロマグロ", type: "A" },
    { label: "🐟 カサゴ", type: "A" },
    { label: "🦑 アオリイカ", type: "A" },
    { label: "🐚 アサリ", type: "B" },
    { label: "🐚 ホタテ", type: "B" },
    { label: "🐚 クロアワビ", type: "B" },
    { label: "🧰 浮き・仕掛け", type: "B" },
    { label: "🕸️ 漁網ロープ", type: "B" }
  ];

  let timeLeft = 12;
  let score = 0;
  let combo = 0;
  let miss = 0;
  let current = pool[Math.floor(Math.random() * pool.length)];

  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud">
        <span>⏱ 残り <strong id="job-time">12</strong>秒</span>
        <span>正解 <strong id="job-score">0</strong> (🔥<span id="job-combo">0</span>)</span>
      </div>
      <div class="muted">目の前の荷物を正しい箱へ素早く仕分けよう！</div>
      <div id="sort-card" class="sort-card">${current.label}</div>
      <div class="sort-btns">
        <button id="sort-a" class="btn-primary">🐟 鮮魚・イカ箱</button>
        <button id="sort-b" class="btn-warn">🐚 貝・漁具箱</button>
      </div>
    </div>
  `;

  const nextItem = () => {
    current = pool[Math.floor(Math.random() * pool.length)];
    const el = container.querySelector("#sort-card");
    if (el) el.textContent = current.label;
  };

  const answer = (pick) => {
    if (pick === current.type) {
      combo++;
      score += 1 + (combo >= 5 ? 0.25 : 0);
      audioEngine.playOk();
    } else {
      combo = 0;
      miss++;
      audioEngine.playFail();
    }
    const sc = container.querySelector("#job-score");
    const cb = container.querySelector("#job-combo");
    if (sc) sc.textContent = Math.floor(score);
    if (cb) cb.textContent = combo;
    nextItem();
  };

  container.querySelector("#sort-a").onclick = () => answer("A");
  container.querySelector("#sort-b").onclick = () => answer("B");

  const timer = setInterval(() => {
    timeLeft--;
    const tEl = container.querySelector("#job-time");
    if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopActiveJobGame();
      const ratio = 0.65 + score * 0.08 - miss * 0.07;
      const { pay, grade } = calcReward(job, ratio);
      onFinish({ pay, grade, detail: `仕分け成功 ${Math.floor(score)}件 / ミス ${miss}回` });
    }
  }, 1000);

  activeCleanup = () => clearInterval(timer);
}

// 2) ジャスト殻むき（5回勝負）
function runTimingGame(container, job, onFinish) {
  let round = 1;
  const maxRounds = 5;
  let perfect = 0;
  let good = 0;
  let pos = 0;
  let dir = 1;
  let speed = 1.9;
  let zoneStart = 38;
  let zoneWidth = 24;
  let rafId = null;

  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud">
        <span>🦪 <strong id="t-round">1</strong> / ${maxRounds} 個目</span>
        <span>✨完璧: <strong id="t-perf">0</strong></span>
      </div>
      <div class="muted">黄色バーが緑ゾーンに入ったらタップして殻を開けよう！</div>
      <div class="timing-track">
        <div id="t-zone" class="timing-zone" style="left:${zoneStart}%;width:${zoneWidth}%;"></div>
        <div id="t-cursor" class="timing-cursor" style="left:0%;"></div>
      </div>
      <div id="t-msg" class="muted">集中してタイミングを合わせよう…</div>
      <button id="t-tap" class="btn-primary" style="height:54px;font-size:1rem;">🔪 今だ！殻をむく</button>
    </div>
  `;

  const step = () => {
    pos += dir * speed;
    if (pos >= 96) { pos = 96; dir = -1; }
    if (pos <= 0) { pos = 0; dir = 1; }
    const cur = container.querySelector("#t-cursor");
    if (cur) cur.style.left = `${pos}%`;
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  const nextRound = () => {
    round++;
    if (round > maxRounds) {
      stopActiveJobGame();
      const ratio = 0.6 + perfect * 0.2 + good * 0.08;
      const { pay, grade } = calcReward(job, ratio);
      onFinish({ pay, grade, detail: `完璧 ${perfect}回 / 良好 ${good}回（全${maxRounds}個）` });
      return;
    }
    speed = 1.9 + round * 0.28;
    zoneWidth = Math.max(15, 25 - round * 2);
    zoneStart = 18 + Math.floor(Math.random() * (68 - zoneWidth));
    const zEl = container.querySelector("#t-zone");
    const rEl = container.querySelector("#t-round");
    if (zEl) { zEl.style.left = `${zoneStart}%`; zEl.style.width = `${zoneWidth}%`; }
    if (rEl) rEl.textContent = round;
  };

  container.querySelector("#t-tap").onclick = () => {
    const center = pos + 2;
    const msg = container.querySelector("#t-msg");
    if (center >= zoneStart && center <= zoneStart + zoneWidth) {
      perfect++;
      audioEngine.playOk();
      if (msg) msg.textContent = "✨ 完璧！身を傷つけず綺麗にむけた！";
    } else if (center >= zoneStart - 10 && center <= zoneStart + zoneWidth + 10) {
      good++;
      audioEngine.playDig();
      if (msg) msg.textContent = "👍 まずまず！少しズレたけど出荷OK";
    } else {
      audioEngine.playFail();
      if (msg) msg.textContent = "💦 殻が欠けてしまった…落ち着いて次！";
    }
    const pEl = container.querySelector("#t-perf");
    if (pEl) pEl.textContent = perfect;
    nextRound();
  };

  activeCleanup = () => { if (rafId) cancelAnimationFrame(rafId); };
}

// 3) 港内配送・夜の桟橋見回り（3x3グリッド12秒）
function runPatrolGame(container, job, onFinish) {
  let timeLeft = 12;
  let hits = 0;
  let activeIdx = Math.floor(Math.random() * 9);
  const icon = job.id === "job_night" ? "💡" : "📦";

  const cellsHtml = Array.from({ length: 9 }, (_, i) =>
    `<button class="patrol-cell ${i === activeIdx ? "active" : ""}" data-cell="${i}">${i === activeIdx ? icon : "・"}</button>`
  ).join("");

  container.innerHTML = `
    <div class="job-stage">
      <div class="job-hud">
        <span>⏱ 残り <strong id="p-time">12</strong>秒</span>
        <span>完了: <strong id="p-hits">0</strong>件</span>
      </div>
      <div class="muted">光っている場所を素早くタップして回ろう！</div>
      <div class="patrol-grid">${cellsHtml}</div>
    </div>
  `;

  const paint = () => {
    container.querySelectorAll(".patrol-cell").forEach((b, i) => {
      const on = i === activeIdx;
      b.classList.toggle("active", on);
      b.textContent = on ? icon : "・";
    });
  };

  container.querySelectorAll(".patrol-cell").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.cell);
      if (idx === activeIdx) {
        hits++;
        audioEngine.playOk();
        let next = Math.floor(Math.random() * 9);
        if (next === activeIdx) next = (next + 1) % 9;
        activeIdx = next;
        const hEl = container.querySelector("#p-hits");
        if (hEl) hEl.textContent = hits;
        paint();
      } else {
        audioEngine.playFail();
      }
    };
  });

  const timer = setInterval(() => {
    timeLeft--;
    const tEl = container.querySelector("#p-time");
    if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      stopActiveJobGame();
      const ratio = 0.6 + hits * 0.065;
      const { pay, grade } = calcReward(job, ratio);
      onFinish({ pay, grade, detail: `対応件数 ${hits}件` });
    }
  }, 1000);

  activeCleanup = () => clearInterval(timer);
}
