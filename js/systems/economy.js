import { getGachaGearList } from "./gacha.js?v=20261128_025924";

export const BOATS = [
  { id: "boat_none", tier: 0, name: "徒歩（船なし）", buyPrice: 0, rentPrice: 0, maxFuel: 0, speed: 0, desc: "港・堤防・砂浜・河口・磯を自由に歩いて探索" },
  { id: "boat_wasen", tier: 1, name: "ミニ和船（15馬力）", buyPrice: 48000, rentPrice: 4500, maxFuel: 40, speed: 1.15, desc: "近海エリアへ出航OK。燃費が良く小回りが利く" },
  { id: "boat_mid", tier: 2, name: "中型漁船 7.5m", buyPrice: 280000, rentPrice: 24000, maxFuel: 120, speed: 1.5, desc: "沖合・深海海溝まで到達可能。網漁も本格稼働" },
  { id: "boat_large", tier: 3, name: "FRP大型遠洋船 11m", buyPrice: 980000, rentPrice: 72000, maxFuel: 320, speed: 1.95, desc: "遠洋・南国サンゴ礁まで全海域を完全制覇！" }
];

export const FUEL_PRICE_PER_L = 160;

export const SHOP_ITEMS = [
  { id: "set_offshore", tab: "rod_reel", slot: "bundle", name: "沖釣り入門セット", price: 54000, items: ["rod_2", "reel_2", "line_2"], desc: "シーバス竿＋スピニング3000＋PE1.5号の一括セット" },
  { id: "set_big", tab: "rod_reel", slot: "bundle", name: "大物ハンターセット", price: 210000, items: ["rod_3", "reel_3", "line_3"], desc: "オフショア大物竿＋大型両軸＋PE4号のプロ仕様" },

  { id: "rod_1", tab: "rod_reel", slot: "rod", name: "入門の万能竿", price: 0, power: 1.0, desc: "堤防・砂浜の小物〜中型向け" },
  { id: "rod_2", tab: "rod_reel", slot: "rod", name: "シーバス・ライトジギング竿", price: 16000, power: 1.45, desc: "近海のタイ・スズキ・青物に対応" },
  { id: "rod_3", tab: "rod_reel", slot: "rod", name: "オフショア大物カーボン竿", price: 68000, power: 2.15, desc: "沖合・深海の大型魚と渡り合える" },
  { id: "rod_4", tab: "rod_reel", slot: "rod", name: "プロ用マグロ専用竿", price: 220000, power: 3.2, desc: "クロマグロ・クエ・メカジキ対応" },

  { id: "reel_1", tab: "rod_reel", slot: "reel", name: "スピニング 1000", price: 0, speed: 1.0, desc: "巻速度 x1.0 ・基本リール" },
  { id: "reel_2", tab: "rod_reel", slot: "reel", name: "スピニング 3000", price: 14000, speed: 1.28, desc: "巻速度 x1.28 ・滑らかなドラグ" },
  { id: "reel_3", tab: "rod_reel", slot: "reel", name: "大型両軸 14000", price: 82000, speed: 1.68, desc: "巻速度 x1.68 ・大物ファイト用" },
  { id: "reel_4", tab: "rod_reel", slot: "reel", name: "電動リール 9000", price: 240000, speed: 2.25, desc: "巻速度 x2.25 ・電動アシスト搭載" },

  { id: "line_1", tab: "gear_net", slot: "line", name: "ナイロン 3号", price: 0, strength: 1.0, desc: "強度 5kg ・入門ライン" },
  { id: "line_2", tab: "gear_net", slot: "line", name: "PE 1.5号＋フロロ", price: 9800, strength: 1.55, desc: "強度 14kg ・切れにくい" },
  { id: "line_3", tab: "gear_net", slot: "line", name: "PE 4号ディープ", price: 46000, strength: 2.35, desc: "強度 40kg ・深海＆青物対応" },
  { id: "line_4", tab: "gear_net", slot: "line", name: "PE 20号モンスター", price: 145000, strength: 3.5, desc: "強度 120kg ・超大型も安心" },

  { id: "cooler_1", tab: "gear_net", slot: "cooler", name: "小型クーラー (10枠)", price: 0, cap: 10, desc: "初期サイズ" },
  { id: "cooler_2", tab: "gear_net", slot: "cooler", name: "中型保冷クーラー (25枠)", price: 15000, cap: 25, desc: "網漁や遠征に便利" },
  { id: "cooler_3", tab: "gear_net", slot: "cooler", name: "大型エアポンプ付 (50枠)", price: 62000, cap: 50, desc: "活魚を大量持ち帰り" },
  { id: "cooler_4", tab: "gear_net", slot: "cooler", name: "業務用ライブウェル (80枠)", price: 175000, cap: 80, desc: "プロの大量水揚げ仕様" },

  { id: "shell_1", tab: "gear_net", slot: "shellTool", name: "手掘り熊手", price: 0, bonus: 1.0, desc: "基本の潮干狩り・磯採り" },
  { id: "shell_2", tab: "gear_net", slot: "shellTool", name: "ステンレス磯金＆ジョレン", price: 14000, bonus: 1.38, desc: "大粒・レア貝UP＆殻割れ軽減" },
  { id: "shell_3", tab: "gear_net", slot: "shellTool", name: "電動桁引き＆深海かご", price: 64000, bonus: 1.8, desc: "ホタテ・アカガイ・ツブ大量採取" },

  { id: "net_toami", tab: "gear_net", slot: "net", method: "toami", name: "入門 投網（とあみ）", price: 0, minCount: 2, maxCount: 3, fuelCost: 0, damageChance: 0.08, desc: "岸・浅場で小魚をまとめ獲り" },
  { id: "net_sashiami", tab: "gear_net", slot: "net", method: "sashiami", name: "沿岸 刺し網", price: 22000, minCount: 2, maxCount: 4, fuelCost: 3, damageChance: 0.14, desc: "磯・近海の中型魚やイセエビ狙い" },
  { id: "net_sokobiki", tab: "gear_net", slot: "net", method: "sokobiki", name: "底引き・桁引き網", price: 64000, minCount: 3, maxCount: 5, fuelCost: 6, damageChance: 0.25, desc: "海底のヒラメ・ノドグロ・ホタテ漁" },
  { id: "net_makiami", tab: "gear_net", slot: "net", method: "makiami", name: "大型 巻き網", price: 145000, minCount: 3, maxCount: 6, fuelCost: 10, damageChance: 0.28, desc: "青物・カツオ・マグロの群れを一網打尽" },
  { id: "net_kago", tab: "gear_net", slot: "net", method: "kago", name: "漁業用 貝・底かご", price: 30000, minCount: 2, maxCount: 4, fuelCost: 4, damageChance: 0.04, desc: "傷をつけずタコ・ウナギ・イセエビ捕獲" },

  { id: "bait_free", tab: "bait", slot: "bait", name: "サビキ・標準仕掛け", price: 0, pack: 0, attract: 1.0, desc: "無料・無限に使える基本仕掛け" },
  { id: "bait_isoma", tab: "bait", slot: "bait", name: "アオイソメ (20回分)", price: 600, pack: 20, attract: 1.18, desc: "誘引力x1.18 ・堤防・砂浜で定番" },
  { id: "bait_okiami", tab: "bait", slot: "bait", name: "特選オキアミ (20回分)", price: 900, pack: 20, attract: 1.28, desc: "誘引力x1.28 ・タイや青物に好反応" },
  { id: "bait_saba", tab: "bait", slot: "bait", name: "サバ切り身 (15回分)", price: 1500, pack: 15, attract: 1.45, desc: "誘引力x1.45 ・根魚・深海魚に強い" },
  { id: "bait_live_aji", tab: "bait", slot: "bait", name: "活きアジ (10回分)", price: 4200, pack: 10, attract: 1.85, desc: "誘引力x1.85 ・ヒラメ・ブリ・マグロ特効！" }
];

export const PART_TIME_JOBS = [
  { id: "job_aquarium_clean", gameType: "clean", icon: "🧼", name: "水族館・大水槽ガラス磨き", bonusHours: [9,10,11,12,13,14,15,16], bonusLabel: "昼の開館手当+20%", stamina: 14, basePay: 4200, quotaText: "汚れ除去 80%以上（18秒）", desc: "水槽のコケを指でこすってピカピカに磨こう！" },
  { id: "job_aquarium_feed", gameType: "feed", icon: "🐠", name: "水族館・お魚給餌タイム", bonusHours: [10,11,12,13,14,15,16,17], bonusLabel: "ショータイム手当+20%", stamina: 13, basePay: 4000, quotaText: "ペコペコ魚に 8匹以上給餌（15秒）", desc: "空腹の魚(😋)だけに素早くエサやり！サメ(🦈)に注意" },
  { id: "job_market_sort", gameType: "sort", icon: "📦", name: "魚市場の高速箱詰め仕分け", bonusHours: [4,5,6,7,8,9], bonusLabel: "早朝セリ手当+25%", stamina: 15, basePay: 4500, quotaText: "10件以上 正しく仕分け（15秒）", desc: "流れてくる魚・貝・漁具を正しい箱へ高速仕分け！" },
  { id: "job_oyster_shuck", gameType: "timing", icon: "🦪", name: "カキ・貝類のジャスト殻むき", bonusHours: [9,10,11,12,13,14,15], bonusLabel: "加工場ピーク手当+20%", stamina: 12, basePay: 3900, quotaText: "5個中 3個以上 成功", desc: "動くバーを緑ゾーンで止めて綺麗に殻を開けよう！" },
  { id: "job_ice_pack", gameType: "ice", icon: "🧊", name: "鮮魚冷凍庫の氷詰め管理", bonusHours: [12,13,14,15,16,17,18], bonusLabel: "鮮度管理手当+20%", stamina: 15, basePay: 4400, quotaText: "8回以上冷却＆腐敗ゼロ（15秒）", desc: "温度が上がる4つの鮮魚箱に氷を足して冷やし続けろ！" },
  { id: "job_net_repair", gameType: "repair", icon: "🕸️", name: "破れた漁網の補修作業", bonusHours: null, bonusLabel: "いつでも職人作業", stamina: 12, basePay: 3600, quotaText: "破れた網を 3枚以上修繕（15秒）", desc: "網のほつれ穴(🕳️)をすべてタップして素早く縫い直そう！" },
  { id: "job_port_patrol", gameType: "patrol", icon: "🚚", name: "港内鮮魚配送 ＆ 夜間見回り", bonusHours: [19,20,21,22,23,0,1,2,3], bonusLabel: "深夜見回り手当+25%", stamina: 16, basePay: 4600, quotaText: "10件以上 スピード対応（15秒）", desc: "光る配送先／桟橋ライトを制限時間内に回り切れ！" }
];

export function getJobRankInfo(totalClears = 0) {
  if (totalClears >= 30) return { title: "港のレジェンド", bonusMult: 1.4, next: null };
  if (totalClears >= 18) return { title: "エーススタッフ", bonusMult: 1.28, next: 30 };
  if (totalClears >= 9)  return { title: "熟練バイト",     bonusMult: 1.18, next: 18 };
  if (totalClears >= 3)  return { title: "一人前スタッフ", bonusMult: 1.08, next: 9 };
  return { title: "見習いスタッフ", bonusMult: 1.0, next: 3 };
}

export function getActiveBoat(save) {
  const now = Date.now();
  if (save.rentalBoat && save.rentalBoat.expiresAt <= now) save.rentalBoat = null;
  const ownedIds = save.ownedBoats || ["boat_none"];
  const candidates = ownedIds.map((id) => BOATS.find((b) => b.id === id)).filter(Boolean);
  if (save.rentalBoat) {
    const rb = BOATS.find((b) => b.id === save.rentalBoat.boatId);
    if (rb) candidates.push(rb);
  }
  const selected = candidates.find((b) => b.id === save.activeBoatId);
  if (selected && selected.tier > 0) return selected;
  candidates.sort((a, b) => b.tier - a.tier);
  return candidates[0] || BOATS[0];
}

export function getBestBoatTier(save) {
  const b = getActiveBoat(save);
  return b ? b.tier : 0;
}

export function getEquippedStats(save) {
  const g = save.gear || {};
  const all = [...SHOP_ITEMS, ...getGachaGearList()];
  const rod = all.find((x) => x.id === (g.rod || "rod_1")) || SHOP_ITEMS.find((x) => x.id === "rod_1");
  const reel = all.find((x) => x.id === (g.reel || "reel_1")) || SHOP_ITEMS.find((x) => x.id === "reel_1");
  const line = all.find((x) => x.id === (g.line || "line_1")) || SHOP_ITEMS.find((x) => x.id === "line_1");
  const cooler = all.find((x) => x.id === (g.cooler || "cooler_1")) || SHOP_ITEMS.find((x) => x.id === "cooler_1");
  const shellTool = all.find((x) => x.id === (g.shellTool || "shell_1")) || SHOP_ITEMS.find((x) => x.id === "shell_1");
  const net = all.find((x) => x.id === (g.net || "net_toami")) || SHOP_ITEMS.find((x) => x.id === "net_toami");
  let bait = all.find((x) => x.id === (g.bait || "bait_free")) || SHOP_ITEMS.find((x) => x.id === "bait_free");
  if (bait.pack > 0 && ((save.baitStock?.[bait.id]) || 0) <= 0) bait = SHOP_ITEMS.find((x) => x.id === "bait_free");

  return {
    rod, reel, line, cooler, shellTool, net, bait,
    rodPower: rod.power || 1, reelSpeed: reel.speed || 1, lineStrength: line.strength || 1,
    coolerCap: cooler.cap || 10, shellBonus: shellTool.bonus || 1, baitAttract: bait.attract || 1
  };
}

export function applyBankInterest(save) {
  if (!save.bank) save.bank = { ordinary: 0, loan: 0, lastCalcAt: Date.now() };
  const now = Date.now();
  const days = (now - (save.bank.lastCalcAt || now)) / 86400000;
  if (days >= 0.04) {
    if (save.bank.ordinary > 0) save.bank.ordinary += Math.floor(save.bank.ordinary * 0.002 * days);
    if (save.bank.loan > 0) save.bank.loan += Math.floor(save.bank.loan * 0.003 * days);
    save.bank.lastCalcAt = now;
  }
  return save.bank;
}
