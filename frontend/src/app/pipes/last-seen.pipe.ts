import { Pipe, PipeTransform } from '@angular/core';

/**
 * Renders a `last_seen` timestamp as short relative Russian time, for the
 * friends list and the admin users table.
 *
 * Short forms on purpose: these go into a 48px-tall sidebar row next to an
 * avatar and an unread badge, and a long sentence does not fit.
 *
 * Russian needs real pluralisation - "1 минуту", "2 минуты", "5 минут" - so
 * this is not a lookup table. `plural()` implements the rule: n%10 in 2..4 and
 * n%100 not in 12..14 gives the "2-4" form, n%10==1 and n%100!=11 gives the
 * singular, everything else the "many" form.
 */
@Pipe({ name: 'lastSeen', standalone: true, pure: true })
export class LastSeenPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '';
    const ts = value instanceof Date ? value.getTime() : Date.parse(value);
    if (Number.isNaN(ts)) return '';

    const seconds = Math.floor((Date.now() - ts) / 1000);
    // A future timestamp means clock skew between the phone and the server, not
    // a user who left in the future. Anything under a minute reads as "just now",
    // which is also true for a person who stepped away a few seconds ago.
    if (seconds < 60) return 'только что';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;

    const weeks = Math.floor(days / 7);
    if (days < 30) return `${weeks} ${plural(weeks, 'неделю', 'недели', 'недель')} назад`;

    const months = Math.floor(days / 30);
    if (days < 365) return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;

    const years = Math.floor(days / 365);
    return `${years} ${plural(years, 'год', 'года', 'лет')} назад`;
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
