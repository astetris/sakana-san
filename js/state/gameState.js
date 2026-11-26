const SAVE_KEY = 'sakana_san_save_v1';

export class GameState {
  constructor() {
    this.money = 1000;
    this.day = 1;
    this.timeMinutes = 5 * 60 + 30; // 05:30 スタート
    this.weather = 'sunny'; // sunny | rain | rough
    this.quality = 'high';  // high | low
    this.cooler = [];       // { uid, fishId, name, rarity, weightKg, caughtDay }
    this.marketRates = {};  // { [fishId]: multiplier }
    this.marketNews = '';
    this.equipped = {
      rodId: 'rod_starter',
      reelId: 'reel_starter',
      lineId: 'line_starter',
      lureId: 'lure_jig'
    };
  }

  save() {
    try {
      const payload = {
        money: this.money,
        day: this.day,
        timeMinutes: this.timeMinutes,
        weather: this.weather,
        quality: this.quality,
        cooler: this.cooler,
        marketRates: this.marketRates,
        marketNews: this.marketNews,
        equipped: this.equipped
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch (_) {
      // プライベートブラウズ等で保存不可の場合は無視
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      Object.assign(this, data);
      return true;
    } catch (_) {
      return false;
    }
  }
}
