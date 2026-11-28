import { audioEngine } from "./audioEngine.js?v=20261128_032740";

let rafId = null;

export function stopShopView() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function drawRounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function startShopView(canvas, { bizDef, bizState, onRushSale, onServeGuest }) {
  stopShopView();
  if (!canvas) return { triggerRush: () => {} };

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  let rushUntil = 0;
  let lastRushAutoAt = 0;
  let combo = 0;
  let lastServeAt = 0;

  // 料理人/店主の目の前の3席（左・中央・右）
  const seatDefs = [
    { x: W * 0.22, y: H * 0.56, coat: "#3b82f6", hair: "#1e293b", type: "常連さん" },
    { x: W * 0.50, y: H * 0.55, coat: "#ef4444", hair: "#451a03", type: "美食家" },
    { x: W * 0.78, y: H * 0.56, coat: "#10b981", hair: "#27272a", type: "観光客" }
  ];

  const ORDER_TEXTS = {
    luxury_sushi: ["特上握り!", "大将おまかせ!", "旬の刺身!", "極上の一貫!"],
    kaiten_sushi: ["中トロ頼む!", "炙りちょうだい!", "貝三貫!", "おすすめ皿!"],
    fishmonger: ["今夜の刺身!", "活きのいいの!", "煮付け用!", "お造り1パック!"],
    aquarium: ["餌やり見たい!", "すごい大物!", "写真撮ろう!", "ショー開催!"]
  };

  const guests = seatDefs.map((s, idx) => ({
    ...s,
    present: true,
    hasOrder: idx === 1,
    orderText: (ORDER_TEXTS[bizDef.id] || ORDER_TEXTS.fishmonger)[idx % 4],
    patience: 1.0,
    maxPatience: 11 + idx * 2,
    nextOrderAt: performance.now() + 900 + idx * 1400,
    happyUntil: 0,
    bobSeed: idx * 2.1
  }));

  // 料理人が客前へスッと差し出す皿アニメーション
  const slidingPlates = [];
  // 売上ポップアップ
  const popups = [];
  // 湯気・泡パーティクル
  const bubbles = Array.from({ length: 18 }, (_, i) => ({
    x: 24 + Math.random() * (W - 48),
    y: 25 + Math.random() * 120,
    r: 1.6 + Math.random() * 3.2,
    vy: 0.35 + Math.random() * 0.55,
    phase: i * 0.9
  }));
  // 水族館の立体回遊魚（奥行きz付き）
  const tankFish = Array.from({ length: 12 }, (_, i) => ({
    x: 40 + Math.random() * (W - 80),
    y: 34 + Math.random() * 98,
    z: 0.45 + (i % 4) * 0.22, // 奥行きスケール
    vx: (i % 2 === 0 ? 1 : -1) * (0.45 + Math.random() * 0.75),
    col: ["#38bdf8", "#f59e0b", "#fb7185", "#34d399", "#a78bfa", "#fde047"][i % 6],
    size: 8 + (i % 4) * 4
  }));

  const addPopup = (x, y, text, color = "#ffd166") => {
    popups.push({ x, y, text, color, life: 64, maxLife: 64 });
  };

  const triggerRush = () => {
    rushUntil = performance.now() + 12000;
    lastRushAutoAt = 0;
    guests.forEach((g) => {
      g.present = true;
      g.hasOrder = true;
      g.patience = 1.0;
    });
  };

  const serveSeat = (g, isRush) => {
    const now = performance.now();
    if (now - lastServeAt < 5000) combo = Math.min(8, combo + 1);
    else combo = 1;
    lastServeAt = now;

    const res = onServeGuest
      ? onServeGuest({ isRush, combo })
      : { ok: true, net: onRushSale?.() || 0, tag: "" };

    if (!res || !res.ok || !res.net) {
      audioEngine.playFail?.();
      addPopup(g.x, g.y - 36, bizDef.isAquarium ? "展示魚を追加!" : "在庫切れ!仕込もう", "#ff7b7b");
      return;
    }

    audioEngine.playCash?.();
    g.hasOrder = false;
    g.happyUntil = now + 2200;
    g.nextOrderAt = now + (isRush ? 1100 : 2800 + Math.random() * 2200);
    g.patience = 1.0;

    // 料理人の手元（画面下中央）から客席前へスッと料理・商品を出すアニメーション
    slidingPlates.push({
      sx: W * 0.5, sy: H * 0.90,
      tx: g.x, ty: H * 0.67,
      t: 0,
      icon: bizDef.isAquarium ? "✨" : bizDef.id === "fishmonger" ? "🐟" : "🍣"
    });

    const tagTxt = res.tag ? ` ${res.tag}` : "";
    const comboTxt = combo >= 2 ? ` (${combo}連続!)` : "";
    addPopup(g.x, g.y - 40, `+¥${res.net.toLocaleString()}${comboTxt}`, "#ffd166");
    if (tagTxt) addPopup(g.x, g.y - 24, `${res.itemName || ""}${tagTxt}`, "#7ef29a");
  };

  // キャンバス直接タップで目の前の客に接客！
  canvas.onpointerdown = (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = (ev.clientX - rect.left) * (W / Math.max(1, rect.width));
    const my = (ev.clientY - rect.top) * (H / Math.max(1, rect.height));
    const isRush = performance.now() < rushUntil;

    // 注文が出ている最寄りの客を優先判定
    let picked = null;
    let minD = 999;
    guests.forEach((g) => {
      if (!g.present) return;
      const d = Math.hypot(mx - g.x, my - (g.y - 16));
      if (d < 78 && d < minD) {
        if (g.hasOrder || bizDef.isAquarium) {
          minD = d;
          picked = g;
        }
      }
    });
    if (!picked) {
      picked = guests.find((g) => g.present && g.hasOrder);
    }
    if (picked) {
      serveSeat(picked, isRush);
    }
  };

  // お客さん立体シルエット＋注文吹き出し描画
  const drawGuest = (g, now, isRush) => {
    if (!g.present) return;
    const happy = now < g.happyUntil;
    const bob = Math.sin(now * 0.003 + g.bobSeed) * 1.8;
    const gx = g.x;
    const gy = g.y + bob;

    // 影（カウンターへの落ち影）
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(gx, gy + 16, 26, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 肩・服（立体グラデーション）
    const bodyGrad = ctx.createLinearGradient(gx - 22, gy - 8, gx + 22, gy + 24);
    bodyGrad.addColorStop(0, g.coat);
    bodyGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = bodyGrad;
    drawRounded(ctx, gx - 24, gy - 4, 48, 30, 14);
    ctx.fill();

    // 首＆顔
    ctx.fillStyle = "#f5cfa0";
    ctx.beginPath();
    ctx.arc(gx, gy - 17, 13, 0, Math.PI * 2);
    ctx.fill();
    // 髪
    ctx.fillStyle = g.hair;
    ctx.beginPath();
    ctx.arc(gx, gy - 20, 13.5, Math.PI, Math.PI * 2);
    ctx.fill();
    // 表情
    ctx.fillStyle = "#1f2937";
    if (happy) {
      ctx.font = "12px sans-serif";
      ctx.fillText("😍", gx - 7, gy - 11);
    } else {
      ctx.fillRect(gx - 5, gy - 18, 2.5, 2.5);
      ctx.fillRect(gx + 2.5, gy - 18, 2.5, 2.5);
      ctx.strokeStyle = "#7c2d12";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(gx, gy - 13, 3.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // 注文吹き出し（タップ対象）
    if (g.hasOrder && (bizState.stock.length > 0 || bizDef.isAquarium)) {
      const pulse = 1 + Math.sin(now * 0.008 + g.bobSeed) * 0.04;
      ctx.save();
      ctx.translate(gx, gy - 48);
      ctx.scale(pulse, pulse);
      const bw = 90, bh = 25;
      ctx.fillStyle = isRush ? "rgba(254, 243, 199, 0.96)" : "rgba(248, 250, 252, 0.95)";
      ctx.strokeStyle = g.patience < 0.35 ? "#ef4444" : "#f59e0b";
      ctx.lineWidth = 2;
      drawRounded(ctx, -bw / 2, -bh / 2, bw, bh, 9);
      ctx.fill();
      ctx.stroke();

      // 忍耐バー
      ctx.fillStyle = "rgba(15,23,42,0.16)";
      ctx.fillRect(-bw / 2 + 6, bh / 2 - 5, bw - 12, 3);
      ctx.fillStyle = g.patience > 0.45 ? "#10b981" : "#ef4444";
      ctx.fillRect(-bw / 2 + 6, bh / 2 - 5, (bw - 12) * Math.max(0, g.patience), 3);

      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10.5px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(g.orderText, 0, 1);
      ctx.textAlign = "left";
      ctx.restore();
    }
  };

  // ===================================================
  // 業態別 2.5D立体背景＆手前カウンター描画
  // ===================================================
  const drawLuxurySushi = (now, isRush) => {
    const intLv = bizState.interiorLv || 1;
    // 奥の和室壁＆天井（一点透視）
    const wallGrad = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    wallGrad.addColorStop(0, "#1c130d");
    wallGrad.addColorStop(1, "#332217");
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, W, H * 0.65);

    // 障子格子（背景に奥行き）
    ctx.fillStyle = intLv >= 3 ? "rgba(254, 240, 199, 0.22)" : "rgba(254, 243, 199, 0.13)";
    ctx.fillRect(24, 16, 108, 92);
    ctx.fillRect(W - 132, 16, 108, 92);
    ctx.strokeStyle = "#5c3d24";
    ctx.lineWidth = 2;
    for (let x = 24; x <= 132; x += 27) { ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, 108); ctx.stroke(); }
    for (let y = 16; y <= 108; y += 23) { ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(132, y); ctx.stroke(); }
    for (let x = W - 132; x <= W - 24; x += 27) { ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, 108); ctx.stroke(); }
    for (let y = 16; y <= 108; y += 23) { ctx.beginPath(); ctx.moveTo(W - 132, y); ctx.lineTo(W - 24, y); ctx.stroke(); }

    // 中央の掛け軸＆暖簾
    ctx.fillStyle = "#efe6d5";
    ctx.fillRect(W / 2 - 30, 14, 60, 74);
    ctx.strokeStyle = intLv >= 2 ? "#d97706" : "#78350f";
    ctx.lineWidth = 3;
    ctx.strokeRect(W / 2 - 30, 14, 60, 74);
    ctx.fillStyle = "#1c1917";
    ctx.font = "bold 22px serif";
    ctx.textAlign = "center";
    ctx.fillText("凪", W / 2, 58);
    ctx.textAlign = "left";

    // 天井からの和風ダウンライト（暖かい光円錐）
    [W * 0.22, W * 0.5, W * 0.78].forEach((lx) => {
      const glow = ctx.createRadialGradient(lx, 12, 2, lx, 62, 68);
      glow.addColorStop(0, "rgba(255, 224, 150, 0.42)");
      glow.addColorStop(1, "rgba(255, 200, 100, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(lx - 70, 0, 140, 130);
      ctx.fillStyle = "#451a03";
      ctx.fillRect(lx - 11, 0, 22, 10);
      ctx.fillStyle = "#fef08a";
      ctx.fillRect(lx - 8, 9, 16, 4);
    });

    // カウンター向こうに座るお客さん
    guests.forEach((g) => drawGuest(g, now, isRush));

    // ===== 手前：料理人目線の檜の一枚板カウンター（台形パース） =====
    const counterTopY = H * 0.63;
    const woodGrad = ctx.createLinearGradient(0, counterTopY, 0, H);
    woodGrad.addColorStop(0, "#e5b887");
    woodGrad.addColorStop(0.55, "#cf9860");
    woodGrad.addColorStop(1, "#a8723e");
    ctx.fillStyle = woodGrad;
    ctx.beginPath();
    ctx.moveTo(16, counterTopY);
    ctx.lineTo(W - 16, counterTopY);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // 檜の木目ライン
    ctx.strokeStyle = "rgba(120, 68, 28, 0.24)";
    ctx.lineWidth = 1.2;
    for (let y = counterTopY + 8; y < H; y += 11) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ガラス冷蔵ネタケース（カウンター左奥に立体配置）
    const nx = 34, ny = counterTopY - 12, nw = 152, nh = 28;
    ctx.fillStyle = "rgba(186, 230, 253, 0.22)";
    ctx.strokeStyle = "rgba(224, 242, 254, 0.72)";
    ctx.lineWidth = 1.6;
    drawRounded(ctx, nx, ny, nw, nh, 5);
    ctx.fill();
    ctx.stroke();
    // ネタケース内の鮮やかな刺身サク（在庫に応じて表示）
    const netaCols = ["#ef4444", "#fb923c", "#f8fafc", "#f43f5e", "#facc15", "#e2e8f0"];
    const showNeta = Math.min(6, bizState.stock.length);
    for (let i = 0; i < showNeta; i++) {
      ctx.fillStyle = "#166534"; // 笹の葉
      ctx.fillRect(nx + 10 + i * 23, ny + 14, 18, 9);
      ctx.fillStyle = netaCols[i % netaCols.length];
      drawRounded(ctx, nx + 11 + i * 23, ny + 11, 16, 9, 3);
      ctx.fill();
    }

    // 手前のまな板・寿司下駄・柳刃包丁（料理人視点の主役！）
    // 白木まな板
    ctx.fillStyle = "#f5d7b0";
    ctx.strokeStyle = "#b47b44";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(W * 0.30, H * 0.76);
    ctx.lineTo(W * 0.70, H * 0.76);
    ctx.lineTo(W * 0.74, H * 0.96);
    ctx.lineTo(W * 0.26, H * 0.96);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 柳刃包丁（まな板右端にキラリと光る刃）
    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(W * 0.62, H * 0.80);
    ctx.lineTo(W * 0.78, H * 0.88);
    ctx.lineTo(W * 0.76, H * 0.91);
    ctx.lineTo(W * 0.60, H * 0.83);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#78350f";
    ctx.fillRect(W * 0.76, H * 0.88, 22, 7);

    // 湯呑み＆ワサビ小鉢
    ctx.fillStyle = "#14532d";
    ctx.beginPath(); ctx.ellipse(W * 0.84, H * 0.72, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3f6212";
    ctx.fillRect(W * 0.84 - 11, H * 0.72, 22, 14);
  };

  const drawKaitenSushi = (now, isRush) => {
    const intLv = bizState.interiorLv || 1;
    // 奥の明るい木目店内＆短冊メニュー
    const bg = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    bg.addColorStop(0, "#1e293b");
    bg.addColorStop(1, "#334155");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H * 0.65);

    // メニュー短冊ズラリ
    const menus = ["マグロ", "サーモン", "タイ", "イカ", "貝三昧", "特上"];
    menus.forEach((m, i) => {
      const mx = 22 + i * 64;
      ctx.fillStyle = i % 2 === 0 ? "#fef3c7" : "#fde68a";
      ctx.fillRect(mx, 12, 46, 54);
      ctx.strokeStyle = "#b45309";
      ctx.strokeRect(mx, 12, 46, 54);
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m, mx + 23, 42);
      ctx.textAlign = "left";
    });
    if (intLv >= 2) {
      // 赤提灯
      [48, W - 48].forEach((lx) => {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath(); ctx.ellipse(lx, 24, 11, 14, 0, 0, Math.PI * 2); ctx.fill();
      });
    }

    guests.forEach((g) => drawGuest(g, now, isRush));

    // ===== 立体パース付き回転コンベア =====
    const laneY = H * 0.72;
    ctx.fillStyle = "#475569";
    ctx.beginPath();
    ctx.moveTo(10, H * 0.62);
    ctx.lineTo(W - 10, H * 0.62);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // 回転レーン本体（楕円ベルト）
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.ellipse(W / 2, laneY + 8, W * 0.44, 24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.ellipse(W / 2, laneY + 8, W * 0.44, 24, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 流れる立体寿司皿（手前は大きく、奥は小さく描画）
    const dishCount = Math.min(9, Math.max(3, bizState.stock.length));
    const dishes = [];
    for (let i = 0; i < dishCount; i++) {
      const ang = now * (isRush ? 0.0022 : 0.0012) + (i * Math.PI * 2) / dishCount;
      const dx = W / 2 + Math.cos(ang) * (W * 0.43);
      const dy = laneY + 8 + Math.sin(ang) * 23;
      const depth = 0.72 + (Math.sin(ang) + 1) * 0.24;
      dishes.push({ dx, dy, depth, i });
    }
    dishes.sort((a, b) => a.dy - b.dy);
    dishes.forEach(({ dx, dy, depth, i }) => {
      ctx.fillStyle = i % 3 === 0 ? "#f59e0b" : i % 3 === 1 ? "#ef4444" : "#38bdf8";
      ctx.beginPath();
      ctx.ellipse(dx, dy, 13 * depth, 6 * depth, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.ellipse(dx, dy - 1.5 * depth, 9 * depth, 4 * depth, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${Math.round(13 * depth)}px sans-serif`;
      ctx.fillText("🍣", dx - 7 * depth, dy + 2 * depth);
    });

    // 手前の職人シャリ桶
    ctx.fillStyle = "#d97706";
    ctx.beginPath(); ctx.ellipse(W * 0.16, H * 0.94, 34, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath(); ctx.ellipse(W * 0.16, H * 0.92, 27, 10, 0, 0, Math.PI * 2); ctx.fill();
  };

  const drawFishmonger = (now, isRush) => {
    // 港の軒先・青い日よけテント（店主目線）
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.58);
    sky.addColorStop(0, "#0c4a6e");
    sky.addColorStop(1, "#38bdf8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H * 0.62);

    // 縞模様の青い庇テント
    for (let x = 0; x < W; x += 28) {
      ctx.fillStyle = (x / 28) % 2 === 0 ? "#0284c7" : "#f8fafc";
      ctx.fillRect(x, 0, 28, 28);
      ctx.beginPath();
      ctx.arc(x + 14, 28, 14, 0, Math.PI);
      ctx.fill();
    }

    // 買い物客
    guests.forEach((g) => drawGuest(g, now, isRush));

    // ===== 手前：傾斜した砕氷の鮮魚台（立体パース） =====
    const topY = H * 0.62;
    ctx.fillStyle = "#0369a1";
    ctx.beginPath();
    ctx.moveTo(14, topY);
    ctx.lineTo(W - 14, topY);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // 砕いた氷ベッド
    const iceGrad = ctx.createLinearGradient(0, topY + 6, 0, H - 8);
    iceGrad.addColorStop(0, "#e0f2fe");
    iceGrad.addColorStop(1, "#bae6fd");
    ctx.fillStyle = iceGrad;
    ctx.beginPath();
    ctx.moveTo(26, topY + 8);
    ctx.lineTo(W - 26, topY + 8);
    ctx.lineTo(W - 10, H - 6);
    ctx.lineTo(10, H - 6);
    ctx.closePath();
    ctx.fill();

    // 並ぶ鮮魚と赤い値札ポップ
    const fishCount = Math.min(8, bizState.stock.length);
    for (let i = 0; i < fishCount; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const fx = 66 + col * 92;
      const fy = topY + 26 + row * 34;
      ctx.font = row === 0 ? "20px sans-serif" : "24px sans-serif";
      ctx.fillText(i % 3 === 0 ? "🐟" : i % 3 === 1 ? "🐠" : "🐚", fx - 12, fy + 6);
      // 値札
      ctx.fillStyle = "#fef08a";
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 1.2;
      ctx.fillRect(fx + 14, fy - 12, 28, 14);
      ctx.strokeRect(fx + 14, fy - 12, 28, 14);
      ctx.fillStyle = "#b91c1c";
      ctx.font = "bold 8px sans-serif";
      ctx.fillText("新鮮", fx + 17, fy - 2);
    }
    if (!fishCount) {
      ctx.fillStyle = "#0369a1";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🧊 氷の上は空っぽ！魚を仕込もう", W / 2, H * 0.82);
      ctx.textAlign = "left";
    }
  };

  const drawAquarium = (now, isRush) => {
    const intLv = bizState.interiorLv || 1;
    // 巨大パノラマ大水槽
    const waterGrad = ctx.createLinearGradient(0, 0, 0, H * 0.78);
    waterGrad.addColorStop(0, "#0284c7");
    waterGrad.addColorStop(0.45, "#0369a1");
    waterGrad.addColorStop(1, "#082f49");
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, W, H * 0.80);

    // 上から差し込む光のカーテン（ゴッドレイ）
    for (let i = 0; i < 4; i++) {
      const rx = 55 + i * 95 + Math.sin(now * 0.001 + i) * 14;
      const rayGrad = ctx.createLinearGradient(rx, 0, rx + 26, H * 0.72);
      rayGrad.addColorStop(0, "rgba(186, 230, 253, 0.24)");
      rayGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(rx - 12, 0);
      ctx.lineTo(rx + 26, 0);
      ctx.lineTo(rx + 58, H * 0.76);
      ctx.lineTo(rx - 22, H * 0.76);
      ctx.closePath();
      ctx.fill();
    }

    // 海底の白砂＆サンゴ礁
    ctx.fillStyle = "#0e4d64";
    ctx.beginPath();
    ctx.moveTo(0, H * 0.68);
    ctx.quadraticCurveTo(W * 0.3, H * 0.60, W * 0.6, H * 0.69);
    ctx.quadraticCurveTo(W * 0.85, H * 0.74, W, H * 0.64);
    ctx.lineTo(W, H * 0.82);
    ctx.lineTo(0, H * 0.82);
    ctx.closePath();
    ctx.fill();

    // サンゴ・海藻（内装レベルで増える）
    const coralCols = ["#f43f5e", "#f59e0b", "#a855f7", "#14b8a6"];
    for (let i = 0; i < 3 + intLv; i++) {
      const cx = 36 + i * 54;
      ctx.fillStyle = coralCols[i % coralCols.length];
      ctx.beginPath();
      ctx.arc(cx, H * 0.70, 9 + (i % 2) * 4, Math.PI, 0);
      ctx.fill();
    }

    // 上昇する気泡
    ctx.strokeStyle = "rgba(224, 242, 254, 0.55)";
    ctx.lineWidth = 1.2;
    bubbles.forEach((b) => {
      b.y -= b.vy;
      if (b.y < 8) { b.y = H * 0.74; b.x = 20 + Math.random() * (W - 40); }
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(now * 0.004 + b.phase) * 3, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 展示魚（奥行きスケール付き立体回遊）
    const showFish = Math.min(tankFish.length, Math.max(0, bizState.stock.length));
    const sortedFish = tankFish.slice(0, showFish).sort((a, b) => a.z - b.z);
    sortedFish.forEach((f, idx) => {
      f.x += f.vx * (isRush ? 1.8 : 1.0);
      if (f.x < 28 || f.x > W - 28) f.vx *= -1;
      const fy = f.y + Math.sin(now * 0.003 + idx) * 6;
      const s = f.size * f.z;
      ctx.save();
      ctx.translate(f.x, fy);
      ctx.scale(f.vx >= 0 ? 1 : -1, 1);
      ctx.fillStyle = f.col;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.4, s * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 1.1, 0);
      ctx.lineTo(-s * 2.0, -s * 0.7);
      ctx.lineTo(-s * 2.0, s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath(); ctx.arc(s * 0.75, -s * 0.15, Math.max(1.5, s * 0.16), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    if (!showFish) {
      ctx.fillStyle = "#e0f2fe";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🐠 魚や貝を展示すると大水槽を優雅に泳ぎます！", W / 2, H * 0.40);
      ctx.textAlign = "left";
    }

    // 手前の暗い観覧フロア＆アクリル枠＆観客シルエット
    ctx.fillStyle = "#0b1324";
    ctx.fillRect(0, H * 0.78, W, H * 0.22);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, H * 0.78); ctx.lineTo(W, H * 0.78); ctx.stroke();

    guests.forEach((g) => {
      // 観客を水槽前のシルエット位置に補正して描画
      const origY = g.y;
      g.y = H * 0.85;
      drawGuest(g, now, isRush);
      g.y = origY;
    });
  };

  let lastFrame = performance.now();

  const draw = (now) => {
    const dt = Math.min(0.08, (now - lastFrame) / 1000);
    lastFrame = now;
    const isRush = now < rushUntil;

    // 客の注文発生＆忍耐ゲージ進行
    const orderSpeed = isRush ? 1.7 : 1.0;
    guests.forEach((g, idx) => {
      if (!g.hasOrder && now >= g.nextOrderAt && (bizState.stock.length > 0 || bizDef.isAquarium)) {
        g.hasOrder = true;
        g.patience = 1.0;
        const pool = ORDER_TEXTS[bizDef.id] || ORDER_TEXTS.fishmonger;
        g.orderText = pool[Math.floor(Math.random() * pool.length)];
      } else if (g.hasOrder) {
        g.patience -= (dt / g.maxPatience) * orderSpeed;
        if (g.patience <= 0) {
          g.hasOrder = false;
          g.nextOrderAt = now + 2600 + idx * 700;
          g.patience = 1.0;
        }
      }
    });

    // ラッシュ営業中は1.3秒ごとに自動で客注文を捌く（タップと併用可）
    if (isRush && now - lastRushAutoAt > 1350) {
      lastRushAutoAt = now;
      const target = guests.find((g) => g.hasOrder) || guests[Math.floor(Math.random() * guests.length)];
      serveSeat(target, true);
    }

    ctx.clearRect(0, 0, W, H);
    if (bizDef.id === "luxury_sushi") drawLuxurySushi(now, isRush);
    else if (bizDef.id === "kaiten_sushi") drawKaitenSushi(now, isRush);
    else if (bizDef.id === "fishmonger") drawFishmonger(now, isRush);
    else drawAquarium(now, isRush);

    // 料理人から差し出される皿・提供エフェクト
    for (let i = slidingPlates.length - 1; i >= 0; i--) {
      const p = slidingPlates[i];
      p.t += dt * 3.6;
      const e = Math.min(1, 1 - Math.pow(1 - Math.min(1, p.t), 3));
      const px = p.sx + (p.tx - p.sx) * e;
      const py = p.sy + (p.ty - p.sy) * e;
      const sc = 1.35 - e * 0.45;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(sc, sc);
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      ctx.beginPath(); ctx.ellipse(0, 5, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.icon, 0, 4);
      ctx.restore();
      if (p.t >= 1.25) slidingPlates.splice(i, 1);
    }

    // 売上ポップアップ
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.y -= 0.65;
      p.life--;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = "rgba(15,23,42,0.85)";
      ctx.lineWidth = 3;
      ctx.font = "bold 12.5px sans-serif";
      ctx.textAlign = "center";
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
      if (p.life <= 0) popups.splice(i, 1);
    }

    // 下部ガイド＆ラッシュ表示
    if (isRush) {
      const rem = Math.ceil((rushUntil - now) / 1000);
      ctx.fillStyle = "rgba(217, 119, 6, 0.94)";
      drawRounded(ctx, W - 128, H - 25, 120, 19, 6);
      ctx.fill();
      ctx.fillStyle = "#111827";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(`🔥 ラッシュ残 ${rem}秒`, W - 120, H - 12);
    } else if (bizState.stock.length > 0 || bizDef.isAquarium) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      drawRounded(ctx, 8, H - 23, 192, 18, 6);
      ctx.fill();
      ctx.fillStyle = "#bae6fd";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("👆 注文の吹き出しをタップで直接接客！", 14, H - 11);
    }

    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);

  return { triggerRush };
}
