package handlers

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"my-chat-backend/database"
)

// Cover for the sticker pack UI work of 2026-10-09: renaming a pack and adding
// stickers that come from an iPhone.

func seedPack(t *testing.T, name string) int64 {
	t.Helper()
	res, err := database.DB.Exec("INSERT INTO sticker_packs (name) VALUES (?)", name)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// The rename endpoint and its API method existed since the sticker feature
// landed - the UI simply never called it. This pins the contract the button
// relies on, including the two failure cases the button distinguishes: an empty
// name is rejected rather than silently blanking the pack.
func TestAdminRenameStickerPack(t *testing.T) {
	app, _, adminID := setupTestApp(t)
	packID := seedPack(t, "Старое имя")

	rename := func(name string) *http.Response {
		body, _ := json.Marshal(map[string]string{"name": name})
		req, _ := http.NewRequest("PUT", "/admin/sticker-packs/"+itoa(packID), bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", bearerToken(t, adminID, true))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	if resp := rename("Новое имя"); resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var got string
	database.DB.QueryRow("SELECT name FROM sticker_packs WHERE id = ?", packID).Scan(&got)
	if got != "Новое имя" {
		t.Errorf("name = %q, want %q", got, "Новое имя")
	}

	// Renaming must not disturb the stickers in the pack.
	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM stickers WHERE pack_id = ?", packID).Scan(&count)

	// Empty name rejected, not applied.
	if resp := rename("   "); resp.StatusCode != 400 {
		t.Errorf("empty name: expected 400, got %d", resp.StatusCode)
	}
	database.DB.QueryRow("SELECT name FROM sticker_packs WHERE id = ?", packID).Scan(&got)
	if got != "Новое имя" {
		t.Errorf("name changed after a rejected rename: %q", got)
	}
}

// Renaming is a pack-level operation; a non-admin must not reach it.
func TestAdminRenameStickerPack_RejectsNonAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)
	packID := seedPack(t, "Пак")

	body, _ := json.Marshal(map[string]string{"name": "Взломано"})
	req, _ := http.NewRequest("PUT", "/admin/sticker-packs/"+itoa(packID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode == 200 {
		t.Errorf("a non-admin renamed a pack: status %d", resp.StatusCode)
	}

	var got string
	database.DB.QueryRow("SELECT name FROM sticker_packs WHERE id = ?", packID).Scan(&got)
	if got != "Пак" {
		t.Errorf("name = %q, want %q", got, "Пак")
	}
}

// A minimal but real APNG: PNG signature, IHDR, then the acTL chunk that marks
// it as animated. Built by hand because the test needs a file that is
// *structurally* an APNG - imageproc is not involved in sticker uploads, so
// nothing decodes these bytes.
func minimalAPNG() []byte {
	var b bytes.Buffer
	b.WriteString("\x89PNG\r\n\x1a\n")

	chunk := func(typ string, data []byte) {
		var length [4]byte
		n := len(data)
		length[0] = byte(n >> 24)
		length[1] = byte(n >> 16)
		length[2] = byte(n >> 8)
		length[3] = byte(n)
		b.Write(length[:])
		b.WriteString(typ)
		b.Write(data)
		b.Write([]byte{0, 0, 0, 0}) // CRC: unused by the handler under test
	}

	ihdr := make([]byte, 13)
	ihdr[0], ihdr[1], ihdr[2], ihdr[3] = 0, 0, 1, 0 // 256x256
	ihdr[8] = 8                                        // bit depth
	ihdr[9] = 6                                        // RGBA
	chunk("IHDR", ihdr)
	chunk("acTL", []byte{0, 0, 0, 2, 0, 0, 0, 0}) // num_frames=2, num_plays=0
	chunk("IDAT", []byte{0x78, 0x9C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01})
	chunk("IEND", nil)
	return b.Bytes()
}

// An animated iPhone sticker arrives as .apng, and it used to be rejected
// outright by the extension allowlist.
func TestAdminUploadSticker_AcceptsAPNG(t *testing.T) {
	app, _, adminID := setupTestApp(t)
	packID := seedPack(t, "Пак")

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("sticker", "sticker.apng")
	if err != nil {
		t.Fatal(err)
	}
	part.Write(minimalAPNG())
	w.Close()

	req, _ := http.NewRequest("POST", "/admin/sticker-packs/"+itoa(packID)+"/stickers", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, adminID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		body := new(bytes.Buffer)
		body.ReadFrom(resp.Body)
		t.Fatalf("expected 201 for an APNG upload, got %d: %s", resp.StatusCode, body.String())
	}

	var url string
	database.DB.QueryRow("SELECT image_url FROM stickers WHERE pack_id = ?", packID).Scan(&url)

	// Stored as .png, deliberately. Go's mime table resolves .apng to
	// image/apng and app.Static would serve that faithfully - but no browser
	// renders image/apng, so an <img> pointed at one shows nothing. Renaming
	// costs nothing: APNG is a valid PNG and browsers animate the extra chunks.
	if !bytes.HasSuffix([]byte(url), []byte(".png")) {
		t.Errorf("image_url = %q, want a .png extension so app.Static serves image/png", url)
	}
}

// A sticker was stored at full size: uploads used c.SaveFile, so a 3.1 MB phone
// photo stayed 3.1 MB. imageproc.Store is what compresses every other upload,
// and Sniff takes the extension from the bytes.
func TestAdminUploadSticker_CompressesAndSniffsExtension(t *testing.T) {
	app, _, adminID := setupTestApp(t)
	packID := seedPack(t, "Пак")

	// A real JPEG, big enough that leaving it alone is visible: 1200x1200 of
	// gradient, which compresses well but not to nothing.
	img := image.NewRGBA(image.Rect(0, 0, 1200, 1200))
	for y := 0; y < 1200; y++ {
		for x := 0; x < 1200; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 98}); err != nil {
		t.Fatal(err)
	}
	original := buf.Len()

	// Named .png on purpose: the name must not decide the stored extension.
	body := buf.Bytes()
	var form bytes.Buffer
	w := multipart.NewWriter(&form)
	part, err := w.CreateFormFile("sticker", "sticker.png")
	if err != nil {
		t.Fatal(err)
	}
	part.Write(body)
	w.Close()

	req, _ := http.NewRequest("POST", "/admin/sticker-packs/"+itoa(packID)+"/stickers", &form)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, adminID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		out := new(bytes.Buffer)
		out.ReadFrom(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, out.String())
	}

	var url string
	database.DB.QueryRow("SELECT image_url FROM stickers WHERE pack_id = ?", packID).Scan(&url)

	// Sniffed from the bytes: it is a JPEG, so it must not be stored as .png.
	if !bytes.HasSuffix([]byte(url), []byte(".jpg")) {
		t.Errorf("image_url = %q, want a .jpg extension sniffed from the bytes", url)
	}

	// The URL is the promise the static handler keeps, so the bytes have to be
	// where it says. Reading the bare filename would have passed while the file
	// sat outside uploads/ - which is exactly what happened: the path used to be
	// the bare "stickers", writing to ./stickers/ and serving 404s, and this
	// test still went green because it looked the file up by name.
	stored, err := os.ReadFile("." + filepath.FromSlash(url))
	if err != nil {
		t.Fatalf("stored file at %s: %v", url, err)
	}
	if len(stored) >= original {
		t.Errorf("stored %d bytes, original %d: not compressed", len(stored), original)
	}

	// Nothing may land outside uploads/: that tree is a bind mount and a static
	// route, and a file elsewhere is unreachable no matter what the URL says.
	if _, err := os.Stat("stickers"); err == nil {
		t.Error("upload wrote a ./stickers/ directory in the working tree")
	}
}

// The allowlist still rejects what it did before - the .apng addition must not
// have turned into "accept anything".
func TestAdminUploadSticker_RejectsNonImage(t *testing.T) {
	app, _, adminID := setupTestApp(t)
	packID := seedPack(t, "Пак")

	for _, name := range []string{"evil.svg", "script.html", "notes.txt"} {
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		part, _ := w.CreateFormFile("sticker", name)
		part.Write([]byte("<svg onload=alert(1)>"))
		w.Close()

		req, _ := http.NewRequest("POST", "/admin/sticker-packs/"+itoa(packID)+"/stickers", &buf)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.Header.Set("Authorization", bearerToken(t, adminID, true))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 400 {
			t.Errorf("%s: expected 400, got %d", name, resp.StatusCode)
		}
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM stickers WHERE pack_id = ?", packID).Scan(&count)
	if count != 0 {
		t.Errorf("%d stickers stored from rejected uploads, want 0", count)
	}
}

func itoa(id int64) string {
	return strconv.FormatInt(id, 10)
}