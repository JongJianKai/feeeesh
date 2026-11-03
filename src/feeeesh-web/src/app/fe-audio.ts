/**
 * Tiny Web Audio cues — no asset files, synthesized.
 * Muted until first user gesture (browser autoplay policy).
 */

type Cue = 'boot' | 'ui' | 'enter' | 'summon' | 'tend' | 'rare';

class FeeeeshAudio {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private ambientNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private ambientOn = false;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    return this.ctx;
  }

  /** Call from a click / key so later cues can play. */
  unlock() {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    this.unlocked = true;
  }

  play(cue: Cue, rarity?: string) {
    this.unlock();
    const ctx = this.ensure();
    if (!ctx || !this.unlocked) return;

    switch (cue) {
      case 'boot':
        this.chime(ctx, [523.25, 659.25, 783.99], 0.07, 0.12);
        break;
      case 'ui':
        this.blip(ctx, 880, 0.035, 0.05);
        break;
      case 'enter':
        this.chime(ctx, [392, 523.25], 0.05, 0.1);
        break;
      case 'tend':
        this.chime(ctx, [440, 554.37, 659.25], 0.045, 0.09);
        break;
      case 'summon':
      case 'rare': {
        const r = (rarity ?? 'Common').toLowerCase();
        if (r.includes('legend')) this.fanfare(ctx, [523.25, 659.25, 783.99, 1046.5], 0.09);
        else if (r.includes('rare')) this.chime(ctx, [587.33, 739.99, 880], 0.07, 0.14);
        else if (r.includes('uncommon')) this.chime(ctx, [493.88, 622.25], 0.055, 0.11);
        else this.blip(ctx, 698.46, 0.05, 0.08);
        break;
      }
    }
  }

  startAmbient() {
    this.unlock();
    const ctx = this.ensure();
    if (!ctx || this.ambientOn) return;
    this.ambientOn = true;

    const specs: Array<[number, number]> = [
      [55, 0.012],
      [82.5, 0.008],
      [110, 0.006]
    ];
    for (const [freq, vol] of specs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sine';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 280;
      gain.gain.value = vol;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      this.ambientNodes.push({ osc, gain });
    }
  }

  stopAmbient() {
    for (const n of this.ambientNodes) {
      try {
        n.gain.gain.exponentialRampToValueAtTime(0.0001, (this.ctx?.currentTime ?? 0) + 0.35);
        n.osc.stop((this.ctx?.currentTime ?? 0) + 0.4);
      } catch {
        /* already stopped */
      }
    }
    this.ambientNodes = [];
    this.ambientOn = false;
  }

  private blip(ctx: AudioContext, freq: number, vol: number, dur: number) {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private chime(ctx: AudioContext, freqs: number[], vol: number, step: number) {
    freqs.forEach((f, i) => {
      const t0 = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
  }

  private fanfare(ctx: AudioContext, freqs: number[], vol: number) {
    freqs.forEach((f, i) => {
      const t0 = ctx.currentTime + i * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    });
  }
}

export const feAudio = new FeeeeshAudio();
