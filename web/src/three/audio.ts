// All sound is synthesised with WebAudio: room tone per location, speech blips per voice, and stings.
import type { SceneId } from '../../../shared/types';

const TONE: Record<SceneId, [number, number, number]> = {   // [drone Hz, noise cutoff Hz, level]
  interrogation: [55, 420, 0.5], witness_room: [98, 900, 0.3], office: [73, 1400, 0.4], briefing: [82, 1100, 0.35], crime_scene: [49, 600, 0.6],
  evidence_room: [110, 2000, 0.4], courtroom: [65, 700, 0.35], jury_room: [98, 800, 0.3], lab: [147, 3200, 0.4], archive: [41, 300, 0.55],
};

export class Sound {
  private ctx: AudioContext | null = null; private master!: GainNode; private amb: { stop: () => void } | null = null; private scene: SceneId | null = null;
  enabled = false;
  enable(on: boolean) {
    this.enabled = on;
    if (on && !this.ctx) { this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination); }
    if (this.ctx) { if (on) { this.ctx.resume(); if (this.scene) this.ambient(this.scene, true); } else { this.amb?.stop(); this.amb = null; this.ctx.suspend(); } }
  }
  ambient(scene: SceneId, force = false) {
    if (this.scene === scene && !force) return; this.scene = scene;
    if (!this.ctx || !this.enabled) return;
    this.amb?.stop();
    const c = this.ctx, [hz, cut, lvl] = TONE[scene], g = c.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(lvl * 0.16, c.currentTime + 1.5); g.connect(this.master);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz; const og = c.createGain(); og.gain.value = 0.5; o.connect(og).connect(g); o.start();
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = hz * 1.5 + 0.7; const o2g = c.createGain(); o2g.gain.value = 0.12; o2.connect(o2g).connect(g); o2.start();
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = c.createBufferSource(); n.buffer = buf; n.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; const ng = c.createGain(); ng.gain.value = 0.35; n.connect(f).connect(ng).connect(g); n.start();
    this.amb = { stop: () => { g.gain.linearRampToValueAtTime(0, c.currentTime + 0.8); setTimeout(() => { o.stop(); o2.stop(); n.stop(); }, 900); } };
  }
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0, slide = 0) {
    if (!this.ctx || !this.enabled) return; const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  /** A soft syllable in the speaker's register: gives each character a recognisable voice without words. */
  blip(pitch: number) { this.tone(pitch * (0.92 + Math.random() * 0.2), 0.07, 'triangle', 0.07); }
  gavel() { this.tone(160, 0.18, 'square', 0.25, 0, -90); this.tone(120, 0.2, 'square', 0.22, 0.24, -70); }
  sting(kind: 'evidence' | 'contradiction' | 'objection' | 'verdict' | 'phase' | 'reveal') {
    if (kind === 'evidence') { this.tone(523, 0.5, 'sine', 0.14); this.tone(784, 0.7, 'sine', 0.12, 0.12); }
    if (kind === 'contradiction') { this.tone(196, 0.9, 'sawtooth', 0.1); this.tone(207, 0.9, 'sawtooth', 0.1); this.tone(98, 1.2, 'sine', 0.2); }
    if (kind === 'objection') { this.tone(330, 0.12, 'square', 0.12); this.tone(440, 0.2, 'square', 0.12, 0.1); }
    if (kind === 'verdict') { for (let i = 0; i < 3; i++) this.tone(220, 1.6, 'sine', 0.2, i * 0.9); this.tone(110, 3, 'sine', 0.18); }
    if (kind === 'phase') { this.tone(147, 1.2, 'sine', 0.16); this.tone(220, 1.4, 'sine', 0.1, 0.15); }
    if (kind === 'reveal') { [220, 262, 330, 392].forEach((f, i) => this.tone(f, 2.2, 'sine', 0.12, i * 0.35)); }
  }
}
