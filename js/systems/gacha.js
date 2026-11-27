let gachaConfig = { version: 1, banners: [] };
let gachaGearMap = new Map();

export async function loadGachaBanners() {
  try {
    const res = await fetch(`./data/gacha_banners.json?t=${Date.now()}`);
    if (!res.ok) throw new Error("gacha_banners.json load failed");
    gachaConfig = await res.json();
    gachaGearMap = new Map();
    for (const b of gachaConfig.banners || []) {
      for (const item of b.pool || []) {
        if (item.type === "gear" && item.slot) {
          gachaGearMap.set(item.id, {
            id: item.id,
            slot: item.slot,
            name: item.name,
            rarity: item.rarity,
            desc: item.desc,
            ...(item.stats || {})
          });
        }
      }
    }
  } catch (e) {
    console.warn("ガチャデータ読込スキップ:", e);
  }
  return gachaConfig;
}

export function getActiveBanners() {
  return (gachaConfig.banners || []).filter((b) => b.active !== false);
}

export function getGachaGearList() {
  return Array.from(gachaGearMap.values());
}

export function getExchangeCatalog() {
  const seen = new Map();
  for (const b of getActiveBanners()) {
    for (const item of b.pool || []) {
      if ((item.exchangeCost || 0) > 0 && !seen.has(item.id)) {
        seen.set(item.id, item);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => (b.rarity - a.rarity) || (b.exchangeCost - a.exchangeCost));
}

function pickFromPool(pool) {
  const total = pool.reduce((s, x) => s + (x.weight || 1), 0);
  let r = Math.random() * total;
  for (const item of pool) {
    r -= (item.weight || 1);
    if (r <= 0) return item;
  }
  return pool[0];
}

export function applyGachaPrize(save, prize) {
  const dupeShells = { 5: 10, 4: 3, 3: 1 };
  let isDupe = false;
  let convertedShells = 0;

  if (prize.type === "gear") {
    if (save.ownedGear.includes(prize.id)) {
      isDupe = true;
      convertedShells = dupeShells[prize.rarity] || 1;
      save.shells = (save.shells || 0) + convertedShells;
    } else {
      save.ownedGear.push(prize.id);
    }
  } else if (prize.type === "title") {
    if (!save.unlockedTitles) save.unlockedTitles = [];
    if (save.unlockedTitles.includes(prize.title)) {
      isDupe = true;
      convertedShells = dupeShells[prize.rarity] || 3;
      save.shells = (save.shells || 0) + convertedShells;
    } else {
      save.unlockedTitles.push(prize.title);
    }
  } else if (prize.type === "bait") {
    const bid = prize.baitId || "bait_live_aji";
    save.baitStock[bid] = (save.baitStock[bid] || 0) + (prize.qty || 10);
  } else if (prize.type === "money") {
    save.money += (prize.amount || 10000);
  } else if (prize.type === "item") {
    if (prize.effect === "stamina_full") save.stamina = 100;
    else if (prize.effect === "charm_30") {
      save.pearlBuff = { label: "🍀大潮チャーム", priceMult: 1.25, rareBonus: true, expiresAt: Date.now() + 30 * 60000 };
    }
  }

  return { prize, isDupe, convertedShells };
}

export function executeGachaDraw(save, banner, count = 1) {
  const pool = banner.pool || [];
  if (!pool.length) return { results: [], bonusShells: 0 };
  const highPool = pool.filter((x) => (x.rarity || 3) >= 4);
  const results = [];

  for (let i = 0; i < count; i++) {
    const useGuaranteed = (count >= 10 && i === count - 1 && highPool.length > 0);
    const picked = pickFromPool(useGuaranteed ? highPool : pool);
    results.push(applyGachaPrize(save, picked));
  }

  const bonusShells = count >= 10 ? (banner.shellBonusOnTen ?? 10) : 0;
  if (bonusShells > 0) save.shells = (save.shells || 0) + bonusShells;
  return { results, bonusShells };
}
