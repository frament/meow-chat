package models

import "time"

type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	AvatarURL string    `json:"avatar_url"`
	IsAdmin   bool      `json:"is_admin"`
	CreatedAt time.Time `json:"created_at"`
	IsOnline  bool      `json:"is_online"`
}

type Message struct {
	ID               int64       `json:"id"`
	FromUserID       int64       `json:"from_user_id"`
	ToUserID         int64       `json:"to_user_id"`
	GroupChatID      *int64      `json:"group_chat_id,omitempty"`
	Content          string      `json:"content"`
	Type             string      `json:"msg_type"`
	CreatedAt        time.Time   `json:"created_at"`
	FromUser         string      `json:"from_user,omitempty"`
	Images           []PostImage `json:"images,omitempty"`
	EncryptedContent string      `json:"encrypted_content,omitempty"`
	EncryptedIV      string      `json:"encrypted_iv,omitempty"`
}

type GroupChat struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	CreatedBy   int64     `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	MemberCount int       `json:"member_count"`
}

type GroupMember struct {
	UserID    int64  `json:"user_id"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatar_url"`
}

type GroupChatInvite struct {
	ID          int64      `json:"id"`
	GroupChatID int64      `json:"group_chat_id"`
	Token       string     `json:"token"`
	MaxUses     int        `json:"max_uses"`
	UseCount    int        `json:"use_count"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type PostImage struct {
	ID       int64  `json:"id"`
	PostID   int64  `json:"post_id"`
	ImageURL string `json:"image_url"`
}

type Reaction struct {
	Emoji   string `json:"emoji"`
	Count   int    `json:"count"`
	Reacted bool   `json:"reacted"`
}

type Post struct {
	ID        int64       `json:"id"`
	UserID    int64       `json:"user_id"`
	Content   string      `json:"content"`
	CreatedAt time.Time   `json:"created_at"`
	Username  string      `json:"username,omitempty"`
	AvatarURL string      `json:"avatar_url,omitempty"`
	IsAdmin   bool        `json:"is_admin"`
	IsPublic  bool        `json:"is_public"`
	Images    []PostImage `json:"images,omitempty"`
	Reactions []Reaction  `json:"reactions,omitempty"`
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

type InviteToken struct {
	ID        int64      `json:"id"`
	CreatedBy int64      `json:"created_by"`
	Token     string     `json:"token"`
	MaxUses   int        `json:"max_uses"`
	UseCount  int        `json:"use_count"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type CreateInviteRequest struct {
	MaxUses   int    `json:"max_uses"`
	ExpiresIn string `json:"expires_in,omitempty"`
}

type RegisterRequest struct {
	Username    string `json:"username"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	InviteToken string `json:"invite_token"`
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
	IsAdmin   bool   `json:"is_admin"`
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

type FriendInvite struct {
	ID        int64     `json:"id"`
	CreatedBy int64     `json:"created_by"`
	Token     string    `json:"token"`
	UsedBy    *int64    `json:"used_by,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
