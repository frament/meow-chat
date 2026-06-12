//go:build !windows

package backup

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
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
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return err
	}
	done := make(chan bool, 1)
	go func() {
		proc.Wait()
		done <- true
	}()
	select {
	case <-done:
		return nil
	case <-time.After(10 * time.Second):
		return proc.Kill()
	}
}

func IsDocker() bool {
	_, err := os.Stat("/.dockerenv")
	return err == nil
}

func PIDFilePath(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "server.pid")
}

func WritePIDFile(dbPath string) error {
	path := PIDFilePath(dbPath)
	return os.WriteFile(path, []byte(fmt.Sprintf("%d", os.Getpid())), 0644)
}
