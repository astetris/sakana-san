/* step-trace-boot-debug */
function __traceBoot(msg) {
  try {
    console.log("[BOOT]", msg);
    const clk = document.getElementById("live-clock");
    if (clk && clk.textContent.includes("読み込み中")) clk.textContent = msg;
    const st = document.getElementById("sync-status");
    if (st && st.textContent.includes("接続中")) st.textContent = msg;
  } catch {}
}
window.addEventListener("error", (ev) => {
});
window.addEventListener("unhandledrejection", (ev) => {
});


/* visible-mode-btn-and-error-guard */
window.addEventListener("error", (ev) => {
  const b = document.getElementById("status-banner");
  if (b && ev?.message) b.textContent = "⚠️ エラー: " + ev.message;
});
window.addEventListener("unhandledrejection", (ev) => {
  const b = document.getElementById("status-banner");
  if (b && ev?.reason) b.textContent = "⚠️ 通信/処理エラー: " + (ev.reason?.message || ev.reason);
});

import {
  initFirebase, getCurrentUid, getJstDateKey, RANKING_BOARDS, subscribePendingPurchases, clearPendingPurchase, getAuthAccountSummary, linkOrSignInGoogle, linkOrSignInEmail,
  fetchDailyRanking, submitDailyBoard,
  updateWorldPresence, clearWorldPresence, subscribeWorldPlayers,
  pushWorldFeed, subscribeWorldFeed,
  publishMyProfile, fetchPublicProfile,
  sendChatMessage, subscribeChatRoom,
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend,
  subscribeFriends, subscribeFriendRequests, consumeRedeemCode
} from "./config/firebase.js?v=20261128_042032";
import { getRealWorldEnv } from "./systems/environment.js?v=20261128_042032";
import { audioEngine } from "./systems/audioEngine.js?v=20261128_042032";
import { getAreaAt, isNearPier, drawMinimap, PIER_DOCK_POS } from "./systems/worldMap.js?v=20261128_042032";
import {
  BOATS, FUEL_PRICE_PER_L, SHOP_ITEMS, PART_TIME_JOBS,
  getJobRankInfo, getActiveBoat, getBestBoatTier, getEquippedStats, applyBankInterest
} from "./systems/economy.js?v=20261128_042032";
import { runJobMinigame, stopActiveJobGame } from "./systems/jobsMinigame.js?v=20261128_042032";
import {
  BUSINESS_DEFS, FARM_EXPAND_PRICES, getPortLevel, isBusinessOpen,
  autoOmakaseStock, syncBusinessProgress, getFarmDurationMs, harvestFarmPlot, ensureDailyOrders
} from "./systems/business.js?v=20261128_042032";
import { startShopView, stopShopView } from "./systems/shopView.js?v=20261128_042032";
import { CANTEEN_MENU, PROFILE_TITLES, getActiveBuff } from "./systems/social.js?v=20261128_042032";
import {
  getTotalPearls, isMonthlyPassActive, isWeeklyPassActive, canClaimAnyPass, checkFreePearlMilestones, grantMonthlyPass, grantWeeklyPass, PEARL_PACKS, MONTHLY_PASS_DEF, WEEKLY_PASS_DEF
} from "./systems/pearlShop.js?v=20261128_042032";
import { loadGachaBanners } from "./systems/gacha.js?v=20261128_042032";
import { openPearlShopUI, openGachaUI } from "./systems/phase7UI.js?v=20261128_042032";
import { verifyAdminAccess, openAdminPanel } from "./systems/adminPanel.js?v=20261128_042032";
import { syncLoadSlots, persistSlots, createNewSave, ensureSaveDefaults } from "./state/saveManager.js?v=20261128_042032";
import {
  loadSpeciesMaster, getAllSpecies, getSpeciesById, rollCatch, rollShellfish, rollNetHaul, getShellMethodForArea
} from "./systems/fishingEngine.js?v=20261128_042032";
import { FishingScene } from "./scenes/fishingScene.js?v=20261128_042032";

const $ = (id) => document.getElementById(id);

let slots = [];
let activeSlotIndex = -1;
let env = getRealWorldEnv();
let scene3d;

/* feature-pack-shell-net-sell-solo-multi */
let playMode = localStorage.getItem("sakana_play_mode") || "multi"; // "solo" | "multi"
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
let activeRankBoard = "biggest_weight";

// Phase 5 & 6 マルチ・チャット・フレンド・休憩所・課金状態
let remotePlayersCache = {};
let globalChatCache = [];
let loungeChatCache = [];
let friendsCache = {};
let friendReqsCache = {};
let activeChatTab = "global";   // global | lounge | friends
let activeLoungeTab = "canteen"; // canteen | rest
let activePearlTab = "buy";     // buy | use
let selectedPayMethod = "paypay";
let restTimer = null;
let activeModalType = null;

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

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function syncMyPublicProfile() {
  const save = currentSave();
  if (!save) return;
  const { lv } = getPortLevel(save.reputation);
  publishMyProfile({
    name: save.name,
    title: save.profile?.title || "見習い漁師",
    bio: save.profile?.bio || "",
    favSpecies: save.profile?.favSpecies || "マダイ",
    portLv: lv,
    dexCount: Object.keys(save.dex || {}).length,
    totalCaught: save.stats?.totalCaught || 0,
    isVip: isMonthlyPassActive(save)
  });
}

function recordDailyProgress(save, { caughtDelta = 0, earnedDelta = 0 } = {}) {
  const today = getJstDateKey();
  if (!save.dailyStats || save.dailyStats.dateKey !== today) {
    save.dailyStats = { dateKey: today, caughtCount: 0, earnedMoney: 0 };
  }
  if (caughtDelta > 0) {
    save.dailyStats.caughtCount += caughtDelta;
    submitDailyBoard("daily_count", { playerName: save.name, score: save.dailyStats.caughtCount, detail: "本日累計" });
  }
  if (earnedDelta > 0) {
    save.dailyStats.earnedMoney += earnedDelta;
    submitDailyBoard("daily_earned", { playerName: save.name, score: save.dailyStats.earnedMoney, detail: "本日の総売上" });
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
          <strong>スロット${idx + 1}: ${escapeHtml(s.name)}</strong>
          <span>¥${s.money.toLocaleString()} / 💎${getTotalPearls(s)} / ${boat.name} / 図鑑${dexCount}種</span>
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

function renderRankTabs(container, onChange) {
  container.innerHTML = RANKING_BOARDS.map((b) =>
    `<button class="rank-tab ${b.id === activeRankBoard ? "active" : ""}" data-board="${b.id}">${b.label}</button>`
  ).join("");
  container.querySelectorAll("[data-board]").forEach((btn) => {
    btn.onclick = () => { activeRankBoard = btn.dataset.board; onChange(); };
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
      <li class="${r.uid === myUid ? "me" : ""}" data-view-uid="${r.uid}" style="cursor:pointer;">
        <span><strong>${medal}</strong> ${escapeHtml(r.name)}${sub ? `（${escapeHtml(sub)}）` : ""}</span>
        <strong>${board.format(val)}</strong>
      </li>
    `;
  }).join("");
  ulEl.querySelectorAll("[data-view-uid]").forEach((li) => {
    li.onclick = () => { if (activeSlotIndex >= 0) openOtherProfileModal(li.dataset.viewUid); };
  });
}

async function renderHomeRanking() {
  renderRankTabs($("home-rank-tabs"), renderHomeRanking);
  await renderRankingInto($("ranking-list"), 8);
}

async function openRankingModal() {
  openModal("🏆 今日のランキング（毎朝5:00リセット）", `
    <div id="modal-rank-tabs" class="rank-tabs"></div>
    <ol id="modal-rank-list" class="ranking-list"><li class="muted">読み込み中...</li></ol>
    <div class="muted">※名前をタップするとプロフィールを見られます</div>
    <button class="btn-mini" id="rank-back-office" style="padding:8px;">← 事務所へ戻る</button>
  `);
  $("rank-back-office").onclick = openOfficeModal;
  renderRankTabs($("modal-rank-tabs"), openRankingModal);
  await renderRankingInto($("modal-rank-list"), 20);
}

function startSlot(idx) {
  activeSlotIndex = idx;
  setTimeout(() => processPendingPurchases(), 300);
  const save = ensureSaveDefaults(currentSave());
  save.lastPlayedAt = Date.now();
  const boat = getActiveBoat(save);
  const canBoat = boat.tier > 0 && save.worldPos.isBoating;
  scene3d.setPlayerState({
    x: canBoat ? save.worldPos.x : Math.max(-150, Math.min(130, save.worldPos.x || 0)),
    z: canBoat ? Math.min(-12, save.worldPos.z) : Math.max(-2, save.worldPos.z || 4),
    yaw: save.worldPos.yaw || 0, isBoating: canBoat, boatSpeed: boat.speed || 1.2, boatTier: boat.tier
  });
  syncMyPublicProfile();
  updateHud();
  syncWorldStatus();
  broadcastPresence();
  $("home-screen").classList.remove("active");
  $("play-screen").classList.add("active");
  resetActionState();

  // 月額パスの毎日ログイン受け取り通知
  if (canClaimAnyPass(save)) {
    showLiveTicker("🎁 パスの毎日ログイン報酬（💠無償真珠＆¥）が受け取れます！右上の💎から受取ろう");
  }
}

function broadcastPresence() {
  const save = currentSave();
  if (!save || !scene3d || activeSlotIndex < 0) return;
  updateWorldPresence({
    name: save.name,
    title: save.profile?.title || "見習い漁師",
    x: Number(scene3d.pos.x.toFixed(1)),
    z: Number(scene3d.pos.y.toFixed(1)),
    yaw: Number(scene3d.yaw.toFixed(2)),
    isBoating: scene3d.isBoating,
    status: activeModalType === "lounge_rest" ? "resting" : phase,
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
  const hasOfficeNotif = syncBusinessProgress(save) || Object.keys(friendReqsCache).length > 0;
  const stats = getEquippedStats(save);
  const boat = getActiveBoat(save);

  $("hud-name").textContent = `${isMonthlyPassActive(save) ? "🌙" : ""}${save.name}`;
  $("hud-money").textContent = `¥${save.money.toLocaleString()}`;
  $("hud-pearls").textContent = getTotalPearls(save).toLocaleString();
  $("hud-stamina").textContent = save.stamina;
  $("hud-cooler-count").textContent = `${save.cooler.length}/${stats.coolerCap}`;
  ensurePlayModeButton();
  $("gear-power-hint").textContent = `(竿x${stats.rodPower} / リールx${stats.reelSpeed} / 糸x${stats.lineStrength})`;
  $("office-dot").classList.toggle("hidden", !hasOfficeNotif);

  const buff = getActiveBuff(save);
  const bEl = $("buff-badge");
  if (buff) { bEl.textContent = buff.text; bEl.classList.remove("hidden"); }
  else bEl.classList.add("hidden");

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

  const nearby = playMode === "multi" ? scene3d.getNearbyPlayers(35) : [];
  const tBadge = $("together-badge");
  if (nearby.length > 0) {
    const names = nearby.slice(0, 2).map((p) => p.name).join("・");
    tBadge.textContent = `🤝 ${names}さんと一緒に釣り中！（レアUP＆査定+10%）`;
    tBadge.classList.remove("hidden");
  } else tBadge.classList.add("hidden");

  const near = isNearPier(scene3d.pos.x, scene3d.pos.y);
  const boardBtn = $("btn-board-toggle");
  if (near) {
    boardBtn.classList.remove("hidden");
    boardBtn.textContent = scene3d.isBoating ? "🚶 下船" : "🚤 乗船";
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
  if (!save || phase !== "idle") return;
  const { coolerCap } = getEquippedStats(save);
  if (save.cooler.length >= coolerCap) { $("status-banner").textContent = "🧊 クーラーボックスがいっぱいです！"; audioEngine.playFail(); return; }
  const { net } = getEquippedStats(save);
  if (!net || net.tier <= 0) { $("status-banner").textContent = "🕸️ 網を持っていません！🏪道具屋で買おう"; audioEngine.playFail(); return; }
  if (save.stamina < 5) { $("status-banner").textContent = "⚡ スタミナ不足（網漁は⚡5必要）！"; audioEngine.playFail(); return; }

  save.stamina -= 5;
  save.lastPlayedAt = Date.now();
  audioEngine.playNetThrow();
  updateHud();

  runNetThrowMiniGame({
    title: `🕸️ 投網＆引き上げ勝負（${net.name}）`,
    net,
    onFinish: (quality) => {
      if (quality === "miss") {
        $("status-banner").textContent = "💨 タイミングが合わず網から逃げられてしまった…";
        audioEngine.playFail();
        persistSlots(slots, false);
        updateHud();
        return;
      }
      const areaId = currentArea?.id || "teibou";
      const inHotspot = scene3d.getNearestHotspot().inSpot;
      const together = playMode === "multi" && scene3d.getNearbyPlayers(35).length > 0;
      const buff = getActiveBuff(save);
      const haul = rollNetHaul(areaId, env, net, inHotspot || together || buff?.rareBonus || quality === "great");
      if (!haul.length) { $("status-banner").textContent = "ここでは網に入らなかった…"; updateHud(); return; }

      const kept = haul.slice(0, Math.max(0, coolerCap - save.cooler.length));
      const qMult = quality === "great" ? 1.2 : 1.0;
      let totalPrice = 0;
      kept.forEach((item) => {
        const sp = item.species;
        let mult = (together ? 1.1 : 1) * (buff?.priceMult || 1) * (isMonthlyPassActive(save) ? 1.1 : 1) * qMult;
        const price = Math.round(item.estimatedPrice * mult);
        const tags = [...item.tags];
        if (together) tags.push("一緒に釣り+10%");
        if (quality === "great") tags.push("完璧引き上げ+20%");
        item.estimatedPrice = price; item.tags = tags;

        save.cooler.push({ id: sp.id, name: sp.name, rank: sp.rank, weightKg: item.weightKg, tags, price });
        if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
        save.dex[sp.id].count += 1; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, item.weightKg);
        save.stats.totalCaught += 1; totalPrice += price;
        submitDailyBoard("biggest_weight", { playerName: save.name, score: item.weightKg, detail: sp.name });
        submitDailyBoard("highest_price", { playerName: save.name, score: price, detail: sp.name });
      });

      recordDailyProgress(save, { caughtDelta: kept.length });
      syncMyPublicProfile();
      if (playMode === "multi" && (kept.length >= 4 || kept.some((x) => x.species.rank === "S"))) {
        pushWorldFeed({ text: `🕸️ ${save.name}さんが ${net.name}で ${kept.length}匹 を大漁水揚げ！` });
      }
      audioEngine.playCatch(kept.some((x) => x.species.rank === "S") ? "S" : "A");
      $("status-banner").textContent = `🕸️ ${kept.length}匹 水揚げ！（合計 ¥${totalPrice.toLocaleString()}）`;
      persistSlots(slots, true);
      updateHud();
    }
  });
}

function doShellHarvest() {
  const save = currentSave();
  if (!save || phase !== "idle") return;
  const { coolerCap } = getEquippedStats(save);
  if (save.cooler.length >= coolerCap) { $("status-banner").textContent = "🧊 クーラーボックスがいっぱいです！"; audioEngine.playFail(); return; }
  if (save.stamina < 3) { $("status-banner").textContent = "⚡ スタミナ不足（貝採取は⚡3必要）！"; audioEngine.playFail(); return; }

  const areaId = currentArea?.id || "teibou";
  const methodLabel = getShellMethodForArea(areaId);
  save.stamina -= 3;
  save.lastPlayedAt = Date.now();
  audioEngine.playDig();
  updateHud();

  runShellDigMiniGame({
    title: `🐚 ${methodLabel}チャレンジ`,
    methodLabel,
    onFinish: (quality) => {
      if (quality === "miss") {
        $("status-banner").textContent = "🐚 貝が深く潜ってしまい採取できなかった…";
        audioEngine.playFail();
        persistSlots(slots, false);
        updateHud();
        return;
      }
      const buff = getActiveBuff(save);
      const qBonus = quality === "great" ? 1.35 : 1.0;
      const res = rollShellfish(areaId, env, (getEquippedStats(save).shellBonus || 1) * (buff?.rareBonus ? 1.25 : 1) * qBonus);
      if (!res) { $("status-banner").textContent = "ここでは貝が見つからなかった…"; updateHud(); return; }

      const sp = res.species;
      const together = playMode === "multi" && scene3d.getNearbyPlayers(35).length > 0;
      const price = Math.round(res.estimatedPrice * (together ? 1.1 : 1) * (buff?.priceMult || 1) * (isMonthlyPassActive(save) ? 1.1 : 1) * (quality === "great" ? 1.15 : 1));
      const tags = [...res.tags];
      if (together) tags.push("一緒に釣り+10%");
      if (quality === "great") tags.push("ジャスト採取+15%");

      save.cooler.push({ id: sp.id, name: `${sp.name}×${res.count}`, rank: sp.rank, weightKg: res.weightKg, tags, price });
      if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
      save.dex[sp.id].count += res.count; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, res.weightKg);
      save.stats.totalCaught += res.count;

      recordDailyProgress(save, { caughtDelta: res.count });
      syncMyPublicProfile();
      submitDailyBoard("biggest_shell", { playerName: save.name, score: res.weightKg, detail: `${sp.name}×${res.count}` });
      submitDailyBoard("highest_price", { playerName: save.name, score: price, detail: `${sp.name}×${res.count}` });
      if (playMode === "multi" && (sp.rank === "S" || tags.includes("真珠入り"))) {
        pushWorldFeed({ text: `🐚 ${save.name}さんが ${sp.name}（${tags.includes("真珠入り") ? "✨真珠入り!" : `${res.weightKg}kg`}）を採取！` });
      }
      audioEngine.playCatch(sp.rank === "S" ? "S" : "B");
      $("status-banner").textContent = `🐚 ${sp.name}×${res.count} を採取！（¥${price.toLocaleString()}）`;
      persistSlots(slots, true);
      updateHud();
    }
  });
}

function startCast() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  if (save.stamina < 2) { $("status-banner").textContent = "スタミナ不足です（🍜憩いの食堂や休憩所で回復！）"; audioEngine.playFail(); return; }
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
  const buff = getActiveBuff(save);
  const caught = rollCatch(currentArea?.id || "teibou", env, inSpot || together || buff?.rareBonus, getEquippedStats(save).baitAttract);
  const mult = (together ? 1.1 : 1) * (buff?.priceMult || 1) * (isMonthlyPassActive(save) ? 1.1 : 1);
  if (mult > 1) caught.estimatedPrice = Math.round(caught.estimatedPrice * mult);
  if (together) caught.tags.push("一緒に釣り+10%");

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
  const ms = checkFreePearlMilestones(save); if (ms.length) showLiveTicker(`🎉 実績報酬: ${ms.join(' / ')}`);
  syncMyPublicProfile();
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

function stopLoungeRest() {
  if (restTimer) { clearInterval(restTimer); restTimer = null; }
}

function openModal(title, html, modalType = null) {
  stopActiveJobGame();
  stopShopView();
  stopLoungeRest();
  activeModalType = modalType;
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  stopActiveJobGame();
  stopShopView();
  stopLoungeRest();
  activeModalType = null;
  $("modal-overlay").classList.add("hidden");
}

// ===== Phase 6: 港の食堂 ＆ 休憩所（憩いの場） =====
function openLoungeModal() {
  const save = currentSave();
  const vipSpeed = isMonthlyPassActive(save); const weekSpeed = isWeeklyPassActive(save);
  const tabsHtml = `
    <div class="shop-tabs">
      <button class="shop-tab ${activeLoungeTab === "canteen" ? "active" : ""}" data-ltab="canteen">🍜 港の食堂（料理）</button>
      <button class="shop-tab ${activeLoungeTab === "rest" ? "active" : ""}" data-ltab="rest">♨️ 憩いの場（休憩＆交流）</button>
    </div>
  `;

  if (activeLoungeTab === "canteen") {
    const buff = getActiveBuff(save);
    const rows = CANTEEN_MENU.map((m) => `
      <div class="list-row">
        <div>
          <strong>${m.icon} ${m.name}</strong>
          <div class="muted">${m.desc}</div>
        </div>
        <button class="btn-primary" data-eat="${m.id}">¥${m.price.toLocaleString()}</button>
      </div>
    `).join("");

    openModal(`🍜 港の食堂（⚡${save.stamina}/100 / ¥${save.money.toLocaleString()}）`, `
      ${tabsHtml}
      ${buff ? `<div class="bank-box"><strong>発動中バフ:</strong> ${buff.text}</div>` : ""}
      ${rows}
    `, "lounge_canteen");

    $("modal-body").querySelectorAll("[data-eat]").forEach((btn) => {
      btn.onclick = () => {
        const m = CANTEEN_MENU.find((x) => x.id === btn.dataset.eat);
        if (!m) return;
        if (save.money < m.price) { audioEngine.playFail(); alert("お金が足りません！憩いの場で無料休憩もできます。"); return; }
        save.money -= m.price;
        save.stamina = Math.min(100, save.stamina + m.heal);
        if (m.buff) {
          save.mealBuff = { label: m.buff.label, priceMult: m.buff.priceMult, rareBonus: m.buff.rareBonus, expiresAt: Date.now() + m.buff.mins * 60000 };
        }
        save.lastPlayedAt = Date.now();
        persistSlots(slots, true); updateHud(); audioEngine.playCatch("B");
        openLoungeModal();
      };
    });
  } else {
    // 休憩所（憩いの場）：滞在中に体力が自動回復＋憩いの場チャット＋同席プレイヤー
    const onlineOthers = Object.entries(remotePlayersCache);
    const guestPills = onlineOthers.length
      ? onlineOthers.map(([uid, p]) => `<button class="btn-sub" data-prof="${uid}">${p.status === "resting" ? "♨️" : "🎣"} ${escapeHtml(p.name)}</button>`).join("")
      : `<span class="muted">今はあなたが一番乗り！全体チャットも使えます。</span>`;

    openModal("♨️ 港の休憩所『憩いの場』", `
      ${tabsHtml}
      <div class="bank-box">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>☕ ゆったり休憩中… ⚡<span id="rest-sta">${save.stamina}</span>/100</strong>
          <span class="tag">${vipSpeed ? "🌙月パス2倍回復" : weekSpeed ? "🌤️週パス1.5倍回復" : "5秒ごとに⚡+1"}</span>
        </div>
        <div class="muted">お茶を飲みながら他の漁師さんとチャット交流！タップでプロフ閲覧・フレ申OK</div>
        <div class="btn-row">${guestPills}</div>
      </div>
      <div id="lounge-chat-box" class="chat-box"></div>
      <div class="chat-input-row">
        <input id="lounge-chat-input" class="field-input" maxlength="120" placeholder="憩いの場チャットにメッセージ..." />
        <button id="lounge-chat-send" class="btn-primary">送信</button>
      </div>
    `, "lounge_rest");

    paintChatInto($("lounge-chat-box"), loungeChatCache);
    const send = async () => {
      const inp = $("lounge-chat-input");
      if (!inp || !inp.value.trim()) return;
      const txt = inp.value; inp.value = "";
      await sendChatMessage("lounge", { name: save.name, title: save.profile?.title, text: txt });
      audioEngine.playOk();
    };
    $("lounge-chat-send").onclick = send;
    $("lounge-chat-input").onkeydown = (e) => { if (e.key === "Enter") send(); };
    $("modal-body").querySelectorAll("[data-prof]").forEach((b) => { b.onclick = () => openOtherProfileModal(b.dataset.prof); });

    // 滞在中の自動体力回復ループ（通常5秒で+1、月額パス加入中は2.5秒で+1）
    restTimer = setInterval(() => {
      if (save.stamina < 100) {
        save.stamina = Math.min(100, save.stamina + 1);
        persistSlots(slots, false);
        updateHud();
        const el = $("rest-sta"); if (el) el.textContent = save.stamina;
      }
    }, vipSpeed ? 2500 : weekSpeed ? 3333 : 5000);
  }

  $("modal-body").querySelectorAll("[data-ltab]").forEach((btn) => {
    btn.onclick = () => { activeLoungeTab = btn.dataset.ltab; openLoungeModal(); };
  });
}

// ===== Phase 6: どこでもチャット＆フレンドモーダル =====
function paintChatInto(boxEl, messages) {
  if (!boxEl) return;
  if (!messages.length) {
    boxEl.innerHTML = `<div class="muted">まだ発言がありません。挨拶してみよう！</div>`;
    return;
  }
  boxEl.innerHTML = messages.map((m) => {
    const t = new Date(m.ts || Date.now());
    const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    return `
      <div class="chat-msg">
        <span class="chat-author" data-chat-uid="${m.uid}">${escapeHtml(m.name)}</span>
        ${m.title ? `<span class="tag">${escapeHtml(m.title)}</span>` : ""}
        <span class="muted">${hm}</span>
        <div>${escapeHtml(m.text)}</div>
      </div>
    `;
  }).join("");
  boxEl.scrollTop = boxEl.scrollHeight;
  boxEl.querySelectorAll("[data-chat-uid]").forEach((el) => {
    el.onclick = () => openOtherProfileModal(el.dataset.chatUid);
  });
}

function openChatAndFriendsModal() {
  const save = currentSave();
  if (activeChatTab === "lounge") activeChatTab = "global";
  const reqCount = Object.keys(friendReqsCache).length;
  const tabsHtml = `
    <div class="shop-tabs">
      <button class="shop-tab ${activeChatTab === "global" ? "active" : ""}" data-ctab="global">🌊 全体チャット</button>
      <button class="shop-tab ${activeChatTab === "friends" ? "active" : ""}" data-ctab="friends">🤝 フレンド${reqCount ? `(${reqCount})` : ""}</button>
    </div>
  `;

  if (activeChatTab === "friends") {
    const reqList = Object.values(friendReqsCache);
    const reqHtml = reqList.length ? reqList.map((r) => `
      <div class="list-row">
        <div><strong class="chat-author" data-fprof="${r.uid}">${escapeHtml(r.name)}</strong><div class="muted">フレンド申請が届いています</div></div>
        <div class="btn-row"><button class="btn-sub" data-acc="${r.uid}">承認</button><button class="btn-danger" data-rej="${r.uid}">拒否</button></div>
      </div>
    `).join("") : `<div class="muted">届いているフレンド申請はありません。</div>`;

    const frList = Object.values(friendsCache);
    const frHtml = frList.length ? frList.map((f) => {
      const online = !!remotePlayersCache[f.uid];
      return `<div class="list-row"><div><strong class="chat-author" data-fprof="${f.uid}">${online ? "🟢" : "⚪"} ${escapeHtml(f.name)}</strong><div class="muted">${online ? "現在オンライン中！" : "オフライン"}</div></div><button class="btn-danger" data-rmf="${f.uid}">解除</button></div>`;
    }).join("") : `<div class="muted">まだフレンドがいません。名前をタップして申請しよう！</div>`;

    const nearbyOthers = Object.entries(remotePlayersCache);
    const onlineHtml = nearbyOthers.length ? nearbyOthers.map(([uid, p]) => `
      <div class="list-row"><div><strong class="chat-author" data-fprof="${uid}">🟢 ${escapeHtml(p.name)}</strong> <span class="muted">${escapeHtml(p.title || "")}</span></div><button class="btn-sub" data-fprof="${uid}">プロフを見る</button></div>
    `).join("") : `<div class="muted">現在オンライン中の他プレイヤーはいません</div>`;

    openModal("🤝 フレンド ＆ オンライン漁師", `${tabsHtml}<div class="bank-box"><strong>📩 届いた申請（${reqList.length}）</strong>${reqHtml}</div><div class="bank-box"><strong>👥 フレンド一覧（${frList.length}）</strong>${frHtml}</div><div class="bank-box"><strong>🌊 オンライン中の漁師</strong>${onlineHtml}</div>`, "chat_friends");
    $("modal-body").querySelectorAll("[data-fprof]").forEach((b) => { b.onclick = () => openOtherProfileModal(b.dataset.fprof); });
    $("modal-body").querySelectorAll("[data-acc]").forEach((b) => { b.onclick = async () => { await acceptFriendRequest(b.dataset.acc, friendReqsCache[b.dataset.acc] || {}, { name: save.name }); audioEngine.playCash(); openChatAndFriendsModal(); }; });
    $("modal-body").querySelectorAll("[data-rej]").forEach((b) => { b.onclick = async () => { await rejectFriendRequest(b.dataset.rej); openChatAndFriendsModal(); }; });
    $("modal-body").querySelectorAll("[data-rmf]").forEach((b) => { b.onclick = async () => { if (confirm("フレンドを解除しますか？")) { await removeFriend(b.dataset.rmf); openChatAndFriendsModal(); } }; });
  } else {
    openModal("💬 港の全体チャット", `
      ${tabsHtml}
      <div class="muted">※憩いの場専用チャットは「🍜 憩い → ♨️ 憩いの場」で休憩中のみ利用できます</div>
      <div id="main-chat-box" class="chat-box"></div>
      <div class="chat-input-row">
        <input id="main-chat-input" class="field-input" maxlength="120" placeholder="全体チャットにメッセージ..." />
        <button id="main-chat-send" class="btn-primary">送信</button>
      </div>
    `, "chat_global");
    paintChatInto($("main-chat-box"), globalChatCache);
    const send = async () => {
      const inp = $("main-chat-input"); if (!inp || !inp.value.trim()) return;
      const txt = inp.value; inp.value = "";
      await sendChatMessage("global", { name: save.name, title: save.profile?.title, text: txt });
      audioEngine.playOk();
    };
    $("main-chat-send").onclick = send;
    $("main-chat-input").onkeydown = (e) => { if (e.key === "Enter") send(); };
  }
  $("modal-body").querySelectorAll("[data-ctab]").forEach((btn) => { btn.onclick = () => { activeChatTab = btn.dataset.ctab; openChatAndFriendsModal(); }; });
}

// ===== Phase 6: プロフィール編集 ＆ 他プレイヤーのプロフィール閲覧 =====
function openMyProfileEditModal() {
  const save = currentSave();
  const { lv } = getPortLevel(save.reputation);
  const dexGot = Object.keys(save.dex || {}).length;
  const allTitles = [...new Set([...PROFILE_TITLES, ...(save.unlockedTitles || [])])];
  const titleOpts = allTitles.map((t) => `<option value="${t}" ${save.profile?.title === t ? "selected" : ""}>${t}</option>`).join("");
  const favOpts = getAllSpecies().map((s) => `<option value="${s.name}" ${save.profile?.favSpecies === s.name ? "selected" : ""}>${s.name}</option>`).join("");

  openModal("👤 マイプロフィール編集", `
    <div class="bank-box">
      <div class="muted">港の評価 Lv${lv} / 図鑑 ${dexGot}種 / 累計釣果 ${save.stats.totalCaught}匹 ${isMonthlyPassActive(save) ? '<span class="tag purple">🌙パス会員</span>' : ""}</div>
      <label class="muted">表示名（最大12文字）</label>
      <input id="prof-name" class="field-input" maxlength="12" value="${escapeHtml(save.name)}" />
      <label class="muted">称号</label>
      <select id="prof-title" class="field-input">${titleOpts}</select>
      <label class="muted">推しの魚・貝</label>
      <select id="prof-fav" class="field-input">${favOpts}</select>
      <label class="muted">自己紹介（最大60文字）</label>
      <input id="prof-bio" class="field-input" maxlength="60" value="${escapeHtml(save.profile?.bio || "")}" />
      <button id="prof-save" class="btn-primary" style="margin-top:4px;">💾 プロフィールを保存して公開</button>
    </div>
    <button class="btn-mini" id="prof-back" style="padding:8px;">← 閉じる</button>
  `);

  $("prof-back").onclick = closeModal;
  $("prof-save").onclick = () => {
    const newName = ($("prof-name").value || "").trim().slice(0, 12);
    if (newName) save.name = newName;
    save.profile = {
      title: $("prof-title").value,
      favSpecies: $("prof-fav").value,
      bio: ($("prof-bio").value || "").trim().slice(0, 60)
    };
    save.lastPlayedAt = Date.now();
    persistSlots(slots, true);
    syncMyPublicProfile();
    broadcastPresence();
    updateHud();
    audioEngine.playCash();
    alert("プロフィールを更新しました！");
    closeModal();
  };
}

async function openOtherProfileModal(targetUid) {
  if (!targetUid) return;
  if (targetUid === getCurrentUid()) { openMyProfileEditModal(); return; }

  openModal("👤 プロフィール読み込み中...", `<p class="muted">取得中...</p>`);
  const prof = await fetchPublicProfile(targetUid);
  const live = remotePlayersCache[targetUid];
  if (!prof && !live) {
    openModal("👤 プロフィール", `<p class="muted">このプレイヤーの公開プロフィールはまだありません。</p>`);
    return;
  }

  const name = prof?.name || live?.name || "名無しの漁師";
  const title = prof?.title || live?.title || "見習い漁師";
  const bio = prof?.bio || "よろしくお願いします！";
  const isFriend = !!friendsCache[targetUid];

  openModal(`👤 ${escapeHtml(name)} さんのプロフィール`, `
    <div class="bank-box">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:1.05rem;">${prof?.isVip ? "🌙 " : ""}${escapeHtml(name)}</strong>
        <span class="tag gold">${escapeHtml(title)}</span>
      </div>
      <div style="padding:8px;background:rgba(255,255,255,0.05);border-radius:8px;">${escapeHtml(bio)}</div>
      <div class="office-stats">
        <div><span class="muted">港の評価</span><strong>Lv ${prof?.portLv || 1}</strong></div>
        <div><span class="muted">図鑑記録</span><strong>${prof?.dexCount || 0} 種</strong></div>
        <div><span class="muted">累計釣果</span><strong>${prof?.totalCaught || 0} 匹</strong></div>
        <div><span class="muted">推しの魚</span><strong>${escapeHtml(prof?.favSpecies || "-")}</strong></div>
      </div>
      <div class="btn-row" style="margin-top:4px;">
        ${isFriend
          ? `<span class="tag">🤝 フレンドです</span>`
          : `<button class="btn-primary" id="btn-send-freq" style="flex:1;">🤝 フレンド申請を送る</button>`
        }
        <button class="btn-sub" id="btn-prof-chat">💬 チャットへ戻る</button>
      </div>
    </div>
  `);

  if ($("btn-send-freq")) {
    $("btn-send-freq").onclick = async () => {
      const save = currentSave();
      const ok = await sendFriendRequest(targetUid, { name: save.name, title: save.profile?.title });
      if (ok) { audioEngine.playCash(); alert(`${name}さんにフレンド申請を送りました！`); closeModal(); }
      else { audioEngine.playFail(); alert("申請に失敗しました（オンライン状態を確認してください）"); }
    };
  }
  $("btn-prof-chat").onclick = openChatAndFriendsModal;
}

let pendingPurchasesCache = {};
const processingPurchaseIds = new Set();

async function processPendingPurchases() {
  if (!Array.isArray(slots)) return;
  const entries = Object.entries(pendingPurchasesCache || {});
  if (!entries.length) return;

  let targetIdx = activeSlotIndex;
  if (targetIdx < 0 || !slots[targetIdx]) {
    let savedIdx = -1;
    try { savedIdx = Number(localStorage.getItem("sakana_pending_slot")); } catch {}
    if (Number.isInteger(savedIdx) && savedIdx >= 0 && slots[savedIdx]) {
      targetIdx = savedIdx;
    } else {
      targetIdx = slots.findIndex((sl) => !!sl);
    }
  }
  if (targetIdx < 0 || !slots[targetIdx]) return;

  const targetSave = slots[targetIdx];
  if (!Array.isArray(targetSave.claimedSessions)) targetSave.claimedSessions = [];

  for (const [sessionId, item] of entries) {
    if (!item || processingPurchaseIds.has(sessionId)) continue;
    processingPurchaseIds.add(sessionId);

    if (targetSave.claimedSessions.includes(sessionId)) {
      await clearPendingPurchase(sessionId);
      continue;
    }

    const deleted = await clearPendingPurchase(sessionId);
    if (!deleted) {
      processingPurchaseIds.delete(sessionId);
      continue;
    }

    const kind = item.kind
      || (item.productId === "monthly_pass" ? "monthly_pass"
        : item.productId === "weekly_pass" ? "weekly_pass" : "pearls");

    let rewardText = item.name || "購入アイテム";
    if (kind === "monthly_pass") {
      grantMonthlyPass(targetSave);
      rewardText = `${MONTHLY_PASS_DEF.name}\n💎有償真珠+${MONTHLY_PASS_DEF.instantPaid} / ¥${MONTHLY_PASS_DEF.instantMoney.toLocaleString()}`;
    } else if (kind === "weekly_pass") {
      grantWeeklyPass(targetSave);
      rewardText = `${WEEKLY_PASS_DEF.name}\n💎有償真珠+${WEEKLY_PASS_DEF.instantPaid} / ¥${WEEKLY_PASS_DEF.instantMoney.toLocaleString()}`;
    } else {
      const pack = PEARL_PACKS.find((p) => p.id === item.productId);
      const paid = Number(item.paid ?? item.paidPearls ?? pack?.paid ?? 0);
      const bonus = Number(item.bonusFree ?? item.freePearls ?? pack?.bonusFree ?? 0);
      targetSave.paidPearls = (targetSave.paidPearls || 0) + paid;
      targetSave.freePearls = (targetSave.freePearls || 0) + bonus;
      rewardText = `${item.name || pack?.name || "真珠パック"}\n💎有償真珠+${paid.toLocaleString()}${bonus ? ` / 💠無償真珠+${bonus.toLocaleString()}` : ""}`;
    }

    targetSave.claimedSessions.push(sessionId);
    if (targetSave.claimedSessions.length > 50) {
      targetSave.claimedSessions = targetSave.claimedSessions.slice(-50);
    }

    persistSlots(slots, true);
    if (activeSlotIndex === targetIdx) {
      syncMyPublicProfile();
      updateHud();
    } else {
      renderSlots();
    }
    try { audioEngine.playCatch("S"); } catch {}
    alert(`🎉 ご購入ありがとうございます！\nスロット${targetIdx + 1}（${targetSave.name}）へ自動反映しました！\n\n${rewardText}`);
  }
}


async function refreshAfterAuthChange(successMsg) {
  slots = await syncLoadSlots();
  renderSlots();
  renderHomeRanking();
  if (activeSlotIndex >= 0 && slots[activeSlotIndex]) {
    updateHud();
    syncMyPublicProfile();
  }
  audioEngine.playCash();
  try { alert(successMsg); } catch {}
  openAccountLinkModal(successMsg);
}

function openAccountLinkModal(noticeMsg = "") {
  const info = getAuthAccountSummary();
  const hasGoogle = info.providers.includes("google.com");
  const hasPassword = info.providers.includes("password");
  const statusLabel = !info.isAnonymous
    ? `✅ 連携済み（${info.email || info.providers.join(", ")}）`
    : "⚠️ 匿名ゲスト状態（端末変更に備えて連携がおすすめ）";

  openModal("🔐 アカウント連携・データ引継ぎ", `
    <div class="bank-box">
      <div><strong>現在の状態:</strong> ${escapeHtml(statusLabel)}</div>
      <div class="muted">セーブデータは本人のアカウントのみアクセスでき、他のプレイヤーからは閲覧できません。</div>
      <div class="muted" style="word-break:break-all;">UID: ${escapeHtml(info.uid || "未接続")}</div>
      <div id="auth-status-msg" style="margin-top:6px;font-size:12px;color:#ffd166;">${noticeMsg ? escapeHtml(noticeMsg) : ""}</div>
    </div>

    <div class="bank-box">
      <strong>① Googleアカウント連携 / サインイン</strong>
      <div class="muted">${hasGoogle ? "Googleアカウントと連携済みです。" : "新規連携は左、連携済みデータを復元する場合は右を押してください。"}</div>
      <div class="btn-row">
        <button class="btn-sub" id="btn-auth-google" style="flex:1;">${hasGoogle ? "Google連携を再確認" : "🔵 今のデータと連携"}</button>
        <button class="btn-warn" id="btn-auth-google-signin" style="flex:1;">🔑 既存Googleでサインイン</button>
      </div>
    </div>

    <div class="bank-box">
      <strong>② メール＆パスワード連携 / サインイン</strong>
      <input id="auth-email" class="field-input" type="email" placeholder="メールアドレス" value="${escapeHtml(info.email || "")}" />
      <input id="auth-pass" class="field-input" type="password" placeholder="パスワード（6文字以上）" />
      <div class="btn-row">
        <button class="btn-sub" id="btn-auth-email-link" style="flex:1;">${hasPassword ? "メール情報を更新" : "✉️ 今のデータと連携"}</button>
        <button class="btn-warn" id="btn-auth-email-signin" style="flex:1;">🔑 既存メールでサインイン</button>
      </div>
    </div>
  `);

  const setAuthMsg = (text, isErr = false) => {
    const el = $("auth-status-msg");
    if (!el) return;
    el.style.color = isErr ? "#ff7b7b" : "#7ef29a";
    el.textContent = text;
  };

  const runGoogleAuth = async (btnId, mode) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.disabled = true;
    setAuthMsg("⏳ Googleログイン処理中...");
    try {
      const res = await linkOrSignInGoogle(mode);
      if (!res.ok) {
        audioEngine.playFail();
        setAuthMsg("⚠️ " + res.msg, true);
        try { alert(res.msg); } catch {}
        return;
      }
      setAuthMsg("⏳ セーブデータを読み込み中...");
      await refreshAfterAuthChange(res.msg);
    } catch (err) {
      const msg = err?.message || String(err);
      audioEngine.playFail();
      setAuthMsg("⚠️ エラー: " + msg, true);
      try { alert("エラー: " + msg); } catch {}
    } finally {
      if ($(btnId)) $(btnId).disabled = false;
    }
  };

  $("btn-auth-google").onclick = () => runGoogleAuth("btn-auth-google", "link");
  $("btn-auth-google-signin").onclick = () => runGoogleAuth("btn-auth-google-signin", "signin");

  $("btn-auth-email-link").onclick = async () => {
    const email = $("auth-email").value;
    const password = $("auth-pass").value;
    const res = await linkOrSignInEmail({ email, password, mode: "link" });
    if (!res.ok) { audioEngine.playFail(); alert(res.msg); return; }
    await refreshAfterAuthChange(res.msg);
  };

  $("btn-auth-email-signin").onclick = async () => {
    const email = $("auth-email").value;
    const password = $("auth-pass").value;
    const res = await linkOrSignInEmail({ email, password, mode: "signin" });
    if (!res.ok) { audioEngine.playFail(); alert(res.msg); return; }
    await refreshAfterAuthChange(res.msg);
  };
}

function openPearlShopModal() {
  openPearlShopUI({
    save: currentSave(),
    slotIndex: activeSlotIndex,
    scene3d,
    openModal,
    onSaveAndRefresh: (syncCloud) => { persistSlots(slots, syncCloud); syncMyPublicProfile(); updateHud(); },
    onOpenGacha: openGachaModal
  });
}

function openGachaModal() {
  openGachaUI({
    save: currentSave(),
    openModal,
    onSaveAndRefresh: (syncCloud) => { persistSlots(slots, syncCloud); updateHud(); resetActionState(); },
    onOpenPearls: openPearlShopModal
  });
}

// ===== 事務所ハブ =====
function openOfficeModal() {
  const save = currentSave();
  syncBusinessProgress(save);
  const { lv, rep } = getPortLevel(save.reputation);
  const dexAll = getAllSpecies().length, dexGot = Object.keys(save.dex || {}).length;
  const pct = dexAll ? Math.round((dexGot / dexAll) * 100) : 0;
  const totalPending = BUSINESS_DEFS.reduce((s, d) => s + (save.businesses[d.id]?.pendingRevenue || 0), 0);
  const readyFarms = (save.farm?.plots || []).filter((p) => p && Date.now() >= p.readyAt).length;
  const reqCount = Object.keys(friendReqsCache).length;

  openModal("🏢 港の事務所", `
    <div class="office-stats">
      <div><span class="muted">港の評価</span><strong>Lv ${lv}</strong></div>
      <div><span class="muted">評判</span><strong>${rep} pt</strong></div>
      <div><span class="muted">図鑑記録</span><strong>${dexGot}/${dexAll} (${pct}%)</strong></div>
      <div><span class="muted">同じ海の仲間</span><strong>${Object.keys(remotePlayersCache).length + 1} 人</strong></div>
    </div>
    <div class="office-grid">
      <button class="office-btn accent" id="off-biz">🏪 店舗経営<span>${totalPending > 0 ? `💰 未回収 ¥${totalPending.toLocaleString()}` : "魚屋・寿司・水族館"}</span></button>
      <button class="office-btn" id="off-farm">🐟 養殖場<span>${readyFarms > 0 ? `✨ 収穫OK ${readyFarms}枠！` : `生け簀 ${save.farm.maxPlots}枠`}</span></button>
      <button class="office-btn" id="off-gacha">🎰 ガチャ＆交換所<span>🐚貝殻 ${save.shells || 0}個</span></button>
      <button class="office-btn" id="off-orders">📋 納品依頼<span>高単価で評判UP</span></button>
      <button class="office-btn" id="off-bank">🏦 漁協バンク<span>預金 ¥${(save.bank?.ordinary || 0).toLocaleString()}</span></button>
      <button class="office-btn" id="off-prof">👤 プロフ編集<span>称号・自己紹介${reqCount ? ` / 申請${reqCount}` : ""}</span></button>
      <button class="office-btn" id="off-dex">📖 生き物図鑑<span>全${dexAll}種コレクション</span></button>
      <button class="office-btn" id="off-rank">🏆 ランキング<span>全5部門</span></button>
      <button class="office-btn wide" id="off-title" style="border-color:rgba(248,113,113,0.45);">🏠 タイトル画面に戻る<span>セーブを保存してスロット選択画面へ</span></button>
    </div>
  `);

  $("off-biz").onclick = openBusinessModal;
  $("off-farm").onclick = openFarmModal;
  $("off-gacha").onclick = openGachaModal;
  $("off-orders").onclick = openOrdersModal;
  $("off-bank").onclick = openBankModal;
  $("off-prof").onclick = openMyProfileEditModal;
  $("off-dex").onclick = openDexModal;
  $("off-rank").onclick = openRankingModal;
  $("off-title").onclick = () => { closeModal(); $("btn-back-home").click(); };
}

// ===== 4業態店舗経営・養殖・依頼・船・ショップ・バイト・クーラー・銀行・図鑑 =====
function openBusinessModal() {
  const save = currentSave(); syncBusinessProgress(save);
  const def = BUSINESS_DEFS.find((b) => b.id === activeBizTab) || BUSINESS_DEFS[0];
  const st = save.businesses[def.id], open = isBusinessOpen(st);
  const remainH = st.rentExpiresAt > Date.now() ? Math.ceil((st.rentExpiresAt - Date.now()) / 3600000) : 0;
  const tabsHtml = BUSINESS_DEFS.map((b) => `<button class="shop-tab ${b.id === def.id ? "active" : ""}" data-biz-tab="${b.id}">${b.icon}${b.name.slice(0, 3)}${(save.businesses[b.id]?.pendingRevenue || 0) >= 500 ? "●" : ""}</button>`).join("");

  let bodyHtml = "";
  if (!open) {
    bodyHtml = `<div class="bank-box"><strong>${def.icon} ${def.name}（未開業）</strong><div class="muted">${def.desc}</div><div class="btn-row" style="margin-top:4px;"><button class="btn-warn" id="biz-rent">1日賃貸 ¥${def.rentPrice.toLocaleString()}</button><button class="btn-primary" id="biz-buy">店舗を購入 ¥${def.buyPrice.toLocaleString()}</button></div></div>`;
  } else {
    const statusBadge = st.owned ? `<span class="tag gold">所有店舗</span>` : `<span class="tag">賃貸中(残${remainH}h)</span>`;
    const totalPop = def.isAquarium ? st.stock.reduce((s, x) => s + (x.pop || 20), 0) : 0;
    const stockListHtml = st.stock.slice(0, 8).map((x) => `<span class="tag">${x.name}${def.isAquarium ? `(人気${x.pop})` : `(¥${x.salePrice.toLocaleString()})`}</span>`).join("") || `<span class="muted">まだ在庫がありません。「大将のおまかせ」で仕込もう！</span>`;
    bodyHtml = `
      <div class="shop-canvas-wrap"><canvas id="shop-view-canvas" width="420" height="175"></canvas><div class="shop-view-overlay"><span>${def.icon} ${def.name}</span><span>${def.isAquarium ? `人気度 ${totalPop} / 展示 ${st.stock.length}/${def.stockCap}` : `在庫 ${st.stock.length}/${def.stockCap}`}</span></div></div>
      <div class="bank-box">
        <div style="display:flex;justify-content:space-between;align-items:center;"><div>${statusBadge} 売上金庫: <strong style="color:#f3c687;">¥${st.pendingRevenue.toLocaleString()}</strong></div><button class="btn-primary" id="biz-collect" ${st.pendingRevenue <= 0 ? "disabled" : ""}>💰 回収</button></div>
        <div class="btn-row"><button class="btn-primary" id="biz-omakase" style="flex:1;">🍣 ${def.isAquarium ? "おまかせ展示" : "大将のおまかせ仕込み"}</button><button class="btn-warn" id="biz-rush">⚡ ラッシュ営業(12秒)</button></div>
        <div class="muted">クーラー内: ${save.cooler.length}点 / 累計売上: ¥${st.totalRevenue.toLocaleString()}</div>
        <div>${stockListHtml}</div>
      </div>
      ${!st.owned ? `<button class="btn-sub" id="biz-buy">この店舗を買い取る（¥${def.buyPrice.toLocaleString()}）</button>` : ""}
    `;
  }
  openModal(`🏪 店舗経営（所持 ¥${save.money.toLocaleString()}）`, `<div class="shop-tabs">${tabsHtml}</div>${bodyHtml}<button class="btn-mini" id="biz-back-office" style="padding:8px;">← 事務所へ戻る</button>`);
  $("biz-back-office").onclick = openOfficeModal;
  $("modal-body").querySelectorAll("[data-biz-tab]").forEach((btn) => { btn.onclick = () => { activeBizTab = btn.dataset.bizTab; openBusinessModal(); }; });
  if ($("biz-rent")) $("biz-rent").onclick = () => { if (save.money < def.rentPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; } save.money -= def.rentPrice; st.rentExpiresAt = Date.now() + 86400000; st.lastTickAt = Date.now(); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBusinessModal(); };
  if ($("biz-buy")) $("biz-buy").onclick = () => { if (save.money < def.buyPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; } save.money -= def.buyPrice; st.owned = true; st.lastTickAt = Date.now(); save.reputation += 12; pushWorldFeed({ text: `🏪 ${save.name}さんが「${def.name}」のオーナーになった！` }); persistSlots(slots, true); updateHud(); audioEngine.playCatch("S"); openBusinessModal(); };
  if (open) {
    const viewCtrl = startShopView($("shop-view-canvas"), {
      bizDef: def, bizState: st,
      onRushSale: () => {
        if (def.isAquarium) { const p = st.stock.reduce((s, x) => s + (x.pop || 20), 0); if (p <= 0) return 0; const t = Math.round(p * 16 + 300); st.pendingRevenue += t; st.totalRevenue += t; save.reputation += 0.3; persistSlots(slots, false); return t; }
        if (!st.stock.length) return 0;
        const item = st.stock.shift(), rev = Math.round((item.salePrice || 500) * 1.15);
        st.pendingRevenue += rev; st.totalRevenue += rev; save.reputation += 0.6; persistSlots(slots, false); return rev;
      }
    });
    $("biz-omakase").onclick = () => { const res = autoOmakaseStock(save, def.id, getSpeciesMap()); if (res.moved > 0) { persistSlots(slots, true); updateHud(); audioEngine.playOk(); openBusinessModal(); } else { audioEngine.playFail(); alert(res.msg); } };
    $("biz-collect").onclick = () => { if (st.pendingRevenue <= 0) return; const rev = st.pendingRevenue; save.money += rev; save.stats.totalEarned += rev; st.pendingRevenue = 0; recordDailyProgress(save, { earnedDelta: rev }); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBusinessModal(); };
    $("biz-rush").onclick = () => { if (!st.stock.length) { audioEngine.playFail(); alert("先に「おまかせ」でネタを投入しよう！"); return; } audioEngine.playOk(); viewCtrl.triggerRush(); setTimeout(() => { if ($("shop-view-canvas")) openBusinessModal(); }, 12400); };
  }
}

function openFarmModal() {
  const save = currentSave(), farm = save.farm, now = Date.now();
  const farmable = getAllSpecies().filter((s) => s.farmHours > 0 && s.farmSeedPrice > 0);
  const nextExpandPrice = FARM_EXPAND_PRICES[farm.maxPlots] || 0;
  const plotCards = farm.plots.map((p, idx) => {
    if (!p) return `<div class="bank-box"><strong>🌊 生け簀 #${idx + 1}（空き）</strong><div class="muted">稚魚・稚貝を投入して現実時間でサクサク育成！</div><button class="btn-primary" data-seed-slot="${idx}">🌱 稚魚・稚貝を仕入れる</button></div>`;
    const sp = getSpeciesById(p.speciesId), pct = Math.min(100, Math.round(((now - p.startedAt) / Math.max(1, p.readyAt - p.startedAt)) * 100));
    const remMin = Math.max(0, Math.ceil((p.readyAt - now) / 60000)), ready = now >= p.readyAt, isShell = sp?.speciesType === "shellfish";
    return `<div class="bank-box"><div style="display:flex;justify-content:space-between;"><strong>${isShell ? "🦪 垂下養殖" : "🐟 生け簀"} #${idx + 1}: ${sp ? sp.name : p.speciesId}</strong><span class="tag ${ready ? "gold" : ""}">${ready ? "✨ 収穫OK！" : `残 ${remMin}分 (${pct}%)`}</span></div><div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>${ready ? `<div class="btn-row" style="margin-top:4px;"><button class="btn-sub" data-harv-cooler="${idx}">🧊 クーラーへ収穫</button><button class="btn-primary" data-harv-sell="${idx}">💰 市場へ直送売却</button></div>` : `<div class="muted">${isShell ? "貝の垂下養殖はエサ不要で自動成長中" : "すくすく育成中（放置OK）"}</div>`}</div>`;
  }).join("");
  const expandHtml = farm.maxPlots < 6 ? `<button class="btn-warn" id="farm-expand">➕ 生け簀を拡張（${farm.maxPlots} → ${farm.maxPlots + 1}枠 / ¥${nextExpandPrice.toLocaleString()}）</button>` : `<div class="muted" style="text-align:center;">最大規模（6枠）まで拡張済み！</div>`;
  openModal(`🐟 サクサク養殖場（所持 ¥${save.money.toLocaleString()}）`, `${plotCards}${expandHtml}<button class="btn-mini" id="farm-back-office" style="padding:8px;">← 事務所へ戻る</button>`);
  $("farm-back-office").onclick = openOfficeModal;
  if ($("farm-expand")) $("farm-expand").onclick = () => { if (save.money < nextExpandPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; } save.money -= nextExpandPrice; farm.maxPlots += 1; farm.plots.push(null); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openFarmModal(); };
  $("modal-body").querySelectorAll("[data-seed-slot]").forEach((btn) => { btn.onclick = () => openSeedPickerModal(Number(btn.dataset.seedSlot), farmable); });
  $("modal-body").querySelectorAll("[data-harv-cooler]").forEach((btn) => { btn.onclick = () => { const idx = Number(btn.dataset.harvCooler); if (!checkCoolerSpace(save, 1)) return; const sp = getSpeciesById(farm.plots[idx].speciesId), res = harvestFarmPlot(save, idx, sp, env, false); if (res) { recordDailyProgress(save, { caughtDelta: res.count }); persistSlots(slots, true); updateHud(); audioEngine.playCatch(sp.rank); openFarmModal(); } }; });
  $("modal-body").querySelectorAll("[data-harv-sell]").forEach((btn) => { btn.onclick = () => { const idx = Number(btn.dataset.harvSell), sp = getSpeciesById(farm.plots[idx].speciesId), res = harvestFarmPlot(save, idx, sp, env, true); if (res) { recordDailyProgress(save, { caughtDelta: res.count, earnedDelta: res.price }); persistSlots(slots, true); updateHud(); audioEngine.playCash(); alert(`✨ ${res.name}×${res.count}を直送売却！（+¥${res.price.toLocaleString()}）`); openFarmModal(); } }; });
}

function openSeedPickerModal(slotIdx, farmable) {
  const save = currentSave();
  const rows = farmable.sort((a, b) => a.farmSeedPrice - b.farmSeedPrice).map((sp) => `<div class="list-row"><div><strong class="rank-${sp.rank}">[${sp.rank}] ${sp.name}</strong> <span class="tag">${sp.speciesType === "shellfish" ? "🦪垂下" : "🐟生け簀"}</span><div class="muted">育成時間: 約${Math.round(getFarmDurationMs(sp, isMonthlyPassActive(save)) / 60000)}分 / 市場目安 ¥${sp.basePricePerKg}/kg</div></div><button class="btn-primary" data-pick-seed="${sp.id}">¥${sp.farmSeedPrice.toLocaleString()}</button></div>`).join("");
  openModal(`🌱 生け簀 #${slotIdx + 1} の種苗を選ぶ`, `${rows}<button class="btn-mini" id="seed-back" style="padding:8px;">← 養殖場へ戻る</button>`);
  $("seed-back").onclick = openFarmModal;
  $("modal-body").querySelectorAll("[data-pick-seed]").forEach((btn) => { btn.onclick = () => { const sp = getSpeciesById(btn.dataset.pickSeed); if (!sp || save.money < sp.farmSeedPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; } save.money -= sp.farmSeedPrice; const now = Date.now(); save.farm.plots[slotIdx] = { speciesId: sp.id, startedAt: now, readyAt: now + getFarmDurationMs(sp, isMonthlyPassActive(save)) }; persistSlots(slots, true); updateHud(); audioEngine.playCash(); openFarmModal(); }; });
}

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
  $("modal-body").querySelectorAll("[data-equip]").forEach((btn) => { btn.onclick = () => { const item = SHOP_ITEMS.find((x) => x.id === btn.dataset.equip); if (!item) return; save.gear[item.slot] = item.id; persistSlots(slots, true); updateHud(); resetActionState(); openShopModal(); }; });
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
      if (!job || save.stamina < job.stamina) { audioEngine.playFail(); alert("スタミナが足りません！🍜憩いの食堂や休憩所で回復できます"); return; }
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
          if (jp.streak % 10 === 0) { save.freePearls = (save.freePearls || 0) + 25; drink += " ＆ 💠無償真珠+25！"; }
          const ms = checkFreePearlMilestones(save); if (ms.length) drink += ` / 🎉${ms.join(' ')}`;
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


function setPlayMode(mode) {
  playMode = mode === "solo" ? "solo" : "multi";
  window.playMode = playMode;
  localStorage.setItem("sakana_play_mode", playMode);
  if (playMode === "solo") {
    scene3d?.syncRemotePlayers({});
    $("together-badge")?.classList.add("hidden");
    $("status-banner").textContent = "🧍 ソロプレイモードに切り替えました（他プレイヤー非表示・集中モード）";
  } else {
    scene3d?.syncRemotePlayers(remotePlayersCache);
    $("status-banner").textContent = "🌐 マルチプレイモードに切り替えました（他プレイヤー表示・一緒に釣りボーナス有効）";
  }
  if (typeof ensurePlayModeButton === "function") ensurePlayModeButton();
  updateHud();
}

function openPlayModeSelectModal() {
  openModal("🎮 プレイモード選択（ソロ / マルチ）", `
    <div class="bank-box">
      <div><strong>現在のモード:</strong> ${playMode === "solo" ? "🧍 ソロプレイ" : "🌐 マルチプレイ"}</div>
      <div class="muted">いつでも切り替えできます。</div>
    </div>
    <div class="bank-box">
      <strong>🧍 ソロプレイ</strong>
      <div class="muted">他のプレイヤーを表示せず、自分のペースでじっくり釣り・採取・経営を楽しめます。</div>
      <button class="${playMode === "solo" ? "btn-primary" : "btn-sub"}" id="btn-mode-solo">🧍 ソロプレイで遊ぶ</button>
    </div>
    <div class="bank-box">
      <strong>🌐 マルチプレイ</strong>
      <div class="muted">他の漁師の姿・チャット・近くでの一緒に釣りボーナス（レアUP＆査定+10%）を楽しめます。</div>
      <button class="${playMode === "multi" ? "btn-primary" : "btn-sub"}" id="btn-mode-multi">🌐 マルチプレイで遊ぶ</button>
    </div>
  `);
  $("btn-mode-solo").onclick = () => { setPlayMode("solo"); audioEngine.playOk(); closeModal(); };
  $("btn-mode-multi").onclick = () => { setPlayMode("multi"); audioEngine.playOk(); closeModal(); };
}

function runShellDigMiniGame({ title, methodLabel, onFinish }) {
  if (phase !== "idle") return;
  phase = "harvesting";

  const GOAL = 5;
  const TIME_LIMIT = 9.5;
  let hits = 0;
  let misses = 0;
  let timeLeft = TIME_LIMIT;
  let finished = false;
  let activeSlots = new Map(); // idx -> { type: "shell"|"crab"|"rock", expireAt }
  let nextSpawnAt = 0;
  let lastTick = performance.now();

  const cellsHtml = Array.from({ length: 12 }, (_, i) =>
    `<button type="button" class="shell-cell" data-scell="${i}" style="height:56px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:rgba(15,23,42,0.82);font-size:1.35rem;display:flex;align-items:center;justify-content:center;touch-action:manipulation;user-select:none;transition:transform 0.08s;">🌊</button>`
  ).join("");

  openModal(title || `🐚 ${methodLabel || "貝採取"}チャレンジ`, `
    <div class="bank-box" style="text-align:center;">
      <div class="muted" style="font-size:12px;">🫧<strong>貝の気泡</strong>だけを素早く${GOAL}回タップ！🦀カニ・🪨岩は時間ペナルティ</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 6px;font-size:13px;">
        <span id="sh-progress" style="font-weight:700;color:#38e59a;">採取: 0 / ${GOAL}</span>
        <span id="sh-timer" style="font-weight:700;color:#f3c687;">残り ${TIME_LIMIT.toFixed(1)}s</span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;margin-bottom:10px;">
        <div id="sh-timebar" style="height:100%;width:100%;background:linear-gradient(90deg,#38e59a,#f59e0b);transition:width 0.08s linear;"></div>
      </div>
      <div id="sh-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;user-select:none;">
        ${cellsHtml}
      </div>
      <div id="sh-msg" class="muted" style="margin-top:8px;min-height:18px;font-size:12px;">気泡が出た瞬間に掘り出せ！</div>
    </div>
  `);

  const origClose = $("btn-close-modal").onclick;
  let loopId = null;

  const cleanup = () => {
    if (loopId) clearInterval(loopId);
    loopId = null;
    phase = "idle";
    if ($("btn-close-modal")) $("btn-close-modal").onclick = origClose;
  };

  const finishGame = (quality) => {
    if (finished) return;
    finished = true;
    cleanup();
    closeModal();
    onFinish(quality);
  };

  const renderCells = () => {
    const grid = document.getElementById("sh-grid");
    if (!grid) return;
    grid.querySelectorAll("[data-scell]").forEach((btn) => {
      const idx = Number(btn.dataset.scell);
      const item = activeSlots.get(idx);
      if (!item) {
        btn.textContent = "·";
        btn.style.background = "rgba(15,23,42,0.72)";
        btn.style.borderColor = "rgba(255,255,255,0.10)";
      } else if (item.type === "shell") {
        btn.textContent = "🫧";
        btn.style.background = "rgba(16,185,129,0.28)";
        btn.style.borderColor = "#38e59a";
      } else if (item.type === "crab") {
        btn.textContent = "🦀";
        btn.style.background = "rgba(239,68,68,0.24)";
        btn.style.borderColor = "#f87171";
      } else {
        btn.textContent = "🪨";
        btn.style.background = "rgba(148,163,184,0.22)";
        btn.style.borderColor = "#94a3b8";
      }
    });
  };

  const spawnTargets = (now) => {
    // 進行度とミス数でどんどん潜るのが速くなる（釣り並みの緊張感）
    const speedFactor = Math.max(0.55, 1 - hits * 0.08 - misses * 0.05);
    const shellLifeMs = Math.round((780 + Math.random() * 240) * speedFactor);
    const fakeLifeMs = Math.round((850 + Math.random() * 260) * speedFactor);

    // 本物の気泡が盤面に無ければ必ず1つ出す
    let hasShell = false;
    activeSlots.forEach((v) => { if (v.type === "shell") hasShell = true; });

    const freeIdx = [];
    for (let i = 0; i < 12; i++) if (!activeSlots.has(i)) freeIdx.push(i);
    if (!freeIdx.length) return;

    const pickFree = () => freeIdx.splice(Math.floor(Math.random() * freeIdx.length), 1)[0];

    if (!hasShell) {
      const idx = pickFree();
      activeSlots.set(idx, { type: "shell", expireAt: now + shellLifeMs });
    }
    // フェイク（カニ・岩）を1〜2個混ぜて見極めを要求
    const fakeCount = Math.min(freeIdx.length, hits >= 2 ? 2 : 1);
    for (let k = 0; k < fakeCount; k++) {
      if (Math.random() < 0.85) {
        const idx = pickFree();
        const type = Math.random() < 0.6 ? "crab" : "rock";
        activeSlots.set(idx, { type, expireAt: now + fakeLifeMs });
      }
    }
    nextSpawnAt = now + Math.round((320 + Math.random() * 220) * speedFactor);
  };

  const gridEl = document.getElementById("sh-grid");
  if (gridEl) {
    gridEl.querySelectorAll("[data-scell]").forEach((btn) => {
      const onTap = (ev) => {
        if (ev) ev.preventDefault();
        if (finished) return;
        const idx = Number(btn.dataset.scell);
        const item = activeSlots.get(idx);
        const msgEl = document.getElementById("sh-msg");
        const progEl = document.getElementById("sh-progress");

        if (item && item.type === "shell") {
          activeSlots.delete(idx);
          hits += 1;
          audioEngine.playDig?.();
          if (progEl) progEl.textContent = `採取: ${hits} / ${GOAL}`;
          if (msgEl) { msgEl.style.color = "#38e59a"; msgEl.textContent = `✨ 掘り当てた！（${hits}/${GOAL}）`; }
          if (hits >= GOAL) {
            const quality = (misses === 0 || timeLeft >= 3.0) ? "great" : "good";
            finishGame(quality);
            return;
          }
          nextSpawnAt = Math.min(nextSpawnAt, performance.now() + 180);
          renderCells();
        } else {
          misses += 1;
          if (item) activeSlots.delete(idx);
          timeLeft = Math.max(0, timeLeft - (item?.type === "crab" ? 1.5 : 1.0));
          audioEngine.playFail?.();
          if (msgEl) {
            msgEl.style.color = "#ff7b7b";
            msgEl.textContent = item?.type === "crab"
              ? "🦀 カニに挟まれた！ -1.5秒"
              : item?.type === "rock"
                ? "🪨 硬い岩だった… -1.0秒"
                : "💦 空振り！貝が警戒した… -1.0秒";
          }
          renderCells();
        }
      };
      btn.onpointerdown = onTap;
    });
  }

  loopId = setInterval(() => {
    if (finished) return;
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    timeLeft = Math.max(0, timeLeft - dt);

    let changed = false;
    activeSlots.forEach((v, k) => {
      if (now >= v.expireAt) {
        activeSlots.delete(k);
        changed = true;
      }
    });
    if (now >= nextSpawnAt) {
      spawnTargets(now);
      changed = true;
    }
    if (changed) renderCells();

    const tEl = document.getElementById("sh-timer");
    const barEl = document.getElementById("sh-timebar");
    if (tEl) {
      tEl.textContent = `残り ${timeLeft.toFixed(1)}s`;
      tEl.style.color = timeLeft <= 2.5 ? "#ff7b7b" : "#f3c687";
    }
    if (barEl) barEl.style.width = `${(timeLeft / TIME_LIMIT) * 100}%`;

    if (timeLeft <= 0) {
      finishGame("miss");
    }
  }, 50);

  $("btn-close-modal").onclick = () => {
    if (finished) return;
    finished = true;
    cleanup();
    if (origClose) origClose();
    else closeModal();
  };
}

function runNetThrowMiniGame({ title, net, onFinish }) {
  if (phase !== "idle") return;
  phase = "harvesting";

  let finished = false;
  let stage = "aim"; // "aim" -> "pull"
  let aimResult = "good"; // "great" | "good"
  const netTier = Math.max(1, Number(net?.tier || 1));

  // Phase 1: 動く魚群を狙って投網
  let fishX = 20 + Math.random() * 60;
  let fishY = 25 + Math.random() * 50;
  let vx = (Math.random() < 0.5 ? -1 : 1) * (42 + Math.random() * 24);
  let vy = (Math.random() < 0.5 ? -1 : 1) * (32 + Math.random() * 22);
  let turnTimer = 0.7;
  let aimTime = 6.0;
  let throwing = false;
  let throwX = 50;
  let throwY = 50;
  let throwRadius = Math.min(24, 17 + netTier * 1.4);

  // Phase 2: 網引き上げテンションバトル
  let pullProgress = 0;
  let netTension = 18;
  let pullTime = 10.5;
  let holding = false;
  let fishRage = false;
  let rageTimer = 1.1;
  let peakTension = 0;

  let lastTick = performance.now();
  let loopId = null;

  openModal(title || "🕸️ 投網＆引き上げ勝負", `
    <div class="bank-box" style="text-align:center;">
      <div id="net-stage-desc" class="muted" style="font-size:12px;">【第1段階】泳ぐ🐟魚群が中央の網サークルに入った瞬間に投網！（落下ラグあり）</div>
      <div id="net-aim-wrap">
        <div id="net-water" style="position:relative;height:168px;margin:10px 0;border-radius:12px;background:radial-gradient(circle at 50% 45%, #0c4a6e, #082f49);border:1px solid rgba(56,189,248,0.35);overflow:hidden;touch-action:manipulation;user-select:none;">
          <div id="net-zone" style="position:absolute;left:50%;top:50%;width:${throwRadius * 2}%;aspect-ratio:1/1;border-radius:50%;border:2px dashed #38bdf8;background:rgba(56,189,248,0.14);transform:translate(-50%,-50%);pointer-events:none;"></div>
          <div id="net-school" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:1.35rem;letter-spacing:-2px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));pointer-events:none;">🐟🐟🐟</div>
          <div id="net-splash" style="position:absolute;left:50%;top:50%;width:0;height:0;border-radius:50%;border:3px solid #f3c687;transform:translate(-50%,-50%);opacity:0;pointer-events:none;"></div>
        </div>
        <div id="net-aim-timer" style="font-size:13px;font-weight:700;color:#f3c687;margin-bottom:8px;">魚群通過まで 6.0s</div>
        <button type="button" class="btn-primary" id="btn-net-cast" style="width:100%;height:50px;font-size:1.05rem;touch-action:manipulation;user-select:none;">🕸️ 今だ！投網を放つ！</button>
      </div>

      <div id="net-pull-wrap" style="display:none;margin-top:8px;">
        <div id="net-rage-badge" style="padding:6px 10px;border-radius:8px;font-weight:800;font-size:13px;margin-bottom:10px;background:rgba(16,185,129,0.2);color:#38e59a;">🌊 落ち着いている！今すぐ長押しで引き上げろ！</div>
        <div style="text-align:left;font-size:12px;margin-bottom:4px;display:flex;justify-content:space-between;">
          <span>🕸️ 引き上げ進捗</span><strong id="net-prog-txt">0%</strong>
        </div>
        <div style="height:14px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;margin-bottom:10px;">
          <div id="net-prog-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#38bdf8,#38e59a);"></div>
        </div>
        <div style="text-align:left;font-size:12px;margin-bottom:4px;display:flex;justify-content:space-between;">
          <span>⚠️ 網の負荷（100%で破損！）</span><strong id="net-tens-txt">18%</strong>
        </div>
        <div style="height:14px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;margin-bottom:10px;">
          <div id="net-tens-bar" style="height:100%;width:18%;background:linear-gradient(90deg,#38e59a,#f59e0b,#ef4444);"></div>
        </div>
        <div id="net-pull-timer" style="font-size:12px;font-weight:700;color:#f3c687;margin-bottom:8px;">残り 10.5s</div>
        <button type="button" class="btn-primary" id="btn-net-pull" oncontextmenu="return false;" style="width:100%;height:54px;font-size:1.05rem;touch-action:none;user-select:none;-webkit-user-select:none;">💪 長押しで引き上げ（暴れたら離す！）</button>
      </div>
    </div>
  `);

  const origClose = $("btn-close-modal").onclick;
  const cleanup = () => {
    if (loopId) clearInterval(loopId);
    loopId = null;
    holding = false;
    phase = "idle";
    if ($("btn-close-modal")) $("btn-close-modal").onclick = origClose;
  };

  const finishGame = (quality) => {
    if (finished) return;
    finished = true;
    cleanup();
    closeModal();
    onFinish(quality);
  };

  const enterPullStage = (hitGrade) => {
    stage = "pull";
    aimResult = hitGrade;
    pullProgress = hitGrade === "great" ? 16 : 6;
    netTension = 16;
    fishRage = false;
    rageTimer = 0.8 + Math.random() * 0.6;
    const desc = document.getElementById("net-stage-desc");
    const aimWrap = document.getElementById("net-aim-wrap");
    const pullWrap = document.getElementById("net-pull-wrap");
    if (desc) desc.innerHTML = hitGrade === "great"
      ? "🎯 <strong>ド真ん中捕捉！</strong>【第2段階】暴れる赤警告を避けて引き上げろ！"
      : "🕸️ <strong>魚群を包囲！</strong>【第2段階】暴れる赤警告を避けて引き上げろ！";
    if (aimWrap) aimWrap.style.display = "none";
    if (pullWrap) pullWrap.style.display = "block";
    audioEngine.playOk?.();
  };

  const triggerCast = (ev) => {
    if (ev) ev.preventDefault();
    if (finished || stage !== "aim" || throwing) return;
    throwing = true;
    audioEngine.playNetThrow?.();
    const castBtn = document.getElementById("btn-net-cast");
    if (castBtn) { castBtn.disabled = true; castBtn.textContent = "🕸️ 網が広がっている…"; }

    const splash = document.getElementById("net-splash");
    if (splash) {
      splash.style.opacity = "1";
      splash.style.width = `${throwRadius * 2}%`;
      splash.style.aspectRatio = "1/1";
      splash.style.transition = "all 0.16s ease-out";
    }

    // 網が着水する0.16秒後に着水判定（先読みが必要）
    setTimeout(() => {
      if (finished || stage !== "aim") return;
      const dx = fishX - throwX;
      const dy = (fishY - throwY) * 0.72;
      const dist = Math.hypot(dx, dy);
      if (dist <= throwRadius * 0.58) {
        enterPullStage("great");
      } else if (dist <= throwRadius * 1.15) {
        enterPullStage("good");
      } else {
        audioEngine.playFail?.();
        finishGame("miss");
      }
    }, 160);
  };

  const castBtn = document.getElementById("btn-net-cast");
  if (castBtn) castBtn.onpointerdown = triggerCast;

  const waterEl = document.getElementById("net-water");
  if (waterEl) {
    waterEl.onpointerdown = (ev) => {
      if (finished || stage !== "aim" || throwing) return;
      const rect = waterEl.getBoundingClientRect();
      throwX = Math.max(12, Math.min(88, ((ev.clientX - rect.left) / rect.width) * 100));
      throwY = Math.max(15, Math.min(85, ((ev.clientY - rect.top) / rect.height) * 100));
      const zone = document.getElementById("net-zone");
      const splash = document.getElementById("net-splash");
      if (zone) { zone.style.left = `${throwX}%`; zone.style.top = `${throwY}%`; }
      if (splash) { splash.style.left = `${throwX}%`; splash.style.top = `${throwY}%`; }
      triggerCast(ev);
    };
  }

  const pullBtn = document.getElementById("btn-net-pull");
  if (pullBtn) {
    const startHold = (ev) => { if (ev) ev.preventDefault(); holding = true; };
    const endHold = () => { holding = false; };
    pullBtn.onpointerdown = startHold;
    pullBtn.onpointerup = endHold;
    pullBtn.onpointercancel = endHold;
    pullBtn.onpointerleave = endHold;
  }

  loopId = setInterval(() => {
    if (finished) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;

    if (stage === "aim") {
      aimTime = Math.max(0, aimTime - dt);
      turnTimer -= dt;
      if (turnTimer <= 0) {
        turnTimer = 0.45 + Math.random() * 0.65;
        const angle = Math.random() * Math.PI * 2;
        const spd = 48 + Math.random() * 34;
        vx = Math.cos(angle) * spd;
        vy = Math.sin(angle) * spd;
      }
      fishX += vx * dt;
      fishY += vy * dt;
      if (fishX < 10 || fishX > 90) { fishX = Math.max(10, Math.min(90, fishX)); vx *= -1; }
      if (fishY < 14 || fishY > 86) { fishY = Math.max(14, Math.min(86, fishY)); vy *= -1; }

      const schoolEl = document.getElementById("net-school");
      if (schoolEl) {
        schoolEl.style.left = `${fishX}%`;
        schoolEl.style.top = `${fishY}%`;
        schoolEl.style.transform = `translate(-50%,-50%) scaleX(${vx >= 0 ? -1 : 1})`;
      }
      const tEl = document.getElementById("net-aim-timer");
      if (tEl) tEl.textContent = `魚群通過まで ${aimTime.toFixed(1)}s（水面直接タップでも投網OK）`;
      if (aimTime <= 0 && !throwing) {
        finishGame("miss");
      }
    } else if (stage === "pull") {
      pullTime = Math.max(0, pullTime - dt);
      rageTimer -= dt;
      if (rageTimer <= 0) {
        fishRage = !fishRage;
        rageTimer = fishRage ? (0.75 + Math.random() * 0.75) : (0.85 + Math.random() * 0.85);
      }

      const tierEase = Math.max(0.72, 1 - (netTier - 1) * 0.06);
      if (holding) {
        if (fishRage) {
          // 暴れている最中に引くと負荷が急上昇
          netTension += 54 * tierEase * dt;
          pullProgress += 6 * dt;
        } else {
          pullProgress += 26 * dt;
          netTension += 14 * tierEase * dt;
        }
      } else {
        // 離している間は負荷が下がるが、少しずつ魚に引き戻される
        netTension = Math.max(0, netTension - 34 * dt);
        pullProgress = Math.max(0, pullProgress - (fishRage ? 9 : 4.5) * dt);
      }
      peakTension = Math.max(peakTension, netTension);

      const badge = document.getElementById("net-rage-badge");
      if (badge) {
        if (fishRage) {
          badge.style.background = "rgba(239,68,68,0.28)";
          badge.style.color = "#ff7b7b";
          badge.textContent = "🚨 魚群が暴れている！！今すぐボタンを離せ！！";
        } else {
          badge.style.background = "rgba(16,185,129,0.22)";
          badge.style.color = "#38e59a";
          badge.textContent = "🌊 静まった！長押しで一気に引き上げろ！";
        }
      }
      const pTxt = document.getElementById("net-prog-txt");
      const pBar = document.getElementById("net-prog-bar");
      const tTxt = document.getElementById("net-tens-txt");
      const tBar = document.getElementById("net-tens-bar");
      const tmEl = document.getElementById("net-pull-timer");
      if (pTxt) pTxt.textContent = `${Math.min(100, Math.round(pullProgress))}%`;
      if (pBar) pBar.style.width = `${Math.min(100, pullProgress)}%`;
      if (tTxt) tTxt.textContent = `${Math.min(100, Math.round(netTension))}%`;
      if (tBar) tBar.style.width = `${Math.min(100, netTension)}%`;
      if (tmEl) tmEl.textContent = `残り ${pullTime.toFixed(1)}s`;

      if (netTension >= 100 || pullTime <= 0) {
        audioEngine.playFail?.();
        finishGame("miss");
      } else if (pullProgress >= 100) {
        const quality = (aimResult === "great" && peakTension < 85) ? "great" : "good";
        finishGame(quality);
      }
    }
  }, 40);

  $("btn-close-modal").onclick = () => {
    if (finished) return;
    finished = true;
    cleanup();
    if (origClose) origClose();
    else closeModal();
  };
}

function runTimingMiniGame({ title, desc, speedMs = 30, hitWidth = 34, onFinish }) {
  if (phase !== "idle") return;
  phase = "harvesting";
  let pos = 0;
  let dir = 1;
  let finished = false;
  const sweetStart = Math.max(10, Math.round((100 - hitWidth) / 2));
  const sweetEnd = sweetStart + hitWidth;

  openModal(title, `
    <div class="bank-box" style="text-align:center;">
      <div class="muted">${escapeHtml(desc)}</div>
      <div style="position:relative;height:30px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;margin:12px 0;">
        <div style="position:absolute;left:${sweetStart}%;width:${sweetEnd - sweetStart}%;top:0;bottom:0;background:rgba(56,229,154,0.38);border-left:2px solid #38e59a;border-right:2px solid #38e59a;"></div>
        <div id="mg-cursor" style="position:absolute;left:0%;top:2px;bottom:2px;width:10px;border-radius:999px;background:#f3c687;transform:translateX(-50%);"></div>
      </div>
      <button class="btn-primary" id="btn-mg-stop" style="width:100%;height:50px;font-size:1.05rem;touch-action:manipulation;">🎯 緑ゾーンでタップ！</button>
    </div>
  `);

  const timer = setInterval(() => {
    pos += dir * 1.8;
    if (pos >= 100) { pos = 100; dir = -1; }
    else if (pos <= 0) { pos = 0; dir = 1; }
    const cur = document.getElementById("mg-cursor");
    if (cur) cur.style.left = `${pos}%`;
  }, speedMs);

  const origClose = $("btn-close-modal").onclick;
  const cleanup = () => {
    clearInterval(timer);
    phase = "idle";
    if ($("btn-close-modal")) $("btn-close-modal").onclick = origClose;
  };

  const stopNow = () => {
    if (finished) return;
    finished = true;
    cleanup();
    closeModal();
    const center = sweetStart + hitWidth / 2;
    const diff = Math.abs(pos - center);
    const quality = diff <= hitWidth * 0.25 ? "great" : (pos >= sweetStart && pos <= sweetEnd ? "good" : "miss");
    onFinish(quality);
  };

  const stopBtn = $("btn-mg-stop");
  stopBtn.onpointerdown = (ev) => { ev.preventDefault(); stopNow(); };
  stopBtn.onclick = () => stopNow();

  $("btn-close-modal").onclick = () => {
    if (finished) return;
    finished = true;
    cleanup();
    if (origClose) origClose();
    else closeModal();
  };
}

function sellCoolerItemAt(index) {
  const save = currentSave();
  if (!save || !Array.isArray(save.cooler) || index < 0 || index >= save.cooler.length) return;
  const [item] = save.cooler.splice(index, 1);
  const gain = Number(item?.price || 0);
  save.money += gain;
  save.stats.totalEarned += gain;
  save.lastPlayedAt = Date.now();
  recordDailyProgress(save, { earnedDelta: gain });
  persistSlots(slots, true);
  updateHud();
  audioEngine.playCash();
  openCoolerModal();
}

/* clean-fix-mode-btn-and-boot */
window.addEventListener("error", (ev) => {
  const b = document.getElementById("status-banner");
  if (b && ev?.message) b.textContent = "⚠️ " + ev.message;
});
window.addEventListener("unhandledrejection", (ev) => {
  const b = document.getElementById("status-banner");
  if (b && ev?.reason) b.textContent = "⚠️ " + (ev.reason?.message || ev.reason);
});

if (typeof window.playMode === "undefined") {
  window.playMode = localStorage.getItem("sakana_play_mode") || "multi";
}

function ensurePlayModeButton() {
  const modeVal = (typeof playMode === "string" && playMode) ? playMode : (localStorage.getItem("sakana_play_mode") || "multi");
  window.playMode = modeVal;
  const isSolo = modeVal === "solo";
  const label = isSolo ? "🧍 ソロ" : "🌐 マルチ";

  // 左上メニュー側の重複ボタンがあれば削除（ミニマップ上に一本化）
  const dupBtn = document.getElementById("btn-play-mode-toggle");
  if (dupBtn) dupBtn.remove();

  const onOpenMode = () => {
    if (typeof audioEngine !== "undefined" && audioEngine?.unlock) audioEngine.unlock();
    if (typeof openPlayModeSelectModal === "function") {
      openPlayModeSelectModal();
    } else {
      alert("モード切替モーダルが読み込まれていません。");
    }
  };

  const playScreen = document.getElementById("play-screen");
  if (playScreen) {
    let floatBtn = document.getElementById("btn-play-mode-float");
    if (!floatBtn) {
      floatBtn = document.createElement("button");
      floatBtn.id = "btn-play-mode-float";
      floatBtn.className = "btn-mini";
      floatBtn.type = "button";
      floatBtn.style.cssText = "position:fixed;right:12px;top:118px;z-index:50;padding:6px 12px;border-radius:999px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.45);";
      floatBtn.onclick = onOpenMode;
      playScreen.appendChild(floatBtn);
    }
    floatBtn.style.display = playScreen.classList.contains("active") ? "inline-flex" : "none";
    floatBtn.style.borderColor = isSolo ? "#f59e0b" : "#38bdf8";
    floatBtn.style.background = isSolo ? "rgba(120, 53, 15, 0.88)" : "rgba(12, 74, 110, 0.88)";
    floatBtn.style.color = "#ffffff";
    floatBtn.textContent = label;
  }
}

setInterval(() => {
  try { ensurePlayModeButton(); } catch {}
}, 1000);

function openCoolerModal() {
  const save = currentSave(), { coolerCap } = getEquippedStats(save);
  if (!save.cooler.length) { openModal(`🧊 クーラーボックス (0/${coolerCap})`, `<p class="muted">まだ魚や貝が入っていません。</p>`); return; }
  const total = save.cooler.reduce((s, x) => s + x.price, 0);
  const rows = save.cooler.map((x, idx) => `
    <div class="list-row">
      <div>
        <strong class="rank-${x.rank}">[${x.rank}] ${escapeHtml(x.name)}</strong> (${x.weightKg}kg)
        <div class="muted">${escapeHtml((x.tags || []).join(" / "))}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <strong>¥${Number(x.price || 0).toLocaleString()}</strong>
        <button class="btn-mini" data-sell-idx="${idx}">売る</button>
      </div>
    </div>
  `).join("");
  openModal(`🧊 クーラーボックス (${save.cooler.length}/${coolerCap})`, `<div class="btn-row"><button class="btn-primary" id="btn-sell-all" style="flex:1;">一括売却（¥${total.toLocaleString()}）</button><button class="btn-sub" id="btn-go-biz">🏪 店舗へ仕込む</button></div>${rows}`);
  $("btn-go-biz").onclick = openBusinessModal;
  $("btn-sell-all").onclick = () => { save.money += total; save.stats.totalEarned += total; save.cooler = []; save.lastPlayedAt = Date.now(); recordDailyProgress(save, { earnedDelta: total }); persistSlots(slots, true); updateHud(); audioEngine.playCash(); closeModal(); };
  $("modal-body").querySelectorAll("[data-sell-idx]").forEach((btn) => {
    btn.onclick = () => sellCoolerItemAt(Number(btn.dataset.sellIdx));
  });
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

function triggerAdminSecret() {
  if (!verifyAdminAccess()) return;
  let targetSave = currentSave();
  if (!targetSave) {
    // ホーム画面から開いた場合は最初の既存スロットを対象にする
    const firstIdx = slots.findIndex(Boolean);
    if (firstIdx >= 0) { activeSlotIndex = firstIdx; targetSave = slots[firstIdx]; }
  }
  openAdminPanel({
    save: targetSave,
    scene3d,
    openModal,
    onSaveAndRefresh: () => {
      persistSlots(slots, true);
      updateHud();
      syncWorldStatus();
      renderSlots();
    },
    onEnvChanged: () => updateEnvironmentUI()
  });
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
    if (phase !== "idle" || document.activeElement?.tagName === "INPUT") { scene3d.moveInput.x = 0; scene3d.moveInput.y = 0; return; }
    scene3d.moveInput.x = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    scene3d.moveInput.y = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  };
  window.addEventListener("keydown", (e) => { keys.add(e.code); syncKeys(); });
  window.addEventListener("keyup", (e) => { keys.delete(e.code); syncKeys(); });
}

async function boot() {
  /* fast-boot-steps */
  /* main-entered-tracer */
  if ($("live-clock")) $("live-clock").textContent = "⏳ boot開始...";
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
  await loadGachaBanners();
  await initFirebase({ onOnlineCount: (n) => { $("online-count").textContent = n; }, onStatus: (msg) => { $("sync-status").textContent = msg; } });

  // リアルタイム同期購読
  subscribeWorldPlayers((others) => { remotePlayersCache = others; scene3d.syncRemotePlayers(others); });
  subscribeWorldFeed((item) => { if (!item || (item.ts || 0) < bootTime - 25000) return; showLiveTicker(`📣 ${item.text}`); });
  subscribeChatRoom("global", (list) => {
    globalChatCache = list;
    if (activeModalType === "chat_global") paintChatInto($("main-chat-box"), list);
    const last = list[list.length - 1];
    if (last && last.ts > bootTime && last.uid !== getCurrentUid()) showLiveTicker(`💬 ${last.name}: ${last.text}`);
  });
  subscribeChatRoom("lounge", (list) => {
    loungeChatCache = list;
    if (activeModalType === "lounge_rest") paintChatInto($("lounge-chat-box"), list);
    if (activeModalType === "chat_lounge") paintChatInto($("main-chat-box"), list);
  });
  subscribeFriends((map) => { friendsCache = map; });
  subscribeFriendRequests((map) => {
    friendReqsCache = map;
    if (Object.keys(map).length > 0 && activeSlotIndex >= 0) {
      updateHud();
      showLiveTicker("🤝 フレンド申請が届いています！右下の💬→フレンドから確認");
    }
  });

  subscribePendingPurchases((map) => {
    pendingPurchasesCache = map || {};
    processPendingPurchases();
  });

  slots = await syncLoadSlots();
  renderSlots();
  renderHomeRanking();
  processPendingPurchases();

  if (window.location.search.includes("paid=") || window.location.search.includes("checkout=")) {
    try { history.replaceState(null, "", window.location.pathname); } catch {}
  }

  // 秘密の管理人ページトリガー（ホーム画面タイトル5連タップ）
  let secretTapCount = 0, secretTapTimer = null;
  $("secret-admin-trigger").onclick = () => {
    secretTapCount++;
    clearTimeout(secretTapTimer);
    secretTapTimer = setTimeout(() => { secretTapCount = 0; }, 1600);
    if (secretTapCount >= 5) { secretTapCount = 0; triggerAdminSecret(); }
  };

  // プレイ画面の名前を5連タップでも秘密ページへ入れる（デバッグしやすい）
  let playTapCount = 0, playTapTimer = null;
  $("btn-hud-profile").onclick = () => {
    playTapCount++;
    clearTimeout(playTapTimer);
    if (playTapCount >= 5) { playTapCount = 0; triggerAdminSecret(); return; }
    playTapTimer = setTimeout(() => {
      if (playTapCount === 1) openMyProfileEditModal();
      playTapCount = 0;
    }, 320);
  };

  $("btn-sound-home").onclick = () => { audioEngine.toggleMute(); updateSoundIcons(); };
  $("btn-sound-play").onclick = () => { audioEngine.toggleMute(); updateSoundIcons(); };
  $("btn-refresh-rank").onclick = renderHomeRanking;
  $("btn-back-home").onclick = () => {
    resetActionState(); saveWorldPosition(true); clearWorldPresence();
    $("stamp-bar").classList.add("hidden");
    $("play-screen").classList.remove("active"); $("home-screen").classList.add("active");
    renderSlots(); renderHomeRanking();
  };

  $("btn-open-chat").onclick = () => { audioEngine.unlock(); openChatAndFriendsModal(); };
  $("btn-open-orders-quick").onclick = () => { audioEngine.unlock(); openOrdersModal(); };
  if ($("btn-open-account-home")) {
    $("btn-open-account-home").onclick = () => { audioEngine.unlock(); openAccountLinkModal(); };
  }
  $("btn-open-pearls").onclick = () => { audioEngine.unlock(); openPearlShopModal(); };
  $("btn-open-gacha").onclick = () => { audioEngine.unlock(); openGachaModal(); };
  $("btn-open-lounge").onclick = () => { audioEngine.unlock(); openLoungeModal(); };

  $("btn-stamp-toggle").onclick = () => { audioEngine.unlock(); $("stamp-bar").classList.toggle("hidden"); };
  document.querySelectorAll("[data-stamp]").forEach((btn) => {
    btn.onclick = () => {
      const save = currentSave(); if (!save) return;
      myLastStamp = btn.dataset.stamp; myLastStampTs = Date.now();
      broadcastPresence();
      pushWorldFeed({ text: `${save.name}「${myLastStamp}」`, kind: "stamp" });
      showLiveTicker(`💬 あなた「${myLastStamp}」`);
      audioEngine.playOk(); $("stamp-bar").classList.add("hidden");
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
  if ($("btn-open-cooler")?.parentElement && !document.getElementById("btn-play-mode-toggle")) {
    const modeBtn = document.createElement("button");
    modeBtn.id = "btn-play-mode-toggle";
    modeBtn.className = "btn-mini";
    modeBtn.type = "button";
    modeBtn.textContent = (typeof playMode !== "undefined" && playMode === "solo") ? "🧍 ソロ" : "🌐 マルチ";
    modeBtn.onclick = () => {
      if (typeof audioEngine !== "undefined" && audioEngine?.unlock) audioEngine.unlock();
      if (typeof openPlayModeSelectModal === "function") openPlayModeSelectModal();
    };
    $("btn-open-cooler").parentElement.appendChild(modeBtn);
  }
  $("btn-open-cooler").onclick = openCoolerModal;
  $("btn-open-dock").onclick = openDockModal;
  $("btn-open-shop").onclick = openShopModal;
  $("btn-open-jobs").onclick = openJobsModal;
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
