import * as THREE from "three";
import { clampWorldPosition, WORLD_LAYOUT } from "../systems/worldMap.js?v=20261128_034601";
import { audioEngine } from "../systems/audioEngine.js?v=20261128_034601";

// ===== リアル海面シェーダー（日替わり波高・6層セット波・岸壁衝突白波・桟橋/防波堤泡・ウキ波紋） =====
const OCEAN_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uWaveAmp;
  uniform vec2 uWaveDir;
  uniform float uChoppiness;
  uniform float uWaveSeed;
  uniform vec2 uBobberPos;
  uniform float uBobberActive;
  uniform float uSplashAge;
  uniform float uBiteIntensity;

  varying vec3 vWorldPos;
  varying float vWaveHeight;
  varying float vShoreMask;
  varying float vWallImpact;
  varying float vSetMod;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float t = uTime;

    vec2 bd = normalize(uWaveDir + vec2(0.0001, 0.0));
    vec2 pd = vec2(-bd.y, bd.x);

    vec2 d1 = normalize(bd * 0.96 + pd * 0.28);
    vec2 d2 = normalize(bd * 0.72 - pd * 0.69);
    vec2 d3 = normalize(bd * 0.45 + pd * 0.89);
    vec2 d4 = normalize(-bd * 0.31 + pd * 0.95);
    vec2 d5 = normalize(bd * 0.84 - pd * 0.54);
    vec2 d6 = normalize(-bd * 0.62 - pd * 0.78);

    // 港内は少し穏やか・外海は大きなうねり
    float shoreFade = smoothstep(3.5, -14.0, wp.z);
    float inHarbor = (1.0 - smoothstep(-38.0, -54.0, wp.z)) * (1.0 - smoothstep(55.0, 88.0, abs(wp.x)));
    float harborCalm = mix(1.0, 0.48, inHarbor);

    // 同じ動きを繰り返さないセット波エンベロープ（強弱の波群がゆっくり流れてくる）
    float set1 = sin(dot(wp.xz, d1) * 0.021 - t * 0.23 + uWaveSeed * 0.71);
    float set2 = cos(dot(wp.xz, d2) * 0.017 - t * 0.143 + uWaveSeed * 1.13);
    float gust = 0.86 + 0.24 * sin(t * 0.19 + wp.x * 0.013 - wp.z * 0.011 + uWaveSeed * 0.37);
    float setMod = (0.64 + 0.52 * (0.5 + 0.5 * set1) * (0.55 + 0.45 * set2)) * gust;
    vSetMod = setMod;

    float amp = uWaveAmp * (0.24 + 0.76 * shoreFade) * harborCalm * setMod;

    float p1 = dot(wp.xz, d1) * 0.072 - t * 1.18 + uWaveSeed * 0.4;
    float p2 = dot(wp.xz, d2) * 0.113 - t * 1.47 + uWaveSeed * 0.9;
    float p3 = dot(wp.xz, d3) * 0.197 - t * 1.93 + uWaveSeed * 1.5;
    float p4 = dot(wp.xz, d4) * 0.311 - t * 2.41 + uWaveSeed * 2.1;
    float p5 = dot(wp.xz, d5) * 0.487 - t * 2.97 + uWaveSeed * 2.7;
    float p6 = dot(wp.xz, d6) * 0.743 - t * 3.61 + uWaveSeed * 3.3;

    float s1 = sin(p1); float c1 = cos(p1);
    float s2 = sin(p2); float c2 = cos(p2);

    // 波頭を尖らせ谷を緩やかにするゲルストナー風プロファイル
    float sharp = 0.26 * uChoppiness;
    float w1 = (s1 + sharp * (1.0 - c1 * c1) * s1) * 0.28;
    float w2 = (s2 + sharp * (1.0 - c2 * c2) * s2) * 0.19;
    float w3 = sin(p3) * 0.105;
    float w4 = sin(p4) * 0.062;
    float w5 = sin(p5) * 0.035;
    float w6 = sin(p6) * 0.020;

    float h = (w1 + w2 + w3 + w4 + w5 + w6) * amp;

    // 港の護岸に当たって跳ね返る重複波（壁際での上下のうねり）
    float portWallX = 1.0 - smoothstep(35.0, 39.5, abs(wp.x));
    float portWallBand = exp(-pow(max(0.0, -wp.z) * 0.42, 2.0)) * portWallX;
    float wallClap = sin(-wp.z * 0.78 - t * 2.35 + sin(wp.x * 0.14) * 1.6) * 0.16 * uWaveAmp * setMod * portWallBand;
    h += wallClap;

    // 沖合のみ水平ピンチ（岸壁に隙間ができないよう shoreFade を掛ける）
    float pinch = shoreFade * amp * uChoppiness * 0.22;
    wp.xz += (d1 * c1 * 0.65 + d2 * c2 * 0.35) * pinch;

    // ウキ着水＆アタリの微細な水面押し下げ
    if (uBobberActive > 0.5) {
      float bDist = length(wp.xz - uBobberPos);
      if (uSplashAge < 3.5) {
        float front = uSplashAge * 2.8;
        float rEnv = exp(-pow((bDist - front) * 0.9, 2.0)) * exp(-uSplashAge * 0.85);
        h += sin(bDist * 6.0 - uSplashAge * 12.0) * 0.075 * rEnv;
      }
      if (uBiteIntensity > 0.05) {
        float bEnv = exp(-bDist * 0.65);
        h += sin(bDist * 7.5 - t * 16.0) * 0.06 * uBiteIntensity * bEnv;
      }
    }

    wp.y += h;
    vWorldPos = wp.xyz;
    vWaveHeight = h;

    // 岸辺・護岸・沖防波堤・テトラポッド・南国島の白波マスク
    float coastFoam = 1.0 - smoothstep(-0.8, -12.0, wp.z);
    float bwZ = exp(-pow((wp.z + 43.5) * 0.21, 2.0));
    float bwX = smoothstep(18.5, 22.5, abs(wp.x)) * (1.0 - smoothstep(75.0, 83.0, abs(wp.x)));
    float islandDist = length(wp.xz - vec2(145.0, -295.0));
    float islandFoam = exp(-pow((islandDist - 31.5) * 0.22, 2.0));

    vShoreMask = clamp(coastFoam + bwZ * bwX * 0.95 + islandFoam * 0.85, 0.0, 1.0);
    vWallImpact = clamp(portWallBand * (0.45 + max(0.0, h) * 2.8) + bwZ * bwX * (0.35 + max(0.0, h) * 1.9), 0.0, 1.0);

    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const OCEAN_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uWaveAmp;
  uniform vec2 uWaveDir;
  uniform float uChoppiness;
  uniform float uWaveSeed;
  uniform vec2 uBobberPos;
  uniform float uBobberActive;
  uniform float uSplashAge;
  uniform float uBiteIntensity;

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
  varying float vWallImpact;
  varying float vSetMod;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float t = uTime;
    vec2 p = vWorldPos.xz;
    vec2 bd = normalize(uWaveDir + vec2(0.0001, 0.0));
    vec2 pd = vec2(-bd.y, bd.x);

    vec2 d1 = normalize(bd * 0.96 + pd * 0.28);
    vec2 d2 = normalize(bd * 0.72 - pd * 0.69);
    vec2 d3 = normalize(bd * 0.45 + pd * 0.89);
    vec2 d4 = normalize(-bd * 0.31 + pd * 0.95);

    // ドメインワープで規則的な格子模様を消した自然なさざ波法線
    vec2 warp = vec2(
      sin(p.y * 0.17 + t * 0.55 + uWaveSeed),
      cos(p.x * 0.15 - t * 0.48 + uWaveSeed * 1.3)
    ) * 1.15;
    vec2 pw = p + warp;

    float g1 = cos(dot(p, d1) * 0.072 - t * 1.18 + uWaveSeed * 0.4) * 0.085;
    float g2 = cos(dot(p, d2) * 0.113 - t * 1.47 + uWaveSeed * 0.9) * 0.075;
    float g3 = cos(dot(pw, d3) * 0.29 - t * 2.15 + uWaveSeed * 1.5) * 0.085;
    float g4 = cos(dot(pw, d4) * 0.58 - t * 2.88 + uWaveSeed * 2.1) * 0.062;
    float micro1 = sin(pw.x * 1.35 - pw.y * 1.12 + t * 3.4) * 0.042;
    float micro2 = cos(pw.x * 2.35 + pw.y * 1.95 - t * 4.3) * 0.026;

    vec2 slope = d1 * g1 + d2 * g2 + d3 * g3 + d4 * g4 + vec2(micro1 + micro2, micro2 - micro1);
    float slopeScale = (0.62 + 0.42 * uWaveAmp) * (0.78 + 0.28 * uChoppiness) * clamp(vSetMod, 0.55, 1.45);
    vec2 nXZ = -slope * slopeScale;

    // ===== ウキ着水＆アタリの同心円波紋（法線を曲げて水面反射にリアルな波紋を出す） =====
    float bobberFoam = 0.0;
    if (uBobberActive > 0.5) {
      vec2 toB = p - uBobberPos;
      float bDist = length(toB);
      vec2 bDir = toB / max(bDist, 0.001);

      // 1. 着水時の大きく広がる多層波紋
      if (uSplashAge >= 0.0 && uSplashAge < 4.8) {
        float front1 = uSplashAge * 2.9;
        float env1 = exp(-pow((bDist - front1) * 1.15, 2.0)) * exp(-uSplashAge * 0.72) * smoothstep(0.0, 0.06, uSplashAge);
        float front2 = max(0.0, (uSplashAge - 0.30) * 2.25);
        float env2 = exp(-pow((bDist - front2) * 1.4, 2.0)) * exp(-max(0.0, uSplashAge - 0.30) * 0.85) * step(0.30, uSplashAge);
        float front3 = max(0.0, (uSplashAge - 0.62) * 1.75);
        float env3 = exp(-pow((bDist - front3) * 1.6, 2.0)) * exp(-max(0.0, uSplashAge - 0.62) * 0.95) * step(0.62, uSplashAge);

        float wSplash = (cos(bDist * 7.8 - uSplashAge * 14.5) * env1
                      + cos(bDist * 9.2 - uSplashAge * 13.0) * env2 * 0.75
                      + cos(bDist * 10.5 - uSplashAge * 11.5) * env3 * 0.5);
        nXZ += bDir * wSplash * 0.58;

        // 着水直後の白い飛沫リング
        float ringGlow = (env1 * 0.75 + env2 * 0.45) * smoothstep(0.15, 0.95, 0.5 + 0.5 * sin(bDist * 7.8 - uSplashAge * 14.5));
        float centerPop = exp(-bDist * bDist * 2.2) * exp(-uSplashAge * 1.85);
        bobberFoam += ringGlow * 0.65 + centerPop * 0.85;
      }

      // 2. 浮いている間の細かい揺らぎ波紋
      if (bDist < 4.5) {
        float idleEnv = exp(-bDist * 0.85) * smoothstep(0.08, 0.45, bDist);
        nXZ += bDir * cos(bDist * 8.2 - t * 6.8) * idleEnv * 0.14;
      }

      // 3. アタリ・ファイト時の激しい波紋＆白泡
      if (uBiteIntensity > 0.05 && bDist < 6.5) {
        float biteEnv = exp(-bDist * 0.52) * uBiteIntensity;
        float biteWave = cos(bDist * 9.5 - t * 18.5);
        nXZ += bDir * biteWave * biteEnv * 0.62;
        bobberFoam += exp(-bDist * 1.35) * uBiteIntensity * (0.45 + 0.45 * vnoise(p * 4.5 + t * 3.0));
      }
    }

    vec3 N = normalize(vec3(nXZ.x, 1.0, nXZ.y));
    vec3 V = normalize(cameraPosition - vWorldPos);
    float NoV = max(dot(N, V), 0.001);
    float fresnel = pow(1.0 - NoV, 3.8);

    float beachShallow = smoothstep(-58.0, -3.5, vWorldPos.z) * (0.45 + 0.55 * smoothstep(40.0, -100.0, vWorldPos.x));
    float tropical = smoothstep(-195.0, -255.0, vWorldPos.z) * smoothstep(45.0, 115.0, vWorldPos.x);
    float shallowFactor = clamp(beachShallow * 0.72 + tropical * 0.85, 0.0, 1.0);
    vec3 waterBody = mix(uDeepColor, uShallowColor, shallowFactor);

    // 太陽光の透過（波の山のエメラルドグリーン）
    float sss = pow(max(dot(V, -uSunDir + N * 0.45), 0.0001), 3.0) * max(vWaveHeight * 1.55 + 0.22, 0.0);
    waterBody += uShallowColor * uSunColor * sss * (0.40 * (1.0 - uNightFactor * 0.72));

    vec3 R = reflect(-V, N);
    float skyGrad = clamp(R.y * 1.6 + 0.15, 0.0, 1.0);
    vec3 skyReflect = mix(uSkyHorizon, uSkyZenith, skyGrad);
    vec3 col = mix(waterBody, skyReflect, clamp(fresnel * 0.88 + 0.07, 0.0, 0.92));

    vec3 H = normalize(uSunDir + V);
    float NoH = max(dot(N, H), 0.0001);
    float specSharp = pow(NoH, 260.0) * 2.0;
    float specSoft = pow(NoH, 28.0) * 0.26;
    col += uSunColor * (specSharp + specSoft);

    // 夜の港町の街灯・家明かり・赤白灯台が水面に揺らめく映り込み
    if (uNightFactor > 0.05) {
      float townGlow = exp(-length((vWorldPos.xz - vec2(0.0, 2.0)) * vec2(0.013, 0.028)));
      float shimmer = pow(max(0.0, sin(p.x * 1.35 + t * 2.1 + nXZ.x * 4.0) * cos(p.y * 1.85 - t * 2.7 + nXZ.y * 4.0) * 0.5 + 0.5), 2.8);
      col += vec3(1.0, 0.68, 0.32) * townGlow * (0.26 + 0.64 * shimmer) * uNightFactor;

      float redLh = exp(-length((vWorldPos.xz - vec2(22.0, -43.5)) * 0.075));
      col += vec3(1.0, 0.22, 0.22) * redLh * (0.35 + 0.4 * shimmer) * uNightFactor;
      float whtLh = exp(-length((vWorldPos.xz - vec2(-22.0, -43.5)) * 0.075));
      col += vec3(0.75, 1.0, 0.85) * whtLh * (0.32 + 0.4 * shimmer) * uNightFactor;
    }

    // ===== 港護岸・桟橋杭・砂浜引き波・テトラポッド・防波堤の自然な白波と泡 =====
    float foamNoise = vnoise(p * 0.85 + vec2(t * 0.35, -t * 0.52)) * 0.65 + vnoise(p * 2.4 - vec2(t * 0.7, t * 0.4)) * 0.35;

    // 1. 港のコンクリート護岸（z ≈ 0, |x| <= 37.5）に打ち寄せて広がる白泡
    float inPortX = 1.0 - smoothstep(35.5, 38.5, abs(p.x));
    float wallDist = max(0.0, -p.y);
    float wallPulse = 0.5 + 0.5 * sin(t * 1.85 + sin(p.x * 0.16) * 2.2 + uWaveSeed);
    float wallReach = 0.75 + (0.65 + 1.35 * wallPulse) * clamp(uWaveAmp, 0.4, 2.2) * clamp(vSetMod, 0.6, 1.4);
    float wallBand = (1.0 - smoothstep(0.1, wallReach, wallDist)) * inPortX;
    float portWallFoam = smoothstep(0.28, 0.78, wallBand * (0.65 + 0.65 * foamNoise) + vWallImpact * 0.35);

    // 2. 桟橋の側面＆木杭まわりのさざ波泡
    float nearPierZ = smoothstep(-16.2, -14.8, p.y) * (1.0 - smoothstep(-0.2, 1.2, p.y));
    float pierEdge = exp(-pow((abs(p.x) - 4.45) * 1.7, 2.0)) * nearPierZ;
    float pilingZ = abs(fract((p.y + 14.8) / 3.5 + 0.5) - 0.5) * 3.5;
    float pilingRing = exp(-(pow(abs(p.x) - 4.1, 2.0) + pilingZ * pilingZ) * 2.2) * nearPierZ;
    float pierFoam = clamp((pierEdge * 0.5 + pilingRing * 0.9) * (0.45 + 0.65 * foamNoise), 0.0, 0.85);

    // 3. 砂浜（x ∈ [-105, -36]）の押し寄せて引く波打ち際の泡レース
    float inBeachX = smoothstep(-108.0, -98.0, p.x) * (1.0 - smoothstep(-39.0, -34.0, p.x));
    float swashPhase = sin(p.y * 0.65 + t * 1.65 + sin(p.x * 0.09) * 2.5);
    float beachBand = (1.0 - smoothstep(0.0, 9.5, max(0.0, -p.y - 0.6))) * inBeachX;
    float beachFoam = smoothstep(0.42, 0.86, beachBand * (0.45 + 0.55 * (0.5 + 0.5 * swashPhase)) * (0.55 + 0.65 * foamNoise));

    // 4. 沖防波堤・テトラポッド・磯場の砕け波
    float tetraBand = smoothstep(33.0, 37.0, p.x) * (1.0 - smoothstep(72.0, 82.0, p.x)) * exp(-pow((p.y + 1.6) * 0.38, 2.0));
    float shoreWave = sin(p.y * 1.15 + t * 2.35 + sin(p.x * 0.22) * 2.1 + foamNoise * 2.4) * 0.5 + 0.5;
    float breakFoam = smoothstep(0.46, 0.92, (shoreWave * vShoreMask + vShoreMask * 0.32 + tetraBand * 0.85) * (0.62 + 0.55 * foamNoise));

    // 5. 高波・白波の立つ日だけ沖の波頭に現れる白波（うさぎ跳び）
    float crestThreshold = mix(0.42, 0.19, clamp((uWaveAmp - 0.5) * 0.6, 0.0, 1.0));
    float crestFoam = smoothstep(crestThreshold, crestThreshold + 0.24, vWaveHeight + (foamNoise - 0.5) * 0.14) * clamp((uWaveAmp - 0.55) * 0.65, 0.0, 0.85);

    float foam = clamp(portWallFoam * 0.82 + pierFoam * 0.65 + beachFoam * 0.78 + breakFoam * 0.72 + crestFoam + bobberFoam, 0.0, 0.94);
    vec3 foamColor = mix(vec3(0.94, 0.98, 1.0), uSkyHorizon * 1.08, 0.22);
    col = mix(col, foamColor, foam);

    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

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
    float band = exp(-abs(d.y) * 9.0) * 0.16;
    col += uHorizonColor * band;
    float sunDot = max(dot(d, normalize(uSunDir)), 0.0);
    float sunGlow = pow(sunDot, 12.0) * 0.35 * uGlowStrength + pow(sunDot, 180.0) * 0.95;
    col += uSunColor * sunGlow;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ===== プロシージャル高精細テクスチャ群 =====
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
      const v = 92 + Math.floor(Math.random() * 44);
      ctx.fillStyle = `rgba(${v},${v + 4},${v + 10},0.34)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.strokeStyle = "rgba(30, 41, 59, 0.42)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = "rgba(40, 52, 65, 0.14)";
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 24, 0, Math.PI * 2);
      ctx.fill();
    }
  }, rx, ry);
}

function createAsphaltRoadTexture(rx = 22, ry = 1) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#2b313a";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const v = 30 + Math.floor(Math.random() * 32);
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},0.45)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // 両端の白線
    ctx.fillStyle = "rgba(241, 245, 249, 0.82)";
    ctx.fillRect(0, 14, w, 7);
    ctx.fillRect(0, h - 21, w, 7);
    // 中央の破線（日本の道路らしい白/黄センターライン）
    ctx.fillStyle = "rgba(250, 204, 21, 0.85)";
    ctx.fillRect(28, h / 2 - 4, 118, 8);
  }, rx, ry);
}

function createStoneWallTexture(rx = 26, ry = 2) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#4b525a";
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const offset = (r % 2) * 28;
      for (let x = -32; x < w + 32; x += 52) {
        const bw = 48;
        const shade = 78 + ((r * 17 + x * 7) % 36);
        ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
        ctx.fillRect(x + offset + 2, y + 2, bw - 3, rh - 3);
        // 苔の風合い
        if ((r + x) % 5 === 0) {
          ctx.fillStyle = "rgba(63, 98, 42, 0.25)";
          ctx.fillRect(x + offset + 2, y + 2, bw - 3, 6);
        }
      }
    }
  }, rx, ry);
}

function createRoofTileTexture(baseHex = "#242a34", rx = 3, ry = 3) {
  return makeCanvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    for (let y = 8; y < h; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    for (let x = 0; x < w; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  }, rx, ry);
}

function createHouseWallTexture(baseHex = "#e2ddd2", trimHex = "#5c4738") {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, w, h);
    // 下見板・モルタルの繊細な筋
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 2;
    for (let y = 0; y < h; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // 1階腰壁（焼き杉・ダーク板張り）
    ctx.fillStyle = trimHex;
    ctx.fillRect(0, h * 0.64, w, h * 0.36);
    // 引き戸・窓枠シルエット
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(34, 42, 66, 56);
    ctx.fillRect(154, 42, 66, 56);
    ctx.fillRect(42, 166, 86, 74);
    ctx.strokeStyle = "#d6d3d1";
    ctx.lineWidth = 4;
    ctx.strokeRect(34, 42, 66, 56);
    ctx.strokeRect(154, 42, 66, 56);
    ctx.strokeRect(42, 166, 86, 74);
  }, 1, 1);
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
      ctx.strokeStyle = "rgba(58, 36, 18, 0.28)";
      ctx.lineWidth = 1;
      for (let g = 0; g < 6; g++) {
        ctx.beginPath();
        const gy = y + 4 + (g / 6) * (ph - 6);
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + Math.sin(i + g) * 3, w * 0.7, gy - Math.cos(i + g) * 3, w, gy);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(25, 16, 8, 0.65)";
      ctx.fillRect(0, y + ph - 2, w, 2);
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
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,248,220,0.38)" : "rgba(138,112,68,0.26)";
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, rx, ry);
}

function createRockTexture(rx = 5, ry = 3) {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#48443f";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      const v = 45 + Math.floor(Math.random() * 55);
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.4)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 3, 2);
    }
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
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(92,140,48,0.38)" : "rgba(38,68,20,0.35)";
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 4);
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
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, w / 2, sub ? 66 : h / 2);
    if (sub) {
      ctx.fillStyle = accent;
      ctx.font = "bold 25px sans-serif";
      ctx.fillText(sub, w / 2, 122);
    }
  }, 1, 1);
}

function createFlagTexture() {
  return makeCanvasTex(256, 160, (ctx, w, h) => {
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(0, 0, w, h);
    // 旭日・波模様の大漁旗
    ctx.fillStyle = "#facc15";
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.48, 42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0284c7";
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 54px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("大漁", w * 0.5, h * 0.48);
  }, 1, 1);
}

function createNameSprite(text) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 112;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);

  // 角丸ネームタグ背景
  const r = 28;
  const x = 16, y = 16, w = c.width - 32, h = c.height - 32;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(10, 18, 34, 0.84)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
  ctx.stroke();

  ctx.font = "800 38px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(String(text || "漁師").slice(0, 18), c.width / 2, c.height / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(3.4, 0.76, 1);
  sp.position.set(0, 2.55, 0);
  sp.renderOrder = 10;
  return sp;
}

// リアル漁船モデル（大漁旗＆集魚灯オプション付き）
function buildRealisticBoatModel(accentColor = 0x1d4ed8, hasCabin = true, flagTex = null) {
  const g = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.42, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.38, metalness: 0.15 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.78 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.12, metalness: 0.65, transparent: true, opacity: 0.75 });

  const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.75, 5.4), whiteMat);
  lowerHull.position.set(0, 0.22, 1.4);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.22, 5.46), accentMat);
  stripe.position.set(0, 0.48, 1.4);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.12, 5.0), deckMat);
  deck.position.set(0, 0.62, 1.4);

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

  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 5.2), whiteMat);
  railL.position.set(-1.3, 0.8, 1.4);
  const railR = railL.clone();
  railR.position.x = 1.3;
  const stern = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.44, 0.18), whiteMat);
  stern.position.set(0, 0.8, 4.05);
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
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 6), darkMat);
    mast.position.set(0, 2.85, 0.55);
    const navLamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfef08a }));
    navLamp.position.set(0, 3.76, 0.55);
    g.add(cabin, roof, winFront, winSideL, winSideR, mast, navLamp);

    if (flagTex) {
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.65, 1.05),
        new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.7 })
      );
      flag.position.set(0, 3.15, 1.38);
      flag.rotation.y = Math.PI / 2;
      flag.userData.isFlag = true;
      g.add(flag);
    }
  }
  return g;
}

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

// 漁協の軽トラック生成
function buildKeiTruck() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.15 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.12, metalness: 0.65 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 });

  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.45, 1.45), bodyMat);
  cab.position.set(0, 1.05, -1.15);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.62, 0.08), glassMat);
  wind.position.set(0, 1.32, -1.88);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.55, 2.35), bodyMat);
  bed.position.set(0, 0.72, 0.78);
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 2.35), bodyMat);
  sideL.position.set(-0.8, 1.15, 0.78);
  const sideR = sideL.clone();
  sideR.position.x = 0.8;
  // 荷台の青い魚箱×4
  for (let i = 0; i < 4; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.42, 0.92), i % 2 === 0 ? boxMat : bodyMat);
    crate.position.set((i % 2 === 0 ? -0.38 : 0.38), 1.2, 0.25 + Math.floor(i / 2) * 1.0);
    g.add(crate);
  }
  const tireGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
  tireGeo.rotateZ(Math.PI / 2);
  [[-0.82, -1.2], [0.82, -1.2], [-0.82, 1.15], [0.82, 1.15]].forEach(([tx, tz]) => {
    const t = new THREE.Mesh(tireGeo, tireMat);
    t.position.set(tx, 0.32, tz);
    g.add(t);
  });
  g.add(cab, wind, bed, sideL, sideR);
  return g;
}


// ===== 高クオリティ釣り人・漁師3Dアバター生成（4造形シルエット＆カラー対応） =====
function hashColorFromName(name = "") {
  const palette = ["#0284c7", "#0f766e", "#d97706", "#e11d48", "#7c3aed", "#2563eb", "#16a34a", "#ea580c"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function normalizeAvatarOpt(opt, fallbackName = "") {
  if (typeof opt === "number") {
    return { model: 0, color: opt, hair: 0x261c16 };
  }
  const m = Number(opt?.model ?? 0);
  const model = (m >= 0 && m <= 3) ? m : 0;
  const color = opt?.color || hashColorFromName(fallbackName);
  const hair = opt?.hair || "#261c16";
  return { model, color, hair };
}

function buildHighQualityAngler(avatarOpt = null, withRod = true, fallbackName = "") {
  const cfg = normalizeAvatarOpt(avatarOpt, fallbackName);
  const slim = (cfg.model === 1 || cfg.model === 3);
  const root = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf7cfa0, roughness: 0.70 });
  const hairMat = new THREE.MeshStandardMaterial({ color: cfg.hair, roughness: 0.82 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.72 });
  const vestMat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.55, metalness: 0.08 });
  const pocketMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: slim ? 0x3b485b : 0x334155, roughness: 0.84 });
  const bootMat = new THREE.MeshStandardMaterial({ color: slim ? 0x3b2a22 : 0x18181b, roughness: 0.45 });
  const hatMat = new THREE.MeshStandardMaterial({ color: (cfg.model === 2 || cfg.model === 3) ? cfg.color : 0xd9ad6c, roughness: 0.70 });
  const hatBandMat = new THREE.MeshStandardMaterial({ color: (cfg.model === 2 || cfg.model === 3) ? 0xf8fafc : cfg.color, roughness: 0.5 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
  const cheekMat = new THREE.MeshBasicMaterial({ color: 0xf4a59c, transparent: true, opacity: slim ? 0.55 : 0.2 });

  // 胴体（モデルごとのシルエット差：しっかり肩幅 vs スリムウエスト＋フレア/キュロット）
  const torso = new THREE.Group();
  torso.position.y = 1.05;
  const torsoW = slim ? 0.39 : 0.49;
  const torsoD = slim ? 0.24 : 0.29;
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(torsoW, 0.56, torsoD), shirtMat);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(torsoW + 0.04, 0.50, torsoD + 0.03), vestMat);
  vest.position.y = -0.01;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.1, 10), shirtMat);
  collar.position.y = 0.31;
  [-torsoW * 0.28, torsoW * 0.28].forEach((px) => {
    const pock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.05), pocketMat);
    pock.position.set(px, 0.04, -(torsoD * 0.5 + 0.01));
    torso.add(pock);
  });
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(slim ? 0.30 : 0.36, 0.39, 0.15), pocketMat);
  backpack.position.set(0, 0.02, torsoD * 0.5 + 0.08);
  torso.add(shirt, vest, collar, backpack);

  if (cfg.model === 1) {
    // フレアスカート風シルエット
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.33, 0.34, 14), pantsMat);
    flare.position.y = -0.36;
    torso.add(flare);
  } else if (cfg.model === 3) {
    // ショートキュロット風シルエット
    const culotte = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.28, 0.25, 14), pantsMat);
    culotte.position.y = -0.33;
    torso.add(culotte);
  }
  root.add(torso);

  // 首・頭部・顔・髪型（4パターン）・帽子（バケット／つば広／キャップ）
  const headGrp = new THREE.Group();
  headGrp.position.y = slim ? 1.54 : 1.57;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.085, 0.14, 8), skinMat);
  neck.position.y = -0.14;
  const head = new THREE.Mesh(new THREE.SphereGeometry(slim ? 0.21 : 0.22, 16, 14), skinMat);

  // 後ろ髪ベース
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(slim ? 0.22 : 0.23, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat);
  hairCap.rotation.x = -0.25;
  hairCap.position.set(0, 0.02, 0.02);
  headGrp.add(neck, head, hairCap);

  // 髪型の違い
  if (cfg.model === 1) {
    // ロングヘア（背面＋両サイドの髪）
    const longBack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.14), hairMat);
    longBack.position.set(0, -0.16, 0.14);
    headGrp.add(longBack);
    [-0.17, 0.17].forEach((sx) => {
      const sideLock = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.36, 8), hairMat);
      sideLock.position.set(sx, -0.11, -0.02);
      headGrp.add(sideLock);
    });
  } else if (cfg.model === 3) {
    // ポニーテール＆前髪サイド
    const pony = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 10), hairMat);
    pony.position.set(0, -0.04, 0.27);
    pony.rotation.x = 0.52;
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 6, 10), vestMat);
    tie.position.set(0, 0.08, 0.22);
    tie.rotation.x = Math.PI / 2;
    headGrp.add(pony, tie);
    [-0.16, 0.16].forEach((sx) => {
      const side = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.22, 8), hairMat);
      side.position.set(sx, -0.04, -0.04);
      headGrp.add(side);
    });
  } else {
    // ショートヘアの襟足
    const shortBack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.10), hairMat);
    shortBack.position.set(0, -0.04, 0.15);
    headGrp.add(shortBack);
  }

  // 目＆チーク（前方 = -Z側）
  const eyeR = slim ? 0.028 : 0.025;
  [-0.072, 0.072].forEach((ex) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 8, 8), eyeMat);
    eye.position.set(ex, 0.02, -(slim ? 0.195 : 0.205));
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.032, 8), cheekMat);
    cheek.position.set(ex * 1.45, -0.035, -(slim ? 0.19 : 0.20));
    cheek.rotation.y = Math.PI;
    headGrp.add(eye, cheek);
  });

  // 帽子（0:バケットハット / 1:つば広リボンハット / 2,3:つば前向きキャップ）
  if (cfg.model === 2 || cfg.model === 3) {
    const capDome = new THREE.Mesh(new THREE.SphereGeometry(0.225, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hatMat);
    capDome.position.y = 0.07;
    const capVisor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.22), hatMat);
    capVisor.position.set(0, 0.11, -0.22);
    capVisor.rotation.x = 0.12;
    const capLogo = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.02), hatBandMat);
    capLogo.position.set(0, 0.17, -0.21);
    headGrp.add(capDome, capVisor, capLogo);
  } else {
    const brimR = cfg.model === 1 ? 0.44 : 0.37;
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(brimR - 0.02, brimR + 0.02, 0.038, 20), hatMat);
    hatBrim.position.y = 0.14;
    const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.16, 16), hatMat);
    hatCrown.position.y = 0.23;
    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.224, 0.048, 16), hatBandMat);
    hatBand.position.y = 0.17;
    headGrp.add(hatBrim, hatCrown, hatBand);
  }
  root.add(headGrp);

  // 両腕
  const armX = slim ? 0.265 : 0.32;
  const armR = slim ? 0.062 : 0.076;
  const makeArm = (side) => {
    const arm = new THREE.Group();
    arm.position.set(side * armX, 1.29, 0);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR * 0.9, 0.33, 10), shirtMat);
    sleeve.position.y = -0.165;
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(armR * 0.82, armR * 0.74, 0.23, 10), skinMat);
    fore.position.y = -0.41;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(armR * 0.88, 10, 10), skinMat);
    hand.position.y = -0.54;
    arm.add(sleeve, fore, hand);
    return arm;
  };
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  if (withRod) {
    const miniRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.024, 1.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.6, roughness: 0.3 })
    );
    miniRod.rotation.x = -Math.PI * 0.36;
    miniRod.position.set(0, -0.45, -0.78);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.012, 0.45, 6),
      new THREE.MeshStandardMaterial({ color: 0xff5a36, roughness: 0.3 })
    );
    tip.rotation.x = -Math.PI * 0.36;
    tip.position.set(0, -0.02, -1.68);
    rightArm.add(miniRod, tip);
  }
  root.add(leftArm, rightArm);

  // 両脚
  const legX = slim ? 0.105 : 0.13;
  const legR = slim ? 0.078 : 0.095;
  const makeLeg = (side) => {
    const leg = new THREE.Group();
    leg.position.set(side * legX, 0.75, 0);
    const thighMat = slim ? skinMat : pantsMat;
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR * 0.86, 0.41, 10), thighMat);
    thigh.position.y = -0.205;
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(legR * 0.92, legR * 0.88, 0.35, 10), bootMat);
    boot.position.y = -0.55;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(slim ? 0.14 : 0.16, 0.11, 0.25), bootMat);
    foot.position.set(0, -0.70, -0.05);
    leg.add(thigh, boot, foot);
    return leg;
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);
  root.add(leftLeg, rightLeg);

  root.userData.rig = { torso, headGrp, leftArm, rightArm, leftLeg, rightLeg };
  return root;
}

function animateAnglerRig(angler, walkPhase, speedFactor, isBoating, timeSec = 0, isFishing = false, rodBend = 0) {
  const rig = angler?.userData?.rig;
  if (!rig) return;
  if (isBoating) {
    rig.leftLeg.rotation.x = -1.1;
    rig.rightLeg.rotation.x = -1.1;
    rig.leftArm.rotation.x = -0.55;
    rig.rightArm.rotation.x = isFishing ? 1.25 : -0.55;
    rig.torso.rotation.x = 0;
    rig.torso.position.y = 1.05;
    return;
  }
  const spd = Math.max(0, Math.min(1, speedFactor || 0));
  if (spd > 0.04 && !isFishing) {
    const amp = 0.78 * spd;
    const s = Math.sin(walkPhase) * amp;
    const bounce = Math.abs(Math.sin(walkPhase)) * 0.065 * spd;
    rig.leftLeg.rotation.x = s;
    rig.rightLeg.rotation.x = -s;
    rig.leftArm.rotation.x = -s * 0.85;
    rig.rightArm.rotation.x = s * 0.85;
    rig.torso.rotation.x = -0.14 * spd;
    rig.torso.position.y = 1.05 + bounce;
  } else {
    const k = 0.22;
    rig.leftLeg.rotation.x *= (1 - k);
    rig.rightLeg.rotation.x *= (1 - k);
    rig.leftArm.rotation.x *= (1 - k);
    rig.torso.rotation.x *= (1 - k);
    rig.torso.position.y = 1.05 + Math.sin(timeSec * 2.2) * 0.014;
    // 釣り中：右腕を前側へ伸ばし、しなりに応じて少し持ち上げる
    const targetRightArmX = isFishing ? (1.18 + rodBend * 0.22) : 0.0;
    rig.rightArm.rotation.x += (targetRightArmX - rig.rightArm.rotation.x) * 0.28;
  }
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
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 680);

    this.hemi = new THREE.HemisphereLight(0x9bd6ff, 0x1b3a4b, 0.75);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.36);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff4d6, 1.48);
    this.sun.position.set(55, 78, -95);
    this.scene.add(this.sun);

    this.buildSkyAndAtmosphere();

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
      uNightFactor: { value: 0.0 },
      uWaveDir: { value: new THREE.Vector2(0.45, 0.89) },
      uChoppiness: { value: 0.52 },
      uWaveSeed: { value: 1.0 },
      uBobberPos: { value: new THREE.Vector2(0, -10) },
      uBobberActive: { value: 0.0 },
      uSplashAge: { value: 99.0 },
      uBiteIntensity: { value: 0.0 }
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
    this.townWindowMats = [];
    this.dockedBoats = [];
    this.buoyLamps = [];
    this.flags = [];
    this.lighthouseBeam = null;
    this.signalBulbs = { carR: [], carY: [], carG: [], pedR: [], pedG: [] };
    this.signalState = { car: 'green', ped: 'red', pedBlink: false };
    this.lastRedWarnAt = 0;
    this.railState = null;
    this.lastGateWarnAt = 0;
    this.trafficVehicles = [];
    this.carBeamMats = [];
    this.busWindowMats = [];
    this.carNightFactor = 0;

    this.buildWorldTerrain();

    this.playerRig = new THREE.Group();
    this.scene.add(this.playerRig);
    this.camera.position.set(0, 2.75, 4.45);
    this.camera.lookAt(0, 1.35, -3.5);
    this.playerRig.add(this.camera);

    this.boatGroup = buildRealisticBoatModel(0xc2410c, false);
    this.boatGroup.visible = false;
    this.playerRig.add(this.boatGroup);
    this.localAvatarOpt = { model: 0, color: '#0284c7', hair: '#261c16' };
    this.localAvatar = buildHighQualityAngler(this.localAvatarOpt, false);
    this.localAvatar.position.set(0, 0.0, 0.0);
    this.localWalkPhase = 0;
    this.bodyYaw = 0;
    this.playerRig.add(this.localAvatar);

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
    this.waveDir = { x: 0.45, z: 0.89 };
    this.waveChoppiness = 0.52;
    this.waveSeed = 1.0;
    this.bobberSplashAt = -99;
    this.bobberWorldPos = new THREE.Vector2(0, -10);
    this.wallSprayAcc = 0;
    this.biteSprayAcc = 0;
    this.initWaveEffects();

    this.parkedBoat = buildRealisticBoatModel(0xc2410c, true);
    this.parkedBoat.visible = true;
    this.parkedBoat.position.set(6.4, 0.08, -10.2);
    this.parkedBoat.rotation.y = Math.PI * 0.04;
    this.scene.add(this.parkedBoat);

    this.portLight = new THREE.PointLight(0xffb85c, 0, 32);
    this.portLight.position.set(0, 5.2, 2.0);
    this.playerRig.add(this.portLight);

    // リアル釣り竿
    // 釣り竿をアバター右手に装着（前へ伸びた腕の手先から海側＆やや上向きに構える）
    this.rodGroup = new THREE.Group();
    const rodShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.036, 2.75, 10),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x1e293b, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.35 })
    );
    rodShaft.rotation.x = -Math.PI * 0.36;
    rodShaft.position.set(0.0, 0.55, -1.22);

    const rodTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.022, 0.75, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5722, emissive: 0x8a2200, roughness: 0.25 })
    );
    rodTip.rotation.x = -Math.PI * 0.36;
    rodTip.position.set(0.0, 1.22, -2.32);

    const reel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.068, 0.085, 12),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.6, roughness: 0.25 })
    );
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0.0, 0.16, -0.45);

    this.rodTipObj = new THREE.Object3D();
    this.rodTipObj.position.set(0.0, 1.46, -2.68);

    this.rodGroup.add(rodShaft, rodTip, reel, this.rodTipObj);
    this.rodGroup.position.set(0.0, -0.58, 0.0);
    this.rodGroup.visible = false;
    const rArm = this.localAvatar?.userData?.rig?.rightArm;
    if (rArm) rArm.add(this.rodGroup);
    else this.playerRig.add(this.rodGroup);

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

    this.remoteGroup = new THREE.Group();
    this.scene.add(this.remoteGroup);
    this.remoteAvatars = new Map();

    this.clock = new THREE.Clock();
    this.rodBend = 0; this.bobberDip = 0; this.bobberDist = 18; this.waveAmp = 1.0;
    this.pos = new THREE.Vector2(0, 4); this.yaw = 0;
    this.isBoating = false; this.boatSpeed = 1.2; this.boatTier = 0;
    this.moveInput = { x: 0, y: 0 }; this.autopilot = false;
    this.onFuelConsume = null; this.onBlocked = null; this.lastBlockAt = 0;

    // 原神風：上下左右360°オービット視点＋2本指ピンチ＆ホイールズーム＋マルチタッチ分離
    this.targetYaw = this.yaw;
    this.camPitch = 0.27;
    this.targetPitch = 0.27;
    this.camDist = 4.7;
    this.targetCamDist = 4.7;
    canvas.style.touchAction = "none";

    const camPointers = new Map();
    let pinchStartDist = 0;
    let pinchStartCamDist = this.targetCamDist;

    const getDistRange = () => (this.isBoating ? [4.2, 11.5] : [2.3, 7.6]);

    canvas.addEventListener("pointerdown", (e) => {
      camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (camPointers.size === 2) {
        const pts = [...camPointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartCamDist = this.targetCamDist;
      }
    });

    window.addEventListener("pointermove", (e) => {
      if (!camPointers.has(e.pointerId)) return;
      const prev = camPointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (camPointers.size === 1) {
        this.targetYaw -= dx * 0.0062;
        this.targetPitch = Math.max(-0.32, Math.min(1.12, this.targetPitch + dy * 0.0052));
      } else if (camPointers.size === 2) {
        const pts = [...camPointers.values()];
        const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStartDist > 12) {
          const [minD, maxD] = getDistRange();
          const scale = pinchStartDist / Math.max(12, curDist);
          this.targetCamDist = Math.max(minD, Math.min(maxD, pinchStartCamDist * scale));
        }
      }
    });

    const releaseCamPointer = (e) => {
      camPointers.delete(e.pointerId);
      if (camPointers.size < 2) pinchStartDist = 0;
    };
    window.addEventListener("pointerup", releaseCamPointer);
    window.addEventListener("pointercancel", releaseCamPointer);

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [minD, maxD] = getDistRange();
      this.targetCamDist = Math.max(minD, Math.min(maxD, this.targetCamDist + e.deltaY * 0.004));
    }, { passive: false });
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
      new THREE.SphereGeometry(460, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false
      })
    );
    this.scene.add(this.skyDome);

    this.celestialDisc = new THREE.Mesh(
      new THREE.SphereGeometry(9.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false })
    );
    this.scene.add(this.celestialDisc);

    const starCount = 340;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.12 + Math.random() * 0.88);
      const r = 390;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xe2f1ff, size: 2.1, transparent: true, opacity: 0.0, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.stars);

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
      cg.position.set((Math.random() - 0.5) * 440, 66 + Math.random() * 34, -260 + Math.random() * 360);
      this.scene.add(cg);
      this.clouds.push({ group: cg, speed: 1.4 + Math.random() * 1.6 });
    }

    this.seagulls = [];
    const gullMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6, side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.95, 0.28);
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const leftW = new THREE.Mesh(wingGeo, gullMat);
      leftW.position.x = -0.45;
      const rightW = new THREE.Mesh(wingGeo, gullMat);
      rightW.position.x = 0.45;
      g.add(leftW, rightW);
      this.scene.add(g);
      this.seagulls.push({
        group: g, leftW, rightW,
        cx: -35 + i * 14, cz: -18 - (i % 3) * 18,
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
    const roadTex = createAsphaltRoadTexture(26, 1);
    const stoneTex = createStoneWallTexture(26, 2);
    const flagTex = createFlagTexture();

    const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.88, metalness: 0.05 });
    const darkConcreteMat = new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.94 });
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.82 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.42, metalness: 0.65 });
    const whiteRailMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45, metalness: 0.25 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });
    const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.92 });
    const tetraMat = new THREE.MeshStandardMaterial({ color: 0x7a828c, roughness: 0.92 });

    // ===== 1. 港・堤防（護岸＋白線＋車止め＋防舷材＋係留ボラード） =====
    const portDeck = new THREE.Mesh(new THREE.BoxGeometry(74, 1.5, 44), concreteMat);
    portDeck.position.set(0, 0.25, 22);
    const seaWallBase = new THREE.Mesh(new THREE.BoxGeometry(74.4, 0.65, 44.4), darkConcreteMat);
    seaWallBase.position.set(0, -0.15, 22);
    const warnLine = new THREE.Mesh(
      new THREE.BoxGeometry(74, 0.05, 0.38),
      new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.7 })
    );
    warnLine.position.set(0, 1.01, 0.55);
    world.add(portDeck, seaWallBase, warnLine);

    for (let x = -33; x <= 33; x += 6) {
      if (Math.abs(x) < 6) continue;
      const curb = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.24, 0.42), darkConcreteMat);
      curb.position.set(x, 1.12, 0.28);
      const bollardBase = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.55, 10), metalMat);
      bollardBase.position.set(x + 2.2, 1.25, 0.75);
      const bollardTop = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.14, 10), metalMat);
      bollardTop.position.set(x + 2.2, 1.54, 0.75);
      const fender = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 0.28), rubberMat);
      fender.position.set(x, 0.32, -0.14);
      world.add(curb, bollardBase, bollardTop, fender);
    }

    // ===== 2. 木製桟橋（板張り＋木杭＋常夜灯） =====
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
    [-4.1, 4.1].forEach((px) => {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xffa834, emissiveIntensity: 0.8 })
      );
      lamp.position.set(px, 2.08, -14.8);
      world.add(lamp);
      this.nightEmissives.push(lamp.material);
    });

    // ===== 3. 港の街灯 =====
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
      if (idx < 3) {
        const pt = new THREE.PointLight(0xffb454, 0, 28, 1.6);
        pt.position.set(lx, 5.8, lz - 1.1);
        world.add(pt);
        this.nightLights.push(pt);
      }
    });

    // ===== 4. 港湾設備（荷揚げクレーン・漁協軽トラ・自販機コーナー・漁具の山） =====
    // 4-1 荷揚げジブクレーン（西側岸壁 -31, 3.2）
    const craneGrp = new THREE.Group();
    craneGrp.position.set(-31.0, 1.0, 3.2);
    const craneMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.45, metalness: 0.35 });
    const cBase = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 1.2, 10), darkConcreteMat);
    cBase.position.y = 0.6;
    const cPost = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 5.2, 10), craneMat);
    cPost.position.y = 3.2;
    const cBoom = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 5.8), craneMat);
    cBoom.position.set(0, 6.4, -2.2);
    cBoom.rotation.x = 0.28;
    const cWire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 6), metalMat);
    cWire.position.set(0, 5.5, -4.6);
    const cHook = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 6, 12, Math.PI * 1.4), darkConcreteMat);
    cHook.position.set(0, 3.8, -4.6);
    craneGrp.add(cBase, cPost, cBoom, cWire, cHook);
    world.add(craneGrp);

    // 4-2 魚市場脇の漁協軽トラック（-31.0, 19.8）
    const truck = buildKeiTruck();
    truck.position.set(-31.0, 1.0, 19.8);
    truck.rotation.y = 0.08;
    world.add(truck);

    // 4-3 港の自販機コーナー＆ベンチ（7.0, 27.5：夜間に光ってリアル！）
    const vendGrp = new THREE.Group();
    vendGrp.position.set(WORLD_LAYOUT.portVendX, 1.0, WORLD_LAYOUT.portVendZ);
    [[-0.85, 0x0284c7], [0.85, 0xdc2626]].forEach(([vx, vcol]) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.25, 0.95), new THREE.MeshStandardMaterial({ color: vcol, roughness: 0.4 }));
      body.position.set(vx, 1.12, 0);
      const dispMat = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0xbae6fd, emissiveIntensity: 0.65 });
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.92), dispMat);
      disp.position.set(vx, 1.45, -0.49);
      disp.rotation.y = Math.PI;
      this.nightEmissives.push(dispMat);
      vendGrp.add(body, disp);
    });
    world.add(vendGrp);

    // 4-4 岸壁の漁具・魚箱・赤い浮き玉の山（-16.5, 2.3 と 15.5, 2.3）
    const addGearPile = (gx, gz) => {
      const pg = new THREE.Group();
      pg.position.set(gx, 1.0, gz);
      const netMound = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.95, 1),
        new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.95 })
      );
      netMound.scale.set(1.2, 0.62, 1.0);
      netMound.position.set(0, 0.42, 0);
      pg.add(netMound);
      for (let i = 0; i < 3; i++) {
        const buoy = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 10, 10),
          new THREE.MeshStandardMaterial({ color: i === 0 ? 0xf97316 : 0xef4444, roughness: 0.35 })
        );
        buoy.position.set(-0.65 + i * 0.45, 0.24, -0.65 + (i % 2) * 0.35);
        pg.add(buoy);
      }
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.52, 0.68), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.7 }));
      crate.position.set(0.65, 0.26, 0.42);
      pg.add(crate);
      world.add(pg);
    };
    addGearPile(-16.5, 2.3);
    addGearPile(15.5, 2.3);

    // ===== 5. 回転サーチライト付き灯台 =====
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

    // ===== 6. 港の主要店舗（魚市場・寿司処 凪・岬の水族館） =====
    const marketGrp = new THREE.Group();
    marketGrp.position.set(-21.0, 1.0, 20.5);
    const mBody = new THREE.Mesh(new THREE.BoxGeometry(16, 5.6, 10), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.78 }));
    mBody.position.y = 2.8;
    const mRoof = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.7, 11.4), new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.55 }));
    mRoof.position.y = 5.9;
    const mAwning = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.25, 2.8), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 }));
    mAwning.position.set(0, 3.6, -5.8);
    mAwning.rotation.x = 0.2;
    const mSign = new THREE.Mesh(
      new THREE.PlaneGeometry(8.5, 2.3),
      new THREE.MeshBasicMaterial({ map: createSignTexture("🐟 港の魚市場", "新鮮地魚・漁協直売所", "#0f2942", "#ffffff", "#38bdf8") })
    );
    mSign.position.set(0, 5.05, -5.06);
    mSign.rotation.y = Math.PI;
    const mDoor = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.0, 0.2), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 }));
    mDoor.position.set(0, 1.5, -5.02);
    for (let i = 0; i < 4; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.65, 0.9),
        new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xf8fafc : 0x0284c7, roughness: 0.65 })
      );
      box.position.set(-5.8 + i * 1.45, 0.35, -5.9);
      marketGrp.add(box);
    }
    // 店頭の「地魚」のぼり旗×2
    const noboriTex = createSignTexture("活魚", "直送", "#dc2626", "#ffffff", "#facc15");
    [-7.2, 7.2].forEach((nx) => {
      const npole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 3.6, 6), whiteRailMat);
      npole.position.set(nx, 1.8, -6.2);
      const ncloth = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 2.0), new THREE.MeshBasicMaterial({ map: noboriTex, side: THREE.DoubleSide }));
      ncloth.position.set(nx + 0.44, 2.4, -6.2);
      marketGrp.add(npole, ncloth);
    });
    marketGrp.add(mBody, mRoof, mAwning, mSign, mDoor);
    world.add(marketGrp);

    const sushiGrp = new THREE.Group();
    sushiGrp.position.set(-2.2, 1.0, 24.5);
    const sBody = new THREE.Mesh(new THREE.BoxGeometry(11.5, 4.6, 8.2), new THREE.MeshStandardMaterial({ color: 0x5c3d24, roughness: 0.85 }));
    sBody.position.y = 2.3;
    const sRoof = new THREE.Mesh(new THREE.ConeGeometry(8.6, 2.8, 4), new THREE.MeshStandardMaterial({ map: createRoofTileTexture("#23272f", 3, 2), roughness: 0.65 }));
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

    const aqGrp = new THREE.Group();
    aqGrp.position.set(19.5, 1.0, 23.0);
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

    // ===== 7. 電柱と電線（道路・ガードレールは buildTraffic で1本だけ綺麗に構築） =====
    const poleXs = WORLD_LAYOUT.poleXs;
    const poleZ = WORLD_LAYOUT.poleZ;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.9 });
    const wireMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.72 });

    poleXs.forEach((px) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 10.2, 8), poleMat);
      pole.position.set(px, 6.0, poleZ);
      const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 2.2), metalMat);
      arm1.position.set(px, 10.4, poleZ);
      const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.8), metalMat);
      arm2.position.set(px, 9.4, poleZ);
      const trans = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.82, 8), darkConcreteMat);
      trans.position.set(px + 0.34, 8.6, poleZ);
      world.add(pole, arm1, arm2, trans);
    });
    for (let i = 0; i < poleXs.length - 1; i++) {
      const x1 = poleXs[i], x2 = poleXs[i + 1];
      [[-0.85, 10.45], [0.85, 10.45], [0.0, 9.45]].forEach(([zOff, yTop]) => {
        const pts = [];
        for (let s = 0; s <= 10; s++) {
          const f = s / 10;
          const sag = Math.sin(f * Math.PI) * 0.95;
          pts.push(new THREE.Vector3(THREE.MathUtils.lerp(x1, x2, f), yTop - sag, poleZ + zOff));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        world.add(new THREE.Line(geo, wireMat));
      });
    }

    // ===== 8. 段丘に建ち並ぶ港町の家並み＆高台の神社（日本の漁村風景） =====
    // 1段目＆2段目の石垣段丘
    const terrace1 = new THREE.Mesh(new THREE.BoxGeometry(295, 4.2, 22), stoneMat);
    terrace1.position.set(-5, 2.6, 72.5);
    const terrace1Top = new THREE.Mesh(new THREE.BoxGeometry(295, 0.25, 22), concreteMat);
    terrace1Top.position.set(-5, 4.72, 72.5);
    const terrace2 = new THREE.Mesh(new THREE.BoxGeometry(285, 9.6, 28), stoneMat);
    terrace2.position.set(-5, 5.4, 97.5);
    const terrace2Top = new THREE.Mesh(new THREE.BoxGeometry(285, 0.3, 28), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }));
    terrace2Top.position.set(-5, 10.22, 97.5);
    world.add(terrace1, terrace1Top, terrace2, terrace2Top);

    // 民家・漁協倉庫・海辺の民宿の共有マテリアル
    const wallMats = [
      new THREE.MeshStandardMaterial({ map: createHouseWallTexture("#ebe5d8", "#4f3a2c"), roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: createHouseWallTexture("#d8dfe6", "#374151"), roughness: 0.82 }),
      new THREE.MeshStandardMaterial({ map: createHouseWallTexture("#e8d5bd", "#6b4423"), roughness: 0.88 }),
      new THREE.MeshStandardMaterial({ map: createHouseWallTexture("#cbd5e1", "#1e3a5f"), roughness: 0.78 })
    ];
    const roofMats = [
      new THREE.MeshStandardMaterial({ map: createRoofTileTexture("#202630", 3, 2), roughness: 0.65 }),
      new THREE.MeshStandardMaterial({ map: createRoofTileTexture("#1e3a5f", 3, 2), roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ map: createRoofTileTexture("#5c2a24", 3, 2), roughness: 0.68 }),
      new THREE.MeshStandardMaterial({ map: createRoofTileTexture("#3b444f", 3, 2), roughness: 0.72 })
    ];
    const winWarmMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0xffc864, emissiveIntensity: 0.0 });
    const winCoolMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0xdbeafe, emissiveIntensity: 0.0 });
    this.townWindowMats.push(winWarmMat, winCoolMat);

    // 決定論的疑似乱数で美しい港町の街並みを自動生成（約54棟）
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

    const addTownHouse = (hx, baseY, hz, isTall = false) => {
      const hw = 6.2 + rand() * 4.4;
      const hd = 5.4 + rand() * 3.6;
      const hh = isTall ? (7.8 + rand() * 4.2) : (4.2 + rand() * 2.8);
      const wMat = wallMats[Math.floor(rand() * wallMats.length)];
      const rMat = roofMats[Math.floor(rand() * roofMats.length)];

      const hg = new THREE.Group();
      hg.position.set(hx, baseY, hz);
      hg.rotation.y = (rand() - 0.5) * 0.14;

      const body = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), wMat);
      body.position.y = hh * 0.5;
      hg.add(body);

      if (isTall) {
        // 海辺の民宿・鉄筋マンション（陸屋根＋手すり）
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(hw + 0.35, 0.55, hd + 0.35), darkConcreteMat);
        parapet.position.y = hh + 0.25;
        hg.add(parapet);
      } else {
        // 日本の瓦屋根（切妻・寄棟）
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(hw, hd) * 0.78, 2.2 + rand() * 1.1, 4), rMat);
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(hw / Math.max(hw, hd), 1, hd / Math.max(hw, hd));
        roof.position.y = hh + 1.15;
        hg.add(roof);
      }

      // 海側（-Z面）に夜光る窓パネルを配置
      const winCount = isTall ? 3 : 2;
      const floors = isTall ? 2 : 1;
      for (let f = 0; f < floors; f++) {
        for (let k = 0; k < winCount; k++) {
          if (rand() < 0.22) continue;
          const wMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1.25, 1.05),
            rand() < 0.72 ? winWarmMat : winCoolMat
          );
          const wx = ((k + 0.5) / winCount - 0.5) * (hw * 0.72);
          const wy = hh * (floors === 2 ? (0.34 + f * 0.38) : 0.62);
          wMesh.position.set(wx, wy, -hd * 0.5 - 0.04);
          wMesh.rotation.y = Math.PI;
          hg.add(wMesh);
        }
      }
      world.add(hg);
    };

    // 1段目（道路のすぐ山側：商店・漁協倉庫・海辺の民家 26棟）
    for (let x = -118; x <= 110; x += 9.2) {
      const jitterX = (rand() - 0.5) * 2.2;
      const jitterZ = 65.5 + rand() * 8.5;
      addTownHouse(x + jitterX, 4.8, jitterZ, rand() < 0.2);
    }
    // 2段目（高台の漁村住宅街＆海辺の旅館 24棟）
    for (let x = -124; x <= 116; x += 10.2) {
      if (Math.abs(x - 14) < 12) continue; // 高台の神社スペースを空ける
      const jitterX = (rand() - 0.5) * 2.8;
      const jitterZ = 89.5 + rand() * 14.5;
      addTownHouse(x + jitterX, 10.3, jitterZ, rand() < 0.18);
    }

    // 高台の海見神社（朱色の鳥居＋石段＋社殿）
    const shrineGrp = new THREE.Group();
    shrineGrp.position.set(14, 10.35, 90.0);
    const toriiMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45 });
    const tL = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 5.2, 8), toriiMat);
    tL.position.set(-1.9, 2.6, -4.5);
    const tR = tL.clone(); tR.position.x = 1.9;
    const tTop = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.45, 0.55), toriiMat);
    tTop.position.set(0, 5.2, -4.5);
    const tSub = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.28, 0.35), toriiMat);
    tSub.position.set(0, 4.3, -4.5);
    const shMain = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.6, 5.2), new THREE.MeshStandardMaterial({ color: 0x7c4a26, roughness: 0.85 }));
    shMain.position.set(0, 1.8, 2.2);
    const shRoof = new THREE.Mesh(new THREE.ConeGeometry(5.8, 2.5, 4), roofMats[0]);
    shRoof.rotation.y = Math.PI / 4;
    shRoof.position.set(0, 4.8, 2.2);
    shrineGrp.add(tL, tR, tTop, tSub, shMain, shRoof);
    world.add(shrineGrp);

    // ===== 9. 沖防波堤（左右の一文字堤防＋赤白の港入口灯台＋テトラポッド） =====
    const buildBreakwater = (cx, tipX, isRedLight) => {
      const bw = new THREE.Mesh(new THREE.BoxGeometry(55, 2.8, 5.6), concreteMat);
      bw.position.set(cx, 0.9, -43.5);
      const bwCap = new THREE.Mesh(new THREE.BoxGeometry(55.4, 0.45, 6.0), darkConcreteMat);
      bwCap.position.set(cx, 2.35, -43.5);
      world.add(bw, bwCap);

      // 外洋側（-Z側）に消波テトラポッドを並べる
      const startX = cx - 25;
      for (let i = 0; i < 11; i++) {
        const tp = createTetrapod(tetraMat, 1.25);
        tp.position.set(startX + i * 4.8, 0.85, -47.0);
        tp.rotation.set(i * 0.7, i * 1.2, i * 0.5);
        world.add(tp);
      }

      // 港入口先端の赤灯台（東） / 白灯台（西）
      const colHex = isRedLight ? 0xdc2626 : 0xf8fafc;
      const lampHex = isRedLight ? 0xff4444 : 0x4ade80;
      const mlh = new THREE.Group();
      mlh.position.set(tipX, 2.55, -43.5);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.35, 6.8, 12), new THREE.MeshStandardMaterial({ color: colHex, roughness: 0.45 }));
      tower.position.y = 3.4;
      const topCap = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.05, 0.35, 12), metalMat);
      topCap.position.y = 6.9;
      const lampMat = new THREE.MeshBasicMaterial({ color: lampHex });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 10), lampMat);
      lamp.position.y = 7.55;
      mlh.add(tower, topCap, lamp);
      world.add(mlh);
      this.buoyLamps.push({ lamp, phase: isRedLight ? 0.0 : Math.PI });
    };
    buildBreakwater(-49.5, -23.0, false); // 西防波堤＆白灯台
    buildBreakwater(49.5, 23.0, true);    // 東防波堤＆赤灯台

    // ===== 10. 係留漁船（大漁旗＋岸壁ボラードへ結ぶ係留ロープ付き） =====
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xd6c3a5 });
    const dockedSpecs = [
      { x: -17, z: -7.5, yaw: Math.PI * 0.48, col: 0x0284c7, bx: -18.8, hasFlag: true },
      { x: -29, z: -8.2, yaw: Math.PI * 0.52, col: 0x0f766e, bx: -30.8, hasFlag: false },
      { x: 18,  z: -7.8, yaw: -Math.PI * 0.48, col: 0xb45309, bx: 17.2, hasFlag: true }
    ];
    dockedSpecs.forEach((ds, idx) => {
      const b = buildRealisticBoatModel(ds.col, true, ds.hasFlag ? flagTex : null);
      b.position.set(ds.x, 0.08, ds.z);
      b.rotation.y = ds.yaw;
      world.add(b);
      this.dockedBoats.push({ mesh: b, phase: idx * 1.7 });
      b.traverse((obj) => { if (obj.userData?.isFlag) this.flags.push({ mesh: obj, phase: idx * 2.1 }); });

      // 岸壁ボラードから船首への係留ロープ
      const rPts = [
        new THREE.Vector3(ds.bx, 1.35, 0.75),
        new THREE.Vector3((ds.bx + ds.x) * 0.5, 0.65, ds.z * 0.48),
        new THREE.Vector3(ds.x, 0.75, ds.z + 1.2)
      ];
      world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rPts), ropeMat));
    });

    // ===== 11. 白砂の砂浜・清流の河口・荒波の磯場 =====
    const beach = new THREE.Mesh(new THREE.BoxGeometry(74, 1.15, 46), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.94 }));
    beach.position.set(-73, 0.08, 22);
    world.add(beach);

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

    const riverBank = new THREE.Mesh(new THREE.BoxGeometry(66, 1.25, 48), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.94 }));
    riverBank.position.set(-142, 0.12, 26);
    const riverWater = new THREE.Mesh(new THREE.BoxGeometry(16, 1.32, 52), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.16, metalness: 0.35 }));
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

    const isoBase = new THREE.Mesh(new THREE.BoxGeometry(110, 1.35, 46), new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.95 }));
    isoBase.position.set(92, 0.16, 22);
    world.add(isoBase);

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

    // ===== 12. 港町の背後に連なる自然な連山（起伏付きメッシュ） =====
    const buildMountainRange = (zCenter, width, depth, maxH, colHex, freq) => {
      const geo = new THREE.PlaneGeometry(width, depth, 48, 12);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vz = pos.getZ(i);
        const edgeX = 1.0 - Math.pow(Math.abs(vx) / (width * 0.5), 2.4);
        const edgeZ = Math.sin(((vz + depth * 0.5) / depth) * Math.PI);
        const ridge =
          Math.sin(vx * freq + 0.5) * 0.42 +
          Math.cos(vx * freq * 2.1 - 1.2) * 0.28 +
          Math.sin(vx * freq * 4.3 + vz * 0.08) * 0.12 + 0.68;
        const h = Math.max(0, edgeX * edgeZ * ridge * maxH);
        pos.setY(i, h);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: colHex, roughness: 0.95, flatShading: true })
      );
      mesh.position.set(0, 6.5, zCenter);
      world.add(mesh);
    };
    buildMountainRange(140, 440, 76, 52, 0x244734, 0.022);
    buildMountainRange(180, 540, 92, 82, 0x2c4b57, 0.017);

    // ===== 13. 沖のランドマーク（南国島・遠景島影・航路ブイ） =====
    const tropicalIsland = new THREE.Group();
    tropicalIsland.position.set(145, 0, -295);
    const islSand = new THREE.Mesh(new THREE.CylinderGeometry(20, 32, 4.5, 16), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.9 }));
    islSand.position.y = 0.8;
    const islHill = new THREE.Mesh(new THREE.ConeGeometry(16, 13, 10), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.88, flatShading: true }));
    islHill.position.y = 7.2;
    tropicalIsland.add(islSand, islHill);
    world.add(tropicalIsland);

    const farMtnMat = new THREE.MeshStandardMaterial({ color: 0x33535c, roughness: 0.96, flatShading: true });
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
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), new THREE.MeshBasicMaterial({ color: col }));
      lamp.position.y = 4.6;
      bg.add(body, topCage, lamp);
      world.add(bg);
      this.buoyLamps.push({ lamp, phase: x * 0.1 });
    };
    addBuoy(-125, -280, 0x818cf8);
    addBuoy(0, -290, 0xf97316);
    addBuoy(-62, -135, 0x22c55e);
    addBuoy(68, -140, 0xef4444);

    this.buildTraffic(world);
    this.buildRailway(world);
    this.scene.add(world);
  }

  // ===== 港の道路・車・バス・大型トラック・動く信号機・踏切・電車・駅（WORLD_LAYOUT完全連動） =====
  createVehicleModel(type, bodyColor) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.36, metalness: 0.28 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.38, metalness: 0.2 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.14, metalness: 0.7 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4, metalness: 0.65 });

    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
    wheelGeo.rotateX(Math.PI / 2);
    const addWheels = (xs, zOff) => {
      xs.forEach((wx) => {
        [-zOff, zOff].forEach((wz) => {
          const w = new THREE.Mesh(wheelGeo, wheelMat);
          w.position.set(wx, 0.42, wz);
          g.add(w);
        });
      });
    };

    let frontX = 2.1;
    let backX = -2.1;

    if (type === "keitora") {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.35, 1.7), cabinMat);
      cab.position.set(1.1, 1.15, 0);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 1.48), glassMat);
      wind.position.set(1.82, 1.32, 0);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.45, 1.72), cabinMat);
      bed.position.set(-0.85, 0.78, 0);
      const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 0.72), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 }));
      crate1.position.set(-0.6, 1.22, -0.35);
      const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 0.72), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.6 }));
      crate2.position.set(-1.35, 1.22, 0.3);
      g.add(cab, wind, bed, crate1, crate2);
      addWheels([-1.15, 1.1], 0.85);
      frontX = 1.88;
      backX = -2.05;
    } else if (type === "truck") {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.7, 2.05), bodyMat);
      cab.position.set(2.05, 1.32, 0);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.72, 1.8), glassMat);
      wind.position.set(2.9, 1.56, 0);
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(3.85, 2.15, 2.18), cabinMat);
      cargo.position.set(-0.82, 1.68, 0);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.88, 0.32, 2.2), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 }));
      stripe.position.set(-0.82, 1.45, 0);
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.35, 2.08), metalMat);
      bumper.position.set(2.96, 0.62, 0);
      g.add(cab, wind, cargo, stripe, bumper);
      addWheels([-1.75, 1.85], 1.05);
      frontX = 3.0;
      backX = -2.76;
    } else if (type === "bus") {
      const busBody = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2.35, 2.3), cabinMat);
      busBody.position.set(0, 1.72, 0);
      const busStripe = new THREE.Mesh(new THREE.BoxGeometry(8.46, 0.56, 2.34), bodyMat);
      busStripe.position.set(0, 1.05, 0);
      const busTopBand = new THREE.Mesh(new THREE.BoxGeometry(8.44, 0.24, 2.32), bodyMat);
      busTopBand.position.set(0, 2.75, 0);
      const acUnit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.34, 1.45), metalMat);
      acUnit.position.set(-0.3, 3.04, 0);
      const winGlowMat = new THREE.MeshStandardMaterial({
        color: 0x334155, emissive: 0xffd27d, emissiveIntensity: 0.2, roughness: 0.18, metalness: 0.45
      });
      this.nightEmissives.push(winGlowMat);
      const frontWin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 2.02), glassMat);
      frontWin.position.set(4.18, 2.02, 0);
      const destSign = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.28, 1.35),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
      );
      destSign.position.set(4.18, 2.72, 0);
      const sideWin = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.92, 2.34), winGlowMat);
      sideWin.position.set(-0.2, 2.05, 0);
      for (let wx = -2.8; wx <= 2.4; wx += 1.3) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.94, 2.36), cabinMat);
        pil.position.set(wx, 2.05, 0);
        g.add(pil);
      }
      g.add(busBody, busStripe, busTopBand, acUnit, frontWin, destSign, sideWin);
      addWheels([-2.55, 2.65], 1.12);
      frontX = 4.24;
      backX = -4.24;
    } else if (type === "bigtruck") {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.15, 2.25, 2.25), bodyMat);
      cab.position.set(3.45, 1.66, 0);
      const deflector = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 2.1), bodyMat);
      deflector.position.set(3.2, 3.02, 0);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.88, 2.0), glassMat);
      wind.position.set(4.5, 2.0, 0);
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.75, 2.38), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.45 }));
      cargo.position.set(-1.1, 2.08, 0);
      const cargoBand = new THREE.Mesh(new THREE.BoxGeometry(6.54, 0.36, 2.4), bodyMat);
      cargoBand.position.set(-1.1, 1.85, 0);
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 2.28), metalMat);
      bumper.position.set(4.56, 0.68, 0);
      g.add(cab, deflector, wind, cargo, cargoBand, bumper);
      addWheels([-3.25, -1.95, 3.2], 1.15);
      frontX = 4.58;
      backX = -4.38;
    } else {
      const lower = new THREE.Mesh(new THREE.BoxGeometry(4.15, 0.74, 1.88), bodyMat);
      lower.position.set(0, 0.76, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.66, 1.66), bodyMat);
      upper.position.set(-0.15, 1.42, 0);
      const winF = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, 1.52), glassMat);
      winF.position.set(0.96, 1.4, 0);
      const winB = winF.clone();
      winB.position.x = -1.26;
      const winSide = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.46, 1.7), glassMat);
      winSide.position.set(-0.15, 1.42, 0);
      g.add(lower, upper, winF, winB, winSide);
      addWheels([-1.28, 1.28], 0.92);
      frontX = 2.08;
      backX = -2.08;
    }

    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff7cc });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    [-0.64, 0.64].forEach((lz) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.34), headMat);
      hl.position.set(frontX, 0.78, lz);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.34), tailMat);
      tl.position.set(backX, 0.8, lz);
      g.add(hl, tl);
    });

    const beamGeo = new THREE.ConeGeometry(1.75, 9.5, 10, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(4.8, 0, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff3b0, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const beamL = new THREE.Mesh(beamGeo, beamMat);
    beamL.position.set(frontX, 0.74, -0.58);
    const beamR = new THREE.Mesh(beamGeo, beamMat);
    beamR.position.set(frontX, 0.74, 0.58);
    g.add(beamL, beamR);
    this.carBeamMats.push(beamMat);

    return g;
  }

  buildTraffic(world) {
    const L = WORLD_LAYOUT;
    const roadTex = createAsphaltRoadTexture(26, 1);
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.88 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 });
    const guardMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45, metalness: 0.3 });

    // 海沿い道路（1本のみ・z: 34.4〜41.6）
    const backRoad = new THREE.Mesh(new THREE.BoxGeometry(300, 0.1, 7.2), roadMat);
    backRoad.position.set(-10, 1.0, L.roadCenterZ);
    world.add(backRoad);

    // ガードレール（1重のみ・横断歩道 x: 3.2〜10.8 を綺麗に開口）
    const addGuardSection = (x1, x2, zPos) => {
      if (x2 <= x1 + 0.5) return;
      const len = x2 - x1;
      const cx = (x1 + x2) / 2;
      const rMesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.32, 0.14), guardMat);
      rMesh.position.set(cx, 1.66, zPos);
      world.add(rMesh);
      for (let x = x1 + 1.2; x <= x2 - 0.8; x += 6.0) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.92, 6), guardMat);
        post.position.set(x, 1.38, zPos);
        world.add(post);
      }
    };
    addGuardSection(-157, L.crosswalkMinX - 0.1, L.roadMinZ);
    addGuardSection(L.crosswalkMaxX + 0.1, 137, L.roadMinZ);
    addGuardSection(-157, L.crosswalkMinX - 0.1, L.roadMaxZ);
    addGuardSection(L.crosswalkMaxX + 0.1, 137, L.roadMaxZ);

    // 交差点・横断歩道・信号機・向こう側歩道
    this.buildIntersection(world, roadMat, lineMat, guardMat);

    // 港前バス停（横断歩道の右脇・導線の外）
    const stopPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8), guardMat);
    stopPole.position.set(L.busStopX, 2.25, L.busStopZ);
    const stopSign = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.08, 14),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 })
    );
    stopSign.rotation.x = Math.PI / 2;
    stopSign.position.set(L.busStopX, 3.35, L.busStopZ);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.48, 0.55), new THREE.MeshStandardMaterial({ color: 0x78563a, roughness: 0.85 }));
    bench.position.set(L.busStopX + 1.9, 1.24, L.busStopZ);
    world.add(stopPole, stopSign, bench);

    // 海沿い道路をたまに通過する車両ラインナップ（港内道路は撤去済み）
    const specs = [
      { type: "car",      color: 0xdc2626, z: 36.4, dir: 1,  minX: -165, maxX: 145, speed: 14.8, waitMin: 10, waitMax: 24, inPort: false, initDelay: 3.0 },
      { type: "car",      color: 0xe2e8f0, z: 39.6, dir: -1, minX: -165, maxX: 145, speed: 15.2, waitMin: 12, waitMax: 26, inPort: false, initDelay: 11.0 },
      { type: "truck",    color: 0x0f766e, z: 36.4, dir: 1,  minX: -165, maxX: 145, speed: 11.8, waitMin: 18, waitMax: 34, inPort: false, initDelay: 20.0 },
      { type: "keitora",  color: 0xfef3c7, z: 39.6, dir: -1, minX: -165, maxX: 145, speed: 12.6, waitMin: 16, waitMax: 32, inPort: false, initDelay: 28.0 },
      { type: "bus",      color: 0x0284c7, z: 36.4, dir: 1,  minX: -175, maxX: 155, speed: 10.8, waitMin: 24, waitMax: 44, inPort: false, initDelay: 8.0 },
      { type: "bus",      color: 0x16a34a, z: 39.6, dir: -1, minX: -175, maxX: 155, speed: 11.2, waitMin: 28, waitMax: 48, inPort: false, initDelay: 25.0 },
      { type: "bigtruck", color: 0x1e3a8a, z: 36.4, dir: 1,  minX: -175, maxX: 155, speed: 10.0, waitMin: 26, waitMax: 46, inPort: false, initDelay: 16.0 },
      { type: "bigtruck", color: 0x991b1b, z: 39.6, dir: -1, minX: -175, maxX: 155, speed: 10.4, waitMin: 30, waitMax: 52, inPort: false, initDelay: 35.0 }
    ];

    specs.forEach((s) => {
      const mesh = this.createVehicleModel(s.type, s.color);
      mesh.visible = false;
      mesh.position.set(s.dir > 0 ? s.minX : s.maxX, 1.0, s.z);
      mesh.rotation.y = s.dir > 0 ? 0 : Math.PI;
      world.add(mesh);
      this.trafficVehicles.push({
        ...s,
        mesh,
        active: false,
        cooldown: s.initDelay,
        halfLen: (s.type === "bus" || s.type === "bigtruck") ? 4.5 : (s.type === "truck" ? 3.1 : 2.2),
        halfWid: (s.type === "bus" || s.type === "bigtruck") ? 1.3 : (s.type === "truck" ? 1.25 : 1.05)
      });
    });
  }

  buildIntersection(world, roadMat, lineMat, guardMat) {
    const L = WORLD_LAYOUT;
    const cx = L.crosswalkCenterX;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.45, metalness: 0.65 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55, metalness: 0.3 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x737b86, roughness: 0.9 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });

    // 向こう側歩道（z: 41.6〜48.2）
    const northWalk = new THREE.Mesh(new THREE.BoxGeometry(78, 1.48, 6.8), sidewalkMat);
    northWalk.position.set(0, 0.28, 44.9);
    const northCurbL = new THREE.Mesh(new THREE.BoxGeometry(40.2, 0.14, 0.28), curbMat);
    northCurbL.position.set(-17.0, 1.04, L.roadMaxZ + 0.08);
    const northCurbR = new THREE.Mesh(new THREE.BoxGeometry(26.2, 0.14, 0.28), curbMat);
    northCurbR.position.set(24.0, 1.04, L.roadMaxZ + 0.08);

    // 線路手前の安全柵（踏切正面 x: 3.2〜10.8 は完全開放）
    const railFenceL = new THREE.Mesh(new THREE.BoxGeometry(40.2, 0.72, 0.14), guardMat);
    railFenceL.position.set(-17.0, 1.44, L.trackMinZ);
    const railFenceR = new THREE.Mesh(new THREE.BoxGeometry(26.2, 0.72, 0.14), guardMat);
    railFenceR.position.set(24.0, 1.44, L.trackMinZ);
    world.add(northWalk, northCurbL, northCurbR, railFenceL, railFenceR);

    // 向こう側歩道の自販機＆ベンチ（端側 x=28.5 / 24.5 に寄せて邪魔にならない配置）
    const vendBody = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, 0.85), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35 }));
    vendBody.position.set(L.northVendX, 2.08, L.northVendZ);
    const vendFrontMat = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0x7dd3fc, emissiveIntensity: 0.7 });
    const vendFront = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.15), vendFrontMat);
    vendFront.position.set(L.northVendX, 2.32, L.northVendZ - 0.44);
    vendFront.rotation.y = Math.PI;
    this.nightEmissives.push(vendFrontMat);

    const northBench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.48, 0.56), new THREE.MeshStandardMaterial({ color: 0x78563a, roughness: 0.85 }));
    northBench.position.set(L.northBenchX, 1.26, L.northBenchZ);
    world.add(vendBody, vendFront, northBench);

    // 横断歩道（幅7.4mのゆったりゼブラ）＆車両停止線
    for (let z = 35.1; z <= 40.9; z += 0.92) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.02, 0.50), lineMat);
      stripe.position.set(cx, 1.07, z);
      world.add(stripe);
    }
    const stopLineW = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.02, 2.8), lineMat);
    stopLineW.position.set(1.5, 1.07, 36.4);
    const stopLineE = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.02, 2.8), lineMat);
    stopLineE.position.set(12.5, 1.07, 39.6);
    world.add(stopLineW, stopLineE);

    // 車両用3灯信号機＆歩行者用2灯信号機
    const makeBulb = (colHex, r = 0.16) => {
      const mat = new THREE.MeshBasicMaterial({ color: colHex });
      return { mesh: new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat), mat };
    };

    const addSignalPole = (px, pz, carFaceDir, pedFaceDir) => {
      const g = new THREE.Group();
      g.position.set(px, 1.0, pz);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 5.4, 8), poleMat);
      pole.position.y = 2.7;
      g.add(pole);

      const armDirZ = pz < L.roadCenterZ ? 1 : -1;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 8), poleMat);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0, 4.95, armDirZ * 1.05);
      g.add(arm);

      const carHead = new THREE.Group();
      carHead.position.set(0, 4.95, armDirZ * 1.9);
      carHead.rotation.y = carFaceDir;
      const carBox = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.48, 0.34), housingMat);
      carHead.add(carBox);

      const bG = makeBulb(0x00e676, 0.14);
      const bY = makeBulb(0x1e242c, 0.14);
      const bR = makeBulb(0x1e242c, 0.14);
      bG.mesh.position.set(-0.4, 0, 0.16);
      bY.mesh.position.set(0.0, 0, 0.16);
      bR.mesh.position.set(0.4, 0, 0.16);
      carHead.add(bG.mesh, bY.mesh, bR.mesh);
      this.signalBulbs.carG.push(bG.mat);
      this.signalBulbs.carY.push(bY.mat);
      this.signalBulbs.carR.push(bR.mat);
      g.add(carHead);

      const pedHead = new THREE.Group();
      pedHead.position.set(0, 3.15, 0);
      pedHead.rotation.y = pedFaceDir;
      const pedBox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.96, 0.32), housingMat);
      pedHead.add(pedBox);

      const pR = makeBulb(0xff2e2e, 0.15);
      const pG = makeBulb(0x1e242c, 0.15);
      pR.mesh.position.set(0, 0.22, 0.15);
      pG.mesh.position.set(0, -0.22, 0.15);
      pedHead.add(pR.mesh, pG.mesh);
      this.signalBulbs.pedR.push(pR.mat);
      this.signalBulbs.pedG.push(pG.mat);
      g.add(pedHead);

      world.add(g);
    };

    addSignalPole(L.crosswalkMaxX + 0.65, L.roadMinZ - 0.55, Math.PI / 2, 0);
    addSignalPole(L.crosswalkMinX - 0.65, L.roadMaxZ + 0.55, -Math.PI / 2, Math.PI);
  }

  updateTrafficSignals(t) {
    const cycle = t % 22.0;
    let car = "red";
    let ped = "red";
    let pedBlink = false;

    if (cycle < 11.0) car = "green";
    else if (cycle < 13.5) car = "yellow";
    else if (cycle < 14.5) car = "red";
    else if (cycle < 19.0) { car = "red"; ped = "green"; }
    else if (cycle < 21.0) { car = "red"; ped = "green"; pedBlink = Math.floor(t * 4.5) % 2 === 0; }

    this.signalState.car = car;
    this.signalState.ped = ped;
    this.signalState.pedBlink = pedBlink;

    const OFF = 0x1c232d;
    const carGCol = car === "green" ? 0x00e676 : OFF;
    const carYCol = car === "yellow" ? 0xffc400 : OFF;
    const carRCol = car === "red" ? 0xff2e2e : OFF;
    const pedRCol = ped === "red" ? 0xff2e2e : OFF;
    const pedGCol = (ped === "green" && !pedBlink) ? 0x00e676 : OFF;

    this.signalBulbs.carG.forEach((m) => m.color.setHex(carGCol));
    this.signalBulbs.carY.forEach((m) => m.color.setHex(carYCol));
    this.signalBulbs.carR.forEach((m) => m.color.setHex(carRCol));
    this.signalBulbs.pedR.forEach((m) => m.color.setHex(pedRCol));
    this.signalBulbs.pedG.forEach((m) => m.color.setHex(pedGCol));
  }

  updateTraffic(dt, t) {
    const L = WORLD_LAYOUT;
    this.updateTrafficSignals(t);

    if (this.signalState.ped === "green") {
      const dCw = Math.hypot(this.pos.x - L.crosswalkCenterX, this.pos.y - L.roadCenterZ);
      if (dCw < 40) {
        audioEngine.playCrosswalkChime(Math.pow(1 - dCw / 40, 1.5), this.signalState.pedBlink);
      }
    }

    const playerOnCrosswalk = !this.isBoating &&
      this.pos.y >= L.roadMinZ && this.pos.y <= L.roadMaxZ &&
      this.pos.x >= L.crosswalkMinX && this.pos.x <= L.crosswalkMaxX;

    if (playerOnCrosswalk && this.signalState.ped === "red" && performance.now() - this.lastRedWarnAt > 2600) {
      this.lastRedWarnAt = performance.now();
      this.onBlocked?.("🚥 歩行者信号が赤です！青になるまで待つと安全だよ");
    }

    for (const v of this.trafficVehicles) {
      if (!v.active) {
        v.cooldown -= dt;
        if (v.cooldown <= 0) {
          const laneBusy = this.trafficVehicles.some((o) => {
            if (o === v || !o.active) return false;
            if (Math.abs(o.z - v.z) < 0.8) {
              const startX = v.dir > 0 ? v.minX : v.maxX;
              return Math.abs(o.mesh.position.x - startX) < 36;
            }
            return false;
          });
          if (laneBusy) { v.cooldown = 3.5; continue; }
          v.active = true;
          v.mesh.visible = true;
          v.mesh.position.set(v.dir > 0 ? v.minX : v.maxX, 1.0, v.z);
        }
        continue;
      }

      let paused = false;
      const stopLineX = v.dir > 0 ? 1.5 : 12.5;
      const frontX = v.mesh.position.x + v.dir * v.halfLen;
      const distToLine = (stopLineX - frontX) * v.dir;
      if ((this.signalState.car !== "green" || playerOnCrosswalk) && distToLine >= -0.4 && distToLine <= 4.0) {
        paused = true;
      }
      if (!paused) {
        for (const o of this.trafficVehicles) {
          if (o === v || !o.active || o.dir !== v.dir || Math.abs(o.z - v.z) > 0.8) continue;
          const gap = (o.mesh.position.x - v.mesh.position.x) * v.dir - (o.halfLen + v.halfLen);
          if (gap > -1.0 && gap < 3.2) { paused = true; break; }
        }
      }

      if (!paused) {
        v.mesh.position.x += v.dir * v.speed * dt;
        v.mesh.position.y = 1.0 + Math.sin(t * 22 + v.z) * 0.015;
        const dCar = Math.hypot(this.pos.x - v.mesh.position.x, this.pos.y - v.z);
        if (dCar < 18) {
          audioEngine.playTrafficWhoosh(Math.pow(1 - dCar / 18, 1.6), v.type === "bus" || v.type === "bigtruck" || v.type === "truck");
        }
      } else {
        v.mesh.position.y = 1.0;
      }

      if ((v.dir > 0 && v.mesh.position.x > v.maxX) || (v.dir < 0 && v.mesh.position.x < v.minX)) {
        v.active = false;
        v.mesh.visible = false;
        v.cooldown = v.waitMin + Math.random() * (v.waitMax - v.waitMin);
      }
    }
  }

  // ===== 海沿いのローカル電車・踏切・さかな港駅（たまに走る情緒あるペース） =====
  buildRailway(world) {
    const L = WORLD_LAYOUT;
    const trackZ = L.trackZ;
    const crossX = L.crosswalkCenterX;
    const groundY = 1.0;

    const ballastMat = new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.96 });
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x4b3621, roughness: 0.92 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.78 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.6 });
    const concMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.88 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });

    // 線路の砕石・枕木・レール・架線（地面 y=1.0 の上に完全に独立配置）
    const railGround = new THREE.Mesh(new THREE.BoxGeometry(310, 1.48, 14.0), new THREE.MeshStandardMaterial({ color: 0x5f686e, roughness: 0.95 }));
    railGround.position.set(-10, 0.26, 54.5);
    world.add(railGround);

    const ballast = new THREE.Mesh(new THREE.BoxGeometry(310, 0.22, 4.4), ballastMat);
    ballast.position.set(-10, groundY + 0.11, trackZ);
    world.add(ballast);

    const tieGeo = new THREE.BoxGeometry(0.28, 0.12, 2.55);
    for (let x = -155; x <= 140; x += 1.6) {
      const tie = new THREE.Mesh(tieGeo, tieMat);
      tie.position.set(x, groundY + 0.26, trackZ);
      world.add(tie);
    }
    const railTopY = groundY + 0.42;
    [-0.78, 0.78].forEach((rz) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(310, 0.14, 0.12), railMat);
      rail.position.set(-10, railTopY - 0.07, trackZ + rz);
      world.add(rail);
    });

    for (let x = -140; x <= 130; x += 28) {
      if (Math.abs(x - crossX) < 7.0 || (x >= 11 && x <= 37)) continue;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.2, 8), poleMat);
      p.position.set(x, groundY + 3.1, trackZ + 2.6);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.3), poleMat);
      arm.position.set(x, groundY + 5.8, trackZ + 1.0);
      world.add(p, arm);
    }
    const wire = new THREE.Mesh(new THREE.BoxGeometry(310, 0.04, 0.04), darkMat);
    wire.position.set(-10, groundY + 5.65, trackZ);
    world.add(wire);

    // 踏切（渡り板・警報機・可動遮断機）
    const crossDeck = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.16, 4.8), concMat);
    crossDeck.position.set(crossX, groundY + 0.24, trackZ);
    world.add(crossDeck);

    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.6 });
    const gateArms = [];
    const flashL = [];
    const flashR = [];

    const addCrossingPost = (px, pz, barDirX, faceRotY) => {
      const g = new THREE.Group();
      g.position.set(px, groundY, pz);

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.5, 8), stripeMat);
      post.position.y = 1.75;
      g.add(post);
      for (let by = 0.6; by <= 3.0; by += 0.8) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.34, 8), blackMat);
        band.position.y = by;
        g.add(band);
      }

      const xGrp = new THREE.Group();
      xGrp.position.set(0, 3.1, 0);
      xGrp.rotation.y = faceRotY;
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.08), stripeMat);
      b1.rotation.z = Math.PI / 4;
      const b2 = b1.clone();
      b2.rotation.z = -Math.PI / 4;
      xGrp.add(b1, b2);
      g.add(xGrp);

      const lampGrp = new THREE.Group();
      lampGrp.position.set(0, 2.3, 0);
      lampGrp.rotation.y = faceRotY;
      const lBar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.14), blackMat);
      const mL = new THREE.MeshBasicMaterial({ color: 0x2a1414 });
      const mR = new THREE.MeshBasicMaterial({ color: 0x2a1414 });
      const bulbL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), mL);
      bulbL.position.set(-0.34, 0, 0.1);
      const bulbR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), mR);
      bulbR.position.set(0.34, 0, 0.1);
      lampGrp.add(lBar, bulbL, bulbR);
      flashL.push(mL);
      flashR.push(mR);
      g.add(lampGrp);

      const pivot = new THREE.Group();
      pivot.position.set(0, 1.15, 0);
      const armLen = 6.6;
      const armMesh = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.12, 0.12), stripeMat);
      armMesh.position.set(barDirX * (armLen / 2), 0, 0);
      pivot.add(armMesh);
      for (let s = 0.7; s < armLen; s += 1.0) {
        const sb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.13, 0.13), blackMat);
        sb.position.set(barDirX * s, 0, 0);
        pivot.add(sb);
      }
      g.add(pivot);
      gateArms.push({ pivot, dir: barDirX });

      world.add(g);
    };

    addCrossingPost(L.crosswalkMinX - 0.35, trackZ - 2.6, 1, Math.PI);
    addCrossingPost(L.crosswalkMaxX + 0.35, trackZ + 2.6, -1, 0);

    // 駅前広場＆「さかな港駅」（石垣段丘 z=61.5 より手前で独立）
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(36, 0.14, 5.4), new THREE.MeshStandardMaterial({ color: 0x71717a, roughness: 0.9 }));
    plaza.position.set(20.0, groundY + 0.07, 57.2);
    world.add(plaza);

    const platform = new THREE.Mesh(new THREE.BoxGeometry(23.0, 0.55, 4.2), concMat);
    platform.position.set(24.0, groundY + 0.275, 56.7);
    const yellowLine = new THREE.Mesh(
      new THREE.BoxGeometry(22.6, 0.04, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.65 })
    );
    yellowLine.position.set(24.0, groundY + 0.57, 54.85);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.24, 3.6), new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.55 }));
    roof.position.set(24.0, groundY + 3.65, 57.1);
    for (let px = 17.25; px <= 30.25; px += 6.5) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.0, 8), poleMat);
      col.position.set(px, groundY + 2.05, 57.1);
      world.add(col);
    }
    const stSign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 1.35),
      new THREE.MeshBasicMaterial({ map: createSignTexture("🚉 さかな港", "SAKANA-MINATO", "#f8fafc", "#0f172a", "#0284c7"), side: THREE.DoubleSide })
    );
    stSign.position.set(24.0, groundY + 2.75, 55.25);
    stSign.rotation.y = Math.PI;
    const stLampMat = new THREE.MeshStandardMaterial({ color: 0xfff8dc, emissive: 0xffd166, emissiveIntensity: 0.4 });
    const stLamp = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.14, 0.32), stLampMat);
    stLamp.position.set(24.0, groundY + 3.46, 56.5);
    this.nightEmissives.push(stLampMat);
    const stBench = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.48, 0.65), new THREE.MeshStandardMaterial({ color: 0x78563a, roughness: 0.85 }));
    stBench.position.set(23.75, groundY + 0.79, 57.85);
    world.add(platform, yellowLine, roof, stSign, stLamp, stBench);

    // レトロ2両編成ローカル電車
    const trainGroup = new THREE.Group();
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xfef9e7, roughness: 0.38, metalness: 0.15 });
    const seaBlueMat = new THREE.MeshStandardMaterial({ color: 0x0e7490, roughness: 0.36, metalness: 0.22 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.55 });
    const winGlowMat = new THREE.MeshStandardMaterial({
      color: 0x334155, emissive: 0xffd27d, emissiveIntensity: 0.35, roughness: 0.16, metalness: 0.4
    });
    this.nightEmissives.push(winGlowMat);

    const buildCar = (offsetX) => {
      const car = new THREE.Group();
      car.position.x = offsetX;
      [-3.5, 3.5].forEach((bx) => {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.52, 2.2), darkMat);
        bogie.position.set(bx, 0.46, 0);
        car.add(bogie);
        [-0.75, 0.75].forEach((wx) => {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 12), railMat);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(bx + wx, 0.36, 0);
          car.add(wheel);
        });
      });
      const lower = new THREE.Mesh(new THREE.BoxGeometry(11.4, 1.15, 2.55), seaBlueMat);
      lower.position.y = 1.25;
      const upper = new THREE.Mesh(new THREE.BoxGeometry(11.4, 1.45, 2.55), creamMat);
      upper.position.y = 2.52;
      const carRoof = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.28, 2.42), roofMat);
      carRoof.position.y = 3.36;
      const sideWin = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.92, 2.6), winGlowMat);
      sideWin.position.y = 2.48;
      for (let wx = -4.2; wx <= 4.2; wx += 1.4) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.96, 2.62), creamMat);
        pil.position.set(wx, 2.48, 0);
        car.add(pil);
      }
      const panto = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.72, 0.9), darkMat);
      panto.position.set(0, 3.84, 0);
      car.add(lower, upper, carRoof, sideWin, panto);
      return car;
    };

    trainGroup.add(buildCar(-6.0), buildCar(6.0));
    const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 2.1), darkMat);
    coupler.position.y = 2.0;
    trainGroup.add(coupler);

    const headL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff7cc }));
    headL.position.set(11.75, 2.75, 0);
    const tailL = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    tailL.position.set(-11.75, 1.35, 0);
    trainGroup.add(headL, tailL);

    trainGroup.position.set(-168, railTopY, trackZ);
    trainGroup.visible = false;
    world.add(trainGroup);

    this.railState = {
      train: trainGroup,
      railY: railTopY,
      trackZ,
      crossX,
      stationX: 24.0,
      gateArms,
      flashL,
      flashR,
      x: -168,
      dir: 1,
      speed: 0,
      maxSpeed: 16.5,
      mode: "wait",
      timer: 18.0, // 初回は18秒後、以降は55〜95秒おきにたまに通過
      stoppedThisTrip: false,
      gateClosed: 0
    };
  }

  updateRailway(dt, t) {
    const r = this.railState;
    if (!r) return;

    if (r.mode === "wait") {
      r.timer -= dt;
      if (r.timer <= 0) {
        r.mode = "run";
        r.stoppedThisTrip = false;
        r.x = r.dir > 0 ? -168 : 148;
        r.train.rotation.y = r.dir > 0 ? 0 : Math.PI;
        r.train.visible = true;
      }
    } else if (r.mode === "stop") {
      r.speed = 0;
      r.timer -= dt;
      if (r.timer <= 0) {
        r.mode = "run";
      }
    } else if (r.mode === "run") {
      const distToStation = (r.stationX - r.x) * r.dir;
      let targetSpd = r.maxSpeed;
      if (!r.stoppedThisTrip && distToStation > 0 && distToStation < 34) {
        targetSpd = Math.max(1.8, (distToStation / 34) * r.maxSpeed);
      }
      if (!r.stoppedThisTrip && Math.abs(r.x - r.stationX) < 1.2) {
        r.x = r.stationX;
        r.speed = 0;
        r.stoppedThisTrip = true;
        r.mode = "stop";
        r.timer = 5.0;
        const dSt = Math.hypot(this.pos.x - r.stationX, this.pos.y - r.trackZ);
        if (dSt < 55) audioEngine.playStationBell(Math.pow(1 - dSt / 55, 1.3));
      } else {
        r.speed += (targetSpd - r.speed) * Math.min(1, dt * 2.4);
        r.x += r.dir * r.speed * dt;
      }

      if ((r.dir > 0 && r.x > 152) || (r.dir < 0 && r.x < -172)) {
        r.mode = "wait";
        r.timer = 55 + Math.random() * 40; // たまに来るペース（約1分〜1分半おき）
        r.dir *= -1;
        r.train.visible = false;
      }
    }

    r.train.position.set(r.x, r.railY, r.trackZ);

    const nearCrossing = r.mode !== "wait" && Math.abs(r.x - r.crossX) < 52;
    const targetClosed = nearCrossing ? 1.0 : 0.0;
    r.gateClosed += (targetClosed - r.gateClosed) * Math.min(1, dt * 3.8);

    const openAngle = Math.PI * 0.46;
    const curAngle = openAngle * (1.0 - r.gateClosed);
    r.gateArms.forEach(({ pivot, dir }) => {
      pivot.rotation.z = dir * curAngle;
    });

    const blink = Math.floor(t * 3.4) % 2 === 0;
    const onCol = 0xff2222;
    const offCol = 0x261212;
    r.flashL.forEach((m) => m.color.setHex(nearCrossing && blink ? onCol : offCol));
    r.flashR.forEach((m) => m.color.setHex(nearCrossing && !blink ? onCol : offCol));

    if (nearCrossing) {
      const dGate = Math.hypot(this.pos.x - r.crossX, this.pos.y - r.trackZ);
      if (dGate < 58) audioEngine.playCrossingDing(Math.pow(1 - dGate / 58, 1.4));
    }
    if (r.mode === "run" && r.speed > 3.0) {
      const dTr = Math.hypot(this.pos.x - r.x, this.pos.y - r.trackZ);
      if (dTr < 62) audioEngine.playTrainClack(Math.pow(1 - dTr / 62, 1.4), r.speed);
    }
  }

  // ===== 他プレイヤー3Dアバター同期 =====
  createRemoteAvatar(data) {
    const group = new THREE.Group();
    const avCfg = normalizeAvatarOpt(data.avatar, data.name || "漁師");
    const person = buildHighQualityAngler(avCfg, true, data.name || "漁師");

    const boat = buildRealisticBoatModel(avCfg.color, true);
    boat.position.set(0, 0, -1.2);

    const labelText = this.formatRemoteLabel(data);
    const labelSprite = createNameSprite(labelText);

    group.add(person, boat, labelSprite);
    group.position.set(data.x || 0, data.isBoating ? 0.1 : 1.0, data.z || 4);
    this.remoteGroup.add(group);

    return {
      group, person, boat, labelSprite, labelText,
      avatarKey: JSON.stringify(avCfg),
      targetX: data.x || 0, targetZ: data.z || 4, targetYaw: data.yaw || 0,
      isBoating: !!data.isBoating, name: data.name || "漁師",
      walkPhase: Math.random() * 6
    };
  }

  formatRemoteLabel(data) {
    const now = Date.now();
    if (data.stamp && data.stampTs && now - data.stampTs < 6500) return `${data.name || "漁師"}「${data.stamp}」`;
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
      if (!av) { av = this.createRemoteAvatar(data); this.remoteAvatars.set(uid, av); }
      const nextCfg = normalizeAvatarOpt(data.avatar, data.name || "漁師");
      const nextKey = JSON.stringify(nextCfg);
      if (nextKey !== av.avatarKey) {
        av.group.remove(av.person);
        av.person = buildHighQualityAngler(nextCfg, true, data.name || "漁師");
        av.group.add(av.person);
        av.avatarKey = nextKey;
      }
      av.targetX = data.x ?? av.targetX;
      av.targetZ = data.z ?? av.targetZ;
      av.targetYaw = data.yaw ?? av.targetYaw;
      av.isBoating = !!data.isBoating;
      av.name = data.name || "漁師";
      av.boat.visible = av.isBoating;
      av.person.visible = true;
      av.person.position.set(0, av.isBoating ? 0.55 : 0.0, av.isBoating ? -0.45 : 0);
      av.labelSprite.position.y = av.isBoating ? 3.25 : 2.55;

      const nextLabel = this.formatRemoteLabel(data);
      if (nextLabel !== av.labelText) {
        av.labelSprite.material.map?.dispose();
        av.labelSprite.material.dispose();
        av.group.remove(av.labelSprite);
        av.labelSprite = createNameSprite(nextLabel);
        av.labelSprite.position.y = av.isBoating ? 3.25 : 2.55;
        av.group.add(av.labelSprite);
        av.labelText = nextLabel;
      }
    }
  }
  clearRemotePlayers() { this.syncRemotePlayers({}); }

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
    const presets = [{ x:-35,z:-72 }, { x:45,z:-88 }, { x:-15,z:-175 }, { x:70,z:-195 }, { x:-115,z:-275 }, { x:110,z:-270 }, { x:0,z:-315 }];
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

  setLocalAvatar(avatarOpt, fallbackName = "") {
    const cfg = normalizeAvatarOpt(avatarOpt, fallbackName);
    this.localAvatarOpt = cfg;
    if (this.localAvatar && this.playerRig) {
      this.playerRig.remove(this.localAvatar);
    }
    this.localAvatar = buildHighQualityAngler(cfg, false, fallbackName);
    this.localAvatar.position.set(0, this.isBoating ? 0.44 : 0.0, this.isBoating ? 0.22 : 0.0);
    if (this.rodGroup) {
      const rArm = this.localAvatar?.userData?.rig?.rightArm;
      if (rArm) rArm.add(this.rodGroup);
      else this.playerRig?.add(this.rodGroup);
    }
    if (this.playerRig) this.playerRig.add(this.localAvatar);
  }

  getAvatarYaw() {
    return this.isBoating ? this.yaw : (typeof this.bodyYaw === "number" ? this.bodyYaw : this.yaw);
  }

  setPlayerState({ x, z, yaw, isBoating, boatSpeed, boatTier, avatar, name }) {
    this.pos.set(x ?? 0, z ?? 4); this.yaw = yaw ?? 0; this.targetYaw = this.yaw; this.bodyYaw = this.yaw;
    this.targetCamDist = isBoating ? 6.8 : 4.7; this.camDist = this.targetCamDist;
    this.isBoating = !!isBoating; this.boatSpeed = boatSpeed || 1.2; this.boatTier = boatTier || 0;
    this.boatGroup.visible = this.isBoating;
    this.parkedBoat.visible = !this.isBoating && this.boatTier > 0;
    this.autopilot = false;
    if (avatar || name) this.setLocalAvatar(avatar, name || "");
  }
  updateBoatSpec(boatSpeed, boatTier) {
    this.boatSpeed = boatSpeed || 1.2;
    this.boatTier = boatTier || 0;
    this.parkedBoat.visible = !this.isBoating && this.boatTier > 0;
  }
  setMode(mode) { if (this.rodGroup && mode !== 'fish') this.rodGroup.visible = false; }

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
        sun: 0xffb36b, sunPos: [75, 24, -180], amb: 0.45, hemi: 0.65, sunI: 1.25, port: 1.2, night: 0.35
      },
      day: {
        top: 0x1c69ba, horizon: 0x9cd8f7, deep: 0x063761, shallow: 0x169aa8,
        sun: 0xfff6dc, sunPos: [62, 118, -165], amb: 0.42, hemi: 0.88, sunI: 1.55, port: 0.0, night: 0.0
      },
      dusk: {
        top: 0x2c2b59, horizon: 0xe36b3e, deep: 0x0a213d, shallow: 0x1c596b,
        sun: 0xff7b38, sunPos: [-78, 20, -175], amb: 0.36, hemi: 0.55, sunI: 1.15, port: 1.8, night: 0.52
      },
      night: {
        top: 0x040b18, horizon: 0x0f223d, deep: 0x020d1c, shallow: 0x082a3b,
        sun: 0xa8c8f0, sunPos: [52, 86, -170], amb: 0.24, hemi: 0.34, sunI: 0.58, port: 3.4, night: 1.0
      }
    };
    const p = palettes[env.timePhase] || palettes.day;
    let topCol = new THREE.Color(p.top);
    let horCol = new THREE.Color(p.horizon);
    let fogDensity = 0.0034;

    if (env.weather === "fog") {
      horCol.lerp(new THREE.Color(0x9eb2bf), 0.72);
      topCol.lerp(new THREE.Color(0x7c92a1), 0.65);
      fogDensity = 0.014;
    } else if (env.weather === "rain" || env.weather === "rough") {
      horCol.lerp(new THREE.Color(0x364759), 0.68);
      topCol.lerp(new THREE.Color(0x1f2d3b), 0.68);
      fogDensity = 0.0086;
    } else if (env.weather === "cloudy") {
      horCol.lerp(new THREE.Color(0x8fa6b8), 0.42);
      topCol.lerp(new THREE.Color(0x526b82), 0.38);
      fogDensity = 0.0052;
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
    this.celestialDisc.position.copy(sunDir.clone().multiplyScalar(360));
    this.celestialDisc.material.color.setHex(p.sun);
    this.celestialDisc.visible = env.weather !== "rain" && env.weather !== "rough" && env.weather !== "fog";

    this.ambient.intensity = p.amb;
    this.hemi.intensity = p.hemi;
    this.hemi.color.copy(horCol);
    this.portLight.intensity = p.port;

    const isClearNight = p.night > 0.6 && env.weather !== "rain" && env.weather !== "rough";
    this.starMat.opacity = isClearNight ? 0.88 : 0.0;
    this.cloudMat.color.copy(horCol).lerp(new THREE.Color(0xffffff), 0.45 * (1.0 - p.night * 0.7));
    this.cloudMat.opacity = env.weather === "fog" ? 0.35 : 0.78;

    this.nightLights.forEach((lt) => { lt.intensity = p.night * 4.4; });
    this.nightEmissives.forEach((m) => { m.emissiveIntensity = 0.25 + p.night * 1.45; });
    // 夕方〜夜に港町の家々の窓明かりが灯る
    this.townWindowMats.forEach((m) => { m.emissiveIntensity = p.night > 0.25 ? p.night * 1.45 : 0.0; });
    if (this.lhBeamMat) this.lhBeamMat.opacity = p.night * 0.24;
    this.carNightFactor = p.night;
    this.carBeamMats.forEach((m) => { m.opacity = p.night * 0.26; });
    this.busWindowMats.forEach((m) => { m.emissiveIntensity = p.night * 1.15; });

    this.rain.visible = env.weather === "rain" || env.weather === "rough";
    this.waveAmp = typeof env.waveAmp === "number" ? env.waveAmp : (env.weather === "rough" ? 2.1 : env.weather === "rain" ? 1.4 : 1.0);
    this.waveChoppiness = typeof env.waveChoppiness === "number" ? env.waveChoppiness : (env.weather === "rough" ? 0.92 : 0.52);
    this.waveSeed = typeof env.waveSeed === "number" ? env.waveSeed : 1.0;
    if (env.waveDir && typeof env.waveDir.x === "number") {
      this.waveDir = { x: env.waveDir.x, z: env.waveDir.z };
    }
    this.waterUniforms.uWaveAmp.value = this.waveAmp;
    this.waterUniforms.uChoppiness.value = this.waveChoppiness;
    this.waterUniforms.uWaveSeed.value = this.waveSeed;
    this.waterUniforms.uWaveDir.value.set(this.waveDir.x, this.waveDir.z);
  }

  setBobber(visible, dist = 18, dip = 0) {
    const wasVisible = this.bobber.visible;
    const prevDip = this.bobberDip || 0;
    this.bobber.visible = visible;
    this.fishingLine.visible = visible;
    this.bobberDist = dist;
    this.bobberDip = dip;
    if (visible && !wasVisible) {
      this.onBobberLanded();
    } else if (visible && dip > 0.08 && prevDip <= 0.08) {
      const t = this.clock ? this.clock.elapsedTime : 0;
      const wy = this.getWaveHeightAt(this.bobberWorldPos.x, this.bobberWorldPos.y, t);
      this.spawnSplashBurst(this.bobberWorldPos.x, wy + 0.04, this.bobberWorldPos.y, 8, 2.3, 0.9);
      this.spawnWorldRipple(this.bobberWorldPos.x, this.bobberWorldPos.y, 3.8, 1.35, 0.72);
    }
    if (!visible && this.waterUniforms?.uBobberActive) {
      this.waterUniforms.uBobberActive.value = 0.0;
      this.waterUniforms.uBiteIntensity.value = 0.0;
    }
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


  // ===== リアル波エフェクト（CPU同期波高・岸壁＆防波堤3D水しぶき・ウキ多層波紋） =====
  initWaveEffects() {
    // 柔らかい水しぶき用スプライトテクスチャ
    const sc = document.createElement("canvas");
    sc.width = 64; sc.height = 64;
    const sctx = sc.getContext("2d");
    const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0.0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.45, "rgba(224,244,255,0.68)");
    grad.addColorStop(1.0, "rgba(200,235,255,0.0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const sprayTex = new THREE.CanvasTexture(sc);

    this.splashParticles = [];
    for (let i = 0; i < 72; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sprayTex, transparent: true, opacity: 0.0, depthWrite: false
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      this.scene.add(sp);
      this.splashParticles.push({
        mesh: sp, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.65, baseSize: 0.35
      });
    }

    // ワールド座標で広がる多層波紋リングプール（ウキ着水・アタリ用）
    this.worldRipples = [];
    const ringGeo = new THREE.RingGeometry(0.42, 0.56, 28);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe8f7ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.worldRipples.push({
        mesh, life: 0, maxLife: 1.5, maxScale: 4.0, baseOpacity: 0.65, wx: 0, wz: 0
      });
    }
  }

  getWaveHeightAt(wx, wz, t) {
    const smoothstep = (e0, e1, x) => {
      const v = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return v * v * (3 - 2 * v);
    };
    const bdx = this.waveDir?.x ?? 0.45;
    const bdz = this.waveDir?.z ?? 0.89;
    const blen = Math.hypot(bdx, bdz) || 1;
    const bx = bdx / blen, bz = bdz / blen;
    const px = -bz, pz = bx;

    const d1x = bx * 0.96 + px * 0.28, d1z = bz * 0.96 + pz * 0.28;
    const d2x = bx * 0.72 - px * 0.69, d2z = bz * 0.72 - pz * 0.69;
    const d3x = bx * 0.45 + px * 0.89, d3z = bz * 0.45 + pz * 0.89;
    const d4x = -bx * 0.31 + px * 0.95, d4z = -bz * 0.31 + pz * 0.95;

    const shoreFade = smoothstep(3.5, -14.0, wz);
    const inHarbor = (1.0 - smoothstep(-38.0, -54.0, wz)) * (1.0 - smoothstep(55.0, 88.0, Math.abs(wx)));
    const harborCalm = 1.0 + (0.48 - 1.0) * inHarbor;

    const seed = this.waveSeed || 1.0;
    const set1 = Math.sin((wx * d1x + wz * d1z) * 0.021 - t * 0.23 + seed * 0.71);
    const set2 = Math.cos((wx * d2x + wz * d2z) * 0.017 - t * 0.143 + seed * 1.13);
    const gust = 0.86 + 0.24 * Math.sin(t * 0.19 + wx * 0.013 - wz * 0.011 + seed * 0.37);
    const setMod = (0.64 + 0.52 * (0.5 + 0.5 * set1) * (0.55 + 0.45 * set2)) * gust;

    const amp = (this.waveAmp || 1.0) * (0.24 + 0.76 * shoreFade) * harborCalm * setMod;
    const p1 = (wx * d1x + wz * d1z) * 0.072 - t * 1.18 + seed * 0.4;
    const p2 = (wx * d2x + wz * d2z) * 0.113 - t * 1.47 + seed * 0.9;
    const p3 = (wx * d3x + wz * d3z) * 0.197 - t * 1.93 + seed * 1.5;
    const p4 = (wx * d4x + wz * d4z) * 0.311 - t * 2.41 + seed * 2.1;

    const s1 = Math.sin(p1), c1 = Math.cos(p1);
    const s2 = Math.sin(p2), c2 = Math.cos(p2);
    const sharp = 0.26 * (this.waveChoppiness || 0.52);

    let h = ((s1 + sharp * (1 - c1 * c1) * s1) * 0.28
          + (s2 + sharp * (1 - c2 * c2) * s2) * 0.19
          + Math.sin(p3) * 0.105
          + Math.sin(p4) * 0.062) * amp;

    const portWallX = 1.0 - smoothstep(35.0, 39.5, Math.abs(wx));
    const portWallBand = Math.exp(-Math.pow(Math.max(0, -wz) * 0.42, 2)) * portWallX;
    h += Math.sin(-wz * 0.78 - t * 2.35 + Math.sin(wx * 0.14) * 1.6) * 0.16 * (this.waveAmp || 1.0) * setMod * portWallBand;
    return h;
  }

  spawnSplashBurst(wx, wy, wz, count = 6, power = 2.6, spread = 1.2) {
    if (!this.splashParticles) return;
    let spawned = 0;
    for (const p of this.splashParticles) {
      if (p.life <= 0) {
        const ang = Math.random() * Math.PI * 2;
        const spd = (0.35 + Math.random() * 0.65) * spread;
        p.vx = Math.cos(ang) * spd;
        p.vz = Math.sin(ang) * spd;
        p.vy = (0.55 + Math.random() * 0.65) * power;
        p.maxLife = 0.42 + Math.random() * 0.38;
        p.life = p.maxLife;
        p.baseSize = 0.24 + Math.random() * 0.34;
        p.mesh.position.set(wx + (Math.random() - 0.5) * 0.3, wy, wz + (Math.random() - 0.5) * 0.3);
        p.mesh.scale.set(p.baseSize, p.baseSize, 1);
        p.mesh.material.opacity = 0.82;
        p.mesh.visible = true;
        spawned++;
        if (spawned >= count) break;
      }
    }
  }

  spawnWorldRipple(wx, wz, maxScale = 4.6, life = 1.6, baseOpacity = 0.7) {
    if (!this.worldRipples) return;
    for (const r of this.worldRipples) {
      if (r.life <= 0) {
        r.wx = wx; r.wz = wz;
        r.maxLife = life; r.life = life;
        r.maxScale = maxScale;
        r.baseOpacity = baseOpacity;
        r.mesh.position.set(wx, 0.04, wz);
        r.mesh.scale.set(0.25, 0.25, 1);
        r.mesh.material.opacity = baseOpacity;
        r.mesh.visible = true;
        break;
      }
    }
  }

  onBobberLanded() {
    const t = this.clock ? this.clock.elapsedTime : 0;
    const bz = 2.5 - this.bobberDist * 0.6;
    const wx = this.pos.x + Math.sin(this.yaw) * bz;
    const wz = this.pos.y + Math.cos(this.yaw) * bz;
    this.bobberWorldPos.set(wx, wz);
    this.bobberSplashAt = t;

    const wy = this.getWaveHeightAt(wx, wz, t);
    // 着水の水柱しぶき＋時間差3重波紋リング
    this.spawnSplashBurst(wx, wy + 0.04, wz, 14, 3.1, 1.35);
    this.spawnWorldRipple(wx, wz, 4.8, 1.55, 0.82);
    setTimeout(() => { if (this.bobber.visible) this.spawnWorldRipple(wx, wz, 5.8, 1.85, 0.58); }, 220);
    setTimeout(() => { if (this.bobber.visible) this.spawnWorldRipple(wx, wz, 6.6, 2.05, 0.40); }, 480);

    if (this.waterUniforms?.uBobberPos) {
      this.waterUniforms.uBobberPos.value.set(wx, wz);
      this.waterUniforms.uBobberActive.value = 1.0;
      this.waterUniforms.uSplashAge.value = 0.0;
    }
  }

  updateWaveEffects(dt, t) {
    // 1. 港護岸・テトラポッド・沖防波堤に波が当たった時の3D水しぶき
    this.wallSprayAcc += dt;
    const sprayInterval = Math.max(0.11, 0.44 - (this.waveAmp || 1.0) * 0.14);
    if (this.wallSprayAcc >= sprayInterval) {
      this.wallSprayAcc = 0;
      // 港の護岸（プレイヤーに近い範囲を中心に発生）
      if (this.pos.y > -35 && Math.abs(this.pos.x) < 55) {
        const sx = Math.max(-35, Math.min(35, this.pos.x + (Math.random() - 0.5) * 34));
        const wh = this.getWaveHeightAt(sx, -0.5, t);
        if (wh > 0.06 || this.waveAmp > 1.35) {
          const pwr = 1.3 + (this.waveAmp || 1.0) * 1.15 + Math.max(0, wh) * 2.2;
          this.spawnSplashBurst(sx, Math.max(0.1, wh + 0.15), -0.35, this.waveAmp > 1.3 ? 5 : 3, pwr, 0.9);
        }
      }
      // 磯場のテトラポッド防波帯
      if (this.pos.x > 12 && this.pos.y > -28) {
        const tx = 35 + Math.random() * 32;
        const twh = this.getWaveHeightAt(tx, -2.0, t);
        if (twh > 0.04 || this.waveAmp > 1.15) {
          this.spawnSplashBurst(tx, Math.max(0.2, twh + 0.3), -1.8, 5, 1.9 + (this.waveAmp || 1.0) * 1.35, 1.25);
        }
      }
      // 沖防波堤の外洋側（船で近づいた時や高波の日に迫力アップ）
      if (this.waveAmp > 0.95 && this.pos.y < 12 && this.pos.y > -95) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const bx = side * (24 + Math.random() * 48);
        const bwh = this.getWaveHeightAt(bx, -46.8, t);
        if (bwh > 0.08) {
          this.spawnSplashBurst(bx, 0.4 + bwh, -46.5, 6, 2.4 + (this.waveAmp || 1.0) * 1.5, 1.5);
        }
      }
    }

    // 2. 3D水しぶきパーティクル更新（重力放物線＋霧散フェード）
    if (this.splashParticles) {
      for (const p of this.splashParticles) {
        if (p.life > 0) {
          p.life -= dt;
          p.vy -= 8.6 * dt;
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;
          const r = Math.max(0, p.life / p.maxLife);
          const sz = p.baseSize * (1.0 + (1.0 - r) * 1.15);
          p.mesh.scale.set(sz, sz, 1);
          p.mesh.material.opacity = r * 0.78;
          if (p.life <= 0 || p.mesh.position.y < -0.25) {
            p.life = 0;
            p.mesh.visible = false;
          }
        }
      }
    }

    // 3. ワールド波紋リング更新
    if (this.worldRipples) {
      for (const r of this.worldRipples) {
        if (r.life > 0) {
          r.life -= dt;
          const prog = 1.0 - Math.max(0, r.life / r.maxLife);
          const sc = 0.3 + prog * r.maxScale;
          r.mesh.scale.set(sc, sc, 1);
          r.mesh.position.y = this.getWaveHeightAt(r.wx, r.wz, t) + 0.04;
          r.mesh.material.opacity = Math.pow(1.0 - prog, 1.4) * r.baseOpacity;
          if (r.life <= 0) r.mesh.visible = false;
        }
      }
    }
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

    // カメラ目標角・距離への滑らかな補間（原神風のヌルッとした視点追従）
    if (typeof this.targetYaw !== "number") this.targetYaw = this.yaw;
    if (typeof this.targetPitch !== "number") this.targetPitch = 0.27;
    if (typeof this.camPitch !== "number") this.camPitch = this.targetPitch;
    if (typeof this.targetCamDist !== "number") this.targetCamDist = this.isBoating ? 6.8 : 4.7;
    if (typeof this.camDist !== "number") this.camDist = this.targetCamDist;

    const camSmooth = Math.min(1, dt * 16);
    this.yaw += (this.targetYaw - this.yaw) * camSmooth;
    this.camPitch += (this.targetPitch - this.camPitch) * camSmooth;
    const minD = this.isBoating ? 4.2 : 2.3, maxD = this.isBoating ? 11.5 : 7.6;
    this.targetCamDist = Math.max(minD, Math.min(maxD, this.targetCamDist));
    this.camDist += (this.targetCamDist - this.camDist) * Math.min(1, dt * 10);

    if (this.isBoating && this.autopilot) {
      const nearest = this.getNearestHotspot();
      if (nearest.spot && nearest.dist > 6) {
        const autoYaw = Math.atan2(-(nearest.spot.x - nx), -(nearest.spot.z - nz));
        let diff = autoYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.1);
        this.yaw += turn; this.targetYaw = this.yaw;
        const step = dt * 15 * this.boatSpeed;
        nx -= Math.sin(this.yaw) * step; nz -= Math.cos(this.yaw) * step; movedDist = step;
      } else this.autopilot = false;
    } else if (Math.abs(this.moveInput.x) > 0.06 || Math.abs(this.moveInput.y) > 0.06) {
      if (this.isBoating) {
        const turn = -this.moveInput.x * dt * 1.9;
        this.yaw += turn; this.targetYaw += turn;
        const step = -this.moveInput.y * dt * 16 * this.boatSpeed;
        nx -= Math.sin(this.yaw) * step; nz -= Math.cos(this.yaw) * step; movedDist = Math.abs(step);
      } else {
        let ix = this.moveInput.x, iy = this.moveInput.y;
        const mag = Math.hypot(ix, iy);
        if (mag > 1.0) { ix /= mag; iy /= mag; }
        const walkSpeed = 14 * dt, fwd = -iy * walkSpeed, strafe = ix * walkSpeed;
        nx += (-Math.sin(this.yaw) * fwd) + (Math.cos(this.yaw) * strafe);
        nz += (-Math.cos(this.yaw) * fwd) - (Math.sin(this.yaw) * strafe);
      }
    }

    if (movedDist > 0 && this.isBoating && this.onFuelConsume && !this.onFuelConsume(movedDist)) {
      this.autopilot = false; nx = this.pos.x; nz = this.pos.y;
    } else {
      const clamped = clampWorldPosition(nx, nz, this.isBoating, this.boatTier, this.pos.x, this.pos.y);
      let fx = clamped.x, fz = clamped.z;
      if (!this.isBoating) {
        for (const v of this.trafficVehicles) {
          if (!v.active || !v.inPort) continue;
          const minX = v.mesh.position.x - v.halfLen - 0.85, maxX = v.mesh.position.x + v.halfLen + 0.85;
          const minZ = v.z - v.halfWid - 0.85, maxZ = v.z + v.halfWid + 0.85;
          if (fx > minX && fx < maxX && fz > minZ && fz < maxZ) {
            const dl = Math.abs(fx - minX), dr = Math.abs(maxX - fx);
            const dtz = Math.abs(fz - minZ), dbz = Math.abs(maxZ - fz);
            const m = Math.min(dl, dr, dtz, dbz);
            if (m === dl) fx = minX;
            else if (m === dr) fx = maxX;
            else if (m === dtz) fz = minZ;
            else fz = maxZ;
          }
        }
      }
      if (!this.isBoating && this.railState && this.railState.gateClosed > 0.35) {
        const inGateX = fx >= WORLD_LAYOUT.crosswalkMinX - 0.5 && fx <= WORLD_LAYOUT.crosswalkMaxX + 0.5;
        if (inGateX && fz > WORLD_LAYOUT.trackMinZ && fz < WORLD_LAYOUT.trackMaxZ) {
          fz = this.pos.y <= WORLD_LAYOUT.trackZ ? WORLD_LAYOUT.trackMinZ : WORLD_LAYOUT.trackMaxZ;
          if (performance.now() - this.lastGateWarnAt > 2200) {
            this.lastGateWarnAt = performance.now();
            this.onBlocked?.('🚆 電車が来ます！遮断機が上がるまで待とう');
          }
        }
      }
            this.pos.set(fx, fz);
      if (clamped.blockedMsg && performance.now() - this.lastBlockAt > 1800) {
        this.lastBlockAt = performance.now(); this.autopilot = false; this.onBlocked?.(clamped.blockedMsg);
      }
    }

    let rigY = 0.78, boatPitch = 0, boatRoll = 0;
    if (this.isBoating) {
      const hC = this.getWaveHeightAt(this.pos.x, this.pos.y, t);
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const hF = this.getWaveHeightAt(this.pos.x + fx * 2.4, this.pos.y + fz * 2.4, t);
      const hR = this.getWaveHeightAt(this.pos.x + rx * 1.4, this.pos.y + rz * 1.4, t);
      rigY = hC * 0.85;
      boatPitch = THREE.MathUtils.clamp((hF - hC) * 0.12, -0.12, 0.12);
      boatRoll = THREE.MathUtils.clamp((hC - hR) * 0.16, -0.14, 0.14);
    }
    this.playerRig.position.set(this.pos.x, rigY, this.pos.y);
    this.playerRig.rotation.y = this.yaw;
    // 原神風オービットカメラ：常にプレイヤー(0, focusY, 0)を中心に360°回転（lookAt不使用で絶対ズレない）
    const focusY = this.isBoating ? 1.45 : 1.48;
    const minLocalCamY = this.isBoating ? 0.65 : 0.42;
    let effDist = this.camDist ?? (this.isBoating ? 6.8 : 4.7);
    const pitch = this.camPitch ?? 0.27;
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    if (sinP < 0 && (focusY + sinP * effDist) < minLocalCamY) {
      effDist = Math.max(1.35, (minLocalCamY - focusY) / sinP);
    }
    const camY = Math.max(minLocalCamY, focusY + sinP * effDist);
    const camZ = Math.max(0.6, cosP * effDist);
    const actualPitch = Math.atan2(camY - focusY, camZ);
    this.camera.position.set(0, camY, camZ);
    this.camera.rotation.set(-actualPitch, 0, 0);

    if (this.localAvatar) {
      const stepDx = this.pos.x - (this._prevPosX ?? this.pos.x);
      const stepDz = this.pos.y - (this._prevPosZ ?? this.pos.y);
      this._prevPosX = this.pos.x;
      this._prevPosZ = this.pos.y;
      const moveDistFrame = Math.hypot(stepDx, stepDz);
      const spd = Math.min(1.0, moveDistFrame / Math.max(0.001, 14 * dt));
      if (this.isBoating) {
        this.bodyYaw = this.yaw;
      } else if (this.bobber.visible) {
        // キャスト中は海側（カメラ向き）へ滑らかに向く
        let diff = this.yaw - (this.bodyYaw ?? this.yaw);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.bodyYaw = (this.bodyYaw ?? this.yaw) + diff * Math.min(1, dt * 10);
      } else if (moveDistFrame > 0.004) {
        // 歩いた方向へ滑らかに向き直る（立ち止まって視点を回しただけでは動かない）
        const moveYaw = Math.atan2(-stepDx, -stepDz);
        let diff = moveYaw - (this.bodyYaw ?? this.yaw);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.bodyYaw = (this.bodyYaw ?? this.yaw) + diff * Math.min(1, dt * 12);
      }
      if (spd > 0.08 && !this.isBoating) this.localWalkPhase += dt * 9.5;
      this.localAvatar.position.set(0, this.isBoating ? 0.44 : 0.0, this.isBoating ? 0.22 : 0.0);
      this.localAvatar.rotation.y = (this.bodyYaw ?? this.yaw) - this.yaw;
      animateAnglerRig(this.localAvatar, this.localWalkPhase, this.isBoating ? 0 : spd, this.isBoating, t, Boolean(this.bobber?.visible || (this.rodBend && this.rodBend > 0.01)), this.rodBend || 0);
    }
    for (const av of this.remoteAvatars.values()) {
      const dMove = Math.hypot((av.targetX ?? 0) - av.group.position.x, (av.targetZ ?? 0) - av.group.position.z);
      if (dMove > 0.06 && !av.isBoating) av.walkPhase = (av.walkPhase || 0) + dt * 9.5;
      animateAnglerRig(av.person, av.walkPhase || 0, Math.min(1, dMove * 2.5), av.isBoating, t);
    }
    this.playerRig.rotation.z = this.isBoating ? boatRoll * 0.28 : 0;
    if (this.boatGroup && this.isBoating) {
      this.boatGroup.rotation.x += (boatPitch - this.boatGroup.rotation.x) * Math.min(1, dt * 6);
      this.boatGroup.rotation.z += (boatRoll - this.boatGroup.rotation.z) * Math.min(1, dt * 6);
    }

    if (this.isBoating && movedDist > 0.05) {
      this.wakeSpawnAcc += dt;
      if (this.wakeSpawnAcc > 0.07) {
        this.wakeSpawnAcc = 0;
        this.spawnWake(this.pos.x + Math.sin(this.yaw) * 4.5, this.pos.y + Math.cos(this.yaw) * 4.5);
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

    this.skyDome.position.set(this.pos.x, 0, this.pos.y);
    this.stars.position.set(this.pos.x, 0, this.pos.y);
    this.sea.position.set(Math.floor(this.pos.x / 5) * 5, 0, Math.floor(this.pos.y / 5) * 5);
    this.waterUniforms.uTime.value = t;
    this.updateWaveEffects(dt, t);

    for (const db of this.dockedBoats) {
      const dh = this.getWaveHeightAt(db.mesh.position.x, db.mesh.position.z, t);
      const dhR = this.getWaveHeightAt(db.mesh.position.x + 1.2, db.mesh.position.z, t);
      db.mesh.position.y = 0.06 + dh * 0.85;
      db.mesh.rotation.z = THREE.MathUtils.clamp((dh - dhR) * 0.14, -0.1, 0.1);
    }
    for (const fl of this.flags) {
      fl.mesh.rotation.y = Math.PI / 2 + Math.sin(t * 5.0 + fl.phase) * 0.22;
    }
    if (this.parkedBoat.visible) {
      const ph = this.getWaveHeightAt(this.parkedBoat.position.x, this.parkedBoat.position.z, t);
      const phR = this.getWaveHeightAt(this.parkedBoat.position.x + 1.2, this.parkedBoat.position.z, t);
      this.parkedBoat.position.y = 0.06 + ph * 0.85;
      this.parkedBoat.rotation.z = THREE.MathUtils.clamp((ph - phR) * 0.14, -0.1, 0.1);
    }

    if (this.lighthouseBeam) this.lighthouseBeam.rotation.y = t * 0.55;
    this.updateTraffic(dt, t);
    this.updateRailway(dt, t);
    for (const b of this.buoyLamps) {
      b.lamp.visible = Math.sin(t * 3.0 + b.phase) > -0.15;
    }

    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > 250) c.group.position.x = -250;
    }
    for (const g of this.seagulls) {
      g.angle += g.speed * dt;
      g.group.position.set(g.cx + Math.cos(g.angle) * g.radius, g.height + Math.sin(t * 1.7 + g.angle) * 1.2, g.cz + Math.sin(g.angle) * g.radius);
      g.group.rotation.y = -g.angle;
      const flap = Math.sin(t * 7.5 + g.angle * 3.0) * 0.45;
      g.leftW.rotation.z = flap;
      g.rightW.rotation.z = -flap;
    }

    for (const av of this.remoteAvatars.values()) {
      av.group.position.x += (av.targetX - av.group.position.x) * Math.min(1, dt * 7);
      av.group.position.z += (av.targetZ - av.group.position.z) * Math.min(1, dt * 7);
      av.group.position.y = av.isBoating ? this.getWaveHeightAt(av.group.position.x, av.group.position.z, t) * 0.85 : 0.85;
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

    const showRod = Boolean(this.bobber?.visible || (this.rodBend && this.rodBend > 0.01));
    this.rodGroup.visible = showRod;
    this.rodGroup.rotation.x = -this.rodBend * 0.42 + Math.sin(t * 2.2) * 0.02;
    if (this.localAvatar && this.rodGroup.parent !== (this.localAvatar.userData?.rig?.rightArm || this.playerRig)) {
      const rArm = this.localAvatar.userData?.rig?.rightArm;
      if (rArm) rArm.add(this.rodGroup);
    }
    this.scene.updateMatrixWorld(true);

    if (this.bobber.visible) {
      const bz = 2.5 - this.bobberDist * 0.6;
      const bwx = this.pos.x + Math.sin(this.yaw) * bz;
      const bwz = this.pos.y + Math.cos(this.yaw) * bz;
      this.bobberWorldPos.set(bwx, bwz);
      const oceanY = this.getWaveHeightAt(bwx, bwz, t);
      const by = (oceanY + 0.05) - rigY - this.bobberDip * 0.55;
      this.bobber.position.set(0, by, bz);
      this.bobber.rotation.z = Math.sin(t * 3.1 + bwx) * (0.06 + this.bobberDip * 0.35);

      const bitePow = Math.min(1.0, Math.max(this.bobberDip * 2.2, this.rodBend * 0.85));
      const rCycle = (t * (1.25 + bitePow * 1.5)) % 1.0;
      const rs = 0.8 + rCycle * (2.6 + bitePow * 1.8);
      this.bobberRipple.scale.set(rs, rs, 1);
      this.bobberRipple.material.opacity = (1.0 - rCycle) * (0.48 + bitePow * 0.32);

      this.waterUniforms.uBobberPos.value.set(bwx, bwz);
      this.waterUniforms.uBobberActive.value = 1.0;
      this.waterUniforms.uSplashAge.value = Math.max(0, t - this.bobberSplashAt);
      this.waterUniforms.uBiteIntensity.value = bitePow;

      if (bitePow > 0.16) {
        this.biteSprayAcc += dt;
        if (this.biteSprayAcc > 0.16) {
          this.biteSprayAcc = 0;
          this.spawnSplashBurst(bwx, oceanY + 0.05, bwz, 4, 1.9 + bitePow * 1.4, 0.85);
          this.spawnWorldRipple(bwx, bwz, 3.2 + bitePow * 2.2, 1.1, 0.65);
        }
      }

      // 竿先(rodTipObj)のワールド座標を playerRig ローカル座標へ変換して釣り糸の始点に完全一致させる
      this.rodGroup.visible = true;
      this.scene.updateMatrixWorld(true);
      const tipWorld = new THREE.Vector3();
      if (this.rodTipObj) this.rodTipObj.getWorldPosition(tipWorld);
      else tipWorld.set(this.pos.x + Math.sin(this.yaw) * 1.4, rigY + 1.85, this.pos.y + Math.cos(this.yaw) * 1.4);
      const tip = this.playerRig.worldToLocal(tipWorld);
      const end = new THREE.Vector3(0, by + 0.12, bz);
      const sag = Math.max(0.05, (1.0 - this.rodBend) * 0.85);
      const lp = this.fishingLineGeo.attributes.position;
      const minLineY = (oceanY + 0.02) - rigY;
      for (let i = 0; i < 12; i++) {
        const f = i / 11;
        const lx = THREE.MathUtils.lerp(tip.x, end.x, f);
        const lz = THREE.MathUtils.lerp(tip.z, end.z, f);
        const ly = THREE.MathUtils.lerp(tip.y, end.y, f) - Math.sin(f * Math.PI) * sag;
        lp.setXYZ(i, lx, Math.max(minLineY, ly), lz);
      }
      lp.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
