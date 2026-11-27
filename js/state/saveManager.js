import { saveCloudSlots, loadCloudSlots } from "../config/firebase.js";

const STORAGE_KEY = "sakana_san_slots_v1";
export const MAX_SLOTS = 5;
const STAMINA_MAX = 100;
const STAMINA_REGEN_MS = 3 * 60 * 1000; // 3分で1回復（5時間で全回復）

export function createEmptySlots() {
  return Array.from({ length: MAX_SLOTS }, () => null);
}

export function createNewSave(name = "新人漁師") {
  return {
    name,
    money: 15000,
    stamina: STAMINA_MAX,
    staminaUpdatedAt: Date.now(),
    area: "teibou",
    cooler: [],
    dex: {},
    stats: { totalCaught: 0, totalEarned: 0 },
    lastPlayedAt: Date.now()
  };
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
    return Array.isArray(parsed) && parsed.length === MAX_SLOTS ? parsed : createEmptySlots();
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
    if (!loc) return cl || null;
    if (!cl) return loc;
    return (cl.lastPlayedAt || 0) > (loc.lastPlayedAt || 0) ? cl : loc;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function persistSlots(slots, syncCloud = false) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  if (syncCloud) saveCloudSlots(slots);
}
