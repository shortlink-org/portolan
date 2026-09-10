package gocall

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func writeSource(t *testing.T, root, name, contents string) {
	t.Helper()
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(contents), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestSharedFactsPreservePossibleTargetsAndSourcePositions(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "go.mod", "module example.com/facts\n\ngo 1.24\n")
	writeSource(t, root, "main.go", `package main
 type Runner interface { Execute() }
 type First struct{}
 func (*First) Execute() {}
 type Second struct{}
 func (*Second) Execute() {}
 func dispatch(r Runner) { r.Execute() }
 func main() { dispatch(&First{}); dispatch(&Second{}) }
 `)
	result, err := Analyze(context.Background(), Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Complete || len(result.Diagnostics) != 0 {
		t.Fatalf("unexpected partial result: %+v", result)
	}
	var dynamic []Edge
	for _, edge := range result.Edges {
		if strings.HasSuffix(edge.Caller.ID, ".dispatch") {
			dynamic = append(dynamic, edge)
		}
	}
	if len(dynamic) != 2 {
		t.Fatalf("possible dispatch targets = %+v", dynamic)
	}
	for _, edge := range dynamic {
		if edge.Kind != Possible || edge.Site.File != "main.go" || edge.Site.Line != 7 || edge.Site.Column == 0 {
			t.Fatalf("lost evidence: %+v", edge)
		}
	}
	// Call sites on one line remain separate in the common representation.
	var sites []int
	for _, edge := range result.Edges {
		if strings.HasSuffix(edge.Caller.ID, ".main") && strings.HasSuffix(edge.Callee.ID, ".dispatch") {
			if edge.Kind != Static {
				t.Fatalf("direct call is not static: %+v", edge)
			}
			sites = append(sites, edge.Site.Column)
		}
	}
	if len(sites) != 2 || sites[0] == sites[1] {
		t.Fatalf("call columns = %v", sites)
	}
	again, err := Analyze(context.Background(), Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result, again) {
		t.Fatal("typed facts are not deterministic")
	}
}

func TestBrokenPackageDoesNotDiscardIndependentFacts(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "go.mod", "module example.com/partial\n\ngo 1.24\n")
	writeSource(t, root, "good/good.go", "package good\nfunc Run() { save() }; func save() {}\n")
	writeSource(t, root, "broken/broken.go", "package broken\nvar value MissingType\n")
	result, err := Analyze(context.Background(), Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if result.Complete || len(result.Diagnostics) == 0 {
		t.Fatalf("missing partial diagnostic: %+v", result)
	}
	found := false
	for _, edge := range result.Edges {
		if strings.HasSuffix(edge.Callee.ID, ".save") {
			found = true
		}
	}
	if !found {
		t.Fatalf("independent edge lost: %+v", result)
	}
}

func TestCanceledAnalysisDoesNotReturnCompleteFacts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Analyze(ctx, Options{Root: t.TempDir()}); err == nil {
		t.Fatal("canceled analysis succeeded")
	}
}
