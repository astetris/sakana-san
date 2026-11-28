import { saveCloudSlots, loadCloudSlots, getJstDateKey } from "../config/firebase.js?v=20261128_025945";
import { applyBankInterest, getActiveBoat } from "../systems/economy.js?v=20261128_025945";

const STORAGE_KEY = "sakana_san_slots_v1";
export const MAX_SLOTS = 5;
const STAMINA_MAX = 100;
const STAMINA_REGEN_MS = 3 * 60 * 1000;

export function createEmptySlots() { return Array.from({ length: MAX_SLOTS }, () => null); }

function defaultBusinesses() {
  const now = Date.now();
  return {
    fishmonger:   { owned: false, rentExpiresAt: 0, stock: [], pendingRevenue: 0, totalRevenue: 0, lastTickAt: now },
    kaiten_sushi: { owned: false, rentExpiresAt: 0, stock: [], pendingRevenue: 0, totalRevenue: 0, lastTickAt: now },
    luxury_sushi: { owned: false, rentExpiresAt: 0, stock: [], pendingRevenue: 0, totalRevenue: 0, lastTickAt: now },
    aquarium:     { owned: false, rentExpiresAt: 0, stock: [], pendingRevenue: 0, totalRevenue: 0, lastTickAt: now }
  };
}

export function createNewSave(name = "新人漁師") {
  return ensureSaveDefaults({
    name, money: 15000, paidPearls: 0, freePearls: 0, shells: 0,
    monthlyPass: null, weeklyPass: null, activeCoupon: null,
    stamina: STAMINA_MAX, staminaUpdatedAt: Date.now(), area: "teibou",
    worldPos: { x: 0, z: 4, yaw: 0, isBoating: false },
    profile: { title: "見習い漁師", bio: "よろしくお願いします！", favSpecies: "マダイ" },
    unlockedTitles: [], claimedMilestones: [],
    cooler: [], dex: {}, stats: { totalCaught: 0, totalEarned: 0 },
    dailyStats: { dateKey: getJstDateKey(), caughtCount: 0, earnedMoney: 0 },
    jobProfile: { totalClears: 0, streak: 0 }, reputation: 0, lastPlayedAt: Date.now()
  });
}

export function ensureSaveDefaults(save) {
  if (!save) return null;
  if (typeof save.paidPearls !== "number") save.paidPearls = 0;
  if (typeof save.freePearls !== "number") save.freePearls = 0;
  // 旧Phase 6のpearlsから安全移行
  if (typeof save.pearls === "number" && save.pearls > 0) {
    save.freePearls += save.pearls;
    save.pearls = 0;
  }
  if (typeof save.shells !== "number") save.shells = 0;
  if (!Array.isArray(save.unlockedTitles)) save.unlockedTitles = [];
  if (!Array.isArray(save.claimedMilestones)) save.claimedMilestones = [];
  if (!save.profile) save.profile = { title: "見習い漁師", bio: "よろしくお願いします！", favSpecies: "マダイ" };

  if (!save.gear) save.gear = { rod: "rod_1", reel: "reel_1", line: "line_1", cooler: "cooler_1", shellTool: "shell_1", net: "net_toami", bait: "bait_free" };
  if (!save.gear.reel) save.gear.reel = "reel_1";
  if (!save.gear.net) save.gear.net = "net_toami";
  if (!save.gear.bait) save.gear.bait = "bait_free";

  if (!save.ownedGear) save.ownedGear = [];
  ["rod_1", "reel_1", "line_1", "cooler_1", "shell_1", "net_toami", "bait_free"].forEach((id) => {
    if (!save.ownedGear.includes(id)) save.ownedGear.push(id);
  });
  if (!save.baitStock) save.baitStock = {};

  if (!save.ownedBoats) save.ownedBoats = ["boat_none"];
  if (!save.activeBoatId) save.activeBoatId = "boat_none";
  if (typeof save.fuel !== "number") save.fuel = 0;
  if (typeof save.autoRefuel !== "boolean") save.autoRefuel = true;
  if (!save.worldPos) save.worldPos = { x: 0, z: 4, yaw: 0, isBoating: false };
  if (!save.jobProfile) save.jobProfile = { totalClears: 0, streak: 0 };

  if (typeof save.reputation !== "number") save.reputation = 0;
  if (!save.businesses) save.businesses = defaultBusinesses();
  else { const def = defaultBusinesses(); Object.keys(def).forEach((k) => { if (!save.businesses[k]) save.businesses[k] = def[k]; }); }
  if (!save.farm) save.farm = { maxPlots: 2, plots: [null, null] };
  if (!Array.isArray(save.orders)) save.orders = [];

  const today = getJstDateKey();
  if (!save.dailyStats || save.dailyStats.dateKey !== today) save.dailyStats = { dateKey: today, caughtCount: 0, earnedMoney: 0 };
  if (!save.bank) save.bank = { ordinary: 0, loan: 0, lastCalcAt: Date.now() };
  if (!save.cooler) save.cooler = [];
  if (!save.dex) save.dex = {};
  if (!save.stats) save.stats = { totalCaught: 0, totalEarned: 0 };

  applyStaminaRegen(save);
  applyBankInterest(save);
  getActiveBoat(save);
  return save;
}

export function applyStaminaRegen(save) {
  if (!save) return save;
  const now = Date.now();
  const elapsed = Math.max(0, now - (save.staminaUpdatedAt || now));
  const gain = Math.floor(elapsed / STAMINA_REGEN_MS);
  if (gain > 0) {
    save.stamina = Math.min(STAMINA_MAX, (save.stamina ?? STAMINA_MAX) + gain);
    save.staminaUpdatedAt = now - (elapsed % STAMINA_REGEN_MS);
  }
  return save;
}

export function loadLocalSlots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptySlots();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== MAX_SLOTS) return createEmptySlots();
    return parsed.map((s) => ensureSaveDefaults(s));
  } catch { return createEmptySlots(); }
}

export async function syncLoadSlots() {
  const local = loadLocalSlots();
  const cloud = await loadCloudSlots();
  if (!cloud || !Array.isArray(cloud)) return local;
  const merged = local.map((loc, i) => {
    const cl = cloud[i];
    const picked = (!loc) ? cl : (!cl) ? loc : ((cl.lastPlayedAt || 0) > (loc.lastPlayedAt || 0) ? cl : loc);
    return ensureSaveDefaults(picked);
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function persistSlots(slots, syncCloud = false) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  if (syncCloud) saveCloudSlots(slots);
}
