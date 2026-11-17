// The ten environments. Each is built procedurally and exposes named anchors (where a role stands or
// sits), an establishing camera, an exhibit spot, and its own lighting, fog and atmosphere.
import * as THREE from 'three';
import type { SceneId } from '../../../shared/types';
import { mat, tex, box, cyl, ball, plane, group, room, table, desk, chair, lampDesk, pendant, shelf, boxesRow, monitor, windowLit, plant, door, dust, label, mesh } from './kit';

type V3 = [number, number, number];
export interface Anchor { p: V3; face: number; sit?: boolean }
export interface Env {
  id: SceneId; group: THREE.Group; anchors: Record<string, Anchor>; extras: Anchor[];
  wide: { pos: V3; look: V3 }; exhibit: V3; fog: [string, number, number]; bounds: [number, number, number];
  tick: (t: number) => void; board?: THREE.Group;
}
const A = (x: number, y: number, z: number, face: number, sit = false): Anchor => ({ p: [x, y, z], face, sit });
const PI = Math.PI;
function base(id: SceneId, g: THREE.Group, o: Partial<Env> & Pick<Env, 'anchors' | 'wide' | 'exhibit' | 'fog' | 'bounds'>, hemi: [string, string, number]): Env {
  g.add(new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2] * 2.6));
  const ticks: ((t: number) => void)[] = [];
  g.traverse((x) => { if (x.userData.tick) ticks.push(x.userData.tick); });
  return { id, group: g, extras: [], tick: (t) => ticks.forEach((f) => f(t)), ...o };
}
const steel = () => mat('#7d848c', { metal: 0.85, rough: 0.35 });
const tube = (len: number, color = '#dff1ff', ei = 1.3) => box(len, 0.03, 0.09, mat('#fff', { emissive: color, ei }));

function interrogation(): Env {
  const g = room(6, 5, 3, { floor: mat('#3a3d3f', { map: tex.noise('#4a4d50', 4), rough: 0.9 }), wall: mat('#3d4744', { map: tex.noise('#55605c', 3, 0.06), rough: 0.95 }), ceil: mat('#161818'), trim: '#1e2322' });
  const tb = table(1.7, 0.85, 0.76, mat('#5d6368', { metal: 0.7, rough: 0.5 }), mat('#33373b', { metal: 0.6 })); g.add(tb);
  const cs = mat('#2a2d30', { metal: 0.5, rough: 0.5 });
  g.add(group([0, 0, 0.9], PI, chair(cs)), group([0, 0, -0.9], 0, chair(cs)));
  g.add(plane(3.2, 1.2, mat('#070a0b', { metal: 1, rough: 0.08 }), [0, 1.65, -2.49]), box(3.3, 0.06, 0.05, cs, [0, 2.27, -2.47]), box(3.3, 0.06, 0.05, cs, [0, 1.03, -2.47]));
  g.add(group([2.99, 0, 1.2], -PI / 2, door(mat('#2b3331', { rough: 0.7 }))));
  g.add(box(0.12, 0.09, 0.2, cs, [-2.7, 2.7, -2.2], [0.3, 0.7, 0]), ball(0.012, mat('#f00', { emissive: '#ff2a1a', ei: 4 }), [-2.62, 2.68, -2.1]));
  g.add(group([0, 3, 0], 0, pendant('#fff1d6', 15, 0.75, true)));
  g.add(box(0.22, 0.012, 0.3, mat('#d8d2c2'), [0.45, 0.767, 0.1], [0, 0.3, 0]), cyl(0.035, 0.03, 0.09, mat('#ddd', { rough: 0.3 }), [-0.55, 0.805, 0.2]));
  g.add(dust(110, 2.2, 2.6, 2.2, '#ffe9c4', 0.012));
  const fill = new THREE.PointLight('#4f8f88', 9, 9); fill.position.set(-2.4, 1.5, 1.8); g.add(fill);
  return base('interrogation', g, { anchors: { detective: A(0, 0, 0.9, PI, true), subject: A(0, 0, -0.9, 0, true), observer: A(2.2, 0, 1.6, -2.2) }, wide: { pos: [2.5, 1.75, 2.1], look: [0, 0.95, -0.1] }, exhibit: [0, 0.8, 0], fog: ['#0b0f0f', 4, 14], bounds: [2.8, 2.8, 2.3] }, ['#56706c', '#0a0c0c', 0.32]);
}

function witnessRoom(): Env {
  const g = room(6, 5, 2.9, { floor: mat('#5b4a3a', { map: tex.wood('#6b5540', 3), rough: 0.7 }), wall: mat('#6f6657', { map: tex.noise('#857b68', 3, 0.05), rough: 0.95 }), ceil: mat('#2a2622'), trim: '#3a2f25' });
  g.add(mesh(new THREE.CircleGeometry(1.7, 40), mat('#6b2f2c', { map: tex.noise('#7a3632', 3), rough: 1 }), [0, 0.012, 0], [-PI / 2, 0, 0], false));
  g.add(cyl(0.5, 0.5, 0.04, mat('#4a3423', { map: tex.wood('#5a4028', 1) }), [0, 0.6, 0], [0, 0, 0], 32), cyl(0.05, 0.2, 0.6, mat('#2a1e15'), [0, 0.3, 0]));
  const up = mat('#42544a', { rough: 0.95 });
  g.add(group([0, 0, 0.95], PI, chair(up, mat('#2a1e15'), { arms: true })), group([0, 0, -0.95], 0, chair(up, mat('#2a1e15'), { arms: true })));
  g.add(group([-2.98, 1.6, -0.3], PI / 2, windowLit(1.6, 1.4, '#ffb46a', { blinds: true, shaft: 2.6, ei: 1.6 })));
  const sun = new THREE.SpotLight('#ffb878', 26, 12, 0.6, 0.7, 1.4); sun.position.set(-2.8, 2.2, -0.3); sun.target.position.set(0.6, 0, 0.2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.002; g.add(sun, sun.target);
  g.add(group([-2.4, 0, -2.0], 0, plant()), group([-2.3, 0, 1.9], 0, plant()));
  g.add(group([2.4, 0, -1.9], 0, cyl(0.02, 0.02, 1.5, mat('#2a1e15'), [0, 0.75, 0]), cyl(0.2, 0.26, 0.3, mat('#f3dfb8', { emissive: '#ffcf8a', ei: 0.7 }), [0, 1.6, 0])));
  const warm = new THREE.PointLight('#ffc98a', 7, 7, 1.8); warm.position.set(2.2, 1.5, -1.7); g.add(warm);
  g.add(box(1.5, 0.9, 0.04, mat('#2c241c'), [0.6, 1.7, -2.47]), plane(1.4, 0.8, new THREE.MeshBasicMaterial({ color: '#8f8f8f', map: label('Witness Services', { bg: '#d9cfb8', sub: 'You are not under arrest. You may leave at any time.', w: 512, h: 300 }) }), [0.6, 1.7, -2.44]));
  g.add(cyl(0.04, 0.035, 0.1, mat('#e8e2d4'), [0.2, 0.67, 0.15]), group([2.98, 0, -1], -PI / 2, door(mat('#4a3626', { map: tex.wood('#5a4230', 1) }))), dust(90, 4, 2.5, 3, '#ffd9a8'));
  return base('witness_room', g, { anchors: { detective: A(0, 0, 0.95, PI, true), subject: A(0, 0, -0.95, 0, true) }, wide: { pos: [2.4, 1.6, 2.0], look: [0, 0.9, -0.1] }, exhibit: [0, 0.66, 0], fog: ['#231a12', 6, 18], bounds: [2.8, 2.7, 2.3] }, ['#b89a78', '#2a1f16', 0.55]);
}

function office(): Env {
  const g = room(11, 9, 3.2, { floor: mat('#3b3530', { map: tex.wood('#4a4038', 5), rough: 0.8 }), wall: mat('#39403f', { map: tex.noise('#46504e', 5, 0.05), rough: 0.95 }), ceil: mat('#17191a'), trim: '#1d1f1f' });
  const wood = mat('#4e3b2b', { map: tex.wood('#5c4632', 1), rough: 0.6 });
  g.add(group([0, 0, -1.6], 0, table(2.6, 1.2, 0.78, wood, mat('#2a2018'))));
  const board = group([0, 1.75, -4.46], 0, box(4.2, 1.9, 0.05, mat('#8a6a48', { map: tex.noise('#96754f', 3, 0.1), rough: 1 })), box(4.3, 0.06, 0.07, wood, [0, 0.97, 0]), box(4.3, 0.06, 0.07, wood, [0, -0.97, 0])); g.add(board);
  const bl = new THREE.SpotLight('#ffe2b8', 30, 8, 0.75, 0.6, 1.5); bl.position.set(0, 3.1, -2.6); bl.target.position.set(0, 1.6, -4.4); g.add(bl, bl.target);
  for (const [x, z, ry] of [[-4, -2.2, PI / 2], [-4, 0.6, PI / 2], [4, -2.2, -PI / 2], [4, 0.6, -PI / 2]] as const) {
    g.add(group([x, 0, z], ry, desk(1.5, 0.75, 0.76, wood), group([0.35, 0.785, -0.1], 0, monitor()), group([-0.45, 0.785, -0.05], 0.4, lampDesk('#ffcf87', '#2e4a3a', 3.5)), group([0, 0, 0.7], PI, chair(mat('#22262a'), mat('#111'))), box(0.3, 0.02, 0.22, mat('#d8d0bc'), [-0.05, 0.795, 0.12], [0, 0.2, 0])));
  }
  g.add(group([5.48, 1.7, -0.8], -PI / 2, windowLit(3.4, 1.6, '#4f79b8', { blinds: true, shaft: 3, ei: 0.9 })));
  const city = new THREE.SpotLight('#6a93d8', 55, 14, 0.7, 0.8, 1.2); city.position.set(5.2, 2.3, -0.8); city.target.position.set(-1, 0, -1); city.castShadow = true; city.shadow.mapSize.set(1024, 1024); city.shadow.bias = -0.002; g.add(city, city.target);
  for (const x of [-4.9, -4.2]) g.add(group([x, 0, -4.1], 0, box(0.6, 1.4, 0.55, mat('#4d5458', { metal: 0.5, rough: 0.6 }), [0, 0.7, 0]), box(0.5, 0.02, 0.02, steel(), [0, 1.1, 0.29]), box(0.5, 0.02, 0.02, steel(), [0, 0.65, 0.29])));
  g.add(group([-1.2, 3.2, 0.5], 0, pendant('#ffd39a', 30, 0.5)), group([1.8, 3.2, -1.2], 0, pendant('#ffd39a', 44, 0.5)), group([-2.6, 3.2, -2.4], 0, pendant('#ffd39a', 30, 0.5)), group([3.4, 0, 3.6], 0, plant()));
  g.add(box(0.5, 0.012, 0.36, mat('#c9b88e'), [-0.7, 0.79, -1.5], [0, 0.25, 0]), cyl(0.045, 0.04, 0.1, mat('#eee'), [0.9, 0.83, -1.3]), dust(140, 9, 3, 7, '#bcd3ff', 0.014));
  return base('office', g, { board, anchors: { detective: A(-0.9, 0, -2.75, 0.25), forensic: A(1.7, 0, -1.9, -1.0), prosecutor: A(1.2, 0, -2.8, -0.35), defense: A(-2, 0, -1.2, 1.2) }, wide: { pos: [3.0, 1.9, 2.6], look: [-0.2, 1.2, -2.6] }, exhibit: [0, 0.82, -1.6], fog: ['#0c1016', 7, 24], bounds: [5.2, 2.9, 4.2] }, ['#7f93b0', '#2a221a', 0.6]);
}

function briefing(): Env {
  const g = room(9, 8, 3.2, { floor: mat('#2e3438', { map: tex.noise('#3a4146', 5), rough: 0.95 }), wall: mat('#2f3940', { map: tex.noise('#3a454d', 4, 0.05), rough: 0.95 }), ceil: mat('#141618'), trim: '#15181a' });
  g.add(plane(4.2, 2.2, new THREE.MeshBasicMaterial({ color: '#8f8f8f', map: label('OPERATION MERIDIAN', { bg: '#0d1b2a', fg: '#dfe9f5', sub: 'Major Crimes — initial briefing', w: 1024, h: 540, accent: '#e0a84a' }) }), [0, 1.75, -3.96]), box(4.4, 2.4, 0.04, mat('#0a0a0c'), [0, 1.75, -3.99]));
  const scr = new THREE.PointLight('#7fb0ff', 10, 8, 1.6); scr.position.set(0, 1.8, -3.2); g.add(scr);
  g.add(group([-2.2, 0, -2.6], 0.3, box(0.6, 1.1, 0.45, mat('#3a2c20', { map: tex.wood('#4a3828', 1) }), [0, 0.55, 0])));
  for (let r = 0; r < 3; r++) for (let c = -2; c <= 2; c++) g.add(group([c * 1.0, 0, 0.3 + r * 1.1], PI, chair(mat('#1f2a36', { rough: 0.9 }), mat('#111'))));
  const key = new THREE.SpotLight('#ffe0b0', 55, 10, 0.75, 0.7, 1.3); key.position.set(0, 3.1, 0.4); key.target.position.set(0, 1, -2.8); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.002; g.add(key, key.target);
  g.add(group([-4.48, 1.6, 0.5], PI / 2, windowLit(2.4, 1.3, '#39507a', { blinds: true, ei: 0.7 })), group([3.9, 0, -3.4], 0, plant()), box(0.9, 1.2, 0.04, mat('#8d979c', { rough: 0.5 }), [3.2, 1.6, -3.96]), dust(100, 7, 3, 6, '#a9c6ff', 0.014));
  return base('briefing', g, { anchors: { detective: A(-0.9, 0, -2.7, 0.15), forensic: A(1.0, 0, -2.6, -0.3), prosecutor: A(2.4, 0, -1.9, -0.9) }, wide: { pos: [0.8, 1.7, 2.4], look: [0, 1.25, -2.8] }, exhibit: [0, 1.2, -2.2], fog: ['#0a0e13', 7, 22], bounds: [4.2, 2.9, 3.7] }, ['#7c93b2', '#1c1a18', 0.62]);
}

function crimeScene(): Env {
  const g = new THREE.Group(), R = 9;
  g.add(mesh(new THREE.CircleGeometry(R, 64), mat('#2c2f33', { map: tex.tiles('#33373c', '#2b2e33', 12), rough: 0.55, metal: 0.1 }), [0, 0, 0], [-PI / 2, 0, 0], false));
  const dome = mesh(new THREE.SphereGeometry(R, 48, 24, 0, PI * 2, 0, PI / 2), mat('#20262d', { rough: 0.9, side: THREE.BackSide }), [0, 2.6, 0], [0, 0, 0], false); g.add(dome);
  g.add(mesh(new THREE.CylinderGeometry(R, R, 2.6, 64, 1, true), mat('#262b31', { map: tex.panel('#2b3138', 18), rough: 0.9, side: THREE.BackSide }), [0, 1.3, 0], [0, 0, 0], false));
  for (let i = 0; i < 12; i++) { const rib = mesh(new THREE.TorusGeometry(R - 0.05, 0.05, 6, 24, PI / 2), mat('#14181c', { metal: 0.6 }), [0, 2.6, 0], [0, (i / 12) * PI * 2, 0], false); g.add(rib); }
  // the open slit, with moonlight pouring through
  const slit = mesh(new THREE.SphereGeometry(R - 0.1, 8, 20, -0.11, 0.22, 0.05, PI / 2 - 0.1), mat('#000', { emissive: '#9db8e8', ei: 1.3, side: THREE.BackSide }), [0, 2.6, 0], [0, PI * 0.9, 0], false); g.add(slit);
  const moon = new THREE.SpotLight('#a9c3f2', 260, 26, 0.34, 0.6, 1.2); moon.position.set(2.2, 10.5, -6.5); moon.target.position.set(-1.2, 0, 0.8); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.001; g.add(moon, moon.target);
  // telescope
  const white = mat('#d9dde2', { rough: 0.35, metal: 0.3 }), dark = mat('#1a1d21', { metal: 0.7, rough: 0.4 });
  const scope = group([1.2, 0, -1.6], 0, cyl(0.9, 1.1, 1.4, mat('#3a3f46', { rough: 0.8 }), [0, 0.7, 0], [0, 0, 0], 28), cyl(0.35, 0.45, 1.6, dark, [0, 2.2, 0]));
  const tubeG = group([0, 3.3, 0], 0, cyl(0.62, 0.62, 5.2, white, [0, 0.6, 0], [0, 0, 0], 28), cyl(0.66, 0.66, 0.3, dark, [0, 3.1, 0], [0, 0, 0], 28), cyl(0.3, 0.3, 0.5, dark, [0, -2.2, 0]), box(0.5, 0.5, 2.0, dark, [0.75, 0, 0]));
  tubeG.rotation.set(0.75, 0, 0.35); scope.add(tubeG); g.add(scope);
  // gantry with stairs and the rail he went over
  const gm = mat('#3d444c', { metal: 0.7, rough: 0.5 }), gx = -3.4;
  g.add(box(2.2, 0.08, 3.2, gm, [gx, 2.4, -1.4]));
  for (const [x, z] of [[-1, -1.5], [1, -1.5], [-1, 1.5], [1, 1.5]]) g.add(box(0.1, 2.4, 0.1, gm, [gx + x, 1.2, -1.4 + z]));
  for (let i = 0; i < 9; i++) g.add(box(1.0, 0.05, 0.3, gm, [gx - 0.5, 2.4 - (i + 1) * 0.26, 0.2 + (i + 1) * 0.3 + 0.2]));
  g.add(box(0.05, 0.05, 3.2, steel(), [gx + 1.08, 3.4, -1.4]), box(0.05, 0.05, 3.2, steel(), [gx + 1.08, 2.9, -1.4]));
  for (let z = -2.9; z <= 0.2; z += 0.62) g.add(box(0.04, 1.0, 0.04, steel(), [gx + 1.08, 2.9, z]));
  g.add(box(0.12, 0.02, 0.05, mat('#222', { rough: 0.2 }), [gx + 0.6, 2.46, -0.9]));                                         // his glasses
  // body outline, markers, tape
  const chalk = new THREE.MeshBasicMaterial({ color: '#f2efe6' });
  const out = group([-1.0, 0.012, 0.9], 0.5); const ring = (rx: number, rz: number, x: number, z: number, rot = 0) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 28), chalk); m.rotation.x = -PI / 2; m.rotation.z = rot; m.scale.set(rx, rz, 1); m.position.set(x, 0, z); out.add(m); };
  ring(0.15, 0.17, 0, -0.95); ring(0.26, 0.42, 0, -0.38); ring(0.11, 0.42, -0.13, 0.42, 0.08); ring(0.11, 0.42, 0.15, 0.42, -0.1); ring(0.08, 0.34, -0.42, -0.5, 0.9); ring(0.08, 0.34, 0.4, -0.2, -0.5); g.add(out);
  [[-0.2, 1.6], [-2.0, 0.4], [-0.3, -0.1], [-1.9, 1.9]].forEach(([x, z], i) => g.add(group([x, 0, z], i, mesh(new THREE.ConeGeometry(0.09, 0.16, 4), mat('#f2c230', { rough: 0.5 }), [0, 0.08, 0]), plane(0.07, 0.07, new THREE.MeshBasicMaterial({ color: '#8f8f8f', map: label(String(i + 1), { bg: '#f2c230', w: 64, h: 64 }) }), [0, 0.09, 0.062], [-0.5, 0, 0]))));
  const tape = new THREE.MeshBasicMaterial({ color: '#f2c230', side: THREE.DoubleSide });
  const posts: V3[] = [[-3.2, 0, 2.6], [1.0, 0, 3.0], [1.6, 0, -0.4]];
  posts.forEach((p) => g.add(cyl(0.03, 0.05, 1.0, mat('#c33'), [p[0], 0.5, p[2]])));
  for (let i = 0; i < posts.length - 1; i++) { const a = new THREE.Vector3(...posts[i]), b = new THREE.Vector3(...posts[i + 1]), m = new THREE.Mesh(new THREE.PlaneGeometry(a.distanceTo(b), 0.07), tape); m.position.copy(a.add(b).multiplyScalar(0.5)).setY(0.9); m.rotation.y = -Math.atan2(posts[i + 1][2] - posts[i][2], posts[i + 1][0] - posts[i][0]); g.add(m); }
  // portable floodlights
  for (const [x, z, tx, tz] of [[2.6, 2.6, -1, 0.9], [-4.6, 3.2, -1.2, 0.6]]) {
    g.add(group([x, 0, z], 0, cyl(0.02, 0.02, 1.9, dark, [0, 0.95, 0]), box(0.5, 0.3, 0.08, dark, [0, 2.0, 0]), box(0.44, 0.24, 0.02, mat('#fff', { emissive: '#e8f2ff', ei: 5 }), [0, 2.0, -0.05])));
    const f = new THREE.SpotLight('#dfeaff', 150, 15, 0.6, 0.6, 1.5); f.position.set(x, 2.0, z); f.target.position.set(tx, 0, tz); g.add(f, f.target);
  }
  g.add(dust(260, 12, 7, 12, '#bfd3ff', 0.02));
  return base('crime_scene', g, { anchors: { detective: A(0.4, 0, 1.9, -2.4), forensic: A(-2.2, 0, 2.2, 2.6), prosecutor: A(1.4, 0, 2.6, -2.3) }, wide: { pos: [3.6, 2.4, 5.4], look: [-1.2, 1.4, -0.4] }, exhibit: [-0.2, 1.1, 1.5], fog: ['#0a0d13', 9, 34], bounds: [6.2, 6, 6.2] }, ['#6a7fa6', '#15151c', 0.6]);
}

function evidenceRoom(): Env {
  const g = room(7.5, 6.5, 3, { floor: mat('#3c4043', { map: tex.noise('#474c50', 5), rough: 0.6 }), wall: mat('#454b4d', { map: tex.noise('#51585a', 4, 0.05), rough: 0.9 }), ceil: mat('#1a1c1d'), trim: '#222' });
  const sm = mat('#566068', { metal: 0.7, rough: 0.5 });
  for (const z of [-2.9]) for (const x of [-2.4, 0, 2.4]) g.add(group([x, 0, z], 0, shelf(2.2, 2.4, 0.5, sm, 4, (s, y, i) => boxesRow(s, y, 2.2, 0.5, i * 3 + x))));
  for (const z of [-0.6, 1.4]) g.add(group([-3.45, 0, z], PI / 2, shelf(1.8, 2.4, 0.5, sm, 4, (s, y, i) => boxesRow(s, y, 1.8, 0.5, i * 5 + z))));
  g.add(group([0, 0, 0.2], 0, table(2.2, 1.0, 0.86, steel(), sm)), box(0.9, 0.03, 0.6, mat('#fff', { emissive: '#eaf4ff', ei: 0.7 }), [0, 0.875, 0.2]));
  const lb = new THREE.PointLight('#dcecff', 2, 4, 1.6); lb.position.set(0, 1.2, 0.2); g.add(lb);
  for (let x = 1.2; x <= 3.6; x += 0.16) g.add(box(0.015, 3, 0.015, sm, [x, 1.5, 1.8]));       // cage
  for (let y = 0.2; y < 3; y += 0.3) g.add(box(2.5, 0.015, 0.015, sm, [2.4, y, 1.8]));
  for (const x of [-1.6, 1.6]) { g.add(group([x, 2.96, 0], PI / 2, tube(1.4))); const l = new THREE.PointLight('#dceeff', 5, 9, 1.5); l.position.set(x, 2.8, 0); g.add(l); }
  const k = new THREE.SpotLight('#e6f1ff', 22, 8, 0.6, 0.6, 1.4); k.position.set(0.4, 2.9, 1.2); k.target.position.set(0, 0.8, 0.2); k.castShadow = true; k.shadow.mapSize.set(1024, 1024); k.shadow.bias = -0.002; g.add(k, k.target);
  g.add(group([-1.6, 0, 3.22], PI, door(mat('#3a4246', { metal: 0.4 }))), plane(1.2, 0.4, new THREE.MeshBasicMaterial({ color: '#8f8f8f', map: label('EVIDENCE — AUTHORISED PERSONNEL', { bg: '#b8a03a', w: 512, h: 170 }) }), [1.2, 2.5, 3.23], [0, PI, 0]));
  return base('evidence_room', g, { anchors: { detective: A(-1.0, 0, 1.15, 2.5), forensic: A(1.0, 0, 1.15, -2.5), prosecutor: A(1.6, 0, 0.2, -PI / 2) }, wide: { pos: [2.3, 1.9, 2.7], look: [-0.2, 0.95, -0.3] }, exhibit: [0, 1.0, 0.2], fog: ['#0d1113', 6, 18], bounds: [3.5, 2.8, 3.0] }, ['#9db4c4', '#141414', 0.2]);
}

function courtroom(): Env {
  const W = 14, D = 17, H = 6.2;
  const panel = mat('#5a3d28', { map: tex.panel('#5e4029', 7), rough: 0.6 }), wood = mat('#4a3120', { map: tex.wood('#55381f', 2), rough: 0.5 }), dark = mat('#2c1c12', { map: tex.wood('#34220f', 2), rough: 0.5 });
  const g = room(W, D, H, { floor: mat('#3d2a1c', { map: tex.wood('#4a3322', 8), rough: 0.45 }), wall: mat('#cfc4ae', { map: tex.noise('#d6ccb6', 6, 0.04), rough: 0.95 }), ceil: mat('#2b241d'), trim: '#2c1c12' });
  g.add(plane(W, 2.2, panel, [0, 1.1, -D / 2 + 0.02]), plane(D, 2.2, panel, [-W / 2 + 0.02, 1.1, 0], [0, PI / 2, 0]), plane(D, 2.2, panel, [W / 2 - 0.02, 1.1, 0], [0, -PI / 2, 0]));
  // the bench
  g.add(box(6.5, 0.5, 2.6, dark, [0, 0.25, -7.0]), box(4.4, 1.25, 0.7, wood, [0, 1.12, -6.2]), box(4.6, 0.08, 0.9, dark, [0, 1.78, -6.2]), plane(4.2, 0.9, panel, [0, 1.1, -5.84]));
  g.add(group([0, 0.5, -7.1], 0, chair(mat('#3a1512', { rough: 0.6 }), dark, { high: true, arms: true })));
  g.add(cyl(0.9, 0.9, 0.06, mat('#b08a3c', { metal: 0.8, rough: 0.35 }), [0, 4.0, -8.44], [PI / 2, 0, 0], 40), cyl(0.7, 0.7, 0.08, mat('#1c2740', { rough: 0.5 }), [0, 4.0, -8.42], [PI / 2, 0, 0], 40));
  for (const x of [-2.9, 2.9]) g.add(cyl(0.025, 0.025, 2.8, mat('#b08a3c', { metal: 0.8 }), [x, 1.9, -7.9]), box(0.9, 0.6, 0.03, mat(x < 0 ? '#6b1f24' : '#1f2f55', { rough: 0.9 }), [x + 0.45, 2.9, -7.9]));
  g.add(box(0.28, 0.06, 0.12, dark, [0.9, 1.85, -6.1]), cyl(0.035, 0.035, 0.1, wood, [0.75, 1.9, -6.1], [0, 0, PI / 2]));                 // gavel block
  // witness stand
  g.add(box(1.5, 0.25, 1.5, dark, [-3.3, 0.125, -5.4]), box(1.5, 0.9, 0.08, wood, [-3.3, 0.7, -4.69]), box(0.08, 0.9, 1.4, wood, [-4.02, 0.7, -5.4]), box(0.08, 0.9, 1.4, wood, [-2.58, 0.7, -5.4]), group([-3.3, 0.25, -5.55], 0, chair(mat('#3a1512'), dark)));
  // jury box
  g.add(box(1.8, 0.2, 5.0, dark, [5.6, 0.1, -3.2]), box(0.08, 0.95, 5.0, wood, [4.7, 0.6, -3.2]));
  for (const z of [-4.6, -3.2, -1.8]) g.add(group([5.5, 0.2, z], -PI / 2, chair(mat('#3a1512'), dark, { arms: true })));
  // counsel tables, lectern, bar and gallery
  for (const x of [-2.6, 2.6]) { g.add(group([x, 0, -0.9], 0, table(2.6, 1.0, 0.78, wood, dark, 0.07))); for (const dx of [-0.6, 0.6]) g.add(group([x + dx, 0, -0.1], PI, chair(mat('#3a1512'), dark))); g.add(box(0.34, 0.03, 0.24, mat('#e8e0cc'), [x - 0.5, 0.8, -0.9], [0, 0.2, 0]), box(0.3, 0.1, 0.22, mat('#3a2a1a'), [x + 0.6, 0.83, -1.0])); }
  g.add(box(0.6, 1.15, 0.5, wood, [0, 0.575, -2.6]), box(0.7, 0.05, 0.55, dark, [0, 1.17, -2.6], [0.25, 0, 0]));
  for (const x of [-4.2, 4.2]) g.add(box(5.4, 0.08, 0.1, wood, [x, 0.95, 1.4])); for (let x = -6.6; x <= 6.6; x += 0.45) if (Math.abs(x) > 1.4) g.add(cyl(0.03, 0.03, 0.95, dark, [x, 0.475, 1.4], [0, 0, 0], 8));
  for (let r = 0; r < 4; r++) for (const x of [-3.6, 3.6]) g.add(box(5.2, 0.08, 0.5, wood, [x, 0.46, 2.6 + r * 1.3]), box(5.2, 0.5, 0.07, wood, [x, 0.75, 2.86 + r * 1.3]), box(0.08, 0.46, 0.5, dark, [x - 2.5, 0.23, 2.6 + r * 1.3]), box(0.08, 0.46, 0.5, dark, [x + 2.5, 0.23, 2.6 + r * 1.3]));
  // tall windows with afternoon light
  for (const z of [-5, -1.5, 2, 5.5]) g.add(group([-W / 2 + 0.03, 4.0, z], PI / 2, windowLit(1.5, 2.8, '#ffd9a0', { shaft: 5.5, ei: 1.7 })));
  const sun = new THREE.DirectionalLight('#ffd3a0', 2.6); sun.position.set(-9, 9, -1); sun.target.position.set(1, 0, -3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.far = 30; sun.shadow.bias = -0.0015; sun.shadow.radius = 3; g.add(sun, sun.target);
  for (const [x, z] of [[-3, -4], [3, -4], [0, 0], [-3, 4], [3, 4]]) { g.add(group([x, H, z], 0, cyl(0.01, 0.01, 1.2, dark, [0, -0.6, 0], [0, 0, 0], 6), ball(0.22, mat('#fff3d6', { emissive: '#ffdca0', ei: 1.6 }), [0, -1.3, 0]))); const l = new THREE.PointLight('#ffdcaa', 22, 11, 1.7); l.position.set(x, H - 1.4, z); g.add(l); }
  const jb = new THREE.SpotLight('#ffe6c0', 40, 10, 0.5, 0.7, 1.5); jb.position.set(0, 5.6, -4.2); jb.target.position.set(0, 1.6, -7); g.add(jb, jb.target);
  g.add(dust(300, 12, 6, 15, '#ffe3b5', 0.022));
  return base('courtroom', g, {
    anchors: { judge: A(0, 0.5, -7.1, 0, true), witness: A(-3.3, 0.25, -5.55, 0.3, true), prosecutor: A(-3.2, 0, -0.1, PI, true), defense: A(2.0, 0, -0.1, PI, true), defendant: A(3.2, 0, -0.1, PI, true), juror1: A(5.5, 0.2, -4.6, -PI / 2, true), juror2: A(5.5, 0.2, -3.2, -PI / 2, true), juror3: A(5.5, 0.2, -1.8, -PI / 2, true), detective: A(-2.2, 0, 2.62, PI, true), forensic: A(-3.4, 0, 2.62, PI, true), lectern: A(0, 0, -1.9, PI) },
    wide: { pos: [0.6, 3.1, 6.4], look: [0, 1.5, -5.5] }, exhibit: [0, 1.5, -3.6], fog: ['#2a1f16', 14, 46], bounds: [6.6, 5.6, 8.0],
  }, ['#e6d3b4', '#3a2a1c', 0.55]);
}

function juryRoom(): Env {
  const g = room(7, 6, 3, { floor: mat('#4a3f35', { map: tex.noise('#55493e', 5), rough: 1 }), wall: mat('#8b8672', { map: tex.noise('#96917c', 4, 0.04), rough: 0.95 }), ceil: mat('#2a2925'), trim: '#3a2f25' });
  const wood = mat('#5a3f29', { map: tex.wood('#674a30', 2), rough: 0.5 });
  const top = cyl(1.5, 1.5, 0.07, wood, [0, 0.76, 0], [0, 0, 0], 40); top.scale.z = 0.62; g.add(top, cyl(0.12, 0.4, 0.72, mat('#2a1e15'), [0, 0.36, 0]));
  const cs = mat('#39424a', { rough: 0.9 });
  g.add(group([-1.75, 0, 0], PI / 2, chair(cs)), group([1.75, 0, 0], -PI / 2, chair(cs)), group([0, 0, -1.25], 0, chair(cs)), group([0.9, 0, 1.25], PI, chair(cs)), group([-0.9, 0, 1.25], PI, chair(cs)));
  g.add(cyl(0.07, 0.06, 0.24, mat('#cfe6f2', { opacity: 0.5, rough: 0.1 }), [0.2, 0.91, 0]), cyl(0.03, 0.03, 0.1, mat('#cfe6f2', { opacity: 0.5 }), [-0.3, 0.84, 0.2]), cyl(0.03, 0.03, 0.1, mat('#cfe6f2', { opacity: 0.5 }), [0.5, 0.84, -0.25]), box(0.3, 0.015, 0.22, mat('#f1ecdc'), [-0.7, 0.8, -0.1], [0, 0.4, 0]));
  g.add(box(2.4, 1.3, 0.04, mat('#f2f2ee', { rough: 0.3 }), [0, 1.75, -2.97]), plane(2.2, 1.1, new THREE.MeshBasicMaterial({ color: '#8f8f8f', map: label('GUILTY  |  NOT GUILTY', { bg: '#f6f6f2', fg: '#22313f', sub: 'beyond reasonable doubt — every element', w: 768, h: 384 }) }), [0, 1.75, -2.94]));
  g.add(cyl(0.22, 0.22, 0.03, mat('#f4f1e8'), [2.6, 2.3, -2.96], [PI / 2, 0, 0], 28), box(0.012, 0.15, 0.01, mat('#111'), [2.6, 2.36, -2.93]), box(0.1, 0.012, 0.01, mat('#111'), [2.65, 2.3, -2.93]));
  g.add(group([-3.48, 1.65, 0.3], PI / 2, windowLit(1.8, 1.3, '#f2c78a', { blinds: true, shaft: 2.6, ei: 1.4 })));
  const sun = new THREE.SpotLight('#ffcf94', 26, 12, 0.65, 0.7, 1.3); sun.position.set(-3.3, 2.3, 0.3); sun.target.position.set(0.5, 0.4, 0); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.002; g.add(sun, sun.target);
  g.add(group([0, 3, 0], 0, pendant('#ffe1b0', 22, 0.6)), group([3.48, 0, 1.6], -PI / 2, door(mat('#4a3626', { map: tex.wood('#5a4230', 1) }))), group([2.8, 0, -2.4], 0, plant()), dust(90, 5, 2.6, 4, '#ffdcae'));
  return base('jury_room', g, { anchors: { juror1: A(0, 0, -1.25, 0, true), juror2: A(-1.75, 0, 0, PI / 2, true), juror3: A(1.75, 0, 0, -PI / 2, true) }, wide: { pos: [1.5, 2.0, 2.7], look: [0, 0.9, -0.3] }, exhibit: [0, 1.05, 0], fog: ['#1f1a14', 7, 20], bounds: [3.3, 2.8, 2.8] }, ['#c9b693', '#2b241c', 0.5]);
}

function lab(): Env {
  const g = room(9, 7, 3.2, { floor: mat('#7a868b', { map: tex.tiles('#86929a', '#727e85', 9), rough: 0.35 }), wall: mat('#8fa0a6', { map: tex.noise('#9aabb1', 5, 0.04), rough: 0.85 }), ceil: mat('#3a4245'), trim: '#6e7b80' });
  const white = mat('#b9c4c8', { rough: 0.4 }), topM = mat('#2a3237', { rough: 0.25, metal: 0.2 }), glass = (c: string) => mat('#d8f2f4', { opacity: 0.45, rough: 0.05, emissive: c, ei: 0.5 });
  g.add(box(8.2, 0.9, 0.7, white, [0, 0.45, -3.1]), box(8.3, 0.05, 0.75, topM, [0, 0.925, -3.1]), box(3.0, 0.9, 1.1, white, [0, 0.45, -0.4]), box(3.1, 0.05, 1.2, topM, [0, 0.925, -0.4]));
  g.add(box(0.8, 0.025, 0.55, mat('#fff', { emissive: '#e6fbff', ei: 0.8 }), [0, 0.965, -0.4]));
  const il = new THREE.PointLight('#d6f6ff', 2.5, 4, 1.6); il.position.set(0, 1.3, -0.4); g.add(il);
  const micro = () => group([0, 0, 0], 0, box(0.18, 0.03, 0.24, topM, [0, 0.015, 0]), box(0.05, 0.3, 0.05, white, [0, 0.17, -0.08]), cyl(0.035, 0.03, 0.2, white, [0, 0.3, 0.0], [0.5, 0, 0]), cyl(0.02, 0.02, 0.08, topM, [0, 0.14, 0.03]));
  g.add(group([-2.6, 0.95, -3.05], 0, micro()), group([-1.0, 0.95, -0.2], 0.6, micro()));
  [['#3ce0c8', -3.6], ['#ff9f43', -3.3], ['#7c6cff', -3.0], ['#3ce0c8', 2.2], ['#ff5d73', 2.5]].forEach(([c, x], i) => g.add(cyl(0.04, 0.05, 0.16 + (i % 3) * 0.05, glass(c as string), [x as number, 1.04 + (i % 3) * 0.025, -3.15]), cyl(0.036, 0.046, 0.07, mat(c as string, { emissive: c as string, ei: 0.9, opacity: 0.8 }), [x as number, 0.99, -3.15])));
  g.add(group([1.0, 0.95, -3.1], 0, monitor(undefined, '#39d6c2')), group([1.7, 0.95, -3.1], -0.2, monitor(undefined, '#39d6c2')), group([1.1, 0.95, -0.6], -0.5, monitor(undefined, '#6fd8ff')));
  g.add(box(1.6, 1.3, 0.7, mat('#d2dade', { rough: 0.4 }), [3.4, 1.9, -3.1]), plane(1.4, 0.9, mat('#b7e6ea', { opacity: 0.3, rough: 0.05 }), [3.4, 1.8, -2.74]));
  g.add(group([-4.48, 1.7, -0.5], PI / 2, windowLit(2.2, 1.2, '#bfe6ff', { ei: 1.0 })), group([4.2, 0, 2.9], 0, plant()));
  for (const x of [-2.4, 0, 2.4]) { g.add(group([x, 3.16, -1], 0, tube(1.6, '#e9fbff', 1.4))); const l = new THREE.PointLight('#e4f7ff', 4.5, 9, 1.5); l.position.set(x, 3.0, -1); g.add(l); }
  const k = new THREE.SpotLight('#eafcff', 26, 10, 0.7, 0.6, 1.4); k.position.set(1.5, 3.1, 1.8); k.target.position.set(0, 0.9, -0.6); k.castShadow = true; k.shadow.mapSize.set(1024, 1024); k.shadow.bias = -0.002; g.add(k, k.target);
  g.add(group([-3.2, 0, -1.0], 0, cyl(0.2, 0.2, 0.05, topM, [0, 0.55, 0]), cyl(0.03, 0.03, 0.55, steel(), [0, 0.28, 0])));
  return base('lab', g, { anchors: { forensic: A(0.2, 0, -1.25, 0), detective: A(-1.3, 0, 0.75, 2.5), prosecutor: A(1.5, 0, 0.75, -2.5) }, wide: { pos: [2.6, 1.9, 2.8], look: [0, 1.05, -1.0] }, exhibit: [0, 1.15, -0.4], fog: ['#16232a', 8, 26], bounds: [4.2, 2.9, 3.2] }, ['#cfeaf2', '#3d4b50', 0.22]);
}

function archive(): Env {
  const g = room(10, 16, 3.6, { floor: mat('#2b2622', { map: tex.wood('#372f29', 8), rough: 0.7 }), wall: mat('#2d2a26', { map: tex.noise('#37332e', 6, 0.05), rough: 1 }), ceil: mat('#121110'), trim: '#1a1613' });
  const wood = mat('#3f2f22', { map: tex.wood('#4a3626', 1), rough: 0.7 });
  for (let i = 0; i < 6; i++) for (const x of [-3.4, 3.4]) g.add(group([x, 0, -6.5 + i * 2.3], x < 0 ? PI / 2 : -PI / 2, shelf(1.9, 3.0, 0.55, wood, 5, (s, y, r) => boxesRow(s, y, 1.9, 0.55, r * 7 + i, ['#7a6a4c', '#5e5340', '#8a7650', '#4f4a3c', '#6b3a2e']))));
  for (let i = 0; i < 4; i++) g.add(group([0, 3.6, -6 + i * 3.6], 0, pendant('#ffcf8f', i === 2 ? 34 : 20, 1.0, i === 2)));
  g.add(group([0, 0, 1.2], 0, table(2.2, 1.0, 0.78, wood, mat('#241a12'))), group([0.75, 0.785, 1.05], -0.5, lampDesk('#ffd98c', '#1f5a3c', 2.5)));
  g.add(box(0.5, 0.3, 0.36, mat('#8a7650', { rough: 0.9 }), [-0.55, 0.935, 1.15], [0, 0.3, 0]), plane(0.3, 0.14, new THREE.MeshBasicMaterial({ color: '#8f8f8f', map: label('CASE CLOSED', { bg: '#e8e0cc', fg: '#8a1f1f', w: 256, h: 120 }) }), [-0.5, 0.93, 1.345], [0, 0.3, 0]), box(0.34, 0.02, 0.46, mat('#c9b88e'), [0.05, 0.795, 1.25], [0, -0.15, 0]));
  g.add(dust(260, 8, 3.4, 14, '#ffd9a0', 0.02));
  return base('archive', g, { anchors: {}, wide: { pos: [1.5, 1.6, 4.4], look: [-0.1, 1.0, 0.6] }, exhibit: [0, 1.25, 1.2], fog: ['#0b0907', 5, 20], bounds: [3.0, 3.3, 7.6] }, ['#8a6a44', '#0c0a08', 0.25]);
}

const BUILD: Record<SceneId, () => Env> = { interrogation, witness_room: witnessRoom, office, briefing, crime_scene: crimeScene, evidence_room: evidenceRoom, courtroom, jury_room: juryRoom, lab, archive };
export function buildEnv(id: SceneId): Env { const e = BUILD[id](); e.group.name = id; return e; }
