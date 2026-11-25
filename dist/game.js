import * as THREE from 'three';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#game');
const loading = $('#loading');
const errorPanel = $('#error');
const home = $('#home');
const hud = $('#matchHud');
const joystick = $('#joystick');
const joyKnob = $('.joy-knob');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);

let renderer;
let scene;
let camera;
let player;
let playerRoot;
let playerParts = {};
let terrain;
let active = false;
let lastTime = 0;
let walkTime = 0;
let cameraYaw = 0.36;
let cameraPitch = 0.34;
let cameraDistance = 11;
let isOrbiting = false;
let lastPointer = { x: 0, y: 0 };
let fireCooldown = 0;
let toastTimer;
const keys = new Set();
const obstacles = [];
const raycaster = new THREE.Raycaster();
const worldUp = new THREE.Vector3(0, 1, 0);
const moveInput = new THREE.Vector2();
const cameraTarget = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const clock = new THREE.Clock();

const palette = {
  ground: 0x7d8b61,
  sand: 0xb69b69,
  stone: 0x586153,
  darkStone: 0x39463d,
  accent: 0xd8874d,
  teal: 0x83c8ad,
  cream: 0xd9d3b6,
};

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9eb7b4);
  scene.fog = new THREE.Fog(0x9eb7b4, 58, 145);

  camera = new THREE.PerspectiveCamera(54, 1, 0.1, 220);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const hemi = new THREE.HemisphereLight(0xd8eee2, 0x68654d, 2.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6bd, 3.2);
  sun.position.set(-25, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);

  buildTerrain();
  buildArena();
  buildProps();
  buildPlayer();
  resize();
  window.addEventListener('resize', resize);
  loading.classList.add('hidden');
  animate();
}

function material(color, roughness = 0.86, extras = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extras });
}

function addMesh(geometry, mat, parent, position, options = {}) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.scale) mesh.scale.set(...options.scale);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  return mesh;
}

function buildTerrain() {
  const size = 180;
  const segments = 100;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = [];
  const low = new THREE.Color(0x687d5c);
  const high = new THREE.Color(0x87916a);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const wave = Math.sin(x * 0.16) * Math.cos(z * 0.12) * 0.4 + Math.sin((x + z) * 0.075) * 0.55;
    positions.setY(i, wave * clamp((edge - 34) / 18, 0, 1));
    const variation = clamp(0.52 + wave * 0.12 + Math.sin(x * 0.055 + z * 0.09) * 0.1, 0, 1);
    const color = low.clone().lerp(high, variation);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  terrain = addMesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), scene, [0, -0.3, 0], { castShadow: false });
  terrain.receiveShadow = true;

  const arenaFloor = addMesh(new THREE.PlaneGeometry(72, 72), material(palette.sand), scene, [0, -0.18, 0]);
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.receiveShadow = true;

  const tileMatA = material(0xb9a779, 1);
  const tileMatB = material(0xb4a174, 1);
  for (let x = -32; x < 32; x += 8) {
    for (let z = -32; z < 32; z += 8) {
      const tint = ((x + z) / 8) % 2 === 0 ? tileMatA : tileMatB;
      addMesh(new THREE.PlaneGeometry(7.92, 7.92), tint, scene, [x + 4, -0.165, z + 4], { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
    }
  }
}

function buildArena() {
  const wallMat = material(palette.stone);
  const capMat = material(0x7a8069);
  const trimMat = material(0x39463e);
  const wallHeight = 3.8;
  const wallLength = 72;
  const wallParts = [
    { x: 0, z: -36, sx: wallLength, sz: 1.5 },
    { x: 0, z: 36, sx: wallLength, sz: 1.5 },
    { x: -36, z: 0, sx: 1.5, sz: wallLength },
    { x: 36, z: 0, sx: 1.5, sz: wallLength },
  ];
  wallParts.forEach(({ x, z, sx, sz }) => {
    addMesh(new THREE.BoxGeometry(sx, wallHeight, sz), wallMat, scene, [x, 1.8, z]);
    addMesh(new THREE.BoxGeometry(sx + 0.25, 0.28, sz + 0.25), capMat, scene, [x, 3.84, z]);
    addMesh(new THREE.BoxGeometry(sx + 0.06, 0.18, sz + 0.06), trimMat, scene, [x, 0.25, z]);
  });
  for (const [x, z] of [[-36, -36], [36, -36], [-36, 36], [36, 36]]) {
    const tower = new THREE.Group();
    tower.position.set(x, 0, z);
    scene.add(tower);
    addMesh(new THREE.BoxGeometry(4.4, 5.2, 4.4), wallMat, tower, [0, 2.5, 0]);
    addMesh(new THREE.CylinderGeometry(2.2, 2.55, 0.6, 6), capMat, tower, [0, 5.4, 0]);
    addMesh(new THREE.CylinderGeometry(1.45, 1.45, 0.16, 6), trimMat, tower, [0, 5.78, 0]);
    addObstacle(x, z, 3.1);
  }

  // Low raised walkways create a readable arena perimeter without blocking the view.
  const walkMat = material(0x8c8a6e);
  for (const z of [-29, 29]) {
    addMesh(new THREE.BoxGeometry(52, 0.42, 3.2), walkMat, scene, [0, 0.06, z]);
  }
  for (const x of [-29, 29]) {
    addMesh(new THREE.BoxGeometry(3.2, 0.42, 52), walkMat, scene, [x, 0.06, 0]);
  }
}

function addObstacle(x, z, radius, height = 1) {
  obstacles.push({ x, z, radius, height });
}

function buildProps() {
  const crateMat = material(0x776b4d);
  const crateTop = material(0x9b895d);
  const stoneMat = material(0x687064);
  const stoneLight = material(0x7e806d);
  const coverSets = [
    [-17, -15, 2.2, 1.8], [-12, -16, 1.45, 1.2], [15, -16, 2, 1.5], [19, -12, 1.5, 1.1],
    [-19, 9, 2.2, 1.5], [-15, 15, 1.5, 1.2], [17, 10, 2.2, 1.6], [13, 16, 1.6, 1.3],
    [-3, -23, 2.3, 1.5], [5, -23, 1.7, 1.2], [-3, 23, 2.2, 1.5], [5, 23, 1.7, 1.2],
    [-24, -2, 1.8, 1.2], [24, 2, 1.8, 1.2],
  ];
  coverSets.forEach(([x, z, width, height], index) => {
    const angle = (index % 3 - 1) * 0.08;
    const crate = new THREE.Group();
    crate.position.set(x, 0, z);
    crate.rotation.y = angle;
    scene.add(crate);
    if (index % 3 === 0) {
      addMesh(new THREE.BoxGeometry(width, height, width * 0.82), crateMat, crate, [0, height / 2, 0]);
      addMesh(new THREE.BoxGeometry(width + 0.06, 0.12, width * 0.82 + 0.06), crateTop, crate, [0, height + 0.04, 0]);
      for (const side of [-1, 1]) addMesh(new THREE.BoxGeometry(0.11, height * 0.82, 0.1), crateTop, crate, [side * width * 0.32, height / 2, width * 0.42 + 0.01]);
      addObstacle(x, z, Math.max(width, width * 0.82) * 0.61, height);
    } else {
      const rock = addMesh(new THREE.DodecahedronGeometry(width * 0.55, 0), stoneMat, crate, [0, height * 0.48, 0], { scale: [1.18, height / (width * 0.58), 0.9] });
      rock.rotation.set(0.05, angle, 0.12);
      addMesh(new THREE.DodecahedronGeometry(width * 0.18, 0), stoneLight, crate, [width * 0.3, height * 0.58, -width * 0.06], { scale: [1.15, 0.85, 0.95] });
      addObstacle(x, z, width * 0.57, height);
    }
  });

  // A central broken stone formation gives the arena a clear landmark and flanking routes.
  for (const [x, z, scale] of [[-1.6, -3, 1], [1.5, -3.2, 0.8], [0, -1.7, 0.65]]) {
    addMesh(new THREE.DodecahedronGeometry(1.5 * scale, 0), stoneMat, scene, [x, 0.75 * scale, z], { scale: [1.15, 0.76, 0.82] });
    addObstacle(x, z, 1.45 * scale, 1.5 * scale);
  }

  buildVegetation();
  buildArenaDetails();
}

function buildVegetation() {
  const trunkMat = material(0x665342);
  const leafMats = [material(0x526d4c), material(0x647d51), material(0x71885b)];
  const bushMats = [material(0x5b754e), material(0x728151)];
  const treeSpots = [
    [-31, -23], [-30, -14], [-31, 16], [-30, 25], [31, -25], [30, -17], [31, 15], [30, 24],
    [-23, -31], [-13, -31], [13, -31], [23, -31], [-24, 31], [-13, 31], [13, 31], [24, 31],
  ];
  treeSpots.forEach(([x, z], index) => {
    const tree = new THREE.Group();
    tree.position.set(x + rand(-1, 1), 0, z + rand(-1, 1));
    tree.rotation.y = rand(0, Math.PI * 2);
    scene.add(tree);
    const trunkHeight = rand(1.8, 2.5);
    addMesh(new THREE.CylinderGeometry(0.16, 0.27, trunkHeight, 6), trunkMat, tree, [0, trunkHeight / 2, 0]);
    for (let tier = 0; tier < 3; tier++) {
      const radius = 1.45 - tier * 0.27 + rand(-0.08, 0.08);
      addMesh(new THREE.ConeGeometry(radius, 1.9 - tier * 0.18, 7, 1), leafMats[(index + tier) % leafMats.length], tree, [0, trunkHeight + 0.35 + tier * 0.77, 0]);
    }
    addObstacle(tree.position.x, tree.position.z, 0.42, 4.8);
  });

  const bushSpots = [
    [-27, -6], [-28, 4], [-26, 13], [-25, -14], [27, -8], [28, 5], [26, 14], [25, -17],
    [-21, -25], [-8, -29], [8, -29], [21, -25], [-21, 26], [-8, 29], [8, 29], [21, 26],
    [-9, 11], [10, 11], [-10, -11], [11, -11],
  ];
  bushSpots.forEach(([x, z], index) => {
    const bush = new THREE.Group();
    bush.position.set(x + rand(-0.45, 0.45), 0, z + rand(-0.45, 0.45));
    scene.add(bush);
    const count = 3 + index % 3;
    for (let i = 0; i < count; i++) {
      addMesh(new THREE.IcosahedronGeometry(rand(0.38, 0.7), 0), bushMats[(i + index) % bushMats.length], bush,
        [rand(-0.48, 0.48), rand(0.3, 0.55), rand(-0.42, 0.42)], { scale: [1.2, 0.85, 1] });
    }
    addObstacle(bush.position.x, bush.position.z, 0.7, 1.1);
  });
}

function buildArenaDetails() {
  const paint = material(0xe4cf9f, 0.95);
  const dark = material(0x575e4f, 0.95);
  for (const x of [-10, 10]) {
    addMesh(new THREE.BoxGeometry(0.18, 0.018, 6), paint, scene, [x, -0.145, 0], { castShadow: false });
  }
  for (const z of [-10, 10]) {
    addMesh(new THREE.BoxGeometry(6, 0.018, 0.18), paint, scene, [0, -0.14, z], { castShadow: false });
  }
  // Small raised stone pads and lanterns make the edges feel inhabited without adding actors.
  for (const [x, z] of [[-25, -25], [25, -25], [-25, 25], [25, 25]]) {
    addMesh(new THREE.CylinderGeometry(1.1, 1.2, 0.5, 8), dark, scene, [x, 0.1, z]);
    addMesh(new THREE.CylinderGeometry(0.22, 0.28, 1.4, 7), material(0x7b765e), scene, [x, 1.02, z]);
    const glow = new THREE.MeshStandardMaterial({ color: 0xf2bc76, emissive: 0xb96830, emissiveIntensity: 0.75, roughness: 0.3 });
    addMesh(new THREE.OctahedronGeometry(0.34, 0), glow, scene, [x, 1.86, z]);
  }
}

function buildPlayer() {
  playerRoot = new THREE.Group();
  playerRoot.position.set(3.5, 0, 8);
  scene.add(playerRoot);
  player = new THREE.Group();
  player.position.y = 0.05;
  playerRoot.add(player);

  const suit = material(0x326b68, 0.62, { metalness: 0.12 });
  const suitLight = material(0x4c9184, 0.58, { metalness: 0.14 });
  const darkSuit = material(0x253d3c, 0.78);
  const armor = material(0xc58b57, 0.55, { metalness: 0.18 });
  const visor = material(0x18272a, 0.3, { metalness: 0.36, emissive: 0x193e40, emissiveIntensity: 0.18 });
  const joints = material(0x273333, 0.6);

  addMesh(new THREE.CapsuleGeometry(0.48, 0.65, 5, 9), suit, player, [0, 1.38, 0]);
  addMesh(new THREE.BoxGeometry(0.78, 0.34, 0.52), armor, player, [0, 1.16, 0.03]);
  addMesh(new THREE.SphereGeometry(0.4, 12, 9), suitLight, player, [0, 2.02, 0]);
  addMesh(new THREE.SphereGeometry(0.31, 12, 8), visor, player, [0, 2.05, -0.235], { scale: [1.12, 0.68, 0.55] });
  addMesh(new THREE.BoxGeometry(0.42, 0.085, 0.055), material(0xb9ddc9, 0.25, { emissive: 0x6ab7a0, emissiveIntensity: 0.55 }), player, [0, 2.08, -0.405]);
  addMesh(new THREE.BoxGeometry(0.16, 0.09, 0.17), armor, player, [0, 2.46, 0]);

  playerParts.leftArm = new THREE.Group();
  playerParts.rightArm = new THREE.Group();
  playerParts.leftArm.position.set(-0.55, 1.7, 0);
  playerParts.rightArm.position.set(0.55, 1.7, 0);
  player.add(playerParts.leftArm, playerParts.rightArm);
  for (const [arm, sign] of [[playerParts.leftArm, -1], [playerParts.rightArm, 1]]) {
    addMesh(new THREE.SphereGeometry(0.23, 9, 7), armor, arm, [0, 0, 0]);
    addMesh(new THREE.CapsuleGeometry(0.16, 0.49, 3, 7), suitLight, arm, [sign * 0.03, -0.37, -0.04], { rotation: [0.08, 0, sign * -0.12] });
    addMesh(new THREE.SphereGeometry(0.17, 8, 6), joints, arm, [sign * 0.03, -0.74, -0.08]);
  }
  // Compact training blaster is a piece of the character model, not an image or sprite.
  addMesh(new THREE.BoxGeometry(0.2, 0.2, 0.63), darkSuit, playerParts.rightArm, [0.1, -0.74, -0.35]);
  addMesh(new THREE.CylinderGeometry(0.075, 0.09, 0.28, 8), armor, playerParts.rightArm, [0.1, -0.76, -0.77], { rotation: [Math.PI / 2, 0, 0] });

  playerParts.leftLeg = new THREE.Group();
  playerParts.rightLeg = new THREE.Group();
  playerParts.leftLeg.position.set(-0.24, 0.94, 0.02);
  playerParts.rightLeg.position.set(0.24, 0.94, 0.02);
  player.add(playerParts.leftLeg, playerParts.rightLeg);
  for (const [leg, sign] of [[playerParts.leftLeg, -1], [playerParts.rightLeg, 1]]) {
    addMesh(new THREE.CapsuleGeometry(0.2, 0.52, 4, 7), darkSuit, leg, [0, -0.35, 0]);
    addMesh(new THREE.BoxGeometry(0.38, 0.2, 0.56), suitLight, leg, [0, -0.67, -0.11]);
    addMesh(new THREE.BoxGeometry(0.13, 0.13, 0.12), armor, leg, [sign * 0.11, -0.04, 0]);
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.035, 6, 36), new THREE.MeshBasicMaterial({ color: 0x98dfbd, transparent: true, opacity: 0.65 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.045;
  playerRoot.add(ring);
  playerParts.ring = ring;
}

function resize() {
  if (!renderer || !camera) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = width < 700 ? 61 : 54;
  camera.updateProjectionMatrix();
}

function updateCamera(delta = 1) {
  if (!playerRoot) return;
  cameraTarget.set(playerRoot.position.x, playerRoot.position.y + 1.28, playerRoot.position.z);
  const horizontal = Math.cos(cameraPitch) * cameraDistance;
  cameraOffset.set(Math.sin(cameraYaw) * horizontal, Math.sin(cameraPitch) * cameraDistance, Math.cos(cameraYaw) * horizontal);
  camera.position.lerp(cameraTarget.clone().add(cameraOffset), 1 - Math.pow(0.0008, delta));
  camera.lookAt(cameraTarget);
}

function collides(x, z) {
  const boundary = 32.7;
  if (Math.abs(x) > boundary || Math.abs(z) > boundary) return true;
  for (const obstacle of obstacles) {
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    const minDistance = obstacle.radius + 0.43;
    if (dx * dx + dz * dz < minDistance * minDistance) return true;
  }
  return false;
}

function readMovement() {
  let x = 0;
  let y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  x += moveInput.x;
  y += moveInput.y;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return { x, y, moving: length > 0.08 };
}

function updatePlayer(delta) {
  if (!active) return;
  const movement = readMovement();
  const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const right = new THREE.Vector3(Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
  const direction = right.multiplyScalar(movement.x).add(forward.multiplyScalar(movement.y));
  if (movement.moving) {
    direction.normalize();
    const speed = 7.2;
    const nextX = playerRoot.position.x + direction.x * speed * delta;
    const nextZ = playerRoot.position.z + direction.z * speed * delta;
    if (!collides(nextX, playerRoot.position.z)) playerRoot.position.x = nextX;
    if (!collides(playerRoot.position.x, nextZ)) playerRoot.position.z = nextZ;
    playerRoot.rotation.y = Math.atan2(-direction.x, -direction.z);
    walkTime += delta * 10;
    const swing = Math.sin(walkTime) * 0.58;
    playerParts.leftLeg.rotation.x = swing;
    playerParts.rightLeg.rotation.x = -swing;
    playerParts.leftArm.rotation.x = -swing * 0.45;
    playerParts.rightArm.rotation.x = swing * 0.25;
    player.position.y = 0.05 + Math.abs(Math.sin(walkTime * 2)) * 0.035;
    playerParts.ring.material.opacity = 0.55 + Math.sin(walkTime * 2) * 0.12;
  } else {
    playerParts.leftLeg.rotation.x = THREE.MathUtils.damp(playerParts.leftLeg.rotation.x, 0, 12, delta);
    playerParts.rightLeg.rotation.x = THREE.MathUtils.damp(playerParts.rightLeg.rotation.x, 0, 12, delta);
    playerParts.leftArm.rotation.x = THREE.MathUtils.damp(playerParts.leftArm.rotation.x, 0, 12, delta);
    playerParts.rightArm.rotation.x = THREE.MathUtils.damp(playerParts.rightArm.rotation.x, 0, 12, delta);
    player.position.y = THREE.MathUtils.damp(player.position.y, 0.05, 8, delta);
  }
}

function makeTracer(origin, end) {
  const vector = end.clone().sub(origin);
  const length = vector.length();
  const tracer = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.055, length, 6), new THREE.MeshBasicMaterial({ color: 0xffc780, transparent: true, opacity: 0.95 }));
  tracer.position.copy(origin).add(end).multiplyScalar(0.5);
  tracer.quaternion.setFromUnitVectors(worldUp, vector.normalize());
  scene.add(tracer);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd498 }));
  flash.position.copy(origin);
  scene.add(flash);
  setTimeout(() => {
    scene.remove(tracer, flash);
    tracer.geometry.dispose(); tracer.material.dispose();
    flash.geometry.dispose(); flash.material.dispose();
  }, 90);
}

function fire() {
  if (!active || fireCooldown > 0) return;
  fireCooldown = 0.24;
  const muzzle = new THREE.Vector3(0.1, -0.76, -0.9);
  playerParts.rightArm.localToWorld(muzzle);
  const origin = camera.position.clone();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  raycaster.set(origin, direction);
  raycaster.far = 65;
  const hits = raycaster.intersectObjects(scene.children, true).filter((hit) => hit.object !== terrain && hit.object !== player && !playerRoot.getObjectById(hit.object.id));
  const end = hits.length ? hits[0].point : origin.clone().add(direction.multiplyScalar(55));
  makeTracer(muzzle, end);
  playerParts.rightArm.rotation.x = -0.16;
  window.setTimeout(() => { if (playerParts.rightArm) playerParts.rightArm.rotation.x = 0; }, 90);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 1900);
}

function setActive(value) {
  active = value;
  $('#app').classList.toggle('playing', value);
  home.classList.toggle('hidden', value);
  hud.classList.toggle('hidden', !value);
  if (value) {
    playerRoot.position.set(0, 0, 12);
    playerRoot.rotation.y = 0;
    cameraYaw = 0;
    cameraPitch = 0.32;
    cameraDistance = 10.5;
    showToast('Arena este a ta. Explorează liber.');
  } else {
    playerRoot.position.set(3.5, 0, 8);
    cameraYaw = 0.36;
    cameraPitch = 0.34;
    cameraDistance = 11;
  }
}

function animate(time = 0) {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.04);
  lastTime = time;
  fireCooldown = Math.max(0, fireCooldown - delta);
  updatePlayer(delta);
  updateCamera(delta);
  renderer.render(scene, camera);
}

function bindControls() {
  $('#playBtn').addEventListener('click', () => setActive(true));
  $('#menuBtn').addEventListener('click', () => setActive(false));
  window.addEventListener('keydown', (event) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Escape' && active) setActive(false);
    if (event.code === 'Space') fire();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); isOrbiting = false; });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    if (!active) return;
    if (event.pointerType === 'mouse' && event.button === 2) {
      isOrbiting = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    } else if (event.pointerType !== 'touch' && event.button === 0) {
      fire();
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!isOrbiting) return;
    cameraYaw -= (event.clientX - lastPointer.x) * 0.006;
    cameraPitch = clamp(cameraPitch + (event.clientY - lastPointer.y) * 0.0045, 0.12, 0.78);
    lastPointer = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (isOrbiting) {
      isOrbiting = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener('wheel', (event) => {
    if (!active) return;
    cameraDistance = clamp(cameraDistance + Math.sign(event.deltaY) * 0.8, 6.5, 16);
  }, { passive: true });
  $('#touchFire').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    fire();
  });

  let joyPointer = null;
  const updateJoy = (event) => {
    const rect = joystick.getBoundingClientRect();
    const radius = rect.width * 0.31;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    const scale = length > radius ? radius / length : 1;
    const px = dx * scale;
    const py = dy * scale;
    joyKnob.style.transform = `translate(${px}px, ${py}px)`;
    moveInput.set(px / radius, -py / radius);
    if (moveInput.length() > 1) moveInput.normalize();
  };
  joystick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    joyPointer = event.pointerId;
    joystick.setPointerCapture(joyPointer);
    updateJoy(event);
  });
  joystick.addEventListener('pointermove', (event) => {
    if (event.pointerId === joyPointer) updateJoy(event);
  });
  const releaseJoy = (event) => {
    if (event.pointerId !== joyPointer) return;
    joyPointer = null;
    moveInput.set(0, 0);
    joyKnob.style.transform = 'translate(0, 0)';
  };
  joystick.addEventListener('pointerup', releaseJoy);
  joystick.addEventListener('pointercancel', releaseJoy);

  let touchOrbitId = null;
  let touchLast = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !active) return;
    touchOrbitId = event.pointerId;
    touchLast = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || event.pointerId !== touchOrbitId) return;
    cameraYaw -= (event.clientX - touchLast.x) * 0.006;
    cameraPitch = clamp(cameraPitch + (event.clientY - touchLast.y) * 0.004, 0.12, 0.78);
    touchLast = { x: event.clientX, y: event.clientY };
  });
  const releaseTouchOrbit = (event) => {
    if (event.pointerId === touchOrbitId) touchOrbitId = null;
  };
  canvas.addEventListener('pointerup', releaseTouchOrbit);
  canvas.addEventListener('pointercancel', releaseTouchOrbit);
}

try {
  setupScene();
  bindControls();
} catch (error) {
  console.error('Unable to initialize the arena:', error);
  loading.classList.add('hidden');
  errorPanel.classList.remove('hidden');
}
