package handlers

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"my-chat-backend/database"
)

// jpegFixture builds a real JPEG rather than a header with the right magic
// bytes: saveImage sniffs the content and re-encodes, so a fake would exercise a
// path the product never takes.
func jpegFixture(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// multipartRequest builds a multipart/form-data request with one file part.
func multipartRequest(t *testing.T, path, field, filename string, content []byte, userID int64) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatal(err)
	}
	part.Write(content)
	mw.Close()

	req, err := http.NewRequest("POST", path, &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	return req
}

// The avatar route had no test at all: saveImage was covered in images_test.go,
// which proves the encoder works and says nothing about whether the endpoint
// stores the result or returns a URL the client can use.
func TestUploadAvatar_StoresAndReturnsURL(t *testing.T) {
	app, _, userID := setupTestApp(t)

	jpg := jpegFixture(t, 64, 64)
	req := multipartRequest(t, "/upload-avatar", "avatar", "me.jpg", jpg, userID)
	resp, body := doRequest(t, app, req)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d (%#v)", resp.StatusCode, body)
	}

	url, _ := body["avatar_url"].(string)
	if !strings.HasPrefix(url, "/uploads/avatars/") {
		t.Fatalf("expected an avatar URL under /uploads/avatars/, got %q", url)
	}

	// The file the URL names must exist: a handler that stored the row but not
	// the bytes would pass a check on the response alone, and the client would
	// get a broken image.
	onDisk := filepath.Join(".", url)
	if _, err := os.Stat(onDisk); err != nil {
		t.Errorf("the URL points at %s, which does not exist: %v", onDisk, err)
	}
	t.Cleanup(func() { os.Remove(onDisk) })

	var stored string
	if err := database.DB.QueryRow("SELECT avatar_url FROM users WHERE id = ?", userID).Scan(&stored); err != nil {
		t.Fatalf("read avatar_url: %v", err)
	}
	if stored != url {
		t.Errorf("expected the row to hold %q, got %q", url, stored)
	}
}

func TestUploadAvatar_RejectsMissingFile(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	mw.WriteField("note", "no file here")
	mw.Close()

	req, _ := http.NewRequest("POST", "/upload-avatar", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))

	resp, body := doRequest(t, app, req)
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	if body["error"] != "No file provided" {
		t.Errorf("expected the missing-file error, got %#v", body["error"])
	}
}

// A file that is not an image is a client mistake, and the answer must say so
// rather than 500: the app shows this text to the user.
func TestUploadAvatar_RejectsNonImage(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req := multipartRequest(t, "/upload-avatar", "avatar", "notes.txt", []byte("just some text"), userID)
	resp, body := doRequest(t, app, req)
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 for a non-image, got %d (%#v)", resp.StatusCode, body)
	}
	if !strings.Contains(body["error"].(string), "Only image files") {
		t.Errorf("expected the only-images error, got %#v", body["error"])
	}
}
