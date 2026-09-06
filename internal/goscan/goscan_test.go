package goscan

import (
	"go/ast"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func write(t *testing.T, root, name, contents string) {
	t.Helper()
	full := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func tree(t *testing.T) *Tree {
	t.Helper()
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/m\n\ngo 1.22\n")
	write(t, root, "main.go", `package main

import (
	other "example.com/m/sub"
	"example.com/m/vendor/lib"
)

const (
	A = "a"
	B = A
	C = other.D
	Inherited
	Self1 = Self2
	Self2 = Self1
	Foreign = lib.Default
	Number = 3
)

type Args struct {
	ID     string `+"`json:\"id\"`"+`
	Secret string `+"`json:\"-\"`"+`
	Plain  int
	hidden bool
}
`)
	write(t, root, "sub/b.go", "package sub\n\nconst D = \"d\"\n")
	write(t, root, "sub/b_test.go", "package sub\n\nconst Test = \"never\"\n")
	write(t, root, "sub/gen.gen.go", "package sub\n\nconst Generated = \"never\"\n")
	write(t, root, "vendor/lib/lib.go", "package lib\n\nconst Default = \"never\"\n")
	write(t, root, ".hidden/h.go", "package hidden\n\nconst Hidden = \"never\"\n")
	write(t, root, "node_modules/x/x.go", "package x\n\nconst X = \"never\"\n")

	out, err := Read(root)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestReadKeepsTheSourceAndLeavesTheRest(t *testing.T) {
	out := tree(t)

	var names []string
	for _, file := range out.Files {
		names = append(names, file.Name+" "+file.Pkg)
	}
	want := []string{"main.go example.com/m", "sub/b.go example.com/m/sub"}
	if !reflect.DeepEqual(names, want) {
		t.Errorf("files: got %v, want %v", names, want)
	}
	if out.Module != "example.com/m" {
		t.Errorf("module: got %q", out.Module)
	}
	for _, key := range []string{"example.com/m/sub.Test", "example.com/m/sub.Generated", "example.com/m/vendor/lib.Default", "example.com/m/.hidden.Hidden"} {
		if _, found := out.Constants[key]; found {
			t.Errorf("%s was read", key)
		}
	}
}

func TestImportsAreByLocalName(t *testing.T) {
	out := tree(t)
	got := out.Files[0].Imports
	want := map[string]string{"other": "example.com/m/sub", "lib": "example.com/m/vendor/lib"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("imports: got %v, want %v", got, want)
	}
}

func TestADottedImportSegmentIsKnownByItsPackageName(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/m\n")
	write(t, root, "main.go", "package main\n\nimport (\n\t\"github.com/nats-io/nats.go\"\n\t\"gopkg.in/yaml.v3\"\n\t\"github.com/nats-io/nats.go/jetstream\"\n)\n")
	out, err := Read(root)
	if err != nil {
		t.Fatal(err)
	}
	got := out.Files[0].Imports
	want := map[string]string{
		"nats.go":   "github.com/nats-io/nats.go",
		"nats":      "github.com/nats-io/nats.go",
		"yaml.v3":   "gopkg.in/yaml.v3",
		"yaml":      "gopkg.in/yaml.v3",
		"jetstream": "github.com/nats-io/nats.go/jetstream",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("imports: got %v, want %v", got, want)
	}
}

func TestConstantsResolveThroughEachOther(t *testing.T) {
	out := tree(t)
	cases := map[string]string{
		"example.com/m.A":         "a",
		"example.com/m.B":         "a",
		"example.com/m.C":         "d",
		"example.com/m.Inherited": "d",
		"example.com/m.Self1":     "",
		"example.com/m.Foreign":   "",
		"example.com/m.Number":    "",
		"example.com/m.Missing":   "",
	}
	for key, want := range cases {
		if got := out.ConstantString(key, nil); got != want {
			t.Errorf("%s: got %q, want %q", key, got, want)
		}
	}
}

func TestForeignAnswersWhatTheTreeCannot(t *testing.T) {
	out := tree(t)
	out.Foreign = func(importPath, name string) (string, bool) {
		if importPath == "example.com/m/vendor/lib" && name == "Default" {
			return "default", true
		}
		return "", false
	}
	if got := out.ConstantString("example.com/m.Foreign", nil); got != "default" {
		t.Errorf("got %q, want %q", got, "default")
	}
}

func TestTypeKey(t *testing.T) {
	out := tree(t)
	file := out.Files[0]
	parse := func(src string) ast.Expr {
		expr, err := parseExpr(src)
		if err != nil {
			t.Fatal(err)
		}
		return expr
	}
	cases := map[string]string{
		"Args":             "example.com/m.Args",
		"*Args":            "example.com/m.Args",
		"string":           "string",
		"other.Thing":      "example.com/m/sub.Thing",
		"[]other.Thing":    "[]example.com/m/sub.Thing",
		"map[string]Args":  "map[string]example.com/m.Args",
		"interface{ M() }": "interface",
		"func()":           "",
		"a.b.C":            "",
	}
	for src, want := range cases {
		if got := out.TypeKey(parse(src), file); got != want {
			t.Errorf("%s: got %q, want %q", src, got, want)
		}
	}
	if got := out.TypeKey(nil, file); got != "" {
		t.Errorf("nil: got %q", got)
	}
}

func TestFieldsOfFollowTheJSONTag(t *testing.T) {
	out := tree(t)
	var body *ast.StructType
	ast.Inspect(out.Files[0].Node, func(node ast.Node) bool {
		if spec, ok := node.(*ast.TypeSpec); ok && spec.Name.Name == "Args" {
			body = spec.Type.(*ast.StructType)
		}
		return body == nil
	})
	got := out.FieldsOf(body)
	want := []string{"id string", "Plain int", "hidden bool"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestAtIsRelativeToTheRoot(t *testing.T) {
	out := tree(t)
	file := out.Files[1]
	at := out.At(file.Node.Decls[0].Pos())
	if at.String() != "sub/b.go:3" {
		t.Errorf("got %q", at.String())
	}
	if (Source{File: "x.go"}).String() != "x.go" {
		t.Error("a source with no line prints its line")
	}
}

func TestNames(t *testing.T) {
	if got := LastSegment("example.com/m.Args"); got != "Args" {
		t.Errorf("LastSegment: %q", got)
	}
	if got := LastSegment("plain"); got != "plain" {
		t.Errorf("LastSegment plain: %q", got)
	}
	if got := Slug("  Send Welcome_Mail!! "); got != "send-welcome-mail" {
		t.Errorf("Slug: %q", got)
	}
	if got := Title("send-welcome_mail.v1"); got != "Send Welcome Mail V1" {
		t.Errorf("Title: %q", got)
	}
	if got := FirstNonEmpty(" ", "", "x", "y"); got != "x" {
		t.Errorf("FirstNonEmpty: %q", got)
	}
	if got := strings.TrimSpace(FirstNonEmpty(" ", "")); got != "" {
		t.Errorf("FirstNonEmpty empty: %q", got)
	}
}
