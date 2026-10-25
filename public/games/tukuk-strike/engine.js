/* Tukuk Strike — engine.js
 * A small WebGL1 renderer written for tukuk.org's arcade: no libraries, no CDN,
 * no textures — geometry, lighting and sound are all generated in the browser so
 * the game boots offline and in a single page load.
 *
 * Responsibilities:
 *   M4        — column-major matrix helpers (perspective/lookAt/TRS/normal)
 *   Builder   — merges boxes, cylinders and spheres into one vertex buffer
 *   Renderer  — lit pass, planar projected shadows, additive FX, particles, beams
 *   Input     — keyboard/mouse (pointer lock) state, consumed by game.js
 *   Audio     — WebAudio synth SFX + a procedural ambient bed
 */
(function (root) {
  'use strict';

  // ── Small helpers ───────────────────────────────────────────────────────
  const U = {
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    rand(a, b) { return a + Math.random() * (b - a); },
    randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    damp(a, b, l, dt) { return U.lerp(a, b, 1 - Math.exp(-l * dt)); },
    norm(x, y, z) { const d = Math.hypot(x, y, z) || 1; return [x / d, y / d, z / d]; },
    dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; },
    // short angle interpolation, used by the camera & enemy turning
    angDamp(a, b, l, dt) {
      let d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * (1 - Math.exp(-l * dt));
    },
  };

  // ── Matrices ────────────────────────────────────────────────────────────
  const M4 = {
    create() { return new Float32Array(16); },
    identity(o) {
      o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
      o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
      return o;
    },
    mul(o, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
        o[i * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
        o[i * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
        o[i * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
      }
      return o;
    },
    perspective(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      o.fill(0);
      o[0] = f / aspect;
      o[5] = f;
      o[10] = (far + near) / (near - far);
      o[11] = -1;
      o[14] = (2 * far * near) / (near - far);
      return o;
    },
    lookAt(o, eye, target, up) {
      let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
      let d = Math.hypot(zx, zy, zz) || 1; zx /= d; zy /= d; zz /= d;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      d = Math.hypot(xx, xy, xz) || 1; xx /= d; xy /= d; xz /= d;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      o[15] = 1;
      return o;
    },
    // translate * Ry * Rx * Rz * scale
    trs(o, x, y, z, yaw, pitch, roll, sx, sy, sz) {
      const cy = Math.cos(yaw || 0), sy2 = Math.sin(yaw || 0);
      const cx = Math.cos(pitch || 0), sx2 = Math.sin(pitch || 0);
      const cz = Math.cos(roll || 0), sz2 = Math.sin(roll || 0);
      // rows of Ry * Rx * Rz
      const r00 = cy * cz + sy2 * sx2 * sz2;
      const r01 = -cy * sz2 + sy2 * sx2 * cz;
      const r02 = sy2 * cx;
      const r10 = cx * sz2;
      const r11 = cx * cz;
      const r12 = -sx2;
      const r20 = -sy2 * cz + cy * sx2 * sz2;
      const r21 = sy2 * sz2 + cy * sx2 * cz;
      const r22 = cy * cx;
      const kx = sx === undefined ? 1 : sx, ky = sy === undefined ? 1 : sy, kz = sz === undefined ? 1 : sz;
      o[0] = r00 * kx; o[1] = r10 * kx; o[2] = r20 * kx; o[3] = 0;
      o[4] = r01 * ky; o[5] = r11 * ky; o[6] = r21 * ky; o[7] = 0;
      o[8] = r02 * kz; o[9] = r12 * kz; o[10] = r22 * kz; o[11] = 0;
      o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
      return o;
    },
    scale(o, x, y, z) { return M4.trs(o, 0, 0, 0, 0, 0, 0, x, y, z); },
    // inverse-transpose of the upper 3x3, written as a mat3 (column-major)
    normalMat3(o, m) {
      const a = m[0], b = m[1], c = m[2];
      const d = m[4], e = m[5], f = m[6];
      const g = m[8], h = m[9], i = m[10];
      const C00 = e * i - f * h, C01 = -(d * i - f * g), C02 = d * h - e * g;
      const det = a * C00 + b * C01 + c * C02;
      if (!det) { o[0] = o[4] = o[8] = 1; o[1] = o[2] = o[3] = o[5] = o[6] = o[7] = 0; return o; }
      const id = 1 / det;
      // inverse = adj / det, then transpose → store transposed directly
      o[0] = C00 * id; o[1] = C01 * id; o[2] = C02 * id;
      o[3] = -(b * i - c * h) * id;
      o[4] = (a * i - c * g) * id;
      o[5] = -(a * h - b * g) * id;
      o[6] = (b * f - c * e) * id;
      o[7] = -(a * f - c * d) * id;
      o[8] = (a * e - b * d) * id;
      return o;
    },
  };

  // ── Geometry builder ────────────────────────────────────────────────────
  // Vertex layout: pos(3) normal(3) colour(4)  — colour.a doubles as an emission
  // factor (1 = fully self-lit), so glowing parts cost nothing extra.
  function Builder() {
    this.v = [];
    this.i = [];
    this.n = 0;
  }
  Builder.prototype.vert = function (px, py, pz, nx, ny, nz, c, emit) {
    this.v.push(px, py, pz, nx, ny, nz, c[0], c[1], c[2], emit || 0);
    return this.n++;
  };
  Builder.prototype.quad = function (a, b, c, d) { this.i.push(a, b, c, a, c, d); };

  // A box with its own baked rotation around Y. `col` is [r,g,b], `emit` 0..1.
  Builder.prototype.box = function (cx, cy, cz, sx, sy, sz, col, emit, yaw) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const co = Math.cos(yaw || 0), si = Math.sin(yaw || 0);
    const P = (x, y, z) => [cx + x * co + z * si, cy + y, cz - x * si + z * co];
    const N = (x, y, z) => [x * co + z * si, y, -x * si + z * co];
    const faces = [
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1]],
      [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0]],
      [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0]],
      [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0]],
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]],
    ];
    for (let f = 0; f < 6; f++) {
      const F = faces[f], n = N(F[4][0], F[4][1], F[4][2]);
      const base = this.n;
      for (let k = 0; k < 4; k++) {
        const p = P(F[k][0], F[k][1], F[k][2]);
        this.vert(p[0], p[1], p[2], n[0], n[1], n[2], col, emit);
      }
      this.quad(base, base + 1, base + 2, base + 3);
    }
    return this;
  };

  Builder.prototype.cyl = function (cx, cy, cz, rTop, rBot, h, seg, col, emit) {
    const half = h / 2, step = (Math.PI * 2) / seg;
    for (let s = 0; s < seg; s++) {
      const a0 = s * step, a1 = (s + 1) * step;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const nx0 = c0, nz0 = s0, nx1 = c1, nz1 = s1;
      const b0 = this.n;
      this.vert(cx + c0 * rBot, cy - half, cz + s0 * rBot, nx0, 0, nz0, col, emit);
      this.vert(cx + c1 * rBot, cy - half, cz + s1 * rBot, nx1, 0, nz1, col, emit);
      this.vert(cx + c1 * rTop, cy + half, cz + s1 * rTop, nx1, 0, nz1, col, emit);
      this.vert(cx + c0 * rTop, cy + half, cz + s0 * rTop, nx0, 0, nz0, col, emit);
      this.quad(b0, b0 + 1, b0 + 2, b0 + 3);
      if (rTop > 0.001) { // top cap
        const t = this.n;
        this.vert(cx, cy + half, cz, 0, 1, 0, col, emit);
        this.vert(cx + c0 * rTop, cy + half, cz + s0 * rTop, 0, 1, 0, col, emit);
        this.vert(cx + c1 * rTop, cy + half, cz + s1 * rTop, 0, 1, 0, col, emit);
        this.i.push(t, t + 1, t + 2);
      }
      if (rBot > 0.001) { // bottom cap
        const b = this.n;
        this.vert(cx, cy - half, cz, 0, -1, 0, col, emit);
        this.vert(cx + c1 * rBot, cy - half, cz + s1 * rBot, 0, -1, 0, col, emit);
        this.vert(cx + c0 * rBot, cy - half, cz + s0 * rBot, 0, -1, 0, col, emit);
        this.i.push(b, b + 1, b + 2);
      }
    }
    return this;
  };

  Builder.prototype.sphere = function (cx, cy, cz, r, seg, ring, col, emit) {
    for (let j = 0; j < ring; j++) {
      const p0 = (j / ring) * Math.PI - Math.PI / 2;
      const p1 = ((j + 1) / ring) * Math.PI - Math.PI / 2;
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
        const pts = [[p0, a0], [p0, a1], [p1, a1], [p1, a0]];
        const base = this.n;
        for (const [pp, aa] of pts) {
          const x = Math.cos(pp) * Math.cos(aa), y = Math.sin(pp), z = Math.cos(pp) * Math.sin(aa);
          this.vert(cx + x * r, cy + y * r, cz + z * r, x, y, z, col, emit);
        }
        this.quad(base, base + 1, base + 2, base + 3);
      }
    }
    return this;
  };

  // A flat XZ quad (used for the arena floor and glow decals).
  Builder.prototype.plane = function (cx, cy, cz, sx, sz, col, emit) {
    const hx = sx / 2, hz = sz / 2;
    const b = this.n;
    this.vert(cx - hx, cy, cz - hz, 0, 1, 0, col, emit);
    this.vert(cx + hx, cy, cz - hz, 0, 1, 0, col, emit);
    this.vert(cx + hx, cy, cz + hz, 0, 1, 0, col, emit);
    this.vert(cx - hx, cy, cz + hz, 0, 1, 0, col, emit);
    this.quad(b, b + 1, b + 2, b + 3);
    return this;
  };

  Builder.prototype.translate = function (dx, dy, dz) {
    for (let k = 0; k < this.v.length; k += 10) { this.v[k] += dx; this.v[k + 1] += dy; this.v[k + 2] += dz; }
    return this;
  };

  // ── Shaders ─────────────────────────────────────────────────────────────
  const VS_LIT = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol;
uniform mat4 uProj, uView, uModel;
uniform mat3 uNrmMat;
varying vec3 vNrm; varying vec3 vCol; varying float vEmit; varying vec3 vWorld;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorld = wp.xyz;
  vNrm = uNrmMat * aNrm;
  vCol = aCol.rgb;
  vEmit = aCol.a;
  gl_Position = uProj * uView * wp;
}`;

  const FS_LIT = `
precision mediump float;
uniform vec3 uLightDir, uAmbient, uFogColor, uCamPos, uTint;
uniform float uEmitMul, uFogDensity, uGrid, uTime, uAlpha;
varying vec3 vNrm; varying vec3 vCol; varying float vEmit; varying vec3 vWorld;
void main() {
  vec3 n = normalize(vNrm);
  float diff = max(dot(n, -uLightDir), 0.0);
  vec3 base = vCol * uTint;
  vec3 col = base * (uAmbient + diff * 0.85);
  // cool bounce light from the opposite side keeps unlit faces readable
  col += base * max(dot(n, uLightDir), 0.0) * 0.18;
  vec3 V = normalize(uCamPos - vWorld);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.35;
  col += rim * base;
  col += base * vEmit * uEmitMul;
  if (uGrid > 0.5) {
    vec2 p = vWorld.xz;
    vec2 f = fract(p * 0.5);
    vec2 d = min(f, 1.0 - f) * 2.0;
    float line = 1.0 - smoothstep(0.0, 0.045, min(d.x, d.y));
    vec2 f8 = fract(p / 8.0);
    vec2 d8 = min(f8, 1.0 - f8) * 8.0;
    float main8 = 1.0 - smoothstep(0.0, 0.09, min(d8.x, d8.y));
    vec2 f4 = fract(p / 4.0);
    vec2 d4 = min(f4, 1.0 - f4) * 4.0;
    float main4 = 1.0 - smoothstep(0.0, 0.055, min(d4.x, d4.y));
    float pulse = 0.55 + 0.45 * sin(uTime * 1.6 + p.x * 0.05 + p.y * 0.05);
    col = mix(col, vec3(0.10, 0.24, 0.45), line * 0.55);
    col = mix(col, vec3(0.16, 0.34, 0.62), main4 * 0.35);
    col += vec3(0.10, 0.42, 0.95) * main8 * pulse * 0.55;
  }
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.94));
  gl_FragColor = vec4(col, uAlpha);
}`;

  const VS_SHADOW = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol;
uniform mat4 uProj, uView, uModel;
uniform vec3 uLight;
varying float vA;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  float t = wp.y / max(-uLight.y, 0.0001);
  vec3 sp = wp.xyz + uLight * t;
  sp.y = 0.015;
  vA = clamp(1.0 - t * 0.22, 0.08, 1.0);
  gl_Position = uProj * uView * vec4(sp, 1.0);
}`;

  const FS_SHADOW = `
precision mediump float;
uniform float uAlpha;
varying float vA;
void main() { gl_FragColor = vec4(0.0, 0.02, 0.06, vA * uAlpha); }`;

  const VS_UNLIT = `
attribute vec3 aPos; attribute vec4 aCol;
uniform mat4 uProj, uView, uModel;
varying vec4 vCol;
void main() { vCol = aCol; gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }`;

  const FS_UNLIT = `
precision mediump float;
uniform float uAlpha;
varying vec4 vCol;
void main() { gl_FragColor = vec4(vCol.rgb, vCol.a * uAlpha); }`;

  const VS_POINT = `
attribute vec3 aPos; attribute vec4 aCol;
uniform mat4 uProj, uView;
uniform float uScale;
varying vec4 vCol;
void main() {
  vec4 vp = uView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = max(1.0, aCol.a * uScale / max(1.0, -vp.z));
  vCol = vec4(aCol.rgb, 1.0);
}`;

  const FS_POINT = `
precision mediump float;
uniform float uAlpha;
varying vec4 vCol;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = (1.0 - smoothstep(0.12, 0.5, r)) * uAlpha;
  gl_FragColor = vec4(vCol.rgb, a);
}`;

  const VS_SKY = `
attribute vec2 aPos;
varying vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FS_SKY = `
precision mediump float;
uniform vec3 uTop, uBottom, uGlow;
uniform float uAspect, uTime;
varying vec2 vUV;
void main() {
  float h = clamp(vUV.y, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.85));
  // horizon glow, slightly off-centre so the arena has a light source direction
  vec2 c = vec2(0.62, 0.34);
  vec2 p = (vUV - c) * vec2(uAspect, 1.0);
  float g = exp(-dot(p, p) * 7.0);
  col += uGlow * g * 0.55;
  float band = pow(1.0 - abs(vUV.y - 0.5) * 2.0, 6.0) * 0.05;
  col += vec3(0.2, 0.45, 0.9) * band;
  gl_FragColor = vec4(col, 1.0);
}`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader: ' + log);
    }
    return sh;
  }

  function program(gl, vs, fs, attrs, unis) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const o = { prog: p, a: {}, u: {} };
    for (const a of attrs) o.a[a] = gl.getAttribLocation(p, a);
    for (const u of unis) o.u[u] = gl.getUniformLocation(p, u);
    return o;
  }

  // ── Particles ───────────────────────────────────────────────────────────
  function ParticleSystem(max) {
    this.max = max || 1400;
    this.list = [];
    this.buf = new Float32Array(this.max * 7);
    this.count = 0;
    this.quality = 1;
  }
  // o: {x,y,z, vx,vy,vz, life, size, color:[r,g,b], gravity, drag, fade}
  ParticleSystem.prototype.spawn = function (o) {
    if (this.list.length >= Math.floor(this.max * this.quality)) return;
    this.list.push({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      age: 0, life: o.life || 0.6, size: o.size || 12,
      r: o.color ? o.color[0] : 1, g: o.color ? o.color[1] : 1, b: o.color ? o.color[2] : 1,
      gravity: o.gravity === undefined ? 0 : o.gravity,
      drag: o.drag === undefined ? 1.2 : o.drag,
    });
  };
  ParticleSystem.prototype.burst = function (x, y, z, n, opt) {
    const o = opt || {};
    const spd = o.speed || 6;
    for (let i = 0; i < n * this.quality; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const s = spd * (0.35 + Math.random() * 0.9);
      this.spawn({
        x, y, z,
        vx: Math.cos(a) * s * (1 - up * 0.5),
        vy: (o.up === undefined ? 0.7 : o.up) * s * up,
        vz: Math.sin(a) * s * (1 - up * 0.5),
        life: U.rand(0.25, 0.75) * (o.life || 1),
        size: U.rand(6, 16) * (o.size || 1),
        color: o.color || [1, 0.75, 0.3],
        gravity: o.gravity === undefined ? 12 : o.gravity,
        drag: o.drag === undefined ? 2.2 : o.drag,
      });
    }
  };
  ParticleSystem.prototype.update = function (dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) { L.splice(i, 1); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
    }
  };
  ParticleSystem.prototype.fill = function () {
    const b = this.buf;
    let n = 0;
    for (let i = 0; i < this.list.length && n < this.max; i++) {
      const p = this.list[i];
      const t = p.age / p.life;
      const fade = 1 - t;
      const k = n * 7;
      b[k] = p.x; b[k + 1] = p.y; b[k + 2] = p.z;
      b[k + 3] = p.r * (0.4 + fade * 0.6);
      b[k + 4] = p.g * (0.4 + fade * 0.6);
      b[k + 5] = p.b * (0.4 + fade * 0.6);
      b[k + 6] = p.size * (0.5 + fade * 4);
      n++;
    }
    this.count = n;
    return n;
  };

  // ── Beams (tracers, laser sights, shock rings) ───────────────────────────
  function BeamSystem(max) {
    this.max = max || 256;
    this.list = [];
    this.buf = new Float32Array(this.max * 6 * 7);
    this.verts = 0;
  }
  BeamSystem.prototype.add = function (a, b, color, life, width) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], color: color || [1, 0.6, 0.2], life: life || 0.09, age: 0, width: width || 0.05 });
  };
  BeamSystem.prototype.update = function (dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      this.list[i].age += dt;
      if (this.list[i].age >= this.list[i].life) this.list.splice(i, 1);
    }
  };
  // Builds camera-facing quads so thin beams stay visible from any angle.
  BeamSystem.prototype.build = function (camRight, camUp) {
    const b = this.buf;
    let n = 0;
    for (const L of this.list) {
      const fade = 1 - L.age / L.life;
      let dx = L.bx - L.ax, dy = L.by - L.ay, dz = L.bz - L.az;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      // side vector = cross(dir, viewDir) approximated with the camera basis
      let sx = dy * camUp[2] - dz * camUp[1];
      let sy = dz * camUp[0] - dx * camUp[2];
      let sz = dx * camUp[1] - dy * camUp[0];
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = L.width * (0.6 + fade * 0.8) / sl;
      sx *= w; sy *= w; sz *= w;
      const col = L.color;
      const a = 0.15 + fade * 0.85;
      const pts = [
        [L.ax - sx, L.ay - sy, L.az - sz], [L.ax + sx, L.ay + sy, L.az + sz],
        [L.bx + sx, L.by + sy, L.bz + sz], [L.bx - sx, L.by - sy, L.bz - sz],
      ];
      const order = [0, 1, 2, 0, 2, 3];
      for (const k of order) {
        if (n >= this.max) break;
        const p = pts[k], o = n * 7;
        b[o] = p[0]; b[o + 1] = p[1]; b[o + 2] = p[2];
        b[o + 3] = col[0]; b[o + 4] = col[1]; b[o + 5] = col[2]; b[o + 6] = a;
        n++;
      }
    }
    this.verts = n;
    return n;
  };

  // ── Renderer ────────────────────────────────────────────────────────────
  function Renderer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' })
      || canvas.getContext('experimental-webgl', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL is not available in this browser');

    this.gl = gl;
    this.canvas = canvas;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.quality = 1;
    this.shadowsOn = true;
    this.time = 0;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // Generated geometry has no consistent winding, so culling is off: the arena
    // is small enough that the extra fill does not show up in the frame budget.
    gl.disable(gl.CULL_FACE);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.03, 0.05, 0.09, 1);

    this.pLit = program(gl, VS_LIT, FS_LIT,
      ['aPos', 'aNrm', 'aCol'],
      ['uProj', 'uView', 'uModel', 'uNrmMat', 'uLightDir', 'uAmbient', 'uFogColor', 'uCamPos',
        'uTint', 'uEmitMul', 'uFogDensity', 'uGrid', 'uTime', 'uAlpha']);
    this.pShadow = program(gl, VS_SHADOW, FS_SHADOW,
      ['aPos', 'aNrm', 'aCol'], ['uProj', 'uView', 'uModel', 'uLight', 'uAlpha']);
    this.pUnlit = program(gl, VS_UNLIT, FS_UNLIT, ['aPos', 'aCol'], ['uProj', 'uView', 'uModel', 'uAlpha']);
    this.pPoint = program(gl, VS_POINT, FS_POINT, ['aPos', 'aCol'], ['uProj', 'uView', 'uScale', 'uAlpha']);
    this.pSky = program(gl, VS_SKY, FS_SKY, ['aPos'], ['uTop', 'uBottom', 'uGlow', 'uAspect', 'uTime']);

    this.proj = M4.create();
    this.view = M4.create();
    this.nrm = new Float32Array(9);
    this.camPos = [0, 0, 0];
    this.camRight = [1, 0, 0];
    this.camUp = [0, 1, 0];
    this.light = U.norm(-0.42, -1, -0.32);
    this.ambient = [0.44, 0.52, 0.64];
    this.fogColor = [0.035, 0.06, 0.105];
    this.fogDensity = 0.013;
    this.skyTop = [0.03, 0.06, 0.13];
    this.skyBottom = [0.07, 0.13, 0.22];
    this.skyGlow = [0.25, 0.5, 0.95];

    this.particles = new ParticleSystem(1600);
    this.beams = new BeamSystem(280);

    // full-screen sky triangle pair
    this.skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.dynamic = gl.createBuffer();
    this.dynamicCap = 0;
    this.dynamicProgram = null;
  }

  Renderer.prototype.resize = function () {
    const c = this.canvas;
    const dpr = Math.min(root.devicePixelRatio || 1, this.quality >= 1 ? 2 : 1.25);
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (w === c.width && h === c.height) return false;
    c.width = w; c.height = h;
    this.width = w; this.height = h; this.dpr = dpr;
    this.gl.viewport(0, 0, w, h);
    return true;
  };

  Renderer.prototype.setQuality = function (q) {
    // q: 0 = battery saver, 1 = balanced, 2 = high
    this.quality = q;
    this.particles.quality = q === 0 ? 0.35 : q === 1 ? 0.7 : 1;
    this.shadowsOn = q > 0;
  };

  Renderer.prototype.mesh = function (builder) {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.v), gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(builder.i), gl.STATIC_DRAW);
    return { vbo, ibo, count: builder.i.length };
  };

  Renderer.prototype.begin = function (cam) {
    const gl = this.gl;
    this.time += 0.0; // advanced by update()
    M4.perspective(this.proj, cam.fov * Math.PI / 180, this.width / this.height, 0.1, 220);
    M4.lookAt(this.view, cam.eye, cam.target, [0, 1, 0]);
    this.camPos = cam.eye;
    // camera basis (for billboards) straight from the view matrix
    this.camRight = [this.view[0], this.view[4], this.view[8]];
    this.camUp = [this.view[1], this.view[5], this.view[9]];
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawSky();
  };

  Renderer.prototype.update = function (dt) {
    this.time += dt;
    this.particles.update(dt);
    this.beams.update(dt);
  };

  Renderer.prototype.drawSky = function () {
    const gl = this.gl;
    const p = this.pSky;
    gl.useProgram(p.prog);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.enableVertexAttribArray(p.a.aPos);
    gl.vertexAttribPointer(p.a.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(p.u.uTop, this.skyTop);
    gl.uniform3fv(p.u.uBottom, this.skyBottom);
    gl.uniform3fv(p.u.uGlow, this.skyGlow);
    gl.uniform1f(p.u.uAspect, this.width / this.height);
    gl.uniform1f(p.u.uTime, this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  };

  Renderer.prototype.bindLit = function () {
    const gl = this.gl, p = this.pLit;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.u.uView, false, this.view);
    gl.uniform3fv(p.u.uLightDir, this.light);
    gl.uniform3fv(p.u.uAmbient, this.ambient);
    gl.uniform3fv(p.u.uFogColor, this.fogColor);
    gl.uniform3fv(p.u.uCamPos, this.camPos);
    gl.uniform1f(p.u.uFogDensity, this.fogDensity);
    gl.uniform1f(p.u.uTime, this.time);
    return p;
  };

  Renderer.prototype.attribs = function (p) {
    const gl = this.gl;
    gl.enableVertexAttribArray(p.a.aPos);
    gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 40, 0);
    if (p.a.aNrm !== undefined && p.a.aNrm >= 0) {
      gl.enableVertexAttribArray(p.a.aNrm);
      gl.vertexAttribPointer(p.a.aNrm, 3, gl.FLOAT, false, 40, 12);
    }
    if (p.a.aCol !== undefined && p.a.aCol >= 0) {
      gl.enableVertexAttribArray(p.a.aCol);
      gl.vertexAttribPointer(p.a.aCol, 4, gl.FLOAT, false, 40, 24);
    }
  };

  function color3(c) { return c || [1, 1, 1]; }

  // Draw a lit mesh. opt: { tint:[r,g,b], emit:1, grid:0, alpha:1 }
  Renderer.prototype.lit = function (mesh, model, opt) {
    if (!mesh) return;
    const gl = this.gl, p = this.pLit;
    if (this.dynamicProgram !== p) {
      this.bindLit();
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      this.dynamicProgram = p;
    }
    M4.normalMat3(this.nrm, model);
    gl.uniformMatrix4fv(p.u.uModel, false, model);
    gl.uniformMatrix3fv(p.u.uNrmMat, false, this.nrm);
    const o = opt || {};
    gl.uniform3fv(p.u.uTint, color3(o.tint));
    gl.uniform1f(p.u.uEmitMul, o.emit === undefined ? 1 : o.emit);
    gl.uniform1f(p.u.uGrid, o.grid ? 1 : 0);
    gl.uniform1f(p.u.uAlpha, o.alpha === undefined ? 1 : o.alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    this.attribs(p);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  };

  Renderer.prototype.shadow = function (mesh, model, alpha) {
    if (!mesh || !this.shadowsOn || this.quality === 0) return;
    const gl = this.gl, p = this.pShadow;
    if (this.dynamicProgram !== p) {
      gl.useProgram(p.prog);
      gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
      gl.uniformMatrix4fv(p.u.uView, false, this.view);
      gl.uniform3fv(p.u.uLight, this.light);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.dynamicProgram = p;
    }
    gl.uniformMatrix4fv(p.u.uModel, false, model);
    gl.uniform1f(p.u.uAlpha, alpha === undefined ? 0.4 : alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    this.attribs(p);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  };

  // Draw raw dynamic geometry: Float32Array of [x,y,z, r,g,b,a] per vertex.
  Renderer.prototype.raw = function (data, verts, mode, additive, alpha) {
    if (!verts) return;
    const gl = this.gl, p = this.pUnlit;
    if (this.dynamicProgram !== p) {
      gl.useProgram(p.prog);
      gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
      gl.uniformMatrix4fv(p.u.uView, false, this.view);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      this.dynamicProgram = p;
    }
    gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(p.u.uModel, false, IDENTITY);
    gl.uniform1f(p.u.uAlpha, alpha === undefined ? 1 : alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamic);
    const need = verts * 7;
    if (this.dynamicCap < need) {
      this.dynamicCap = Math.max(need, this.dynamicCap * 2, 1024);
      gl.bufferData(gl.ARRAY_BUFFER, this.dynamicCap * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, need));
    gl.enableVertexAttribArray(p.a.aPos);
    gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(p.a.aCol);
    gl.vertexAttribPointer(p.a.aCol, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(mode === 'tri' ? gl.TRIANGLES : mode === 'line' ? gl.LINES : gl.POINTS, 0, verts);
  };

  Renderer.prototype.fx = function (alpha) {
    // beams, then particles — both additive, both after the opaque pass
    const gl = this.gl;
    const n = this.beams.build(this.camRight, this.camUp);
    this.raw(this.beams.buf, n, 'tri', true, alpha === undefined ? 1 : alpha);
    const pn = this.particles.fill();
    if (pn) {
      const p = this.pPoint;
      gl.useProgram(p.prog);
      gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
      gl.uniformMatrix4fv(p.u.uView, false, this.view);
      gl.uniform1f(p.u.uScale, this.height * 0.055);
      gl.uniform1f(p.u.uAlpha, alpha === undefined ? 1 : alpha);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamic);
      if (this.dynamicCap < pn * 7) {
        this.dynamicCap = Math.max(pn * 7, this.dynamicCap * 2, 1024);
        gl.bufferData(gl.ARRAY_BUFFER, this.dynamicCap * 4, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particles.buf.subarray(0, pn * 7));
      gl.enableVertexAttribArray(p.a.aPos);
      gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(p.a.aCol);
      gl.vertexAttribPointer(p.a.aCol, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.POINTS, 0, pn);
      this.dynamicProgram = p;
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  };

  Renderer.prototype.end = function () {
    // restore state for the next frame
    const gl = this.gl;
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    this.dynamicProgram = null;
  };

  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  // ── Input ───────────────────────────────────────────────────────────────
  // Keyboard + pointer lock look. Touch buttons are wired in game.js so the HUD
  // can decide which ones exist; both write into the same state object.
  function Input(canvas) {
    const state = this;
    this.keys = Object.create(null);
    this.lookX = 0;
    this.lookY = 0;
    this.fire = false;
    this.aim = false;
    this.jump = false;
    this.dash = false;
    this.ability = false;
    this.reload = false;
    this.switchWeapon = false;
    this.locked = false;
    this.isTouch = ('ontouchstart' in root) || (navigator.maxTouchPoints || 0) > 0;
    this.sensitivity = 1;

    const block = { Tab: 1, Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
    addEventListener('keydown', (e) => {
      if (block[e.code]) e.preventDefault();
      if (e.repeat) return;
      state.keys[e.code] = true;
      if (e.code === 'KeyE') state.ability = true;
      if (e.code === 'KeyR') state.reload = true;
      if (e.code === 'KeyQ') state.switchWeapon = true;
      if (e.code === 'Space') state.jump = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.dash = true;
      if (state.onKey) state.onKey(e.code);
    });
    addEventListener('keyup', (e) => { state.keys[e.code] = false; });
    addEventListener('blur', () => { state.keys = Object.create(null); state.fire = false; state.aim = false; });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (state.isTouch) return;
      // A click always shoots: if the pointer is not captured yet we ask for it,
      // but the shot still goes out so a denied lock can never make the game feel dead.
      if (!state.locked && state.onLockRequest) state.onLockRequest();
      if (e.button === 0) state.fire = true;
      if (e.button === 2) state.aim = !state.aim;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) state.fire = false;
    });
    document.addEventListener('pointerlockchange', () => {
      state.locked = document.pointerLockElement === canvas;
      if (!state.locked) { state.fire = false; if (state.onUnlock) state.onUnlock(); }
    });
    addEventListener('mousemove', (e) => {
      if (!state.locked) return;
      state.lookX += e.movementX * 0.0022 * state.sensitivity;
      state.lookY += e.movementY * 0.0022 * state.sensitivity;
    });
    addEventListener('wheel', (e) => { if (state.locked) { state.switchWeapon = true; e.preventDefault(); } }, { passive: false });
  }
  Input.prototype.consumeLook = function () {
    const x = this.lookX, y = this.lookY;
    this.lookX = 0; this.lookY = 0;
    return [x, y];
  };
  Input.prototype.down = function (code) { return !!this.keys[code]; };
  Input.prototype.axis = function () {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    return [x, z];
  };
  Input.prototype.take = function (flag) {
    // one-shot actions: read and clear
    if (!this[flag]) return false;
    this[flag] = false;
    return true;
  };
  Input.prototype.lock = function (canvas) {
    if (this.isTouch) return;
    if (!canvas.requestPointerLock) return;
    try {
      const p = canvas.requestPointerLock();
      // Chrome returns a promise here; a denial must not surface as an uncaught error.
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* lock is a nicety, not a requirement */ }
  };

  // ── Audio ───────────────────────────────────────────────────────────────
  function Audio() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.musicOn = false;
    this._musicTimer = null;
    this._step = 0;
  }
  Audio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.7;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    // A short noise buffer is reused by every weapon/impact sound.
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this._filter = ctx.createBiquadFilter();
    this._filter.type = 'lowpass';
    this._filter.frequency.value = 9000;
    this._filter.connect(master);
    return ctx;
  };
  Audio.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  };
  Audio.prototype.noiseHit = function (freq, dur, gain, type) {
    const ctx = this.ensure();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  };
  Audio.prototype.tone = function (freq, dur, gain, type, slideTo) {
    const ctx = this.ensure();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  Audio.prototype.shoot = function () {
    this.noiseHit(1800, 0.09, 0.28);
    this.tone(220, 0.08, 0.16, 'square', 90);
  };
  Audio.prototype.scatter = function () {
    this.noiseHit(800, 0.22, 0.34, 'lowpass');
    this.tone(140, 0.2, 0.2, 'sawtooth', 55);
  };
  Audio.prototype.enemyShoot = function () {
    this.tone(520, 0.14, 0.12, 'sawtooth', 220);
  };
  Audio.prototype.hit = function () {
    this.noiseHit(3000, 0.05, 0.2, 'highpass');
    this.tone(1200, 0.04, 0.08, 'sine');
  };
  Audio.prototype.explosion = function (big) {
    this.noiseHit(big ? 320 : 600, big ? 0.6 : 0.35, big ? 0.5 : 0.32, 'lowpass');
    this.tone(big ? 70 : 110, big ? 0.5 : 0.3, 0.22, 'sine', 34);
  };
  Audio.prototype.damage = function () {
    this.noiseHit(420, 0.22, 0.3, 'lowpass');
    this.tone(160, 0.18, 0.14, 'triangle', 70);
  };
  Audio.prototype.pickup = function () {
    this.tone(680, 0.09, 0.14, 'sine', 980);
    setTimeout(() => this.tone(980, 0.1, 0.12, 'sine', 1320), 70);
  };
  Audio.prototype.reload = function () {
    this.noiseHit(900, 0.05, 0.14, 'bandpass');
    setTimeout(() => this.noiseHit(500, 0.07, 0.16, 'bandpass'), 110);
  };
  Audio.prototype.ability = function () {
    this.tone(120, 0.5, 0.25, 'sawtooth', 900);
    this.noiseHit(1200, 0.4, 0.25, 'highpass');
  };
  Audio.prototype.wave = function () {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 0.12, 'triangle'), i * 110));
  };
  Audio.prototype.death = function () {
    this.tone(220, 0.9, 0.3, 'sawtooth', 50);
    this.noiseHit(240, 1.1, 0.3, 'lowpass');
  };
  Audio.prototype.ui = function () { this.tone(720, 0.05, 0.06, 'sine', 900); };
  Audio.prototype.startMusic = function () {
    const ctx = this.ensure();
    if (!ctx || this.musicOn) return;
    this.musicOn = true;
    const scale = [55, 65.41, 73.42, 82.41, 98, 110, 130.81, 146.83];
    const tick = () => {
      if (!this.musicOn) return;
      const t = ctx.currentTime + 0.05;
      const root0 = scale[(this._step * 3) % scale.length];
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380 + Math.sin(this._step * 0.7) * 180;
      o.type = 'sawtooth';
      o.frequency.value = root0;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 6);
      // sparse high bell
      if (this._step % 4 === 0) {
        const b = ctx.createOscillator();
        const bg = ctx.createGain();
        b.type = 'triangle';
        b.frequency.value = scale[(this._step * 5 + 3) % scale.length] * 4;
        bg.gain.setValueAtTime(0.0001, t + 0.5);
        bg.gain.exponentialRampToValueAtTime(0.02, t + 0.8);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        b.connect(bg); bg.connect(this.master);
        b.start(t + 0.5); b.stop(t + 5);
      }
      this._step++;
      this._musicTimer = setTimeout(tick, 4200);
    };
    tick();
  };
  Audio.prototype.stopMusic = function () {
    this.musicOn = false;
    if (this._musicTimer) clearTimeout(this._musicTimer);
    this._musicTimer = null;
  };

  root.TKE = { M4, Builder, Renderer, Input, Audio, U, IDENTITY };
})(typeof window !== 'undefined' ? window : this);
