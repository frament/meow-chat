/**
 * Whether the current address can be shown without a session.
 *
 * The failure this exists for: a session can disappear while the app is open -
 * an expired token whose refresh is refused, or a logout from another tab - and
 * the app stayed exactly where it was. The profile then showed nobody signed in
 * and the mobile bottom bar was gone, which reads as a broken app rather than as
 * "you have been signed out", and the only way out was guessing that the profile
 * page still had a "Выход" button.
 *
 * Pure and exported: the decision is a comparison of two strings, and a branch
 * that returns early before this is reachable becomes untestable.
 */
const PUBLIC_ROUTES = ['/login', '/register'];

export function shouldRedirectToLogin(hasUser: boolean, url: string): boolean {
  if (hasUser) return false;
  const path = (url.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  return !PUBLIC_ROUTES.includes(path);
}
