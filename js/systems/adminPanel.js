import { SHOP_ITEMS, BOATS } from "./economy.js";
import { BUSINESS_DEFS } from "./business.js";
import { getAllSpecies } from "./fishingEngine.js";
import { setEnvOverride, getEnvOverride } from "./environment.js";
import { grantMonthlyPass, isMonthlyPassActive } from "./pearlShop.js";
import { createRedeemCode } from "../config/firebase.js";
import { audioEngine } from "./audioEngine.js";

// 管理人パスコード（必要に応じてここを変更）
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
  if (!save) {
    alert("先にいずれかのセーブスロットに入ってから管理人ページを開いてください（またはホームから開く場合はスロット選択後）。");
    return;
  }

  const tabsHtml = `
    <div class="shop-tabs">
      <button class="shop-tab ${adminTab === "stats" ? "active" : ""}" data-atab="stats">数値</button>
      <button class="shop-tab ${adminTab === "unlock" ? "active" : ""}" data-atab="unlock">解放/魚</button>
      <button class="shop-tab ${adminTab === "world" ? "active" : ""}" data-atab="world">環境/移動</button>
      <button class="shop-tab ${adminTab === "billing" ? "active" : ""}" data-atab="billing">課金/保存</button>
    </div>
  `;

  let body = "";
  if (adminTab === "stats") {
    body = `
      <div class="bank-box">
        <strong>💰 所持金・真珠・体力・燃料・評判</strong>
        <div class="muted">現在: ¥${save.money.toLocaleString()} / 💎${save.pearls || 0} / ⚡${save.stamina} / ⛽${Math.floor(save.fuel || 0)}L / 評判${Math.round(save.reputation || 0)}</div>
        <div class="btn-row">
          <button class="btn-primary" id="adm-money-100k">+¥10万</button>
          <button class="btn-primary" id="adm-money-10m">+¥1,000万</button>
          <button class="btn-warn" id="adm-pearl-1000">+💎1,000</button>
          <button class="btn-warn" id="adm-pearl-10000">+💎10,000</button>
          <button class="btn-sub" id="adm-full-sta">⚡体力＆⛽燃料MAX</button>
          <button class="btn-sub" id="adm-rep-100">⭐評判+100</button>
        </div>
        <div class="chat-input-row" style="margin-top:4px;">
          <input type="number" id="adm-custom-money" class="field-input" placeholder="任意の所持金額(¥)" />
          <button class="btn-primary" id="adm-set-money">設定</button>
        </div>
      </div>
      <div class="bank-box">
        <strong>🧹 リセット・養殖＆クーラー操作</strong>
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
        <strong>🔓 一括アンロック（検証用チート）</strong>
        <div class="btn-row">
          <button class="btn-primary" id="adm-all-gear">🎣 全道具＆餌99個</button>
          <button class="btn-primary" id="adm-all-boats">🚤 全船所有</button>
          <button class="btn-primary" id="adm-all-biz">🏪 全4店舗所有</button>
          <button class="btn-warn" id="adm-farm-max">🐟 生け簀6枠解放</button>
          <button class="btn-sub" id="adm-all-dex">📖 図鑑105種コンプ</button>
        </div>
      </div>
      <div class="bank-box">
        <strong>🐟 指定した魚・貝をクーラーへ即生成</strong>
        <select id="adm-sp-select" class="field-input">${speciesOpts}</select>
        <select id="adm-tag-select" class="field-input">
          <option value="トロフィー特大">🏆 トロフィー特大（特大サイズ）</option>
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
        <strong>🌦️ 環境オーバーライド（リアルタイム反映）</strong>
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
    const passOn = isMonthlyPassActive(save);
    body = `
      <div class="bank-box">
        <strong>🌙 月額パス＆課金引換コード発行</strong>
        <div class="muted">月額パス状態: <strong>${passOn ? "有効" : "未加入"}</strong></div>
        <div class="btn-row">
          <button class="btn-primary" id="adm-grant-pass">月額パスを30日付与</button>
          <button class="btn-sub" id="adm-reset-daily">今日のパス受取をリセット</button>
          <button class="btn-danger" id="adm-revoke-pass">パス解除</button>
        </div>
        <div style="margin-top:6px;"><strong>🎫 引換コードを発行（Firebase登録）</strong></div>
        <div class="btn-row">
          <button class="btn-warn" id="adm-gen-p500">💎600コード発行</button>
          <button class="btn-warn" id="adm-gen-p1500">💎1560コード発行</button>
          <button class="btn-primary" id="adm-gen-pass">🌙月額パスコード発行</button>
        </div>
        <div id="adm-code-out" class="muted">発行するとここにコードが表示されます</div>
      </div>
      <div class="bank-box">
        <strong>💾 セーブデータJSON検証</strong>
        <div class="btn-row">
          <button class="btn-sub" id="adm-export-json">JSONをコピー</button>
          <button class="btn-danger" id="adm-lock">管理人ログアウト</button>
        </div>
      </div>
    `;
  }

  openModal("🔧 管理人デバッグ＆チートページ", `
    <div class="admin-banner">⚠️ 管理者モード起動中：不具合検証・バランス確認用の特権パネルです</div>
    ${tabsHtml}
    ${body}
  `);

  const reopen = () => openAdminPanel({ save, scene3d, openModal, onSaveAndRefresh, onEnvChanged });
  const commit = (msg) => {
    audioEngine.playOk();
    onSaveAndRefresh();
    if (msg) alert(msg);
    reopen();
  };

  document.querySelectorAll("[data-atab]").forEach((b) => {
    b.onclick = () => { adminTab = b.dataset.atab; reopen(); };
  });

  if (adminTab === "stats") {
    document.getElementById("adm-money-100k").onclick = () => { save.money += 100000; commit(); };
    document.getElementById("adm-money-10m").onclick = () => { save.money += 10000000; commit(); };
    document.getElementById("adm-pearl-1000").onclick = () => { save.pearls = (save.pearls || 0) + 1000; commit(); };
    document.getElementById("adm-pearl-10000").onclick = () => { save.pearls = (save.pearls || 0) + 10000; commit(); };
    document.getElementById("adm-full-sta").onclick = () => { save.stamina = 100; save.fuel = 320; commit(); };
    document.getElementById("adm-rep-100").onclick = () => { save.reputation = (save.reputation || 0) + 100; commit(); };
    document.getElementById("adm-set-money").onclick = () => {
      const v = Number(document.getElementById("adm-custom-money").value);
      if (!Number.isNaN(v) && v >= 0) { save.money = Math.floor(v); commit(); }
    };
    document.getElementById("adm-farm-ready").onclick = () => {
      (save.farm?.plots || []).forEach((p) => { if (p) p.readyAt = Date.now() - 1000; });
      commit("全ての養殖を収穫OKにしました！");
    };
    document.getElementById("adm-clear-cooler").onclick = () => { save.cooler = []; commit("クーラーを空にしました"); };
    document.getElementById("adm-clear-loan").onclick = () => { if (save.bank) save.bank.loan = 0; commit("借金をゼロにしました"); };
  } else if (adminTab === "unlock") {
    document.getElementById("adm-all-gear").onclick = () => {
      SHOP_ITEMS.forEach((it) => {
        if (it.slot === "bundle") return;
        if (it.slot === "bait" && it.pack > 0) save.baitStock[it.id] = 99;
        else if (!save.ownedGear.includes(it.id)) save.ownedGear.push(it.id);
      });
      commit("全釣具・網・餌99個を解放しました！");
    };
    document.getElementById("adm-all-boats").onclick = () => {
      BOATS.forEach((b) => { if (!save.ownedBoats.includes(b.id)) save.ownedBoats.push(b.id); });
      save.activeBoatId = "boat_large"; save.fuel = 320;
      scene3d?.updateBoatSpec(1.95, 3);
      commit("全船を所有＋大型遠洋船を装備しました！");
    };
    document.getElementById("adm-all-biz").onclick = () => {
      BUSINESS_DEFS.forEach((b) => { if (save.businesses[b.id]) save.businesses[b.id].owned = true; });
      commit("全4店舗を所有状態にしました！");
    };
    document.getElementById("adm-farm-max").onclick = () => {
      save.farm.maxPlots = 6;
      while (save.farm.plots.length < 6) save.farm.plots.push(null);
      commit("生け簀を最大6枠に解放しました！");
    };
    document.getElementById("adm-all-dex").onclick = () => {
      getAllSpecies().forEach((sp) => {
        if (!save.dex[sp.id]) save.dex[sp.id] = { count: 1, maxKg: sp.trophyKg || sp.maxKg };
      });
      commit(`全${getAllSpecies().length}種の図鑑をコンプリートしました！`);
    };
    document.getElementById("adm-spawn-sp").onclick = () => {
      const id = document.getElementById("adm-sp-select").value;
      const tag = document.getElementById("adm-tag-select").value;
      const sp = getAllSpecies().find((s) => s.id === id);
      if (!sp) return;
      const kg = tag === "トロフィー特大" ? Number(sp.maxKg.toFixed(2)) : Number(((sp.minKg + sp.maxKg) * 0.6).toFixed(2));
      const mult = tag === "真珠入り" ? 3.2 : tag === "トロフィー特大" ? 1.6 : 1.3;
      const price = Math.max(500, Math.round(kg * sp.basePricePerKg * mult));
      save.cooler.push({ id: sp.id, name: sp.name, rank: sp.rank, weightKg: kg, tags: [tag, "🔧生成"], price });
      if (!save.dex[sp.id]) save.dex[sp.id] = { count: 0, maxKg: 0 };
      save.dex[sp.id].count += 1; save.dex[sp.id].maxKg = Math.max(save.dex[sp.id].maxKg, kg);
      commit(`${sp.name}（${kg}kg / ${tag}）をクーラーへ追加しました！`);
    };
  } else if (adminTab === "world") {
    document.getElementById("adm-apply-env").onclick = () => {
      const h = document.getElementById("adm-hour").value;
      const w = document.getElementById("adm-weather").value;
      const s = document.getElementById("adm-season").value;
      const t = document.getElementById("adm-tide").value;
      const m = document.getElementById("adm-mkt").value;
      const obj = {};
      if (h !== "") obj.hour = Number(h);
      if (w) obj.weather = w;
      if (s) obj.season = s;
      if (t) obj.tideName = t;
      if (m !== "" && Number(m) > 0) obj.marketRate = Number(m);
      setEnvOverride(Object.keys(obj).length ? obj : null);
      onEnvChanged();
      commit("環境オーバーライドを適用しました！");
    };
    document.getElementById("adm-reset-env").onclick = () => {
      setEnvOverride(null); onEnvChanged(); commit("現実時間連動へ戻しました！");
    };
    document.querySelectorAll("[data-warp]").forEach((btn) => {
      btn.onclick = () => {
        const [x, z, boatFlag] = btn.dataset.warp.split(",").map(Number);
        if (boatFlag === 1 && !save.ownedBoats.includes("boat_large")) {
          save.ownedBoats.push("boat_large"); save.activeBoatId = "boat_large"; save.fuel = 320;
        }
        scene3d?.setPlayerState({ x, z, yaw: 0, isBoating: boatFlag === 1, boatSpeed: 1.95, boatTier: 3 });
        commit(`座標 (${x}, ${z}) へワープしました！`);
      };
    });
  } else {
    document.getElementById("adm-grant-pass").onclick = () => { grantMonthlyPass(save); commit("月額パス(30日)＆即時💎300を付与しました！"); };
    document.getElementById("adm-reset-daily").onclick = () => { if (save.monthlyPass) save.monthlyPass.lastClaimKey = ""; commit("本日の受取状態をリセットしました！"); };
    document.getElementById("adm-revoke-pass").onclick = () => { save.monthlyPass = null; commit("月額パスを解除しました"); };

    const genCode = async (prefix, payload) => {
      const code = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const ok = await createRedeemCode(code, payload);
      const out = document.getElementById("adm-code-out");
      if (ok && out) {
        out.innerHTML = `✅ 発行済コード: <strong style="color:#ffd166;user-select:text;">${code}</strong>（真珠ショップで入力可能）`;
        audioEngine.playCash();
      } else alert("コード登録に失敗しました（Firebase RTDBルールを確認）");
    };
    document.getElementById("adm-gen-p500").onclick = () => genCode("PRL600", { type: "pearls", pearls: 600 });
    document.getElementById("adm-gen-p1500").onclick = () => genCode("PRL1560", { type: "pearls", pearls: 1560 });
    document.getElementById("adm-gen-pass").onclick = () => genCode("PASS30", { type: "monthly_pass" });

    document.getElementById("adm-export-json").onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(save, null, 2));
        alert("現在のセーブJSONをクリップボードへコピーしました！");
      } catch { prompt("コピーしてください:", JSON.stringify(save)); }
    };
    document.getElementById("adm-lock").onclick = () => {
      adminUnlocked = false;
      sessionStorage.removeItem("sakana_admin_ok");
      alert("管理人モードからログアウトしました。");
      document.getElementById("btn-close-modal")?.click();
    };
  }
}
