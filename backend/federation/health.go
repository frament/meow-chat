package federation

import (
	"log"
	"time"

	"my-chat-backend/database"
)

// Ping cadence. The old schedule was one ping at 30s and then one per hour,
// which meant a peer that came back could sit at "unreachable" for almost an
// hour - and because the offline queue was only re-armed on the
// unreachable -> active transition, messages addressed to it waited the same
// hour. Fast is the state that needs attention; slow is the healthy state.
const (
	healthIntervalFast = 30 * time.Second
	healthIntervalSlow = 10 * time.Minute
)

type HealthChecker struct {
	transport *Transport
	queue     *Queue
	stopChan  chan struct{}
}

func NewHealthChecker(transport *Transport, queue *Queue) *HealthChecker {
	return &HealthChecker{
		transport: transport,
		queue:     queue,
		stopChan:  make(chan struct{}),
	}
}

func (hc *HealthChecker) Start() {
	go func() {
		// One immediate ping settles the common case without making the caller
		// wait out the fast interval first.
		hc.pingAll()

		for {
			timer := time.NewTimer(hc.interval())
			select {
			case <-timer.C:
				hc.pingAll()
			case <-hc.stopChan:
				timer.Stop()
				return
			}
		}
	}()
}

func (hc *HealthChecker) Stop() {
	close(hc.stopChan)
}

// interval picks the next delay from the current state rather than running on a
// fixed ticker: fast while any peer is unreachable or has queued work waiting,
// slow once everything is healthy and idle.
func (hc *HealthChecker) interval() time.Duration {
	var unreachable int
	database.DB.QueryRow("SELECT COUNT(*) FROM federation_servers WHERE status = 'unreachable'").Scan(&unreachable)

	var stuck int
	database.DB.QueryRow("SELECT COUNT(*) FROM federation_queue WHERE attempts > 0").Scan(&stuck)

	if unreachable > 0 || stuck > 0 {
		return healthIntervalFast
	}
	return healthIntervalSlow
}

func (hc *HealthChecker) PingServer(serverID int64) {
	var baseURL, token string
	err := database.DB.QueryRow(
		"SELECT base_url, server_token FROM federation_servers WHERE id = ?", serverID,
	).Scan(&baseURL, &token)
	if err != nil {
		log.Println("Health ping: server not found:", serverID)
		return
	}
	hc.pingOne(serverID, baseURL, token)
}

func (hc *HealthChecker) pingAll() {
	rows, err := database.DB.Query("SELECT id, base_url, server_token FROM federation_servers WHERE status IN ('active', 'unreachable')")
	if err != nil {
		log.Println("Health ping query error:", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var baseURL, token string
		if err := rows.Scan(&id, &baseURL, &token); err != nil {
			continue
		}
		hc.pingOne(id, baseURL, token)
	}
}

func (hc *HealthChecker) pingOne(serverID int64, baseURL string, token string) {
	resp, err := hc.transport.SendDirect(baseURL+"/api/federation/v1/ping", "HEAD", token, nil, nil)

	var currentStatus string
	database.DB.QueryRow("SELECT status FROM federation_servers WHERE id = ?", serverID).Scan(&currentStatus)
	wasUnreachable := currentStatus == "unreachable"

	if err == nil && resp.StatusCode < 500 {
		if wasUnreachable {
			database.DB.Exec("UPDATE federation_servers SET status = 'active' WHERE id = ?", serverID)
			hc.queue.DrainFailed(serverID)
			log.Printf("Federation server %d recovered, draining failed queue", serverID)
			// Drain now rather than waiting out the queue's tick: the sender
			// has been told the message went out, and every second of delay is
			// a second the other household does not have it.
			if hc.pendingForServer(serverID) {
				go hc.queue.processPending()
			}
		}
	} else {
		if currentStatus == "active" {
			database.DB.Exec("UPDATE federation_servers SET status = 'unreachable' WHERE id = ?", serverID)
			log.Printf("Federation server %d is unreachable", serverID)
		}
	}
}

// pendingForServer reports whether a peer still has undelivered work, which is
// what makes recovery worth re-arming on the transition.
func (hc *HealthChecker) pendingForServer(serverID int64) bool {
	var n int
	database.DB.QueryRow("SELECT COUNT(*) FROM federation_queue WHERE server_id = ?", serverID).Scan(&n)
	return n > 0
}
