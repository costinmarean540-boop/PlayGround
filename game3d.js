import * as THREE from './assets/three.module.js';

(() => {
  'use strict';
  const canvas = document.getElementById('world');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a7dbe5');
  scene.fog = new THREE.Fog('#b9dfda', 24, 58);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const hemi = new THREE.HemisphereLight('#e4f8ff', '#617847', 2.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0c7', 3.1);
  sun.position.set(-12, 24, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.00025;
  scene.add(sun);
  scene.add(sun.target);

  const materials = {
    grass: new THREE.MeshStandardMaterial({ color: '#80b655', roughness: 1 }),
    dirt: new THREE.MeshStandardMaterial({ color: '#a9784b', roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: '#929b91', roughness: 1 }),
    sand: new THREE.MeshStandardMaterial({ color: '#d7c785', roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: '#9b6637', roughness: 1 }),
    plank: new THREE.MeshStandardMaterial({ color: '#d2a35f', roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#4d914e', roughness: 1 }),
  };
  const mat = {
    grass: { name: 'Grass', icon: '🟩' }, dirt: { name: 'Dirt', icon: '🟫' },
    stone: { name: 'Stone', icon: '🪨' }, wood: { name: 'Wood', icon: '🪵' },
    plank: { name: 'Planks', icon: '🪚' }, leaf: { name: 'Leaves', icon: '🍃' },
  };
  const keys = ['grass', 'dirt', 'stone', 'wood', 'plank', 'leaf'];
  const inventory = { grass: 0, dirt: 0, stone: 0, wood: 0, plank: 0, leaf: 0 };
  const W = 31, H = 31, blocks = new Map(), decorations = [], placed = [];
  let selected = 'wood', face = 0, questDone = false, time = 20, dayNumber = 1;
  const player = { x: 15, z: 15, walk: 0 };
  const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7 + 9.2) * 43758.5453; return n - Math.floor(n); };
  const heightAt = (x, z) => Math.max(0, Math.min(3, Math.floor((Math.sin(x * .29) * .65 + Math.cos(z * .28) * .55 + Math.sin((x + z) * .19) * .36 + (hash(x, z) - .5) * .8 + 1.9) * .95)));
  const id = (x, z) => `${x},${z}`;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const elevation = heightAt(x, z), r = hash(x + 83, z - 23);
    let type = elevation === 0 ? 'sand' : (elevation >= 2 && r > .48 && r < .61 ? 'stone' : 'grass');
    if (type === 'grass' && elevation === 1 && r > .91) type = 'dirt';
    const tree = type === 'grass' && elevation > 0 && r > .925 && !(x > 12 && x < 19 && z > 12 && z < 19);
    const block = { x, z, elevation, type, tree, removed: false };
    blocks.set(id(x, z), block);
    if (type === 'grass' && elevation > 0 && r > .84 && r < .875) decorations.push({ x, z, elevation, kind: r > .86 ? 'flower' : 'grass', tone: hash(z, x) });
  }
  for (let z = 13; z < 18; z++) for (let x = 13; x < 18; x++) {
    const b = blocks.get(id(x, z)); if (b) { b.tree = false; b.elevation = 1; b.type = 'grass'; }
  }
  const groundHeight = b => b.elevation * .38;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#73985b', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.55; ground.receiveShadow = true; scene.add(ground);
  const tileGeo = new THREE.BoxGeometry(1.015, .82, 1.015);
  const trunkGeo = new THREE.BoxGeometry(.23, .95, .23);
  const leafGeo = new THREE.BoxGeometry(.86, .68, .86);
  const smallLeafGeo = new THREE.BoxGeometry(.68, .58, .68);
  const terrainMeshes = new Map(), vegetationInstances = [];

  function disposeTerrain() {
    for (const mesh of terrainMeshes.values()) { scene.remove(mesh); mesh.dispose?.(); }
    terrainMeshes.clear();
  }
  function rebuildTerrain() {
    disposeTerrain();
    const groups = { grass: [], dirt: [], stone: [], sand: [] };
    for (const b of blocks.values()) if (!b.removed) groups[b.type].push(b);
    for (const [type, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(tileGeo, materials[type], list.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const dummy = new THREE.Object3D();
      list.forEach((b, i) => {
        dummy.position.set(b.x - 15, groundHeight(b), b.z - 15);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        b.instanceId = i;
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.blocks = list;
      scene.add(mesh); terrainMeshes.set(type, mesh);
    }
  }
  rebuildTerrain();

  function buildVegetation() {
    vegetationInstances.forEach(mesh => scene.remove(mesh));
    vegetationInstances.length = 0;
    const trees = [...blocks.values()].filter(b => b.tree);
    const trunks = new THREE.InstancedMesh(trunkGeo, materials.wood, trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, materials.leaf, trees.length * 2);
    const littleLeaves = new THREE.InstancedMesh(smallLeafGeo, materials.leaf, trees.length);
    const d = new THREE.Object3D(); let ti = 0, li = 0, si = 0;
    for (const b of trees) {
      const x = b.x - 15, z = b.z - 15, y = groundHeight(b) + .42;
      d.position.set(x, y + .57, z); d.updateMatrix(); trunks.setMatrixAt(ti++, d.matrix);
      d.position.set(x, y + 1.25, z); d.updateMatrix(); leaves.setMatrixAt(li++, d.matrix);
      d.position.set(x - .18, y + 1.68, z + .08); d.updateMatrix(); leaves.setMatrixAt(li++, d.matrix);
      d.position.set(x + .22, y + 1.12, z - .12); d.updateMatrix(); littleLeaves.setMatrixAt(si++, d.matrix);
    }
    trunks.castShadow = leaves.castShadow = littleLeaves.castShadow = true;
    trunks.receiveShadow = leaves.receiveShadow = littleLeaves.receiveShadow = true;
    scene.add(trunks, leaves, littleLeaves); vegetationInstances.push(trunks, leaves, littleLeaves);
    const flowerMat = new THREE.MeshStandardMaterial({ color: '#ffcb68', roughness: 1 });
    const flowers = decorations.filter(d => d.kind === 'flower');
    if (flowers.length) {
      const flowerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, .12, .12), flowerMat, flowers.length);
      flowers.forEach((b, i) => { d.position.set(b.x - 15, groundHeight(b) + .48, b.z - 15); d.updateMatrix(); flowerMesh.setMatrixAt(i, d.matrix); });
      scene.add(flowerMesh); vegetationInstances.push(flowerMesh);
    }
  }
  buildVegetation();

  const playerGroup = new THREE.Group(); scene.add(playerGroup);
  const skinMat = new THREE.MeshStandardMaterial({ color: '#d3a77c', roughness: .9 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: '#5e84b5', roughness: .9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: '#425f85', roughness: .9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: '#413d35', roughness: 1 });
  function part(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; playerGroup.add(mesh); return mesh;
  }
  part(new THREE.BoxGeometry(.43, .46, .28), shirtMat, 0, .87, 0);
  const head = part(new THREE.BoxGeometry(.34, .34, .34), skinMat, 0, 1.3, 0);
  part(new THREE.BoxGeometry(.37, .1, .38), hairMat, 0, 1.49, 0);
  const leftLeg = part(new THREE.BoxGeometry(.16, .34, .19), pantsMat, -.12, .46, 0);
  const rightLeg = part(new THREE.BoxGeometry(.16, .34, .19), pantsMat, .12, .46, 0);
  const leftArm = part(new THREE.BoxGeometry(.14, .4, .16), skinMat, -.29, .87, 0);
  const rightArm = part(new THREE.BoxGeometry(.14, .4, .16), skinMat, .29, .87, 0);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#26332d' });
  part(new THREE.BoxGeometry(.055, .055, .025), eyeMat, .085, 1.33, .176);
  part(new THREE.BoxGeometry(.055, .055, .025), eyeMat, -.04, 1.33, .176);

  const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, .86, 1.04)), new THREE.LineBasicMaterial({ color: '#fff2a8', transparent: true, opacity: .95 }));
  scene.add(highlight);
  const placeGeometry = new THREE.BoxGeometry(.92, .92, .92);
  function refreshHighlight() {
    const b = targetBlock();
    if (!b) { highlight.visible = false; return; }
    highlight.visible = true;
    const extra = placed.find(p => p.x === b.x && p.z === b.z);
    const y = groundHeight(b) + .42 + (extra ? extra.stack : 0);
    highlight.position.set(b.x - 15, y, b.z - 15);
  }
  const camOffset = new THREE.Vector3(11, 12, 14);
  let orbit = 0, cameraDistance = 1, dragStart = null, dragged = false;
  function updateCamera() {
    const center = new THREE.Vector3(player.x - 15, groundHeight(blocks.get(id(Math.round(player.x), Math.round(player.z))) || { elevation: 1 }) + .6, player.z - 15);
    const ox = Math.sin(orbit) * 10, oz = Math.cos(orbit) * 13;
    camera.position.set(center.x + ox * cameraDistance, center.y + 11 * cameraDistance, center.z + oz * cameraDistance);
    camera.lookAt(center.x, center.y + .2, center.z);
    sun.position.set(center.x - 12, 24, center.z + 15); sun.target.position.copy(center);
  }

  function targetBlock() {
    const dirs = [[1, 0], [0, -1], [0, 1], [-1, 0]], d = dirs[face];
    return blocks.get(id(Math.round(player.x + d[0] * .9), Math.round(player.z + d[1] * .9)));
  }
  function notify(message) {
    const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.remove('show'), 1700);
  }
  function updateUI() {
    const el = document.getElementById('inventory'); el.innerHTML = '';
    keys.forEach((key, index) => {
      const slot = document.createElement('button'); slot.className = 'slot' + (key === selected ? ' selected' : ''); slot.title = mat[key].name;
      slot.innerHTML = `<span class="key">${index + 1}</span><span class="icon">${mat[key].icon}</span><span class="num">${inventory[key]}</span>`;
      slot.addEventListener('click', () => { selected = key; updateUI(); }); el.appendChild(slot);
    });
    const progress = Math.min(100, (inventory.wood / 8 + inventory.stone / 6) * 50);
    document.getElementById('quest-progress').style.width = progress + '%';
    if (!questDone && inventory.wood >= 8 && inventory.stone >= 6) {
      questDone = true; document.getElementById('quest-title').textContent = 'Your first shelter!';
      document.getElementById('quest-text').textContent = 'Craft planks, then place them to make a home.';
      document.getElementById('quest-progress').style.width = '100%'; notify('Quest complete! You have the makings of a home.');
    }
  }
  function mine() {
    const b = targetBlock(); if (!b) return;
    const built = placed.findIndex(p => p.x === b.x && p.z === b.z);
    if (built >= 0) {
      const block = placed.splice(built, 1)[0]; inventory[block.type]++;
      scene.remove(block.mesh); updateUI(); refreshHighlight(); notify(`+1 ${mat[block.type].name.toLowerCase()}`); return;
    }
    if (b.tree) {
      b.tree = false; inventory.wood++; buildVegetation(); updateUI(); refreshHighlight(); notify('+1 wood'); return;
    }
    if (b.type === 'stone') inventory.stone++;
    else if (b.type === 'grass' || b.type === 'dirt' || b.type === 'sand') inventory.dirt++;
    else return;
    // Break the top soil cube; the broad ground plane remains below it.
    b.removed = true; rebuildTerrain(); updateUI(); refreshHighlight();
    notify(b.type === 'stone' ? '+1 stone' : '+1 dirt');
  }
  function place() {
    const b = targetBlock();
    if (!b || b.tree || inventory[selected] <= 0 || !['wood', 'plank', 'stone'].includes(selected)) {
      notify(inventory[selected] <= 0 ? `No ${mat[selected].name.toLowerCase()} to place` : 'That spot is blocked'); return;
    }
    const stack = placed.filter(p => p.x === b.x && p.z === b.z).length;
    const mesh = new THREE.Mesh(placeGeometry, materials[selected]);
    mesh.position.set(b.x - 15, groundHeight(b) + .84 + stack * .92, b.z - 15);
    mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    placed.push({ x: b.x, z: b.z, type: selected, mesh, stack });
    inventory[selected]--; updateUI(); refreshHighlight(); notify(`${mat[selected].name} placed`);
  }

  const held = new Set();
  const onKeyDown = event => {
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
    if (key === 'escape') document.getElementById('modal').classList.toggle('open');
    if (/^[1-6]$/.test(key)) { selected = keys[Number(key) - 1]; updateUI(); }
    held.add(key);
  };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
  function move(dx, dz) {
    let nx = Math.max(1.2, Math.min(W - 2.2, player.x + dx));
    let nz = Math.max(1.2, Math.min(H - 2.2, player.z + dz));
    const cell = blocks.get(id(Math.round(nx), Math.round(nz)));
    if (cell?.tree || placed.some(p => p.x === Math.round(nx) && p.z === Math.round(nz))) return;
    player.x = nx; player.z = nz;
    if (Math.abs(dx) > Math.abs(dz)) face = dx > 0 ? 0 : 3; else face = dz < 0 ? 1 : 2;
    player.walk += .75;
  }
  function movementFrame() {
    let dx = 0, dz = 0;
    if (held.has('w') || held.has('arrowup')) dz -= .075;
    if (held.has('s') || held.has('arrowdown')) dz += .075;
    if (held.has('a') || held.has('arrowleft')) dx -= .075;
    if (held.has('d') || held.has('arrowright')) dx += .075;
    if (dx && dz) { dx *= .707; dz *= .707; }
    if (dx || dz) move(dx, dz);
  }

  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 2) return;
    dragStart = { x: event.clientX, y: event.clientY, button: event.button }; dragged = false;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.x, dy = event.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
    if (dragged) { orbit -= dx * .006; cameraDistance = Math.max(.72, Math.min(1.55, cameraDistance + dy * .003)); dragStart.x = event.clientX; dragStart.y = event.clientY; }
  });
  canvas.addEventListener('pointerup', event => {
    if (dragStart && !dragged) dragStart.button === 2 ? place() : mine();
    dragStart = null;
  });
  canvas.addEventListener('wheel', event => { cameraDistance = Math.max(.72, Math.min(1.55, cameraDistance + event.deltaY * .001)); }, { passive: true });
  document.getElementById('mineBtn').addEventListener('pointerdown', event => { event.preventDefault(); mine(); });
  document.getElementById('placeBtn').addEventListener('pointerdown', event => { event.preventDefault(); place(); });
  document.querySelectorAll('[data-dir]').forEach(button => {
    let timer; const dir = button.dataset.dir;
    const action = () => { const directions = { up: [0, -.16], down: [0, .16], left: [-.16, 0], right: [.16, 0] }; move(...directions[dir]); };
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); action(); timer = setInterval(action, 95); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => button.addEventListener(name, () => clearInterval(timer)));
  });
  document.getElementById('craft').addEventListener('click', () => {
    if (inventory.wood >= 2) { inventory.wood -= 2; inventory.plank += 4; updateUI(); notify('Crafted 4 planks from 2 wood'); }
    else notify('Need 2 wood to craft 4 planks');
  });
  const toggleHelp = () => document.getElementById('modal').classList.toggle('open');
  document.getElementById('help').addEventListener('click', toggleHelp);
  document.getElementById('resume').addEventListener('click', toggleHelp);

  function resize() {
    const width = innerWidth, height = innerHeight;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize(); updateUI();
  let last = performance.now();
  function frame(now) {
    const delta = Math.min((now - last) / 1000, .04); last = now;
    movementFrame();
    const b = blocks.get(id(Math.round(player.x), Math.round(player.z)));
    playerGroup.position.set(player.x - 15, groundHeight(b || { elevation: 1 }) + .43, player.z - 15);
    playerGroup.rotation.y = face === 0 ? -Math.PI / 2 : face === 1 ? Math.PI : face === 3 ? 0 : Math.PI / 2;
    const step = held.size ? Math.sin(player.walk) * .55 : 0;
    leftLeg.rotation.x = step; rightLeg.rotation.x = -step; leftArm.rotation.x = -step * .7; rightArm.rotation.x = step * .7;
    updateCamera(); refreshHighlight(); renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => {
    time++; if (time >= 1440) { time = 0; dayNumber++; }
    const hour = (8 + Math.floor(time / 60)) % 24;
    document.getElementById('clock').textContent = String(hour).padStart(2, '0') + ':' + String(time % 60).padStart(2, '0');
    sun.intensity = 2.6 + Math.sin(time / 1440 * Math.PI * 2) * .5;
    document.getElementById('sun').style.width = (50 + Math.sin((time / 1440 - .25) * Math.PI * 2) * 40) + '%';
    document.getElementById('day').textContent = String(dayNumber).padStart(2, '0');
  }, 1500);
})();
