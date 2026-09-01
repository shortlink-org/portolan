package dto

import "time"

// SessionStarted is the wire form of auth.SessionStarted.
type SessionStarted struct {
	SessionID  string    `json:"sessionId"`
	UserID     string    `json:"userId"`
	ExpiresAt  time.Time `json:"expiresAt"`
	OccurredAt time.Time `json:"occurredAt"`
}

// SessionEnded is the wire form of auth.SessionEnded.
type SessionEnded struct {
	SessionID  string    `json:"sessionId"`
	UserID     string    `json:"userId"`
	Reason     string    `json:"reason"`
	OccurredAt time.Time `json:"occurredAt"`
}
