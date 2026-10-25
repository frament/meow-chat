package logfile

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The whole point is that the line survives a container that is gone: written to
// the file, not only to stdout that Docker throws away on recreation.
func TestSetup_WritesToFileAndStdout(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "backend.log")

	closer, err := Setup(path, DefaultMaxBytes)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if closer == nil {
		t.Fatal("expected a closer for an opened file")
	}
	defer closer.Close()
	defer log.SetOutput(os.Stderr)

	log.Println("после пересоздания контейнера строка должна остаться")

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(data), "строка должна остаться") {
		t.Fatalf("line not written to the file: %q", data)
	}
}

// The file is the durable half, but `docker logs` still has to work for the
// running container: without this assertion "stdout and the file" was only a
// claim in the comment, and dropping stdout left every test green.
func TestSetup_KeepsStdout(t *testing.T) {
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	previous := os.Stdout
	os.Stdout = write
	defer func() { os.Stdout = previous }()

	path := filepath.Join(t.TempDir(), "backend.log")
	closer, err := Setup(path, DefaultMaxBytes)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer log.SetOutput(os.Stderr)

	log.Println("видно и в docker logs")
	closer.Close()
	write.Close()

	out, _ := io.ReadAll(read)
	if !strings.Contains(string(out), "видно и в docker logs") {
		t.Fatalf("stdout lost the line: %q", out)
	}
}

func TestSetup_RotatesWhenTooLarge(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "backend.log")

	// A file from the previous run, already over the limit.
	if err := os.WriteFile(path, []byte(strings.Repeat("x", 2048)), 0o644); err != nil {
		t.Fatal(err)
	}

	closer, err := Setup(path, 1024)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer closer.Close()
	defer log.SetOutput(os.Stderr)

	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("expected the previous file rotated to .1: %v", err)
	}
	log.Println("новая строка")
	rotated, _ := os.ReadFile(path + ".1")
	if !strings.Contains(string(rotated), "xxxx") {
		t.Error("the rotated file must hold the previous content")
	}
	fresh, _ := os.ReadFile(path)
	if strings.Contains(string(fresh), "xxxx") {
		t.Error("the new file must start empty")
	}
}

func TestSetup_AppendsInsteadOfTruncating(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "backend.log")
	if err := os.WriteFile(path, []byte("прошлый запуск\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	closer, err := Setup(path, DefaultMaxBytes)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer closer.Close()
	defer log.SetOutput(os.Stderr)

	// Restarting must not erase the evidence we came for.
	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), "прошлый запуск") {
		t.Fatalf("the previous run was truncated: %q", data)
	}
}

func TestSetup_NoPathIsNotAnError(t *testing.T) {
	closer, err := Setup("", DefaultMaxBytes)
	if err != nil {
		t.Fatalf("stdout-only must be fine: %v", err)
	}
	if closer != nil {
		t.Error("nothing to close without a file")
	}
}
