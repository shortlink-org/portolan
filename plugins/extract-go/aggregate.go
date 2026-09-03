package main

import (
	"os"
	"path"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// extractAggregate reads one package under internal/domain.
//
// The layout is the claim: a directory there is an aggregate, the struct named
// after it is the root, `vo/` holds its value objects and `event/` the facts it
// publishes. Nothing is inferred from a comment or a marker interface, so a
// package that does not follow the layout produces a diagnostic instead of a
// half-right aggregate.
func extractAggregate(root, dir, svcID string, b *plugin.Builder) (catalog.Aggregate, bool) {
	pkg, err := parsePkg(root, path.Join("internal/domain", dir))
	if err != nil {
		if !os.IsNotExist(err) {
			b.Warn(aggregateID(svcID, dir), "internal/domain/"+dir+" could not be parsed: "+err.Error())
		}

		return catalog.Aggregate{}, false
	}

	id := aggregateID(svcID, dir)
	name := title(pkg.name)

	aggregate := catalog.Aggregate{
		ID:           id,
		Slug:         dir,
		Name:         name,
		Readme:       readme(pkg.name, name, pkg.doc()),
		Entities:     []catalog.Block{},
		ValueObjects: []catalog.Block{},
		Operations:   []catalog.Operation{},
		Events:       []catalog.Event{},
	}

	for _, decl := range pkg.structs() {
		if !exported(decl.name) {
			continue
		}

		aggregate.Entities = append(aggregate.Entities, catalog.Block{
			ID:     blockID(id, slug(decl.name)),
			Slug:   slug(decl.name),
			Name:   decl.name,
			Doc:    decl.doc,
			Fields: fields(decl.fields),
		})
	}

	// The root is the entity named after its package: package user holds User.
	// It is a rule rather than a guess, and a package that breaks it says so.
	aggregate.Root = name
	if !hasBlock(aggregate.Entities, aggregate.Root) {
		if len(aggregate.Entities) == 0 {
			b.Warn(id, "internal/domain/"+dir+" declares no exported struct, so the aggregate has no root")

			return catalog.Aggregate{}, false
		}

		aggregate.Root = aggregate.Entities[0].Name
		b.Warn(id, "internal/domain/"+dir+" has no struct called "+name+"; taking "+aggregate.Root+" as the root")
	}

	aggregate.ValueObjects = extractValueObjects(root, dir, id, b)
	aggregate.Events = extractEvents(root, dir, id, b)

	return aggregate, true
}

// extractValueObjects reads internal/domain/<aggregate>/vo/*.
//
// Each directory there is one value object, and the exported struct inside it
// is its shape. `rules/` is skipped: a validation specification is how the
// value object refuses a value, not part of what it holds.
func extractValueObjects(root, dir, aggID string, b *plugin.Builder) []catalog.Block {
	out := []catalog.Block{}

	for _, name := range subdirs(root, path.Join("internal/domain", dir, "vo")) {
		if name == "rules" {
			continue
		}

		pkg, err := parsePkg(root, path.Join("internal/domain", dir, "vo", name))
		if err != nil {
			continue
		}

		found := false
		for _, decl := range pkg.structs() {
			if !exported(decl.name) {
				continue
			}

			doc := decl.doc
			if doc == "" {
				doc = firstSentenceOrAll(pkg.doc())
			}

			// Qualified the way Go refers to it, so that the value object and
			// the field that holds it are visibly the same thing: User.Password
			// is a `password.Hash`, and a block called just `Hash` says nothing
			// about which one.
			label := qualified(pkg.name, decl.name)

			out = append(out, catalog.Block{
				ID:     blockID(aggID, slug(label)),
				Slug:   slug(label),
				Name:   label,
				Doc:    doc,
				Fields: fields(decl.fields),
			})
			found = true
		}

		if !found {
			b.Warn(aggID, "internal/domain/"+dir+"/vo/"+name+" declares no exported struct; skipped")
		}
	}

	return out
}

func hasBlock(blocks []catalog.Block, name string) bool {
	for i := range blocks {
		if blocks[i].Name == name {
			return true
		}
	}

	return false
}

// qualified is pkg.Name, unless the package is named after the type it holds -
// token.Token adds nothing over Token.
func qualified(pkg, name string) string {
	if strings.EqualFold(pkg, name) {
		return name
	}

	return pkg + "." + name
}

func exported(name string) bool {
	return name != "" && name[0] >= 'A' && name[0] <= 'Z'
}

// readme turns a package comment into the markdown the catalog carries. The
// heading is added because every other readme in a catalog has one, and a page
// that starts mid-paragraph reads as a fragment of something else.
func readme(pkgName, name, doc string) string {
	doc = withoutPackagePrefix(pkgName, strings.TrimSpace(doc))
	if doc == "" {
		return ""
	}

	return "# " + name + "\n\n" + doc
}

// withoutPackagePrefix drops the "Package user " that Go doc convention puts at
// the front of a package comment.
//
// It is a convention for godoc, where the sentence is read next to the package
// clause. On a page headed "User" it reads as a leftover from somewhere else,
// and the sentence works perfectly well without it.
func withoutPackagePrefix(pkgName, doc string) string {
	return withoutLeading("Package "+pkgName+" ", doc)
}

// withoutLeading is the same for anything else Go doc convention names before
// it says anything: a type comment opens with the type.
func withoutLeading(prefix, doc string) string {
	rest, ok := strings.CutPrefix(doc, prefix)
	if !ok {
		return doc
	}

	runes := []rune(rest)
	if len(runes) == 0 {
		return doc
	}
	if runes[0] >= 'a' && runes[0] <= 'z' {
		runes[0] = runes[0] - 'a' + 'A'
	}

	return string(runes)
}
