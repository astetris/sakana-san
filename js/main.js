import { initFirebase, fetchDailyRanking, submitDailyRecord } from "./config/firebase.js";
import { getRealWorldEnv } from "./systems/environment.js";
import {
  syncLoadSlots, persistSlots, createNewSave, applyStaminaRegen
} from "./state/saveManager.js";
import { loadSpeciesMaster, getAllSpecies, rollCatch } from "./systems/fishingEngine.js";
import { FishingScene } from "./scenes/fishingScene.js";

const $ = (id) => document.getElementById(id);

let slots = [];
let activeSlotIndex = -1;
let env = getRealWorldEnv();
let scene3d;

// 釣り状態マシン: idle | waiting | bite | fighting
let phase = "idle";
let waitTimer = null;
let biteTimer = null;
let fightState = null;
let isReeling = false;

function currentSave() {
  return activeSlotIndex >= 0 ? slots[activeSlotIndex] : null;
}

function updateEnvironmentUI() {
  env = getRealWorldEnv();
  scene3d?.applyEnvironment(env);
  $("live-clock").textContent = env.clockText;
  $("env-weather").textContent = `${env.weatherJa} / ${env.windJa}`;
  $("env-sea").textContent = `${env.waterTemp}℃ / ${env.tideName}`;
  $("env-market").textContent = `x${env.marketRate.toFixed(2)}`;
  $("hud-env-mini").textContent = `${env.weatherJa.split(" ")[0]} ${env.waterTemp}℃ ${env.tideName}`;
}

function renderSlots() {
  const wrap = $("slot-list");
  wrap.innerHTML = "";
  slots.forEach((s, idx) => {
    const item = document.createElement("div");
    item.className = "slot-item";
    if (s) {
      applyStaminaRegen(s);
      const dexCount = Object.keys(s.dex || {}).length;
      item.innerHTML = `
        <div class="slot-info">
          <strong>スロット${idx + 1}: ${s.name}</strong>
          <span>¥${s.money.toLocaleString()} / 図鑑 ${dexCount}種 / ⚡${s.stamina}</span>
        </div>
        <div class="slot-actions">
          <button class="btn-primary" data-play="${idx}">続きから</button>
          <button class="btn-danger" data-del="${idx}">削除</button>
        </div>
      `;
    } else {
      item.innerHTML = `
        <div class="slot-info">
          <strong>スロット${idx + 1}: 空きスロット</strong>
          <span>新しく漁師ライフを始める</span>
        </div>
        <div class="slot-actions">
          <button class="btn-primary" data-new="${idx}">新規作成</button>
        </div>
      `;
    }
    wrap.appendChild(item);
  });

  wrap.querySelectorAll("[data-play]").forEach((btn) => {
    btn.onclick = () => startSlot(Number(btn.dataset.play));
  });
  wrap.querySelectorAll("[data-new]").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.new);
      const name = prompt("漁師の名前を入力してください", `漁師${idx + 1}`) || `漁師${idx + 1}`;
      slots[idx] = createNewSave(name.slice(0, 12));
      persistSlots(slots, true);
      startSlot(idx);
    };
  });
  wrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.del);
      if (!confirm(`スロット${idx + 1}を削除しますか？`)) return;
      slots[idx] = null;
      persistSlots(slots, true);
      renderSlots();
    };
  });
}

async function renderRanking() {
  const ul = $("ranking-list");
  const list = await fetchDailyRanking();
  if (!list.length) {
    ul.innerHTML = `<li class="muted">まだ本日の記録がありません。1位を狙おう！</li>`;
    return;
  }
  ul.innerHTML = list.slice(0, 8).map((r, i) => `
    <li>
      <span><strong>#${i + 1}</strong> ${r.name}（${r.fishName}）</span>
      <strong>${r.weightKg}kg</strong>
    </li>
  `).join("");
}

function startSlot(idx) {
  activeSlotIndex = idx;
  const save = applyStaminaRegen(currentSave());
  save.lastPlayedAt = Date.now();
  $("area-select").value = save.area || "teibou";
  updateHud();
  $("home-screen").classList.remove("active");
  $("play-screen").classList.add("active");
  resetFishing();
}

function updateHud() {
  const save = currentSave();
  if (!save) return;
  applyStaminaRegen(save);
  $("hud-name").textContent = save.name;
  $("hud-money").textContent = `¥${save.money.toLocaleString()}`;
  $("hud-stamina").textContent = save.stamina;
  $("hud-cooler-count").textContent = save.cooler.length;
}

function resetFishing() {
  clearTimeout(waitTimer);
  clearTimeout(biteTimer);
  phase = "idle";
  fightState = null;
  isReeling = false;
  scene3d.setBobber(false);
  scene3d.setRodBend(0);
  $("fight-panel").classList.add("hidden");
  $("btn-main-action").className = "btn-action";
  $("btn-main-action").textContent = "🎣 キャスト";
  $("status-banner").textContent = "キャストボタンを押して釣り開始！";
}

function startCast() {
  const save = currentSave();
  if (!save) return;
  if (save.stamina < 2) {
    $("status-banner").textContent = "スタミナ不足です（3分で1回復します）";
    return;
  }
  save.stamina -= 2;
  save.lastPlayedAt = Date.now();
  persistSlots(slots, false);
  updateHud();

  phase = "waiting";
  const dist = 16 + Math.random() * 14;
  scene3d.setBobber(true, dist, 0);
  $("btn-main-action").textContent = "回収する";
  $("status-banner").textContent = "アタリを待っています...";

  const waitMs = 2000 + Math.random() * 3200;
  waitTimer = setTimeout(() => {
    if (phase !== "waiting") return;
    phase = "bite";
    scene3d.setBobber(true, dist, 0.35);
    $("btn-main-action").className = "btn-action bite";
    $("btn-main-action").textContent = "⚡ アワセる！";
    $("status-banner").textContent = "ヒット！！今すぐタップしてアワセろ！";

    biteTimer = setTimeout(() => {
      if (phase === "bite") {
        $("status-banner").textContent = "逃げられてしまった…";
        setTimeout(resetFishing, 900);
      }
    }, 1800);
  }, waitMs);
}

function startFight() {
  clearTimeout(biteTimer);
  const save = currentSave();
  const caught = rollCatch(save.area, env);

  phase = "fighting";
  fightState = {
    caught,
    distance: 20 + Math.random() * 10,
    fishStamina: 100,
    tension: 25
  };

  $("fight-panel").classList.remove("hidden");
  $("btn-main-action").className = "btn-action reeling";
  $("btn-main-action").textContent = "🔄 長押しで巻く";
  $("status-banner").textContent = `大物の手応え！ゲージが赤くなる前にドラグ調整！`;
}

function tickFight() {
  if (phase !== "fighting" || !fightState) return;
  const f = fightState;
  const sp = f.caught.species;
  const drag = Number($("drag-slider").value) / 100;
  $("drag-val").textContent = `${Math.round(drag * 100)}%`;

  const pull = (sp.pullPower || 2) * (0.45 + Math.random() * 0.55) * (f.fishStamina > 20 ? 1 : 0.45);
  if (isReeling) {
    f.tension += (drag * 6.5 + pull * 0.75) - 3.6;
    const gain = Math.max(0.08, (drag * 1.15) - (pull * 0.08));
    f.distance = Math.max(0, f.distance - gain * 0.45);
    f.fishStamina = Math.max(0, f.fishStamina - (0.7 + drag * 0.8));
  } else {
    f.tension = Math.max(8, f.tension - 4.8);
    if (f.fishStamina > 15) f.distance += (sp.speed || 2) * 0.035;
  }

  f.tension = Math.max(0, Math.min(105, f.tension));
  const rodPct = Math.min(100, f.tension * 0.96);
  const linePct = Math.min(100, f.tension);
  const reelPct = Math.min(100, f.tension * drag * 1.15);

  const colorFor = (v) => (v > 85 ? "#ff4d4d" : v > 62 ? "#ffd166" : "#38e59a");
  $("bar-rod").style.width = `${rodPct}%`;
  $("bar-rod").style.background = colorFor(rodPct);
  $("bar-line").style.width = `${linePct}%`;
  $("bar-line").style.background = colorFor(linePct);
  $("bar-reel").style.width = `${reelPct}%`;
  $("bar-reel").style.background = colorFor(reelPct);

  $("fight-distance").textContent = `距離: ${f.distance.toFixed(1)}m`;
  $("fight-fish-stamina").textContent = `魚体力: ${Math.round(f.fishStamina)}%`;

  scene3d.setBobber(true, f.distance, 0.25);
  scene3d.setRodBend(f.tension / 100);

  if (f.tension >= 100) {
    $("status-banner").textContent = "💥 ラインブレイク！ドラグを少し緩めよう";
    phase = "idle";
    setTimeout(resetFishing, 1300);
    return;
  }
  if (f.distance <= 0.4) {
    onCatchSuccess(f.caught);
  }
}

function onCatchSuccess(caught) {
  const save = currentSave();
  const sp = caught.species;

  save.cooler.push({
    id: sp.id,
    name: sp.name,
    rank: sp.rank,
    weightKg: caught.weightKg,
    tags: caught.tags,
    price: caught.estimatedPrice
  });

  if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
  save.dex[sp.id].count += 1;
  save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, caught.weightKg);
  save.stats.totalCaught += 1;
  save.lastPlayedAt = Date.now();

  persistSlots(slots, true);
  updateHud();
  submitDailyRecord({
    playerName: save.name,
    fishName: sp.name,
    weightKg: caught.weightKg,
    rank: sp.rank,
    condition: caught.tags[0] || ""
  });

  openModal(
    `🎉 ${sp.name}（ランク${sp.rank}）を釣り上げた！`,
    `
      <div><strong>重量:</strong> ${caught.weightKg} kg</div>
      <div><strong>査定額:</strong> ¥${caught.estimatedPrice.toLocaleString()}（本日相場 x${env.marketRate}）</div>
      <div>${caught.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
      <p class="muted">${sp.desc}</p>
      <p>${sp.tasteNote}</p>
      <button class="btn-primary" id="btn-catch-ok">クーラーにしまって続ける</button>
    `
  );
  $("btn-catch-ok").onclick = closeModal;
  resetFishing();
}

function openModal(title, html) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  $("modal-overlay").classList.add("hidden");
}

function openCoolerModal() {
  const save = currentSave();
  if (!save.cooler.length) {
    openModal("🧊 クーラーボックス", `<p class="muted">まだ魚が入っていません。</p>`);
    return;
  }
  const total = save.cooler.reduce((s, x) => s + x.price, 0);
  const rows = save.cooler.map((x) => `
    <div class="list-row">
      <div>
        <strong class="rank-${x.rank}">[${x.rank}] ${x.name}</strong> (${x.weightKg}kg)
        <div class="muted">${x.tags.join(" / ")}</div>
      </div>
      <strong>¥${x.price.toLocaleString()}</strong>
    </div>
  `).join("");

  openModal("🧊 クーラーボックス", `
    <button class="btn-primary" id="btn-sell-all">市場でまとめて売却（合計 ¥${total.toLocaleString()}）</button>
    ${rows}
  `);
  $("btn-sell-all").onclick = () => {
    save.money += total;
    save.stats.totalEarned += total;
    save.cooler = [];
    save.lastPlayedAt = Date.now();
    persistSlots(slots, true);
    updateHud();
    closeModal();
  };
}

function openDexModal() {
  const save = currentSave();
  const all = getAllSpecies();
  const caughtCount = Object.keys(save.dex || {}).length;
  const rows = all.map((sp) => {
    const rec = save.dex[sp.id];
    const badge = sp.speciesType === "shellfish" ? "🐚" : "🐟";
    return `
      <div class="list-row">
        <div>
          <strong class="rank-${sp.rank}">${badge} [${sp.rank}] ${rec ? sp.name : "？？？"}</strong>
          <div class="muted">${rec ? `${rec.count}匹 / 最大${rec.maxKg}kg` : `生息: ${sp.areas.join(", ")}`}</div>
        </div>
        <span class="muted">¥${sp.basePricePerKg}/kg</span>
      </div>
    `;
  }).join("");
  openModal(`📖 生き物図鑑 (${caughtCount}/${all.length}種)`, rows);
}

async function boot() {
  scene3d = new FishingScene($("scene-canvas"));
  updateEnvironmentUI();
  setInterval(updateEnvironmentUI, 30000);
  setInterval(tickFight, 60);

  await loadSpeciesMaster();
  await initFirebase({
    onOnlineCount: (n) => { $("online-count").textContent = n; },
    onStatus: (msg) => { $("sync-status").textContent = msg; }
  });

  slots = await syncLoadSlots();
  renderSlots();
  renderRanking();

  $("btn-refresh-rank").onclick = renderRanking;
  $("btn-back-home").onclick = () => {
    resetFishing();
    persistSlots(slots, true);
    $("play-screen").classList.remove("active");
    $("home-screen").classList.add("active");
    renderSlots();
    renderRanking();
  };
  $("area-select").onchange = (e) => {
    const save = currentSave();
    if (!save) return;
    save.area = e.target.value;
    persistSlots(slots, false);
    resetFishing();
  };
  $("btn-open-cooler").onclick = openCoolerModal;
  $("btn-open-dex").onclick = openDexModal;
  $("btn-close-modal").onclick = closeModal;

  const actBtn = $("btn-main-action");
  actBtn.addEventListener("pointerdown", () => {
    if (phase === "idle") startCast();
    else if (phase === "waiting") resetFishing();
    else if (phase === "bite") startFight();
    else if (phase === "fighting") isReeling = true;
  });
  window.addEventListener("pointerup", () => { isReeling = false; });
  window.addEventListener("pointercancel", () => { isReeling = false; });
}

boot();
