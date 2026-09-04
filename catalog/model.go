// Package catalog is the Go side of the contract in src/catalog.ts.
//
// It is a MIRROR, not a second definition. The TypeScript file is where the
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
	GeneratedAt string             `json:"generatedAt"`
	Commit      string             `json:"commit"`
	Contexts    []BoundedContext   `json:"contexts"`
	Defs        map[string]TypeDef `json:"defs"`
	Flows       []Flow             `json:"flows"`
	Adrs        []Adr              `json:"adrs"`
	Stores      []Store            `json:"stores,omitempty"`
	Modules     []ProtoModule      `json:"modules,omitempty"`
}

type Classification string

const (
	ClassificationCore       Classification = "core"
	ClassificationSupporting Classification = "supporting"
	ClassificationGeneric    Classification = "generic"
)

type BoundedContext struct {
	ID             string         `json:"id"`
	Slug           string         `json:"slug"`
	Name           string         `json:"name"`
	Summary        string         `json:"summary"`
	Classification Classification `json:"classification,omitempty"`
	ViewID         string         `json:"viewId,omitempty"`
	Services       []Service      `json:"services"`
}

type Service struct {
	ID         string       `json:"id"`
	Slug       string       `json:"slug"`
	Name       string       `json:"name"`
	Repo       string       `json:"repo"`
	Path       string       `json:"path"`
	Readme     string       `json:"readme"`
	Provides   []RpcService `json:"provides"`
	Consumes   []RpcCall    `json:"consumes"`
	Aggregates []Aggregate  `json:"aggregates"`
	// Stores this service touches, by id. Ownership is not stated here - a
	// store names its own owner, so an id in this list that the store does not
	// call its owner is a read.
	Stores []string `json:"stores,omitempty"`

	// Modules this service publishes or vendors, by id. Same rule as Stores: a
	// module names its own owner, so an id here that does not call this service
	// its owner is one the service reads.
	Modules []string `json:"modules,omitempty"`
}

type RpcService struct {
	ID       string       `json:"id"`
	Methods  []RpcMethod  `json:"methods"`
	Source   string       `json:"source"`
	Messages []RpcMessage `json:"messages,omitempty"`

	// Module is the schema module declaring this interface, by ProtoModule.ID.
	Module string `json:"module,omitempty"`
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
}

type HttpRoute struct {
	// Method is upper case: POST.
	Method string `json:"method"`
	// Path is the template as the document writes it: /v1/users/{id}.
	Path string `json:"path"`
}

type Streaming string

const (
	StreamingClient Streaming = "client"
	StreamingServer Streaming = "server"
	StreamingBidi   Streaming = "bidi"
)

type RpcMessage struct {
	Name   string  `json:"name"`
	Fields []Field `json:"fields"`
}

type RpcCall struct {
	ID     string `json:"id"`
	Peer   string `json:"peer"`
	Status Status `json:"status"`
	Source string `json:"source"`
	Note   string `json:"note,omitempty"`

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
	ID           string      `json:"id"`
	Slug         string      `json:"slug"`
	Name         string      `json:"name"`
	Readme       string      `json:"readme"`
	Root         string      `json:"root"`
	Entities     []Block     `json:"entities"`
	ValueObjects []Block     `json:"valueObjects"`
	Operations   []Operation `json:"operations"`
	Events       []Event     `json:"events"`
	Lifecycle    *Lifecycle  `json:"lifecycle,omitempty"`
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
	StoreKindKafkaTopic StoreKind = "kafka-topic"
	StoreKindOther      StoreKind = "other"
)

type Store struct {
	ID     string    `json:"id"`
	Slug   string    `json:"slug"`
	Name   string    `json:"name"`
	Kind   StoreKind `json:"kind"`
	Owner  string    `json:"owner"`
	Tables []Table   `json:"tables"`
	Views  []View    `json:"views,omitempty"`
	Source string    `json:"source,omitempty"`
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
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Doc      string       `json:"doc,omitempty"`
	Columns  []Column     `json:"columns"`
	Indexes  []TableIndex `json:"indexes,omitempty"`
	Persists *Persists    `json:"persists,omitempty"`
	Role     TableRole    `json:"role,omitempty"`
}

// Persists is the link back to the model: which domain object these rows hold.
type Persists struct {
	Aggregate string `json:"aggregate,omitempty"`
	Block     string `json:"block,omitempty"`
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

// Flow is a sequence read out of source. Every one of them is derived the same
// way, which is why nothing here says where it came from: a field whose value
// is the same on every record answers a question nobody can ask.
type Flow struct {
	ID      string `json:"id"`
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Source  string `json:"source,omitempty"`
	// Owner is the bounded context the flow belongs to. The extractor knows it
	// - it read the service's own tree to find the flow - so it says so rather
	// than leaving a reader to work it back out of a path.
	Owner string `json:"owner"`
	// Participants order is significant: it is the lane order.
	Participants []Participant `json:"participants"`
	Steps        FlowNodes     `json:"steps"`
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
	StepRPC   StepKind = "rpc"
	StepEvent StepKind = "event"
	StepCall  StepKind = "call"
)

type Step struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	From string `json:"from"`
	// To is a participant id. From == To is a self-message.
	To   string   `json:"to"`
	Kind StepKind `json:"kind"`
	// Ref is an Event.id or an RpcCall.id. It resolves, or Status says
	// unresolved; there is no third option.
	Ref    string `json:"ref,omitempty"`
	Label  string `json:"label,omitempty"`
	Status Status `json:"status"`
	Note   string `json:"note,omitempty"`
	Line   string `json:"line,omitempty"`
}

func (*Step) NodeType() string { return "step" }

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
	SupersededBy string     `json:"supersededBy,omitempty"`
	Supersedes   []string   `json:"supersedes,omitempty"`
	Relates      AdrRelates `json:"relates"`
	Source       string     `json:"source"`
}

type AdrRelates struct {
	Services []string `json:"services,omitempty"`
	Events   []string `json:"events,omitempty"`
	Flows    []string `json:"flows,omitempty"`
}
