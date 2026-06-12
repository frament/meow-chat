package federation

import (
	"log"
	"time"

	"my-chat-backend/database"
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
		time.Sleep(30 * time.Second)
		hc.pingAll()
	}()

	ticker := time.NewTicker(60 * time.Minute)
	go func() {
		for {
			select {
			case <-ticker.C:
				hc.pingAll()
			case <-hc.stopChan:
				ticker.Stop()
				return
			}
		}
	}()
}

func (hc *HealthChecker) Stop() {
	close(hc.stopChan)
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
		}
	} else {
		if currentStatus == "active" {
			database.DB.Exec("UPDATE federation_servers SET status = 'unreachable' WHERE id = ?", serverID)
			log.Printf("Federation server %d is unreachable", serverID)
		}
	}
}
