export const BUSINESS_DEFS = [
  {
    id: "fishmonger", icon: "🐟", name: "町の魚屋",
    rentPrice: 12000, buyPrice: 180000, stockCap: 35,
    baseMult: 1.48, sellIntervalSec: 45,
    desc: "あらゆる魚や貝を地域住民へ直売。回転が早く安定収益！"
  },
  {
    id: "kaiten_sushi", icon: "🍣", name: "回転寿司『さかな丸』",
    rentPrice: 28000, buyPrice: 420000, stockCap: 45,
    baseMult: 1.82, sellIntervalSec: 32,
    desc: "C〜Aランクの握り・貝ネタが飛ぶように売れる高回転店！"
  },
  {
    id: "luxury_sushi", icon: "🍶", name: "高級寿司『割烹 凪』",
    rentPrice: 75000, buyPrice: 1200000, stockCap: 25,
    baseMult: 2.55, sellIntervalSec: 55,
    desc: "A/Sランク・脂乗り抜群・トロフィーネタで客単価が跳ね上がる！"
  },
  {
    id: "aquarium", icon: "🐠", name: "岬の水族館",
    rentPrice: 55000, buyPrice: 950000, stockCap: 16,
    baseMult: 1.0, sellIntervalSec: 60, isAquarium: true,
    desc: "生きた魚・貝を水槽へ展示！人気度に応じて入場料が自動で貯まり続ける"
  }
];

export const FARM_EXPAND_PRICES = [0, 0, 28000, 68000, 145000, 290000]; // 最大6枠

export function getPortLevel(rep = 0) {
  const lv = Math.floor(Math.sqrt(Math.max(0, rep) / 8)) + 1;
  return { lv, rep: Math.round(rep) };
}

export function isBusinessOpen(bizState) {
  if (!bizState) return false;
  return bizState.owned || (bizState.rentExpiresAt && bizState.rentExpiresAt > Date.now());
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

// 大将のおまかせ：クーラーから業態に合うネタを自動選別して仕込む
export function autoOmakaseStock(save, bizId, speciesMap) {
  const def = BUSINESS_DEFS.find((b) => b.id === bizId);
  const st = save.businesses[bizId];
  if (!def || !st || !isBusinessOpen(st)) return { moved: 0, msg: "まず店舗を賃貸または購入してください" };

  const room = def.stockCap - st.stock.length;
  if (room <= 0) return { moved: 0, msg: "店頭ストックが満タンです！" };

  const scored = save.cooler.map((item, idx) => {
    const sp = speciesMap.get(item.id);
    let score = 0;
    if (def.isAquarium) {
      // 水族館は未展示のレア・人気魚を優先
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
      // 町の魚屋は幅広く仕入れ
      score = 60 + (item.price / 1000);
    }
    return { idx, item, sp, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, Math.min(room, def.isAquarium ? 4 : 12));
  if (!picked.length) return { moved: 0, msg: "この店舗に合うネタがクーラーにありません" };

  const removeSet = new Set(picked.map((x) => x.idx));
  picked.forEach(({ item, sp }) => {
    st.stock.push({
      id: item.id,
      name: item.name,
      rank: item.rank,
      weightKg: item.weightKg,
      tags: item.tags || [],
      salePrice: def.isAquarium ? 0 : calcMenuSalePrice(def, item, sp),
      pop: sp?.aquariumPop || 25
    });
  });
  save.cooler = save.cooler.filter((_, i) => !removeSet.has(i));
  return { moved: picked.length, msg: `大将のおまかせで ${picked.length}点 を仕込みました！` };
}

// 現実時間経過による自動営業・水族館入場料の精算
export function syncBusinessProgress(save) {
  const now = Date.now();
  let hasAlert = false;

  BUSINESS_DEFS.forEach((def) => {
    const st = save.businesses[def.id];
    if (!st) return;
    if (!isBusinessOpen(st)) { st.lastTickAt = now; return; }

    const elapsedSec = Math.max(0, (now - (st.lastTickAt || now)) / 1000);
    if (elapsedSec < 8) {
      if (st.pendingRevenue >= 1000) hasAlert = true;
      return;
    }

    if (def.isAquarium) {
      const totalPop = st.stock.reduce((sum, x) => sum + (x.pop || 20), 0);
      if (totalPop > 0) {
        // 人気度100あたり1分で約¥180（1時間で約¥10,800）の快適ペース
        const earned = Math.floor((totalPop * 1.8) * (elapsedSec / 60) * (1 + getPortLevel(save.reputation).lv * 0.05));
        if (earned > 0) {
          st.pendingRevenue += earned;
          st.totalRevenue += earned;
          st.lastTickAt = now;
        }
      } else {
        st.lastTickAt = now;
      }
    } else {
      const salesCount = Math.min(st.stock.length, Math.floor(elapsedSec / def.sellIntervalSec));
      if (salesCount > 0) {
        const sold = st.stock.splice(0, salesCount);
        const rev = sold.reduce((s, x) => s + (x.salePrice || 500), 0);
        st.pendingRevenue += rev;
        st.totalRevenue += rev;
        save.reputation = (save.reputation || 0) + salesCount * 0.4;
        st.lastTickAt = now;
      }
    }
    if (st.pendingRevenue >= 1000) hasAlert = true;
  });

  // 養殖完了チェック
  (save.farm?.plots || []).forEach((p) => {
    if (p && now >= p.readyAt) hasAlert = true;
  });
  return hasAlert;
}

// サクサク養殖：species.jsonのfarmHoursを現実時間（3分〜90分）へ快適スケーリング
export function getFarmDurationMs(species) {
  const h = species.farmHours || 4;
  const mins = Math.max(3, Math.min(90, Math.round(h * 1.25)));
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

// 港の納品依頼掲示板（日替わり＋達成補充）
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
