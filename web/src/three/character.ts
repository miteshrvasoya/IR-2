// A procedural, articulated character: one coherent stylised look for every agent, dressed by role,
// animated entirely in code (breathing, gaze, speech, gestures, sitting, standing, walking).
import * as THREE from 'three';
import { mat, mesh, box, cyl, ball } from './kit';

export interface Look { skin: string; hair: string; hairStyle: string; accent: string; build?: number; outfit?: string }
type Gesture = 'object' | 'point' | 'gavel' | 'slump' | 'nod' | 'shake' | 'examine' | 'shrug' | 'present';

const OUTFITS: Record<string, (a: string) => { top: string; legs: string; shirt: string; tie?: string; coat?: number; apron?: boolean; hood?: boolean; badge?: boolean; collar?: boolean }> = {
  detective: (a) => ({ top: '#8a7353', legs: '#26262b', shirt: '#e4dfd3', tie: a, coat: 0.5 }),
  forensic: () => ({ top: '#a9b3b8', legs: '#34414b', shirt: '#3d8a8a', coat: 0.55 }),
  prosecutor: (a) => ({ top: '#1c2740', legs: '#1c2740', shirt: '#f2f0ea', tie: a }),
  defense: (a) => ({ top: '#3a3537', legs: '#2a2729', shirt: '#f2f0ea', tie: a }),
  judge: () => ({ top: '#0d0d10', legs: '#0d0d10', shirt: '#f4f2ee', coat: 0.86, collar: true }),
  juror: (a) => ({ top: a, legs: '#33333c', shirt: '#d9d4c8' }),
  blazer: (a) => ({ top: a, legs: '#1f1f24', shirt: '#efe9df' }),
  hoodie: (a) => ({ top: a, legs: '#3a4354', shirt: a, hood: true }),
  suit: (a) => ({ top: '#22242a', legs: '#22242a', shirt: '#f2f0ea', tie: a }),
  uniform: (a) => ({ top: a, legs: '#1c2430', shirt: '#b9c4d0', badge: true }),
  apron: () => ({ top: '#f1eee8', legs: '#24242a', shirt: '#f1eee8', apron: true }),
};

const capsule = (r: number, len: number, m: THREE.Material) => { const o = mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m); o.position.y = -len / 2 - r * 0.2; return o; };

export class Character {
  root = new THREE.Group();
  private body = new THREE.Group(); private torso = new THREE.Group(); private head = new THREE.Group();
  private armL = new THREE.Group(); private armR = new THREE.Group(); private foreL = new THREE.Group(); private foreR = new THREE.Group();
  private legL = new THREE.Group(); private legR = new THREE.Group(); private shinL = new THREE.Group(); private shinR = new THREE.Group();
  private mouth!: THREE.Mesh; private eyes: THREE.Mesh[] = [];
  private phase = Math.random() * 10; private sitT = 0; private sitGoal = 0;
  private gesture: { type: Gesture; t: number; dur: number } | null = null;
  private yaw = 0; private pitch = 0;
  private walk: { to: THREE.Vector3; face: number; sit: boolean; done?: () => void } | null = null;
  talking = false; talkAmp = 1; lookTarget: THREE.Vector3 | null = null; scale = 1;
  headPos = new THREE.Vector3();

  constructor(public seat: string, public role: string, look: Look) {
    const s = (this.scale = look.build ?? 1), o = (OUTFITS[look.outfit || ''] || OUTFITS[role] || OUTFITS.juror)(look.accent);
    const skin = mat(look.skin, { rough: 0.65 }), top = mat(o.top, { rough: 0.85 }), legs = mat(o.legs, { rough: 0.9 }), shirt = mat(o.shirt, { rough: 0.8 }), hair = mat(look.hair, { rough: 0.7 }), shoe = mat('#141416', { rough: 0.5 });
    this.root.add(this.body); this.body.position.y = 0.92;
    // legs
    for (const [leg, shin, x] of [[this.legL, this.shinL, -0.095], [this.legR, this.shinR, 0.095]] as const) {
      leg.position.set(x * s, 0, 0); leg.add(capsule(0.075 * s, 0.34, legs));
      shin.position.y = -0.44; shin.add(capsule(0.062 * s, 0.34, legs));
      const foot = box(0.1 * s, 0.07, 0.24, shoe, [0, -0.45, 0.05]); shin.add(foot);
      leg.add(shin); this.body.add(leg);
    }
    // torso
    this.body.add(this.torso);
    const chest = mesh(new THREE.CapsuleGeometry(0.17 * s, 0.3, 6, 14), top, [0, 0.3, 0]); chest.scale.set(1.12, 1, 0.72); this.torso.add(chest);
    this.torso.add(box(0.3 * s, 0.14, 0.2, legs, [0, 0.02, 0]));                                  // hips
    const front = box(0.085 * s, 0.2, 0.02, shirt, [0, 0.43, 0.116]); this.torso.add(front);          // shirt front
    if (o.tie) this.torso.add(box(0.03, 0.19, 0.012, mat(o.tie, { rough: 0.5 }), [0, 0.425, 0.128]));
    if (o.collar) this.torso.add(box(0.16, 0.05, 0.03, mat('#f6f4ef'), [0, 0.55, 0.11]));
    if (o.badge) this.torso.add(box(0.045, 0.055, 0.01, mat('#d9b44a', { metal: 0.8, rough: 0.3 }), [-0.09 * s, 0.44, 0.125]));
    if (o.apron) this.torso.add(box(0.3 * s, 0.62, 0.015, mat('#1d2a3a', { rough: 0.9 }), [0, 0.08, 0.135]));
    if (o.hood) { const h = mesh(new THREE.SphereGeometry(0.13 * s, 12, 8), top, [0, 0.56, -0.08]); h.scale.set(1.2, 0.7, 0.9); this.torso.add(h); }
    if (o.coat) { const len = o.coat, sk = mesh(new THREE.CylinderGeometry(0.19 * s, 0.24 * s, len, 16, 1, true), mat(o.top, { rough: 0.85, side: THREE.DoubleSide }), [0, -len / 2 + 0.1, 0]); sk.scale.z = 0.78; this.torso.add(sk); }
    // arms
    for (const [arm, fore, x] of [[this.armL, this.foreL, -1], [this.armR, this.foreR, 1]] as const) {
      arm.position.set(x * 0.225 * s, 0.5, 0); arm.add(capsule(0.052 * s, 0.22, top));
      fore.position.y = -0.3; fore.add(capsule(0.045 * s, 0.2, top)); fore.add(ball(0.042 * s, skin, [0, -0.29, 0]));
      arm.add(fore); this.torso.add(arm);
    }
    // head
    this.head.position.y = 0.6; this.torso.add(this.head);
    this.head.add(cyl(0.05 * s, 0.055 * s, 0.1, skin, [0, 0.02, 0], [0, 0, 0], 10));
    const skull = mesh(new THREE.SphereGeometry(0.118, 22, 18), skin, [0, 0.17, 0]); skull.scale.set(0.95, 1.12, 1); this.head.add(skull);
    const dark = mat('#17120f', { rough: 0.4 });
    const white = mat('#f4f1ea', { rough: 0.35 });
    for (const x of [-0.04, 0.04]) {
      const w = mesh(new THREE.SphereGeometry(0.017, 10, 8), white, [x, 0.182, 0.098], [0, 0, 0], false); w.scale.set(1.25, 0.8, 0.6); this.head.add(w);
      const e = mesh(new THREE.SphereGeometry(0.0085, 8, 8), dark, [x, 0.182, 0.109], [0, 0, 0], false); this.eyes.push(e, w); this.head.add(e);
      const b = box(0.036, 0.006, 0.008, hair, [x, 0.207, 0.108]); b.rotation.z = x < 0 ? 0.12 : -0.12; b.castShadow = false; this.head.add(b);
    }
    const nose = mesh(new THREE.SphereGeometry(0.014, 8, 6), skin, [0, 0.152, 0.116]); nose.scale.set(0.8, 1.3, 1); this.head.add(nose);
    this.mouth = box(0.036, 0.007, 0.008, mat('#6e3a33', { rough: 0.6 }), [0, 0.118, 0.106]); this.mouth.castShadow = false; this.head.add(this.mouth);
    for (const x of [-0.115, 0.115]) this.head.add(ball(0.022, skin, [x, 0.17, 0]));
    this.hair(look.hairStyle, hair);
    this.root.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; } });
  }

  private hair(style: string, m: THREE.Material) {
    const h = this.head, cap = (sy = 1, back = 0) => { const c = mesh(new THREE.SphereGeometry(0.124, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), m, [0, 0.176, -0.014 - back]); c.scale.set(1.0, sy * 1.08, 1.06); c.rotation.x = -0.42; h.add(c); return c; };
    switch (style) {
      case 'bun': cap(1.05); h.add(ball(0.055, m, [0, 0.27, -0.09])); break;
      case 'bob': cap(1.05); for (const x of [-0.1, 0.1]) { const b = mesh(new THREE.CapsuleGeometry(0.035, 0.1, 4, 8), m, [x, 0.115, -0.03]); h.add(b); } { const b = mesh(new THREE.SphereGeometry(0.11, 12, 8), m, [0, 0.12, -0.06]); b.scale.set(1.05, 0.9, 0.6); h.add(b); } break;
      case 'pony': cap(1.03); { const p = mesh(new THREE.CapsuleGeometry(0.03, 0.16, 4, 8), m, [0, 0.16, -0.15]); p.rotation.x = 0.5; h.add(p); } break;
      case 'messy': cap(1.12); for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; h.add(ball(0.04, m, [Math.cos(a) * 0.075, 0.275 + (i % 2) * 0.012, Math.sin(a) * 0.075 - 0.01])); } break;
      case 'slick': cap(0.98, 0.006); break;
      case 'balding': { const r = mesh(new THREE.TorusGeometry(0.108, 0.03, 8, 20, Math.PI * 1.25), m, [0, 0.17, -0.01]); r.rotation.set(Math.PI / 2, 0, Math.PI * 0.875 + Math.PI / 2); h.add(r); } break;
      case 'braids': cap(1.08); for (const x of [-0.09, 0.09]) { const p = mesh(new THREE.CapsuleGeometry(0.022, 0.2, 4, 8), m, [x, 0.07, -0.05]); h.add(p); } break;
      default: cap(1.0);
    }
  }

  place(pos: THREE.Vector3, face: number, sit: boolean) { this.walk = null; this.root.position.copy(pos); this.root.rotation.y = face; this.sitGoal = this.sitT = sit ? 1 : 0; }
  goTo(pos: THREE.Vector3, face: number, sit: boolean, done?: () => void) { this.sitGoal = 0; this.walk = { to: pos.clone(), face, sit, done }; }
  setSit(v: boolean) { this.sitGoal = v ? 1 : 0; }
  get sitting() { return this.sitGoal > 0.5; }
  play(type: Gesture, dur = 1.6) { this.gesture = { type, t: 0, dur }; }

  update(dt: number, time: number) {
    const t = time + this.phase, L = THREE.MathUtils.lerp, k = Math.min(1, dt * 6);
    // --- locomotion ---
    let stride = 0;
    if (this.walk) {
      const d = this.walk.to.clone().sub(this.root.position); d.y = 0; const dist = d.length();
      if (this.sitT > 0.15) { /* stand up first */ }
      else if (dist < 0.06) { const w = this.walk; this.walk = null; this.root.position.copy(w.to); this.root.rotation.y = w.face; this.sitGoal = w.sit ? 1 : 0; w.done?.(); }
      else { d.normalize(); this.root.position.addScaledVector(d, Math.min(dist, dt * 1.5)); const want = Math.atan2(d.x, d.z); let diff = want - this.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); this.root.rotation.y += diff * Math.min(1, dt * 8); stride = Math.sin(t * 9) * 0.55; }
    }
    this.sitT = L(this.sitT, this.sitGoal, Math.min(1, dt * 4));
    const s = this.sitT;
    this.body.position.y = L(0.92, 0.56, s) + (stride ? Math.abs(Math.sin(t * 9)) * 0.02 : 0);
    this.legL.rotation.x = L(stride, -1.5, s); this.legR.rotation.x = L(-stride, -1.5, s);
    this.shinL.rotation.x = L(Math.max(0, -stride) * 0.9, 1.5, s); this.shinR.rotation.x = L(Math.max(0, stride) * 0.9, 1.5, s);

    // --- breathing & base posture ---
    const breathe = Math.sin(t * 1.5) * 0.012;
    this.torso.scale.y = 1 + breathe;
    let torsoX = L(0.02, 0.06, s) + Math.sin(t * 0.4) * 0.01, torsoY = 0, headX = 0, headZ = Math.sin(t * 0.33) * 0.02, headYaw = 0;
    let aLx = L(0.04 + stride * 0.7, -0.55, s), aRx = L(0.04 - stride * 0.7, -0.55, s), aLz = -0.1, aRz = 0.1, fL = L(-0.18, -0.95, s), fR = L(-0.18, -0.95, s);

    // --- speech ---
    const amp = this.talking ? this.talkAmp : 0;
    if (amp) {
      aRx += -0.35 * amp + Math.sin(t * 2.7) * 0.22 * amp; fR += -0.5 * amp + Math.sin(t * 3.9 + 1) * 0.3 * amp; aRz += 0.12 * amp;
      aLx += Math.sin(t * 2.1 + 2) * 0.1 * amp; fL += -0.2 * amp + Math.sin(t * 3.1) * 0.15 * amp;
      headX += Math.sin(t * 4.6) * 0.035; headYaw += Math.sin(t * 1.3) * 0.06; torsoX += Math.sin(t * 1.9) * 0.015;
    }
    this.mouth.scale.y = L(this.mouth.scale.y, amp ? 1 + Math.abs(Math.sin(t * 13)) * 2.6 * (0.6 + 0.4 * Math.sin(t * 3.3)) : 1, 0.5);
    const blink = Math.sin(t * 0.9) > 0.985 || Math.sin(t * 2.3 + 1) > 0.995; for (let i = 0; i < this.eyes.length; i += 2) { this.eyes[i].scale.y = blink ? 0.1 : 1; this.eyes[i + 1].scale.y = blink ? 0.1 : 0.8; }

    // --- gaze: head (and a little torso) turn toward whoever matters ---
    let wantYaw = 0, wantPitch = 0;
    if (this.lookTarget && !this.walk) {
      const local = this.root.worldToLocal(this.lookTarget.clone()); const hy = this.body.position.y + 0.75;
      wantYaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.25, 1.25);
      wantPitch = THREE.MathUtils.clamp(-Math.atan2(local.y - hy, Math.hypot(local.x, local.z)), -0.45, 0.45);
    }
    this.yaw = L(this.yaw, wantYaw, Math.min(1, dt * 4)); this.pitch = L(this.pitch, wantPitch, Math.min(1, dt * 4));
    torsoY += this.yaw * 0.3; headYaw += this.yaw * 0.7; headX += this.pitch;

    // --- gestures ---
    const g = this.gesture;
    if (g) {
      g.t += dt; const p = g.t / g.dur, env = Math.sin(Math.min(1, p) * Math.PI) ** 0.5;
      if (g.type === 'object') { aRx = L(aRx, -2.75, env); fR = L(fR, -0.15, env); aRz = L(aRz, 0.25, env); torsoX -= 0.05 * env; }
      if (g.type === 'point' || g.type === 'present') { aRx = L(aRx, -1.4, env); fR = L(fR, -0.05, env); aRz = L(aRz, -0.1 + this.yaw * 0.6, env); }
      if (g.type === 'gavel') { const hit = Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p); aRx = L(aRx, -1.0, env); fR = L(fR, -1.5 + hit * 1.3, env); }
      if (g.type === 'slump') { torsoX += 0.3 * env; headX += 0.45 * env; aLx = L(aLx, -0.2, env); aRx = L(aRx, -0.2, env); }
      if (g.type === 'nod') headX += Math.sin(p * Math.PI * 4) * 0.16 * (1 - p);
      if (g.type === 'shake') headYaw += Math.sin(p * Math.PI * 5) * 0.3 * (1 - p);
      if (g.type === 'examine') { torsoX += 0.32 * env; headX += 0.3 * env; aRx = L(aRx, -0.9, env); fR = L(fR, -0.8, env); }
      if (g.type === 'shrug') { aLz -= 0.35 * env; aRz += 0.35 * env; fL = L(fL, -1.2, env); fR = L(fR, -1.2, env); }
      if (p >= 1) this.gesture = null;
    }
    this.torso.rotation.x = L(this.torso.rotation.x, torsoX, k); this.torso.rotation.y = L(this.torso.rotation.y, torsoY, k);
    this.head.rotation.set(L(this.head.rotation.x, headX, k), L(this.head.rotation.y, headYaw, k), headZ);
    this.armL.rotation.set(L(this.armL.rotation.x, aLx, k), 0, L(this.armL.rotation.z, aLz, k)); this.armR.rotation.set(L(this.armR.rotation.x, aRx, k), 0, L(this.armR.rotation.z, aRz, k));
    this.foreL.rotation.x = L(this.foreL.rotation.x, fL, k); this.foreR.rotation.x = L(this.foreR.rotation.x, fR, k);
    this.head.getWorldPosition(this.headPos); this.headPos.y += 0.17;
  }
}
