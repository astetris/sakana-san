import {
  PAYMENT_URLS, PAYMENT_METHODS, PEARL_PACKS, MONTHLY_PASS_DEF, WEEKLY_PASS_DEF, PEARL_USES,
  getTotalPearls, spendPearls, isMonthlyPassActive, isWeeklyPassActive,
  canClaimAnyPass, claimAllDailyPassRewards, grantMonthlyPass, grantWeeklyPass, calcDiscountedPrice, startStripeCheckout
} from "./pearlShop.js?v=20261128_033716";
import { getActiveBanners, getExchangeCatalog, getGachaGearList, executeGachaDraw, applyGachaPrize } from "./gacha.js?v=20261128_033716";
import { previewCouponCode, redeemCouponCode, getCurrentUid } from "../config/firebase.js?v=20261128_033716";
import { audioEngine } from "./audioEngine.js?v=20261128_033716";

let pearlTab = "buy";
let gachaTab = "draw";
let selectedBannerId = null;
let selectedPayMethod = "paypay";

export function openPearlShopUI({ save, slotIndex = -1, scene3d, openModal, onSaveAndRefresh, onOpenGacha }) {
  const mOn = isMonthlyPassActive(save), wOn = isWeeklyPassActive(save);
  const mDays = mOn ? Math.ceil((save.monthlyPass.expiresAt - Date.now()) / 86400000) : 0;
  const wDays = wOn ? Math.ceil((save.weeklyPass.expiresAt - Date.now()) / 86400000) : 0;
  const canClaim = canClaimAnyPass(save);
  const activeCoupon = save.activeCoupon || null;

  const reopen = () => openPearlShopUI({ save, slotIndex, scene3d, openModal, onSaveAndRefresh, onOpenGacha });

  const headerBalance = `
    <div class="office-stats">
      <div><span class="muted">💎 有償真珠</span><strong style="color:#e9d5ff;">${(save.paidPearls || 0).toLocaleString()}</strong></div>
      <div><span class="muted">💠 無償真珠</span><strong style="color:#7dd3fc;">${(save.freePearls || 0).toLocaleString()}</strong></div>
      <div><span class="muted">🐚 黄金の貝殻</span><strong style="color:#fde68a;">${(save.shells || 0).toLocaleString()}</strong></div>
      <div><button class="btn-sub" id="ps-go-gacha" style="width:100%;padding:4px 6px;">🎰 ガチャへ</button></div>
    </div>
  `;

  const tabsHtml = `
    <div class="shop-tabs">
      <button class="shop-tab ${pearlTab === "buy" ? "active" : ""}" data-ptab="buy">💎 パス・真珠購入</button>
      <button class="shop-tab ${pearlTab === "use" ? "active" : ""}" data-ptab="use">✨ 真珠を使う</button>
    </div>
  `;

  if (pearlTab === "use") {
    const useRows = PEARL_USES.map((u) => `
      <div class="list-row">
        <div><strong>${u.icon} ${u.name}</strong><div class="muted">${u.desc}</div></div>
        <button class="btn-primary" data-puse="${u.id}">真珠${u.cost}</button>
      </div>
    `).join("");

    openModal(`💎 真珠の使い道（合計 ${getTotalPearls(save).toLocaleString()}個）`, `${headerBalance}${tabsHtml}<div class="muted">※無償真珠💠から優先消費されます</div>${useRows}`);

    document.querySelectorAll("[data-puse]").forEach((btn) => {
      btn.onclick = () => {
        const u = PEARL_USES.find((x) => x.id === btn.dataset.puse);
        if (!u || !spendPearls(save, u.cost, false)) { audioEngine.playFail(); alert("真珠が足りません！"); return; }
        if (u.id === "use_stamina") save.stamina = 100;
        else if (u.id === "use_hotspot") {
          scene3d.hotspots.forEach((h, i) => { if (i === 0) { h.x = scene3d.pos.x; h.z = Math.min(-18, scene3d.pos.y - 4); h.mesh.position.set(h.x, 0.25, h.z); } });
        } else if (u.id === "use_farm") {
          (save.farm?.plots || []).forEach((p) => { if (p) p.readyAt = Date.now() - 1000; });
        } else if (u.id === "use_charm") {
          save.pearlBuff = { label: "🍀真珠チャーム", priceMult: 1.25, rareBonus: true, expiresAt: Date.now() + 30 * 60000 };
        }
        onSaveAndRefresh(true); audioEngine.playCatch("A"); alert(`✨「${u.name}」を発動しました！`); reopen();
      };
    });
  } else {
    const payOpts = PAYMENT_METHODS.map((m) => `
      <button class="pay-opt ${selectedPayMethod === m.id ? "selected" : ""}" data-paym="${m.id}">
        <div>${m.label}</div><div class="muted" style="font-size:0.65rem;">${m.note}</div>
      </button>
    `).join("");

    const fmtPrice = (jpy, itemId) => {
      const disc = calcDiscountedPrice(jpy, activeCoupon, itemId);
      return disc < jpy ? `<s>¥${jpy.toLocaleString()}</s> → ¥${disc.toLocaleString()}` : `¥${jpy.toLocaleString()}`;
    };

    const packRows = PEARL_PACKS.map((pk) => `
      <div class="list-row">
        <div>
          <strong>💎 ${pk.name}（計${(pk.paid + pk.bonusFree).toLocaleString()}個）</strong>
          <span class="tag purple">${pk.tag}</span>
          <div class="muted">有償💎${pk.paid}${pk.bonusFree ? ` ＋ おまけ無償💠${pk.bonusFree}` : ""}</div>
        </div>
        <button class="btn-primary" data-buy-pack="${pk.id}">${fmtPrice(pk.jpy, pk.id)}</button>
      </div>
    `).join("");

    const couponNote = activeCoupon
      ? `<div class="bank-box" style="border-color:#38e59a;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>🏷️ 割引クーポン適用中: ${activeCoupon.code}</strong>
            <button class="btn-danger" id="btn-clear-coupon">外す</button>
          </div>
          <div class="muted">内容: ${activeCoupon.discountType === "percent" ? `${activeCoupon.value}%OFF` : `¥${activeCoupon.value}引き`}（次回購入で1回限り消費）</div>
         </div>` : "";

    openModal(`💎 真珠ショップ`, `
      ${headerBalance}
      ${tabsHtml}
      ${canClaim ? `<button class="btn-sub" id="btn-claim-pass" style="padding:10px;font-size:0.86rem;">🎁 本日のパス毎日報酬をまとめて受け取る！</button>` : ""}
      ${couponNote}
      <div class="bank-box" style="border-color:rgba(192,132,252,0.65);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${MONTHLY_PASS_DEF.name}</strong>
          <span class="tag purple">${mOn ? `加入中(残${mDays}日)` : `豪華版`}</span>
        </div>
        <div class="muted">${MONTHLY_PASS_DEF.desc}</div>
        <button class="btn-primary" data-buy-pack="monthly_pass">${mOn ? "30日延長" : "購入"} ${fmtPrice(MONTHLY_PASS_DEF.jpy, "monthly_pass")}</button>
      </div>
      <div class="bank-box" style="border-color:rgba(56,189,248,0.55);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${WEEKLY_PASS_DEF.name}</strong>
          <span class="tag">${wOn ? `加入中(残${wDays}日)` : `お試し`}</span>
        </div>
        <div class="muted">${WEEKLY_PASS_DEF.desc}</div>
        <button class="btn-warn" data-buy-pack="weekly_pass">${wOn ? "7日延長" : "購入"} ${fmtPrice(WEEKLY_PASS_DEF.jpy, "weekly_pass")}</button>
      </div>
      <div class="bank-box">
        <strong>💳 お支払い方法</strong>
      <!-- <div class="pay-grid">${payOpts}</div> -->
      </div>
      ${packRows}
      <div class="bank-box">
        <strong>🎫 クーポン / 引換コード入力（1人1回限り）</strong>
        <div class="chat-input-row" style="gap:6px;">
          <input id="redeem-input" class="field-input" placeholder="コードを入力" style="flex:1;text-transform:uppercase;" />
          <button type="button" id="btn-paste-redeem" class="btn-mini" style="padding:8px 10px;">📋 貼付</button>
          <button type="button" id="btn-redeem" class="btn-sub">適用・引換</button>
        </div>
      </div>
    `);

    if (document.getElementById("btn-claim-pass")) {
      document.getElementById("btn-claim-pass").onclick = () => {
        const { freeGain, moneyGain } = claimAllDailyPassRewards(save);
        onSaveAndRefresh(true); audioEngine.playCatch("A");
        alert(`🎁 毎日ログイン報酬を受け取りました！\n💠無償真珠 +${freeGain} / ¥${moneyGain.toLocaleString()}`);
        reopen();
      };
    }
    if (document.getElementById("btn-clear-coupon")) {
      document.getElementById("btn-clear-coupon").onclick = () => { save.activeCoupon = null; onSaveAndRefresh(false); reopen(); };
    }
    document.querySelectorAll("[data-paym]").forEach((b) => { b.onclick = () => { selectedPayMethod = b.dataset.paym; reopen(); }; });
    document.querySelectorAll("[data-buy-pack]").forEach((b) => {
      b.onclick = async () => {
        const pid = b.dataset.buyPack;
        const uid = getCurrentUid();
        if (!uid) {
          audioEngine.playFail();
          alert("クラウド接続が完了していないため購入できません。通信環境を確認して再読み込みしてください。");
          return;
        }
        const origHtml = b.innerHTML;
        b.disabled = true;
        b.textContent = "決済画面を準備中...";
        try {
          if (slotIndex >= 0) {
            try { localStorage.setItem("sakana_pending_slot", String(slotIndex)); } catch {}
          }
          const couponCode = save.activeCoupon?.code || "";
          const checkoutUrl = await startStripeCheckout({
            productId: pid,
            uid,
            couponCode,
            payMethod: selectedPayMethod
          });
          if (save.activeCoupon) {
            await redeemCouponCode(save.activeCoupon.code);
            save.activeCoupon = null;
          }
          onSaveAndRefresh(true);
          window.location.href = checkoutUrl;
        } catch (err) {
          b.disabled = false;
          b.innerHTML = origHtml;
          audioEngine.playFail();
          alert("決済の開始に失敗しました:\n" + (err?.message || err));
        }
      };
    });

    
    const pasteBtn = document.getElementById("btn-paste-redeem");
    const redeemInp = document.getElementById("redeem-input");
    if (pasteBtn && redeemInp) {
      pasteBtn.onclick = async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const clip = (await navigator.clipboard.readText() || "").trim();
            if (clip) {
              redeemInp.value = clip;
              audioEngine.playOk?.();
              return;
            }
          }
        } catch (_) {}
        redeemInp.focus();
        alert("入力欄を長押しして「貼り付け」を選んでください。");
      };
    }

    document.getElementById("btn-redeem").onclick = async () => {
      const rawCode = document.getElementById("redeem-input").value.trim().toUpperCase();
      if (!rawCode) return;
      const pre = await previewCouponCode(rawCode);
      if (!pre.ok) { audioEngine.playFail(); alert(pre.msg); return; }

      if (pre.data.kind === "discount") {
        save.activeCoupon = { code: rawCode, ...pre.data };
        onSaveAndRefresh(false); audioEngine.playOk();
        alert(`🏷️ 割引クーポン「${rawCode}」をセットしました！ショップ価格が割引表示になります。`);
        reopen();
        return;
      }

      const res = await redeemCouponCode(rawCode);
      if (!res.ok) { audioEngine.playFail(); alert(res.msg); return; }
      const d = res.data;
      if (d.kind === "monthly_pass") {
        grantMonthlyPass(save);
        alert(`🌙 月パス(30日)＋即💎${MONTHLY_PASS_DEF.instantPaid}＋¥${MONTHLY_PASS_DEF.instantMoney.toLocaleString()} を受取！`);
      } else if (d.kind === "weekly_pass") {
        grantWeeklyPass(save);
        alert(`🌤️ 週パス(7日)＋即💎${WEEKLY_PASS_DEF.instantPaid}＋¥${WEEKLY_PASS_DEF.instantMoney.toLocaleString()} を受取！`);
      } else if (d.kind === "pearls") {
        const amt = d.amount || 0;
        if (d.pearlType === "paid") { save.paidPearls = (save.paidPearls || 0) + amt; alert(`💎 有償真珠 ${amt.toLocaleString()}個 を受取！`); }
        else { save.freePearls = (save.freePearls || 0) + amt; alert(`💠 無償真珠 ${amt.toLocaleString()}個 を受取！`); }
      }
      onSaveAndRefresh(true); audioEngine.playCatch("S"); reopen();
    };
  }

  document.getElementById("ps-go-gacha").onclick = onOpenGacha;
  document.querySelectorAll("[data-ptab]").forEach((b) => { b.onclick = () => { pearlTab = b.dataset.ptab; reopen(); }; });
}

export function openGachaUI({ save, openModal, onSaveAndRefresh, onOpenPearls }) {
  const banners = getActiveBanners();
  if (!selectedBannerId || !banners.some((b) => b.id === selectedBannerId)) {
    selectedBannerId = banners[0]?.id || null;
  }
  const banner = banners.find((b) => b.id === selectedBannerId) || banners[0];
  const reopen = () => openGachaUI({ save, openModal, onSaveAndRefresh, onOpenPearls });

  const headerBalance = `
    <div class="office-stats">
      <div><span class="muted">💎 有償</span><strong style="color:#e9d5ff;">${(save.paidPearls || 0).toLocaleString()}</strong></div>
      <div><span class="muted">💠 無償</span><strong style="color:#7dd3fc;">${(save.freePearls || 0).toLocaleString()}</strong></div>
      <div><span class="muted">🐚 貝殻</span><strong style="color:#fde68a;">${(save.shells || 0).toLocaleString()}</strong></div>
      <div><button class="btn-sub" id="gc-go-pearls" style="width:100%;padding:4px 6px;">💎 補充</button></div>
    </div>
  `;

  const mainTabs = `
    <div class="shop-tabs">
      <button class="shop-tab ${gachaTab === "draw" ? "active" : ""}" data-gtab="draw">🎰 ガチャ</button>
      <button class="shop-tab ${gachaTab === "exchange" ? "active" : ""}" data-gtab="exchange">🐚 貝殻交換所</button>
      <button class="shop-tab ${gachaTab === "bag" ? "active" : ""}" data-gtab="bag">🎒 獲得装備</button>
    </div>
  `;

  let bodyHtml = "";
  if (gachaTab === "draw") {
    if (!banner) {
      bodyHtml = `<p class="muted">現在開催中のガチャはありません。</p>`;
    } else {
      const bTabs = banners.map((b) => `<button class="rank-tab ${b.id === banner.id ? "active" : ""}" data-bid="${b.id}">${b.name.slice(0, 14)}</button>`).join("");
      const starRows = (banner.pool || []).filter((x) => x.rarity >= 4).map((x) =>
        `<div class="muted"><strong class="${x.rarity === 5 ? "rank-S" : "rank-A"}">★${x.rarity}</strong> ${x.name}（${x.desc}）</div>`
      ).join("");
      const curLabel = banner.paidOnly ? "💎有償限定" : "💎/💠使用";
      bodyHtml = `
        <div class="rank-tabs">${bTabs}</div>
        <div class="bank-box" style="border-color:${banner.paidOnly ? "rgba(192,132,252,0.7)" : "rgba(243,198,135,0.6)"};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${banner.name}</strong>
            <span class="tag ${banner.paidOnly ? "purple" : "gold"}">${curLabel}</span>
          </div>
          <div class="muted">${banner.subtitle}</div>
          <div class="btn-row" style="margin-top:4px;">
            <button class="btn-warn" id="gc-draw-1" style="flex:1;">1回引く（${banner.singleCost}）</button>
            <button class="btn-primary" id="gc-draw-10" style="flex:1;">10連（${banner.tenCost}）★4確定+🐚${banner.shellBonusOnTen ?? 10}</button>
          </div>
        </div>
        <div class="bank-box"><strong>✨ 主な★5・★4ラインナップ</strong>${starRows}</div>
      `;
    }
  } else if (gachaTab === "exchange") {
    const catalog = getExchangeCatalog();
    bodyHtml = `
      <div class="muted">10連ボーナスや装備重複で貯めた「🐚 黄金の貝殻」で好きな景品と交換できます！</div>
      ${catalog.map((it) => {
        const owned = it.type === "gear" && save.ownedGear.includes(it.id);
        return `
          <div class="list-row">
            <div>
              <strong class="${it.rarity === 5 ? "rank-S" : it.rarity === 4 ? "rank-A" : "rank-B"}">[★${it.rarity}] ${it.name}</strong>
              ${owned ? `<span class="tag">所持済</span>` : ""}
              <div class="muted">${it.desc}</div>
            </div>
            <button class="btn-primary" data-exch="${it.id}" ${(save.shells || 0) < it.exchangeCost ? "disabled" : ""}>🐚${it.exchangeCost}</button>
          </div>
        `;
      }).join("")}
    `;
  } else {
    const gachaGears = getGachaGearList().filter((g) => save.ownedGear.includes(g.id));
    bodyHtml = gachaGears.length ? gachaGears.map((g) => {
      const equipped = save.gear[g.slot] === g.id;
      return `
        <div class="list-row">
          <div>
            <strong class="${g.rarity === 5 ? "rank-S" : "rank-A"}">[★${g.rarity}] ${g.name}</strong>
            <div class="muted">${g.desc}</div>
          </div>
          ${equipped ? `<span class="tag gold">装備中</span>` : `<button class="btn-sub" data-gequip="${g.id}">装備</button>`}
        </div>
      `;
    }).join("") : `<p class="muted">まだガチャ限定の装備を獲得していません。</p>`;
  }

  openModal("🎰 ガチャ ＆ 🐚 貝殻交換所", `${headerBalance}${mainTabs}${bodyHtml}`);

  document.getElementById("gc-go-pearls").onclick = onOpenPearls;
  document.querySelectorAll("[data-gtab]").forEach((b) => { b.onclick = () => { gachaTab = b.dataset.gtab; reopen(); }; });
  document.querySelectorAll("[data-bid]").forEach((b) => { b.onclick = () => { selectedBannerId = b.dataset.bid; reopen(); }; });

  const doPull = (n) => {
    const cost = n >= 10 ? banner.tenCost : banner.singleCost;
    if (!spendPearls(save, cost, !!banner.paidOnly)) {
      audioEngine.playFail();
      alert(banner.paidOnly ? "有償真珠💎が足りません！" : "真珠が足りません！");
      return;
    }
    const { results, bonusShells } = executeGachaDraw(save, banner, n);
    onSaveAndRefresh(true);
    const has5 = results.some((r) => r.prize.rarity === 5);
    audioEngine.playCatch(has5 ? "S" : "A");

    const rows = results.map((r) => `
      <div class="list-row">
        <div>
          <strong class="${r.prize.rarity === 5 ? "rank-S" : r.prize.rarity === 4 ? "rank-A" : "rank-B"}">[★${r.prize.rarity}] ${r.prize.name}</strong>
          <div class="muted">${r.isDupe ? `重複変換 → 🐚黄金の貝殻 +${r.convertedShells}` : r.prize.desc}</div>
        </div>
        ${r.prize.type === "gear" && !r.isDupe ? `<button class="btn-sub" data-quick-eq="${r.prize.id}">即装備</button>` : ""}
      </div>
    `).join("");

    openModal(`🎉 ガチャ結果（${n}連）`, `
      ${bonusShells ? `<div class="bank-box" style="text-align:center;color:#fde68a;font-weight:800;">🐚 10連ボーナス：黄金の貝殻 +${bonusShells}個 獲得！</div>` : ""}
      ${rows}
      <button class="btn-primary" id="gc-res-back">ガチャ画面へ戻る</button>
    `);
    document.getElementById("gc-res-back").onclick = reopen;
    document.querySelectorAll("[data-quick-eq]").forEach((btn) => {
      btn.onclick = () => {
        const g = getGachaGearList().find((x) => x.id === btn.dataset.quickEq);
        if (!g) return;
        save.gear[g.slot] = g.id;
        onSaveAndRefresh(true);
        btn.textContent = "装備済"; btn.disabled = true;
        audioEngine.playOk();
      };
    });
  };

  if (document.getElementById("gc-draw-1")) document.getElementById("gc-draw-1").onclick = () => doPull(1);
  if (document.getElementById("gc-draw-10")) document.getElementById("gc-draw-10").onclick = () => doPull(10);

  document.querySelectorAll("[data-exch]").forEach((btn) => {
    btn.onclick = () => {
      const it = getExchangeCatalog().find((x) => x.id === btn.dataset.exch);
      if (!it || (save.shells || 0) < it.exchangeCost) return;
      if (!confirm(`🐚黄金の貝殻 ${it.exchangeCost}個 で「${it.name}」と交換しますか？`)) return;
      save.shells -= it.exchangeCost;
      applyGachaPrize(save, it);
      onSaveAndRefresh(true); audioEngine.playCatch("S");
      alert(`✨「${it.name}」を交換しました！`);
      reopen();
    };
  });

  document.querySelectorAll("[data-gequip]").forEach((btn) => {
    btn.onclick = () => {
      const g = getGachaGearList().find((x) => x.id === btn.dataset.gequip);
      if (!g) return;
      save.gear[g.slot] = g.id;
      onSaveAndRefresh(true); audioEngine.playOk(); reopen();
    };
  });
}
