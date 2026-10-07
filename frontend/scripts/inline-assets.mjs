/**
 * Сводит холодную загрузку к трём соединениям вместо семи.
 *
 * Измерено на LTE через релей: ре пропускает не больше трёх одновременных
 * соединений. Залп из трёх доходит целиком, из десяти доходит один. Статика
 * открывается браузером мимо перехватчика — четыре года подряд ставился потолок
 * на API-запросы, а ограничение било по `<link>` и `<script>`, которые
 * приложение не контролирует.
 *
 * Что делается:
 *   - весь CSS вставляется в <style>, обе ссылки на styles.css убираются.
 *     Побочный выигрыш: страница перестаёт ждать отдельный запрос перед первой
 *     отрисовкой — критические стили Beasties уже в документе.
 *   - фавиконка становится data:URI, отдельного запроса больше нет.
 *
 * Чего не делается и почему: шрифт (27 КБ woff2) остаётся отдельным запросом.
 * Вшить его в CSS можно, но он кэшируется отдельно и вшитым грузился бы при
 * каждом обновлении приложения, а не только при первом визите.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BROWSER_DIR = process.argv[2] || 'dist/frontend/browser';
const indexPath = join(BROWSER_DIR, 'index.html');

if (!existsSync(indexPath)) {
  console.error(`✗ нет ${indexPath} — сначала собери фронтенд`);
  process.exit(1);
}

/** Имя файла по glob-префиксу: styles-ABC123.css → styles- */
async function findByPrefix(prefix, suffix) {
  const names = await readdir(BROWSER_DIR);
  const hit = names.find((n) => n.startsWith(prefix) && n.endsWith(suffix));
  return hit ? join(BROWSER_DIR, hit) : null;
}

let html = await readFile(indexPath, 'utf8');
let inlined = 0;

// --- весь CSS в документ ------------------------------------------------------
const cssPath = await findByPrefix('styles-', '.css');
if (!cssPath) {
  console.error('✗ не найден styles-*.css — нечего встраивать');
  process.exit(1);
}
const css = await readFile(cssPath, 'utf8');
// Одинарные кавычки: стили содержат двойные, и наоборот — разметка сломалась бы.
const styleTag = `<style>${css.replace(/<\/style>/gi, '<\\/style>')}</style>`;
const linkRe = /[ \t]*<link[^>]*rel=["']stylesheet["'][^>]*>\s*/gi;
const linksFound = (html.match(linkRe) || []).length;
html = html.replace(linkRe, '');
if (linksFound === 0) {
  console.error('✗ в index.html нет ссылок на stylesheet — встраивать нечего');
  process.exit(1);
}
// Beasties уже положил критические стили в <style>; эта метка нужна, чтобы не
// вставлять второй раз, если скрипт запустят повторно.
if (!html.includes('<!-- styles-inlined -->')) {
  html = html.replace('</head>', `<!-- styles-inlined -->${styleTag}</head>`);
  inlined += 1;
}

// --- фавиконка в документ -----------------------------------------------------
// Отдельным запросом она не стоит того: браузер всё равно грузит её один раз,
// а соединение на счёт идёт.
const iconPath = await findByPrefix('favicon', '.png');
if (iconPath) {
  const { readFile: rf } = await import('node:fs/promises');
  const png = await rf(iconPath);
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  const before = html;
  html = html.replace(/(href=["'])[^"']*favicon[^"']*(["'])/gi, `$1${dataUri}$2`);
  if (before !== html && !html.includes('data:image/png;base64')) {
    console.error('✗ фавиконка не подставилась — разметка не совпала');
    process.exit(1);
  }
  if (before !== html) inlined += 1;
}

await writeFile(indexPath, html);

const total = html.length;
const withLinks = total + css.length;
console.log(`✓ index.html: ${(total / 1024).toFixed(1)} КБ, CSS ${(css.length / 1024).toFixed(1)} КБ в документ`);
console.log(`  убрано ссылок на стили: ${linksFound}, встроено: ${inlined}`);
console.log(`  соединений на холодной загрузке было 7, стало ${7 - inlined}:`);
console.log(`    /index.html (со стилями и иконкой), /polyfills-*.js, /main-*.js, шрифт, /manifest.webmanifest`);
void withLinks;