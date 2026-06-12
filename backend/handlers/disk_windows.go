//go:build windows

package handlers

type DiskInfo struct {
	Total    int64   `json:"total"`
	Used     int64   `json:"used"`
	Free     int64   `json:"free"`
	TotalGB  float64 `json:"total_gb"`
	UsedGB   float64 `json:"used_gb"`
	FreeGB   float64 `json:"free_gb"`
	UsedPct  float64 `json:"used_pct"`
}

func getDiskUsage(path string) DiskInfo {
	return DiskInfo{}
}
