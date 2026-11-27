import * as THREE from "three";
import { clampWorldPosition } from "../systems/worldMap.js";

function createNameSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(10, 22, 36, 0.82)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
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

export class FishingScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 450);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff4d6, 1.35);
    this.sun.position.set(28, 45, -20);
    this.scene.add(this.sun);

    const seaGeo = new THREE.PlaneGeometry(340, 340, 44, 44);
    seaGeo.rotateX(-Math.PI / 2);
    this.seaMat = new THREE.MeshStandardMaterial({ color: 0x0b4f78, roughness: 0.25, metalness: 0.22, flatShading: true });
    this.sea = new THREE.Mesh(seaGeo, this.seaMat);
    this.scene.add(this.sea);
    this.basePos = Float32Array.from(seaGeo.attributes.position.array);

    this.buildWorldTerrain();

    this.playerRig = new THREE.Group();
    this.scene.add(this.playerRig);
    this.camera.position.set(0, 3.0, 6.2);
    this.camera.lookAt(0, 0.9, -12);
    this.playerRig.add(this.camera);

    this.boatGroup = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.9, 6.0), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 }));
    hull.position.set(0, 0.25, 1.8);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.55, 2.6, 4), new THREE.MeshStandardMaterial({ color: 0xb5732b, roughness: 0.4 }));
    bow.rotation.x = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0, 0.3, -2.3);
    this.boatGroup.add(hull, bow);
    this.boatGroup.visible = false;
    this.playerRig.add(this.boatGroup);

    this.parkedBoat = this.boatGroup.clone();
    this.parkedBoat.visible = true;
    this.parkedBoat.position.set(4.5, 0.1, -10.5);
    this.scene.add(this.parkedBoat);

    this.portLight = new THREE.PointLight(0xffb85c, 0, 28);
    this.portLight.position.set(0, 5.2, 2.0);
    this.playerRig.add(this.portLight);

    this.rodGroup = new THREE.Group();
    this.rodGroup.position.set(0.85, 1.7, 3.6);
    const rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.045, 3.6, 8), new THREE.MeshStandardMaterial({ color: 0x1d2530, metalness: 0.6, roughness: 0.3 }));
    rodMesh.rotation.x = -Math.PI / 2.6; rodMesh.position.set(0, 0.4, -1.4);
    this.rodGroup.add(rodMesh);
    this.playerRig.add(this.rodGroup);

    this.bobber = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0x550000 }));
    this.bobber.visible = false;
    this.playerRig.add(this.bobber);

    const rainCount = 240;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 34;
      rainPositions[i * 3 + 1] = Math.random() * 16;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 6;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    this.rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xcbe8ff, size: 0.09, transparent: true, opacity: 0.6 }));
    this.rain.visible = false;
    this.playerRig.add(this.rain);

    this.hotspots = [];
    this.hotspotGroup = new THREE.Group();
    this.scene.add(this.hotspotGroup);
    this.spawnWorldHotspots();

    // 他プレイヤー管理（Phase 5 マルチ同期）
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

  buildWorldTerrain() {
    const world = new THREE.Group();
    const portDeck = new THREE.Mesh(new THREE.BoxGeometry(74, 1.4, 44), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 }));
    portDeck.position.set(0, 0.2, 22);
    const pier = new THREE.Mesh(new THREE.BoxGeometry(9, 1.1, 16), new THREE.MeshStandardMaterial({ color: 0x78563a, roughness: 0.85 }));
    pier.position.set(0, 0.25, -7);
    const lighthouse = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 13, 10), new THREE.MeshStandardMaterial({ color: 0xf8fafc }));
    lighthouse.position.set(28, 7, 4);
    const lhTop = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0x440000 }));
    lhTop.position.set(28, 13.5, 4);
    const market = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 10), new THREE.MeshStandardMaterial({ color: 0x334155 }));
    market.position.set(-18, 3.8, 22);
    const aquarium = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.2, metalness: 0.3 }));
    aquarium.position.set(16, 0.9, 25);
    const beach = new THREE.Mesh(new THREE.BoxGeometry(74, 1.1, 46), new THREE.MeshStandardMaterial({ color: 0xd9c28a, roughness: 0.95 }));
    beach.position.set(-73, 0.05, 22);
    const riverBank = new THREE.Mesh(new THREE.BoxGeometry(66, 1.2, 48), new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.95 }));
    riverBank.position.set(-142, 0.1, 26);
    const riverWater = new THREE.Mesh(new THREE.BoxGeometry(16, 1.28, 52), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.25 }));
    riverWater.position.set(-134, 0.12, 22);
    const isoBase = new THREE.Mesh(new THREE.BoxGeometry(110, 1.3, 46), new THREE.MeshStandardMaterial({ color: 0x44403c, roughness: 0.95 }));
    isoBase.position.set(92, 0.15, 22);
    world.add(portDeck, pier, lighthouse, lhTop, market, aquarium, beach, riverBank, riverWater, isoBase);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x292524, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2 + (i % 4) * 1.1, 0), rockMat);
      rock.position.set(44 + i * 7.2, 1.2, 3 + (i % 3) * 8);
      world.add(rock);
    }

    const tropicalIsland = new THREE.Mesh(new THREE.CylinderGeometry(18, 28, 4, 14), new THREE.MeshStandardMaterial({ color: 0xe9d5a1, roughness: 0.9 }));
    tropicalIsland.position.set(145, 0.6, -295);
    const palmCrown = new THREE.Mesh(new THREE.ConeGeometry(7, 10, 8), new THREE.MeshStandardMaterial({ color: 0x15803d }));
    palmCrown.position.set(145, 8, -295);
    world.add(tropicalIsland, palmCrown);

    const addBuoy = (x, z, col) => {
      const b = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5, 8), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 }));
      b.position.set(x, 2.2, z); world.add(b);
    };
    addBuoy(-125, -280, 0x818cf8);
    addBuoy(0, -290, 0xf97316);
    this.scene.add(world);
  }

  // ===== 他プレイヤー3Dアバター同期 =====
  createRemoteAvatar(data) {
    const group = new THREE.Group();

    // 徒歩アバター（漁師シルエット）
    const person = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0x0ea5e9 }));
    body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 10), new THREE.MeshStandardMaterial({ color: 0xfde68a }));
    head.position.y = 1.85;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xd49449 }));
    hat.position.y = 2.15;
    person.add(body, head, hat);

    // 船アバター（青ラインの僚船）
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.85, 5.6), new THREE.MeshStandardMaterial({ color: 0xf1f5f9 }));
    hull.position.set(0, 0.3, 0);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.45, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0x0284c7 }));
    bow.rotation.x = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0, 0.35, -3.9);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.8), new THREE.MeshStandardMaterial({ color: 0x38bdf8 }));
    cabin.position.set(0, 1.2, 0.4);
    boat.add(hull, bow, cabin);

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

    // いなくなったプレイヤーを削除
    for (const [uid, av] of this.remoteAvatars.entries()) {
      if (!activeIds.has(uid)) {
        av.labelSprite.material.map?.dispose();
        av.labelSprite.material.dispose();
        this.remoteGroup.remove(av.group);
        this.remoteAvatars.delete(uid);
      }
    }

    // 新規追加・更新
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
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.3, 24), new THREE.MeshBasicMaterial({ color: 0x38e59a, side: THREE.DoubleSide, transparent: true, opacity: 0.72 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(hx, 0.25, hz);
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
  updateBoatSpec(boatSpeed, boatTier) { this.boatSpeed = boatSpeed || 1.2; this.boatTier = boatTier || 0; this.parkedBoat.visible = !this.isBoating && this.boatTier > 0; }
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
      dawn:  { sky: 0xd97d54, sea: 0x1d4e6e, sun: 0xffb36b, amb: 0.65, port: 0.8 },
      day:   { sky: 0x6ec3f4, sea: 0x0b5d8a, sun: 0xfff8e7, amb: 0.85, port: 0.0 },
      dusk:  { sky: 0xc85a3a, sea: 0x1c3a57, sun: 0xff8547, amb: 0.55, port: 1.4 },
      night: { sky: 0x071324, sea: 0x061f33, sun: 0x5c7fa3, amb: 0.32, port: 3.2 }
    };
    const p = palettes[env.timePhase] || palettes.day;
    let skyColor = p.sky, fogDensity = 0.0055;
    if (env.weather === "fog") { skyColor = 0x8ea3b0; fogDensity = 0.022; }
    else if (env.weather === "rain" || env.weather === "rough") { skyColor = 0x2d3e4f; fogDensity = 0.013; }
    else if (env.weather === "cloudy") { fogDensity = 0.008; }
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.FogExp2(skyColor, fogDensity);
    this.seaMat.color.setHex(p.sea); this.sun.color.setHex(p.sun);
    this.ambient.intensity = p.amb; this.portLight.intensity = p.port;
    this.rain.visible = env.weather === "rain" || env.weather === "rough";
    this.waveAmp = env.weather === "rough" ? 2.0 : 1.0;
  }

  setBobber(visible, dist = 18, dip = 0) { this.bobber.visible = visible; this.bobberDist = dist; this.bobberDip = dip; }
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

    this.playerRig.position.set(this.pos.x, this.isBoating ? Math.sin(t * 2.1) * 0.08 * this.waveAmp : 0.72, this.pos.y);
    this.playerRig.rotation.y = this.yaw;
    this.playerRig.rotation.z = this.isBoating ? Math.sin(t * 1.6) * 0.025 * this.waveAmp : 0;

    // 他プレイヤーアバターの滑らか補間
    for (const av of this.remoteAvatars.values()) {
      av.group.position.x += (av.targetX - av.group.position.x) * Math.min(1, dt * 7);
      av.group.position.z += (av.targetZ - av.group.position.z) * Math.min(1, dt * 7);
      av.group.position.y = av.isBoating ? Math.sin(t * 2.1 + av.targetX) * 0.08 * this.waveAmp : 0.85;
      av.group.rotation.y = av.targetYaw;
    }

    this.sea.position.set(this.pos.x, 0, this.pos.y);
    const posAttr = this.sea.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const wx = this.basePos[i * 3] + this.pos.x, wz = this.basePos[i * 3 + 2] + this.pos.y;
      posAttr.setY(i, (Math.sin(wx * 0.16 + t * 1.5) * 0.15 + Math.cos(wz * 0.14 + t * 1.2) * 0.13) * this.waveAmp);
    }
    posAttr.needsUpdate = true;

    for (const h of this.hotspots) {
      h.mesh.rotation.z = t * 1.2;
      const s = 1 + Math.sin(t * 3.5) * 0.12; h.mesh.scale.set(s, s, 1);
    }
    if (this.rain.visible) {
      const rp = this.rain.geometry.attributes.position;
      for (let i = 0; i < rp.count; i++) { let y = rp.getY(i) - 0.35; if (y < 0) y = 16; rp.setY(i, y); }
      rp.needsUpdate = true;
    }
    if (this.bobber.visible) this.bobber.position.set(0, Math.sin(t * 4) * 0.08 - this.bobberDip, 2.5 - this.bobberDist * 0.6);
    this.rodGroup.rotation.x = -this.rodBend * 0.45 + Math.sin(t * 2) * 0.015;
    this.renderer.render(this.scene, this.camera);
  }
}
