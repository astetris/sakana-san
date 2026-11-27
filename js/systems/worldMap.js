export const PIER_DOCK_POS = { x: 0, z: -10 };

export const AREA_META = {
  teibou:   { id: "teibou",   name: "港・堤防",     minBoatTier: 0, isSea: false, color: "#64748b" },
  sunahama: { id: "sunahama", name: "白砂の砂浜",   minBoatTier: 0, isSea: false, color: "#e9d5a1" },
  kakou:    { id: "kakou",    name: "清流の河口",   minBoatTier: 0, isSea: false, color: "#38bdf8" },
  iso:      { id: "iso",      name: "荒波の磯場",   minBoatTier: 0, isSea: false, color: "#57534e" },
  kinkai:   { id: "kinkai",   name: "近海エリア",   minBoatTier: 1, isSea: true,  color: "#0284c7" },
  okiai:    { id: "okiai",    name: "沖合エリア",   minBoatTier: 2, isSea: true,  color: "#1d4ed8" },
  shinkai:  { id: "shinkai",  name: "深海海溝",     minBoatTier: 2, isSea: true,  color: "#1e1b4b" },
  nangoku:  { id: "nangoku",  name: "南国サンゴ礁", minBoatTier: 3, isSea: true,  color: "#14b8a6" },
  enyou:    { id: "enyou",    name: "遠洋外海",     minBoatTier: 3, isSea: true,  color: "#0f172a" }
};

export function getAreaAt(x, z, isBoating) {
  if (!isBoating || z > -14) {
    if (x < -105) return AREA_META.kakou;
    if (x < -36) return AREA_META.sunahama;
    if (x > 36) return AREA_META.iso;
    return AREA_META.teibou;
  }
  if (z > -125) return AREA_META.kinkai;
  if (z <= -220 && x < -65) return AREA_META.shinkai;
  if (z <= -220 && x > 65) return AREA_META.nangoku;
  if (z <= -255) return AREA_META.enyou;
  return AREA_META.okiai;
}

export function isNearPier(x, z) {
  return Math.hypot(x - PIER_DOCK_POS.x, z - PIER_DOCK_POS.z) <= 18;
}

export function clampWorldPosition(nx, nz, isBoating, boatTier) {
  let blockedMsg = null;
  if (!isBoating) {
    nx = Math.max(-158, Math.min(138, nx));
    const onPierX = Math.abs(nx) <= 5.5;
    const minZ = onPierX ? -13.5 : -2.0;
    if (nz < minZ) {
      nz = minZ;
      blockedMsg = "海が深い！桟橋（中央）から船に乗ろう";
    }
    nz = Math.min(34, nz);
    return { x: nx, z: nz, blockedMsg };
  }

  nx = Math.max(-210, Math.min(210, nx));
  if (nz > -10) nz = -10;
  if (nz < -365) nz = -365;

  const targetArea = getAreaAt(nx, nz, true);
  if (targetArea.minBoatTier > boatTier) {
    const needName = targetArea.minBoatTier === 2 ? "中型漁船以上" : "大型遠洋船";
    blockedMsg = `⚠️ ${targetArea.name}へは${needName}が必要！`;
    if (targetArea.minBoatTier === 2) nz = Math.max(nz, -124);
    if (targetArea.minBoatTier === 3) {
      if (nz < -219 && nx > 64) nx = 64;
      nz = Math.max(nz, -254);
    }
  }
  return { x: nx, z: nz, blockedMsg };
}

export function drawMinimap(canvas, { px, pz, yaw, isBoating, hotspots }) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const toMX = (wx) => ((wx + 210) / 420) * w;
  const toMY = (wz) => ((wz + 370) / 410) * h;

  ctx.fillStyle = "#0b2540"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#081426"; ctx.fillRect(0, 0, w, toMY(-255));
  ctx.fillStyle = "#171442"; ctx.fillRect(0, toMY(-365), toMX(-65), toMY(-220) - toMY(-365));
  ctx.fillStyle = "#0f5c5c"; ctx.fillRect(toMX(65), toMY(-365), w - toMX(65), toMY(-220) - toMY(-365));
  ctx.fillStyle = "#0e3b66"; ctx.fillRect(0, toMY(-125), w, toMY(-10) - toMY(-125));

  const shoreY = toMY(-4);
  ctx.fillStyle = "#38bdf8"; ctx.fillRect(0, shoreY, toMX(-105), h - shoreY);
  ctx.fillStyle = "#d9c28a"; ctx.fillRect(toMX(-105), shoreY, toMX(-36) - toMX(-105), h - shoreY);
  ctx.fillStyle = "#64748b"; ctx.fillRect(toMX(-36), shoreY, toMX(36) - toMX(-36), h - shoreY);
  ctx.fillStyle = "#57534e"; ctx.fillRect(toMX(36), shoreY, w - toMX(36), h - shoreY);

  ctx.fillStyle = "#f3c687"; ctx.fillRect(toMX(-4), toMY(-14), 4, 6);

  if (hotspots?.length) {
    ctx.fillStyle = "#38e59a";
    for (const s of hotspots) {
      ctx.beginPath(); ctx.arc(toMX(s.x), toMY(s.z), 2.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  ctx.save();
  ctx.translate(toMX(px), toMY(pz));
  ctx.rotate(-yaw);
  ctx.fillStyle = isBoating ? "#facc15" : "#ffffff";
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}
