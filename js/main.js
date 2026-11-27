import { initFirebase, fetchDailyRanking, submitDailyRecord } from "./config/firebase.js";
import { getRealWorldEnv } from "./systems/environment.js";
import { audioEngine } from "./systems/audioEngine.js";
import {
  getAreaAt, isNearPier, drawMinimap, PIER_DOCK_POS
} from "./systems/worldMap.js";
import {
  BOATS, FUEL_PRICE_PER_L, SHOP_ITEMS, PART_TIME_JOBS,
  getJobRankInfo, getActiveBoat, getBestBoatTier, getEquippedStats, applyBankInterest
} from "./systems/economy.js";
import { runJobMinigame, stopActiveJobGame } from "./systems/jobsMinigame.js";
import {
  syncLoadSlots, persistSlots, createNewSave, ensureSaveDefaults
} from "./state/saveManager.js";
import {
  loadSpeciesMaster, getAllSpecies, rollCatch, rollShellfish, rollNetHaul, getShellMethodForArea
} from "./systems/fishingEngine.js";
import { FishingScene } from "./scenes/fishingScene.js";

const $ = (id) => document.getElementById(id);

let slots = [];
let activeSlotIndex = -1;
let env = getRealWorldEnv();
let scene3d;

let harvestMode = "fish"; // fish | shell | net
let phase = "idle";       // idle | waiting | bite | fighting
let waitTimer = null;
let biteTimer = null;
let fightState = null;
let isReeling = false;
let fuelMoveAccum = 0;
let currentArea = null;
let shopTab = "rod_reel";

function currentSave() {
  return activeSlotIndex >= 0 ? slots[activeSlotIndex] : null;
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
        <div class="slot-actions">
          <button class="btn-primary" data-new="${idx}">新規作成</button>
        </div>
      `;
    }
    wrap.appendChild(item);
  });

  wrap.querySelectorAll("[data-play]").forEach((btn) => {
    btn.onclick = () => { audioEngine.unlock(); startSlot(Number(btn.dataset.play)); };
  });
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
  const save = ensureSaveDefaults(currentSave());
  save.lastPlayedAt = Date.now();
  const boat = getActiveBoat(save);
  const canBoat = boat.tier > 0 && save.worldPos.isBoating;
  scene3d.setPlayerState({
    x: canBoat ? save.worldPos.x : Math.max(-150, Math.min(130, save.worldPos.x || 0)),
    z: canBoat ? Math.min(-12, save.worldPos.z) : Math.max(-2, save.worldPos.z || 4),
    yaw: save.worldPos.yaw || 0,
    isBoating: canBoat,
    boatSpeed: boat.speed || 1.2,
    boatTier: boat.tier
  });
  updateHud();
  syncWorldStatus();
  $("home-screen").classList.remove("active");
  $("play-screen").classList.add("active");
  resetActionState();
}

function saveWorldPosition(syncCloud = false) {
  const save = currentSave();
  if (!save || !scene3d) return;
  save.worldPos = {
    x: Number(scene3d.pos.x.toFixed(1)),
    z: Number(scene3d.pos.y.toFixed(1)),
    yaw: Number(scene3d.yaw.toFixed(2)),
    isBoating: scene3d.isBoating
  };
  save.area = currentArea?.id || "teibou";
  persistSlots(slots, syncCloud);
}

function updateHud() {
  const save = currentSave();
  if (!save) return;
  ensureSaveDefaults(save);
  const stats = getEquippedStats(save);
  const boat = getActiveBoat(save);
  $("hud-name").textContent = save.name;
  $("hud-money").textContent = `¥${save.money.toLocaleString()}`;
  $("hud-stamina").textContent = save.stamina;
  $("hud-cooler-count").textContent = `${save.cooler.length}/${stats.coolerCap}`;
  $("gear-power-hint").textContent = `(竿x${stats.rodPower} / リールx${stats.reelSpeed} / 糸x${stats.lineStrength})`;

  const fuelPill = $("hud-fuel-pill");
  if (boat.maxFuel > 0) {
    fuelPill.classList.remove("hidden");
    $("hud-fuel").textContent = Math.floor(save.fuel);
  } else {
    fuelPill.classList.add("hidden");
  }
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

  // 桟橋付近で乗船/下船ボタンを表示
  const near = isNearPier(scene3d.pos.x, scene3d.pos.y);
  const boardBtn = $("btn-board-toggle");
  if (near) {
    boardBtn.classList.remove("hidden");
    boardBtn.textContent = scene3d.isBoating ? "🚶 桟橋へ下船" : "🚤 船に乗る";
  } else {
    boardBtn.classList.add("hidden");
  }

  if (scene3d.isBoating) {
    const info = scene3d.getNearestHotspot();
    $("sonar-bar").classList.toggle("hotspot", info.inSpot);
    $("sonar-text").textContent = info.inSpot
      ? "🐟 魚群反応MAX！レア＆大漁ボーナス"
      : `📡 最寄り魚群まで ${Math.round(info.dist)}m`;
    $("btn-autopilot").textContent = scene3d.autopilot ? "⏹ 自動航行中" : "🧭 魚群へ自動航行";
  }

  drawMinimap($("minimap-canvas"), {
    px: scene3d.pos.x,
    pz: scene3d.pos.y,
    yaw: scene3d.yaw,
    isBoating: scene3d.isBoating,
    hotspots: scene3d.hotspots
  });

  if (changed) {
    syncHarvestTabs();
    if (phase === "idle") resetActionState();
  }
}

function tryConsumeFuel(amount) {
  const save = currentSave();
  if (!save || amount <= 0) return true;
  const boat = getActiveBoat(save);
  if (boat.maxFuel <= 0) return true;

  if (save.fuel >= amount) {
    save.fuel = Math.max(0, save.fuel - amount);
    return true;
  }
  if (save.autoRefuel) {
    const need = Math.ceil(boat.maxFuel - save.fuel);
    const cost = need * FUEL_PRICE_PER_L;
    if (save.money >= cost) {
      save.money -= cost;
      save.fuel = boat.maxFuel - amount;
      audioEngine.playCash();
      $("status-banner").textContent = `⛽ 自動給油しました（-¥${cost.toLocaleString()}）`;
      updateHud();
      return true;
    }
  }
  return false;
}

function syncHarvestTabs() {
  const areaId = currentArea?.id || "teibou";
  const shellMethod = getShellMethodForArea(areaId);
  const shellBtn = $("tab-mode-shell");
  if (shellMethod) {
    shellBtn.disabled = false;
    shellBtn.textContent = `🐚 ${shellMethod.label}`;
  } else {
    shellBtn.disabled = true;
    shellBtn.textContent = "🐚 貝なし";
    if (harvestMode === "shell") harvestMode = "fish";
  }

  $("tab-mode-fish").classList.toggle("active", harvestMode === "fish");
  shellBtn.classList.toggle("active", harvestMode === "shell");
  $("tab-mode-net").classList.toggle("active", harvestMode === "net");
  scene3d?.setMode(harvestMode);
}

function resetActionState() {
  clearTimeout(waitTimer);
  clearTimeout(biteTimer);
  phase = "idle";
  fightState = null;
  isReeling = false;
  scene3d.setBobber(false);
  scene3d.setRodBend(0);
  $("fight-panel").classList.add("hidden");

  const save = currentSave();
  const areaId = currentArea?.id || "teibou";
  const btn = $("btn-main-action");
  if (harvestMode === "shell" && save) {
    const m = getShellMethodForArea(areaId);
    btn.className = "btn-action shell";
    btn.textContent = `🐚 ${m ? m.label : "貝採取"}（⚡3）`;
    $("status-banner").textContent = `${currentArea?.name || "海岸"}で${m ? m.label : "貝採取"}！`;
  } else if (harvestMode === "net" && save) {
    const { net } = getEquippedStats(save);
    btn.className = "btn-action net";
    const fuelTxt = net.fuelCost ? `/⛽${net.fuelCost}L` : "";
    btn.textContent = `🕸️ ${net.name}（⚡5${fuelTxt}）`;
    $("status-banner").textContent = "網漁で複数匹を一網打尽！";
  } else {
    const bait = save ? getEquippedStats(save).bait : null;
    btn.className = "btn-action";
    btn.textContent = "🎣 キャスト（⚡2）";
    const baitTxt = bait && bait.pack > 0 ? ` / 餌:${bait.name.split(" ")[0]}(残${save.baitStock[bait.id] || 0})` : "";
    $("status-banner").textContent = `${currentArea?.name || "港"}で釣り待機中${baitTxt}`;
  }
}

function checkCoolerSpace(save, minNeed = 1) {
  const { coolerCap } = getEquippedStats(save);
  if (save.cooler.length + minNeed > coolerCap) {
    $("status-banner").textContent = `クーラー満タン（${save.cooler.length}/${coolerCap}）！売却か拡張しよう`;
    audioEngine.playFail();
    return false;
  }
  return true;
}

function doNetHarvest() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  const { net, coolerCap } = getEquippedStats(save);
  const areaId = currentArea?.id || "teibou";

  if (!scene3d.isBoating && net.method !== "toami" && net.method !== "kago") {
    $("status-banner").textContent = `${net.name}は船で沖へ出て使おう（岸では投網か道具変更）`;
    audioEngine.playFail();
    return;
  }
  if (save.stamina < 5) {
    $("status-banner").textContent = "スタミナ不足です（⚡5必要）";
    audioEngine.playFail();
    return;
  }
  if (net.fuelCost > 0 && !tryConsumeFuel(net.fuelCost)) {
    $("status-banner").textContent = "⛽ 燃料不足！船ドックで給油しよう";
    audioEngine.playFail();
    return;
  }

  save.stamina -= 5;
  save.lastPlayedAt = Date.now();
  audioEngine.playNetThrow();

  const inHotspot = scene3d.getNearestHotspot().inSpot;
  const haul = rollNetHaul(areaId, env, net, inHotspot);
  if (!haul.length) {
    $("status-banner").textContent = "この場所では網に獲物が入らなかった…";
    updateHud();
    return;
  }

  const room = Math.max(0, coolerCap - save.cooler.length);
  const kept = haul.slice(0, room);
  let totalPrice = 0;

  kept.forEach((item) => {
    const sp = item.species;
    save.cooler.push({
      id: sp.id, name: sp.name, rank: sp.rank,
      weightKg: item.weightKg, tags: item.tags, price: item.estimatedPrice
    });
    if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
    save.dex[sp.id].count += 1;
    save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, item.weightKg);
    save.stats.totalCaught += 1;
    totalPrice += item.estimatedPrice;
  });

  if (inHotspot) scene3d.spawnWorldHotspots();
  saveWorldPosition(true);
  updateHud();
  audioEngine.playCatch(kept.some((x) => x.species.rank === "S" || x.species.rank === "A") ? "A" : "C");

  const rows = kept.map((x) => `
    <div class="list-row">
      <div>
        <strong class="rank-${x.species.rank}">[${x.species.rank}] ${x.species.name}</strong> (${x.weightKg}kg)
        <div>${x.tags.map((t) => `<span class="tag ${t === "傷あり" ? "warn" : ""}">${t}</span>`).join("")}</div>
      </div>
      <strong>¥${x.estimatedPrice.toLocaleString()}</strong>
    </div>
  `).join("");

  openModal(`🕸️ ${net.name}で ${kept.length}匹 を水揚げ！`, `
    <div><strong>合計査定:</strong> ¥${totalPrice.toLocaleString()} ${inHotspot ? '<span class="tag gold">🐟 魚群ボーナス</span>' : ""}</div>
    ${rows}
    <button class="btn-primary" id="btn-net-ok">クーラーにしまう</button>
  `);
  $("btn-net-ok").onclick = closeModal;
  resetActionState();
}

function doShellHarvest() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  const areaId = currentArea?.id || "teibou";
  if (save.stamina < 3) {
    $("status-banner").textContent = "スタミナ不足です（3分で1回復）";
    audioEngine.playFail();
    return;
  }
  const m = getShellMethodForArea(areaId);
  if (areaId === "iso" && env.weather === "rough") {
    $("status-banner").textContent = "シケで磯が危険なため今日は磯採り不可！";
    audioEngine.playFail();
    return;
  }

  save.stamina -= 3;
  save.lastPlayedAt = Date.now();
  audioEngine.playDig();

  const { shellBonus } = getEquippedStats(save);
  const res = rollShellfish(areaId, env, shellBonus);
  if (!res) {
    $("status-banner").textContent = "ここでは貝が見つからなかった…";
    updateHud();
    return;
  }

  const sp = res.species;
  save.cooler.push({
    id: sp.id, name: `${sp.name}×${res.count}`, rank: sp.rank,
    weightKg: res.weightKg, tags: res.tags, price: res.estimatedPrice
  });
  if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
  save.dex[sp.id].count += res.count;
  save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, res.weightKg);
  save.stats.totalCaught += res.count;

  saveWorldPosition(true);
  updateHud();
  audioEngine.playCatch(sp.rank);

  openModal(`🐚 ${sp.name} ×${res.count}（ランク${sp.rank}）を採取！`, `
    <div><strong>合計重量:</strong> ${res.weightKg} kg（${m.label}）</div>
    <div><strong>査定額:</strong> ¥${res.estimatedPrice.toLocaleString()}</div>
    <div>${res.tags.map((t) => `<span class="tag ${t === "真珠入り" ? "gold" : ""}">${t}</span>`).join("")}</div>
    <p class="muted">${sp.desc}</p>
    <p>${sp.tasteNote}</p>
    <button class="btn-primary" id="btn-catch-ok">クーラーにしまって続ける</button>
  `);
  $("btn-catch-ok").onclick = closeModal;
  resetActionState();
}

function startCast() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save, 1)) return;
  if (save.stamina < 2) {
    $("status-banner").textContent = "スタミナ不足です（3分で1回復）";
    audioEngine.playFail();
    return;
  }
  const { bait, baitAttract } = getEquippedStats(save);
  if (bait.pack > 0 && save.baitStock[bait.id] > 0) {
    save.baitStock[bait.id] -= 1;
  }

  save.stamina -= 2;
  save.lastPlayedAt = Date.now();
  persistSlots(slots, false);
  updateHud();
  audioEngine.playCast();

  phase = "waiting";
  const dist = 16 + Math.random() * 14;
  scene3d.setBobber(true, dist, 0);
  $("btn-main-action").textContent = "回収する";
  const inSpot = scene3d.getNearestHotspot().inSpot;
  $("status-banner").textContent = inSpot ? "🐟 魚群ポイント！アタリが早そうだ..." : "アタリを待っています...";

  const speedFactor = (inSpot ? 0.65 : 1.0) / Math.sqrt(baitAttract);
  const waitMs = (1700 + Math.random() * 2700) * speedFactor;
  waitTimer = setTimeout(() => {
    if (phase !== "waiting") return;
    phase = "bite";
    scene3d.setBobber(true, dist, 0.35);
    audioEngine.playBite();
    $("btn-main-action").className = "btn-action bite";
    $("btn-main-action").textContent = "⚡ アワセる！";
    $("status-banner").textContent = "ヒット！！今すぐタップしてアワセろ！";

    biteTimer = setTimeout(() => {
      if (phase === "bite") {
        audioEngine.playFail();
        $("status-banner").textContent = "逃げられてしまった…";
        setTimeout(resetActionState, 900);
      }
    }, 1800);
  }, waitMs);
}

function startFight() {
  clearTimeout(biteTimer);
  const save = currentSave();
  const inSpot = scene3d.getNearestHotspot().inSpot;
  const { baitAttract } = getEquippedStats(save);
  const caught = rollCatch(currentArea?.id || "teibou", env, inSpot, baitAttract);

  phase = "fighting";
  fightState = { caught, distance: 19 + Math.random() * 10, fishStamina: 100, tension: 24 };
  $("fight-panel").classList.remove("hidden");
  $("btn-main-action").className = "btn-action reeling";
  $("btn-main-action").textContent = "🔄 長押しで巻く";
  $("status-banner").textContent = "ファイト中！ゲージが赤くなる前にドラグ調整！";
}

function tickFight() {
  if (phase !== "fighting" || !fightState) return;
  const save = currentSave();
  const { rodPower, reelSpeed, lineStrength } = getEquippedStats(save);
  const f = fightState;
  const sp = f.caught.species;
  const drag = Number($("drag-slider").value) / 100;
  $("drag-val").textContent = `${Math.round(drag * 100)}%`;

  const rawPull = (sp.pullPower || 2) * (0.45 + Math.random() * 0.55) * (f.fishStamina > 20 ? 1 : 0.45);
  const effectivePull = rawPull / lineStrength;

  if (isReeling) {
    audioEngine.playReelTick(f.tension);
    f.tension += (drag * 5.7 + effectivePull * 0.7) - (3.4 + rodPower * 0.42);
    const gain = Math.max(0.12, (drag * 1.1 * rodPower * reelSpeed) - (effectivePull * 0.08));
    f.distance = Math.max(0, f.distance - gain * 0.44);
    f.fishStamina = Math.max(0, f.fishStamina - (0.75 + drag * 0.75 * rodPower));
  } else {
    f.tension = Math.max(8, f.tension - 5.0);
    if (f.fishStamina > 15) f.distance += ((sp.speed || 2) / rodPower) * 0.03;
  }

  f.tension = Math.max(0, Math.min(105, f.tension));
  const rodPct = Math.min(100, f.tension / Math.max(1, rodPower * 0.85));
  const linePct = Math.min(100, f.tension);
  const reelPct = Math.min(100, f.tension * drag * 1.1);

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
    audioEngine.playFail();
    $("status-banner").textContent = "💥 ラインブレイク！ドラグ調整か上位装備を検討しよう";
    phase = "idle";
    setTimeout(resetActionState, 1300);
    return;
  }
  if (f.distance <= 0.4) onCatchSuccess(f.caught);
}

function onCatchSuccess(caught) {
  const save = currentSave();
  const sp = caught.species;

  save.cooler.push({
    id: sp.id, name: sp.name, rank: sp.rank,
    weightKg: caught.weightKg, tags: caught.tags, price: caught.estimatedPrice
  });
  if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
  save.dex[sp.id].count += 1;
  save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, caught.weightKg);
  save.stats.totalCaught += 1;
  save.lastPlayedAt = Date.now();

  saveWorldPosition(true);
  updateHud();
  audioEngine.playCatch(sp.rank);

  submitDailyRecord({
    playerName: save.name, fishName: sp.name,
    weightKg: caught.weightKg, rank: sp.rank, condition: caught.tags[0] || ""
  });

  openModal(`🎉 ${sp.name}（ランク${sp.rank}）を釣り上げた！`, `
    <div><strong>重量:</strong> ${caught.weightKg} kg</div>
    <div><strong>査定額:</strong> ¥${caught.estimatedPrice.toLocaleString()}（相場 x${env.marketRate}）</div>
    <div>${caught.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    <p class="muted">${sp.desc}</p>
    <p>${sp.tasteNote}</p>
    <button class="btn-primary" id="btn-catch-ok">クーラーにしまって続ける</button>
  `);
  $("btn-catch-ok").onclick = closeModal;
  resetActionState();
}

function openModal(title, html) {
  stopActiveJobGame();
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  stopActiveJobGame();
  $("modal-overlay").classList.add("hidden");
}

function openDockModal() {
  const save = currentSave();
  const active = getActiveBoat(save);
  const remainH = save.rentalBoat ? Math.max(1, Math.ceil((save.rentalBoat.expiresAt - Date.now()) / 3600000)) : 0;
  const needFuel = Math.max(0, Math.ceil(active.maxFuel - save.fuel));
  const refuelCost = needFuel * FUEL_PRICE_PER_L;

  const fuelBox = active.maxFuel > 0 ? `
    <div class="bank-box">
      <strong>⛽ 燃料管理（現在 ${Math.floor(save.fuel)} / ${active.maxFuel} L）</strong>
      <div class="btn-row">
        <button class="btn-primary" id="btn-refuel-full" ${needFuel <= 0 ? "disabled" : ""}>
          満タン給油（${needFuel}L / ¥${refuelCost.toLocaleString()}）
        </button>
        <button class="btn-sub" id="btn-toggle-autorefuel">自動給油: ${save.autoRefuel ? "ON" : "OFF"}</button>
      </div>
    </div>
  ` : "";

  const boatRows = BOATS.filter((b) => b.tier > 0).map((b) => {
    const owned = save.ownedBoats.includes(b.id);
    const rented = save.rentalBoat && save.rentalBoat.boatId === b.id;
    const isUsing = active.id === b.id;

    let actions = "";
    if (isUsing) actions = `<span class="tag gold">${owned ? "係留中(所有)" : `レンタル中(残${remainH}h)`}</span>`;
    else if (owned || rented) actions = `<button class="btn-sub" data-use-boat="${b.id}">この船を使う</button>`;
    else {
      actions = `
        <div class="btn-row">
          <button class="btn-warn" data-rent-boat="${b.id}">1日レンタル ¥${b.rentPrice.toLocaleString()}</button>
          <button class="btn-primary" data-buy-boat="${b.id}">購入 ¥${b.buyPrice.toLocaleString()}</button>
        </div>
      `;
    }
    return `
      <div class="bank-box">
        <div><strong>🚤 ${b.name}</strong>（燃料 ${b.maxFuel}L / 速度x${b.speed}）</div>
        <div class="muted">${b.desc}</div>
        ${actions}
      </div>
    `;
  }).join("");

  openModal(`🚤 船ドック・レンタル（所持 ¥${save.money.toLocaleString()}）`, `${fuelBox}${boatRows}`);

  if ($("btn-refuel-full")) {
    $("btn-refuel-full").onclick = () => {
      if (needFuel <= 0) return;
      if (save.money < refuelCost) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= refuelCost;
      save.fuel = active.maxFuel;
      persistSlots(slots, true);
      updateHud();
      audioEngine.playCash();
      openDockModal();
    };
  }
  if ($("btn-toggle-autorefuel")) {
    $("btn-toggle-autorefuel").onclick = () => {
      save.autoRefuel = !save.autoRefuel;
      persistSlots(slots, true);
      openDockModal();
    };
  }

  $("modal-body").querySelectorAll("[data-rent-boat]").forEach((btn) => {
    btn.onclick = () => {
      const b = BOATS.find((x) => x.id === btn.dataset.rentBoat);
      if (!b || save.money < b.rentPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= b.rentPrice;
      save.rentalBoat = { boatId: b.id, expiresAt: Date.now() + 24 * 3600 * 1000 };
      save.activeBoatId = b.id;
      save.fuel = b.maxFuel;
      scene3d.updateBoatSpec(b.speed, b.tier);
      persistSlots(slots, true);
      updateHud();
      audioEngine.playCash();
      openDockModal();
    };
  });

  $("modal-body").querySelectorAll("[data-buy-boat]").forEach((btn) => {
    btn.onclick = () => {
      const b = BOATS.find((x) => x.id === btn.dataset.buyBoat);
      if (!b || save.money < b.buyPrice) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= b.buyPrice;
      if (!save.ownedBoats.includes(b.id)) save.ownedBoats.push(b.id);
      save.activeBoatId = b.id;
      save.fuel = b.maxFuel;
      scene3d.updateBoatSpec(b.speed, b.tier);
      persistSlots(slots, true);
      updateHud();
      audioEngine.playCash();
      openDockModal();
    };
  });

  $("modal-body").querySelectorAll("[data-use-boat]").forEach((btn) => {
    btn.onclick = () => {
      const b = BOATS.find((x) => x.id === btn.dataset.useBoat);
      if (!b) return;
      save.activeBoatId = b.id;
      save.fuel = Math.min(save.fuel || b.maxFuel, b.maxFuel);
      scene3d.updateBoatSpec(b.speed, b.tier);
      persistSlots(slots, true);
      updateHud();
      openDockModal();
    };
  });
}

function openShopModal() {
  const save = currentSave();
  const list = SHOP_ITEMS.filter((x) => x.tab === shopTab);
  const cards = list.map((item) => {
    const isBaitPack = item.slot === "bait" && item.pack > 0;
    const isBundle = item.slot === "bundle";
    const stock = isBaitPack ? (save.baitStock[item.id] || 0) : 0;
    const owned = isBundle
      ? item.items.every((id) => save.ownedGear.includes(id))
      : isBaitPack ? stock > 0 : save.ownedGear.includes(item.id);
    const equipped = !isBundle && save.gear[item.slot] === item.id;

    let btnHtml = "";
    if (isBaitPack) {
      btnHtml = `
        <div class="btn-row">
          <button class="btn-primary" data-buy="${item.id}" style="flex:1;">買う ¥${item.price.toLocaleString()}</button>
          ${stock > 0 && !equipped ? `<button class="btn-sub" data-equip="${item.id}">装備</button>` : ""}
        </div>
      `;
    } else if (equipped) {
      btnHtml = `<span class="tag gold">装備中</span>`;
    } else if (owned && !isBundle) {
      btnHtml = `<button class="btn-sub" data-equip="${item.id}">装備する</button>`;
    } else if (owned && isBundle) {
      btnHtml = `<span class="tag">購入済</span>`;
    } else {
      btnHtml = `<button class="btn-primary" data-buy="${item.id}">買う ¥${item.price.toLocaleString()}</button>`;
    }

    const stockLabel = isBaitPack ? ` <span class="tag">残${stock}</span>` : "";
    return `
      <div class="shop-card ${equipped ? "equipped" : ""}">
        <div>
          <strong>${item.name}</strong>${stockLabel}
          <div class="muted" style="margin-top:3px;">${item.desc}</div>
        </div>
        ${btnHtml}
      </div>
    `;
  }).join("");

  openModal(`🏪 港ショップ（所持 ¥${save.money.toLocaleString()}）`, `
    <div class="shop-tabs">
      <button class="shop-tab ${shopTab === "rod_reel" ? "active" : ""}" data-tab="rod_reel">竿・リール</button>
      <button class="shop-tab ${shopTab === "gear_net" ? "active" : ""}" data-tab="gear_net">糸・箱・網</button>
      <button class="shop-tab ${shopTab === "bait" ? "active" : ""}" data-tab="bait">餌・仕掛け</button>
    </div>
    <div class="shop-grid">${cards}</div>
  `);

  $("modal-body").querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => { shopTab = btn.dataset.tab; openShopModal(); };
  });

  $("modal-body").querySelectorAll("[data-buy]").forEach((btn) => {
    btn.onclick = () => {
      const item = SHOP_ITEMS.find((x) => x.id === btn.dataset.buy);
      if (!item) return;
      if (save.money < item.price) { audioEngine.playFail(); alert("お金が足りません！"); return; }
      save.money -= item.price;

      if (item.slot === "bundle") {
        item.items.forEach((id) => {
          const sub = SHOP_ITEMS.find((x) => x.id === id);
          if (sub) {
            if (!save.ownedGear.includes(id)) save.ownedGear.push(id);
            save.gear[sub.slot] = id;
          }
        });
      } else if (item.slot === "bait" && item.pack > 0) {
        save.baitStock[item.id] = (save.baitStock[item.id] || 0) + item.pack;
        save.gear.bait = item.id;
      } else {
        if (!save.ownedGear.includes(item.id)) save.ownedGear.push(item.id);
        save.gear[item.slot] = item.id;
      }

      save.lastPlayedAt = Date.now();
      persistSlots(slots, true);
      updateHud();
      resetActionState();
      audioEngine.playCash();
      openShopModal();
    };
  });

  $("modal-body").querySelectorAll("[data-equip]").forEach((btn) => {
    btn.onclick = () => {
      const item = SHOP_ITEMS.find((x) => x.id === btn.dataset.equip);
      if (!item) return;
      save.gear[item.slot] = item.id;
      persistSlots(slots, true);
      updateHud();
      resetActionState();
      openShopModal();
    };
  });
}

function openJobsModal() {
  const save = currentSave();
  const h = env.hour;
  const jp = save.jobProfile || { totalClears: 0, streak: 0 };
  const rank = getJobRankInfo(jp.totalClears);
  const streakBonusPct = Math.min(50, jp.streak * 10);

  const headerBox = `
    <div class="bank-box">
      <div><strong>🏅 ランク: ${rank.title}</strong>（報酬 x${rank.bonusMult.toFixed(2)} / 達成 ${jp.totalClears}回）</div>
      <div class="muted">
        🔥 連勤コンボ: <strong>${jp.streak}回</strong>（+${streakBonusPct}%）
        ${rank.next ? ` / 次ランクまであと ${rank.next - jp.totalClears}回` : " / 最高ランク！"}
      </div>
    </div>
  `;

  const rows = PART_TIME_JOBS.map((job) => {
    const isBonusTime = job.bonusHours && job.bonusHours.includes(h);
    return `
      <div class="list-row">
        <div>
          <strong>${job.icon} ${job.name}</strong>
          ${isBonusTime ? `<span class="tag gold">${job.bonusLabel}</span>` : ""}
          <div class="muted">${job.desc}</div>
          <div class="muted">ノルマ: ${job.quotaText} / 消費⚡${job.stamina} / 基本¥${job.basePay.toLocaleString()}</div>
        </div>
        <button class="btn-primary" data-job="${job.id}">出勤</button>
      </div>
    `;
  }).join("");

  openModal(`💼 港のバイト掲示板（全7種 / ⚡${save.stamina}）`, `${headerBox}${rows}`);

  $("modal-body").querySelectorAll("[data-job]").forEach((btn) => {
    btn.onclick = () => {
      const job = PART_TIME_JOBS.find((x) => x.id === btn.dataset.job);
      if (!job) return;
      if (save.stamina < job.stamina) {
        audioEngine.playFail();
        alert("スタミナが足りません（3分で1回復します）");
        return;
      }
      save.stamina -= job.stamina;
      save.lastPlayedAt = Date.now();
      persistSlots(slots, false);
      updateHud();

      $("modal-title").textContent = `${job.icon} 勤務中: ${job.name}`;
      runJobMinigame($("modal-body"), job, ({ passed, perfect, extraMult, detail }) => {
        const isBonusTime = job.bonusHours && job.bonusHours.includes(env.hour);
        const timeMult = isBonusTime ? 1.2 : 1.0;

        let pay = 0;
        let bonusNotes = [];
        let drinkMsg = "";

        if (passed) {
          jp.totalClears += 1;
          jp.streak += 1;
          const rankNow = getJobRankInfo(jp.totalClears);
          const streakMult = 1 + Math.min(0.5, (jp.streak - 1) * 0.1);
          const perfMult = perfect ? 1.3 : 1.0;
          const totalMult = rankNow.bonusMult * streakMult * timeMult * perfMult * (1 + (extraMult || 0));
          pay = Math.round(job.basePay * totalMult);

          if (isBonusTime) bonusNotes.push(`${job.bonusLabel}`);
          if (perfect) bonusNotes.push("✨パーフェクト+30%");
          if (jp.streak >= 2) bonusNotes.push(`🔥${jp.streak}連勤ボーナス`);
          if (jp.streak % 5 === 0) {
            save.stamina = Math.min(100, save.stamina + 15);
            drinkMsg = "🥤 5連勤達成！漁協から栄養ドリンク支給（⚡+15回復）";
          }
          audioEngine.playCatch(perfect ? "S" : "B");
        } else {
          jp.streak = 0;
          pay = Math.round(job.basePay * 0.3);
          bonusNotes.push("ノルマ未達（見習い手当30%）");
          audioEngine.playFail();
        }

        save.jobProfile = jp;
        save.money += pay;
        save.stats.totalEarned += pay;
        save.lastPlayedAt = Date.now();
        persistSlots(slots, true);
        updateHud();

        $("modal-title").textContent = passed
          ? (perfect ? "🌟 ノルマ達成＆パーフェクト！" : "✅ ノルマ達成！お疲れさま！")
          : "💦 ノルマ未達…次は達成しよう！";
        $("modal-body").innerHTML = `
          <div class="bank-box" style="text-align:center;">
            <div style="font-size:1.45rem;font-weight:800;color:#f3c687;">報酬 ¥${pay.toLocaleString()}</div>
            <div class="muted">${detail}</div>
            <div>${bonusNotes.map((b) => `<span class="tag gold">${b}</span>`).join("")}</div>
            ${drinkMsg ? `<div style="color:#38e59a;font-weight:700;">${drinkMsg}</div>` : ""}
          </div>
          <div class="btn-row">
            <button class="btn-primary" id="job-again" style="flex:1;">バイト一覧へ</button>
            <button class="btn-sub" id="job-close" style="flex:1;">マップへ戻る</button>
          </div>
        `;
        $("job-again").onclick = openJobsModal;
        $("job-close").onclick = closeModal;
      });
    };
  });
}

function openCoolerModal() {
  const save = currentSave();
  const { coolerCap } = getEquippedStats(save);
  if (!save.cooler.length) {
    openModal(`🧊 クーラーボックス (0/${coolerCap})`, `<p class="muted">まだ魚や貝が入っていません。</p>`);
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

  openModal(`🧊 クーラーボックス (${save.cooler.length}/${coolerCap})`, `
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
    audioEngine.playCash();
    closeModal();
  };
}

function openBankModal() {
  const save = currentSave();
  const bank = applyBankInterest(save);
  openModal("🏦 漁協バンク（ゆるめ快適設定）", `
    <div class="bank-box">
      <strong>💰 普通預金（日利 0.2% 自動複利）</strong>
      <div>預金残高: <strong>¥${bank.ordinary.toLocaleString()}</strong> / 手持ち: ¥${save.money.toLocaleString()}</div>
      <div class="btn-row">
        <button class="btn-sub" id="bank-dep-10k">1万円預ける</button>
        <button class="btn-sub" id="bank-dep-all">全額預ける</button>
        <button class="btn-primary" id="bank-wd-10k">1万円引出</button>
        <button class="btn-primary" id="bank-wd-all">全額引出</button>
      </div>
    </div>
    <div class="bank-box">
      <strong>📄 漁協ローン（日利 0.3%・上限50万円）</strong>
      <div>借入残高: <strong style="color:#ff7b7b;">¥${bank.loan.toLocaleString()}</strong></div>
      <div class="btn-row">
        <button class="btn-primary" id="loan-borrow-20k">2万円借りる</button>
        <button class="btn-primary" id="loan-borrow-50k">5万円借りる</button>
        <button class="btn-sub" id="loan-repay-20k">2万円返済</button>
        <button class="btn-sub" id="loan-repay-all">一括返済</button>
      </div>
    </div>
  `);

  const done = () => {
    save.lastPlayedAt = Date.now();
    persistSlots(slots, true);
    updateHud();
    audioEngine.playCash();
    openBankModal();
  };

  $("bank-dep-10k").onclick = () => { if (save.money >= 10000) { save.money -= 10000; bank.ordinary += 10000; done(); } };
  $("bank-dep-all").onclick = () => { if (save.money > 0) { bank.ordinary += save.money; save.money = 0; done(); } };
  $("bank-wd-10k").onclick = () => { const v = Math.min(10000, bank.ordinary); if (v > 0) { bank.ordinary -= v; save.money += v; done(); } };
  $("bank-wd-all").onclick = () => { if (bank.ordinary > 0) { save.money += bank.ordinary; bank.ordinary = 0; done(); } };
  $("loan-borrow-20k").onclick = () => { if (bank.loan + 20000 <= 500000) { bank.loan += 20000; save.money += 20000; done(); } };
  $("loan-borrow-50k").onclick = () => { if (bank.loan + 50000 <= 500000) { bank.loan += 50000; save.money += 50000; done(); } };
  $("loan-repay-20k").onclick = () => { const v = Math.min(20000, bank.loan, save.money); if (v > 0) { bank.loan -= v; save.money -= v; done(); } };
  $("loan-repay-all").onclick = () => { const v = Math.min(bank.loan, save.money); if (v > 0) { bank.loan -= v; save.money -= v; done(); } };
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

function setupJoystick() {
  const base = $("joy-base");
  const knob = $("joy-knob");
  let activeId = null;
  const maxR = 36;

  const updateStick = (clientX, clientY) => {
    const r = base.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (phase === "idle") {
      scene3d.autopilot = false;
      scene3d.moveInput.x = dx / maxR;
      scene3d.moveInput.y = dy / maxR;
    }
  };

  const resetStick = () => {
    activeId = null;
    knob.style.transform = "translate(0px, 0px)";
    scene3d.moveInput.x = 0;
    scene3d.moveInput.y = 0;
  };

  base.addEventListener("pointerdown", (e) => {
    audioEngine.unlock();
    activeId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    updateStick(e.clientX, e.clientY);
  });
  base.addEventListener("pointermove", (e) => {
    if (e.pointerId === activeId) updateStick(e.clientX, e.clientY);
  });
  base.addEventListener("pointerup", (e) => { if (e.pointerId === activeId) resetStick(); });
  base.addEventListener("pointercancel", resetStick);

  // PCキーボード WASD / 矢印キー対応
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
    audioEngine.playEnginePulse();
    fuelMoveAccum += dist;
    if (fuelMoveAccum >= 18) {
      fuelMoveAccum -= 18;
      const ok = tryConsumeFuel(1);
      updateHud();
      if (!ok) {
        $("status-banner").textContent = "⛽ ガス欠！船ドックで給油か「⚓港へ」で帰還しよう";
        audioEngine.playFail();
        return false;
      }
    }
    return true;
  };
  scene3d.onBlocked = (msg) => {
    $("status-banner").textContent = msg;
    audioEngine.playFail();
  };

  setupJoystick();
  updateSoundIcons();
  updateEnvironmentUI();
  setInterval(updateEnvironmentUI, 30000);
  setInterval(tickFight, 60);
  setInterval(() => { if (activeSlotIndex >= 0) syncWorldStatus(); }, 180);

  window.addEventListener("pointerdown", () => audioEngine.unlock(), { once: true });

  await loadSpeciesMaster();
  await initFirebase({
    onOnlineCount: (n) => { $("online-count").textContent = n; },
    onStatus: (msg) => { $("sync-status").textContent = msg; }
  });

  slots = await syncLoadSlots();
  renderSlots();
  renderRanking();

  $("btn-sound-home").onclick = () => { audioEngine.toggleMute(); updateSoundIcons(); };
  $("btn-sound-play").onclick = () => { audioEngine.toggleMute(); updateSoundIcons(); };
  $("btn-refresh-rank").onclick = renderRanking;
  $("btn-back-home").onclick = () => {
    resetActionState();
    saveWorldPosition(true);
    $("play-screen").classList.remove("active");
    $("home-screen").classList.add("active");
    renderSlots();
    renderRanking();
  };

  // 乗船 / 下船（シームレス切替）
  $("btn-board-toggle").onclick = () => {
    audioEngine.unlock();
    const save = currentSave();
    if (!save) return;
    if (scene3d.isBoating) {
      scene3d.setPlayerState({
        x: 0, z: -2, yaw: 0, isBoating: false,
        boatSpeed: getActiveBoat(save).speed, boatTier: getBestBoatTier(save)
      });
      $("status-banner").textContent = "🚶 桟橋へ下船しました！西の砂浜や東の磯へ歩けます";
    } else {
      const boat = getActiveBoat(save);
      if (boat.tier <= 0) {
        audioEngine.playFail();
        if (confirm("まだ船を持っていません。船ドックでミニ和船をレンタル（¥4,500/日）しますか？")) {
          openDockModal();
        }
        return;
      }
      scene3d.setPlayerState({
        x: 0, z: -18, yaw: 0, isBoating: true,
        boatSpeed: boat.speed, boatTier: boat.tier
      });
      $("status-banner").textContent = `🚤 ${boat.name}で出航！沖の魚群を目指そう`;
    }
    saveWorldPosition(false);
    syncWorldStatus();
    resetActionState();
  };

  // 港へワンタップ帰還
  $("btn-return-port").onclick = () => {
    const save = currentSave();
    if (!save) return;
    resetActionState();
    scene3d.setPlayerState({
      x: PIER_DOCK_POS.x, z: 2, yaw: 0, isBoating: false,
      boatSpeed: getActiveBoat(save).speed, boatTier: getBestBoatTier(save)
    });
    saveWorldPosition(false);
    syncWorldStatus();
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
  $("btn-open-bank").onclick = openBankModal;
  $("btn-open-dex").onclick = openDexModal;
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
