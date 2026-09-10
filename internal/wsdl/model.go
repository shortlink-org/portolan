// Package wsdl reads local WSDL 1.1 contracts and the XML Schemas they reach.
//
// It deliberately performs no network access. A remote import is evidence that
// part of a contract is unavailable in the checkout, and is returned as a
// warning rather than fetched behind the caller's back.
package wsdl

// Contract is one WSDL service, or one standalone port type when the document
// does not declare a service.
type Contract struct {
	Name       string
	Namespace  string
	Summary    string
	Source     string
	Interfaces []Interface
}

// Interface is a WSDL port bound to one SOAP binding. Keeping the port rather
// than flattening the whole document preserves distinct endpoints and SOAP
// versions when a service publishes more than one.
type Interface struct {
	Name       string
	Binding    string
	PortType   string
	Endpoint   string
	Version    string
	Style      string
	Operations []Operation
	Messages   []Message
}

// Operation joins the abstract portType operation to its concrete SOAP
// binding. Request, response and faults name entries in Interface.Messages.
type Operation struct {
	Name     string
	Action   string
	Doc      string
	Request  string
	Response string
	Faults   []string
	Headers  []string
}

// Message is a WSDL message or an XSD complex type reachable from one.
type Message struct {
	Name   string
	Fields []Field
}

// Field is the compact XML shape the catalog can display.
type Field struct {
	Name string
	Type string
	Doc  string
}

// Result is deterministic: contracts, interfaces, operations and messages are
// sorted by the parser before they leave the package.
type Result struct {
	Contracts []Contract
	// Warnings are what stopped a document from being read in full: a remote
	// import, a port whose binding is not here. They matter to anyone reading
	// the contracts, including a client extractor resolving calls against them.
	Warnings []string
	// SchemaWarnings are about the quality of the schemas themselves, such as
	// one name declared twice in a namespace. Nothing failed to resolve; the
	// loader kept the first and says so. They belong to whoever publishes the
	// contracts, not to every extractor that happens to read them.
	SchemaWarnings []string
}
