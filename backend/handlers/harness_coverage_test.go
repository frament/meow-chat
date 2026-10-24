package handlers

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Routes reachable from tests are declared twice: once where production
// registers them, once where the test harness does. Two hand-maintained lists
// drift silently - a handler can exist in production and simply be absent from
// the tests, and nothing fails. That is the same shape as a table with no
// writer: it looks covered and is not.
//
// Found on 2026-10-11 while auditing tests for honesty: 32 of 131 application
// handlers had no route in the harness at all, so no handler test for them
// could exist even in principle.
//
// The comparison is on METHOD + PATH, not on the handler name. It was by name
// first, and that hid a real mismatch: UnsubscribePush was registered as
// POST /push/unsubscribe in the harness while production serves
// DELETE /api/push/subscribe. The handler looked covered; the route clients
// actually call was never exercised.
func TestHarnessCoversEveryRoute(t *testing.T) {
	production := productionRoutes(t)
	harness := harnessRoutes(t)

	checkCoverage(t, "приложение", production, harness, applicationGaps)
}

// applicationGaps are production routes with no matching route in the harness.
//
// This list is debt, not approval. It is frozen so it cannot grow; shrinking it
// is the point of the round-2 work. A reason is required because "we never got
// to it" and "the route cannot be exercised this way" are different debts, and
// only one of them is repaid by writing a test.
// applicationGaps is empty: every route main.go serves now has a route in the
// harness.
//
// The list existed from 2026-10-11 to 2026-10-12 and held 32 routes, then 25
// after the guard was widened to look at every test file rather than only the
// harness. Each entry carried a reason, and the reasons were of two kinds: "no
// test", which was repaid by writing one, and "tested another way", which was
// repaid by registering the route the client actually calls.
//
// It stays as an empty map rather than being deleted, because the guard's job
// includes reporting a stale entry when a route is covered and still listed -
// and that mechanism needs somewhere to list from.
var applicationGaps = map[string]string{}

func checkCoverage(t *testing.T, surface string, production, harness map[string]string, gaps map[string]string) {
	t.Helper()

	// New drift: production serves a route the harness never registered and
	// nobody has written down yet.
	var added []string
	for route := range production {
		if _, ok := harness[route]; !ok {
			if gaps[route] == "" {
				added = append(added, route)
			}
		}
	}
	if len(added) > 0 {
		sort.Strings(added)
		t.Errorf("%s: маршруты есть в main.go, но не в тестовой обвязке и не в списке известных пробелов:\n  %s\n"+
			"Зарегистрируйте маршрут в обвязке по тому же методу и пути или добавьте его в список пробелов с причиной.",
			surface, strings.Join(added, "\n  "))
	}

	// Stale drift: the list claims a route is uncovered, but it is covered now,
	// or it is not served any more. Left alone, the list slowly stops describing
	// reality and the next person takes it for the state of things.
	var fixed []string
	for route := range gaps {
		if _, covered := harness[route]; covered {
			fixed = append(fixed, route)
			continue
		}
		if _, served := production[route]; !served {
			fixed = append(fixed, route)
		}
	}
	if len(fixed) > 0 {
		sort.Strings(fixed)
		t.Errorf("%s: список пробелов протух - эти маршруты либо уже в обвязке, либо больше не обслуживаются:\n  %s\n"+
			"Уберите их из списка.", surface, strings.Join(fixed, "\n  "))
	}
}

// productionRoutes reads main.go and returns "METHOD path" for every route,
// with the group prefixes expanded and /api stripped, so it lines up with the
// harness, which registers the same handlers without the API prefix.
func productionRoutes(t *testing.T) map[string]string {
	t.Helper()

	src := readFile(t, "../main.go")
	prefix := map[string]string{"app": ""}
	// Groups may be nested (fed is a child of api), so resolve in passes until
	// nothing changes.
	for pass := 0; pass < 4; pass++ {
		changed := false
		for _, m := range regexp.MustCompile(`(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"[^)]*\)`).FindAllStringSubmatch(src, -1) {
			want := prefix[m[2]] + m[3]
			if prefix[m[1]] != want {
				prefix[m[1]] = want
				changed = true
			}
		}
		if !changed {
			break
		}
	}

	return parseRoutes(t, "../main.go", prefix, func(p string) string {
		return strings.TrimPrefix(p, "/api")
	})
}

// harnessRoutes collects every route registered by any test file in this
// package.
//
// Reading only handlers_test_setup.go was too narrow, and wrong in a way that
// sent the work in the wrong direction: /check-update, /version and the WebAuthn
// routes are registered correctly inside their own test files, so they were
// listed as gaps that did not exist. The question this guard asks is "does some
// test exercise this route", not "is it in that one file".
func harnessRoutes(t *testing.T) map[string]string {
	t.Helper()

	files, err := filepath.Glob("*_test.go")
	if err != nil {
		t.Fatalf("list test files: %v", err)
	}
	// handlers_test_setup.go is not named *_test.go, so the glob misses it - and
	// it is the file that registers most of these routes. Without it every route
	// in the harness would be reported as a gap.
	files = append(files, "handlers_test_setup.go")
	// Deterministic order so a failure message does not shuffle between runs.
	sort.Strings(files)

	out := make(map[string]string)
	for _, f := range files {
		src := readFile(t, f)
		prefix := map[string]string{"app": ""}
		for pass := 0; pass < 4; pass++ {
			changed := false
			for _, m := range regexp.MustCompile(`(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"[^)]*\)`).FindAllStringSubmatch(src, -1) {
				want := prefix[m[2]] + m[3]
				if prefix[m[1]] != want {
					prefix[m[1]] = want
					changed = true
				}
			}
			if !changed {
				break
			}
		}
		for k, v := range parseRoutes(t, f, prefix, func(p string) string {
			// Test-only scaffolding, not a production route.
			if strings.HasPrefix(p, "/test-") {
				return ""
			}
			return p
		}) {
			out[k] = v
		}
	}
	if len(out) == 0 {
		t.Fatal("no routes found in any test file - this guard would pass over nothing")
	}
	return out
}

func parseRoutes(t *testing.T, path string, prefix map[string]string, normalize func(string) string) map[string]string {
	t.Helper()

	src := readFile(t, path)
	re := regexp.MustCompile(
		`(\w+)\.(Get|Post|Put|Delete|Patch|Head)\("([^"]*)"\s*,\s*(?:(?:AuthRequired|AdminRequired)\s*,\s*)*h\.\w+`)

	out := make(map[string]string)
	for _, m := range re.FindAllStringSubmatch(src, -1) {
		full := prefix[m[1]] + m[3]
		full = normalize(full)
		if full == "" {
			continue
		}
		out[strings.ToUpper(m[2])+" "+full] = m[0]
	}
	// An empty result is normal here: most test files register no routes at all.
	// Only the aggregate being empty is a failure, and that is checked by the
	// callers - a per-file failure would abort on the first such file.
	return out
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}
