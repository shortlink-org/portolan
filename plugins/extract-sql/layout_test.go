package extractsql

import "testing"

func TestDiscoversHorizontalAndFeatureStoragePackages(t *testing.T) {
	root := writeTree(t, map[string]string{
		"internal/infrastructure/repository/quote/migrations/0001_quote.sql":           `CREATE TABLE quotes (id text PRIMARY KEY);`,
		"internal/user/infrastructure/repository/migrations/0001_user.sql":             `CREATE TABLE users (id text PRIMARY KEY);`,
		"internal/search/infrastructure/projector/results/migrations/0001_results.sql": `CREATE TABLE results (id text PRIMARY KEY);`,
	})

	layout := discoverStorageLayout(root, "", "")
	if len(layout.repositories) != 2 {
		t.Fatalf("repositories = %+v", layout.repositories)
	}
	if layout.repositories[0].name != "quote" || layout.repositories[0].dir != "internal/infrastructure/repository/quote" {
		t.Errorf("horizontal repository = %+v", layout.repositories[0])
	}
	if layout.repositories[1].name != "user" || layout.repositories[1].dir != "internal/user/infrastructure/repository" {
		t.Errorf("feature repository = %+v", layout.repositories[1])
	}
	if len(layout.projectors) != 1 || layout.projectors[0].name != "results" {
		t.Errorf("projectors = %+v", layout.projectors)
	}
}

func TestFeatureRepositoriesProduceAStableSourcePattern(t *testing.T) {
	root := writeTree(t, map[string]string{
		"internal/user/infrastructure/repository/migrations/0001_user.sql":       `CREATE TABLE users (id text PRIMARY KEY);`,
		"internal/session/infrastructure/repository/migrations/0001_session.sql": `CREATE TABLE sessions (id text PRIMARY KEY);`,
	})

	layout := discoverStorageLayout(root, "", "")
	want := root + "/internal/*/infrastructure/repository"
	if layout.source != want {
		t.Errorf("source = %q, want %q", layout.source, want)
	}
}

func TestExplicitRootAcceptsCollectionAndFeaturePackage(t *testing.T) {
	root := writeTree(t, map[string]string{
		"src/infrastructure/repository/order/migrations/0001_order.sql":    `CREATE TABLE orders (id text PRIMARY KEY);`,
		"internal/user/infrastructure/repository/migrations/0001_user.sql": `CREATE TABLE users (id text PRIMARY KEY);`,
	})

	collection := discoverStorageLayout(root, "src/infrastructure/repository", "missing")
	if len(collection.repositories) != 1 || collection.repositories[0].name != "order" {
		t.Errorf("collection = %+v", collection.repositories)
	}

	feature := discoverStorageLayout(root, "internal/user/infrastructure/repository", "missing")
	if len(feature.repositories) != 1 || feature.repositories[0].name != "user" {
		t.Errorf("feature = %+v", feature.repositories)
	}
}
