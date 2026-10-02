package imageproc

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"math/rand"
	"testing"
)

// noise builds an image that JPEG cannot do well on, which is the closest thing
// to a phone photo available without shipping a binary fixture. A real photo of
// a scene compresses much better, but it also shrinks much more under a
// lower quality setting, so noise is the harsher case: if the rewrite wins here
// it wins on real photographs too.
func noise(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rnd := rand.New(rand.NewSource(1))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{
				R: uint8(rnd.Intn(256)),
				G: uint8(rnd.Intn(256)),
				B: uint8(rnd.Intn(256)),
				A: 255,
			})
		}
	}
	return img
}

// flat builds an image with nothing in it, which is the sharpest version of
// "already as small as this format can make it": there is no detail to lose and
// no redundancy to squeeze, so a rewrite at a lower quality cannot save anything.
func flat(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 180, B: 160, A: 255})
		}
	}
	return img
}

// fixtureJPEG encodes at a chosen quality, which is how the tests get a
// file that is deliberately badly or well compressed.
func fixtureJPEG(t *testing.T, img image.Image, quality int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		t.Fatalf("fixture encode: %v", err)
	}
	return buf.Bytes()
}

func decodeConfig(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("result is not a decodable image: %v", err)
	}
	return cfg.Width, cfg.Height
}

func TestCompressShrinksAndCapsAPhotosizedJPEG(t *testing.T) {
	// Larger than MaxEdge on the long side, the shape of a 12 megapixel phone
	// photo.
	in := fixtureJPEG(t, noise(2400, 1800), 92)

	out, changed, err := Compress(in)
	if err != nil {
		t.Fatalf("Compress: %v", err)
	}
	if !changed {
		t.Fatal("expected a rewrite of a 2400px JPEG")
	}
	if len(out) >= len(in) {
		t.Errorf("expected fewer bytes, got %d from %d", len(out), len(in))
	}

	w, h := decodeConfig(t, out)
	if max(w, h) != MaxEdge {
		t.Errorf("expected long side capped to %d, got %dx%d", MaxEdge, w, h)
	}
	// The short side has to keep its shape, or a photo comes out squashed.
	if want := 1800 * MaxEdge / 2400; abs(h-want) > 2 {
		t.Errorf("expected height near %d to keep the aspect ratio, got %dx%d", want, w, h)
	}
}

func TestCompressKeepsTheOriginalWhenTheRewriteDoesNotPay(t *testing.T) {
	// Nothing to gain. Re-encoding at 82 would only add generation loss, so the
	// original stands.
	in := fixtureJPEG(t, flat(400, 300), 97)

	out, changed, err := Compress(in)
	if err != nil {
		t.Fatalf("Compress: %v", err)
	}
	if changed {
		t.Fatalf("expected the original to be kept, got a rewrite of %d bytes into %d", len(in), len(out))
	}
	if !bytes.Equal(out, in) {
		t.Error("expected the original bytes back, unchanged")
	}
}

func TestCompressNeverUpscales(t *testing.T) {
	in := fixtureJPEG(t, noise(200, 150), 70)

	out, _, err := Compress(in)
	if err != nil {
		t.Fatalf("Compress: %v", err)
	}
	w, h := decodeConfig(t, out)
	if w != 200 || h != 150 {
		t.Errorf("expected 200x150, got %dx%d", w, h)
	}
}

func TestCompressPassesOtherFormatsThroughByteForByte(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		{"png", append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0x42}, 64)...)},
		{"gif", append([]byte("GIF89a"), bytes.Repeat([]byte{0x21}, 64)...)},
		{"webp", append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), bytes.Repeat([]byte{0x00}, 32)...)},
		{"plain text", []byte("this is not an image at all")},
		{"empty", nil},
		// A PNG that is also a GIF, to prove the order of the checks does not
		// matter for a format we never touch.
		{"gif named png", append([]byte("GIF89a"), bytes.Repeat([]byte{0x21}, 16)...)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, changed, err := Compress(tc.data)
			if err != nil {
				t.Fatalf("Compress: %v", err)
			}
			if changed {
				t.Error("expected no rewrite")
			}
			if !bytes.Equal(out, tc.data) {
				t.Error("expected the bytes back untouched")
			}
		})
	}
}

func TestCompressReportsAnErrorOnAJPEGItCannotDecode(t *testing.T) {
	// The signature is right but the body is not, so the rewrite fails. The
	// original still comes back, because a slightly worse photo is better than a
	// rejected upload.
	in := append([]byte{0xFF, 0xD8, 0xFF}, bytes.Repeat([]byte{0x11}, 32)...)

	out, changed, err := Compress(in)
	if err == nil {
		t.Error("expected a decode error to be reported")
	}
	if changed {
		t.Error("expected no rewrite after a failure")
	}
	if !bytes.Equal(out, in) {
		t.Error("expected the original bytes back after a failure")
	}
}

func TestSniff(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"jpeg", fixtureJPEG(t, noise(8, 8), 80), "jpg"},
		{"png", append([]byte("\x89PNG\r\n\x1a\n"), 0x00), "png"},
		{"gif87", []byte("GIF87a...."), "gif"},
		{"gif89", []byte("GIF89a...."), "gif"},
		{"webp", []byte("RIFF\x24\x00\x00\x00WEBPVP8 "), "webp"},
		{"truncated jpeg is still a jpeg", []byte{0xFF, 0xD8, 0xFF}, "jpg"},
		{"riff that is not webp", []byte("RIFF\x24\x00\x00\x00AVI LIST"), ""},
		{"too short for riff", []byte("RIFF"), ""},
		{"pdf", []byte("%PDF-1.7"), ""},
		{"empty", nil, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Sniff(tc.data)
			if tc.want == "" {
				if err == nil {
					t.Fatalf("expected ErrNotAnImage, got extension %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("Sniff: %v", err)
			}
			if got != tc.want {
				t.Errorf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

// The extension has to come from the bytes. A photo uploaded as photo.png used
// to be stored as - and served as - image/png.
func TestSniffIgnoresTheNameTheClientSent(t *testing.T) {
	jpegBytes := fixtureJPEG(t, noise(8, 8), 80)

	got, err := Sniff(jpegBytes)
	if err != nil {
		t.Fatalf("Sniff: %v", err)
	}
	if got != "jpg" {
		t.Errorf("expected jpg for JPEG bytes, got %q", got)
	}
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
