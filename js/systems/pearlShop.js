import { getJstDateKey } from "../config/firebase.js?v=20261128_051000";

export const PAYMENT_URLS = {
  pearl_100: "", pearl_340: "", pearl_750: "", pearl_1500: "",
  pearl_2800: "", pearl_5600: "", pearl_10000: "",
  monthly_pass: "", weekly_pass: ""
};

export const PAYMENT_METHODS = [
  { id: "paypay", label: "📱 PayPay",           note: "スマホアプリで即決済" },
  { id: "card",   label: "💳 クレジットカード", note: "Visa / Master / JCB / Amex" },
  { id: "wallet", label: "🍎 Apple / Google Pay", note: "端末のワンタップ決済" },
  { id: "conv",   label: "🏪 コンビニ / キャリア", note: "セブン・ローソン・各社払い" }
];

// 課金パック7種（有償真珠💎 ＋ 高額ほどお得なボーナス無償真珠💠）
export const PEARL_PACKS = [
  { id: "pearl_100",   name: "お試し真珠",   paid: 100,  bonusFree: 0,    jpy: 160,   tag: "入門" },
  { id: "pearl_340",   name: "真珠のしずく", paid: 300,  bonusFree: 40,   jpy: 480,   tag: "+13%" },
  { id: "pearl_750",   name: "真珠の小袋",   paid: 620,  bonusFree: 130,  jpy: 980,   tag: "+21%" },
  { id: "pearl_1500",  name: "真珠の巾着",   paid: 1150, bonusFree: 350,  jpy: 1800,  tag: "+30%" },
  { id: "pearl_2800",  name: "真珠の宝箱",   paid: 2050, bonusFree: 750,  jpy: 3200,  tag: "人気 +37%" },
  { id: "pearl_5600",  name: "竜宮の真珠箱", paid: 3850, bonusFree: 1750, jpy: 6000,  tag: "+45%" },
  { id: "pearl_10000", name: "海神の大宝箱", paid: 6400, bonusFree: 3600, jpy: 10000, tag: "最大 +56%" }
];

export const MONTHLY_PASS_DEF = {
  id: "monthly_pass",
  name: "🌙 真珠の恵み・月パス（30日間）",
  jpy: 480,
  days: 30,
  instantPaid: 300,
  instantMoney: 30000,
  dailyFree: 100,
  dailyMoney: 8000,
  desc: "即💎有償300＋¥30,000 / 毎日💠無償100＋¥8,000 / 休憩回復2倍・釣果査定常時+10%・養殖20%短縮・🌙VIP"
};

export const WEEKLY_PASS_DEF = {
  id: "weekly_pass",
  name: "🌤️ 港のお試し・週パス（7日間）",
  jpy: 160,
  days: 7,
  instantPaid: 100,
  instantMoney: 5000,
  dailyFree: 60,
  dailyMoney: 3000,
  desc: "即💎有償100＋¥5,000 / 毎日💠無償60＋¥3,000 / 休憩回復1.5倍（月パスとW加入＆同時受取OK）"
};

export const PEARL_USES = [
  { id: "use_stamina", icon: "⚡", name: "スタミナ完全回復",        cost: 30, desc: "体力を一瞬で100/100へ全回復" },
  { id: "use_hotspot", icon: "🐟", name: "大魚群ソナー呼び寄せ",    cost: 50, desc: "自分の周囲へ特大魚群を即出現させる" },
  { id: "use_farm",    icon: "🌱", name: "養殖池すべて即時収穫OK",  cost: 60, desc: "育成中の生け簀・垂下養殖を今すぐ完了" },
  { id: "use_charm",   icon: "🍀", name: "真珠の潮汐チャーム(30分)", cost: 80, desc: "30分間 レア確率大幅UP＆全釣果査定+25%" }
];

export function getTotalPearls(save) {
  return (save?.paidPearls || 0) + (save?.freePearls || 0);
}

// 通常消費は無償真珠💠から優先消費し、不足分を有償真珠💎から消費
export function spendPearls(save, cost, paidOnly = false) {
  if (cost <= 0) return true;
  if (paidOnly) {
    if ((save.paidPearls || 0) < cost) return false;
    save.paidPearls -= cost;
    return true;
  }
  if (getTotalPearls(save) < cost) return false;
  const fromFree = Math.min(save.freePearls || 0, cost);
  save.freePearls = (save.freePearls || 0) - fromFree;
  const rem = cost - fromFree;
  if (rem > 0) save.paidPearls = (save.paidPearls || 0) - rem;
  return true;
}

export function isMonthlyPassActive(save) {
  return !!(save?.monthlyPass && save.monthlyPass.expiresAt > Date.now());
}

export function isWeeklyPassActive(save) {
  return !!(save?.weeklyPass && save.weeklyPass.expiresAt > Date.now());
}

export function canClaimMonthlyDaily(save) {
  return isMonthlyPassActive(save) && save.monthlyPass.lastClaimKey !== getJstDateKey();
}

export function canClaimWeeklyDaily(save) {
  return isWeeklyPassActive(save) && save.weeklyPass.lastClaimKey !== getJstDateKey();
}

export function canClaimAnyPass(save) {
  return canClaimMonthlyDaily(save) || canClaimWeeklyDaily(save);
}

export function grantMonthlyPass(save) {
  const now = Date.now();
  const base = Math.max(now, save.monthlyPass?.expiresAt || 0);
  save.monthlyPass = { expiresAt: base + MONTHLY_PASS_DEF.days * 86400000, lastClaimKey: save.monthlyPass?.lastClaimKey || "" };
  save.paidPearls = (save.paidPearls || 0) + MONTHLY_PASS_DEF.instantPaid;
  save.money += MONTHLY_PASS_DEF.instantMoney;
}

export function grantWeeklyPass(save) {
  const now = Date.now();
  const base = Math.max(now, save.weeklyPass?.expiresAt || 0);
  save.weeklyPass = { expiresAt: base + WEEKLY_PASS_DEF.days * 86400000, lastClaimKey: save.weeklyPass?.lastClaimKey || "" };
  save.paidPearls = (save.paidPearls || 0) + WEEKLY_PASS_DEF.instantPaid;
  save.money += WEEKLY_PASS_DEF.instantMoney;
}

export function claimAllDailyPassRewards(save) {
  const today = getJstDateKey();
  let freeGain = 0, moneyGain = 0;
  if (canClaimMonthlyDaily(save)) {
    save.monthlyPass.lastClaimKey = today;
    freeGain += MONTHLY_PASS_DEF.dailyFree;
    moneyGain += MONTHLY_PASS_DEF.dailyMoney;
  }
  if (canClaimWeeklyDaily(save)) {
    save.weeklyPass.lastClaimKey = today;
    freeGain += WEEKLY_PASS_DEF.dailyFree;
    moneyGain += WEEKLY_PASS_DEF.dailyMoney;
  }
  if (freeGain > 0 || moneyGain > 0) {
    save.freePearls = (save.freePearls || 0) + freeGain;
    save.money += moneyGain;
  }
  return { freeGain, moneyGain };
}

export function calcDiscountedPrice(jpy, coupon, itemId) {
  if (!coupon || coupon.kind !== "discount") return jpy;
  const target = coupon.target || "all";
  const isPass = itemId === "monthly_pass" || itemId === "weekly_pass";
  if (target === "pass" && !isPass) return jpy;
  if (target === "pack" && isPass) return jpy;
  if (coupon.discountType === "percent") {
    return Math.max(10, Math.round(jpy * (1 - Math.min(90, coupon.value || 0) / 100)));
  }
  return Math.max(10, jpy - (coupon.value || 0));
}

// 希少な無償真珠マイルストーン（図鑑・バイト累計など）
export function checkFreePearlMilestones(save) {
  if (!save.claimedMilestones) save.claimedMilestones = [];
  const dexCount = Object.keys(save.dex || {}).length;
  const jobClears = save.jobProfile?.totalClears || 0;
  const checks = [
    { id: "dex_10",  cond: dexCount >= 10,   reward: 30,  label: "図鑑10種達成" },
    { id: "dex_25",  cond: dexCount >= 25,   reward: 60,  label: "図鑑25種達成" },
    { id: "dex_50",  cond: dexCount >= 50,   reward: 120, label: "図鑑50種達成" },
    { id: "dex_80",  cond: dexCount >= 80,   reward: 200, label: "図鑑80種達成" },
    { id: "dex_100", cond: dexCount >= 100,  reward: 400, label: "図鑑100種達成" },
    { id: "job_10",  cond: jobClears >= 10,  reward: 40,  label: "バイト10回達成" },
    { id: "job_30",  cond: jobClears >= 30,  reward: 100, label: "バイト30回達成" }
  ];
  const gained = [];
  for (const c of checks) {
    if (c.cond && !save.claimedMilestones.includes(c.id)) {
      save.claimedMilestones.push(c.id);
      save.freePearls = (save.freePearls || 0) + c.reward;
      gained.push(`${c.label}（💠+${c.reward}）`);
    }
  }
  return gained;
}

// ===== Phase 8: Stripe Checkout 開始 =====
export const PAY_WORKER_URL = "https://sakana-pay.asterism1246.workers.dev";

export async function startStripeCheckout({ productId, uid, couponCode = "", payMethod = "card" }) {
  if (!uid) throw new Error("クラウド接続が完了していません。少し待ってからもう一度お試しください。");
  const res = await fetch(`${PAY_WORKER_URL}/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId,
      uid,
      couponCode: couponCode || "",
      payMethod,
      returnUrl: window.location.origin + window.location.pathname
    })
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || !data.url) {
    throw new Error(data.error || `決済ページの作成に失敗しました (HTTP ${res.status})`);
  }
  return data.url;
}

/* pass-extend-remaining-expiry */
export function computeExtendedPassExpiry(currentExpiresAt, durationMs) {
  const base = Math.max(Date.now(), Number(currentExpiresAt || 0));
  return base + Number(durationMs || 0);
}
