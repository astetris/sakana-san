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

// ===== 建物・港湾設備・自然地形の当たり判定（fishingScene.js と完全一致） =====
const LAND_OBSTACLES = (() => {
  const list = [
    // 港の主要建物
    { type: "box", minX: -28.4, maxX: -11.6, minZ: 14.5, maxZ: 26.4, label: "魚市場" },
    { type: "box", minX: -7.5,  maxX: 4.5,   minZ: 21.4, maxZ: 30.4, label: "寿司処 凪" },
    { type: "circle", x: 17.5, z: 24.0, r: 8.4, label: "岬の水族館" },
    { type: "circle", x: 28.0, z: 4.0,  r: 3.0, label: "灯台" },

    // 新規港町設備（軽トラック・自販機コーナー・荷揚げクレーン・漁具の山）
    { type: "box", minX: -32.4, maxX: -29.6, minZ: 17.4, maxZ: 22.2, label: "漁協の軽トラック" },
    { type: "box", minX: 5.2,   maxX: 8.8,   minZ: 26.2, maxZ: 28.8, label: "自販機コーナー" },
    { type: "circle", x: -31.0, z: 3.2,  r: 1.65, label: "荷揚げクレーン" },
    { type: "circle", x: -16.5, z: 2.3,  r: 1.45, label: "漁具・魚箱" },
    { type: "circle", x: 15.5,  z: 2.3,  r: 1.35, label: "漁具・浮き玉" },

    // 清流の河口：川の水面は歩けない（木製の橋 z: 14.2〜17.8 のみ通行可）
    { type: "box", minX: -142.0, maxX: -126.0, minZ: -4.0, maxZ: 14.2, label: "川（橋を渡ろう）" },
    { type: "box", minX: -142.0, maxX: -126.0, minZ: 17.8, maxZ: 48.0, label: "川（橋を渡ろう）" },
    // 海沿い道路のガードレール（横断歩道 x = 4.6〜9.4 だけ渡れる）
    { type: "box", minX: -160.0, maxX: 4.5,   minZ: 34.1, maxZ: 41.6, label: "ガードレール（横断歩道から渡ろう）" },
    { type: "box", minX: 9.5,    maxX: 140.0, minZ: 34.1, maxZ: 41.6, label: "ガードレール（横断歩道から渡ろう）" },
    // 向こう側歩道の左右終端＆自販機
    { type: "box", minX: -160.0, maxX: -36.5, minZ: 41.6, maxZ: 48.0, label: "歩道の端" },
    { type: "box", minX: 36.5,   maxX: 140.0, minZ: 41.6, maxZ: 48.0, label: "歩道の端" },
    { type: "box", minX: 0.7,    maxX: 2.3,   minZ: 45.4, maxZ: 46.8, label: "自動販売機" }
  ];

  // 港の街灯
  const lamps = [[-26, 2.5], [-10, 2.5], [10, 2.5], [22, 2.5], [-26, 16], [10, 16]];
  lamps.forEach(([lx, lz]) => list.push({ type: "circle", x: lx, z: lz, r: 0.45, label: "街灯" }));

  // 港の係留ボラード
  for (let x = -33; x <= 33; x += 6) {
    if (Math.abs(x) < 6) continue;
    list.push({ type: "circle", x: x + 2.2, z: 0.75, r: 0.45, label: "係留ボラード" });
  }

  // 砂浜のヤシの木
  [-46, -68, -92].forEach((px, i) => {
    list.push({ type: "circle", x: px, z: 18 + (i % 2) * 7, r: 0.72, label: "ヤシの木" });
  });

  // 河口の松林
  for (let i = 0; i < 7; i++) {
    list.push({ type: "circle", x: -154 + (i % 3) * 7, z: 8 + i * 4.2, r: 0.75, label: "松の木" });
  }

  // 磯場手前のテトラポッド防波帯
  for (let i = 0; i < 12; i++) {
    list.push({ type: "circle", x: 35 + i * 2.9, z: -1.6 + (i % 3) * 0.9, r: 1.45, label: "テトラポッド" });
  }

  // 荒波の磯場の岩礁
  for (let i = 0; i < 18; i++) {
    const r = (2.2 + (i % 4) * 1.35) * 0.92;
    list.push({ type: "circle", x: 44 + i * 5.6, z: 1 + (i % 4) * 6.5, r, label: "岩礁" });
  }

  return list;
})();

const SEA_OBSTACLES = [
  // 沖防波堤（左右の一文字堤防：中央 x=-21〜+21 が広い出港航路）
  { type: "box", minX: -78.0, maxX: -21.5, minZ: -46.8, maxZ: -40.2, label: "西・沖防波堤" },
  { type: "box", minX: 21.5,  maxX: 78.0,  minZ: -46.8, maxZ: -40.2, label: "東・沖防波堤" },
  // 沖の島々
  { type: "circle", x: 145,  z: -295, r: 32.5, label: "南国の島" },
  { type: "circle", x: -160, z: -355, r: 34.0, label: "沖の島" },
  { type: "circle", x: 45,   z: -385, r: 28.0, label: "沖の島" }
];

function resolveCircleVsBox(px, pz, pr, ob) {
  const cx = Math.max(ob.minX, Math.min(ob.maxX, px));
  const cz = Math.max(ob.minZ, Math.min(ob.maxZ, pz));
  const dx = px - cx;
  const dz = pz - cz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= pr * pr) return { x: px, z: pz, hit: false };

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    const push = pr - dist;
    return { x: px + (dx / dist) * push, z: pz + (dz / dist) * push, hit: true };
  }
  const dLeft = Math.abs(px - ob.minX);
  const dRight = Math.abs(ob.maxX - px);
  const dTop = Math.abs(pz - ob.minZ);
  const dBot = Math.abs(ob.maxZ - pz);
  const m = Math.min(dLeft, dRight, dTop, dBot);
  if (m === dLeft) return { x: ob.minX - pr, z: pz, hit: true };
  if (m === dRight) return { x: ob.maxX + pr, z: pz, hit: true };
  if (m === dTop) return { x: px, z: ob.minZ - pr, hit: true };
  return { x: px, z: ob.maxZ + pr, hit: true };
}

function resolveCircleVsCircle(px, pz, pr, ob) {
  const dx = px - ob.x;
  const dz = pz - ob.z;
  const minD = pr + ob.r;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minD * minD) return { x: px, z: pz, hit: false };
  const dist = Math.sqrt(distSq) || 0.001;
  const push = minD - dist;
  return { x: px + (dx / dist) * push, z: pz + (dz / dist) * push, hit: true };
}

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

// ===== 指定ワールド座標が「水面（海または川）」かどうか判定 =====
export function isWaterPoint(wx, wz) {
  for (const ob of SEA_OBSTACLES) {
    if (ob.type === "box") {
      if (wx >= ob.minX && wx <= ob.maxX && wz >= ob.minZ && wz <= ob.maxZ) return false;
    } else if (Math.hypot(wx - ob.x, wz - ob.z) <= ob.r - 1.0) {
      return false;
    }
  }
  if (Math.abs(wx) <= 4.7 && wz >= -15.5 && wz <= 1.2) return false;
  const shoreZ = Math.abs(wx) <= 37 ? -0.4 : -1.2;
  if (wz < shoreZ) return true;
  if (wx >= -141.5 && wx <= -126.5 && wz >= -4.0 && wz <= 44.0) {
    if (wz >= 14.3 && wz <= 17.7) return false;
    return true;
  }
  return false;
}

export function canCastFrom(x, z, yaw, isBoating) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);

  if (isBoating) {
    const okNear = isWaterPoint(x + fx * 8, z + fz * 8);
    const okMid = isWaterPoint(x + fx * 14, z + fz * 14);
    if (!okNear && !okMid) {
      return { ok: false, msg: "⚠️ 陸地や防波堤側を向いています！海の方を向いて投げよう" };
    }
    return { ok: true, msg: "" };
  }

  const onPier = Math.abs(x) <= 4.6 && z <= 1.5;
  const nearSeaShore = z <= 5.2;
  const nearRiver = (x >= -146.5 && x <= -121.5 && z <= 34.0);
  if (!onPier && !nearSeaShore && !nearRiver) {
    return { ok: false, msg: "⚠️ 陸地では釣れません！海辺・桟橋・川岸まで歩こう" };
  }

  const sampleDists = nearRiver && z > 5.2 ? [4.5, 7.5, 10.5] : [6.5, 10.5, 14.5];
  let waterHits = 0;
  for (const d of sampleDists) {
    if (isWaterPoint(x + fx * d, z + fz * d)) waterHits += 1;
  }
  if (waterHits === 0) {
    return { ok: false, msg: "⚠️ 陸地に向かって投げられません！海や川の方を向こう" };
  }
  return { ok: true, msg: "" };
}

export function canHarvestShellAt(x, z, isBoating) {
  if (isBoating) return { ok: true, msg: "" };
  const onPier = Math.abs(x) <= 4.6 && z <= 1.5;
  const nearSeaShore = z <= 6.0;
  const nearRiver = (x >= -146.5 && x <= -121.5 && z <= 34.0);
  if (!onPier && !nearSeaShore && !nearRiver) {
    return { ok: false, msg: "⚠️ 陸地の奥では貝は採れません！波打ち際や岸壁へ移動しよう" };
  }
  return { ok: true, msg: "" };
}

export function clampWorldPosition(nx, nz, isBoating, boatTier) {
  let blockedMsg = null;

  if (!isBoating) {
    const PLAYER_R = 0.9;
    nx = Math.max(-157, Math.min(137, nx));
    nz = Math.min(45.4, nz);

    const onPierEntry = Math.abs(nx) <= 3.6;
    const coastMinZ = Math.abs(nx) <= 36.5 ? 0.75 : -0.35;
    if (nz < coastMinZ) {
      if (onPierEntry) {
        nx = Math.max(-3.5, Math.min(3.5, nx));
        if (nz < -14.2) {
          nz = -14.2;
          blockedMsg = "桟橋の先端です！船に乗るかここから釣りを楽しもう";
        }
      } else {
        nz = coastMinZ;
        blockedMsg = "海が深い！中央の桟橋から船に乗ろう";
      }
    }

    let hitLabel = null;
    for (let iter = 0; iter < 3; iter++) {
      for (const ob of LAND_OBSTACLES) {
        const res = ob.type === "box"
          ? resolveCircleVsBox(nx, nz, PLAYER_R, ob)
          : resolveCircleVsCircle(nx, nz, PLAYER_R, ob);
        if (res.hit) {
          nx = res.x;
          nz = res.z;
          hitLabel = ob.label;
        }
      }
      nx = Math.max(-157, Math.min(137, nx));
      nz = Math.min(45.4, nz);
      if (nz < coastMinZ) {
        if (Math.abs(nx) <= 3.6) {
          nx = Math.max(-3.5, Math.min(3.5, nx));
          nz = Math.max(-14.2, nz);
        } else {
          nz = coastMinZ;
        }
      }
    }

    if (hitLabel && !blockedMsg && hitLabel.includes("川")) {
      blockedMsg = "🌊 川が深い！木製の橋から向こう岸へ渡ろう";
    }
    return { x: nx, z: nz, blockedMsg };
  }

  // ===== 船での航行エリア＆沖防波堤・島との衝突判定 =====
  nx = Math.max(-210, Math.min(210, nx));
  if (nz > -10) nz = -10;
  if (nz < -365) nz = -365;

  const BOAT_R = 2.6;
  for (let iter = 0; iter < 3; iter++) {
    for (const ob of SEA_OBSTACLES) {
      const res = ob.type === "box"
        ? resolveCircleVsBox(nx, nz, BOAT_R, ob)
        : resolveCircleVsCircle(nx, nz, BOAT_R, ob);
      if (res.hit) {
        nx = res.x;
        nz = res.z;
        blockedMsg = ob.label.includes("防波堤")
          ? `⚓ ${ob.label}です！中央の赤白灯台の間から出港しよう`
          : `🏝️ ${ob.label}の浅瀬には近づけません！`;
      }
    }
  }

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

export function drawMinimap(canvas, { px, pz, yaw, isBoating, hotspots, remotePlayers }) {
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

  // 沖防波堤（左右の一文字堤防）＆赤白灯台ドット
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(toMX(-78), toMY(-46), toMX(-22) - toMX(-78), 2.5);
  ctx.fillRect(toMX(22), toMY(-46), toMX(78) - toMX(22), 2.5);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(toMX(-22) - 1.5, toMY(-46) - 0.5, 3, 3);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(toMX(22) - 1.5, toMY(-46) - 0.5, 3, 3);

  ctx.fillStyle = "#f3c687"; ctx.fillRect(toMX(-4), toMY(-14), 4, 6);

  if (hotspots?.length) {
    ctx.fillStyle = "#38e59a";
    for (const s of hotspots) {
      ctx.beginPath(); ctx.arc(toMX(s.x), toMY(s.z), 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  if (remotePlayers) {
    ctx.fillStyle = "#38bdf8";
    for (const p of Object.values(remotePlayers)) {
      ctx.beginPath();
      ctx.arc(toMX(p.x || 0), toMY(p.z || 0), 3.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.translate(toMX(px), toMY(pz));
  ctx.rotate(-yaw);
  ctx.fillStyle = isBoating ? "#facc15" : "#ffffff";
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}
