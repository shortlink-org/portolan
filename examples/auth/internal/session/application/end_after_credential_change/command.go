package end_after_credential_change

import "time"

// Command describes the credential change whose older sessions must end.
type Command struct {
	UserID    string
	ChangedAt time.Time
	Keep      string
}
