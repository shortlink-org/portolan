// Package gocall supplies source-backed, typed call facts to native Go
// extractors. It has no knowledge of HTTP, domain layouts or catalog lanes.
package gocall

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/callgraph"
	"golang.org/x/tools/go/callgraph/vta"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"
)

// Position is relative to the analysis root. Column distinguishes call sites
// on the same line. Empty File means a declaration outside the source root.
type Position struct {
	File   string
	Line   int
	Column int
}

type Definition struct {
	Name     string
	Position Position
}

// Function retains lexical parents so a consumer may map a closure to its
// enclosing declaration without making that policy part of the shared graph.
type Function struct {
	ID          string
	Definitions []Definition
}

type Kind string

const (
	Static   Kind = "static"
	Possible Kind = "possible"
)

// Edge records a static target or a VTA candidate. A Possible edge is not
// evidence that the target executes in a particular runtime scenario.
type Edge struct {
	Caller Function
	Callee Function
	Site   Position
	Kind   Kind
}

type Diagnostic struct {
	Package string
	Message string
}

func (d Diagnostic) String() string { return d.Package + ": " + d.Message }

type Result struct {
	Edges       []Edge
	Diagnostics []Diagnostic
	// Complete is false when package errors forced a partial graph.
	Complete bool
}

type Options struct {
	Root       string
	Patterns   []string
	BuildFlags []string
}

// Analyze respects the caller's deadline while loading packages. Native
// consumers also bound the whole process, since SSA/VTA do not accept a context.
// Broken packages and their dependents are excluded; independent packages
// still contribute facts, accompanied by diagnostics.
func Analyze(ctx context.Context, opts Options) (Result, error) {
	root, err := filepath.Abs(opts.Root)
	if err != nil {
		return Result{}, err
	}
	patterns := opts.Patterns
	if len(patterns) == 0 {
		patterns = []string{"./..."}
	}
	flags := append([]string{"-mod=readonly"}, opts.BuildFlags...)
	loaded, err := packages.Load(&packages.Config{
		Context: ctx, Dir: root, Mode: packages.LoadSyntax, Tests: false, BuildFlags: flags,
	}, patterns...)
	if err != nil {
		return Result{}, err
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	result := Result{Complete: true}
	var usable []*packages.Package
	for _, pkg := range loaded {
		if len(pkg.Errors) > 0 || pkg.IllTyped {
			result.Complete = false
			if len(pkg.Errors) == 0 {
				result.Diagnostics = append(result.Diagnostics, Diagnostic{pkg.PkgPath, "package is ill-typed"})
			}
			for _, problem := range pkg.Errors {
				result.Diagnostics = append(result.Diagnostics, Diagnostic{pkg.PkgPath, problem.Error()})
			}
			continue
		}
		usable = append(usable, pkg)
	}
	sort.Slice(result.Diagnostics, func(i, j int) bool { return result.Diagnostics[i].String() < result.Diagnostics[j].String() })
	if len(usable) == 0 {
		if len(result.Diagnostics) > 0 {
			return result, fmt.Errorf("no usable Go packages: %s", result.Diagnostics[0].String())
		}
		return result, fmt.Errorf("no Go packages found")
	}
	program, _ := ssautil.Packages(usable, ssa.InstantiateGenerics)
	program.Build()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	functions := ssautil.AllFunctions(program)
	if len(functions) == 0 {
		return result, fmt.Errorf("SSA program contains no source functions")
	}
	position := func(filename string, line, column int) Position {
		rel, err := filepath.Rel(root, filename)
		if filename == "" || line == 0 || err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return Position{}
		}
		return Position{filepath.ToSlash(rel), line, column}
	}
	function := func(fn *ssa.Function) Function {
		out := Function{ID: fn.String()}
		for candidate := fn; candidate != nil; candidate = candidate.Parent() {
			pos := program.Fset.Position(candidate.Pos())
			if at := position(pos.Filename, pos.Line, pos.Column); at.File != "" {
				out.Definitions = append(out.Definitions, Definition{candidate.Name(), at})
			}
		}
		return out
	}
	graph := vta.CallGraph(functions, nil)
	seen := map[string]bool{}
	err = callgraph.GraphVisitEdges(graph, func(edge *callgraph.Edge) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		caller, callee := function(edge.Caller.Func), function(edge.Callee.Func)
		if len(caller.Definitions) == 0 || len(callee.Definitions) == 0 {
			return nil
		}
		pos := program.Fset.Position(edge.Pos())
		site := position(pos.Filename, pos.Line, pos.Column)
		kind := Possible
		if edge.Site != nil && edge.Site.Common().StaticCallee() != nil {
			kind = Static
		}
		key := fmt.Sprintf("%s\x00%d:%d\x00%s\x00%s", site.File, site.Line, site.Column, caller.ID, callee.ID)
		if !seen[key] {
			seen[key] = true
			result.Edges = append(result.Edges, Edge{caller, callee, site, kind})
		}
		return nil
	})
	if err != nil {
		return result, err
	}
	sort.Slice(result.Edges, func(i, j int) bool {
		a, b := result.Edges[i], result.Edges[j]
		if a.Site.File != b.Site.File {
			return a.Site.File < b.Site.File
		}
		if a.Site.Line != b.Site.Line {
			return a.Site.Line < b.Site.Line
		}
		if a.Site.Column != b.Site.Column {
			return a.Site.Column < b.Site.Column
		}
		if a.Caller.ID != b.Caller.ID {
			return a.Caller.ID < b.Caller.ID
		}
		return a.Callee.ID < b.Callee.ID
	})
	return result, nil
}
