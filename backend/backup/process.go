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

func ShutdownContainer() {
	syscall.Kill(1, syscall.SIGTERM)
}

// SendRestartSignal asks a process to terminate so something can replace it.
//
// Rejects non-positive PIDs deliberately. On Unix the negative and zero cases of
// kill() are not "no such process", they are broadcast semantics: kill(-1, sig)
// signals every process the caller can reach, and kill(0, sig) signals the
// caller's whole process group. A pid file that is empty, truncated or
// otherwise parses to 0 would otherwise turn a restart into a self-inflicted
// kill of the entire process group - and, when running as root in CI, of the
// runner itself.
func SendRestartSignal(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("refusing to signal broadcast pid %d", pid)
	}
	return syscall.Kill(pid, syscall.SIGTERM)
}
