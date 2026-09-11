// Package catalog is the Go side of the contract in src/catalog.ts.
//
// It is a MIRROR, not a second definition (portolan.0003). The TypeScript file is where the
// shape is decided and where the prose explaining each decision lives; this
// package exists so a plugin written in Go can read a catalog without
// reinventing it, and it is held to the original by a round-trip test rather
// than by anyone remembering to update both.
//
// Nothing here validates. A plugin receives a catalog that the host has
// already validated, and a second opinion in a second language is how the two
// drift apart.
package catalog

import (
	"encoding/json"
	"fmt"
)

type Status string

const (
	StatusVerified   Status = "verified"
	StatusDeclared   Status = "declared"
	StatusUnresolved Status = "unresolved"
)

// Catalog is one source of facts. The estate a reader sees is the merge of
// several of these, so nothing in a plugin may assume it holds all of them.
type Catalog struct {
	// The stamp the HOST writes, from the last commit that touched the input
	// this source was read from - never a plugin, which would have to read a
	// clock and produce a different fragment on every run. Both are omitted
	// when empty, because a source nobody generates carries no stamp at all
	// and a mirror that wrote `"generatedAt": ""` would be inventing an answer
	// to a question the file does not answer. The merge dates the estate from
	// the sources that do carry one.
	GeneratedAt string             `json:"generatedAt,omitempty"`
	Commit      string             `json:"commit,omitempty"`
	Contexts    []BoundedContext   `json:"contexts"`
	Defs        map[string]TypeDef `json:"defs"`
	Flows       []Flow             `json:"flows"`
	Adrs        []Adr              `json:"adrs"`
	Stores      []Store            `json:"stores,omitempty"`
	Modules     []ProtoModule      `json:"modules,omitempty"`
	Terms       []Term             `json:"terms,omitempty"`
	Repos       []RepoPin          `json:"repos,omitempty"`
	Deployments []Deployment       `json:"deployments,omitempty"`
	Externals   []External         `json:"externals,omitempty"`
}

// Deployment is one place a service runs: an Argo CD Application as the
// deployer listed it, reduced to what a deploy changes. A list on the catalog
// rather than a field on Service: the fetcher that writes it reads a control
// plane and does not know which service an Application is, and one service
// stands in several places.
type Deployment struct {
	// ID is "<argocd namespace>/<application name>".
	ID          string `json:"id"`
	Name        string `json:"name"`
	Project     string `json:"project"`
	Environment string `json:"environment"`
	Cluster     string `json:"cluster"`
	Namespace   string `json:"namespace"`
	// Repo is spelled the way Service.Repo spells it; empty for a chart
	// from a registry.
	Repo string `json:"repo"`
	Path string `json:"path"`
	// Chart is the Helm chart name when the source is a registry.
	Chart          string `json:"chart,omitempty"`
	TargetRevision string `json:"targetRevision"`
	Revision       string `json:"revision"`
	// Tool is helm, kustomize, directory or plugin, as Argo CD says it.
	Tool string `json:"tool"`
	URL  string `json:"url"`
	// Service is the id of the service the Application's labels name;
	// empty when they name none, and the path decides.
	Service string   `json:"service,omitempty"`
	Images  []string `json:"images,omitempty"`
}

// External is a system outside the estate with a contract: what it answers on,
// read from the copy of its document vendored beside the adapter that calls it,
// and nothing else. It sits at the root beside the contexts, so its id is its
// slug and carries no dot.
type External struct {
	ID       string       `json:"id"`
	Slug     string       `json:"slug"`
	Name     string       `json:"name"`
	Summary  string       `json:"summary"`
	URL      string       `json:"url,omitempty"`
	Provides []RpcService `json:"provides"`
}

// RepoPin is a repository the estate was read at, and the commit it was read
// at, so a source path in another repository can still be a link.
//
// A list on the catalog rather than a field on Service: the pin is a fact
// about the estate, and a repository holding three services is fetched once.
type RepoPin struct {
	// Repo is spelled the way Service.Repo spells it: "github.com/acme/shop".
	Repo string `json:"repo"`

	// Commit is the full sha. Nothing resolves it locally, so there is
	// nothing a short one could be expanded against.
	Commit string `json:"commit"`
}

type Classification string

const (
	ClassificationCore       Classification = "core"
	ClassificationSupporting Classification = "supporting"
	ClassificationGeneric    Classification = "generic"
)

// How a context is read. The keys stay `contexts` and `services` (portolan.0004).
type GroupKind string

const (
	GroupKindBoundedContext GroupKind = "bounded-context"
	GroupKindSystem         GroupKind = "system"
	GroupKindProduct        GroupKind = "product"
	GroupKindTeam           GroupKind = "team"
	GroupKindNamespace      GroupKind = "namespace"
)

type BoundedContext struct {
	ID             string         `json:"id"`
	Slug           string         `json:"slug"`
	Name           string         `json:"name"`
	Summary        string         `json:"summary"`
	Kind           GroupKind      `json:"kind,omitempty"`
	Classification Classification `json:"classification,omitempty"`
	ViewID         string         `json:"viewId,omitempty"`
	Services       []Service      `json:"services"`
}

type ComponentKind string

const (
	ComponentKindService      ComponentKind = "service"
	ComponentKindApplication  ComponentKind = "application"
	ComponentKindWebapp       ComponentKind = "webapp"
	ComponentKindWorker       ComponentKind = "worker"
	ComponentKindJob          ComponentKind = "job"
	ComponentKindFunction     ComponentKind = "function"
	ComponentKindCLI          ComponentKind = "cli"
	ComponentKindLibrary      ComponentKind = "library"
	ComponentKindDataPipeline ComponentKind = "data-pipeline"
)

type Service struct {
	ID           string        `json:"id"`
	Slug         string        `json:"slug"`
	Name         string        `json:"name"`
	Repo         string        `json:"repo"`
	Path         string        `json:"path"`
	Readme       string        `json:"readme"`
	Kind         ComponentKind `json:"kind,omitempty"`
	Technologies []string      `json:"technologies,omitempty"`
	Provides     []RpcService  `json:"provides"`
	Consumes     []RpcCall     `json:"consumes"`
	// Copies are interfaces read from vendored proto modules. They are kept
	// apart from Provides because this service calls rather than implements
	// them, but retain the shapes needed to compare the copy with its publisher.
	Copies     []RpcService `json:"copies,omitempty"`
	Aggregates []Aggregate  `json:"aggregates"`
	// Stores this service touches, by id. Ownership is not stated here - a
	// store names its own owner, so an id in this list that the store does not
	// call its owner is a read.
	Stores []string `json:"stores,omitempty"`

	// Modules this service publishes or vendors, by id. Same rule as Stores: a
	// module names its own owner, so an id here that does not call this service
	// its owner is one the service reads.
	Modules []string `json:"modules,omitempty"`

	// Channels this service declares it publishes on or listens to, read out of
	// an AsyncAPI document. Absent for a service that has no such document,
	// which is not the same as a service that speaks to nobody.
	Channels []Channel `json:"channels,omitempty"`

	// Owners is who to ask about it, as CODEOWNERS spells them. Handles and
	// nothing more: resolving one to people is a call to a forge, and the
	// handle is what a reviewer types anyway.
	Owners []string `json:"owners,omitempty"`

	// Commands are what a developer types against the checkout - the make
	// targets, npm scripts, just recipes and task-runner tasks the repository
	// declares. Read from the runner files, never from the README, so the
	// list is the one the runner would accept. Absent when nothing declares
	// any, which is not the same as a service that cannot be built.
	Commands []Command `json:"commands,omitempty"`

	// Hosts are the names this service answers on, read from what deploys
	// it: a Kubernetes Service's name in its short, namespaced, `svc` and
	// fully qualified forms, and the hosts of the Ingress or HTTPRoute in
	// front of it. Written so that a call another service is configured to
	// make to `pricing.shop.svc` can find the service that answers. Absent
	// when nothing in the tree says where the service is reachable.
	Hosts []string `json:"hosts,omitempty"`

	// Dials are the in-cluster names this service's workload is configured
	// to reach, read out of its environment and config maps and reduced to
	// the host alone. A value is never kept: not the variable it came from,
	// not the scheme, port, path or credentials around the name. Only a name
	// the cluster resolves qualifies - a Service in the same tree, or a
	// `<name>.<namespace>.svc` form - so a password in an environment
	// variable is not something this list can hold by shape.
	Dials []string `json:"dials,omitempty"`
}

// Command is one entry of a task runner's file: a make target, an npm script,
// a just recipe, a Taskfile task, a poe or pdm task.
//
// Run is the whole point - the line a reader copies - and it is spelled here
// rather than rebuilt from Runner and Name, because `npm test` and
// `npm run typecheck` are two spellings of one runner and the page should not
// have to know which scripts npm treats specially.
type Command struct {
	// Runner is the tool the line is typed at: make, npm, pnpm, yarn, bun,
	// just, task, poe, pdm.
	Runner string `json:"runner"`
	// Name is the target, script, recipe or task as its file spells it.
	Name string `json:"name"`
	// Run is the line to type at a shell in the service's directory.
	Run string `json:"run"`
	// Doc is what the file says the command is for, when it says anything: a
	// `## comment` on a make target, a `#` line over a just recipe, a task's
	// `desc`, a poe task's `help`. Most files say nothing.
	Doc string `json:"doc,omitempty"`
	// Body is what the runner executes for it: the recipe, the script line,
	// the cmds. Carried so a name that says nothing can still be read, and
	// shown folded, because a build script is not a sentence.
	Body string `json:"body,omitempty"`
	// Source is the file and line the entry was read at.
	Source string `json:"source,omitempty"`
}

type RpcService struct {
	ID       string       `json:"id"`
	Methods  []RpcMethod  `json:"methods"`
	Source   string       `json:"source"`
	Messages []RpcMessage `json:"messages,omitempty"`
	// Enums are the closed sets the messages' fields take values from, reached
	// the way Messages are: from the methods, through the fields, as far as
	// the protos read here declare them.
	Enums []RpcEnum `json:"enums,omitempty"`

	// Module is the schema module declaring this interface, by ProtoModule.ID.
	Module string `json:"module,omitempty"`
}

// RpcEnum is an enum a message field names, as the interface's document
// declares it. Values carry their wire number because a proto consumer sees
// the number, not the name, in a binary message.
type RpcEnum struct {
	Name   string         `json:"name"`
	Doc    string         `json:"doc,omitempty"`
	Values []RpcEnumValue `json:"values"`
}

type RpcEnumValue struct {
	Name   string `json:"name"`
	Number int    `json:"number"`
	Doc    string `json:"doc,omitempty"`
}

// RpcMethod is one method of one interface.
//
// A string would have done for the name, and did until protos were read. What
// a string could not carry is the shapes on either side: an endpoint whose
// request and response are named is one a reader can follow without opening
// the source, and a streaming method drawn as a unary call is a lie about how
// the two ends are coupled.
//
// Only Name is required. An interface read from an OpenAPI document supplies
// nothing else, and must keep reading the way it always did.
type RpcMethod struct {
	// Name is what the interface declares - a proto method, an OpenAPI
	// operationId. This is what Operation.ExposedBy names.
	Name string `json:"name"`
	Doc  string `json:"doc,omitempty"`

	// Request and Response name messages in RpcService.Messages; the Ref forms
	// key Catalog.Defs when the shape is shared. The same pairing, for the same
	// reason, as Field.Type and Field.Ref.
	Request     string `json:"request,omitempty"`
	RequestRef  string `json:"requestRef,omitempty"`
	Response    string `json:"response,omitempty"`
	ResponseRef string `json:"responseRef,omitempty"`

	// Streaming is empty for a unary method, which is most of them.
	Streaming  Streaming `json:"streaming,omitempty"`
	Deprecated bool      `json:"deprecated,omitempty"`

	// HTTP is the route, for a method read from an OpenAPI document. It is
	// what lets a request seen on the wire be read back to the operation.
	HTTP *HttpRoute `json:"http,omitempty"`

	// SOAP is the concrete binding of a WSDL operation. Unlike Doc, these
	// fields participate in comparison and let renderers present the contract
	// without reparsing the source document.
	SOAP *SoapRoute `json:"soap,omitempty"`
}

type HttpRoute struct {
	// Method is upper case: POST. It is empty when a framework extractor
	// proved the mount but no declaration proved the verb (extract-django's
	// `Planet.fetch`); such a route is never matched against an outbound
	// call, and a renderer shows the path alone.
	Method string `json:"method"`
	// Path is the template as the document writes it: /v1/users/{id}.
	Path string `json:"path"`
}

// SoapRoute is the wire-level part of one WSDL operation. Request, response
// and fault shapes remain on RpcMethod/RpcService, beside their proto and
// OpenAPI equivalents.
type SoapRoute struct {
	Action   string   `json:"action,omitempty"`
	Version  string   `json:"version,omitempty"`
	Style    string   `json:"style,omitempty"`
	Endpoint string   `json:"endpoint,omitempty"`
	Binding  string   `json:"binding,omitempty"`
	Faults   []string `json:"faults,omitempty"`
	Headers  []string `json:"headers,omitempty"`
}

type Streaming string

const (
	StreamingClient Streaming = "client"
	StreamingServer Streaming = "server"
	StreamingBidi   Streaming = "bidi"
)

type RpcMessage struct {
	Name          string            `json:"name"`
	Fields        []Field           `json:"fields"`
	Discriminator *RpcDiscriminator `json:"discriminator,omitempty"`
}

// RpcDiscriminator explains how a polymorphic OpenAPI message selects its
// concrete shape on the wire.
type RpcDiscriminator struct {
	Property string       `json:"property"`
	Variants []RpcVariant `json:"variants"`
}

type RpcVariant struct {
	Value   string `json:"value"`
	Message string `json:"message"`
}

type HTTPDestination struct {
	Transforms            []HTTPDestinationJoin      `json:"transforms,omitempty"`
	CallSite              string                     `json:"callSite"`
	EndpointExpression    string                     `json:"endpointExpression"`
	Method                string                     `json:"method"`
	LocalPath             string                     `json:"localPath,omitempty"`
	BaseURL               *HTTPBaseURL               `json:"baseURL,omitempty"`
	ServiceDiscoveryAlias string                     `json:"serviceDiscoveryAlias,omitempty"`
	FullPath              string                     `json:"fullPath,omitempty"`
	Join                  *HTTPDestinationJoin       `json:"join,omitempty"`
	Resolution            *HTTPDestinationResolution `json:"resolution,omitempty"`
}
type HTTPBaseURL struct {
	Expression          string `json:"expression"`
	ConfigField         string `json:"configField,omitempty"`
	EnvironmentVariable string `json:"environmentVariable,omitempty"`
	Value               string `json:"value,omitempty"`
	Kind                string `json:"kind"`
	Source              string `json:"source"`
	OptionSource        string `json:"optionSource,omitempty"`
}
type HTTPDestinationJoin struct {
	Expression string `json:"expression"`
	Source     string `json:"source"`
}
type HTTPDestinationResolution struct {
	Basis    string `json:"basis"`
	Provider string `json:"provider"`
	Route    string `json:"route"`
}

type RpcCall struct {
	Evidence    []RelationEvidence `json:"evidence,omitempty"`
	Destination *HTTPDestination   `json:"destination,omitempty"`
	ID          string             `json:"id"`
	Peer        string             `json:"peer"`
	Status      Status             `json:"status"`
	Source      string             `json:"source"`
	Note        string             `json:"note,omitempty"`

	// Module is the module the vendored copy this call was read from belongs to.
	Module string `json:"module,omitempty"`

	// Via is set when the call was derived from a flow step rather than declared.
	Via *EdgeVia `json:"via,omitempty"`
}

// EdgeVia names the flow step a derived consumer or call was read from. A
// plugin never writes one: the host derives edges from flows after the merge,
// and this is how the generated output can say where an arrow came from.
type EdgeVia struct {
	Flow string `json:"flow"`
	Step string `json:"step"`
}

// ProtoModule is a schema module: a set of .proto files with a name, a version
// and a publisher - "buf.build/acme/shop".
//
// It sits at the top level rather than inside the service that publishes it,
// because the interesting fact about a module is usually who ELSE reads it.
//
// Its ID is the module's own registry-global name and NOT "<owner>.<slug>" the
// way a Store's is. A store is declared by exactly one source. A module is
// declared by several that do not know each other - the producer, and each
// consumer reading a vendored copy in another repository - and since the merge
// unions top-level entities BY ID, an owner-derived id would grow one module
// per consumer.
//
// What it carries is identity and inventory, not schema: the interfaces are
// found through RpcService.Module and the shapes live in RpcService.Messages.
type ProtoModule struct {
	// ID is "buf.build/acme/shop", or "local:proto/shop" for a set never
	// published to a registry.
	ID string `json:"id"`

	// Slug is unique across the catalog, and what the URL uses: "acme-shop".
	Slug string `json:"slug"`
	Name string `json:"name"`

	// Registry is "buf.build", empty when the module was never published.
	Registry string `json:"registry,omitempty"`

	// Owner is the service that publishes it, when the estate knows. Empty is
	// an honest answer rather than a defect: a module published by a team, or
	// by a repository outside the estate, is the ordinary case.
	Owner string `json:"owner,omitempty"`

	Commit string `json:"commit,omitempty"`
	Digest string `json:"digest,omitempty"`

	Packages []string `json:"packages"`
	Files    []string `json:"files"`
	Deps     []string `json:"deps,omitempty"`
	Source   string   `json:"source"`
}

type Aggregate struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	Readme string `json:"readme"`
	// Kind is "model-group" for a source grouping without an aggregate boundary.
	Kind         string      `json:"kind,omitempty"`
	Root         string      `json:"root"`
	Entities     []Block     `json:"entities"`
	ValueObjects []Block     `json:"valueObjects"`
	Operations   []Operation `json:"operations"`
	Events       []Event     `json:"events"`
	// Enums are the closed sets the aggregate's fields take values from. A
	// list beside Entities and ValueObjects rather than a Block with values:
	// an enum has no fields, and a consumer switches on it rather than reads
	// it. Omitted when the source declares none.
	Enums     []Enum     `json:"enums,omitempty"`
	Lifecycle *Lifecycle `json:"lifecycle,omitempty"`
}

// Enum is a closed set of values a field can hold - a reason, a status, a
// code. What a consumer of an event switches on, and so what it has to be
// told: free text from a schema row says "reason: Reason", and this is what
// Reason can be.
type Enum struct {
	ID   string `json:"id"` // "<aggregate id>.<slug>"
	Slug string `json:"slug"`
	Name string `json:"name"`
	Doc  string `json:"doc"`
	// Deprecated marks the whole set as on its way out.
	Deprecated bool        `json:"deprecated,omitempty"`
	Values     []EnumValue `json:"values"`
}

// EnumValue is one member of an Enum. Name is what a consumer sees on the
// wire when the source says so - a Go constant's literal - and the variant's
// own name otherwise.
type EnumValue struct {
	Name       string `json:"name"`
	Doc        string `json:"doc"`
	Deprecated bool   `json:"deprecated,omitempty"`
}

// Lifecycle is the root's state machine as the code writes it down: the
// states in the order listed, the first being where a new root starts, and
// every move between them. A state nothing leads out of is terminal.
type Lifecycle struct {
	States      []string     `json:"states"`
	Transitions []Transition `json:"transitions"`
}

// Transition is one move: the method on the root that makes it, and the
// event it hands back for it when it hands one back.
type Transition struct {
	From   string `json:"from"`
	To     string `json:"to"`
	On     string `json:"on"`
	Emits  string `json:"emits,omitempty"`
	Source string `json:"source,omitempty"`
}

type OperationKind string

const (
	OperationCommand OperationKind = "command"
	OperationQuery   OperationKind = "query"
)

type Operation struct {
	ID   string        `json:"id"`
	Kind OperationKind `json:"kind"`
	Doc  string        `json:"doc,omitempty"`
	// ExposedBy names the interface methods that run this operation, as they
	// appear in RpcService.Methods. Empty means nothing outside the service can
	// reach it, which is a fact worth having rather than a gap.
	ExposedBy []string `json:"exposedBy,omitempty"`
}

// Block is an entity or a value object. The two are told apart by the list
// they sit in, not by a field, which is why one struct serves both.
type Block struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Doc  string `json:"doc"`
	// Ref names a shared catalog.defs entry. When it is set the shape is that
	// def's, and Fields is empty; when it is not, Fields carries a shape local
	// to this aggregate.
	Ref    string  `json:"ref,omitempty"`
	Fields []Field `json:"fields,omitempty"`
}

type Event struct {
	ID        string          `json:"id"`
	Slug      string          `json:"slug"`
	Name      string          `json:"name"`
	Versions  []EventVersion  `json:"versions"`
	Consumers []EventConsumer `json:"consumers"`
	// Wire is how the event leaves the service; nil when the source does
	// not say.
	Wire *EventWire `json:"wire,omitempty"`
}

// EventWire is the event as the bus sees it: its name on the message and the
// channel it is published on. A trace carries both, as `event.name` and
// `messaging.destination.name`, and this is where the catalog meets it.
type EventWire struct {
	// Name is the name on the message: "cart.BasketCreated".
	Name string `json:"name"`
	// Channel is the topic, subject or stream: "cart_basket". Empty when the
	// source names the event but not where it goes.
	Channel string `json:"channel,omitempty"`
}

// Channel is a topic, subject or stream a service says it uses, and the
// messages that travel on it. It is what an AsyncAPI document declares, and it
// is the async half of what an OpenAPI document says about routes.
//
// The catalog already knew about channels, but only by inference: an event
// carries a Wire, and the channel was whatever the events happened to name. A
// declaration is a different fact. It says what the service means to put on the
// bus whether or not any event was found saying so, and it says what the
// service listens for - which nothing in a publisher's source could ever say.
type Channel struct {
	// Address is the channel as the broker knows it: "shop.cart.basket". It is
	// the same string an event's Wire.Channel carries, and comparing the two is
	// how a document and the code it belongs to are held against each other.
	Address string `json:"address"`
	// Kind distinguishes domain-event channels, work queues, and generic message
	// streams. Only event channels are checked against the domain event model.
	Kind ChannelKind `json:"kind,omitempty"`

	Title string `json:"title,omitempty"`
	Doc   string `json:"doc,omitempty"`

	Messages []ChannelMessage `json:"messages"`

	// Source is the document this was read out of.
	Source string `json:"source,omitempty"`
}

type ChannelKind string

const (
	ChannelKindEvent   ChannelKind = "event"
	ChannelKindJob     ChannelKind = "job"
	ChannelKindMessage ChannelKind = "message"
)

// ChannelDirection is which way a message travels, from this service's side.
//
// It decides ownership: a service that sends on a channel is publishing on it,
// and a channel has one publisher. A service that only receives is a
// subscriber, and any number of those is fine.
type ChannelDirection string

const (
	ChannelSend    ChannelDirection = "send"
	ChannelReceive ChannelDirection = "receive"
)

// ChannelMessage is one message on a channel, by the name it goes by on the
// wire - the same name an event's Wire.Name carries.
type ChannelMessage struct {
	Name      string           `json:"name"`
	Title     string           `json:"title,omitempty"`
	Doc       string           `json:"doc,omitempty"`
	Direction ChannelDirection `json:"direction"`
	// Encoding is the normalized payload serialization, for example msgpack.
	// It is deliberately open-ended: a catalog must be able to carry a format
	// before Portolan learns special presentation or compatibility rules for it.
	Encoding string `json:"encoding,omitempty"`
	// ContentType keeps the exact media type declared by a contract. Kafka
	// client code commonly proves an encoding without declaring a media type,
	// so the two facts are independent.
	ContentType string `json:"contentType,omitempty"`
}

type EventConsumer struct {
	Service string `json:"service"`
	Status  Status `json:"status"`
	Note    string `json:"note,omitempty"`

	// Via is set when the consumer was derived from a flow step rather than declared.
	Via *EdgeVia `json:"via,omitempty"`
}

type EventVersion struct {
	Version string  `json:"version"`
	Doc     string  `json:"doc"`
	Source  string  `json:"source"`
	Fields  []Field `json:"fields"`
}

type Field struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Doc  string `json:"doc"`
	Ref  string `json:"ref,omitempty"`
	// Number is the protobuf field number when the source carries one. Other
	// schema and domain extractors leave it absent.
	Number int `json:"number,omitempty"`
}

type TypeDef struct {
	Fields []Field `json:"fields"`
}

type StoreKind string

const (
	StoreKindPostgres   StoreKind = "postgres"
	StoreKindMySQL      StoreKind = "mysql"
	StoreKindSQLite     StoreKind = "sqlite"
	StoreKindRedis      StoreKind = "redis"
	StoreKindMongoDB    StoreKind = "mongodb"
	StoreKindClickHouse StoreKind = "clickhouse"
	StoreKindS3         StoreKind = "s3"
	StoreKindDynamoDB   StoreKind = "dynamodb"
	StoreKindOther      StoreKind = "other"
)

type Store struct {
	ID        string          `json:"id"`
	Slug      string          `json:"slug"`
	Name      string          `json:"name"`
	Kind      StoreKind       `json:"kind"`
	Owner     string          `json:"owner"`
	Tables    []Table         `json:"tables"`
	Views     []View          `json:"views,omitempty"`
	Keyspaces []RedisKeyspace `json:"keyspaces,omitempty"`
	Source    string          `json:"source,omitempty"`
}

type RedisOperation string

const (
	RedisOperationRead   RedisOperation = "read"
	RedisOperationWrite  RedisOperation = "write"
	RedisOperationDelete RedisOperation = "delete"
	RedisOperationExists RedisOperation = "exists"
	RedisOperationExpire RedisOperation = "expire"
	RedisOperationCount  RedisOperation = "count"
)

// RedisKeyspace is a family of keys proved by the expressions passed to a
// Redis client. Pattern keeps literal separators and writes dynamic pieces in
// braces; square brackets mark a conditional suffix.
type RedisKeyspace struct {
	Pattern    string           `json:"pattern"`
	Operations []RedisOperation `json:"operations"`
	TTL        string           `json:"ttl,omitempty"`
	Value      string           `json:"value,omitempty"`
	Source     string           `json:"source,omitempty"`
	// Persists links the value stored under this key family back to the domain
	// model. It is optional because a counter, lock or coordination key may not
	// hold an aggregate at all.
	Persists *Persists     `json:"persists,omitempty"`
	Accesses []RedisAccess `json:"accesses,omitempty"`
}

// RedisAccess is one proved client call, kept separately even when several
// calls use the same key family. Operations is the compact schema summary;
// accesses answers who performs each read or write and where the proof lives.
type RedisAccess struct {
	Operation RedisOperation `json:"operation"`
	Method    string         `json:"method,omitempty"`
	TTL       string         `json:"ttl,omitempty"`
	Value     string         `json:"value,omitempty"`
	Source    string         `json:"source,omitempty"`
}

type TableRole string

const (
	TableRoleAggregateRoot TableRole = "aggregate-root"
	TableRoleChild         TableRole = "child"
	TableRoleOutbox        TableRole = "outbox"
	TableRoleProjection    TableRole = "projection"
	TableRoleLookup        TableRole = "lookup"
	TableRoleOther         TableRole = "other"
)

type Table struct {
	Evidence []RelationEvidence `json:"evidence,omitempty"`
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Doc      string             `json:"doc,omitempty"`
	Columns  []Column           `json:"columns"`
	Indexes  []TableIndex       `json:"indexes,omitempty"`
	Persists *Persists          `json:"persists,omitempty"`
	Role     TableRole          `json:"role,omitempty"`
	// Accesses are the source-backed repository methods that touch this table.
	// They answer who reads or writes the rows; the DDL alone cannot.
	Accesses []TableAccess `json:"accesses,omitempty"`
}

type TableOperation string

const (
	TableOperationRead   TableOperation = "read"
	TableOperationWrite  TableOperation = "write"
	TableOperationDelete TableOperation = "delete"
)

// TableAccess is one SQL statement proved inside a repository method.
type TableAccess struct {
	Operation TableOperation `json:"operation"`
	Method    string         `json:"method,omitempty"`
	Source    string         `json:"source,omitempty"`
}

// Persists is the link back to the model: which domain object these rows hold.
type Persists struct {
	Evidence  []RelationEvidence `json:"evidence,omitempty"`
	Aggregate string             `json:"aggregate,omitempty"`
	Block     string             `json:"block,omitempty"`
}

type TableIndex struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
}

type Column struct {
	Name string `json:"name"`
	// Type is the db type as declared - uuid, timestamptz, jsonb - never
	// normalised. A reader comparing a column to a migration wants the string
	// the migration used.
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	PK       bool   `json:"pk,omitempty"`
	FK       *FK    `json:"fk,omitempty"`
	// From is lineage: where this value CAME FROM, as "<table or view id>.<column>".
	// A foreign key answers a different question - which row it points at.
	From []string `json:"from,omitempty"`
	Maps string   `json:"maps,omitempty"`
	Doc  string   `json:"doc,omitempty"`
}

type FK struct {
	Table    string `json:"table"`
	Column   string `json:"column"`
	OnDelete string `json:"onDelete,omitempty"`
}

type View struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Doc  string `json:"doc,omitempty"`
	// Materialized: the database keeps the rows rather than recomputing them,
	// which means they can be stale. A reader has to know that before believing
	// one, so it is drawn differently rather than noted in prose.
	Materialized bool      `json:"materialized,omitempty"`
	Columns      []Column  `json:"columns"`
	Reads        []string  `json:"reads,omitempty"`
	Definition   string    `json:"definition,omitempty"`
	Persists     *Persists `json:"persists,omitempty"`
	Source       string    `json:"source,omitempty"`
}

// Flow is a sequence read out of source. Extractors may attach the execution
// trigger they proved; authored flows omit it when that evidence is not part of
// the document.
type Flow struct {
	ID      string `json:"id"`
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Source  string `json:"source,omitempty"`
	// Trigger says how execution enters this flow and how strong the static
	// evidence is. Authored flows may omit it; source extractors should not.
	Trigger *FlowTrigger `json:"trigger,omitempty"`
	// EntryPoint is the source function this fragment expands. It is machine
	// evidence for composing a queue handler with the outbound flow extracted
	// independently from the same function; ordinary authored flows omit it.
	EntryPoint string `json:"entrypoint,omitempty"`
	// Includes names source-backed flow fragments composed into this root flow.
	// It makes composition idempotent and leaves visible provenance for readers.
	Includes []string `json:"includes,omitempty"`
	// Owner is the bounded context the flow belongs to. The extractor knows it
	// - it read the service's own tree to find the flow - so it says so rather
	// than leaving a reader to work it back out of a path.
	Owner string `json:"owner"`
	// Participants order is significant: it is the lane order.
	Participants []Participant `json:"participants"`
	Steps        FlowNodes     `json:"steps"`
}

type FlowTrigger struct {
	Kind       string `json:"kind"`
	Label      string `json:"label,omitempty"`
	Confidence string `json:"confidence"`
}

type ParticipantKind string

const (
	ParticipantActor    ParticipantKind = "actor"
	ParticipantService  ParticipantKind = "service"
	ParticipantBroker   ParticipantKind = "broker"
	ParticipantStore    ParticipantKind = "store"
	ParticipantExternal ParticipantKind = "external"
	ParticipantUnknown  ParticipantKind = "unknown"
)

type Participant struct {
	ID   string          `json:"id"`
	Kind ParticipantKind `json:"kind"`
	// Context is null for actors and brokers, which is a fact rather than an
	// absence - hence a pointer that marshals to null, not an empty string.
	Context *string `json:"context"`
	Label   string  `json:"label,omitempty"`
}

// FlowNode is one entry in a flow: a step, or one of the three shapes that
// hold steps. It is an interface rather than a struct with four optional
// members so that a renderer has to say which shape it is handling - a flow
// that quietly treats an alt as a sequence reads as "the order was cancelled
// and then charged".
type FlowNode interface {
	NodeType() string
}

// FlowNodes is a list of them. The custom unmarshaller is the only place that
// knows how the union is discriminated on the wire.
type FlowNodes []FlowNode

func (n *FlowNodes) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	out := make(FlowNodes, 0, len(raw))
	for i, item := range raw {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(item, &probe); err != nil {
			return fmt.Errorf("node %d: %w", i, err)
		}

		var node FlowNode
		switch probe.Type {
		case "step":
			node = &Step{}
		case "parallel":
			node = &Parallel{}
		case "alt":
			node = &Alt{}
		case "loop":
			node = &Loop{}
		default:
			return fmt.Errorf("node %d: unknown flow node type %q", i, probe.Type)
		}

		if err := json.Unmarshal(item, node); err != nil {
			return fmt.Errorf("node %d (%s): %w", i, probe.Type, err)
		}
		out = append(out, node)
	}

	*n = out

	return nil
}

type StepKind string

const (
	StepRPC      StepKind = "rpc"
	StepEvent    StepKind = "event"
	StepCall     StepKind = "call"
	StepResponse StepKind = "response"
)

// RelationEvidence records why an extractor or catalog resolution produced a
// relationship. It describes source evidence, never observed execution.
type RelationEvidence struct {
	Kind       string   `json:"kind"`
	Rule       string   `json:"rule"`
	Source     string   `json:"source,omitempty"`
	Symbol     string   `json:"symbol,omitempty"`
	Candidates []string `json:"candidates,omitempty"`
}

type Step struct {
	Evidence    []RelationEvidence `json:"evidence,omitempty"`
	Destination *HTTPDestination   `json:"destination,omitempty"`
	Type        string             `json:"type"`
	ID          string             `json:"id"`
	From        string             `json:"from"`
	// To is a participant id. From == To is a self-message.
	To   string   `json:"to"`
	Kind StepKind `json:"kind"`
	// Ref is an Event.id, an RpcCall.id or a provided RPC method id. It
	// resolves, or Status says unresolved; there is no third option.
	Ref    string `json:"ref,omitempty"`
	Label  string `json:"label,omitempty"`
	Status Status `json:"status"`
	Note   string `json:"note,omitempty"`
	Line   string `json:"line,omitempty"`
	// ReplyTo names the synchronous request step this synthesized response
	// returns from. Extractors record requests; composition adds the response
	// only when it can prove the nested HTTP or unary RPC execution returns.
	ReplyTo string `json:"replyTo,omitempty"`
	// HTTP describes the wire response when source inspection can prove it.
	// BodyRef names the RPC method whose response is serialized, so the merged
	// catalog can resolve the schema without copying it into every flow.
	HTTP *HTTPResponse `json:"http,omitempty"`
	// ContinuesAt names the source function execution enters after this step.
	// The merge uses it only when exactly one flow declares that entry point.
	ContinuesAt string `json:"continuesAt,omitempty"`
	// Reaches names source functions proven to execute on the path represented
	// by this step. The merge may use them to attach independently extracted
	// protocol fragments that expand those exact functions.
	Reaches []string `json:"reaches,omitempty"`
	// Handoff identifies a source-backed send or receive through an asynchronous
	// channel. Matching is exact on kind, channel, and message.
	Handoff *FlowHandoff `json:"handoff,omitempty"`
	// StoreAccess identifies the repository method at extraction time and is
	// enriched with its Redis operation and key family after store fragments
	// have been merged into the catalog.
	StoreAccess *FlowStoreAccess `json:"storeAccess,omitempty"`
}

func (*Step) NodeType() string { return "step" }

type HTTPResponse struct {
	Status      int     `json:"status,omitempty"`
	ContentType string  `json:"contentType,omitempty"`
	Body        string  `json:"body,omitempty"`
	BodyRef     string  `json:"bodyRef,omitempty"`
	Encoding    string  `json:"encoding,omitempty"`
	Outcome     string  `json:"outcome,omitempty"`
	Warning     string  `json:"warning,omitempty"`
	Source      string  `json:"source,omitempty"`
	Fields      []Field `json:"fields,omitempty"`
}

type FlowHandoff struct {
	Kind      string `json:"kind"`
	Transport string `json:"transport"`
	Channel   string `json:"channel"`
	Message   string `json:"message,omitempty"`
	Direction string `json:"direction"`
}

type FlowStoreAccess struct {
	Store     string         `json:"store"`
	Method    string         `json:"method,omitempty"`
	Operation RedisOperation `json:"operation,omitempty"`
	Keyspace  string         `json:"keyspace,omitempty"`
	Source    string         `json:"source,omitempty"`
}

type Parallel struct {
	Type     string      `json:"type"`
	ID       string      `json:"id"`
	Title    string      `json:"title,omitempty"`
	Branches []FlowNodes `json:"branches"`
}

func (*Parallel) NodeType() string { return "parallel" }

// Alt is a choice: exactly one branch runs. The branches are not a sequence
// and nothing that reads a flow may render them as one.
type Alt struct {
	Type     string      `json:"type"`
	ID       string      `json:"id"`
	Branches []AltBranch `json:"branches"`
}

func (*Alt) NodeType() string { return "alt" }

type AltBranch struct {
	// Title is the condition under which this branch runs, in words.
	Title string    `json:"title"`
	Steps FlowNodes `json:"steps"`
	// Terminal marks a branch that ENDS the flow instead of rejoining it.
	// Without it, the steps drawn after the alt read as if they follow this
	// branch too.
	Terminal bool `json:"terminal,omitempty"`
}

type Loop struct {
	Type  string    `json:"type"`
	ID    string    `json:"id"`
	Title string    `json:"title"`
	Steps FlowNodes `json:"steps"`
}

func (*Loop) NodeType() string { return "loop" }

type AdrStatus string

const (
	AdrProposed   AdrStatus = "proposed"
	AdrAccepted   AdrStatus = "accepted"
	AdrSuperseded AdrStatus = "superseded"
	AdrDeprecated AdrStatus = "deprecated"
	AdrRejected   AdrStatus = "rejected"
)

// AdrScope is org-wide, or one context, or one service. The kind says which of
// the two ids is set.
type AdrScope struct {
	Kind    string `json:"kind"`
	Context string `json:"context,omitempty"`
	Service string `json:"service,omitempty"`
}

// Adr is frozen history. It says what was decided and when, not what the model
// looks like now, so nothing on it is ever regenerated from the current
// catalog.
type Adr struct {
	ID           string     `json:"id"`
	Slug         string     `json:"slug"`
	Number       int        `json:"number"`
	Title        string     `json:"title"`
	Status       AdrStatus  `json:"status"`
	Date         string     `json:"date"`
	Scope        AdrScope   `json:"scope"`
	Body         string     `json:"body"`
	Note         string     `json:"note,omitempty"`
	SupersededBy string     `json:"supersededBy,omitempty"`
	Supersedes   []string   `json:"supersedes,omitempty"`
	Relates      AdrRelates `json:"relates"`
	Source       string     `json:"source"`

	// Created is the commit that first added the file, and Revised the one
	// that last touched it, when that is a different commit. Absent when the
	// tree has no history to read.
	Created *AdrCommit `json:"created,omitempty"`
	Revised *AdrCommit `json:"revised,omitempty"`
}

// AdrCommit is one commit of a record's file: who made it and when. The
// markdown says when a decision was taken; git says when it was written down
// and by whom, which is the other half of "who decided this".
type AdrCommit struct {
	Commit string `json:"commit"`
	Author string `json:"author"`
	Date   string `json:"date"`
}

type AdrRelates struct {
	Services []string `json:"services,omitempty"`
	Events   []string `json:"events,omitempty"`
	Flows    []string `json:"flows,omitempty"`
}

// Term is one entry of a context's glossary: a word, and what it means inside
// the boundary that means it.
type Term struct {
	ID         string `json:"id"`
	Slug       string `json:"slug"`
	Context    string `json:"context"`
	Name       string `json:"name"`
	Definition string `json:"definition"`
	Source     string `json:"source"`
}
