# portolan.0018 — A Gateway Route contributes hosts only through a valid attachment

- **Status:** accepted
- **Date:** 2026-09-14
- **Scope:** portolan

## Context and Problem Statement

Portolan reads Kubernetes names to distinguish providers of the same HTTP or
gRPC route (portolan.0011). The first Gateway API reader treated an HTTPRoute,
GRPCRoute or TLSRoute as an ingress by itself: when one of its backendRefs named
a Service, every hostname on the Route was added to that Service.

A Route is not an entry point by itself. It has to name a Gateway in parentRefs,
the Gateway has to accept the Route on a listener, and the listener and Route
hostnames have to intersect. Namespace boundaries add two different handshakes:
allowedRoutes controls Route-to-Gateway attachment, while ReferenceGrant
controls a Route referring to a Service in another namespace. Ignoring those
relationships can publish a hostname on which the service is not reachable.

## Decision Drivers

- A host used to resolve an ambiguous call must be proven, not inferred from an
  unattached Route.
- Manifest and live-cluster readers must apply the same rules.
- The catalog needs the reachable name, not a second model of the Kubernetes
  control plane.
- Kubernetes Secrets and certificate references must remain unread.
- A namespace-scoped cluster read must not silently widen the workload scope.

## Decision Outcome

A Gateway API hostname contributes to `service.hosts` only through the complete
Route -> Gateway listener -> Service relationship.

The reader resolves HTTPRoute and GRPCRoute, and TLSRoute when its experimental
CRD is available. It applies parentRef defaults, sectionName and port listener
selection, protocol and allowed kind compatibility, allowedRoutes namespace
rules, and listener/Route hostname intersection. A cross-namespace backendRef
to a Service is accepted only when a ReferenceGrant in the Service namespace
allows that Route kind and source namespace.

`GatewayClass`, policies, listener status and controller-specific resources do
not become catalog entities. They do not add a name that an application calls.
The readers use declarative configuration, not status conditions, so a manifest
and the same objects returned by a cluster produce the same answer.

For `fetch-k8s`, `namespaces` remains the set whose workloads are emitted.
`gatewayNamespaces` may additionally name namespaces holding shared Gateways or
Routes; only Gateway API and Namespace metadata is read there. When namespaces
is omitted the existing all-namespaces read already covers both.

Namespace objects are read only for labels used by allowedRoutes selectors.
Secrets are still never requested. TLS certificateRefs and every other value
that does not become a hostname are ignored.

## Consequences

An unattached Route, a listener with no hostname intersection, a disallowed
namespace, and an ungranted cross-namespace backend no longer create false
hosts. A Route without hostnames can inherit a concrete listener hostname.

The Go manifest extractor and JavaScript cluster reader keep separate
implementations because they run in different environments. A shared table of
Gateway API object graphs and expected hosts holds their behavior together.

TCPRoute and UDPRoute carry no hostname, so they do not affect `service.hosts`.
Gateway addresses and status conditions may be added later if the catalog needs
to distinguish desired attachment from controller-observed reachability.
