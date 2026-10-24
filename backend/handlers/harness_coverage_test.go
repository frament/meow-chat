package handlers

import (
	"os"
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
var applicationGaps = map[string]string{
	"GET /invite/:token":                      "нет теста",
	"GET /friend-invite/:token":               "нет теста",
	"POST /friend-invite/:token/accept":       "нет теста",
	"POST /invites":                           "нет теста",
	"DELETE /invites/:id":                     "нет теста",
	"POST /friend-invites":                    "нет теста",
	"GET /pinned":                             "нет теста",
	"POST /pin/:id":                           "нет теста",
	"DELETE /pin/:id":                         "нет теста",
	"DELETE /friends/:id":                     "нет теста",
	"GET /keys/:userId":                       "нет теста",
	"PUT /keys":                               "нет теста",
	"POST /logout":                            "нет теста",
	"POST /offline":                           "нет теста",
	"GET /version":                            "нет теста; version_test.go проверяет пакет version, а не маршрут",
	"GET /check-update":                       "нет теста",
	"GET /ws-health":                          "нет теста",
	"POST /upload-avatar":                     "нет теста; saveImage проверяется в images_test.go, маршрут - нет",
	"GET /giphy/search":                       "нет теста",
	"GET /giphy/trending":                     "нет теста",
	"GET /admin/settings/giphy-key":           "нет теста",
	"PUT /admin/settings/giphy-key":           "нет теста",
	"POST /admin/federation/connect":          "нет теста; handshake проверяется в admin_federation_test.go через SendDirect, минуя маршрут",
	"POST /admin/federation/servers/:id/ping": "нет теста",
	"POST /admin/federation/restore":          "нет теста",
	"POST /webauthn/begin-login":              "нет теста",
	"POST /webauthn/finish-login":             "нет теста",
	"POST /webauthn/has-credentials":          "нет теста",
	"POST /webauthn/begin-registration":       "нет теста",
	"POST /webauthn/finish-registration":      "нет теста",
	"GET /webauthn/credentials":               "нет теста",
	"DELETE /webauthn/credentials/:id":        "нет теста",
}

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

// harnessRoutes reads the handler test harness, which registers on a bare
// Fiber app and therefore needs the /api prefix stripped from nothing.
func harnessRoutes(t *testing.T) map[string]string {
	t.Helper()

	src := readFile(t, "handlers_test_setup.go")
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

	return parseRoutes(t, "handlers_test_setup.go", prefix, func(p string) string {
		// Test-only scaffolding, not a production route.
		if strings.HasPrefix(p, "/test-") {
			return ""
		}
		return p
	})
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
	if len(out) == 0 {
		t.Fatalf("no routes found in %s - the pattern stopped matching, which would make this guard pass over nothing", path)
	}
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
