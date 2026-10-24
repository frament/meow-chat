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
// This guard makes the drift loud. It does not demand that everything be
// covered today - the allow-lists below are the actual work list - it demands
// that the uncovered set only shrinks. Adding a route without a registration
// now fails, and so does leaving a fixed one on the list.
func TestHarnessCoversEveryRoute(t *testing.T) {
	app := routeHandlers(t, "../main.go", `h\.(\w+)`)
	fed := routeHandlers(t, "../main.go", `fedHandler\.(\w+)`)
	appHarness := routeHandlers(t, "handlers_test_setup.go", `h\.(\w+)`)
	fedHarness := routeHandlers(t, "../federation/handler_test.go", `(?:fh|h)\.(\w+)`)

	checkCoverage(t, "приложение", app, appHarness, applicationGaps)
	checkCoverage(t, "федерация", fed, fedHarness, federationGaps)
}

// applicationGaps are application handlers with no route in the harness.
//
// This list is debt, not approval. It is frozen so it cannot grow; shrinking it
// is the point of the round-2 work. A reason is required because "we never got
// to it" and "the route cannot be exercised this way" are different debts, and
// only one of them is repaid by writing a test.
var applicationGaps = map[string]string{
	"AcceptFriendInvite":         "нет теста",
	"AdminConnectFederation":     "нет теста; handshake проверяется в admin_federation_test.go через SendDirect, минуя маршрут",
	"AdminPingFederationServer":  "нет теста",
	"AdminRestoreFederation":     "нет теста",
	"CheckFriendInvite":          "нет теста",
	"CheckInvite":                "нет теста",
	"CheckUpdate":                "нет теста",
	"CreateFriendInvite":         "нет теста",
	"CreateInvite":               "нет теста",
	"DeleteInvite":               "нет теста",
	"GetGiphyKey":                "нет теста",
	"GetKey":                     "нет теста",
	"GetPinned":                  "нет теста",
	"GetVersion":                 "нет теста; version_test.go проверяет пакет version, а не маршрут",
	"GoOffline":                  "нет теста",
	"Logout":                     "нет теста",
	"PinUser":                    "нет теста",
	"PutKey":                     "нет теста",
	"RemoveFriend":               "нет теста",
	"SearchGiphy":                "нет теста",
	"TrendingGiphy":              "нет теста",
	"UnpinUser":                  "нет теста",
	"UpdateGiphyKey":             "нет теста",
	"UploadAvatar":               "нет теста; saveImage проверяется в images_test.go, маршрут - нет",
	"WSHealth":                   "нет теста",
	"WebAuthnBeginLogin":         "нет теста",
	"WebAuthnBeginRegistration":  "нет теста",
	"WebAuthnFinishLogin":        "нет теста",
	"WebAuthnFinishRegistration": "нет теста",
	"WebAuthnHasCredentials":     "нет теста",
	"WebAuthnListCredentials":    "нет теста",
	"WebAuthnRemoveCredential":   "нет теста",
}

// federationGaps are the two federation endpoints their package does not
// register. The other fourteen are registered in federation/handler_test.go,
// which is a second harness with the same drift risk and is checked here for
// the same reason.
var federationGaps = map[string]string{
	"HandleBulkStickerPacks":    "нет теста",
	"HandleReceiveStickerPacks": "нет теста",
}

func checkCoverage(t *testing.T, surface string, production, harness []string, gaps map[string]string) {
	t.Helper()

	inHarness := make(map[string]bool, len(harness))
	for _, h := range harness {
		inHarness[h] = true
	}
	inProduction := make(map[string]bool, len(production))
	for _, h := range production {
		inProduction[h] = true
	}

	// New drift: production has a handler the harness never registered and
	// nobody has written down yet.
	var added []string
	for _, h := range production {
		if !inHarness[h] && gaps[h] == "" {
			added = append(added, h)
		}
	}
	if len(added) > 0 {
		sort.Strings(added)
		t.Errorf("%s: маршруты есть в main.go, но не в тестовой обвязке и не в списке известных пробелов:\n  %s\n"+
			"Зарегистрируйте маршрут в обвязке или добавьте обработчик в список пробелов с причиной.",
			surface, strings.Join(dedupe(added), "\n  "))
	}

	// Stale drift: the list claims a handler is uncovered, but it is covered
	// now, or it is not a route any more. Left alone, the list slowly stops
	// describing reality and the next person takes it for the state of things.
	var fixed []string
	for h := range gaps {
		if inHarness[h] || !inProduction[h] {
			fixed = append(fixed, h)
		}
	}
	if len(fixed) > 0 {
		sort.Strings(fixed)
		t.Errorf("%s: список пробелов протух - эти обработчики либо уже в обвязке, либо больше не маршрут:\n  %s\n"+
			"Уберите их из списка.", surface, strings.Join(fixed, "\n  "))
	}
}

func dedupe(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := in[:0]
	for _, s := range in {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// routeHandlers returns the handler method names registered in a Go source
// file, one entry per registration (the same handler can serve two verbs).
func routeHandlers(t *testing.T, path string, handlerRe string) []string {
	t.Helper()

	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	re := regexp.MustCompile(`\.(?:Get|Post|Put|Delete|Patch|Head)\("[^"]*"\s*,\s*(?:(?:AuthRequired|AdminRequired)\s*,\s*)*` + handlerRe)
	var out []string
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		out = append(out, m[1])
	}
	if len(out) == 0 {
		t.Fatalf("no routes found in %s - the pattern stopped matching, which would make this guard pass over nothing", path)
	}
	return out
}
