import { Routes } from '@angular/router';
import { HomePageComponent } from './home-page.component';
import { PublicTankPageComponent } from './public-tank-page.component';

export const routes: Routes = [
  { path: '', component: HomePageComponent },
  { path: 't/:slug', component: PublicTankPageComponent },
  { path: '**', redirectTo: '' }
];
