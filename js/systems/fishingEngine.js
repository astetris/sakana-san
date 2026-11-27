let speciesCache = [];

export async function loadSpeciesMaster() {
  const res = await fetch("./data/species.json");
  if (!res.ok) throw new Error("data/species.json の読み込みに失敗しました");
  speciesCache = await res.json();
  return speciesCache;
}

export function getAllSpecies() {
  return speciesCache;
}

export function rollCatch(areaId, env) {
  // Phase 1の釣り対象（貝類はPhase 2の潮干狩り・磯採り・桁引き網で採取）
  const candidates = speciesCache.filter(
    (s) => s.speciesType !== "shellfish" && s.areas.includes(areaId)
  );
  const pool = candidates.length ? candidates : speciesCache.filter((s) => s.speciesType !== "shellfish");

  const weighted = pool.map((s) => {
    let w = s.rarityWeight || 10;
    if (s.seasons.includes(env.season)) w *= 1.5;
    if (s.activeHours.includes(env.hour)) w *= 1.6;
    if (s.favWeather.includes(env.weather)) w *= 1.3;
    if (s.favWind === env.wind || s.favWind === "any") w *= 1.15;
    if (env.waterTemp < s.minTemp || env.waterTemp > s.maxTemp) w *= 0.45;
    return { species: s, weight: Math.max(1, w) };
  });

  const total = weighted.reduce((sum, x) => sum + x.weight, 0);
  let r = Math.random() * total;
  let picked = weighted[0].species;
  for (const item of weighted) {
    r -= item.weight;
    if (r <= 0) { picked = item.species; break; }
  }

  // 重量抽選（やや標準寄り＋稀にトロフィー）
  const spread = picked.maxKg - picked.minKg;
  const bias = Math.pow(Math.random(), 1.35);
  const weightKg = Number((picked.minKg + spread * bias).toFixed(2));

  // 体調タグ自動判定
  const tags = [];
  let priceMult = 1.0;

  if (weightKg >= picked.trophyKg) {
    tags.push("トロフィー特大");
    priceMult *= 1.6;
  } else if (weightKg < picked.minKg + spread * 0.2) {
    tags.push("少し小ぶり");
    priceMult *= 0.85;
  }

  if (picked.spawnSeasons?.includes(env.season) && Math.random() < 0.28) {
    tags.push("抱卵");
    priceMult *= 1.35;
  }
  if (picked.fatSeasons?.includes(env.season) && env.waterTemp <= (picked.minTemp + picked.maxTemp) / 2 + 1) {
    tags.push("脂乗り抜群");
    priceMult *= 1.4;
  }
  if (env.tideName === "大潮" || (picked.coldWaterBonus && env.waterTemp <= picked.minTemp + 4)) {
    tags.push("身の締まり◎");
    priceMult *= 1.2;
  }
  if (env.waterTemp < picked.minTemp - 2 || env.waterTemp > picked.maxTemp + 2) {
    tags.push("やや痩せ気味");
    priceMult *= 0.85;
  }
  if (tags.length === 0) tags.push("活魚");

  const estimatedPrice = Math.max(
    100,
    Math.round(weightKg * picked.basePricePerKg * priceMult * env.marketRate)
  );

  return {
    species: picked,
    weightKg,
    tags,
    estimatedPrice
  };
}
