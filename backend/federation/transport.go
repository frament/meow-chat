package federation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"my-chat-backend/database"
)

type Transport struct {
	client *http.Client
}

type FederationRequest struct {
	ServerID int64
	Endpoint string
	Method   string
	Body     interface{}
	Headers  map[string]string
}

type FederationResponse struct {
	StatusCode int
	Body       []byte
	Error      string
}

func NewTransport() *Transport {
	return &Transport{
		client: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:    10,
				IdleConnTimeout: 60 * time.Second,
			},
		},
	}
}

func (t *Transport) getServerToken(serverID int64) (string, string, error) {
	var token, baseURL string
	err := database.DB.QueryRow(
		"SELECT server_token, base_url FROM federation_servers WHERE id = ? AND status = 'active'",
		serverID,
	).Scan(&token, &baseURL)
	if err != nil {
		return "", "", fmt.Errorf("server not found or not active: %w", err)
	}
	return token, baseURL, nil
}

func (t *Transport) Send(req FederationRequest) (*FederationResponse, error) {
	token, baseURL, err := t.getServerToken(req.ServerID)
	if err != nil {
		return &FederationResponse{Error: err.Error()}, err
	}

	return t.sendRaw(baseURL+req.Endpoint, req.Method, token, req.Body, req.Headers)
}

func (t *Transport) SendDirect(fullURL string, method string, token string, body interface{}, headers map[string]string) (*FederationResponse, error) {
	return t.sendRaw(fullURL, method, token, body, headers)
}

func (t *Transport) sendRaw(url string, method string, token string, body interface{}, headers map[string]string) (*FederationResponse, error) {
	var bodyReader io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return &FederationResponse{Error: err.Error()}, err
		}
		bodyReader = bytes.NewReader(jsonData)
	}

	httpReq, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return &FederationResponse{Error: err.Error()}, err
	}

	if headers == nil {
		headers = make(map[string]string)
	}
	headers["X-Federation-Token"] = token
	headers["Content-Type"] = "application/json"

	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := t.client.Do(httpReq)
	if err != nil {
		return &FederationResponse{Error: err.Error()}, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	return &FederationResponse{
		StatusCode: resp.StatusCode,
		Body:       respBody,
	}, nil
}

func (t *Transport) SendWithRetry(req FederationRequest) *FederationResponse {
	delays := []time.Duration{1 * time.Second, 5 * time.Second, 15 * time.Second}
	for i, delay := range delays {
		resp, err := t.Send(req)
		if err == nil && resp.StatusCode < 500 {
			return resp
		}
		if i < len(delays)-1 {
			time.Sleep(delay)
		}
	}
	resp, _ := t.Send(req)
	return resp
}
