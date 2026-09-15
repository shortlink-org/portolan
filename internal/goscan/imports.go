package goscan

import (
	"go/ast"
	"path"
	"strconv"
	"strings"
	"unicode"
)

// PackageName is the name a package is assumed to declare, read from its
// import path alone. The package clause is what Go binds, and it is not in the
// path, so this is the convention goimports relies on when it has nothing
// better: the last element, except that a major-version element - `/v2`,
// `/v10` - gives way to the one before it, a leading `go-` is dropped, and the
// name stops at the first character a Go identifier cannot have. That reads
// `github.com/jackc/pgx/v5` as pgx, `gopkg.in/yaml.v3` as yaml,
// `github.com/redis/go-redis/v9` as redis and `github.com/segmentio/kafka-go`
// as kafka.
//
// `/v0` and `/v1` are not major versions a module path may carry, and a
// directory called that - `k8s.io/api/core/v1` - is usually a package called
// that, so they stay. A package in the tree being read is not left to this
// guess: Read indexes the package clause and uses it.
func PackageName(importPath string) string {
	base := path.Base(importPath)
	if majorVersion(base) {
		if dir := path.Dir(importPath); dir != "." && dir != "/" {
			base = path.Base(dir)
		}
	}
	base = strings.TrimPrefix(base, "go-")
	if at := strings.IndexFunc(base, notIdentifier); at >= 0 {
		base = base[:at]
	}
	return base
}

// ImportName is the name a file uses for one of its imports: the name written
// in front of it when there is one - `_` and `.` included, as written - and the
// package's assumed name when there is not.
func ImportName(spec *ast.ImportSpec) string {
	if spec.Name != nil {
		return spec.Name.Name
	}
	importPath, err := strconv.Unquote(spec.Path.Value)
	if err != nil {
		return ""
	}
	return PackageName(importPath)
}

// ImportsOf is a file's imports by the name the file uses for them: the alias
// when there is one, the package name otherwise. Blank and dot imports are
// kept by the package name, since nothing in the file refers to them by name.
func ImportsOf(node *ast.File) map[string]string {
	out := map[string]string{}
	for _, spec := range node.Imports {
		value, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		name := ImportName(spec)
		if name == "_" || name == "." {
			name = PackageName(value)
		}
		out[name] = value
	}
	return out
}

func majorVersion(element string) bool {
	digits, ok := strings.CutPrefix(element, "v")
	if !ok || digits == "" || digits[0] == '0' {
		return false
	}
	n, err := strconv.Atoi(digits)
	return err == nil && n >= 2
}

func notIdentifier(r rune) bool {
	return !(r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r))
}
