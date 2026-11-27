let speciesCache = [];

export async function loadSpeciesMaster() {
  const res = await fetch("./data/species.json");
  if (!res.ok) throw new Error("data/species.json の読み込みに失敗しました");
  speciesCache = await res.json();
  return speciesCache;
}

export function getAllSpecies() { return speciesCache; }

export function getSpeciesById(id) {
  return speciesCache.find((s) => s.id === id) || null;
}

export function getShellMethodForArea(areaId) {
  const map = {
    sunahama: { id: "shiohigari", label: "潮干狩り" },
    kakou:    { id: "shiohigari", label: "干潟潮干狩" },
    iso:      { id: "isodori",    label: "磯採り" },
    teibou:   { id: "isodori",    label: "岸壁採取" },
    kinkai:   { id: "ketabiki",   label: "桁引き網" },
    okiai:    { id: "ketabiki",   label: "桁引かご" },
    shinkai:  { id: "kago",       label: "深海かご" }
  };
  return map[areaId] || null;
}

function buildCatchItem(picked, env, { isNet = false, damageChance = 0, hotspotBonus = false, baitAttract = 1.0 } = {}) {
  const spread = picked.maxKg - picked.minKg;
  const biasPower = hotspotBonus ? 0.92 : (baitAttract > 1.3 ? 1.1 : 1.35);
  const weightKg = Number((picked.minKg + spread * Math.pow(Math.random(), biasPower)).toFixed(2));
  const tags = [];
  let priceMult = 1.0;

  if (weightKg >= picked.trophyKg) { tags.push("トロフィー特大"); priceMult *= 1.6; }
  else if (weightKg < picked.minKg + spread * 0.2) { tags.push("少し小ぶり"); priceMult *= 0.85; }
  if (picked.spawnSeasons?.includes(env.season) && Math.random() < 0.28) { tags.push("抱卵"); priceMult *= 1.35; }
  if (picked.fatSeasons?.includes(env.season) && env.waterTemp <= (picked.minTemp + picked.maxTemp) / 2 + 1) { tags.push("脂乗り抜群"); priceMult *= 1.4; }
  if (env.tideName === "大潮" || (picked.coldWaterBonus && env.waterTemp <= picked.minTemp + 4)) { tags.push("身の締まり◎"); priceMult *= 1.2; }
  if (isNet && Math.random() < damageChance) { tags.push("傷あり"); priceMult *= 0.75; }
  if (env.waterTemp < picked.minTemp - 2 || env.waterTemp > picked.maxTemp + 2) { tags.push("やや痩せ気味"); priceMult *= 0.85; }
  if (tags.length === 0) tags.push(isNet ? "網揚げ" : "活魚");

  const estimatedPrice = Math.max(120, Math.round(weightKg * picked.basePricePerKg * priceMult * env.marketRate));
  return { species: picked, weightKg, tags, estimatedPrice };
}

function pickWeighted(pool, env, hotspotBonus = false, baitAttract = 1.0) {
  const weighted = pool.map((s) => {
    let w = s.rarityWeight || 10;
    if (s.seasons.includes(env.season)) w *= 1.5;
    if (s.activeHours.includes(env.hour)) w *= 1.6;
    if (s.favWeather.includes(env.weather)) w *= 1.3;
    if (s.favWind === env.wind || s.favWind === "any") w *= 1.15;
    if (env.waterTemp < s.minTemp || env.waterTemp > s.maxTemp) w *= 0.45;
    if ((hotspotBonus || baitAttract >= 1.4) && (s.rank === "S" || s.rank === "A" || s.rank === "B")) {
      w *= hotspotBonus ? 1.65 : baitAttract * 0.9;
    }
    return { species: s, weight: Math.max(1, w) };
  });
  const total = weighted.reduce((sum, x) => sum + x.weight, 0);
  let r = Math.random() * total;
  for (const item of weighted) { r -= item.weight; if (r <= 0) return item.species; }
  return weighted[0].species;
}

export function rollCatch(areaId, env, hotspotBonus = false, baitAttract = 1.0) {
  const candidates = speciesCache.filter((s) => s.speciesType !== "shellfish" && s.areas.includes(areaId));
  const pool = candidates.length ? candidates : speciesCache.filter((s) => s.speciesType !== "shellfish");
  return buildCatchItem(pickWeighted(pool, env, hotspotBonus, baitAttract), env, { hotspotBonus, baitAttract });
}

export function rollNetHaul(areaId, env, netItem, hotspotBonus = false) {
  const method = netItem.method;
  const allowedMethods = method === "sokobiki" ? ["sokobiki", "ketabiki"] : [method];
  let candidates = speciesCache.filter((s) => s.areas.includes(areaId) && (s.captureMethods || []).some((m) => allowedMethods.includes(m)));
  if (!candidates.length) candidates = speciesCache.filter((s) => s.areas.includes(areaId) && (s.captureMethods || []).length > 0);
  if (!candidates.length) return [];

  const minC = netItem.minCount || 2;
  const maxC = (netItem.maxCount || 3) + (hotspotBonus ? 1 : 0);
  const haulCount = minC + Math.floor(Math.random() * (maxC - minC + 1));
  const results = [];
  for (let i = 0; i < haulCount; i++) {
    results.push(buildCatchItem(pickWeighted(candidates, env, hotspotBonus), env, { isNet: true, damageChance: netItem.damageChance || 0.15, hotspotBonus }));
  }
  return results;
}

export function rollShellfish(areaId, env, toolBonus = 1.0) {
  const candidates = speciesCache.filter((s) => s.speciesType === "shellfish" && s.areas.includes(areaId));
  if (!candidates.length) return null;

  const isSpringTide = env.tideName === "大潮";
  const weighted = candidates.map((s) => {
    let w = s.rarityWeight || 10;
    if (s.seasons.includes(env.season)) w *= 1.4;
    if ((s.rank === "S" || s.rank === "A") && isSpringTide) w *= 1.5;
    if ((s.rank === "S" || s.rank === "A") && toolBonus > 1.2) w *= toolBonus;
    return { species: s, weight: Math.max(1, w) };
  });
  const total = weighted.reduce((sum, x) => sum + x.weight, 0);
  let r = Math.random() * total;
  let picked = weighted[0].species;
  for (const item of weighted) { r -= item.weight; if (r <= 0) { picked = item.species; break; } }

  const count = picked.rank === "S" ? 1 : picked.rank === "A" ? (1 + Math.floor(Math.random() * 2)) : (2 + Math.floor(Math.random() * 3));
  const unitSpread = picked.maxKg - picked.minKg;
  const unitKg = picked.minKg + unitSpread * Math.pow(Math.random(), isSpringTide ? 0.9 : 1.2);
  const weightKg = Number((unitKg * count).toFixed(2));

  const tags = [];
  let priceMult = 1.0;
  if (unitKg >= picked.trophyKg) { tags.push("大粒"); priceMult *= 1.45; }
  if (picked.fatSeasons?.includes(env.season)) { tags.push("身入りパンパン"); priceMult *= 1.35; }
  if (Math.random() < 0.03 * toolBonus) { tags.push("真珠入り"); priceMult *= 3.2; }
  else if ((areaId === "kinkai" || areaId === "okiai") && Math.random() < (0.16 / toolBonus)) { tags.push("殻割れ"); priceMult *= 0.78; }
  else if ((areaId === "sunahama" || areaId === "kakou") && Math.random() < 0.22) { tags.push("砂噛み"); priceMult *= 0.92; }
  if (tags.length === 0) tags.push("活貝");

  const estimatedPrice = Math.max(180, Math.round(weightKg * picked.basePricePerKg * priceMult * env.marketRate));
  return { species: picked, weightKg, count, tags, estimatedPrice };
}
