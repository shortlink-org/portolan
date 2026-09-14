package extractrfc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestExtractsRFCWithoutADRSemantics(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs", "rfcs"), 0o755); err != nil {
		t.Fatal(err)
	}
	source := `---
rfc: 42
title: Rotate credentials without downtime
state: published
scope: payments.ledger
authors: [Ada, Lin]
created: 2026-01-02
discussion: https://github.com/acme/payments/pull/42
relates:
  services: [payments.ledger]
---
# RFC 42 — Rotate credentials without downtime

## Proposal

Rotate both credentials during an overlap window.
`
	if err := os.WriteFile(filepath.Join(root, "docs", "rfcs", "0042-rotation.md"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	resp, err := extract(plugin.Input{Root: root}, Options{History: "none", Repo: "github.com/acme/architecture"})
	if err != nil {
		t.Fatal(err)
	}
	var fragment catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &fragment); err != nil {
		t.Fatal(err)
	}
	if len(fragment.Rfcs) != 1 {
		t.Fatalf("rfcs = %+v", fragment.Rfcs)
	}
	rfc := fragment.Rfcs[0]
	if rfc.DisplayID != "RFC-42" || rfc.Lifecycle != "accepted" || rfc.Status != "published" || rfc.Scope.Service != "payments.ledger" {
		t.Fatalf("rfc = %+v", rfc)
	}
	if rfc.Source != "docs/rfcs/0042-rotation.md" {
		t.Fatalf("source = %q", rfc.Source)
	}
	if rfc.Repository != "github.com/acme/architecture" {
		t.Fatalf("repository = %q", rfc.Repository)
	}
	if len(fragment.Adrs) != 0 {
		t.Fatalf("RFC leaked into ADRs: %+v", fragment.Adrs)
	}
}

func TestUnknownStatusIsPreserved(t *testing.T) {
	rfc, problems := parseRFC("docs/rfc/idea.md", "---\nstatus: seeking-council\nscope: org\n---\n# RFC alpha — Try it\n\n## Proposal\n\nText.\n", Options{})
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	if rfc.Status != "seeking-council" || rfc.Lifecycle != "unknown" {
		t.Fatalf("rfc = %+v", rfc)
	}
}
