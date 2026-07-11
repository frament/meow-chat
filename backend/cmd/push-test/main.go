package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"
)

var client = &http.Client{Timeout: 30 * time.Second}

type resp struct {
	Code int
	Body []byte
}

func main() {
	if len(os.Args) < 2 {
		log.Fatalf("Usage: push-test <cmd> [args]\n  cmds: register, friend, send")
	}

	cmd := os.Args[1]
	switch cmd {
	case "register":
		register()
	case "friend":
		friend()
	case "send":
		send()
	default:
		log.Fatalf("unknown cmd: %s (want register, friend, send)", cmd)
	}
}

func do(method, url, token, contentType string, body io.Reader) (*resp, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	r, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return &resp{Code: r.StatusCode, Body: b}, nil
}

func doJSON(method, url, token string, v any) (*resp, error) {
	var r io.Reader
	if v != nil {
		b, _ := json.Marshal(v)
		r = bytes.NewReader(b)
	}
	return do(method, url, token, "application/json", r)
}

func login(server, username, password string) (string, error) {
	r, err := doJSON("POST", server+"/api/login", "", map[string]string{
		"username": username,
		"password": password,
	})
	if err != nil {
		return "", fmt.Errorf("login %s: %w", username, err)
	}
	if r.Code != 200 {
		return "", fmt.Errorf("login %s: status=%d body=%s", username, r.Code, string(r.Body))
	}
	var res struct {
		AccessToken string `json:"access_token"`
		Refresh     string `json:"refresh_token"`
	}
	json.Unmarshal(r.Body, &res)
	return res.AccessToken, nil
}

// ── register: push-test register <server> <username> <password>
func register() {
	if len(os.Args) < 5 {
		log.Fatalf("Usage: push-test register <server_url> <username> <password>")
	}
	server := strings.TrimRight(os.Args[2], "/")
	username := os.Args[3]
	password := os.Args[4]

	// login as admin to create invite token
	adminToken, err := login(server, "admin", "admin")
	if err != nil {
		log.Fatalf("admin login: %v", err)
	}

	invite, err := doJSON("POST", server+"/api/invites", adminToken, map[string]int{"max_uses": 10})
	if err != nil {
		log.Fatalf("create invite: %v", err)
	}
	if invite.Code != 200 && invite.Code != 201 {
		log.Fatalf("create invite: status=%d body=%s", invite.Code, string(invite.Body))
	}
	var inv struct {
		Token string `json:"token"`
	}
	json.Unmarshal(invite.Body, &inv)

	// register user (unique email to avoid UNIQUE constraint)
	email := username + "@test.local"
	r, err := doJSON("POST", server+"/api/register", "", map[string]string{
		"username":     username,
		"email":        email,
		"password":     password,
		"invite_token": inv.Token,
	})
	if err != nil {
		log.Fatalf("register %s: %v", username, err)
	}
	if r.Code != 201 && r.Code != 200 {
		log.Fatalf("register %s: status=%d body=%s", username, r.Code, string(r.Body))
	}
	log.Printf("user %s registered OK", username)

	// login to show token
	tok, err := login(server, username, password)
	if err != nil {
		log.Fatalf("login after register: %v", err)
	}
	fmt.Println("access_token:", tok)
}

func jwtPayload(token string) (map[string]any, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid JWT")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}
	var m map[string]any
	json.Unmarshal(decoded, &m)
	return m, nil
}

// ── friend: push-test friend <server> <tokenA> <tokenB>
func friend() {
	if len(os.Args) < 5 {
		log.Fatalf("Usage: push-test friend <server_url> <tokenA> <tokenB>")
	}
	server := strings.TrimRight(os.Args[2], "/")
	tokA := os.Args[3]
	tokB := os.Args[4]

	payA, err := jwtPayload(tokA)
	if err != nil {
		log.Fatalf("decode tokenA: %v", err)
	}
	payB, err := jwtPayload(tokB)
	if err != nil {
		log.Fatalf("decode tokenB: %v", err)
	}
	infoA := struct {
		ID       int
		Username string
	}{ID: int(payA["user_id"].(float64))}
	infoB := struct {
		ID       int
		Username string
	}{ID: int(payB["user_id"].(float64))}

	// fetch users to get usernames
	users, err := doJSON("GET", server+"/api/users", tokA, nil)
	if err == nil && users.Code == 200 {
		var ul []struct {
			ID       int    `json:"id"`
			Username string `json:"username"`
		}
		json.Unmarshal(users.Body, &ul)
		for _, u := range ul {
			if u.ID == infoA.ID {
				infoA.Username = u.Username
			}
			if u.ID == infoB.ID {
				infoB.Username = u.Username
			}
		}
	}

	log.Printf("userA: %s (id=%d), userB: %s (id=%d)", infoA.Username, infoA.ID, infoB.Username, infoB.ID)

	// userA sends friend request to userB
	r, err := doJSON("POST", server+fmt.Sprintf("/api/friend-requests/%d", infoB.ID), tokA, nil)
	if err != nil {
		log.Fatalf("send friend request: %v", err)
	}
	if r.Code != 200 && r.Code != 201 {
		log.Fatalf("send friend request: status=%d body=%s", r.Code, string(r.Body))
	}
	log.Printf("friend request sent from %s to %s", infoA.Username, infoB.Username)

	// userB fetches friend requests
	reqs, err := doJSON("GET", server+"/api/friend-requests", tokB, nil)
	if err != nil {
		log.Fatalf("get friend requests: %v", err)
	}
	if reqs.Code != 200 {
		log.Fatalf("get friend requests: status=%d body=%s", reqs.Code, string(reqs.Body))
	}
	var reqList []struct {
		ID     int `json:"id"`
		FromID int `json:"from_user"`
	}
	json.Unmarshal(reqs.Body, &reqList)

	if len(reqList) == 0 {
		log.Fatalf("no friend requests found")
	}
	reqID := reqList[0].ID

	// userB accepts
	r, err = doJSON("POST", server+fmt.Sprintf("/api/friend-requests/%d/accept", reqID), tokB, nil)
	if err != nil {
		log.Fatalf("accept friend request: %v", err)
	}
	if r.Code != 200 && r.Code != 201 {
		log.Fatalf("accept friend request: status=%d body=%s", r.Code, string(r.Body))
	}
	log.Printf("now friends: %s <-> %s", infoA.Username, infoB.Username)
}

// ── send: push-test send <server> <token> <to_username> <message>
func send() {
	if len(os.Args) < 6 {
		log.Fatalf("Usage: push-test send <server_url> <token> <to_username> <message>")
	}
	server := strings.TrimRight(os.Args[2], "/")
	tok := os.Args[3]
	toUser := os.Args[4]
	content := os.Args[5]

	// find user ID
	users, err := doJSON("GET", server+"/api/users", tok, nil)
	if err != nil {
		log.Fatalf("get users: %v", err)
	}
	if users.Code != 200 {
		log.Fatalf("get users: status=%d body=%s", users.Code, string(users.Body))
	}
	var userList []struct {
		ID       int    `json:"id"`
		Username string `json:"username"`
	}
	json.Unmarshal(users.Body, &userList)

	var toID int
	for _, u := range userList {
		if u.Username == toUser {
			toID = u.ID
			break
		}
	}
	if toID == 0 {
		log.Fatalf("user %s not found", toUser)
	}

	// send multipart message
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", fmt.Sprintf("%d", toID))
	w.WriteField("content", content)
	w.WriteField("type", "text")
	w.Close()

	r, err := do("POST", server+"/api/messages", tok, w.FormDataContentType(), &buf)
	if err != nil {
		log.Fatalf("send message: %v", err)
	}
	if r.Code != 200 && r.Code != 201 {
		log.Fatalf("send message: status=%d body=%s", r.Code, string(r.Body))
	}
	log.Printf("message sent to %s: %s", toUser, content)
	fmt.Println("response:", string(r.Body))
}
