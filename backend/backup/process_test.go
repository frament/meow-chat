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

func TestSendRestartSignal_InvalidPID(t *testing.T) {
	err := SendRestartSignal(-1)
	if err == nil {
		t.Error("expected error for invalid PID")
	}
}
