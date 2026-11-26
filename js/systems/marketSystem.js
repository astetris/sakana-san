export class MarketSystem {
  constructor(state, fishMaster) {
    this.state = state;
    this.fishMaster = fishMaster;
    if (!Object.keys(this.state.marketRates).length) {
      this.refreshDailyMarket();
    }
  }

  refreshDailyMarket() {
    const rates = {};
    const weatherBoost = this.state.weather === 'rough' ? 1.25 : this.state.weather === 'rain' ? 1.08 : 1.0;

    // ランダムで1魚種を本日の高騰魚に設定
    const hotFish = this.fishMaster[Math.floor(Math.random() * this.fishMaster.length)];

    for (const f of this.fishMaster) {
      let mult = (0.85 + Math.random() * 0.35) * weatherBoost;
      if (f.id === hotFish.id) {
        mult *= 1.35;
      }
      rates[f.id] = Number(mult.toFixed(2));
    }

    this.state.marketRates = rates;
    this.state.marketNews =
      this.state.weather === 'rough'
        ? `【シケ高騰】全体相場アップ！特に「${hotFish.name}」が品薄高値`
        : `【本日の特需】「${hotFish.name}」の需要が急上昇中（x${rates[hotFish.id]}）`;
  }

  getSellPrice(fishItem) {
    const master = this.fishMaster.find((f) => f.id === fishItem.fishId);
    if (!master) return 100;
    const rate = this.state.marketRates[fishItem.fishId] || 1.0;
    return Math.max(50, Math.round(master.basePricePerKg * fishItem.weightKg * rate));
  }

  sellAll() {
    let total = 0;
    for (const item of this.state.cooler) {
      total += this.getSellPrice(item);
    }
    this.state.money += total;
    this.state.cooler = [];
    this.state.save();
    return total;
  }
}
