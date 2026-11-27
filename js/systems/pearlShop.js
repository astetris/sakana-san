import { getJstDateKey } from "../config/firebase.js";

// 将来、Stripe / KOMOJU / BOOTH等の本番決済URLを取得したらここへ設定
export const PAYMENT_URLS = {
  pearl_120:  "",
  pearl_600:  "",
  pearl_1500: "",
  pearl_4200: "",
  monthly_pass: ""
};

export const PAYMENT_METHODS = [
  { id: "paypay", label: "📱 PayPay",           note: "スマホアプリで即決済" },
  { id: "card",   label: "💳 クレジットカード", note: "Visa / Master / JCB / Amex" },
  { id: "wallet", label: "🍎 Apple / Google Pay", note: "端末のワンタップ決済" },
  { id: "conv",   label: "🏪 コンビニ / キャリア", note: "セブン・ローソン・各社払い" }
];

// 課金で購入できるのは「課金専用の真珠」と「お得な月額パス」のみ
export const PEARL_PACKS = [
  { id: "pearl_120",  name: "真珠のしずく",   pearls: 120,  bonus: 0,    jpy: 160,  tag: "お試し" },
  { id: "pearl_600",  name: "真珠の小袋",     pearls: 500,  bonus: 100,  jpy: 650,  tag: "+20%お得" },
  { id: "pearl_1500", name: "真珠の宝箱",     pearls: 1200, bonus: 360,  jpy: 1500, tag: "一番人気" },
  { id: "pearl_4200", name: "竜宮の真珠箱",   pearls: 3200, bonus: 1200, jpy: 3800, tag: "超増量" }
];

export const MONTHLY_PASS_DEF = {
  id: "monthly_pass",
  name: "🌙 真珠の恵み・月額パス（30日間）",
  jpy: 480,
  instantPearls: 300,
  dailyPearls: 100,
  days: 30,
  desc: "購入時に即💎300＋30日間毎日ログインで💎100（合計最大💎3,300）！さらに休憩所回復速度2倍。"
};

// 真珠の使い道（ゲーム内で色んな事に使える）
export const PEARL_USES = [
  { id: "use_stamina", icon: "⚡", name: "スタミナ完全回復",       cost: 30, desc: "体力を一瞬で100/100へ全回復" },
  { id: "use_hotspot", icon: "🐟", name: "大魚群ソナー呼び寄せ",   cost: 50, desc: "自分の周囲へ特大魚群を即出現させる" },
  { id: "use_farm",    icon: "🌱", name: "養殖池すべて即時収穫OK", cost: 60, desc: "育成中の生け簀・垂下養殖を今すぐ完了" },
  { id: "use_charm",   icon: "🍀", name: "真珠の潮汐チャーム(30分)", cost: 80, desc: "30分間 レア確率大幅UP＆全釣果査定+25%" }
];

export function isMonthlyPassActive(save) {
  return !!(save.monthlyPass && save.monthlyPass.expiresAt > Date.now());
}

export function canClaimDailyPass(save) {
  if (!isMonthlyPassActive(save)) return false;
  return save.monthlyPass.lastClaimKey !== getJstDateKey();
}

export function grantMonthlyPass(save) {
  const now = Date.now();
  const base = Math.max(now, save.monthlyPass?.expiresAt || 0);
  save.monthlyPass = {
    expiresAt: base + MONTHLY_PASS_DEF.days * 86400000,
    lastClaimKey: save.monthlyPass?.lastClaimKey || ""
  };
  save.pearls = (save.pearls || 0) + MONTHLY_PASS_DEF.instantPearls;
}

export function claimMonthlyPassDaily(save) {
  if (!canClaimDailyPass(save)) return 0;
  save.monthlyPass.lastClaimKey = getJstDateKey();
  save.pearls = (save.pearls || 0) + MONTHLY_PASS_DEF.dailyPearls;
  return MONTHLY_PASS_DEF.dailyPearls;
}
