import {
  initFirebase, getCurrentUid, getJstDateKey, RANKING_BOARDS,
  fetchDailyRanking, submitDailyBoard,
  updateWorldPresence, clearWorldPresence, subscribeWorldPlayers,
  pushWorldFeed, subscribeWorldFeed
} from "./config/firebase.js";
import { getRealWorldEnv } from "./systems/environment.js";
import { audioEngine } from "./systems/audioEngine.js";
import { getAreaAt, isNearPier, drawMinimap, PIER_DOCK_POS } from "./systems/worldMap.js";
import {
  BOATS, FUEL_PRICE_PER_L, SHOP_ITEMS, PART_TIME_JOBS,
  getJobRankInfo, getActiveBoat, getBestBoatTier, getEquippedStats, applyBankInterest
} from "./systems/economy.js";
import { runJobMinigame, stopActiveJobGame } from "./systems/jobsMinigame.js";
import {
  BUSINESS_DEFS, FARM_EXPAND_PRICES, getPortLevel, isBusinessOpen,
  autoOmakaseStock, syncBusinessProgress, getFarmDurationMs, harvestFarmPlot, ensureDailyOrders
} from "./systems/business.js";
import { startShopView, stopShopView } from "./systems/shopView.js";
import { syncLoadSlots, persistSlots, createNewSave, ensureSaveDefaults } from "./state/saveManager.js";
import {
  loadSpeciesMaster, getAllSpecies, getSpeciesById, rollCatch, rollShellfish, rollNetHaul, getShellMethodForArea
} from "./systems/fishingEngine.js";
import { FishingScene } from "./scenes/fishingScene.js";

const $ = (id) => document.getElementById(id);

let slots = [];
let activeSlotIndex = -1;
let env = getRealWorldEnv();
let scene3d;

let harvestMode = "fish";
let phase = "idle";
let waitTimer = null;
let biteTimer = null;
let fightState = null;
let isReeling = false;
let fuelMoveAccum = 0;
let currentArea = null;
let shopTab = "rod_reel";
let activeBizTab = "fishmonger";

// Phase 5: 5部門ランキング＆マルチプレイ状態
let activeRankBoard = "biggest_weight";
let remotePlayersCache = {};
let myLastStamp = "";
let myLastStampTs = 0;
let tickerTimer = null;
const bootTime = Date.now();

function currentSave() { return activeSlotIndex >= 0 ? slots[activeSlotIndex] : null; }

function getSpeciesMap() {
  const map = new Map();
  getAllSpecies().forEach((s) => map.set(s.id, s));
  return map;
}

function recordDailyProgress(save, { caughtDelta = 0, earnedDelta = 0 } = {}) {
  const today = getJstDateKey();
  if (!save.dailyStats || save.dailyStats.dateKey !== today) {
    save.dailyStats = { dateKey: today, caughtCount: 0, earnedMoney: 0 };
  }
  if (caughtDelta > 0) {
    save.dailyStats.caughtCount += caughtDelta;
    submitDailyBoard("daily_count", {
      playerName: save.name,
      score: save.dailyStats.caughtCount,
      detail: `本日累計`
    });
  }
  if (earnedDelta > 0) {
    save.dailyStats.earnedMoney += earnedDelta;
    submitDailyBoard("daily_earned", {
      playerName: save.name,
      score: save.dailyStats.earnedMoney,
      detail: `本日の総売上`
    });
  }
}

function showLiveTicker(text) {
  const el = $("live-ticker");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(tickerTimer);
  tickerTimer = setTimeout(() => el.classList.add("hidden"), 9000);
}

function updateSoundIcons() {
  const icon = audioEngine.muted ? "🔇" : "🔊";
  $("btn-sound-home").textContent = icon;
  $("btn-sound-play").textContent = icon;
}

function updateEnvironmentUI() {
  env = getRealWorldEnv();
  scene3d?.applyEnvironment(env);
  audioEngine.updateEnvironment(env);
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
      ensureSaveDefaults(s);
      const dexCount = Object.keys(s.dex || {}).length;
      const boat = getActiveBoat(s);
      item.innerHTML = `
        <div class="slot-info">
          <strong>スロット${idx + 1}: ${s.name}</strong>
          <span>¥${s.money.toLocaleString()} / ${boat.name} / 図鑑${dexCount}種</span>
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
        <div class="slot-actions"><button class="btn-primary" data-new="${idx}">新規作成</button></div>
      `;
    }
    wrap.appendChild(item);
  });

  wrap.querySelectorAll("[data-play]").forEach((btn) => { btn.onclick = () => { audioEngine.unlock(); startSlot(Number(btn.dataset.play)); }; });
  wrap.querySelectorAll("[data-new]").forEach((btn) => {
    btn.onclick = () => {
      audioEngine.unlock();
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
      slots[idx] = null; persistSlots(slots, true); renderSlots();
    };
  });
}

// ===== 5部門ランキング描画（ホーム & モーダル共通） =====
function renderRankTabs(container, onChange) {
  container.innerHTML = RANKING_BOARDS.map((b) =>
    `<button class="rank-tab ${b.id === activeRankBoard ? "active" : ""}" data-board="${b.id}">${b.label}</button>`
  ).join("");
  container.querySelectorAll("[data-board]").forEach((btn) => {
    btn.onclick = () => {
      activeRankBoard = btn.dataset.board;
      onChange();
    };
  });
}

async function renderRankingInto(ulEl, limit = 8) {
  const board = RANKING_BOARDS.find((b) => b.id === activeRankBoard) || RANKING_BOARDS[0];
  ulEl.innerHTML = `<li class="muted">読み込み中...</li>`;
  const list = await fetchDailyRanking(board.id);
  const myUid = getCurrentUid();
  if (!list.length) {
    ulEl.innerHTML = `<li class="muted">まだ本日の「${board.label}」記録がありません。1位を狙おう！</li>`;
    return;
  }
  ulEl.innerHTML = list.slice(0, limit).map((r, i) => {
    const val = typeof r.score === "number" ? r.score : (r.weightKg || 0);
    const sub = r.detail || r.fishName || "";
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
    return `
      <li class="${r.uid === myUid ? "me" : ""}">
        <span><strong>${medal}</strong> ${r.name}${sub ? `（${sub}）` : ""}</span>
        <strong>${board.format(val)}</strong>
      </li>
    `;
  }).join("");
}

async function renderHomeRanking() {
  renderRankTabs($("home-rank-tabs"), renderHomeRanking);
  await renderRankingInto($("ranking-list"), 8);
}

async function openRankingModal() {
  openModal("🏆 今日のランキング（毎朝5:00リセット）", `
    <div id="modal-rank-tabs" class="rank-tabs"></div>
    <ol id="modal-rank-list" class="ranking-list"><li class="muted">読み込み中...</li></ol>
    <button class="btn-mini" id="rank-back-office" style="padding:8px;">← 事務所へ戻る</button>
  `);
  $("rank-back-office").onclick = openOfficeModal;
  renderRankTabs($("modal-rank-tabs"), openRankingModal);
  await renderRankingInto($("modal-rank-list"), 20);
}

function startSlot(idx) {
  activeSlotIndex = idx;
  const save = ensureSaveDefaults(currentSave());
  save.lastPlayedAt = Date.now();
  const boat = getActiveBoat(save);
  const canBoat = boat.tier > 0 && save.worldPos.isBoating;
  scene3d.setPlayerState({
    x: canBoat ? save.worldPos.x : Math.max(-150, Math.min(130, save.worldPos.x || 0)),
    z: canBoat ? Math.min(-12, save.worldPos.z) : Math.max(-2, save.worldPos.z || 4),
    yaw: save.worldPos.yaw || 0, isBoating: canBoat, boatSpeed: boat.speed || 1.2, boatTier: boat.tier
  });
  updateHud();
  syncWorldStatus();
  broadcastPresence();
  $("home-screen").classList.remove("active");
  $("play-screen").classList.add("active");
  resetActionState();
}

function broadcastPresence() {
  const save = currentSave();
  if (!save || !scene3d || activeSlotIndex < 0) return;
  updateWorldPresence({
    name: save.name,
    x: Number(scene3d.pos.x.toFixed(1)),
    z: Number(scene3d.pos.y.toFixed(1)),
    yaw: Number(scene3d.yaw.toFixed(2)),
    isBoating: scene3d.isBoating,
    status: phase,
    stamp: myLastStamp,
    stampTs: myLastStampTs
  });
}

function saveWorldPosition(syncCloud = false) {
  const save = currentSave();
  if (!save || !scene3d) return;
  save.worldPos = { x: Number(scene3d.pos.x.toFixed(1)), z: Number(scene3d.pos.y.toFixed(1)), yaw: Number(scene3d.yaw.toFixed(2)), isBoating: scene3d.isBoating };
  save.area = currentArea?.id || "teibou";
  persistSlots(slots, syncCloud);
}

function updateHud() {
  const save = currentSave();
  if (!save) return;
  ensureSaveDefaults(save);
  const hasOfficeNotif = syncBusinessProgress(save);
  const stats = getEquippedStats(save);
  const boat = getActiveBoat(save);

  $("hud-name").textContent = save.name;
  $("hud-money").textContent = `¥${save.money.toLocaleString()}`;
  $("hud-stamina").textContent = save.stamina;
  $("hud-cooler-count").textContent = `${save.cooler.length}/${stats.coolerCap}`;
  $("gear-power-hint").textContent = `(竿x${stats.rodPower} / リールx${stats.reelSpeed} / 糸x${stats.lineStrength})`;
  $("office-dot").classList.toggle("hidden", !hasOfficeNotif);

  const fuelPill = $("hud-fuel-pill");
  if (boat.maxFuel > 0) { fuelPill.classList.remove("hidden"); $("hud-fuel").textContent = Math.floor(save.fuel); }
  else fuelPill.classList.add("hidden");
}

function syncWorldStatus() {
  const save = currentSave();
  if (!save || !scene3d) return;
  const area = getAreaAt(scene3d.pos.x, scene3d.pos.y, scene3d.isBoating);
  const changed = !currentArea || currentArea.id !== area.id;
  currentArea = area;
  save.area = area.id;

  const modeLabel = scene3d.isBoating ? `🚤 ${getActiveBoat(save).name}` : "🚶 徒歩";
  $("hud-area-name").textContent = `📍 ${area.name}（${modeLabel}）`;
  $("sonar-bar").classList.toggle("hidden", !scene3d.isBoating);

  // 一緒に釣りボーナス判定（近くに他プレイヤーがいるか）
  const nearby = scene3d.getNearbyPlayers(35);
  const tBadge = $("together-badge");
  if (nearby.length > 0) {
    const names = nearby.slice(0, 2).map((p) => p.name).join("・");
    tBadge.textContent = `🤝 ${names}さんと一緒に釣り中！（レアUP＆査定+10%）`;
    tBadge.classList.remove("hidden");
  } else {
    tBadge.classList.add("hidden");
  }

  const near = isNearPier(scene3d.pos.x, scene3d.pos.y);
  const boardBtn = $("btn-board-toggle");
  if (near) {
    boardBtn.classList.remove("hidden");
    boardBtn.textContent = scene3d.isBoating ? "🚶 桟橋へ下船" : "🚤 船に乗る";
  } else boardBtn.classList.add("hidden");

  if (scene3d.isBoating) {
    const info = scene3d.getNearestHotspot();
    $("sonar-bar").classList.toggle("hotspot", info.inSpot);
    $("sonar-text").textContent = info.inSpot ? "🐟 魚群反応MAX！レア＆大漁ボーナス" : `📡 最寄り魚群まで ${Math.round(info.dist)}m`;
    $("btn-autopilot").textContent = scene3d.autopilot ? "⏹ 自動航行中" : "🧭 魚群へ自動航行";
  }

  drawMinimap($("minimap-canvas"), {
    px: scene3d.pos.x, pz: scene3d.pos.y, yaw: scene3d.yaw,
    isBoating: scene3d.isBoating, hotspots: scene3d.hotspots,
    remotePlayers: remotePlayersCache
  });
  if (changed) { syncHarvestTabs(); if (phase === "idle") resetActionState(); }
}

function tryConsumeFuel(amount) {
  const save = currentSave();
  if (!save || amount <= 0) return true;
  const boat = getActiveBoat(save);
  if (boat.maxFuel <= 0) return true;
  if (save.fuel >= amount) { save.fuel = Math.max(0, save.fuel - amount); return true; }
  if (save.autoRefuel) {
    const need = Math.ceil(boat.maxFuel - save.fuel), cost = need * FUEL_PRICE_PER_L;
    if (save.money >= cost) {
      save.money -= cost; save.fuel = boat.maxFuel - amount; audioEngine.playCash();
      $("status-banner").textContent = `⛽ 自動給油しました（-¥${cost.toLocaleString()}）`;
      updateHud(); return true;
    }
  }
  return false;
}

function syncHarvestTabs() {
  const areaId = currentArea?.id || "teibou";
  const shellMethod = getShellMethodForArea(areaId);
  const shellBtn = $("tab-mode-shell");
  if (shellMethod) { shellBtn.disabled = false; shellBtn.textContent = `🐚 ${shellMethod.label}`; }
  else { shellBtn.disabled = true; shellBtn.textContent = "🐚 貝なし"; if (harvestMode === "shell") harvestMode = "fish"; }
  $("tab-mode-fish").classList.toggle("active", harvestMode === "fish");
  shellBtn.classList.toggle("active", harvestMode === "shell");
  $("tab-mode-net").classList.toggle("active", harvestMode === "net");
  scene3d?.setMode(harvestMode);
}

function resetActionState() {
  clearTimeout(waitTimer); clearTimeout(biteTimer);
  phase = "idle"; fightState = null; isReeling = false;
  scene3d.setBobber(false); scene3d.setRodBend(0);
  $("fight-panel").classList.add("hidden");

  const save = currentSave(), areaId = currentArea?.id || "teibou", btn = $("btn-main-action");
  if (harvestMode === "shell" && save) {
    const m = getShellMethodForArea(areaId);
    btn.className = "btn-action shell"; btn.textContent = `🐚 ${m ? m.label : "貝採取"}（⚡3）`;
    $("status-banner").textContent = `${currentArea?.name || "海岸"}で${m ? m.label : "貝採取"}！`;
  } else if (harvestMode === "net" && save) {
    const { net } = getEquippedStats(save);
    btn.className = "btn-action net";
    btn.textContent = `🕸️ ${net.name}（⚡5${net.fuelCost ? `/⛽${net.fuelCost}L` : ""}）`;
    $("status-banner").textContent = "網漁で複数匹を一網打尽！";
  } else {
    const bait = save ? getEquippedStats(save).bait : null;
    btn.className = "btn-action"; btn.textContent = "🎣 キャスト（⚡2）";
    const baitTxt = bait && bait.pack > 0 ? ` / 餌:${bait.name.split(" ")[0]}(残${save.baitStock[bait.id] || 0})` : "";
    $("status-banner").textContent = `${currentArea?.name || "港"}で釣り待機中${baitTxt}`;
  }
}

function checkCoolerSpace(save, minNeed = 1) {
  const { coolerCap } = getEquippedStats(save);
  if (save.cooler.length + minNeed > coolerCap) {
    $("status-banner").textContent = `クーラー満タン（${save.cooler.length}/${coolerCap}）！売却か店へ仕込もう`;
    audioEngine.playFail(); return false;
  }
  return true;
}

function doNetHarvest() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  const { net, coolerCap } = getEquippedStats(save), areaId = currentArea?.id || "teibou";
  if (!scene3d.isBoating && net.method !== "toami" && net.method !== "kago") {
    $("status-banner").textContent = `${net.name}は船で沖へ出て使おう`; audioEngine.playFail(); return;
  }
  if (save.stamina < 5) { $("status-banner").textContent = "スタミナ不足です（⚡5必要）"; audioEngine.playFail(); return; }
  if (net.fuelCost > 0 && !tryConsumeFuel(net.fuelCost)) { $("status-banner").textContent = "⛽ 燃料不足！"; audioEngine.playFail(); return; }

  save.stamina -= 5; save.lastPlayedAt = Date.now(); audioEngine.playNetThrow();
  const inHotspot = scene3d.getNearestHotspot().inSpot;
  const together = scene3d.getNearbyPlayers(35).length > 0;
  const haul = rollNetHaul(areaId, env, net, inHotspot || together);
  if (!haul.length) { $("status-banner").textContent = "ここでは網に入らなかった…"; updateHud(); return; }

  const kept = haul.slice(0, Math.max(0, coolerCap - save.cooler.length));
  let totalPrice = 0;
  kept.forEach((item) => {
    const sp = item.species;
    const price = together ? Math.round(item.estimatedPrice * 1.1) : item.estimatedPrice;
    const tags = together ? [...item.tags, "一緒に釣り+10%"] : item.tags;
    item.estimatedPrice = price;
    item.tags = tags;

    save.cooler.push({ id: sp.id, name: sp.name, rank: sp.rank, weightKg: item.weightKg, tags, price });
    if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
    save.dex[sp.id].count += 1; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, item.weightKg);
    save.stats.totalCaught += 1; totalPrice += price;

    submitDailyBoard("biggest_weight", { playerName: save.name, score: item.weightKg, detail: sp.name });
    submitDailyBoard("highest_price", { playerName: save.name, score: price, detail: sp.name });
  });

  recordDailyProgress(save, { caughtDelta: kept.length });
  if (kept.length >= 4 || kept.some((x) => x.species.rank === "S")) {
    pushWorldFeed({ text: `🕸️ ${save.name}さんが ${net.name}で ${kept.length}匹 を大漁水揚げ！` });
  }
  if (inHotspot) scene3d.spawnWorldHotspots();
  saveWorldPosition(true); updateHud();
  audioEngine.playCatch(kept.some((x) => x.species.rank === "S" || x.species.rank === "A") ? "A" : "C");

  const rows = kept.map((x) => `<div class="list-row"><div><strong class="rank-${x.species.rank}">[${x.species.rank}] ${x.species.name}</strong> (${x.weightKg}kg)<div>${x.tags.map((t) => `<span class="tag ${t === "傷あり" ? "warn" : ""}">${t}</span>`).join("")}</div></div><strong>¥${x.estimatedPrice.toLocaleString()}</strong></div>`).join("");
  openModal(`🕸️ ${net.name}で ${kept.length}匹 を水揚げ！`, `<div><strong>合計査定:</strong> ¥${totalPrice.toLocaleString()} ${inHotspot ? '<span class="tag gold">🐟 魚群ボーナス</span>' : ""}</div>${rows}<button class="btn-primary" id="btn-net-ok">クーラーにしまう</button>`);
  $("btn-net-ok").onclick = closeModal;
  resetActionState();
}

function doShellHarvest() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  const areaId = currentArea?.id || "teibou";
  if (save.stamina < 3) { $("status-banner").textContent = "スタミナ不足です"; audioEngine.playFail(); return; }
  const m = getShellMethodForArea(areaId);
  if (areaId === "iso" && env.weather === "rough") { $("status-banner").textContent = "シケで磯が危険なため今日は磯採り不可！"; audioEngine.playFail(); return; }

  save.stamina -= 3; save.lastPlayedAt = Date.now(); audioEngine.playDig();
  const res = rollShellfish(areaId, env, getEquippedStats(save).shellBonus);
  if (!res) { $("status-banner").textContent = "ここでは貝が見つからなかった…"; updateHud(); return; }

  const sp = res.species;
  const together = scene3d.getNearbyPlayers(35).length > 0;
  const price = together ? Math.round(res.estimatedPrice * 1.1) : res.estimatedPrice;
  const tags = together ? [...res.tags, "一緒に釣り+10%"] : res.tags;

  save.cooler.push({ id: sp.id, name: `${sp.name}×${res.count}`, rank: sp.rank, weightKg: res.weightKg, tags, price });
  if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
  save.dex[sp.id].count += res.count; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, res.weightKg);
  save.stats.totalCaught += res.count;

  recordDailyProgress(save, { caughtDelta: res.count });
  submitDailyBoard("biggest_shell", { playerName: save.name, score: res.weightKg, detail: `${sp.name}×${res.count}` });
  submitDailyBoard("highest_price", { playerName: save.name, score: price, detail: `${sp.name}×${res.count}` });
  if (sp.rank === "S" || tags.includes("真珠入り")) {
    pushWorldFeed({ text: `🐚 ${save.name}さんが ${sp.name}（${tags.includes("真珠入り") ? "✨真珠入り!" : `${res.weightKg}kg`}）を採取！` });
  }

  saveWorldPosition(true); updateHud(); audioEngine.playCatch(sp.rank);

  openModal(`🐚 ${sp.name} ×${res.count}（ランク${sp.rank}）を採取！`, `
    <div><strong>合計重量:</strong> ${res.weightKg} kg（${m.label}）</div>
    <div><strong>査定額:</strong> ¥${price.toLocaleString()}</div>
    <div>${tags.map((t) => `<span class="tag ${t === "真珠入り" ? "gold" : ""}">${t}</span>`).join("")}</div>
    <p class="muted">${sp.desc}</p><p>${sp.tasteNote}</p>
    <button class="btn-primary" id="btn-catch-ok">クーラーにしまって続ける</button>
  `);
  $("btn-catch-ok").onclick = closeModal;
  resetActionState();
}

function startCast() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  if (save.stamina < 2) { $("status-banner").textContent = "スタミナ不足です"; audioEngine.playFail(); return; }
  const { bait, baitAttract } = getEquippedStats(save);
  if (bait.pack > 0 && save.baitStock[bait.id] > 0) save.baitStock[bait.id] -= 1;

  save.stamina -= 2; save.lastPlayedAt = Date.now(); persistSlots(slots, false); updateHud(); audioEngine.playCast();
  phase = "waiting";
  const dist = 16 + Math.random() * 14;
  scene3d.setBobber(true, dist, 0);
  $("btn-main-action").textContent = "回収する";
  const inSpot = scene3d.getNearestHotspot().inSpot;
  $("status-banner").textContent = inSpot ? "🐟 魚群ポイント！アタリが早そうだ..." : "アタリを待っています...";

  const waitMs = (1700 + Math.random() * 2700) * ((inSpot ? 0.65 : 1.0) / Math.sqrt(baitAttract));
  waitTimer = setTimeout(() => {
    if (phase !== "waiting") return;
    phase = "bite"; scene3d.setBobber(true, dist, 0.35); audioEngine.playBite();
    $("btn-main-action").className = "btn-action bite"; $("btn-main-action").textContent = "⚡ アワセる！";
    $("status-banner").textContent = "ヒット！！今すぐタップしてアワセろ！";
    biteTimer = setTimeout(() => { if (phase === "bite") { audioEngine.playFail(); $("status-banner").textContent = "逃げられてしまった…"; setTimeout(resetActionState, 900); } }, 1800);
  }, waitMs);
}

function startFight() {
  clearTimeout(biteTimer);
  const save = currentSave();
  const inSpot = scene3d.getNearestHotspot().inSpot;
  const together = scene3d.getNearbyPlayers(35).length > 0;
  const caught = rollCatch(currentArea?.id || "teibou", env, inSpot || together, getEquippedStats(save).baitAttract);
  if (together) {
    caught.estimatedPrice = Math.round(caught.estimatedPrice * 1.1);
    caught.tags.push("一緒に釣り+10%");
  }
  phase = "fighting";
  fightState = { caught, distance: 19 + Math.random() * 10, fishStamina: 100, tension: 24 };
  $("fight-panel").classList.remove("hidden");
  $("btn-main-action").className = "btn-action reeling"; $("btn-main-action").textContent = "🔄 長押しで巻く";
  $("status-banner").textContent = "ファイト中！ゲージが赤くなる前にドラグ調整！";
}

function tickFight() {
  if (phase !== "fighting" || !fightState) return;
  const save = currentSave(), { rodPower, reelSpeed, lineStrength } = getEquippedStats(save);
  const f = fightState, sp = f.caught.species, drag = Number($("drag-slider").value) / 100;
  $("drag-val").textContent = `${Math.round(drag * 100)}%`;

  const effectivePull = ((sp.pullPower || 2) * (0.45 + Math.random() * 0.55) * (f.fishStamina > 20 ? 1 : 0.45)) / lineStrength;
  if (isReeling) {
    audioEngine.playReelTick(f.tension);
    f.tension += (drag * 5.7 + effectivePull * 0.7) - (3.4 + rodPower * 0.42);
    f.distance = Math.max(0, f.distance - Math.max(0.12, (drag * 1.1 * rodPower * reelSpeed) - (effectivePull * 0.08)) * 0.44);
    f.fishStamina = Math.max(0, f.fishStamina - (0.75 + drag * 0.75 * rodPower));
  } else {
    f.tension = Math.max(8, f.tension - 5.0);
    if (f.fishStamina > 15) f.distance += ((sp.speed || 2) / rodPower) * 0.03;
  }

  f.tension = Math.max(0, Math.min(105, f.tension));
  const rodPct = Math.min(100, f.tension / Math.max(1, rodPower * 0.85)), linePct = Math.min(100, f.tension), reelPct = Math.min(100, f.tension * drag * 1.1);
  const colorFor = (v) => (v > 85 ? "#ff4d4d" : v > 62 ? "#ffd166" : "#38e59a");
  $("bar-rod").style.width = `${rodPct}%`; $("bar-rod").style.background = colorFor(rodPct);
  $("bar-line").style.width = `${linePct}%`; $("bar-line").style.background = colorFor(linePct);
  $("bar-reel").style.width = `${reelPct}%`; $("bar-reel").style.background = colorFor(reelPct);
  $("fight-distance").textContent = `距離: ${f.distance.toFixed(1)}m`;
  $("fight-fish-stamina").textContent = `魚体力: ${Math.round(f.fishStamina)}%`;
  scene3d.setBobber(true, f.distance, 0.25); scene3d.setRodBend(f.tension / 100);

  if (f.tension >= 100) { audioEngine.playFail(); $("status-banner").textContent = "💥 ラインブレイク！"; phase = "idle"; setTimeout(resetActionState, 1300); return; }
  if (f.distance <= 0.4) onCatchSuccess(f.caught);
}

function onCatchSuccess(caught) {
  const save = currentSave(), sp = caught.species;
  save.cooler.push({ id: sp.id, name: sp.name, rank: sp.rank, weightKg: caught.weightKg, tags: caught.tags, price: caught.estimatedPrice });
  if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
  save.dex[sp.id].count += 1; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, caught.weightKg);
  save.stats.totalCaught += 1; save.lastPlayedAt = Date.now();

  recordDailyProgress(save, { caughtDelta: 1 });
  submitDailyBoard("biggest_weight", { playerName: save.name, score: caught.weightKg, detail: sp.name });
  submitDailyBoard("highest_price", { playerName: save.name, score: caught.estimatedPrice, detail: sp.name });

  if (sp.rank === "S" || sp.rank === "A" || caught.tags.includes("トロフィー特大")) {
    pushWorldFeed({ text: `🎣 ${save.name}さんが [${sp.rank}]${sp.name}（${caught.weightKg}kg）を釣り上げた！` });
  }

  saveWorldPosition(true); updateHud(); audioEngine.playCatch(sp.rank);

  openModal(`🎉 ${sp.name}（ランク${sp.rank}）を釣り上げた！`, `
    <div><strong>重量:</strong> ${caught.weightKg} kg</div>
    <div><strong>査定額:</strong> ¥${caught.estimatedPrice.toLocaleString()}（相場 x${env.marketRate}）</div>
    <div>${caught.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    <p class="muted">${sp.desc}</p><p>${sp.tasteNote}</p>
    <button class="btn-primary" id="btn-catch-ok">クーラーにしまって続ける</button>
  `);
  $("btn-catch-ok").onclick = closeModal;
  resetActionState();
}

function openModal(title, html) {
  stopActiveJobGame();
  stopShopView();
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  stopActiveJobGame();
  stopShopView();
  $("modal-overlay").classList.add("hidden");
}

// ===== 事務所ハブ（5部門ランキングへの導線追加） =====
function openOfficeModal() {
  const save = currentSave();
  syncBusinessProgress(save);
  const { lv, rep } = getPortLevel(save.reputation);
  const dexAll = getAllSpecies().length;
  const dexGot = Object.keys(save.dex || {}).length;
  const pct = dexAll ? Math.round((dexGot / dexAll) * 100) : 0;

  const totalPending = BUSINESS_DEFS.reduce((s, d) => s + (save.businesses[d.id]?.pendingRevenue || 0), 0);
  const readyFarms = (save.farm?.plots || []).filter((p) => p && Date.now() >= p.readyAt).length;
  const otherCount = Object.keys(remotePlayersCache).length;

  openModal("🏢 港の事務所", `
    <div class="office-stats">
      <div><span class="muted">港の評価</span><strong>Lv ${lv}</strong></div>
      <div><span class="muted">評判</span><strong>${rep} pt</strong></div>
      <div><span class="muted">図鑑記録</span><strong>${dexGot}/${dexAll} (${pct}%)</strong></div>
      <div><span class="muted">同じ海の仲間</span><strong>${otherCount + 1} 人</strong></div>
    </div>
    <div class="office-grid">
      <button class="office-btn accent" id="off-biz">
        🏪 店舗経営
        <span>${totalPending > 0 ? `💰 未回収 ¥${totalPending.toLocaleString()}` : "魚屋・寿司・水族館"}</span>
      </button>
      <button class="office-btn" id="off-farm">
        🐟 養殖場
        <span>${readyFarms > 0 ? `✨ 収穫OK ${readyFarms}枠！` : `生け簀 ${save.farm.maxPlots}枠`}</span>
      </button>
      <button class="office-btn" id="off-bank">
        🏦 漁協バンク
        <span>預金 ¥${(save.bank?.ordinary || 0).toLocaleString()}</span>
      </button>
      <button class="office-btn" id="off-dex">
        📖 生き物図鑑
        <span>全${dexAll}種コレクション</span>
      </button>
      <button class="office-btn wide" id="off-rank">
        🏆 今日のランキング（全5部門）
        <span>大物・最高額・匹数・貝・売上王をチェック</span>
      </button>
    </div>
  `);

  $("off-biz").onclick = openBusinessModal;
  $("off-farm").onclick = openFarmModal;
  $("off-bank").onclick = openBankModal;
  $("off-dex").onclick = openDexModal;
  $("off-rank").onclick = openRankingModal;
}

// ===== 4業態店舗経営 =====
function openBusinessModal() {
  const save = currentSave();
  syncBusinessProgress(save);
  const def = BUSINESS_DEFS.find((b) => b.id === activeBizTab) || BUSINESS_DEFS[0];
  const st = save.businesses[def.id];
  const open = isBusinessOpen(st);
  const remainH = st.rentExpiresAt > Date.now() ? Math.ceil((st.rentExpiresAt - Date.now()) / 3600000) : 0;

  const tabsHtml = BUSINESS_DEFS.map((b) => {
    const bst = save.businesses[b.id];
    const mark = (bst?.pendingRevenue || 0) >= 500 ? "●" : "";
    return `<button class="shop-tab ${b.id === def.id ? "active" : ""}" data-biz-tab="${b.id}">${b.icon}${b.name.slice(0, 3)}${mark}</button>`;
  }).join("");

  let bodyHtml = "";
  if (!open) {
    bodyHtml = `
      <div class="bank-box">
        <strong>${def.icon} ${def.name}（未開業）</strong>
        <div class="muted">${def.desc}</div>
        <div class="btn-row" style="margin-top:4px;">
          <button class="btn-warn" id="biz-rent">1日賃貸 ¥${def.rentPrice.toLocaleString()}</button>
          <button class="btn-primary" id="biz-buy">店舗を購入 ¥${def.buyPrice.toLocaleString()}</button>
        </div>
      </div>
    `;
  } else {
    const statusBadge = st.owned ? `<span class="tag gold">所有店舗</span>` : `<span class="tag">賃貸中(残${remainH}h)</span>`;
    const totalPop = def.isAquarium ? st.stock.reduce((s, x) => s + (x.pop || 20), 0) : 0;
    const stockListHtml = st.stock.slice(0, 8).map((x) =>
      `<span class="tag">${x.name}${def.isAquarium ? `(人気${x.pop})` : `(¥${x.salePrice.toLocaleString()})`}</span>`
    ).join("") || `<span class="muted">まだ在庫がありません。「大将のおまかせ」で仕込もう！</span>`;

    bodyHtml = `
      <div class="shop-canvas-wrap">
        <canvas id="shop-view-canvas" width="420" height="175"></canvas>
        <div class="shop-view-overlay">
          <span>${def.icon} ${def.name}</span>
          <span>${def.isAquarium ? `人気度 ${totalPop} / 展示 ${st.stock.length}/${def.stockCap}` : `在庫 ${st.stock.length}/${def.stockCap}`}</span>
        </div>
      </div>
      <div class="bank-box">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>${statusBadge} 売上金庫: <strong style="color:#f3c687;">¥${st.pendingRevenue.toLocaleString()}</strong></div>
          <button class="btn-primary" id="biz-collect" ${st.pendingRevenue <= 0 ? "disabled" : ""}>💰 回収</button>
        </div>
        <div class="btn-row">
          <button class="btn-primary" id="biz-omakase" style="flex:1;">🍣 ${def.isAquarium ? "おまかせ展示" : "大将のおまかせ仕込み"}</button>
          <button class="btn-warn" id="biz-rush">⚡ ラッシュ営業(12秒)</button>
        </div>
        <div class="muted">クーラー内: ${save.cooler.length}点 / 累計売上: ¥${st.totalRevenue.toLocaleString()}</div>
        <div>${stockListHtml}</div>
      </div>
      ${!st.owned ? `<button class="btn-sub" id="biz-buy">この店舗を買い取る（¥${def.buyPrice.toLocaleString()}）</button>` : ""}
    `;
  }

  openModal(`🏪 店舗経営（所持 ¥${save.money.toLocaleString()}）`, `
    <div class="shop-tabs">${tabsHtml}</div>
    ${bodyHtml}
    <button class="btn-mini" id="biz-back-office" style="padding:8px;">← 事務所へ戻る</button>
  `);

  $("biz-back-office").onclick = openOfficeModal;
  $("modal-body").querySelectorAll("[data-biz-tab]").forEach((btn) => { btn.onclick = () => { activeBizTab = btn.dataset.bizTab; openBusinessModal(); }; });

  if ($("biz-rent")) {
    $("biz-rent").onclick = () => {
      if (save.money < def.rentPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= def.rentPrice; st.rentExpiresAt = Date.now() + 86400000; st.lastTickAt = Date.now();
      persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBusinessModal();
    };
  }
  if ($("biz-buy")) {
    $("biz-buy").onclick = () => {
      if (save.money < def.buyPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= def.buyPrice; st.owned = true; st.lastTickAt = Date.now(); save.reputation += 12;
      pushWorldFeed({ text: `🏪 ${save.name}さんが「${def.name}」のオーナーになった！` });
      persistSlots(slots, true); updateHud(); audioEngine.playCatch("S"); openBusinessModal();
    };
  }

  if (open) {
    const viewCtrl = startShopView($("shop-view-canvas"), {
      bizDef: def,
      bizState: st,
      onRushSale: () => {
        if (def.isAquarium) {
          const totalPop = st.stock.reduce((s, x) => s + (x.pop || 20), 0);
          if (totalPop <= 0) return 0;
          const ticket = Math.round(totalPop * 16 + 300);
          st.pendingRevenue += ticket; st.totalRevenue += ticket; save.reputation += 0.3;
          persistSlots(slots, false); return ticket;
        } else {
          if (!st.stock.length) return 0;
          const item = st.stock.shift();
          const rev = Math.round((item.salePrice || 500) * 1.15);
          st.pendingRevenue += rev; st.totalRevenue += rev; save.reputation += 0.6;
          persistSlots(slots, false); return rev;
        }
      }
    });

    $("biz-omakase").onclick = () => {
      const res = autoOmakaseStock(save, def.id, getSpeciesMap());
      if (res.moved > 0) { persistSlots(slots, true); updateHud(); audioEngine.playOk(); openBusinessModal(); }
      else { audioEngine.playFail(); alert(res.msg); }
    };
    $("biz-collect").onclick = () => {
      if (st.pendingRevenue <= 0) return;
      const rev = st.pendingRevenue;
      save.money += rev; save.stats.totalEarned += rev; st.pendingRevenue = 0;
      recordDailyProgress(save, { earnedDelta: rev });
      persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBusinessModal();
    };
    $("biz-rush").onclick = () => {
      if (!st.stock.length) { audioEngine.playFail(); alert("先に「おまかせ」でネタ（または展示魚）を投入しよう！"); return; }
      audioEngine.playOk(); viewCtrl.triggerRush();
      setTimeout(() => { if ($("shop-view-canvas")) openBusinessModal(); }, 12400);
    };
  }
}

// ===== サクサク養殖場 =====
function openFarmModal() {
  const save = currentSave(), farm = save.farm, now = Date.now();
  const farmable = getAllSpecies().filter((s) => s.farmHours > 0 && s.farmSeedPrice > 0);
  const nextExpandPrice = FARM_EXPAND_PRICES[farm.maxPlots] || 0;

  const plotCards = farm.plots.map((p, idx) => {
    if (!p) {
      return `<div class="bank-box"><strong>🌊 生け簀 #${idx + 1}（空き）</strong><div class="muted">稚魚・稚貝を投入して現実時間でサクサク育成！</div><button class="btn-primary" data-seed-slot="${idx}">🌱 稚魚・稚貝を仕入れる</button></div>`;
    }
    const sp = getSpeciesById(p.speciesId);
    const pct = Math.min(100, Math.round(((now - p.startedAt) / Math.max(1, p.readyAt - p.startedAt)) * 100));
    const remMin = Math.max(0, Math.ceil((p.readyAt - now) / 60000));
    const ready = now >= p.readyAt, isShell = sp?.speciesType === "shellfish";
    return `
      <div class="bank-box">
        <div style="display:flex;justify-content:space-between;">
          <strong>${isShell ? "🦪 垂下養殖" : "🐟 生け簀"} #${idx + 1}: ${sp ? sp.name : p.speciesId}</strong>
          <span class="tag ${ready ? "gold" : ""}">${ready ? "✨ 収穫OK！" : `残 ${remMin}分 (${pct}%)`}</span>
        </div>
        <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
        ${ready ? `<div class="btn-row" style="margin-top:4px;"><button class="btn-sub" data-harv-cooler="${idx}">🧊 クーラーへ収穫</button><button class="btn-primary" data-harv-sell="${idx}">💰 市場へ直送売却</button></div>`
          : `<div class="muted">${isShell ? "貝の垂下養殖はエサ不要で自動成長中" : "すくすく育成中（放置OK）"}</div>`}
      </div>
    `;
  }).join("");

  const expandHtml = farm.maxPlots < 6
    ? `<button class="btn-warn" id="farm-expand">➕ 生け簀を拡張（${farm.maxPlots} → ${farm.maxPlots + 1}枠 / ¥${nextExpandPrice.toLocaleString()}）</button>`
    : `<div class="muted" style="text-align:center;">最大規模（6枠）まで拡張済み！</div>`;

  openModal(`🐟 サクサク養殖場（所持 ¥${save.money.toLocaleString()}）`, `${plotCards}${expandHtml}<button class="btn-mini" id="farm-back-office" style="padding:8px;">← 事務所へ戻る</button>`);
  $("farm-back-office").onclick = openOfficeModal;
  if ($("farm-expand")) $("farm-expand").onclick = () => { if (save.money < nextExpandPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; } save.money -= nextExpandPrice; farm.maxPlots += 1; farm.plots.push(null); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openFarmModal(); };
  $("modal-body").querySelectorAll("[data-seed-slot]").forEach((btn) => { btn.onclick = () => openSeedPickerModal(Number(btn.dataset.seedSlot), farmable); });
  $("modal-body").querySelectorAll("[data-harv-cooler]").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.harvCooler); if (!checkCoolerSpace(save, 1)) return;
      const sp = getSpeciesById(farm.plots[idx].speciesId), res = harvestFarmPlot(save, idx, sp, env, false);
      if (res) { recordDailyProgress(save, { caughtDelta: res.count }); persistSlots(slots, true); updateHud(); audioEngine.playCatch(sp.rank); openFarmModal(); }
    };
  });
  $("modal-body").querySelectorAll("[data-harv-sell]").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.harvSell); const sp = getSpeciesById(farm.plots[idx].speciesId);
      const res = harvestFarmPlot(save, idx, sp, env, true);
      if (res) { recordDailyProgress(save, { caughtDelta: res.count, earnedDelta: res.price }); persistSlots(slots, true); updateHud(); audioEngine.playCash(); alert(`✨ ${res.name}×${res.count}を直送売却！（+¥${res.price.toLocaleString()}）`); openFarmModal(); }
    };
  });
}

function openSeedPickerModal(slotIdx, farmable) {
  const save = currentSave();
  const rows = farmable.sort((a, b) => a.farmSeedPrice - b.farmSeedPrice).map((sp) => {
    const mins = Math.round(getFarmDurationMs(sp) / 60000);
    return `<div class="list-row"><div><strong class="rank-${sp.rank}">[${sp.rank}] ${sp.name}</strong> <span class="tag">${sp.speciesType === "shellfish" ? "🦪垂下" : "🐟生け簀"}</span><div class="muted">育成時間: 約${mins}分 / 市場目安 ¥${sp.basePricePerKg}/kg</div></div><button class="btn-primary" data-pick-seed="${sp.id}">¥${sp.farmSeedPrice.toLocaleString()}</button></div>`;
  }).join("");
  openModal(`🌱 生け簀 #${slotIdx + 1} の種苗を選ぶ`, `${rows}<button class="btn-mini" id="seed-back" style="padding:8px;">← 養殖場へ戻る</button>`);
  $("seed-back").onclick = openFarmModal;
  $("modal-body").querySelectorAll("[data-pick-seed]").forEach((btn) => {
    btn.onclick = () => {
      const sp = getSpeciesById(btn.dataset.pickSeed);
      if (!sp || save.money < sp.farmSeedPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= sp.farmSeedPrice; const now = Date.now();
      save.farm.plots[slotIdx] = { speciesId: sp.id, startedAt: now, readyAt: now + getFarmDurationMs(sp) };
      persistSlots(slots, true); updateHud(); audioEngine.playCash(); openFarmModal();
    };
  });
}

// ===== 納品依頼掲示板 =====
function openOrdersModal() {
  const save = currentSave(), orders = ensureDailyOrders(save, getAllSpecies(), env.dayKey);
  const rows = orders.map((ord, idx) => {
    const haveCount = save.cooler.filter((x) => x.id === ord.speciesId).length, canDeliver = haveCount >= ord.qty;
    return `<div class="bank-box"><div style="display:flex;justify-content:space-between;align-items:center;"><span class="muted">🏢 ${ord.client}</span><strong style="color:#38e59a;">¥${ord.reward.toLocaleString()} +評判${ord.rep}</strong></div><div><strong class="rank-${ord.rank}">[${ord.rank}] ${ord.speciesName}</strong> を <strong>${ord.qty}点</strong> 納品</div><div class="muted">クーラー所持: ${haveCount} / ${ord.qty}</div><button class="btn-primary" data-deliver="${idx}" ${canDeliver ? "" : "disabled"}>${canDeliver ? "📦 納品して報酬を受け取る" : "対象がクーラーに足りません"}</button></div>`;
  }).join("");
  openModal("📋 港の納品依頼掲示板（市場より高単価！）", rows);

  $("modal-body").querySelectorAll("[data-deliver]").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.deliver), ord = save.orders[idx]; if (!ord) return;
      let left = ord.qty; const nextCooler = [];
      for (const item of save.cooler) { if (left > 0 && item.id === ord.speciesId) left--; else nextCooler.push(item); }
      if (left > 0) return;
      save.cooler = nextCooler; save.money += ord.reward; save.stats.totalEarned += ord.reward; save.reputation += ord.rep;
      recordDailyProgress(save, { earnedDelta: ord.reward });
      save.orders.splice(idx, 1); ensureDailyOrders(save, getAllSpecies(), env.dayKey);
      persistSlots(slots, true); updateHud(); audioEngine.playCatch("A"); openOrdersModal();
    };
  });
}

// ===== 船・道具ショップ・バイト・クーラー・銀行・図鑑 =====
function openDockModal() {
  const save = currentSave(), active = getActiveBoat(save);
  const remainH = save.rentalBoat ? Math.max(1, Math.ceil((save.rentalBoat.expiresAt - Date.now()) / 3600000)) : 0;
  const needFuel = Math.max(0, Math.ceil(active.maxFuel - save.fuel)), refuelCost = needFuel * FUEL_PRICE_PER_L;
  const fuelBox = active.maxFuel > 0 ? `<div class="bank-box"><strong>⛽ 燃料管理（現在 ${Math.floor(save.fuel)} / ${active.maxFuel} L）</strong><div class="btn-row"><button class="btn-primary" id="btn-refuel-full" ${needFuel <= 0 ? "disabled" : ""}>満タン給油（${needFuel}L / ¥${refuelCost.toLocaleString()}）</button><button class="btn-sub" id="btn-toggle-autorefuel">自動給油: ${save.autoRefuel ? "ON" : "OFF"}</button></div></div>` : "";
  const boatRows = BOATS.filter((b) => b.tier > 0).map((b) => {
    const owned = save.ownedBoats.includes(b.id), rented = save.rentalBoat && save.rentalBoat.boatId === b.id, isUsing = active.id === b.id;
    let actions = isUsing ? `<span class="tag gold">${owned ? "係留中(所有)" : `レンタル中(残${remainH}h)`}</span>`
      : (owned || rented) ? `<button class="btn-sub" data-use-boat="${b.id}">この船を使う</button>`
      : `<div class="btn-row"><button class="btn-warn" data-rent-boat="${b.id}">1日レンタル ¥${b.rentPrice.toLocaleString()}</button><button class="btn-primary" data-buy-boat="${b.id}">購入 ¥${b.buyPrice.toLocaleString()}</button></div>`;
    return `<div class="bank-box"><div><strong>🚤 ${b.name}</strong>（燃料 ${b.maxFuel}L / 速度x${b.speed}）</div><div class="muted">${b.desc}</div>${actions}</div>`;
  }).join("");
  openModal(`🚤 船ドック・レンタル（所持 ¥${save.money.toLocaleString()}）`, `${fuelBox}${boatRows}`);

  if ($("btn-refuel-full")) $("btn-refuel-full").onclick = () => { if (needFuel <= 0 || save.money < refuelCost) return; save.money -= refuelCost; save.fuel = active.maxFuel; persistSlots(slots, true); updateHud(); audioEngine.playCash(); openDockModal(); };
  if ($("btn-toggle-autorefuel")) $("btn-toggle-autorefuel").onclick = () => { save.autoRefuel = !save.autoRefuel; persistSlots(slots, true); openDockModal(); };
  $("modal-body").querySelectorAll("[data-rent-boat]").forEach((btn) => { btn.onclick = () => { const b = BOATS.find((x) => x.id === btn.dataset.rentBoat); if (!b || save.money < b.rentPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; } save.money -= b.rentPrice; save.rentalBoat = { boatId: b.id, expiresAt: Date.now() + 86400000 }; save.activeBoatId = b.id; save.fuel = b.maxFuel; scene3d.updateBoatSpec(b.speed, b.tier); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openDockModal(); }; });
  $("modal-body").querySelectorAll("[data-buy-boat]").forEach((btn) => { btn.onclick = () => { const b = BOATS.find((x) => x.id === btn.dataset.buyBoat); if (!b || save.money < b.buyPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; } save.money -= b.buyPrice; if (!save.ownedBoats.includes(b.id)) save.ownedBoats.push(b.id); save.activeBoatId = b.id; save.fuel = b.maxFuel; scene3d.updateBoatSpec(b.speed, b.tier); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openDockModal(); }; });
  $("modal-body").querySelectorAll("[data-use-boat]").forEach((btn) => { btn.onclick = () => { const b = BOATS.find((x) => x.id === btn.dataset.useBoat); if (!b) return; save.activeBoatId = b.id; save.fuel = Math.min(save.fuel || b.maxFuel, b.maxFuel); scene3d.updateBoatSpec(b.speed, b.tier); persistSlots(slots, true); updateHud(); openDockModal(); }; });
}

function openShopModal() {
  const save = currentSave(), list = SHOP_ITEMS.filter((x) => x.tab === shopTab);
  const cards = list.map((item) => {
    const isBaitPack = item.slot === "bait" && item.pack > 0, isBundle = item.slot === "bundle";
    const stock = isBaitPack ? (save.baitStock[item.id] || 0) : 0;
    const owned = isBundle ? item.items.every((id) => save.ownedGear.includes(id)) : isBaitPack ? stock > 0 : save.ownedGear.includes(item.id);
    const equipped = !isBundle && save.gear[item.slot] === item.id;
    let btnHtml = isBaitPack ? `<div class="btn-row"><button class="btn-primary" data-buy="${item.id}" style="flex:1;">買う ¥${item.price.toLocaleString()}</button>${stock > 0 && !equipped ? `<button class="btn-sub" data-equip="${item.id}">装備</button>` : ""}</div>`
      : equipped ? `<span class="tag gold">装備中</span>`
      : (owned && !isBundle) ? `<button class="btn-sub" data-equip="${item.id}">装備する</button>`
      : (owned && isBundle) ? `<span class="tag">購入済</span>`
      : `<button class="btn-primary" data-buy="${item.id}">買う ¥${item.price.toLocaleString()}</button>`;
    return `<div class="shop-card ${equipped ? "equipped" : ""}"><div><strong>${item.name}</strong>${isBaitPack ? ` <span class="tag">残${stock}</span>` : ""}<div class="muted" style="margin-top:3px;">${item.desc}</div></div>${btnHtml}</div>`;
  }).join("");

  openModal(`🏪 港ショップ（所持 ¥${save.money.toLocaleString()}）`, `
    <div class="shop-tabs">
      <button class="shop-tab ${shopTab === "rod_reel" ? "active" : ""}" data-tab="rod_reel">竿・リール</button>
      <button class="shop-tab ${shopTab === "gear_net" ? "active" : ""}" data-tab="gear_net">糸・箱・網</button>
      <button class="shop-tab ${shopTab === "bait" ? "active" : ""}" data-tab="bait">餌・仕掛け</button>
    </div>
    <div class="shop-grid">${cards}</div>
  `);
  $("modal-body").querySelectorAll("[data-tab]").forEach((btn) => { btn.onclick = () => { shopTab = btn.dataset.tab; openShopModal(); }; });
  $("modal-body").querySelectorAll("[data-buy]").forEach((btn) => {
    btn.onclick = () => {
      const item = SHOP_ITEMS.find((x) => x.id === btn.dataset.buy);
      if (!item || save.money < item.price) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= item.price;
      if (item.slot === "bundle") { item.items.forEach((id) => { const sub = SHOP_ITEMS.find((x) => x.id === id); if (sub) { if (!save.ownedGear.includes(id)) save.ownedGear.push(id); save.gear[sub.slot] = id; } }); }
      else if (item.slot === "bait" && item.pack > 0) { save.baitStock[item.id] = (save.baitStock[item.id] || 0) + item.pack; save.gear.bait = item.id; }
      else { if (!save.ownedGear.includes(item.id)) save.ownedGear.push(item.id); save.gear[item.slot] = item.id; }
      save.lastPlayedAt = Date.now(); persistSlots(slots, true); updateHud(); resetActionState(); audioEngine.playCash(); openShopModal();
    };
  });
  $("modal-body").querySelectorAll("[data-equip]").forEach((btn) => {
    btn.onclick = () => { const item = SHOP_ITEMS.find((x) => x.id === btn.dataset.equip); if (!item) return; save.gear[item.slot] = item.id; persistSlots(slots, true); updateHud(); resetActionState(); openShopModal(); };
  });
}

function openJobsModal() {
  const save = currentSave(), h = env.hour, jp = save.jobProfile || { totalClears: 0, streak: 0 }, rank = getJobRankInfo(jp.totalClears);
  const headerBox = `<div class="bank-box"><div><strong>🏅 ランク: ${rank.title}</strong>（報酬 x${rank.bonusMult.toFixed(2)} / 達成 ${jp.totalClears}回）</div><div class="muted">🔥 連勤コンボ: <strong>${jp.streak}回</strong>（+${Math.min(50, jp.streak * 10)}%）${rank.next ? ` / 次まであと ${rank.next - jp.totalClears}回` : " / 最高ランク！"}</div></div>`;
  const rows = PART_TIME_JOBS.map((job) => {
    const isBonus = job.bonusHours && job.bonusHours.includes(h);
    return `<div class="list-row"><div><strong>${job.icon} ${job.name}</strong> ${isBonus ? `<span class="tag gold">${job.bonusLabel}</span>` : ""}<div class="muted">${job.desc}</div><div class="muted">ノルマ: ${job.quotaText} / ⚡${job.stamina} / 基本¥${job.basePay.toLocaleString()}</div></div><button class="btn-primary" data-job="${job.id}">出勤</button></div>`;
  }).join("");
  openModal(`💼 港のバイト掲示板（全7種 / ⚡${save.stamina}）`, `${headerBox}${rows}`);

  $("modal-body").querySelectorAll("[data-job]").forEach((btn) => {
    btn.onclick = () => {
      const job = PART_TIME_JOBS.find((x) => x.id === btn.dataset.job);
      if (!job || save.stamina < job.stamina) { audioEngine.playFail(); alert("スタミナが足りません！"); return; }
      save.stamina -= job.stamina; persistSlots(slots, false); updateHud();
      $("modal-title").textContent = `${job.icon} 勤務中: ${job.name}`;
      runJobMinigame($("modal-body"), job, ({ passed, perfect, extraMult, detail }) => {
        const isBonus = job.bonusHours && job.bonusHours.includes(env.hour);
        let pay = 0, notes = [], drink = "";
        if (passed) {
          jp.totalClears += 1; jp.streak += 1;
          const rankNow = getJobRankInfo(jp.totalClears);
          pay = Math.round(job.basePay * rankNow.bonusMult * (1 + Math.min(0.5, (jp.streak - 1) * 0.1)) * (isBonus ? 1.2 : 1) * (perfect ? 1.3 : 1) * (1 + (extraMult || 0)));
          if (isBonus) notes.push(job.bonusLabel); if (perfect) notes.push("✨パーフェクト+30%"); if (jp.streak >= 2) notes.push(`🔥${jp.streak}連勤`);
          if (jp.streak % 5 === 0) { save.stamina = Math.min(100, save.stamina + 15); drink = "🥤 5連勤達成！栄養ドリンク支給（⚡+15）"; }
          save.reputation += 1.5; audioEngine.playCatch(perfect ? "S" : "B");
        } else { jp.streak = 0; pay = Math.round(job.basePay * 0.3); notes.push("ノルマ未達（見習い手当30%）"); audioEngine.playFail(); }
        save.jobProfile = jp; save.money += pay; save.stats.totalEarned += pay; save.lastPlayedAt = Date.now();
        recordDailyProgress(save, { earnedDelta: pay });
        persistSlots(slots, true); updateHud();
        $("modal-title").textContent = passed ? (perfect ? "🌟 ノルマ達成＆パーフェクト！" : "✅ ノルマ達成！") : "💦 ノルマ未達…";
        $("modal-body").innerHTML = `<div class="bank-box" style="text-align:center;"><div style="font-size:1.45rem;font-weight:800;color:#f3c687;">報酬 ¥${pay.toLocaleString()}</div><div class="muted">${detail}</div><div>${notes.map((b) => `<span class="tag gold">${b}</span>`).join("")}</div>${drink ? `<div style="color:#38e59a;font-weight:700;">${drink}</div>` : ""}</div><div class="btn-row"><button class="btn-primary" id="job-again" style="flex:1;">バイト一覧へ</button><button class="btn-sub" id="job-close" style="flex:1;">マップへ戻る</button></div>`;
        $("job-again").onclick = openJobsModal; $("job-close").onclick = closeModal;
      });
    };
  });
}

function openCoolerModal() {
  const save = currentSave(), { coolerCap } = getEquippedStats(save);
  if (!save.cooler.length) { openModal(`🧊 クーラーボックス (0/${coolerCap})`, `<p class="muted">まだ魚や貝が入っていません。</p>`); return; }
  const total = save.cooler.reduce((s, x) => s + x.price, 0);
  const rows = save.cooler.map((x) => `<div class="list-row"><div><strong class="rank-${x.rank}">[${x.rank}] ${x.name}</strong> (${x.weightKg}kg)<div class="muted">${x.tags.join(" / ")}</div></div><strong>¥${x.price.toLocaleString()}</strong></div>`).join("");
  openModal(`🧊 クーラーボックス (${save.cooler.length}/${coolerCap})`, `
    <div class="btn-row">
      <button class="btn-primary" id="btn-sell-all" style="flex:1;">市場で売却（¥${total.toLocaleString()}）</button>
      <button class="btn-sub" id="btn-go-biz">🏪 店舗へ仕込む</button>
    </div>
    ${rows}
  `);
  $("btn-go-biz").onclick = openBusinessModal;
  $("btn-sell-all").onclick = () => {
    save.money += total; save.stats.totalEarned += total; save.cooler = []; save.lastPlayedAt = Date.now();
    recordDailyProgress(save, { earnedDelta: total });
    persistSlots(slots, true); updateHud(); audioEngine.playCash(); closeModal();
  };
}

function openBankModal() {
  const save = currentSave(), bank = applyBankInterest(save);
  openModal("🏦 漁協バンク（ゆるめ快適設定）", `
    <div class="bank-box"><strong>💰 普通預金（日利 0.2% 自動複利）</strong><div>預金残高: <strong>¥${bank.ordinary.toLocaleString()}</strong> / 手持ち: ¥${save.money.toLocaleString()}</div><div class="btn-row"><button class="btn-sub" id="bank-dep-10k">1万円預ける</button><button class="btn-sub" id="bank-dep-all">全額預ける</button><button class="btn-primary" id="bank-wd-10k">1万円引出</button><button class="btn-primary" id="bank-wd-all">全額引出</button></div></div>
    <div class="bank-box"><strong>📄 漁協ローン（日利 0.3%・上限100万円）</strong><div>借入残高: <strong style="color:#ff7b7b;">¥${bank.loan.toLocaleString()}</strong></div><div class="btn-row"><button class="btn-primary" id="loan-borrow-50k">5万円借りる</button><button class="btn-primary" id="loan-borrow-200k">20万円借りる</button><button class="btn-sub" id="loan-repay-50k">5万円返済</button><button class="btn-sub" id="loan-repay-all">一括返済</button></div></div>
    <button class="btn-mini" id="bank-back-office" style="padding:8px;">← 事務所へ戻る</button>
  `);
  const done = () => { save.lastPlayedAt = Date.now(); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBankModal(); };
  $("bank-back-office").onclick = openOfficeModal;
  $("bank-dep-10k").onclick = () => { if (save.money >= 10000) { save.money -= 10000; bank.ordinary += 10000; done(); } };
  $("bank-dep-all").onclick = () => { if (save.money > 0) { bank.ordinary += save.money; save.money = 0; done(); } };
  $("bank-wd-10k").onclick = () => { const v = Math.min(10000, bank.ordinary); if (v > 0) { bank.ordinary -= v; save.money += v; done(); } };
  $("bank-wd-all").onclick = () => { if (bank.ordinary > 0) { save.money += bank.ordinary; bank.ordinary = 0; done(); } };
  $("loan-borrow-50k").onclick = () => { if (bank.loan + 50000 <= 1000000) { bank.loan += 50000; save.money += 50000; done(); } };
  $("loan-borrow-200k").onclick = () => { if (bank.loan + 200000 <= 1000000) { bank.loan += 200000; save.money += 200000; done(); } };
  $("loan-repay-50k").onclick = () => { const v = Math.min(50000, bank.loan, save.money); if (v > 0) { bank.loan -= v; save.money -= v; done(); } };
  $("loan-repay-all").onclick = () => { const v = Math.min(bank.loan, save.money); if (v > 0) { bank.loan -= v; save.money -= v; done(); } };
}

function openDexModal() {
  const save = currentSave(), all = getAllSpecies(), caughtCount = Object.keys(save.dex || {}).length;
  const rows = all.map((sp) => {
    const rec = save.dex[sp.id], badge = sp.speciesType === "shellfish" ? "🐚" : "🐟";
    return `<div class="list-row"><div><strong class="rank-${sp.rank}">${badge} [${sp.rank}] ${rec ? sp.name : "？？？"}</strong><div class="muted">${rec ? `${rec.count}匹 / 最大${rec.maxKg}kg` : `生息: ${sp.areas.join(", ")}`}</div></div><span class="muted">¥${sp.basePricePerKg}/kg</span></div>`;
  }).join("");
  openModal(`📖 生き物図鑑 (${caughtCount}/${all.length}種)`, `<button class="btn-mini" id="dex-back-office" style="padding:8px;">← 事務所へ戻る</button>${rows}`);
  $("dex-back-office").onclick = openOfficeModal;
}

function setupJoystick() {
  const base = $("joy-base"), knob = $("joy-knob");
  let activeId = null; const maxR = 36;
  const updateStick = (clientX, clientY) => {
    const r = base.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (phase === "idle") { scene3d.autopilot = false; scene3d.moveInput.x = dx / maxR; scene3d.moveInput.y = dy / maxR; }
  };
  const resetStick = () => { activeId = null; knob.style.transform = "translate(0px, 0px)"; scene3d.moveInput.x = 0; scene3d.moveInput.y = 0; };
  base.addEventListener("pointerdown", (e) => { audioEngine.unlock(); activeId = e.pointerId; base.setPointerCapture(e.pointerId); updateStick(e.clientX, e.clientY); });
  base.addEventListener("pointermove", (e) => { if (e.pointerId === activeId) updateStick(e.clientX, e.clientY); });
  base.addEventListener("pointerup", (e) => { if (e.pointerId === activeId) resetStick(); });
  base.addEventListener("pointercancel", resetStick);

  const keys = new Set();
  const syncKeys = () => {
    if (phase !== "idle") { scene3d.moveInput.x = 0; scene3d.moveInput.y = 0; return; }
    scene3d.moveInput.x = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    scene3d.moveInput.y = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  };
  window.addEventListener("keydown", (e) => { keys.add(e.code); syncKeys(); });
  window.addEventListener("keyup", (e) => { keys.delete(e.code); syncKeys(); });
}

async function boot() {
  scene3d = new FishingScene($("scene-canvas"));
  scene3d.onFuelConsume = (dist) => {
    audioEngine.playEnginePulse(); fuelMoveAccum += dist;
    if (fuelMoveAccum >= 18) {
      fuelMoveAccum -= 18;
      if (!tryConsumeFuel(1)) { $("status-banner").textContent = "⛽ ガス欠！「⚓港へ」で帰還か給油しよう"; audioEngine.playFail(); return false; }
      updateHud();
    }
    return true;
  };
  scene3d.onBlocked = (msg) => { $("status-banner").textContent = msg; audioEngine.playFail(); };

  setupJoystick();
  updateSoundIcons();
  updateEnvironmentUI();
  setInterval(updateEnvironmentUI, 30000);
  setInterval(tickFight, 60);
  setInterval(() => { if (activeSlotIndex >= 0) syncWorldStatus(); }, 180);
  setInterval(() => { if (activeSlotIndex >= 0) broadcastPresence(); }, 450);
  setInterval(() => { if (activeSlotIndex >= 0) updateHud(); }, 10000);

  window.addEventListener("pointerdown", () => audioEngine.unlock(), { once: true });
  await loadSpeciesMaster();
  await initFirebase({ onOnlineCount: (n) => { $("online-count").textContent = n; }, onStatus: (msg) => { $("sync-status").textContent = msg; } });

  // Phase 5: リアルタイム他プレイヤー＆ライブ速報の購読
  subscribeWorldPlayers((others) => {
    remotePlayersCache = others;
    scene3d.syncRemotePlayers(others);
  });
  subscribeWorldFeed((item) => {
    if (!item || (item.ts || 0) < bootTime - 25000) return;
    showLiveTicker(`📣 ${item.text}`);
  });

  slots = await syncLoadSlots();
  renderSlots();
  renderHomeRanking();

  $("btn-sound-home").onclick = () => { audioEngine.toggleMute(); updateSoundIcons(); };
  $("btn-sound-play").onclick = () => { audioEngine.toggleMute(); updateSoundIcons(); };
  $("btn-refresh-rank").onclick = renderHomeRanking;
  $("btn-back-home").onclick = () => {
    resetActionState();
    saveWorldPosition(true);
    clearWorldPresence();
    $("stamp-bar").classList.add("hidden");
    $("play-screen").classList.remove("active");
    $("home-screen").classList.add("active");
    renderSlots();
    renderHomeRanking();
  };

  // マルチスタンプ送信
  $("btn-stamp-toggle").onclick = () => {
    audioEngine.unlock();
    $("stamp-bar").classList.toggle("hidden");
  };
  document.querySelectorAll("[data-stamp]").forEach((btn) => {
    btn.onclick = () => {
      const save = currentSave();
      if (!save) return;
      myLastStamp = btn.dataset.stamp;
      myLastStampTs = Date.now();
      broadcastPresence();
      pushWorldFeed({ text: `${save.name}「${myLastStamp}」`, kind: "stamp" });
      showLiveTicker(`💬 あなた「${myLastStamp}」`);
      audioEngine.playOk();
      $("stamp-bar").classList.add("hidden");
    };
  });

  $("btn-board-toggle").onclick = () => {
    audioEngine.unlock();
    const save = currentSave(); if (!save) return;
    if (scene3d.isBoating) {
      scene3d.setPlayerState({ x: 0, z: -2, yaw: 0, isBoating: false, boatSpeed: getActiveBoat(save).speed, boatTier: getBestBoatTier(save) });
      $("status-banner").textContent = "🚶 桟橋へ下船しました！";
    } else {
      const boat = getActiveBoat(save);
      if (boat.tier <= 0) {
        audioEngine.playFail();
        if (confirm("まだ船を持っていません。船ドックでミニ和船をレンタル（¥4,500/日）しますか？")) openDockModal();
        return;
      }
      scene3d.setPlayerState({ x: 0, z: -18, yaw: 0, isBoating: true, boatSpeed: boat.speed, boatTier: boat.tier });
      $("status-banner").textContent = `🚤 ${boat.name}で出航！`;
    }
    saveWorldPosition(false); syncWorldStatus(); broadcastPresence(); resetActionState();
  };

  $("btn-return-port").onclick = () => {
    const save = currentSave(); if (!save) return;
    resetActionState();
    scene3d.setPlayerState({ x: PIER_DOCK_POS.x, z: 2, yaw: 0, isBoating: false, boatSpeed: getActiveBoat(save).speed, boatTier: getBestBoatTier(save) });
    saveWorldPosition(false); syncWorldStatus(); broadcastPresence();
    $("status-banner").textContent = "⚓ 港の桟橋へ帰還しました";
  };

  $("tab-mode-fish").onclick = () => { harvestMode = "fish"; syncHarvestTabs(); resetActionState(); };
  $("tab-mode-shell").onclick = () => { harvestMode = "shell"; syncHarvestTabs(); resetActionState(); };
  $("tab-mode-net").onclick = () => { harvestMode = "net"; syncHarvestTabs(); resetActionState(); };
  $("btn-autopilot").onclick = () => { audioEngine.unlock(); scene3d.toggleAutopilot(); };

  $("btn-open-cooler").onclick = openCoolerModal;
  $("btn-open-dock").onclick = openDockModal;
  $("btn-open-shop").onclick = openShopModal;
  $("btn-open-jobs").onclick = openJobsModal;
  $("btn-open-orders").onclick = openOrdersModal;
  $("btn-open-office").onclick = openOfficeModal;
  $("btn-close-modal").onclick = closeModal;

  const actBtn = $("btn-main-action");
  actBtn.addEventListener("pointerdown", () => {
    audioEngine.unlock();
    if (harvestMode === "shell") { doShellHarvest(); return; }
    if (harvestMode === "net") { doNetHarvest(); return; }
    if (phase === "idle") startCast();
    else if (phase === "waiting") resetActionState();
    else if (phase === "bite") startFight();
    else if (phase === "fighting") isReeling = true;
  });
  window.addEventListener("pointerup", () => { isReeling = false; });
  window.addEventListener("pointercancel", () => { isReeling = false; });
}

boot();
