// ===== 水産・港湾 リアルタイム株式取引所（個人セーブ完全分離） =====
export const STOCK_DEFS = [
  { id: "MAGURO", code: "1301", name: "黒潮マグロ水産",   icon: "🐟", base: 2400, vol: 0.042, desc: "遠洋マグロ漁の筆頭。豊漁ニュースで急騰しやすいハイリスク銘柄" },
  { id: "NAGI",   code: "2840", name: "凪すしHD",         icon: "🍣", base: 1850, vol: 0.024, desc: "港の名店チェーン。インバウンド・観光客増で堅調に伸びる" },
  { id: "MINATO", code: "9104", name: "さかな港湾ロジ",   icon: "⚓", base: 1320, vol: 0.028, desc: "鮮魚輸送・港湾倉庫。天候や海況の影響を受けやすい" },
  { id: "SHINKAI",code: "4588", name: "深海マリンバイオ", icon: "🦑", base: 3600, vol: 0.062, desc: "深海魚研究バイオ。大発見で爆上げも急落もある仕手系銘柄" },
  { id: "SANGO",  code: "9612", name: "南国サンゴ観光",   icon: "🐠", base: 1580, vol: 0.032, desc: "水族館・離島ツアー。晴天時に買われやすいレジャー銘柄" },
  { id: "COLD",   code: "2910", name: "極鮮コールド",     icon: "🧊", base: 1120, vol: 0.015, desc: "製氷・冷蔵設備。値動き穏やかなディフェンシブ水産株" }
];

const NEWS_POOL = [
  { target: "MAGURO",  drift:  0.055, text: "【速報】黒潮の蛇行が収まり本マグロ大豊漁の兆し！" },
  { target: "MAGURO",  drift: -0.045, text: "【速報】遠洋海域で時化が続き水揚げ減少懸念" },
  { target: "NAGI",    drift:  0.042, text: "【速報】港の寿司ブーム到来！SNSで「凪」がトレンド入り" },
  { target: "NAGI",    drift: -0.032, text: "【速報】シャリ用米・海苔の仕入れ高騰が重荷" },
  { target: "MINATO",  drift:  0.038, text: "【速報】鮮魚直行トラック便が増便、港湾取扱量が過去最高" },
  { target: "MINATO",  drift: -0.036, text: "【速報】燃料費上昇で物流コスト増を警戒" },
  { target: "SHINKAI", drift:  0.085, text: "【特報】深海魚由来コラーゲンの新特許取得を発表！" },
  { target: "SHINKAI", drift: -0.072, text: "【速報】深海探査プロジェクトの試験が延期に" },
  { target: "SANGO",   drift:  0.048, text: "【速報】連休の海辺観光予約が前年比140%に急増！" },
  { target: "SANGO",   drift: -0.035, text: "【速報】悪天候予報で観光関連株に売り先行" },
  { target: "COLD",    drift:  0.025, text: "【速報】新型急速冷凍庫の受注が全国漁協から殺到" }
];

const marketState = {
  started: false,
  timer: null,
  tickCount: 0,
  prices: {},
  prevPrices: {},
  history: {},
  drifts: {},
  lastNews: "📢 市場オープン！ニュースとチャートを見ながら魚株を売買しよう",
  listeners: new Set()
};

STOCK_DEFS.forEach((s) => {
  marketState.prices[s.id] = s.base;
  marketState.prevPrices[s.id] = s.base;
  marketState.drifts[s.id] = 0;
  const arr = [];
  let p = s.base * (0.94 + Math.random() * 0.12);
  for (let i = 0; i < 24; i++) {
    p = Math.max(Math.round(s.base * 0.35), Math.round(p * (1 + (Math.random() - 0.5) * s.vol * 1.4)));
    arr.push(p);
  }
  marketState.prices[s.id] = arr[arr.length - 1];
  marketState.prevPrices[s.id] = arr[arr.length - 2];
  marketState.history[s.id] = arr;
});

export function ensureStockMarketRunning(getEnvFn) {
  if (marketState.started) return;
  marketState.started = true;
  marketState.timer = setInterval(() => {
    marketState.tickCount += 1;
    const env = typeof getEnvFn === "function" ? getEnvFn() : null;

    if (marketState.tickCount % 8 === 0) {
      const ev = NEWS_POOL[Math.floor(Math.random() * NEWS_POOL.length)];
      marketState.drifts[ev.target] = (marketState.drifts[ev.target] || 0) + ev.drift;
      marketState.lastNews = ev.text;
    }

    STOCK_DEFS.forEach((s) => {
      const cur = marketState.prices[s.id];
      marketState.prevPrices[s.id] = cur;
      const meanPull = (s.base - cur) / s.base * 0.032;
      let weatherBias = 0;
      if (env?.weather === "sunny" && s.id === "SANGO") weatherBias = 0.004;
      if ((env?.weather === "rain" || env?.weather === "rough") && (s.id === "MINATO" || s.id === "MAGURO")) weatherBias = -0.004;
      const noise = (Math.random() - 0.5) * 2 * s.vol;
      const drift = marketState.drifts[s.id] || 0;
      marketState.drifts[s.id] = drift * 0.62;

      const pct = Math.max(-0.14, Math.min(0.14, noise + meanPull + drift + weatherBias));
      const next = Math.max(Math.round(s.base * 0.25), Math.min(Math.round(s.base * 3.8), Math.round(cur * (1 + pct))));
      marketState.prices[s.id] = next;
      const hist = marketState.history[s.id];
      hist.push(next);
      if (hist.length > 42) hist.shift();
    });

    marketState.listeners.forEach((fn) => {
      try { fn(marketState); } catch (_) {}
    });
  }, 2500);
}

export function ensureSaveStocks(save) {
  if (!save.fishStocks || typeof save.fishStocks !== "object") {
    save.fishStocks = { holdings: {}, realizedProfit: 0 };
  }
  if (!save.fishStocks.holdings || typeof save.fishStocks.holdings !== "object") {
    save.fishStocks.holdings = {};
  }
  if (typeof save.fishStocks.realizedProfit !== "number") {
    save.fishStocks.realizedProfit = 0;
  }
  return save.fishStocks;
}

export function getStockPortfolioValue(save) {
  const st = ensureSaveStocks(save);
  let total = 0;
  for (const [id, h] of Object.entries(st.holdings)) {
    if (h?.qty > 0) total += (marketState.prices[id] || 0) * h.qty;
  }
  return total;
}

export function drawStockChart(canvas, stockId, avgCost = 0) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const hist = marketState.history[stockId] || [];
  if (hist.length < 2) return;

  ctx.fillStyle = "#0b1324";
  ctx.fillRect(0, 0, w, h);

  let minV = Math.min(...hist);
  let maxV = Math.max(...hist);
  if (avgCost > 0) {
    minV = Math.min(minV, avgCost);
    maxV = Math.max(maxV, avgCost);
  }
  const pad = Math.max(20, (maxV - minV) * 0.14);
  minV -= pad;
  maxV += pad;

  const toX = (i) => 12 + (i / (hist.length - 1)) * (w - 24);
  const toY = (v) => (h - 22) - ((v - minV) / (maxV - minV || 1)) * (h - 38);

  ctx.strokeStyle = "rgba(148,163,184,0.16)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const gy = 14 + (g / 3) * (h - 36);
    ctx.beginPath(); ctx.moveTo(10, gy); ctx.lineTo(w - 10, gy); ctx.stroke();
  }

  if (avgCost > 0) {
    const ay = toY(avgCost);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(10, ay); ctx.lineTo(w - 10, ay); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#facc15";
    ctx.font = "10px sans-serif";
    ctx.fillText(`取得 ¥${Math.round(avgCost).toLocaleString()}`, 14, Math.max(12, ay - 4));
  }

  const isUp = hist[hist.length - 1] >= hist[0];
  const lineCol = isUp ? "#38e59a" : "#fb7185";

  const grad = ctx.createLinearGradient(0, 12, 0, h - 18);
  grad.addColorStop(0, isUp ? "rgba(56,229,154,0.28)" : "rgba(251,113,133,0.28)");
  grad.addColorStop(1, "rgba(11,19,36,0.0)");
  ctx.beginPath();
  hist.forEach((v, i) => {
    const x = toX(i), y = toY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(toX(hist.length - 1), h - 18);
  ctx.lineTo(toX(0), h - 18);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  hist.forEach((v, i) => {
    const x = toX(i), y = toY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 2.4;
  ctx.stroke();

  const lx = toX(hist.length - 1), ly = toY(hist[hist.length - 1]);
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = lineCol; ctx.fill();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  ctx.fillText(`高 ¥${Math.round(maxV - pad).toLocaleString()}`, w - 84, 14);
  ctx.fillText(`安 ¥${Math.round(minV + pad).toLocaleString()}`, w - 84, h - 6);
}

export function openFishStockExchange({ save, openModal, closeModal, onCommit, playCash, playFail }) {
  ensureSaveStocks(save);
  let selectedId = STOCK_DEFS[0].id;
  let unsub = null;

  const render = () => {
    const st = ensureSaveStocks(save);
    const def = STOCK_DEFS.find((s) => s.id === selectedId) || STOCK_DEFS[0];
    const price = marketState.prices[def.id];
    const prev = marketState.prevPrices[def.id];
    const diff = price - prev;
    const diffPct = prev > 0 ? ((diff / prev) * 100).toFixed(1) : "0.0";
    const diffCol = diff >= 0 ? "#38e59a" : "#fb7185";
    const h = st.holdings[def.id] || { qty: 0, avgCost: 0 };
    const unrealized = h.qty > 0 ? Math.round((price - h.avgCost) * h.qty) : 0;
    const totalVal = getStockPortfolioValue(save);

    const tabsHtml = STOCK_DEFS.map((s) => {
      const p = marketState.prices[s.id];
      const d = p - marketState.prevPrices[s.id];
      const own = st.holdings[s.id]?.qty || 0;
      const active = s.id === selectedId;
      return `<button type="button" data-sttab="${s.id}" style="padding:6px 8px;border-radius:8px;border:1px solid ${active ? "#38bdf8" : "rgba(255,255,255,0.14)"};background:${active ? "rgba(56,189,248,0.22)" : "rgba(15,23,42,0.75)"};color:#f8fafc;font-size:11px;text-align:left;cursor:pointer;">
        <div style="font-weight:700;">${s.icon} ${s.name.slice(0, 6)}</div>
        <div style="display:flex;justify-content:space-between;gap:4px;font-size:10px;margin-top:2px;">
          <span>¥${p.toLocaleString()}</span>
          <span style="color:${d >= 0 ? "#38e59a" : "#fb7185"};">${d >= 0 ? "▲" : "▼"}</span>
        </div>
        ${own > 0 ? `<div style="font-size:9px;color:#facc15;">保有 ${own}株</div>` : ""}
      </button>`;
    }).join("");

    const wrap = document.getElementById("stock-modal-root");
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="background:rgba(14,165,233,0.14);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:6px 10px;font-size:11px;margin-bottom:8px;color:#e0f2fe;">
        ${marketState.lastNews}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px;background:rgba(15,23,42,0.6);padding:7px 10px;border-radius:8px;">
        <span>💰 所持金: <strong>¥${Math.floor(save.money || 0).toLocaleString()}</strong></span>
        <span>📊 保有株評価: <strong>¥${totalVal.toLocaleString()}</strong></span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;">${tabsHtml}</div>

      <div style="background:rgba(15,23,42,0.75);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div>
            <span style="font-size:15px;font-weight:800;">${def.icon} ${def.name}</span>
            <span class="muted" style="font-size:11px;margin-left:4px;">(${def.code})</span>
          </div>
          <div style="text-align:right;">
            <span style="font-size:18px;font-weight:900;color:#fff;">¥${price.toLocaleString()}</span>
            <span style="font-size:12px;font-weight:700;color:${diffCol};margin-left:4px;">${diff >= 0 ? "+" : ""}${diff} (${diffPct}%)</span>
          </div>
        </div>
        <div class="muted" style="font-size:11px;margin:3px 0 8px;">${def.desc}</div>
        <canvas id="stock-chart-cv" width="320" height="132" style="width:100%;height:132px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);display:block;"></canvas>

        <div style="display:flex;justify-content:space-between;font-size:12px;margin:8px 0;padding:6px 8px;background:rgba(255,255,255,0.05);border-radius:6px;">
          <span>保有: <strong>${h.qty}株</strong>${h.qty > 0 ? ` (平均¥${Math.round(h.avgCost).toLocaleString()})` : ""}</span>
          <span>含み損益: <strong style="color:${unrealized >= 0 ? "#38e59a" : "#fb7185"};">${unrealized >= 0 ? "+" : ""}¥${unrealized.toLocaleString()}</strong></span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px;">
          <button type="button" class="btn-primary" id="st-buy-1" style="padding:8px 4px;font-size:12px;">📈 1株買う</button>
          <button type="button" class="btn-primary" id="st-buy-10" style="padding:8px 4px;font-size:12px;">📈 10株買う</button>
          <button type="button" class="btn-primary" id="st-buy-max" style="padding:8px 4px;font-size:12px;">🔥 全力買い</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
          <button type="button" class="btn-sub" id="st-sell-1" style="padding:8px 4px;font-size:12px;">📉 1株売る</button>
          <button type="button" class="btn-sub" id="st-sell-10" style="padding:8px 4px;font-size:12px;">📉 10株売る</button>
          <button type="button" class="btn-sub" id="st-sell-all" style="padding:8px 4px;font-size:12px;">💴 全部売る</button>
        </div>
        <div id="st-msg" class="muted" style="font-size:11px;margin-top:6px;min-height:16px;text-align:center;">累計確定損益: ${st.realizedProfit >= 0 ? "+" : ""}¥${Math.round(st.realizedProfit).toLocaleString()}（2.5秒ごとに自動更新）</div>
      </div>
    `;

    drawStockChart(document.getElementById("stock-chart-cv"), def.id, h.qty > 0 ? h.avgCost : 0);

    wrap.querySelectorAll("[data-sttab]").forEach((btn) => {
      btn.onclick = () => { selectedId = btn.dataset.sttab; render(); };
    });

    const buyQty = (n) => {
      const curP = marketState.prices[def.id];
      const maxAfford = Math.floor((save.money || 0) / curP);
      const qty = n === "max" ? maxAfford : Math.min(n, maxAfford);
      if (qty <= 0) {
        playFail?.();
        const m = document.getElementById("st-msg");
        if (m) m.textContent = "⚠️ 所持金が足りません！";
        return;
      }
      const cost = curP * qty;
      save.money -= cost;
      const prevH = st.holdings[def.id] || { qty: 0, avgCost: 0 };
      const newQty = prevH.qty + qty;
      const newAvg = (prevH.qty * prevH.avgCost + cost) / newQty;
      st.holdings[def.id] = { qty: newQty, avgCost: newAvg };
      playCash?.();
      onCommit?.();
      render();
    };

    const sellQty = (n) => {
      const prevH = st.holdings[def.id] || { qty: 0, avgCost: 0 };
      const qty = n === "all" ? prevH.qty : Math.min(n, prevH.qty);
      if (qty <= 0) {
        playFail?.();
        const m = document.getElementById("st-msg");
        if (m) m.textContent = "⚠️ 保有株がありません！";
        return;
      }
      const curP = marketState.prices[def.id];
      const revenue = curP * qty;
      const profit = (curP - prevH.avgCost) * qty;
      save.money += revenue;
      st.realizedProfit += profit;
      prevH.qty -= qty;
      if (prevH.qty <= 0) delete st.holdings[def.id];
      else st.holdings[def.id] = prevH;
      playCash?.();
      onCommit?.();
      render();
    };

    document.getElementById("st-buy-1").onclick = () => buyQty(1);
    document.getElementById("st-buy-10").onclick = () => buyQty(10);
    document.getElementById("st-buy-max").onclick = () => buyQty("max");
    document.getElementById("st-sell-1").onclick = () => sellQty(1);
    document.getElementById("st-sell-10").onclick = () => sellQty(10);
    document.getElementById("st-sell-all").onclick = () => sellQty("all");
  };

  openModal("📈 港の水産株取引所", `<div id="stock-modal-root"></div>`);
  render();

  const onTick = () => {
    if (!document.getElementById("stock-modal-root")) {
      marketState.listeners.delete(onTick);
      return;
    }
    render();
  };
  marketState.listeners.add(onTick);
  unsub = () => marketState.listeners.delete(onTick);

  const closeBtn = document.getElementById("btn-close-modal");
  if (closeBtn) {
    const orig = closeBtn.onclick;
    closeBtn.onclick = () => {
      unsub?.();
      if (orig) orig();
      else closeModal?.();
    };
  }
}
