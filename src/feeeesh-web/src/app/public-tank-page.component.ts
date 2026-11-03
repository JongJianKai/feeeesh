import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, TankDto } from './api.service';
import { TankScene } from './tank-scene';

@Component({
  selector: 'app-public-tank-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="fe-visit">
      <div #viewport class="fe-visit__tank" aria-label="Public Feeeesh tank"></div>

      <div class="fe-visit__chrome">
        <header class="fe-visit__top">
          <a routerLink="/" class="fe-wordmark fe-wordmark--tilt" aria-label="Feeeesh">
            F<span class="fe-wordmark__accent">eee</span>sh
          </a>
          <div class="fe-status-chip">
            <span>Visiting /t/{{ slug }}</span>
            @if (tank(); as t) {
              <span>{{ t.occupied }}/{{ t.capacity }} fish</span>
            }
          </div>
        </header>

        <div class="fe-visit__bottom">
          @if (error()) {
            <p class="fe-toast fe-toast--error">{{ error() }}</p>
          }
          <div class="fe-visit__actions">
            <button type="button" class="fe-share" (click)="copyLink()">
              {{ copied() ? 'Link copied' : 'Copy link' }}
            </button>
            <a routerLink="/" class="fe-pill fe-pill--ghost fe-visit__own">Make your own tank</a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .fe-visit {
        position: fixed;
        inset: 0;
        z-index: 1;
        width: 100%;
        height: 100%;
        height: 100dvh;
        overflow: hidden;
        overscroll-behavior: none;
        background: #3fb0d4;
      }
      .fe-visit__tank {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      .fe-visit__tank canvas {
        display: block;
        width: 100% !important;
        height: 100% !important;
        touch-action: none;
      }
      .fe-visit__chrome {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 1.25rem 1.5rem 1.5rem;
        overflow: hidden;
      }
      .fe-visit__chrome a,
      .fe-visit__chrome button,
      .fe-visit__chrome .fe-status-chip,
      .fe-visit__chrome .fe-toast {
        pointer-events: auto;
      }
      .fe-visit__top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .fe-visit__top .fe-wordmark {
        text-decoration: none;
        font-size: clamp(2rem, 4vw, 2.8rem);
      }
      .fe-visit__bottom {
        display: grid;
        gap: 0.75rem;
      }
      .fe-visit__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
      }
      .fe-visit__own {
        text-decoration: none;
      }
      .fe-toast {
        margin: 0;
        max-width: max-content;
        padding: 0.45rem 0.85rem;
        border-radius: var(--fe-radius-pill);
        background: var(--fe-glass);
        border: 1px solid var(--fe-glass-border);
        color: var(--fe-muted);
        font: 600 0.85rem/1.3 var(--fe-font-ui);
      }
      .fe-toast--error {
        color: #ffb4a8;
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
  copied = signal(false);
  private scene?: TankScene;
  private copyTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.scene = new TankScene(this.viewport.nativeElement);
    try {
      const tank = await this.api.publicTank(this.slug);
      this.tank.set(tank);
      await this.scene.setFish(tank.fish);
      this.scene.resize();
    } catch {
      this.error.set('Tank not found.');
    }
  }

  ngOnDestroy() {
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.scene?.dispose();
  }

  async copyLink() {
    const url = `${location.origin}/t/${this.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      if (this.copyTimer) clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => this.copied.set(false), 1800);
    } catch {
      this.error.set(url);
    }
  }
}
