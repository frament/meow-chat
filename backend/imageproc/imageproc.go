// Package imageproc rewrites uploaded images so they cost less to send.
//
// It rewrites JPEG and nothing else. Compress explains why the other formats
// pass through untouched.
package imageproc

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"

	"golang.org/x/image/draw"
)

const (
	// Quality is the JPEG quality the rewrite aims for. It was picked by eye
	// rather than measured: high enough that recompression stays invisible on a
	// phone screen, low enough to cost roughly a third of the bytes.
	Quality = 82

	// MaxEdge caps the long side. A chat bubble is about 300 pixels wide and the
	// feed shows images full width, so this leaves room for a desktop display at
	// 2x without carrying pixels nobody can see.
	MaxEdge = 1920

	// minSavings is how much smaller the rewrite has to be before it is preferred
	// over the original. Without it a photo that is already well compressed gets
	// re-encoded for nothing, and every upload pays for a resize it did not need.
	minSavings = 0.05
)

// ErrNotAnImage is returned by Sniff for bytes that are not a picture.
var ErrNotAnImage = errors.New("not a recognised image")

// Compress returns a smaller JPEG, and whether it produced one worth keeping.
//
// Why JPEG only, decided 2026-10-02 from what the server actually holds: two
// 12-megapixel phone photos were 62% of every byte stored, shown in a chat
// bubble roughly 300 pixels wide. So the long side is capped, the quality is
// lowered, and whichever of the two files is smaller wins.
//
// The formats left alone are left alone on purpose:
//
//   - PNG, because that is what people upload screenshots in. Re-encoding a
//     screenshot as JPEG is what makes text look broken, and telling a
//     photograph from a screenshot needs something this project does not have.
//   - GIF and WebP, because pure Go can decode a WebP but cannot encode one, and
//     the standard library does not write animated GIFs at all. They pass through
//     byte for byte.
//
// That last point is a real gap, not a shrug: a phone photo uploaded as WebP
// keeps its full size. Closing it means cgo, and cgo goes away in v2.0.0.
//
// A rewritten JPEG also loses its EXIF, which is where phones record the device,
// the time, and sometimes the coordinates. Re-encoding is what strips it, so an
// image small enough to be kept as-is keeps its metadata too. Stripping
// unconditionally would mean accepting a larger file to throw away bytes, which
// is the opposite of what this function is for.
func Compress(data []byte) ([]byte, bool, error) {
	if !isJPEG(data) {
		return data, false, nil
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, false, err
	}

	// Turn the image upright before measuring it. The stored pixels of a phone
	// photo are often sideways, and the long side of the stored image is not
	// necessarily the long side of the photo - capping first would leave a
	// portrait photo at 1440 pixels tall and 1920 wide, which is the wrong way
	// round.
	var img image.Image = src
	if o := exifOrientation(data); o != 1 {
		img = oriented(src, o)
	}

	bounds := img.Bounds()
	var toEncode image.Image = img
	if max(bounds.Dx(), bounds.Dy()) > MaxEdge {
		scale := float64(MaxEdge) / float64(max(bounds.Dx(), bounds.Dy()))
		dst := image.NewRGBA(image.Rect(0, 0, int(float64(bounds.Dx())*scale), int(float64(bounds.Dy())*scale)))
		// CatmullRom over the source's alpha channel, so the resize does not bleed
		// the colour of one edge pixel across the whole image.
		draw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, draw.Src, nil)
		toEncode = dst
	}

	var buf bytes.Buffer
	buf.Grow(len(data) / 2)
	if err := jpeg.Encode(&buf, toEncode, &jpeg.Options{Quality: Quality}); err != nil {
		return data, false, err
	}

	if buf.Len() >= int(float64(len(data))*(1-minSavings)) {
		return data, false, nil
	}
	return buf.Bytes(), true, nil
}

// Sniff returns the file extension that matches what the bytes actually are,
// without a leading dot. The name a client sent is not consulted: a photo
// uploaded as photo.png is JPEG, and storing it under that name makes the
// static handler serve it as image/png.
func Sniff(data []byte) (string, error) {
	switch {
	case isJPEG(data):
		return "jpg", nil
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "png", nil
	case bytes.HasPrefix(data, []byte("GIF87a")), bytes.HasPrefix(data, []byte("GIF89a")):
		return "gif", nil
	case len(data) >= 12 && bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "webp", nil
	default:
		return "", ErrNotAnImage
	}
}

func isJPEG(data []byte) bool {
	// SOI marker followed by any marker. The third byte is deliberately not
	// checked: a truncated upload should still be recognised, so that the caller
	// can try to decode it and report the real error.
	return len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF
}
