import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { FeedComponent } from './components/feed/feed';
import { ChatComponent } from './components/chat/chat';
import { SettingsComponent } from './components/settings/settings';
import { LayoutComponent } from './components/layout/layout';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: 'feed', component: FeedComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'settings', component: SettingsComponent },
    ],
  },
];
