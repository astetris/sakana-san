import { audioEngine } from "./audioEngine.js";

let rafId = null;

export function stopShopView() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export function startShopView(canvas, { bizDef, bizState, onRushSale }) {
  stopShopView();
  if (!canvas) return { triggerRush: () => {} };

  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  let rushUntil = 0;
  let lastRushSaleAt = 0;
  const guests = Array.from({ length: 6 }, (_, i) => ({
    x: 45 + (i % 3) * 115 + Math.random() * 20,
    y: bizDef.isAquarium ? (125 + Math.random() * 35) : (120 + (i >= 3 ? 35 : 0)),
    vx: (Math.random() - 0.5) * 0.5,
    color: ["#f97316", "#38bdf8", "#a78bfa", "#f43f5e", "#22c55e", "#eab308"][i],
    mood: "🙂"
  }));
  const fishes = Array.from({ length: 8 }, (_, i) => ({
    x: 30 + Math.random() * (W - 60),
    y: 26 + Math.random() * 58,
    vx: (i % 2 === 0 ? 1 : -1) * (0.4 + Math.random() * 0.6),
    emoji: ["🐟", "🐠", "🐡", "🦑", "🦐"][i % 5]
  }));
  const popups = [];

  const addPopup = (x, y, text) => {
    popups.push({ x, y, text, life: 60 });
  };

  const triggerRush = () => {
    rushUntil = performance.now() + 12000;
    lastRushSaleAt = 0;
  };

  const draw = (now) => {
    const isRush = now < rushUntil;

    // 業態ごとの固定俯瞰フロア描画
    if (bizDef.id === "fishmonger") {
      ctx.fillStyle = "#1e293b"; ctx.fillRect(0, 0, W, H);
      // 氷の鮮魚陳列台
      ctx.fillStyle = "#38bdf8"; ctx.fillRect(24, 18, W - 48, 54);
      ctx.fillStyle = "#e0f2fe"; ctx.fillRect(30, 24, W - 60, 42);
      ctx.fillStyle = "#0f172a"; ctx.font = "bold 12px sans-serif";
      ctx.fillText(`🐟 本日の鮮魚台（在庫 ${bizState.stock.length}点）`, 38, 49);
    } else if (bizDef.id === "kaiten_sushi") {
      ctx.fillStyle = "#1f242d"; ctx.fillRect(0, 0, W, H);
      // 回転レーン（楕円）
      ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 22;
      ctx.beginPath(); ctx.roundRect(36, 26, W - 72, 68, 30); ctx.stroke();
      ctx.strokeStyle = "#475569"; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.roundRect(36, 26, W - 72, 68, 30); ctx.stroke();
      // 流れる寿司皿
      const dishCount = Math.min(8, Math.max(2, bizState.stock.length));
      for (let i = 0; i < dishCount; i++) {
        const ang = (now * 0.0012 + (i * Math.PI * 2) / dishCount);
        const dx = W / 2 + Math.cos(ang) * (W * 0.34);
        const dy = 60 + Math.sin(ang) * 32;
        ctx.fillStyle = i % 2 === 0 ? "#f59e0b" : "#ef4444";
        ctx.beginPath(); ctx.arc(dx, dy, 7, 0, Math.PI * 2); ctx.fill();
        ctx.font = "11px sans-serif"; ctx.fillText("🍣", dx - 6, dy + 4);
      }
    } else if (bizDef.id === "luxury_sushi") {
      ctx.fillStyle = "#1c1917"; ctx.fillRect(0, 0, W, H);
      // 檜の一枚板カウンター
      ctx.fillStyle = "#d4a373"; ctx.fillRect(22, 24, W - 44, 48);
      ctx.fillStyle = "#b07d4f"; ctx.fillRect(22, 66, W - 44, 6);
      ctx.fillStyle = "#292524"; ctx.font = "bold 12px sans-serif";
      ctx.fillText(`🍶 檜カウンター（厳選ネタ ${bizState.stock.length}貫）`, 34, 52);
    } else {
      // 水族館の大水槽俯瞰
      ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 12, 0, 96);
      grad.addColorStop(0, "#0284c7"); grad.addColorStop(1, "#082f49");
      ctx.fillStyle = grad; ctx.fillRect(16, 14, W - 32, 82);
      ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 3;
      ctx.strokeRect(16, 14, W - 32, 82);

      // 水槽内を泳ぐ展示魚
      const swimCount = Math.min(fishes.length, Math.max(1, bizState.stock.length));
      for (let i = 0; i < swimCount; i++) {
        const f = fishes[i];
        f.x += f.vx;
        if (f.x < 28 || f.x > W - 36) f.vx *= -1;
        ctx.font = "16px sans-serif";
        ctx.fillText(f.emoji, f.x, f.y + Math.sin(now * 0.003 + i) * 4);
      }
      if (!bizState.stock.length) {
        ctx.fillStyle = "#bae6fd"; ctx.font = "12px sans-serif";
        ctx.fillText("クーラーから魚や貝を展示しよう！", 80, 58);
      }
    }

    // お客さんの動き＆ラッシュ接客処理
    const activeGuests = bizState.stock.length > 0 ? (isRush ? 6 : 4) : 1;
    for (let i = 0; i < activeGuests; i++) {
      const g = guests[i];
      g.x += g.vx * (isRush ? 2.2 : 1.0);
      if (g.x < 28 || g.x > W - 28) g.vx *= -1;
      ctx.fillStyle = g.color;
      ctx.beginPath(); ctx.arc(g.x, g.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fde68a";
      ctx.beginPath(); ctx.arc(g.x, g.y - 3, 6, 0, Math.PI * 2); ctx.fill();
      ctx.font = "12px sans-serif";
      ctx.fillText(isRush ? "😍" : g.mood, g.x + 8, g.y - 8);
    }

    // ラッシュ営業中は1.4秒おきに目の前で即売上＆チップ発生
    if (isRush && now - lastRushSaleAt > 1400) {
      lastRushSaleAt = now;
      const g = guests[Math.floor(Math.random() * activeGuests)];
      const rev = onRushSale?.();
      if (rev && rev > 0) {
        audioEngine.playCash();
        addPopup(g.x, g.y - 16, `+¥${rev.toLocaleString()}`);
      }
    }

    // 売上ポップアップ描画
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.y -= 0.7; p.life--;
      ctx.globalAlpha = Math.max(0, p.life / 60);
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(p.text, p.x - 18, p.y);
      ctx.globalAlpha = 1;
      if (p.life <= 0) popups.splice(i, 1);
    }

    if (isRush) {
      const rem = Math.ceil((rushUntil - now) / 1000);
      ctx.fillStyle = "rgba(212, 148, 73, 0.92)";
      ctx.fillRect(W - 118, H - 24, 112, 18);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(`🔥 ラッシュ残 ${rem}秒`, W - 110, H - 11);
    }

    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);

  return { triggerRush };
}
