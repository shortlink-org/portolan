package extractgo

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/internal/goscan"
)

// sourceLayout is the small amount of filesystem knowledge the extractor
// needs. Discovery is deliberately separate from reading behaviour: the rest
// of the extractor deals in aggregate/use-case keys and concrete package
// directories, not in one repository-wide directory convention.
type sourceLayout struct {
	index             *goscan.Tree
	packages          []string
	domains           map[string]string
	useCases          map[string]string
	integrationEvents map[string]string
	policies          []string
	http              []string
	grpc              []string
}

// scoped keeps the packages owned by one deployable in a shared Go module.
// The flow reader may still follow explicit imports outside this set; the
// scope decides ownership, not reachability.
func (l sourceLayout) scoped(scope string) sourceLayout {
	prefix := "internal/" + strings.Trim(scope, "/") + "/"
	keep := func(dir string) bool { return dir == strings.TrimSuffix(prefix, "/") || strings.HasPrefix(dir, prefix) }
	out := sourceLayout{
		index:   l.index,
		domains: map[string]string{}, useCases: map[string]string{}, integrationEvents: map[string]string{},
	}
	for _, dir := range l.packages {
		if keep(dir) {
			out.packages = append(out.packages, dir)
		}
	}
	for name, dir := range l.domains {
		if keep(dir) {
			out.domains[name] = dir
		}
	}
	for name, dir := range l.useCases {
		if keep(dir) {
			out.useCases[name] = dir
		}
	}
	for name, dir := range l.integrationEvents {
		if keep(dir) {
			out.integrationEvents[name] = dir
		}
	}
	for _, dir := range l.policies {
		if keep(dir) {
			out.policies = append(out.policies, dir)
		}
	}
	for _, dir := range l.http {
		if keep(dir) {
			out.http = append(out.http, dir)
		}
	}
	for _, dir := range l.grpc {
		if keep(dir) {
			out.grpc = append(out.grpc, dir)
		}
	}
	return out
}

func discoverLayout(root string, indexes ...*goscan.Tree) sourceLayout {
	var index *goscan.Tree
	if len(indexes) > 0 {
		index = indexes[0]
	}
	if index == nil {
		index, _ = goscan.ReadWithOptions(root, goscan.ReadOptions{IncludeGenerated: true, AllowPartial: true})
	}
	layout := sourceLayout{
		index:             index,
		packages:          goPackageDirs(root, "internal", index),
		domains:           map[string]string{},
		useCases:          map[string]string{},
		integrationEvents: map[string]string{},
	}

	for _, dir := range layout.packages {
		parts := strings.Split(filepath.ToSlash(dir), "/")

		if aggregate, ok := domainDir(parts); ok {
			layout.domains[aggregate] = dir
		}
		if aggregate, ok := integrationEventDir(parts); ok {
			layout.integrationEvents[aggregate] = dir
		}
		if aggregate, name, ok := useCaseDir(parts); ok {
			pkg, err := parsePkg(root, dir, index)
			if err == nil && hasStructNamed(pkg, "UseCase") {
				layout.useCases[aggregate+"/"+name] = dir
			}
		}

		if path.Base(dir) == "policy" {
			layout.policies = append(layout.policies, dir)
		}
		if isTransportPackage(parts, "http") {
			layout.http = append(layout.http, dir)
		}
		if isTransportPackage(parts, "grpc") {
			layout.grpc = append(layout.grpc, dir)
		}
	}

	sort.Strings(layout.policies)
	sort.Strings(layout.http)
	sort.Strings(layout.grpc)

	return layout
}

func hasStructNamed(pkg *pkg, name string) bool {
	for _, decl := range pkg.structs() {
		if decl.name == name {
			return true
		}
	}
	return false
}

// domainDir accepts both layouts:
//
//	internal/domain/user
//	internal/user/domain
func domainDir(parts []string) (string, bool) {
	if len(parts) == 3 && parts[0] == "internal" && parts[1] == "domain" {
		return parts[2], true
	}
	if len(parts) == 3 && parts[0] == "internal" && parts[2] == "domain" {
		return parts[1], true
	}
	return "", false
}

// useCaseDir accepts the horizontal convention, feature slices with use cases
// directly below application, and feature slices that keep a usecases level.
func useCaseDir(parts []string) (aggregate, name string, ok bool) {
	if len(parts) == 5 && parts[0] == "internal" && parts[1] == "application" && parts[3] == "usecases" {
		return parts[2], parts[4], true
	}
	if len(parts) == 4 && parts[0] == "internal" && parts[2] == "application" {
		return parts[1], parts[3], true
	}
	if len(parts) == 5 && parts[0] == "internal" && parts[2] == "application" && parts[3] == "usecases" {
		return parts[1], parts[4], true
	}
	return "", "", false
}

func integrationEventDir(parts []string) (string, bool) {
	if len(parts) == 4 && parts[0] == "internal" && parts[2] == "integration" && parts[3] == "event" {
		return parts[1], true
	}
	// Legacy event DTOs lived beside repositories.
	if len(parts) == 5 && parts[0] == "internal" && parts[1] == "infrastructure" && parts[2] == "repository" && parts[4] == "dto" {
		return parts[3], true
	}
	return "", false
}

func isTransportPackage(parts []string, protocol string) bool {
	for _, part := range parts {
		if part == "gen" {
			return false
		}
	}
	for i, part := range parts {
		if part != protocol || i == 0 {
			continue
		}
		// Horizontal: infrastructure/transport/http[/handler].
		// Feature:    user/infrastructure/http[/handler].
		// Shared:     internal/transport/http.
		if parts[i-1] == "transport" || parts[i-1] == "infrastructure" {
			return true
		}
	}
	return false
}

func goPackageDirs(root, rel string, indexes ...*goscan.Tree) []string {
	if len(indexes) > 0 && indexes[0] != nil {
		return indexes[0].PackageDirs(rel)
	}
	base := filepath.Join(root, filepath.FromSlash(rel))
	seen := map[string]bool{}

	_ = filepath.WalkDir(base, func(filename string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if filename != base {
				switch entry.Name() {
				case "vendor", "node_modules", "testdata":
					return filepath.SkipDir
				}
				if _, err := os.Stat(filepath.Join(filename, "go.mod")); err == nil {
					return filepath.SkipDir
				}
			}
			if filename != base && strings.HasPrefix(entry.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			return nil
		}
		dir, err := filepath.Rel(root, filepath.Dir(filename))
		if err == nil {
			seen[filepath.ToSlash(dir)] = true
		}
		return nil
	})

	out := make([]string, 0, len(seen))
	for dir := range seen {
		out = append(out, dir)
	}
	sort.Strings(out)
	return out
}

func internalParts(importPath string) ([]string, bool) {
	_, after, found := strings.Cut(importPath, "/internal/")
	if !found || after == "" {
		return nil, false
	}
	return append([]string{"internal"}, strings.Split(after, "/")...), true
}

func domainImport(importPath string) (string, bool) {
	parts, ok := internalParts(importPath)
	if !ok {
		return "", false
	}
	return domainDir(parts)
}

func eventImport(importPath string) (string, bool) {
	parts, ok := internalParts(importPath)
	if !ok {
		return "", false
	}
	if len(parts) == 4 && parts[0] == "internal" && parts[1] == "domain" && parts[3] == "event" {
		return parts[2], true
	}
	if len(parts) == 4 && parts[0] == "internal" && parts[2] == "domain" && parts[3] == "event" {
		return parts[1], true
	}
	return integrationEventDir(parts)
}

func useCaseImport(importPath string) (aggregate, name string, ok bool) {
	parts, ok := internalParts(importPath)
	if !ok {
		return "", "", false
	}
	return useCaseDir(parts)
}

func applicationSupportImport(importPath string) bool {
	parts, ok := internalParts(importPath)
	if !ok {
		return false
	}

	return (len(parts) >= 3 && parts[1] == "application") ||
		(len(parts) >= 4 && parts[2] == "application")
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
