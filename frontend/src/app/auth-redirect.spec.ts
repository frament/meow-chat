import { shouldRedirectToLogin } from './auth-redirect';

describe('shouldRedirectToLogin', () => {
  it('stays where it is when there is a session', () => {
    expect(shouldRedirectToLogin(true, '/chat/2')).toBeFalse();
    expect(shouldRedirectToLogin(true, '/login')).toBeFalse();
  });

  it('sends an app without a session to the login page', () => {
    // The prod report: no bottom bar, nobody signed in on the profile page, and
    // the only way out was finding the logout button.
    expect(shouldRedirectToLogin(false, '/chat/2')).toBeTrue();
    expect(shouldRedirectToLogin(false, '/profile')).toBeTrue();
    expect(shouldRedirectToLogin(false, '/')).toBeTrue();
  });

  it('leaves the pages that exist for signed-out people alone', () => {
    expect(shouldRedirectToLogin(false, '/login')).toBeFalse();
    expect(shouldRedirectToLogin(false, '/register')).toBeFalse();
    expect(shouldRedirectToLogin(false, '/login?redirect=/chat/2')).toBeFalse();
    expect(shouldRedirectToLogin(false, '/login/')).toBeFalse();
  });
});
