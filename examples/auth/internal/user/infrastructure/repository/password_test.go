package user_test

import (
	"testing"

	domainpassword "github.com/shortlink-org/portolan/examples/auth/internal/user/domain/vo/password"
	passwordadapter "github.com/shortlink-org/portolan/examples/auth/internal/user/infrastructure/password"
)

func testHasher() *passwordadapter.Hasher {
	return passwordadapter.NewHasher()
}

func mustHash(t testing.TB, plaintext string) domainpassword.Hash {
	t.Helper()
	hash, err := testHasher().Hash(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func passwordMatches(hash domainpassword.Hash, plaintext string) bool {
	return testHasher().Verify(plaintext, hash)
}
