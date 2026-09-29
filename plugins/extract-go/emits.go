package extractgo

import (
	"go/ast"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// What a use case can publish, read off the domain calls it makes.
//
//	func (l *Lockout) Fail(now time.Time) (event.AccountLocked, bool) { … }
//
//	func (uc *UseCase) Handle(ctx context.Context, in Command) error {
//	    if ev, locked := l.Fail(now); locked { events = append(events, ev) }
//	    return uc.repo.Save(ctx, l, events...)
//	}
//
// The domain says which of its functions produce which events: a function or
// a root method produces the events its results are typed as and the events it
// builds as literals, and whatever the functions it calls produce. The use case
// says which of those it calls. The event is the domain's to name, and the use
// case only decides whether to run the method that names it - so the operation
// emits what it reaches, whether or not a branch keeps the result.
//
// Calls are matched by name: a root method by its name on any receiver, a
// domain function through the import that names the domain package. A
// repository method that happens to share a name with an emitting root method
// is read as that method; the names in a domain package are chosen to say what
// the aggregate does, and the collision is rare enough to take.
type emitters struct {
	methods map[string][]string // root method -> event ids
	funcs   map[string][]string // package function -> event ids
	events  map[string]string   // event type name -> event id
	order   map[string]int      // event id -> position in the aggregate
	pkgName string              // what an unaliased import of the domain is called
}

// domainEmitters reads the emitting functions of one domain package.
func domainEmitters(domain *pkg, root string, events []catalog.Event) emitters {
	e := emitters{
		methods: map[string][]string{},
		funcs:   map[string][]string{},
		events:  map[string]string{},
		order:   map[string]int{},
		pkgName: domain.name,
	}
	for i, ev := range events {
		e.events[ev.Name] = ev.ID
		e.order[ev.ID] = i
	}
	if len(events) == 0 {
		return e
	}

	// Each function's own events and the domain functions it calls, then the
	// calls folded in until nothing changes: a method that records through an
	// unexported helper emits what the helper builds.
	type node struct {
		own   map[string]bool
		calls []string
	}
	nodes := map[string]*node{}
	key := func(method bool, name string) string {
		if method {
			return "m:" + name
		}

		return "f:" + name
	}
	for _, file := range domain.files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			method := fn.Recv != nil && len(fn.Recv.List) > 0
			if method && receiverName(fn.Recv.List[0].Type) != root {
				continue
			}
			n := &node{own: map[string]bool{}}
			for _, id := range e.resultEvents(fn) {
				n.own[id] = true
			}
			receiver := receiverIdent(fn)
			ast.Inspect(fn.Body, func(x ast.Node) bool {
				switch x := x.(type) {
				case *ast.CompositeLit:
					if id := e.literalEvent(x); id != "" {
						n.own[id] = true
					}
				case *ast.CallExpr:
					switch f := x.Fun.(type) {
					case *ast.Ident:
						n.calls = append(n.calls, key(false, f.Name))
					case *ast.SelectorExpr:
						if base, ok := f.X.(*ast.Ident); ok && receiver != "" && base.Name == receiver {
							n.calls = append(n.calls, key(true, f.Sel.Name))
						}
					}
				}

				return true
			})
			nodes[key(method, fn.Name.Name)] = n
		}
	}
	for changed := true; changed; {
		changed = false
		for _, n := range nodes {
			for _, callee := range n.calls {
				c, ok := nodes[callee]
				if !ok {
					continue
				}
				for id := range c.own {
					if !n.own[id] {
						n.own[id] = true
						changed = true
					}
				}
			}
		}
	}
	for k, n := range nodes {
		if len(n.own) == 0 || !exported(k[2:]) {
			continue
		}
		ids := e.sorted(n.own)
		if strings.HasPrefix(k, "m:") {
			e.methods[k[2:]] = ids
		} else {
			e.funcs[k[2:]] = ids
		}
	}

	return e
}

// resultEvents are the events a function's results are typed as.
func (e emitters) resultEvents(fn *ast.FuncDecl) []string {
	if fn.Type.Results == nil {
		return nil
	}
	var out []string
	for _, field := range fn.Type.Results.List {
		if id := e.typeEvent(field.Type); id != "" {
			out = append(out, id)
		}
	}

	return out
}

func (e emitters) literalEvent(lit *ast.CompositeLit) string {
	if lit.Type == nil {
		return ""
	}

	return e.typeEvent(lit.Type)
}

func (e emitters) typeEvent(expr ast.Expr) string {
	if star, ok := expr.(*ast.StarExpr); ok {
		expr = star.X
	}
	switch t := expr.(type) {
	case *ast.SelectorExpr:
		return e.events[t.Sel.Name]
	case *ast.Ident:
		return e.events[t.Name]
	}

	return ""
}

func (e emitters) sorted(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return e.order[out[i]] < e.order[out[j]] })

	return out
}

// useCaseEmits is what one use case package reaches: root methods by name,
// domain functions through the import of domainPath, and event literals built
// in the use case itself. Nil when it reaches nothing.
func (e emitters) useCaseEmits(useCase *pkg, domainPath string) []string {
	if len(e.events) == 0 {
		return nil
	}
	found := map[string]bool{}
	for _, file := range useCase.files {
		domainImports := map[string]bool{}
		for _, spec := range file.Imports {
			importPath, err := strconv.Unquote(spec.Path.Value)
			if err != nil || !strings.HasSuffix(importPath, "/"+domainPath) {
				continue
			}
			// The package clause names it, not the directory:
			// .../lockout/domain declares package lockout.
			name := e.pkgName
			if spec.Name != nil {
				name = spec.Name.Name
			}
			domainImports[name] = true
		}
		ast.Inspect(file, func(x ast.Node) bool {
			switch x := x.(type) {
			case *ast.CompositeLit:
				if id := e.literalEvent(x); id != "" {
					found[id] = true
				}
			case *ast.CallExpr:
				f, ok := x.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				ids := e.methods[f.Sel.Name]
				if base, ok := f.X.(*ast.Ident); ok && domainImports[base.Name] {
					ids = e.funcs[f.Sel.Name]
				}
				for _, id := range ids {
					found[id] = true
				}
			}

			return true
		})
	}
	if len(found) == 0 {
		return nil
	}

	return e.sorted(found)
}

// linkEmits fills each operation's Emits from the use case it was read from.
func linkEmits(root, aggregateName string, layout sourceLayout, aggregate *catalog.Aggregate) {
	domainPath := layout.domains[aggregateName]
	domain, err := parsePkg(root, domainPath, layout.index)
	if err != nil {
		return
	}
	e := domainEmitters(domain, aggregate.Root, aggregate.Events)
	for i := range aggregate.Operations {
		dir := layout.useCases[aggregateName+"/"+useCaseName(layout, aggregateName, aggregate.Operations[i].ID)]
		if dir == "" {
			continue
		}
		useCase, err := parsePkg(root, dir, layout.index)
		if err != nil {
			continue
		}
		aggregate.Operations[i].Emits = e.useCaseEmits(useCase, domainPath)
	}
}

// useCaseName finds the use case directory an operation id was made from.
func useCaseName(layout sourceLayout, aggregateName, id string) string {
	for key := range layout.useCases {
		agg, name, _ := strings.Cut(key, "/")
		if agg == aggregateName && camel(name) == id {
			return name
		}
	}

	return ""
}
