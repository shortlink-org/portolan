package extractk8s

import (
	"sort"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

const gatewayAPIGroup = "gateway.networking.k8s.io"

var gatewayRouteProtocols = map[string]map[string]bool{
	"HTTPRoute": {"HTTP": true, "HTTPS": true},
	"GRPCRoute": {"HTTP": true, "HTTPS": true},
	"TLSRoute":  {"TLS": true},
}

func neededForGatewayResolution(kind string) bool {
	return kind == "Gateway" || kind == "ReferenceGrant" || gatewayRouteProtocols[kind] != nil
}

// gatewayHosts resolves the ownership tree rather than treating a Route as
// an ingress on its own. A hostname contributes only when the Route targets
// one of the selected Services, is attached to an existing Gateway listener,
// and that listener accepts its kind, namespace and hostname.
func gatewayHosts(objects []object, backends map[string]bool) []string {
	var out []string
	for _, exposure := range gatewayExposures(objects, backends, "") {
		out = append(out, exposure.Hostnames...)
	}
	return sortedUnique(out)
}

// gatewayExposures keeps the evidence gatewayHosts deliberately reduces: the
// Route, accepted listener and backend Service behind each set of hostnames.
func gatewayExposures(objects []object, backends map[string]bool, basis catalog.GatewayExposureBasis) []catalog.GatewayExposure {
	gateways := map[string]object{}
	namespaces := namespaceLabelIndex(objects)
	for _, o := range objects {
		if o.kind == "Gateway" && strings.HasPrefix(o.apiVersion, gatewayAPIGroup+"/") {
			gateways[namespacedName(o.namespace, o.name)] = o
		}
	}

	byID := map[string]catalog.GatewayExposure{}
	for _, route := range objects {
		if gatewayRouteProtocols[route.kind] == nil || !strings.HasPrefix(route.apiVersion, gatewayAPIGroup+"/") {
			continue
		}
		spec := mapAt(route.body, "spec")
		targets := routeBackends(route, spec, objects, backends)
		if len(targets) == 0 {
			continue
		}
		for _, parent := range listAt(spec, "parentRefs") {
			group := stringAt(parent, "group")
			if group == "" {
				group = gatewayAPIGroup
			}
			kind := stringAt(parent, "kind")
			if kind == "" {
				kind = "Gateway"
			}
			if group != gatewayAPIGroup || kind != "Gateway" {
				continue
			}
			parentNamespace := stringAt(parent, "namespace")
			if parentNamespace == "" {
				parentNamespace = objectNamespace(route.namespace)
			}
			gateway, ok := gateways[namespacedName(parentNamespace, stringAt(parent, "name"))]
			if !ok {
				continue
			}
			for _, listener := range listAt(mapAt(gateway.body, "spec"), "listeners") {
				if !listenerAcceptsRoute(listener, gateway, route, parent, namespaces) {
					continue
				}
				listenerName := stringAt(listener, "name")
				port, _ := strconv.Atoi(stringAt(listener, "port"))
				for _, target := range targets {
					id := route.kind + "/" + namespacedName(route.namespace, route.name) +
						"->Gateway/" + namespacedName(gateway.namespace, gateway.name) + "#" + listenerName +
						"->Service/" + target
					byID[id] = catalog.GatewayExposure{
						ID:               id,
						Hostnames:        intersectHostnames(stringAt(listener, "hostname"), stringListAt(spec, "hostnames")),
						RouteKind:        route.kind,
						RouteNamespace:   objectNamespace(route.namespace),
						RouteName:        route.name,
						GatewayNamespace: objectNamespace(gateway.namespace),
						GatewayName:      gateway.name,
						Listener:         listenerName,
						Protocol:         strings.ToUpper(stringAt(listener, "protocol")),
						Port:             port,
						BackendNamespace: strings.SplitN(target, "/", 2)[0],
						BackendName:      strings.SplitN(target, "/", 2)[1],
						Basis:            basis,
						Source:           route.file,
					}
				}
			}
		}
	}
	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]catalog.GatewayExposure, 0, len(ids))
	for _, id := range ids {
		out = append(out, byID[id])
	}
	return out
}

func routeBackends(route object, spec map[string]any, objects []object, backends map[string]bool) []string {
	targets := map[string]bool{}
	for _, rule := range listAt(spec, "rules") {
		for _, ref := range listAt(rule, "backendRefs") {
			group := stringAt(ref, "group")
			kind := stringAt(ref, "kind")
			if group != "" || (kind != "" && kind != "Service") {
				continue
			}
			namespace := stringAt(ref, "namespace")
			if namespace == "" {
				namespace = objectNamespace(route.namespace)
			}
			name := stringAt(ref, "name")
			if !backends[namespacedName(namespace, name)] {
				continue
			}
			if namespace == objectNamespace(route.namespace) || referenceGranted(objects, route, namespace, name) {
				targets[namespacedName(namespace, name)] = true
			}
		}
	}
	out := make([]string, 0, len(targets))
	for target := range targets {
		out = append(out, target)
	}
	sort.Strings(out)
	return out
}

func referenceGranted(objects []object, route object, targetNamespace, targetName string) bool {
	for _, grant := range objects {
		if grant.kind != "ReferenceGrant" || objectNamespace(grant.namespace) != targetNamespace || !strings.HasPrefix(grant.apiVersion, gatewayAPIGroup+"/") {
			continue
		}
		spec := mapAt(grant.body, "spec")
		fromMatches := false
		for _, from := range listAt(spec, "from") {
			if stringAt(from, "group") == gatewayAPIGroup && stringAt(from, "kind") == route.kind && stringAt(from, "namespace") == objectNamespace(route.namespace) {
				fromMatches = true
				break
			}
		}
		if !fromMatches {
			continue
		}
		for _, to := range listAt(spec, "to") {
			if stringAt(to, "group") == "" && stringAt(to, "kind") == "Service" {
				name := stringAt(to, "name")
				if name == "" || name == targetName {
					return true
				}
			}
		}
	}
	return false
}

func listenerAcceptsRoute(listener map[string]any, gateway, route object, parent map[string]any, namespaces map[string]map[string]string) bool {
	if section := stringAt(parent, "sectionName"); section != "" && section != stringAt(listener, "name") {
		return false
	}
	if port := stringAt(parent, "port"); port != "" && port != stringAt(listener, "port") {
		return false
	}
	if !gatewayRouteProtocols[route.kind][strings.ToUpper(stringAt(listener, "protocol"))] {
		return false
	}
	allowed := mapAt(listener, "allowedRoutes")
	if kinds := listAt(allowed, "kinds"); len(kinds) > 0 {
		matched := false
		for _, candidate := range kinds {
			group := stringAt(candidate, "group")
			if group == "" {
				group = gatewayAPIGroup
			}
			if group == gatewayAPIGroup && stringAt(candidate, "kind") == route.kind {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	from := stringAt(mapAt(allowed, "namespaces"), "from")
	if from == "" {
		from = "Same"
	}
	switch from {
	case "All":
		return true
	case "Same":
		return objectNamespace(gateway.namespace) == objectNamespace(route.namespace)
	case "Selector":
		labels, ok := namespaces[objectNamespace(route.namespace)]
		return ok && labelSelectorMatches(labels, mapAt(mapAt(allowed, "namespaces"), "selector"))
	default:
		return false
	}
}

func namespaceLabelIndex(objects []object) map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, o := range objects {
		if o.kind != "Namespace" {
			continue
		}
		labels := map[string]string{"kubernetes.io/metadata.name": o.name}
		for key, value := range o.labels {
			labels[key] = value
		}
		out[o.name] = labels
	}
	return out
}

func labelSelectorMatches(labels map[string]string, selector map[string]any) bool {
	for key, value := range stringMapAt(selector, "matchLabels") {
		if labels[key] != value {
			return false
		}
	}
	for _, expression := range listAt(selector, "matchExpressions") {
		key := stringAt(expression, "key")
		value, exists := labels[key]
		values := stringListAt(expression, "values")
		contains := false
		for _, candidate := range values {
			if candidate == value {
				contains = true
				break
			}
		}
		switch stringAt(expression, "operator") {
		case "In":
			if !exists || !contains {
				return false
			}
		case "NotIn":
			if exists && contains {
				return false
			}
		case "Exists":
			if !exists {
				return false
			}
		case "DoesNotExist":
			if exists {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func intersectHostnames(listener string, routes []string) []string {
	listener = strings.ToLower(strings.TrimSpace(listener))
	if len(routes) == 0 {
		if listener == "" {
			return nil
		}
		return []string{listener}
	}
	if listener == "" {
		out := make([]string, 0, len(routes))
		for _, route := range routes {
			out = append(out, strings.ToLower(strings.TrimSpace(route)))
		}
		return sortedUnique(out)
	}
	var out []string
	for _, route := range routes {
		if intersection, ok := hostnameIntersection(listener, strings.ToLower(strings.TrimSpace(route))); ok {
			out = append(out, intersection)
		}
	}
	return sortedUnique(out)
}

func hostnameIntersection(a, b string) (string, bool) {
	if a == "" || b == "" {
		return "", false
	}
	if a == b {
		return a, true
	}
	if wildcardMatches(a, b) {
		return b, true
	}
	if wildcardMatches(b, a) {
		return a, true
	}
	if strings.HasPrefix(a, "*.") && strings.HasPrefix(b, "*.") {
		as, bs := strings.TrimPrefix(a, "*"), strings.TrimPrefix(b, "*")
		if strings.HasSuffix(as, bs) {
			return a, true
		}
		if strings.HasSuffix(bs, as) {
			return b, true
		}
	}
	return "", false
}

func wildcardMatches(pattern, hostname string) bool {
	if !strings.HasPrefix(pattern, "*.") || strings.HasPrefix(hostname, "*.") {
		return false
	}
	suffix := strings.TrimPrefix(pattern, "*")
	return strings.HasSuffix(hostname, suffix) && len(hostname) > len(suffix)
}
