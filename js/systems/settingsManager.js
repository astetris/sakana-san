import { audioEngine, BGM_TRACKS } from "./audioEngine.js?v=20261128_152807";

const STORAGE_KEY = "sakana_settings_v1";

export const DEFAULT_SETTINGS = {
  // サウンド
  muted: false,
  masterVol: 70,
  bgmVol: 80,
  seVol: 90,
  ambientVol: 80,
  bgmTrack: "auto",
  // グラフィック・画面
  quality: "high",        // "low" | "medium" | "high"
  brightness: 100,        // 70〜135 (%)
  colorTone: "normal",    // "normal" | "vivid" | "warm" | "cool"
  fovOffset: 0,           // -10〜+15
  showClouds: true,
  showSeagulls: true,
  showSplashes: true,
  showFps: false,
  // UI・操作
  fontScale: 100,         // 90 | 100 | 112 | 124
  vibration: true,
  showTicker: true,
  showMinimap: true
};

let activeSettingsTab = "audio";
let fpsRafId = null;
let resizeHooked = false;
let lastSceneRef = null;

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    if (localStorage.getItem("sakana_muted") === "1") merged.muted = true;
    else if (raw && typeof saved.muted === "boolean") merged.muted = saved.muted;
    return merged;
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    localStorage.setItem("sakana_muted", s.muted ? "1" : "0");
  } catch (_) {}
}

function syncSoundIcons(muted) {
  const icon = muted ? "🔇" : "🔊";
  ["btn-sound-home", "btn-sound-play"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = icon;
  });
}

function ensureSettingsStyleTag() {
  let st = document.getElementById("sakana-dynamic-settings-style");
  if (!st) {
    st = document.createElement("style");
    st.id = "sakana-dynamic-settings-style";
    document.head.appendChild(st);
  }
  return st;
}

function updateFpsBadge(enabled) {
  let badge = document.getElementById("sakana-fps-badge");
  if (!enabled) {
    if (fpsRafId) { cancelAnimationFrame(fpsRafId); fpsRafId = null; }
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "sakana-fps-badge";
    badge.style.cssText =
      "position:fixed;left:8px;bottom:8px;z-index:9500;padding:3px 7px;border-radius:6px;" +
      "background:rgba(15,23,42,0.78);color:#38e59a;font-family:monospace;font-size:11px;" +
      "font-weight:700;pointer-events:none;border:1px solid rgba(56,229,154,0.35);";
    badge.textContent = "FPS --";
    document.body.appendChild(badge);
  }
  if (fpsRafId) return;
  let frames = 0;
  let lastT = performance.now();
  const loop = (now) => {
    frames++;
    if (now - lastT >= 500) {
      const fps = Math.round((frames * 1000) / (now - lastT));
      if (badge && badge.isConnected) {
        badge.textContent = `FPS ${fps}`;
        badge.style.color = fps >= 50 ? "#38e59a" : fps >= 30 ? "#fbbf24" : "#ff6b6b";
      }
      frames = 0;
      lastT = now;
    }
    fpsRafId = requestAnimationFrame(loop);
  };
  fpsRafId = requestAnimationFrame(loop);
}

export function applySettings(settings, scene3d = lastSceneRef) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || loadSettings()) };
  if (scene3d) lastSceneRef = scene3d;
  window.__sakanaSettings = s;

  // 1. サウンド＆BGMトラック＆振動
  audioEngine.setVolumes({
    master: s.masterVol / 100,
    bgm: s.bgmVol / 100,
    se: s.seVol / 100,
    ambient: s.ambientVol / 100
  });
  audioEngine.setBgmTrack(s.bgmTrack || "auto", false);
  audioEngine.setMuted(s.muted);
  audioEngine.setVibration(s.vibration);
  syncSoundIcons(s.muted);

  // 2. グラフィック・明るさ・色調・視野角・演出オブジェクト
  const toneFilter =
    s.colorTone === "vivid" ? "saturate(1.28) contrast(1.06)" :
    s.colorTone === "warm"  ? "sepia(0.18) saturate(1.12)" :
    s.colorTone === "cool"  ? "hue-rotate(-8deg) saturate(1.08) contrast(1.03)" :
    "";
  const canvasFilter = `brightness(${(s.brightness / 100).toFixed(2)}) ${toneFilter}`.trim();

  if (lastSceneRef) {
    try {
      const dpr = window.devicePixelRatio || 1;
      const targetPr =
        s.quality === "low" ? Math.min(dpr, 0.85) :
        s.quality === "medium" ? Math.min(dpr, 1.3) :
        Math.min(dpr, 2.0);
      if (lastSceneRef.renderer) {
        lastSceneRef.renderer.setPixelRatio(targetPr);
        const w = window.innerWidth || document.documentElement.clientWidth || 1;
        const h = window.innerHeight || document.documentElement.clientHeight || 1;
        lastSceneRef.renderer.setSize(w, h);
        if (lastSceneRef.renderer.domElement) {
          lastSceneRef.renderer.domElement.style.filter = canvasFilter;
        }
      }
      if (lastSceneRef.camera) {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        const aspect = w / h;
        const baseFov = aspect < 1 ? Math.min(75, 60 + (1 - aspect) * 26) : 58;
        lastSceneRef.camera.fov = Math.max(42, Math.min(92, baseFov + (Number(s.fovOffset) || 0)));
        lastSceneRef.camera.updateProjectionMatrix();
      }
      if (Array.isArray(lastSceneRef.clouds)) {
        lastSceneRef.clouds.forEach((c) => { if (c?.group) c.group.visible = !!s.showClouds; });
      }
      if (Array.isArray(lastSceneRef.seagulls)) {
        lastSceneRef.seagulls.forEach((g) => { if (g?.group) g.group.visible = !!s.showSeagulls; });
      }
      if (Array.isArray(lastSceneRef.splashParticles) && !s.showSplashes) {
        lastSceneRef.splashParticles.forEach((p) => {
          if (p?.mesh) p.mesh.visible = false;
          if (p) p.life = 0;
        });
      }
      if (typeof lastSceneRef.spawnSplashBurst === "function" && !lastSceneRef.__splashWrapped) {
        const origSpawn = lastSceneRef.spawnSplashBurst.bind(lastSceneRef);
        lastSceneRef.spawnSplashBurst = (...args) => {
          if (window.__sakanaSettings && window.__sakanaSettings.showSplashes === false) return;
          return origSpawn(...args);
        };
        lastSceneRef.__splashWrapped = true;
      }
    } catch (_) {}
  } else {
    const cvs = document.querySelector("canvas:not(#minimap-canvas)");
    if (cvs) cvs.style.filter = canvasFilter;
  }

  // 3. 文字サイズ・UI表示（動的CSS注入）
  const scale = Math.max(85, Math.min(130, Number(s.fontScale) || 100));
  const menuScale = Math.min(1.16, scale / 100).toFixed(2);
  const tickerCss = !s.showTicker ? "#live-ticker { display: none !important; }" : "";
  const minimapCss = !s.showMinimap ? ".minimap-wrap { display: none !important; }" : "";
  const st = ensureSettingsStyleTag();
  st.textContent = [
    `html { font-size: ${scale}%; }`,
    `.modal-body, .bank-box, .glass-card, .slot-card, .area-pill, #status-banner { font-size: calc(1rem * ${(scale / 100).toFixed(2)}); }`,
    `.menu-bar .btn-mini { font-size: calc(0.78rem * ${menuScale}); }`,
    tickerCss,
    minimapCss
  ].join("\n");

  updateFpsBadge(!!s.showFps);

  if (!resizeHooked) {
    resizeHooked = true;
    window.addEventListener("resize", () => {
      setTimeout(() => applySettings(loadSettings(), lastSceneRef), 80);
    });
  }
}

export function openSettingsModal({ openModal, scene3d }) {
  if (scene3d) lastSceneRef = scene3d;
  const s = loadSettings();

  const renderModal = () => {
    const tabsHtml = `
      <div class="shop-tabs">
        <button class="shop-tab ${activeSettingsTab === "audio" ? "active" : ""}" data-stab="audio">🔊 音量・BGM</button>
        <button class="shop-tab ${activeSettingsTab === "graphics" ? "active" : ""}" data-stab="graphics">🎨 画面・画質</button>
        <button class="shop-tab ${activeSettingsTab === "ui" ? "active" : ""}" data-stab="ui">🔤 文字・操作</button>
      </div>
    `;

    let body = "";
    if (activeSettingsTab === "audio") {
      const trackBtnsHtml = BGM_TRACKS.map((tr) => {
        const active = (s.bgmTrack || "auto") === tr.id;
        return `
          <button type="button" data-bgm-track="${tr.id}" style="
            width:100%;text-align:left;padding:8px 10px;border-radius:10px;cursor:pointer;
            border:${active ? "2px solid #38bdf8" : "1px solid rgba(148,163,184,0.28)"};
            background:${active ? "rgba(56,189,248,0.20)" : "rgba(15,23,42,0.55)"};
            color:#f8fafc;display:flex;justify-content:space-between;align-items:center;gap:8px;
          ">
            <div>
              <div style="font-size:13px;font-weight:800;">${tr.name}</div>
              <div style="font-size:11px;color:#94a3b8;">${tr.desc}</div>
            </div>
            <span style="font-size:12px;font-weight:800;color:${active ? "#38e59a" : "#64748b"};">
              ${active ? "▶ 再生中" : "選択"}
            </span>
          </button>
        `;
      }).join("");

      body = `
        <div class="bank-box">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <strong>🔇 ミュート（消音）</strong>
            <button type="button" id="set-toggle-mute" class="${s.muted ? "btn-danger" : "btn-primary"}" style="padding:6px 14px;">
              ${s.muted ? "🔇 消音中（タップで解除）" : "🔊 オン"}
            </button>
          </div>

          <div style="margin-bottom:11px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
              <span>🎚️ マスター音量</span><strong id="val-master">${s.masterVol}%</strong>
            </div>
            <input type="range" id="rng-master" min="0" max="100" step="1" value="${s.masterVol}" style="width:100%;" />
          </div>

          <div style="margin-bottom:11px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
              <span>🎵 BGM 音量</span><strong id="val-bgm">${s.bgmVol}%</strong>
            </div>
            <input type="range" id="rng-bgm" min="0" max="100" step="1" value="${s.bgmVol}" style="width:100%;" />
          </div>

          <div style="margin-bottom:11px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
              <span>✨ SE（効果音）音量</span><strong id="val-se">${s.seVol}%</strong>
            </div>
            <input type="range" id="rng-se" min="0" max="100" step="1" value="${s.seVol}" style="width:100%;" />
          </div>

          <div style="margin-bottom:11px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
              <span>🌊 環境音（波・雨・街の音）</span><strong id="val-amb">${s.ambientVol}%</strong>
            </div>
            <input type="range" id="rng-amb" min="0" max="100" step="1" value="${s.ambientVol}" style="width:100%;" />
          </div>

          <div class="btn-row">
            <button type="button" class="btn-sub" id="set-test-se">🔔 SEテスト</button>
            <button type="button" class="btn-sub" id="set-test-catch">🎉 ファンファーレ</button>
          </div>
        </div>

        <div class="bank-box" style="margin-top:8px;">
          <div style="font-size:13px;font-weight:800;margin-bottom:8px;">🎼 BGM 選曲（タップで即切替＆試聴）</div>
          <div style="display:grid;gap:6px;">
            ${trackBtnsHtml}
          </div>
        </div>
      `;
    } else if (activeSettingsTab === "graphics") {
      body = `
        <div class="bank-box">
          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:6px;">🖥️ グラフィック品質（解像度）</div>
            <div class="btn-row">
              <button type="button" class="${s.quality === "low" ? "btn-primary" : "btn-sub"}" data-qual="low">低（軽量）</button>
              <button type="button" class="${s.quality === "medium" ? "btn-primary" : "btn-sub"}" data-qual="medium">標準</button>
              <button type="button" class="${s.quality === "high" ? "btn-primary" : "btn-sub"}" data-qual="high">高精細</button>
            </div>
          </div>

          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
              <span>☀️ 画面の明るさ</span><strong id="val-bright">${s.brightness}%</strong>
            </div>
            <input type="range" id="rng-bright" min="70" max="135" step="1" value="${s.brightness}" style="width:100%;" />
          </div>

          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:6px;">🎞️ 色調フィルター</div>
            <div class="btn-row">
              <button type="button" class="${s.colorTone === "normal" ? "btn-primary" : "btn-sub"}" data-tone="normal">標準</button>
              <button type="button" class="${s.colorTone === "vivid" ? "btn-primary" : "btn-sub"}" data-tone="vivid">鮮やか</button>
              <button type="button" class="${s.colorTone === "warm" ? "btn-primary" : "btn-sub"}" data-tone="warm">暖色</button>
              <button type="button" class="${s.colorTone === "cool" ? "btn-primary" : "btn-sub"}" data-tone="cool">クール</button>
            </div>
          </div>

          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
              <span>📷 カメラ視野角（FOV補正）</span><strong id="val-fov">${s.fovOffset >= 0 ? "+" : ""}${s.fovOffset}°</strong>
            </div>
            <input type="range" id="rng-fov" min="-10" max="15" step="1" value="${s.fovOffset}" style="width:100%;" />
          </div>

          <div style="display:grid;gap:8px;margin-top:8px;">
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span>☁️ 雲を表示</span>
              <input type="checkbox" id="chk-clouds" ${s.showClouds ? "checked" : ""} style="width:20px;height:20px;" />
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span>🕊️ カモメを表示</span>
              <input type="checkbox" id="chk-gulls" ${s.showSeagulls ? "checked" : ""} style="width:20px;height:20px;" />
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span>💦 水しぶきエフェクト</span>
              <input type="checkbox" id="chk-splash" ${s.showSplashes ? "checked" : ""} style="width:20px;height:20px;" />
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span>📊 FPSカウンター表示</span>
              <input type="checkbox" id="chk-fps" ${s.showFps ? "checked" : ""} style="width:20px;height:20px;" />
            </label>
          </div>
        </div>
      `;
    } else {
      body = `
        <div class="bank-box">
          <div style="margin-bottom:14px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:6px;">🔤 文字サイズ（UI全体）</div>
            <div class="btn-row">
              <button type="button" class="${s.fontScale === 90 ? "btn-primary" : "btn-sub"}" data-fscale="90">小</button>
              <button type="button" class="${s.fontScale === 100 ? "btn-primary" : "btn-sub"}" data-fscale="100">標準</button>
              <button type="button" class="${s.fontScale === 112 ? "btn-primary" : "btn-sub"}" data-fscale="112">大</button>
              <button type="button" class="${s.fontScale === 124 ? "btn-primary" : "btn-sub"}" data-fscale="124">特大</button>
            </div>
          </div>

          <div style="display:grid;gap:10px;">
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span>📳 バイブレーション（ヒット・釣果時振動）</span>
              <input type="checkbox" id="chk-vib" ${s.vibration ? "checked" : ""} style="width:20px;height:20px;" />
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span>📣 港のライブ速報バーを表示</span>
              <input type="checkbox" id="chk-ticker" ${s.showTicker ? "checked" : ""} style="width:20px;height:20px;" />
            </label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span>🗺️ ミニマップを表示</span>
              <input type="checkbox" id="chk-minimap" ${s.showMinimap ? "checked" : ""} style="width:20px;height:20px;" />
            </label>
          </div>
        </div>
      `;
    }

    const footer = `
      <div class="bank-box" style="margin-top:8px;">
        <div class="btn-row">
          <button type="button" class="btn-danger" id="set-reset-all">↺ 初期設定に戻す</button>
        </div>
        <div class="muted" style="font-size:11px;margin-top:6px;">※設定はこの端末に自動保存されます</div>
      </div>
    `;

    openModal("⚙️ 設定", `${tabsHtml}${body}${footer}`);

    const commit = () => {
      saveSettings(s);
      applySettings(s, lastSceneRef);
    };

    document.querySelectorAll("[data-stab]").forEach((btn) => {
      btn.onclick = () => {
        activeSettingsTab = btn.dataset.stab;
        renderModal();
      };
    });

    if (activeSettingsTab === "audio") {
      const muteBtn = document.getElementById("set-toggle-mute");
      if (muteBtn) muteBtn.onclick = () => { s.muted = !s.muted; commit(); renderModal(); };

      const bindRange = (id, valId, key) => {
        const el = document.getElementById(id);
        const vel = document.getElementById(valId);
        if (!el) return;
        el.oninput = () => {
          s[key] = Number(el.value);
          if (vel) vel.textContent = `${s[key]}%`;
          if (s.muted && s[key] > 0 && key === "masterVol") s.muted = false;
          commit();
        };
      };
      bindRange("rng-master", "val-master", "masterVol");
      bindRange("rng-bgm", "val-bgm", "bgmVol");
      bindRange("rng-se", "val-se", "seVol");
      bindRange("rng-amb", "val-amb", "ambientVol");

      const tSe = document.getElementById("set-test-se");
      if (tSe) tSe.onclick = () => { audioEngine.unlock(); audioEngine.playOk(); };
      const tCatch = document.getElementById("set-test-catch");
      if (tCatch) tCatch.onclick = () => { audioEngine.unlock(); audioEngine.playCatch("A"); };

      document.querySelectorAll("[data-bgm-track]").forEach((btn) => {
        btn.onclick = () => {
          s.bgmTrack = btn.dataset.bgmTrack;
          if (s.muted) s.muted = false;
          saveSettings(s);
          applySettings(s, lastSceneRef);
          audioEngine.unlock();
          audioEngine.setBgmTrack(s.bgmTrack, true);
          renderModal();
        };
      });
    } else if (activeSettingsTab === "graphics") {
      document.querySelectorAll("[data-qual]").forEach((b) => {
        b.onclick = () => { s.quality = b.dataset.qual; commit(); renderModal(); };
      });
      document.querySelectorAll("[data-tone]").forEach((b) => {
        b.onclick = () => { s.colorTone = b.dataset.tone; commit(); renderModal(); };
      });
      const rngB = document.getElementById("rng-bright");
      const valB = document.getElementById("val-bright");
      if (rngB) rngB.oninput = () => {
        s.brightness = Number(rngB.value);
        if (valB) valB.textContent = `${s.brightness}%`;
        commit();
      };
      const rngF = document.getElementById("rng-fov");
      const valF = document.getElementById("val-fov");
      if (rngF) rngF.oninput = () => {
        s.fovOffset = Number(rngF.value);
        if (valF) valF.textContent = `${s.fovOffset >= 0 ? "+" : ""}${s.fovOffset}°`;
        commit();
      };
      const bindChk = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.onchange = () => { s[key] = el.checked; commit(); };
      };
      bindChk("chk-clouds", "showClouds");
      bindChk("chk-gulls", "showSeagulls");
      bindChk("chk-splash", "showSplashes");
      bindChk("chk-fps", "showFps");
    } else {
      document.querySelectorAll("[data-fscale]").forEach((b) => {
        b.onclick = () => { s.fontScale = Number(b.dataset.fscale); commit(); renderModal(); };
      });
      const bindChk = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.onchange = () => {
          s[key] = el.checked;
          commit();
          if (key === "vibration" && s.vibration) audioEngine.vibrate(40);
        };
      };
      bindChk("chk-vib", "vibration");
      bindChk("chk-ticker", "showTicker");
      bindChk("chk-minimap", "showMinimap");
    }

    const resetBtn = document.getElementById("set-reset-all");
    if (resetBtn) resetBtn.onclick = () => {
      Object.assign(s, DEFAULT_SETTINGS);
      commit();
      audioEngine.setBgmTrack(s.bgmTrack, true);
      audioEngine.playOk();
      renderModal();
    };
  };

  renderModal();
}
