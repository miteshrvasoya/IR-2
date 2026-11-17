// The Stage is the bridge from simulation events to the 3D world: it owns the renderer, builds
// environments and characters, and directs every validated event as staging, gesture, light and camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneId, SimEvent } from '../../../shared/types';
import { buildEnv, type Env, type Anchor } from './scenes';
import { Character, type Look } from './character';
import { Sound } from './audio';
import { mat, box, cyl, plane, ball, label, group } from './kit';

export interface CastSeat { id: string; role: string; characterId?: string; look: Look | null; name: string | null }

const Grade = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, flash: { value: 0 }, tint: { value: new THREE.Color(1, 0.2, 0.15) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float flash; uniform vec3 tint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))+time)*43758.5453); }
    void main(){ vec2 d=vUv-0.5; float r=dot(d,d);
      vec3 c=vec3(texture2D(tDiffuse,vUv+d*r*0.012).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-d*r*0.012).b);
      c*=smoothstep(1.05,0.2,r*1.45); c+= (h(vUv*vec2(1920.,1080.))-0.5)*0.022; c=mix(c, c*tint*1.6+tint*0.12, flash*smoothstep(0.0,0.5,r*2.0+0.2));
      gl_FragColor=vec4(c,1.0); }`,
};

function prop(v: { kind: string; color?: string }): THREE.Group {
  const g = new THREE.Group(), paper = mat('#f1ecdf', { rough: 0.9 }), dark = mat('#141416', { rough: 0.4 });
  const lines = (w: number, n: number, y0: number) => { for (let i = 0; i < n; i++) g.add(box(w * (0.5 + ((i * 37) % 10) / 22), 0.004, 0.012, mat('#3a3a3a'), [-w * 0.05, y0 + 0.004, -0.11 + i * 0.03])); };
  switch (v.kind) {
    case 'photos': for (let i = 0; i < 3; i++) { const p = group([i * 0.07 - 0.07, i * 0.006, 0], (i - 1) * 0.3, box(0.26, 0.006, 0.19, paper), box(0.22, 0.007, 0.15, mat(['#2b3440', '#40332a', '#27333a'][i], { rough: 0.3 }), [0, 0.001, 0])); g.add(p); } break;
    case 'document': g.add(box(0.24, 0.02, 0.32, paper)); lines(0.2, 8, 0.01); break;
    case 'printout': g.add(box(0.26, 0.006, 0.42, paper), box(0.26, 0.006, 0.02, mat('#9fc3a0'), [0, 0.001, -0.2])); lines(0.2, 9, 0.004); break;
    case 'monitor': g.add(box(0.44, 0.28, 0.03, dark, [0, 0.16, 0]), box(0.4, 0.24, 0.006, mat('#0a1622', { emissive: '#7fb8ff', ei: 1.4 }), [0, 0.16, 0.018]), box(0.06, 0.02, 0.02, mat('#f33', { emissive: '#ff3322', ei: 3 }), [0.14, 0.25, 0.022])); break;
    case 'cloth': { const c = mat(v.color || '#7a1f33', { rough: 1 }); const a = ball(0.16, c, [0, 0.05, 0]); a.scale.set(1.5, 0.35, 1); const b = ball(0.1, c, [0.14, 0.07, 0.06]); b.scale.set(1.2, 0.5, 1); g.add(a, b); for (let i = 0; i < 7; i++) g.add(box(0.008, 0.008, 0.07, c, [-0.2 + i * 0.03, 0.02, 0.17], [0, (i % 3 - 1) * 0.2, 0])); break; }
    case 'prints': g.add(box(0.3, 0.008, 0.2, dark)); for (let i = 0; i < 3; i++) for (let r = 1; r <= 3; r++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.008 * r, 0.008 * r + 0.003, 20), new THREE.MeshBasicMaterial({ color: '#7fe8ff' })); m.rotation.x = -Math.PI / 2; m.position.set(-0.09 + i * 0.09, 0.006, 0); m.scale.y = 1.3; g.add(m); } break;
    case 'phone': g.add(box(0.09, 0.012, 0.18, dark), box(0.08, 0.002, 0.16, mat('#0c1420', { emissive: '#8fc0ff', ei: 1.2 }), [0, 0.007, 0])); g.scale.setScalar(1.6); break;
    case 'ledger': case 'book': g.add(box(0.26, 0.04, 0.34, mat(v.kind === 'ledger' ? '#1f3a2c' : '#3a2a1a', { rough: 0.7 })), box(0.24, 0.03, 0.32, paper, [0.006, 0.006, 0]), box(0.12, 0.002, 0.05, mat('#d9b44a', { metal: 0.7 }), [0, 0.022, -0.08])); break;
    case 'usb': g.add(box(0.03, 0.012, 0.07, mat(v.color || '#c0392b', { rough: 0.4 })), box(0.022, 0.008, 0.03, mat('#c8ccd0', { metal: 0.9, rough: 0.25 }), [0, 0, 0.05])); g.scale.setScalar(3.2); break;
    default: g.add(box(0.2, 0.12, 0.2, mat('#8a7650')));
  }
  g.traverse((m) => { m.castShadow = true; });
  return g;
}

export class Stage {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(38, 1, 0.08, 120);
  sound = new Sound();
  private composer: EffectComposer; private grade: ShaderPass; private controls: OrbitControls;
  private envs = new Map<SceneId, Env>(); private env!: Env; private liveScene: SceneId = 'office'; private present: string[] = [];
  private chars = new Map<string, Character>(); private cast: CastSeat[] = [];
  private stand: string | null = null; private defendant: string | null = null; private speaker: string | null = null;
  private want = { pos: new THREE.Vector3(3, 2, 4), look: new THREE.Vector3(0, 1, 0), fov: 38 }; private look = new THREE.Vector3(0, 1, 0);
  private drift = 0; private propObj: THREE.Group | null = null; private propLight = new THREE.SpotLight('#fff2d8', 0, 6, 0.5, 0.6, 1.5);
  private boardCards = new Map<string, THREE.Object3D>();
  private clock = new THREE.Clock(); private raf = 0; private ro: ResizeObserver; private shot = 0; private blipT = 0;
  free = false; tour: SceneId | null = null; fade = 0; private fadeGoal = 0; onFade: (v: number) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    host.appendChild(this.renderer.domElement);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.24, 0.6, 0.94));
    this.composer.addPass(new OutputPass()); this.grade = new ShaderPass(Grade); this.composer.addPass(this.grade);   // grade in display space
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enabled = false; this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.52; this.controls.enablePan = false;
    this.scene.add(this.propLight, this.propLight.target);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); this.resize();
    this.swap('office', true);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); }; loop();
  }
  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.sound.enable(false); this.renderer.dispose(); this.renderer.domElement.remove(); }
  private inset = 0;
  /** Keep the subject centred in the part of the frame not covered by a side panel. */
  setInset(px: number) { this.inset = px; this.resize(); }
  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1; this.renderer.setSize(w, h); this.composer.setSize(w, h); this.camera.aspect = w / h;
    if (this.inset && w > 900) this.camera.setViewOffset(w, h, this.inset / 2, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ---------- cast ----------
  setCast(seats: CastSeat[], defendant: string | null) {
    this.cast = seats; this.defendant = defendant;
    for (const s of seats) if (s.look && !this.chars.has(s.id)) { const c = new Character(s.id, s.role, s.look); c.root.visible = false; this.chars.set(s.id, c); this.scene.add(c.root); }
  }
  private anchorName(seat: string): string {
    const role = this.cast.find((c) => c.id === seat)?.role || '', id = this.env.id;
    if (id === 'courtroom') return seat === this.stand ? 'witness' : seat === this.defendant ? 'defendant' : this.env.anchors[seat] ? seat : role;
    if (id === 'interrogation' || id === 'witness_room') return role === 'detective' ? 'detective' : 'subject';
    return this.env.anchors[seat] ? seat : role;
  }
  private anchorOf(seat: string, i: number): Anchor {
    const a = this.env.anchors[this.anchorName(seat)]; if (a) return a;
    const [lx, , lz] = this.env.wide.look; return { p: [lx + (i - 1.5) * 0.9, 0, lz + 1.6 + (i % 2) * 0.5], face: Math.PI, sit: false };
  }
  private arrange(instant: boolean) {
    const here = this.tour && this.tour !== this.liveScene ? [] : this.present;
    let extra = 0;
    for (const [seat, c] of this.chars) {
      const on = here.includes(seat), was = c.root.visible;
      c.root.visible = on; if (!on) continue;
      const a = this.anchorOf(seat, this.env.anchors[this.anchorName(seat)] ? 0 : extra++), pos = new THREE.Vector3(...a.p);
      if (instant || !was || c.root.position.distanceTo(pos) > 14) c.place(pos, a.face, !!a.sit);
      else if (c.root.position.distanceTo(pos) > 0.15) c.goTo(pos, a.face, !!a.sit);
      else c.setSit(!!a.sit);
    }
  }

  // ---------- scenes ----------
  private swap(id: SceneId, instant: boolean) {
    if (this.env) this.scene.remove(this.env.group);
    if (!this.envs.has(id)) this.envs.set(id, buildEnv(id));
    this.env = this.envs.get(id)!; this.scene.add(this.env.group);
    const [fc, fn, ff] = this.env.fog; this.scene.fog = new THREE.Fog(fc, fn, ff); this.scene.background = new THREE.Color(fc);
    this.clearProp(); this.arrange(true); this.sound.ambient(id);
    this.wide(instant); this.refreshBoard();
    this.controls.target.set(...this.env.wide.look); this.controls.maxDistance = new THREE.Vector3(...this.env.wide.pos).distanceTo(this.controls.target) * 1.15; this.controls.minDistance = 0.8;
    if (this.free) { this.camera.position.set(...this.env.wide.pos); this.camera.fov = 44; this.camera.updateProjectionMatrix(); }
  }
  setScene(id: SceneId, present: string[], instant = false) {
    this.liveScene = id; this.present = present; this.stand = null;
    if (this.tour && this.tour !== id) return;
    if (this.env.id === id) { this.arrange(instant); return; }
    if (instant) { this.swap(id, true); return; }
    this.fadeGoal = 1; setTimeout(() => { this.swap(this.tour || this.liveScene, true); this.fadeGoal = 0; }, 420);
  }
  /** Spectator tour: look around any location without disturbing the live proceeding. */
  visit(id: SceneId | null) {
    this.tour = id; this.setFree(!!id);
    this.fadeGoal = 1; setTimeout(() => { this.swap(id || this.liveScene, true); this.fadeGoal = 0; }, 300);
  }
  setFree(on: boolean) { this.free = on; this.controls.enabled = on; if (on) { this.controls.target.copy(this.look); } }

  // ---------- camera ----------
  private clamp(p: THREE.Vector3) { const [bx, by, bz] = this.env.bounds; if (this.env.id === 'crime_scene') { const r = Math.hypot(p.x, p.z); if (r > bx) p.multiplyScalar(bx / r).setY(p.y); } else { p.x = THREE.MathUtils.clamp(p.x, -bx, bx); p.z = THREE.MathUtils.clamp(p.z, -bz, bz); } p.y = THREE.MathUtils.clamp(p.y, 0.5, by); return p; }
  private cut(pos: THREE.Vector3, look: THREE.Vector3, fov: number, hard = false) { this.want.pos.copy(this.clamp(pos)); this.want.look.copy(look); this.want.fov = fov; if (hard) { this.camera.position.copy(this.want.pos); this.look.copy(look); this.camera.fov = fov; this.camera.updateProjectionMatrix(); } }
  wide(hard = false) { const w = this.env.wide; this.cut(new THREE.Vector3(...w.pos), new THREE.Vector3(...w.look), 42, hard); }
  private head(seat: string) { const c = this.chars.get(seat); if (!c || !c.root.visible) return null; const h = new THREE.Vector3(...[c.root.position.x, c.root.position.y + (c.sitting ? 1.28 : 1.64), c.root.position.z]); return { c, h, f: new THREE.Vector3(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y)) }; }
  closeUp(seat: string, side = 1, dist = 1.5, hard = true) {
    const s = this.head(seat); if (!s) return this.wide();
    const right = new THREE.Vector3(s.f.z, 0, -s.f.x);
    const d = dist * 1.55;
    this.cut(s.h.clone().addScaledVector(s.f, d).addScaledVector(right, 0.42 * side * d).add(new THREE.Vector3(0, 0.12, 0)), s.h.clone().add(new THREE.Vector3(0, -0.16, 0)), 33, hard);
  }
  private overShoulder(listener: string, speaker: string) {
    const l = this.head(listener), s = this.head(speaker); if (!l || !s) return this.closeUp(speaker);
    const d = s.h.clone().sub(l.h).setY(0).normalize(), right = new THREE.Vector3(d.z, 0, -d.x);
    this.cut(l.h.clone().addScaledVector(d, -1.15).addScaledVector(right, 0.6).add(new THREE.Vector3(0, 0.28, 0)), s.h.clone().add(new THREE.Vector3(0, -0.1, 0)), 36, true);
  }
  private twoShot(a: string, b: string) {
    const A = this.head(a), B = this.head(b); if (!A || !B) return this.wide();
    const mid = A.h.clone().add(B.h).multiplyScalar(0.5), d = B.h.clone().sub(A.h).setY(0), len = d.length(); d.normalize();
    this.cut(mid.clone().add(new THREE.Vector3(d.z, 0, -d.x).multiplyScalar(Math.max(2.2, len * 1.25))).add(new THREE.Vector3(0, 0.25, 0)), mid, 36, true);
  }

  // ---------- props & board ----------
  private clearProp() { if (this.propObj) { this.scene.remove(this.propObj); this.propObj = null; } this.propLight.intensity = 0; }
  showProp(v: { kind: string; color?: string }, focus: boolean) {
    this.clearProp(); const p = prop(v), [x, y, z] = this.env.exhibit;
    p.position.set(x, y + 0.12, z); p.scale.multiplyScalar(1.5); p.rotation.x = 0.35; this.scene.add(p); this.propObj = p;
    this.propLight.position.set(x + 0.4, y + 1.6, z + 0.8); this.propLight.target.position.set(x, y, z); this.propLight.intensity = 26;
    if (focus) this.cut(new THREE.Vector3(x + 0.75, y + 0.62, z + 1.05), new THREE.Vector3(x, y + 0.12, z), 30, true);
  }
  private evidence: { id: string; title: string }[] = [];
  addEvidence(id: string, title: string) { if (!this.evidence.some((e) => e.id === id)) { this.evidence.push({ id, title }); this.refreshBoard(); } }
  private refreshBoard() {
    const b = this.env?.board; if (!b) return;
    this.evidence.forEach((e, i) => {
      if (this.boardCards.has(e.id)) { if (this.boardCards.get(e.id)!.parent !== b) b.add(this.boardCards.get(e.id)!); return; }
      const col = i % 5, row = Math.floor(i / 5);
      const card = group([-1.6 + col * 0.8 + (row % 2) * 0.1, 0.55 - row * 0.62, 0.04], 0, plane(0.62, 0.42, new THREE.MeshBasicMaterial({ map: label(e.title, { w: 384, h: 256, sub: e.id, accent: '#8a1f1f' }) })), ball(0.02, mat('#c0392b', { rough: 0.3 }), [0, 0.19, 0.01]));
      card.rotation.z = ((i * 37) % 9 - 4) * 0.015; this.boardCards.set(e.id, card); b.add(card);
    });
  }

  /** Forget everything case-specific (used when seeking in a replay). */
  reset() { this.quiet(); this.clearProp(); this.evidence = []; for (const c of this.boardCards.values()) c.parent?.remove(c); this.boardCards.clear(); this.stand = null; this.defendant = null; this.present = []; this.arrange(true); }
  autoRotate(on: boolean) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 0.35; }
  // ---------- directing events ----------
  flash(color: [number, number, number], amount = 1) { (this.grade.uniforms.tint.value as THREE.Color).setRGB(...color); this.grade.uniforms.flash.value = amount; }
  private quiet() { for (const c of this.chars.values()) c.talking = false; if (this.speaker && this.env.id === 'courtroom' && ['prosecutor', 'defense'].includes(this.speaker)) this.chars.get(this.speaker)?.setSit(true); this.speaker = null; }
  setDefendant(d: string | null) { this.defendant = d; }

  /** Stage one simulation event. `instant` applies its lasting effects without animation (catch-up / seek). */
  apply(e: SimEvent, instant = false) {
    const d = e.data || {}, seat = e.actor?.seatId, me = seat ? this.chars.get(seat) : undefined;
    if (e.type === 'scene') { this.quiet(); this.setScene(d.scene, d.present || [], instant); return; }
    if (e.type === 'evidence') { this.addEvidence(d.id, d.title); if (!instant && !this.tour) { this.quiet(); this.showProp(d.visual, true); me?.play('examine', 2.4); this.sound.sting('evidence'); } return; }
    if (e.type === 'speech' && e.kind === 'charge') this.defendant = d.suspect;
    if (e.type === 'stand') { this.stand = d.seat || null; if (!this.tour) { this.arrange(instant); if (!instant && d.seat) setTimeout(() => this.closeUp(d.seat, 1, 2.6, false), 900); } return; }
    if (instant || this.tour) return;
    this.shot++;
    switch (e.type) {
      case 'speech': {
        this.quiet(); this.clearProp(); if (!me || !me.root.visible) { this.wide(); return; }
        this.speaker = seat!; me.talking = true; me.talkAmp = ['objection', 'closing', 'opening', 'charge'].includes(e.kind || '') ? 1.5 : e.kind === 'answer' ? 0.7 : 1;
        const target = e.target && this.chars.get(e.target)?.root.visible ? e.target : null;
        for (const [id, c] of this.chars) if (c.root.visible && id !== seat) c.lookTarget = me.headPos.clone();
        me.lookTarget = target ? this.chars.get(target)!.headPos.clone() : this.camera.position.clone();
        const lawyer = this.env.id === 'courtroom' && (seat === 'prosecutor' || seat === 'defense');
        if (lawyer) me.setSit(false);
        const side = e.seq % 2 ? 1 : -1, k = e.kind || '';
        if (k === 'objection') { me.play('object', 1.8); this.sound.sting('objection'); this.flash([1, 0.75, 0.2], 0.5); setTimeout(() => this.closeUp(seat!, side, 1.25), lawyer ? 350 : 0); }
        else if (k === 'ruling' || k === 'judgment' || k === 'sentence') { if (this.env.id === 'courtroom') { me.play('gavel', 1.2); this.sound.gavel(); } this.closeUp(seat!, side, 1.9); }
        else if (k === 'opening' || k === 'closing' || k === 'instructions' || k === 'report' || k === 'assessment') { this.closeUp(seat!, side, 2.4); setTimeout(() => { if (this.speaker === seat) this.closeUp(seat!, -side, 1.4, false); }, 3200); }
        else if (k === 'charge' || k === 'call' || k === 'warrant_request') { me.play('point', 2); this.closeUp(seat!, side, 1.8); }
        else if (target && this.shot % 5 === 0) this.twoShot(seat!, target);
        else if (target && this.shot % 3 === 0) this.overShoulder(target, seat!);
        else this.closeUp(seat!, side, k === 'answer' ? 1.25 : 1.5);
        if (k === 'lab_report' || k === 'deliberation') me.play('present', 2);
        break;
      }
      case 'present': this.showProp(d.visual, false); me?.play('present', 2); if (e.target) setTimeout(() => this.closeUp(e.target!, 1, 1.3, true), 1300); break;
      case 'contradiction': { this.quiet(); this.flash([1, 0.15, 0.1], 1); this.sound.sting('contradiction'); const t = e.target && this.chars.get(e.target); if (t && t.root.visible) { t.play('slump', 4); this.closeUp(e.target!, 1, 1.15); } break; }
      case 'admission': if (me) { me.play('slump', 2.5); this.flash([0.4, 0.7, 1], 0.5); } break;
      case 'action': this.quiet(); this.wide(true); me?.play('examine', 3); break;
      case 'lab': this.quiet(); me?.play('point', 1.6); break;
      case 'phase': this.quiet(); this.sound.sting('phase'); this.wide(true); break;
      case 'narration': case 'lead': case 'warrant': case 'system': this.quiet(); if (e.type === 'narration') this.wide(true); break;
      case 'evidence_status': this.quiet(); this.flash(d.status === 'admitted' ? [0.5, 1, 0.6] : [1, 0.3, 0.2], 0.6); if (d.status !== 'admitted') this.sound.gavel(); break;
      case 'theory_shift': case 'vote_change': me?.play('shake', 1.6); if (seat) this.closeUp(seat, 1, 1.3); break;
      case 'verdict': { this.quiet(); this.sound.sting('verdict'); this.wide(true); const def = this.defendant; if (def) setTimeout(() => { this.closeUp(def, 1, 1.2); this.chars.get(def)?.play(d.kind === 'convicted' ? 'slump' : 'nod', 5); this.flash(d.kind === 'convicted' ? [1, 0.2, 0.15] : [0.5, 1, 0.7], 0.8); }, 3200); break; }
      case 'reveal': this.quiet(); this.sound.sting('reveal'); this.wide(true); this.flash([1, 0.8, 0.4], 0.7); break;
      case 'case': this.wide(true); break;
    }
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime;
    this.env.tick(t);
    for (const c of this.chars.values()) if (c.root.visible) c.update(dt, t);
    if (this.speaker && this.sound.enabled && (this.blipT -= dt) < 0) { this.blipT = 0.085 + Math.random() * 0.05; const c = this.chars.get(this.speaker)!; this.sound.blip(150 + (1.2 - c.scale) * 420 + (this.speaker.charCodeAt(0) % 7) * 12); }
    if (this.propObj) { this.propObj.rotation.y += dt * 0.5; this.propObj.position.y = this.env.exhibit[1] + 0.14 + Math.sin(t * 1.4) * 0.015; }
    if (this.free) { this.controls.update(); this.clamp(this.camera.position); }
    else {
      this.drift += dt; const k = 1 - Math.exp(-dt * 2.2);
      const sway = new THREE.Vector3(Math.sin(this.drift * 0.31) * 0.035, Math.sin(this.drift * 0.23) * 0.02, Math.cos(this.drift * 0.27) * 0.035);
      this.want.pos.addScaledVector(this.want.look.clone().sub(this.want.pos).normalize(), dt * 0.018);          // imperceptible push-in keeps shots alive
      this.camera.position.lerp(this.want.pos.clone().add(sway), k); this.look.lerp(this.want.look, k);
      this.camera.fov += (this.want.fov - this.camera.fov) * k; this.camera.updateProjectionMatrix(); this.camera.lookAt(this.look);
    }
    this.grade.uniforms.time.value = t % 100; this.grade.uniforms.flash.value *= Math.exp(-dt * 2.2);
    if (Math.abs(this.fade - this.fadeGoal) > 0.01) { this.fade += Math.sign(this.fadeGoal - this.fade) * Math.min(Math.abs(this.fadeGoal - this.fade), dt * 3.2); this.onFade(this.fade); }
    this.composer.render();
  }
}
