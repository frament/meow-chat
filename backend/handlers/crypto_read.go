package handlers

import (
	"database/sql"
	"encoding/base64"
	"fmt"

	"my-chat-backend/database"
	"my-chat-backend/messagecrypto"
	"my-chat-backend/models"
)

// openServerScheme replaces at-rest ciphertext with an envelope for this reader.
//
// Content of the new scheme is stored under the at-rest key, which the reader
// does not have and must never receive. What crosses the wire instead is the
// text wrapped to the reader's own key - that is the point of the second leg: it
// does not depend on TLS, so a compromised channel still yields nothing.
//
// Two honest outcomes, no third: either the reader gets an envelope, or the
// reader is told the account has no key yet (`needs_key`). Returning the at-rest
// blob, returning plaintext, or returning an empty bubble that looks like data
// loss are all worse than saying so.
func openServerScheme(messages []models.Message, readerID int64) error {
	var readerKid, readerPublicB64 string
	err := database.DB.QueryRow(
		"SELECT kid, public_key FROM user_receive_keys WHERE user_id = ? AND retired_at IS NULL",
		readerID,
	).Scan(&readerKid, &readerPublicB64)

	var readerPublic []byte
	switch {
	case err == sql.ErrNoRows:
		// No key: every server-scheme message is reported as needing one.
	case err != nil:
		return fmt.Errorf("reading receive key: %w", err)
	default:
		raw, decErr := base64.StdEncoding.DecodeString(readerPublicB64)
		if decErr != nil || len(raw) != 32 {
			// A stored key that cannot be decoded is not a reason to deliver
			// anything in the clear; it is a reason to stop.
			return fmt.Errorf("stored receive key is unusable for user %d", readerID)
		}
		readerPublic = raw
	}

	for i := range messages {
		if messages[i].CryptoScheme != "server" {
			continue
		}
		m := &messages[i]

		blob, err := base64.StdEncoding.DecodeString(m.EncryptedContent)
		if err != nil {
			return fmt.Errorf("message %d: stored blob is not base64: %w", m.ID, err)
		}
		plaintext, err := database.DecryptAtRest(blob)
		if err != nil {
			// Loud on purpose. This means the at-rest key is not the one the row
			// was written with, or the row is damaged. Filling the thread with
			// empty bubbles would look like the messages were deleted.
			return fmt.Errorf("message %d: cannot open at-rest content: %w", m.ID, err)
		}
		// The server's own ciphertext is not the client's business.
		m.EncryptedContent = ""

		if readerPublic == nil {
			m.NeedsKey = true
			continue
		}

		envelope, err := messagecrypto.Seal(plaintext, readerPublic, readerKid)
		if err != nil {
			return fmt.Errorf("message %d: wrapping for reader: %w", m.ID, err)
		}
		m.ServerEnvelope = envelope
	}
	return nil
}
