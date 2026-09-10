package gohttp

import (
	"context"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shortlink-org/portolan/internal/gocall"
)

const typedAnalysisTimeout = 45 * time.Second

// indexTypedCallEdges adapts shared typed facts to the HTTP syntax index.
// Dynamic edges are possible callees, not proof of runtime execution.
func (s *scanner) indexTypedCallEdges() bool {
	ctx, cancel := context.WithTimeout(context.Background(), typedAnalysisTimeout)
	defer cancel()
	result, err := gocall.Analyze(ctx, gocall.Options{Root: s.root})
	if err != nil {
		s.typedCallGraphError = err.Error()
		return false
	}
	for _, diagnostic := range result.Diagnostics {
		s.warnings = append(s.warnings, "typed call graph is partial: "+diagnostic.String())
	}
	positions := s.functionKeysByPosition()
	seen := map[string]bool{}
	for _, edge := range result.Edges {
		caller := s.typedFunctionKey(edge.Caller, positions)
		callee := s.typedFunctionKey(edge.Callee, positions)
		if caller == "" || callee == "" || caller == callee {
			continue
		}
		key := caller + "\x00" + strconv.Itoa(edge.Site.Line) + "\x00" + callee
		if !seen[key] {
			seen[key] = true
			s.typedEdges[caller] = append(s.typedEdges[caller], localEdge{target: callee, line: edge.Site.Line})
		}
	}
	for caller := range s.typedEdges {
		sort.Slice(s.typedEdges[caller], func(i, j int) bool {
			a, b := s.typedEdges[caller][i], s.typedEdges[caller][j]
			if a.line != b.line {
				return a.line < b.line
			}
			return a.target < b.target
		})
	}
	return len(s.typedEdges) > 0
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

func (s *scanner) typedFunctionKey(function gocall.Function, positions map[string][]string) string {
	for _, definition := range function.Definitions {
		pos := definition.Position
		keys := positions[pos.File+":"+strconv.Itoa(pos.Line)]
		if len(keys) == 1 {
			return keys[0]
		}
		for _, key := range keys {
			display := displayFunction(key)
			if display == definition.Name || strings.HasSuffix(display, "."+definition.Name) {
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
