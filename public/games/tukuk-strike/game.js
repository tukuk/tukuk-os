/* Tukuk Strike — game.js
 * A third-person arena shooter in the spirit of Godot's TPS demo (robot enemies,
 * aim-down-sights, dash, wave survival), rebuilt for tukuk.org with no engine
 * download: procedural level, AI state machines, synthesized audio, touch support
 * and the site's own score API.
 *
 * Layout of this file:
 *   1. state + tuning           2. procedural meshes + level
 *   3. collision & ray helpers  4. player + camera + weapons
 *   5. enemies & AI             6. waves, pickups, projectiles
 *   7. HUD, menus, leaderboard  8. main loop + input wiring
 */
(function () {
  'use strict';
  const { M4, Builder, Renderer, Input, Audio, U } = window.TKE;
  const $ = (id) => document.getElementById(id);

  // ── 1. Tuning ───────────────────────────────────────────────────────────
  const ARENA = 30;                 // half width of the play field
  const GRAVITY = 24;
  const PLAYER_R = 0.42;
  const PLAYER_H = 1.75;
  const EYE_H = 1.58;
  const MAX_HP = 100;
  const LB_GAME = 'tukuk-strike';

  const WEAPONS = [
    {
      id: 'pulse', name: 'PULSE RIFLE', short: 'PULSE', dmg: 10, rate: 0.105, mag: 30,
      reserveMax: 210, reload: 1.35, spread: 0.008, pellets: 1, kick: 0.55,
      color: [0.35, 0.85, 1.0], tracer: [0.45, 0.9, 1.0], auto: true,
    },
    {
      id: 'scatter', name: 'SCATTER-6', short: 'SCATTER', dmg: 7, rate: 0.85, mag: 6,
      reserveMax: 60, reload: 1.85, spread: 0.075, pellets: 7, kick: 2.4,
      color: [1.0, 0.62, 0.25], tracer: [1.0, 0.7, 0.3], auto: false,
    },
    {
      id: 'arc', name: 'ARC LANCE', short: 'ARC', dmg: 95, rate: 1.15, mag: 4,
      reserveMax: 36, reload: 2.0, spread: 0.0015, pellets: 1, kick: 3.4,
      color: [0.72, 0.45, 1.0], tracer: [0.8, 0.55, 1.0], auto: false, pierce: true,
    },
  ];

  const ENEMY_TYPES = {
    grunt: {
      name: 'SENTINEL', hp: 34, speed: 3.4, radius: 0.55, height: 2.0, scale: 1.0,
      score: 100, color: [0.85, 0.3, 0.26], touch: 9, melee: 11,
    },
    sentry: {
      name: 'TURRET', hp: 26, speed: 2.1, radius: 0.6, height: 1.8, scale: 1.0,
      score: 130, color: [0.95, 0.55, 0.2], ranged: 9, keep: 9.5,
    },
    drone: {
      name: 'WASP', hp: 20, speed: 4.6, radius: 0.5, height: 1.0, scale: 1.0,
      score: 120, color: [0.55, 0.85, 1.0], ranged: 6, fly: 3.4,
    },
    brute: {
      name: 'JUGGERNAUT', hp: 140, speed: 2.4, radius: 0.9, height: 3.0, scale: 1.55,
      score: 320, color: [0.75, 0.2, 0.55], touch: 20, charge: 26,
    },
    titan: {
      name: 'TITAN', hp: 900, speed: 1.9, radius: 1.6, height: 5.2, scale: 2.5,
      score: 2000, color: [0.9, 0.2, 0.2], boss: true, touch: 26,
    },
  };

  const S = {
    mode: 'title',            // title | play | pause | over | upgrade
    time: 0, run: 0, dt: 0,
    wave: 0, wavePhase: 'idle', waveT: 0, queue: [], alive: 0,
    score: 0, kills: 0, shots: 0, hits: 0, combo: 0, comboT: 0,
    player: null, enemies: [], projectiles: [], pickups: [], props: [],
    obstacles: [], shake: 0, flash: 0, hitT: 0, toastT: 0,
    spawnPt: [0, 0, 0], best: 0, muted: false, quality: 1,
    submitted: false, lbDirty: true,
    diff: 'veteran',          // active run difficulty (also the title selection)
    mods: baseMods(),         // per-run perk multipliers, reset in resetRun()
    offers: [],               // the three perk cards currently on the upgrade screen
  };

  // ── Difficulty tiers ────────────────────────────────────────────────────
  // hp/speed scale every robot; budget/cap drive how many spawn at once;
  // mult is a straight score multiplier so harder runs are worth more.
  const DIFFS = {
    recruit:   { name: 'RECRUIT',   hp: 0.82, speed: 0.9,  budget: 0.8, cap: 10, mult: 0.8 },
    veteran:   { name: 'VETERAN',   hp: 1.0,  speed: 1.0,  budget: 1.0, cap: 14, mult: 1.0 },
    nightmare: { name: 'NIGHTMARE', hp: 1.5,  speed: 1.16, budget: 1.4, cap: 20, mult: 1.7 },
  };
  const DIFF_ORDER = ['recruit', 'veteran', 'nightmare'];

  // ── Between-wave perk upgrades (the roguelite build layer) ──────────────
  // Every perk mutates the run's S.mods and, where relevant, the live player.
  // shoot()/playerUpdate()/useAbility()/updatePickups() read these each frame.
  function baseMods() {
    return { dmg: 1, rate: 1, hp: 1, speed: 1, ability: 1, dash: 1, ammo: 1, crit: 2, lifesteal: 0, magnet: 1 };
  }
  const PERKS = [
    { id: 'dmg', name: 'HOLLOW POINT', desc: '+22% weapon damage', apply: (m) => { m.dmg *= 1.22; } },
    { id: 'rate', name: 'HAIR TRIGGER', desc: '+18% fire rate', apply: (m) => { m.rate *= 1.18; } },
    { id: 'hp', name: 'TEMPERED CHASSIS', desc: '+25% max integrity · repairs 25', apply: (m, p) => { m.hp *= 1.25; if (p) { p.maxHp = Math.round(MAX_HP * m.hp); p.hp = Math.min(p.maxHp, p.hp + 25); } } },
    { id: 'speed', name: 'KINETIC BOOSTERS', desc: '+16% movement speed', apply: (m) => { m.speed *= 1.16; } },
    { id: 'dash', name: 'BLINK CAPACITOR', desc: 'dash recharges 30% faster', apply: (m) => { m.dash *= 0.7; } },
    { id: 'ability', name: 'OVERCLOCK CORE', desc: 'overcharge recharges 32% faster', apply: (m) => { m.ability *= 0.68; } },
    { id: 'crit', name: 'DEADEYE OPTIC', desc: 'headshot bonus +1×', apply: (m) => { m.crit += 1; } },
    { id: 'leech', name: 'VAMPIRIC ROUNDS', desc: 'heal 4 integrity per kill', apply: (m) => { m.lifesteal += 4; } },
    { id: 'ammo', name: 'AMMO HOARD', desc: '+45% reserve capacity', apply: (m, p) => { m.ammo *= 1.45; if (p) p.ammo.forEach((s, i) => { s.reserve = Math.min(Math.round(WEAPONS[i].reserveMax * m.ammo), s.reserve + Math.round(WEAPONS[i].reserveMax * 0.3)); }); } },
    { id: 'magnet', name: 'MAGNET COIL', desc: 'pull pickups from farther away', apply: (m) => { m.magnet *= 1.9; } },
  ];

  let R = null, A = null, I = null, MESH = null;
  const tmpM = M4.create();
  const tmpM2 = M4.create();

  // ── 2. Procedural meshes ────────────────────────────────────────────────
  const C = {
    wall: [0.115, 0.14, 0.20], wallTrim: [0.16, 0.44, 0.82],
    crate: [0.36, 0.41, 0.50], crateTrim: [0.18, 0.66, 1.0],
    pillar: [0.21, 0.25, 0.33], pillarTrim: [0.2, 0.78, 1.0],
    metal: [0.30, 0.34, 0.43], dark: [0.15, 0.18, 0.24],
    blue: [0.26, 0.52, 0.94], cyan: [0.45, 0.93, 1.0],
    red: [1.0, 0.32, 0.24], amber: [1.0, 0.62, 0.2],
    white: [0.8, 0.85, 0.92],
  };

  function robotGrunt() {
    const b = new Builder();
    const body = C.metal, dark = C.dark, glow = [1.0, 0.3, 0.22];
    b.box(0, 1.18, 0, 0.86, 0.92, 0.58, body);
    b.box(0, 1.18, -0.31, 0.5, 0.5, 0.08, dark);
    b.box(0, 1.78, 0, 0.5, 0.44, 0.46, dark);
    b.box(0, 1.78, -0.24, 0.38, 0.11, 0.05, glow, 1);
    b.box(-0.63, 1.22, 0, 0.26, 0.8, 0.28, body);
    b.box(0.63, 1.22, 0, 0.26, 0.8, 0.28, body);
    b.box(-0.27, 0.44, 0, 0.32, 0.88, 0.36, dark);
    b.box(0.27, 0.44, 0, 0.32, 0.88, 0.36, dark);
    b.box(0.63, 1.5, -0.42, 0.16, 0.16, 0.62, dark);
    b.box(0.63, 1.5, -0.78, 0.1, 0.1, 0.14, glow, 1);
    b.box(0, 1.34, 0.32, 0.55, 0.5, 0.14, dark);
    return b;
  }

  function robotSentry() {
    const b = new Builder();
    b.cyl(0, 0.16, 0, 0.85, 0.9, 0.28, 12, C.dark);
    b.box(0, 0.75, 0, 0.62, 0.7, 0.62, C.metal);
    b.sphere(0, 1.28, 0, 0.34, 12, 8, [1.0, 0.55, 0.18], 0.9);
    b.box(0, 1.28, -0.45, 0.2, 0.2, 0.62, C.dark);
    b.box(0, 1.28, -0.8, 0.1, 0.1, 0.1, [1.0, 0.8, 0.4], 1);
    b.box(-0.4, 1.9, 0, 0.1, 0.4, 0.1, C.dark);
    b.box(0.4, 1.9, 0, 0.1, 0.4, 0.1, C.dark);
    return b;
  }

  function robotDrone() {
    const b = new Builder();
    b.sphere(0, 0, 0, 0.44, 12, 8, C.metal);
    b.sphere(0, -0.06, -0.34, 0.14, 8, 6, [1.0, 0.35, 0.3], 1);
    b.box(-0.62, 0.12, 0, 0.5, 0.06, 0.12, C.dark);
    b.box(0.62, 0.12, 0, 0.5, 0.06, 0.12, C.dark);
    b.cyl(-0.9, 0.16, 0, 0.34, 0.34, 0.04, 10, C.cyan, 0.6);
    b.cyl(0.9, 0.16, 0, 0.34, 0.34, 0.04, 10, C.cyan, 0.6);
    return b;
  }

  function robotBrute() {
    const b = new Builder();
    const body = [0.42, 0.24, 0.4], dark = C.dark;
    b.box(0, 1.25, 0, 1.35, 1.2, 0.95, body);
    b.box(0, 1.25, -0.5, 0.9, 0.6, 0.1, dark);
    b.box(0, 0.55, 0, 1.28, 0.5, 0.85, dark);
    b.box(0, 1.95, 0, 0.62, 0.55, 0.6, dark);
    b.box(0, 1.95, -0.32, 0.5, 0.14, 0.06, [1.0, 0.3, 0.6], 1);
    b.box(-0.86, 1.2, 0, 0.4, 1.05, 0.5, body);
    b.box(0.86, 1.2, 0, 0.4, 1.05, 0.5, body);
    b.box(-0.86, 0.55, -0.3, 0.34, 0.5, 0.34, dark);
    b.box(0.86, 0.55, -0.3, 0.34, 0.5, 0.34, dark);
    b.box(0, 1.55, 0.52, 1.0, 0.5, 0.2, dark);
    b.box(-0.4, 1.55, 0.6, 0.12, 0.36, 0.12, [1.0, 0.25, 0.5], 1);
    b.box(0.4, 1.55, 0.6, 0.12, 0.36, 0.12, [1.0, 0.25, 0.5], 1);
    b.box(-0.34, 0.16, 0, 0.4, 0.34, 0.5, dark);
    b.box(0.34, 0.16, 0, 0.4, 0.34, 0.5, dark);
    return b;
  }

  function robotTitan() {
    const b = new Builder();
    const body = [0.35, 0.16, 0.2], dark = C.dark, glow = [1.0, 0.25, 0.15];
    b.box(0, 1.3, 0, 1.5, 1.5, 1.1, body);
    b.box(0, 2.35, 0, 1.0, 0.7, 0.9, dark);
    b.box(0, 2.35, -0.48, 1.0, 0.2, 0.08, glow, 1);
    b.box(0, 1.3, -0.58, 0.7, 0.7, 0.1, glow, 0.35);
    b.box(-1.05, 1.3, 0, 0.55, 1.3, 0.65, body);
    b.box(1.05, 1.3, 0, 0.55, 1.3, 0.65, body);
    b.box(-1.05, 0.5, -0.35, 0.45, 0.6, 0.45, dark);
    b.box(1.05, 0.5, -0.35, 0.45, 0.6, 0.45, dark);
    b.box(-0.42, 0.3, 0, 0.55, 0.6, 0.7, dark);
    b.box(0.42, 0.3, 0, 0.55, 0.6, 0.7, dark);
    b.cyl(0, 1.95, 0.7, 0.45, 0.5, 0.9, 10, dark);
    b.cyl(0, 2.42, 0.7, 0.4, 0.4, 0.06, 10, glow, 1);
    return b;
  }

  function playerMesh() {
    const b = new Builder();
    const body = C.blue, dark = C.dark, trim = C.cream || [0.75, 0.82, 0.9];
    b.box(0, 1.12, 0, 0.72, 0.78, 0.5, body);
    b.box(0, 1.12, -0.27, 0.42, 0.44, 0.08, trim);
    b.box(0, 1.6, 0, 0.36, 0.34, 0.38, trim);
    b.box(0, 1.62, -0.2, 0.3, 0.1, 0.05, C.cyan, 1);
    b.box(0, 1.12, 0.32, 0.5, 0.55, 0.16, dark);
    b.box(-0.22, 1.12, 0.42, 0.12, 0.36, 0.1, C.cyan, 1);
    b.box(0.22, 1.12, 0.42, 0.12, 0.36, 0.1, C.cyan, 1);
    b.box(-0.5, 1.15, 0, 0.24, 0.72, 0.26, body);
    b.box(0.5, 1.15, 0, 0.24, 0.72, 0.26, body);
    b.box(-0.2, 0.4, 0, 0.28, 0.82, 0.32, dark);
    b.box(0.2, 0.4, 0, 0.28, 0.82, 0.32, dark);
    b.box(-0.2, 0.04, -0.05, 0.3, 0.14, 0.4, trim);
    b.box(0.2, 0.04, -0.05, 0.3, 0.14, 0.4, trim);
    b.box(0.5, 1.3, -0.4, 0.14, 0.14, 0.85, dark);
    b.box(0.5, 1.3, -0.86, 0.09, 0.09, 0.16, C.cyan, 1);
    return b;
  }

  function crateMesh(sx, sy, sz) {
    const b = new Builder();
    b.box(0, sy / 2, 0, sx, sy, sz, C.crate);
    b.box(0, sy * 0.5, 0, sx * 1.01, sy * 0.06, sz * 0.35, C.crateTrim, 0.9);
    b.box(0, sy * 0.86, 0, sx * 1.01, sy * 0.05, sz * 0.9, C.dark);
    return b;
  }

  function makeMeshes() {
    MESH = {};
    MESH.grunt = R.mesh(robotGrunt());
    MESH.sentry = R.mesh(robotSentry());
    MESH.drone = R.mesh(robotDrone());
    MESH.brute = R.mesh(robotBrute());
    MESH.titan = R.mesh(robotTitan());
    MESH.player = R.mesh(playerMesh());
    MESH.crate2 = R.mesh(crateMesh(2.4, 2.2, 2.4));
    MESH.crateS = R.mesh(crateMesh(1.5, 1.3, 1.5));
    MESH.crateT = R.mesh(crateMesh(3.4, 1.1, 2.2));

    // floor with the grid shader
    const f = new Builder();
    f.plane(0, 0, 0, ARENA * 2 + 8, ARENA * 2 + 8, [0.12, 0.145, 0.19], 0);
    MESH.floor = R.mesh(f);

    // perimeter walls + emissive trim bands
    const w = new Builder();
    const H = 6;
    w.box(0, H / 2, -ARENA - 0.7, ARENA * 2 + 3, H, 1.4, C.wall);
    w.box(0, H / 2, ARENA + 0.7, ARENA * 2 + 3, H, 1.4, C.wall);
    w.box(-ARENA - 0.7, H / 2, 0, 1.4, H, ARENA * 2 + 3, C.wall);
    w.box(ARENA + 0.7, H / 2, 0, 1.4, H, ARENA * 2 + 3, C.wall);
    for (let i = -2; i <= 2; i++) {
      w.box(i * 11, 0.5, -ARENA, 6, 0.14, 0.2, C.wallTrim, 0.85);
      w.box(i * 11, 0.5, ARENA, 6, 0.14, 0.2, C.wallTrim, 0.85);
      w.box(-ARENA, 0.5, i * 11, 0.2, 0.14, 6, C.wallTrim, 0.85);
      w.box(ARENA, 0.5, i * 11, 0.2, 0.14, 6, C.wallTrim, 0.85);
    }
    w.box(0, H - 0.4, -ARENA, ARENA * 2, 0.12, 0.3, C.wallTrim, 0.35);
    w.box(0, H - 0.4, ARENA, ARENA * 2, 0.12, 0.3, C.wallTrim, 0.35);
    MESH.walls = R.mesh(w);

    // pillar (one mesh, drawn per instance so it casts its own shadow)
    const p = new Builder();
    p.cyl(0, 2.6, 0, 0.95, 1.15, 5.2, 14, C.pillar);
    p.cyl(0, 0.25, 0, 1.35, 1.45, 0.5, 14, C.dark);
    p.cyl(0, 5.15, 0, 1.2, 1.05, 0.4, 14, C.dark);
    p.cyl(0, 3.6, 0, 1.02, 1.02, 0.1, 14, C.pillarTrim, 0.9);
    p.cyl(0, 1.6, 0, 1.06, 1.06, 0.08, 14, C.pillarTrim, 0.55);
    MESH.pillar = R.mesh(p);

    // raised centre pad
    const pad = new Builder();
    pad.cyl(0, 0.15, 0, 3.6, 3.8, 0.3, 24, C.dark);
    pad.cyl(0, 0.32, 0, 2.8, 2.9, 0.06, 24, C.pillarTrim, 0.6);
    MESH.pad = R.mesh(pad);

    // low cover walls
    const lc = new Builder();
    lc.box(0, 0.6, 0, 4.2, 1.2, 0.7, C.metal);
    lc.box(0, 1.22, 0, 4.2, 0.08, 0.8, C.crateTrim, 0.6);
    MESH.lowCover = R.mesh(lc);

    // projectile / pickup / fx meshes
    const orb = new Builder();
    orb.sphere(0, 0, 0, 0.26, 10, 8, [1.0, 0.55, 0.25], 1);
    MESH.orb = R.mesh(orb);

    const pk = new Builder();
    pk.box(0, 0, 0, 0.42, 0.42, 0.42, [0.4, 1.0, 0.7], 0.9);
    pk.box(0, 0, 0, 0.56, 0.16, 0.16, [0.8, 1.0, 0.9], 1);
    pk.box(0, 0, 0, 0.16, 0.56, 0.16, [0.8, 1.0, 0.9], 1);
    MESH.pickup = R.mesh(pk);

    const bossc = new Builder();
    bossc.sphere(0, 0, 0, 0.5, 10, 8, [1.0, 0.3, 0.3], 1);
    MESH.core = R.mesh(bossc);
  }

  // ── 3. Level, collision and rays ────────────────────────────────────────
  function addObstacle(x, z, w, h, d) {
    S.obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h, kind: 'box' });
  }

  const PROP_LAYOUT = [
    { mesh: 'crate2', x: -9, z: 8, w: 2.4, h: 2.2, d: 2.4, yaw: 0.15 },
    { mesh: 'crate2', x: 10, z: -7, w: 2.4, h: 2.2, d: 2.4, yaw: -0.3 },
    { mesh: 'crate2', x: -14, z: -11, w: 2.4, h: 2.2, d: 2.4, yaw: 0.6 },
    { mesh: 'crateS', x: 16, z: 12, w: 1.5, h: 1.3, d: 1.5, yaw: 0.1 },
    { mesh: 'crateS', x: 17.4, z: 11.2, w: 1.5, h: 1.3, d: 1.5, yaw: -0.5 },
    { mesh: 'crateS', x: -19, z: 16, w: 1.5, h: 1.3, d: 1.5, yaw: 0.9 },
    { mesh: 'crateS', x: -18, z: 17.4, w: 1.5, h: 1.3, d: 1.5, yaw: 0.2 },
    { mesh: 'crateT', x: 6, z: 18, w: 3.4, h: 1.1, d: 2.2, yaw: 0.0 },
    { mesh: 'crateT', x: -6, z: -18, w: 3.4, h: 1.1, d: 2.2, yaw: 0.0 },
    { mesh: 'crateT', x: 19, z: -18, w: 3.4, h: 1.1, d: 2.2, yaw: 0.8 },
    { mesh: 'lowCover', x: 0, z: 11, w: 4.2, h: 1.2, d: 0.8, yaw: 0.0 },
    { mesh: 'lowCover', x: 0, z: -11, w: 4.2, h: 1.2, d: 0.8, yaw: 0.0 },
    { mesh: 'lowCover', x: -17, z: -3, w: 4.2, h: 1.2, d: 0.8, yaw: Math.PI / 2 },
    { mesh: 'lowCover', x: 17, z: 3, w: 4.2, h: 1.2, d: 0.8, yaw: Math.PI / 2 },
    { mesh: 'pillar', x: -22, z: 22, w: 2.4, h: 5.2, d: 2.4, yaw: 0.0, round: true },
    { mesh: 'pillar', x: 22, z: 22, w: 2.4, h: 5.2, d: 2.4, yaw: 0.0, round: true },
    { mesh: 'pillar', x: -22, z: -22, w: 2.4, h: 5.2, d: 2.4, yaw: 0.0, round: true },
    { mesh: 'pillar', x: 22, z: -22, w: 2.4, h: 5.2, d: 2.4, yaw: 0.0, round: true },
    { mesh: 'pillar', x: 0, z: 0, w: 2.4, h: 5.2, d: 2.4, yaw: 0.0, round: true },
  ];

  function buildLevel() {
    S.obstacles.length = 0;
    S.props.length = 0;
    // perimeter
    addObstacle(0, -ARENA - 0.7, ARENA * 2 + 3, 6, 1.4);
    addObstacle(0, ARENA + 0.7, ARENA * 2 + 3, 6, 1.4);
    addObstacle(-ARENA - 0.7, 0, 1.4, 6, ARENA * 2 + 3);
    addObstacle(ARENA + 0.7, 0, 1.4, 6, ARENA * 2 + 3);
    // centre pad (walkable, 0.35 high)
    S.obstacles.push({ minX: -3.3, maxX: 3.3, minZ: -3.3, maxZ: 3.3, top: 0.35, kind: 'pad' });

    for (const p of PROP_LAYOUT) {
      addObstacle(p.x, p.z, p.w, p.h, p.d);
      S.props.push({
        mesh: MESH[p.mesh], x: p.x, z: p.z, yaw: p.yaw || 0,
        h: p.h, model: M4.create(), round: !!p.round,
      });
    }
    // The centre pillar hides the pad's middle — keep a hole in the pad walk area.
    for (const pr of S.props) {
      if (pr.round) M4.trs(pr.model, pr.x, 0, pr.z, pr.yaw, 0, 0, 1, 1, 1);
      else M4.trs(pr.model, pr.x, 0, pr.z, pr.yaw, 0, 0, 1, 1, 1);
    }
  }

  function resolveCircle(o, r, skipLow, feetY) {
    for (const b of S.obstacles) {
      if (skipLow && b.top <= (feetY || 0) + 0.32) continue;
      const nx = U.clamp(o.x, b.minX, b.maxX);
      const nz = U.clamp(o.z, b.minZ, b.maxZ);
      let dx = o.x - nx, dz = o.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        o.x = nx + (dx / d) * r;
        o.z = nz + (dz / d) * r;
      } else {
        // centre is inside the box: push out through the nearest face
        const lx = Math.min(o.x - b.minX, b.maxX - o.x);
        const lz = Math.min(o.z - b.minZ, b.maxZ - o.z);
        if (lx < lz) o.x = o.x < (b.minX + b.maxX) / 2 ? b.minX - r : b.maxX + r;
        else o.z = o.z < (b.minZ + b.maxZ) / 2 ? b.minZ - r : b.maxZ + r;
      }
    }
  }

  function groundAt(x, z, feetY) {
    let h = 0;
    for (const b of S.obstacles) {
      if (x < b.minX - 0.25 || x > b.maxX + 0.25 || z < b.minZ - 0.25 || z > b.maxZ + 0.25) continue;
      if (b.top <= feetY + 0.62 && b.top > h) h = b.top;
    }
    return h;
  }

  // Ray vs every obstacle box; returns the nearest hit distance or Infinity.
  function rayObstacles(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT === undefined ? Infinity : maxT;
    for (const b of S.obstacles) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b.minX, 0, b.minZ, b.maxX, b.top, b.maxZ);
      if (t !== null && t > 0.0001 && t < best) best = t;
    }
    return best;
  }
  function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
    let tmin = 0, tmax = 1e9;
    const ax = [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]];
    for (const [o, d, lo, hi] of ax) {
      if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) return null; continue; }
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    return tmin;
  }
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const ex = ox - cx, ey = oy - cy, ez = oz - cz;
    const b = ex * dx + ey * dy + ez * dz;
    const c = ex * ex + ey * ey + ez * ez - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 0) t = -b + sq;
    return t >= 0 ? t : null;
  }
  function lineOfSight(ax, ay, az, bx, by, bz) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    return rayObstacles(ax, ay, az, dx, dy, dz, len) >= len - 0.05;
  }

  // ── 4. Player, camera, weapons ──────────────────────────────────────────
  function newPlayer() {
    const m = S.mods;
    const maxHp = Math.round(MAX_HP * m.hp);
    return {
      x: 0, y: 0, z: 20, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, grounded: true, hp: maxHp, maxHp, dead: false,
      aim: false, sprint: false, bob: 0, hurtT: 0, regenT: 0,
      weapon: 0, fireCd: 0, kick: 0.04, recoil: 0,
      ammo: WEAPONS.map((w) => ({ mag: w.mag, reserve: Math.round(w.reserveMax * m.ammo), reloadT: 0 })),
      dashT: 0, dashCd: 0, dashDir: [0, 0, -1], invuln: 0,
      abilityCd: 0, abilityMax: 14, jumpBuf: 0, dashFx: 0, lastShot: 0,
    };
  }

  function resetRun() {
    S.enemies.length = 0;
    S.projectiles.length = 0;
    S.pickups.length = 0;
    S.wave = 0; S.wavePhase = 'idle'; S.waveT = 0; S.queue = []; S.alive = 0;
    S.score = 0; S.kills = 0; S.shots = 0; S.hits = 0; S.combo = 0; S.comboT = 0;
    S.shake = 0; S.flash = 0; S.hitT = 0; S.submitted = false; S.offers = [];
    S.mods = baseMods();
    S.player = newPlayer();
    S.run = 0;
    R.particles.list.length = 0;
    R.beams.list.length = 0;
    if (A && S.mode === 'play') A.startMusic();
  }

  function spawnPointAway() {
    // pick an edge point that is not right on top of the player
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = U.rand(16, ARENA - 4);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (U.dist2(x, z, S.player.x, S.player.z) < 100) continue;
      return [x, z];
    }
    return [0, -20];
  }

  function playerUpdate(dt) {
    const p = S.player;
    const [lx, ly] = I.consumeLook();
    p.yaw -= lx;
    p.pitch = U.clamp(p.pitch - ly, -0.85, 0.78);
    if (p.pitch > 1.1) p.pitch = 1.1;

    // aim toggle / sprint
    p.aim = I.aim;

    let [ix, iz] = I.axis();
    if (I.touchMove) { ix += I.touchMove[0]; iz += I.touchMove[1]; }
    const ilen = Math.hypot(ix, iz);
    if (ilen > 1) { ix /= ilen; iz /= ilen; }

    // camera-relative movement: forward is -Z rotated by yaw
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let wx = fx * iz + rx * ix;
    let wz = fz * iz + rz * ix;
    const wlen = Math.hypot(wx, wz);
    if (wlen > 1) { wx /= wlen; wz /= wlen; }

    p.sprint = !!(I.down('ShiftLeft') || I.down('ShiftRight')) && !p.aim && wlen > 0.1;
    const targetSpeed = (p.aim ? 3.4 : p.sprint ? 8.6 : 5.9) * S.mods.speed;

    if (p.dashT > 0) {
      p.dashT -= dt;
      const k = Math.max(0, p.dashT / 0.24);
      p.vx = p.dashDir[0] * (16 * k + 4);
      p.vz = p.dashDir[1] * (16 * k + 4);
      p.dashFx = Math.max(p.dashFx, k);
    } else {
      p.vx = U.damp(p.vx, wx * targetSpeed, 12, dt);
      p.vz = U.damp(p.vz, wz * targetSpeed, 12, dt);
    }

    // dash trigger (Shift tap) — a short burst with i-frames
    if (I.take('dash') && p.dashCd <= 0 && p.dashT <= 0) {
      const dxi = wlen > 0.1 ? wx : fx, dzi = wlen > 0.1 ? wz : fz;
      p.dashDir = [dxi, dzi];
      p.dashT = 0.24;
      p.dashCd = 1.9 * S.mods.dash;
      p.invuln = Math.max(p.invuln, 0.3);
      S.shake = Math.max(S.shake, 0.25);
      R.particles.burst(p.x, p.y + 0.9, p.z, 14, { color: [0.45, 0.85, 1], speed: 4, up: 0.3, gravity: 2, size: 1.1 });
      A.whoosh && A.whoosh();
    }
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.dashFx = Math.max(0, p.dashFx - dt * 3);

    // jump
    if (I.take('jump')) p.jumpBuf = 0.16;
    p.jumpBuf = Math.max(0, p.jumpBuf - dt);
    if (p.jumpBuf > 0 && p.grounded) {
      p.vy = 8.2; p.grounded = false; p.jumpBuf = 0;
      R.particles.burst(p.x, p.y + 0.05, p.z, 8, { color: [0.5, 0.7, 1], speed: 2.4, up: 0.2, gravity: 6, size: 0.9 });
    }
    if (!p.grounded) p.vy -= GRAVITY * dt;

    // integrate + collide
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const ahead = { x: p.x, z: p.z };
    resolveCircle(ahead, PLAYER_R, true, p.y);
    p.x = ahead.x; p.z = ahead.z;
    p.x = U.clamp(p.x, -ARENA + 1.2, ARENA - 1.2);
    p.z = U.clamp(p.z, -ARENA + 1.2, ARENA - 1.2);

    p.y += p.vy * dt;
    const g = groundAt(p.x, p.z, p.y);
    if (p.y <= g + 0.001 && p.vy <= 0) {
      if (!p.grounded && p.vy < -8) {
        R.particles.burst(p.x, g + 0.05, p.z, 10, { color: [0.4, 0.6, 0.9], speed: 3, up: 0.15, gravity: 9, size: 1 });
        S.shake = Math.max(S.shake, 0.12);
      }
      p.y = g; p.vy = 0; p.grounded = true;
    } else if (p.y > g + 0.02) {
      p.grounded = false;
    }
    if (p.grounded) p.vy = 0;

    // footstep bob + regen
    const spd = Math.hypot(p.vx, p.vz);
    p.bob += dt * (2.2 + spd * 0.8);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (p.hurtT <= 0 && p.hp < p.maxHp) {
      p.regenT += dt;
      if (p.regenT > 1.2) p.hp = Math.min(p.maxHp, p.hp + 7 * dt);
    } else p.regenT = 0;

    // weapon one-shots
    if (I.take('reload')) startReload();
    if (I.take('switchWeapon')) switchWeapon();
    if (I.take('ability')) useAbility();

    p.fireCd = Math.max(0, p.fireCd - dt);
    p.kick = U.damp(p.kick, 0, 9, dt);
    p.recoil = U.damp(p.recoil, 0, 7, dt);
    p.abilityCd = Math.max(0, p.abilityCd - dt);

    const slot = p.ammo[p.weapon];
    if (slot.reloadT > 0) {
      slot.reloadT -= dt;
      if (slot.reloadT <= 0) {
        const need = WEAPONS[p.weapon].mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take; slot.reserve -= take;
      }
    } else if (slot.mag <= 0 && slot.reserve > 0) {
      startReload();
    }

    const wantFire = I.fire || I.touchFire;
    if (wantFire && p.fireCd <= 0 && slot.reloadT <= 0 && slot.mag > 0 && !p.dead) shoot();
    if (slot.mag <= 0 && slot.reloadT <= 0) startReload();
  }

  function switchWeapon() {
    const p = S.player;
    selectWeapon((p.weapon + 1) % WEAPONS.length);
  }

  // Direct slot pick (keys 1/2/3). Guards the index so a fourth weapon slot in
  // the DOM never selects out of range, and keeps the swap cadence fair.
  function selectWeapon(i) {
    const p = S.player;
    if (i < 0 || i >= WEAPONS.length || i === p.weapon) return;
    p.weapon = i;
    p.fireCd = Math.max(p.fireCd, 0.25);
    const slot = p.ammo[i];
    if (slot.reloadT > 0) slot.reloadT = 0; // cancelling the swap aborts the current reload
    A.reload();
    HUD.weaponFlash();
  }

  function startReload() {
    const p = S.player, slot = p.ammo[p.weapon], W = WEAPONS[p.weapon];
    if (slot.reloadT > 0 || slot.mag >= W.mag || slot.reserve <= 0) return;
    slot.reloadT = W.reload;
    A.reload();
  }

  function camBasis() {
    const p = S.player;
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const fx = -Math.sin(p.yaw) * cp, fy = sp, fz = -Math.cos(p.yaw) * cp;
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    return { fx, fy, fz, rx, ry: 0, rz };
  }

  function muzzle() {
    const p = S.player, b = camBasis();
    return [
      p.x + b.rx * 0.35 + b.fx * 0.75,
      p.y + 1.32 + b.fy * 0.2,
      p.z + b.rz * 0.35 + b.fz * 0.75,
    ];
  }

  function shoot() {
    const p = S.player, W = WEAPONS[p.weapon], slot = p.ammo[p.weapon];
    slot.mag--;
    p.fireCd = W.rate / S.mods.rate;
    S.shots++;
    p.kick = W.kick;
    p.recoil = Math.min(1.5, p.recoil + W.kick * 0.6);
    S.shake = Math.max(S.shake, W.id === 'scatter' ? 0.5 : 0.12);
    const b = camBasis();
    const from = muzzle();
    // Converge the shot on the point the crosshair is over (eye + camera forward), so
    // the off-centre third-person camera still hits exactly what the reticle covers.
    const cam = S.cam || { eye: [p.x, p.y + 1.6, p.z] };
    const aimX = cam.eye[0] + b.fx * 90, aimY = cam.eye[1] + b.fy * 90, aimZ = cam.eye[2] + b.fz * 90;
    let bx = aimX - from[0], by = aimY - from[1], bz = aimZ - from[2];
    const bl = Math.hypot(bx, by, bz) || 1;
    bx /= bl; by /= bl; bz /= bl;
    R.particles.burst(from[0], from[1], from[2], W.id === 'scatter' ? 12 : 5, {
      color: W.color, speed: 5, up: 0.6, gravity: 4, life: 0.35, size: 0.9, drag: 4,
    });
    if (W.id === 'scatter') A.scatter(); else if (W.id === 'arc') A.railgun(); else A.shoot();

    for (let i = 0; i < W.pellets; i++) {
      const spread = W.spread * (W.pellets > 1 ? 1 : 0.5);
      const ax = (Math.random() - 0.5) * 2 * spread;
      const ay = (Math.random() - 0.5) * 2 * spread;
      let dx = bx + b.rx * ax, dy = by + ay, dz = bz + b.rz * ax;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;

      const wallT = rayObstacles(from[0], from[1], from[2], dx, dy, dz, 120);
      if (W.pierce) {
        // A lance beam punches through everything short of a wall, damaging each robot it crosses.
        let far = 0;
        for (const e of S.enemies) {
          if (e.state === 'dead' || e.state === 'spawn') continue;
          const cy = e.y + e.height * 0.55;
          const t = raySphere(from[0], from[1], from[2], dx, dy, dz, e.x, cy, e.z, e.radius + 0.18);
          if (t !== null && t < wallT) {
            S.hits++;
            const hy = from[1] + dy * t;
            const head = hy > e.y + e.height * 0.78;
            damageEnemy(e, W.dmg * S.mods.dmg * (head ? S.mods.crit : 1), head, from);
            if (t > far) far = t;
          }
        }
        const reach = far > 0 ? Math.min(far + 6, wallT, 120) : Math.min(wallT, 120);
        const ex = from[0] + dx * reach, ey = from[1] + dy * reach, ez = from[2] + dz * reach;
        R.beams.add(from, [ex, ey, ez], W.tracer, 0.16, 0.09);
        R.particles.burst(ex, ey, ez, far > 0 ? 10 : 4, { color: W.tracer, speed: 4, up: 0.5, gravity: 4, life: 0.5, size: 0.8, drag: 3 });
        continue;
      }
      let hitEnemy = null, hitT = wallT, head = false;
      for (const e of S.enemies) {
        if (e.state === 'dead' || e.state === 'spawn') continue;
        const cy = e.y + e.height * 0.55;
        const t = raySphere(from[0], from[1], from[2], dx, dy, dz, e.x, cy, e.z, e.radius + 0.15);
        if (t !== null && t < hitT) {
          const hy = from[1] + dy * t;
          const topY = e.y + e.height;
          // head band = the upper 22% of the robot
          head = hy > e.y + e.height * 0.78;
          hitT = t; hitEnemy = e;
          if (topY < hy) { hitEnemy = null; }
        }
      }
      const ex = from[0] + dx * Math.min(hitT, 120);
      const ey = from[1] + dy * Math.min(hitT, 120);
      const ez = from[2] + dz * Math.min(hitT, 120);
      R.beams.add(from, [ex, ey, ez], W.tracer, 0.07, W.pellets > 1 ? 0.035 : 0.045);
      if (hitEnemy) {
        S.hits++;
        const dmg = W.dmg * S.mods.dmg * (head ? S.mods.crit : 1);
        damageEnemy(hitEnemy, dmg, head, from);
      } else if (wallT < 120) {
        R.particles.burst(ex, ey, ez, 4, { color: [0.8, 0.9, 1], speed: 3.2, up: 0.5, gravity: 8, life: 0.4, size: 0.55, drag: 3 });
      }
    }
  }

  function useAbility() {
    const p = S.player;
    if (p.abilityCd > 0) return;
    p.abilityMax = 14 * S.mods.ability;
    p.abilityCd = p.abilityMax;
    A.ability();
    S.shake = Math.max(S.shake, 0.7);
    S.flash = Math.max(S.flash, 0.5);
    const cx = p.x, cy = p.y + 0.9, cz = p.z;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      R.beams.add([cx, cy, cz], [cx + Math.cos(a) * 7.5, cy + 0.25, cz + Math.sin(a) * 7.5], [0.4, 0.85, 1.0], 0.35, 0.06);
    }
    R.particles.burst(cx, cy, cz, 40, { color: [0.45, 0.9, 1], speed: 9, up: 0.4, gravity: 1, size: 1.2, life: 0.7 });
    for (const e of S.enemies) {
      if (e.state === 'dead' || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - cx, e.z - cz);
      if (d < 7.5) {
        const dmg = 70 * (1 - d / 9);
        damageEnemy(e, dmg, false, [cx, cy, cz]);
        e.stun = Math.max(e.stun, 1.1);
      }
    }
    HUD.toast('OVERCHARGE', 'pulse released');
  }

  function playerHurt(dmg, fromX, fromZ) {
    const p = S.player;
    if (p.dead || p.invuln > 0) return;
    p.hp -= dmg;
    p.hurtT = 3.2;
    p.regenT = 0;
    S.flash = Math.min(1, S.flash + 0.45);
    S.shake = Math.max(S.shake, 0.45);
    A.damage();
    // knockback
    const dx = p.x - fromX, dz = p.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    p.vx += (dx / d) * 3.2;
    p.vz += (dz / d) * 3.2;
    HUD.damage();
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      endRun();
    }
  }

  function cameraUpdate(dt) {
    const p = S.player;
    const b = camBasis();
    const aim = p.aim;
    const dist = U.damp(S.camDist === undefined ? 5.6 : S.camDist, aim ? 2.6 : 5.6, 9, dt);
    S.camDist = dist;
    const shoulder = aim ? 0.66 : 0.55;
    const pivotY = p.y + EYE_H + (aim ? 0.1 : 0.2);
    const px = p.x + b.rx * shoulder;
    const pz = p.z + b.rz * shoulder;
    let ex = px - b.fx * dist;
    let ey = pivotY - b.fy * dist + (aim ? 0.05 : 0.35);
    let ez = pz - b.fz * dist;

    // shorten the arm when a wall sits between the pivot and the camera
    let dx = ex - p.x, dy = ey - pivotY, dz = ez - p.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const t = rayObstacles(p.x, pivotY, p.z, dx / len, dy / len, dz / len, len);
    if (t < len) {
      const k = Math.max(0.18, (t - 0.25) / len);
      ex = p.x + dx * k;
      ey = pivotY + dy * k;
      ez = p.z + dz * k;
    }
    if (ey < 0.4) ey = 0.4;

    const shake = S.shake;
    if (shake > 0.001) {
      ex += (Math.random() - 0.5) * shake * 0.35;
      ey += (Math.random() - 0.5) * shake * 0.35;
      ez += (Math.random() - 0.5) * shake * 0.35;
    }
    S.shake = Math.max(0, S.shake - dt * 2.2);

    const fovTarget = aim ? 56 : p.sprint ? 78 : 72;
    S.camFov = U.damp(S.camFov === undefined ? 72 : S.camFov, fovTarget, 7, dt);

    S.cam = {
      eye: [ex, ey, ez],
      target: [ex + b.fx * 20, ey + b.fy * 20 + p.pitch * 0.6, ez + b.fz * 20],
      fov: S.camFov,
    };
  }

  // ── 5. Enemies and AI ───────────────────────────────────────────────────
  function newEnemy(type, x, z) {
    const T = ENEMY_TYPES[type];
    const D = DIFFS[S.diff] || DIFFS.veteran;
    const hpScale = (1 + Math.max(0, S.wave - 1) * 0.075) * D.hp;
    return {
      type, x, z, y: T.fly || 0,
      vx: 0, vy: 0, vz: 0,
      yaw: Math.atan2(-(S.player.x - x), -(S.player.z - z)),
      hp: T.hp * hpScale, maxHp: T.hp * hpScale,
      spdMul: D.speed,
      radius: T.radius * (T.scale || 1) * 0.85,
      height: T.height * (T.scale || 1),
      scale: T.scale || 1,
      mesh: MESH[type],
      state: 'spawn', stateT: 0.85,
      fireT: U.rand(1.0, 2.2), tel: 0,
      act: '', actT: 0, stun: 0, hurtT: 0,
      chargeCd: U.rand(2, 4), strafe: Math.random() < 0.5 ? 1 : -1,
      strafeT: U.rand(1.2, 2.8), bobT: Math.random() * 6.28,
      deadT: 0, summonCd: 7, shots: 0,
    };
  }

  function spawnEnemy(type, x, z) {
    const e = newEnemy(type, x, z);
    S.enemies.push(e);
    const col = ENEMY_TYPES[type].color;
    R.particles.burst(x, 0.4, z, 18, { color: col, speed: 5, up: 0.9, gravity: 8, size: 1.2, life: 0.8 });
    // a visible ring so a spawn is never a blind shot from off-screen
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      R.beams.add([x + Math.cos(a) * 1.5, 0.06, z + Math.sin(a) * 1.5],
        [x + Math.cos(a) * 0.5, 2.4, z + Math.sin(a) * 0.5], col, 0.75, 0.05);
    }
    return e;
  }

  function moveEnemy(e, dt) {
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    const o = { x: e.x, z: e.z };
    resolveCircle(o, e.radius, true, e.y);
    e.x = U.clamp(o.x, -ARENA + 1.6, ARENA - 1.6);
    e.z = U.clamp(o.z, -ARENA + 1.6, ARENA - 1.6);
    const T = ENEMY_TYPES[e.type];
    if (T.fly) e.y = T.fly + Math.sin(e.bobT * 1.9) * 0.35;
    else e.y = groundAt(e.x, e.z, e.y);
  }

  function enemyFire(e, dmg, speed, spread, count, color) {
    const p = S.player;
    const sy = e.y + e.height * 0.62;
    const base = Math.atan2(-(p.x - e.x), -(p.z - e.z));
    for (let i = 0; i < count; i++) {
      const a = base + (i - (count - 1) / 2) * spread + (Math.random() - 0.5) * spread * 0.4;
      const dx = -Math.sin(a), dz = -Math.cos(a);
      // lead the target a little so strafing is not a free dodge
      const tx = p.x - e.x, tz = p.z - e.z;
      const flight = Math.hypot(tx, tz) / speed;
      const aimX = p.x + p.vx * flight * 0.55 - e.x;
      const aimZ = p.z + p.vz * flight * 0.55 - e.z;
      const yy = (sy - (e.y + 0.9));
      const len = Math.hypot(aimX, aimZ) || 1;
      const dy = U.clamp(((p.y + 1.0) - sy) / (len / speed), -4, 4);
      S.projectiles.push({
        x: e.x + dx * 0.7, y: sy + yy * 0.2, z: e.z + dz * 0.7,
        vx: (aimX / len) * speed, vy: dy, vz: (aimZ / len) * speed,
        life: 3.4, dmg, color: color || [1.0, 0.5, 0.2], fromEnemy: true, radius: 0.34,
      });
    }
    R.particles.burst(e.x, sy, e.z, 5, { color: color || [1, 0.5, 0.2], speed: 2.5, up: 0.3, gravity: 0, size: 0.7, life: 0.25 });
    A.enemyShoot();
  }

  function aiGrunt(e, dt, nx, nz, dist) {
    const T = ENEMY_TYPES.grunt;
    if (e.act === 'windup') {
      e.actT -= dt;
      e.vx = U.damp(e.vx, 0, 12, dt); e.vz = U.damp(e.vz, 0, 12, dt);
      if (e.actT <= 0) {
        if (dist < 2.9) {
          playerHurt(T.melee, e.x, e.z);
          R.particles.burst(e.x + nx * 0.8, e.y + 1.2, e.z + nz * 0.8, 10, { color: [1, 0.4, 0.3], speed: 4, up: 0.5, gravity: 4, size: 0.9 });
        }
        e.act = 'recover'; e.actT = 0.55;
      }
      return;
    }
    if (e.act === 'recover') {
      e.actT -= dt;
      e.vx = U.damp(e.vx, nx * 1.2, 5, dt); e.vz = U.damp(e.vz, nz * 1.2, 5, dt);
      if (e.actT <= 0) e.act = '';
      return;
    }
    if (dist < 2.3) {
      e.act = 'windup'; e.actT = 0.34;
      e.hurtT = 0.34;
      e.vx = 0; e.vz = 0;
    } else {
      e.vx = U.damp(e.vx, nx * T.speed * e.spdMul, 7, dt);
      e.vz = U.damp(e.vz, nz * T.speed * e.spdMul, 7, dt);
    }
  }

  function aiSentry(e, dt, nx, nz, dist) {
    const T = ENEMY_TYPES.sentry;
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = U.rand(1.6, 3.2); }
    const tx = -nz * e.strafe, tz = nx * e.strafe;
    if (dist > T.keep + 3) {
      e.vx = U.damp(e.vx, nx * T.speed * e.spdMul, 4, dt); e.vz = U.damp(e.vz, nz * T.speed * e.spdMul, 4, dt);
    } else if (dist < T.keep - 3) {
      e.vx = U.damp(e.vx, -nx * T.speed * e.spdMul, 4, dt); e.vz = U.damp(e.vz, -nz * T.speed * e.spdMul, 4, dt);
    } else {
      e.vx = U.damp(e.vx, tx * T.speed * 0.8 * e.spdMul, 4, dt); e.vz = U.damp(e.vz, tz * T.speed * 0.8 * e.spdMul, 4, dt);
    }
    const sy = e.y + e.height * 0.7;
    const los = lineOfSight(e.x, sy, e.z, S.player.x, S.player.y + 1.1, S.player.z);
    if (e.tel > 0) {
      e.tel -= dt;
      if (e.tel <= 0) { enemyFire(e, 9, 26, 0.06, 3, [1, 0.55, 0.2]); e.fireT = U.rand(1.6, 2.4); }
    } else if (los && dist < 22) {
      e.fireT -= dt;
      if (e.fireT <= 0) e.tel = 0.42;
    }
  }

  function aiDrone(e, dt, nx, nz, dist) {
    const T = ENEMY_TYPES.drone;
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = U.rand(0.9, 1.8); }
    const want = 7;
    const radial = dist > want + 1.5 ? 1 : dist < want - 1.5 ? -1 : 0;
    const tx = -nz * e.strafe * 0.85 + nx * radial;
    const tz = nx * e.strafe * 0.85 + nz * radial;
    e.vx = U.damp(e.vx, tx * T.speed * e.spdMul, 5, dt);
    e.vz = U.damp(e.vz, tz * T.speed * e.spdMul, 5, dt);
    const los = lineOfSight(e.x, e.y, e.z, S.player.x, S.player.y + 1.1, S.player.z);
    if (e.tel > 0) {
      e.tel -= dt;
      if (e.tel <= 0) { enemyFire(e, 6, 24, 0.05, 2, [0.5, 0.85, 1]); e.fireT = U.rand(1.5, 2.2); }
    } else if (los && dist < 20) {
      e.fireT -= dt;
      if (e.fireT <= 0) e.tel = 0.3;
    }
  }

  function aiBrute(e, dt, nx, nz, dist) {
    const T = ENEMY_TYPES.brute;
    e.chargeCd = Math.max(0, e.chargeCd - dt);
    if (e.act === 'charge') {
      e.actT -= dt;
      e.vx = e.chargeDir[0] * 13; e.vz = e.chargeDir[1] * 13;
      if (dist < 2.6) {
        playerHurt(T.charge, e.x, e.z);
        S.shake = Math.max(S.shake, 0.6);
        e.act = 'recover'; e.actT = 1.3; e.chargeCd = 4.5;
      } else if (e.actT <= 0) { e.act = 'recover'; e.actT = 0.9; e.chargeCd = 3.2; }
      R.particles.spawn({ x: e.x, y: e.y + 0.3, z: e.z, vy: 1.4, life: 0.5, size: 1.4, color: [1, 0.3, 0.6], gravity: -1, drag: 2 });
      return;
    }
    if (e.act === 'recover') {
      e.actT -= dt;
      e.vx = U.damp(e.vx, 0, 5, dt); e.vz = U.damp(e.vz, 0, 5, dt);
      if (e.actT <= 0) e.act = '';
      return;
    }
    if (e.chargeCd <= 0 && dist > 5 && dist < 15) {
      e.act = 'charge'; e.actT = 0.95; e.chargeDir = [nx, nz]; e.hurtT = 0.2;
      A.enemyShoot();
      return;
    }
    if (dist < 3.2) {
      e.vx = U.damp(e.vx, 0, 6, dt); e.vz = U.damp(e.vz, 0, 6, dt);
      e.attackT = (e.attackT || 0) + dt;
      if (e.attackT > 1.5) {
        e.attackT = 0;
        playerHurt(T.touch, e.x, e.z);
        S.shake = Math.max(S.shake, 0.5);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          R.beams.add([e.x, e.y + 0.3, e.z], [e.x + Math.cos(a) * 4, e.y + 0.2, e.z + Math.sin(a) * 4], [1, 0.35, 0.6], 0.3, 0.05);
        }
      }
    } else {
      e.vx = U.damp(e.vx, nx * T.speed * e.spdMul, 4, dt);
      e.vz = U.damp(e.vz, nz * T.speed * e.spdMul, 4, dt);
    }
  }

  function aiTitan(e, dt, nx, nz, dist) {
    const T = ENEMY_TYPES.titan;
    const half = e.hp < e.maxHp * 0.5;
    const spd = T.speed * e.spdMul * (half ? 1.55 : 1);
    e.vx = U.damp(e.vx, nx * spd, 3, dt);
    e.vz = U.damp(e.vz, nz * spd, 3, dt);
    e.summonCd -= dt;
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.fireT = half ? 2.4 : 3.4;
      // radial barrage, aimed slightly at the player for the middle shot
      const sx = e.x, sy = e.y + e.height * 0.55, sz = e.z;
      const n = half ? 16 : 12;
      const base = Math.atan2(-(S.player.x - sx), -(S.player.z - sz));
      for (let i = 0; i < n; i++) {
        const a = base + (i / n) * Math.PI * 2;
        S.projectiles.push({
          x: sx, y: sy, z: sz,
          vx: -Math.sin(a) * 14, vy: 0, vz: -Math.cos(a) * 14,
          life: 3.6, dmg: 12, color: [1, 0.3, 0.25], fromEnemy: true, radius: 0.42,
        });
      }
      R.particles.burst(sx, sy, sz, 26, { color: [1, 0.35, 0.3], speed: 8, up: 0.5, gravity: 2, size: 1.4, life: 0.7 });
      S.shake = Math.max(S.shake, 0.5);
      A.enemyShoot();
    }
    if (e.summonCd <= 0) {
      e.summonCd = half ? 7 : 11;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        S.queue.push({ type: 'grunt', x: e.x + Math.cos(a) * 4, z: e.z + Math.sin(a) * 4, delay: 0.1 });
      }
      HUD.toast('TITAN', 'reinforcements incoming');
    }
    if (dist < 4.5) {
      e.attackT = (e.attackT || 0) + dt;
      if (e.attackT > 2) {
        e.attackT = 0;
        playerHurt(T.touch, e.x, e.z);
        S.shake = Math.max(S.shake, 0.8);
      }
    }
  }

  function updateEnemies(dt) {
    const p = S.player;
    // flock separation so the robots never stack into one column
    for (let i = 0; i < S.enemies.length; i++) {
      const a = S.enemies[i];
      if (a.state === 'dead' || a.state === 'spawn') continue;
      for (let j = i + 1; j < S.enemies.length; j++) {
        const b = S.enemies[j];
        if (b.state === 'dead' || b.state === 'spawn') continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const need = a.radius + b.radius + 0.35;
        const d2 = dx * dx + dz * dz;
        if (d2 > need * need || d2 < 1e-5) continue;
        const d = Math.sqrt(d2);
        const push = (need - d) * 0.5;
        dx /= d; dz /= d;
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;
      }
    }

    for (let i = S.enemies.length - 1; i >= 0; i--) {
      const e = S.enemies[i];
      if (e.state === 'dead') {
        e.deadT += dt;
        if (e.deadT > 0.5) S.enemies.splice(i, 1);
        continue;
      }
      if (e.state === 'spawn') {
        e.stateT -= dt;
        if (e.stateT <= 0) e.state = 'seek';
        continue;
      }
      e.bobT += dt;
      e.hurtT = Math.max(0, e.hurtT - dt);
      if (e.stun > 0) {
        e.stun -= dt;
        e.vx = U.damp(e.vx, 0, 6, dt);
        e.vz = U.damp(e.vz, 0, 6, dt);
        moveEnemy(e, dt);
        continue;
      }
      let dx = p.x - e.x, dz = p.z - e.z;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist, nz = dz / dist;
      e.yaw = U.angDamp(e.yaw, Math.atan2(-nx, -nz), 7, dt);
      const T = ENEMY_TYPES[e.type];
      if (e.type === 'grunt') aiGrunt(e, dt, nx, nz, dist);
      else if (e.type === 'sentry') aiSentry(e, dt, nx, nz, dist);
      else if (e.type === 'drone') aiDrone(e, dt, nx, nz, dist);
      else if (e.type === 'brute') aiBrute(e, dt, nx, nz, dist);
      else aiTitan(e, dt, nx, nz, dist);
      moveEnemy(e, dt);
      // charging brutes and titan slams hit on contact
      if ((e.act === 'charge' || e.type === 'titan') && dist < e.radius + PLAYER_R + 0.3) {
        if (e.contactCd === undefined) e.contactCd = 0;
        if (e.contactCd <= 0) { playerHurt(T.charge || T.touch, e.x, e.z); e.contactCd = 1.1; }
      }
      if (e.contactCd !== undefined) e.contactCd = Math.max(0, e.contactCd - dt);
    }
  }

  function damageEnemy(e, dmg, head, from) {
    if (!e || e.state === 'dead') return;
    e.hp -= dmg;
    e.hurtT = 0.12;
    S.hitT = 0.14;
    A.hit();
    const cy = e.y + e.height * (head ? 0.85 : 0.5);
    R.particles.burst(e.x, cy, e.z, head ? 12 : 6, {
      color: head ? [1, 0.85, 0.4] : [1, 0.55, 0.35], speed: 4, up: 0.6, gravity: 6, size: 0.8, life: 0.4, drag: 4,
    });
    if (head) HUD.hitmark(true); else HUD.hitmark(false);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    const T = ENEMY_TYPES[e.type];
    e.state = 'dead'; e.deadT = 0;
    S.kills++;
    S.combo++;
    S.comboT = 3.4;
    const mult = 1 + Math.min(8, Math.floor(S.combo / 5)) * 0.5;
    const D = DIFFS[S.diff] || DIFFS.veteran;
    const gain = Math.round(T.score * mult * D.mult);
    S.score += gain;
    if (S.mods.lifesteal > 0 && S.player && !S.player.dead) {
      S.player.hp = Math.min(S.player.maxHp, S.player.hp + S.mods.lifesteal);
    }
    if (S.combo === 8) HUD.banner('KILLING SPREE', 'x' + mult.toFixed(1) + ' combo');
    else if (S.combo === 16) HUD.banner('UNSTOPPABLE', 'x' + mult.toFixed(1) + ' combo');
    const cy = e.y + e.height * 0.5;
    R.particles.burst(e.x, cy, e.z, T.boss ? 70 : 26, {
      color: T.color, speed: T.boss ? 14 : 7, up: 0.7, gravity: 9, size: T.boss ? 1.8 : 1.1, life: 1.1,
    });
    R.particles.burst(e.x, cy, e.z, T.boss ? 40 : 14, {
      color: [1, 0.85, 0.45], speed: T.boss ? 11 : 6, up: 0.9, gravity: 5, size: 1.4, life: 0.8, drag: 1.4,
    });
    A.explosion(!!T.boss);
    S.shake = Math.max(S.shake, T.boss ? 1.1 : 0.3);
    HUD.toast('+' + gain, (T.boss ? 'TITAN DESTROYED ' : '') + (mult > 1 ? 'x' + mult.toFixed(1) + ' combo' : T.name));
    // drops
    const roll = Math.random();
    if (T.boss) { dropPickup(e.x, e.z, 'health'); dropPickup(e.x + 1.4, e.z, 'ammo'); }
    else if (roll < 0.12) dropPickup(e.x, e.z, 'health');
    else if (roll < 0.3) dropPickup(e.x, e.z, 'ammo');
    else if (roll < 0.34) dropPickup(e.x, e.z, 'ability');
  }

  // ── 6. Projectiles, pickups, waves ──────────────────────────────────────
  function dropPickup(x, z, kind) {
    S.pickups.push({ kind, x, z, y: 0.7, vy: 2.2, t: Math.random() * 6.28, life: 26 });
  }

  function updateProjectiles(dt) {
    const p = S.player;
    for (let i = S.projectiles.length - 1; i >= 0; i--) {
      const b = S.projectiles[i];
      b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      let dead = b.life <= 0;
      if (b.y < 0.12) dead = true;
      if (!dead) {
        for (const o of S.obstacles) {
          if (b.x > o.minX && b.x < o.maxX && b.z > o.minZ && b.z < o.maxZ && b.y < o.top) { dead = true; break; }
        }
      }
      if (!dead && !p.dead) {
        const dx = b.x - p.x, dy = b.y - (p.y + 1.0), dz = b.z - p.z;
        if (dx * dx + dy * dy + dz * dz < (PLAYER_R + 0.35) * (PLAYER_R + 0.35)) {
          playerHurt(b.dmg, b.x, b.z);
          dead = true;
        }
      }
      if (dead) {
        R.particles.burst(b.x, b.y, b.z, 7, { color: b.color, speed: 4, up: 0.5, gravity: 5, size: 0.8, life: 0.4, drag: 3 });
        S.projectiles.splice(i, 1);
      }
    }
  }

  function updatePickups(dt) {
    const p = S.player;
    for (let i = S.pickups.length - 1; i >= 0; i--) {
      const k = S.pickups[i];
      k.t += dt; k.life -= dt;
      const d = Math.hypot(p.x - k.x, p.z - k.z);
      if (d < 3.2 * S.mods.magnet && k.life < 26 && d > 0.6) {
        // magnet toward the player once they are close
        k.x += ((p.x - k.x) / d) * 6 * dt;
        k.z += ((p.z - k.z) / d) * 6 * dt;
      }
      k.vy -= 9 * dt;
      k.y += k.vy * dt;
      if (k.y < 0.6) { k.y = 0.6; k.vy = 0; }
      if (d < 0.9) {
        if (k.kind === 'health') { p.hp = Math.min(p.maxHp, p.hp + 32); HUD.toast('+32 HP', 'repair kit'); }
        else if (k.kind === 'ammo') {
          p.ammo.forEach((s, idx) => { s.reserve = Math.min(Math.round(WEAPONS[idx].reserveMax * S.mods.ammo), s.reserve + 60); });
          HUD.toast('+60 AMMO', 'resupply');
        } else { p.abilityCd = 0; HUD.toast('OVERCHARGE READY', 'core recovered'); }
        A.pickup();
        R.particles.burst(k.x, k.y, k.z, 12, { color: [0.4, 1, 0.7], speed: 4, up: 0.8, gravity: 3, size: 1, life: 0.5 });
        S.pickups.splice(i, 1);
        continue;
      }
      if (k.life <= 0) S.pickups.splice(i, 1);
    }
  }

  function waveCost(t) { return t === 'brute' ? 4 : t === 'sentry' ? 2.5 : t === 'drone' ? 2 : t === 'titan' ? 8 : 1.5; }

  function buildWave(n) {
    const q = [];
    if (n % 5 === 0) {
      q.push({ type: 'titan', delay: 0 });
      const guards = 2 + Math.floor(n / 5);
      for (let i = 0; i < guards; i++) q.push({ type: 'grunt', delay: 1.2 + i * 0.4 });
    }
    const pool = ['grunt', 'grunt'];
    if (n >= 2) pool.push('sentry');
    if (n >= 3) pool.push('drone');
    if (n >= 5) pool.push('brute');
    let budget = (7 + n * 3.4) * ((DIFFS[S.diff] || DIFFS.veteran).budget);
    let guard = 0;
    while (budget > 0 && guard++ < 60) {
      const t = U.pick(pool);
      budget -= waveCost(t);
      q.push({ type: t, delay: 0 });
    }
    return q;
  }

  function startWave(n) {
    S.wave = n;
    S.wavePhase = 'active';
    S.waveT = 0;
    S.queue = buildWave(n);
    S.spawnT = 0.4;
    const boss = n % 5 === 0;
    HUD.banner(boss ? 'WAVE ' + n + ' — TITAN' : 'WAVE ' + n, boss ? 'A titan has entered the arena' : S.queue.length + ' hostiles inbound');
    A.wave();
    if (n === 1) HUD.toast('MOVE + AIM', 'WASD · mouse · right-click to aim');
  }

  function updateWave(dt) {
    if (S.wavePhase === 'idle') {
      S.waveT -= dt;
      if (S.waveT <= 0) startWave(S.wave + 1);
      return;
    }
    if (S.wavePhase === 'clear') {
      S.waveT -= dt;
      if (S.waveT <= 0) startWave(S.wave + 1);
      return;
    }
    // active
    S.spawnT -= dt;
    const D = DIFFS[S.diff] || DIFFS.veteran;
    const live = S.enemies.filter((e) => e.state !== 'dead').length;
    if (S.queue.length && live < D.cap && S.spawnT <= 0) {
      const item = S.queue.shift();
      if (item.x !== undefined) spawnEnemy(item.type, item.x, item.z);
      else {
        const pt = spawnPointAway();
        spawnEnemy(item.type, pt[0], pt[1]);
      }
      S.spawnT = item.type === 'titan' ? 1.4 : U.rand(0.35, 0.9);
    }
    if (!S.queue.length && live === 0) {
      const bonus = 250 + S.wave * 100;
      S.score += bonus;
      HUD.banner('WAVE ' + S.wave + ' CLEAR', '+' + bonus + ' bonus · choose an upgrade');
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        dropPickup(S.player.x + Math.cos(a) * 5, S.player.z + Math.sin(a) * 5, i === 0 ? 'health' : 'ammo');
      }
      A.wave();
      enterUpgrade();
    }
  }

  // ── 7. HUD, menus, leaderboard ──────────────────────────────────────────
  const HUD = {
    el: {},
    init() {
      const ids = ['hud', 'hpFill', 'hpText', 'ammoText', 'weaponName', 'reloadBar', 'scoreVal', 'waveVal',
        'comboVal', 'minimap', 'hitmark', 'vignette', 'toast', 'toastTitle', 'toastSub', 'banner',
        'bannerTitle', 'bannerSub', 'abilityRing', 'abilityKey', 'screenTitle', 'screenPause',
        'screenOver', 'screenUpgrade', 'stScore', 'stWave', 'stKills', 'stAcc', 'stTime', 'stBest', 'lbList', 'nameInput',
        'btnSubmit', 'lbStatus', 'sensRange', 'qualitySel', 'btnMute', 'bestTitle', 'lockHint'];
      for (const id of ids) this.el[id] = $(id);
      this.e = this.el;
      this.mm = this.e.minimap ? this.e.minimap.getContext('2d') : null;
      if (this.mm) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.e.minimap.width = 148 * dpr;
        this.e.minimap.height = 148 * dpr;
        this.mm.scale(dpr, dpr);
      }
      this._toastTimer = 0;
      this._bannerTimer = 0;
      this._hitTimer = 0;
    },
    setScreen(name) {
      document.body.dataset.screen = name;
      const map = { title: this.e.screenTitle, pause: this.e.screenPause, over: this.e.screenOver, upgrade: this.e.screenUpgrade };
      for (const k of Object.keys(map)) if (map[k]) map[k].classList.toggle('show', name === k);
      if (this.e.hud) this.e.hud.classList.toggle('show', name === 'play' || name === 'pause');
    },
    toast(title, sub) {
      const t = this.e.toast;
      if (!t) return;
      this.e.toastTitle.textContent = title;
      this.e.toastSub.textContent = sub || '';
      t.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
    },
    banner(title, sub) {
      const b = this.e.banner;
      if (!b) return;
      this.e.bannerTitle.textContent = title;
      this.e.bannerSub.textContent = sub || '';
      b.classList.remove('show');
      void b.offsetWidth;
      b.classList.add('show');
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => b.classList.remove('show'), 2600);
    },
    hitmark(head) {
      const h = this.e.hitmark;
      if (!h) return;
      h.classList.toggle('head', !!head);
      h.classList.add('on');
      clearTimeout(this._hitTimer);
      this._hitTimer = setTimeout(() => h.classList.remove('on'), 130);
    },
    damage() {
      const v = this.e.vignette;
      if (!v) return;
      v.classList.remove('on');
      void v.offsetWidth;
      v.classList.add('on');
    },
    weaponFlash() {
      const w = this.e.weaponName;
      if (!w) return;
      w.classList.remove('flash');
      void w.offsetWidth;
      w.classList.add('flash');
    },
    sync() {
      const p = S.player;
      if (!p || !this.e.hpFill) return;
      const pct = Math.max(0, p.hp) / (p.maxHp || MAX_HP);
      this.e.hpFill.style.width = (pct * 100).toFixed(1) + '%';
      this.e.hpFill.classList.toggle('low', pct < 0.3);
      this.e.hpText.textContent = Math.ceil(Math.max(0, p.hp));

      const W = WEAPONS[p.weapon], slot = p.ammo[p.weapon];
      if (slot.reloadT > 0) {
        this.e.ammoText.textContent = 'RELOAD';
        this.e.reloadBar.style.width = ((1 - slot.reloadT / W.reload) * 100).toFixed(0) + '%';
        this.e.reloadBar.parentElement.classList.add('on');
      } else {
        this.e.ammoText.textContent = slot.mag + ' / ' + slot.reserve;
        this.e.reloadBar.parentElement.classList.remove('on');
      }
      this.e.weaponName.textContent = W.name;
      this.e.scoreVal.textContent = S.score.toLocaleString();
      this.e.waveVal.textContent = Math.max(1, S.wave);
      const mult = 1 + Math.min(8, Math.floor(S.combo / 5)) * 0.5;
      this.e.comboVal.textContent = S.combo > 1 ? 'x' + mult.toFixed(1) : '';
      this.e.comboVal.style.opacity = S.combo > 1 ? 1 : 0;
      if (this.e.abilityRing) {
        const ready = p.abilityCd <= 0;
        this.e.abilityRing.style.setProperty('--cd', ready ? '0%' : ((p.abilityCd / (p.abilityMax || 14)) * 100).toFixed(0) + '%');
        this.e.abilityRing.classList.toggle('ready', ready);
      }
      if (this.e.vignette) this.e.vignette.style.opacity = Math.min(0.85, S.flash).toFixed(2);
      if (this.e.lockHint) {
        const want = S.mode === 'play' && !I.locked && !I.isTouch && !p.dead;
        this.e.lockHint.classList.toggle('show', want);
      }
      // crosshair spread follows movement + recoil
      const spd = Math.hypot(p.vx, p.vz) / 8.6;
      const gap = 4 + spd * 8 + p.recoil * 8 + (p.aim ? -2 : 0);
      document.documentElement.style.setProperty('--ch-gap', Math.max(2, gap).toFixed(1) + 'px');
      this.minimap(p);
    },
    minimap(p) {
      const ctx = this.mm;
      if (!ctx) return;
      const S2 = 148, R2 = S2 / 2, k = R2 / ARENA;
      ctx.clearRect(0, 0, S2, S2);
      ctx.fillStyle = 'rgba(8,14,24,0.72)';
      ctx.beginPath(); ctx.arc(R2, R2, R2 - 2, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(R2, R2, R2 - 3, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(60,90,130,0.35)';
      for (const o of S.obstacles) {
        const w = (o.maxX - o.minX) * k, h = (o.maxZ - o.minZ) * k;
        ctx.fillRect(R2 + o.minX * k, R2 + o.minZ * k, w, h);
      }
      for (const kp of S.pickups) {
        ctx.fillStyle = kp.kind === 'health' ? '#4ade80' : kp.kind === 'ammo' ? '#fbbf24' : '#38bdf8';
        ctx.fillRect(R2 + kp.x * k - 1.5, R2 + kp.z * k - 1.5, 3, 3);
      }
      for (const e of S.enemies) {
        if (e.state === 'dead') continue;
        const T = ENEMY_TYPES[e.type];
        ctx.fillStyle = T.boss ? '#ff3b3b' : e.type === 'brute' ? '#e879f9' : e.type === 'drone' ? '#7dd3fc' : e.type === 'sentry' ? '#fdba74' : '#f87171';
        const rr = T.boss ? 4.5 : 2.2;
        ctx.beginPath(); ctx.arc(R2 + e.x * k, R2 + e.z * k, rr, 0, Math.PI * 2); ctx.fill();
      }
      // player arrow
      ctx.save();
      ctx.translate(R2 + p.x * k, R2 + p.z * k);
      ctx.rotate(-p.yaw);
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.restore();
      ctx.strokeStyle = 'rgba(125,211,252,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(R2, R2, R2 - 3, 0, Math.PI * 2); ctx.stroke();
    },
  };

  // Health bars are the only UI drawn inside the 3D pass; they are billboarded quads.
  const barBuf = new Float32Array(48 * 6 * 7);
  let barN = 0;
  function pushBar(cx, cy, cz, w, h, col, alpha) {
    if (barN + 6 > 48 * 6) return;
    const rx = R.camRight, up = R.camUp;
    const hw = w / 2, hh = h / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const order = [0, 1, 2, 0, 2, 3];
    for (const idx of order) {
      const c = corners[idx];
      const o = barN * 7;
      barBuf[o] = cx + rx[0] * c[0] + up[0] * c[1];
      barBuf[o + 1] = cy + rx[1] * c[0] + up[1] * c[1];
      barBuf[o + 2] = cz + rx[2] * c[0] + up[2] * c[1];
      barBuf[o + 3] = col[0]; barBuf[o + 4] = col[1]; barBuf[o + 5] = col[2]; barBuf[o + 6] = alpha;
      barN++;
    }
  }
  function drawBars() {
    barN = 0;
    for (const e of S.enemies) {
      if (e.state === 'dead' || e.state === 'spawn' || e.hp >= e.maxHp) continue;
      const y = e.y + e.height + 0.45;
      const w = Math.max(0.9, e.radius * 2.4);
      pushBar(e.x, y, e.z, w, 0.11, [0.02, 0.04, 0.07], 0.75);
      const frac = Math.max(0, e.hp / e.maxHp);
      const col = ENEMY_TYPES[e.type].boss ? [1, 0.25, 0.25] : [1, 0.55, 0.3];
      pushBar(e.x - (w * (1 - frac)) / 2, y, e.z, w * frac, 0.08, col, 0.95);
    }
    if (barN) R.raw(barBuf, barN, 'tri', false, 1);
  }

  // ── 8. Rendering, loop and boot ─────────────────────────────────────────
  function drawPlayer() {
    const p = S.player;
    const bobY = p.grounded ? Math.sin(p.bob * 2) * 0.04 : 0;
    const roll = p.grounded ? Math.sin(p.bob) * 0.03 * Math.min(1, Math.hypot(p.vx, p.vz) / 6) : 0;
    const lean = p.aim ? p.pitch * 0.35 : 0;
    M4.trs(tmpM, p.x, p.y + bobY, p.z, p.yaw, lean, roll, 1, 1, 1);
    const hurt = p.hurtT > 2.6;
    R.lit(MESH.player, tmpM, { tint: hurt ? [1.9, 0.75, 0.7] : [1, 1, 1] });
    R.shadow(MESH.player, tmpM, 0.4);
  }

  function drawEnemies() {
    for (const e of S.enemies) {
      if (e.state === 'dead') continue;
      let k = e.scale;
      if (e.state === 'spawn') {
        const t = 1 - Math.max(0, e.stateT) / 0.85;
        k *= 0.35 + t * 0.65;
      }
      const bob = ENEMY_TYPES[e.type].fly ? 0 : Math.abs(Math.sin(e.bobT * 4)) * 0.05;
      M4.trs(tmpM, e.x, e.y + bob, e.z, e.yaw, 0, 0, k, k, k);
      let tint = [1, 1, 1];
      if (e.hurtT > 0) tint = [2.4, 1.1, 1.05];
      else if (e.tel > 0) tint = [1.6, 1.4, 1.2];
      else if (e.stun > 0) tint = [0.8, 1.4, 1.6];
      R.lit(e.mesh, tmpM, { tint, emit: e.state === 'spawn' ? 2.5 : 1 });
      R.shadow(e.mesh, tmpM, ENEMY_TYPES[e.type].boss ? 0.55 : 0.38);
    }
  }

  function render() {
    R.resize();
    if (S.mode === 'title' || !S.cam) {
      const t = S.time * 0.16;
      S.cam = { eye: [Math.sin(t) * 31, 15, Math.cos(t) * 31], target: [0, 1.2, 0], fov: 62 };
    }
    R.begin(S.cam);
    R.lit(MESH.floor, window.TKE.IDENTITY, { grid: 1 });
    R.lit(MESH.pad, window.TKE.IDENTITY, {});
    R.lit(MESH.walls, window.TKE.IDENTITY, {});
    for (const pr of S.props) {
      R.lit(pr.mesh, pr.model, {});
      R.shadow(pr.mesh, pr.model, 0.34);
    }
    drawEnemies();
    if (S.mode !== 'title' && S.player && !S.player.dead) drawPlayer();

    for (const b of S.projectiles) {
      M4.trs(tmpM, b.x, b.y, b.z, S.time * 6, 0, 0, 1, 1, 1);
      R.lit(MESH.orb, tmpM, { tint: [(b.color[0] + 1) * 0.6, (b.color[1] + 0.4), (b.color[2] + 0.4)], emit: 2 });
    }
    for (const k of S.pickups) {
      const y = k.y + Math.sin(k.t * 2.4) * 0.12;
      const col = k.kind === 'health' ? [0.4, 1, 0.6] : k.kind === 'ammo' ? [1, 0.78, 0.3] : [0.4, 0.85, 1];
      M4.trs(tmpM, k.x, y, k.z, k.t * 1.8, 0, k.t, 1, 1, 1);
      R.lit(MESH.pickup, tmpM, { tint: col, emit: 2 });
    }
    drawBars();
    drawPlayerTrail();
    R.fx();
    R.end();
  }

  function drawPlayerTrail() {
    const p = S.player;
    if (!p || p.dashFx <= 0.01) return;
    const b = camBasis();
    for (let i = 0; i < 4; i++) {
      const y = p.y + 0.4 + i * 0.35;
      R.beams.add([p.x - p.dashDir[0] * 0.8, y, p.z - p.dashDir[1] * 0.8],
        [p.x + p.vx * -0.02, y, p.z + p.vz * -0.02], [0.4, 0.8, 1], 0.12, 0.18 * p.dashFx);
    }
    void b;
  }

  function update(dt) {
    S.run += dt;
    playerUpdate(dt);
    if (S.player.dead) { cameraUpdate(dt); return; }
    cameraUpdate(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateWave(dt);
    S.comboT -= dt;
    if (S.comboT <= 0) S.combo = 0;
    S.hitT = Math.max(0, S.hitT - dt);
    // idle map particles keep drifting while the menu is up
    if (Math.random() < dt * 6) {
      R.particles.spawn({
        x: U.rand(-ARENA, ARENA), y: U.rand(0.4, 5), z: U.rand(-ARENA, ARENA),
        vx: U.rand(-0.3, 0.3), vy: U.rand(0.1, 0.5), vz: U.rand(-0.3, 0.3),
        life: U.rand(1.5, 3), size: U.rand(0.4, 1.1), color: [0.3, 0.55, 0.95], gravity: -0.3, drag: 0.4,
      });
    }
  }

  let lastTs = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const raw = lastTs ? (ts - lastTs) / 1000 : 0.016;
    lastTs = ts;
    const dt = Math.min(0.05, Math.max(0.001, raw));
    S.time += dt;
    R.update(dt);
    if (S.mode === 'play') update(dt);
    S.flash = Math.max(0, S.flash - dt * 1.6);
    render();
    if (S.mode === 'play' || S.mode === 'pause') HUD.sync();
  }

  function startGame() {
    S.mode = 'play';
    resetRun();
    HUD.setScreen('play');
    cameraUpdate(0.016);
    if (A) { A.ensure(); A.startMusic(); }
    I.lock(document.getElementById('gl'));
    lastTs = 0;
  }

  function pauseGame() {
    if (S.mode !== 'play') return;
    S.mode = 'pause';
    HUD.setScreen('pause');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function resumeGame() {
    if (S.mode !== 'pause') return;
    S.mode = 'play';
    HUD.setScreen('play');
    if (A) A.ensure();
    I.lock(document.getElementById('gl'));
    lastTs = 0;
  }

  function quitToTitle() {
    S.mode = 'title';
    HUD.setScreen('title');
    if (A) A.stopMusic();
    if (document.pointerLockElement) document.exitPointerLock();
    if (HUD.e.bestTitle) HUD.e.bestTitle.textContent = S.best ? 'BEST ' + S.best.toLocaleString() : '';
    loadBoard();
  }

  function endRun() {
    S.mode = 'over';
    A.death();
    A.stopMusic();
    if (document.pointerLockElement) document.exitPointerLock();
    if (S.score > S.best) {
      S.best = S.score;
      try { localStorage.setItem('tukuk-strike-best', String(S.best)); } catch (e) { /* private mode */ }
    }
    const acc = S.shots ? Math.round((S.hits / S.shots) * 100) : 0;
    const set = (k, v) => { if (HUD.e[k]) HUD.e[k].textContent = v; };
    set('stScore', S.score.toLocaleString());
    set('stWave', S.wave);
    set('stKills', S.kills);
    set('stAcc', acc + '%');
    set('stTime', Math.floor(S.run / 60) + ':' + String(Math.floor(S.run % 60)).padStart(2, '0'));
    set('stBest', S.best.toLocaleString());
    if (HUD.e.lbStatus) HUD.e.lbStatus.textContent = '';
    HUD.setScreen('over');
    HUD.sync();
  }

  // ── Between-wave upgrades ────────────────────────────────────
  // Freezes the run (mode 'upgrade' => update() is skipped, render stays), shows three
  // perk cards, and resumes toward the next wave once one is chosen. If the overlay DOM
  // is missing it falls back to a short auto-countdown, so a wave can never soft-lock.
  function pickOffers(k) {
    const pool = PERKS.slice();
    const out = [];
    for (let i = 0; i < k && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }
  function renderUpgrades() {
    const row = $('perkRow');
    if (!row) return;
    row.innerHTML = '';
    S.offers.forEach((perk, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'perkcard';
      card.dataset.perk = String(i);
      const num = document.createElement('span'); num.className = 'perknum'; num.textContent = String(i + 1);
      const nm = document.createElement('span'); nm.className = 'perkname'; nm.textContent = perk.name;
      const ds = document.createElement('span'); ds.className = 'perkdesc'; ds.textContent = perk.desc;
      card.appendChild(num); card.appendChild(nm); card.appendChild(ds);
      row.appendChild(card);
    });
    const wt = $('upgradeWave');
    if (wt) wt.textContent = 'WAVE ' + S.wave + ' CLEARED';
  }
  function enterUpgrade() {
    if (!$('perkRow')) { S.wavePhase = 'clear'; S.waveT = 1.6; return; } // no overlay: keep the old auto-advance
    S.mode = 'upgrade';
    S.offers = pickOffers(3);
    renderUpgrades();
    HUD.setScreen('upgrade');
    if (document.pointerLockElement) document.exitPointerLock();
    A.ui();
  }
  function choosePerk(i) {
    if (S.mode !== 'upgrade') return;
    const perk = S.offers[i];
    try { if (perk) perk.apply(S.mods, S.player); } catch (err) { /* one bad perk must not stall the run */ }
    if (A && A.upgrade) A.upgrade();
    S.offers = [];
    S.mode = 'play';
    HUD.setScreen('play');
    S.wavePhase = 'idle';
    S.waveT = 1.4;
    lastTs = 0;
    const canvas = $('gl');
    if (canvas && I) I.lock(canvas);
  }

  // ── Leaderboard (the site's own /api/score, no account needed) ───────────
  function renderBoard(items) {
    if (!HUD.e.lbList) return;
    if (!items || !items.length) {
      HUD.e.lbList.innerHTML = '<li class="lbempty">No scores yet — be the first.</li>';
      return;
    }
    HUD.e.lbList.innerHTML = items.map((it, i) =>
      '<li><span class="lbr">' + (i + 1) + '</span><span class="lbn">' + escapeHtml(it.n) +
      '</span><span class="lbs">' + Number(it.s).toLocaleString() + '</span></li>').join('');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function loadBoard() {
    if (!HUD.e.lbList) return;
    fetch('/api/scores?g=' + LB_GAME + '&limit=5', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => renderBoard(d && d.items))
      .catch(() => { if (HUD.e.lbList) HUD.e.lbList.innerHTML = '<li class="lbempty">Leaderboard offline — your run still counts.</li>'; });
  }
  function submitScore() {
    if (S.submitted) return;
    const input = HUD.e.nameInput;
    const name = String((input && input.value) || localStorage.getItem('tukuk-strike-name') || 'Anon').trim().slice(0, 20) || 'Anon';
    try { localStorage.setItem('tukuk-strike-name', name); } catch (e) { /* ignore */ }
    S.submitted = true;
    if (HUD.e.btnSubmit) HUD.e.btnSubmit.disabled = true;
    if (HUD.e.lbStatus) HUD.e.lbStatus.textContent = 'Sending…';
    fetch('/api/score?g=' + LB_GAME + '&n=' + encodeURIComponent(name) + '&s=' + Math.round(S.score))
      .then((r) => r.json())
      .then(() => { if (HUD.e.lbStatus) HUD.e.lbStatus.textContent = 'Score saved. Terima kasih!'; loadBoard(); })
      .catch(() => { if (HUD.e.lbStatus) HUD.e.lbStatus.textContent = 'Offline — score kept on this device.'; });
  }

  // ── Settings + wiring ───────────────────────────────────────────────────
  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem('tukuk-strike-settings') || '{}');
      if (raw.sens) I.sensitivity = U.clamp(Number(raw.sens), 0.25, 3);
      if (raw.quality !== undefined) S.quality = U.clamp(Number(raw.quality), 0, 2);
      if (raw.muted) { S.muted = true; A.setMuted(true); }
      if (raw.diff && DIFFS[raw.diff]) S.diff = raw.diff;
      S.best = Number(localStorage.getItem('tukuk-strike-best') || 0) || 0;
    } catch (e) { /* ignore */ }
    document.body.dataset.diff = S.diff;
    if (HUD.e.sensRange) HUD.e.sensRange.value = String(I.sensitivity);
    if (HUD.e.qualitySel) HUD.e.qualitySel.value = String(S.quality);
    if (HUD.e.btnMute) HUD.e.btnMute.textContent = S.muted ? 'Sound off' : 'Sound on';
    R.setQuality(S.quality);
  }
  function saveSettings() {
    try {
      localStorage.setItem('tukuk-strike-settings', JSON.stringify({ sens: I.sensitivity, quality: S.quality, muted: S.muted, diff: S.diff }));
    } catch (e) { /* ignore */ }
  }

  function wireUI() {
    const canvas = $('gl');
    const on = (id, ev, fn) => { const n = $(id); if (n) n.addEventListener(ev, fn); };
    on('btnPlay', 'click', () => { A.ensure(); A.ui(); startGame(); });
    on('btnResume', 'click', () => { A.ui(); resumeGame(); });
    on('btnRestart', 'click', () => { A.ui(); startGame(); });
    on('btnRestart2', 'click', () => { A.ui(); startGame(); });
    on('btnPauseTouch', 'click', () => { pauseGame(); });
    on('btnQuit', 'click', () => { A.ui(); quitToTitle(); });
    on('btnPauseQuit', 'click', () => { A.ui(); quitToTitle(); });
    on('btnSubmit', 'click', submitScore);
    on('btnMute', 'click', () => {
      S.muted = !S.muted;
      A.setMuted(S.muted);
      if (HUD.e.btnMute) HUD.e.btnMute.textContent = S.muted ? 'Sound off' : 'Sound on';
      saveSettings();
    });
    on('btnFullscreen', 'click', () => {
      const el = document.documentElement;
      if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen(); }
      else if (document.exitFullscreen) document.exitFullscreen();
    });
    on('sensRange', 'input', (e) => { I.sensitivity = Number(e.target.value) || 1; saveSettings(); });
    on('qualitySel', 'change', (e) => { S.quality = Number(e.target.value) || 0; R.setQuality(S.quality); saveSettings(); });
    on('btnHowTo', 'click', () => { const p = $('howTo'); if (p) p.classList.toggle('show'); });
    on('howToClose', 'click', () => { const p = $('howTo'); if (p) p.classList.remove('show'); });
    I.onLockRequest = () => I.lock(canvas);

    // Difficulty picker on the title — the chosen tier persists and drives the run.
    const setDiff = (id) => {
      if (!DIFFS[id]) return;
      S.diff = id;
      document.body.dataset.diff = id;
      saveSettings();
      if (A) A.ui();
    };
    DIFF_ORDER.forEach((id) => {
      const b = $('btnDiff' + id.charAt(0).toUpperCase() + id.slice(1));
      if (b) b.addEventListener('click', () => setDiff(id));
    });

    // Perk cards are built dynamically, so one delegated listener covers all three.
    const perkRow = $('perkRow');
    if (perkRow) perkRow.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-perk]') : null;
      if (btn) choosePerk(Number(btn.dataset.perk));
    });

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (S.mode === 'play') pauseGame();
        else if (S.mode === 'pause') resumeGame();
      }
      if (e.code === 'KeyP' && (S.mode === 'play' || S.mode === 'pause')) {
        if (S.mode === 'play') pauseGame(); else resumeGame();
      }
      if (S.mode === 'play') {
        if (e.code === 'Digit1') selectWeapon(0);
        else if (e.code === 'Digit2') selectWeapon(1);
        else if (e.code === 'Digit3') selectWeapon(2);
      } else if (S.mode === 'upgrade') {
        if (e.code === 'Digit1') choosePerk(0);
        else if (e.code === 'Digit2') choosePerk(1);
        else if (e.code === 'Digit3') choosePerk(2);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && S.mode === 'play') pauseGame();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && S.mode === 'play') pauseGame();
    });
    addEventListener('resize', () => { R.resize(); });
    canvas.addEventListener('click', () => { if (S.mode === 'play') I.lock(canvas); });

    // ── touch controls ──
    if (I.isTouch) {
      document.body.classList.add('touch');
      wireTouch();
    }
  }

  function wireTouch() {
    const stickZone = $('stickZone'), knob = $('stickKnob'), lookZone = $('lookZone');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const RMAX = 52;
    if (stickZone && knob) {
      stickZone.addEventListener('pointerdown', (e) => {
        stickId = e.pointerId;
        const r = stickZone.getBoundingClientRect();
        sx = r.left + r.width / 2; sy = r.top + r.height / 2;
        stickZone.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      stickZone.addEventListener('pointermove', (e) => {
        if (e.pointerId !== stickId) return;
        let dx = e.clientX - sx, dy = e.clientY - sy;
        const len = Math.hypot(dx, dy) || 1;
        if (len > RMAX) { dx = (dx / len) * RMAX; dy = (dy / len) * RMAX; }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        I.touchMove = [dx / RMAX, -dy / RMAX];
        e.preventDefault();
      });
      const endStick = (e) => {
        if (e.pointerId !== stickId) return;
        stickId = null; I.touchMove = [0, 0];
        knob.style.transform = 'translate(0,0)';
      };
      stickZone.addEventListener('pointerup', endStick);
      stickZone.addEventListener('pointercancel', endStick);
    }
    if (lookZone) {
      lookZone.addEventListener('pointerdown', (e) => {
        lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
        lookZone.setPointerCapture(e.pointerId);
      });
      lookZone.addEventListener('pointermove', (e) => {
        if (e.pointerId !== lookId) return;
        I.lookX += (e.clientX - lx) * 0.0045 * I.sensitivity;
        I.lookY += (e.clientY - ly) * 0.0045 * I.sensitivity;
        lx = e.clientX; ly = e.clientY;
      });
      const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
      lookZone.addEventListener('pointerup', endLook);
      lookZone.addEventListener('pointercancel', endLook);
    }
    const hold = (id, onDown, onUp) => {
      const n = $(id);
      if (!n) return;
      n.addEventListener('pointerdown', (e) => { n.classList.add('down'); onDown(); e.preventDefault(); });
      const up = () => { n.classList.remove('down'); if (onUp) onUp(); };
      n.addEventListener('pointerup', up);
      n.addEventListener('pointercancel', up);
      n.addEventListener('pointerleave', up);
    };
    hold('tbFire', () => { I.touchFire = true; }, () => { I.touchFire = false; });
    hold('tbJump', () => { I.jump = true; });
    hold('tbDash', () => { I.dash = true; });
    hold('tbAbility', () => { I.ability = true; });
    hold('tbReload', () => { I.reload = true; });
    hold('tbSwap', () => { I.switchWeapon = true; });
    const aim = $('tbAim');
    if (aim) aim.addEventListener('click', () => { I.aim = !I.aim; aim.classList.toggle('on', I.aim); });
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  function boot() {
    const canvas = $('gl');
    const fail = (msg) => {
      const box = $('bootError');
      if (box) { box.textContent = msg; box.classList.add('show'); }
    };
    try {
      R = new Renderer(canvas);
    } catch (err) {
      fail('This browser cannot start WebGL, so the arena cannot render. Try Chrome, Firefox or Edge with hardware acceleration on.');
      return;
    }
    I = new Input(canvas);
    A = new Audio();
    makeMeshes();
    buildLevel();
    S.player = newPlayer();
    cameraUpdate(0.016);
    HUD.init();
    loadSettings();
    wireUI();
    HUD.setScreen('title');
    if (HUD.e.bestTitle) HUD.e.bestTitle.textContent = S.best ? 'BEST ' + S.best.toLocaleString() : '';
    if (HUD.e.nameInput) {
      try { HUD.e.nameInput.value = localStorage.getItem('tukuk-strike-name') || ''; } catch (e) { /* ignore */ }
    }
    loadBoard();
    // A small handle for debugging and for embeds that want to know the run state.
    window.TukukStrike = { state: S, input: I, audio: A, renderer: R };
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
