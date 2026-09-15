package extractredis

import (
	"encoding/json"
	"go/ast"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

type redisConstruction struct {
	at goscan.Source
}

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	tree, err := goscan.Read(in.Root)
	if err != nil {
		return plugin.Response{}, err
	}

	owner := opts.Context + "." + opts.Service
	service := catalog.Service{
		ID:         owner,
		Slug:       opts.Service,
		Provides:   []catalog.RpcService{},
		Consumes:   []catalog.RpcCall{},
		Aggregates: []catalog.Aggregate{},
	}
	stores := []catalog.Store{}
	if found := findRedisConstruction(tree); found != nil {
		keyspaces := scanRedisKeyspaces(tree)
		storeSlug := firstNonEmpty(opts.Store, "redis")
		storeID := owner + "." + storeSlug
		service.Stores = []string{storeID}
		stores = append(stores, catalog.Store{
			ID:        storeID,
			Slug:      storeSlug,
			Name:      firstNonEmpty(opts.Name, opts.Service+" Redis"),
			Kind:      catalog.StoreKindRedis,
			Owner:     owner,
			Tables:    []catalog.Table{},
			Keyspaces: keyspaces,
			Source:    found.at.String(),
		})
	} else {
		b.Warn(owner, "no supported Redis client construction was found in non-test Go source")
	}

	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID:       opts.Context,
			Slug:     opts.Context,
			Services: []catalog.Service{service},
		}},
		Defs:   map[string]catalog.TypeDef{},
		Flows:  []catalog.Flow{},
		Adrs:   []catalog.Adr{},
		Stores: stores,
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(firstNonEmpty(opts.Out, "redis.json"), string(encoded)+"\n")

	return b.Response(), nil
}

func findRedisConstruction(tree *goscan.Tree) *redisConstruction {
	for _, file := range tree.Files {
		var found *redisConstruction
		ast.Inspect(file.Node, func(node ast.Node) bool {
			if found != nil {
				return false
			}
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			pkg, ok := sel.X.(*ast.Ident)
			if !ok {
				return true
			}
			importPath := redisImportPath(file, pkg.Name)
			if !isRedisConstructor(importPath, sel.Sel.Name) {
				return true
			}
			found = &redisConstruction{at: tree.At(call.Pos())}
			return false
		})
		if found != nil {
			return found
		}
	}

	return nil
}

// redisImportPath is the Redis client package a file calls packageName, or
// empty when that name is something else. goscan already knows go-redis/v9
// by the name redis and rueidis by rueidis, alias or not.
func redisImportPath(file *goscan.File, packageName string) string {
	if importPath := file.Imports[packageName]; isRedisClientImport(importPath) {
		return importPath
	}
	return ""
}

func isRedisConstructor(importPath, name string) bool {
	switch {
	case isGoRedisImport(importPath):
		switch name {
		case "NewClient", "NewClusterClient", "NewFailoverClient", "NewFailoverClusterClient":
			return true
		}
	case importPath == "github.com/redis/rueidis" || strings.HasPrefix(importPath, "github.com/redis/rueidis/"):
		return name == "NewClient"
	case importPath == "github.com/gomodule/redigo/redis":
		return name == "Dial" || name == "DialURL"
	}

	return false
}

func isRedisClientImport(importPath string) bool {
	return isGoRedisImport(importPath) || importPath == "github.com/redis/rueidis" ||
		strings.HasPrefix(importPath, "github.com/redis/rueidis/") || importPath == "github.com/gomodule/redigo/redis"
}

func isGoRedisImport(importPath string) bool {
	for _, base := range []string{"github.com/redis/go-redis", "github.com/go-redis/redis"} {
		if importPath == base {
			return true
		}
		version, ok := strings.CutPrefix(importPath, base+"/v")
		if !ok || version == "" {
			continue
		}
		if _, err := strconv.Atoi(version); err == nil {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
