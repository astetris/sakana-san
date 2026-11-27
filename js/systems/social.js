export const CANTEEN_MENU = [
  { id: "meal_onigiri", icon: "🍙", name: "塩むすび＆温かいお茶", price: 650, heal: 20, buff: null, desc: "手軽にサクッと体力回復（⚡+20）" },
  { id: "meal_soup",    icon: "🍲", name: "漁師のあら汁定食",     price: 1800, heal: 45, buff: { label: "🍲 あったか活力(+5%査定)", priceMult: 1.05, rareBonus: false, mins: 20 }, desc: "⚡+45回復 ＆ 20分間 魚・貝の査定+5%" },
  { id: "meal_don",     icon: "🍚", name: "港の特盛海鮮丼",       price: 4200, heal: 75, buff: { label: "🍚 大漁の気合い(レアUP/+10%)", priceMult: 1.1, rareBonus: true, mins: 30 }, desc: "⚡+75回復 ＆ 30分間 レア率UP・査定+10%" },
  { id: "meal_feast",   icon: "🍱", name: "大将の特上漁師御膳",   price: 9800, heal: 100, buff: { label: "🍱 漁師の極み(レアUP/+18%)", priceMult: 1.18, rareBonus: true, mins: 45 }, desc: "⚡全回復 ＆ 45分間 レア率UP・査定+18%" }
];

export const PROFILE_TITLES = [
  "見習い漁師",
  "堤防の常連",
  "潮干狩り名人",
  "大物ハンター",
  "深海の探求者",
  "寿司屋の大将",
  "水族館の館長",
  "港のVIPサポーター",
  "海の覇王"
];

export function getActiveBuff(save) {
  const now = Date.now();
  const meal = save.mealBuff && save.mealBuff.expiresAt > now ? save.mealBuff : null;
  const pearl = save.pearlBuff && save.pearlBuff.expiresAt > now ? save.pearlBuff : null;
  if (!meal && !pearl) return null;

  const priceMult = (meal?.priceMult || 1) * (pearl?.priceMult || 1);
  const rareBonus = !!(meal?.rareBonus || pearl?.rareBonus);
  const labels = [];
  if (meal) labels.push(`${meal.label.split("(")[0]} 残${Math.ceil((meal.expiresAt - now) / 60000)}分`);
  if (pearl) labels.push(`${pearl.label} 残${Math.ceil((pearl.expiresAt - now) / 60000)}分`);
  return { priceMult, rareBonus, text: labels.join(" / ") };
}
