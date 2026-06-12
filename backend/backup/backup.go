package backup

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

func CreateBackup(db *sql.DB, dbPath, backupDir, workingDir string) (string, int64, error) {
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		return "", 0, fmt.Errorf("mkdir backup dir: %w", err)
	}

	tmpDB := filepath.Join(backupDir, "chat-backup.db")
	_, err := db.Exec(fmt.Sprintf("VACUUM INTO '%s'", tmpDB))
	if err != nil {
		return "", 0, fmt.Errorf("vacuum into: %w", err)
	}
	defer os.Remove(tmpDB)

	timestamp := time.Now().Format("2006-01-02T150405")
	zipPath := filepath.Join(backupDir, fmt.Sprintf("backup-%s.zip", timestamp))

	zipFile, err := os.Create(zipPath)
	if err != nil {
		return "", 0, fmt.Errorf("create zip: %w", err)
	}
	defer zipFile.Close()

	zw := zip.NewWriter(zipFile)

	addFile := func(src, dst string) error {
		f, err := os.Open(src)
		if err != nil {
			return err
		}
		defer f.Close()
		info, _ := f.Stat()
		hdr, _ := zip.FileInfoHeader(info)
		hdr.Name = dst
		hdr.Method = zip.Deflate
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		_, err = io.Copy(w, f)
		return err
	}

	addDir := func(src, dstPrefix string) error {
		entries, err := os.ReadDir(src)
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			fullPath := filepath.Join(src, e.Name())
			if err := addFile(fullPath, dstPrefix+"/"+e.Name()); err != nil {
				return err
			}
		}
		return nil
	}

	if err := addFile(tmpDB, "chat.db"); err != nil {
		return "", 0, fmt.Errorf("add chat.db: %w", err)
	}

	keyPath := filepath.Join(filepath.Dir(dbPath), "server_key.bin")
	if _, err := os.Stat(keyPath); err == nil {
		addFile(keyPath, "server_key.bin")
	}

	vapidPath := filepath.Join(workingDir, "vapid_keys.json")
	if _, err := os.Stat(vapidPath); err == nil {
		addFile(vapidPath, "vapid_keys.json")
	}

	addDir(filepath.Join(workingDir, "uploads/avatars"), "avatars")
	addDir(filepath.Join(workingDir, "uploads/posts"), "posts")
	addDir(filepath.Join(workingDir, "uploads/messages"), "messages")

	if err := zw.Close(); err != nil {
		return "", 0, fmt.Errorf("close zip: %w", err)
	}

	info, _ := os.Stat(zipPath)
	return zipPath, info.Size(), nil
}

func RestoreFromZip(zipPath, dbPath, workingDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		var dest string
		switch {
		case f.Name == "chat.db":
			dest = dbPath
		case f.Name == "server_key.bin":
			dest = filepath.Join(filepath.Dir(dbPath), "server_key.bin")
		case f.Name == "vapid_keys.json":
			dest = filepath.Join(workingDir, "vapid_keys.json")
		case len(f.Name) > 0 && f.Name[0] != '/':
			dest = filepath.Join(workingDir, "uploads", f.Name)
		default:
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(dest, 0755)
			continue
		}

		os.MkdirAll(filepath.Dir(dest), 0755)

		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			return fmt.Errorf("create %s: %w", dest, err)
		}

		rc, err := f.Open()
		if err != nil {
			out.Close()
			return fmt.Errorf("read %s from zip: %w", f.Name, err)
		}

		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return fmt.Errorf("write %s: %w", dest, err)
		}
	}
	return nil
}
