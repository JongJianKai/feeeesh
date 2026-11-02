import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, MeDto } from './api.service';
import { TankScene } from './tank-scene';

type Screen = 'splash' | 'lobby' | 'tank';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.css'
})
export class HomePageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  @ViewChild('viewport') viewport?: ElementRef<HTMLDivElement>;

  me = signal<MeDto | null>(null);
  status = signal<string | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);
  screen = signal<Screen>('splash');
  splashProgress = signal(8);
  shareCopied = signal(false);
  showMore = false;
  showAuth = false;

  email = '';
  password = '';
  vanity = '';

  private scene?: TankScene;
  private splashTimer?: ReturnType<typeof setInterval>;
  private shareTimer?: ReturnType<typeof setTimeout>;
  private bootStarted = 0;

  summonLabel = computed(() => {
    const m = this.me();
    if (!m) return 'Daily free roll';
    if (m.dailyClaimAvailable) return 'Daily free roll';
    return 'Cast for Pearls';
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
      this.status.set('Your tank is ready');
      this.splashProgress.set(100);
      await this.finishSplash();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to start. Is the API running on :5071?');
      this.status.set('Could not start');
      this.screen.set('lobby');
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
    }, 180);
  }

  private async finishSplash() {
    if (this.splashTimer) {
      clearInterval(this.splashTimer);
      this.splashTimer = undefined;
    }
    const elapsed = performance.now() - this.bootStarted;
    const wait = Math.max(0, 1600 - elapsed);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.screen.set('lobby');
  }

  async openTank() {
    this.screen.set('tank');
    this.error.set(null);
    // wait for viewport to mount
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const host = this.viewport?.nativeElement;
    if (!host) return;
    if (!this.scene) {
      this.scene = new TankScene(host);
    }
    const me = this.me();
    if (me) await this.scene.setFish(me.tank.fish);
    this.scene.resize();
    this.status.set('Watching your tank');
  }

  backToLobby() {
    this.screen.set('lobby');
    // keep scene alive but hidden host may be destroyed — dispose and recreate next open
    this.scene?.dispose();
    this.scene = undefined;
  }

  private applyMe(me: MeDto) {
    this.me.set(me);
    void this.scene?.setFish(me.tank.fish);
    this.error.set(null);
  }

  async summon() {
    const m = this.me();
    if (!m) return;
    this.busy.set(true);
    try {
      if (m.dailyClaimAvailable) {
        const r = await this.api.daily();
        this.status.set(`Daily free roll: ${r.fish.speciesName} (${r.fish.rarity})`);
      } else {
        const r = await this.api.cast();
        this.status.set(`Cast for Pearls: ${r.fish.speciesName} (${r.fish.rarity})`);
      }
      const me = await this.api.me();
      this.applyMe(me);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Summon failed');
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
