#!/usr/bin/env node
// Finds tests that are green for reasons unrelated to the code.
//
// The premise: a test that cannot fail is worse than no test, because it buys
// the appearance of coverage. Four have already been found in this project by
// hand - three counted rows in a table nobody wrote to, and one of those three
// was this scanner's own ancestor, a check I wrote that could not fail either.
// So the search here is for *shapes* that cannot fail, not for missing tests.
//
// Every finding below is a smell with a stated reason. The list is a starting
// point for reading, not a verdict: a hit is where to look, never proof.
//
// Usage: node scripts/audit-fake-tests.mjs [path ...]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.angular') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Blocks of the form `it('name', () => { ... })` plus bare `describe`. */
function splitSpecs(source) {
  const specs = [];
  const re = /\b(it|fit)\(\s*(['"`])((?:\\.|(?!\2).)*)\2\s*,\s*(?:async\s*)?/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    // Skip the parameter list. Counting parentheses from the callback's opening
    // paren stops dead on `()`, which is the usual shape here, and every spec
    // then comes back with an empty body - which reads as "no assertions"
    // for all of them.
    let i = m.index + m[0].length;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== '(') continue;
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source.slice(i, i + 2) !== '=>') continue;
    i += 2;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== '{') continue;

    // From the body's opening brace, match to its close. Strings, template
    // literals, comments and regex literals all have to be skipped: a lone
    // apostrophe in a comment (`// ... doesn't ...`) otherwise opens a string
    // that runs until the next apostrophe, swallowing real closing braces and
    // making every later spec look like one enormous body.
    const bodyStart = i + 1;
    depth = 0;
    let quote = null;
    for (; i < source.length; i++) {
      const c = source[i];

      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }

      if (c === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }

      // A `/` right after punctuation opens a regex, not a division. Cheap
      // heuristic, and the only one available without a parser: get it wrong
      // and we only mis-skip a `/`, which costs a brace either way.
      if (c === '/' && isRegexStart(source, i)) {
        i++;
        let inClass = false;
        for (; i < source.length; i++) {
          const r = source[i];
          if (r === '\\') { i++; continue; }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
        }
        continue;
      }

      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    const line = source.slice(0, m.index).split('\n').length;
    specs.push({ kind: m[1], name: m[3], body: source.slice(bodyStart, i), line });
  }
  return specs;
}

/** True when the `/` at `i` looks like the start of a regex literal. */
function isRegexStart(source, i) {
  for (let j = i - 1; j >= 0; j--) {
    const c = source[j];
    if (/\s/.test(c)) continue;
    return '(,=:[!&|?{};+-*%~^<>'.includes(c);
  }
  return true;
}

function countMatches(body, re) {
  const m = body.match(re);
  return m ? m.length : 0;
}

const findings = [];

function report(file, spec, rule, detail) {
  findings.push({
    file: relative(ROOT, file),
    line: spec ? spec.line : 1,
    test: spec ? spec.name : '(файл целиком)',
    rule,
    detail,
  });
}

// ---------------------------------------------------------------- rules

function auditSpec(file, spec) {
  const b = spec.body;
  const hasExpect = /\bexpect\s*\(/.test(b);
  const hasAsyncAssert = /\bawait\s+expectAsync\b|\.and\.beResolved|\.and\.beRejected|\bflushMicrotasks\b|\btick\s*\(|\bdiscardPeriodicTasks\b/.test(b);

  // 1. A spec that never asserts anything.
  if (!hasExpect && !hasAsyncAssert) {
    report(file, spec, 'без проверок',
      'в теле нет ни одного expect и ни одного асинхронного утверждения');
  }

  // 2. A mock that answers the same thing whatever it was asked.
  //    Only meaningful where the HTTP layer is the subject. A component test
  //    that stubs api.getKey with a peer public key and then asserts on a
  //    crypto roundtrip is doing exactly the right thing, and the first cut of
  //    this rule flagged all four such tests. Scoped to specs that drive real
  //    requests, where the URL and body are precisely what is under test.
  if (/HttpTestingController/.test(b)) {
    const bareOf = countMatches(b, /\bof\s*\(\s*\{/g);
    const paramOf = countMatches(b, /\bof\s*\(\s*\(/g);
    if (bareOf > 0 && paramOf === 0) {
      report(file, spec, 'заглушка без входа',
        `of({...}) встречается ${bareOf} раз и ни один ответ не зависит от аргументов запроса - подмена URL или тела не будет замечена`);
    }

    // 2b. An HTTP test that never inspects the outgoing request at all.
    if (!/expectOne|expect\(\s*req/.test(b)) {
      report(file, spec, 'HTTP без проверки запроса',
        'используется HttpTestingController, но expectOne или expect(req => ...) не встречается - сам запрос не проверяется');
    }
  }

  // 3. A method spy created and never checked.
  //    Only `createSpy` assigned onto a mock object counts. `createSpyObj`
  //    passed to TestBed.overrideProvider is a stand-in for a whole service:
  //    nothing calls it directly, the component does, and the spec asserts on
  //    the component. Flagging those produced a false positive on a test that
  //    correctly checks a signal flips from false to true.
  const created = [...b.matchAll(/(\w+(?:\.\w+)*)\s*=\s*jasmine\.createSpy\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g)];
  for (const c of created) {
    const name = c[1].split('.').pop();
    const asserted = new RegExp(`${name}[^\\n]*toHaveBeenCalled|expect\\([^)]*${name}`).test(b);
    if (!asserted) {
      report(file, spec, 'шпион без проверки',
        `${c[1]} = jasmine.createSpy('${c[3]}') — нигде не проверяется, что его вызывали`);
    }
  }
  // spyOn without toHaveBeenCalled / call counts
  const spyOns = [...b.matchAll(/\bspyOn\s*\(\s*([^)]*?)\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2/g)];
  for (const s of spyOns) {
    const name = s[3];
    if (!/toHaveBeenCalled|and\.callCount|toHaveBeenCalledTimes/.test(b)) {
      report(file, spec, 'spyOn без проверки',
        `spyOn(...${name}) есть, но ни одной проверки вызова во всём теле`);
    }
  }

  // 4. Removed. The first cut flagged every `.subscribe()` without an `error`
  //    handler, and reading the hits showed thirteen of them were honest:
  //    `httpMock.expectOne('/api/login')` with method and body asserted, and
  //    the failure case sitting in the very next spec. Not knowing the failure
  //    path is not the same as not testing it, so this now lives as a
  //    per-method check at file level below, where it can actually be answered.

  // 5. Fake clock advanced but never asserted against.
  if (/jasmine\.clock\(\)|tick\s*\(/.test(b) && !hasExpect) {
    report(file, spec, 'часы без проверки',
      'время подделывается, но утверждений нет');
  }
}

function auditFile(file, source) {
  const specs = splitSpecs(source);

  // 6. A test that only asserts on its own fixture: it reads rows back and
  //    checks the count, without the handler ever having run. The push_copies
  //    family, generalised - COUNT(*) over something nothing writes.
  const fixtures = [...source.matchAll(
    /\b(\w+)\.(QueryRow|Query)\(\s*"SELECT\s+COUNT\(\*\)\s+FROM\s+(\w+)/gi)];
  for (const f of fixtures) {
    const [, recv, , table] = f;
    if (typeof recv === 'string') continue;
    // Nothing in this file writes to the table, so the count is a constant.
    const writes = new RegExp(`(INSERT\\s+INTO|UPDATE|REPLACE\\s+INTO)\\s+${table}\\b`, 'i').test(source);
    if (!writes) {
      report(file, null, 'таблица, которую никто не наполняет',
        `COUNT(*) FROM ${table} без единого INSERT/UPDATE в этом файле - значение всегда 0`);
    }
  }

  for (const s of specs) auditSpec(file, s);

  // 7. An API method with a success test and no failure test at all. Grouped by
  //    the method name in the spec title, so "login()" counts as one method
  //    whether it has one spec or six. A method that can fail - which is every
  //    one that touches the network - and is only ever tested on the happy path
  //    is where a swallowed error would go unnoticed.
  const byMethod = new Map();
  for (const s of specs) {
    const m = s.name.match(/^([a-zA-Z_$][\w$]*)\s*\(/);
    if (!m) continue;
    const name = m[1];
    if (!byMethod.has(name)) byMethod.set(name, []);
    byMethod.get(name).push(s);
  }
  const FAILURE_WORDS = /error|fail|отказ|ошибк|throw|reject|401|500|503|timeout|таймаут/i;
  for (const [name, group] of byMethod) {
    if (group.length < 1) continue;
    const hasFailure = group.some((s) => FAILURE_WORDS.test(s.name));
    if (!hasFailure && group.some((s) => /subscribe|flush|expectOne/.test(s.body))) {
      report(file, null, 'метод без теста на отказ',
        `${name}() — ${group.length} тест(ов), все на успешном пути; провалившийся запрос не проверяется ни разу`);
    }
  }

  return specs.length;
}

// ---------------------------------------------------------------- Go side

function readIfExists(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/** Routes registered by a Go file, as method + full path + handler name. */
function goRoutes(file, handlerRe) {
  const src = readFileSync(file, 'utf8');
  const prefix = {};
  for (const m of src.matchAll(/(\w+)\s*:=\s*\w+\.Group\("([^"]*)"/g)) prefix[m[1]] = m[2];
  const out = [];
  const re = new RegExp(
    `(\\w+)\\.(Get|Post|Put|Delete|Patch)\\("([^"]*)"\\s*,\\s*(?:(?:AuthRequired|AdminRequired)\\s*,\\s*)*(${handlerRe})`,
    'g');
  for (const m of src.matchAll(re)) {
    const [, varName, meth, p, handler] = m;
    out.push({ meth: meth.toUpperCase(), path: (prefix[varName] ?? '') + p, handler: handler.split('.')[1] });
  }
  return out;}

function auditGo() {
  const root = process.env.AUDIT_BACKEND || join(ROOT, 'backend');
  if (!existsSync(root)) return 0;

  // Schema first, and unconditionally. The table rule below used to sit behind
  // an `if (!main.go) return` guard, which meant that pointing the scanner at a
  // directory without main.go - exactly what checking it against an old commit
  // means - silently reported nothing at all. A check that disables itself when
  // its input is incomplete is worse than no check.
  const schema = readIfExists(join(root, 'database', 'database.go')) ?? '';
  const tables = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]));

  const goFiles = walk(root).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
  const prodBlob = goFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

  for (const f of walk(root).filter((x) => x.endsWith('_test.go'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/SELECT\s+COUNT\(\*\)\s+FROM\s+(\w+)/gi)) {
      const table = m[1];
      if (!tables.has(table)) continue;
      // The first cut only looked at production code and duly flagged
      // group_device_key_shares, where the test seeds the rows itself and then
      // checks the handler deletes them - a real assertion, against a table the
      // product never populates. A count is only vacuous when *nothing* writes
      // the table: neither the product nor the fixture.
      const writeRe = new RegExp(
        `(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE|REPLACE)\\s+${table}\\b`, 'i');
      const writtenSomewhere = writeRe.test(prodBlob) || writeRe.test(src);
      if (!writtenSomewhere) {
        const line = src.slice(0, m.index).split('\n').length;
        report(f, { name: '(таблица)', line }, 'таблица без писателя',
          `COUNT(*) FROM ${table}, а не пишет её ни продакшен-код, ни фикстура этого файла - значение всегда 0`);
      }
    }
  }

  // Route coverage needs main.go and the harness. Absent either, there is
  // nothing to compare and the pass says so rather than reporting a clean bill.
  const mainSrc = readIfExists(join(root, 'main.go'));
  const setupSrc = readIfExists(join(root, 'handlers', 'handlers_test_setup.go'));
  if (!mainSrc || !setupSrc) return 0;

  const main = goRoutes(join(root, 'main.go'), '(?:h|fedHandler)\\.\\w+');
  const setup = goRoutes(join(root, 'handlers', 'handlers_test_setup.go'), 'h\\.\\w+');

  const appHandlers = new Map();   // h.* - should be reachable from handler tests
  const fedHandlers = new Map();   // fedHandler.* - federation package has its own harness
  for (const r of main) {
    const bag = r.handler.startsWith('Handle') ? fedHandlers : appHandlers;
    if (!bag.has(r.handler)) bag.set(r.handler, []);
    bag.get(r.handler).push(`${r.meth} ${r.path}`);
  }
  const inSetup = new Set(setup.map((r) => r.handler));

  const missing = [...appHandlers.entries()].filter(([h]) => !inSetup.has(h));
  if (missing.length) {
    report(join(root, 'handlers', 'handlers_test_setup.go'), null, 'обработчик вне тестовой обвязки',
      `${missing.length} маршрутов зарегистрированы в main.go и отсутствуют в обвязке. ` +
      `Два списка правят руками и расходятся молча: обработчик может существовать в проде и просто не быть в тестах.\n` +
      missing.map(([h, paths]) => `        ${h}: ${paths.join(', ')}`).join('\n'));
  }

  return 0;
}

// ---------------------------------------------------------------- run

const only = process.argv.slice(2).filter((a) => a !== '--go');
const files = only.length
  ? only.flatMap((t) => (statSync(t).isDirectory() ? walk(t) : [t]))
  : walk(join(ROOT, 'frontend', 'src')).filter((f) => extname(f) === '.ts');

let totalSpecs = 0;
for (const f of files) {
  if (extname(f) !== '.ts' || !f.includes('spec')) continue;
  totalSpecs += auditFile(f, readFileSync(f, 'utf8'));
}

// The Go pass reports into the same list, so it has to run before the
// grouping - after it, its findings were counted but never printed. It
// contributes nothing to the tally of its own: one finding may list thirty
// handlers, and counting the group as thirty would double-count it against
// the list it was already reported in.
auditGo();

const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, []);
  byRule.get(f.rule).push(f);
}

console.log(`Просмотрено спецификаций: ${totalSpecs}`);
console.log(`Находок: ${findings.length}\n`);

for (const [rule, items] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── ${rule} (${items.length})`);
  for (const i of items.slice(0, 12)) {
    console.log(`   ${i.file}:${i.line}  ${i.test}`);
    console.log(`     ${i.detail}`);
  }
  if (items.length > 12) console.log(`   …ещё ${items.length - 12}`);
  console.log();
}

process.exit(findings.length > 0 ? 1 : 0);
