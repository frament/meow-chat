package imageproc

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestThumbnailCapsEachSize(t *testing.T) {
	src := fixtureJPEG(t, noise(2400, 1800), 92)

	for _, edge := range []int{ThumbEdge, PreviewEdge} {
		out, err := Thumbnail(src, edge)
		if err != nil {
			t.Fatalf("Thumbnail(%d): %v", edge, err)
		}
		w, h := decodeConfig(t, out)
		if max(w, h) != edge {
			t.Errorf("expected long side %d, got %dx%d", edge, w, h)
		}
		if len(out) >= len(src) {
			t.Errorf("expected a %dpx thumbnail to be smaller than the original, got %d from %d",
				edge, len(out), len(src))
		}
	}
}

func TestThumbnailNeverUpscales(t *testing.T) {
	src := fixtureJPEG(t, noise(120, 90), 85)

	out, err := Thumbnail(src, PreviewEdge)
	if err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}
	if w, h := decodeConfig(t, out); w != 120 || h != 90 {
		t.Errorf("expected 120x90, got %dx%d", w, h)
	}
}

func TestThumbnailTurnsAnOrientedPhotoUprightToo(t *testing.T) {
	src := withOrientation(t, fixtureJPEG(t, noise(800, 600), 92), 6)

	out, err := Thumbnail(src, ThumbEdge)
	if err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}
	w, h := decodeConfig(t, out)
	if w >= h {
		t.Errorf("expected a portrait thumbnail after a quarter turn, got %dx%d", w, h)
	}
	if max(w, h) != ThumbEdge {
		t.Errorf("expected long side %d, got %dx%d", ThumbEdge, w, h)
	}
}

func TestThumbnailRefusesFormatsItCannotWrite(t *testing.T) {
	cases := map[string][]byte{
		"png":  append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0x42}, 32)...),
		"gif":  append([]byte("GIF89a"), bytes.Repeat([]byte{0x21}, 32)...),
		"webp": append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), bytes.Repeat([]byte{0x00}, 32)...),
	}
	for name, data := range cases {
		if _, err := Thumbnail(data, ThumbEdge); err != ErrNoThumbnail {
			t.Errorf("%s: expected ErrNoThumbnail, got %v", name, err)
		}
	}
}

// Thumbnail is what the chat bubble shows, and the point of it is that the
// browser downloads far fewer bytes. If the numbers stop saying that, the
// feature is doing work for nothing.
func TestThumbnailsAreMuchSmallerThanTheStoredImage(t *testing.T) {
	stored, _, err := Compress(fixtureJPEG(t, noise(2400, 1800), 92))
	if err != nil {
		t.Fatalf("Compress: %v", err)
	}
	thumb, err := Thumbnail(fixtureJPEG(t, noise(2400, 1800), 92), ThumbEdge)
	if err != nil {
		t.Fatalf("Thumbnail: %v", err)
	}

	ratio := float64(len(stored)) / float64(len(thumb))
	if ratio < 4 {
		t.Errorf("expected the chat thumbnail to be at least 4x smaller, got %.1fx (%d -> %d)",
			ratio, len(stored), len(thumb))
	}
}

func TestStoreWritesTheImageAndBothThumbnails(t *testing.T) {
	dir := t.TempDir()
	// Store derives the thumbnail location from the original's, so the layout has
	// to match what splitUploadURL expects: an "uploads" directory under the
	// working directory.
	if err := os.MkdirAll(filepath.Join(dir, "uploads", "posts"), 0755); err != nil {
		t.Fatal(err)
	}
	chdir(t, dir)

	stored, err := Store("./uploads/posts", "7_1", fixtureJPEG(t, noise(2400, 1800), 92))
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	if stored.URL != "/uploads/posts/7_1.jpg" {
		t.Errorf("unexpected url %q", stored.URL)
	}
	if stored.Thumb != "/uploads/thumbs/posts/7_1_400.jpg" {
		t.Errorf("unexpected thumb url %q", stored.Thumb)
	}
	if stored.Preview != "/uploads/thumbs/posts/7_1_1200.jpg" {
		t.Errorf("unexpected preview url %q", stored.Preview)
	}

	for _, path := range []string{
		"./uploads/posts/7_1.jpg",
		"./uploads/thumbs/posts/7_1_400.jpg",
		"./uploads/thumbs/posts/7_1_1200.jpg",
	} {
		if _, err := os.Stat(path); err != nil {
			t.Errorf("expected %s on disk: %v", path, err)
		}
	}
}

// The whole point of deriving thumbnails from the original URL is that the read
// path can find them without a database column. If Store and ThumbURLs disagree
// about a path, every image silently falls back to the full-size one and nothing
// looks broken.
func TestThumbURLsFindsWhatStoreWrote(t *testing.T) {
	chdir(t, t.TempDir())
	if err := os.MkdirAll("./uploads/posts", 0755); err != nil {
		t.Fatal(err)
	}

	src := fixtureJPEG(t, noise(2400, 1800), 92)
	stored, err := Store("./uploads/posts", "7_2", src)
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	thumb, preview := ThumbURLs(stored.URL)
	if thumb != stored.Thumb {
		t.Errorf("thumb mismatch: found %q, wrote %q", thumb, stored.Thumb)
	}
	if preview != stored.Preview {
		t.Errorf("preview mismatch: found %q, wrote %q", preview, stored.Preview)
	}
}

// The twenty-odd images already on the server predate this. They have no
// thumbnails, and the answer has to be empty rather than a URL that 404s.
func TestThumbURLsIsEmptyForAnImageWithoutThumbnails(t *testing.T) {
	chdir(t, t.TempDir())
	if err := os.MkdirAll("./uploads/messages", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("./uploads/messages/12_IMG_1352.jpg", []byte("not really a jpeg"), 0644); err != nil {
		t.Fatal(err)
	}

	if thumb, preview := ThumbURLs("/uploads/messages/12_IMG_1352.jpg"); thumb != "" || preview != "" {
		t.Errorf("expected both empty for a file with no thumbnails, got %q and %q", thumb, preview)
	}
}

func TestThumbURLsIgnoresAnythingNotStoredLocally(t *testing.T) {
	chdir(t, t.TempDir())

	cases := []struct {
		name string
		url  string
	}{
		{"a peer's address, kept because the download failed", "https://peer.example.com/uploads/posts/1_1.jpg"},
		{"protocol relative", "//peer.example.com/uploads/posts/1_1.jpg"},
		{"outside uploads", "/static/photos/1_1.jpg"},
		{"no subdirectory", "/uploads/1_1.jpg"},
		{"traversal in the name", "/uploads/posts/../../etc/passwd"},
		{"traversal in the directory", "/uploads/../secrets/1_1.jpg"},
		{"empty", ""},
		{"just the prefix", "/uploads/"},
		{"bare filename", "1_1.jpg"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Refusing these is what stops a remote URL from being turned into a
			// path to probe on every read of the feed.
			thumb, preview := ThumbURLs(tc.url)
			if thumb != "" || preview != "" {
				t.Errorf("expected empty, got %q and %q", thumb, preview)
			}
		})
	}
}

// Files uploaded before the extension came from the bytes kept whatever the
// client sent, including the long form.
func TestThumbURLsHandlesTheOldJpegExtension(t *testing.T) {
	chdir(t, t.TempDir())
	if err := os.MkdirAll("./uploads/thumbs/posts", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("./uploads/thumbs/posts/6_1_400.jpg", []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	thumb, _ := ThumbURLs("/uploads/posts/6_1.jpeg")
	if thumb != "/uploads/thumbs/posts/6_1_400.jpg" {
		t.Errorf("expected the .jpeg name to resolve to the same thumbnail, got %q", thumb)
	}
}

func TestStoreLeavesThumbsEmptyForFormatsItCannotWrite(t *testing.T) {
	chdir(t, t.TempDir())
	if err := os.MkdirAll("./uploads/posts", 0755); err != nil {
		t.Fatal(err)
	}

	gif := append([]byte("GIF89a"), bytes.Repeat([]byte{0x21}, 64)...)
	stored, err := Store("./uploads/posts", "9_1", gif)
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	if stored.URL != "/uploads/posts/9_1.gif" {
		t.Errorf("unexpected url %q", stored.URL)
	}
	if stored.Thumb != "" || stored.Preview != "" {
		t.Errorf("expected no thumbnails for a GIF, got %q and %q", stored.Thumb, stored.Preview)
	}
	// The original still has to be there, byte for byte: it is the only copy.
	onDisk, err := os.ReadFile("./uploads/posts/9_1.gif")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(onDisk, gif) {
		t.Error("expected the GIF stored untouched")
	}
}

func TestStoreRefusesNonImages(t *testing.T) {
	chdir(t, t.TempDir())

	if _, err := Store("./uploads/posts", "1_1", []byte("%PDF-1.7 this is a document")); err != ErrNotAnImage {
		t.Errorf("expected ErrNotAnImage, got %v", err)
	}
}

func TestStoreWritesTheStoredImageCompressed(t *testing.T) {
	chdir(t, t.TempDir())
	if err := os.MkdirAll("./uploads/posts", 0755); err != nil {
		t.Fatal(err)
	}

	src := fixtureJPEG(t, noise(2400, 1800), 92)
	if _, err := Store("./uploads/posts", "8_1", src); err != nil {
		t.Fatalf("Store: %v", err)
	}

	onDisk, err := os.ReadFile("./uploads/posts/8_1.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if len(onDisk) >= len(src) {
		t.Errorf("expected the stored image to be compressed, got %d from %d", len(onDisk), len(src))
	}
	if w, h := decodeConfig(t, onDisk); max(w, h) > MaxEdge {
		t.Errorf("expected the stored image capped to %d, got %dx%d", MaxEdge, w, h)
	}
}

// chdir points the relative uploads paths at a scratch directory. It restores the
// previous directory afterwards, so tests do not depend on each other's order.
func chdir(t *testing.T, dir string) {
	t.Helper()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chdir(previous) })
}
