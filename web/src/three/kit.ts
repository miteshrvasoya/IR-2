// Building blocks for the procedural world: cached materials, canvas-painted textures, and furniture.
// Everything in the 3D world is generated here in code, so the look is one coherent stylised-realist
// style with no third-party assets and no licensing questions.
import * as THREE from 'three';

const mats = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, o: { rough?: number; metal?: number; emissive?: string; ei?: number; map?: THREE.Texture; opacity?: number; side?: THREE.Side } = {}) {
  const key = color + JSON.stringify({ ...o, map: o.map?.uuid });
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0, emissive: o.emissive ? new THREE.Color(o.emissive) : undefined, emissiveIntensity: o.ei ?? 1, map: o.map, transparent: o.opacity !== undefined, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide });
    mats.set(key, m);
  }
  return m;
}

function canvas(size: number, paint: (c: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  paint(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const texCache = new Map<string, THREE.Texture>();
const cached = (k: string, f: () => THREE.Texture) => { if (!texCache.has(k)) texCache.set(k, f()); return texCache.get(k)!.clone(); };
const shade = (hex: string, k: number) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

export const tex = {
  wood: (color: string, repeat = 2) => { const t = cached('wood' + color, () => canvas(256, (c, s) => {
    c.fillStyle = color; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) { c.strokeStyle = shade(color, 0.7 + Math.random() * 0.5); c.globalAlpha = 0.25; c.lineWidth = 1 + Math.random() * 2; const y = Math.random() * s; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(s / 3, y + Math.random() * 8 - 4, (2 * s) / 3, y + Math.random() * 8 - 4, s, y); c.stroke(); }
    c.globalAlpha = 0.35; c.strokeStyle = shade(color, 0.45); c.lineWidth = 2; for (let x = 0; x <= s; x += s / 4) { c.beginPath(); c.moveTo(0, x); c.lineTo(s, x); c.stroke(); }
  })); t.repeat.set(repeat, repeat); return t; },
  noise: (color: string, repeat = 2, amp = 0.12) => { const t = cached('noise' + color + amp, () => canvas(128, (c, s) => {
    c.fillStyle = color; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) { c.fillStyle = shade(color, 1 - amp + Math.random() * amp * 2); c.globalAlpha = 0.5; c.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
  })); t.repeat.set(repeat, repeat); return t; },
  tiles: (a: string, b: string, repeat = 6) => { const t = cached('tiles' + a + b, () => canvas(128, (c, s) => {
    c.fillStyle = a; c.fillRect(0, 0, s, s); c.fillStyle = b; c.fillRect(0, 0, s / 2, s / 2); c.fillRect(s / 2, s / 2, s / 2, s / 2);
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.strokeRect(0, 0, s / 2, s / 2); c.strokeRect(s / 2, s / 2, s / 2, s / 2); c.strokeRect(0, s / 2, s / 2, s / 2); c.strokeRect(s / 2, 0, s / 2, s / 2);
  })); t.repeat.set(repeat, repeat); return t; },
  panel: (color: string, repeat = 3) => { const t = cached('panel' + color, () => canvas(256, (c, s) => {
    c.fillStyle = color; c.fillRect(0, 0, s, s);
    c.strokeStyle = shade(color, 0.55); c.lineWidth = 6; c.strokeRect(14, 14, s - 28, s - 28);
    c.strokeStyle = shade(color, 1.35); c.lineWidth = 2; c.strokeRect(22, 22, s - 44, s - 44);
  })); t.repeat.set(repeat, 1); return t; },
};

/** A text card painted to a texture (evidence labels, screens, signs). */
export function label(text: string, o: { w?: number; h?: number; bg?: string; fg?: string; font?: string; sub?: string; accent?: string; scale?: number } = {}) {
  const w = o.w ?? 512, h = o.h ?? 256, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = o.bg ?? '#efe6d2'; c.fillRect(0, 0, w, h);
  if (o.accent) { c.fillStyle = o.accent; c.fillRect(0, 0, w, h * 0.09); }
  c.fillStyle = o.fg ?? '#1a1a1a'; c.textAlign = 'center'; c.textBaseline = 'middle';
  let size = Math.floor(h * 0.24 * (o.scale ?? 1)); c.font = `${o.font ?? '700'} ${size}px Georgia, serif`;
  const words = text.split(' '), lines: string[] = []; let cur = '';
  for (const wd of words) { if (c.measureText(cur + ' ' + wd).width > w * 0.88 && cur) { lines.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; }
  lines.push(cur);
  if (lines.length > 3) { size = Math.floor(size * 0.7); c.font = `${o.font ?? '700'} ${size}px Georgia, serif`; }
  const lh = size * 1.15, y0 = h / 2 - ((lines.length - 1) * lh) / 2 - (o.sub ? size * 0.4 : 0);
  lines.slice(0, 4).forEach((l, i) => c.fillText(l, w / 2, y0 + i * lh));
  if (o.sub) { c.font = `400 ${Math.floor(size * 0.5)}px Georgia, serif`; c.globalAlpha = 0.7; c.fillText(o.sub, w / 2, h - size * 0.7); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

type V3 = [number, number, number];
export function mesh(geo: THREE.BufferGeometry, m: THREE.Material, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], shadow = true) {
  const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...r); o.castShadow = shadow; o.receiveShadow = true; return o;
}
export const box = (w: number, h: number, d: number, m: THREE.Material, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0]) => mesh(new THREE.BoxGeometry(w, h, d), m, p, r);
export const cyl = (rt: number, rb: number, h: number, m: THREE.Material, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], seg = 20) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m, p, r);
export const ball = (rad: number, m: THREE.Material, p: V3 = [0, 0, 0]) => mesh(new THREE.SphereGeometry(rad, 20, 14), m, p);
export const plane = (w: number, h: number, m: THREE.Material, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0]) => mesh(new THREE.PlaneGeometry(w, h), m, p, r, false);
export function group(p: V3 = [0, 0, 0], ry = 0, ...kids: THREE.Object3D[]) { const g = new THREE.Group(); g.position.set(...p); g.rotation.y = ry; kids.forEach((k) => g.add(k)); return g; }

/** A closed room. The camera always stays inside, so walls face inwards. */
export function room(w: number, d: number, h: number, o: { floor: THREE.Material; wall: THREE.Material; ceil?: THREE.Material; trim?: string }) {
  const g = new THREE.Group();
  const f = plane(w, d, o.floor, [0, 0, 0], [-Math.PI / 2, 0, 0]); f.receiveShadow = true; g.add(f);
  g.add(plane(w, d, o.ceil ?? mat('#1b1b1e', { rough: 1 }), [0, h, 0], [Math.PI / 2, 0, 0]));
  g.add(plane(w, h, o.wall, [0, h / 2, -d / 2]), plane(w, h, o.wall, [0, h / 2, d / 2], [0, Math.PI, 0]), plane(d, h, o.wall, [-w / 2, h / 2, 0], [0, Math.PI / 2, 0]), plane(d, h, o.wall, [w / 2, h / 2, 0], [0, -Math.PI / 2, 0]));
  if (o.trim) { const tm = mat(o.trim, { rough: 0.6 }); g.add(box(w, 0.12, 0.04, tm, [0, 0.06, -d / 2 + 0.02]), box(w, 0.12, 0.04, tm, [0, 0.06, d / 2 - 0.02]), box(0.04, 0.12, d, tm, [-w / 2 + 0.02, 0.06, 0]), box(0.04, 0.12, d, tm, [w / 2 - 0.02, 0.06, 0])); }
  return g;
}

export function table(w: number, d: number, h: number, top: THREE.Material, leg: THREE.Material = top, thick = 0.06) {
  const g = new THREE.Group(); g.add(box(w, thick, d, top, [0, h - thick / 2, 0]));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(box(0.06, h - thick, 0.06, leg, [x * (w / 2 - 0.08), (h - thick) / 2, z * (d / 2 - 0.08)]));
  return g;
}
export function desk(w: number, d: number, h: number, m: THREE.Material) {
  const g = new THREE.Group(); g.add(box(w, 0.05, d, m, [0, h, 0]), box(0.05, h, d, m, [-w / 2 + 0.03, h / 2, 0]), box(0.05, h, d, m, [w / 2 - 0.03, h / 2, 0]), box(w, h * 0.7, 0.04, m, [0, h * 0.6, -d / 2 + 0.03]));
  return g;
}
export function chair(seat: THREE.Material, frame: THREE.Material = seat, o: { arms?: boolean; high?: boolean } = {}) {
  const g = new THREE.Group(), bh = o.high ? 0.85 : 0.5;
  g.add(box(0.46, 0.06, 0.46, seat, [0, 0.46, 0]), box(0.46, bh, 0.05, seat, [0, 0.5 + bh / 2, -0.22]));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(cyl(0.02, 0.02, 0.44, frame, [x * 0.2, 0.22, z * 0.2], [0, 0, 0], 8));
  if (o.arms) g.add(box(0.05, 0.04, 0.4, frame, [0.25, 0.68, 0]), box(0.05, 0.04, 0.4, frame, [-0.25, 0.68, 0]));
  return g;
}
export function lampDesk(color = '#ffcf87', shadeColor = '#2e4a3a', intensity = 5) {
  const g = new THREE.Group(), brass = mat('#8a6a2a', { metal: 0.8, rough: 0.35 });
  g.add(cyl(0.08, 0.1, 0.02, brass, [0, 0.01, 0]), cyl(0.012, 0.012, 0.32, brass, [0, 0.17, 0], [0, 0, 0], 8), box(0.3, 0.07, 0.12, mat(shadeColor, { rough: 0.4 }), [0, 0.35, 0]), box(0.26, 0.015, 0.09, mat('#fff', { emissive: color, ei: 2.2 }), [0, 0.312, 0]));
  const l = new THREE.PointLight(color, intensity, 4.5, 2); l.position.set(0, 0.28, 0.02); g.add(l);
  return g;
}
export function pendant(color = '#ffd9a0', intensity = 20, drop = 0.8, cast = false) {
  const g = new THREE.Group(), dark = mat('#141414', { rough: 0.5, metal: 0.4 });
  g.add(cyl(0.006, 0.006, drop, dark, [0, -drop / 2, 0], [0, 0, 0], 6), cyl(0.05, 0.22, 0.16, dark, [0, -drop - 0.08, 0]), cyl(0.18, 0.18, 0.01, mat('#fff', { emissive: color, ei: 3 }), [0, -drop - 0.165, 0]));
  const l = new THREE.SpotLight(color, intensity, 9, 0.85, 0.6, 1.6); l.position.set(0, -drop - 0.12, 0); l.target.position.set(0, -drop - 4, 0); l.castShadow = cast;
  if (cast) { l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0015; l.shadow.radius = 4; }
  g.add(l, l.target);
  return g;
}
export function shelf(w: number, h: number, d: number, m: THREE.Material, rows = 4, fill?: (g: THREE.Group, y: number, i: number) => void) {
  const g = new THREE.Group(); g.add(box(0.04, h, d, m, [-w / 2, h / 2, 0]), box(0.04, h, d, m, [w / 2, h / 2, 0]));
  for (let i = 0; i <= rows; i++) { const y = (i / rows) * (h - 0.04) + 0.02; g.add(box(w, 0.035, d, m, [0, y, 0])); if (fill && i < rows) fill(g, y + 0.02, i); }
  return g;
}
export function boxesRow(g: THREE.Group, y: number, w: number, d: number, seed: number, colors = ['#8a7a5c', '#7a6a50', '#9a8a68', '#6e5f48']) {
  let x = -w / 2 + 0.08, i = seed;
  while (x < w / 2 - 0.25) { const bw = 0.24 + ((i * 37) % 10) / 60, bh = 0.2 + ((i * 53) % 10) / 70; const b = box(bw, bh, d * 0.8, mat(colors[i % colors.length], { rough: 0.9 }), [x + bw / 2, y + bh / 2, 0]); g.add(b, box(bw * 0.5, 0.06, 0.005, mat('#e8e0cc'), [x + bw / 2, y + bh * 0.55, d * 0.4 + 0.003])); x += bw + 0.03; i++; }
}
export function monitor(text?: THREE.Texture, glow = '#5fb4ff') {
  const g = new THREE.Group(), dark = mat('#0e0e10', { rough: 0.4 });
  g.add(box(0.52, 0.32, 0.025, dark, [0, 0.3, 0]), box(0.48, 0.28, 0.005, text ? new THREE.MeshBasicMaterial({ map: text }) : mat('#0a1622', { emissive: glow, ei: 0.9 }), [0, 0.3, 0.015]), box(0.04, 0.14, 0.03, dark, [0, 0.08, -0.02]), box(0.2, 0.012, 0.14, dark, [0, 0.006, 0]));
  return g;
}
/** A window: glowing pane, frame, optional blinds, and a faked volumetric light shaft. */
export function windowLit(w: number, h: number, color: string, o: { blinds?: boolean; shaft?: number; ei?: number } = {}) {
  const g = new THREE.Group(), fr = mat('#15120f', { rough: 0.5 });
  g.add(plane(w, h, mat('#000', { emissive: color, ei: o.ei ?? 1.4 }), [0, 0, 0.01]));
  g.add(box(w + 0.1, 0.06, 0.06, fr, [0, h / 2, 0.03]), box(w + 0.1, 0.06, 0.06, fr, [0, -h / 2, 0.03]), box(0.06, h, 0.06, fr, [-w / 2, 0, 0.03]), box(0.06, h, 0.06, fr, [w / 2, 0, 0.03]), box(0.035, h, 0.04, fr, [0, 0, 0.03]));
  if (o.blinds) for (let y = -h / 2 + 0.06; y < h / 2; y += 0.085) g.add(box(w, 0.045, 0.012, mat('#1d1a17', { rough: 0.6 }), [0, y, 0.05], [0.5, 0, 0]));
  if (o.shaft) {
    const sm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.034, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(w * (0.9 - i * 0.2), o.shaft), sm); s.position.set((i - 1) * w * 0.18, -o.shaft * 0.32, o.shaft * 0.42); s.rotation.x = -0.92; g.add(s); }
  }
  return g;
}
export function plant() {
  const g = new THREE.Group(); g.add(cyl(0.16, 0.12, 0.3, mat('#6b4a36', { rough: 0.9 }), [0, 0.15, 0]));
  const leaf = mat('#2f5a3a', { rough: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, l = mesh(new THREE.SphereGeometry(0.11, 8, 6), leaf, [Math.cos(a) * 0.14, 0.5 + (i % 3) * 0.14, Math.sin(a) * 0.14]); l.scale.set(0.5, 1.5, 1); l.rotation.set(0.5, a, 0.3); g.add(l); }
  return g;
}
export function door(m: THREE.Material) { const g = new THREE.Group(); g.add(box(0.95, 2.1, 0.06, m, [0, 1.05, 0]), ball(0.035, mat('#b99a4a', { metal: 0.9, rough: 0.3 }), [0.36, 1.0, 0.05])); return g; }
/** Slow-drifting dust motes that catch the light. */
export function dust(n: number, w: number, h: number, d: number, color = '#ffe6bf', size = 0.018) {
  const pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * w; pos[i * 3 + 1] = Math.random() * h; pos[i * 3 + 2] = (Math.random() - 0.5) * d; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending }));
  p.userData.tick = (t: number) => { p.rotation.y = t * 0.012; p.position.y = Math.sin(t * 0.21) * 0.05; };
  return p;
}
export { shade };
