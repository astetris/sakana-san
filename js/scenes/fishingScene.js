import * as THREE from "three";
import { clampWorldPosition } from "../systems/worldMap.js?v=20261128_042032";

// ===== リアル海面シェーダー（多層うねり・フレネル反射・白波・浅瀬グラデ・夜景反射） =====
const OCEAN_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uWaveAmp;
  varying vec3 vWorldPos;
  varying float vWaveHeight;
  varying float vShoreMask;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // 岸・桟橋に食い込みすぎないよう陸側(z > -6)は波を抑える
    float shoreFade = smoothstep(4.0, -14.0, wp.z);
    float amp = uWaveAmp * (0.22 + 0.78 * shoreFade);

    float w1 = sin(wp.x * 0.11 + wp.z * 0.08 + uTime * 1.35) * 0.22;
    float w2 = cos(wp.x * 0.07 - wp.z * 0.16 + uTime * 1.05) * 0.18;
    float w3 = sin(wp.x * 0.34 + wp.z * 0.29 - uTime * 2.15) * 0.075;
    float w4 = cos(wp.x * 0.58 - wp.z * 0.47 + uTime * 2.85) * 0.035;
    float h = (w1 + w2 + w3 + w4) * amp;

    wp.y += h;
    vWorldPos = wp.xyz;
    vWaveHeight = h;
    vShoreMask = 1.0 - smoothstep(-2.0, -18.0, wp.z);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const OCEAN_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uWaveAmp;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyZenith;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uNightFactor;

  varying vec3 vWorldPos;
  varying float vWaveHeight;
  varying float vShoreMask;

  void main() {
    // 細かいさざ波の解析法線（キラキラ感の要）
    float t = uTime;
    vec2 p = vWorldPos.xz;
    float nx =
      cos(p.x * 0.11 + p.y * 0.08 + t * 1.35) * 0.09 +
      cos(p.x * 0.34 + p.y * 0.29 - t * 2.15) * 0.11 +
      sin(p.x * 0.92 - p.y * 0.78 + t * 3.1) * 0.06 +
      cos(p.x * 1.75 + p.y * 1.45 - t * 4.2) * 0.035;
    float nz =
      -sin(p.x * 0.07 - p.y * 0.16 + t * 1.05) * 0.09 +
      cos(p.x * 0.34 + p.y * 0.29 - t * 2.15) * 0.09 -
      cos(p.x * 0.88 - p.y * 0.82 + t * 2.9) * 0.06 +
      sin(p.x * 1.62 - p.y * 1.58 + t * 3.9) * 0.035;

    vec3 N = normalize(vec3(-nx * (0.75 + 0.35 * uWaveAmp), 1.0, -nz * (0.75 + 0.35 * uWaveAmp)));
    vec3 V = normalize(cameraPosition - vWorldPos);
    float NoV = max(dot(N, V), 0.001);
    float fresnel = pow(1.0 - NoV, 3.6);

    // 浅瀬（岸辺・砂浜・南国サンゴ礁）は透明エメラルド〜沖は深い藍
    float beachShallow = smoothstep(-58.0, -4.0, vWorldPos.z) * (0.45 + 0.55 * smoothstep(40.0, -100.0, vWorldPos.x));
    float tropical = smoothstep(-195.0, -255.0, vWorldPos.z) * smoothstep(45.0, 115.0, vWorldPos.x);
    float shallowFactor = clamp(beachShallow * 0.72 + tropical * 0.85, 0.0, 1.0);
    vec3 waterBody = mix(uDeepColor, uShallowColor, shallowFactor);

    // 太陽光の水中透過（波頭がほんのり透けて光る）
    float sss = pow(max(dot(V, -uSunDir + N * 0.45), 0.0001), 3.0) * max(vWaveHeight * 1.4 + 0.25, 0.0);
    waterBody += uShallowColor * uSunColor * sss * (0.35 * (1.0 - uNightFactor * 0.7));

    // 空の鏡面反射
    vec3 R = reflect(-V, N);
    float skyGrad = clamp(R.y * 1.6 + 0.15, 0.0, 1.0);
    vec3 skyReflect = mix(uSkyHorizon, uSkyZenith, skyGrad);
    vec3 col = mix(waterBody, skyReflect, clamp(fresnel * 0.88 + 0.08, 0.0, 0.92));

    // 太陽・月の光の道（二重スペキュラ：鋭い煌めき＋広い光帯）
    vec3 H = normalize(uSunDir + V);
    float NoH = max(dot(N, H), 0.0001);
    float specSharp = pow(NoH, 240.0) * 1.9;
    float specSoft = pow(NoH, 26.0) * 0.28;
    col += uSunColor * (specSharp + specSoft);

    // 夜の港の街灯が水面に揺らめき映り込む表現
    if (uNightFactor > 0.05) {
      float portProx = exp(-length((vWorldPos.xz - vec2(0.0, -6.0)) * vec2(0.024, 0.035)));
      float shimmer = pow(max(0.0, sin(p.x * 1.4 + t * 2.2) * cos(p.y * 1.9 - t * 2.8) * 0.5 + 0.5), 3.0);
      col += vec3(1.0, 0.68, 0.30) * portProx * (0.28 + 0.65 * shimmer) * uNightFactor;

      float lhProx = exp(-length((vWorldPos.xz - vec2(28.0, 0.0)) * 0.045));
      col += vec3(1.0, 0.92, 0.65) * lhProx * 0.32 * uNightFactor;
    }

    // 岸辺の打ち寄せ白波＋波頭の泡（フォーム）
    float shoreWave = sin(vWorldPos.z * 1.35 + t * 2.6 + sin(vWorldPos.x * 0.25) * 1.8) * 0.5 + 0.5;
    float shoreFoam = smoothstep(0.55, 0.96, shoreWave * vShoreMask + vShoreMask * 0.42);
    float crestFoam = smoothstep(0.24, 0.48, vWaveHeight + (uWaveAmp - 1.0) * 0.15) * 0.55;
    float foam = clamp(shoreFoam * 0.72 + crestFoam, 0.0, 0.88);
    vec3 foamColor = mix(vec3(0.92, 0.97, 1.0), uSkyHorizon * 1.05, 0.25);
    col = mix(col, foamColor, foam);

    // 指数フォグで水平線を空へ溶け込ませる
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ===== リアル空ドームシェーダー =====
const SKY_VERTEX_SHADER = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = `
  uniform vec3 uTopColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uGlowStrength;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.55));

    // 地平線付近のほんのりした大気霞
    float band = exp(-abs(d.y) * 9.0) * 0.16;
    col += uHorizonColor * band;

    // 太陽・月まわりの光輪グロー
    float sunDot = max(dot(d, normalize(uSunDir)), 0.0);
    float sunGlow = pow(sunDot, 12.0) * 0.35 * uGlowStrength + pow(sunDot, 180.0) * 0.95;
    col += uSunColor * sunGlow;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ===== プロシージャル高精細テクスチャ生成ユーティリティ =====
function makeCanvasTex(w, h, drawFn, repeatX = 1, repeatY = 1) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  drawFn(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if ("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createConcreteTexture(rx = 8, ry = 5) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#6c7682";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const v = 92 + Math.floor(Math.random() * 44);
      ctx.fillStyle = `rgba(${v},${v + 4},${v + 10},0.34)`;
      ctx.fillRect(x, y, 2, 2);
    }
    // コンクリート舗装の目地
    ctx.strokeStyle = "rgba(30, 41, 59, 0.42)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // 潮風のしみ
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = "rgba(40, 52, 65, 0.14)";
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 24, 0, Math.PI * 2);
      ctx.fill();
    }
  }, rx, ry);
}

function createWoodPlankTexture(rx = 2, ry = 4) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#7c5838";
    ctx.fillRect(0, 0, w, h);
    const planks = 8;
    const ph = h / planks;
    for (let i = 0; i < planks; i++) {
      const y = i * ph;
      const shade = (i % 3) * 8 - 8;
      ctx.fillStyle = `rgb(${124 + shade}, ${88 + shade}, ${56 + shade})`;
      ctx.fillRect(0, y, w, ph - 2);
      // 木目ライン
      ctx.strokeStyle = "rgba(58, 36, 18, 0.28)";
      ctx.lineWidth = 1;
      for (let g = 0; g < 6; g++) {
        ctx.beginPath();
        const gy = y + 4 + (g / 6) * (ph - 6);
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + Math.sin(i + g) * 3, w * 0.7, gy - Math.cos(i + g) * 3, w, gy);
        ctx.stroke();
      }
      // 継ぎ目＆釘頭
      ctx.fillStyle = "rgba(25, 16, 8, 0.65)";
      ctx.fillRect(0, y + ph - 2, w, 2);
      ctx.fillStyle = "rgba(35, 38, 44, 0.7)";
      ctx.fillRect(10, y + 6, 4, 4);
      ctx.fillRect(w - 14, y + 6, 4, 4);
      ctx.fillRect(10, y + ph - 10, 4, 4);
      ctx.fillRect(w - 14, y + ph - 10, 4, 4);
    }
  }, rx, ry);
}

function createSandTexture(rx = 10, ry = 6) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#b89f6d");
    grad.addColorStop(0.28, "#dec792");
    grad.addColorStop(1, "#e8d5a4");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4500; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,248,220,0.38)" : "rgba(138,112,68,0.26)";
      ctx.fillRect(x, y, 2, 2);
    }
  }, rx, ry);
}

function createRockTexture(rx = 5, ry = 3) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#48443f";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const v = 45 + Math.floor(Math.random() * 55);
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.4)`;
      ctx.fillRect(x, y, 3, 2);
    }
    // 磯の苔アクセント
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = "rgba(62, 92, 52, 0.25)";
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }, rx, ry);
}

function createGrassTexture(rx = 6, ry = 5) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#3f6522";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(92,140,48,0.38)" : "rgba(38,68,20,0.35)";
      ctx.fillRect(x, y, 2, 4);
    }
  }, rx, ry);
}

function createSignTexture(title, sub, bg = "#162438", fg = "#f8fafc", accent = "#f59e0b") {
  return makeCanvasTex(512, 160, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = fg;
    ctx.font = "bold 54px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, w / 2, sub ? 66 : h / 2);
    if (sub) {
      ctx.fillStyle = accent;
      ctx.font = "bold 26px sans-serif";
      ctx.fillText(sub, w / 2, 122);
    }
  }, 1, 1);
}

function createNameSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(10, 22, 36, 0.84)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.88)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 10, 240, 52, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 14), 128, 36);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.6, 1.3, 1);
  sprite.position.set(0, 3.6, 0);
  return sprite;
}

// リアル漁船モデル生成ヘルパー
function buildRealisticBoatModel(accentColor = 0x1d4ed8, hasCabin = true) {
  const g = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.42, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.38, metalness: 0.15 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.78 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.12, metalness: 0.65, transparent: true, opacity: 0.75 });

  // 船体（下部＋カラーライン＋デッキ）
  const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.75, 5.4), whiteMat);
  lowerHull.position.set(0, 0.22, 1.4);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.22, 5.46), accentMat);
  stripe.position.set(0, 0.48, 1.4);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.12, 5.0), deckMat);
  deck.position.set(0, 0.62, 1.4);

  // 船首（シャープなバウ）
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.8, 4), whiteMat);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1.22, 1.0, 0.58);
  bow.position.set(0, 0.38, -2.55);

  const bowAccent = new THREE.Mesh(new THREE.ConeGeometry(1.12, 2.0, 4), accentMat);
  bowAccent.rotation.x = -Math.PI / 2;
  bowAccent.rotation.y = Math.PI / 4;
  bowAccent.scale.set(1.18, 1.0, 0.32);
  bowAccent.position.set(0, 0.58, -2.3);

  // 舷側（ふちの壁）
  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 5.2), whiteMat);
  railL.position.set(-1.3, 0.8, 1.4);
  const railR = railL.clone();
  railR.position.x = 1.3;
  const stern = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.44, 0.18), whiteMat);
  stern.position.set(0, 0.8, 4.05);

  // 船外機（エンジン）
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.56, 1.05, 0.62), darkMat);
  motor.position.set(0, 0.68, 4.35);

  g.add(lowerHull, stripe, deck, bow, bowAccent, railL, railR, stern, motor);

  if (hasCabin) {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.68, 1.28, 1.85), whiteMat);
    cabin.position.set(0, 1.28, 0.55);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.14, 2.15), accentMat);
    roof.position.set(0, 1.98, 0.55);
    const winFront = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.55, 0.08), glassMat);
    winFront.position.set(0, 1.44, -0.37);
    const winSideL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 1.1), glassMat);
    winSideL.position.set(-0.84, 1.44, 0.55);
    const winSideR = winSideL.clone();
    winSideR.position.x = 0.84;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 6), darkMat);
    mast.position.set(0, 2.55, 0.55);
    const navLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    navLamp.position.set(0, 3.16, 0.55);
    g.add(cabin, roof, winFront, winSideL, winSideR, mast, navLamp);
  }
  return g;
}

// 4脚テトラポッド生成ヘルパー
function createTetrapod(mat, scale = 1.0) {
  const g = new THREE.Group();
  const legGeo = new THREE.CylinderGeometry(0.32 * scale, 0.52 * scale, 1.65 * scale, 8);
  const dirs = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0.94, -0.33, 0),
    new THREE.Vector3(-0.47, -0.33, 0.81),
    new THREE.Vector3(-0.47, -0.33, -0.81)
  ];
  const up = new THREE.Vector3(0, 1, 0);
  dirs.forEach((d) => {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.quaternion.setFromUnitVectors(up, d.clone().normalize());
    leg.position.copy(d.clone().normalize().multiplyScalar(0.68 * scale));
    g.add(leg);
  });
  return g;
}

export class FishingScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if ("toneMapping" in this.renderer && THREE.ACESFilmicToneMapping) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 650);

    // ライティング（半球光＋太陽光＋環境光で立体感を底上げ）
    this.hemi = new THREE.HemisphereLight(0x9bd6ff, 0x1b3a4b, 0.72);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff4d6, 1.45);
    this.sun.position.set(55, 78, -95);
    this.scene.add(this.sun);

    // リアル空ドーム・太陽/月・満天の星・雲・カモメ
    this.buildSkyAndAtmosphere();

    // リアル海面（GLSLカスタムシェーダー）
    const seaGeo = new THREE.PlaneGeometry(460, 460, 92, 92);
    seaGeo.rotateX(-Math.PI / 2);
    this.waterUniforms = {
      uTime: { value: 0 },
      uWaveAmp: { value: 1.0 },
      uDeepColor: { value: new THREE.Color(0x063459) },
      uShallowColor: { value: new THREE.Color(0x148c9e) },
      uSkyHorizon: { value: new THREE.Color(0x88c9f2) },
      uSkyZenith: { value: new THREE.Color(0x1f6fb8) },
      uSunColor: { value: new THREE.Color(0xfff1cc) },
      uSunDir: { value: new THREE.Vector3(0.32, 0.48, -0.82).normalize() },
      uFogColor: { value: new THREE.Color(0x7cc4ed) },
      uFogDensity: { value: 0.0042 },
      uNightFactor: { value: 0.0 }
    };
    this.seaMat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERTEX_SHADER,
      fragmentShader: OCEAN_FRAGMENT_SHADER,
      uniforms: this.waterUniforms
    });
    this.sea = new THREE.Mesh(seaGeo, this.seaMat);
    this.scene.add(this.sea);

    this.nightLights = [];
    this.nightEmissives = [];
    this.dockedBoats = [];
    this.buoyLamps = [];
    this.lighthouseBeam = null;

    this.buildWorldTerrain();

    // プレイヤーリグ（カメラ・自船・竿・ウキ・釣り糸）
    this.playerRig = new THREE.Group();
    this.scene.add(this.playerRig);
    this.camera.position.set(0, 3.05, 6.2);
    this.camera.lookAt(0, 0.9, -12);
    this.playerRig.add(this.camera);

    // リアル自船（一人称視界を遮らないオープンデッキ＋船首）
    this.boatGroup = buildRealisticBoatModel(0xc2410c, false);
    this.boatGroup.visible = false;
    this.playerRig.add(this.boatGroup);

    // 航跡波（船尾の白い泡）
    this.wakeParticles = [];
    const wakeGeo = new THREE.CircleGeometry(0.45, 10);
    wakeGeo.rotateX(-Math.PI / 2);
    const wakeMat = new THREE.MeshBasicMaterial({ color: 0xe6f7ff, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const wm = new THREE.Mesh(wakeGeo, wakeMat.clone());
      wm.visible = false;
      this.scene.add(wm);
      this.wakeParticles.push({ mesh: wm, life: 0, maxLife: 1.1 });
    }
    this.wakeSpawnAcc = 0;

    // 桟橋横に係留される自分の船
    this.parkedBoat = buildRealisticBoatModel(0xc2410c, true);
    this.parkedBoat.visible = true;
    this.parkedBoat.position.set(6.4, 0.08, -10.2);
    this.parkedBoat.rotation.y = Math.PI * 0.04;
    this.scene.add(this.parkedBoat);

    // 手元ライト（夜間用）
    this.portLight = new THREE.PointLight(0xffb85c, 0, 32);
    this.portLight.position.set(0, 5.2, 2.0);
    this.playerRig.add(this.portLight);

    // リアル釣り竿（コルクグリップ・リール・ガイド・赤い穂先）
    this.rodGroup = new THREE.Group();
    this.rodGroup.position.set(0.84, 1.68, 3.6);
    const rodShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.036, 3.7, 10),
      new THREE.MeshStandardMaterial({ color: 0x161e2a, metalness: 0.65, roughness: 0.25 })
    );
    rodShaft.rotation.x = -Math.PI / 2.6;
    rodShaft.position.set(0, 0.42, -1.45);
    const rodTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.015, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5a36, emissive: 0x330800, roughness: 0.3 })
    );
    rodTip.rotation.x = -Math.PI / 2.6;
    rodTip.position.set(0, 1.12, -3.12);
    const corkGrip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.052, 0.62, 10),
      new THREE.MeshStandardMaterial({ color: 0xc2935b, roughness: 0.85 })
    );
    corkGrip.rotation.x = -Math.PI / 2.6;
    corkGrip.position.set(0, -0.18, -0.02);
    const reelBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.14, 12),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.78, roughness: 0.22 })
    );
    reelBody.rotation.z = Math.PI / 2;
    reelBody.position.set(0, -0.1, -0.34);
    this.rodTipLocal = new THREE.Vector3(0, 1.24, -3.38);
    this.rodGroup.add(rodShaft, rodTip, corkGrip, reelBody);
    this.playerRig.add(this.rodGroup);

    // 紅白玉ウキ＋波紋リング
    this.bobber = new THREE.Group();
    const bobTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0x550800, roughness: 0.25 })
    );
    const bobBot = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
    );
    const bobPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    bobPin.position.y = 0.16;
    this.bobberRipple = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.36, 20),
      new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    this.bobberRipple.rotation.x = -Math.PI / 2;
    this.bobberRipple.position.y = -0.03;
    this.bobber.add(bobTop, bobBot, bobPin, this.bobberRipple);
    this.bobber.visible = false;
    this.playerRig.add(this.bobber);

    // 竿先〜ウキの釣り糸
    const linePos = new Float32Array(12 * 3);
    this.fishingLineGeo = new THREE.BufferGeometry();
    this.fishingLineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    this.fishingLine = new THREE.Line(
      this.fishingLineGeo,
      new THREE.LineBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.72 })
    );
    this.fishingLine.visible = false;
    this.playerRig.add(this.fishingLine);

    // 雨パーティクル
    const rainCount = 340;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 40;
      rainPositions[i * 3 + 1] = Math.random() * 18;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 36 - 8;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    this.rain = new THREE.Points(
      rainGeo,
      new THREE.PointsMaterial({ color: 0xdbeafe, size: 0.11, transparent: true, opacity: 0.65 })
    );
    this.rain.visible = false;
    this.playerRig.add(this.rain);

    this.hotspots = [];
    this.hotspotGroup = new THREE.Group();
    this.scene.add(this.hotspotGroup);
    this.spawnWorldHotspots();

    // 他プレイヤー管理
    this.remoteGroup = new THREE.Group();
    this.scene.add(this.remoteGroup);
    this.remoteAvatars = new Map();

    this.clock = new THREE.Clock();
    this.rodBend = 0; this.bobberDip = 0; this.bobberDist = 18; this.waveAmp = 1.0;
    this.pos = new THREE.Vector2(0, 4); this.yaw = 0;
    this.isBoating = false; this.boatSpeed = 1.2; this.boatTier = 0;
    this.moveInput = { x: 0, y: 0 }; this.autopilot = false;
    this.onFuelConsume = null; this.onBlocked = null; this.lastBlockAt = 0;

    let dragX = null;
    canvas.addEventListener("pointerdown", (e) => { dragX = e.clientX; });
    window.addEventListener("pointermove", (e) => {
      if (dragX === null) return;
      const dx = e.clientX - dragX; dragX = e.clientX;
      this.yaw -= dx * 0.006;
    });
    window.addEventListener("pointerup", () => { dragX = null; });
    const _syncSize = () => { this.resize(); setTimeout(() => this.resize(), 180); setTimeout(() => this.resize(), 420); };
    window.addEventListener("resize", _syncSize);
    window.addEventListener("orientationchange", _syncSize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", () => this.resize());
    this.resize();
    this.animate();
  }

  buildSkyAndAtmosphere() {
    this.skyUniforms = {
      uTopColor: { value: new THREE.Color(0x1c64b0) },
      uHorizonColor: { value: new THREE.Color(0x8fd0f5) },
      uSunColor: { value: new THREE.Color(0xfff3cc) },
      uSunDir: { value: new THREE.Vector3(0.32, 0.48, -0.82).normalize() },
      uGlowStrength: { value: 1.0 }
    };
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(420, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false
      })
    );
    this.scene.add(this.skyDome);

    // 太陽 / 月ディスク
    this.celestialDisc = new THREE.Mesh(
      new THREE.SphereGeometry(9.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false })
    );
    this.scene.add(this.celestialDisc);

    // 夜の満天の星
    const starCount = 320;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.12 + Math.random() * 0.88);
      const r = 360;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xe2f1ff, size: 2.1, transparent: true, opacity: 0.0, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.stars);

    // 漂う立体雲
    this.clouds = [];
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, fog: true });
    for (let i = 0; i < 16; i++) {
      const cg = new THREE.Group();
      const puffs = 3 + (i % 3);
      for (let k = 0; k < puffs; k++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 5, 10, 8), this.cloudMat);
        puff.scale.set(1.5, 0.55, 1.0);
        puff.position.set((k - puffs / 2) * 7.5, (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 4);
        cg.add(puff);
      }
      cg.position.set((Math.random() - 0.5) * 420, 62 + Math.random() * 34, -260 + Math.random() * 320);
      this.scene.add(cg);
      this.clouds.push({ group: cg, speed: 1.4 + Math.random() * 1.6 });
    }

    // 港の上空を舞うカモメ
    this.seagulls = [];
    const gullMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6, side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.95, 0.28);
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const leftW = new THREE.Mesh(wingGeo, gullMat);
      leftW.position.x = -0.45;
      const rightW = new THREE.Mesh(wingGeo, gullMat);
      rightW.position.x = 0.45;
      g.add(leftW, rightW);
      this.scene.add(g);
      this.seagulls.push({
        group: g, leftW, rightW,
        cx: -25 + i * 14, cz: -18 - (i % 3) * 16,
        radius: 16 + (i % 4) * 7,
        height: 15 + (i % 3) * 4.5,
        angle: i * 1.1,
        speed: 0.34 + (i % 3) * 0.08
      });
    }
  }

  buildWorldTerrain() {
    const world = new THREE.Group();
    const concreteTex = createConcreteTexture(10, 6);
    const woodTex = createWoodPlankTexture(2, 5);
    const sandTex = createSandTexture(12, 6);
    const rockTex = createRockTexture(6, 4);
    const grassTex = createGrassTexture(8, 6);

    const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.88, metalness: 0.05 });
    const darkConcreteMat = new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.94 });
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.82 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.42, metalness: 0.65 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });

    // ===== 1. 港・堤防（護岸＋白線＋車止め＋防舷材＋係留ボラード） =====
    const portDeck = new THREE.Mesh(new THREE.BoxGeometry(74, 1.5, 44), concreteMat);
    portDeck.position.set(0, 0.25, 22);
    // 海面際の湿った護岸コンクリート帯
    const seaWallBase = new THREE.Mesh(new THREE.BoxGeometry(74.4, 0.65, 44.4), darkConcreteMat);
    seaWallBase.position.set(0, -0.15, 22);
    // 堤防先端の黄色安全ライン＆車止めブロック
    const warnLine = new THREE.Mesh(
      new THREE.BoxGeometry(74, 0.05, 0.38),
      new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.7 })
    );
    warnLine.position.set(0, 1.01, 0.55);
    world.add(portDeck, seaWallBase, warnLine);

    for (let x = -33; x <= 33; x += 6) {
      if (Math.abs(x) < 6) continue;
      // 車止めブロック
      const curb = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.24, 0.42), darkConcreteMat);
      curb.position.set(x, 1.12, 0.28);
      // 係留ボラード（ビット）
      const bollardBase = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.55, 10), metalMat);
      bollardBase.position.set(x + 2.2, 1.25, 0.75);
      const bollardTop = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.14, 10), metalMat);
      bollardTop.position.set(x + 2.2, 1.54, 0.75);
      // 護岸のゴム防舷材
      const fender = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 0.28), rubberMat);
      fender.position.set(x, 0.32, -0.14);
      world.add(curb, bollardBase, bollardTop, fender);
    }

    // ===== 2. 木製桟橋（板張り＋木杭＋両脇の支柱とロープ） =====
    const pier = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.45, 16.5), woodMat);
    pier.position.set(0, 0.78, -7.2);
    world.add(pier);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x4b3621, roughness: 0.9 });
    for (let z = -14.8; z <= -0.8; z += 3.5) {
      [-4.1, 4.1].forEach((px) => {
        const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 3.6, 8), postMat);
        piling.position.set(px, 0.15, z);
        world.add(piling);
      });
    }
    // 桟橋先端の常夜灯ポスト
    [-4.1, 4.1].forEach((px) => {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xffa834, emissiveIntensity: 0.8 })
      );
      lamp.position.set(px, 2.08, -14.8);
      world.add(lamp);
      this.nightEmissives.push(lamp.material);
    });

    // ===== 3. 港の街灯（夕方〜夜に暖かく点灯） =====
    const lampPositions = [[-26, 2.5], [-10, 2.5], [10, 2.5], [22, 2.5], [-26, 16], [10, 16]];
    lampPositions.forEach(([lx, lz], idx) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 5.6, 8), metalMat);
      pole.position.set(lx, 3.7, lz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.35), metalMat);
      arm.position.set(lx, 6.45, lz - 0.55);
      const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xffb347, emissiveIntensity: 0.25 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), bulbMat);
      bulb.position.set(lx, 6.26, lz - 1.1);
      world.add(pole, arm, bulb);
      this.nightEmissives.push(bulbMat);
      // モバイル負荷を抑えるため主要な3基に実PointLightを設置
      if (idx < 3) {
        const pt = new THREE.PointLight(0xffb454, 0, 28, 1.6);
        pt.position.set(lx, 5.8, lz - 1.1);
        world.add(pt);
        this.nightLights.push(pt);
      }
    });

    // ===== 4. 回転サーチライト付き灯台 =====
    const lhGroup = new THREE.Group();
    lhGroup.position.set(28, 1.0, 4);
    const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.8, 2.2, 12), darkConcreteMat);
    lhBase.position.y = 1.1;
    const lhLower = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 2.05, 5.2, 14), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }));
    lhLower.position.y = 4.6;
    const lhStripe = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.56, 2.8, 14), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45 }));
    lhStripe.position.y = 8.6;
    const lhUpper = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.38, 2.6, 14), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }));
    lhUpper.position.y = 11.3;
    const lhDeck = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.6, 0.35, 14), metalMat);
    lhDeck.position.y = 12.7;
    const lhGlassMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xffd166, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });
    const lhGlass = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.9, 12), lhGlassMat);
    lhGlass.position.y = 13.75;
    this.nightEmissives.push(lhGlassMat);
    const lhRoof = new THREE.Mesh(new THREE.ConeGeometry(1.45, 1.7, 12), new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.45 }));
    lhRoof.position.y = 15.5;

    // 回転ビーム（夜間に海面を照らす）
    const beamPivot = new THREE.Group();
    beamPivot.position.y = 13.8;
    const beamGeo = new THREE.ConeGeometry(4.2, 34, 14, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, -17);
    this.lhBeamMat = new THREE.MeshBasicMaterial({
      color: 0xfff3b0, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const beam1 = new THREE.Mesh(beamGeo, this.lhBeamMat);
    const beam2 = new THREE.Mesh(beamGeo, this.lhBeamMat);
    beam2.rotation.y = Math.PI;
    beamPivot.add(beam1, beam2);
    this.lighthouseBeam = beamPivot;
    lhGroup.add(lhBase, lhLower, lhStripe, lhUpper, lhDeck, lhGlass, lhRoof, beamPivot);
    world.add(lhGroup);

    // ===== 5. 港のリアル店舗群（魚市場・和風寿司処・ガラスドーム水族館） =====
    // 5-1 魚市場＆町の魚屋
    const marketGrp = new THREE.Group();
    marketGrp.position.set(-20, 1.0, 21);
    const mBody = new THREE.Mesh(new THREE.BoxGeometry(16, 5.6, 10), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.78 }));
    mBody.position.y = 2.8;
    const mRoof = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.7, 11.4), new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.55 }));
    mRoof.position.y = 5.9;
    const mAwning = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.25, 2.8), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 }));
    mAwning.position.set(0, 3.6, -5.8);
    mAwning.rotation.x = 0.2;
    const mSign = new THREE.Mesh(
      new THREE.PlaneGeometry(8.5, 2.3),
      new THREE.MeshBasicMaterial({ map: createSignTexture("🐟 港の魚市場", "新鮮地魚・直送卸売", "#0f2942", "#ffffff", "#38bdf8") })
    );
    mSign.position.set(0, 5.05, -5.06);
    mSign.rotation.y = Math.PI;
    const mDoor = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.0, 0.2), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 }));
    mDoor.position.set(0, 1.5, -5.02);
    // 軒先の鮮魚トロ箱（発泡スチロール＆青コンテナ）
    for (let i = 0; i < 4; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.65, 0.9),
        new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xf8fafc : 0x0284c7, roughness: 0.65 })
      );
      box.position.set(-5.8 + i * 1.45, 0.35, -5.9);
      marketGrp.add(box);
    }
    marketGrp.add(mBody, mRoof, mAwning, mSign, mDoor);
    world.add(marketGrp);

    // 5-2 港の和風寿司処（瓦屋根・木壁・暖簾・赤提灯）
    const sushiGrp = new THREE.Group();
    sushiGrp.position.set(-1.5, 1.0, 26);
    const sBody = new THREE.Mesh(new THREE.BoxGeometry(11.5, 4.6, 8.2), new THREE.MeshStandardMaterial({ color: 0x5c3d24, roughness: 0.85 }));
    sBody.position.y = 2.3;
    const sRoof = new THREE.Mesh(new THREE.ConeGeometry(8.6, 2.8, 4), new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.65 }));
    sRoof.rotation.y = Math.PI / 4;
    sRoof.position.y = 5.9;
    const sNoren = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 1.45),
      new THREE.MeshBasicMaterial({ map: createSignTexture("🍣 寿司処 凪", "", "#172554", "#fef3c7", "#d97706"), side: THREE.DoubleSide })
    );
    sNoren.position.set(0, 2.55, -4.22);
    sNoren.rotation.y = Math.PI;
    const sWarmMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xf59e0b, emissiveIntensity: 0.6 });
    const sWindow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.9), sWarmMat);
    sWindow.position.set(0, 1.5, -4.12);
    sWindow.rotation.y = Math.PI;
    this.nightEmissives.push(sWarmMat);
    [-3.4, 3.4].forEach((lx) => {
      const lanternMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.75 });
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 10), lanternMat);
      lantern.scale.set(0.85, 1.25, 0.85);
      lantern.position.set(lx, 3.0, -4.45);
      sushiGrp.add(lantern);
      this.nightEmissives.push(lanternMat);
    });
    sushiGrp.add(sBody, sRoof, sNoren, sWindow);
    world.add(sushiGrp);

    // 5-3 岬の水族館（ガラスドーム＋青い水槽発光＋エントランス看板）
    const aqGrp = new THREE.Group();
    aqGrp.position.set(17.5, 1.0, 24);
    const aqBase = new THREE.Mesh(new THREE.CylinderGeometry(7.8, 8.2, 1.6, 20), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 }));
    aqBase.position.y = 0.8;
    const aqDomeMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0369a1, emissiveIntensity: 0.35, roughness: 0.14, metalness: 0.45 });
    const aqDome = new THREE.Mesh(new THREE.SphereGeometry(7.4, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), aqDomeMat);
    aqDome.position.y = 1.4;
    this.nightEmissives.push(aqDomeMat);
    const aqRing = new THREE.Mesh(new THREE.TorusGeometry(7.45, 0.22, 8, 28), metalMat);
    aqRing.rotation.x = Math.PI / 2;
    aqRing.position.y = 1.55;
    const aqSign = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 1.9),
      new THREE.MeshBasicMaterial({ map: createSignTexture("🐠 岬の水族館", "MARINE AQUARIUM", "#082f49", "#e0f2fe", "#38bdf8") })
    );
    aqSign.position.set(0, 3.0, -8.1);
    aqSign.rotation.y = Math.PI;
    aqGrp.add(aqBase, aqDome, aqRing, aqSign);
    world.add(aqGrp);

    // ===== 6. 港の左右に係留されている漁船（波に揺れる装飾） =====
    const dockedSpecs = [
      { x: -17, z: -7.5, yaw: Math.PI * 0.48, col: 0x0284c7 },
      { x: -29, z: -8.2, yaw: Math.PI * 0.52, col: 0x0f766e },
      { x: 18,  z: -7.8, yaw: -Math.PI * 0.48, col: 0xb45309 }
    ];
    dockedSpecs.forEach((ds, idx) => {
      const b = buildRealisticBoatModel(ds.col, true);
      b.position.set(ds.x, 0.08, ds.z);
      b.rotation.y = ds.yaw;
      world.add(b);
      this.dockedBoats.push({ mesh: b, phase: idx * 1.7 });
    });

    // ===== 7. 白砂の砂浜・ヤシの木・清流の河口・荒波の磯場＆テトラポッド =====
    const beach = new THREE.Mesh(new THREE.BoxGeometry(74, 1.15, 46), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.94 }));
    beach.position.set(-73, 0.08, 22);
    world.add(beach);

    // 砂浜のヤシの木
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c5333, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.78 });
    [-46, -68, -92].forEach((px, i) => {
      const palm = new THREE.Group();
      palm.position.set(px, 0.6, 18 + (i % 2) * 7);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.42, 7.2, 8), trunkMat);
      trunk.position.y = 3.5;
      trunk.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.14;
      palm.add(trunk);
      for (let k = 0; k < 6; k++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.85, 4.2, 5), leafMat);
        frond.position.set(Math.cos(k * 1.05) * 1.4, 7.0, Math.sin(k * 1.05) * 1.4);
        frond.rotation.z = Math.cos(k * 1.05) * 1.1;
        frond.rotation.x = Math.sin(k * 1.05) * 1.1;
        palm.add(frond);
      }
      world.add(palm);
    });

    // 清流の河口（草地＋川＋木製の小さな橋＋松林）
    const riverBank = new THREE.Mesh(new THREE.BoxGeometry(66, 1.25, 48), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.94 }));
    riverBank.position.set(-142, 0.12, 26);
    const riverWater = new THREE.Mesh(
      new THREE.BoxGeometry(16, 1.32, 52),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.16, metalness: 0.35 })
    );
    riverWater.position.set(-134, 0.14, 22);
    const riverBridge = new THREE.Mesh(new THREE.BoxGeometry(19, 0.45, 3.6), woodMat);
    riverBridge.position.set(-134, 1.45, 16);
    world.add(riverBank, riverWater, riverBridge);

    for (let i = 0; i < 7; i++) {
      const pine = new THREE.Group();
      pine.position.set(-154 + (i % 3) * 7, 0.7, 8 + i * 4.2);
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 4.5, 7), trunkMat);
      tr.position.y = 2.2;
      const cr1 = new THREE.Mesh(new THREE.ConeGeometry(2.1, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.85 }));
      cr1.position.y = 5.2;
      const cr2 = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.85 }));
      cr2.position.y = 7.2;
      pine.add(tr, cr1, cr2);
      world.add(pine);
    }

    // 荒波の磯場＋テトラポッド防波帯＋大小の岩礁
    const isoBase = new THREE.Mesh(new THREE.BoxGeometry(110, 1.35, 46), new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.95 }));
    isoBase.position.set(92, 0.16, 22);
    world.add(isoBase);

    const tetraMat = new THREE.MeshStandardMaterial({ color: 0x7a828c, roughness: 0.92 });
    for (let i = 0; i < 12; i++) {
      const tp = createTetrapod(tetraMat, 1.15 + (i % 2) * 0.2);
      tp.position.set(35 + i * 2.9, 0.65 + (i % 2) * 0.35, -1.6 + (i % 3) * 0.9);
      tp.rotation.set(i * 0.6, i * 1.1, i * 0.4);
      world.add(tp);
    }

    const rockMat = new THREE.MeshStandardMaterial({ map: rockTex, flatShading: true, roughness: 0.92 });
    for (let i = 0; i < 18; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2 + (i % 4) * 1.35, 1), rockMat);
      rock.scale.set(1.25, 0.72 + (i % 3) * 0.25, 1.1);
      rock.position.set(44 + i * 5.6, 0.9 + (i % 3) * 0.5, 1 + (i % 4) * 6.5);
      world.add(rock);
    }

    // ===== 8. 遠景の山並み（陸の背後に奥行きを作る） =====
    const mountainMat = new THREE.MeshStandardMaterial({ color: 0x264635, roughness: 0.95, flatShading: true });
    const farMtnMat = new THREE.MeshStandardMaterial({ color: 0x33535c, roughness: 0.96, flatShading: true });
    const mtnDefs = [
      { x: -165, z: 92, r: 58, h: 46, far: false },
      { x: -88,  z: 105, r: 64, h: 52, far: false },
      { x: 5,    z: 118, r: 72, h: 58, far: true },
      { x: 96,   z: 102, r: 62, h: 48, far: false },
      { x: 175,  z: 96, r: 54, h: 44, far: true }
    ];
    mtnDefs.forEach((m) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(m.r, m.h, 8), m.far ? farMtnMat : mountainMat);
      cone.scale.set(1.4, 1.0, 0.85);
      cone.position.set(m.x, m.h * 0.46, m.z);
      world.add(cone);
    });

    // ===== 9. 沖のランドマーク（南国トロピカル島・遠景島影・点滅ブイ） =====
    const tropicalIsland = new THREE.Group();
    tropicalIsland.position.set(145, 0, -295);
    const islSand = new THREE.Mesh(new THREE.CylinderGeometry(20, 32, 4.5, 16), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.9 }));
    islSand.position.y = 0.8;
    const islHill = new THREE.Mesh(new THREE.ConeGeometry(16, 13, 10), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.88, flatShading: true }));
    islHill.position.y = 7.2;
    tropicalIsland.add(islSand, islHill);
    world.add(tropicalIsland);

    // 遠く水平線上の島影（2つ）
    const farIsl1 = new THREE.Mesh(new THREE.ConeGeometry(34, 14, 9), farMtnMat);
    farIsl1.position.set(-160, 4.5, -355);
    const farIsl2 = new THREE.Mesh(new THREE.ConeGeometry(28, 11, 8), farMtnMat);
    farIsl2.position.set(45, 3.8, -385);
    world.add(farIsl1, farIsl2);

    const addBuoy = (x, z, col) => {
      const bg = new THREE.Group();
      bg.position.set(x, 0, z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.7, 3.4, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 }));
      body.position.y = 1.4;
      const topCage = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.4, 6), metalMat);
      topCage.position.y = 3.6;
      const lampMat = new THREE.MeshBasicMaterial({ color: col });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), lampMat);
      lamp.position.y = 4.6;
      bg.add(body, topCage, lamp);
      world.add(bg);
      this.buoyLamps.push({ lamp, phase: x * 0.1 });
    };
    addBuoy(-125, -280, 0x818cf8);
    addBuoy(0, -290, 0xf97316);
    addBuoy(-62, -135, 0x22c55e);
    addBuoy(68, -140, 0xef4444);

    this.scene.add(world);
  }

  // ===== 他プレイヤー3Dアバター同期 =====
  createRemoteAvatar(data) {
    const group = new THREE.Group();

    const person = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0x0ea5e9 }));
    body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 10), new THREE.MeshStandardMaterial({ color: 0xfde68a }));
    head.position.y = 1.85;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xd49449 }));
    hat.position.y = 2.15;
    person.add(body, head, hat);

    const boat = buildRealisticBoatModel(0x0284c7, true);
    boat.position.set(0, 0, -1.2);

    const labelText = this.formatRemoteLabel(data);
    const labelSprite = createNameSprite(labelText);

    group.add(person, boat, labelSprite);
    group.position.set(data.x || 0, data.isBoating ? 0.1 : 0.9, data.z || 4);
    this.remoteGroup.add(group);

    return {
      group, person, boat, labelSprite, labelText,
      targetX: data.x || 0,
      targetZ: data.z || 4,
      targetYaw: data.yaw || 0,
      isBoating: !!data.isBoating,
      name: data.name || "漁師"
    };
  }

  formatRemoteLabel(data) {
    const now = Date.now();
    if (data.stamp && data.stampTs && now - data.stampTs < 6500) {
      return `${data.stamp}`;
    }
    const icon = data.status === "fighting" ? "🔥" : data.isBoating ? "🚤" : "🎣";
    return `${icon} ${data.name || "漁師"}`;
  }

  syncRemotePlayers(playersObj) {
    const activeIds = new Set(Object.keys(playersObj || {}));
    for (const [uid, av] of this.remoteAvatars.entries()) {
      if (!activeIds.has(uid)) {
        av.labelSprite.material.map?.dispose();
        av.labelSprite.material.dispose();
        this.remoteGroup.remove(av.group);
        this.remoteAvatars.delete(uid);
      }
    }

    for (const [uid, data] of Object.entries(playersObj || {})) {
      let av = this.remoteAvatars.get(uid);
      if (!av) {
        av = this.createRemoteAvatar(data);
        this.remoteAvatars.set(uid, av);
      }
      av.targetX = data.x ?? av.targetX;
      av.targetZ = data.z ?? av.targetZ;
      av.targetYaw = data.yaw ?? av.targetYaw;
      av.isBoating = !!data.isBoating;
      av.name = data.name || "漁師";
      av.boat.visible = av.isBoating;
      av.person.visible = !av.isBoating;

      const nextLabel = this.formatRemoteLabel(data);
      if (nextLabel !== av.labelText) {
        av.labelSprite.material.map?.dispose();
        av.labelSprite.material.dispose();
        av.group.remove(av.labelSprite);
        av.labelSprite = createNameSprite(nextLabel);
        av.group.add(av.labelSprite);
        av.labelText = nextLabel;
      }
    }
  }

  clearRemotePlayers() {
    this.syncRemotePlayers({});
  }

  getNearbyPlayers(radius = 35) {
    const near = [];
    for (const av of this.remoteAvatars.values()) {
      const d = Math.hypot(av.group.position.x - this.pos.x, av.group.position.z - this.pos.y);
      if (d <= radius) near.push({ name: av.name, dist: d });
    }
    return near;
  }

  spawnWorldHotspots() {
    while (this.hotspotGroup.children.length) this.hotspotGroup.remove(this.hotspotGroup.children[0]);
    this.hotspots = [];
    const presets = [{ x:-35,z:-65 }, { x:45,z:-85 }, { x:-15,z:-175 }, { x:70,z:-195 }, { x:-115,z:-275 }, { x:110,z:-270 }, { x:0,z:-315 }];
    presets.forEach((p) => {
      const hx = p.x + (Math.random() - 0.5) * 20, hz = p.z + (Math.random() - 0.5) * 20;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(3.2, 4.3, 28),
        new THREE.MeshBasicMaterial({ color: 0x38e59a, side: THREE.DoubleSide, transparent: true, opacity: 0.72 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(hx, 0.34, hz);
      this.hotspotGroup.add(ring);
      this.hotspots.push({ x: hx, z: hz, mesh: ring });
    });
  }

  setPlayerState({ x, z, yaw, isBoating, boatSpeed, boatTier }) {
    this.pos.set(x ?? 0, z ?? 4); this.yaw = yaw ?? 0;
    this.isBoating = !!isBoating; this.boatSpeed = boatSpeed || 1.2; this.boatTier = boatTier || 0;
    this.boatGroup.visible = this.isBoating;
    this.parkedBoat.visible = !this.isBoating && this.boatTier > 0;
    this.autopilot = false;
  }
  updateBoatSpec(boatSpeed, boatTier) {
    this.boatSpeed = boatSpeed || 1.2;
    this.boatTier = boatTier || 0;
    this.parkedBoat.visible = !this.isBoating && this.boatTier > 0;
  }
  setMode(mode) { this.rodGroup.visible = mode === "fish"; }

  getNearestHotspot() {
    if (!this.isBoating || !this.hotspots.length) return { dist: 999, inSpot: false, spot: null };
    let best = null, minDist = Infinity;
    for (const h of this.hotspots) {
      const d = Math.hypot(h.x - this.pos.x, h.z - this.pos.y);
      if (d < minDist) { minDist = d; best = h; }
    }
    return { dist: minDist, inSpot: minDist <= 12, spot: best };
  }
  toggleAutopilot(forceState) { this.autopilot = typeof forceState === "boolean" ? forceState : !this.autopilot; return this.autopilot; }

  applyEnvironment(env) {
    const palettes = {
      dawn: {
        top: 0x3b4e87, horizon: 0xeb9462, deep: 0x0b2a47, shallow: 0x1b7180,
        sun: 0xffb36b, sunPos: [75, 24, -180], amb: 0.45, hemi: 0.65, sunI: 1.25, port: 1.2, night: 0.32
      },
      day: {
        top: 0x1c69ba, horizon: 0x9cd8f7, deep: 0x063761, shallow: 0x169aa8,
        sun: 0xfff6dc, sunPos: [62, 118, -165], amb: 0.42, hemi: 0.88, sunI: 1.55, port: 0.0, night: 0.0
      },
      dusk: {
        top: 0x2c2b59, horizon: 0xe36b3e, deep: 0x0a213d, shallow: 0x1c596b,
        sun: 0xff7b38, sunPos: [-78, 20, -175], amb: 0.36, hemi: 0.55, sunI: 1.15, port: 1.8, night: 0.48
      },
      night: {
        top: 0x040b18, horizon: 0x0f223d, deep: 0x020d1c, shallow: 0x082a3b,
        sun: 0xa8c8f0, sunPos: [52, 86, -170], amb: 0.24, hemi: 0.32, sunI: 0.58, port: 3.4, night: 1.0
      }
    };
    const p = palettes[env.timePhase] || palettes.day;
    let topCol = new THREE.Color(p.top);
    let horCol = new THREE.Color(p.horizon);
    let fogDensity = 0.0036;

    if (env.weather === "fog") {
      horCol.lerp(new THREE.Color(0x9eb2bf), 0.72);
      topCol.lerp(new THREE.Color(0x7c92a1), 0.65);
      fogDensity = 0.015;
    } else if (env.weather === "rain" || env.weather === "rough") {
      horCol.lerp(new THREE.Color(0x364759), 0.68);
      topCol.lerp(new THREE.Color(0x1f2d3b), 0.68);
      fogDensity = 0.0092;
    } else if (env.weather === "cloudy") {
      horCol.lerp(new THREE.Color(0x8fa6b8), 0.42);
      topCol.lerp(new THREE.Color(0x526b82), 0.38);
      fogDensity = 0.0056;
    }

    const sunVec = new THREE.Vector3(...p.sunPos);
    const sunDir = sunVec.clone().normalize();

    this.scene.background = horCol.clone();
    this.scene.fog = new THREE.FogExp2(horCol.getHex(), fogDensity);

    this.skyUniforms.uTopColor.value.copy(topCol);
    this.skyUniforms.uHorizonColor.value.copy(horCol);
    this.skyUniforms.uSunColor.value.setHex(p.sun);
    this.skyUniforms.uSunDir.value.copy(sunDir);
    this.skyUniforms.uGlowStrength.value = (env.weather === "rain" || env.weather === "rough" || env.weather === "fog") ? 0.35 : 1.0;

    this.waterUniforms.uDeepColor.value.setHex(p.deep);
    this.waterUniforms.uShallowColor.value.setHex(p.shallow);
    this.waterUniforms.uSkyHorizon.value.copy(horCol);
    this.waterUniforms.uSkyZenith.value.copy(topCol);
    this.waterUniforms.uSunColor.value.setHex(p.sun);
    this.waterUniforms.uSunDir.value.copy(sunDir);
    this.waterUniforms.uFogColor.value.copy(horCol);
    this.waterUniforms.uFogDensity.value = fogDensity;
    this.waterUniforms.uNightFactor.value = p.night;

    this.sun.color.setHex(p.sun);
    this.sun.intensity = (env.weather === "rain" || env.weather === "rough") ? p.sunI * 0.5 : p.sunI;
    this.sun.position.copy(sunVec);
    this.celestialDisc.position.copy(sunDir.clone().multiplyScalar(330));
    this.celestialDisc.material.color.setHex(p.sun);
    this.celestialDisc.visible = env.weather !== "rain" && env.weather !== "rough" && env.weather !== "fog";

    this.ambient.intensity = p.amb;
    this.hemi.intensity = p.hemi;
    this.hemi.color.copy(horCol);
    this.portLight.intensity = p.port;

    // 星空・街灯・灯台サーチライトを夜間/夕方に自動点灯
    const isClearNight = p.night > 0.6 && env.weather !== "rain" && env.weather !== "rough";
    this.starMat.opacity = isClearNight ? 0.88 : 0.0;
    this.cloudMat.color.copy(horCol).lerp(new THREE.Color(0xffffff), 0.45 * (1.0 - p.night * 0.7));
    this.cloudMat.opacity = env.weather === "fog" ? 0.35 : 0.78;

    this.nightLights.forEach((lt) => { lt.intensity = p.night * 4.2; });
    this.nightEmissives.forEach((m) => { m.emissiveIntensity = 0.25 + p.night * 1.45; });
    if (this.lhBeamMat) this.lhBeamMat.opacity = p.night * 0.24;

    this.rain.visible = env.weather === "rain" || env.weather === "rough";
    this.waveAmp = env.weather === "rough" ? 2.1 : env.weather === "rain" ? 1.4 : 1.0;
    this.waterUniforms.uWaveAmp.value = this.waveAmp;
  }

  setBobber(visible, dist = 18, dip = 0) {
    this.bobber.visible = visible;
    this.fishingLine.visible = visible;
    this.bobberDist = dist;
    this.bobberDip = dip;
  }
  setRodBend(val) { this.rodBend = val; }

  resize() {
    const w = window.innerWidth || document.documentElement.clientWidth || 1;
    const h = window.innerHeight || document.documentElement.clientHeight || 1;
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? Math.min(75, 60 + (1 - aspect) * 26) : 58;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
  }

  spawnWake(wx, wz) {
    for (const p of this.wakeParticles) {
      if (p.life <= 0) {
        p.life = p.maxLife;
        p.mesh.visible = true;
        p.mesh.position.set(wx + (Math.random() - 0.5) * 1.1, 0.09, wz + (Math.random() - 0.5) * 1.1);
        p.mesh.scale.set(0.65, 0.65, 1);
        p.mesh.material.opacity = 0.52;
        break;
      }
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime;
    let nx = this.pos.x, nz = this.pos.y, movedDist = 0;

    if (this.isBoating && this.autopilot) {
      const nearest = this.getNearestHotspot();
      if (nearest.spot && nearest.dist > 6) {
        const targetYaw = Math.atan2(-(nearest.spot.x - nx), -(nearest.spot.z - nz));
        let diff = targetYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.1);
        const step = dt * 15 * this.boatSpeed;
        nx -= Math.sin(this.yaw) * step; nz -= Math.cos(this.yaw) * step; movedDist = step;
      } else this.autopilot = false;
    } else if (Math.abs(this.moveInput.x) > 0.06 || Math.abs(this.moveInput.y) > 0.06) {
      if (this.isBoating) {
        this.yaw -= this.moveInput.x * dt * 1.9;
        const step = -this.moveInput.y * dt * 16 * this.boatSpeed;
        nx -= Math.sin(this.yaw) * step; nz -= Math.cos(this.yaw) * step; movedDist = Math.abs(step);
      } else {
        const walkSpeed = 14 * dt, fwd = -this.moveInput.y * walkSpeed, strafe = this.moveInput.x * walkSpeed;
        nx += (-Math.sin(this.yaw) * fwd) + (Math.cos(this.yaw) * strafe);
        nz += (-Math.cos(this.yaw) * fwd) - (Math.sin(this.yaw) * strafe);
      }
    }

    if (movedDist > 0 && this.isBoating && this.onFuelConsume && !this.onFuelConsume(movedDist)) {
      this.autopilot = false; nx = this.pos.x; nz = this.pos.y;
    } else {
      const clamped = clampWorldPosition(nx, nz, this.isBoating, this.boatTier);
      this.pos.set(clamped.x, clamped.z);
      if (clamped.blockedMsg && performance.now() - this.lastBlockAt > 1800) {
        this.lastBlockAt = performance.now(); this.autopilot = false; this.onBlocked?.(clamped.blockedMsg);
      }
    }

    // プレイヤーリグの揺れ
    this.playerRig.position.set(this.pos.x, this.isBoating ? Math.sin(t * 2.1) * 0.1 * this.waveAmp : 0.78, this.pos.y);
    this.playerRig.rotation.y = this.yaw;
    this.playerRig.rotation.z = this.isBoating ? Math.sin(t * 1.6) * 0.028 * this.waveAmp : 0;

    // 航行中の航跡波パーティクル
    if (this.isBoating && movedDist > 0.05) {
      this.wakeSpawnAcc += dt;
      if (this.wakeSpawnAcc > 0.07) {
        this.wakeSpawnAcc = 0;
        const backX = this.pos.x + Math.sin(this.yaw) * 4.5;
        const backZ = this.pos.y + Math.cos(this.yaw) * 4.5;
        this.spawnWake(backX, backZ);
      }
    }
    for (const p of this.wakeParticles) {
      if (p.life > 0) {
        p.life -= dt;
        const ratio = Math.max(0, p.life / p.maxLife);
        const s = 0.7 + (1 - ratio) * 2.8;
        p.mesh.scale.set(s, s, 1);
        p.mesh.material.opacity = ratio * 0.45;
        if (p.life <= 0) p.mesh.visible = false;
      }
    }

    // 空ドーム・海メッシュをプレイヤー中心に追従（シェーダーはワールド座標基準なので継ぎ目なし）
    this.skyDome.position.set(this.pos.x, 0, this.pos.y);
    this.stars.position.set(this.pos.x, 0, this.pos.y);
    this.sea.position.set(Math.floor(this.pos.x / 5) * 5, 0, Math.floor(this.pos.y / 5) * 5);
    this.waterUniforms.uTime.value = t;

    // 係留漁船のゆらぎ
    for (const db of this.dockedBoats) {
      db.mesh.position.y = 0.08 + Math.sin(t * 1.8 + db.phase) * 0.07 * this.waveAmp;
      db.mesh.rotation.z = Math.sin(t * 1.4 + db.phase) * 0.03 * this.waveAmp;
    }
    if (this.parkedBoat.visible) {
      this.parkedBoat.position.y = 0.08 + Math.sin(t * 1.9 + 0.5) * 0.07 * this.waveAmp;
      this.parkedBoat.rotation.z = Math.sin(t * 1.5) * 0.025 * this.waveAmp;
    }

    // 灯台サーチライト回転＆沖ブイ点滅
    if (this.lighthouseBeam) this.lighthouseBeam.rotation.y = t * 0.55;
    for (const b of this.buoyLamps) {
      b.lamp.visible = Math.sin(t * 3.2 + b.phase) > -0.15;
    }

    // 雲とカモメのアニメーション
    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > 240) c.group.position.x = -240;
    }
    for (const g of this.seagulls) {
      g.angle += g.speed * dt;
      const gx = g.cx + Math.cos(g.angle) * g.radius;
      const gz = g.cz + Math.sin(g.angle) * g.radius;
      g.group.position.set(gx, g.height + Math.sin(t * 1.7 + g.angle) * 1.2, gz);
      g.group.rotation.y = -g.angle;
      const flap = Math.sin(t * 7.5 + g.angle * 3.0) * 0.45;
      g.leftW.rotation.z = flap;
      g.rightW.rotation.z = -flap;
    }

    // 他プレイヤーアバターの滑らか補間
    for (const av of this.remoteAvatars.values()) {
      av.group.position.x += (av.targetX - av.group.position.x) * Math.min(1, dt * 7);
      av.group.position.z += (av.targetZ - av.group.position.z) * Math.min(1, dt * 7);
      av.group.position.y = av.isBoating ? Math.sin(t * 2.1 + av.targetX) * 0.08 * this.waveAmp : 0.85;
      av.group.rotation.y = av.targetYaw;
    }

    for (const h of this.hotspots) {
      h.mesh.rotation.z = t * 1.2;
      const s = 1 + Math.sin(t * 3.5) * 0.12; h.mesh.scale.set(s, s, 1);
    }

    if (this.rain.visible) {
      const rp = this.rain.geometry.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        let y = rp.getY(i) - 0.48;
        let x = rp.getX(i) - 0.06;
        if (y < 0) { y = 18; x = (Math.random() - 0.5) * 40; }
        rp.setXY(i, x, y);
      }
      rp.needsUpdate = true;
    }

    // 竿のしなり・ウキ・釣り糸
    this.rodGroup.rotation.x = -this.rodBend * 0.48 + Math.sin(t * 2) * 0.015;
    if (this.bobber.visible) {
      const bz = 2.5 - this.bobberDist * 0.6;
      const by = Math.sin(t * 4) * 0.08 - this.bobberDip;
      this.bobber.position.set(0, by, bz);
      const rs = 1.0 + ((t * 1.4) % 1.0) * 2.2;
      this.bobberRipple.scale.set(rs, rs, 1);
      this.bobberRipple.material.opacity = (1.0 - ((t * 1.4) % 1.0)) * 0.55;

      // 竿先からウキまでの自然な垂れ下がりライン
      const tip = this.rodTipLocal.clone().applyMatrix4(this.rodGroup.matrix);
      const end = new THREE.Vector3(0, by + 0.12, bz);
      const sag = Math.max(0.08, (1.0 - this.rodBend) * 1.15);
      const lp = this.fishingLineGeo.attributes.position;
      for (let i = 0; i < 12; i++) {
        const f = i / 11;
        const lx = THREE.MathUtils.lerp(tip.x, end.x, f);
        const lz = THREE.MathUtils.lerp(tip.z, end.z, f);
        const ly = THREE.MathUtils.lerp(tip.y, end.y, f) - Math.sin(f * Math.PI) * sag;
        lp.setXYZ(i, lx, Math.max(0.02, ly), lz);
      }
      lp.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
