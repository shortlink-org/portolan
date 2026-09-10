package extractk8s

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// k8sService is a Kubernetes Service: a name the cluster's DNS answers for,
// and the selector that says whose pods are behind it.
type k8sService struct {
	object
	selector map[string]string
}

func services(objects []object) []k8sService {
	byID := map[string]*k8sService{}
	var order []string
	for _, o := range objects {
		if o.kind != "Service" {
			continue
		}
		s := byID[o.id()]
		if s == nil {
			s = &k8sService{object: o, selector: map[string]string{}}
			byID[o.id()] = s
			order = append(order, o.id())
		}
		for k, v := range stringMapAt(mapAt(o.body, "spec"), "selector") {
			s.selector[k] = v
		}
	}
	out := make([]k8sService, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out
}

// selects says whether a Service's selector matches a pod's labels: every
// key the selector names, with the value it names. An empty selector selects
// nothing here, though the cluster reads it as a headless Service with
// endpoints written by hand.
func (s k8sService) selects(podLabels map[string]string) bool {
	if len(s.selector) == 0 {
		return false
	}
	for k, v := range s.selector {
		if podLabels[k] != v {
			return false
		}
	}
	return true
}

// hostForms are the names the cluster's DNS answers for one Service: the
// short name from its own namespace, and the namespaced, `svc` and fully
// qualified forms from anywhere. All four are written, because a caller may
// be configured with any of them.
func hostForms(name, namespace string) []string {
	if namespace == "" {
		namespace = "default"
	}
	return []string{
		name,
		name + "." + namespace,
		name + "." + namespace + ".svc",
		name + "." + namespace + ".svc.cluster.local",
	}
}

// frontingHosts are the hosts an Ingress or a Gateway API HTTPRoute answers
// on for the named Services. A rule whose backend is another Service is
// another service's host.
func frontingHosts(objects []object, backends map[string]bool) []string {
	var out []string
	for _, o := range objects {
		spec := mapAt(o.body, "spec")
		switch o.kind {
		case "Ingress":
			if svc := mapAt(mapAt(spec, "defaultBackend"), "service"); backends[stringAt(svc, "name")] {
				for _, rule := range listAt(spec, "rules") {
					out = append(out, stringAt(rule, "host"))
				}
			}
			for _, rule := range listAt(spec, "rules") {
				host := stringAt(rule, "host")
				if host == "" {
					continue
				}
				for _, path := range listAt(mapAt(rule, "http"), "paths") {
					if backends[stringAt(mapAt(mapAt(path, "backend"), "service"), "name")] {
						out = append(out, host)
						break
					}
				}
			}
		case "HTTPRoute", "GRPCRoute", "TLSRoute":
			hostnames := stringListAt(spec, "hostnames")
			if len(hostnames) == 0 {
				continue
			}
			for _, rule := range listAt(spec, "rules") {
				matched := false
				for _, ref := range listAt(rule, "backendRefs") {
					if backends[stringAt(ref, "name")] {
						matched = true
						break
					}
				}
				if matched {
					out = append(out, hostnames...)
					break
				}
			}
		}
	}
	return out
}

var (
	bareHost = regexp.MustCompile(`^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?$`)
	// svcForm is a name that only the cluster's DNS answers for, which is
	// what lets a name from another repository's Service through: nothing
	// else looks like `pricing.shop.svc`.
	svcForm = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z0-9]([a-z0-9-]*[a-z0-9])?\.svc(\.cluster\.local)?$`)
)

// hostOnly reduces a configured value to the in-cluster host it names, or
// nothing. A URL gives up its hostname and keeps nothing else - not the
// scheme, the port, the path, the query, and not the user and password in
// front of the host. A bare `host[:port]` gives up the port. What is left
// qualifies when it is a form the tree's own Services answer to, or a
// `<name>.<namespace>.svc` form that only a cluster resolves.
//
// A password, a token, a log level, a feature flag: none of these is a host,
// and none of them passes. That is the whole of the rule that keeps values
// out of the catalog, and it is a rule of shape, not a list of words.
func hostOnly(value string, known map[string]bool) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	host := ""
	if strings.Contains(value, "://") {
		parsed, err := url.Parse(value)
		if err != nil {
			return "", false
		}
		host = strings.ToLower(parsed.Hostname())
	} else {
		lower := strings.ToLower(value)
		if !bareHost.MatchString(lower) {
			return "", false
		}
		host = lower
		if i := strings.LastIndex(host, ":"); i >= 0 {
			host = host[:i]
		}
	}
	if host == "" {
		return "", false
	}
	if known[host] || svcForm.MatchString(host) {
		return host, true
	}
	return "", false
}

func sortedUnique(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, v := range values {
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}
