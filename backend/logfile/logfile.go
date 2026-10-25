// Package logfile keeps the server's own log on a mounted volume.
//
// Docker's logs disappear when a container is recreated, and this server is
// redeployed often. An incident that happened before the last deploy then has no
// evidence at all: that is exactly how a lost session on 2026-10-25 ended with
// "cause not established" - the logs were empty not because nothing happened,
// but because the container had been recreated five times that day.
package logfile

import (
	"io"
	"log"
	"os"
)

// DefaultMaxBytes is one deploy cycle of a family server, roughly.
const DefaultMaxBytes int64 = 20 << 20

// Setup sends the standard logger to stdout and to path, rotating the existing
// file to path+".1" when it is already larger than maxBytes.
//
// One generation is deliberate. The file is there to survive a redeploy and stay
// bounded on a machine nobody watches; it is not a log archive.
//
// An empty path means "stdout only" and is not an error: the app has to start
// where no volume is mounted. A path that cannot be opened is reported to the
// caller, which logs it and carries on - losing the log file must never stop the
// server from serving.
func Setup(path string, maxBytes int64) (io.Closer, error) {
	if path == "" {
		return nil, nil
	}

	if maxBytes > 0 {
		if st, err := os.Stat(path); err == nil && st.Size() > maxBytes {
			if err := os.Rename(path, path+".1"); err != nil {
				return nil, err
			}
		}
	}

	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}

	// Both, not either: `docker logs` stays useful for the running container,
	// and the file outlives it.
	log.SetOutput(io.MultiWriter(os.Stdout, f))
	return f, nil
}
