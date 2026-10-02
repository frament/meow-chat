package version

import (
	_ "embed"
	"strconv"
	"strings"
)

// VERSION is the single source of truth for the release number. Bump it, tag
// the commit, and every build reports the truth - including `go run` and the
// tests, which have no build step to be given a flag.
//
// It is embedded rather than injected with
// `-ldflags "-X my-chat-backend/version.Version=..."` on purpose. Every
// injection point needed a literal fallback so that a build without the flag
// would not fail, and each of those fallbacks was a way to silently produce a
// binary reporting the wrong version - which is what happened on the
// 2026-10-02 deploy, where the number never reached the binary and nothing
// complained until someone read /api/version.
//
// The cost of embedding: -X no longer works, and it fails *silently*, because
// Version is no longer a constant-initialised string. Do not reintroduce it.
//
//go:embed VERSION
var versionFile string

// Version is the release this binary was built from.
var Version = strings.TrimSpace(versionFile)

// GitHubRepo is the GitHub repository path for update checks.
var (
	GitHubRepo    = "frament/meow-chat"
	GitHubAPIBase = "https://api.github.com"
)

// Compare compares two semver strings (e.g. "0.1.0", "v1.0.0").
// Returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2.
// Handles optional "v" prefix and "-dev"/"-beta" suffixes.
func Compare(v1, v2 string) int {
	v1 = stripPrefix(v1)
	v2 = stripPrefix(v2)

	p1 := parseNums(v1)
	p2 := parseNums(v2)

	minLen := len(p1)
	if len(p2) < minLen {
		minLen = len(p2)
	}

	for i := 0; i < minLen; i++ {
		if p1[i] < p2[i] {
			return -1
		}
		if p1[i] > p2[i] {
			return 1
		}
	}

	// If one has more segments (e.g. 1.0.0 vs 1.0.0-dev), the shorter wins
	if len(p1) < len(p2) {
		return -1
	}
	if len(p1) > len(p2) {
		return 1
	}
	return 0
}

// IsDev returns true if the version has a pre-release suffix like "-dev".
func IsDev(v string) bool {
	v = strings.TrimLeft(v, "vV")
	return strings.Contains(v, "-")
}

func stripPrefix(v string) string {
	v = strings.TrimLeft(v, "vV")
	if idx := strings.Index(v, "-"); idx >= 0 {
		v = v[:idx]
	}
	return v
}

func parseNums(v string) []int {
	parts := strings.Split(v, ".")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			n = 0
		}
		nums = append(nums, n)
	}
	return nums
}
