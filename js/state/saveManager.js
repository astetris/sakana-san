import { saveCloudSlots, loadCloudSlots } from "../config/firebase.js";
import { applyBankInterest } from "../systems/economy.js";

const STORAGE_KEY = "sakana_san_slots_v1";
export const MAX_SLOTS = 5;
const STAMINA_MAX = 100;
const STAMINA_REGEN_MS = 3 * 60 * 1000;

export function createEmptySlots() {
  return Array.from({ length: MAX_SLOTS }, () => null);
}

export function createNewSave(name = "新人漁師") {
  return ensureSaveDefaults({
    name,
    money: 15000,
    stamina: STAMINA_MAX,
    staminaUpdatedAt: Date.now(),
    area: "teibou",
    cooler: [],
    dex: {},
    stats: { totalCaught: 0, totalEarned: 0 },
    lastPlayedAt: Date.now()
  });
}

export function ensureSaveDefaults(save) {
  if (!save) return null;
  if (!save.gear) {
    save.gear = { rod: "rod_1", line: "line_1", cooler: "cooler_1", shellTool: "shell_1" };
  }
  if (!save.ownedGear) {
    save.ownedGear = ["rod_1", "line_1", "cooler_1", "shell_1"];
  }
  if (!save.bank) {
    save.bank = { ordinary: 0, loan: 0, lastCalcAt: Date.now() };
  }
  if (!save.cooler) save.cooler = [];
  if (!save.dex) save.dex = {};
  if (!save.stats) save.stats = { totalCaught: 0, totalEarned: 0 };
  applyStaminaRegen(save);
  applyBankInterest(save);
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
  } catch {
    return createEmptySlots();
  }
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
