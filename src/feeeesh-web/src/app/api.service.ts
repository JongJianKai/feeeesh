import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface FishDto {
  id: string;
  speciesId: string;
  speciesName: string;
  rarity: string;
  colorHex: string;
  accentHex: string;
  size: number;
  inTank: boolean;
  posX: number;
  posY: number;
  posZ: number;
  care: string;
  nickname: string | null;
  acquiredAt: string;
}

export interface TankDto {
  id: string;
  slug: string;
  vanitySlug: string | null;
  publicPath: string;
  capacity: number;
  occupied: number;
  fish: FishDto[];
}

export interface MeDto {
  userId: string;
  isGuest: boolean;
  email: string | null;
  emailConfirmed: boolean;
  pearls: number;
  dailyClaimAvailable: boolean;
  tank: TankDto;
}

export interface AuthResponse {
  token: string;
  me: MeDto;
}

export interface AcquireResultDto {
  fish: FishDto;
  pearlsRemaining: number;
  source: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  /** Same-origin via Angular dev proxy → API :5071 (cookies stay on :4200). */
  private readonly base = '';

  guest() {
    return firstValueFrom(this.http.post<AuthResponse>(`${this.base}/api/auth/guest`, {}, { withCredentials: true }));
  }

  me() {
    return firstValueFrom(this.http.get<MeDto>(`${this.base}/api/me`, { withCredentials: true }));
  }

  register(email: string, password: string) {
    return firstValueFrom(
      this.http.post<AuthResponse>(`${this.base}/api/auth/register`, { email, password }, { withCredentials: true })
    );
  }

  login(email: string, password: string) {
    return firstValueFrom(
      this.http.post<AuthResponse>(`${this.base}/api/auth/login`, { email, password }, { withCredentials: true })
    );
  }

  claimVanity(slug: string) {
    return firstValueFrom(
      this.http.post<MeDto>(`${this.base}/api/me/vanity`, { slug }, { withCredentials: true })
    );
  }

  daily() {
    return firstValueFrom(this.http.post<AcquireResultDto>(`${this.base}/api/game/daily`, {}, { withCredentials: true }));
  }

  cast() {
    return firstValueFrom(this.http.post<AcquireResultDto>(`${this.base}/api/game/cast`, {}, { withCredentials: true }));
  }

  tend(fishId?: string) {
    const q = fishId ? `?fishId=${fishId}` : '';
    return firstValueFrom(this.http.post<MeDto>(`${this.base}/api/game/tend${q}`, {}, { withCredentials: true }));
  }

  publicTank(slug: string) {
    return firstValueFrom(this.http.get<TankDto>(`${this.base}/api/tanks/${encodeURIComponent(slug)}`));
  }
}
