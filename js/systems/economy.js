export const SHOP_ITEMS = [
  // 竿・タックル
  { id: "rod_1", slot: "rod", name: "入門グラスロッド", price: 0, power: 1.0, desc: "堤防の小物〜中型向け" },
  { id: "rod_2", slot: "rod", name: "シーバス・ライトジギング竿", price: 18000, power: 1.45, desc: "近海のタイ・スズキ・青物に対応" },
  { id: "rod_3", slot: "rod", name: "オフショア大物カーボン竿", price: 75000, power: 2.1, desc: "沖合・深海の大型魚と渡り合える" },
  { id: "rod_4", slot: "rod", name: "遠洋マグロ専用ヘビー竿", price: 240000, power: 3.1, desc: "クロマグロ・クエ・メカジキ対応" },

  // ライン（糸強度）
  { id: "line_1", slot: "line", name: "ナイロン3号", price: 0, strength: 1.0, desc: "標準強度" },
  { id: "line_2", slot: "line", name: "PE1.5号＋フロロリーダー", price: 12000, strength: 1.5, desc: "張り付きにくく切れにくい" },
  { id: "line_3", slot: "line", name: "PE4号ディープブレイド", price: 58000, strength: 2.3, desc: "大物の突っ込みに耐える" },
  { id: "line_4", slot: "line", name: "PE8号モンスターライン", price: 180000, strength: 3.4, desc: "Sランク超大型も安心" },

  // クーラー容量拡張
  { id: "cooler_1", slot: "cooler", name: "小型クーラー(10枠)", price: 0, cap: 10, desc: "初期サイズ" },
  { id: "cooler_2", slot: "cooler", name: "中型保冷クーラー(25枠)", price: 15000, cap: 25, desc: "まとめ買い・遠征に便利" },
  { id: "cooler_3", slot: "cooler", name: "大型エアポンプ付(50枠)", price: 65000, cap: 50, desc: "活魚を大量に持ち帰り可能" },
  { id: "cooler_4", slot: "cooler", name: "業務用ライブウェル(80枠)", price: 190000, cap: 80, desc: "プロの大量漁獲仕様" },

  // 貝採取・網道具
  { id: "shell_1", slot: "shellTool", name: "手掘り熊手", price: 0, bonus: 1.0, desc: "基本の潮干狩り・磯採り道具" },
  { id: "shell_2", slot: "shellTool", name: "ステンレス磯金＆ジョレン", price: 14000, bonus: 1.35, desc: "大粒・レア貝の確率UP＆殻割れ軽減" },
  { id: "shell_3", slot: "shellTool", name: "電動桁引き＆深海かごセット", price: 68000, bonus: 1.75, desc: "ホタテ・アカガイ・ツブガイの収穫効率大幅UP" }
];

export const PART_TIME_JOBS = [
  { id: "job_market", name: "早朝・魚市場の箱詰め仕分け", hours: [4, 5, 6, 7, 8, 9], stamina: 18, pay: 5200, desc: "朝市タイム限定の高時給バイト" },
  { id: "job_oyster", name: "カキ・貝類の砂抜き＆殻むき", hours: [9, 10, 11, 12, 13, 14, 15, 16], stamina: 15, pay: 4200, desc: "昼の漁協加工場での軽作業" },
  { id: "job_delivery", name: "鮮魚トラックの港内配送", hours: [11, 12, 13, 14, 15, 16, 17, 18], stamina: 20, pay: 5800, desc: "少し体力を使うが稼げる定番シフト" },
  { id: "job_night", name: "夜の桟橋ライト点検・見回り", hours: [19, 20, 21, 22, 23, 0, 1, 2, 3], stamina: 16, pay: 5400, desc: "深夜手当つきの静かな港バイト" },
  { id: "job_any", name: "漁具倉庫の整理（いつでも単発）", hours: null, stamina: 12, pay: 2800, desc: "時間帯を問わずすぐ働ける単発仕事" }
];

export function getEquippedStats(save) {
  const g = save.gear || {};
  const rod = SHOP_ITEMS.find((x) => x.id === (g.rod || "rod_1")) || SHOP_ITEMS[0];
  const line = SHOP_ITEMS.find((x) => x.id === (g.line || "line_1")) || SHOP_ITEMS[4];
  const cooler = SHOP_ITEMS.find((x) => x.id === (g.cooler || "cooler_1")) || SHOP_ITEMS[8];
  const shellTool = SHOP_ITEMS.find((x) => x.id === (g.shellTool || "shell_1")) || SHOP_ITEMS[12];
  return {
    rod,
    line,
    cooler,
    shellTool,
    rodPower: rod.power || 1,
    lineStrength: line.strength || 1,
    coolerCap: cooler.cap || 10,
    shellBonus: shellTool.bonus || 1
  };
}

// ゆるめ快適バランス（普通預金 日利0.2% / 漁協ローン 日利0.3%）
export function applyBankInterest(save) {
  if (!save.bank) save.bank = { ordinary: 0, loan: 0, lastCalcAt: Date.now() };
  const now = Date.now();
  const days = (now - (save.bank.lastCalcAt || now)) / 86400000;
  if (days >= 0.04) { // 約1時間以上の経過で日割り反映
    if (save.bank.ordinary > 0) {
      const interest = Math.floor(save.bank.ordinary * 0.002 * days);
      save.bank.ordinary += interest;
    }
    if (save.bank.loan > 0) {
      const fee = Math.floor(save.bank.loan * 0.003 * days);
      save.bank.loan += fee;
    }
    save.bank.lastCalcAt = now;
  }
  return save.bank;
}
