package main

// The id and slug rules, written once.
//
// Every other extractor keeps these in one file for the same reason: the ids
// are the join between fragments that never see each other, and a rule spelled
// twice is a rule that drifts. `plugins/extract-go/ids.go` is the precedent.

import (
	"regexp"
	"strings"
)

// interfaceID is what a service in a .proto is called across the catalog:
// its proto package and its name. `shop.v1.Orders`.
//
// This is already the spelling `RpcService.id` documents, so a proto read here
// lands beside interfaces every other extractor names the same way.
func interfaceID(pkg, service string) string {
	if pkg == "" {
		return service
	}

	return pkg + "." + service
}

// callID is one method of one interface: `shop.v1.Orders/PlaceOrder`.
//
// The same string `buildIndex` keys `rpcProviderByMethod` by, which is what
// makes a consumed call and a provided method meet with no other machinery.
func callID(iface, method string) string {
	return iface + "/" + method
}

// moduleID is the module's registry-global name, or a local stand-in.
//
// A module never published still needs an id, because the interfaces read out
// of it have to say where they came from. `local:` prefixes it so nobody
// mistakes the path for a module someone could go and fetch.
func localModuleID(dir string) string {
	return localPrefix + strings.Trim(dir, "/")
}

var notSlug = regexp.MustCompile(`[^a-z0-9]+`)

const localPrefix = "local:"

// moduleName is the module as a reader says it: `acme/shop` for a published
// module, and the whole path for a local one.
//
// A published module drops its registry host, because it is the same for every
// module in almost every estate and repeating it would say nothing. A local id
// drops NOTHING - its path is not `host/owner/name`, and trimming its first
// segment would turn `internal/infrastructure/pricing` into a directory that
// does not exist.
func moduleName(id string) string {
	if strings.HasPrefix(id, localPrefix) {
		return strings.TrimPrefix(id, localPrefix)
	}
	if parts := strings.Split(id, "/"); len(parts) > 2 {
		return strings.Join(parts[1:], "/")
	}

	return id
}

// moduleSlug is what the URL uses. `buf.build/acme/shop` gives `acme-shop`,
// `local:internal/infrastructure/pricing` gives
// `internal-infrastructure-pricing`.
//
// Should two registries ever host the same owner and name, the validator
// refuses the catalog rather than letting two entities share an address.
func moduleSlug(id string) string {
	slug := notSlug.ReplaceAllString(strings.ToLower(moduleName(id)), "-")

	return strings.Trim(slug, "-")
}

// registryOf is the host a module was published to, empty for a local set.
func registryOf(id string) string {
	if strings.HasPrefix(id, localPrefix) {
		return ""
	}
	if parts := strings.Split(id, "/"); len(parts) > 2 {
		return parts[0]
	}

	return ""
}
