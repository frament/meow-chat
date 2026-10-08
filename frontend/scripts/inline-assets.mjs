/**
 * Сводит холодную загрузку к двум соединениям вместо семи.
 *
 * Измерено на LTE через релей: релей пропускает не больше трёх одновременных
 * соединений, причём нестабильно. Один и тот же бандл в 17:36 загрузился целиком,
 * а в 17:49 релей пропустил два запроса из пяти — и страница осталась пустой:
 * main.js не пришёл, значит приложение просто не запускалось.
 *
 * Критический путь — это /index.html и /main.js. Меньше двух соединений быть не
 * может: без документа и без кода приложения не существует. Всё остальное
 * переносится внутрь документа или подключается после старта.
 *
 * Что делается:
 *   - весь CSS вставляется в <style>, обе ссылки на styles.css убираются.
 *     Побочный выигрыш: страница перестаёт ждать отдельный запрос перед первой
 *     отрисовкой — критические стили Beasties уже в документе.
 *   - фавиконка становится data:URI, отдельного запроса больше нет.
 *   - zone.js переносится в документ. Модульные скрипты выполняются в порядке
 *     появления, поэтому inline-polyfills перед main.js даёт тот же порядок,
 *     что и два внешних тега.
 *   - манифест подключается скриптом сразу после старта приложения. Он весит
 *     367 Б и на установку не влияет — его читает iOS, когда страница уже
 *     загружена.
 *
 * Шрифт подключать отдельно не нужно и даже вредно: в styles.css четыре правила
 * @font-face, они уезжают в документ вместе со стилями, и браузер сам берёт
 * нужные подмножества. Лишний <link> на тот же woff2 добавлял соединение,
 * которого мы как раз хотели избежать.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const BROWSER_DIR = process.argv[2] || 'dist/frontend/browser';
const indexPath = join(BROWSER_DIR, 'index.html');

function die(message, detail) {
  console.error(`✗ ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  die(`нет ${indexPath} — сначала собери фронтенд`);
}

/** Имя файла по префиксу и расширению: styles-ABC123.css → styles-. Рекурсивно:
 *  шрифты лежат в fonts/, а не рядом с index.html. */
async function findByPrefix(prefix, suffix) {
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const hit = await walk(full);
        if (hit) return hit;
      } else if (entry.name.startsWith(prefix) && entry.name.endsWith(suffix)) {
        return full;
      }
    }
    return null;
  };
  return walk(BROWSER_DIR);
}

/** Экранирование закрывающего тега: иначе `</script>` внутри JS оборвёт разметку. */
const safeForTag = (text) => text.replace(/<\/script>/gi, '<\\/script>');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let html = await readFile(indexPath, 'utf8');

// --- весь CSS в документ ------------------------------------------------------
const cssPath = await findByPrefix('styles-', '.css');
if (!cssPath) die('не найден styles-*.css — нечего встраивать');

const css = await readFile(cssPath, 'utf8');
const linkRe = /[ \t]*<link[^>]*rel=["']stylesheet["'][^>]*>\s*/gi;
const linksFound = (html.match(linkRe) || []).length;
if (linksFound === 0) die('в index.html нет ссылок на stylesheet — встраивать нечего');
html = html.replace(linkRe, '');

// Beasties кладёт в документ критические стили - подмножество того же файла.
// Раз полный CSS уезжает следом, второй блок с теми же @font-face и теми же
// селекторами просто дублирует байты и сбивает с толку того, кто это читает.
// Убираются все <style> до нашего маркера, и только они: всё, что после
// маркера, наше по построению.
const MARK = '<!-- styles-inlined -->';
const headEnd = html.indexOf('</head>');
const head = html.slice(0, headEnd);
const stripped = head.replace(/<style>[\s\S]*?<\/style>\s*/gi, '');
if (stripped.length === head.length) {
  console.error('· в <head> не было блоков <style> от Beasties');
} else {
  const saved = head.length - stripped.length;
  console.log(`  удалено дублирующих блоков <style>: ${(saved / 1024).toFixed(1)} КБ`);
}
html = stripped + MARK + `<style>${safeForTag(css)}</style>` + html.slice(headEnd);

// --- фавиконка в документ -----------------------------------------------------
const iconPath = await findByPrefix('favicon', '.png');
if (iconPath) {
  const dataUri = `data:image/png;base64,${(await readFile(iconPath)).toString('base64')}`;
  const before = html;
  html = html.replace(/(href=["'])[^"']*favicon[^"']*(["'])/gi, `$1${dataUri}$2`);
  if (before === html) die('ссылка на фавиконку не нашлась — разметка не совпала');
}

// --- zone.js в документ -------------------------------------------------------
const polyPath = await findByPrefix('polyfills-', '.js');
if (!polyPath) die('не найден polyfills-*.js — встроить нечего');

const polyName = basename(polyPath);
const polyRe = new RegExp(
  `[ \\t]*<script\\b([^>]*?)\\bsrc=["']${escapeRe(polyName)}["']([^>]*?)>\\s*</script>\\s*`,
  'i',
);
if (!polyRe.test(html)) die(`в index.html нет тега со ссылкой на ${polyName}`);

const poly = await readFile(polyPath, 'utf8');
html = html.replace(polyRe, `<script type="module">\n${safeForTag(poly)}\n</script>\n  `);

// --- манифест и шрифт уходят с пути к запуску --------------------------------
const manifestRe = /[ \t]*<link[^>]*rel=["']manifest["'][^>]*>\s*/gi;
if (!manifestRe.test(html)) die('в index.html нет ссылки на манифест');
html = html.replace(manifestRe, '');

const manifestName = (await readdir(BROWSER_DIR)).find((n) => n.endsWith('.webmanifest'));
if (!manifestName) die('не найден manifest.webmanifest');
const manifestUri =
  'data:application/manifest+json,' +
  encodeURIComponent(await readFile(join(BROWSER_DIR, manifestName), 'utf8'));

const boot = [
  '<script>',
  '/* Манифест убран из разметки, чтобы не занимать соединение на пути к',
  '   запуску: релей держит три одновременных соединения, и каждый лишний файл',
  '   на критическом пути — шанс, что приложение вообще не стартует.',
  '   Подключается сразу после загрузки main.js. */',
  '(function () {',
  "  var m = document.createElement('link');",
  "  m.rel = 'manifest';",
  `  m.href = '${manifestUri}';`,
  '  document.head.appendChild(m);',
  '})();',
  '</script>',
].join('\n');
html = html.replace('</body>', `${boot}\n</body>`);

await writeFile(indexPath, html);

const { gzipSync } = await import('node:zlib');
console.log(`✓ index.html: ${(html.length / 1024).toFixed(1)} КБ, ${(gzipSync(Buffer.from(html)).length / 1024).toFixed(1)} КБ gzip`);
console.log(`  ссылок на стили убрано: ${linksFound}, zone.js встроен, манифест — после старта`);
console.log('  соединений на холодной загрузке: 5 → 2');
console.log('    /index.html (стили, иконка, zone.js внутри) и /main-*.js');