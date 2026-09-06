package gohttp

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/tools/go/callgraph"
	"golang.org/x/tools/go/callgraph/vta"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"
)

const typedAnalysisTimeout = 45 * time.Second

// indexTypedCallEdges augments the syntax call graph with dynamic calls proven
// by Go type information. Failure is deliberately non-fatal: repositories with
// unavailable private modules, incomplete build tags, or type errors continue
// to use the deterministic syntax analyzer.
func (s *scanner) indexTypedCallEdges() bool {
	ctx, cancel := context.WithTimeout(context.Background(), typedAnalysisTimeout)
	defer cancel()

	loaded, err := packages.Load(&packages.Config{
		Context:    ctx,
		Dir:        s.root,
		Mode:       packages.LoadSyntax,
		Tests:      false,
		BuildFlags: []string{"-mod=readonly"},
	}, "./...")
	if err != nil {
		s.typedCallGraphError = err.Error()
		return false
	}
	if err := typedPackageError(loaded); err != nil {
		s.typedCallGraphError = err.Error()
		return false
	}

	program, _ := ssautil.Packages(loaded, ssa.InstantiateGenerics)
	program.Build()
	functions := ssautil.AllFunctions(program)
	if len(functions) == 0 {
		s.typedCallGraphError = "SSA program contains no source functions"
		return false
	}

	positions := s.functionKeysByPosition()
	graph := vta.CallGraph(functions, nil)
	edges := map[string][]localEdge{}
	err = callgraph.GraphVisitEdges(graph, func(edge *callgraph.Edge) error {
		caller := s.typedFunctionKey(program, edge.Caller.Func, positions)
		callee := s.typedFunctionKey(program, edge.Callee.Func, positions)
		if caller == "" || callee == "" || caller == callee {
			return nil
		}
		position := program.Fset.Position(edge.Pos())
		edges[caller] = append(edges[caller], localEdge{target: callee, line: position.Line})
		return nil
	})
	if err != nil {
		s.typedCallGraphError = err.Error()
		return false
	}

	for caller, outgoing := range edges {
		sort.Slice(outgoing, func(i, j int) bool {
			if outgoing[i].line != outgoing[j].line {
				return outgoing[i].line < outgoing[j].line
			}
			return outgoing[i].target < outgoing[j].target
		})
		seen := map[string]bool{}
		for _, edge := range outgoing {
			key := strconv.Itoa(edge.line) + "\x00" + edge.target
			if !seen[key] {
				s.typedEdges[caller] = append(s.typedEdges[caller], edge)
				seen[key] = true
			}
		}
	}
	return len(s.typedEdges) > 0
}

func typedPackageError(loaded []*packages.Package) error {
	for _, pkg := range loaded {
		if len(pkg.Errors) > 0 {
			return fmt.Errorf("%s: %s", pkg.PkgPath, pkg.Errors[0].Msg)
		}
		if pkg.IllTyped {
			return fmt.Errorf("%s: package is ill-typed", pkg.PkgPath)
		}
	}
	return nil
}

func (s *scanner) functionKeysByPosition() map[string][]string {
	out := map[string][]string{}
	for key, declaration := range s.functions {
		position := s.fset.Position(declaration.fn.Name.Pos())
		location := s.relativePosition(position.Filename, position.Line)
		if location != "" {
			out[location] = append(out[location], key)
		}
	}
	for location := range out {
		sort.Strings(out[location])
	}
	return out
}

func (s *scanner) typedFunctionKey(program *ssa.Program, function *ssa.Function, positions map[string][]string) string {
	for candidate := function; candidate != nil; candidate = candidate.Parent() {
		position := program.Fset.Position(candidate.Pos())
		keys := positions[s.relativePosition(position.Filename, position.Line)]
		if len(keys) == 1 {
			return keys[0]
		}
		for _, key := range keys {
			display := displayFunction(key)
			if display == candidate.Name() || strings.HasSuffix(display, "."+candidate.Name()) {
				return key
			}
		}
	}
	return ""
}

func (s *scanner) relativePosition(filename string, line int) string {
	if filename == "" || line == 0 {
		return ""
	}
	relative, err := filepath.Rel(s.root, filename)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return ""
	}
	return filepath.ToSlash(relative) + ":" + strconv.Itoa(line)
}
