function seededRandom(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function getRealWorldEnv(now = new Date()) {
  const month = now.getMonth() + 1;
  const hour = now.getHours();
  const min = now.getMinutes();

  let season = "spring", seasonJa = "春";
  if (month >= 6 && month <= 8) { season = "summer"; seasonJa = "夏"; }
  else if (month >= 9 && month <= 11) { season = "autumn"; seasonJa = "秋"; }
  else if (month === 12 || month <= 2) { season = "winter"; seasonJa = "冬"; }

  const dayKey = `${now.getFullYear()}-${month}-${now.getDate()}`;
  const blockKey = `${dayKey}-${Math.floor(hour / 3)}`;

  const rWeather = seededRandom(blockKey + "-w");
  let weather = "sunny", weatherJa = "晴れ ☀️";
  if (rWeather > 0.88) { weather = "rough"; weatherJa = "シケ 🌊"; }
  else if (rWeather > 0.76) { weather = "fog"; weatherJa = "霧 🌫️"; }
  else if (rWeather > 0.58) { weather = "rain"; weatherJa = "雨 🌧️"; }
  else if (rWeather > 0.34) { weather = "cloudy"; weatherJa = "曇り ☁️"; }

  const rWind = seededRandom(blockKey + "-wind");
  const wind = rWind < 0.45 ? "onshore" : rWind < 0.85 ? "offshore" : "any";
  const windJa = wind === "onshore" ? "向かい風" : wind === "offshore" ? "追い風" : "無風";

  const baseTemps = { spring: 16, summer: 24, autumn: 19, winter: 11 };
  const tempOffset = (seededRandom(dayKey + "-temp") - 0.5) * 4;
  const waterTemp = Number((baseTemps[season] + tempOffset).toFixed(1));

  const dayNum = Math.floor(now.getTime() / 86400000);
  const tideCycle = dayNum % 15;
  let tideName = "中潮";
  if (tideCycle <= 2 || tideCycle === 14) tideName = "大潮";
  else if (tideCycle >= 6 && tideCycle <= 8) tideName = "小潮";
  else if (tideCycle === 9) tideName = "長潮";
  else if (tideCycle === 10) tideName = "若潮";

  let timePhase = "day";
  if (hour >= 5 && hour < 7) timePhase = "dawn";
  else if (hour >= 16 && hour < 19) timePhase = "dusk";
  else if (hour >= 19 || hour < 5) timePhase = "night";

  const marketRate = Number((0.85 + seededRandom(dayKey + "-mkt") * 0.5).toFixed(2));

  return {
    now, month, hour, min, dayKey,
    season, seasonJa, weather, weatherJa, wind, windJa,
    waterTemp, tideName, timePhase, marketRate,
    clockText: `${now.getFullYear()}/${String(month).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")} (${seasonJa})`
  };
}
