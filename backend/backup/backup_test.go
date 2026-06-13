package backup

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestCreateBackup(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "chat.db")
	backupDir := filepath.Join(dir, "backups")
	workingDir := dir

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("INSERT INTO test VALUES (1, 'hello')")
	if err != nil {
		t.Fatal(err)
	}

	zipPath, size, err := CreateBackup(db, dbPath, backupDir, workingDir)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(zipPath); os.IsNotExist(err) {
		t.Fatal("backup zip file not created")
	}
	if size <= 0 {
		t.Error("expected positive size")
	}

	info, _ := os.Stat(zipPath)
	if info.Size() != size {
		t.Errorf("size mismatch: %d vs %d", info.Size(), size)
	}
}

func TestCreateBackup_CreatesDir(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "chat.db")

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec("CREATE TABLE t (id INT)")
	if err != nil {
		t.Fatal(err)
	}

	// backupDir doesn't exist yet — CreateBackup should create it
	backupDir := filepath.Join(dir, "nonexistent", "backups")
	zipPath, _, err := CreateBackup(db, dbPath, backupDir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(zipPath); os.IsNotExist(err) {
		t.Fatal("backup zip should be created in new directory")
	}
}

func TestCreateBackup_InMemory(t *testing.T) {
	dir := t.TempDir()
	backupDir := filepath.Join(dir, "backups")

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec("CREATE TABLE t (id INT)")
	if err != nil {
		t.Fatal(err)
	}

	// In-memory DB — VACUUM INTO should still work
	zipPath, size, err := CreateBackup(db, ":memory:", backupDir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if size <= 0 {
		t.Error("expected positive size")
	}
	if _, err := os.Stat(zipPath); os.IsNotExist(err) {
		t.Fatal("backup zip should exist")
	}
}

func TestRestoreFromZip(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "chat.db")
	backupDir := filepath.Join(dir, "backups")

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatal(err)
	}

	_, err = db.Exec("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("INSERT INTO test VALUES (1, 'hello')")
	if err != nil {
		t.Fatal(err)
	}

	_, _, err = CreateBackup(db, dbPath, backupDir, dir)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Find the zip
	entries, _ := os.ReadDir(backupDir)
	var foundZip string
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".zip" {
			foundZip = filepath.Join(backupDir, e.Name())
			break
		}
	}
	if foundZip == "" {
		t.Fatal("no zip file found")
	}

	// Restore to a different path
	restoredDB := filepath.Join(dir, "chat-restored.db")
	rerr := RestoreFromZip(foundZip, restoredDB, dir)
	if rerr != nil {
		t.Fatal(rerr)
	}

	if _, err := os.Stat(restoredDB); os.IsNotExist(err) {
		t.Fatal("restored db doesn't exist")
	}

	db2, err := sql.Open("sqlite3", restoredDB)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()

	var val string
	err = db2.QueryRow("SELECT val FROM test WHERE id=1").Scan(&val)
	if err != nil {
		t.Fatal("restored data not found:", err)
	}
	if val != "hello" {
		t.Errorf("expected hello, got %s", val)
	}
}

func TestRestoreFromZip_NonExistent(t *testing.T) {
	err := RestoreFromZip("/nonexistent/file.zip", "/tmp/out.db", "/tmp")
	if err == nil {
		t.Error("expected error for nonexistent zip")
	}
}
