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
import { injectStamp } from './build-stamp.mjs';
import { computeStamp } from './stamp-from-git.mjs';

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

// Метка сборки: см. build-stamp.mjs. Ставится последним, уже после всех правок
// документа. Если вписать её раньше, любой die() ниже по файлу (нет манифеста,
// нет main.js) завершит скрипт до writeFile - и метка молча пропадёт, а клиент
// покажет «неизвестно» и не отличит это от настоящей сборки без метки.
const stamp = computeStamp();
await writeFile(indexPath, injectStamp(html, stamp));
console.log(`  метка сборки: ${stamp.value}${stamp.dirty ? ' (грязное дерево!)' : ''}`);

// Unknown must never be silent. It ships, it serves, and the settings page then
// says "неизвестно" - while the one command that would explain it
// (`curl | grep build-stamp`) shows nothing to compare. This happened on the
// first 1.6.0 deploy: `docker compose build frontend` bypassed the Makefile,
// which is the only thing exporting BUILD_COMMIT, and the deployed bundle was
// stamped "unknown" - on a feature whose whole purpose is being stampable.
if (stamp.value === 'unknown') {
  console.warn([
    '',
    '  ⚠ МЕТКА СБОРКИ НЕ ОПРЕДЕЛЕНА.',
    '    Сборка будет отдавать "неизвестно", и сверить её с сервером нечем.',
    '    Причина: внутри образа нет .git (исключён из контекста), а BUILD_COMMIT',
    '    не передан. Он задаётся в Makefile, поэтому собирайте через `make build`,',
    '    а не `docker compose build` напрямую.',
    '',
  ].join('\n'));
}

const { gzipSync } = await import('node:zlib');
console.log(`✓ index.html: ${(html.length / 1024).toFixed(1)} КБ, ${(gzipSync(Buffer.from(html)).length / 1024).toFixed(1)} КБ gzip`);

// --- ngsw.json: hash of index.html must match what we just wrote -------------
//
// This is not cosmetic. `ng build` hashes index.html and writes the digest into
// ngsw.json; everything above rewrites the document *after* that, so from the
// worker's point of view the file it fetches is never the one it was promised.
//
// What the worker does with that (ngsw-worker.js, cacheBustedFetchFromNetwork):
// it fetches /index.html, hashes the response, compares against the manifest,
// sees a mismatch, retries with `?ngsw-cache-bust=`, hashes again, sees the
// same mismatch, and throws SwCriticalError. That error propagates out of
// PrefetchAssetGroup.initializeFully into AppVersion.initializeFully, which sets
// `_okay = false` and rethrows - so the new version never becomes ready and
// `notifyClientsAboutVersionReady` is never called. No VERSION_READY, no
// "Доступна новая версия" banner, and the settings button reports "актуальна"
// while a downloaded update sits right there.
//
// The recovery is what made it look intermittent: the *next* page load serves the
// fresh index.html from the network, outside the versioned cache, so the new
// bundle appears on its own - after a restart, and without the banner ever
// showing. Introduced 2026-10-07 together with the inlining above, which is why
// it broke after 05.10 and not before.
//
// Rewriting the digest is the only correct fix: the worker insists on a
// byte-exact match and there is no way to make it stop asking. Recomputed from
// the final bytes, so it stays right whatever else above changes.
const { createHash } = await import('node:crypto');
const finalBytes = await readFile(indexPath);
const finalHash = createHash('sha1').update(finalBytes).digest('hex');

const ngswPath = join(BROWSER_DIR, 'ngsw.json');
if (!existsSync(ngswPath)) {
  die('нет ngsw.json — service worker не сможет проверить обновление');
}
const ngsw = JSON.parse(await readFile(ngswPath, 'utf8'));
const recorded = ngsw.hashTable?.['/index.html'];
if (!recorded) {
  die('в ngsw.json нет /index.html в hashTable — сверять нечего, проверь ngsw-config.json');
}
ngsw.hashTable['/index.html'] = finalHash;
await writeFile(ngswPath, JSON.stringify(ngsw));
console.log(`  ngsw.json: хэш /index.html обновлён, ${recorded.slice(0, 8)}… → ${finalHash.slice(0, 8)}…`);

console.log(`  ссылок на стили убрано: ${linksFound}, zone.js встроен, манифест — после старта`);
console.log('  соединений на холодной загрузке: 5 → 2');
console.log('    /index.html (стили, иконка, zone.js внутри) и /main-*.js');