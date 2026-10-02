package handlers

import "testing"

func TestSafeStem(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"ordinary name", "IMG_1352.jpeg", "IMG_1352"},
		{"no extension", "screenshot", "screenshot"},
		{"dots in the name", "my.holiday.photo.png", "my_holiday_photo"},
		{"spaces", "my photo.jpg", "my_photo"},
		{"cyrillic is kept", "фотография.jpeg", "фотография"},
		{"chinese is kept", "照片.jpeg", "照片"},
		{"path traversal", "../../../etc/passwd", "passwd"},
		{"absolute path", "/etc/shadow", "shadow"},
		{"traversal with an extension", "../../secret.png", "secret"},
		{"a dotfile has no stem", ".gitignore", "image"},
		{"nothing but dots", "..", "image"},
		{"empty", "", "image"},
		{"just a dot", ".", "image"},
		{"just a slash", "/", "image"},
		// A backslash is an ordinary character on the servers this runs on, not a
		// separator, so it is filtered like any other punctuation.
		{"backslash", `a\..\..\b.jpg`, "a_______b"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := safeStem(tc.in); got != tc.want {
				t.Errorf("safeStem(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// A name is a path component, so a long one has to be cut without leaving a
// directory separator or an escape behind.
func TestSafeStemResultIsSafeToJoin(t *testing.T) {
	long := ""
	for i := 0; i < 200; i++ {
		long += "a"
	}
	got := safeStem(long + ".jpg")
	if len(got) > 60 {
		t.Errorf("expected the stem cut to 60 characters, got %d", len(got))
	}
	for _, bad := range []string{"/", "\\", ".."} {
		if got == bad {
			t.Errorf("stem %q must not be %q", got, bad)
		}
	}
}
