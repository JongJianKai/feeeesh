import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, TankDto } from './api.service';
import { TankScene } from './tank-scene';

@Component({
  selector: 'app-public-tank-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="shell">
      <header class="top">
        <a routerLink="/" class="brand">Feeeesh</a>
        <p class="tag">Visiting /t/{{ slug }}</p>
        @if (tank(); as t) {
          <p class="tag">{{ t.occupied }}/{{ t.capacity }} fish swimming</p>
        }
      </header>
      <div #viewport class="viewport"></div>
      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
      <p class="hint"><a routerLink="/">Make your own tank</a></p>
    </div>
  `,
  styles: [
    `
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
        background: linear-gradient(180deg, #071820, #0b2a3a 50%, #0a1f2b);
        color: #e8f4f8;
        font-family: 'Segoe UI', 'Trebuchet MS', sans-serif;
      }
      .top {
        padding: 1.25rem 1.5rem;
      }
      .brand {
        font-size: 2.4rem;
        font-weight: 800;
        color: #f4fbff;
        text-decoration: none;
      }
      .tag {
        margin: 0.25rem 0 0;
        opacity: 0.85;
      }
      .viewport {
        width: min(1200px, 100%);
        margin: 0 auto;
        min-height: 480px;
      }
      .err,
      .hint {
        padding: 1rem 1.5rem;
      }
      .hint a {
        color: #9be7ff;
      }
    `
  ]
})
export class PublicTankPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  @ViewChild('viewport', { static: true }) viewport!: ElementRef<HTMLDivElement>;

  slug = '';
  tank = signal<TankDto | null>(null);
  error = signal<string | null>(null);
  private scene?: TankScene;

  async ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.scene = new TankScene(this.viewport.nativeElement);
    try {
      const tank = await this.api.publicTank(this.slug);
      this.tank.set(tank);
      this.scene.setFish(tank.fish);
    } catch {
      this.error.set('Tank not found.');
    }
  }

  ngOnDestroy() {
    this.scene?.dispose();
  }
}
