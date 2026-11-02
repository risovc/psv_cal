/**
 * PSVCalc Pro — Step 8 Interactive 3D Process Plant & Cutaway Contactor Scene (plant-3d.js)
 * -----------------------------------------------------------------------------------------
 * Self-contained Three.js WebGL Digital Twin:
 *   - Rotatable / zoomable 3D process skid (OrbitControls + camera presets)
 *   - Cutaway C-1001 Trayed Contactor showing all N internal sieve trays, alternating
 *     segmental downcomers, active bubbling froth decks, and top demister pad
 *   - Cutaway V-1001 Inlet Separator with live oil level + instanced 3D falling oil droplets,
 *     rising gas bubbles, and overhead mist carryover driven by Peng-Robinson k_ij
 *   - Active PSV relief valve + inlet/tailpipe piping + P-3102A pump + FCV-1014 + E-1002 + V-5001 flare
 *   - GPU Raycaster picking on all 7 equipment units, N individual trays, and 8 streams (S-01..S-08)
 */
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const STREAM_COLORS = {
  'S-01': 0x0ea5e9, // Raw two-phase feed
  'S-02': 0x38bdf8, // Separator gas -> contactor
  'S-03': 0xd97706, // Separator oil / condensate draw
  'S-04': 0x10b981, // Lean solvent top feed
  'S-05': 0x22c55e, // Sweet sales gas export
  'S-06': 0x8b5cf6, // Rich bottoms -> reboiler
  'S-07': 0xf59e0b, // PSV inlet stub
  'S-08': 0xf97316  // PSV tailpipe -> flare
};

const CAMERA_PRESETS = {
  overview: { pos: [11.5, 8.2, 13.8], target: [0.4, 3.3, 0.2] },
  contactor: { pos: [0.3, 4.5, 6.9], target: [0.0, 4.1, 0.0] },
  separator: { pos: [-5.2, 3.4, 6.2], target: [-5.3, 2.3, 0.6] },
  psv_flare: { pos: [4.2, 7.6, 8.8], target: [3.2, 5.8, -0.3] }
};

function createController() {
  let container = null;
  let canvasWrap = null;
  let labelsLayer = null;
  let callbacks = {};
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let pmremGen = null;
  let resizeObs = null;
  let isSoftwareGl = false;
  let webglAvailable = true;
  let rafId = 0;
  let lastFrameMs = 0;
  let activePreset = 'overview';

  let latestSim = null;
  let selectedEntity = { kind: 'unit', id: 'C-1001' };
  let hoveredKey = null;
  let cutawayPct = 78;

  // Scene registries for raycasting, highlighting, and dynamic updates
  const pickableMeshes = [];
  const entityMeshes = new Map(); // key "kind:id" -> Mesh[]
  const labelPins = [];           // { key, kind, id, anchor: Vector3, el: HTMLElement }

  // Dynamic mesh handles
  let plantRoot = null;
  let contactorGroup = null;
  let traysGroup = null;
  let builtTrayCount = 0;
  let contactorFrontShellMat = null;
  let sepFrontShellMat = null;
  let sepLiquidMesh = null;
  let psvBonnetMat = null;
  let psvPlumeMesh = null;
  let flareFlameGroup = null;
  let flareLight = null;
  const trayDeckMats = [];
  const trayFrothMeshes = [];
  const streamPipeMats = new Map();
  const streamCurves = new Map();

  // Instanced particle systems (pre-allocated for zero GC churn)
  const MAX_OIL_DROPS = 150;
  const MAX_GAS_BUBBLES = 160;
  const MAX_MIST_DROPS = 90;
  const MAX_PIPE_PULSES = 96;

  let oilDropsInst = null;
  let gasBubblesInst = null;
  let mistDropsInst = null;
  let pipePulsesInst = null;

  const oilSeeds = Array.from({ length: MAX_OIL_DROPS }, (_, i) => ({
    u: ((i * 0.6180339887) % 1),
    v: ((i * 0.3819660113 + 0.17) % 1),
    w: ((i * 0.7548776662 + 0.41) % 1),
    phase: (i * 0.293) % 1
  }));
  const gasSeeds = Array.from({ length: MAX_GAS_BUBBLES }, (_, i) => ({
    r: Math.sqrt(((i * 0.6180339) % 1)) * 0.78,
    ang: (i * 2.3999632) % (Math.PI * 2),
    phase: (i * 0.173) % 1,
    inSep: i < 42
  }));
  const mistSeeds = Array.from({ length: MAX_MIST_DROPS }, (_, i) => ({
    r: Math.sqrt(((i * 0.4721359) % 1)) * 0.82,
    ang: (i * 2.3999632) % (Math.PI * 2),
    phase: (i * 0.237) % 1
  }));

  // Scratch math objects
  const tmpMat4 = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3(1, 1, 1);
  const tmpColor = new THREE.Color();
  const projVec = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDownXY = null;

  function entityKey(kind, id) {
    return `${kind}:${id}`;
  }

  function registerPickable(mesh, info) {
    mesh.userData.pickInfo = info;
    pickableMeshes.push(mesh);
    const key = entityKey(info.kind, info.id);
    if (!entityMeshes.has(key)) entityMeshes.set(key, []);
    entityMeshes.get(key).push(mesh);
    // Store baseline emissive so selection/hover highlight restores cleanly
    if (mesh.material && mesh.material.emissive && !mesh.userData.baseEmissiveSaved) {
      mesh.userData.baseEmissiveHex = mesh.material.emissive.getHex();
      mesh.userData.baseEmissiveIntensity = mesh.material.emissiveIntensity || 0;
      mesh.userData.baseEmissiveSaved = true;
    }
  }

  function clearPickablesForPrefix(prefix) {
    for (let i = pickableMeshes.length - 1; i >= 0; i--) {
      const info = pickableMeshes[i].userData.pickInfo;
      if (info && entityKey(info.kind, info.id).startsWith(prefix)) {
        pickableMeshes.splice(i, 1);
      }
    }
    for (const k of Array.from(entityMeshes.keys())) {
      if (k.startsWith(prefix)) entityMeshes.delete(k);
    }
  }

  function currentTheme() {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applySceneTheme(theme) {
    if (!scene) return;
    const isDark = theme === 'dark';
    scene.background = new THREE.Color(isDark ? 0x0b1220 : 0xeef3f9);
    scene.fog = new THREE.FogExp2(isDark ? 0x0b1220 : 0xeef3f9, 0.015);
  }

  function createLabelPin(kind, id, shortTag, subText, anchorVec3) {
    if (!labelsLayer) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `plant3d-pin plant3d-pin-${kind}`;
    btn.dataset.kind = kind;
    btn.dataset.id = id;
    btn.innerHTML = `<span class="pin-id mono">${shortTag}</span><span class="pin-sub">${subText}</span>`;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectEntity(kind, id, true);
    });
    labelsLayer.appendChild(btn);
    labelPins.push({ key: entityKey(kind, id), kind, id, anchor: anchorVec3, el: btn });
  }

  function buildSkidDeck() {
    const deckGroup = new THREE.Group();
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.55,
      roughness: 0.58
    });
    const baseSlab = new THREE.Mesh(new THREE.BoxGeometry(17.6, 0.28, 9.2), deckMat);
    baseSlab.position.set(0.5, 0.14, 0.2);
    deckGroup.add(baseSlab);

    // Safety yellow perimeter curb
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.3, roughness: 0.45 });
    const frontCurb = new THREE.Mesh(new THREE.BoxGeometry(17.7, 0.09, 0.12), curbMat);
    frontCurb.position.set(0.5, 0.30, 4.78);
    const backCurb = frontCurb.clone();
    backCurb.position.z = -4.38;
    deckGroup.add(frontCurb, backCurb);

    // Engineering grid helper
    const grid = new THREE.GridHelper(17.4, 24, 0x38bdf8, 0x475569);
    grid.position.set(0.5, 0.29, 0.2);
    if (Array.isArray(grid.material)) {
      grid.material.forEach(m => { m.transparent = true; m.opacity = 0.26; });
    } else {
      grid.material.transparent = true;
      grid.material.opacity = 0.26;
    }
    deckGroup.add(grid);
    plantRoot.add(deckGroup);
  }

  function buildInletSeparator() {
    // V-1001 Horizontal 3-Phase Separator on twin saddles at x = -5.3, y = 2.15, z = 0.6
    const grp = new THREE.Group();
    grp.position.set(-5.3, 2.15, 0.6);
    const R = 1.02;
    const L = 3.9;

    const saddleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.45 });
    [-1.35, 1.35].forEach(dx => {
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.9, 1.75), saddleMat);
      saddle.position.set(dx, -1.05, 0);
      grp.add(saddle);
    });

    // Back steel shell (solid 210 deg)
    const backShellMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.72,
      roughness: 0.28,
      side: THREE.DoubleSide
    });
    const backCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, L, 28, 1, true, Math.PI * 0.42, Math.PI * 1.16),
      backShellMat
    );
    backCyl.rotation.z = Math.PI / 2;
    grp.add(backCyl);
    registerPickable(backCyl, { kind: 'unit', id: 'V-1001' });

    // Front cutaway glass window on V-1001 so oil pool & falling oil drops are always visible
    sepFrontShellMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      metalness: 0.1,
      roughness: 0.15,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const frontCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, L, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
      sepFrontShellMat
    );
    frontCyl.rotation.z = Math.PI / 2;
    grp.add(frontCyl);
    registerPickable(frontCyl, { kind: 'unit', id: 'V-1001' });

    // Left & right 2:1 ellipsoidal heads
    const headMat = backShellMat.clone();
    [-1, 1].forEach(sign => {
      const head = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), headMat);
      head.scale.set(1, 0.52, 1);
      head.rotation.z = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      head.position.set(sign * (L / 2), 0, 0);
      grp.add(head);
      registerPickable(head, { kind: 'unit', id: 'V-1001' });
    });

    // Internal inlet momentum diverter baffle + weir plate
    const baffleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.65, roughness: 0.35 });
    const diverter = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 1.3), baffleMat);
    diverter.position.set(-L * 0.36, 0.18, 0);
    const weir = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.82, 1.55), baffleMat);
    weir.position.set(L * 0.24, -0.45, 0);
    grp.add(diverter, weir);

    // Translucent amber hydrocarbon oil pool inside V-1001 (scaled dynamically by sepLiquidFrac)
    const oilPoolMat = new THREE.MeshPhysicalMaterial({
      color: 0xd97706,
      emissive: 0x78350f,
      emissiveIntensity: 0.22,
      roughness: 0.18,
      metalness: 0.05,
      transparent: true,
      opacity: 0.78
    });
    sepLiquidMesh = new THREE.Mesh(new THREE.BoxGeometry(L * 0.94, 0.75, R * 1.66), oilPoolMat);
    sepLiquidMesh.position.set(0, -0.46, 0);
    grp.add(sepLiquidMesh);
    registerPickable(sepLiquidMesh, { kind: 'unit', id: 'V-1001' });

    plantRoot.add(grp);
    createLabelPin('unit', 'V-1001', 'V-1001', 'Inlet Separator', new THREE.Vector3(-5.3, 3.65, 0.6));
  }

  function rebuildContactorTrays(trayCount) {
    if (!traysGroup) return;
    while (traysGroup.children.length > 0) {
      const ch = traysGroup.children.pop();
      ch.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    trayDeckMats.length = 0;
    trayFrothMeshes.length = 0;
    clearPickablesForPrefix('tray:');

    const colR = 1.08;
    const yBottom = 1.85;
    const yTop = 6.65;
    const span = yTop - yBottom;

    for (let j = 1; j <= trayCount; j++) {
      // j = 1 is Top Tray, j = trayCount is Bottom Tray
      const fracFromTop = trayCount > 1 ? (j - 1) / (trayCount - 1) : 0.5;
      const y = yTop - fracFromTop * span;
      const trayGrp = new THREE.Group();
      trayGrp.position.set(0, y, 0);

      // Sieve tray perforated metallic deck
      const deckMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0369a1,
        emissiveIntensity: 0.18,
        metalness: 0.62,
        roughness: 0.32,
        side: THREE.DoubleSide
      });
      const deckMesh = new THREE.Mesh(new THREE.CylinderGeometry(colR * 0.93, colR * 0.93, 0.045, 26), deckMat);
      trayGrp.add(deckMesh);
      trayDeckMats.push(deckMat);
      registerPickable(deckMesh, { kind: 'tray', id: `TRAY-${j}`, trayNumber: j });

      // Active bubbling froth layer sitting on the sieve deck
      const frothMat = new THREE.MeshPhysicalMaterial({
        color: 0x22d3ee,
        emissive: 0x0891b2,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.52,
        roughness: 0.25,
        depthWrite: false
      });
      const frothMesh = new THREE.Mesh(new THREE.CylinderGeometry(colR * 0.90, colR * 0.90, 0.14, 24), frothMat);
      frothMesh.position.y = 0.09;
      trayGrp.add(frothMesh);
      trayFrothMeshes.push(frothMesh);
      registerPickable(frothMesh, { kind: 'tray', id: `TRAY-${j}`, trayNumber: j });

      // Alternating left/right segmental downcomer apron
      const dcSide = (j % 2 === 1) ? 1 : -1;
      const dcHeight = Math.min(0.46, (span / Math.max(1, trayCount - 1)) * 0.82);
      const dcMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.32 });
      const dcApron = new THREE.Mesh(new THREE.BoxGeometry(0.16, dcHeight, colR * 1.15), dcMat);
      dcApron.position.set(dcSide * colR * 0.72, -dcHeight * 0.48, 0);
      trayGrp.add(dcApron);
      registerPickable(dcApron, { kind: 'tray', id: `TRAY-${j}`, trayNumber: j });

      // Small front rim ring so tray number spacing looks crisp in cutaway
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.25 });
      const weirLip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, colR * 1.18), rimMat);
      weirLip.position.set(dcSide * colR * 0.64, 0.055, 0);
      trayGrp.add(weirLip);

      traysGroup.add(trayGrp);
    }
    builtTrayCount = trayCount;
  }

  function buildContactorColumn() {
    // C-1001 Vertical Trayed Gas-Liquid Contactor centered at x = 0, z = 0
    contactorGroup = new THREE.Group();
    contactorGroup.position.set(0, 0, 0);

    const colR = 1.14;
    const shellBot = 1.25;
    const shellTop = 7.45;
    const shellH = shellTop - shellBot;

    // Steel support skirt from deck y=0.28 to shellBot
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.42 });
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(colR * 0.96, colR * 1.06, shellBot - 0.25, 28), skirtMat);
    skirt.position.y = (shellBot + 0.25) * 0.5;
    contactorGroup.add(skirt);
    registerPickable(skirt, { kind: 'unit', id: 'C-1001' });

    // Back 205-degree solid metallic pressure shell
    const backShellMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.76,
      roughness: 0.26,
      side: THREE.DoubleSide
    });
    const backShell = new THREE.Mesh(
      new THREE.CylinderGeometry(colR, colR, shellH, 32, 1, true, Math.PI * 0.43, Math.PI * 1.14),
      backShellMat
    );
    backShell.position.y = (shellBot + shellTop) * 0.5;
    contactorGroup.add(backShell);
    registerPickable(backShell, { kind: 'unit', id: 'C-1001' });

    // Cutaway longitudinal flange edges on the shell wall so it reads like a machined engineering cutaway
    const cutEdgeMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.5, roughness: 0.35 });
    [-Math.PI * 0.43, Math.PI * 0.43].forEach(ang => {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, shellH, 0.08), cutEdgeMat);
      edge.position.set(Math.sin(ang) * colR, (shellBot + shellTop) * 0.5, Math.cos(ang) * colR);
      edge.rotation.y = ang;
      contactorGroup.add(edge);
    });

    // Front 155-degree cutaway shell controlled by Cutaway / X-Ray slider
    contactorFrontShellMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      metalness: 0.15,
      roughness: 0.16,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const frontShell = new THREE.Mesh(
      new THREE.CylinderGeometry(colR, colR, shellH, 24, 1, true, -Math.PI * 0.43, Math.PI * 0.86),
      contactorFrontShellMat
    );
    frontShell.position.y = (shellBot + shellTop) * 0.5;
    // Note: intentionally NOT registered as pickable when cutaway is open so clicks pass straight to internal trays!
    contactorGroup.add(frontShell);

    // Top & Bottom 2:1 Ellipsoidal Heads
    const topHead = new THREE.Mesh(
      new THREE.SphereGeometry(colR, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
      backShellMat.clone()
    );
    topHead.scale.set(1, 0.55, 1);
    topHead.position.y = shellTop;
    contactorGroup.add(topHead);
    registerPickable(topHead, { kind: 'unit', id: 'C-1001' });

    const botHead = new THREE.Mesh(
      new THREE.SphereGeometry(colR, 28, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      backShellMat.clone()
    );
    botHead.scale.set(1, 0.55, 1);
    botHead.position.y = shellBot;
    contactorGroup.add(botHead);
    registerPickable(botHead, { kind: 'unit', id: 'C-1001' });

    // Top wire-mesh demister pad (above Tray 1 at y = 7.12)
    const demisterMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.5,
      roughness: 0.65,
      wireframe: false,
      transparent: true,
      opacity: 0.72
    });
    const demister = new THREE.Mesh(new THREE.CylinderGeometry(colR * 0.92, colR * 0.92, 0.16, 26), demisterMat);
    demister.position.y = 7.12;
    contactorGroup.add(demister);
    registerPickable(demister, { kind: 'unit', id: 'C-1001' });

    // Rich liquid sump pool at bottom of contactor
    const sumpMat = new THREE.MeshPhysicalMaterial({
      color: 0x6366f1,
      emissive: 0x312e81,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.75,
      roughness: 0.2
    });
    const sumpPool = new THREE.Mesh(new THREE.CylinderGeometry(colR * 0.93, colR * 0.90, 0.42, 24), sumpMat);
    sumpPool.position.y = shellBot + 0.24;
    contactorGroup.add(sumpPool);
    registerPickable(sumpPool, { kind: 'unit', id: 'C-1001' });

    // Dynamic internal trays container
    traysGroup = new THREE.Group();
    contactorGroup.add(traysGroup);
    rebuildContactorTrays(12);

    plantRoot.add(contactorGroup);
    createLabelPin('unit', 'C-1001', 'C-1001', '12-Tray Contactor', new THREE.Vector3(0.0, 8.35, 0.0));
  }

  function buildPsvAndAuxiliaryUnits() {
    // 1. PSV-1001A mounted above C-1001 overhead nozzle at (0.95, 8.35, 0.0)
    const psvGrp = new THREE.Group();
    psvGrp.position.set(0.95, 8.35, 0.0);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.78, roughness: 0.25 });
    const valveBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.46), bodyMat);
    psvGrp.add(valveBody);
    registerPickable(valveBody, { kind: 'unit', id: 'PSV-1001A' });

    psvBonnetMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.32
    });
    const bonnet = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.72, 20), psvBonnetMat);
    bonnet.position.y = 0.58;
    psvGrp.add(bonnet);
    registerPickable(bonnet, { kind: 'unit', id: 'PSV-1001A' });

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.22, 16), bodyMat);
    cap.position.y = 1.02;
    psvGrp.add(cap);
    registerPickable(cap, { kind: 'unit', id: 'PSV-1001A' });

    // Sonic relief plume cone (visible in Relief Simulation mode)
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });
    psvPlumeMesh = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.1, 18), plumeMat);
    psvPlumeMesh.position.set(0.55, 0.12, 0);
    psvPlumeMesh.rotation.z = -Math.PI / 2;
    psvGrp.add(psvPlumeMesh);

    plantRoot.add(psvGrp);
    createLabelPin('unit', 'PSV-1001A', 'PSV-1001A', 'API 526 Relief Valve', new THREE.Vector3(0.95, 9.75, 0.0));

    // 2. P-3102A Lean Solvent Booster Pump (x = 2.75, y = 0.65, z = 2.65)
    const pumpGrp = new THREE.Group();
    pumpGrp.position.set(2.75, 0.65, 2.65);

    const skidPedestal = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.32, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.35, roughness: 0.65 })
    );
    skidPedestal.position.y = -0.2;
    pumpGrp.add(skidPedestal);

    const motorMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, metalness: 0.62, roughness: 0.34 });
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 22), motorMat);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(0.45, 0.32, 0);
    pumpGrp.add(motor);
    registerPickable(motor, { kind: 'unit', id: 'P-3102A' });

    const voluteMat = new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.68, roughness: 0.28 });
    const volute = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 22), voluteMat);
    volute.rotation.x = Math.PI / 2;
    volute.position.set(-0.52, 0.34, 0);
    pumpGrp.add(volute);
    registerPickable(volute, { kind: 'unit', id: 'P-3102A' });

    plantRoot.add(pumpGrp);
    createLabelPin('unit', 'P-3102A', 'P-3102A', 'API 610 Pump', new THREE.Vector3(2.75, 1.85, 2.65));

    // 3. FCV-1014 Lean Solvent Control Valve (x = 1.65, y = 4.65, z = 1.85)
    const fcvGrp = new THREE.Group();
    fcvGrp.position.set(1.65, 4.65, 1.85);
    const fcvBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.75, roughness: 0.3 })
    );
    const fcvActuator = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.26, 0.24, 20),
      new THREE.MeshStandardMaterial({ color: 0x16a34a, metalness: 0.45, roughness: 0.38 })
    );
    fcvActuator.position.y = 0.48;
    const fcvStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.38, 12),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 })
    );
    fcvStem.position.y = 0.24;
    fcvGrp.add(fcvBody, fcvStem, fcvActuator);
    registerPickable(fcvBody, { kind: 'unit', id: 'FCV-1014' });
    registerPickable(fcvActuator, { kind: 'unit', id: 'FCV-1014' });
    plantRoot.add(fcvGrp);
    createLabelPin('unit', 'FCV-1014', 'FCV-1014', 'L/V Control Valve', new THREE.Vector3(1.65, 5.55, 1.85));

    // 4. E-1002 Rich Solvent Reboiler / Exchanger (x = 3.25, y = 1.45, z = -1.85)
    const exchGrp = new THREE.Group();
    exchGrp.position.set(3.25, 1.45, -1.85);
    const exchMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.18,
      metalness: 0.68,
      roughness: 0.34
    });
    const exchShell = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 2.75, 24), exchMat);
    exchShell.rotation.z = Math.PI / 2;
    exchGrp.add(exchShell);
    registerPickable(exchShell, { kind: 'unit', id: 'E-1002' });

    [-0.95, 0.95].forEach(dx => {
      const sup = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 1.15, 0.92),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.55, roughness: 0.5 })
      );
      sup.position.set(dx, -0.68, 0);
      exchGrp.add(sup);
    });
    plantRoot.add(exchGrp);
    createLabelPin('unit', 'E-1002', 'E-1002', 'Rich Reboiler', new THREE.Vector3(3.25, 2.55, -1.85));

    // 5. V-5001 Flare KO Drum & Elevated Flare Stack (x = 6.45, z = -0.65)
    const flareGrp = new THREE.Group();
    flareGrp.position.set(6.45, 0.28, -0.65);

    const koMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.34 });
    const koDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 2.4, 24), koMat);
    koDrum.position.set(0, 1.35, 0);
    flareGrp.add(koDrum);
    registerPickable(koDrum, { kind: 'unit', id: 'V-5001' });

    const stackMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.78, roughness: 0.28 });
    const stackRiser = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.28, 6.8, 20), stackMat);
    stackRiser.position.set(0, 5.8, 0);
    flareGrp.add(stackRiser);
    registerPickable(stackRiser, { kind: 'unit', id: 'V-5001' });

    const flareTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.20, 0.48, 18),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 })
    );
    flareTip.position.set(0, 9.35, 0);
    flareGrp.add(flareTip);
    registerPickable(flareTip, { kind: 'unit', id: 'V-5001' });

    // Flare Flame Plume (small pilot flame in Normal mode, large roaring flame in Relief mode)
    flareFlameGroup = new THREE.Group();
    flareFlameGroup.position.set(0, 9.65, 0);
    const outerFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 1.45, 16),
      new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.86 })
    );
    outerFlame.position.y = 0.65;
    const innerFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.92, 14),
      new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.95 })
    );
    innerFlame.position.y = 0.45;
    flareFlameGroup.add(outerFlame, innerFlame);
    flareFlameGroup.scale.setScalar(0.28);
    flareGrp.add(flareFlameGroup);

    flareLight = new THREE.PointLight(0xf97316, 0.4, 16);
    flareLight.position.set(6.45, 10.5, -0.65);
    scene.add(flareLight);

    plantRoot.add(flareGrp);
    createLabelPin('unit', 'V-5001', 'V-5001', 'Flare KO & Stack', new THREE.Vector3(6.45, 9.25, -0.65));
  }

  function buildProcessStreams() {
    const pipeDefs = [
      {
        id: 'S-01',
        radius: 0.11,
        label: 'S-01 Feed',
        labelAnchor: [-7.75, 2.55, 0.6],
        pts: [
          [-8.3, 2.35, 0.6],
          [-7.25, 2.35, 0.6]
        ]
      },
      {
        id: 'S-02',
        radius: 0.11,
        label: 'S-02 Sep Gas',
        labelAnchor: [-2.65, 3.35, 0.35],
        pts: [
          [-4.2, 3.18, 0.6],
          [-4.2, 3.85, 0.6],
          [-2.1, 3.85, 0.25],
          [-2.1, 1.95, 0.0],
          [-1.12, 1.95, 0.0]
        ]
      },
      {
        id: 'S-03',
        radius: 0.09,
        label: 'S-03 Oil Draw',
        labelAnchor: [-4.6, 0.85, 2.45],
        pts: [
          [-4.25, 1.12, 0.6],
          [-4.25, 0.62, 0.6],
          [-4.25, 0.62, 3.35],
          [-6.8, 0.62, 3.35]
        ]
      },
      {
        id: 'S-04',
        radius: 0.09,
        label: 'S-04 Lean Solvent',
        labelAnchor: [1.65, 6.85, 1.05],
        pts: [
          [2.22, 1.12, 2.65],
          [1.65, 1.12, 1.85],
          [1.65, 4.65, 1.85],
          [1.65, 6.75, 1.85],
          [1.65, 6.75, 0.0],
          [1.12, 6.75, 0.0]
        ]
      },
      {
        id: 'S-05',
        radius: 0.115,
        label: 'S-05 Sales Gas',
        labelAnchor: [-2.35, 8.25, -1.15],
        pts: [
          [-0.35, 7.98, 0.0],
          [-0.35, 8.55, 0.0],
          [-0.35, 8.55, -1.65],
          [-4.8, 8.55, -1.65]
        ]
      },
      {
        id: 'S-06',
        radius: 0.095,
        label: 'S-06 Rich Bottoms',
        labelAnchor: [1.65, 1.05, -1.35],
        pts: [
          [0.0, 0.72, -0.55],
          [0.0, 0.72, -1.85],
          [1.88, 0.72, -1.85],
          [1.88, 1.45, -1.85]
        ]
      },
      {
        id: 'S-07',
        radius: 0.095,
        label: 'S-07 PSV Inlet',
        labelAnchor: [0.55, 8.15, 0.55],
        pts: [
          [0.42, 7.88, 0.0],
          [0.42, 8.35, 0.0],
          [0.95, 8.35, 0.0]
        ]
      },
      {
        id: 'S-08',
        radius: 0.125,
        label: 'S-08 Flare Line',
        labelAnchor: [3.85, 8.55, -0.35],
        pts: [
          [1.18, 8.35, 0.0],
          [3.65, 8.35, -0.65],
          [5.85, 8.35, -0.65],
          [5.85, 2.25, -0.65],
          [6.45, 2.25, -0.65]
        ]
      }
    ];

    pipeDefs.forEach(def => {
      const vecs = def.pts.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.12);
      streamCurves.set(def.id, curve);

      const mat = new THREE.MeshStandardMaterial({
        color: STREAM_COLORS[def.id],
        emissive: STREAM_COLORS[def.id],
        emissiveIntensity: 0.16,
        metalness: 0.55,
        roughness: 0.32
      });
      streamPipeMats.set(def.id, mat);

      const tubeGeo = new THREE.TubeGeometry(curve, 36, def.radius, 12, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, mat);
      plantRoot.add(tubeMesh);
      registerPickable(tubeMesh, { kind: 'stream', id: def.id });

      if (def.id === 'S-05' || def.id === 'S-03' || def.id === 'S-01' || def.id === 'S-08') {
        createLabelPin('stream', def.id, def.id, def.label.replace(/^S-\d+\s+/, ''), new THREE.Vector3(...def.labelAnchor));
      }
    });
  }

  function buildInstancedParticles() {
    // 1. Falling Hydrocarbon Oil Droplets inside V-1001 Separator
    const oilGeo = new THREE.SphereGeometry(0.052, 10, 8);
    const oilMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.38,
      roughness: 0.18,
      metalness: 0.1
    });
    oilDropsInst = new THREE.InstancedMesh(oilGeo, oilMat, MAX_OIL_DROPS);
    oilDropsInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    plantRoot.add(oilDropsInst);

    // 2. Rising Gas Bubbles inside V-1001 & C-1001 Contactor Trays
    const gasGeo = new THREE.SphereGeometry(0.044, 10, 8);
    const gasMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.82,
      roughness: 0.15
    });
    gasBubblesInst = new THREE.InstancedMesh(gasGeo, gasMat, MAX_GAS_BUBBLES);
    gasBubblesInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    plantRoot.add(gasBubblesInst);

    // 3. Entrained Oil / Mist Carryover Droplets above Contactor Top Tray / Demister
    const mistGeo = new THREE.SphereGeometry(0.036, 8, 8);
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0.85
    });
    mistDropsInst = new THREE.InstancedMesh(mistGeo, mistMat, MAX_MIST_DROPS);
    mistDropsInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    plantRoot.add(mistDropsInst);

    // 4. Directional Stream Flow Pulses along all 8 pipes
    const pulseGeo = new THREE.SphereGeometry(0.068, 8, 8);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    pipePulsesInst = new THREE.InstancedMesh(pulseGeo, pulseMat, MAX_PIPE_PULSES);
    pipePulsesInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    plantRoot.add(pipePulsesInst);
  }

  function applySelectionHighlights() {
    const selKey = selectedEntity ? entityKey(selectedEntity.kind, selectedEntity.id) : null;
    entityMeshes.forEach((meshes, key) => {
      const isSel = key === selKey;
      const isHov = key === hoveredKey;
      meshes.forEach(m => {
        if (!m.material || !m.material.emissive) return;
        if (isSel) {
          m.material.emissive.setHex(0x38bdf8);
          m.material.emissiveIntensity = 0.65;
        } else if (isHov) {
          m.material.emissive.setHex(0x7dd3fc);
          m.material.emissiveIntensity = 0.42;
        } else if (m.userData.baseEmissiveSaved) {
          m.material.emissive.setHex(m.userData.baseEmissiveHex);
          m.material.emissiveIntensity = m.userData.baseEmissiveIntensity;
        }
      });
    });

    labelPins.forEach(pin => {
      pin.el.classList.toggle('selected', pin.key === selKey);
    });
  }

  function updateStaticSimulationVisuals(simRes) {
    if (!simRes || !scene) return;
    const trayCount = simRes.contactor.trayCount;
    if (trayCount !== builtTrayCount) {
      rebuildContactorTrays(trayCount);
    }

    // Update C-1001 pin text with current tray count & Sales Gas spec
    const cPin = labelPins.find(p => p.key === 'unit:C-1001');
    if (cPin) {
      const sub = cPin.el.querySelector('.pin-sub');
      if (sub) sub.textContent = `${trayCount}-Tray Contactor`;
    }
    const s5Pin = labelPins.find(p => p.key === 'stream:S-05');
    if (s5Pin) {
      const sub = s5Pin.el.querySelector('.pin-sub');
      if (sub) sub.textContent = simRes.specs.salesGasOnSpec ? 'Sales Gas ON-SPEC' : 'Sales Gas OFF-SPEC';
      s5Pin.el.classList.toggle('pin-offspec', !simRes.specs.salesGasOnSpec);
      s5Pin.el.classList.toggle('pin-onspec', !!simRes.specs.salesGasOnSpec);
    }
    const s3Pin = labelPins.find(p => p.key === 'stream:S-03');
    if (s3Pin) {
      const sub = s3Pin.el.querySelector('.pin-sub');
      if (sub) sub.textContent = simRes.specs.oilOnSpec ? 'Oil ON-SPEC' : 'Oil RVP OFF-SPEC';
      s3Pin.el.classList.toggle('pin-offspec', !simRes.specs.oilOnSpec);
      s3Pin.el.classList.toggle('pin-onspec', !!simRes.specs.oilOnSpec);
    }
    const psvPin = labelPins.find(p => p.key === 'unit:PSV-1001A');
    if (psvPin) {
      const idSpan = psvPin.el.querySelector('.pin-id');
      const sub = psvPin.el.querySelector('.pin-sub');
      const tagNo = (simRes.units['PSV-1001A'] && simRes.units['PSV-1001A'].name.split(' ')[0]) || 'PSV-1001A';
      if (idSpan) idSpan.textContent = tagNo;
      if (sub) sub.textContent = simRes.sim.operatingMode === 'relief' ? 'RELIEVING!' : `Orifice "${simRes.geometry.psvOrificeLetter}"`;
      psvPin.el.classList.toggle('pin-offspec', simRes.sim.operatingMode === 'relief');
    }

    // Update V-1001 liquid oil pool height from PR phase split (1 - beta)
    if (sepLiquidMesh) {
      const lf = simRes.geometry.sepLiquidFrac; // 0.16 .. 0.72
      const hScale = Math.max(0.28, lf * 1.65);
      sepLiquidMesh.scale.y = hScale;
      sepLiquidMesh.position.y = -0.92 + 0.375 * hScale;
      // Tint oil warmer/redder if swollen off-spec
      sepLiquidMesh.material.color.setHex(simRes.specs.oilOnSpec ? 0xd97706 : 0xea580c);
    }

    // Update per-tray deck color & froth thickness from Kremser + Fair flood profile
    const trays = simRes.contactor.trays;
    const tMin = trays.length ? Math.min(...trays.map(t => t.tempC)) : 38;
    const tMax = trays.length ? Math.max(tMin + 2, ...trays.map(t => t.tempC)) : 52;
    trays.forEach((tr, idx) => {
      const deckMat = trayDeckMats[idx];
      const frothMesh = trayFrothMeshes[idx];
      if (!deckMat || !frothMesh) return;
      const tNorm = Math.min(1, Math.max(0, (tr.tempC - tMin) / (tMax - tMin)));
      if (tr.jetFloodPct > 85) {
        tmpColor.setHex(0xef4444); // Flooding alert red
      } else {
        // Cool cyan at top -> teal -> warm amber on exothermic lower trays
        tmpColor.setHSL(0.54 - 0.44 * tNorm, 0.82, 0.48);
      }
      deckMat.color.copy(tmpColor);
      deckMat.userData = { baseHex: tmpColor.getHex() };

      const fScale = Math.max(0.55, Math.min(2.3, tr.frothHeightMm / 150));
      frothMesh.scale.y = fScale;
      frothMesh.position.y = 0.025 + 0.07 * fScale;
      frothMesh.material.color.copy(tmpColor);
    });

    // Update S-05 and S-03 pipe spec colors & Relief mode state
    const s5Mat = streamPipeMats.get('S-05');
    if (s5Mat) {
      const c5 = simRes.specs.salesGasOnSpec ? 0x22c55e : 0xef4444;
      s5Mat.color.setHex(c5);
      s5Mat.emissive.setHex(c5);
      const s5Meshes = entityMeshes.get('stream:S-05') || [];
      s5Meshes.forEach(m => { m.userData.baseEmissiveHex = c5; });
    }
    const s3Mat = streamPipeMats.get('S-03');
    if (s3Mat) {
      const c3 = simRes.specs.oilOnSpec ? 0xd97706 : 0xef4444;
      s3Mat.color.setHex(c3);
      s3Mat.emissive.setHex(c3);
      const s3Meshes = entityMeshes.get('stream:S-03') || [];
      s3Meshes.forEach(m => { m.userData.baseEmissiveHex = c3; });
    }

    const isRelief = simRes.sim.operatingMode === 'relief';
    if (psvBonnetMat) {
      const cPsv = isRelief ? 0xef4444 : 0x0284c7;
      psvBonnetMat.color.setHex(cPsv);
      psvBonnetMat.emissive.setHex(cPsv);
      const psvMeshes = entityMeshes.get('unit:PSV-1001A') || [];
      psvMeshes.forEach(m => {
        if (m.material === psvBonnetMat) m.userData.baseEmissiveHex = cPsv;
      });
    }
    if (psvPlumeMesh) {
      psvPlumeMesh.material.opacity = isRelief ? 0.52 : 0.0;
    }
    if (flareFlameGroup && flareLight) {
      flareFlameGroup.scale.setScalar(isRelief ? 1.35 : 0.28);
      flareLight.intensity = isRelief ? 2.4 : 0.4;
    }

    setCutaway(simRes.sim.cutawayPct !== undefined ? simRes.sim.cutawayPct : cutawayPct);
    applySelectionHighlights();
  }

  function stepParticlesAndLabels(nowMs) {
    if (!latestSim || !renderer || !camera) return;
    const tSec = nowMs * 0.001;
    const sim = latestSim;

    // 1. Animate Falling Oil Droplets in V-1001 (count, size & speed driven by PR EOS flash!)
    const activeOilCount = Math.min(
      MAX_OIL_DROPS,
      Math.max(10, Math.round(sim.eos.oilMolFrac * 360))
    );
    const dropScale = Math.max(0.55, Math.min(1.85, sim.droplets.d32Um / 220));
    const fallSpeed = Math.max(0.35, Math.min(2.4, sim.droplets.vtMS * 2.6));
    const poolTopY = sepLiquidMesh ? (2.15 + sepLiquidMesh.position.y + 0.36 * sepLiquidMesh.scale.y) : 1.75;

    for (let i = 0; i < MAX_OIL_DROPS; i++) {
      if (i >= activeOilCount) {
        tmpScale.setScalar(0.0001);
        tmpPos.set(0, -20, 0);
      } else {
        const s = oilSeeds[i];
        const prog = (s.phase + tSec * fallSpeed * (0.75 + 0.5 * s.w)) % 1;
        const x = -5.3 + (s.u - 0.5) * 3.35;
        const z = 0.6 + (s.v - 0.5) * 1.25;
        const yStart = 2.92;
        const y = yStart - prog * Math.max(0.25, yStart - poolTopY);
        tmpPos.set(x, y, z);
        tmpScale.setScalar(dropScale);
      }
      tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
      oilDropsInst.setMatrixAt(i, tmpMat4);
    }
    oilDropsInst.instanceMatrix.needsUpdate = true;

    // 2. Animate Rising Gas Bubbles in V-1001 & C-1001 Contactor Trays
    const activeGasCount = Math.min(
      MAX_GAS_BUBBLES,
      Math.max(36, Math.round(45 + sim.eos.beta * 115))
    );
    const riseSpeed = Math.max(0.45, Math.min(2.2, 0.75 + sim.contactor.maxJetFloodPct * 0.012));

    for (let i = 0; i < MAX_GAS_BUBBLES; i++) {
      if (i >= activeGasCount) {
        tmpScale.setScalar(0.0001);
        tmpPos.set(0, -20, 0);
      } else {
        const gs = gasSeeds[i];
        const prog = (gs.phase + tSec * riseSpeed * 0.42) % 1;
        if (gs.inSep) {
          const x = -5.3 + (gs.r - 0.38) * 3.2;
          const z = 0.6 + Math.sin(gs.ang + tSec * 1.8) * 0.55;
          const y = poolTopY + 0.08 + prog * (3.02 - poolTopY);
          tmpPos.set(x, y, z);
          tmpScale.setScalar(0.85);
        } else {
          // Rising through all N trays inside C-1001
          const rad = gs.r * 0.96;
          const wob = gs.ang + Math.sin(tSec * 2.4 + i) * 0.22;
          const x = Math.cos(wob) * rad;
          const z = Math.sin(wob) * rad;
          const y = 1.75 + prog * 5.35;
          tmpPos.set(x, y, z);
          tmpScale.setScalar(0.95);
        }
      }
      tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
      gasBubblesInst.setMatrixAt(i, tmpMat4);
    }
    gasBubblesInst.instanceMatrix.needsUpdate = true;

    // 3. Animate Overhead Carryover Mist Droplets above Tray 1 / Demister when C5+ carryover or flood rises
    const mistIntensity = Math.min(1.0, Math.max(0, (sim.droplets.salesC5PlusPpmv - 18) / 280) + (sim.specs.salesGasOnSpec ? 0.08 : 0.65));
    const activeMistCount = Math.round(mistIntensity * MAX_MIST_DROPS);
    for (let i = 0; i < MAX_MIST_DROPS; i++) {
      if (i >= activeMistCount) {
        tmpScale.setScalar(0.0001);
        tmpPos.set(0, -20, 0);
      } else {
        const ms = mistSeeds[i];
        const prog = (ms.phase + tSec * 0.85) % 1;
        const x = Math.cos(ms.ang + tSec) * ms.r * 0.92;
        const z = Math.sin(ms.ang + tSec) * ms.r * 0.92;
        const y = 6.72 + prog * 1.15;
        tmpPos.set(x, y, z);
        tmpScale.setScalar(0.75 + 0.55 * mistIntensity);
      }
      tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
      mistDropsInst.setMatrixAt(i, tmpMat4);
    }
    mistDropsInst.instanceMatrix.needsUpdate = true;

    // 4. Animate Directional Flow Pulses along active process/relief streams
    const streamList = sim.streams || [];
    const pulsesPerStream = 12;
    let pIdx = 0;
    streamList.forEach(st => {
      const curve = streamCurves.get(st.id);
      const activeFlow = st.massFlowKgHr > 10;
      for (let k = 0; k < pulsesPerStream && pIdx < MAX_PIPE_PULSES; k++, pIdx++) {
        if (!curve || !activeFlow) {
          tmpScale.setScalar(0.0001);
          tmpPos.set(0, -20, 0);
        } else {
          const speed = st.id === 'S-08' ? 0.72 : 0.34;
          const u = ((k / pulsesPerStream) + tSec * speed) % 1;
          curve.getPointAt(u, tmpPos);
          tmpScale.setScalar(st.id === 'S-08' ? 1.25 : 0.9);
        }
        tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
        pipePulsesInst.setMatrixAt(pIdx, tmpMat4);
      }
    });
    pipePulsesInst.instanceMatrix.needsUpdate = true;

    // Subtle flare flicker
    if (flareFlameGroup) {
      const baseS = sim.sim.operatingMode === 'relief' ? 1.35 : 0.28;
      const flick = 1 + 0.08 * Math.sin(tSec * 13.0);
      flareFlameGroup.scale.set(baseS * flick, baseS * (0.94 + 0.12 * Math.cos(tSec * 17.0)), baseS * flick);
    }

    // 5. Project 3D Callout Pins into 2D viewport coordinates (clamped cleanly inside canvas bounds)
    if (labelsLayer && canvasWrap) {
      const w = canvasWrap.clientWidth || 1;
      const h = canvasWrap.clientHeight || 1;
      labelPins.forEach(pin => {
        projVec.copy(pin.anchor).project(camera);
        if (projVec.z > 1 || projVec.z < -1) {
          pin.el.style.display = 'none';
          return;
        }
        const px = (projVec.x * 0.5 + 0.5) * w;
        const py = (-projVec.y * 0.5 + 0.5) * h;
        if (px < 36 || px > w - 36 || py < 22 || py > h - 22) {
          pin.el.style.display = 'none';
          return;
        }
        pin.el.style.display = '';
        pin.el.style.transform = `translate(-50%, -50%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      });
    }
  }

  function isTabVisible() {
    if (!container) return false;
    const pane = container.closest('.tab-pane');
    return !pane || pane.classList.contains('active');
  }

  function renderSingleFrame(nowMs = performance.now()) {
    if (!renderer || !scene || !camera) return;
    if (controls) controls.update();
    stepParticlesAndLabels(nowMs);
    renderer.render(scene, camera);
  }

  function startLoop() {
    if (rafId || !renderer) return;
    const tick = (nowMs) => {
      rafId = 0;
      if (!isTabVisible()) return;
      // Throttle software WebGL to ~18 fps so CPU stays responsive during headless/remote sessions
      const minDt = isSoftwareGl ? 55 : 16;
      if (nowMs - lastFrameMs >= minDt) {
        lastFrameMs = nowMs;
        renderSingleFrame(nowMs);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function performRaycast(ndcX, ndcY, selectOnHit) {
    if (!camera || !pickableMeshes.length) return null;
    pointerNdc.set(ndcX, ndcY);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickableMeshes, false);
    if (!hits.length) {
      if (!selectOnHit && hoveredKey !== null) {
        hoveredKey = null;
        applySelectionHighlights();
      }
      return null;
    }
    const info = hits[0].object.userData.pickInfo;
    if (!info) return null;
    if (selectOnHit) {
      selectEntity(info.kind, info.id, true, info.trayNumber);
    } else {
      const k = entityKey(info.kind, info.id);
      if (k !== hoveredKey) {
        hoveredKey = k;
        applySelectionHighlights();
      }
    }
    return info;
  }

  function bindPointerEvents(domEl) {
    domEl.addEventListener('pointerdown', (ev) => {
      pointerDownXY = { x: ev.clientX, y: ev.clientY };
    });
    domEl.addEventListener('pointermove', (ev) => {
      if (isSoftwareGl && ev.buttons === 0) return; // avoid hover raycast overhead on SwiftShader
      const rect = domEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      const hit = performRaycast(nx, ny, false);
      domEl.style.cursor = hit ? 'pointer' : 'grab';
    });
    domEl.addEventListener('pointerup', (ev) => {
      if (!pointerDownXY) return;
      const dx = ev.clientX - pointerDownXY.x;
      const dy = ev.clientY - pointerDownXY.y;
      pointerDownXY = null;
      if (dx * dx + dy * dy > 36) return; // orbit drag, not a tap/click
      const rect = domEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      performRaycast(nx, ny, true);
    });
  }

  function handleResize() {
    if (!renderer || !camera || !canvasWrap) return;
    const w = Math.max(240, canvasWrap.clientWidth || 720);
    const h = Math.max(260, canvasWrap.clientHeight || 480);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderSingleFrame();
  }

  function mount(targetEl, cb = {}) {
    callbacks = cb || {};
    if (renderer && container === targetEl) {
      handleResize();
      startLoop();
      return true;
    }
    container = targetEl;
    if (!container) return false;
    container.innerHTML = '';

    canvasWrap = document.createElement('div');
    canvasWrap.className = 'plant3d-canvas-inner';
    labelsLayer = document.createElement('div');
    labelsLayer.className = 'plant3d-labels-layer';
    container.appendChild(canvasWrap);
    container.appendChild(labelsLayer);

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      webglAvailable = false;
      canvasWrap.innerHTML = `<div class="plant3d-webgl-fallback">WebGL 3D context unavailable in this browser (${String(err.message || err)}). Simulation data &amp; interactive k<sub>ij</sub> controls remain fully active on the right.</div>`;
      return false;
    }

    // Detect software renderer (SwiftShader / llvmpipe) to tune pixelRatio & frame pacing
    try {
      const gl = renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      isSoftwareGl = /swiftshader|llvmpipe|software/i.test(rName);
    } catch (_) {
      isSoftwareGl = false;
    }

    renderer.setPixelRatio(isSoftwareGl ? 1.0 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    canvasWrap.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    applySceneTheme(currentTheme());

    const w0 = Math.max(280, canvasWrap.clientWidth || 760);
    const h0 = Math.max(300, canvasWrap.clientHeight || 500);
    camera = new THREE.PerspectiveCamera(42, w0 / h0, 0.2, 120);

    // Metallic industrial lighting via RoomEnvironment + directional sun/rim lights
    pmremGen = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;

    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x334155, 0.75);
    scene.add(hemi);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    keyLight.position.set(12, 18, 14);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    rimLight.position.set(-14, 9, -10);
    scene.add(rimLight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3.2;
    controls.maxDistance = 34.0;
    controls.maxPolarAngle = Math.PI * 0.495;

    plantRoot = new THREE.Group();
    scene.add(plantRoot);

    pickableMeshes.length = 0;
    entityMeshes.clear();
    labelPins.length = 0;

    buildSkidDeck();
    buildInletSeparator();
    buildContactorColumn();
    buildPsvAndAuxiliaryUnits();
    buildProcessStreams();
    buildInstancedParticles();

    setCameraPreset('overview');
    bindPointerEvents(renderer.domElement);

    if (typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(() => handleResize());
      resizeObs.observe(canvasWrap);
    } else {
      window.addEventListener('resize', handleResize);
    }

    handleResize();
    if (latestSim) updateStaticSimulationVisuals(latestSim);
    renderSingleFrame();
    startLoop();
    return true;
  }

  function update(simResult) {
    latestSim = simResult;
    if (!renderer) return;
    updateStaticSimulationVisuals(simResult);
    renderSingleFrame();
    if (isTabVisible()) startLoop();
  }

  function selectEntity(kind, id, notify = true, trayNumber = undefined) {
    let resolvedTray = trayNumber;
    if (kind === 'tray' && resolvedTray === undefined) {
      const m = /^TRAY-(\d+)$/.exec(String(id));
      if (m) resolvedTray = Number(m[1]);
    }
    // Clamp tray selection if tray count decreased below previously selected tray
    if (kind === 'tray' && latestSim && resolvedTray > latestSim.contactor.trayCount) {
      resolvedTray = latestSim.contactor.trayCount;
      id = `TRAY-${resolvedTray}`;
    }
    selectedEntity = { kind, id, trayNumber: resolvedTray };
    applySelectionHighlights();
    renderSingleFrame();
    if (notify && callbacks && typeof callbacks.onSelectEntity === 'function') {
      callbacks.onSelectEntity(selectedEntity);
    }
    return selectedEntity;
  }

  function setCameraPreset(presetName) {
    const p = CAMERA_PRESETS[presetName] || CAMERA_PRESETS.overview;
    activePreset = CAMERA_PRESETS[presetName] ? presetName : 'overview';
    if (camera && controls) {
      camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
      controls.target.set(p.target[0], p.target[1], p.target[2]);
      controls.update();
      renderSingleFrame();
    }
  }

  function setCutaway(pct) {
    cutawayPct = Math.min(100, Math.max(0, Number(pct) || 0));
    if (contactorFrontShellMat) {
      // 100% cutaway -> 0.04 glass hint; 0% cutaway -> 0.94 solid shell
      contactorFrontShellMat.opacity = 0.94 - (cutawayPct / 100) * 0.90;
    }
    if (sepFrontShellMat) {
      sepFrontShellMat.opacity = 0.88 - (cutawayPct / 100) * 0.74;
    }
    renderSingleFrame();
  }

  function setAutoRotate(enabled) {
    if (controls) {
      controls.autoRotate = !!enabled;
      controls.autoRotateSpeed = 1.35;
      renderSingleFrame();
    }
  }

  function setLabelsVisible(visible) {
    if (labelsLayer) {
      labelsLayer.style.display = visible ? '' : 'none';
    }
  }

  function setTheme(theme) {
    applySceneTheme(theme);
    renderSingleFrame();
  }

  /**
   * Project an entity's 3D mesh center to normalized device coordinates and invoke real
   * THREE.Raycaster picking — useful for deterministic headless E2E testing of GPU picking.
   */
  function pickEntityViaRaycaster(kind, id) {
    if (!camera || !renderer) return null;
    const key = entityKey(kind, id);
    const meshes = entityMeshes.get(key);
    if (!meshes || !meshes.length) return null;
    const targetMesh = meshes[0];
    targetMesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(targetMesh);
    const center = box.getCenter(new THREE.Vector3());
    center.project(camera);
    return performRaycast(center.x, center.y, true);
  }

  function getEntityScreenPoint(kind, id) {
    if (!camera || !renderer) return null;
    const key = entityKey(kind, id);
    const meshes = entityMeshes.get(key);
    if (!meshes || !meshes.length) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const targetMesh = meshes[0];
    targetMesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(targetMesh);
    const center = box.getCenter(new THREE.Vector3());
    center.project(camera);
    const offsets = [0, 0.03, -0.03, 0.07, -0.07, 0.12, -0.12, 0.18, -0.18];
    for (const dy of offsets) {
      for (const dx of offsets) {
        const nx = center.x + dx;
        const ny = center.y + dy;
        if (nx < -0.95 || nx > 0.95 || ny < -0.95 || ny > 0.95) continue;
        const px = Math.round(rect.left + ((nx + 1) * 0.5) * rect.width);
        const py = Math.round(rect.top + ((1 - ny) * 0.5) * rect.height);
        if (typeof document !== 'undefined' && document.elementFromPoint(px, py) !== renderer.domElement) continue;
        const hit = performRaycast(nx, ny, false);
        if (hit && hit.kind === kind && hit.id === id) {
          return { x: px, y: py };
        }
      }
    }
    return null;
  }

  function getSceneStats() {
    return {
      mounted: !!renderer,
      webgl: webglAvailable,
      isSoftwareGl,
      builtTrayCount,
      pickableCount: pickableMeshes.length,
      entityKeys: Array.from(entityMeshes.keys()),
      selectedEntity,
      activePreset,
      cutawayPct
    };
  }

  return {
    mount,
    update,
    selectEntity,
    setCameraPreset,
    setCutaway,
    setAutoRotate,
    setLabelsVisible,
    setTheme,
    startLoop,
    stopLoop,
    handleResize,
    pickAtNormalized: (nx, ny, select = true) => performRaycast(nx, ny, select),
    pickEntityViaRaycaster,
    getEntityScreenPoint,
    getSceneStats
  };
}

const instance = createController();
if (typeof window !== 'undefined') {
  window.PSVPlant3D = instance;
  window.dispatchEvent(new CustomEvent('psv-plant3d-ready', { detail: instance }));
}
export default instance;
