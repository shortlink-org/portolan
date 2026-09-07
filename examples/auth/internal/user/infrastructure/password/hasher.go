// Package password implements password hashing for the user module.
package password

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	domainpassword "github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
)

const (
	algorithm  = "pbkdf2-sha256"
	iterations = 210_000
	keyLength  = 32
	saltLength = 16
)

type Hasher struct{}

func NewHasher() *Hasher { return &Hasher{} }

func (*Hasher) Hash(plaintext string) (domainpassword.Hash, error) {
	if err := domainpassword.Validate(plaintext); err != nil {
		return domainpassword.Hash{}, err
	}

	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return domainpassword.Hash{}, fmt.Errorf("password: reading salt: %w", err)
	}
	digest, err := pbkdf2.Key(sha256.New, plaintext, salt, iterations, keyLength)
	if err != nil {
		return domainpassword.Hash{}, fmt.Errorf("password: deriving hash: %w", err)
	}

	encoded := fmt.Sprintf("%s$%d$%s$%s", algorithm, iterations,
		hex.EncodeToString(salt), hex.EncodeToString(digest))
	return domainpassword.ParseHash(encoded)
}

func (*Hasher) Verify(plaintext string, hash domainpassword.Hash) bool {
	parts := strings.Split(hash.String(), "$")
	if len(parts) != 4 || parts[0] != algorithm {
		return false
	}

	cost, err := strconv.Atoi(parts[1])
	if err != nil || cost <= 0 {
		return false
	}
	salt, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(parts[3])
	if err != nil || len(want) == 0 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, plaintext, salt, cost, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

func (*Hasher) NeedsRehash(hash domainpassword.Hash) bool {
	parts := strings.Split(hash.String(), "$")
	if len(parts) != 4 || parts[0] != algorithm {
		return true
	}
	cost, err := strconv.Atoi(parts[1])
	return err != nil || cost != iterations
}
