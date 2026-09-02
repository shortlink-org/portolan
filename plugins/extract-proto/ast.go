package main

// What a .proto file says, as it says it.
//
// Types are kept AS WRITTEN - `repeated Money`, `map<string, LineItem>`, the
// `optional` keyword, the author's declaration order. The catalog already
// takes this stance for schemas ("the db type as declared - uuid, timestamptz,
// jsonb - never normalised"), and a reader comparing a page against the file it
// came from should recognise what they are looking at.

// File is one parsed .proto.
type File struct {
	// Path is the file as a reader would type it, relative to the repo root.
	Path string

	// Doc is the comment at the very top of the file, above `syntax`.
	//
	// On a vendored copy this is where the header lives that says which module
	// it came from - docs/adr/org.0001.md requires one - so it is worth keeping
	// apart from the documentation of any declaration inside.
	Doc string

	Syntax   string // "proto2", "proto3", "editions", or "" when unstated
	Package  string
	Imports  []Import
	Options  []Option
	Messages []*Message
	Enums    []*Enum
	Services []*Service
}

type Import struct {
	Path   string
	Public bool
	Weak   bool
	Line   int
}

type Option struct {
	Name  string
	Value string
	Line  int
}

type Message struct {
	Name string
	Doc  string
	Line int

	// Fields holds every field of the message, including the members of its
	// oneofs, in declaration order. A oneof is a constraint on which of them may
	// be set, not a separate place a field lives, so a reader asking "what is in
	// this message" gets one list.
	Fields   []*Field
	Oneofs   []*Oneof
	Messages []*Message // nested
	Enums    []*Enum
	Reserved []string
}

type Field struct {
	Name string
	Doc  string
	Line int

	// Type as written: "string", "Money", "shop.v1.Money", "map<string, Money>".
	Type   string
	Label  string // "", "repeated", "optional", "required"
	Number int

	// Oneof names the oneof this field belongs to, empty when it is not in one.
	Oneof      string
	Deprecated bool
	Default    string
}

type Oneof struct {
	Name   string
	Doc    string
	Line   int
	Fields []*Field
}

type Enum struct {
	Name   string
	Doc    string
	Line   int
	Values []*EnumValue
}

type EnumValue struct {
	Name   string
	Doc    string
	Number int
	Line   int
}

type Service struct {
	Name    string
	Doc     string
	Line    int
	Methods []*Method
}

type Method struct {
	Name string
	Doc  string
	Line int

	Request         string
	Response        string
	ClientStreaming bool
	ServerStreaming bool
	Deprecated      bool
}

// Note is something the parser declined to model, named rather than dropped.
//
// A construct the parser skips silently is a construct nobody knows is missing.
// Every one of these becomes a plugin diagnostic, so an estate using `extend`
// or a proto2 `group` finds out that portolan read past it.
type Note struct {
	Line    int
	Message string
}
