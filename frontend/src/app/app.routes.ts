import { Component, OnInit, inject } from '@angular/core';
import { Routes, Router } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { FeedComponent } from './components/feed/feed';
import { ChatComponent } from './components/chat/chat';
import { SettingsComponent } from './components/settings/settings';
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

export const routes: Routes = [
  { path: '', component: RootRedirect, pathMatch: 'full' },
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
