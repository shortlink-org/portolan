package main

import (
	"go/ast"
	"go/token"
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// The root's lifecycle, read off a go-sdk/fsm rule set and the one method
// that runs events through it.
//
//	var Rules = fsm.TransitionRuleSet{
//	    StateLive:    {EventRevoke: StateRevoked},
//	    StateRevoked: {},
//	}
//	func (s *Session) trigger(ev fsm.Event, now time.Time) bool { … machine.TriggerEvent(ctx, ev) … }
//	func (s *Session) Revoke(reason event.Reason, now time.Time) (event.SessionEnded, bool) { s.trigger(EventRevoke, now) … }
//
// The rule set gives the states, in the order the literal lists them, and the
// edges, each named by the fsm event that takes it. The method whose body
// calls TriggerEvent is the mover; every exported method that hands the mover
// a constant makes the edges that constant names. The event type a method
// returns is what its last move publishes: a Go method puts its guards and
// its housekeeping first and the change it announces at the end, so a method
// that lapses a lock and then locks again hands AccountLocked back for the
// lock, not for the lapse. A rule no method takes, a constant no rule knows,
// and a mover handed something that is not a constant are each reported,
// because the table is a claim and the claim should be kept.
func readLifecycle(p *pkg, root string, events []catalog.Event, aggID string, b *plugin.Builder) *catalog.Lifecycle {
	consts := stringConsts(p)
	states, rules := ruleSet(p, consts)
	if len(states) == 0 {
		return nil
	}

	mover := ""
	methods := p.methods(root)
	for name, fn := range methods {
		if calls(fn, "TriggerEvent") {
			mover = name

			break
		}
	}
	if mover == "" {
		b.Warn(aggID, "internal/domain/"+p.name+" declares a fsm.TransitionRuleSet but no method of "+root+" calls TriggerEvent, so nothing is read as moving along it")

		return &catalog.Lifecycle{States: states, Transitions: []catalog.Transition{}}
	}

	byName := map[string]string{}
	for _, ev := range events {
		byName[ev.Name] = ev.ID
	}

	var transitions []catalog.Transition
	taken := map[string]bool{}
	for name, fn := range methods {
		if name == mover || !exported(name) || fn.Body == nil {
			continue
		}
		emits := emittedEvent(fn, byName)
		var made []catalog.Transition
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (sel.Sel.Name != mover && sel.Sel.Name != "TriggerEvent") {
				return true
			}
			event, literal := eventArg(call, consts)
			if !literal {
				b.Warn(aggID, p.at(call.Pos())+": "+name+" hands "+sel.Sel.Name+" something that is not a constant; the move is not in the lifecycle")

				return true
			}
			known := false
			for _, from := range states {
				to, ok := rules[from][event]
				if !ok {
					continue
				}
				known = true
				taken[from+"→"+to] = true
				made = append(made, catalog.Transition{From: from, To: to, On: name, Source: p.at(call.Pos())})
			}
			if !known {
				b.Warn(aggID, p.at(call.Pos())+": "+name+" triggers "+strconv.Quote(event)+", which no rule in the table knows")
			}

			return true
		})
		// The event goes with the last move the method makes: see above.
		if len(made) > 0 && emits != "" {
			last := made[len(made)-1].Source
			for i := range made {
				if made[i].Source == last {
					made[i].Emits = emits
				}
			}
		}
		transitions = append(transitions, made...)
	}
	for _, from := range states {
		for event, to := range rules[from] {
			if !taken[from+"→"+to] {
				b.Warn(aggID, "the table allows "+from+" → "+to+" on "+strconv.Quote(event)+", and no method of "+root+" makes that move")
			}
		}
	}

	order := map[string]int{}
	for i, s := range states {
		order[s] = i
	}
	sort.SliceStable(transitions, func(i, j int) bool {
		a, c := transitions[i], transitions[j]
		if order[a.From] != order[c.From] {
			return order[a.From] < order[c.From]
		}
		if order[a.To] != order[c.To] {
			return order[a.To] < order[c.To]
		}

		return a.On < c.On
	})
	if transitions == nil {
		transitions = []catalog.Transition{}
	}

	return &catalog.Lifecycle{States: states, Transitions: transitions}
}

// ruleSet finds a package-level `fsm.TransitionRuleSet{…}` literal and reads
// it as states, in literal order, and from → event → to. A state that only
// ever appears as a target is appended, so the table can leave a terminal
// state out and the page still draws it.
func ruleSet(p *pkg, consts map[string]string) ([]string, map[string]map[string]string) {
	rules := map[string]map[string]string{}
	var states []string
	seen := map[string]bool{}
	add := func(state string) {
		if !seen[state] {
			seen[state] = true
			states = append(states, state)
		}
	}

	for _, file := range p.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.VAR {
				continue
			}
			for _, spec := range gen.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for _, v := range value.Values {
					lit, ok := v.(*ast.CompositeLit)
					if !ok || !isRuleSetType(lit.Type) {
						continue
					}
					for _, elt := range lit.Elts {
						kv, ok := elt.(*ast.KeyValueExpr)
						if !ok {
							continue
						}
						from, ok := constString(kv.Key, consts)
						if !ok {
							continue
						}
						add(from)
						if rules[from] == nil {
							rules[from] = map[string]string{}
						}
						inner, ok := kv.Value.(*ast.CompositeLit)
						if !ok {
							continue
						}
						for _, e := range inner.Elts {
							pair, ok := e.(*ast.KeyValueExpr)
							if !ok {
								continue
							}
							event, ok1 := constString(pair.Key, consts)
							to, ok2 := constString(pair.Value, consts)
							if ok1 && ok2 {
								rules[from][event] = to
							}
						}
					}
				}
			}
		}
	}
	for _, from := range append([]string(nil), states...) {
		for _, to := range rules[from] {
			add(to)
		}
	}

	return states, rules
}

func isRuleSetType(expr ast.Expr) bool {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)

	return ok && pkg.Name == "fsm" && sel.Sel.Name == "TransitionRuleSet"
}

// eventArg finds the fsm event a call hands over: the constant among its
// arguments, whichever position the mover keeps it in.
func eventArg(call *ast.CallExpr, consts map[string]string) (string, bool) {
	for _, arg := range call.Args {
		if s, ok := constString(arg, consts); ok {
			return s, true
		}
	}

	return "", false
}

// constString reads an expression as a string it can be sure of: a literal,
// or a name the package declares as one.
func constString(expr ast.Expr, consts map[string]string) (string, bool) {
	switch e := expr.(type) {
	case *ast.BasicLit:
		if e.Kind == token.STRING {
			s, err := strconv.Unquote(e.Value)

			return s, err == nil
		}
	case *ast.Ident:
		s, ok := consts[e.Name]

		return s, ok
	case *ast.ParenExpr:
		return constString(e.X, consts)
	}

	return "", false
}

// stringConsts collects the package's string constants by name, typed or not:
// `StateLive fsm.State = "live"` is "live".
func stringConsts(p *pkg) map[string]string {
	out := map[string]string{}
	for _, file := range p.files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range value.Names {
					if i >= len(value.Values) {
						break
					}
					if s, ok := constString(value.Values[i], nil); ok {
						out[name.Name] = s
					}
				}
			}
		}
	}

	return out
}

// emittedEvent is the event type among a method's results, when one of the
// aggregate's events is there: `(event.SessionEnded, bool)` emits SessionEnded.
func emittedEvent(fn *ast.FuncDecl, byName map[string]string) string {
	if fn.Type.Results == nil {
		return ""
	}
	for _, field := range fn.Type.Results.List {
		expr := field.Type
		if star, ok := expr.(*ast.StarExpr); ok {
			expr = star.X
		}
		name := ""
		switch t := expr.(type) {
		case *ast.SelectorExpr:
			name = t.Sel.Name
		case *ast.Ident:
			name = t.Name
		}
		if id, ok := byName[name]; ok {
			return id
		}
	}

	return ""
}

// at is a position as a reader would open it: the package-relative path and
// the line.
func (p *pkg) at(pos token.Pos) string {
	for file, rel := range p.paths {
		if file.Pos() <= pos && pos <= file.End() {
			return rel + ":" + strconv.Itoa(p.fset.Position(pos).Line)
		}
	}
	name, line := p.position(pos)

	return strings.TrimPrefix(name, p.dir+"/") + ":" + strconv.Itoa(line)
}
