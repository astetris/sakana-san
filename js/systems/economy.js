export const AREA_REQUIREMENTS = {
  teibou:   { name: "堤防",   minBoatTier: 0, isBoatArea: false },
  kakou:    { name: "河口",   minBoatTier: 0, isBoatArea: false },
  sunahama: { name: "砂浜",   minBoatTier: 0, isBoatArea: false },
  iso:      { name: "磯",     minBoatTier: 0, isBoatArea: false },
  kinkai:   { name: "近海",   minBoatTier: 1, isBoatArea: true },
  okiai:    { name: "沖合",   minBoatTier: 2, isBoatArea: true },
  shinkai:  { name: "深海",   minBoatTier: 2, isBoatArea: true },
  enyou:    { name: "遠洋",   minBoatTier: 3, isBoatArea: true },
  nangoku:  { name: "南国",   minBoatTier: 3, isBoatArea: true }
};

// 15%オフ気軽レンタル設定
export const BOATS = [
  { id: "boat_none", tier: 0, name: "徒歩・岸釣り", buyPrice: 0, rentPrice: 0, maxFuel: 0, speed: 0, desc: "堤防・河口・砂浜・磯で遊べる" },
  { id: "boat_wasen", tier: 1, name: "和船（小舟）", buyPrice: 65000, rentPrice: 6800, maxFuel: 40, speed: 1.0, desc: "近海へ出航可能。小回りが利き燃費が良い" },
  { id: "boat_mid", tier: 2, name: "中型漁船", buyPrice: 320000, rentPrice: 38000, maxFuel: 100, speed: 1.35, desc: "沖合・深海に対応。底引き網や大型魚群を狙える" },
  { id: "boat_large", tier: 3, name: "大型遠洋漁船", buyPrice: 1200000, rentPrice: 110000, maxFuel: 250, speed: 1.7, desc: "遠洋・南国を含む全海域へ出航可能！" }
];

export const FUEL_PRICE_PER_L = 160;

export const SHOP_ITEMS = [
  // 竿
  { id: "rod_1", slot: "rod", name: "入門グラスロッド", price: 0, power: 1.0, desc: "堤防の小物〜中型向け" },
  { id: "rod_2", slot: "rod", name: "シーバス・ライトジギング竿", price: 18000, power: 1.45, desc: "近海のタイ・スズキ・青物に対応" },
  { id: "rod_3", slot: "rod", name: "オフショア大物カーボン竿", price: 75000, power: 2.1, desc: "沖合・深海の大型魚と渡り合える" },
  { id: "rod_4", slot: "rod", name: "遠洋マグロ専用ヘビー竿", price: 240000, power: 3.1, desc: "クロマグロ・クエ・メカジキ対応" },

  // ライン
  { id: "line_1", slot: "line", name: "ナイロン3号", price: 0, strength: 1.0, desc: "標準強度" },
  { id: "line_2", slot: "line", name: "PE1.5号＋フロロリーダー", price: 12000, strength: 1.5, desc: "張り付きにくく切れにくい" },
  { id: "line_3", slot: "line", name: "PE4号ディープブレイド", price: 58000, strength: 2.3, desc: "大物の突っ込みに耐える" },
  { id: "line_4", slot: "line", name: "PE8号モンスターライン", price: 180000, strength: 3.4, desc: "Sランク超大型も安心" },

  // クーラー容量
  { id: "cooler_1", slot: "cooler", name: "小型クーラー(10枠)", price: 0, cap: 10, desc: "初期サイズ" },
  { id: "cooler_2", slot: "cooler", name: "中型保冷クーラー(25枠)", price: 15000, cap: 25, desc: "網漁や遠征に便利" },
  { id: "cooler_3", slot: "cooler", name: "大型エアポンプ付(50枠)", price: 65000, cap: 50, desc: "大量の活魚を持ち帰り可能" },
  { id: "cooler_4", slot: "cooler", name: "業務用ライブウェル(80枠)", price: 190000, cap: 80, desc: "プロの大量漁獲仕様" },

  // 貝採取道具
  { id: "shell_1", slot: "shellTool", name: "手掘り熊手", price: 0, bonus: 1.0, desc: "基本の潮干狩り・磯採り道具" },
  { id: "shell_2", slot: "shellTool", name: "ステンレス磯金＆ジョレン", price: 14000, bonus: 1.35, desc: "大粒・レア貝の確率UP＆殻割れ軽減" },
  { id: "shell_3", slot: "shellTool", name: "電動桁引き＆深海かごセット", price: 68000, bonus: 1.75, desc: "ホタテ・アカガイ・ツブガイの収穫効率大幅UP" },

  // 網漁装備
  { id: "net_toami", slot: "net", method: "toami", name: "入門 投網（とあみ）", price: 0, minCount: 2, maxCount: 3, fuelCost: 0, damageChance: 0.08, desc: "岸・浅場で小魚をまとめて獲れる" },
  { id: "net_sashiami", slot: "net", method: "sashiami", name: "沿岸 刺し網", price: 22000, minCount: 2, maxCount: 4, fuelCost: 3, damageChance: 0.14, desc: "磯・近海の中型魚やイセエビも狙える" },
  { id: "net_sokobiki", slot: "net", method: "sokobiki", name: "底引き・桁引き網セット", price: 64000, minCount: 3, maxCount: 5, fuelCost: 6, damageChance: 0.25, desc: "海底のヒラメ・ノドグロ・ホタテを一網打尽" },
  { id: "net_makiami", slot: "net", method: "makiami", name: "大型 巻き網", price: 150000, minCount: 3, maxCount: 6, fuelCost: 10, damageChance: 0.28, desc: "青物・カツオ・マグロの群れを包囲漁獲！" },
  { id: "net_kago", slot: "net", method: "kago", name: "漁業用 貝・底かご", price: 32000, minCount: 2, maxCount: 4, fuelCost: 4, damageChance: 0.05, desc: "傷をつけずタコ・ウナギ・イセエビ・ツブガイを捕獲" }
];

export const PART_TIME_JOBS = [
  { id: "job_market", gameType: "sort", name: "早朝・魚市場の箱詰め仕分け", hours: [4, 5, 6, 7, 8, 9], stamina: 16, basePay: 4200, desc: "12秒間の高速仕分け作業！連続正解で出来高UP" },
  { id: "job_oyster", gameType: "timing", name: "カキ・貝類の殻むき加工", hours: [9, 10, 11, 12, 13, 14, 15, 16], stamina: 14, basePay: 3600, desc: "5回勝負のタイミング殻むき！ジャスト連発で高額報酬" },
  { id: "job_delivery", gameType: "patrol", name: "鮮魚トラックの港内配送", hours: [11, 12, 13, 14, 15, 16, 17, 18], stamina: 18, basePay: 4600, desc: "12秒間の港内スピード配達！光る配送先を素早く回る" },
  { id: "job_night", gameType: "patrol", name: "夜の桟橋ライト点検・見回り", hours: [19, 20, 21, 22, 23, 0, 1, 2, 3], stamina: 15, basePay: 4400, desc: "深夜手当つき！光る異常ライトを素早く点検" },
  { id: "job_any", gameType: "sort", name: "漁具倉庫の整理（いつでも単発）", hours: null, stamina: 12, basePay: 2500, desc: "時間帯不問の仕分け仕事。サクッと小遣い稼ぎ" }
];

export function getActiveBoat(save) {
  const now = Date.now();
  // レンタル期限チェック
  if (save.rentalBoat && save.rentalBoat.expiresAt <= now) {
    save.rentalBoat = null;
  }
  const ownedIds = save.ownedBoats || ["boat_none"];
  const candidates = ownedIds
    .map((id) => BOATS.find((b) => b.id === id))
    .filter(Boolean);
  if (save.rentalBoat) {
    const rb = BOATS.find((b) => b.id === save.rentalBoat.boatId);
    if (rb) candidates.push(rb);
  }
  const selected = candidates.find((b) => b.id === save.activeBoatId);
  if (selected) return selected;
  candidates.sort((a, b) => b.tier - a.tier);
  return candidates[0] || BOATS[0];
}

export function getBestBoatTier(save) {
  const b = getActiveBoat(save);
  return b ? b.tier : 0;
}

export function getEquippedStats(save) {
  const g = save.gear || {};
  const rod = SHOP_ITEMS.find((x) => x.id === (g.rod || "rod_1")) || SHOP_ITEMS[0];
  const line = SHOP_ITEMS.find((x) => x.id === (g.line || "line_1")) || SHOP_ITEMS[4];
  const cooler = SHOP_ITEMS.find((x) => x.id === (g.cooler || "cooler_1")) || SHOP_ITEMS[8];
  const shellTool = SHOP_ITEMS.find((x) => x.id === (g.shellTool || "shell_1")) || SHOP_ITEMS[12];
  const net = SHOP_ITEMS.find((x) => x.id === (g.net || "net_toami")) || SHOP_ITEMS[15];
  return {
    rod, line, cooler, shellTool, net,
    rodPower: rod.power || 1,
    lineStrength: line.strength || 1,
    coolerCap: cooler.cap || 10,
    shellBonus: shellTool.bonus || 1
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
