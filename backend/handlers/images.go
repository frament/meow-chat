package handlers

import (
	"errors"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
	"unicode"

	"my-chat-backend/imageproc"
	"my-chat-backend/models"
)

// saveImage stores one uploaded image under dir and returns the URL to serve it
// from. base is the filename without an extension.
//
// The extension comes from the bytes, not from the name the client sent. The
// static handler derives the Content-Type from the extension, so a photo
// uploaded as photo.png was being stored as - and served as - image/png.
//
// Compression and thumbnail generation both live in imageproc.Store, so this is
// only about getting the bytes out of the request and making the name safe.
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

	stored, err := imageproc.Store(dir, base, data)
	if err != nil {
		return "", err
	}
	return stored.URL, nil
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

// withThumbnails fills in the small copies of an image, if it has them.
//
// They are not stored in the database: the paths follow from the original URL,
// and checking whether the files are actually there costs one stat and answers
// honestly for the images that predate this feature. That is the whole reason
// this is not a column - an image from before has no thumbnail, the client falls
// back to the original, and nothing 404s.
func withThumbnails(images []models.PostImage) []models.PostImage {
	for i := range images {
		images[i].ThumbURL, images[i].PreviewURL = imageproc.ThumbURLs(images[i].ImageURL)
	}
	return images
}
