package gendx

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

type Options struct {
	EntityType         string            `json:"entityType,omitempty"`
	EntityTypes        map[string]string `json:"entityTypes,omitempty"`
	RelationIdentifier string            `json:"relationIdentifier,omitempty"`
	TechnologyProperty string            `json:"technologyProperty,omitempty"`
	OwnerTeamIDs       map[string]string `json:"ownerTeamIds,omitempty"`
}

type Plan struct {
	Version       int            `json:"version"`
	Entities      []DXEntity     `json:"entities"`
	RelationEdges []RelationEdge `json:"relationEdges"`
}

type DXEntity struct {
	Identifier   string                   `json:"identifier"`
	Type         string                   `json:"type"`
	Name         string                   `json:"name"`
	Description  string                   `json:"description,omitempty"`
	OwnerTeamIDs []string                 `json:"owner_team_ids,omitempty"`
	Properties   map[string]any           `json:"properties,omitempty"`
	Aliases      map[string][]AliasLookup `json:"aliases,omitempty"`
}

type AliasLookup struct {
	Lookup string `json:"lookup"`
}

type RelationEdge struct {
	RelationIdentifier string              `json:"relation_identifier"`
	Edges              map[string][]string `json:"edges"`
}

func render(req plugin.Request, opts Options) (plugin.Response, error) {
	if opts.EntityType == "" {
		opts.EntityType = "service"
	}
	if opts.RelationIdentifier == "" {
		opts.RelationIdentifier = "service-depends-on-service"
	}
	services := map[string]*catalog.Service{}
	for i := range req.Catalog.Contexts {
		for j := range req.Catalog.Contexts[i].Services {
			svc := &req.Catalog.Contexts[i].Services[j]
			services[svc.ID] = svc
		}
	}
	ids := make([]string, 0, len(services))
	for id := range services {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	plan := Plan{Version: 1, Entities: make([]DXEntity, 0, len(ids)), RelationEdges: []RelationEdge{}}
	edges := map[string][]string{}
	for _, id := range ids {
		svc := services[id]
		entityType := opts.EntityType
		if mapped := strings.TrimSpace(opts.EntityTypes[string(svc.Kind)]); mapped != "" {
			entityType = mapped
		}
		entity := DXEntity{Identifier: svc.ID, Type: entityType, Name: svc.Name, Description: firstLine(svc.Readme)}
		if opts.TechnologyProperty != "" && len(svc.Technologies) > 0 {
			entity.Properties = map[string]any{opts.TechnologyProperty: sortedUnique(svc.Technologies)}
		}
		for _, owner := range svc.Owners {
			if team := strings.TrimSpace(opts.OwnerTeamIDs[owner]); team != "" {
				entity.OwnerTeamIDs = append(entity.OwnerTeamIDs, team)
			}
		}
		entity.OwnerTeamIDs = sortedUnique(entity.OwnerTeamIDs)
		if aliasType, lookup := repositoryAlias(svc.Repo); aliasType != "" {
			entity.Aliases = map[string][]AliasLookup{aliasType: {{Lookup: lookup}}}
		}
		plan.Entities = append(plan.Entities, entity)

		dependencies := append([]string(nil), svc.DependsOn...)
		for _, call := range svc.Consumes {
			if _, ok := services[call.Peer]; ok {
				dependencies = append(dependencies, call.Peer)
			}
		}
		dependencies = sortedUnique(dependencies)
		filtered := dependencies[:0]
		for _, dependency := range dependencies {
			if dependency != svc.ID {
				if _, ok := services[dependency]; ok {
					filtered = append(filtered, dependency)
				}
			}
		}
		if len(filtered) > 0 {
			edges[svc.ID] = filtered
		}
	}
	if len(edges) > 0 {
		plan.RelationEdges = append(plan.RelationEdges, RelationEdge{RelationIdentifier: opts.RelationIdentifier, Edges: edges})
	}
	raw, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	return plugin.Response{Files: []plugin.File{{Name: "plan.json", Contents: string(raw) + "\n"}}}, nil
}

func repositoryAlias(repo string) (string, string) {
	value := strings.TrimSuffix(strings.TrimSpace(repo), ".git")
	for _, candidate := range []struct{ prefix, kind string }{{"https://github.com/", "github_repo"}, {"github.com/", "github_repo"}, {"https://gitlab.com/", "gitlab_repo"}, {"gitlab.com/", "gitlab_repo"}} {
		if strings.HasPrefix(value, candidate.prefix) {
			return candidate.kind, strings.TrimPrefix(value, candidate.prefix)
		}
	}
	return "", ""
}

func firstLine(value string) string {
	for _, line := range strings.Split(strings.TrimSpace(value), "\n") {
		line = strings.TrimSpace(strings.TrimLeft(line, "#"))
		if line != "" {
			return line
		}
	}
	return ""
}

func sortedUnique(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}
