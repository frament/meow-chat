package federation

import (
	"encoding/json"
	"log"
	"time"

	"my-chat-backend/database"
)

type Queue struct {
	transport *Transport
	stopChan  chan struct{}
}

func NewQueue(transport *Transport) *Queue {
	return &Queue{
		transport: transport,
		stopChan:  make(chan struct{}),
	}
}

func (q *Queue) Enqueue(serverID int64, endpoint string, body interface{}) error {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return err
	}
	_, err = database.DB.Exec(
		"INSERT INTO federation_queue (server_id, endpoint, body) VALUES (?, ?, ?)",
		serverID, endpoint, string(jsonBody),
	)
	return err
}

func (q *Queue) Start() {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		q.processPending()
		for {
			select {
			case <-ticker.C:
				q.processPending()
			case <-q.stopChan:
				ticker.Stop()
				return
			}
		}
	}()
}

func (q *Queue) Stop() {
	close(q.stopChan)
}

func (q *Queue) processPending() {
	rows, err := database.DB.Query(
		"SELECT id, server_id, endpoint, body FROM federation_queue WHERE attempts < max_attempts ORDER BY priority DESC, created_at ASC LIMIT 50",
	)
	if err != nil {
		log.Println("Federation queue query error:", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, serverID int64
		var endpoint, body string
		if err := rows.Scan(&id, &serverID, &endpoint, &body); err != nil {
			continue
		}
		q.processItem(id, serverID, endpoint, body)
	}
}

func (q *Queue) processItem(id int64, serverID int64, endpoint string, body string) {
	var payload interface{}
	json.Unmarshal([]byte(body), &payload)

	resp := q.transport.SendWithRetry(FederationRequest{
		ServerID: serverID,
		Endpoint: endpoint,
		Method:   "POST",
		Body:     payload,
	})

	if resp.Error != "" || resp.StatusCode >= 500 {
		database.DB.Exec(
			"UPDATE federation_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
			resp.Error, id,
		)
	} else {
		database.DB.Exec("DELETE FROM federation_queue WHERE id = ?", id)
	}
}

func (q *Queue) DrainFailed(serverID int64) {
	_, err := database.DB.Exec(
		"UPDATE federation_queue SET attempts = 0, last_error = '' WHERE server_id = ? AND attempts >= max_attempts",
		serverID,
	)
	if err != nil {
		log.Println("DrainFailed error:", err)
	}
}
