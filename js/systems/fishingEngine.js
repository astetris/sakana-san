let speciesCache = [];
let speciesById = new Map();
let areaCatchIndex = new Map();
let areaGatherIndex = new Map();
let areaNetIndex = new Map();

const HOUR_PRESETS = [
  Array.from({ length: 24 }, (_, i) => i),                          // 0: 全時間帯
  [4, 5, 6, 7, 8, 9, 15, 16, 17, 18, 19, 20],                       // 1: 朝夕マズメ
  [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],                     // 2: 日中
  [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]                        // 3: 夜間
];

function decodeMask(mask, list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (mask & (1 << i)) out.push(list[i]);
  }
  return out;
}

function expandExtraPack(pack) {
  if (!pack || !Array.isArray(pack.rows)) return [];
  const { areas, methods, seasons, ranks, stypes, templates, rows } = pack;
  const out = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const [id, name, kana, stIdx, tmplIdx, rankIdx, aMask, sMask, hPreset, minKg, maxKg, basePricePerKg, rarityWeight, mMask, aqPop] = r;
    const tmpl = templates[tmplIdx] || templates[0];
    const rank = ranks[rankIdx] || "C";
    const speciesType = stypes[stIdx] || "fish";
    const spAreas = decodeMask(aMask, areas);
    const spSeasons = decodeMask(sMask, seasons);
    const capMethods = decodeMask(mMask, methods);
    const isDeep = spAreas.includes("shinkai");
    const isTrop = spAreas.includes("nangoku");
    const isGatherOnly = speciesType === "shellfish" || speciesType === "seaweed";

    const pullBase = isGatherOnly ? 0 : Number((0.9 + rankIdx * 2.6 + Math.min(8, Math.sqrt(maxKg) * 0.85)).toFixed(1));
    const staminaBase = isGatherOnly ? 0 : Math.round(10 + rankIdx * 18 + Math.min(45, Math.sqrt(maxKg) * 4.2));
    const speedBase = isGatherOnly ? 0 : Number((1.6 + rankIdx * 1.15 + (spAreas.includes("enyou") ? 1.5 : 0)).toFixed(1));

    out[i] = {
      id,
      name,
      kana,
      speciesType,
      category: tmpl.cat,
      rank,
      desc: tmpl.desc.replace("{label}", name),
      tasteNote: tmpl.taste,
      imageKey: null,
      areas: spAreas.length ? spAreas : ["teibou"],
      seasons: spSeasons.length ? spSeasons : ["spring", "summer", "autumn", "winter"],
      activeHours: HOUR_PRESETS[hPreset] || HOUR_PRESETS[0],
      minDepth: isDeep ? 120 : (isGatherOnly ? 0 : 1),
      maxDepth: isDeep ? 1200 : (isGatherOnly ? 25 : 80),
      minTemp: isDeep ? 1 : (isTrop ? 20 : 10),
      maxTemp: isDeep ? 13 : (isTrop ? 30 : 26),
      favWeather: isDeep ? ["cloudy", "fog", "rough"] : ["sunny", "cloudy"],
      favWind: "any",
      rarityWeight,
      minKg,
      maxKg,
      trophyKg: Number((minKg + (maxKg - minKg) * 0.72).toFixed(2)),
      pullPower: pullBase,
      stamina: staminaBase,
      speed: speedBase,
      favLures: isGatherOnly ? [] : (isDeep ? ["jig"] : ["jig", "minnow", "worm"]),
      favBaits: isGatherOnly ? [] : (isDeep ? ["saba_cut"] : ["okiami", "isoma"]),
      captureMethods: capMethods,
      liveDurability: isGatherOnly ? 5 : (isDeep ? 1 : 3),
      spawnSeasons: [spSeasons[0] || "spring"],
      fatSeasons: [spSeasons[spSeasons.length - 1] || "winter"],
      coldWaterBonus: isDeep || spSeasons.includes("winter"),
      basePricePerKg,
      sushiType: tmpl.sushi || "shiromi",
      omakaseTags: rank === "S" ? ["luxury", "legend"] : rank === "A" ? ["luxury", "seasonal"] : ["standard"],
      aquariumPop: aqPop,
      farmHours: rankIdx >= 3 ? 0 : (isGatherOnly ? 10 : 18),
      farmSeedPrice: rankIdx >= 3 ? 0 : Math.round(basePricePerKg * 0.25)
    };
  }
  return out;
}

function rebuildIndexes() {
  speciesById = new Map();
  areaCatchIndex = new Map();
  areaGatherIndex = new Map();
  areaNetIndex = new Map();

  for (const s of speciesCache) {
    speciesById.set(s.id, s);
    const isGather = s.speciesType === "shellfish" || s.speciesType === "seaweed" || s.speciesType === "echinoderm";
    const isFishable = s.speciesType !== "shellfish" && s.speciesType !== "seaweed";

    for (const a of (s.areas || [])) {
      if (isFishable) {
        if (!areaCatchIndex.has(a)) areaCatchIndex.set(a, []);
        areaCatchIndex.get(a).push(s);
      }
      if (isGather) {
        if (!areaGatherIndex.has(a)) areaGatherIndex.set(a, []);
        areaGatherIndex.get(a).push(s);
      }
      if ((s.captureMethods || []).length > 0) {
        if (!areaNetIndex.has(a)) areaNetIndex.set(a, []);
        areaNetIndex.get(a).push(s);
      }
    }
  }
}

export async function loadSpeciesMaster() {
  const [baseRes, extraRes] = await Promise.all([
    fetch("./data/species.json"),
    fetch("./data/species_extra.json?v=20261128_025945").catch(() => null)
  ]);
  if (!baseRes.ok) throw new Error("data/species.json の読み込みに失敗しました");
  const baseList = await baseRes.json();
  let extraList = [];
  if (extraRes && extraRes.ok) {
    const pack = await extraRes.json();
    extraList = expandExtraPack(pack);
  }
  speciesCache = baseList.concat(extraList);
  rebuildIndexes();
  return speciesCache;
}

export function getAllSpecies() { return speciesCache; }

export function getSpeciesById(id) {
  return speciesById.get(id) || null;
}

export function getShellMethodForArea(areaId) {
  const map = {
    sunahama: { id: "shiohigari", label: "潮干狩り・海藻採り" },
    kakou:    { id: "shiohigari", label: "干潟採取" },
    iso:      { id: "isodori",    label: "磯採り（貝・海藻・ウニ）" },
    teibou:   { id: "isodori",    label: "岸壁採取（貝・海藻）" },
    kinkai:   { id: "ketabiki",   label: "桁引き・海藻採取" },
    okiai:    { id: "ketabiki",   label: "桁引かご・流れ藻採取" },
    shinkai:  { id: "kago",       label: "深海かご採取" },
    nangoku:  { id: "isodori",    label: "サンゴ礁採取（貝・海藻）" },
    enyou:    { id: "kago",       label: "外洋・流れ藻採取" }
  };
  return map[areaId] || null;
}

function buildCatchItem(picked, env, { isNet = false, damageChance = 0, hotspotBonus = false, baitAttract = 1.0 } = {}) {
  const spread = Math.max(0.01, picked.maxKg - picked.minKg);
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
  if (tags.length === 0) {
    tags.push(picked.speciesType === "seaweed" ? "採れたて海藻" : (isNet ? "網揚げ" : "活魚"));
  }

  const estimatedPrice = Math.max(120, Math.round(weightKg * picked.basePricePerKg * priceMult * env.marketRate));
  return { species: picked, weightKg, tags, estimatedPrice };
}

function pickWeighted(pool, env, hotspotBonus = false, baitAttract = 1.0) {
  let total = 0;
  const weights = new Float64Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    let w = s.rarityWeight || 10;
    if (s.seasons.includes(env.season)) w *= 1.45;
    if (s.activeHours.includes(env.hour)) w *= 1.55;
    if (s.favWeather.includes(env.weather)) w *= 1.25;
    if (s.favWind === env.wind || s.favWind === "any") w *= 1.1;
    if (env.waterTemp < s.minTemp || env.waterTemp > s.maxTemp) w *= 0.45;
    if ((hotspotBonus || baitAttract >= 1.4) && (s.rank === "S" || s.rank === "A" || s.rank === "B")) {
      w *= hotspotBonus ? 1.65 : baitAttract * 0.9;
    }
    w = w < 1 ? 1 : w;
    weights[i] = w;
    total += w;
  }
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

export function rollCatch(areaId, env, hotspotBonus = false, baitAttract = 1.0) {
  const candidates = areaCatchIndex.get(areaId);
  const pool = candidates && candidates.length ? candidates : speciesCache.filter((s) => s.speciesType !== "shellfish" && s.speciesType !== "seaweed");
  return buildCatchItem(pickWeighted(pool, env, hotspotBonus, baitAttract), env, { hotspotBonus, baitAttract });
}

export function rollNetHaul(areaId, env, netItem, hotspotBonus = false) {
  const method = netItem.method;
  const allowedMethods = method === "sokobiki" ? ["sokobiki", "ketabiki", "kago"] : [method];
  const areaPool = areaNetIndex.get(areaId) || [];
  let candidates = areaPool.filter((s) => (s.captureMethods || []).some((m) => allowedMethods.includes(m)));
  if (!candidates.length) candidates = areaPool;
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
  const candidates = areaGatherIndex.get(areaId);
  if (!candidates || !candidates.length) return null;

  const isSpringTide = env.tideName === "大潮";
  let total = 0;
  const weights = new Float64Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const s = candidates[i];
    let w = s.rarityWeight || 10;
    if (s.seasons.includes(env.season)) w *= 1.4;
    if ((s.rank === "S" || s.rank === "A") && isSpringTide) w *= 1.5;
    if ((s.rank === "S" || s.rank === "A") && toolBonus > 1.2) w *= toolBonus;
    w = w < 1 ? 1 : w;
    weights[i] = w;
    total += w;
  }
  let r = Math.random() * total;
  let picked = candidates[0];
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) { picked = candidates[i]; break; }
  }

  const isSeaweed = picked.speciesType === "seaweed";
  const isEchino = picked.speciesType === "echinoderm";
  const count = picked.rank === "S" ? 1 : picked.rank === "A" ? (1 + Math.floor(Math.random() * 2)) : (2 + Math.floor(Math.random() * 3));
  const unitSpread = Math.max(0.01, picked.maxKg - picked.minKg);
  const unitKg = picked.minKg + unitSpread * Math.pow(Math.random(), isSpringTide ? 0.9 : 1.2);
  const weightKg = Number((unitKg * count).toFixed(2));

  const tags = [];
  let priceMult = 1.0;
  if (isSeaweed) {
    if (unitKg >= picked.trophyKg) { tags.push("極上肉厚"); priceMult *= 1.45; }
    if (picked.seasons?.includes(env.season)) { tags.push("磯の香り抜群"); priceMult *= 1.3; }
    if (tags.length === 0) tags.push("新鮮海藻");
  } else if (isEchino) {
    if (unitKg >= picked.trophyKg) { tags.push("特大極上"); priceMult *= 1.45; }
    if (picked.fatSeasons?.includes(env.season)) { tags.push("濃厚クリーミー"); priceMult *= 1.38; }
    if (tags.length === 0) tags.push("活磯珍味");
  } else {
    if (unitKg >= picked.trophyKg) { tags.push("大粒"); priceMult *= 1.45; }
    if (picked.fatSeasons?.includes(env.season)) { tags.push("身入りパンパン"); priceMult *= 1.35; }
    if (Math.random() < 0.03 * toolBonus) { tags.push("真珠入り"); priceMult *= 3.2; }
    else if ((areaId === "kinkai" || areaId === "okiai") && Math.random() < (0.16 / toolBonus)) { tags.push("殻割れ"); priceMult *= 0.78; }
    else if ((areaId === "sunahama" || areaId === "kakou") && Math.random() < 0.22) { tags.push("砂噛み"); priceMult *= 0.92; }
    if (tags.length === 0) tags.push("活貝");
  }

  const estimatedPrice = Math.max(180, Math.round(weightKg * picked.basePricePerKg * priceMult * env.marketRate));
  return { species: picked, weightKg, count, tags, estimatedPrice };
}
