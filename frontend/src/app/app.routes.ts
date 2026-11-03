import { Component, OnInit, inject } from '@angular/core';
import { Routes, Router } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { FeedComponent } from './components/feed/feed';
import { DeviceAuthComponent } from './components/device-auth/device-auth';
import { LayoutComponent } from './components/layout/layout';
import { ApiService } from './services/api.service';

@Component({ template: '', standalone: true })
class RootRedirect implements OnInit {
  #api = inject(ApiService);
  #router = inject(Router);
  ngOnInit() {
    this.#router.navigate([this.#api.currentUser() ? '/feed' : '/login']);
  }
}

/**
 * Which components ship in the initial bundle is a decision about the phone on a
 * bad link, not about tidiness.
 *
 * The initial bundle is downloaded before anything is drawn. `chat` alone is over
 * two thousand lines, `settings` pulls `qrcode` (a CommonJS package esbuild warns
 * about), and both admin screens are used by one person out of a household. None
 * of them are needed to show the login screen or the feed, so they are loaded on
 * navigation - `loadComponent` - and the phone stops paying for them on open.
 *
 * Kept static on purpose: login, register, feed and the layout. These are what the
 * app shows first, and a lazy chunk for them would add a round-trip to the one
 * screen that must appear fastest.
 *
 * `provideRouter` is configured without a preload strategy: `PreloadAllModules`
 * would download every chunk right after start-up and undo exactly this, which is
 * worth remembering before anyone adds it "for speed".
 */
export const routes: Routes = [
  { path: '', component: RootRedirect, pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  {
    path: 'add-friend',
    loadComponent: () => import('./components/add-friend/add-friend').then((m) => m.AddFriendComponent),
  },
  {
    path: 'join-group',
    loadComponent: () => import('./components/join-group/join-group').then((m) => m.JoinGroupComponent),
  },
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: 'feed', component: FeedComponent },
      { path: 'chat', loadComponent: () => import('./components/chat/chat').then((m) => m.ChatComponent) },
      { path: 'chat/:userId', loadComponent: () => import('./components/chat/chat').then((m) => m.ChatComponent) },
      {
        path: 'chat/group/:groupId',
        loadComponent: () => import('./components/chat/chat').then((m) => m.ChatComponent),
      },
      { path: 'device-auth', component: DeviceAuthComponent },
      {
        path: 'settings',
        loadComponent: () => import('./components/settings/settings').then((m) => m.SettingsComponent),
      },
      {
        path: 'admin',
        loadComponent: () => import('./components/admin/admin').then((m) => m.AdminComponent),
      },
      {
        path: 'admin/federation',
        loadComponent: () =>
          import('./components/admin-federation/admin-federation').then((m) => m.AdminFederationComponent),
      },
    ],
  },
];
