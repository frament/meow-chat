// Command recompress-stickers rewrites sticker files that were stored before the
// upload path started shrinking them.
//
// Stickers used to be written with c.SaveFile, straight from the multipart file,
// so whatever arrived was stored as-is. On the home server that left one sticker
// at 3 135 669 bytes - a 1625x2426 phone photo drawn in a 96-pixel bubble, and
// fetched in full by every member of the group. The upload path is fixed; this
// is for the files already on disk.
//
// Two different operations, because the formats need different ones:
//
//   - JPEG: imageproc.Compress, the same call the upload path now makes.
//   - PNG: lossless downscale. Not a re-encode - a sticker has an alpha channel
//     and turning it into JPEG would put a black box around it. Resizing keeps
//     every pixel's colour and transparency and only makes them fewer.
//   - GIF/WebP: untouched. Animated, and there is no pure-Go encoder for either.
//
// The 512-pixel cap is deliberately generous: stickers are drawn at 96px, so 512
// is already five times what any screen asks for, and it leaves room for a
// future zoom without a second pass.
//
// Usage: recompress-stickers [-n] <uploads-dir>
//
//	-n   dry run: report what would change, write nothing
package main

import (
	"bytes"
	"flag"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"

	"golang.org/x/image/draw"
	"my-chat-backend/imageproc"
)

// stickerEdge is the long side every sticker is reduced to.
const stickerEdge = 512

// stickerPNGNote explains in every run why GIF and WebP are left alone, because
// "why is my sticker not smaller" is the obvious question and this is the part
// of the answer that looks like an omission.
//
// imageproc.Compress answers for JPEG only, and this tool goes further for PNG
// by resizing rather than re-encoding. Neither is possible for GIF or animated
// WebP: there is no pure-Go encoder for either, and the resize trick does not
// apply because dropping frames of an animation is not a resize.
const stickerPNGNote = `GIF and WebP left alone: animated, and no pure-Go encoder
exists for either. Dropping frames to shrink one is not a compression.`

func main() {
	dryRun := flag.Bool("n", false, "dry run: report, write nothing")
	flag.Parse()

	dir := "./uploads/stickers"
	if flag.NArg() > 0 {
		dir = flag.Arg(0)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read %s: %v\n", dir, err)
		os.Exit(1)
	}

	var totalBefore, totalAfter int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(dir, e.Name())
		before, err := os.ReadFile(path)
		if err != nil {
			fmt.Printf("  %-28s unreadable: %v\n", e.Name(), err)
			continue
		}
		totalBefore += int64(len(before))

		after, changed, why := shrink(before)
		if !changed {
			fmt.Printf("  %-28s %8d B  kept (%s)\n", e.Name(), len(before), why)
			continue
		}

		fmt.Printf("  %-28s %8d B -> %6d B  (-%.0f%%)\n",
			e.Name(), len(before), len(after),
			100*float64(len(before)-len(after))/float64(len(before)))
		if *dryRun {
			fmt.Printf("      (dry run, not written)\n")
			continue
		}
		if err := writeAtomic(path, after); err != nil {
			fmt.Printf("      write failed: %v\n", err)
			continue
		}
		totalAfter += int64(len(after))
	}

	if !*dryRun && totalAfter > 0 {
		fmt.Printf("\ntotal: %d B -> %d B\n", totalBefore, totalAfter)
	}
	fmt.Println("\n" + stickerPNGNote)
}

// shrink reduces one sticker, reporting why it did nothing when it did nothing.
//
// The order matters: sniff the bytes rather than trusting the extension, so a
// JPEG that was saved as .png is still treated as a JPEG.
func shrink(raw []byte) ([]byte, bool, string) {
	ext, err := imageproc.Sniff(raw)
	if err != nil {
		return nil, false, "not an image"
	}

	switch ext {
	case "jpg":
		out, changed, err := imageproc.Compress(raw)
		if err != nil {
			return nil, false, "compression failed: " + err.Error()
		}
		if !changed {
			return nil, false, "already small enough"
		}
		return out, true, ""

	case "png":
		out, why := shrinkPNG(raw)
		if out == nil {
			return nil, false, why
		}
		return out, true, ""

	default:
		return nil, false, ext + " is animated or has no pure-Go encoder"
	}
}

// shrinkPNG downscales a still PNG to stickerEdge, losslessly.
//
// Losslessly is the whole point. A sticker is drawn over the chat background, so
// its alpha channel is what makes it a sticker; re-encoding as JPEG to save
// bytes would draw an opaque box around it. Scaling keeps every pixel's colour
// and its alpha and only makes the grid smaller, so the result is the same
// picture at a sane size.
//
// An APNG is a PNG with extra chunks and would decode here as its first frame,
// losing the animation. Those are refused rather than silently flattened.
func shrinkPNG(raw []byte) ([]byte, string) {
	if bytes.Contains(raw, []byte("acTL")) {
		return nil, "APNG is animated, left alone"
	}

	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "png decode failed: " + err.Error()
	}

	b := img.Bounds()
	long := b.Dx()
	if b.Dy() > long {
		long = b.Dy()
	}
	if long <= stickerEdge {
		return nil, fmt.Sprintf("already within %dpx", stickerEdge)
	}

	scale := float64(stickerEdge) / float64(long)
	dst := image.NewRGBA(image.Rect(0, 0,
		int(float64(b.Dx())*scale), int(float64(b.Dy())*scale)))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)

	var out bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, dst); err != nil {
		return nil, "png encode failed: " + err.Error()
	}

	// A rewrite that came out bigger would be a regression, not a saving.
	if out.Len() >= len(raw) {
		return nil, "resize did not help"
	}
	return out.Bytes(), ""
}

// writeAtomic replaces a file through a temporary one in the same directory, so
// an interrupted run cannot leave a truncated sticker behind a database row that
// already points at it.
func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
