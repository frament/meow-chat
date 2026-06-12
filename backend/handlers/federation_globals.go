package handlers

import "my-chat-backend/federation"

var (
	fedTransport *federation.Transport
	fedQueue     *federation.Queue
	fedHealth    *federation.HealthChecker
)

func InitFederationGlobals(t *federation.Transport, q *federation.Queue, h *federation.HealthChecker) {
	fedTransport = t
	fedQueue = q
	fedHealth = h
}
