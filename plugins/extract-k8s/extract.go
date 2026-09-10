package extractk8s

import (
	"encoding/json"
	"fmt"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/goscan"
	"github.com/shortlink-org/portolan/plugin"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	b := &plugin.Builder{}
	objects, err := readTree(in.Root, opts.Paths, opts.Namespace, b)
	if err != nil {
		return plugin.Response{}, err
	}

	all := workloads(objects, configMaps(objects))
	svcs := services(objects)

	// Every name the tree's own Services answer to, for hostOnly: a value
	// naming one of these is a dial inside the cluster whatever form it took.
	known := map[string]bool{}
	for _, s := range svcs {
		for _, form := range hostForms(s.name, s.namespace) {
			known[form] = true
		}
	}

	service := catalog.Service{
		ID:         opts.Context + "." + opts.Service,
		Slug:       opts.Service,
		Provides:   []catalog.RpcService{},
		Consumes:   []catalog.RpcCall{},
		Aggregates: []catalog.Aggregate{},
	}

	if w, ok := pick(all, opts.Service); ok {
		service.Kind = w.kind

		var hosts []string
		backends := map[string]bool{}
		for _, s := range svcs {
			if s.selects(w.podLabels) {
				hosts = append(hosts, hostForms(s.name, s.namespace)...)
				backends[s.name] = true
			}
		}
		hosts = append(hosts, frontingHosts(objects, backends)...)
		service.Hosts = sortedUnique(hosts)

		own := map[string]bool{}
		for _, h := range service.Hosts {
			own[h] = true
		}
		var dials []string
		for _, value := range w.values {
			if host, ok := hostOnly(value, known); ok && !own[host] {
				dials = append(dials, host)
			}
		}
		service.Dials = sortedUnique(dials)
	} else if len(all) == 0 {
		b.Warn(in.Root, "no Deployment, StatefulSet, DaemonSet, Job or CronJob was found")
	} else {
		b.Warn(in.Root, fmt.Sprintf("none of the %d workloads is named or labelled %q; name the service the manifests call it", len(all), opts.Service))
	}

	fragment := catalog.Catalog{
		Contexts: []catalog.BoundedContext{{
			ID:       opts.Context,
			Slug:     opts.Context,
			Services: []catalog.Service{service},
		}},
		Defs:  map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{},
		Adrs:  []catalog.Adr{},
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(goscan.FirstNonEmpty(opts.Out, "k8s.json"), string(encoded)+"\n")
	return b.Response(), nil
}

// pick is the workload the step is about: the one named like the service,
// or labelled so the way Helm and kustomize conventionally label things, or
// the only one there is.
func pick(all []workload, service string) (workload, bool) {
	for _, w := range all {
		if w.name == service {
			return w, true
		}
	}
	for _, w := range all {
		for _, labels := range []map[string]string{w.labels, w.podLabels} {
			if labels["app.kubernetes.io/name"] == service || labels["app"] == service {
				return w, true
			}
		}
	}
	if len(all) == 1 {
		return all[0], true
	}
	return workload{}, false
}
