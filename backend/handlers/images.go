package handlers

import (
	"errors"
	"io"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"my-chat-backend/imageproc"
)

// saveImage stores one uploaded image under dir and returns the URL to serve it
// from. base is the filename without an extension.
//
// The extension comes from the bytes, not from the name the client sent. The
// static handler derives the Content-Type from the extension, so a photo
// uploaded as photo.png was being stored as - and served as - image/png.
//
// The image is compressed first when that is worth doing, and the original is
// kept when it is not. A compression failure is logged and the original stored:
// a photo that uploads slightly larger is better than a rejected one.
//
// Returns imageproc.ErrNotAnImage if the bytes are not a picture.
func saveImage(file *multipart.FileHeader, dir, base string) (string, error) {
	f, err := file.Open()
	if err != nil {
		return "", err
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}

	ext, err := imageproc.Sniff(data)
	if err != nil {
		return "", err
	}

	filename := base + "." + ext
	if out, changed, err := imageproc.Compress(data); err != nil {
		log.Printf("image: left %s at %d bytes, compression failed: %v", filename, len(data), err)
	} else if changed {
		log.Printf("image: %s %d -> %d bytes", filename, len(data), len(out))
		data = out
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	// Write beside the target and rename into place. Writing straight to the final
	// name risks a truncated file sitting behind a database row that already
	// points at it, if the process dies mid-write.
	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(tmp.Name(), 0644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), filepath.Join(dir, filename)); err != nil {
		return "", err
	}

	return "/uploads/" + filepath.Base(dir) + "/" + filename, nil
}

// safeStem reduces a client-supplied filename to something safe to put in a
// path and a URL: no directory component, no extension, and no character that
// would need escaping.
//
// Letters and digits are kept whatever script they are in, because a family chat
// is full of filenames like "фотография.jpeg" and a row of underscores is worse
// to look at than it is worth guarding against - there is nothing in a Cyrillic
// letter to escape. Everything else becomes an underscore.
func safeStem(name string) string {
	base := filepath.Base(name)
	stem := strings.TrimSuffix(base, filepath.Ext(base))

	var b strings.Builder
	alnum := 0
	for _, r := range stem {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			b.WriteRune(r)
			alnum++
			continue
		}
		b.WriteByte('_')
	}

	if alnum == 0 {
		// Nothing survived: a name of ".", "/" or "..".
		return "image"
	}

	out := []rune(b.String())
	if len(out) > 60 {
		out = out[:60]
	}
	return string(out)
}

func isNotAnImage(err error) bool {
	return errors.Is(err, imageproc.ErrNotAnImage)
}
