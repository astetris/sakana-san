import * as THREE from "three";

export class FishingScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 3.2, 7.5);
    this.camera.lookAt(0, 0.6, -12);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff4d6, 1.3);
    this.sun.position.set(18, 28, -20);
    this.scene.add(this.sun);

    const seaGeo = new THREE.PlaneGeometry(240, 240, 48, 48);
    seaGeo.rotateX(-Math.PI / 2);
    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x0b4f78,
      roughness: 0.25,
      metalness: 0.25,
      flatShading: true
    });
    this.sea = new THREE.Mesh(seaGeo, this.seaMat);
    this.scene.add(this.sea);
    this.baseY = Float32Array.from(seaGeo.attributes.position.array);

    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(8, 1.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x3b424c, roughness: 0.9 })
    );
    pier.position.set(0, 0.5, 6.2);
    this.scene.add(pier);

    this.portLight = new THREE.PointLight(0xffb85c, 0, 22);
    this.portLight.position.set(-3.2, 4.5, 4.5);
    this.scene.add(this.portLight);

    this.rodGroup = new THREE.Group();
    this.rodGroup.position.set(0.85, 1.8, 5.4);
    const rodMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.045, 3.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x1d2530, metalness: 0.6, roughness: 0.3 })
    );
    rodMesh.rotation.x = -Math.PI / 2.6;
    rodMesh.position.set(0, 0.4, -1.5);
    this.rodGroup.add(rodMesh);
    this.scene.add(this.rodGroup);

    this.bobber = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0x550000 })
    );
    this.bobber.visible = false;
    this.scene.add(this.bobber);

    // 雨パーティクル
    const rainCount = 300;
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
    this.scene.add(this.rain);

    this.clock = new THREE.Clock();
    this.rodBend = 0;
    this.bobberDip = 0;
    this.bobberDist = 18;
    this.waveAmp = 1.0;

    window.addEventListener("resize", () => this.resize());
    this.animate();
  }

  setMode(mode) {
    this.rodGroup.visible = mode === "fish";
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
    const t = this.clock.getElapsedTime();

    const pos = this.sea.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = this.baseY[i * 3];
      const z = this.baseY[i * 3 + 2];
      const y = (Math.sin(x * 0.18 + t * 1.6) * 0.16 + Math.cos(z * 0.15 + t * 1.3) * 0.14) * this.waveAmp;
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
      this.bobber.position.set(0, Math.sin(t * 4) * 0.08 - this.bobberDip, 4 - this.bobberDist * 0.65);
    }
    this.rodGroup.rotation.x = -this.rodBend * 0.45 + Math.sin(t * 2) * 0.015;

    this.renderer.render(this.scene, this.camera);
  }
}
