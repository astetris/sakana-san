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

import { ensureStockMarketRunning, openFishStockExchange } from "./systems/fishStock.js?v=20261128_053106";
import { initFirebase, getCurrentUid, getJstDateKey, RANKING_BOARDS, subscribePendingPurchases, clearPendingPurchase, getAuthAccountSummary, linkOrSignInGoogle, linkOrSignInEmail, fetchDailyRanking, submitDailyBoard, updateWorldPresence, clearWorldPresence, subscribeWorldPlayers, pushWorldFeed, subscribeWorldFeed, publishMyProfile, fetchPublicProfile, sendChatMessage, subscribeChatRoom, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend, subscribeFriends, subscribeFriendRequests, consumeRedeemCode, claimPlayerName } from "./config/firebase.js?v=20261128_053106";
import { getRealWorldEnv } from "./systems/environment.js?v=20261128_053106";
import { audioEngine } from "./systems/audioEngine.js?v=20261128_053106";
import { getAreaAt, isNearPier, drawMinimap, PIER_DOCK_POS, canCastFrom, canHarvestShellAt } from "./systems/worldMap.js?v=20261128_053106";
import {
  BOATS, FUEL_PRICE_PER_L, SHOP_ITEMS, PART_TIME_JOBS,
  getJobRankInfo, getActiveBoat, getBestBoatTier, getEquippedStats, applyBankInterest
} from "./systems/economy.js?v=20261128_053106";
import { runJobMinigame, stopActiveJobGame } from "./systems/jobsMinigame.js?v=20261128_053106";
import {
  BUSINESS_DEFS, FARM_EXPAND_PRICES, getPortLevel, isBusinessOpen, autoOmakaseStock, syncBusinessProgress, getFarmDurationMs, harvestFarmPlot, ensureDailyOrders, PRICE_STRATEGIES, BIZ_UPGRADES, ensureBizState, getItemFreshness, getFreshnessEffect, getBizMetrics, getUpgradeCost, upgradeBizFacility, refreshBizIce, stockSingleToBiz, serveGuestOrder
} from "./systems/business.js?v=20261128_053106";
import { startShopView, stopShopView } from "./systems/shopView.js?v=20261128_053106";
import { CANTEEN_MENU, PROFILE_TITLES, getActiveBuff } from "./systems/social.js?v=20261128_053106";
import {
  getTotalPearls, isMonthlyPassActive, isWeeklyPassActive, canClaimAnyPass, checkFreePearlMilestones, grantMonthlyPass, grantWeeklyPass, PEARL_PACKS, MONTHLY_PASS_DEF, WEEKLY_PASS_DEF
} from "./systems/pearlShop.js?v=20261128_053106";
import { loadGachaBanners } from "./systems/gacha.js?v=20261128_053106";
import { openPearlShopUI, openGachaUI } from "./systems/phase7UI.js?v=20261128_053106";
import { verifyAdminAccess, openAdminPanel } from "./systems/adminPanel.js?v=20261128_053106";
import { syncLoadSlots, persistSlots, createNewSave, ensureSaveDefaults } from "./state/saveManager.js?v=20261128_053106";
import {
  loadSpeciesMaster, getAllSpecies, getSpeciesById, rollCatch, rollShellfish, rollNetHaul, getShellMethodForArea
} from "./systems/fishingEngine.js?v=20261128_053106";
import { FishingScene } from "./scenes/fishingScene.js?v=20261128_053106";


// ===== オンライン／オフライン履歴 ＆ 右上人数バッジ同期 ＆ 「合わせる」スタミナ消費 =====
const SEEN_PLAYERS_STORAGE_KEY = "sakana_seen_players_history_v2";
const ONLINE_ACTIVE_MS = 120000; // 2分以内をオンライン扱い

function loadSeenPlayersHistory() {
  try {
    const raw = localStorage.getItem(SEEN_PLAYERS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function saveSeenPlayersHistory(list) {
  try {
    localStorage.setItem(SEEN_PLAYERS_STORAGE_KEY, JSON.stringify(list.slice(0, 100)));
  } catch (_) {}
}

function recordSeenPlayers(_entries = []) {
  // ゲストのログイン履歴は今後は導入しないため何もしない
}

function syncTopRightOnlineBadge(activeOnlineCount) {
  const cnt = Math.max(1, Number(activeOnlineCount || 1));
  const el = document.getElementById("online-count");
  if (el) {
    el.textContent = String(cnt);
  }
  const badge = document.querySelector(".online-badge");
  if (badge) {
    const numSpan = badge.querySelector("strong");
    if (numSpan) numSpan.textContent = String(cnt);
  }
}

function consumeStrikeStamina(save) {
  if (!save || typeof save.stamina !== "number") return;
  save.stamina = Math.max(0, save.stamina - 2);
}

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


async function reserveUniqueName(rawName, prevName = "", ignoreSlotIdx = -1) {
  const clean = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 12) {
    return { ok: false, reason: "プレイヤー名は1〜12文字で入力してください。" };
  }
  const low = clean.toLowerCase();
  const localDup = Array.isArray(slots) && slots.some((s, i) => s && i !== ignoreSlotIdx && String(s.name || "").trim().toLowerCase() === low);
  if (localDup) {
    return { ok: false, reason: `「${clean}」は別スロットで既に使用されています。` };
  }
  return await claimPlayerName(clean, prevName);
}


// ===== 文字を一切使わないビジュアルアバター選択UI（4シルエット×服8色×髪6色） =====
const AVATAR_COLORS = ["#0284c7", "#0f766e", "#e11d48", "#d97706", "#7c3aed", "#16a34a", "#ea580c", "#334155"];
const AVATAR_HAIRS  = ["#261c16", "#5a3825", "#8c5a32", "#d6ad60", "#cbd5e1", "#1e3a5f"];

function ensureAvatarState(save) {
  if (!save) return { model: 0, color: "#0284c7", hair: "#261c16" };
  if (!save.avatar || typeof save.avatar !== "object") {
    save.avatar = { model: 0, color: "#0284c7", hair: "#261c16" };
  }
  const m = Number(save.avatar.model ?? 0);
  save.avatar.model = (m >= 0 && m <= 3) ? m : 0;
  save.avatar.color = save.avatar.color || "#0284c7";
  save.avatar.hair = save.avatar.hair || "#261c16";
  return save.avatar;
}

function renderAvatarPreviewSvg(model, color, hair) {
  const slim = (model === 1 || model === 3);
  const hatColor = (model === 2 || model === 3) ? color : "#d9ad6c";
  const bandColor = (model === 2 || model === 3) ? "#f8fafc" : color;
  const bootColor = slim ? "#3b2a22" : "#18181b";

  // 髪型SVG
  let hairBack = "";
  let hairFront = "";
  if (model === 1) {
    hairBack = `<rect x="26" y="25" width="38" height="38" rx="14" fill="${hair}"/>`;
    hairFront = `<path d="M31 28 Q30 48 33 56" stroke="${hair}" stroke-width="5" stroke-linecap="round" fill="none"/>
                 <path d="M59 28 Q60 48 57 56" stroke="${hair}" stroke-width="5" stroke-linecap="round" fill="none"/>`;
  } else if (model === 3) {
    hairBack = `<ellipse cx="62" cy="36" rx="9" ry="15" transform="rotate(-18 62 36)" fill="${hair}"/>
                <circle cx="57" cy="27" r="3.5" fill="${color}"/>`;
    hairFront = `<path d="M32 28 Q32 41 34 45" stroke="${hair}" stroke-width="4" stroke-linecap="round" fill="none"/>
                 <path d="M58 28 Q58 41 56 45" stroke="${hair}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
  } else {
    hairBack = `<rect x="30" y="22" width="30" height="19" rx="10" fill="${hair}"/>`;
  }

  // 帽子SVG
  let hatSvg = "";
  if (model === 2 || model === 3) {
    hatSvg = `<path d="M31 27 C31 14, 59 14, 59 27 Z" fill="${hatColor}"/>
              <rect x="29" y="24" width="38" height="5" rx="2.5" fill="${hatColor}"/>
              <rect x="40" y="18" width="10" height="4" rx="1.5" fill="${bandColor}"/>`;
  } else if (model === 1) {
    hatSvg = `<ellipse cx="45" cy="25" rx="26" ry="5" fill="${hatColor}"/>
              <rect x="32" y="13" width="26" height="12" rx="6" fill="${hatColor}"/>
              <rect x="32" y="21" width="26" height="3.5" fill="${bandColor}"/>`;
  } else {
    hatSvg = `<ellipse cx="45" cy="25" rx="22" ry="4.5" fill="${hatColor}"/>
              <rect x="32" y="13" width="26" height="12" rx="5" fill="${hatColor}"/>
              <rect x="32" y="21" width="26" height="3.5" fill="${bandColor}"/>`;
  }

  // 胴体・脚シルエット
  const bodySvg = slim
    ? `<rect x="35" y="48" width="20" height="26" rx="6" fill="${color}"/>
       <rect x="42" y="48" width="6" height="24" fill="#f8fafc" opacity="0.88"/>
       <rect x="27" y="50" width="7" height="22" rx="3.5" fill="#f8fafc"/>
       <rect x="56" y="50" width="7" height="22" rx="3.5" fill="#f8fafc"/>
       <circle cx="30.5" cy="74" r="3.5" fill="#f7cfa0"/>
       <circle cx="59.5" cy="74" r="3.5" fill="#f7cfa0"/>
       ${model === 1
         ? `<path d="M34 72 L56 72 L62 93 L28 93 Z" fill="#3b485b"/>`
         : `<path d="M34 72 L56 72 L59 87 L31 87 Z" fill="#3b485b"/>`}
       <rect x="36" y="${model === 1 ? 92 : 86}" width="6" height="${model === 1 ? 14 : 20}" rx="3" fill="#f7cfa0"/>
       <rect x="48" y="${model === 1 ? 92 : 86}" width="6" height="${model === 1 ? 14 : 20}" rx="3" fill="#f7cfa0"/>
       <rect x="35" y="102" width="8" height="14" rx="3" fill="${bootColor}"/>
       <rect x="47" y="102" width="8" height="14" rx="3" fill="${bootColor}"/>`
    : `<rect x="30" y="48" width="30" height="30" rx="6" fill="${color}"/>
       <rect x="42" y="48" width="6" height="28" fill="#f8fafc" opacity="0.88"/>
       <rect x="33" y="56" width="7" height="7" rx="1.5" fill="#1e293b" opacity="0.7"/>
       <rect x="50" y="56" width="7" height="7" rx="1.5" fill="#1e293b" opacity="0.7"/>
       <rect x="22" y="49" width="8" height="25" rx="4" fill="#f8fafc"/>
       <rect x="60" y="49" width="8" height="25" rx="4" fill="#f8fafc"/>
       <circle cx="26" cy="76" r="4" fill="#f7cfa0"/>
       <circle cx="64" cy="76" r="4" fill="#f7cfa0"/>
       <rect x="33" y="77" width="10" height="26" rx="4" fill="#334155"/>
       <rect x="47" y="77" width="10" height="26" rx="4" fill="#334155"/>
       <rect x="32" y="99" width="12" height="17" rx="3.5" fill="${bootColor}"/>
       <rect x="46" y="99" width="12" height="17" rx="3.5" fill="${bootColor}"/>`;

  return `<svg viewBox="0 0 90 122" style="width:100%;height:96px;display:block;pointer-events:none;">
    ${hairBack}
    <rect x="41" y="42" width="8" height="8" rx="3" fill="#f7cfa0"/>
    <circle cx="45" cy="33" r="${slim ? 12.5 : 13}" fill="#f7cfa0"/>
    <circle cx="40" cy="34" r="${slim ? 1.8 : 1.6}" fill="#111827"/>
    <circle cx="50" cy="34" r="${slim ? 1.8 : 1.6}" fill="#111827"/>
    ${slim ? `<circle cx="36.5" cy="37" r="2.1" fill="#f4a59c" opacity="0.55"/><circle cx="53.5" cy="37" r="2.1" fill="#f4a59c" opacity="0.55"/>` : ""}
    ${hairFront}
    ${hatSvg}
    ${bodySvg}
  </svg>`;
}

function buildAvatarPickerHtml(prefix, state) {
  const modelsHtml = [0, 1, 2, 3].map((m) => {
    const act = state.model === m;
    return `<button type="button" data-avm="${m}" style="padding:4px 2px;border-radius:10px;border:2px solid ${act ? "#38bdf8" : "rgba(255,255,255,0.14)"};background:${act ? "rgba(56,189,248,0.2)" : "rgba(15,23,42,0.72)"};cursor:pointer;">
      ${renderAvatarPreviewSvg(m, state.color, state.hair)}
    </button>`;
  }).join("");

  const colorDots = AVATAR_COLORS.map((c) => {
    const act = state.color === c;
    return `<button type="button" data-avc="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};border:${act ? "3px solid #ffffff" : "2px solid rgba(255,255,255,0.28)"};box-shadow:${act ? "0 0 0 2px #38bdf8" : "none"};cursor:pointer;padding:0;"></button>`;
  }).join("");

  const hairDots = AVATAR_HAIRS.map((h) => {
    const act = state.hair === h;
    return `<button type="button" data-avh="${h}" style="width:22px;height:22px;border-radius:50%;background:${h};border:${act ? "3px solid #ffffff" : "2px solid rgba(255,255,255,0.28)"};box-shadow:${act ? "0 0 0 2px #38bdf8" : "none"};cursor:pointer;padding:0;"></button>`;
  }).join("");

  return `
    <div id="${prefix}-picker" style="margin:6px 0 10px;">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px;">${modelsHtml}</div>
      <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:7px;margin-bottom:6px;">${colorDots}</div>
      <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:7px;">${hairDots}</div>
    </div>
  `;
}

function mountAvatarPicker(containerEl, prefix, state, onChange) {
  const draw = () => {
    containerEl.innerHTML = buildAvatarPickerHtml(prefix, state);
    containerEl.querySelectorAll("[data-avm]").forEach((b) => {
      b.onclick = () => { state.model = Number(b.dataset.avm); draw(); onChange?.(state); };
    });
    containerEl.querySelectorAll("[data-avc]").forEach((b) => {
      b.onclick = () => { state.color = b.dataset.avc; draw(); onChange?.(state); };
    });
    containerEl.querySelectorAll("[data-avh]").forEach((b) => {
      b.onclick = () => { state.hair = b.dataset.avh; draw(); onChange?.(state); };
    });
  };
  draw();
}

function openNewAvatarPickerModal(onConfirm) {
  const draft = { model: 0, color: "#0284c7", hair: "#261c16" };
  openModal("✨", `
    <div class="bank-box" style="text-align:center;">
      <div id="new-av-host"></div>
      <button type="button" id="btn-new-av-ok" class="btn-primary" style="width:100%;height:46px;font-size:1rem;margin-top:6px;">✔</button>
    </div>
  `);
  mountAvatarPicker($("new-av-host"), "newav", draft);
  $("btn-new-av-ok").onclick = () => {
    audioEngine.playOk?.();
    closeModal();
    onConfirm({ ...draft });
  };
}

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

  wrap.querySelectorAll("[data-play]").forEach((btn) => { btn.onclick = async () => { audioEngine.unlock(); startSlot(Number(btn.dataset.play)); }; });
  wrap.querySelectorAll("[data-new]").forEach((btn) => {
    btn.onclick = async () => {
      audioEngine.unlock();
      const idx = Number(btn.dataset.new);
      let name = "";
      while (true) {
        const input = prompt("漁師の名前を入力してください（他の人と同じ名前は使えません）", `漁師${idx + 1}`);
        if (input === null) return;
        const res = await reserveUniqueName(input, "", idx);
        if (res.ok) { name = res.name; break; }
        alert("⚠️ " + res.reason);
      }
      openNewAvatarPickerModal((pickedAvatar) => {
        const ns = createNewSave(name.slice(0, 12));
        ns.avatar = pickedAvatar;
        slots[idx] = ns;
        persistSlots(slots, true);
        startSlot(idx);
      });
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
    yaw: save.worldPos.yaw || 0, isBoating: canBoat, boatSpeed: boat.speed || 1.2, boatTier: boat.tier, avatar: ensureAvatarState(save), name: save.name
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
    yaw: Number((scene3d.getAvatarYaw ? scene3d.getAvatarYaw() : scene3d.yaw).toFixed(2)),
    isBoating: scene3d.isBoating,
    avatar: ensureAvatarState(save),
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
  const netCastCheck = canCastFrom(scene3d.pos.x, scene3d.pos.y, scene3d.yaw, scene3d.isBoating);
  if (!netCastCheck.ok) {
    $("status-banner").textContent = netCastCheck.msg.replace("釣れません", "投網できません");
    audioEngine.playFail();
    return;
  }
  const { coolerCap } = getEquippedStats(save);
  if (save.cooler.length >= coolerCap) { $("status-banner").textContent = "🧊 クーラーボックスがいっぱいです！"; audioEngine.playFail(); return; }
  const { net } = getEquippedStats(save);
  if (!net || net.tier <= 0) { $("status-banner").textContent = "🕸️ 網を持っていません！🏪道具屋で買おう"; audioEngine.playFail(); return; }
  if (save.stamina < 5) { $("status-banner").textContent = "⚡ スタミナ不足（網漁は⚡5必要）！"; audioEngine.playFail(); return; }

  
  save.lastPlayedAt = Date.now();
  audioEngine.playNetThrow();
  updateHud();

  const areaId = currentArea?.id || "teibou";
  const inHotspot = scene3d.getNearestHotspot().inSpot;
  const together = playMode === "multi" && scene3d.getNearbyPlayers(35).length > 0;
  const buff = getActiveBuff(save);

  const previewHaul = rollNetHaul(areaId, env, net, inHotspot || together || buff?.rareBonus);
  const rankScore = (r) => {
    const s = String(r || "C").toUpperCase();
    if (s.includes("SS") || s.includes("UR") || s.includes("LR")) return 4;
    if (s.startsWith("S")) return 3;
    if (s.startsWith("A")) return 2;
    if (s.startsWith("B")) return 1;
    return 0;
  };
  let topLevel = 0;
  let topRankLabel = "C";
  previewHaul.forEach((it) => {
    const sc = rankScore(it?.species?.rank);
    if (sc >= topLevel) {
      topLevel = sc;
      topRankLabel = String(it?.species?.rank || "C");
    }
  });

  runNetThrowMiniGame({
      onPhase2: () => consumeHarvestPhase2Stamina(5, "投網"),
    title: `🕸️ 投網＆引き上げ勝負（${net.name}）`,
    net,
    rarityLevel: topLevel,
    rarityLabel: topRankLabel,
    fishCount: previewHaul.length,
    onFinish: (quality) => {
      if (quality === "miss") {
        $("status-banner").textContent = "💨 網のタイミングか引き上げに失敗し、魚群に逃げられてしまった…";
        audioEngine.playFail();
        persistSlots(slots, false);
        updateHud();
        return;
      }
      let haul = previewHaul;
      if (quality === "great") {
        const extra = rollNetHaul(areaId, env, net, true);
        if (extra.length > haul.length) haul = extra;
      }
      if (!haul.length) { $("status-banner").textContent = "ここでは網に入らなかった…"; updateHud(); return; }

      const kept = haul.slice(0, Math.max(0, coolerCap - save.cooler.length));
      const qMult = quality === "great" ? 1.25 : 1.0;
      let totalPrice = 0;
      kept.forEach((item) => {
        const sp = item.species;
        let mult = (together ? 1.1 : 1) * (buff?.priceMult || 1) * (isMonthlyPassActive(save) ? 1.1 : 1) * qMult;
        const price = Math.round(item.estimatedPrice * mult);
        const tags = [...item.tags];
        if (together) tags.push("一緒に釣り+10%");
        if (quality === "great") tags.push("完璧引き上げ+25%");
        item.estimatedPrice = price; item.tags = tags;

        save.cooler.push({ id: sp.id, name: sp.name, rank: sp.rank, weightKg: item.weightKg, tags, price });
        if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
        save.dex[sp.id].count += 1; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, item.weightKg);
        save.stats.totalCaught += 1; totalPrice += price;
        submitDailyBoard("biggest_weight", { playerName: save.name, score: item.weightKg, detail: sp.name });
        submitDailyBoard("highest_price", { playerName: save.name, score: price, detail: sp.name });
      });
      if (playMode === "multi" && kept.length >= 2) {
        pushWorldFeed({ text: `🕸️ ${save.name}さんが ${net.name}で [${topRankLabel}]含む${kept.length}匹を大漁水揚げ！` });
      }
      audioEngine.playCatch(topLevel >= 2 ? "A" : "C");
      $("status-banner").textContent = `🕸️ [${topRankLabel}級魚群] ${kept.length}匹 水揚げ！（合計 ¥${totalPrice.toLocaleString()}）`;
      persistSlots(slots, false);
      updateHud();
    }
  });
}

function doShellHarvest() {
  const _areaLbl = (typeof currentArea !== 'undefined' && currentArea?.name) ? currentArea.name : '岸壁・岩場';
  runShellPhase1BeforePhase2(_areaLbl, 2, () => {

  const save = currentSave();
  if (!save || phase !== "idle") return;
  const shellPosCheck = canHarvestShellAt(scene3d.pos.x, scene3d.pos.y, scene3d.isBoating);
  if (!shellPosCheck.ok) {
    $("status-banner").textContent = shellPosCheck.msg;
    audioEngine.playFail();
    return;
  }
  const { coolerCap } = getEquippedStats(save);
  if (save.cooler.length >= coolerCap) { $("status-banner").textContent = "🧊 クーラーボックスがいっぱいです！"; audioEngine.playFail(); return; }
  if (save.stamina < 3) { $("status-banner").textContent = "⚡ スタミナ不足（貝採取は⚡3必要）！"; audioEngine.playFail(); return; }

  const areaId = currentArea?.id || "teibou";
  const methodLabel = getShellMethodForArea(areaId);
  
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
      let res = rollShellfish(areaId, env, (getEquippedStats(save).shellBonus || 1) * (buff?.rareBonus ? 1.25 : 1) * qBonus); if (!res && window.__shellSpotBonus?.grade === "rich") { res = rollShellfish(areaId, env, (getEquippedStats(save).shellBonus || 1) * (buff?.rareBonus ? 1.25 : 1) * qBonus); }
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
  });
}
function startCast() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  const castCheck = canCastFrom(scene3d.pos.x, scene3d.pos.y, scene3d.yaw, scene3d.isBoating);
  if (!castCheck.ok) {
    $("status-banner").textContent = castCheck.msg;
    audioEngine.playFail();
    return;
  }
  if (save.stamina < 2) { $("status-banner").textContent = "スタミナ不足です（🍜憩いの食堂や休憩所で回復！）"; audioEngine.playFail(); return; }
  const { bait, baitAttract } = getEquippedStats(save);
  if (bait.pack > 0 && save.baitStock[bait.id] > 0) save.baitStock[bait.id] -= 1;

  save.lastPlayedAt = Date.now(); persistSlots(slots, false); updateHud(); audioEngine.playCast();
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
    $("btn-main-action").className = "btn-action bite"; $("btn-main-action").textContent = "合わせる";
    $("status-banner").textContent = "ヒット！！今すぐタップしてアワセろ！";
    biteTimer = setTimeout(() => { if (phase === "bite") { audioEngine.playFail(); $("status-banner").textContent = "逃げられてしまった…"; setTimeout(resetActionState, 900); } }, 1800);
  }, waitMs);
}

function startFight() {
  if (typeof consumeStrikeStaminaOnAction === 'function') { if (!consumeStrikeStaminaOnAction()) return; }
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
  const favOpts = getAllSpecies().slice(0, 180).map((s) => `<option value="${s.name}" ${save.profile?.favSpecies === s.name ? "selected" : ""}>${s.name}</option>`).join("");
  const draftAvatar = { ...ensureAvatarState(save) };

  openModal("👤 マイプロフィール編集", `
    <div class="bank-box">
      <div class="muted">港の評価 Lv${lv} / 図鑑 ${dexGot}種 / 累計釣果 ${save.stats.totalCaught}匹 ${isMonthlyPassActive(save) ? '<span class="tag purple">🌙パス会員</span>' : ""}</div>
      <div id="prof-avatar-host"></div>
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

  mountAvatarPicker($("prof-avatar-host"), "profav", draftAvatar, (st) => {
    scene3d?.setLocalAvatar?.(st, save.name);
  });

  $("prof-back").onclick = () => {
    scene3d?.setLocalAvatar?.(ensureAvatarState(save), save.name);
    closeModal();
  };
  $("prof-save").onclick = async () => {
    const newName = ($("prof-name").value || "").trim().slice(0, 12);
    if (newName && newName !== save.name) {
      const nRes = await reserveUniqueName(newName, save.name, activeSlotIndex);
      if (!nRes.ok) {
        alert("⚠️ " + nRes.reason);
        return;
      }
      save.name = nRes.name;
    }
    save.avatar = { ...draftAvatar };
    scene3d?.setLocalAvatar?.(save.avatar, save.name);
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
let activeBizSubTab = "floor"; // "floor" | "stock" | "manage"

function openBusinessModal() {
  const save = currentSave();
  syncBusinessProgress(save, env);
  const def = BUSINESS_DEFS.find((b) => b.id === activeBizTab) || BUSINESS_DEFS[0];
  const st = ensureBizState(save.businesses[def.id]);
  const open = isBusinessOpen(st);
  const remainH = st.rentExpiresAt > Date.now() ? Math.ceil((st.rentExpiresAt - Date.now()) / 3600000) : 0;
  const tabsHtml = BUSINESS_DEFS.map((b) => `<button class="shop-tab ${b.id === def.id ? "active" : ""}" data-biz-tab="${b.id}">${b.icon}${b.name.slice(0, 3)}${(save.businesses[b.id]?.pendingRevenue || 0) >= 500 ? "●" : ""}</button>`).join("");

  let bodyHtml = "";
  if (!open) {
    bodyHtml = `
      <div class="bank-box">
        <strong>${def.icon} ${def.name}（未開業）</strong>
        <div class="muted">${def.desc}</div>
        <div class="btn-row" style="margin-top:6px;">
          <button class="btn-warn" id="biz-rent">1日賃貸 ¥${def.rentPrice.toLocaleString()}</button>
          <button class="btn-primary" id="biz-buy">店舗を購入 ¥${def.buyPrice.toLocaleString()}</button>
        </div>
      </div>`;
  } else {
    const m = getBizMetrics(def, st, save, env);
    const statusBadge = st.owned ? `<span class="tag gold">所有店舗</span>` : `<span class="tag">賃貸中(残${remainH}h)</span>`;
    const totalPop = def.isAquarium ? st.stock.reduce((s, x) => s + (x.pop || 20), 0) : 0;
    const starTxt = `★${st.rating.toFixed(2)}${m.isFamous ? " 🌟名店" : ""}`;
    const subTabsHtml = `
      <div class="shop-tabs" style="margin:6px 0;">
        <button class="shop-tab ${activeBizSubTab === "floor" ? "active" : ""}" data-bsub="floor">🍽️ 店頭営業</button>
        <button class="shop-tab ${activeBizSubTab === "stock" ? "active" : ""}" data-bsub="stock">🧊 仕込み/鮮度</button>
        <button class="shop-tab ${activeBizSubTab === "manage" ? "active" : ""}" data-bsub="manage">📈 戦略/設備</button>
      </div>`;

    let subBody = "";
    if (activeBizSubTab === "floor") {
      const stockPreview = st.stock.slice(0, 6).map((x) => {
        if (def.isAquarium) return `<span class="tag">${escapeHtml(x.name)}(人気${x.pop})</span>`;
        const fr = getItemFreshness(x, st.coolingLv, st.lastIceAt);
        const fe = getFreshnessEffect(def.id, fr);
        return `<span class="tag" style="border-color:${fe.color};">${escapeHtml(x.name)} ${fr}%</span>`;
      }).join("") || `<span class="muted">まだ在庫がありません。「おまかせ仕込み」で投入しよう！</span>`;

      subBody = `
        <div class="bank-box">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <div>
              ${statusBadge} <span class="tag" id="biz-rating-badge">${starTxt}</span>
              <div style="margin-top:4px;">純利益金庫: <strong id="biz-pending-val" style="color:#f3c687;font-size:1.05rem;">¥${st.pendingRevenue.toLocaleString()}</strong></div>
            </div>
            <button class="btn-primary" id="biz-collect" ${st.pendingRevenue <= 0 ? "disabled" : ""}>💰 回収</button>
          </div>
          <div class="muted" id="biz-live-sub" style="margin-top:4px;">
            ${m.peakLabel} / 回転: 約${Math.round(m.effectiveIntervalSec)}秒 / 経費率: ${Math.round(m.expenseRate * 100)}%
          </div>
          <div class="muted" id="biz-profit-line">
            直近収支: 売上¥${(st.lastGross || 0).toLocaleString()} − 経費¥${(st.lastExpense || 0).toLocaleString()} / 累計 ¥${st.totalRevenue.toLocaleString()}
          </div>
          <div class="btn-row" style="margin-top:6px;">
            <button class="btn-primary" id="biz-omakase" style="flex:1;">🍣 ${def.isAquarium ? "おまかせ展示" : "大将のおまかせ仕込み"}</button>
            <button class="btn-warn" id="biz-rush">⚡ ラッシュ(12秒)</button>
          </div>
          <div style="margin-top:6px;">${stockPreview}</div>
        </div>`;
    } else if (activeBizSubTab === "stock") {
      const iceBtn = !def.isAquarium
        ? `<button class="btn-sub" id="biz-ice">❄️ 砕氷補充 ¥800（鮮度回復＆保冷${m.iceActive ? "・保冷中" : ""}）</button>`
        : "";
      const bizCoolerIndexed = save.cooler.map((c, idx) => ({ c, idx }));
      const bizCoolerFiltered = bizCoolerRankFilter === "all" ? bizCoolerIndexed : bizCoolerIndexed.filter((e) => e.c.rank === bizCoolerRankFilter);
      const bizRankBar = save.cooler.length ? buildRankFilterBarHtml("data-biz-rk", bizCoolerRankFilter, save.cooler) : "";
      const coolerRows = bizCoolerFiltered.length
        ? bizCoolerFiltered.slice(0, 20).map(({ c, idx }) => `
            <div class="list-row">
              <div><strong class="rank-${c.rank}">[${c.rank}] ${escapeHtml(c.name)}</strong> <span class="muted">${c.weightKg}kg / ¥${(c.price || 0).toLocaleString()}</span></div>
              <button class="btn-mini" data-biz-pick="${idx}">${def.isAquarium ? "展示" : "仕込む"}</button>
            </div>`).join("")
        : `<div class="muted">クーラーボックスは空です。海で釣ってこよう！</div>`;
      const curStockRows = st.stock.slice(0, 10).map((x) => {
        if (def.isAquarium) return `<div class="list-row"><span>🐠 ${escapeHtml(x.name)}</span><span class="tag">人気 ${x.pop}</span></div>`;
        const fr = getItemFreshness(x, st.coolingLv, st.lastIceAt);
        const fe = getFreshnessEffect(def.id, fr);
        return `<div class="list-row"><span>${escapeHtml(x.name)} <span class="muted">(基準¥${(x.salePrice || 0).toLocaleString()})</span></span><span class="tag" style="color:${fe.color};">${fe.label} ${fr}%</span></div>`;
      }).join("") || `<div class="muted">店頭在庫なし</div>`;

      subBody = `
        <div class="bank-box">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${def.isAquarium ? "🐠 水槽展示管理" : `🧊 鮮度＆仕込み管理（平均鮮度 ${m.avgFreshness}%）`}</strong>
            <span class="muted">${st.stock.length}/${m.stockCap}</span>
          </div>
          <div class="btn-row" style="margin:6px 0;">
            <button class="btn-primary" id="biz-omakase" style="flex:1;">🍣 ${def.isAquarium ? "おまかせ展示" : "おまかせ仕込み"}</button>
            ${iceBtn}
          </div>
          <div style="font-size:12px;font-weight:700;margin-top:6px;">📦 クーラーから選んで仕込む（計${save.cooler.length}点）</div>
          ${bizRankBar}
          <div style="max-height:145px;overflow-y:auto;">${coolerRows}</div>
          <div style="font-size:12px;font-weight:700;margin-top:8px;">🏪 現在の店頭ストック</div>
          <div style="max-height:110px;overflow-y:auto;">${curStockRows}</div>
        </div>`;
    } else {
      const stratBtns = !def.isAquarium ? `
        <div class="bank-box">
          <strong>💴 価格戦略（値付け方針）</strong>
          <div class="btn-row" style="margin-top:4px;">
            ${Object.values(PRICE_STRATEGIES).map((p) => `<button class="${st.priceStrategy === p.id ? "btn-primary" : "btn-sub"}" data-biz-strat="${p.id}" style="flex:1;">${p.label}</button>`).join("")}
          </div>
          <div class="muted" style="margin-top:4px;">${m.strat.desc}</div>
        </div>` : "";

      const upgRows = Object.entries(BIZ_UPGRADES).map(([kind, u]) => {
        const lv = st[u.key] || 1;
        const cost = getUpgradeCost(def, kind, lv);
        const maxed = lv >= u.maxLv;
        return `
          <div class="list-row" style="align-items:flex-start;">
            <div style="flex:1;">
              <strong>${u.label} Lv.${lv}/${u.maxLv}</strong>
              <div class="muted" style="font-size:11px;">${u.desc}</div>
            </div>
            <button class="${maxed ? "btn-sub" : "btn-warn"}" data-biz-upg="${kind}" ${maxed ? "disabled" : ""}>${maxed ? "MAX" : `¥${cost.toLocaleString()}`}</button>
          </div>`;
      }).join("");

      subBody = `
        ${stratBtns}
        <div class="bank-box">
          <strong>🛠️ 店舗設備・スタッフ投資</strong>
          <div class="muted" style="font-size:11px;">内装Lvを上げると2.5D店内の照明や装飾もグレードアップします</div>
          ${upgRows}
        </div>
        ${!st.owned ? `<button class="btn-sub" id="biz-buy">この店舗を買い取る（¥${def.buyPrice.toLocaleString()}）</button>` : ""}`;
    }

    bodyHtml = `
      <div class="shop-canvas-wrap" style="position:relative;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.14);">
        <canvas id="shop-view-canvas" width="420" height="232" style="width:100%;height:auto;display:block;cursor:pointer;touch-action:manipulation;"></canvas>
        <div class="shop-view-overlay">
          <span>${def.icon} ${def.name} <strong id="biz-top-star" style="color:#ffd166;">★${st.rating.toFixed(1)}</strong></span>
          <span id="biz-top-stock">${def.isAquarium ? `人気 ${totalPop} / 展示 ${st.stock.length}/${m.stockCap}` : `在庫 ${st.stock.length}/${m.stockCap} / 鮮度${m.avgFreshness}%`}</span>
        </div>
      </div>
      ${subTabsHtml}
      ${subBody}
    `;
  }

  openModal(`🏪 店舗経営（所持 ¥${save.money.toLocaleString()}）`, `<div class="shop-tabs">${tabsHtml}</div>${bodyHtml}<button class="btn-mini" id="biz-back-office" style="padding:8px;margin-top:6px;">← 事務所へ戻る</button>`);
  $("biz-back-office").onclick = openOfficeModal;
  $("modal-body").querySelectorAll("[data-biz-tab]").forEach((btn) => { btn.onclick = () => { activeBizTab = btn.dataset.bizTab; openBusinessModal(); }; });
  $("modal-body").querySelectorAll("[data-bsub]").forEach((btn) => { btn.onclick = () => { activeBizSubTab = btn.dataset.bsub; openBusinessModal(); }; });

  if ($("biz-rent")) $("biz-rent").onclick = () => {
    if (save.money < def.rentPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
    save.money -= def.rentPrice; st.rentExpiresAt = Date.now() + 86400000; st.lastTickAt = Date.now();
    persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBusinessModal();
  };
  if ($("biz-buy")) $("biz-buy").onclick = () => {
    if (save.money < def.buyPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
    save.money -= def.buyPrice; st.owned = true; st.lastTickAt = Date.now(); save.reputation += 12;
    pushWorldFeed({ text: `🏪 ${save.name}さんが「${def.name}」のオーナーになった！` });
    persistSlots(slots, true); updateHud(); audioEngine.playCatch("S"); openBusinessModal();
  };

  if (open) {
    const syncLiveDom = () => {
      const m2 = getBizMetrics(def, st, save, env);
      const totalPop2 = def.isAquarium ? st.stock.reduce((s, x) => s + (x.pop || 20), 0) : 0;
      if ($("biz-pending-val")) $("biz-pending-val").textContent = `¥${st.pendingRevenue.toLocaleString()}`;
      if ($("biz-collect")) $("biz-collect").disabled = st.pendingRevenue <= 0;
      if ($("biz-rating-badge")) $("biz-rating-badge").textContent = `★${st.rating.toFixed(2)}${m2.isFamous ? " 🌟名店" : ""}`;
      if ($("biz-top-star")) $("biz-top-star").textContent = `★${st.rating.toFixed(1)}`;
      if ($("biz-top-stock")) $("biz-top-stock").textContent = def.isAquarium
        ? `人気 ${totalPop2} / 展示 ${st.stock.length}/${m2.stockCap}`
        : `在庫 ${st.stock.length}/${m2.stockCap} / 鮮度${m2.avgFreshness}%`;
      if ($("biz-profit-line")) $("biz-profit-line").textContent =
        `直近収支: 売上¥${(st.lastGross || 0).toLocaleString()} − 経費¥${(st.lastExpense || 0).toLocaleString()} / 累計 ¥${st.totalRevenue.toLocaleString()}`;
    };

    const viewCtrl = startShopView($("shop-view-canvas"), {
      bizDef: def,
      bizState: st,
      onServeGuest: ({ isRush, combo }) => {
        const res = serveGuestOrder(save, def, env, { isRush, combo });
        if (res.ok) {
          persistSlots(slots, false);
          syncLiveDom();
        }
        return res;
      },
      onRushSale: () => {
        const res = serveGuestOrder(save, def, env, { isRush: true, combo: 2 });
        if (res.ok) {
          persistSlots(slots, false);
          syncLiveDom();
          return res.net;
        }
        return 0;
      }
    });

    if ($("biz-omakase")) $("biz-omakase").onclick = () => {
      const res = autoOmakaseStock(save, def.id, getSpeciesMap());
      if (res.moved > 0) { persistSlots(slots, true); updateHud(); audioEngine.playOk(); openBusinessModal(); }
      else { audioEngine.playFail(); alert(res.msg); }
    };
    if ($("biz-collect")) $("biz-collect").onclick = () => {
      if (st.pendingRevenue <= 0) return;
      const rev = st.pendingRevenue; save.money += rev; save.stats.totalEarned += rev; st.pendingRevenue = 0;
      recordDailyProgress(save, { earnedDelta: rev }); persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBusinessModal();
    };
    if ($("biz-rush")) $("biz-rush").onclick = () => {
      if (!st.stock.length) { audioEngine.playFail(); alert("先に「おまかせ」でネタを投入しよう！"); return; }
      audioEngine.playOk(); viewCtrl.triggerRush();
    };
    if ($("biz-ice")) $("biz-ice").onclick = () => {
      const res = refreshBizIce(save, def.id);
      if (!res.ok) { audioEngine.playFail(); alert(res.msg); return; }
      persistSlots(slots, true); updateHud(); audioEngine.playOk(); openBusinessModal();
    };
    $("modal-body").querySelectorAll("[data-biz-pick]").forEach((btn) => {
      btn.onclick = () => {
        const res = stockSingleToBiz(save, def.id, Number(btn.dataset.bizPick), getSpeciesMap());
        if (!res.ok) { audioEngine.playFail(); alert(res.msg); return; }
        persistSlots(slots, true); updateHud(); audioEngine.playOk(); openBusinessModal();
      };
    });
    $("modal-body").querySelectorAll("[data-biz-strat]").forEach((btn) => {
      btn.onclick = () => {
        st.priceStrategy = btn.dataset.bizStrat;
        persistSlots(slots, true); audioEngine.playOk(); openBusinessModal();
      };
    });
    $("modal-body").querySelectorAll("[data-biz-upg]").forEach((btn) => {
      btn.onclick = () => {
        const res = upgradeBizFacility(save, def.id, btn.dataset.bizUpg);
        if (!res.ok) { audioEngine.playFail(); alert(res.msg); return; }
        persistSlots(slots, true); updateHud(); audioEngine.playCash(); openBusinessModal();
      };
    });
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
  const sorted = [...farmable].sort((a, b) => a.farmSeedPrice - b.farmSeedPrice);
  let curRank = "all";
  let query = "";

  openModal(`🌱 生け簀 #${slotIdx + 1} の種苗を選ぶ`, `
    <input id="seed-search" class="field-input" placeholder="名前で検索（例: タイ / アサリ / コンブ）" style="margin-bottom:4px;padding:6px 8px;font-size:12px;" />
    <div id="seed-rank-bar"></div>
    <div id="seed-list" style="max-height:52vh;overflow-y:auto;"></div>
    <button class="btn-mini" id="seed-back" style="padding:8px;margin-top:6px;">← 養殖場へ戻る</button>
  `);

  const renderSeeds = () => {
    const q = query.trim().toLowerCase();
    const list = sorted.filter((sp) => {
      if (curRank !== "all" && sp.rank !== curRank) return false;
      if (q && !`${sp.name} ${sp.kana || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const rb = $("seed-rank-bar");
    if (rb) {
      rb.innerHTML = buildRankFilterBarHtml("data-seed-rk", curRank, sorted);
      rb.querySelectorAll("[data-seed-rk]").forEach((b) => {
        b.onclick = () => { curRank = b.dataset.seedRk; renderSeeds(); };
      });
    }

    const listEl = $("seed-list");
    if (!listEl) return;
    if (!list.length) {
      listEl.innerHTML = `<div class="muted" style="text-align:center;padding:18px;">該当する種苗がありません</div>`;
      return;
    }
    listEl.innerHTML = list.slice(0, 120).map((sp) => `
      <div class="list-row">
        <div>
          <strong class="rank-${sp.rank}">[${sp.rank}] ${escapeHtml(sp.name)}</strong>
          <span class="tag">${sp.speciesType === "shellfish" ? "🦪垂下" : sp.speciesType === "seaweed" ? "🌿海藻" : "🐟生け簀"}</span>
          <div class="muted">育成時間: 約${Math.round(getFarmDurationMs(sp, isMonthlyPassActive(save)) / 60000)}分 / 市場目安 ¥${sp.basePricePerKg}/kg</div>
        </div>
        <button class="btn-primary" data-pick-seed="${sp.id}">¥${sp.farmSeedPrice.toLocaleString()}</button>
      </div>
    `).join("") + (list.length > 120 ? `<div class="muted" style="text-align:center;padding:6px;font-size:11px;">他 ${list.length - 120}種（検索またはランクで絞り込めます）</div>` : "");

    listEl.querySelectorAll("[data-pick-seed]").forEach((btn) => {
      btn.onclick = () => {
        const sp = getSpeciesById(btn.dataset.pickSeed);
        if (!sp || save.money < sp.farmSeedPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
        save.money -= sp.farmSeedPrice;
        const now = Date.now();
        save.farm.plots[slotIdx] = { speciesId: sp.id, startedAt: now, readyAt: now + getFarmDurationMs(sp, isMonthlyPassActive(save)) };
        persistSlots(slots, true); updateHud(); audioEngine.playCash(); openFarmModal();
      };
    });
  };

  $("seed-back").onclick = openFarmModal;
  $("seed-search").oninput = (e) => { query = e.target.value || ""; renderSeeds(); };
  renderSeeds();
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
  const TIME_LIMIT = 14.0;
  let hits = 0;
  let misses = 0;
  let timeLeft = TIME_LIMIT;
  let finished = false;
  let roundLocked = false;
  let activeSlots = new Map(); // idx -> { type: "shell"|"crab"|"rock" }
  let roundExpireAt = 0;
  let nextRoundAt = performance.now() + 260;
  let lastTick = performance.now();

  const cellsHtml = Array.from({ length: 12 }, (_, i) =>
    `<button type="button" class="shell-cell" data-scell="${i}" style="height:56px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:rgba(15,23,42,0.82);font-size:1.35rem;display:flex;align-items:center;justify-content:center;touch-action:manipulation;user-select:none;transition:transform 0.08s;">·</button>`
  ).join("");

  openModal(title || `🐚 ${methodLabel || "貝採取"}チャレンジ`, `
    <div class="bank-box" style="text-align:center;">
      <div class="muted" style="font-size:12px;">1回ごとに🫧<strong>貝の気泡</strong>を1回タップ！合計${GOAL}回で満額採取</div>
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
      <div id="sh-msg" class="muted" style="margin-top:8px;min-height:18px;font-size:12px;">🫧が出たら1回だけ落ち着いてタップ！</div>
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
        btn.style.background = "rgba(16,185,129,0.32)";
        btn.style.borderColor = "#38e59a";
      } else if (item.type === "crab") {
        btn.textContent = "🦀";
        btn.style.background = "rgba(239,68,68,0.22)";
        btn.style.borderColor = "#f87171";
      } else {
        btn.textContent = "🪨";
        btn.style.background = "rgba(148,163,184,0.20)";
        btn.style.borderColor = "#94a3b8";
      }
    });
  };

  const startNewRound = (now) => {
    activeSlots.clear();
    roundLocked = false;
    const pool = Array.from({ length: 12 }, (_, i) => i);
    const pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];

    // 1ラウンドにつき本物の気泡を必ず1つだけ配置
    activeSlots.set(pick(), { type: "shell" });
    // フェイク（カニ・小石）を1〜2個だけ配置
    const fakeCount = hits >= 2 ? 2 : 1;
    for (let k = 0; k < fakeCount; k++) {
      activeSlots.set(pick(), { type: Math.random() < 0.55 ? "crab" : "rock" });
    }
    // 1回あたりの表示時間はゆっくり1.6〜2.0秒
    const lifeMs = Math.round(1600 + Math.random() * 400);
    roundExpireAt = now + lifeMs;
    nextRoundAt = 0;
    renderCells();
  };

  const queueNextRound = (now, delayMs = 340) => {
    activeSlots.clear();
    roundLocked = true;
    roundExpireAt = 0;
    nextRoundAt = now + delayMs;
    renderCells();
  };

  const gridEl = document.getElementById("sh-grid");
  if (gridEl) {
    gridEl.querySelectorAll("[data-scell]").forEach((btn) => {
      btn.onpointerdown = (ev) => {
        if (ev) ev.preventDefault();
        if (finished || roundLocked || activeSlots.size === 0) return;

        const now = performance.now();
        const idx = Number(btn.dataset.scell);
        const item = activeSlots.get(idx);
        const msgEl = document.getElementById("sh-msg");
        const progEl = document.getElementById("sh-progress");

        if (item && item.type === "shell") {
          hits += 1;
          audioEngine.playDig?.();
          if (progEl) progEl.textContent = `採取: ${hits} / ${GOAL}`;
          if (msgEl) {
            msgEl.style.color = "#38e59a";
            msgEl.textContent = `🐚 ${hits}個目を掘り当てた！（${hits}/${GOAL}）`;
          }
          if (hits >= GOAL) {
            const quality = (misses === 0 || timeLeft >= 4.0) ? "great" : "good";
            finishGame(quality);
            return;
          }
          queueNextRound(now, 340);
        } else {
          misses += 1;
          timeLeft = Math.max(0, timeLeft - (item?.type === "crab" ? 1.0 : 0.7));
          audioEngine.playFail?.();
          if (msgEl) {
            msgEl.style.color = "#ff7b7b";
            msgEl.textContent = item?.type === "crab"
              ? "🦀 カニだった！ -1.0秒（次の気泡を待とう）"
              : item?.type === "rock"
                ? "🪨 小石だった… -0.7秒（次の気泡を待とう）"
                : "💦 空振り！ -0.7秒（🫧を狙おう）";
          }
          queueNextRound(now, 400);
        }
      };
    });
  }

  loopId = setInterval(() => {
    if (finished) return;
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    timeLeft = Math.max(0, timeLeft - dt);

    if (nextRoundAt > 0 && now >= nextRoundAt) {
      startNewRound(now);
    } else if (roundExpireAt > 0 && now >= roundExpireAt) {
      const msgEl = document.getElementById("sh-msg");
      if (msgEl) {
        msgEl.style.color = "#94a3b8";
        msgEl.textContent = "🌊 貝が潜った…次の気泡を探そう！";
      }
      queueNextRound(now, 320);
    }

    const tEl = document.getElementById("sh-timer");
    const barEl = document.getElementById("sh-timebar");
    if (tEl) {
      tEl.textContent = `残り ${timeLeft.toFixed(1)}s`;
      tEl.style.color = timeLeft <= 3.0 ? "#ff7b7b" : "#f3c687";
    }
    if (barEl) barEl.style.width = `${(timeLeft / TIME_LIMIT) * 100}%`;

    if (timeLeft <= 0) {
      finishGame(hits > 0 ? "good" : "miss");
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

function runNetThrowMiniGame({ title, net, rarityLevel = 0, rarityLabel = "C", fishCount = 2, onFinish }) {
  if (phase !== "idle") return;
  phase = "harvesting";

  const tierMap = [
    { name: "一般魚群",   badge: "#38bdf8", icon: "🐟🐟",   spd: 1.18, rad: 16.5, aimSec: 7.4, pullSec: 11.5, gain: 26, rageRise: 48, slipBack: 4,  warnDur: 0.68, turnMin: 0.95 },
    { name: "良型魚群",   badge: "#34d399", icon: "🐠🐟🐠", spd: 1.48, rad: 14.2, aimSec: 6.8, pullSec: 11.2, gain: 23, rageRise: 60, slipBack: 7,  warnDur: 0.56, turnMin: 0.72 },
    { name: "希少魚群",   badge: "#c084fc", icon: "✨🐟✨", spd: 1.85, rad: 12.2, aimSec: 6.2, pullSec: 11.0, gain: 20, rageRise: 74, slipBack: 10, warnDur: 0.45, turnMin: 0.52 },
    { name: "超大物魚群", badge: "#fbbf24", icon: "👑🦈✨", spd: 2.25, rad: 10.6, aimSec: 5.8, pullSec: 10.8, gain: 18, rageRise: 88, slipBack: 13, warnDur: 0.36, turnMin: 0.38 },
    { name: "伝説魚群",   badge: "#f43f5e", icon: "🔥🐉👑", spd: 2.55, rad: 9.6,  aimSec: 5.4, pullSec: 10.6, gain: 16, rageRise: 98, slipBack: 16, warnDur: 0.30, turnMin: 0.30 }
  ];
  const cfg = tierMap[Math.max(0, Math.min(tierMap.length - 1, rarityLevel))];
  const netTier = Math.max(1, Number(net?.tier || 1));

  let finished = false;
  let stage = "aim";
  let aimResult = "good";

  let fishX = 20 + Math.random() * 60;
  let fishY = 22 + Math.random() * 56;
  let vx = (Math.random() < 0.5 ? -1 : 1) * (28 + Math.random() * 14) * cfg.spd;
  let vy = (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 12) * cfg.spd;
  let turnTimer = cfg.turnMin + Math.random() * 0.55;
  let aimTime = cfg.aimSec;
  let throwing = false;
  let throwFlight = 0;
  let throwX = 50, throwY = 50;
  const throwRadius = Math.max(8.5, Math.min(20.5, cfg.rad + (netTier - 1) * 1.1));

  let pullProgress = 0;
  let netTension = 16;
  let pullTime = cfg.pullSec;
  let holding = false;
  let rageState = "calm";
  let stateTimer = 0.95 + Math.random() * 0.45;
  let lastTick = performance.now();
  let loopId = null;

  openModal(title || "🕸️ 投網＆引き上げ勝負", `
    <div class="bank-box" style="text-align:center;">
      <div style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;margin-bottom:6px;background:rgba(15,23,42,0.85);border:1px solid ${cfg.badge};color:${cfg.badge};">
        [${rarityLabel}級] ${cfg.name}（難易度 ★${Math.min(5, rarityLevel + 2)}）
      </div>
      <div id="net-stage-desc" class="muted" style="font-size:12px;">【第1段階】網が飛ぶラグを読んで、魚群の<strong>少し先</strong>をタップ！</div>
      <div id="net-aim-wrap">
        <div id="net-water" style="position:relative;height:178px;margin:10px 0;border-radius:12px;background:radial-gradient(circle at 50% 45%, #0c4a6e, #062135);border:1px solid ${cfg.badge};overflow:hidden;touch-action:manipulation;user-select:none;cursor:crosshair;">
          <div id="net-school" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:1.3rem;letter-spacing:-2px;filter:drop-shadow(0 0 8px ${cfg.badge});pointer-events:none;">${cfg.icon}</div>
          <div id="net-splash" style="position:absolute;left:50%;top:50%;width:${throwRadius * 2}%;aspect-ratio:1/1;border-radius:50%;border:2.5px dashed #facc15;background:rgba(250,204,21,0.16);transform:translate(-50%,-50%) scale(0.3);opacity:0;pointer-events:none;transition:transform 0.22s ease-out, opacity 0.15s;"></div>
        </div>
        <div id="net-aim-timer" style="font-size:13px;font-weight:700;color:#f3c687;margin-bottom:6px;">魚群通過まで ${aimTime.toFixed(1)}s</div>
        <div class="muted" style="font-size:11px;">※レア魚ほど速く急反転します！進路の先を狙おう</div>
      </div>

      <div id="net-pull-wrap" style="display:none;margin-top:8px;">
        <div id="net-rage-badge" style="padding:6px 10px;border-radius:8px;font-weight:800;font-size:13px;margin-bottom:10px;background:rgba(16,185,129,0.2);color:#38e59a;">🌊 今だ！長押しで引き上げろ！</div>
        <div style="text-align:left;font-size:12px;margin-bottom:4px;display:flex;justify-content:space-between;">
          <span>🕸️ 引き上げ進捗</span><strong id="net-prog-txt">0%</strong>
        </div>
        <div style="height:14px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;margin-bottom:10px;">
          <div id="net-prog-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#38bdf8,#38e59a);"></div>
        </div>
        <div style="text-align:left;font-size:12px;margin-bottom:4px;display:flex;justify-content:space-between;">
          <span>⚠️ 網の負荷（100%で破損）</span><strong id="net-tens-txt">16%</strong>
        </div>
        <div style="height:14px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;margin-bottom:10px;">
          <div id="net-tens-bar" style="height:100%;width:16%;background:linear-gradient(90deg,#38e59a,#f59e0b,#ef4444);"></div>
        </div>
        <div id="net-pull-timer" style="font-size:12px;font-weight:700;color:#f3c687;margin-bottom:8px;">残り ${pullTime.toFixed(1)}s</div>
        <button type="button" class="btn-primary" id="btn-net-pull" oncontextmenu="return false;" style="width:100%;height:56px;font-size:1.05rem;touch-action:none;user-select:none;-webkit-user-select:none;">💪 長押しで引き上げ（赤で即離す！）</button>
      </div>
    </div>
  `);

  const origClose = $("btn-close-modal").onclick;
  const endHold = () => { holding = false; };
  const cleanup = () => {
    if (loopId) clearInterval(loopId);
    loopId = null;
    holding = false;
    window.removeEventListener("pointerup", endHold);
    window.removeEventListener("pointercancel", endHold);
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
    pullProgress = hitGrade === "great" ? 18 : 8;
    netTension = 16;
    rageState = "calm";
    stateTimer = Math.max(0.55, 1.05 - rarityLevel * 0.12) + Math.random() * 0.4;
    const desc = document.getElementById("net-stage-desc");
    const aimWrap = document.getElementById("net-aim-wrap");
    const pullWrap = document.getElementById("net-pull-wrap");
    if (desc) desc.innerHTML = hitGrade === "great"
      ? "🎯 <strong>ド真ん中捕捉！</strong>【第2段階】赤で即離しつつ押し戻される前に引き上げろ！"
      : "🕸️ <strong>なんとか包囲！</strong>【第2段階】赤で即離しつつ引き上げろ！";
    if (aimWrap) aimWrap.style.display = "none";
    if (pullWrap) pullWrap.style.display = "block";
    audioEngine.playOk?.();
  };

  const waterEl = document.getElementById("net-water");
  if (waterEl) {
    waterEl.onpointerdown = (ev) => {
      if (finished || stage !== "aim" || throwing) return;
      ev.preventDefault();
      const rect = waterEl.getBoundingClientRect();
      throwX = Math.max(5, Math.min(95, ((ev.clientX - rect.left) / rect.width) * 100));
      throwY = Math.max(5, Math.min(95, ((ev.clientY - rect.top) / rect.height) * 100));
      throwing = true;
      throwFlight = 0.22;
      audioEngine.playNetThrow?.();
      const sp = document.getElementById("net-splash");
      if (sp) {
        sp.style.left = `${throwX}%`;
        sp.style.top = `${throwY}%`;
        sp.style.opacity = "1";
        sp.style.transform = "translate(-50%,-50%) scale(1.0)";
      }
    };
  }

  const pullBtn = document.getElementById("btn-net-pull");
  if (pullBtn) {
    pullBtn.addEventListener("pointerdown", (ev) => {
      if (ev) ev.preventDefault();
      if (stage === "pull") holding = true;
    });
    window.addEventListener("pointerup", endHold);
    window.addEventListener("pointercancel", endHold);
  }

  $("btn-close-modal").onclick = () => {
    if (finished) return;
    finished = true;
    cleanup();
    if (origClose) origClose();
    else closeModal();
  };

  loopId = setInterval(() => {
    if (finished) return;
    const now = performance.now();
    const dt = Math.min(0.08, (now - lastTick) / 1000);
    lastTick = now;

    if (stage === "aim") {
      aimTime = Math.max(0, aimTime - dt);
      turnTimer -= dt;
      if (turnTimer <= 0) {
        turnTimer = cfg.turnMin + Math.random() * (0.65 - Math.min(0.35, rarityLevel * 0.08));
        const angle = Math.random() * Math.PI * 2;
        const mag = (30 + Math.random() * 18) * cfg.spd;
        vx = Math.cos(angle) * mag;
        vy = Math.sin(angle) * mag;
      }

      fishX += vx * dt;
      fishY += vy * dt;
      if (fishX < 8 || fishX > 92) { vx *= -1; fishX = Math.max(8, Math.min(92, fishX)); }
      if (fishY < 10 || fishY > 90) { vy *= -1; fishY = Math.max(10, Math.min(90, fishY)); }

      const fEl = document.getElementById("net-school");
      if (fEl) {
        fEl.style.left = `${fishX}%`;
        fEl.style.top = `${fishY}%`;
        fEl.style.transform = `translate(-50%,-50%) scaleX(${vx < 0 ? 1 : -1})`;
      }
      const tEl = document.getElementById("net-aim-timer");
      if (tEl) tEl.textContent = `魚群通過まで ${aimTime.toFixed(1)}s`;

      if (throwing) {
        throwFlight -= dt;
        if (throwFlight <= 0) {
          const dist = Math.hypot(fishX - throwX, (fishY - throwY) * 0.65);
          if (dist <= throwRadius * 0.56) {
            enterPullStage("great");
          } else if (dist <= throwRadius * 1.02) {
            enterPullStage("good");
          } else {
            finishGame("miss");
          }
          return;
        }
      } else if (aimTime <= 0) {
        finishGame("miss");
      }
    } else if (stage === "pull") {
      pullTime = Math.max(0, pullTime - dt);
      stateTimer -= dt;

      if (stateTimer <= 0) {
        if (rageState === "calm") {
          rageState = "warn";
          stateTimer = cfg.warnDur;
        } else if (rageState === "warn") {
          rageState = "rage";
          stateTimer = 0.72 + Math.random() * (0.45 + rarityLevel * 0.12);
        } else {
          rageState = "calm";
          stateTimer = Math.max(0.55, 1.15 - rarityLevel * 0.12) + Math.random() * 0.55;
        }
      }

      if (holding) {
        if (rageState === "rage") {
          netTension += cfg.rageRise * dt;
          pullProgress += cfg.gain * 0.18 * dt;
        } else if (rageState === "warn") {
          netTension += 22 * dt;
          pullProgress += cfg.gain * 0.85 * dt;
        } else {
          netTension += 7 * dt;
          pullProgress += cfg.gain * dt;
        }
        audioEngine.playReelTick?.(netTension);
      } else {
        netTension = Math.max(0, netTension - (rageState === "rage" ? 30 : 24) * dt);
        pullProgress = Math.max(0, pullProgress - cfg.slipBack * (rageState === "rage" ? 1.25 : 0.7) * dt);
      }

      const badge = document.getElementById("net-rage-badge");
      if (badge) {
        if (rageState === "rage") {
          badge.style.background = "rgba(239,68,68,0.30)";
          badge.style.color = "#ff7b7b";
          badge.textContent = "🚨 魚群が大暴れ！！今すぐ指を離せ！";
        } else if (rageState === "warn") {
          badge.style.background = "rgba(245,158,11,0.28)";
          badge.style.color = "#fbbf24";
          badge.textContent = "⚡ 暴れる予兆！離す準備！";
        } else {
          badge.style.background = "rgba(16,185,129,0.22)";
          badge.style.color = "#38e59a";
          badge.textContent = "🌊 チャンス！長押しで一気に引き上げろ！";
        }
      }

      const pPct = Math.min(100, Math.round(pullProgress));
      const tPct = Math.min(100, Math.round(netTension));
      const pTxt = document.getElementById("net-prog-txt");
      const pBar = document.getElementById("net-prog-bar");
      const tTxt = document.getElementById("net-tens-txt");
      const tBar = document.getElementById("net-tens-bar");
      const tmEl = document.getElementById("net-pull-timer");
      if (pTxt) pTxt.textContent = `${pPct}%`;
      if (pBar) pBar.style.width = `${pPct}%`;
      if (tTxt) tTxt.textContent = `${tPct}%`;
      if (tBar) tBar.style.width = `${tPct}%`;
      if (tmEl) tmEl.textContent = `残り ${pullTime.toFixed(1)}s`;

      if (netTension >= 100 || pullTime <= 0) {
        finishGame("miss");
      } else if (pullProgress >= 100) {
        finishGame(aimResult === "great" && netTension < 72 ? "great" : "good");
      }
    }
  }, 33);
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


// ===== 各魚一覧 共通ランク絞り込み（全て / S / A / B / C / D） =====
let coolerRankFilter = "all";
let bizCoolerRankFilter = "all";

function buildRankFilterBarHtml(attrName, activeRank, items = null) {
  const ranks = ["all", "S", "A", "B", "C", "D"];
  const rankColor = { all: "#38bdf8", S: "#fbbf24", A: "#c084fc", B: "#38bdf8", C: "#34d399", D: "#94a3b8" };
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;">` + ranks.map((rk) => {
    const cnt = items ? (rk === "all" ? items.length : items.filter((x) => x.rank === rk).length) : null;
    const act = activeRank === rk;
    const label = rk === "all" ? "全て" : rk;
    const cntTxt = cnt !== null ? `(${cnt})` : "";
    const col = rankColor[rk];
    return `<button type="button" class="btn-mini" ${attrName}="${rk}" style="padding:4px 8px;font-size:11px;font-weight:700;border:1px solid ${act ? col : "rgba(255,255,255,0.16)"};background:${act ? col : "rgba(15,23,42,0.72)"};color:${act ? "#0f172a" : col};">${label}${cntTxt}</button>`;
  }).join("") + `</div>`;
}

function openCoolerModal() {
  const save = currentSave(), { coolerCap } = getEquippedStats(save);
  if (!save.cooler.length) { openModal(`🧊 クーラーボックス (0/${coolerCap})`, `<p class="muted">まだ魚や貝が入っていません。</p>`); return; }

  const indexed = save.cooler.map((x, idx) => ({ item: x, idx }));
  const filtered = coolerRankFilter === "all" ? indexed : indexed.filter((e) => e.item.rank === coolerRankFilter);
  const totalAll = save.cooler.reduce((s, x) => s + Number(x.price || 0), 0);
  const totalShown = filtered.reduce((s, e) => s + Number(e.item.price || 0), 0);

  const rankBar = buildRankFilterBarHtml("data-cooler-rk", coolerRankFilter, save.cooler);
  const rows = filtered.length
    ? filtered.map(({ item: x, idx }) => `
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
    `).join("")
    : `<div class="muted" style="text-align:center;padding:18px;">このランクの魚・貝は入っていません</div>`;

  const sellLabel = coolerRankFilter === "all"
    ? `一括売却（¥${totalAll.toLocaleString()}）`
    : `${coolerRankFilter}ランクを一括売却（¥${totalShown.toLocaleString()}）`;

  openModal(
    `🧊 クーラーボックス (${save.cooler.length}/${coolerCap})`,
    `<div class="btn-row"><button class="btn-primary" id="btn-sell-all" style="flex:1;" ${filtered.length ? "" : "disabled"}>${sellLabel}</button><button class="btn-sub" id="btn-go-biz">🏪 店舗へ仕込む</button></div>${rankBar}${rows}`
  );

  $("btn-go-biz").onclick = openBusinessModal;
  $("modal-body").querySelectorAll("[data-cooler-rk]").forEach((btn) => {
    btn.onclick = () => { coolerRankFilter = btn.dataset.coolerRk; openCoolerModal(); };
  });
  $("btn-sell-all").onclick = () => {
    if (!filtered.length) return;
    if (coolerRankFilter === "all") {
      save.money += totalAll; save.stats.totalEarned += totalAll; save.cooler = [];
      recordDailyProgress(save, { earnedDelta: totalAll });
    } else {
      const keep = save.cooler.filter((x) => x.rank !== coolerRankFilter);
      save.money += totalShown; save.stats.totalEarned += totalShown; save.cooler = keep;
      recordDailyProgress(save, { earnedDelta: totalShown });
    }
    save.lastPlayedAt = Date.now();
    persistSlots(slots, true); updateHud(); audioEngine.playCash();
    if (save.cooler.length) openCoolerModal(); else closeModal();
  };
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
  const save = currentSave();
  if (!save) return;
  const all = getAllSpecies();
  const dexMap = save.dex || {};
  const caughtCount = Object.keys(dexMap).length;

  let curTab = "all";
  let curRank = "all";
  let curArea = "all";
  let onlyCaught = false;
  let query = "";
  let page = 0;
  const PER_PAGE = 36;

  const AREA_LABELS = {
    all: "全エリア", teibou: "港・堤防", sunahama: "白砂の砂浜", kakou: "清流の河口",
    iso: "荒波の磯場", kinkai: "近海", okiai: "沖合", shinkai: "深海海溝",
    nangoku: "南国サンゴ礁", enyou: "遠洋外海"
  };
  const TYPE_ICON = {
    fish: "🐟", shellfish: "🐚", seaweed: "🌿", crustacean: "🦀", cephalopod: "🦑", echinoderm: "🦔"
  };
  const RANK_COL = { S: "#fbbf24", A: "#c084fc", B: "#38bdf8", C: "#34d399", D: "#94a3b8" };

  const matchTab = (s) => {
    if (curTab === "all") return true;
    if (curTab === "deep") return (s.areas || []).includes("shinkai");
    if (curTab === "offshore") return (s.areas || []).includes("okiai") || (s.areas || []).includes("enyou");
    if (curTab === "fish") return s.speciesType === "fish";
    if (curTab === "shellfish") return s.speciesType === "shellfish";
    if (curTab === "seaweed") return s.speciesType === "seaweed";
    if (curTab === "other") return s.speciesType === "crustacean" || s.speciesType === "cephalopod" || s.speciesType === "echinoderm";
    return true;
  };

  openModal(`📖 生き物図鑑 (${caughtCount.toLocaleString()}/${all.length.toLocaleString()}種)`, `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px;">
      <button class="btn-mini" id="dex-back-office" style="padding:7px 10px;">← 事務所へ戻る</button>
      <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" id="dex-only-caught" /> 発見済みのみ
      </label>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:6px;">
      <input id="dex-search" class="field-input" placeholder="名前・よみで検索（例: マグロ / コンブ / 深海）" style="flex:1;padding:6px 8px;font-size:12px;" />
      <select id="dex-area-sel" class="field-input" style="width:112px;padding:6px 4px;font-size:11px;">
        ${Object.entries(AREA_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
      </select>
    </div>
    <div id="dex-tabs" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
      <button type="button" class="btn-mini" data-dtab="all">全${all.length}</button>
      <button type="button" class="btn-mini" data-dtab="fish">🐟魚類</button>
      <button type="button" class="btn-mini" data-dtab="offshore">🌊沖・遠洋</button>
      <button type="button" class="btn-mini" data-dtab="deep">🌑深海</button>
      <button type="button" class="btn-mini" data-dtab="shellfish">🐚貝類</button>
      <button type="button" class="btn-mini" data-dtab="seaweed">🌿海藻</button>
      <button type="button" class="btn-mini" data-dtab="other">🦀甲殻・他</button>
    </div>
    <div id="dex-rank-bar"></div>
    <div id="dex-meta" class="muted" style="font-size:11px;margin-bottom:6px;"></div>
    <div id="dex-list" style="display:grid;grid-template-columns:1fr;gap:6px;max-height:46vh;overflow-y:auto;padding-right:2px;"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
      <button type="button" class="btn-mini" id="dex-prev" style="padding:7px 14px;">◀ 前へ</button>
      <span id="dex-page-info" style="font-size:12px;font-weight:700;">1 / 1</span>
      <button type="button" class="btn-mini" id="dex-next" style="padding:7px 14px;">次へ ▶</button>
    </div>
  `);

  const renderDex = () => {
    const q = query.trim().toLowerCase();
    const filtered = [];
    let foundInFilter = 0;
    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      if (!matchTab(s)) continue;
      if (curRank !== "all" && s.rank !== curRank) continue;
      if (curArea !== "all" && !(s.areas || []).includes(curArea)) continue;
      const rec = dexMap[s.id];
      if (onlyCaught && !rec) continue;
      if (q) {
        const hay = `${s.name} ${s.kana || ""} ${s.desc || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (rec) foundInFilter++;
      filtered.push(s);
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    page = Math.max(0, Math.min(totalPages - 1, page));
    const slice = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

    const metaEl = $("dex-meta");
    if (metaEl) metaEl.textContent = `表示対象: ${filtered.length.toLocaleString()}種（うち発見済み ${foundInFilter.toLocaleString()}種）`;
    const pEl = $("dex-page-info");
    if (pEl) pEl.textContent = `${page + 1} / ${totalPages}`;
    if ($("dex-prev")) $("dex-prev").disabled = page <= 0;
    if ($("dex-next")) $("dex-next").disabled = page >= totalPages - 1;

    const drb = $("dex-rank-bar");
    if (drb) {
      drb.innerHTML = buildRankFilterBarHtml("data-dex-rk", curRank);
      drb.querySelectorAll("[data-dex-rk]").forEach((b) => {
        b.onclick = () => { curRank = b.dataset.dexRk; page = 0; renderDex(); };
      });
    }
    document.querySelectorAll("#dex-tabs [data-dtab]").forEach((b) => {
      const act = b.dataset.dtab === curTab;
      b.style.background = act ? "#0284c7" : "";
      b.style.color = act ? "#fff" : "";
    });

    const listEl = $("dex-list");
    if (!listEl) return;
    if (!slice.length) {
      listEl.innerHTML = `<div class="muted" style="text-align:center;padding:24px;">該当する生き物がいません</div>`;
      return;
    }
    listEl.innerHTML = slice.map((s) => {
      const rec = dexMap[s.id];
      const icon = TYPE_ICON[s.speciesType] || "🐟";
      const rCol = RANK_COL[s.rank] || "#94a3b8";
      const areaTxt = (s.areas || []).map((a) => AREA_LABELS[a] || a).join("・");
      if (!rec) {
        return `<div style="padding:7px 9px;border-radius:8px;background:rgba(15,23,42,0.52);border:1px solid rgba(255,255,255,0.08);opacity:0.78;">
          <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span>${icon} <span style="color:${rCol};font-weight:800;">[${s.rank}]</span> ？？？？</span>
            <span class="muted" style="font-size:10px;">${areaTxt}</span>
          </div>
        </div>`;
      }
      return `<div style="padding:8px 10px;border-radius:8px;background:rgba(15,23,42,0.82);border:1px solid rgba(56,189,248,0.28);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
          <div style="font-size:13px;font-weight:800;">${icon} <span style="color:${rCol};">[${s.rank}]</span> ${escapeHtml(s.name)}</div>
          <div style="font-size:11px;color:#38e59a;font-weight:700;">最大 ${rec.maxKg}kg / ${rec.count}回</div>
        </div>
        <div class="muted" style="font-size:11px;margin-top:2px;">生息: ${areaTxt} ／ 基準 ¥${(s.basePricePerKg || 0).toLocaleString()}/kg</div>
        <div style="font-size:11px;color:#cbd5e1;margin-top:3px;">${escapeHtml(s.desc || "")}</div>
      </div>`;
    }).join("");
  };

  $("dex-back-office").onclick = openOfficeModal;
  $("dex-only-caught").onchange = (e) => { onlyCaught = e.target.checked; page = 0; renderDex(); };
  $("dex-search").oninput = (e) => { query = e.target.value || ""; page = 0; renderDex(); };
  $("dex-area-sel").onchange = (e) => { curArea = e.target.value; page = 0; renderDex(); };
  document.querySelectorAll("#dex-tabs [data-dtab]").forEach((b) => {
    b.onclick = () => { curTab = b.dataset.dtab; page = 0; renderDex(); };
  });
  $("dex-prev").onclick = () => { if (page > 0) { page--; renderDex(); $("dex-list").scrollTop = 0; } };
  $("dex-next").onclick = () => { page++; renderDex(); $("dex-list").scrollTop = 0; };
  renderDex();
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
  await initFirebase({ onOnlineCount: (n) => { syncTopRightOnlineBadge(Math.min(Number(n) || 1, 1 + Object.keys(remotePlayersCache || {}).length)); }, onStatus: (msg) => { $("sync-status").textContent = msg; } });

  // リアルタイム同期購読
  subscribeWorldPlayers((others) => {
  remotePlayersCache = others;
  scene3d.syncRemotePlayers(others);
  const now = Date.now();
  const entries = [];
  let liveOthers = 0;
  if (others && typeof others === "object") {
    for (const [uid, info] of Object.entries(others)) {
      if (!info) continue;
      const ts = Number(info.updatedAt || info.lastSeen || info.ts || now);
      const isLive = (now - ts) <= ONLINE_ACTIVE_MS;
      if (isLive) liveOthers += 1;
      entries.push({
        uid,
        name: info.name || info.playerName || `漁師(${String(uid).slice(0, 5)})`,
        area: info.areaName || info.area || "港周辺",
        status: isLive ? (info.isBoating ? "乗船中" : (info.isFishing ? "釣り中" : "探索中")) : "オフライン",
        lastSeenAt: ts
      });
    }
  }
  recordSeenPlayers(entries);
  syncTopRightOnlineBadge(1 + liveOthers);
});
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

// ===== 説明バー（#status-banner）を文字数に応じた読める時間だけ表示して自動で消す =====
(function setupStatusBannerAutoHide() {
  const init = () => {
    const el = document.getElementById("status-banner");
    if (!el || el.dataset.autoHideInit) return;
    el.dataset.autoHideInit = "1";
    el.style.transition = "opacity 0.45s ease, transform 0.35s ease";
    let hideTimer = null;

    const scheduleHide = () => {
      const txt = (el.textContent || "").trim();
      if (hideTimer) clearTimeout(hideTimer);
      if (!txt) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        return;
      }
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
      el.style.pointerEvents = "auto";
      // 読める時間：最低3.2秒〜最大7.2秒（1文字あたり約115ms）
      const ms = Math.min(7200, Math.max(3200, txt.length * 115));
      hideTimer = setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(-6px)";
        el.style.pointerEvents = "none";
      }, ms);
    };

    const obs = new MutationObserver(scheduleHide);
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    scheduleHide();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

// ===== 水産株取引所ボタン接続＆リアルタイム市場起動 =====
(function setupFishStockButton() {
  const init = () => {
    ensureStockMarketRunning(() => env);
    const btn = document.getElementById("btn-open-stocks");
    if (!btn || btn.dataset.stockBound) return;
    btn.dataset.stockBound = "1";
    btn.onclick = () => {
      const save = currentSave();
      if (!save) return;
      audioEngine.playOk?.();
      openFishStockExchange({
        save,
        openModal,
        closeModal,
        onCommit: () => { persistSlots(slots, false); updateHud(); },
        playCash: () => audioEngine.playCash?.(),
        playFail: () => audioEngine.playFail?.()
      });
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();








function isForbiddenRosterName(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  const badWords = [
    "分前", "時間前", "秒前", "日前", "たった今アクティブ", "オフライン（履歴）",
    "一括売却", "セーブスロット", "続きから", "新規作成", "削除", "更新",
    "今日のランキング", "大物重量", "1匹最高額", "今日の匹数", "貝マスター", "売上王",
    "港・堤防", "港周辺", "港町", "オンライン", "オフライン", "クラウド同期OK",
    "天候", "水温", "潮回り", "本日の市場相場", "さかなサン", "プレイヤー一覧",
    "オンライン中のプレイヤーと", "過去にオフラインになったプレイヤーを表示しています。",
    "空きスロット", "新しく漁師ライフを始める", "5部門",
    "一緒に釣り中", "マルチ", "釣り中", "乗船中", "探索中", "プレイ中"
  ];
  if (badWords.some((w) => s.includes(w))) return true;
  if (/^[❖◆◇■□▲▼★☆♪♫⚡🎣🐟⚓🥇🥈🥉🏅👑\d\.\s]+$/.test(s)) return true;
  if (/^\d+(\.\d+)?(kg|円|個|人|分|時間|日)$/.test(s)) return true;
  return false;
}

function formatRosterDisplayName(rawName) {
  const s = String(rawName || "").trim();
  if (
    !s ||
    /^ゲスト/i.test(s) ||
    /^guest/i.test(s) ||
    /^anonymous/i.test(s) ||
    /^漁師\([0-9a-zA-Z_-]+\)$/.test(s) ||
    /^player_[0-9a-zA-Z_-]+$/i.test(s)
  ) {
    return "ゲスト";
  }
  return s;
}

function purgeDirtyRosterHistory() {
  for (const key of ["sakana_seen_players_history_v1", "sakana_seen_players_history_v2"]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      const cleaned = arr.filter((item) => item && !isForbiddenRosterName(item.name));
      localStorage.setItem(key, JSON.stringify(cleaned));
    } catch (_) {}
  }
}

function openOnlineRosterModal() {
  const save = currentSave();
  const myUid = typeof getCurrentUid === "function" ? (getCurrentUid() || "local_me") : "local_me";
  const now = Date.now();

  const isTimeWordEntry = (raw) => {
    const s = String(raw || "").trim();
    return /^(分前|時間前|秒前|日前)$/.test(s) || s === "分前" || s === "時間前";
  };

  const normalizeEntryName = (raw) => {
    const s = String(raw || "").trim();
    if (!s || s.includes("一緒に釣り中") || /^ゲスト/i.test(s) || /^guest/i.test(s) || /^anonymous/i.test(s) || /^漁師\([0-9a-zA-Z_-]+\)$/.test(s)) {
      return "ゲスト";
    }
    return s;
  };

  const myName = normalizeEntryName(save?.name || "アステ");

  // 1. 過去の履歴（sakana_seen_players_history_v1 / v2）を読み込み、「時間前」「分前」は削除し、「一緒に釣り中」は「ゲスト」へ変換
  const loadedHist = [];
  for (const key of ["sakana_seen_players_history_v2", "sakana_seen_players_history_v1"]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item) continue;
        const origName = String(item.name || "").trim();
        if (isTimeWordEntry(origName)) continue; // 「時間前」「分前」を削除
        const fixedName = normalizeEntryName(origName);
        if (isTimeWordEntry(fixedName)) continue;
        loadedHist.push({
          uid: String(item.uid || ("hist_" + fixedName)),
          name: fixedName,
          area: item.area || "港町",
          status: item.status || "オフライン",
          lastSeenAt: Number(item.lastSeenAt || 0) || null
        });
      }
    } catch (_) {}
  }

  const candidates = [];
  for (const h of loadedHist) {
    const ts = Number(h.lastSeenAt || 0);
    const isOnline = (String(h.uid) === String(myUid)) || (ts > 0 && (now - ts) <= ONLINE_ACTIVE_MS && h.status !== "オフライン");
    candidates.push({
      uid: h.uid,
      name: h.name,
      area: h.area,
      status: isOnline ? (h.status || "オンライン") : "オフライン",
      online: isOnline,
      lastSeenAt: ts > 0 ? ts : null
    });
  }

  // 2. 現在のワールド同期（remotePlayersCache）
  if (typeof remotePlayersCache !== "undefined" && remotePlayersCache && typeof remotePlayersCache === "object") {
    for (const [uid, info] of Object.entries(remotePlayersCache)) {
      if (!info) continue;
      const origName = String(info.name || info.playerName || "").trim();
      if (isTimeWordEntry(origName)) continue;
      const fixedName = normalizeEntryName(origName);
      const ts = Number(info.updatedAt || info.lastSeen || info.ts || 0);
      const isOnline = ts > 0 && (now - ts) <= ONLINE_ACTIVE_MS;
      candidates.push({
        uid: String(uid),
        name: fixedName,
        area: info.areaName || info.area || "港周辺",
        status: isOnline ? (info.isBoating ? "乗船中" : (info.isFishing ? "釣り中" : "探索中")) : "オフライン",
        online: isOnline,
        lastSeenAt: ts > 0 ? ts : now
      });
    }
  }

  // 3. 自分自身
  candidates.push({
    uid: String(myUid),
    name: myName,
    area: (typeof currentArea !== "undefined" && currentArea?.name) ? currentArea.name : "港・堤防",
    status: (typeof phase !== "undefined" && phase !== "idle") ? "釣り中" : "プレイ中",
    online: true,
    lastSeenAt: now
  });

  // 4. 同じ名前を1人に統合
  const byName = new Map();
  for (const c of candidates) {
    if (isTimeWordEntry(c.name)) continue;
    const key = normalizeEntryName(c.name);
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, { ...c, name: key });
    } else {
      const mergedOnline = Boolean(prev.online || c.online);
      const prevTs = Number(prev.lastSeenAt || 0);
      const curTs = Number(c.lastSeenAt || 0);
      const bestTs = Math.max(prevTs, curTs) || null;
      const pickCur = (!prev.online && c.online) || (curTs > prevTs);
      byName.set(key, {
        uid: pickCur ? c.uid : prev.uid,
        name: key,
        area: pickCur ? c.area : prev.area,
        status: mergedOnline ? (pickCur ? c.status : prev.status) : "オフライン",
        online: mergedOnline,
        lastSeenAt: bestTs
      });
    }
  }

  // クリーンな履歴を保存し直す
  const cleanSaveList = [...byName.values()]
    .filter((p) => p.uid !== String(myUid) && !isTimeWordEntry(p.name))
    .map((p) => ({
      uid: p.uid,
      name: p.name,
      area: p.area,
      status: p.online ? p.status : "オフライン",
      lastSeenAt: Number(p.lastSeenAt || 0) || null
    }));
const list = [...byName.values()].sort((a, b) => Number(b.online) - Number(a.online) || (Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0)));
  const onlineCnt = list.filter((p) => p.online).length;
  const offlineCnt = list.length - onlineCnt;
  if (typeof syncTopRightOnlineBadge === "function") syncTopRightOnlineBadge(onlineCnt);

  const fmtTimeLabel = (p) => {
    if (p.online) return "たった今アクティブ";
    const ts = Number(p.lastSeenAt || 0);
    if (!ts) return "オフライン";
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
    if (diffSec < 60) return `${diffSec}秒前（${hh}:${mm}）`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}分前（${hh}:${mm}）`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}時間前（${hh}:${mm}）`;
    const day = Math.floor(hr / 24);
    return `${day}日前（${hh}:${mm}）`;
  };

  const rowsHtml = list.map((p) => {
    const disp = normalizeEntryName(p.name);
    const badge = p.online
      ? `<span style="display:inline-flex;align-items:center;gap:5px;color:#4ade80;font-weight:700;"><span style="width:9px;height:9px;border-radius:50%;background:#22c55e;display:inline-block;"></span>オンライン</span>`
      : `<span style="display:inline-flex;align-items:center;gap:5px;color:#94a3b8;font-weight:700;"><span style="width:9px;height:9px;border-radius:50%;background:#64748b;display:inline-block;"></span>オフライン</span>`;
    return `
      <div class="list-row" style="opacity:${p.online ? "1" : "0.78"};">
        <div>
          <div style="display:flex;align-items:center;gap:8px;">${badge} <strong>${escapeHtml(disp)}</strong></div>
          <div class="muted" style="font-size:11px;">📍 ${escapeHtml(p.area)} / ${escapeHtml(p.status)}</div>
        </div>
        <div class="muted" style="font-size:11px;text-align:right;">${fmtTimeLabel(p)}</div>
      </div>
    `;
  }).join("");

  openModal(
    `👥 プレイヤー一覧（🟢 ${onlineCnt}人 / ⚫ ${offlineCnt}人）`,
    `<div class="muted" style="font-size:11px;margin-bottom:8px;">🟢 オンライン中のプレイヤーと ⚫ オフラインのプレイヤーを表示しています。</div>${rowsHtml}`
  );
}

purgeDirtyRosterHistory();

document.addEventListener("click", (ev) => {
  const target = ev.target?.closest(".online-badge, #online-count, button, [role='button']");
  if (!target) return;
  const txt = (target.textContent || "").replace(/\s+/g, " ").trim();
  if (target.matches(".online-badge, #online-count") || target.closest(".online-badge") || /^[●🟢⚫]?\s*\d+\s*人$/.test(txt)) {
    ev.preventDefault();
    ev.stopPropagation();
    openOnlineRosterModal();
  }
}, true);


function consumeStrikeStaminaOnAction() {
  const save = typeof currentSave === "function" ? currentSave() : null;
  if (!save || typeof save.stamina !== "number") return false;
  const now = Date.now();
  if (window.__lastStrikeConsumeAt && (now - window.__lastStrikeConsumeAt) < 350) {
    return true;
  }
  if (save.stamina < 2) {
    if (typeof $ === "function" && $("status-banner")) {
      $("status-banner").textContent = "⚡ スタミナ不足です（合わせるには⚡2必要）";
    }
    if (typeof audioEngine !== "undefined" && audioEngine?.playFail) audioEngine.playFail();
    return false;
  }
  window.__lastStrikeConsumeAt = now;
  save.stamina = Math.max(0, save.stamina - 2);
  if (typeof persistSlots === "function" && typeof slots !== "undefined") {
    persistSlots(slots, false);
  }
  if (typeof $ === "function" && $("hud-stamina")) {
    $("hud-stamina").textContent = String(save.stamina);
  }
  if (typeof updateHud === "function") updateHud();
  return true;
}


function consumeHarvestPhase2Stamina(cost, label = "採取") {
  const save = typeof currentSave === "function" ? currentSave() : null;
  if (!save || typeof save.stamina !== "number") return false;
  if (save.stamina < cost) {
    if (typeof $ === "function" && $("status-banner")) {
      $("status-banner").textContent = `⚡ スタミナ不足です（${label}には⚡${cost}必要）`;
    }
    if (typeof audioEngine !== "undefined" && audioEngine?.playFail) audioEngine.playFail();
    return false;
  }
  save.stamina = Math.max(0, save.stamina - cost);
  if (typeof persistSlots === "function" && typeof slots !== "undefined") {
    persistSlots(slots, false);
  }
  if (typeof $ === "function" && $("hud-stamina")) {
    $("hud-stamina").textContent = String(save.stamina);
  }
  if (typeof updateHud === "function") updateHud();
  return true;
}

function runShellPhase1BeforePhase2(areaLabel, cost, onProceedPhase2) {
  const existing = document.getElementById("shell-phase1-overlay");
  if (existing) existing.remove();

  const terrains = [
    { icon: "🪨", name: "岩陰" },
    { icon: "🌊", name: "潮だまり" },
    { icon: "🌿", name: "海藻の陰" },
    { icon: "🏖️", name: "砂地" },
    { icon: "🧱", name: "岸壁際" },
    { icon: "🪨", name: "割れ目" },
    { icon: "🌊", name: "浅瀬" },
    { icon: "🌿", name: "藻場" },
    { icon: "🏖️", name: "砂利場" }
  ];

  // スポット配置（大密集×2、気配あり×3、少なめ×4 をシャッフル）
  const grades = ["rich", "rich", "normal", "normal", "normal", "poor", "poor", "poor", "poor"];
  for (let i = grades.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [grades[i], grades[j]] = [grades[j], grades[i]];
  }

  // ヒント（泡サイン）：大密集のマスは高確率、気配ありは中確率、少なめは低確率で🫧が見える
  const cells = terrains.map((t, idx) => {
    const g = grades[idx];
    const hintBubble =
      (g === "rich" && Math.random() < 0.78) ||
      (g === "normal" && Math.random() < 0.35) ||
      (g === "poor" && Math.random() < 0.12);
    return {
      idx,
      icon: t.icon,
      name: t.name,
      grade: g,
      hintBubble,
      revealed: false
    };
  });

  const maxScans = 3;
  let scansLeft = maxScans;
  let selectedIdx = null;

  const gradeMeta = {
    rich: { badge: "★★★", label: "大密集！", color: "#fbbf24", bg: "rgba(251,191,36,0.18)", border: "#f59e0b" },
    normal: { badge: "★★", label: "気配あり", color: "#38bdf8", bg: "rgba(56,189,248,0.15)", border: "#0284c7" },
    poor: { badge: "★", label: "少なめ", color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "#475569" }
  };

  const ov = document.createElement("div");
  ov.id = "shell-phase1-overlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(8,18,32,0.78);display:flex;align-items:center;justify-content:center;padding:14px;";
  ov.innerHTML = `
    <div style="width:100%;max-width:360px;background:#0f172a;border:1px solid rgba(148,163,184,0.35);border-radius:16px;padding:16px;color:#f8fafc;box-shadow:0 16px 40px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:11px;color:#38bdf8;font-weight:700;">第1フェーズ：スポット探し（消費なし）</span>
        <span id="shell-scan-left" style="font-size:11px;color:#fbbf24;font-weight:700;">残り調査：${scansLeft}回</span>
      </div>
      <div style="font-size:16px;font-weight:800;margin-bottom:6px;">🐚 ${areaLabel || "岸壁・岩場"}の貝スポットを探そう</div>
      <div style="font-size:11px;color:#cbd5e1;line-height:1.5;margin-bottom:10px;">
        🫧泡が出ている場所ほど貝が多いかも！最大${maxScans}箇所を無料で探って、採取する場所を決めよう。
      </div>
      <div id="shell-spot-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;"></div>
      <div id="shell-spot-summary" style="font-size:12px;color:#94a3b8;text-align:center;min-height:20px;margin-bottom:12px;">
        まずは気になる場所をタップして探ってみよう
      </div>
      <div style="display:flex;gap:8px;">
        <button id="btn-shell-p1-cancel" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#cbd5e1;font-weight:700;">やめる</button>
        <button id="btn-shell-p1-go" disabled style="flex:2;padding:10px 12px;border-radius:10px;border:none;background:#475569;color:#94a3b8;font-weight:800;">場所を選んでね</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  const gridEl = ov.querySelector("#shell-spot-grid");
  const scanLeftEl = ov.querySelector("#shell-scan-left");
  const summaryEl = ov.querySelector("#shell-spot-summary");
  const goBtn = ov.querySelector("#btn-shell-p1-go");
  const cancelBtn = ov.querySelector("#btn-shell-p1-cancel");

  function renderGrid() {
    scanLeftEl.textContent = `残り調査：${scansLeft}回`;
    gridEl.innerHTML = "";
    cells.forEach((c) => {
      const btn = document.createElement("button");
      const isSel = selectedIdx === c.idx;
      if (!c.revealed) {
        btn.style.cssText = `
          padding:10px 4px;border-radius:10px;border:1px solid ${c.hintBubble ? "rgba(56,189,248,0.6)" : "rgba(148,163,184,0.28)"};
          background:${c.hintBubble ? "rgba(14,116,144,0.25)" : "#1e293b"};color:#e2e8f0;
          display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;
          opacity:${scansLeft > 0 ? "1" : "0.45"};
        `;
        btn.innerHTML = `
          <div style="font-size:18px;line-height:1.1;">${c.icon}${c.hintBubble ? '<span style="font-size:12px;">🫧</span>' : ""}</div>
          <div style="font-size:11px;font-weight:700;">${c.name}</div>
          <div style="font-size:10px;color:#94a3b8;">${scansLeft > 0 ? "タップで調査" : "調査終了"}</div>
        `;
        btn.onclick = () => {
          if (scansLeft <= 0) return;
          c.revealed = true;
          scansLeft -= 1;
          // まだ未選択、または今見つけた方が高ランクなら自動選択
          const rankVal = { poor: 1, normal: 2, rich: 3 };
          if (selectedIdx === null || rankVal[c.grade] >= rankVal[cells[selectedIdx].grade]) {
            selectedIdx = c.idx;
          }
          renderGrid();
        };
      } else {
        const meta = gradeMeta[c.grade];
        btn.style.cssText = `
          padding:10px 4px;border-radius:10px;
          border:${isSel ? `2px solid ${meta.border}` : "1px solid rgba(148,163,184,0.35)"};
          background:${meta.bg};color:#f8fafc;
          display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;
          box-shadow:${isSel ? `0 0 0 2px ${meta.color}44` : "none"};
        `;
        btn.innerHTML = `
          <div style="font-size:11px;font-weight:800;color:${meta.color};">${meta.badge}</div>
          <div style="font-size:12px;font-weight:800;">${meta.label}</div>
          <div style="font-size:10px;color:#cbd5e1;">${c.name}${isSel ? " ✓" : ""}</div>
        `;
        btn.onclick = () => {
          selectedIdx = c.idx;
          renderGrid();
        };
      }
      gridEl.appendChild(btn);
    });

    if (selectedIdx !== null) {
      const sel = cells[selectedIdx];
      const meta = gradeMeta[sel.grade];
      summaryEl.innerHTML = `選択中：<strong>${sel.name}</strong>（<span style="color:${meta.color};font-weight:800;">${meta.badge} ${meta.label}</span>）`;
      goBtn.disabled = false;
      goBtn.style.background = "#f59e0b";
      goBtn.style.color = "#0f172a";
      goBtn.textContent = `ここで採取する（⚡${cost}）`;
    } else {
      summaryEl.textContent = "まずは気になる場所をタップして探ってみよう";
      goBtn.disabled = true;
      goBtn.style.background = "#475569";
      goBtn.style.color = "#94a3b8";
      goBtn.textContent = "場所を選んでね";
    }
  }

  cancelBtn.onclick = () => {
    window.__shellSpotBonus = null;
    ov.remove();
    if (typeof $ === "function" && $("status-banner")) {
      $("status-banner").textContent = "貝類採取をキャンセルしました";
    }
  };

  goBtn.onclick = () => {
    if (selectedIdx === null) return;
    const sel = cells[selectedIdx];
    const meta = gradeMeta[sel.grade];
    window.__shellSpotBonus = {
      grade: sel.grade,
      spotName: sel.name,
      label: `${meta.badge} ${meta.label}`
    };
    ov.remove();
    if (!consumeHarvestPhase2Stamina(cost, "貝類採取")) return;
    if (typeof $ === "function" && $("status-banner")) {
      $("status-banner").textContent = `🐚 ${sel.name}（${meta.label}）で採取開始！`;
    }
    if (typeof onProceedPhase2 === "function") onProceedPhase2();
  };

  renderGrid();
}
