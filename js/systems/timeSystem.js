const WEATHERS = [
  { id: 'sunny', label: '晴', weight: 0.65 },
  { id: 'rain', label: '雨', weight: 0.25 },
  { id: 'rough', label: 'シケ', weight: 0.10 }
];

export class TimeSystem {
  constructor(state, onNewDay) {
    this.state = state;
    this.onNewDay = onNewDay;
    this.acc = 0;
    // 現実1秒 = ゲーム内2分
    this.minutesPerRealSecond = 2.0;
  }

  update(dt) {
    this.acc += dt * this.minutesPerRealSecond;
    if (this.acc >= 1) {
      const add = Math.floor(this.acc);
      this.acc -= add;
      const prevHour = Math.floor(this.state.timeMinutes / 60);
      this.state.timeMinutes += add;

      if (this.state.timeMinutes >= 24 * 60) {
        this.state.timeMinutes -= 24 * 60;
        this.state.day += 1;
      }

      const currHour = Math.floor(this.state.timeMinutes / 60);
      // 毎朝5:00に天候＆市場相場を更新
      if (prevHour < 5 && currHour >= 5) {
        this.rollWeather();
        if (this.onNewDay) this.onNewDay();
        this.state.save();
      }
    }
  }

  rollWeather() {
    const r = Math.random();
    let sum = 0;
    for (const w of WEATHERS) {
      sum += w.weight;
      if (r <= sum) {
        this.state.weather = w.id;
        return;
      }
    }
    this.state.weather = 'sunny';
  }

  getHour() {
    return Math.floor(this.state.timeMinutes / 60);
  }

  getFormatted() {
    const h = String(this.getHour()).padStart(2, '0');
    const m = String(Math.floor(this.state.timeMinutes % 60)).padStart(2, '0');
    const wObj = WEATHERS.find((w) => w.id === this.state.weather) || WEATHERS[0];
    return `Day ${this.state.day} ${h}:${m} ${wObj.label}`;
  }
}
