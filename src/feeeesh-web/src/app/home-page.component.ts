import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, MeDto } from './api.service';
import { TankScene } from './tank-scene';

type PrimaryKind = 'daily' | 'cast' | 'tend';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.css'
})
export class HomePageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  @ViewChild('viewport', { static: true }) viewport!: ElementRef<HTMLDivElement>;

  me = signal<MeDto | null>(null);
  status = signal<string | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);
  showSplash = signal(true);
  splashProgress = signal(8);
  splashLabel = signal('Warming the tank…');
  shareCopied = signal(false);

  email = '';
  password = '';
  vanity = '';
  showAuth = false;
  showMore = false;

  private scene?: TankScene;
  private splashTimer?: ReturnType<typeof setInterval>;
  private shareTimer?: ReturnType<typeof setTimeout>;
  private bootStarted = 0;

  primaryAction = computed(() => {
    const m = this.me();
    if (!m) return null;
    if (this.needsUrgentTend(m)) {
      return { kind: 'tend' as PrimaryKind, label: 'Tend tank', pulse: true };
    }
    if (m.dailyClaimAvailable) {
      return { kind: 'daily' as PrimaryKind, label: 'Daily roll', pulse: true };
    }
    return { kind: 'cast' as PrimaryKind, label: 'Cast (15 Pearls)', pulse: false };
  });

  async ngOnInit() {
    this.bootStarted = performance.now();
    this.beginSplash();

    try {
      let me: MeDto;
      try {
        me = await this.api.me();
      } catch {
        const auth = await this.api.guest();
        me = auth.me;
      }
      this.me.set(me);
      this.status.set('Your tank is live');
      this.scene = new TankScene(this.viewport.nativeElement);
      this.scene.setFish(me.tank.fish);
      this.splashProgress.set(100);
      this.splashLabel.set('Ready');
      await this.finishSplash();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to start. Is the API running on :5071?');
      this.status.set('Could not start');
      this.splashLabel.set('Still waiting…');
      this.showSplash.set(false);
    }
  }

  ngOnDestroy() {
    if (this.splashTimer) clearInterval(this.splashTimer);
    if (this.shareTimer) clearTimeout(this.shareTimer);
    this.scene?.dispose();
  }

  private beginSplash() {
    this.splashTimer = setInterval(() => {
      const next = Math.min(92, this.splashProgress() + 7 + Math.random() * 10);
      this.splashProgress.set(next);
      if (next > 40 && next < 75) this.splashLabel.set('Calling fish…');
      if (next >= 75) this.splashLabel.set('Almost there…');
    }, 180);
  }

  private async finishSplash() {
    if (this.splashTimer) {
      clearInterval(this.splashTimer);
      this.splashTimer = undefined;
    }
    const elapsed = performance.now() - this.bootStarted;
    // Keep splash visible briefly so the wordmark + load bar can read.
    const wait = Math.max(0, 1400 - elapsed);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.showSplash.set(false);
    // Tank was created while splash covered the viewport — ensure correct size.
    queueMicrotask(() => window.dispatchEvent(new Event('resize')));
  }

  private needsUrgentTend(m: MeDto) {
    return m.tank.fish.some((f) => f.inTank && (f.care === 'NeedsCare' || f.care === 'Down'));
  }

  private applyMe(me: MeDto) {
    this.me.set(me);
    this.scene?.setFish(me.tank.fish);
    this.error.set(null);
  }

  async runPrimary() {
    const action = this.primaryAction();
    if (!action) return;
    if (action.kind === 'daily') return this.daily();
    if (action.kind === 'cast') return this.cast();
    return this.tend();
  }

  async daily() {
    this.busy.set(true);
    try {
      const r = await this.api.daily();
      this.status.set(`Daily catch: ${r.fish.speciesName} (${r.fish.rarity})`);
      const me = await this.api.me();
      this.applyMe(me);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Daily failed');
    } finally {
      this.busy.set(false);
    }
  }

  async cast() {
    this.busy.set(true);
    try {
      const r = await this.api.cast();
      this.status.set(`Cast: ${r.fish.speciesName} (${r.fish.rarity})`);
      const me = await this.api.me();
      this.applyMe(me);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Cast failed');
    } finally {
      this.busy.set(false);
    }
  }

  async tend() {
    this.busy.set(true);
    try {
      const me = await this.api.tend();
      this.status.set('Tank tended');
      this.applyMe(me);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Tend failed');
    } finally {
      this.busy.set(false);
    }
  }

  async register() {
    this.busy.set(true);
    try {
      const r = await this.api.register(this.email, this.password);
      this.applyMe(r.me);
      this.status.set('Account linked');
      this.showAuth = false;
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Register failed');
    } finally {
      this.busy.set(false);
    }
  }

  async login() {
    this.busy.set(true);
    try {
      const r = await this.api.login(this.email, this.password);
      this.applyMe(r.me);
      this.status.set('Welcome back');
      this.showAuth = false;
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Login failed');
    } finally {
      this.busy.set(false);
    }
  }

  async claimVanity() {
    this.busy.set(true);
    try {
      const me = await this.api.claimVanity(this.vanity);
      this.applyMe(me);
      this.status.set(`Vanity slug claimed: /t/${this.vanity}`);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Vanity failed');
    } finally {
      this.busy.set(false);
    }
  }

  shareUrl(me: MeDto) {
    return `${location.origin}${me.tank.publicPath}`;
  }

  async copyShare(me: MeDto) {
    const url = this.shareUrl(me);
    try {
      await navigator.clipboard.writeText(url);
      this.shareCopied.set(true);
      if (this.shareTimer) clearTimeout(this.shareTimer);
      this.shareTimer = setTimeout(() => this.shareCopied.set(false), 1800);
      this.status.set(`Share link ready: ${me.tank.publicPath}`);
      this.error.set(null);
    } catch {
      this.status.set(url);
    }
  }
}
