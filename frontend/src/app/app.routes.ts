import { inject } from '@angular/core';
import { Routes, CanActivateFn, Router } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { FeedComponent } from './components/feed/feed';
import { ChatComponent } from './components/chat/chat';
import { SettingsComponent } from './components/settings/settings';
import { LayoutComponent } from './components/layout/layout';
import { ApiService } from './services/api.service';

const redirectRoot: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  router.navigate([api.currentUser() ? '/feed' : '/login']);
  return false;
};

export const routes: Routes = [
  { path: '', canActivate: [redirectRoot], pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: 'feed', component: FeedComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'chat/:userId', component: ChatComponent },
      { path: 'settings', component: SettingsComponent },
    ],
  },
];
