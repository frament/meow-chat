package federation

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"my-chat-backend/database"
)

type Queue struct {
	transport *Transport
	stopChan  chan struct{}
	// drainMu serialises drains. Recovery pings and the periodic tick can both
	// decide to drain, and two concurrent drains would send the same message
	// twice - which for a chat means the reader sees it twice.
	drainMu sync.Mutex
}

func NewQueue(transport *Transport) *Queue {
	return &Queue{
		transport: transport,
		stopChan:  make(chan struct{}),
	}
}

func (q *Queue) Enqueue(serverID int64, endpoint string, body interface{}) error {
	return q.enqueue(serverID, endpoint, body, nil)
}

// enqueue stores one request for later delivery. Headers are persisted because
// the column exists and a queue item that silently dropped them would fail on
// replay for reasons nobody could see.
func (q *Queue) enqueue(serverID int64, endpoint string, body interface{}, headers map[string]string) error {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return err
	}
	jsonHeaders := ""
	if len(headers) > 0 {
		raw, err := json.Marshal(headers)
		if err != nil {
			return err
		}
		jsonHeaders = string(raw)
	}
	_, err = database.DB.Exec(
		"INSERT INTO federation_queue (server_id, endpoint, body, headers) VALUES (?, ?, ?, ?)",
		serverID, endpoint, string(jsonBody), jsonHeaders,
	)
	return err
}

// SendOrQueue delivers immediately and falls back to the offline queue when the
// peer cannot be reached, which is the only thing that stops a message to a
// downed home from being lost while the sender is told it was sent.
//
// It returns an error only when both paths failed. A peer being unreachable is
// not an error for the caller: the user's own message is already stored
// locally, and failing the request over it would make them think it was lost.
//
// Interactive admin calls deliberately do not use this. There the user is
// waiting on an answer, so the real error is the useful thing to report.
func SendOrQueue(t *Transport, q *Queue, req FederationRequest) error {
	if t == nil {
		return nil
	}

	// SendQuick, not Send: this call has a queue behind it, so it must not hold
	// the sender for the full request timeout when the peer has silently gone.
	resp, err := t.SendQuick(req)
	if err == nil && resp != nil && resp.StatusCode < 500 {
		return nil
	}

	reason := "unknown error"
	if err != nil {
		reason = err.Error()
	} else if resp != nil {
		reason = fmt.Sprintf("status %d", resp.StatusCode)
	}

	if q == nil {
		if err != nil {
			return err
		}
		return fmt.Errorf("federation send failed (%s) and no queue configured", reason)
	}

	if qerr := q.enqueue(req.ServerID, req.Endpoint, req.Body, req.Headers); qerr != nil {
		// Both the send and the fallback failed. Say so, because a lost
		// message that only logs looks exactly like a delivered one.
		return fmt.Errorf("federation send failed (%s) and queueing failed: %w", reason, qerr)
	}
	log.Printf("Federation: queued %s for server %d (%s)", req.Endpoint, req.ServerID, reason)
	return nil
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

// processPending drains one batch.
//
// Two things here are load-bearing, and both were wrong before:
//
//   - Exhausted items are re-armed for servers that are currently active. The
//     only other place that did this was the unreachable -> active transition,
//     so a peer that flapped and came back between two health pings never got
//     its queue reset and the message sat there indefinitely.
//   - The batch only takes items whose server is active. Otherwise a single
//     dead peer filled the LIMIT with its own backlog and starved every other
//     peer's messages behind it.
func (q *Queue) processPending() {
	q.drainMu.Lock()
	defer q.drainMu.Unlock()

	q.rearmExhausted()

	rows, err := database.DB.Query(
		`SELECT q.id, q.server_id, q.endpoint, q.body, q.headers
		 FROM federation_queue q
		 JOIN federation_servers s ON s.id = q.server_id
		 WHERE q.attempts < q.max_attempts AND s.status = 'active'
		 ORDER BY q.priority DESC, q.created_at ASC LIMIT 50`,
	)
	if err != nil {
		log.Println("Federation queue query error:", err)
		return
	}

	// Drain the cursor before sending anything. Each delivery writes to the
	// same database, and with a single-connection pool - which every in-memory
	// test fixture uses - an open cursor plus an Exec deadlocks. Collecting
	// first also stops a slow peer from holding a read transaction open for
	// the length of its request timeout.
	type item struct {
		id, serverID        int64
		endpoint, body, hdr string
	}
	var batch []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.serverID, &it.endpoint, &it.body, &it.hdr); err != nil {
			continue
		}
		batch = append(batch, it)
	}
	rows.Close()

	for _, it := range batch {
		q.processItem(it.id, it.serverID, it.endpoint, it.body, it.hdr)
	}
}

// rearmExhausted resets items that ran out of attempts for peers that are up
// again, so recovery does not depend on catching a status transition.
func (q *Queue) rearmExhausted() {
	_, err := database.DB.Exec(
		`UPDATE federation_queue SET attempts = 0, last_error = ''
		 WHERE attempts >= max_attempts
		   AND server_id IN (SELECT id FROM federation_servers WHERE status = 'active')`,
	)
	if err != nil {
		log.Println("Federation queue rearm error:", err)
	}
}

// processItem attempts one delivery.
//
// It sends once rather than through SendWithRetry. SendWithRetry sleeps 1s+5s+15s
// per item, and against a peer that is marked unreachable Send fails before any
// request goes out - so fifty queued items cost seventeen minutes of the drain
// goroutine sleeping and delivered nothing. The batch is already filtered to
// active peers, so a failed attempt is retried on the next tick instead.
func (q *Queue) processItem(id int64, serverID int64, endpoint string, body string, headers string) {
	var payload interface{}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		// Unparseable body: retrying cannot help, so drop it rather than
		// spending max_attempts on it.
		log.Printf("Federation queue item %d has an unparseable body, dropping", id)
		database.DB.Exec("DELETE FROM federation_queue WHERE id = ?", id)
		return
	}

	var hdrs map[string]string
	if headers != "" {
		json.Unmarshal([]byte(headers), &hdrs)
	}

	resp, err := q.transport.Send(FederationRequest{
		ServerID: serverID,
		Endpoint: endpoint,
		Method:   "POST",
		Body:     payload,
		Headers:  hdrs,
	})

	delivered := err == nil && resp != nil && resp.StatusCode < 500
	if delivered {
		database.DB.Exec("DELETE FROM federation_queue WHERE id = ?", id)
		return
	}

	reason := ""
	switch {
	case err != nil:
		reason = err.Error()
	case resp != nil:
		reason = fmt.Sprintf("status %d", resp.StatusCode)
	}
	database.DB.Exec(
		"UPDATE federation_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
		reason, id,
	)
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
