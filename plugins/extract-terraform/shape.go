package extractterraform

import (
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

// A resource block and a registry module block spell the same facts two
// ways: `attribute { name = "id" }` in the one is `attributes = [{ name =
// "id" }]` in the other, `environment { variables = {...} }` is
// `environment_variables = {...}`. The readers ask through these, and the
// module's rename table answers which spelling to look for.

// attr is the expression the resource sets the attribute to, under the
// resource's own name for it, or nil.
func (r *resource) attr(name string) hclsyntax.Expression {
	return attr(r.Body, r.input(name))
}

// input is the name the block spells an attribute or nested block under.
func (r *resource) input(name string) string {
	if r.module != nil {
		if renamed, ok := r.module.inputs[name]; ok {
			return renamed
		}
	}
	return name
}

// nested is one entry of a repeated nested shape: a block of a resource,
// or one element of the list or map a module takes instead.
type nested struct {
	r    *resource
	body *hclsyntax.Body
	obj  *hclsyntax.ObjectConsExpr
	// key is the map key the element sat under, for a module input written
	// as a map; empty for a list element or a block.
	key string
}

func (n nested) attr(name string) hclsyntax.Expression {
	if n.body != nil {
		return attr(n.body, n.r.input(name))
	}
	if n.obj != nil {
		return n.r.scope.objectItem(n.obj, n.r.input(name))
	}
	return nil
}

// nested is every entry of a nested shape, in source order: the blocks of
// that type on a resource, or the elements of the module input that stands
// for them - a tuple of objects, or an object of objects keyed by name.
func (r *resource) nested(name string) []nested {
	if r.Body == nil {
		return nil
	}
	if r.module == nil {
		var out []nested
		for _, block := range blocks(r.Body, name) {
			out = append(out, nested{r: r, body: block.Body})
		}
		return out
	}
	return objectsOf(r, attr(r.Body, r.input(name)))
}

// objectsOf is the objects an expression holds: the elements of a tuple, or
// the values of an object, each an object itself.
func objectsOf(r *resource, expr hclsyntax.Expression) []nested {
	var out []nested
	switch value := expr.(type) {
	case *hclsyntax.TupleConsExpr:
		for _, item := range value.Exprs {
			if obj, ok := item.(*hclsyntax.ObjectConsExpr); ok {
				out = append(out, nested{r: r, obj: obj})
			}
		}
	case *hclsyntax.ObjectConsExpr:
		for _, item := range value.Items {
			if obj, ok := item.ValueExpr.(*hclsyntax.ObjectConsExpr); ok {
				out = append(out, nested{r: r, obj: obj, key: keyOf(r.scope, item.KeyExpr)})
			}
		}
	}
	return out
}

// env is the object of environment variables a function is configured
// with: the `variables` of its `environment` block, or the module's
// `environment_variables` input.
func (r *resource) env() *hclsyntax.ObjectConsExpr {
	if r.module != nil {
		obj, _ := attr(r.Body, r.input("environment")).(*hclsyntax.ObjectConsExpr)
		return obj
	}
	for _, env := range blocks(r.Body, "environment") {
		if obj, ok := attr(env.Body, "variables").(*hclsyntax.ObjectConsExpr); ok {
			return obj
		}
	}
	return nil
}
