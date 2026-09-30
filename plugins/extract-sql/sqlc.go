package extractsql

import (
	"go/ast"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// sqlc: every query is a named statement, and the generated package has one
// method per name.
//
//	const getOrder = `-- name: GetOrder :one
//	SELECT id, state FROM orders WHERE id = $1`
//
// The statement says which tables; the repository that calls q.GetOrder says
// who. Each call is credited to the calling method, and a query nothing in
// the tree calls is credited to the generated method itself. When the
// generated code is not committed, sqlc.yaml says where the queries are and
// which package they will be generated into.

type sqlcQuery struct {
	name string
	sql  string
	// method and source are the fallback credit: the generated method and
	// where it runs the statement, or the query file when there is no code.
	method string
	source string
	called bool
}

var sqlcName = regexp.MustCompile(`^\s*--\s*name:\s*(\w+)\s+:\w+`)

// readSqlcQueries collects the queries by the import path of the package
// that has, or will have, the generated methods.
func (p *libraryPass) readSqlcQueries() map[string]map[string]*sqlcQuery {
	out := map[string]map[string]*sqlcQuery{}
	for _, file := range p.idx.Files {
		for _, decl := range file.Node.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, raw := range gen.Specs {
				spec := raw.(*ast.ValueSpec)
				for i, name := range spec.Names {
					if i >= len(spec.Values) {
						break
					}
					lit, ok := spec.Values[i].(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						continue
					}
					sql := unquote(lit.Value)
					match := sqlcName.FindStringSubmatch(sql)
					if match == nil {
						continue
					}
					if out[file.Pkg] == nil {
						out[file.Pkg] = map[string]*sqlcQuery{}
					}
					query := &sqlcQuery{name: match[1], sql: sql, method: "Queries." + match[1], source: p.rootSource(file.Name, p.idx.Fset.Position(lit.Pos()).Line)}
					p.sqlcRunner(file.Pkg, name.Name, query)
					out[file.Pkg][match[1]] = query
				}
			}
		}
	}
	for pkg, queries := range p.sqlcConfigQueries() {
		if out[pkg] != nil {
			// The generated code is here and says the same, more precisely.
			continue
		}
		out[pkg] = queries
	}
	return out
}

// sqlcRunner finds the generated method that runs a query's constant, which
// is where the raw reader would place it too.
func (p *libraryPass) sqlcRunner(pkg, constant string, query *sqlcQuery) {
	for _, file := range p.idx.Files {
		if file.Pkg != pkg {
			continue
		}
		for _, decl := range file.Node.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil || fn.Name.Name != query.name {
				continue
			}
			var at *ast.CallExpr
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok || at != nil {
					return at == nil
				}
				for _, arg := range call.Args {
					if ident, ok := arg.(*ast.Ident); ok && ident.Name == constant {
						at = call
						return false
					}
				}
				return true
			})
			query.method = sqlMethodName(fn)
			if at != nil {
				query.source = p.rootSource(file.Name, p.idx.Fset.Position(at.Pos()).Line)
			}
			return
		}
	}
}

func (p *libraryPass) rootSource(name string, line int) string {
	return filepath.ToSlash(filepath.Join(p.root, filepath.FromSlash(name))) + ":" + itoa(line)
}

// sqlcCall credits a call of a generated query method to its caller.
func (s *site) sqlcCall(call *ast.CallExpr) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || s.packageName(sel.X) != "" {
		return
	}
	key := s.typeOf(sel.X)
	for _, pkg := range sortedKeys(s.p.sqlc) {
		query := s.p.sqlc[pkg][sel.Sel.Name]
		if query == nil {
			continue
		}
		switch {
		case strings.HasPrefix(key, pkg+"."):
		case key == "" && s.imports(pkg):
		default:
			continue
		}
		if s.file.Pkg == pkg && strings.HasPrefix(s.fn.Key, pkg+".Queries.") {
			// The generated method itself.
			continue
		}
		query.called = true
		s.emitSQL(call, query.sql, librarySqlc)
	}
}

func (s *site) imports(pkg string) bool {
	for _, imported := range s.file.Imports {
		if imported == pkg {
			return true
		}
	}
	return false
}

// uncalledSqlcQueries credits a query no code here calls to the method sqlc
// generated for it: the tables are still touched by this service's package.
func (p *libraryPass) uncalledSqlcQueries() {
	for _, pkg := range sortedKeys(p.sqlc) {
		for _, name := range sortedKeys(p.sqlc[pkg]) {
			query := p.sqlc[pkg][name]
			if query.called {
				continue
			}
			for _, found := range sqlTableAccesses(query.sql, "", query.source) {
				p.emit([]string{query.method}, query.source, found.table, found.access.Operation, librarySqlc, false)
			}
		}
	}
}

// sqlcConfig is the part of sqlc.yaml (version 1 or 2) that says where the
// queries are and which package they are generated into.
type sqlcConfig struct {
	SQL []struct {
		Queries sqlcPaths `yaml:"queries"`
		Gen     struct {
			Go struct {
				Out string `yaml:"out"`
			} `yaml:"go"`
		} `yaml:"gen"`
	} `yaml:"sql"`
	Packages []struct {
		Path    string    `yaml:"path"`
		Queries sqlcPaths `yaml:"queries"`
	} `yaml:"packages"`
}

// sqlcPaths is a path or a list of them.
type sqlcPaths []string

func (s *sqlcPaths) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind == yaml.ScalarNode {
		*s = []string{node.Value}
		return nil
	}
	var list []string
	if err := node.Decode(&list); err != nil {
		return err
	}
	*s = list
	return nil
}

// sqlcConfigFiles is every sqlc.yaml of the module, nested modules and
// vendored code left out.
func sqlcConfigFiles(root string) []string {
	var configs []string
	_ = filepath.WalkDir(root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if name == root {
				return nil
			}
			switch entry.Name() {
			case "vendor", "node_modules", "testdata":
				return filepath.SkipDir
			}
			if strings.HasPrefix(entry.Name(), ".") {
				return filepath.SkipDir
			}
			if _, err := os.Stat(filepath.Join(name, "go.mod")); err == nil {
				return filepath.SkipDir
			}
			return nil
		}
		switch entry.Name() {
		case "sqlc.yaml", "sqlc.yml", "sqlc.json":
			configs = append(configs, name)
		}
		return nil
	})
	sort.Strings(configs)
	return configs
}

// sqlcConfigQueries reads the queries every sqlc.yaml points at.
func (p *libraryPass) sqlcConfigQueries() map[string]map[string]*sqlcQuery {
	out := map[string]map[string]*sqlcQuery{}
	for _, config := range p.sqlcConfigs {
		data, err := os.ReadFile(config)
		if err != nil {
			continue
		}
		var parsed sqlcConfig
		if err := yaml.Unmarshal(data, &parsed); err != nil {
			p.warn("sqlc: " + p.relative(config) + " could not be read: " + err.Error())
			continue
		}
		base := filepath.Dir(config)
		add := func(out_ string, queries []string) {
			if out_ == "" {
				return
			}
			pkg := p.idx.PackagePath(filepath.Join(base, filepath.FromSlash(out_)))
			for _, query := range queries {
				for _, found := range p.readSqlcFiles(filepath.Join(base, filepath.FromSlash(query))) {
					if out[pkg] == nil {
						out[pkg] = map[string]*sqlcQuery{}
					}
					out[pkg][found.name] = found
				}
			}
		}
		for _, entry := range parsed.SQL {
			add(entry.Gen.Go.Out, entry.Queries)
		}
		for _, entry := range parsed.Packages {
			add(entry.Path, entry.Queries)
		}
	}
	return out
}

func (p *libraryPass) relative(name string) string {
	rel, err := filepath.Rel(p.idx.Root, name)
	if err != nil {
		return filepath.ToSlash(name)
	}
	return filepath.ToSlash(rel)
}

// readSqlcFiles reads the named queries of one query file, or of every .sql
// file in a directory.
func (p *libraryPass) readSqlcFiles(name string) []*sqlcQuery {
	info, err := os.Stat(name)
	if err != nil {
		p.warn("sqlc: the queries at " + p.relative(name) + " do not exist")
		return nil
	}
	files := []string{name}
	if info.IsDir() {
		files = nil
		entries, _ := os.ReadDir(name)
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
				files = append(files, filepath.Join(name, entry.Name()))
			}
		}
	}
	var out []*sqlcQuery
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		rel := p.relative(file)
		var current *sqlcQuery
		var body []string
		flush := func() {
			if current != nil {
				current.sql = strings.Join(body, "\n")
				out = append(out, current)
			}
		}
		for i, line := range strings.Split(string(data), "\n") {
			if match := sqlcName.FindStringSubmatch(line); match != nil {
				flush()
				current = &sqlcQuery{name: match[1], method: "Queries." + match[1], source: p.rootSource(rel, i+1)}
				body = nil
				continue
			}
			body = append(body, line)
		}
		flush()
	}
	return out
}
