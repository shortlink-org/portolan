package extractterraform

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclparse"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"

	"github.com/shortlink-org/portolan/plugin"
)

// A Terraform module is read as syntax and never evaluated: there is no
// provider, no state and no plan here, only the files. A value is followed
// the way goscan follows a subject - to a literal, a variable's default, a
// local, the argument a calling module block passed in, or a child module's
// output - and what that does not reach stays unresolved, with a warning at
// the attribute that names it. A reference from one resource to another
// (aws_sqs_queue.orders.arn) is a fact by itself and needs no value: it is
// the edge the code cannot prove.

// resource is one resource block: its type and label, its body, and where it
// was written relative to the input root.
type resource struct {
	Type   string
	Label  string
	Body   *hclsyntax.Body
	Source string
	scope  *scope
	// module is set for a registry module read as this resource: the block
	// is the module call, and its inputs are read under the module's names.
	module *knownModule
	// fixedName is a name the resource is given rather than reads: the
	// dead-letter queue a module makes beside its queue is called after it.
	fixedName string
	// derived is the resource that stands for the "<name>" part of a module
	// output spelled "<name>:<attribute>" - the dead-letter queue.
	derived map[string]*resource
	// parent is the module resource a derived one belongs to.
	parent *resource
}

// Address is how Terraform itself names the resource, prefixed by the
// module path when it lives in a called module; a registry module is
// named as the call, `module.sqs`, and what it made beside itself after it.
func (r *resource) Address() string {
	if r.parent != nil {
		return r.parent.Address() + "." + r.Label
	}
	if r.module != nil {
		return r.scope.prefix + "module." + r.Label
	}
	return r.scope.prefix + r.Type + "." + r.Label
}

// scope is one module's namespace: its resources, variables, locals and
// outputs, and - for a called module - the block that called it, whose
// attributes are what the module's variables are worth.
type scope struct {
	dir       string
	prefix    string
	parent    *scope
	callArgs  map[string]hclsyntax.Expression
	resources map[string]*resource
	variables map[string]hclsyntax.Expression
	locals    map[string]hclsyntax.Expression
	outputs   map[string]hclsyntax.Expression
	children  map[string]*scope
	order     []*resource
}

// tree is every scope read, root first, with the resources of all of them in
// one order: by module path, then file name, then position.
type tree struct {
	root      string
	resources []*resource
}

// readTree reads the *.tf files of dir under root, and of every local module
// they call, following calls to any depth but never into the same directory
// twice along one path.
func readTree(root, dir string, b *plugin.Builder) (*tree, error) {
	t := &tree{root: root}
	parser := hclparse.NewParser()
	top, err := t.readScope(parser, dir, "", nil, nil, map[string]bool{}, b)
	if err != nil {
		return nil, err
	}
	var collect func(s *scope)
	collect = func(s *scope) {
		t.resources = append(t.resources, s.order...)
		names := make([]string, 0, len(s.children))
		for name := range s.children {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			collect(s.children[name])
		}
	}
	collect(top)
	return t, nil
}

func (t *tree) readScope(parser *hclparse.Parser, dir, prefix string, parent *scope, callArgs map[string]hclsyntax.Expression, visiting map[string]bool, b *plugin.Builder) (*scope, error) {
	s := &scope{
		dir:       dir,
		prefix:    prefix,
		parent:    parent,
		callArgs:  callArgs,
		resources: map[string]*resource{},
		variables: map[string]hclsyntax.Expression{},
		locals:    map[string]hclsyntax.Expression{},
		outputs:   map[string]hclsyntax.Expression{},
		children:  map[string]*scope{},
	}
	absDir := filepath.Join(t.root, dir)
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".tf") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	type moduleCall struct {
		name   string
		source string
		body   *hclsyntax.Body
		at     string
	}
	var calls []moduleCall
	for _, name := range names {
		rel := filepath.ToSlash(filepath.Join(dir, name))
		contents, err := os.ReadFile(filepath.Join(absDir, name))
		if err != nil {
			return nil, err
		}
		file, diags := parser.ParseHCL(contents, rel)
		if diags.HasErrors() {
			b.Warn(rel, "could not be parsed: "+diags.Error())
			continue
		}
		body, ok := file.Body.(*hclsyntax.Body)
		if !ok {
			continue
		}
		for _, block := range body.Blocks {
			at := rel + ":" + strconv.Itoa(block.TypeRange.Start.Line)
			switch block.Type {
			case "resource":
				if len(block.Labels) != 2 {
					continue
				}
				r := &resource{Type: block.Labels[0], Label: block.Labels[1], Body: block.Body, Source: at, scope: s}
				s.resources[r.Type+"."+r.Label] = r
				s.order = append(s.order, r)
			case "variable":
				if len(block.Labels) == 1 {
					if attr, ok := block.Body.Attributes["default"]; ok {
						s.variables[block.Labels[0]] = attr.Expr
					} else {
						s.variables[block.Labels[0]] = nil
					}
				}
			case "locals":
				for name, attr := range block.Body.Attributes {
					s.locals[name] = attr.Expr
				}
			case "output":
				if len(block.Labels) == 1 {
					if attr, ok := block.Body.Attributes["value"]; ok {
						s.outputs[block.Labels[0]] = attr.Expr
					}
				}
			case "module":
				if len(block.Labels) != 1 {
					continue
				}
				call := moduleCall{name: block.Labels[0], body: block.Body, at: at}
				if attr, ok := block.Body.Attributes["source"]; ok {
					call.source, _ = s.stringOf(attr.Expr, nil)
				}
				if known, _ := knownSource(call.source); known != nil {
					r := &resource{Type: known.kind, Label: call.name, Body: block.Body, Source: at, scope: s, module: known}
					// The queue module makes a dead-letter queue beside its
					// queue when told to; it exists from here so that a
					// reference to it from any file finds it, and is named
					// once the queue's own name is known.
					if known.kind == typeQueue {
						if makeDLQ, _ := s.boolOf(attr(block.Body, "create_dlq")); makeDLQ {
							r.derived = map[string]*resource{"dlq": {Type: typeQueue, Label: "dlq", Source: at, scope: s, parent: r}}
						}
					}
					s.resources["module."+call.name] = r
					s.order = append(s.order, r)
					continue
				}
				calls = append(calls, call)
			}
		}
	}

	for _, call := range calls {
		if !strings.HasPrefix(call.source, "./") && !strings.HasPrefix(call.source, "../") {
			b.Warn(call.at, "module \""+call.name+"\" comes from "+orUnknown(call.source)+", which is not in this tree, and is not read")
			continue
		}
		childDir := filepath.ToSlash(filepath.Clean(filepath.Join(dir, call.source)))
		if strings.HasPrefix(childDir, "..") {
			b.Warn(call.at, "module \""+call.name+"\" comes from "+call.source+", which is outside the input root, and is not read")
			continue
		}
		if visiting[childDir] {
			b.Warn(call.at, "module \""+call.name+"\" calls "+call.source+", which is already being read on this path, and is not read again")
			continue
		}
		if _, err := os.Stat(filepath.Join(t.root, childDir)); err != nil {
			b.Warn(call.at, "module \""+call.name+"\" comes from "+call.source+", which is not in this tree, and is not read")
			continue
		}
		args := map[string]hclsyntax.Expression{}
		for name, attr := range call.body.Attributes {
			args[name] = attr.Expr
		}
		visiting[childDir] = true
		child, err := t.readScope(parser, childDir, prefix+"module."+call.name+".", s, args, visiting, b)
		delete(visiting, childDir)
		if err != nil {
			return nil, err
		}
		s.children[call.name] = child
	}
	return s, nil
}

func orUnknown(value string) string {
	if value == "" {
		return "a source this reader could not resolve"
	}
	return value
}

// attr is the expression an attribute of a body is set to, or nil.
func attr(body *hclsyntax.Body, name string) hclsyntax.Expression {
	if body == nil {
		return nil
	}
	if a, ok := body.Attributes[name]; ok {
		return a.Expr
	}
	return nil
}

// blocks are the nested blocks of a body with the given type, in order.
func blocks(body *hclsyntax.Body, kind string) []*hclsyntax.Block {
	var out []*hclsyntax.Block
	for _, block := range body.Blocks {
		if block.Type == kind {
			out = append(out, block)
		}
	}
	return out
}

// line is where an expression starts, for a warning.
func line(rel string, expr hclsyntax.Expression) string {
	return rel[:strings.LastIndex(rel, ":")] + ":" + strconv.Itoa(expr.Range().Start.Line)
}

// visit is every node of an expression tree.
type visit map[string]bool

// stringOf is what an expression is worth as a string, followed through
// templates, format(), variables, locals, module arguments and outputs, and
// the string attributes of other resources. The second result says whether it
// got there.
func (s *scope) stringOf(expr hclsyntax.Expression, seen visit) (string, bool) {
	if seen == nil {
		seen = visit{}
	}
	switch value := expr.(type) {
	case nil:
		return "", false
	case *hclsyntax.LiteralValueExpr:
		return literalString(value.Val)
	case *hclsyntax.TemplateWrapExpr:
		return s.stringOf(value.Wrapped, seen)
	case *hclsyntax.ParenthesesExpr:
		return s.stringOf(value.Expression, seen)
	case *hclsyntax.TemplateExpr:
		var out strings.Builder
		for _, part := range value.Parts {
			piece, ok := s.stringOf(part, seen)
			if !ok {
				return "", false
			}
			out.WriteString(piece)
		}
		return out.String(), true
	case *hclsyntax.FunctionCallExpr:
		if value.Name == "format" && len(value.Args) >= 1 {
			pattern, ok := s.stringOf(value.Args[0], seen)
			if !ok {
				return "", false
			}
			var out strings.Builder
			next := 1
			for i := 0; i < len(pattern); i++ {
				if pattern[i] == '%' && i+1 < len(pattern) {
					switch pattern[i+1] {
					case '%':
						out.WriteByte('%')
						i++
						continue
					case 's', 'd', 'v':
						if next >= len(value.Args) {
							return "", false
						}
						piece, ok := s.stringOf(value.Args[next], seen)
						if !ok {
							return "", false
						}
						out.WriteString(piece)
						next++
						i++
						continue
					}
				}
				out.WriteByte(pattern[i])
			}
			return out.String(), true
		}
		if (value.Name == "lower" || value.Name == "upper") && len(value.Args) == 1 {
			piece, ok := s.stringOf(value.Args[0], seen)
			if !ok {
				return "", false
			}
			if value.Name == "lower" {
				return strings.ToLower(piece), true
			}
			return strings.ToUpper(piece), true
		}
		return "", false
	case *hclsyntax.ScopeTraversalExpr:
		return s.traversalString(value.Traversal, seen)
	}
	return "", false
}

func literalString(val cty.Value) (string, bool) {
	if val.IsNull() || !val.IsKnown() {
		return "", false
	}
	switch val.Type() {
	case cty.String:
		return val.AsString(), true
	case cty.Number:
		return val.AsBigFloat().Text('f', -1), true
	case cty.Bool:
		return strconv.FormatBool(val.True()), true
	}
	return "", false
}

// traversalString follows var.x, local.x, module.x.y and <type>.<label>.<attr>
// to a string, each through the scope that owns it.
func (s *scope) traversalString(t hcl.Traversal, seen visit) (string, bool) {
	parts := attrNames(t)
	if len(parts) < 2 {
		return "", false
	}
	key := s.prefix + strings.Join(parts, ".")
	if seen[key] {
		return "", false
	}
	seen[key] = true
	defer delete(seen, key)

	switch parts[0] {
	case "var":
		if s.callArgs != nil {
			if given, ok := s.callArgs[parts[1]]; ok && s.parent != nil {
				return s.parent.stringOf(given, seen)
			}
		}
		if def, ok := s.variables[parts[1]]; ok && def != nil {
			return s.stringOf(def, seen)
		}
		return "", false
	case "local":
		if value, ok := s.locals[parts[1]]; ok {
			return s.stringOf(value, seen)
		}
		return "", false
	case "module":
		if len(parts) < 3 {
			return "", false
		}
		if r, ok := s.resources["module."+parts[1]]; ok {
			target, name := r.output(parts[2])
			if target == nil {
				return "", false
			}
			return s.stringOf(target.attr(name), seen)
		}
		child, ok := s.children[parts[1]]
		if !ok {
			return "", false
		}
		if value, ok := child.outputs[parts[2]]; ok {
			return child.stringOf(value, seen)
		}
		return "", false
	case "data", "path", "terraform", "each", "count":
		return "", false
	}
	if len(parts) < 3 {
		return "", false
	}
	r, ok := s.resources[parts[0]+"."+parts[1]]
	if !ok {
		return "", false
	}
	return s.stringOf(attr(r.Body, parts[2]), seen)
}

// attrNames flattens a traversal to its dotted names; an index step ends it.
func attrNames(t hcl.Traversal) []string {
	var out []string
	for _, step := range t {
		switch step := step.(type) {
		case hcl.TraverseRoot:
			out = append(out, step.Name)
		case hcl.TraverseAttr:
			out = append(out, step.Name)
		default:
			return out
		}
	}
	return out
}

// refsOf is every resource an expression reaches, in source order of the
// traversals, followed through locals, module arguments and outputs. A
// traversal into a resource's own attribute (aws_sqs_queue.dlq.arn) is the
// resource; the attribute name comes back with it because a table's
// stream_arn is not the table.
type ref struct {
	target *resource
	attr   string
}

func (s *scope) refsOf(expr hclsyntax.Expression, seen visit) []ref {
	if expr == nil {
		return nil
	}
	if seen == nil {
		seen = visit{}
	}
	var out []ref
	_ = hclsyntax.VisitAll(expr, func(node hclsyntax.Node) hcl.Diagnostics {
		traversal, ok := node.(*hclsyntax.ScopeTraversalExpr)
		if !ok {
			return nil
		}
		out = append(out, s.traversalRefs(traversal.Traversal, seen)...)
		return nil
	})
	return out
}

func (s *scope) traversalRefs(t hcl.Traversal, seen visit) []ref {
	parts := attrNames(t)
	if len(parts) < 2 {
		return nil
	}
	key := s.prefix + strings.Join(parts, ".")
	if seen[key] {
		return nil
	}
	seen[key] = true
	defer delete(seen, key)

	switch parts[0] {
	case "var":
		if s.callArgs != nil {
			if given, ok := s.callArgs[parts[1]]; ok && s.parent != nil {
				return s.parent.refsOf(given, seen)
			}
		}
		if def, ok := s.variables[parts[1]]; ok && def != nil {
			return s.refsOf(def, seen)
		}
		return nil
	case "local":
		return s.refsOf(s.locals[parts[1]], seen)
	case "module":
		if len(parts) < 3 {
			return nil
		}
		if r, ok := s.resources["module."+parts[1]]; ok {
			target, name := r.output(parts[2])
			if target == nil {
				return nil
			}
			return []ref{{target: target, attr: name}}
		}
		if child, ok := s.children[parts[1]]; ok {
			return child.refsOf(child.outputs[parts[2]], seen)
		}
		return nil
	case "data", "path", "terraform", "each", "count":
		return nil
	}
	r, ok := s.resources[parts[0]+"."+parts[1]]
	if !ok {
		return nil
	}
	name := ""
	if len(parts) > 2 {
		name = parts[2]
	}
	return []ref{{target: r, attr: name}}
}

// shapeOf is what an expression is worth as a string when parts of it are
// decided at apply time: the literal parts as written, and each piece nothing
// here resolves as its name in braces - `orders-{account_id}`, `uploads-{suffix}`.
// The braces are the same convention the Redis keyspaces use for a dynamic
// piece of a key. The placeholders come back with the text, so the caller
// knows whether anything was left open, and what.
func (s *scope) shapeOf(expr hclsyntax.Expression, seen visit) (string, []string) {
	if seen == nil {
		seen = visit{}
	}
	if value, ok := s.stringOf(expr, seen); ok {
		return value, nil
	}
	switch value := expr.(type) {
	case nil:
		return "", nil
	case *hclsyntax.TemplateWrapExpr:
		return s.shapeOf(value.Wrapped, seen)
	case *hclsyntax.ParenthesesExpr:
		return s.shapeOf(value.Expression, seen)
	case *hclsyntax.TemplateExpr:
		var out strings.Builder
		var open []string
		for _, part := range value.Parts {
			text, holes := s.shapeOf(part, seen)
			out.WriteString(text)
			open = append(open, holes...)
		}
		return out.String(), open
	case *hclsyntax.FunctionCallExpr:
		switch value.Name {
		case "lower", "upper":
			if len(value.Args) == 1 {
				text, holes := s.shapeOf(value.Args[0], seen)
				if value.Name == "lower" {
					return strings.ToLower(text), holes
				}
				return strings.ToUpper(text), holes
			}
		case "format":
			if len(value.Args) >= 1 {
				pattern, holes := s.shapeOf(value.Args[0], seen)
				var out strings.Builder
				next := 1
				for i := 0; i < len(pattern); i++ {
					if pattern[i] == '%' && i+1 < len(pattern) {
						switch pattern[i+1] {
						case '%':
							out.WriteByte('%')
							i++
							continue
						case 's', 'd', 'v':
							if next < len(value.Args) {
								text, more := s.shapeOf(value.Args[next], seen)
								out.WriteString(text)
								holes = append(holes, more...)
								next++
							}
							i++
							continue
						}
					}
					out.WriteByte(pattern[i])
				}
				return out.String(), holes
			}
		}
		hole := "{" + value.Name + "()}"
		return hole, []string{hole}
	case *hclsyntax.ScopeTraversalExpr:
		return s.traversalShape(value.Traversal, seen)
	}
	return "{?}", []string{"{?}"}
}

// traversalShape follows a traversal like traversalString does and, where
// that runs out, names the hole: a variable or local by its name, a data
// source or another resource's attribute by the attribute, a resource of the
// random provider by its label.
func (s *scope) traversalShape(t hcl.Traversal, seen visit) (string, []string) {
	parts := attrNames(t)
	if len(parts) < 2 {
		return "{?}", []string{"{?}"}
	}
	key := s.prefix + strings.Join(parts, ".")
	if !seen[key] {
		seen[key] = true
		defer delete(seen, key)
		switch parts[0] {
		case "var":
			if s.callArgs != nil {
				if given, ok := s.callArgs[parts[1]]; ok && s.parent != nil {
					return s.parent.shapeOf(given, seen)
				}
			}
			if def, ok := s.variables[parts[1]]; ok && def != nil {
				return s.shapeOf(def, seen)
			}
		case "local":
			if value, ok := s.locals[parts[1]]; ok {
				return s.shapeOf(value, seen)
			}
		case "module":
			if len(parts) >= 3 {
				if r, ok := s.resources["module."+parts[1]]; ok {
					if target, name := r.output(parts[2]); target != nil {
						if value := target.attr(name); value != nil {
							return s.shapeOf(value, seen)
						}
					}
				}
				if child, ok := s.children[parts[1]]; ok {
					if value, ok := child.outputs[parts[2]]; ok {
						return child.shapeOf(value, seen)
					}
				}
			}
		}
	}
	hole := "{" + parts[len(parts)-1] + "}"
	switch parts[0] {
	case "var", "local":
		hole = "{" + parts[1] + "}"
	case "module":
		if len(parts) >= 3 {
			hole = "{" + parts[1] + "." + parts[2] + "}"
		}
	default:
		if strings.HasPrefix(parts[0], "random_") {
			hole = "{" + parts[1] + "}"
		}
	}
	return hole, []string{hole}
}

// boolOf is a literal true or false, or a variable or local worth one.
func (s *scope) boolOf(expr hclsyntax.Expression) (bool, bool) {
	value, ok := s.stringOf(expr, nil)
	if !ok {
		return false, false
	}
	switch value {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	return false, false
}

// objectItem is the value under a key of an object expression, looked for
// through jsonencode() and parentheses, and - for a policy written as a JSON
// string - through the template that spells it.
func (s *scope) objectItem(expr hclsyntax.Expression, key string) hclsyntax.Expression {
	switch value := expr.(type) {
	case *hclsyntax.FunctionCallExpr:
		if value.Name == "jsonencode" && len(value.Args) == 1 {
			return s.objectItem(value.Args[0], key)
		}
	case *hclsyntax.ParenthesesExpr:
		return s.objectItem(value.Expression, key)
	case *hclsyntax.ObjectConsExpr:
		for _, item := range value.Items {
			name := hcl.ExprAsKeyword(item.KeyExpr)
			if name == "" {
				if wrapped, ok := item.KeyExpr.(*hclsyntax.ObjectConsKeyExpr); ok {
					name, _ = s.stringOf(wrapped.Wrapped, nil)
				}
			}
			if name == key {
				return item.ValueExpr
			}
		}
	}
	return nil
}

// jsonNumber reads "<key>": <digits> out of a policy written as a JSON
// string, which is how older modules spell a redrive policy.
func jsonNumber(text, key string) string {
	at := strings.Index(text, "\""+key+"\"")
	if at < 0 {
		return ""
	}
	rest := strings.TrimLeft(text[at+len(key)+2:], " \t\r\n")
	if !strings.HasPrefix(rest, ":") {
		return ""
	}
	rest = strings.TrimLeft(rest[1:], " \t\r\n")
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	return rest[:end]
}

// output is what a registry module's output stands for: the resource it is
// an attribute of - the module itself, or something it made beside itself -
// and the attribute's name. An output the table does not list is taken as
// an attribute of that name, so `module.x.arn` still reaches x.
func (r *resource) output(name string) (*resource, string) {
	if r.module == nil {
		return nil, ""
	}
	mapped, ok := r.module.outputs[name]
	if !ok {
		mapped = name
	}
	if at := strings.Index(mapped, ":"); at >= 0 {
		derived := r.derived[mapped[:at]]
		if derived == nil {
			return nil, ""
		}
		return derived, mapped[at+1:]
	}
	return r, mapped
}
