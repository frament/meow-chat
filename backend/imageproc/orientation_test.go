package imageproc

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"testing"
)

// withOrientation inserts an EXIF orientation tag into a JPEG, the way a camera
// writes one. Only the tag is built: a real EXIF block also carries the camera
// model and the coordinates, and nothing here reads those.
func withOrientation(t *testing.T, jpegBytes []byte, orientation uint16) []byte {
	t.Helper()

	// A TIFF header, then a one-entry IFD0 holding tag 0x0112 as a SHORT.
	tiff := make([]byte, 0, 26)
	tiff = append(tiff, 'I', 'I')
	tiff = binary.LittleEndian.AppendUint16(tiff, 42)
	tiff = binary.LittleEndian.AppendUint32(tiff, 8) // IFD0 right after the header
	tiff = binary.LittleEndian.AppendUint16(tiff, 1) // one entry
	tiff = binary.LittleEndian.AppendUint16(tiff, 0x0112)
	tiff = binary.LittleEndian.AppendUint16(tiff, 3) // SHORT
	tiff = binary.LittleEndian.AppendUint32(tiff, 1) // count
	tiff = binary.LittleEndian.AppendUint16(tiff, orientation)
	tiff = append(tiff, 0, 0) // the value field is four bytes wide

	payload := append([]byte("Exif\x00\x00"), tiff...)

	seg := []byte{0xFF, 0xE1}
	seg = binary.BigEndian.AppendUint16(seg, uint16(2+len(payload)))
	seg = append(seg, payload...)

	// Straight after the start of image marker, which is where cameras put it.
	out := append([]byte{}, jpegBytes[:2]...)
	out = append(out, seg...)
	out = append(out, jpegBytes[2:]...)
	return out
}

func TestExifOrientationReadsTheTag(t *testing.T) {
	base := fixtureJPEG(t, noise(16, 16), 80)

	if got := exifOrientation(base); got != 1 {
		t.Errorf("a JPEG with no EXIF should read as 1, got %d", got)
	}
	for o := uint16(1); o <= 8; o++ {
		if got := exifOrientation(withOrientation(t, base, o)); got != int(o) {
			t.Errorf("orientation %d read back as %d", o, got)
		}
	}
}

func TestExifOrientationSurvivesRubbish(t *testing.T) {
	base := withOrientation(t, fixtureJPEG(t, noise(16, 16), 80), 6)

	cases := []struct {
		name   string
		mangle func([]byte) []byte
	}{
		// The EXIF block sits right after the start marker, so cutting the file
		// short is what damages it.
		{"truncated inside the exif block", func(b []byte) []byte { return b[:20] }},
		{"truncated right after the signature", func(b []byte) []byte { return b[:2] }},
		{"empty", func(b []byte) []byte { return nil }},
		{"just a signature", func(b []byte) []byte { return []byte{0xFF, 0xD8, 0xFF} }},
		{"bad byte order", func(b []byte) []byte {
			c := append([]byte{}, b...)
			i := bytes.Index(c, []byte("Exif\x00\x00"))
			c[i+6] = 'X'
			c[i+7] = 'X'
			return c
		}},
		{"bad magic number", func(b []byte) []byte {
			c := append([]byte{}, b...)
			i := bytes.Index(c, []byte("Exif\x00\x00"))
			binary.LittleEndian.PutUint16(c[i+8:i+10], 0xFFFF)
			return c
		}},
		{"offset past the end", func(b []byte) []byte {
			c := append([]byte{}, b...)
			i := bytes.Index(c, []byte("Exif\x00\x00"))
			binary.LittleEndian.PutUint32(c[i+10:i+14], 0xFFFFFF)
			return c
		}},
		{"entry count past the end", func(b []byte) []byte {
			c := append([]byte{}, b...)
			i := bytes.Index(c, []byte("Exif\x00\x00"))
			binary.LittleEndian.PutUint16(c[i+14:i+16], 0xFFFF)
			return c
		}},
		{"orientation out of range", func(b []byte) []byte {
			c := append([]byte{}, b...)
			i := bytes.Index(c, []byte("Exif\x00\x00"))
			binary.LittleEndian.PutUint16(c[i+24:i+26], 42)
			return c
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// The point is that it answers 1 and does not panic on input that came
			// from a phone, a browser or an attacker.
			if got := exifOrientation(tc.mangle(base)); got != 1 {
				t.Errorf("expected a fallback to 1, got %d", got)
			}
		})
	}
}

// A JPEG with a segment length that runs past the end of the data must not send
// the segment walk off the end of the buffer.
func TestExifSegmentStopsAtBadLengths(t *testing.T) {
	full := withOrientation(t, fixtureJPEG(t, noise(16, 16), 80), 6)
	for _, n := range []int{3, 5, 20, 30, 60, 100} {
		if n >= len(full) {
			continue
		}
		truncated := append([]byte{}, full[:n]...)
		got := exifOrientation(truncated)
		if got < 1 || got > 8 {
			t.Errorf("truncated to %d bytes: got %d", n, got)
		}
	}
}

// The regression this whole file exists for. Phone photos store their pixels
// sideways and leave a tag saying so; a browser reads the tag, the Go decoder
// does not. Re-encoding without rotating therefore turns a photo that displays
// correctly into one that displays on its side.
func TestCompressTurnsAnOrientedPhotoUpright(t *testing.T) {
	plain := fixtureJPEG(t, noise(2400, 1800), 92)
	rotated := withOrientation(t, plain, 6)

	if w, h := decodeConfig(t, rotated); w != 2400 || h != 1800 {
		t.Fatalf("fixture should still be 2400x1800 on disk, got %dx%d", w, h)
	}

	out, changed, err := Compress(rotated)
	if err != nil {
		t.Fatalf("Compress: %v", err)
	}
	if !changed {
		t.Fatal("expected a rewrite")
	}

	w, h := decodeConfig(t, out)
	if w != 1440 || h != MaxEdge {
		t.Errorf("expected a quarter turn to 1440x%d, got %dx%d", MaxEdge, w, h)
	}
	if bytes.Contains(out, []byte("Exif")) {
		t.Error("expected the EXIF block to be gone")
	}
}

// The cap has to be applied after the turn. Stored 1800x2400 and turned a
// quarter turn, the upright image is 2400x1800 and its long side is the width.
// Capping the stored pixels first would have produced the transposed
// 1440x1920, so the dimensions alone show which order it happened in.
func TestCompressCapsTheLongSideOfTheUprightImage(t *testing.T) {
	out, _, err := Compress(withOrientation(t, fixtureJPEG(t, noise(1800, 2400), 92), 6))
	if err != nil {
		t.Fatalf("Compress: %v", err)
	}
	w, h := decodeConfig(t, out)
	if w != MaxEdge || h != 1440 {
		t.Errorf("expected %dx1440, got %dx%d", MaxEdge, w, h)
	}
}

func TestOrientedDimensions(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 4, 2))
	src.Set(0, 0, rgba(255, 0, 0))
	src.Set(3, 1, rgba(0, 0, 255))

	cases := []struct {
		orientation int
		w, h        int
	}{
		{1, 4, 2},
		{2, 4, 2},
		{3, 4, 2},
		{4, 4, 2},
		{5, 2, 4},
		{6, 2, 4},
		{7, 2, 4},
		{8, 2, 4},
	}

	for _, tc := range cases {
		got := oriented(src, tc.orientation)
		if got.Rect.Dx() != tc.w || got.Rect.Dy() != tc.h {
			t.Errorf("orientation %d: got %dx%d, want %dx%d",
				tc.orientation, got.Rect.Dx(), got.Rect.Dy(), tc.w, tc.h)
		}
	}
}

// A quarter turn has to actually move the corners: the red pixel in the top
// left of a 6-orientation image belongs in the top right of the result.
func TestOrientedMovesPixels(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 2, 2))
	src.Set(0, 0, rgba(255, 0, 0)) // top left
	src.Set(1, 0, rgba(0, 255, 0)) // top right
	src.Set(0, 1, rgba(0, 0, 255)) // bottom left
	src.Set(1, 1, rgba(255, 255, 0))

	for _, tc := range []struct {
		orientation int
		from, to    image.Point
	}{
		{6, image.Pt(0, 0), image.Pt(1, 0)}, // rotate 90 CW: top left -> top right
		{8, image.Pt(0, 0), image.Pt(0, 1)}, // rotate 90 CCW: top left -> bottom left
		{3, image.Pt(0, 0), image.Pt(1, 1)}, // 180: top left -> bottom right
		{2, image.Pt(0, 0), image.Pt(1, 0)}, // mirror: top left -> top right
		{4, image.Pt(0, 0), image.Pt(0, 1)}, // flip: top left -> bottom left
	} {
		got := oriented(src, tc.orientation)
		if !equal(got.RGBAAt(tc.to.X, tc.to.Y), src.RGBAAt(tc.from.X, tc.from.Y)) {
			t.Errorf("orientation %d: expected the pixel from %v to land at %v", tc.orientation, tc.from, tc.to)
		}
	}
}

func rgba(r, g, b uint8) color.RGBA { return color.RGBA{R: r, G: g, B: b, A: 255} }

func equal(a, b color.Color) bool {
	ar, ag, ab, aa := a.RGBA()
	br, bg, bb, ba := b.RGBA()
	return ar == br && ag == bg && ab == bb && aa == ba
}
