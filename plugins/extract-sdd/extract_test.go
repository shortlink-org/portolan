package extractsdd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestExtractsAnOpenSpecChangeAsOneNormalizedSpecification(t *testing.T) {
	root := t.TempDir()
	change := filepath.Join(root, "openspec", "changes", "add-rate-limits")
	write(t, filepath.Join(change, ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-10-24\n")
	write(t, filepath.Join(change, "proposal.md"), `# Proposal

## Why

Protect the public API from abusive clients.

## What Changes

Add a bounded per-client request budget.
`)
	write(t, filepath.Join(change, "design.md"), "# Design\n\nUse the gateway adapter.\n")
	write(t, filepath.Join(change, "tasks.md"), `# Tasks

## 1. Gateway

- [x] 1.1 Add the rate-limit contract.
- [ ] 1.2 Verify the rejection path.
`)
	write(t, filepath.Join(change, "specs", "request-budget", "spec.md"), `# Spec Delta

## ADDED Requirements

### Requirement: Requests have a bounded budget
The gateway SHALL reject requests after the client budget is exhausted.

#### Scenario: Budget exhausted
- **WHEN** a client spends its final token
- **THEN** the next request is rejected with a retry hint
`)

	response, err := extract(plugin.Input{Root: root}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var fragment catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &fragment); err != nil {
		t.Fatal(err)
	}
	if len(fragment.Specs) != 1 {
		t.Fatalf("specs = %+v", fragment.Specs)
	}
	spec := fragment.Specs[0]
	if spec.ID != "add-rate-limits" || spec.Format != "openspec" || spec.Lifecycle != "implementing" {
		t.Fatalf("spec = %+v", spec)
	}
	if spec.Title != "Add rate limits" || spec.Source != "openspec/changes/add-rate-limits/proposal.md" {
		t.Fatalf("identity = %+v", spec)
	}
	if len(spec.Artifacts) != 4 {
		t.Fatalf("artifacts = %+v", spec.Artifacts)
	}
	if len(spec.Requirements) != 1 || spec.Requirements[0].Title != "Requests have a bounded budget" {
		t.Fatalf("requirements = %+v", spec.Requirements)
	}
	if got := spec.Requirements[0].Scenarios; len(got) != 1 || got[0].When[0] != "a client spends its final token" || got[0].Then[0] != "the next request is rejected with a retry hint" {
		t.Fatalf("scenarios = %+v", got)
	}
	if len(spec.Tasks) != 2 || !spec.Tasks[0].Done || spec.Tasks[1].Done {
		t.Fatalf("tasks = %+v", spec.Tasks)
	}
}

func write(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}
