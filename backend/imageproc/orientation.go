package imageproc

import (
	"encoding/binary"
	"image"
	"image/draw"
)

// exifOrientation reads the orientation tag out of a JPEG and returns the value
// as defined by the EXIF standard, 1 meaning "no rotation needed".
//
// It exists because of the one thing rewriting an image does that a browser
// notices. A JPEG's pixels are often stored sideways with a tag saying how to
// turn them, and it is the browser that turns them. The standard library
// decodes the pixels without reading the tag and the encoder never writes it, so
// a straight re-encode takes a photo that displays correctly and stores one that
// displays on its side. Rotating the pixels ourselves is what makes dropping the
// metadata safe.
//
// Anything unexpected here answers 1, the no-rotation case. Guessing at a
// transform on malformed metadata would be a good way to turn a cosmetic
// problem into a scrambled photo, and the input is whatever a phone uploaded.
func exifOrientation(data []byte) int {
	seg, ok := exifSegment(data)
	if !ok {
		return 1
	}

	// The TIFF header starts right after "Exif\0\0".
	if len(seg) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(seg[0:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(seg[2:4]) != 42 {
		return 1
	}

	ifd := int(order.Uint32(seg[4:8]))
	if ifd < 8 || ifd+2 > len(seg) {
		return 1
	}
	entries := int(order.Uint16(seg[ifd : ifd+2]))
	if entries < 0 || ifd+2+entries*12 > len(seg) {
		return 1
	}

	for i := 0; i < entries; i++ {
		e := ifd + 2 + i*12
		if order.Uint16(seg[e:e+2]) != 0x0112 {
			continue
		}
		if typ := order.Uint16(seg[e+2 : e+4]); typ != 3 && typ != 4 {
			return 1
		}
		value := int(order.Uint16(seg[e+8 : e+10]))
		if value < 1 || value > 8 {
			return 1
		}
		return value
	}
	return 1
}

// exifSegment returns the payload of the first APP1 segment that holds EXIF,
// with the "Exif\0\0" header already stripped off.
func exifSegment(data []byte) ([]byte, bool) {
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			i++
			continue
		}
		marker := data[i+1]
		switch {
		case marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7):
			i += 2
			continue
		case marker == 0xDA || marker == 0xD9:
			// Start of scan or end of image: no metadata past this point.
			return nil, false
		}

		length := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
		if length < 2 || i+2+length > len(data) {
			return nil, false
		}
		payload := data[i+4 : i+2+length]
		if marker == 0xE1 && len(payload) >= 6 && string(payload[:6]) == "Exif\x00\x00" {
			return payload[6:], true
		}
		i += 2 + length
	}
	return nil, false
}

// oriented returns src turned upright according to an EXIF orientation value.
// The result is RGBA because the transforms rewrite the image rather than
// sample it, and the point-free pixel loops below are clearer than a
// transformation matrix.
func oriented(src image.Image, orientation int) *image.RGBA {
	b := src.Bounds()
	flat := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(flat, flat.Bounds(), src, b.Min, draw.Src)

	switch orientation {
	case 2:
		return flipHorizontal(flat)
	case 3:
		return rotate180(flat)
	case 4:
		return flipVertical(flat)
	case 5:
		return flipHorizontal(rotate90CW(flat))
	case 6:
		return rotate90CW(flat)
	case 7:
		return flipVertical(rotate90CW(flat))
	case 8:
		return rotate180(rotate90CW(flat))
	default:
		return flat
	}
}

func rotate90CW(src *image.RGBA) *image.RGBA {
	w, h := src.Rect.Dx(), src.Rect.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(h-1-y, x, src.RGBAAt(x, y))
		}
	}
	return dst
}

func rotate180(src *image.RGBA) *image.RGBA {
	w, h := src.Rect.Dx(), src.Rect.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(w-1-x, h-1-y, src.RGBAAt(x, y))
		}
	}
	return dst
}

func flipHorizontal(src *image.RGBA) *image.RGBA {
	w, h := src.Rect.Dx(), src.Rect.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(w-1-x, y, src.RGBAAt(x, y))
		}
	}
	return dst
}

func flipVertical(src *image.RGBA) *image.RGBA {
	w, h := src.Rect.Dx(), src.Rect.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(x, h-1-y, src.RGBAAt(x, y))
		}
	}
	return dst
}
