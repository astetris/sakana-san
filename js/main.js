import { initFirebase, fetchDailyRanking, submitDailyRecord } from "./config/firebase.js";
import { getRealWorldEnv } from "./systems/environment.js";
import { audioEngine } from "./systems/audioEngine.js";
import {
  SHOP_ITEMS, PART_TIME_JOBS, getEquippedStats, applyBankInterest
} from "./systems/economy.js";
import {
  syncLoadSlots, persistSlots, createNewSave, ensureSaveDefaults
} from "./state/saveManager.js";
import {
  loadSpeciesMaster, getAllSpecies, rollCatch, rollShellfish, getShellMethodForArea
} from "./systems/fishingEngine.js";
import { FishingScene } from "./scenes/fishingScene.js";

const $ = (id) => document.getElementById(id);

let slots = [];
let activeSlotIndex = -1;
let env = getRealWorldEnv();
let scene3d;

let harvestMode = "fish"; // fish | shell
let phase = "idle";       // idle | waiting | bite | fighting
let waitTimer = null;
let biteTimer = null;
let fightState = null;
let isReeling = false;

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
  $("area-select").value = save.area || "teibou";
  updateHud();
  syncHarvestTabs();
  $("home-screen").classList.remove("active");
  $("play-screen").classList.add("active");
  resetActionState();
}

function updateHud() {
  const save = currentSave();
  if (!save) return;
  ensureSaveDefaults(save);
  const stats = getEquippedStats(save);
  $("hud-name").textContent = save.name;
  $("hud-money").textContent = `¥${save.money.toLocaleString()}`;
  $("hud-stamina").textContent = save.stamina;
  $("hud-cooler-count").textContent = `${save.cooler.length}/${stats.coolerCap}`;
  $("gear-power-hint").textContent = `(竿x${stats.rodPower} / 糸x${stats.lineStrength})`;
}

function syncHarvestTabs() {
  const save = currentSave();
  if (!save) return;
  const shellMethod = getShellMethodForArea(save.area);
  const shellBtn = $("tab-mode-shell");
  if (shellMethod) {
    shellBtn.disabled = false;
    shellBtn.textContent = `🐚 ${shellMethod.label}`;
  } else {
    shellBtn.disabled = true;
    shellBtn.textContent = "🐚 貝採取なし";
    if (harvestMode === "shell") harvestMode = "fish";
  }
  $("tab-mode-fish").classList.toggle("active", harvestMode === "fish");
  shellBtn.classList.toggle("active", harvestMode === "shell");
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
  const btn = $("btn-main-action");
  if (harvestMode === "shell" && save) {
    const m = getShellMethodForArea(save.area);
    btn.className = "btn-action shell";
    btn.textContent = `🐚 ${m ? m.label : "貝採取"}する（⚡3）`;
    $("status-banner").textContent = `${m ? m.label : "貝採取"}スポット！大潮の日は大粒チャンス`;
  } else {
    btn.className = "btn-action";
    btn.textContent = "🎣 キャスト（⚡2）";
    $("status-banner").textContent = "キャストボタンを押して釣り開始！";
  }
}

function checkCoolerSpace(save) {
  const { coolerCap } = getEquippedStats(save);
  if (save.cooler.length >= coolerCap) {
    $("status-banner").textContent = `クーラー満タン（${coolerCap}枠）！売却かショップ拡張しよう`;
    audioEngine.playFail();
    return false;
  }
  return true;
}

function doShellHarvest() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save)) return;
  if (save.stamina < 3) {
    $("status-banner").textContent = "スタミナ不足です（3分で1回復）";
    audioEngine.playFail();
    return;
  }
  const m = getShellMethodForArea(save.area);
  if (save.area === "iso" && env.weather === "rough") {
    $("status-banner").textContent = "シケで磯が危険なため今日は磯採り不可！";
    audioEngine.playFail();
    return;
  }

  save.stamina -= 3;
  save.lastPlayedAt = Date.now();
  audioEngine.playDig();
  $("status-banner").textContent = `${m.label}中...`;

  const { shellBonus } = getEquippedStats(save);
  const res = rollShellfish(save.area, env, shellBonus);
  if (!res) {
    $("status-banner").textContent = "ここでは貝が見つからなかった…";
    updateHud();
    return;
  }

  const sp = res.species;
  save.cooler.push({
    id: sp.id,
    name: `${sp.name}×${res.count}`,
    rank: sp.rank,
    weightKg: res.weightKg,
    tags: res.tags,
    price: res.estimatedPrice
  });
  if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
  save.dex[sp.id].count += res.count;
  save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, res.weightKg);
  save.stats.totalCaught += res.count;

  persistSlots(slots, true);
  updateHud();
  audioEngine.playCatch(sp.rank);

  openModal(
    `🐚 ${sp.name} ×${res.count}（ランク${sp.rank}）を採取！`,
    `
      <div><strong>合計重量:</strong> ${res.weightKg} kg（${m.label}）</div>
      <div><strong>査定額:</strong> ¥${res.estimatedPrice.toLocaleString()}（本日相場 x${env.marketRate}）</div>
      <div>${res.tags.map((t) => `<span class="tag ${t === "真珠入り" ? "gold" : ""}">${t}</span>`).join("")}</div>
      <p class="muted">${sp.desc}</p>
      <p>${sp.tasteNote}</p>
      <button class="btn-primary" id="btn-catch-ok">クーラーにしまって続ける</button>
    `
  );
  $("btn-catch-ok").onclick = closeModal;
  resetActionState();
}

function startCast() {
  const save = currentSave();
  if (!save || !checkCoolerSpace(save)) return;
  if (save.stamina < 2) {
    $("status-banner").textContent = "スタミナ不足です（3分で1回復します）";
    audioEngine.playFail();
    return;
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
  $("status-banner").textContent = "アタリを待っています...";

  const waitMs = 1900 + Math.random() * 3000;
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
  const caught = rollCatch(save.area, env);

  phase = "fighting";
  fightState = {
    caught,
    distance: 19 + Math.random() * 10,
    fishStamina: 100,
    tension: 24
  };

  $("fight-panel").classList.remove("hidden");
  $("btn-main-action").className = "btn-action reeling";
  $("btn-main-action").textContent = "🔄 長押しで巻く";
  $("status-banner").textContent = "ファイト中！ゲージが赤くなる前にドラグ調整！";
}

function tickFight() {
  if (phase !== "fighting" || !fightState) return;
  const save = currentSave();
  const { rodPower, lineStrength } = getEquippedStats(save);
  const f = fightState;
  const sp = f.caught.species;
  const drag = Number($("drag-slider").value) / 100;
  $("drag-val").textContent = `${Math.round(drag * 100)}%`;

  const rawPull = (sp.pullPower || 2) * (0.45 + Math.random() * 0.55) * (f.fishStamina > 20 ? 1 : 0.45);
  const effectivePull = rawPull / lineStrength;

  if (isReeling) {
    audioEngine.playReelTick(f.tension);
    f.tension += (drag * 5.8 + effectivePull * 0.72) - (3.4 + rodPower * 0.4);
    const gain = Math.max(0.1, (drag * 1.15 * rodPower) - (effectivePull * 0.08));
    f.distance = Math.max(0, f.distance - gain * 0.44);
    f.fishStamina = Math.max(0, f.fishStamina - (0.75 + drag * 0.75 * rodPower));
  } else {
    f.tension = Math.max(8, f.tension - 5.0);
    if (f.fishStamina > 15) f.distance += ((sp.speed || 2) / rodPower) * 0.032;
  }

  f.tension = Math.max(0, Math.min(105, f.tension));
  const rodPct = Math.min(100, f.tension / Math.max(1, rodPower * 0.85));
  const linePct = Math.min(100, f.tension);
  const reelPct = Math.min(100, f.tension * drag * 1.12);

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
  audioEngine.playCatch(sp.rank);

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
  resetActionState();
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

function openShopModal() {
  const save = currentSave();
  const rows = SHOP_ITEMS.map((item) => {
    const owned = save.ownedGear.includes(item.id);
    const equipped = save.gear[item.slot] === item.id;
    let btnHtml = "";
    if (equipped) btnHtml = `<span class="tag">装備中</span>`;
    else if (owned) btnHtml = `<button class="btn-sub" data-equip="${item.id}">装備</button>`;
    else btnHtml = `<button class="btn-primary" data-buy="${item.id}">¥${item.price.toLocaleString()}</button>`;

    return `
      <div class="list-row">
        <div>
          <strong>${item.name}</strong>
          <div class="muted">${item.desc}</div>
        </div>
        ${btnHtml}
      </div>
    `;
  }).join("");

  openModal(`🏪 釣具・漁具ショップ（所持 ¥${save.money.toLocaleString()}）`, rows);

  $("modal-body").querySelectorAll("[data-buy]").forEach((btn) => {
    btn.onclick = () => {
      const item = SHOP_ITEMS.find((x) => x.id === btn.dataset.buy);
      if (!item) return;
      if (save.money < item.price) {
        audioEngine.playFail();
        alert("お金が足りません！バイトや漁協ローンも活用できます。");
        return;
      }
      save.money -= item.price;
      save.ownedGear.push(item.id);
      save.gear[item.slot] = item.id;
      save.lastPlayedAt = Date.now();
      persistSlots(slots, true);
      updateHud();
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
      openShopModal();
    };
  });
}

function openJobsModal() {
  const save = currentSave();
  const h = env.hour;
  const rows = PART_TIME_JOBS.map((job) => {
    const available = !job.hours || job.hours.includes(h);
    return `
      <div class="list-row">
        <div>
          <strong>${job.name}</strong>
          <div class="muted">${job.desc} / 消費⚡${job.stamina}</div>
        </div>
        ${available
          ? `<button class="btn-primary" data-job="${job.id}">+¥${job.pay.toLocaleString()}</button>`
          : `<span class="muted">時間外</span>`
        }
      </div>
    `;
  }).join("");

  openModal(`💼 港のバイト（現在 ${h}時 / ⚡${save.stamina}）`, rows);

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
      save.money += job.pay;
      save.stats.totalEarned += job.pay;
      save.lastPlayedAt = Date.now();
      persistSlots(slots, true);
      updateHud();
      audioEngine.playCash();
      openJobsModal();
    };
  });
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
      <strong>📄 漁協ローン（日利 0.3%・上限30万円）</strong>
      <div>借入残高: <strong style="color:#ff7b7b;">¥${bank.loan.toLocaleString()}</strong></div>
      <div class="muted">装備や船の購入資金に低金利で借りられます。</div>
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
  $("loan-borrow-20k").onclick = () => { if (bank.loan + 20000 <= 300000) { bank.loan += 20000; save.money += 20000; done(); } };
  $("loan-borrow-50k").onclick = () => { if (bank.loan + 50000 <= 300000) { bank.loan += 50000; save.money += 50000; done(); } };
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

async function boot() {
  scene3d = new FishingScene($("scene-canvas"));
  updateSoundIcons();
  updateEnvironmentUI();
  setInterval(updateEnvironmentUI, 30000);
  setInterval(tickFight, 60);

  // 最初の画面タップでBGM＆波音を自動起動
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
    syncHarvestTabs();
    resetActionState();
  };
  $("tab-mode-fish").onclick = () => { harvestMode = "fish"; syncHarvestTabs(); resetActionState(); };
  $("tab-mode-shell").onclick = () => { harvestMode = "shell"; syncHarvestTabs(); resetActionState(); };

  $("btn-open-cooler").onclick = openCoolerModal;
  $("btn-open-shop").onclick = openShopModal;
  $("btn-open-jobs").onclick = openJobsModal;
  $("btn-open-bank").onclick = openBankModal;
  $("btn-open-dex").onclick = openDexModal;
  $("btn-close-modal").onclick = closeModal;

  const actBtn = $("btn-main-action");
  actBtn.addEventListener("pointerdown", () => {
    audioEngine.unlock();
    if (harvestMode === "shell") {
      doShellHarvest();
      return;
    }
    if (phase === "idle") startCast();
    else if (phase === "waiting") resetActionState();
    else if (phase === "bite") startFight();
    else if (phase === "fighting") isReeling = true;
  });
  window.addEventListener("pointerup", () => { isReeling = false; });
  window.addEventListener("pointercancel", () => { isReeling = false; });
}

boot();
