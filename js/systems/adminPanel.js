import { SHOP_ITEMS, BOATS } from "./economy.js";
import { BUSINESS_DEFS } from "./business.js";
import { getAllSpecies } from "./fishingEngine.js";
import { getGachaGearList } from "./gacha.js";
import { setEnvOverride, getEnvOverride } from "./environment.js";
import { grantMonthlyPass, grantWeeklyPass, isMonthlyPassActive, isWeeklyPassActive } from "./pearlShop.js";
import { createCouponCode } from "../config/firebase.js";
import { audioEngine } from "./audioEngine.js";

export const ADMIN_PASSCODE = "sakana-admin";

let adminTab = "stats";
let adminUnlocked = sessionStorage.getItem("sakana_admin_ok") === "1";

export function verifyAdminAccess() {
  if (adminUnlocked) return true;
  const input = prompt("🔐 管理人パスコードを入力してください");
  if (input === ADMIN_PASSCODE) {
    adminUnlocked = true;
    sessionStorage.setItem("sakana_admin_ok", "1");
    return true;
  }
  if (input !== null) alert("パスコードが違います。");
  return false;
}

export function openAdminPanel({ save, scene3d, openModal, onSaveAndRefresh, onEnvChanged }) {
  if (!save) { alert("先にいずれかのセーブスロットに入ってください。"); return; }

  const tabsHtml = `
    <div class="shop-tabs">
      <button class="shop-tab ${adminTab === "stats" ? "active" : ""}" data-atab="stats">数値</button>
      <button class="shop-tab ${adminTab === "unlock" ? "active" : ""}" data-atab="unlock">解放/魚</button>
      <button class="shop-tab ${adminTab === "world" ? "active" : ""}" data-atab="world">環境/移動</button>
      <button class="shop-tab ${adminTab === "coupon" ? "active" : ""}" data-atab="coupon">パス/クーポン</button>
    </div>
  `;

  let body = "";
  if (adminTab === "stats") {
    body = `
      <div class="bank-box">
        <strong>💰 所持金・有償/無償真珠・貝殻・体力</strong>
        <div class="muted">¥${save.money.toLocaleString()} / 💎有償${save.paidPearls || 0} / 💠無償${save.freePearls || 0} / 🐚貝殻${save.shells || 0} / ⚡${save.stamina}</div>
        <div class="btn-row">
          <button class="btn-primary" id="adm-money-100k">+¥10万</button>
          <button class="btn-primary" id="adm-money-10m">+¥1,000万</button>
          <button class="btn-warn" id="adm-paid-3000">+💎有償3,000</button>
          <button class="btn-sub" id="adm-free-3000">+💠無償3,000</button>
          <button class="btn-warn" id="adm-shell-100">+🐚貝殻100</button>
          <button class="btn-sub" id="adm-full-sta">⚡体力＆⛽燃料MAX</button>
          <button class="btn-sub" id="adm-rep-100">⭐評判+100</button>
        </div>
        <div class="chat-input-row" style="margin-top:4px;">
          <input type="number" id="adm-custom-money" class="field-input" placeholder="任意の所持金額(¥)" />
          <button class="btn-primary" id="adm-set-money">設定</button>
        </div>
      </div>
      <div class="bank-box">
        <strong>🧹 養殖・クーラー操作</strong>
        <div class="btn-row">
          <button class="btn-sub" id="adm-farm-ready">🌱 養殖を全て即完了</button>
          <button class="btn-danger" id="adm-clear-cooler">🧊 クーラー全消去</button>
          <button class="btn-danger" id="adm-clear-loan">📄 借金ゼロ化</button>
        </div>
      </div>
    `;
  } else if (adminTab === "unlock") {
    const speciesOpts = getAllSpecies().map((s) => `<option value="${s.id}">[${s.rank}] ${s.name} (${s.speciesType})</option>`).join("");
    body = `
      <div class="bank-box">
        <strong>🔓 一括アンロック</strong>
        <div class="btn-row">
          <button class="btn-primary" id="adm-all-gear">🎣 全ショップ＆ガチャ装備</button>
          <button class="btn-primary" id="adm-all-boats">🚤 全船所有</button>
          <button class="btn-primary" id="adm-all-biz">🏪 全4店舗所有</button>
          <button class="btn-warn" id="adm-farm-max">🐟 生け簀6枠</button>
          <button class="btn-sub" id="adm-all-dex">📖 図鑑コンプ</button>
        </div>
      </div>
      <div class="bank-box">
        <strong>🐟 指定した魚・貝をクーラーへ即生成</strong>
        <select id="adm-sp-select" class="field-input">${speciesOpts}</select>
        <select id="adm-tag-select" class="field-input">
          <option value="トロフィー特大">🏆 トロフィー特大</option>
          <option value="脂乗り抜群">✨ 脂乗り抜群</option>
          <option value="抱卵">🥚 抱卵</option>
          <option value="真珠入り">💎 真珠入り</option>
          <option value="活魚">🐟 通常・活魚</option>
        </select>
        <button class="btn-primary" id="adm-spawn-sp">クーラーへ1点生成</button>
      </div>
    `;
  } else if (adminTab === "world") {
    const ov = getEnvOverride() || {};
    body = `
      <div class="bank-box">
        <strong>🌦️ 環境オーバーライド</strong>
        <div class="pay-grid">
          <select id="adm-hour" class="field-input">
            <option value="">時刻: 現実連動</option>
            <option value="5" ${ov.hour === 5 ? "selected" : ""}>5時（朝焼け）</option>
            <option value="12" ${ov.hour === 12 ? "selected" : ""}>12時（昼）</option>
            <option value="17" ${ov.hour === 17 ? "selected" : ""}>17時（夕焼け）</option>
            <option value="22" ${ov.hour === 22 ? "selected" : ""}>22時（夜ライト）</option>
          </select>
          <select id="adm-weather" class="field-input">
            <option value="">天候: 現実連動</option>
            <option value="sunny" ${ov.weather === "sunny" ? "selected" : ""}>晴れ ☀️</option>
            <option value="cloudy" ${ov.weather === "cloudy" ? "selected" : ""}>曇り ☁️</option>
            <option value="rain" ${ov.weather === "rain" ? "selected" : ""}>雨 🌧️</option>
            <option value="fog" ${ov.weather === "fog" ? "selected" : ""}>霧 🌫️</option>
            <option value="rough" ${ov.weather === "rough" ? "selected" : ""}>シケ 🌊</option>
          </select>
          <select id="adm-season" class="field-input">
            <option value="">季節: 現実連動</option>
            <option value="spring" ${ov.season === "spring" ? "selected" : ""}>春</option>
            <option value="summer" ${ov.season === "summer" ? "selected" : ""}>夏</option>
            <option value="autumn" ${ov.season === "autumn" ? "selected" : ""}>秋</option>
            <option value="winter" ${ov.season === "winter" ? "selected" : ""}>冬</option>
          </select>
          <select id="adm-tide" class="field-input">
            <option value="">潮回り: 現実連動</option>
            <option value="大潮" ${ov.tideName === "大潮" ? "selected" : ""}>大潮</option>
            <option value="中潮" ${ov.tideName === "中潮" ? "selected" : ""}>中潮</option>
            <option value="小潮" ${ov.tideName === "小潮" ? "selected" : ""}>小潮</option>
          </select>
        </div>
        <div class="chat-input-row">
          <input type="number" step="0.1" id="adm-mkt" class="field-input" placeholder="相場倍率 (例: 3.0)" value="${ov.marketRate ?? ""}" />
          <button class="btn-primary" id="adm-apply-env">適用</button>
          <button class="btn-sub" id="adm-reset-env">解除</button>
        </div>
      </div>
      <div class="bank-box">
        <strong>🧭 ワールド瞬間ワープ</strong>
        <div class="btn-row">
          <button class="btn-mini" data-warp="0,4,0">堤防</button>
          <button class="btn-mini" data-warp="-70,6,0">砂浜</button>
          <button class="btn-mini" data-warp="-135,6,0">河口</button>
          <button class="btn-mini" data-warp="85,6,0">磯場</button>
          <button class="btn-mini" data-warp="0,-70,1">近海</button>
          <button class="btn-mini" data-warp="0,-180,1">沖合</button>
          <button class="btn-mini" data-warp="-120,-275,1">深海</button>
          <button class="btn-mini" data-warp="115,-275,1">南国</button>
          <button class="btn-mini" data-warp="0,-310,1">遠洋</button>
        </div>
      </div>
    `;
  } else {
    body = `
      <div class="bank-box">
        <strong>🌙 月パス＆🌤️ 週パス操作</strong>
        <div class="muted">月パス: ${isMonthlyPassActive(save) ? "有効" : "未加入"} / 週パス: ${isWeeklyPassActive(save) ? "有効" : "未加入"}</div>
        <div class="btn-row">
          <button class="btn-primary" id="adm-grant-mp">月パス付与</button>
          <button class="btn-warn" id="adm-grant-wp">週パス付与</button>
          <button class="btn-sub" id="adm-reset-daily">毎日受取リセット</button>
          <button class="btn-danger" id="adm-revoke-all">全パス解除</button>
        </div>
      </div>

      <div class="bank-box">
        <strong>🏷️ 割引クーポン発行（1人1回・人数＆割引額指定）</strong>
        <div class="pay-grid">
          <select id="cp-dtype" class="field-input">
            <option value="fixed">定額引き（◯円引き）</option>
            <option value="percent">割引率（◯%OFF）</option>
          </select>
          <input type="number" id="cp-dval" class="field-input" value="100" placeholder="金額 or %" />
          <select id="cp-target" class="field-input">
            <option value="all">対象: 全商品</option>
            <option value="pass">対象: パスのみ</option>
            <option value="pack">対象: 真珠パックのみ</option>
          </select>
          <input type="number" id="cp-dmax" class="field-input" value="1" min="1" placeholder="上限人数" />
        </div>
        <button class="btn-primary" id="adm-gen-discount">🏷️ 割引クーポンを発行</button>
      </div>

      <div class="bank-box">
        <strong>🎁 真珠配布＆パスコード発行（1人1回・任意個数＆人数）</strong>
        <div class="pay-grid">
          <select id="cp-gkind" class="field-input">
            <option value="free">💠 無償真珠を配布</option>
            <option value="paid">💎 有償真珠を配布</option>
            <option value="monthly_pass">🌙 月パス(30日)</option>
            <option value="weekly_pass">🌤️ 週パス(7日)</option>
          </select>
          <input type="number" id="cp-gamt" class="field-input" value="500" min="1" placeholder="真珠の個数" />
          <input type="number" id="cp-gmax" class="field-input" value="1" min="1" placeholder="上限人数(1〜)" />
          <button class="btn-warn" id="adm-gen-gift">🎁 コードを発行</button>
        </div>
        <div id="adm-code-out" class="muted">発行したコードがここに表示されます</div>
      </div>

      <div class="bank-box">
        <div class="btn-row">
          <button class="btn-sub" id="adm-export-json">セーブJSONコピー</button>
          <button class="btn-danger" id="adm-lock">管理人ログアウト</button>
        </div>
      </div>
    `;
  }

  openModal("🔧 管理人デバッグ＆チートページ", `<div class="admin-banner">⚠️ 管理者モード起動中</div>${tabsHtml}${body}`);

  const reopen = () => openAdminPanel({ save, scene3d, openModal, onSaveAndRefresh, onEnvChanged });
  const commit = (msg) => { audioEngine.playOk(); onSaveAndRefresh(true); if (msg) alert(msg); reopen(); };

  document.querySelectorAll("[data-atab]").forEach((b) => { b.onclick = () => { adminTab = b.dataset.atab; reopen(); }; });

  if (adminTab === "stats") {
    document.getElementById("adm-money-100k").onclick = () => { save.money += 100000; commit(); };
    document.getElementById("adm-money-10m").onclick = () => { save.money += 10000000; commit(); };
    document.getElementById("adm-paid-3000").onclick = () => { save.paidPearls = (save.paidPearls || 0) + 3000; commit(); };
    document.getElementById("adm-free-3000").onclick = () => { save.freePearls = (save.freePearls || 0) + 3000; commit(); };
    document.getElementById("adm-shell-100").onclick = () => { save.shells = (save.shells || 0) + 100; commit(); };
    document.getElementById("adm-full-sta").onclick = () => { save.stamina = 100; save.fuel = 320; commit(); };
    document.getElementById("adm-rep-100").onclick = () => { save.reputation = (save.reputation || 0) + 100; commit(); };
    document.getElementById("adm-set-money").onclick = () => { const v = Number(document.getElementById("adm-custom-money").value); if (!Number.isNaN(v) && v >= 0) { save.money = Math.floor(v); commit(); } };
    document.getElementById("adm-farm-ready").onclick = () => { (save.farm?.plots || []).forEach((p) => { if (p) p.readyAt = Date.now() - 1000; }); commit("養殖を全完了にしました！"); };
    document.getElementById("adm-clear-cooler").onclick = () => { save.cooler = []; commit("クーラーを空にしました"); };
    document.getElementById("adm-clear-loan").onclick = () => { if (save.bank) save.bank.loan = 0; commit("借金をゼロにしました"); };
  } else if (adminTab === "unlock") {
    document.getElementById("adm-all-gear").onclick = () => {
      SHOP_ITEMS.forEach((it) => { if (it.slot === "bundle") return; if (it.slot === "bait" && it.pack > 0) save.baitStock[it.id] = 99; else if (!save.ownedGear.includes(it.id)) save.ownedGear.push(it.id); });
      getGachaGearList().forEach((g) => { if (!save.ownedGear.includes(g.id)) save.ownedGear.push(g.id); });
      commit("全ショップ＆全ガチャ装備を解放しました！");
    };
    document.getElementById("adm-all-boats").onclick = () => { BOATS.forEach((b) => { if (!save.ownedBoats.includes(b.id)) save.ownedBoats.push(b.id); }); save.activeBoatId = "boat_large"; save.fuel = 320; scene3d?.updateBoatSpec(1.95, 3); commit("全船所有しました！"); };
    document.getElementById("adm-all-biz").onclick = () => { BUSINESS_DEFS.forEach((b) => { if (save.businesses[b.id]) save.businesses[b.id].owned = true; }); commit("全4店舗所有にしました！"); };
    document.getElementById("adm-farm-max").onclick = () => { save.farm.maxPlots = 6; while (save.farm.plots.length < 6) save.farm.plots.push(null); commit("生け簀6枠解放しました！"); };
    document.getElementById("adm-all-dex").onclick = () => { getAllSpecies().forEach((sp) => { if (!save.dex[sp.id]) save.dex[sp.id] = { count: 1, maxKg: sp.trophyKg || sp.maxKg }; }); commit(`全${getAllSpecies().length}種コンプしました！`); };
    document.getElementById("adm-spawn-sp").onclick = () => {
      const id = document.getElementById("adm-sp-select").value, tag = document.getElementById("adm-tag-select").value;
      const sp = getAllSpecies().find((s) => s.id === id); if (!sp) return;
      const kg = tag === "トロフィー特大" ? Number(sp.maxKg.toFixed(2)) : Number(((sp.minKg + sp.maxKg) * 0.6).toFixed(2));
      const price = Math.max(500, Math.round(kg * sp.basePricePerKg * (tag === "真珠入り" ? 3.2 : 1.5)));
      save.cooler.push({ id: sp.id, name: sp.name, rank: sp.rank, weightKg: kg, tags: [tag, "🔧生成"], price });
      if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
      save.dex[sp.id].count += 1; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, kg);
      commit(`${sp.name}を生成しました！`);
    };
  } else if (adminTab === "world") {
    document.getElementById("adm-apply-env").onclick = () => {
      const obj = {};
      const h = document.getElementById("adm-hour").value, w = document.getElementById("adm-weather").value, s = document.getElementById("adm-season").value, t = document.getElementById("adm-tide").value, m = document.getElementById("adm-mkt").value;
      if (h !== "") obj.hour = Number(h); if (w) obj.weather = w; if (s) obj.season = s; if (t) obj.tideName = t; if (m !== "" && Number(m) > 0) obj.marketRate = Number(m);
      setEnvOverride(Object.keys(obj).length ? obj : null); onEnvChanged(); commit("環境を上書きしました！");
    };
    document.getElementById("adm-reset-env").onclick = () => { setEnvOverride(null); onEnvChanged(); commit("現実連動に戻しました！"); };
    document.querySelectorAll("[data-warp]").forEach((btn) => {
      btn.onclick = () => {
        const [x, z, bf] = btn.dataset.warp.split(",").map(Number);
        if (bf === 1 && !save.ownedBoats.includes("boat_large")) { save.ownedBoats.push("boat_large"); save.activeBoatId = "boat_large"; save.fuel = 320; }
        scene3d?.setPlayerState({ x, z, yaw: 0, isBoating: bf === 1, boatSpeed: 1.95, boatTier: 3 });
        commit(`(${x}, ${z})へワープしました！`);
      };
    });
  } else {
    document.getElementById("adm-grant-mp").onclick = () => { grantMonthlyPass(save); commit("月パスを付与しました！"); };
    document.getElementById("adm-grant-wp").onclick = () => { grantWeeklyPass(save); commit("週パスを付与しました！"); };
    document.getElementById("adm-reset-daily").onclick = () => { if (save.monthlyPass) save.monthlyPass.lastClaimKey = ""; if (save.weeklyPass) save.weeklyPass.lastClaimKey = ""; commit("毎日受取をリセットしました！"); };
    document.getElementById("adm-revoke-all").onclick = () => { save.monthlyPass = null; save.weeklyPass = null; commit("全パスを解除しました"); };

    const randCode = (pre) => `${pre}-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    document.getElementById("adm-gen-discount").onclick = async () => {
      const discountType = document.getElementById("cp-dtype").value;
      const value = Math.max(1, Number(document.getElementById("cp-dval").value) || 100);
      const target = document.getElementById("cp-target").value;
      const maxUses = Math.max(1, Number(document.getElementById("cp-dmax").value) || 1);
      const code = randCode("OFF");
      const ok = await createCouponCode(code, { kind: "discount", discountType, value, target, maxUses });
      const out = document.getElementById("adm-code-out");
      if (ok && out) { out.innerHTML = `✅ 割引コード: <strong style="color:#ffd166;user-select:text;">${code}</strong>（上限${maxUses}人・1人1回）`; audioEngine.playCash(); }
      else alert("発行失敗（Firebase RTDBルールにcouponsを追加してください）");
    };

    document.getElementById("adm-gen-gift").onclick = async () => {
      const sel = document.getElementById("cp-gkind").value;
      const amount = Math.max(1, Number(document.getElementById("cp-gamt").value) || 100);
      const maxUses = Math.max(1, Number(document.getElementById("cp-gmax").value) || 1);
      let payload, pre;
      if (sel === "monthly_pass") { payload = { kind: "monthly_pass", maxUses }; pre = "MP30"; }
      else if (sel === "weekly_pass") { payload = { kind: "weekly_pass", maxUses }; pre = "WP07"; }
      else { payload = { kind: "pearls", pearlType: sel, amount, maxUses }; pre = sel === "paid" ? "PAID" : "FREE"; }
      const code = randCode(pre);
      const ok = await createCouponCode(code, payload);
      const out = document.getElementById("adm-code-out");
      if (ok && out) { out.innerHTML = `✅ 配布コード: <strong style="color:#ffd166;user-select:text;">${code}</strong> <button class="btn-mini" data-copy-code="${code}">📋 コピー</button>（上限${maxUses}人・1人1回）`; audioEngine.playCash(); }
      else alert("発行失敗（Firebase RTDBルールにcouponsを追加してください）");
    };

    document.getElementById("adm-export-json").onclick = async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(save, null, 2)); alert("コピーしました！"); }
      catch { prompt("コピー:", JSON.stringify(save)); }
    };
    
    /* admin-code-one-tap-copy */
    document.querySelectorAll("[data-copy-code]").forEach((btn) => {
      btn.onclick = async () => {
        const codeText = btn.dataset.copyCode || "";
        if (!codeText) return;
        try {
          await navigator.clipboard.writeText(codeText);
          alert(`コピーしました: ${codeText}`);
        } catch {
          prompt("コピーしてください:", codeText);
        }
      };
    });
    
    document.getElementById("adm-lock").onclick = () => { adminUnlocked = false; sessionStorage.removeItem("sakana_admin_ok"); document.getElementById("btn-close-modal")?.click(); };
  }
}
