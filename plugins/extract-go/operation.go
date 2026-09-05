package main

import (
	"go/ast"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extractOperations reads internal/application/<aggregate>/usecases/*, keyed by
// the aggregate the use cases sit under.
//
// The application layer is where the commands and queries actually are. The
// aggregate's own methods are the mechanics of one - Register, ChangePassword -
// but a use case is the whole operation, it already has a name a reader would
// recognise, and in this codebase it has a README of its own.
func extractOperations(root string, exposures map[string][]string, b *plugin.Builder) map[string][]catalog.Operation {
	out := map[string][]catalog.Operation{}

	for _, aggregate := range subdirs(root, "internal/application") {
		base := path.Join("internal/application", aggregate, "usecases")
		if _, err := os.Stat(filepath.Join(root, base)); err != nil {
			// Not every directory in the application layer is a set of use
			// cases; a policy or a saga lives there too.
			continue
		}

		for _, name := range subdirs(root, base) {
			pkg, err := parsePkg(root, path.Join(base, name))
			if err != nil {
				b.Warn(aggregate, base+"/"+name+" could not be parsed; skipped")

				continue
			}

			out[aggregate] = append(out[aggregate], catalog.Operation{
				ID:   camel(name),
				Kind: operationKind(pkg),
				Doc:  operationDoc(root, path.Join(base, name), pkg),
				// Which endpoints run it, read from the transport layer. Absent
				// is the honest answer for a use case nothing outside can
				// reach - and in this service that is a deliberate design, not
				// an oversight.
				ExposedBy: exposures[aggregate+"/"+name],
			})
		}
	}

	return out
}

// operationKind asks whether the use case writes.
//
// A use case that reaches a repository's Save or Delete changes state, and one
// that does not is answering a question. Every method on UseCase is looked at,
// not just Handle: a use case that revokes a list of sessions does the writing
// in a helper, and reading only the entry point would file it as a query.
//
// This is a reading of the code rather than a declaration in it, so it is wrong
// exactly when a use case mutates through a name this does not know - which is
// a rule that can be read here, over an annotation nobody would keep current.
func operationKind(pkg *pkg) catalog.OperationKind {
	ports := map[string]bool{}
	for _, held := range pkg.structs() {
		if held.name != "UseCase" || held.fields == nil || held.fields.Fields == nil {
			continue
		}
		for _, field := range held.fields.Fields.List {
			for _, name := range field.Names {
				ports[name.Name] = true
			}
		}
	}
	for _, fn := range pkg.methods("UseCase") {
		if callsWritePort(fn, ports) {
			return catalog.OperationCommand
		}
	}

	return catalog.OperationQuery
}

// All language extractors share this core vocabulary. Framework extractors
// may add native write verbs (Django's bulk_update, for example), but a helper
// method or an unrelated value called Save is not enough: the call has to be
// made through a dependency held by the use case.
var writeMethods = map[string]bool{
	"save": true, "delete": true, "create": true, "update": true,
	"publish": true, "remove": true, "insert": true, "upsert": true,
}

func callsWritePort(fn *ast.FuncDecl, ports map[string]bool) bool {
	if fn == nil || fn.Body == nil {
		return false
	}
	receiver := receiverIdent(fn)
	found := false
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		method, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || !writeMethods[strings.ToLower(method.Sel.Name)] {
			return true
		}
		field, ok := method.X.(*ast.SelectorExpr)
		if !ok || !ports[field.Sel.Name] {
			return true
		}
		base, ok := field.X.(*ast.Ident)
		if ok && base.Name == receiver {
			found = true
			return false
		}
		return true
	})
	return found
}

// operationDoc prefers the use case's README, which is written for a reader,
// over its package comment, which is written for whoever opens the file next.
func operationDoc(root, dir string, pkg *pkg) string {
	readme := readFile(filepath.Join(root, filepath.FromSlash(dir), "README.md"))
	if readme != "" {
		if summary := firstParagraphAfterTitle(readme); summary != "" {
			return summary
		}
	}

	return firstSentenceOrAll(pkg.doc())
}

// firstParagraphAfterTitle is the prose under a readme's heading and before its
// first section: the one paragraph that says what the thing does.
func firstParagraphAfterTitle(md string) string {
	var lines []string

	started := false
	for _, line := range strings.Split(md, "\n") {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "#") {
			if started {
				break
			}
			started = true

			continue
		}
		if trimmed == "" {
			if len(lines) > 0 {
				break
			}

			continue
		}
		lines = append(lines, trimmed)
	}

	return strings.Join(lines, " ")
}
