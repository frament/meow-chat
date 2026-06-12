//go:build !windows

package handlers

import "syscall"

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
	disk := DiskInfo{}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return disk
	}
	total := int64(stat.Bsize) * int64(stat.Blocks)
	free := int64(stat.Bsize) * int64(stat.Bavail)
	used := total - free
	disk = DiskInfo{
		Total:   total,
		Used:    used,
		Free:    free,
		TotalGB: float64(total) / (1 << 30),
		UsedGB:  float64(used) / (1 << 30),
		FreeGB:  float64(free) / (1 << 30),
	}
	if total > 0 {
		disk.UsedPct = float64(used) / float64(total) * 100
	}
	return disk
}
