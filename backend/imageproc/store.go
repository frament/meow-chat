package imageproc

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// Stored says where an image and its two thumbnails ended up.
//
// Thumb and Preview are empty when the image is not a JPEG. The original URL is
// always filled in: an image nobody could make a thumbnail of is still an image,
// and the client falls back to it.
type Stored struct {
	URL     string
	Thumb   string
	Preview string
}

// thumbsDir is where every generated thumbnail lives, mirroring the layout under
// it so that a thumbnail can be found from the original's path alone.
const thumbsDir = "./uploads/thumbs"

// Store writes an uploaded image under dir, named base plus whatever extension
// the bytes call for, together with a chat-sized and a feed-sized thumbnail.
//
// The image is compressed first when that is worth doing, and the original is
// kept when it is not. A compression failure is logged and the original stored:
// a photo that uploads slightly larger is better than a rejected one. The same
// goes for the thumbnails - losing one costs bandwidth, losing the image costs
// the upload.
//
// Returns ErrNotAnImage if the bytes are not a picture.
func Store(dir, base string, data []byte) (Stored, error) {
	ext, err := Sniff(data)
	if err != nil {
		return Stored{}, err
	}

	filename := base + "." + ext
	// Kept for the thumbnails: they are made from what was uploaded rather than
	// from the copy about to be written, so a photo is not re-encoded twice and
	// does not lose quality twice.
	original := data

	if out, changed, err := Compress(data); err != nil {
		log.Printf("image: left %s at %d bytes, compression failed: %v", filename, len(data), err)
	} else if changed {
		log.Printf("image: %s %d -> %d bytes", filename, len(data), len(out))
		data = out
	}

	if err := writeFile(filepath.Join(dir, filename), data); err != nil {
		return Stored{}, err
	}

	stored := Stored{URL: uploadURL(dir) + "/" + filename}
	for _, size := range []struct {
		edge int
		url  *string
	}{
		{ThumbEdge, &stored.Thumb},
		{PreviewEdge, &stored.Preview},
	} {
		thumb, err := Thumbnail(original, size.edge)
		if err != nil {
			if err != ErrNoThumbnail {
				log.Printf("image: no %dpx thumbnail for %s: %v", size.edge, filename, err)
			}
			continue
		}
		name := thumbName(base, size.edge)
		path := filepath.Join(thumbsDir, filepath.Base(dir), name)
		if err := writeFile(path, thumb); err != nil {
			log.Printf("image: thumbnail %s: %v", path, err)
			continue
		}
		*size.url = filepath.Join(uploadURL(thumbsDir), filepath.Base(dir), name)
	}

	return stored, nil
}

// ThumbURLs returns the thumbnail and preview URLs for an image already on the
// server, or empty strings when it has neither.
//
// This is what lets thumbnails exist without a database column. The paths are
// derived from the original URL and then checked on disk, so the images that
// predate this feature have no thumbnails and simply answer empty - which the
// client reads as "use the original" rather than as a 404.
//
// A URL that does not point at a plain path under ./uploads has no local copy to
// check. That covers the peer's address left in place by a federated download
// that failed, and it is why the check refuses anything with a path separator in
// the name rather than joining whatever it is given.
func ThumbURLs(imageURL string) (thumb, preview string) {
	dir, base, ok := splitUploadURL(imageURL)
	if !ok {
		return "", ""
	}

	sub := filepath.Base(dir)
	for _, size := range []struct {
		edge int
		url  *string
	}{
		{ThumbEdge, &thumb},
		{PreviewEdge, &preview},
	} {
		name := thumbName(base, size.edge)
		if _, err := os.Stat(filepath.Join(thumbsDir, sub, name)); err != nil {
			continue
		}
		*size.url = filepath.Join(uploadURL(thumbsDir), sub, name)
	}
	return thumb, preview
}

// thumbName is the one place a thumbnail's filename is decided. Store writes it
// and ThumbURLs looks for it, so a change here cannot leave the two disagreeing
// about where a thumbnail lives.
func thumbName(base string, edge int) string {
	return fmt.Sprintf("%s_%d.jpg", base, edge)
}

// splitUploadURL turns "/uploads/posts/6_123.jpg" into ("./uploads/posts",
// "6_123") - the directory an image lives in and its name without an extension.
func splitUploadURL(imageURL string) (dir, base string, ok bool) {
	const prefix = "/uploads/"
	if !strings.HasPrefix(imageURL, prefix) {
		return "", "", false
	}

	rest := strings.TrimPrefix(imageURL, prefix)
	slash := strings.IndexByte(rest, '/')
	if slash <= 0 {
		return "", "", false
	}

	sub, name := rest[:slash], rest[slash+1:]
	if !plainPathElement(sub) || !plainPathElement(name) {
		return "", "", false
	}

	stem := strings.TrimSuffix(name, filepath.Ext(name))
	if !plainPathElement(stem) {
		return "", "", false
	}
	return "./uploads/" + sub, stem, true
}

func plainPathElement(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.ContainsAny(s, `/\`)
}

func uploadURL(dir string) string {
	return "/uploads/" + filepath.Base(dir)
}

// writeFile writes data to path through a temporary file in the same directory,
// so a crash mid-write cannot leave a truncated image behind a database row that
// already points at it.
func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
