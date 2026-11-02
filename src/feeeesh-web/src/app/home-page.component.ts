import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, MeDto } from './api.service';
import { TankScene } from './tank-scene';

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
  status = signal('Starting Feeeesh…');
  error = signal<string | null>(null);
  email = '';
  password = '';
  vanity = '';
  showAuth = false;

  private scene?: TankScene;

  async ngOnInit() {
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
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to start. Is the API running on :5071?');
    }
  }

  ngOnDestroy() {
    this.scene?.dispose();
  }

  private applyMe(me: MeDto) {
    this.me.set(me);
    this.scene?.setFish(me.tank.fish);
    this.error.set(null);
  }

  async daily() {
    try {
      const r = await this.api.daily();
      this.status.set(`Daily catch: ${r.fish.speciesName} (${r.fish.rarity})`);
      const me = await this.api.me();
      this.applyMe(me);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Daily failed');
    }
  }

  async cast() {
    try {
      const r = await this.api.cast();
      this.status.set(`Cast: ${r.fish.speciesName} (${r.fish.rarity})`);
      const me = await this.api.me();
      this.applyMe(me);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Cast failed');
    }
  }

  async tend() {
    try {
      const me = await this.api.tend();
      this.status.set('Tank tended');
      this.applyMe(me);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Tend failed');
    }
  }

  async register() {
    try {
      const r = await this.api.register(this.email, this.password);
      this.applyMe(r.me);
      this.status.set('Account linked');
      this.showAuth = false;
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Register failed');
    }
  }

  async login() {
    try {
      const r = await this.api.login(this.email, this.password);
      this.applyMe(r.me);
      this.status.set('Welcome back');
      this.showAuth = false;
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Login failed');
    }
  }

  async claimVanity() {
    try {
      const me = await this.api.claimVanity(this.vanity);
      this.applyMe(me);
      this.status.set(`Vanity slug claimed: /t/${this.vanity}`);
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Vanity failed');
    }
  }

  shareUrl(me: MeDto) {
    return `${location.origin}${me.tank.publicPath}`;
  }
}
