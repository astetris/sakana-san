import * as THREE from "three";

export class FishingScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff4d6, 1.3);
    this.sun.position.set(18, 28, -20);
    this.scene.add(this.sun);

    // 無限追従する海面
    const seaGeo = new THREE.PlaneGeometry(240, 240, 44, 44);
    seaGeo.rotateX(-Math.PI / 2);
    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x0b4f78,
      roughness: 0.25,
      metalness: 0.25,
      flatShading: true
    });
    this.sea = new THREE.Mesh(seaGeo, this.seaMat);
    this.scene.add(this.sea);
    this.basePos = Float32Array.from(seaGeo.attributes.position.array);

    // プレイヤー基点（岸または船）
    this.playerRig = new THREE.Group();
    this.scene.add(this.playerRig);

    this.camera.position.set(0, 3.2, 7.2);
    this.camera.lookAt(0, 0.6, -12);
    this.playerRig.add(this.camera);

    // 堤防/桟橋
    this.pier = new THREE.Mesh(
      new THREE.BoxGeometry(8, 1.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x3b424c, roughness: 0.9 })
    );
    this.pier.position.set(0, 0.45, 5.8);
    this.playerRig.add(this.pier);

    // 船モデル（船首・デッキ・航海灯）
    this.boatGroup = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.9, 6.4),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 })
    );
    hull.position.set(0, 0.25, 3.4);
    const bow = new THREE.Mesh(
      new THREE.ConeGeometry(1.65, 2.8, 4),
      new THREE.MeshStandardMaterial({ color: 0x1e40af, roughness: 0.4 })
    );
    bow.rotation.x = -Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.position.set(0, 0.3, -1.0);
    const railL = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.5, 5.8),
      new THREE.MeshStandardMaterial({ color: 0x334155 })
    );
    railL.position.set(-1.55, 0.85, 3.2);
    const railR = railL.clone();
    railR.position.x = 1.55;
    this.boatGroup.add(hull, bow, railL, railR);
    this.boatGroup.visible = false;
    this.playerRig.add(this.boatGroup);

    // 夜の港/航海ライト
    this.portLight = new THREE.PointLight(0xffb85c, 0, 24);
    this.portLight.position.set(-2.5, 4.2, 4.2);
    this.playerRig.add(this.portLight);

    // 釣り竿
    this.rodGroup = new THREE.Group();
    this.rodGroup.position.set(0.85, 1.8, 5.0);
    const rodMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.045, 3.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x1d2530, metalness: 0.6, roughness: 0.3 })
    );
    rodMesh.rotation.x = -Math.PI / 2.6;
    rodMesh.position.set(0, 0.4, -1.5);
    this.rodGroup.add(rodMesh);
    this.playerRig.add(this.rodGroup);

    // ウキ（プレイヤー前方基準）
    this.bobber = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0x550000 })
    );
    this.bobber.visible = false;
    this.playerRig.add(this.bobber);

    // 雨パーティクル
    const rainCount = 260;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 34;
      rainPositions[i * 3 + 1] = Math.random() * 16;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 6;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    this.rain = new THREE.Points(
      rainGeo,
      new THREE.PointsMaterial({ color: 0xcbe8ff, size: 0.09, transparent: true, opacity: 0.6 })
    );
    this.rain.visible = false;
    this.playerRig.add(this.rain);

    // 魚群スポット（3箇所）
    this.hotspots = [];
    this.hotspotGroup = new THREE.Group();
    this.scene.add(this.hotspotGroup);
    this.spawnHotspots(0, 0);

    this.clock = new THREE.Clock();
    this.rodBend = 0;
    this.bobberDip = 0;
    this.bobberDist = 18;
    this.waveAmp = 1.0;

    // 船の操船状態
    this.isBoatArea = false;
    this.boatPos = new THREE.Vector2(0, 0);
    this.boatYaw = 0;
    this.boatSpeed = 1.0;
    this.steerInput = { left: false, right: false, fwd: false };
    this.autopilot = false;
    this.onFuelConsume = null;
    this.fuelDistAccum = 0;

    window.addEventListener("resize", () => this.resize());
    this.animate();
  }

  spawnHotspots(cx, cz) {
    while (this.hotspotGroup.children.length) {
      this.hotspotGroup.remove(this.hotspotGroup.children[0]);
    }
    this.hotspots = [];
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3 + Math.random() * 0.8;
      const dist = 24 + Math.random() * 28;
      const hx = cx + Math.cos(ang) * dist;
      const hz = cz + Math.sin(ang) * dist;

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.6, 3.4, 24),
        new THREE.MeshBasicMaterial({ color: 0x38e59a, side: THREE.DoubleSide, transparent: true, opacity: 0.72 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(hx, 0.25, hz);
      this.hotspotGroup.add(ring);
      this.hotspots.push({ x: hx, z: hz, mesh: ring });
    }
  }

  setAreaMode(isBoatArea, boatSpeed = 1.0) {
    this.isBoatArea = isBoatArea;
    this.boatSpeed = boatSpeed || 1.0;
    this.pier.visible = !isBoatArea;
    this.boatGroup.visible = isBoatArea;
    this.hotspotGroup.visible = isBoatArea;
    this.autopilot = false;
    if (!isBoatArea) {
      this.boatPos.set(0, 0);
      this.boatYaw = 0;
      this.playerRig.position.set(0, 0, 0);
      this.playerRig.rotation.set(0, 0, 0);
    } else {
      this.spawnHotspots(this.boatPos.x, this.boatPos.y);
    }
  }

  setMode(mode) {
    this.rodGroup.visible = mode === "fish";
  }

  getNearestHotspot() {
    if (!this.isBoatArea || !this.hotspots.length) return { dist: 999, inSpot: false, spot: null };
    let best = null;
    let minDist = Infinity;
    for (const h of this.hotspots) {
      const d = Math.hypot(h.x - this.boatPos.x, h.z - this.boatPos.y);
      if (d < minDist) { minDist = d; best = h; }
    }
    return { dist: minDist, inSpot: minDist <= 9.5, spot: best };
  }

  toggleAutopilot(forceState) {
    this.autopilot = typeof forceState === "boolean" ? forceState : !this.autopilot;
    return this.autopilot;
  }

  applyEnvironment(env) {
    const palettes = {
      dawn:  { sky: 0xd97d54, sea: 0x1d4e6e, sun: 0xffb36b, amb: 0.65, port: 0.8 },
      day:   { sky: 0x6ec3f4, sea: 0x0b5d8a, sun: 0xfff8e7, amb: 0.85, port: 0.0 },
      dusk:  { sky: 0xc85a3a, sea: 0x1c3a57, sun: 0xff8547, amb: 0.55, port: 1.4 },
      night: { sky: 0x071324, sea: 0x061f33, sun: 0x5c7fa3, amb: 0.32, port: 3.2 }
    };
    const p = palettes[env.timePhase] || palettes.day;
    let skyColor = p.sky;
    let fogDensity = 0.008;

    if (env.weather === "fog") { skyColor = 0x8ea3b0; fogDensity = 0.032; }
    else if (env.weather === "rain" || env.weather === "rough") { skyColor = 0x2d3e4f; fogDensity = 0.018; }
    else if (env.weather === "cloudy") { fogDensity = 0.012; }

    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.FogExp2(skyColor, fogDensity);
    this.seaMat.color.setHex(p.sea);
    this.sun.color.setHex(p.sun);
    this.ambient.intensity = p.amb;
    this.portLight.intensity = p.port;
    this.rain.visible = env.weather === "rain" || env.weather === "rough";
    this.waveAmp = env.weather === "rough" ? 2.1 : 1.0;
  }

  setBobber(visible, dist = 18, dip = 0) {
    this.bobber.visible = visible;
    this.bobberDist = dist;
    this.bobberDip = dip;
  }

  setRodBend(val) {
    this.rodBend = val;
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // 操船更新
    if (this.isBoatArea) {
      let moving = false;
      if (this.autopilot) {
        const nearest = this.getNearestHotspot();
        if (nearest.spot && nearest.dist > 5.5) {
          const targetYaw = Math.atan2(-(nearest.spot.x - this.boatPos.x), -(nearest.spot.z - this.boatPos.y));
          let diff = targetYaw - this.boatYaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          this.boatYaw += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.9);
          moving = true;
        } else {
          this.autopilot = false;
        }
      } else {
        if (this.steerInput.left) this.boatYaw += dt * 1.55;
        if (this.steerInput.right) this.boatYaw -= dt * 1.55;
        if (this.steerInput.fwd) moving = true;
      }

      if (moving) {
        const stepDist = dt * 11 * this.boatSpeed;
        const canMove = this.onFuelConsume ? this.onFuelConsume(stepDist) : true;
        if (canMove) {
          this.boatPos.x -= Math.sin(this.boatYaw) * stepDist;
          this.boatPos.y -= Math.cos(this.boatYaw) * stepDist;
          // 遠い魚群を周辺へ再配置
          if (this.getNearestHotspot().dist > 95) this.spawnHotspots(this.boatPos.x, this.boatPos.y);
        } else {
          this.autopilot = false;
        }
      }

      this.playerRig.position.set(this.boatPos.x, Math.sin(t * 2.1) * 0.08 * this.waveAmp, this.boatPos.y);
      this.playerRig.rotation.y = this.boatYaw;
      this.playerRig.rotation.z = Math.sin(t * 1.6) * 0.025 * this.waveAmp;
      this.sea.position.set(this.boatPos.x, 0, this.boatPos.y);

      for (const h of this.hotspots) {
        h.mesh.rotation.z = t * 1.2;
        const s = 1 + Math.sin(t * 3.5) * 0.12;
        h.mesh.scale.set(s, s, 1);
      }
    } else {
      this.sea.position.set(0, 0, 0);
    }

    // 波の揺れ（ワールド座標ベースで継ぎ目なし）
    const pos = this.sea.geometry.attributes.position;
    const ox = this.sea.position.x;
    const oz = this.sea.position.z;
    for (let i = 0; i < pos.count; i++) {
      const wx = this.basePos[i * 3] + ox;
      const wz = this.basePos[i * 3 + 2] + oz;
      const y = (Math.sin(wx * 0.18 + t * 1.6) * 0.16 + Math.cos(wz * 0.15 + t * 1.3) * 0.14) * this.waveAmp;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    if (this.rain.visible) {
      const rp = this.rain.geometry.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        let y = rp.getY(i) - 0.35;
        if (y < 0) y = 16;
        rp.setY(i, y);
      }
      rp.needsUpdate = true;
    }

    if (this.bobber.visible) {
      this.bobber.position.set(0, Math.sin(t * 4) * 0.08 - this.bobberDip, 3.6 - this.bobberDist * 0.65);
    }
    this.rodGroup.rotation.x = -this.rodBend * 0.45 + Math.sin(t * 2) * 0.015;

    this.renderer.render(this.scene, this.camera);
  }
}
