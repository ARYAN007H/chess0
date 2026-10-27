/** Tiny synthesized UI sounds via WebAudio — no audio assets needed. */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx === null) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function blip(ac: AudioContext, freq: number, start: number, duration: number, type: OscillatorType, volume: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  gain.gain.setValueAtTime(volume, ac.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + duration + 0.02);
}

export type SoundKind = 'move' | 'capture' | 'check' | 'end';

export function playSound(kind: SoundKind): void {
  const ac = audio();
  if (ac === null) return;
  switch (kind) {
    case 'move':
      blip(ac, 520, 0, 0.07, 'triangle', 0.18);
      blip(ac, 260, 0.01, 0.05, 'sine', 0.12);
      break;
    case 'capture':
      blip(ac, 200, 0, 0.09, 'square', 0.1);
      blip(ac, 340, 0.02, 0.06, 'triangle', 0.14);
      break;
    case 'check':
      blip(ac, 660, 0, 0.08, 'triangle', 0.16);
      blip(ac, 880, 0.09, 0.1, 'triangle', 0.16);
      break;
    case 'end':
      blip(ac, 392, 0, 0.12, 'triangle', 0.14);
      blip(ac, 494, 0.12, 0.12, 'triangle', 0.14);
      blip(ac, 587, 0.24, 0.2, 'triangle', 0.16);
      break;
  }
}
