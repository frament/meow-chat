//go:build windows

package backup

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

func FindProcess(pidFile string) (*os.Process, error) {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return nil, err
	}
	pid, err := strconv.Atoi(string(data))
	if err != nil {
		return nil, err
	}
	return os.FindProcess(pid)
}

func StopProcess(proc *os.Process) error {
	cmd := exec.Command("taskkill", "/PID", fmt.Sprintf("%d", proc.Pid))
	if err := cmd.Run(); err != nil {
		cmd = exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", proc.Pid))
		return cmd.Run()
	}
	time.Sleep(2 * time.Second)
	cmd2 := exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", proc.Pid))
	cmd2.Run()
	return nil
}

func IsDocker() bool {
	return false
}

func PIDFilePath(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "server.pid")
}

func WritePIDFile(dbPath string) error {
	path := PIDFilePath(dbPath)
	return os.WriteFile(path, []byte(fmt.Sprintf("%d", os.Getpid())), 0644)
}

func ShutdownContainer() {
	// Docker doesn't run natively on Windows — no-op
}

// SendRestartSignal asks a process to terminate so something can replace it.
// Non-positive PIDs are refused for the same reason as on Unix: a pid file that
// parses to 0 must never be treated as a target.
func SendRestartSignal(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("refusing to signal broadcast pid %d", pid)
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return proc.Kill()
}
