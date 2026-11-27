import * as THREE from 'three';

const WATER_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uWaveAmp;
  varying vec3 vWorldPos;
  varying float vElevation;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    float w1 = sin(worldPos.x * 0.22 + uTime * 1.4) * cos(worldPos.z * 0.18 + uTime * 1.1);
    float w2 = sin(worldPos.x * 0.55 - uTime * 2.1 + worldPos.z * 0.42) * 0.45;
    float w3 = cos(worldPos.z * 0.85 + uTime * 2.8) * 0.2;
    float elev = (w1 + w2 + w3) * uWaveAmp;
    worldPos.y += elev;
    vWorldPos = worldPos.xyz;
    vElevation = elev;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WATER_FRAGMENT_SHADER = `
  uniform vec3 uDeepColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vElevation;

  void main() {
    // 簡易法線近似
    float nx = cos(vWorldPos.x * 0.35 + uTime * 1.6) * 0.14;
    float nz = sin(vWorldPos.z * 0.32 + uTime * 1.3) * 0.14;
    vec3 normal = normalize(vec3(nx, 1.0, nz));

    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.2);

    // 太陽の鏡面反射（キラキラ感）
    vec3 halfVec = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 96.0);

    vec3 baseCol = mix(uDeepColor, uSkyColor * 0.85, clamp(fresnel + 0.12, 0.0, 1.0));
    baseCol += vec3(0.06, 0.12, 0.16) * max(vElevation, 0.0);
    vec3 finalCol = baseCol + uSunColor * spec * 1.35;

    // 遠景フォグ
    float dist = length(uCameraPos - vWorldPos);
    float fogFactor = smoothstep(45.0, 180.0, dist);
    finalCol = mix(finalCol, uSkyColor, fogFactor);

    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

export class FishingScene3D {
  constructor(container) {
    this.container = container;
    this.quality = 'high';
    this.clockTime = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(0, 2.5, 3.2);
    this.camera.lookAt(0, 0.3, -18);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.sunLight = new THREE.DirectionalLight(0xfff4dd, 1.8);
    this.sunLight.position.set(20, 25, -40);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0x7ca2c4, 0.7));

    this.createEnvironment();
    this.createWater();
    this.createRodAndLine();
    this.createLureAndAim();
    this.createSplashPool();

    this.setQuality('high');
    const _syncSize = () => { this.onResize(); setTimeout(() => this.onResize(), 180); setTimeout(() => this.onResize(), 420); };
    window.addEventListener('resize', _syncSize);
    window.addEventListener('orientationchange', _syncSize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  createEnvironment() {
    // 太陽メッシュ
    const sunGeo = new THREE.SphereGeometry(2.6, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe8b0 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunMesh);

    // 堤防（足元のリアル感）
    const pierGeo = new THREE.BoxGeometry(14, 1.4, 5);
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x5c646b, roughness: 0.92 });
    const pier = new THREE.Mesh(pierGeo, pierMat);
    pier.position.set(0, 0.3, 2.2);
    this.scene.add(pier);

    // 遠くの島影
    const islandGeo = new THREE.ConeGeometry(28, 12, 7);
    const islandMat = new THREE.MeshBasicMaterial({ color: 0x1b3447 });
    this.island = new THREE.Mesh(islandGeo, islandMat);
    this.island.position.set(-38, 3.2, -110);
    this.scene.add(this.island);
  }

  createWater() {
    const geo = new THREE.PlaneGeometry(240, 220, 96, 96);
    geo.rotateX(-Math.PI / 2);

    this.waterUniforms = {
      uTime: { value: 0 },
      uWaveAmp: { value: 0.28 },
      uDeepColor: { value: new THREE.Color(0x062942) },
      uSkyColor: { value: new THREE.Color(0x69a7d6) },
      uSunColor: { value: new THREE.Color(0xffe7b8) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.4, -0.8).normalize() },
      uCameraPos: { value: this.camera.position.clone() }
    };

    this.highWaterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: this.waterUniforms
    });

    this.lowWaterMat = new THREE.MeshBasicMaterial({ color: 0x0b3c5d });

    this.waterMesh = new THREE.Mesh(geo, this.highWaterMat);
    this.waterMesh.position.set(0, 0, -90);
    this.scene.add(this.waterMesh);
  }

  createRodAndLine() {
    // 8節の階層構造でリアルにしなる釣り竿
    this.rodBase = new THREE.Group();
    this.rodBase.position.set(0.68, 1.55, 1.9);
    this.rodBase.rotation.set(0.35, 0.14, 0);
    this.scene.add(this.rodBase);

    this.rodSegments = [];
    let parent = this.rodBase;
    const segLen = 0.34;

    for (let i = 0; i < 8; i++) {
      const segGroup = new THREE.Group();
      if (i > 0) segGroup.position.set(0, 0, -segLen);

      const radiusTop = 0.018 * (1 - i * 0.09);
      const radiusBot = 0.020 * (1 - i * 0.09);
      const cylGeo = new THREE.CylinderGeometry(radiusTop, radiusBot, segLen, 8);
      cylGeo.rotateX(Math.PI / 2);
      cylGeo.translate(0, 0, -segLen / 2);

      const mat = new THREE.MeshStandardMaterial({
        color: i === 0 ? 0x22252a : i === 7 ? 0xff5a36 : 0x161c24,
        roughness: 0.4,
        metalness: 0.35
      });
      segGroup.add(new THREE.Mesh(cylGeo, mat));
      parent.add(segGroup);
      this.rodSegments.push(segGroup);
      parent = segGroup;
    }

    this.rodTipAnchor = new THREE.Object3D();
    this.rodTipAnchor.position.set(0, 0, -segLen);
    parent.add(this.rodTipAnchor);

    // 釣り糸（20頂点）
    this.linePointsCount = 20;
    const positions = new Float32Array(this.linePointsCount * 3);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0xe6f7ff, transparent: true, opacity: 0.85 });
    this.lineMesh = new THREE.Line(this.lineGeo, lineMat);
    this.scene.add(this.lineMesh);
  }

  createLureAndAim() {
    // ルアー/ウキ表示
    const lureGeo = new THREE.SphereGeometry(0.16, 10, 10);
    const lureMat = new THREE.MeshStandardMaterial({ color: 0xff4d3b, emissive: 0x330800 });
    this.lureMesh = new THREE.Mesh(lureGeo, lureMat);
    this.scene.add(this.lureMesh);

    // 照準リング
    const ringGeo = new THREE.RingGeometry(0.55, 0.8, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7ce4ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    this.aimRing = new THREE.Mesh(ringGeo, ringMat);
    this.aimRing.position.set(0, 0.12, -25);
    this.scene.add(this.aimRing);
  }

  createSplashPool() {
    this.splashes = [];
    const geo = new THREE.SphereGeometry(0.11, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.splashes.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0 });
    }
  }

  spawnSplash(x, z, intensity = 1.0) {
    const count = this.quality === 'high' ? 14 : 4;
    let spawned = 0;
    for (const p of this.splashes) {
      if (p.life <= 0) {
        p.mesh.visible = true;
        p.mesh.position.set(x, 0.15, z);
        const angle = Math.random() * Math.PI * 2;
        const speed = (1.2 + Math.random() * 2.5) * intensity;
        p.vx = Math.cos(angle) * speed;
        p.vz = Math.sin(angle) * speed;
        p.vy = (2.2 + Math.random() * 2.8) * intensity;
        p.life = 0.55 + Math.random() * 0.35;
        spawned++;
        if (spawned >= count) break;
      }
    }
  }

  setQuality(mode) {
    this.quality = mode;
    if (mode === 'high') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.waterMesh.material = this.highWaterMat;
    } else {
      this.renderer.setPixelRatio(1);
      this.waterMesh.material = this.lowWaterMat;
    }
  }

  updateAtmosphere(hour, weather) {
    let sky = new THREE.Color(0x63a4d8);
    let deep = new THREE.Color(0x062d47);
    let sun = new THREE.Color(0xfff0cc);
    let sunY = 38;

    if (hour >= 4 && hour < 7) {
      // 早朝
      sky.setHex(0xd48e76);
      deep.setHex(0x132b42);
      sun.setHex(0xffb470);
      sunY = 12;
    } else if (hour >= 16 && hour < 19) {
      // 夕方
      sky.setHex(0xd96f4a);
      deep.setHex(0x162438);
      sun.setHex(0xff9045);
      sunY = 10;
    } else if (hour >= 19 || hour < 4) {
      // 夜
      sky.setHex(0x0a1626);
      deep.setHex(0x030c17);
      sun.setHex(0x88aadd);
      sunY = 26;
    }

    if (weather === 'rain') sky.lerp(new THREE.Color(0x4b5c6b), 0.55);
    if (weather === 'rough') sky.lerp(new THREE.Color(0x32404d), 0.7);

    this.scene.background = sky;
    this.waterUniforms.uSkyColor.value.copy(sky);
    this.waterUniforms.uDeepColor.value.copy(deep);
    this.waterUniforms.uSunColor.value.copy(sun);
    this.waterUniforms.uWaveAmp.value = weather === 'rough' ? 0.58 : weather === 'rain' ? 0.36 : 0.24;

    this.lowWaterMat.color.copy(deep).lerp(sky, 0.25);

    const sunPos = new THREE.Vector3(22, sunY, -115);
    this.sunMesh.position.copy(sunPos);
    this.sunLight.position.copy(sunPos);
    this.waterUniforms.uSunDir.value.copy(sunPos).normalize();
  }

  update(dt, physics, hour, weather) {
    this.clockTime += dt;
    this.waterUniforms.uTime.value = this.clockTime;
    this.updateAtmosphere(hour, weather);

    // 竿の角度としなり（負荷とポンピングに連動）
    const basePitch = 0.25 + physics.rodLift * 0.55 + (physics.phase === 'CHARGING' ? physics.castPower * 0.5 : 0);
    const swayYaw = physics.phase === 'FIGHTING' ? Math.sin(this.clockTime * 8) * 0.06 * physics.rodLoad : -physics.aimX * 0.02;
    this.rodBase.rotation.x = basePitch;
    this.rodBase.rotation.y = 0.12 + swayYaw;

    const bend = physics.rodLoad * 0.24;
    this.rodSegments.forEach((seg, idx) => {
      if (idx > 0) {
        seg.rotation.x = -bend * (idx / 5);
      }
    });

    // ルアー＆照準表示
    this.aimRing.visible = physics.phase === 'IDLE' || physics.phase === 'CHARGING';
    this.aimRing.position.set(physics.aimX, 0.14, -(14 + physics.castPower * 30));

    this.lureMesh.visible = physics.phase !== 'IDLE' && physics.phase !== 'CHARGING';
    this.lureMesh.position.set(physics.lure.x, Math.max(-0.08, physics.lure.y), physics.lure.z);

    // 釣り糸の更新（張力が低いと垂れ下がる）
    const tipPos = new THREE.Vector3();
    this.rodTipAnchor.getWorldPosition(tipPos);
    const endPos = this.lureMesh.visible ? this.lureMesh.position : tipPos.clone().add(new THREE.Vector3(0, -0.8, -0.3));
    const sag = Math.max(0.02, (1 - physics.lineLoad) * 1.4);

    const posAttr = this.lineGeo.attributes.position;
    for (let i = 0; i < this.linePointsCount; i++) {
      const t = i / (this.linePointsCount - 1);
      const x = THREE.MathUtils.lerp(tipPos.x, endPos.x, t);
      const z = THREE.MathUtils.lerp(tipPos.z, endPos.z, t);
      const y = THREE.MathUtils.lerp(tipPos.y, endPos.y, t) - Math.sin(t * Math.PI) * sag;
      posAttr.setXYZ(i, x, Math.max(0.02, y), z);
    }
    posAttr.needsUpdate = true;

    // 水しぶきパーティクル更新
    for (const p of this.splashes) {
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 9.8 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        if (p.life <= 0 || p.mesh.position.y < -0.2) {
          p.life = 0;
          p.mesh.visible = false;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const w = window.innerWidth || document.documentElement.clientWidth || 1;
    const h = window.innerHeight || document.documentElement.clientHeight || 1;
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? Math.min(74, 58 + (1 - aspect) * 26) : 56;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
  }
}
