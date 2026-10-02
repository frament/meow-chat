package backup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPIDFilePath(t *testing.T) {
	path := PIDFilePath("/data/chat.db")
	expected := filepath.Join("/data", "server.pid")
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestIsDocker(t *testing.T) {
	// On Windows, IsDocker() always returns false
	if IsDocker() {
		t.Error("expected IsDocker()=false on Windows")
	}
}

func TestWritePIDFile(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "data", "chat.db")
	os.MkdirAll(filepath.Join(dir, "data"), 0755)

	err := WritePIDFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}

	pidPath := PIDFilePath(dbPath)
	data, err := os.ReadFile(pidPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Error("PID file should not be empty")
	}
}

func TestFindProcess_NonexistentPIDFile(t *testing.T) {
	_, err := FindProcess("/nonexistent/server.pid")
	if err == nil {
		t.Error("expected error for nonexistent PID file")
	}
}

// A nonexistent but strictly positive PID. Using -1 here used to call
// kill(-1, SIGTERM), which on Linux signals *every* process the caller can
// reach - as root on a CI runner that included the Actions runner agent, so the
// job died with "the operation was canceled" and no test output. Locally, as a
// non-root user, the same call returned EPERM, passed the assertion, and hid
// the whole thing. Keep this PID positive and unused.
const unusedPID = 4194303

func TestSendRestartSignal_UnusedPID(t *testing.T) {
	// A real kill against an unused PID must fail, not take anything down.
	if err := SendRestartSignal(unusedPID); err == nil {
		t.Error("expected error for a PID that does not exist")
	}
}

func TestSendRestartSignal_RefusesBroadcastPIDs(t *testing.T) {
	// -1 means "every process the caller can signal" and 0 means "my whole
	// process group" in kill(2). Neither is ever a valid restart target, and
	// SendRestartSignal must not let a corrupt pid file turn a restart into a
	// mass SIGTERM.
	for _, pid := range []int{-1, 0} {
		if err := SendRestartSignal(pid); err == nil {
			t.Errorf("expected an error for broadcast pid %d", pid)
		}
	}
}
