import { Component, OnInit, inject } from '@angular/core';
import { Routes, Router } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { FeedComponent } from './components/feed/feed';
import { ChatComponent } from './components/chat/chat';
import { SettingsComponent } from './components/settings/settings';
import { AdminComponent } from './components/admin/admin';
import { AdminFederationComponent } from './components/admin-federation/admin-federation';
import { AddFriendComponent } from './components/add-friend/add-friend';
import { JoinGroupComponent } from './components/join-group/join-group';
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
  { path: 'add-friend', component: AddFriendComponent },
  { path: 'join-group', component: JoinGroupComponent },
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: 'feed', component: FeedComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'chat/:userId', component: ChatComponent },
      { path: 'chat/group/:groupId', component: ChatComponent },
      { path: 'settings', component: SettingsComponent },
      { path: 'admin', component: AdminComponent },
      { path: 'admin/federation', component: AdminFederationComponent },
    ],
  },
];
