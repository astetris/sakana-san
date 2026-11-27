export const BUSINESS_DEFS = [
  {
    id: "fishmonger", icon: "🐟", name: "町の魚屋",
    rentPrice: 12000, buyPrice: 180000, stockCap: 35,
    baseMult: 1.48, sellIntervalSec: 42,
    desc: "あらゆる魚や貝を地域住民へ直売。回転が早く安定収益！"
  },
  {
    id: "kaiten_sushi", icon: "🍣", name: "回転寿司『さかな丸』",
    rentPrice: 28000, buyPrice: 420000, stockCap: 45,
    baseMult: 1.82, sellIntervalSec: 30,
    desc: "C〜Aランクの握り・貝ネタが飛ぶように売れる高回転店！"
  },
  {
    id: "luxury_sushi", icon: "🍶", name: "高級寿司『割烹 凪』",
    rentPrice: 75000, buyPrice: 1200000, stockCap: 25,
    baseMult: 2.55, sellIntervalSec: 52,
    desc: "A/Sランク・脂乗り抜群・熟成ネタで客単価が跳ね上がる！"
  },
  {
    id: "aquarium", icon: "🐠", name: "岬の水族館",
    rentPrice: 55000, buyPrice: 950000, stockCap: 16,
    baseMult: 1.0, sellIntervalSec: 60, isAquarium: true,
    desc: "生きた魚・貝を大水槽へ展示！人気度と水質・ショーで入場料が貯まる"
  }
];

export const FARM_EXPAND_PRICES = [0, 0, 28000, 68000, 145000, 290000]; // 最大6枠

export const PRICE_STRATEGIES = {
  discount: {
    id: "discount", label: "薄利多売", short: "安め",
    priceMult: 0.86, speedMult: 1.42, ratingDelta: 0.03,
    desc: "価格-14% / 回転+42%・行列ができやすい"
  },
  standard: {
    id: "standard", label: "適正価格", short: "標準",
    priceMult: 1.0, speedMult: 1.0, ratingDelta: 0.01,
    desc: "バランス重視の標準設定"
  },
  premium: {
    id: "premium", label: "強気・高級", short: "高め",
    priceMult: 1.28, speedMult: 0.72, ratingDelta: -0.02,
    desc: "価格+28% / 回転-28%・高鮮度や名店★4以上で真価を発揮"
  }
};

export const BIZ_UPGRADES = {
  interior: {
    key: "interiorLv", label: "🏮 内装・客席",
    baseCost: 18000, maxLv: 5,
    desc: "客単価+9%/Lv・店内装飾が豪華になり★評価も伸びやすい"
  },
  cooling: {
    key: "coolingLv", label: "🧊 氷温設備",
    baseCost: 15000, maxLv: 5,
    desc: "鮮度劣化を大幅軽減（水族館は水質浄化で人気度+12%/Lv）"
  },
  staff: {
    key: "staffLv", label: "👨‍🍳 職人・スタッフ",
    baseCost: 22000, maxLv: 5,
    desc: "回転速度+16%/Lv・在庫上限+8/Lv（人件費は売上に連動）"
  }
};

export function ensureBizState(st) {
  if (!st || typeof st !== "object") return st;
  if (!Array.isArray(st.stock)) st.stock = [];
  if (typeof st.pendingRevenue !== "number") st.pendingRevenue = 0;
  if (typeof st.totalRevenue !== "number") st.totalRevenue = 0;
  if (!st.priceStrategy || !PRICE_STRATEGIES[st.priceStrategy]) st.priceStrategy = "standard";
  if (typeof st.rating !== "number" || Number.isNaN(st.rating)) st.rating = 3.2;
  st.rating = Math.max(1.0, Math.min(5.0, st.rating));
  if (!st.interiorLv) st.interiorLv = 1;
  if (!st.coolingLv) st.coolingLv = 1;
  if (!st.staffLv) st.staffLv = 1;
  if (typeof st.lastIceAt !== "number") st.lastIceAt = 0;
  if (typeof st.servedCount !== "number") st.servedCount = 0;
  if (typeof st.lastGross !== "number") st.lastGross = 0;
  if (typeof st.lastExpense !== "number") st.lastExpense = 0;
  const now = Date.now();
  st.stock.forEach((item) => {
    if (!item.stockedAt) item.stockedAt = now;
    if (typeof item.freshBonus !== "number") item.freshBonus = 0;
  });
  return st;
}

export function getPortLevel(rep = 0) {
  const lv = Math.floor(Math.sqrt(Math.max(0, rep) / 8)) + 1;
  return { lv, rep: Math.round(rep) };
}

export function isBusinessOpen(bizState) {
  if (!bizState) return false;
  return bizState.owned || (bizState.rentExpiresAt && bizState.rentExpiresAt > Date.now());
}

export function getItemFreshness(item, coolingLv = 1, lastIceAt = 0, now = Date.now()) {
  if (!item) return 100;
  const ageHours = Math.max(0, (now - (item.stockedAt || now)) / 3600000);
  const coolFactor = Math.max(0.35, 1 - (coolingLv - 1) * 0.16);
  const iceBoost = (now - (lastIceAt || 0)) < 1800000 ? 0.55 : 1.0;
  const decay = ageHours * 14 * coolFactor * iceBoost;
  return Math.max(12, Math.min(100, Math.round(100 - decay + (item.freshBonus || 0))));
}

export function getFreshnessEffect(bizId, freshness) {
  // 高級寿司は65〜88%の「熟成ゾーン」でも旨味ボーナスが発生するリアル仕様
  if (bizId === "luxury_sushi" && freshness >= 65 && freshness <= 88) {
    return { label: "熟成旨味", mult: 1.16, ratingDelta: 0.04, color: "#f59e0b" };
  }
  if (freshness >= 88) return { label: "極上鮮度", mult: 1.14, ratingDelta: 0.03, color: "#38e59a" };
  if (freshness >= 55) return { label: "新鮮", mult: 1.0, ratingDelta: 0.01, color: "#38bdf8" };
  if (freshness >= 30) return { label: "鮮度低下", mult: 0.78, ratingDelta: -0.04, color: "#fb923c" };
  return { label: "見切り品", mult: 0.52, ratingDelta: -0.09, color: "#f87171" };
}

export function getBizMetrics(def, st, save, env = null) {
  ensureBizState(st);
  const now = Date.now();
  const strat = PRICE_STRATEGIES[st.priceStrategy] || PRICE_STRATEGIES.standard;
  const hour = new Date(now).getHours();
  const isLunchPeak = hour >= 11 && hour <= 14;
  const isDinnerPeak = hour >= 17 && hour <= 21;
  const peakMult = (isLunchPeak || isDinnerPeak) ? 1.28 : (hour >= 2 && hour <= 5 ? 0.85 : 1.0);
  const peakLabel = isLunchPeak ? "🍽️ ランチ盛況(+28%)" : isDinnerPeak ? "🏮 ディナー繁忙(+28%)" : "🌊 通常営業";

  const weather = env?.weather || "clear";
  const weatherSpeed = (weather === "rain" || weather === "rough") ? 0.88 : 1.0;
  const weatherTip = (weather === "rain" || weather === "rough") ? 1.10 : 1.0;

  const stockCap = def.stockCap + (st.staffLv - 1) * 8;
  const interiorPriceMult = 1 + (st.interiorLv - 1) * 0.09;
  const ratingMult = 0.82 + (st.rating / 5.0) * 0.42 + (st.rating >= 4.5 ? 0.14 : 0);
  const staffSpeedMult = 1 + (st.staffLv - 1) * 0.16;
  const effectiveIntervalSec = Math.max(8, def.sellIntervalSec / (strat.speedMult * staffSpeedMult * peakMult * weatherSpeed));

  // 経費率（光熱費＋スタッフ人件費：売上連動で最大24%までに制限し黒字を維持）
  const expenseRate = Math.min(0.24, 0.06 + (st.staffLv - 1) * 0.032 + (st.interiorLv - 1) * 0.015);
  const avgFreshness = def.isAquarium
    ? 100
    : st.stock.length
      ? Math.round(st.stock.reduce((s, x) => s + getItemFreshness(x, st.coolingLv, st.lastIceAt, now), 0) / st.stock.length)
      : 100;
  const iceActive = (now - (st.lastIceAt || 0)) < 1800000;
  const portLv = getPortLevel(save?.reputation || 0).lv;

  return {
    strat,
    stockCap,
    interiorPriceMult,
    ratingMult,
    effectiveIntervalSec,
    expenseRate,
    avgFreshness,
    iceActive,
    peakLabel,
    peakMult,
    weatherTip,
    portLv,
    isFamous: st.rating >= 4.5
  };
}

export function calcMenuSalePrice(bizDef, item, species) {
  let mult = bizDef.baseMult;
  if (bizDef.id === "luxury_sushi") {
    if (item.rank === "S") mult *= 1.35;
    else if (item.rank === "A") mult *= 1.18;
    else if (item.rank === "D") mult *= 0.7;
    if ((item.tags || []).some((t) => t === "トロフィー特大" || t === "脂乗り抜群" || t === "抱卵" || t === "真珠入り")) {
      mult *= 1.25;
    }
  } else if (bizDef.id === "kaiten_sushi") {
    if (species?.sushiType && species.sushiType !== "none") mult *= 1.1;
  }
  if ((item.tags || []).includes("傷あり") && bizDef.id === "luxury_sushi") mult *= 0.8;
  return Math.max(200, Math.round(item.price * mult));
}

// クーラーから1点指定して店舗へ仕込む
export function stockSingleToBiz(save, bizId, coolerIdx, speciesMap) {
  const def = BUSINESS_DEFS.find((b) => b.id === bizId);
  const st = ensureBizState(save.businesses[bizId]);
  if (!def || !st || !isBusinessOpen(st)) return { ok: false, msg: "先に店舗を開業してください" };
  const metrics = getBizMetrics(def, st, save);
  if (st.stock.length >= metrics.stockCap) return { ok: false, msg: "店頭ストックが満タンです！" };
  const item = save.cooler[coolerIdx];
  if (!item) return { ok: false, msg: "対象の魚が見つかりません" };
  const sp = speciesMap.get(item.id);
  if (!def.isAquarium && (def.id === "luxury_sushi" || def.id === "kaiten_sushi") && sp?.sushiType === "none") {
    return { ok: false, msg: `${item.name}は寿司ネタに向きません（魚屋か水族館へ）` };
  }
  save.cooler.splice(coolerIdx, 1);
  st.stock.push({
    id: item.id,
    name: item.name,
    rank: item.rank,
    weightKg: item.weightKg,
    tags: item.tags || [],
    salePrice: def.isAquarium ? 0 : calcMenuSalePrice(def, item, sp),
    pop: sp?.aquariumPop || 25,
    stockedAt: Date.now(),
    freshBonus: 0
  });
  return { ok: true, msg: `${item.name}を${def.isAquarium ? "展示" : "仕込み"}ました！` };
}

// 大将のおまかせ：クーラーから業態に合うネタを自動選別して仕込む
export function autoOmakaseStock(save, bizId, speciesMap) {
  const def = BUSINESS_DEFS.find((b) => b.id === bizId);
  const st = ensureBizState(save.businesses[bizId]);
  if (!def || !st || !isBusinessOpen(st)) return { moved: 0, msg: "まず店舗を賃貸または購入してください" };

  const metrics = getBizMetrics(def, st, save);
  const room = metrics.stockCap - st.stock.length;
  if (room <= 0) return { moved: 0, msg: "店頭ストックが満タンです！" };

  const scored = save.cooler.map((item, idx) => {
    const sp = speciesMap.get(item.id);
    let score = 0;
    if (def.isAquarium) {
      const already = st.stock.some((x) => x.id === item.id);
      score = (sp?.aquariumPop || 20) + (already ? -40 : 40) + (item.rank === "S" ? 50 : item.rank === "A" ? 25 : 0);
    } else if (def.id === "luxury_sushi") {
      if (sp?.sushiType === "none") score = -999;
      else {
        const rankPts = { S: 120, A: 90, B: 45, C: 10, D: -50 }[item.rank] || 0;
        const tagBonus = (item.tags || []).some((t) => t === "脂乗り抜群" || t === "トロフィー特大" || t === "抱卵") ? 35 : 0;
        score = rankPts + tagBonus;
      }
    } else if (def.id === "kaiten_sushi") {
      if (sp?.sushiType === "none") score = -999;
      else score = ({ C: 80, B: 85, A: 65, D: 40, S: 10 }[item.rank] || 50);
    } else {
      score = 60 + (item.price / 1000);
    }
    return { idx, item, sp, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, Math.min(room, def.isAquarium ? 4 : 12));
  if (!picked.length) return { moved: 0, msg: "この店舗に合うネタがクーラーにありません" };

  const now = Date.now();
  const removeSet = new Set(picked.map((x) => x.idx));
  picked.forEach(({ item, sp }) => {
    st.stock.push({
      id: item.id,
      name: item.name,
      rank: item.rank,
      weightKg: item.weightKg,
      tags: item.tags || [],
      salePrice: def.isAquarium ? 0 : calcMenuSalePrice(def, item, sp),
      pop: sp?.aquariumPop || 25,
      stockedAt: now,
      freshBonus: 0
    });
  });
  save.cooler = save.cooler.filter((_, i) => !removeSet.has(i));
  return { moved: picked.length, msg: `大将のおまかせで ${picked.length}点 を仕込みました！` };
}

// 設備・保冷・スタッフのレベルアップ
export function getUpgradeCost(def, kind, currentLv) {
  const u = BIZ_UPGRADES[kind];
  if (!u || currentLv >= u.maxLv) return 0;
  const bizScale = def.id === "luxury_sushi" ? 1.8 : def.id === "aquarium" ? 1.55 : def.id === "kaiten_sushi" ? 1.25 : 1.0;
  return Math.round(u.baseCost * bizScale * Math.pow(1.75, currentLv - 1) / 100) * 100;
}

export function upgradeBizFacility(save, bizId, kind) {
  const def = BUSINESS_DEFS.find((b) => b.id === bizId);
  const st = ensureBizState(save.businesses[bizId]);
  const u = BIZ_UPGRADES[kind];
  if (!def || !st || !u) return { ok: false, msg: "対象が見つかりません" };
  const lv = st[u.key] || 1;
  if (lv >= u.maxLv) return { ok: false, msg: "すでに最大レベルです！" };
  const cost = getUpgradeCost(def, kind, lv);
  if (save.money < cost) return { ok: false, msg: `所持金が足りません（必要 ¥${cost.toLocaleString()}）` };
  save.money -= cost;
  st[u.key] = lv + 1;
  st.rating = Math.min(5.0, Number((st.rating + (kind === "interior" ? 0.18 : 0.1)).toFixed(2)));
  save.reputation = (save.reputation || 0) + 2;
  return { ok: true, msg: `${u.label} を Lv.${lv + 1} に強化しました！` };
}

// 砕氷の補充（鮮度回復＋30分劣化半減）
export function refreshBizIce(save, bizId) {
  const def = BUSINESS_DEFS.find((b) => b.id === bizId);
  const st = ensureBizState(save.businesses[bizId]);
  if (!def || !st) return { ok: false, msg: "店舗データがありません" };
  const cost = 800;
  if (save.money < cost) return { ok: false, msg: `氷の仕入れに ¥${cost} 必要です` };
  save.money -= cost;
  st.lastIceAt = Date.now();
  st.stock.forEach((item) => {
    item.freshBonus = Math.min(35, (item.freshBonus || 0) + 22);
  });
  return { ok: true, msg: "❄️ 砕氷をたっぷり補充しました！（全在庫の鮮度回復＆30分保冷強化）" };
}

// 2.5D店内画面での直接接客（タップで即提供・チップ＆評価UP）
export function serveGuestOrder(save, def, env = null, { isRush = false, combo = 1 } = {}) {
  const st = ensureBizState(save.businesses[def.id]);
  if (!st || !isBusinessOpen(st)) return { ok: false, net: 0 };
  const m = getBizMetrics(def, st, save, env);
  const now = Date.now();

  if (def.isAquarium) {
    const totalPop = st.stock.reduce((s, x) => s + (x.pop || 20), 0);
    if (totalPop <= 0) return { ok: false, net: 0, msg: "展示魚がいません" };
    const coolBoost = 1 + (st.coolingLv - 1) * 0.12;
    const gross = Math.round((totalPop * 18 + 380) * coolBoost * m.interiorPriceMult * m.ratingMult * (isRush ? 1.25 : 1.0) * (1 + Math.min(0.4, (combo - 1) * 0.08)));
    const expense = Math.round(gross * m.expenseRate * 0.65);
    const net = Math.max(150, gross - expense);
    st.pendingRevenue += net;
    st.totalRevenue += net;
    st.lastGross = gross;
    st.lastExpense = expense;
    st.servedCount += 1;
    st.rating = Math.min(5.0, Number((st.rating + 0.03).toFixed(2)));
    save.reputation = (save.reputation || 0) + 0.35;
    return { ok: true, net, gross, expense, itemName: "餌やりショー", tag: "拍手喝采!" };
  }

  if (!st.stock.length) return { ok: false, net: 0, msg: "在庫切れ" };
  // 一番鮮度が良い（または高級寿司なら熟成ベストな）ネタを職人が見極めて提供
  let bestIdx = 0;
  let bestScore = -1;
  st.stock.forEach((it, idx) => {
    const fr = getItemFreshness(it, st.coolingLv, st.lastIceAt, now);
    const eff = getFreshnessEffect(def.id, fr);
    const sc = eff.mult * (it.salePrice || 500);
    if (sc > bestScore) { bestScore = sc; bestIdx = idx; }
  });

  const item = st.stock.splice(bestIdx, 1)[0];
  const fresh = getItemFreshness(item, st.coolingLv, st.lastIceAt, now);
  const feff = getFreshnessEffect(def.id, fresh);
  const comboMult = 1 + Math.min(0.35, (combo - 1) * 0.07);
  const directMult = isRush ? 1.25 : 1.18;

  const gross = Math.round(
    (item.salePrice || 500) *
    m.strat.priceMult *
    m.interiorPriceMult *
    m.ratingMult *
    feff.mult *
    m.weatherTip *
    directMult *
    comboMult
  );
  const expense = Math.round(gross * m.expenseRate);
  const net = Math.max(120, gross - expense);

  st.pendingRevenue += net;
  st.totalRevenue += net;
  st.lastGross = gross;
  st.lastExpense = expense;
  st.servedCount += 1;
  const rDelta = feff.ratingDelta + m.strat.ratingDelta + 0.03;
  st.rating = Math.max(1.0, Math.min(5.0, Number((st.rating + rDelta).toFixed(2))));
  save.reputation = (save.reputation || 0) + 0.65;

  return { ok: true, net, gross, expense, itemName: item.name, fresh, tag: feff.label };
}

// 現実時間経過による自動営業・水族館入場料の精算（経費・鮮度・価格戦略・評価を反映）
export function syncBusinessProgress(save, env = null) {
  const now = Date.now();
  let hasAlert = false;

  BUSINESS_DEFS.forEach((def) => {
    const st = ensureBizState(save.businesses[def.id]);
    if (!st) return;
    if (!isBusinessOpen(st)) { st.lastTickAt = now; return; }

    const elapsedSec = Math.max(0, (now - (st.lastTickAt || now)) / 1000);
    if (elapsedSec < 8) {
      if (st.pendingRevenue >= 1000) hasAlert = true;
      return;
    }

    const m = getBizMetrics(def, st, save, env);

    if (def.isAquarium) {
      const totalPop = st.stock.reduce((sum, x) => sum + (x.pop || 20), 0);
      if (totalPop > 0) {
        const coolBoost = 1 + (st.coolingLv - 1) * 0.12;
        const gross = Math.floor(
          (totalPop * 1.95) *
          (elapsedSec / 60) *
          coolBoost *
          m.interiorPriceMult *
          m.ratingMult *
          m.peakMult *
          (1 + m.portLv * 0.05)
        );
        const expense = Math.floor(gross * m.expenseRate * 0.6);
        const net = Math.max(0, gross - expense);
        if (net > 0) {
          st.pendingRevenue += net;
          st.totalRevenue += net;
          st.lastGross = gross;
          st.lastExpense = expense;
          st.lastTickAt = now;
        }
      } else {
        st.lastTickAt = now;
      }
    } else {
      const salesCount = Math.min(st.stock.length, Math.floor(elapsedSec / m.effectiveIntervalSec));
      if (salesCount > 0) {
        const sold = st.stock.splice(0, salesCount);
        let grossSum = 0;
        let ratingMove = 0;
        sold.forEach((x) => {
          const fr = getItemFreshness(x, st.coolingLv, st.lastIceAt, now);
          const feff = getFreshnessEffect(def.id, fr);
          const sale = Math.round(
            (x.salePrice || 500) *
            m.strat.priceMult *
            m.interiorPriceMult *
            m.ratingMult *
            feff.mult *
            m.weatherTip
          );
          grossSum += sale;
          ratingMove += (feff.ratingDelta + m.strat.ratingDelta) * 0.45;
        });
        const expense = Math.round(grossSum * m.expenseRate);
        const net = Math.max(100, grossSum - expense);
        st.pendingRevenue += net;
        st.totalRevenue += net;
        st.lastGross = grossSum;
        st.lastExpense = expense;
        st.servedCount += salesCount;
        st.rating = Math.max(1.0, Math.min(5.0, Number((st.rating + ratingMove).toFixed(2))));
        save.reputation = (save.reputation || 0) + salesCount * 0.42;
        st.lastTickAt = now;
      }
    }
    if (st.pendingRevenue >= 1000) hasAlert = true;
  });

  (save.farm?.plots || []).forEach((p) => {
    if (p && now >= p.readyAt) hasAlert = true;
  });
  return hasAlert;
}

// サクサク養殖
export function getFarmDurationMs(species, hasMonthlyPass = false) {
  const h = species.farmHours || 4;
  const baseMins = Math.max(3, Math.min(90, Math.round(h * 1.25)));
  const mins = hasMonthlyPass ? Math.max(2, Math.round(baseMins * 0.8)) : baseMins;
  return mins * 60 * 1000;
}

export function harvestFarmPlot(save, plotIdx, species, env, sellDirect = false) {
  const plot = save.farm.plots[plotIdx];
  if (!plot || Date.now() < plot.readyAt) return null;

  const isShell = species.speciesType === "shellfish";
  const count = isShell ? 4 : (species.rank === "S" ? 1 : species.rank === "A" ? 2 : 3);
  const weightKg = Number(((species.minKg + (species.maxKg - species.minKg) * (0.62 + Math.random() * 0.32)) * count).toFixed(2));
  const tags = isShell ? ["垂下養殖", "身入りパンパン"] : ["養殖特選", "脂乗り抜群"];
  const price = Math.max(600, Math.round(weightKg * species.basePricePerKg * 1.35 * env.marketRate));

  save.farm.plots[plotIdx] = null;
  if (sellDirect) {
    save.money += price;
    save.stats.totalEarned += price;
    save.reputation = (save.reputation || 0) + 1.5;
  } else {
    save.cooler.push({
      id: species.id,
      name: isShell ? `${species.name}×${count}` : `${species.name}(養殖)`,
      rank: species.rank, weightKg, tags, price
    });
  }
  if (!save.dex[species.id]) save.dex[species.id] = { count: 0, maxKg: 0 };
  save.dex[species.id].count += count;
  save.dex[species.id].maxKg = Math.max(save.dex[species.id].maxKg, weightKg);
  return { name: species.name, count, weightKg, tags, price, sellDirect };
}

// 港の納品依頼掲示板
const CLIENTS = [
  { name: "海辺のホテル", mult: 1.75, rep: 4 },
  { name: "老舗料亭 潮騒", mult: 2.05, rep: 7 },
  { name: "港の回転寿司", mult: 1.65, rep: 3 },
  { name: "岬の缶詰工場", mult: 1.7, rep: 5 },
  { name: "町立水族館", mult: 1.95, rep: 6 }
];

export function ensureDailyOrders(save, allSpecies, dayKey) {
  if (!allSpecies.length) return [];
  if (!save.orders || save.ordersDayKey !== dayKey) {
    save.ordersDayKey = dayKey;
    save.orders = [];
  }
  while (save.orders.length < 4) {
    const sp = allSpecies[Math.floor(Math.random() * allSpecies.length)];
    const client = CLIENTS[Math.floor(Math.random() * CLIENTS.length)];
    const qty = sp.rank === "S" ? 1 : sp.rank === "A" ? (1 + Math.floor(Math.random() * 2)) : (2 + Math.floor(Math.random() * 3));
    const avgKg = (sp.minKg + sp.maxKg) * 0.5;
    const reward = Math.max(2400, Math.round(avgKg * sp.basePricePerKg * qty * client.mult));
    save.orders.push({
      uid: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      client: client.name,
      speciesId: sp.id,
      speciesName: sp.name,
      rank: sp.rank,
      qty,
      reward,
      rep: client.rep + (sp.rank === "S" ? 6 : sp.rank === "A" ? 3 : 0)
    });
  }
  return save.orders;
}
