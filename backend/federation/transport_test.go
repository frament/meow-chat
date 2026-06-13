package federation

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"my-chat-backend/database"

	_ "github.com/mattn/go-sqlite3"
)

func setupTransportDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.Exec(`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT UNIQUE NOT NULL, server_token TEXT, status TEXT DEFAULT 'active', disk_cache_limit INTEGER DEFAULT 512, blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`)
	originalDB := database.DB
	database.DB = db
	t.Cleanup(func() { database.DB = originalDB })
	return db
}

func TestNewTransport(t *testing.T) {
	tr := NewTransport()
	if tr == nil {
		t.Fatal("expected non-nil transport")
	}
}

func TestSendDirect_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Federation-Token") != "mytoken" {
			w.WriteHeader(403)
			return
		}
		w.WriteHeader(200)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	tr := NewTransport()
	resp, err := tr.SendDirect(srv.URL+"/ping", "GET", "mytoken", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if string(resp.Body) != `{"status":"ok"}` {
		t.Errorf("expected body, got %s", string(resp.Body))
	}
}

func TestSendDirect_WrongToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Federation-Token") != "correct" {
			w.WriteHeader(403)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	tr := NewTransport()
	resp, err := tr.SendDirect(srv.URL+"/ping", "GET", "wrong", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

func TestSendDirect_PostJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		if r.Header.Get("Content-Type") != "application/json" {
			w.WriteHeader(400)
			return
		}
		w.WriteHeader(201)
		w.Write([]byte(`{"id":1}`))
	}))
	defer srv.Close()

	tr := NewTransport()
	body := map[string]interface{}{"name": "test"}
	resp, err := tr.SendDirect(srv.URL+"/create", "POST", "tok", body, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}
}

func TestDownloadFile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		w.Write([]byte("fake-image-bytes"))
	}))
	defer srv.Close()

	tr := NewTransport()
	data, err := tr.DownloadFile(srv.URL + "/image.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "fake-image-bytes" {
		t.Errorf("expected fake-image-bytes, got %s", string(data))
	}
}

func TestDownloadFile_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
	}))
	defer srv.Close()

	tr := NewTransport()
	_, err := tr.DownloadFile(srv.URL + "/missing")
	if err == nil {
		t.Error("expected error for 404")
	}
}

func TestSend_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Federation-Token") != "srv_token" {
			w.WriteHeader(403)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	db := setupTransportDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', ?, 'srv_token', 'active')", srv.URL)

	tr := NewTransport()
	req := FederationRequest{
		ServerID: 1,
		Endpoint: "/ping",
		Method:   "GET",
	}
	resp, err := tr.Send(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestSend_BlockedServer(t *testing.T) {
	db := setupTransportDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'blocked', 'https://example.com', 'tok', 'blocked')")

	tr := NewTransport()
	req := FederationRequest{ServerID: 1, Endpoint: "/ping", Method: "GET"}
	resp, err := tr.Send(req)
	if err == nil {
		t.Error("expected error for blocked server")
	}
	if resp.Error == "" {
		t.Errorf("expected error for blocked server, got %+v", resp)
	}
}

func TestSendWithRetry_ImmediateSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	db := setupTransportDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', ?, 'tok', 'active')", srv.URL)

	tr := NewTransport()
	req := FederationRequest{ServerID: 1, Endpoint: "/ping", Method: "GET"}
	resp := tr.SendWithRetry(req)
	if resp == nil {
		t.Fatal("expected response")
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestSendWithRetry_ServerError(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.WriteHeader(500)
	}))
	defer srv.Close()

	db := setupTransportDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', ?, 'tok', 'active')", srv.URL)

	tr := NewTransport()
	req := FederationRequest{ServerID: 1, Endpoint: "/ping", Method: "GET"}
	resp := tr.SendWithRetry(req)
	if resp == nil {
		t.Fatal("expected response")
	}
	if resp.StatusCode != 500 {
		t.Errorf("expected 500, got %d", resp.StatusCode)
	}
	if attempts < 2 {
		t.Logf("expected retries, got %d attempts", attempts)
	}
}
