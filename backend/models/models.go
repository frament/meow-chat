package models

import "time"

type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	AvatarURL string    `json:"avatar_url"`
	CreatedAt time.Time `json:"created_at"`
	IsOnline  bool      `json:"is_online"`
}

type Message struct {
	ID         int64       `json:"id"`
	FromUserID int64       `json:"from_user_id"`
	ToUserID   int64       `json:"to_user_id"`
	Content    string      `json:"content"`
	CreatedAt  time.Time   `json:"created_at"`
	FromUser   string      `json:"from_user,omitempty"`
	Images     []PostImage `json:"images,omitempty"`
}

type PostImage struct {
	ID       int64  `json:"id"`
	PostID   int64  `json:"post_id"`
	ImageURL string `json:"image_url"`
}

type Post struct {
	ID        int64       `json:"id"`
	UserID    int64       `json:"user_id"`
	Content   string      `json:"content"`
	CreatedAt time.Time   `json:"created_at"`
	Username  string      `json:"username,omitempty"`
	AvatarURL string      `json:"avatar_url,omitempty"`
	Images    []PostImage `json:"images,omitempty"`
}

type CreatePostRequest struct {
	Content string `json:"content"`
}

type CreateMessageRequest struct {
	ToUserID int64  `json:"to_user_id"`
	Content  string `json:"content"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type UpdateProfileRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
}

type LoginResponse struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

type AuthResponse struct {
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	User         LoginResponse `json:"user"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type RefreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

type PushSubscriptionRequest struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

type DeleteSubscriptionRequest struct {
	Endpoint string `json:"endpoint"`
}
