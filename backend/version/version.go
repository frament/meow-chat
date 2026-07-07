package version

import (
	"strconv"
	"strings"
)

const Version = "1.1.0"

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
