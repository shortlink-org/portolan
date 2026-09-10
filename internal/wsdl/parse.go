package wsdl

import (
	"encoding/xml"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	soap11WSDL = "http://schemas.xmlsoap.org/wsdl/soap/"
	soap12WSDL = "http://schemas.xmlsoap.org/wsdl/soap12/"
	xsdNS      = "http://www.w3.org/2001/XMLSchema"
)

type qname struct {
	ns    string
	local string
}

type node struct {
	name     xml.Name
	attrs    []xml.Attr
	ns       map[string]string
	text     string
	children []*node
}

func (n *node) attr(name string) string {
	for _, attr := range n.attrs {
		if attr.Name.Local == name && attr.Name.Space != "xmlns" {
			return strings.TrimSpace(attr.Value)
		}
	}
	return ""
}

func (n *node) child(name string) *node {
	for _, child := range n.children {
		if child.name.Local == name {
			return child
		}
	}
	return nil
}

func (n *node) childrenNamed(name string) []*node {
	var out []*node
	for _, child := range n.children {
		if child.name.Local == name {
			out = append(out, child)
		}
	}
	return out
}

func (n *node) documentation() string {
	doc := n.child("documentation")
	if doc == nil {
		annotation := n.child("annotation")
		if annotation != nil {
			doc = annotation.child("documentation")
		}
	}
	if doc == nil {
		return ""
	}
	return strings.Join(strings.Fields(doc.deepText()), " ")
}

func (n *node) deepText() string {
	parts := []string{n.text}
	for _, child := range n.children {
		parts = append(parts, child.deepText())
	}
	return strings.Join(parts, " ")
}

func parseXML(reader io.Reader) (*node, error) {
	decoder := xml.NewDecoder(reader)
	rootNS := map[string]string{"xml": "http://www.w3.org/XML/1998/namespace"}
	var root *node
	var stack []*node
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch value := token.(type) {
		case xml.StartElement:
			inScope := rootNS
			if len(stack) > 0 {
				inScope = stack[len(stack)-1].ns
			}
			namespaces := make(map[string]string, len(inScope)+2)
			for prefix, namespace := range inScope {
				namespaces[prefix] = namespace
			}
			for _, attr := range value.Attr {
				switch {
				case attr.Name.Space == "xmlns":
					namespaces[attr.Name.Local] = attr.Value
				case attr.Name.Space == "" && attr.Name.Local == "xmlns":
					namespaces[""] = attr.Value
				}
			}
			current := &node{name: value.Name, attrs: value.Attr, ns: namespaces}
			if len(stack) == 0 {
				root = current
			} else {
				parent := stack[len(stack)-1]
				parent.children = append(parent.children, current)
			}
			stack = append(stack, current)
		case xml.CharData:
			if len(stack) > 0 {
				stack[len(stack)-1].text += string(value)
			}
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	if root == nil {
		return nil, fmt.Errorf("empty XML document")
	}
	return root, nil
}

type document struct {
	path string
	root *node
}

type loader struct {
	root       string
	docs       map[string]*document
	loaded     map[string]bool
	adopted    map[string]map[string]bool
	warnings   []string
	duplicates []duplicate
}

// duplicate is one name declared again in a namespace: where the second
// declaration was found, and where the one the index kept came from.
type duplicate struct {
	path      string
	name      string
	namespace string
	origin    string
}

// Read loads one WSDL document and every local WSDL/XSD import or include it
// reaches. spec is relative to root.
func Read(root, spec string) (Result, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return Result{}, err
	}
	l := newLoader(absRoot)
	path, err := l.localPath(absRoot, spec)
	if err != nil {
		return Result{}, err
	}
	if err := l.load(path, ""); err != nil {
		return Result{}, err
	}
	result := l.result([]string{path}, true)
	return result, nil
}

// Discover reads every WSDL in root. Imported interface-only documents are
// used to complete their parent and are not emitted a second time.
func Discover(root string) (Result, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return Result{}, err
	}
	var candidates []string
	err = filepath.WalkDir(absRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != absRoot && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".wsdl") {
			candidates = append(candidates, path)
		}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	sort.Strings(candidates)
	var roots []string
	for _, path := range candidates {
		file, openErr := os.Open(path)
		if openErr != nil {
			return Result{}, openErr
		}
		node, parseErr := parseXML(file)
		_ = file.Close()
		if parseErr != nil {
			return Result{}, fmt.Errorf("%s: %w", path, parseErr)
		}
		if node.name.Local == "definitions" && len(node.childrenNamed("service")) > 0 {
			roots = append(roots, path)
		}
	}
	standalone := false
	if len(roots) == 0 {
		// Some repositories keep only the reusable portType document. It is
		// still a useful contract when no service document exists to own it.
		roots = candidates
		standalone = true
	}
	combined := Result{}
	for _, path := range roots {
		l := newLoader(absRoot)
		if err := l.load(path, ""); err != nil {
			return Result{}, err
		}
		part := l.result([]string{path}, standalone)
		combined.Contracts = append(combined.Contracts, part.Contracts...)
		combined.Warnings = append(combined.Warnings, part.Warnings...)
	}
	combined.Contracts = uniqueContracts(combined.Contracts)
	combined.Warnings = unique(combined.Warnings)
	sort.Slice(combined.Contracts, func(i, j int) bool {
		if combined.Contracts[i].Name != combined.Contracts[j].Name {
			return combined.Contracts[i].Name < combined.Contracts[j].Name
		}
		return combined.Contracts[i].Source < combined.Contracts[j].Source
	})
	sort.Strings(combined.Warnings)
	return combined, nil
}

func newLoader(root string) *loader {
	return &loader{
		root: root, docs: map[string]*document{}, loaded: map[string]bool{},
		adopted: map[string]map[string]bool{},
	}
}

func (l *loader) localPath(from, location string) (string, error) {
	if strings.TrimSpace(location) == "" {
		return "", fmt.Errorf("empty WSDL path")
	}
	if parsed, err := url.Parse(location); err == nil && parsed.Scheme != "" {
		return "", fmt.Errorf("remote import %q is not read", location)
	}
	path := location
	if !filepath.IsAbs(path) {
		path = filepath.Join(from, filepath.FromSlash(path))
	}
	path, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(l.root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("import %q leaves the input root", location)
	}
	return path, nil
}

func (l *loader) load(path, adoptedNS string) error {
	key := path + "\x00" + adoptedNS
	if l.loaded[key] {
		return nil
	}
	l.loaded[key] = true
	doc := l.docs[path]
	if doc == nil {
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		root, parseErr := parseXML(file)
		closeErr := file.Close()
		if parseErr != nil {
			return fmt.Errorf("%s: %w", path, parseErr)
		}
		if closeErr != nil {
			return closeErr
		}
		doc = &document{path: path, root: root}
		l.docs[path] = doc
	}
	if doc.root.name.Local == "schema" && doc.root.attr("targetNamespace") == "" && adoptedNS != "" {
		if l.adopted[path] == nil {
			l.adopted[path] = map[string]bool{}
		}
		l.adopted[path][adoptedNS] = true
	}

	for _, ref := range importReferences(doc.root, adoptedNS) {
		imported, err := l.localPath(filepath.Dir(path), ref.location)
		if err != nil {
			rel, _ := filepath.Rel(l.root, path)
			l.warnings = append(l.warnings, filepath.ToSlash(rel)+": "+err.Error())
			continue
		}
		if err := l.load(imported, ref.adoptedNS); err != nil {
			rel, _ := filepath.Rel(l.root, path)
			l.warnings = append(l.warnings, filepath.ToSlash(rel)+": import "+ref.location+": "+err.Error())
		}
	}
	return nil
}

type importReference struct {
	location  string
	adoptedNS string
}

func importReferences(root *node, inheritedNS string) []importReference {
	var out []importReference
	var walk func(*node, string)
	walk = func(n *node, schemaNS string) {
		if n.name.Local == "schema" {
			schemaNS = first(n.attr("targetNamespace"), schemaNS)
		}
		if n.name.Local == "import" || n.name.Local == "include" || n.name.Local == "redefine" {
			if location := first(n.attr("location"), n.attr("schemaLocation")); location != "" {
				adopted := ""
				if n.name.Local == "include" || n.name.Local == "redefine" {
					adopted = schemaNS
				}
				out = append(out, importReference{location: location, adoptedNS: adopted})
			}
		}
		for _, child := range n.children {
			walk(child, schemaNS)
		}
	}
	walk(root, inheritedNS)
	seen := map[string]bool{}
	var uniqueRefs []importReference
	for _, ref := range out {
		key := ref.location + "\x00" + ref.adoptedNS
		if !seen[key] {
			uniqueRefs = append(uniqueRefs, ref)
			seen[key] = true
		}
	}
	return uniqueRefs
}

type index struct {
	messages     map[qname]*node
	portTypes    map[qname]*node
	bindings     map[qname]*node
	elements     map[qname]*node
	complexTypes map[qname]*node
	namespace    map[*node]string
	// origin is the document each indexed node was read from, so a duplicate
	// can say which declaration won.
	origin map[*node]string
}

func (l *loader) buildIndex() index {
	ix := index{
		messages: map[qname]*node{}, portTypes: map[qname]*node{}, bindings: map[qname]*node{},
		elements: map[qname]*node{}, complexTypes: map[qname]*node{}, namespace: map[*node]string{},
		origin: map[*node]string{},
	}
	paths := make([]string, 0, len(l.docs))
	for path := range l.docs {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		root := l.docs[path].root
		source := l.relative(path)
		switch root.name.Local {
		case "definitions":
			ns := root.attr("targetNamespace")
			ix.namespace[root] = ns
			for _, child := range root.children {
				switch child.name.Local {
				case "message":
					ix.put(ix.messages, qname{ns, child.attr("name")}, child, &l.duplicates, source)
				case "portType", "interface":
					ix.put(ix.portTypes, qname{ns, child.attr("name")}, child, &l.duplicates, source)
				case "binding":
					ix.put(ix.bindings, qname{ns, child.attr("name")}, child, &l.duplicates, source)
				case "types":
					for _, schema := range child.childrenNamed("schema") {
						ix.addSchema(schema, source, "", &l.duplicates)
					}
				}
			}
		case "schema":
			namespaces := []string{root.attr("targetNamespace")}
			if namespaces[0] == "" && len(l.adopted[path]) > 0 {
				namespaces = namespaces[:0]
				for namespace := range l.adopted[path] {
					namespaces = append(namespaces, namespace)
				}
				sort.Strings(namespaces)
			}
			for _, namespace := range namespaces {
				ix.addSchema(root, source, namespace, &l.duplicates)
			}
		}
	}
	return ix
}

func (ix *index) addSchema(schema *node, path, adoptedNS string, duplicates *[]duplicate) {
	ns := first(schema.attr("targetNamespace"), adoptedNS)
	ix.namespace[schema] = ns
	for _, child := range schema.children {
		switch child.name.Local {
		case "element":
			ix.put(ix.elements, qname{ns, child.attr("name")}, child, duplicates, path)
		case "complexType":
			ix.put(ix.complexTypes, qname{ns, child.attr("name")}, child, duplicates, path)
		}
	}
}

// put keeps the first declaration of a name and records every later one.
// Documents are indexed in path order, so "first" is the alphabetically
// earliest file, and the same file read under two adopted namespaces is
// the same node and not a duplicate of itself.
func (ix *index) put(target map[qname]*node, key qname, value *node, duplicates *[]duplicate, path string) {
	if key.local == "" {
		return
	}
	if previous, exists := target[key]; exists && previous != value {
		*duplicates = append(*duplicates, duplicate{path: path, name: key.local, namespace: key.ns, origin: ix.origin[previous]})
		return
	}
	target[key] = value
	ix.origin[value] = path
}

func (l *loader) result(rootPaths []string, includeStandalone bool) Result {
	ix := l.buildIndex()
	var contracts []Contract
	for _, path := range rootPaths {
		doc := l.docs[path]
		if doc == nil || doc.root.name.Local != "definitions" {
			continue
		}
		definitions := doc.root
		namespace := definitions.attr("targetNamespace")
		services := definitions.childrenNamed("service")
		if len(services) == 0 && includeStandalone {
			contract := Contract{Name: first(definitions.attr("name"), strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))), Namespace: namespace, Summary: definitions.documentation(), Source: l.relative(path)}
			for _, portType := range definitions.childrenNamed("portType") {
				contract.Interfaces = append(contract.Interfaces, ix.abstractInterface(portType))
			}
			if len(contract.Interfaces) > 0 {
				contracts = append(contracts, contract)
			}
			continue
		}
		for _, service := range services {
			contract := Contract{Name: first(service.attr("name"), definitions.attr("name")), Namespace: namespace, Summary: first(service.documentation(), definitions.documentation()), Source: l.relative(path)}
			for _, port := range service.childrenNamed("port") {
				if iface, ok := ix.boundInterface(port); ok {
					contract.Interfaces = append(contract.Interfaces, iface)
				} else {
					l.warnings = append(l.warnings, l.relative(path)+": port "+first(port.attr("name"), "<unnamed>")+" refers to a binding or portType that is not available locally")
				}
			}
			if len(contract.Interfaces) > 0 {
				contracts = append(contracts, contract)
			}
		}
	}
	contracts = uniqueContracts(contracts)
	for i := range contracts {
		sort.Slice(contracts[i].Interfaces, func(a, b int) bool { return contracts[i].Interfaces[a].Name < contracts[i].Interfaces[b].Name })
	}
	sort.Slice(contracts, func(i, j int) bool {
		if contracts[i].Name != contracts[j].Name {
			return contracts[i].Name < contracts[j].Name
		}
		return contracts[i].Source < contracts[j].Source
	})
	sort.Strings(l.warnings)
	return Result{Contracts: contracts, Warnings: unique(l.warnings), SchemaWarnings: summarizeDuplicates(l.duplicates)}
}

// summarizeDuplicates says once per namespace and winning document which
// names were declared again and where. A schema copied beside every WSDL that
// uses it is one finding, not one per type; the reader fixing it wants the
// file that is kept, the files that repeat it, and enough names to recognise
// the copy.
func summarizeDuplicates(duplicates []duplicate) []string {
	type group struct {
		namespace string
		origin    string
		names     []string
		paths     []string
	}
	groups := map[string]*group{}
	var keys []string
	for _, d := range duplicates {
		key := d.namespace + "\x00" + d.origin
		found := groups[key]
		if found == nil {
			found = &group{namespace: d.namespace, origin: d.origin}
			groups[key] = found
			keys = append(keys, key)
		}
		found.names = append(found.names, d.name)
		found.paths = append(found.paths, d.path)
	}
	sort.Strings(keys)
	var out []string
	for _, key := range keys {
		found := groups[key]
		names := unique(found.names)
		paths := unique(found.paths)
		sort.Strings(paths)
		var b strings.Builder
		b.WriteString(paths[0] + ": duplicate declaration " + names[0])
		if len(names) > 1 {
			fmt.Fprintf(&b, " and %d more", len(names)-1)
		}
		b.WriteString(" in namespace " + found.namespace)
		if len(paths) > 1 {
			b.WriteString(" (also in " + strings.Join(paths[1:], ", ") + ")")
		}
		if len(names) > 1 {
			b.WriteString("; the declarations in " + found.origin + " are used")
		} else {
			b.WriteString("; the declaration in " + found.origin + " is used")
		}
		out = append(out, b.String())
	}
	return out
}

func (l *loader) relative(path string) string {
	rel, err := filepath.Rel(l.root, path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(rel)
}

func (ix index) abstractInterface(portType *node) Interface {
	iface := Interface{Name: portType.attr("name"), PortType: portType.attr("name")}
	iface.Operations, iface.Messages = ix.operations(portType, nil)
	return iface
}

func (ix index) boundInterface(port *node) (Interface, bool) {
	bindingRef := resolveQName(port, port.attr("binding"), "")
	binding := ix.lookup(ix.bindings, bindingRef)
	if binding == nil {
		return Interface{}, false
	}
	portTypeRef := resolveQName(binding, binding.attr("type"), bindingRef.ns)
	portType := ix.lookup(ix.portTypes, portTypeRef)
	if portType == nil {
		return Interface{}, false
	}
	version, style := bindingSOAP(binding)
	endpoint := ""
	for _, child := range port.children {
		if child.name.Local == "address" && (child.name.Space == soap11WSDL || child.name.Space == soap12WSDL || strings.Contains(child.name.Space, "soap")) {
			endpoint = child.attr("location")
			if child.name.Space == soap12WSDL {
				version = "1.2"
			} else if version == "" {
				version = "1.1"
			}
		}
	}
	iface := Interface{Name: first(port.attr("name"), binding.attr("name")), Binding: binding.attr("name"), PortType: portType.attr("name"), Endpoint: endpoint, Version: version, Style: style}
	iface.Operations, iface.Messages = ix.operations(portType, binding)
	return iface, true
}

func bindingSOAP(binding *node) (version, style string) {
	for _, child := range binding.children {
		if child.name.Local != "binding" {
			continue
		}
		if child.name.Space == soap12WSDL {
			version = "1.2"
		} else if child.name.Space == soap11WSDL || strings.Contains(child.name.Space, "soap") {
			version = "1.1"
		}
		style = child.attr("style")
	}
	return version, style
}

func (ix index) operations(portType, binding *node) ([]Operation, []Message) {
	bindingOps := map[string]*node{}
	if binding != nil {
		for _, operation := range binding.childrenNamed("operation") {
			bindingOps[operation.attr("name")] = operation
		}
	}
	var operations []Operation
	messageRefs := map[qname]bool{}
	for _, abstract := range portType.childrenNamed("operation") {
		name := abstract.attr("name")
		bound := bindingOps[name]
		operation := Operation{Name: name, Doc: abstract.documentation()}
		if input := abstract.child("input"); input != nil {
			ref := resolveQName(input, input.attr("message"), "")
			operation.Request = ref.local
			messageRefs[ref] = ref.local != ""
		}
		if output := abstract.child("output"); output != nil {
			ref := resolveQName(output, output.attr("message"), "")
			operation.Response = ref.local
			messageRefs[ref] = ref.local != ""
		}
		for _, fault := range abstract.childrenNamed("fault") {
			ref := resolveQName(fault, fault.attr("message"), "")
			faultName := first(fault.attr("name"), ref.local)
			if faultName != "" {
				operation.Faults = append(operation.Faults, faultName)
			}
			messageRefs[ref] = ref.local != ""
		}
		if bound != nil {
			for _, child := range bound.children {
				if child.name.Local == "operation" && (child.name.Space == soap11WSDL || child.name.Space == soap12WSDL || strings.Contains(child.name.Space, "soap")) {
					operation.Action = first(child.attr("soapAction"), child.attr("soapActionURI"))
				}
			}
			operation.Headers = bindingHeaders(bound)
			if operation.Doc == "" {
				operation.Doc = bound.documentation()
			}
		}
		operation.Faults = unique(operation.Faults)
		operations = append(operations, operation)
	}
	var messages []Message
	seen := map[string]bool{}
	var typeQueue []qname
	refs := make([]qname, 0, len(messageRefs))
	for ref, present := range messageRefs {
		if present {
			refs = append(refs, ref)
		}
	}
	sort.Slice(refs, func(i, j int) bool { return qnameLess(refs[i], refs[j]) })
	for _, ref := range refs {
		message, reached := ix.message(ref)
		if message.Name != "" && !seen[message.Name] {
			messages = append(messages, message)
			seen[message.Name] = true
		}
		typeQueue = append(typeQueue, reached...)
	}
	for len(typeQueue) > 0 {
		ref := typeQueue[0]
		typeQueue = typeQueue[1:]
		if ref.local == "" || seen[ref.local] || builtin(ref) {
			continue
		}
		complex := ix.lookup(ix.complexTypes, ref)
		if complex == nil {
			continue
		}
		fields, reached := ix.shape(complex, map[qname]bool{})
		messages = append(messages, Message{Name: ref.local, Fields: fields})
		seen[ref.local] = true
		typeQueue = append(typeQueue, reached...)
	}
	sort.Slice(operations, func(i, j int) bool { return operations[i].Name < operations[j].Name })
	sort.Slice(messages, func(i, j int) bool { return messages[i].Name < messages[j].Name })
	return operations, messages
}

func bindingHeaders(operation *node) []string {
	var headers []string
	for _, direction := range []string{"input", "output"} {
		container := operation.child(direction)
		if container == nil {
			continue
		}
		for _, child := range container.children {
			if child.name.Local != "header" || !(child.name.Space == soap11WSDL || child.name.Space == soap12WSDL || strings.Contains(child.name.Space, "soap")) {
				continue
			}
			message := resolveQName(child, child.attr("message"), "").local
			header := first(child.attr("part"), message)
			if message != "" && child.attr("part") != "" {
				header = message + "." + child.attr("part")
			}
			if header != "" {
				headers = append(headers, header)
			}
		}
	}
	return unique(headers)
}

func (ix index) message(ref qname) (Message, []qname) {
	messageNode := ix.lookup(ix.messages, ref)
	if messageNode == nil {
		return Message{Name: ref.local}, nil
	}
	message := Message{Name: messageNode.attr("name")}
	var reached []qname
	parts := messageNode.childrenNamed("part")
	for _, part := range parts {
		if elementValue := part.attr("element"); elementValue != "" {
			elementRef := resolveQName(part, elementValue, ref.ns)
			element := ix.lookup(ix.elements, elementRef)
			if element != nil && len(parts) == 1 {
				fields, refs := ix.elementShape(element, elementRef.ns)
				if len(fields) > 0 {
					message.Fields = append(message.Fields, fields...)
					reached = append(reached, refs...)
					continue
				}
			}
			typeName := elementRef.local
			if element != nil && element.attr("type") != "" {
				typeRef := resolveQName(element, element.attr("type"), elementRef.ns)
				typeName = typeLabel(typeRef)
				reached = append(reached, typeRef)
			}
			message.Fields = append(message.Fields, Field{Name: first(part.attr("name"), elementRef.local), Type: typeName, Doc: documentationOf(element)})
			continue
		}
		typeRef := resolveQName(part, part.attr("type"), ref.ns)
		message.Fields = append(message.Fields, Field{Name: first(part.attr("name"), "value"), Type: typeLabel(typeRef), Doc: part.documentation()})
		reached = append(reached, typeRef)
	}
	return message, reached
}

func (ix index) elementShape(element *node, fallbackNS string) ([]Field, []qname) {
	if inline := element.child("complexType"); inline != nil {
		return ix.shape(inline, map[qname]bool{})
	}
	typeRef := resolveQName(element, element.attr("type"), fallbackNS)
	if complex := ix.lookup(ix.complexTypes, typeRef); complex != nil {
		fields, refs := ix.shape(complex, map[qname]bool{typeRef: true})
		return fields, append(refs, typeRef)
	}
	return nil, []qname{typeRef}
}

func (ix index) shape(complex *node, resolving map[qname]bool) ([]Field, []qname) {
	var fields []Field
	var refs []qname
	var walk func(*node)
	walk = func(current *node) {
		for _, child := range current.children {
			switch child.name.Local {
			case "extension", "restriction":
				base := resolveQName(child, child.attr("base"), "")
				if !builtin(base) && !resolving[base] {
					if parent := ix.lookup(ix.complexTypes, base); parent != nil {
						resolving[base] = true
						parentFields, parentRefs := ix.shape(parent, resolving)
						delete(resolving, base)
						fields = append(fields, parentFields...)
						refs = append(refs, parentRefs...)
					}
				}
				walk(child)
			case "sequence", "all", "choice", "complexContent", "simpleContent", "group":
				walk(child)
			case "element":
				name := child.attr("name")
				ref := resolveQName(child, child.attr("ref"), "")
				if name == "" {
					name = ref.local
				}
				typeRef := resolveQName(child, child.attr("type"), "")
				if typeRef.local == "" && ref.local != "" {
					if declared := ix.lookup(ix.elements, ref); declared != nil {
						typeRef = resolveQName(declared, declared.attr("type"), ref.ns)
						if name == "" {
							name = declared.attr("name")
						}
					}
				}
				typeName := typeLabel(typeRef)
				if inline := child.child("complexType"); inline != nil {
					typeName = first(name, "object")
				}
				if typeName == "" {
					typeName = "any"
				}
				if max := child.attr("maxOccurs"); max == "unbounded" || (max != "" && max != "1") {
					typeName += "[]"
				}
				fields = append(fields, Field{Name: name, Type: typeName, Doc: child.documentation()})
				refs = append(refs, typeRef)
			case "attribute":
				name := first(child.attr("name"), resolveQName(child, child.attr("ref"), "").local)
				typeRef := resolveQName(child, child.attr("type"), "")
				fields = append(fields, Field{Name: "@" + name, Type: first(typeLabel(typeRef), "string"), Doc: child.documentation()})
				refs = append(refs, typeRef)
			}
		}
	}
	walk(complex)
	return uniqueFields(fields), refs
}

func (ix index) lookup(values map[qname]*node, ref qname) *node {
	if found := values[ref]; found != nil {
		return found
	}
	if ref.local == "" {
		return nil
	}
	var match *node
	for key, value := range values {
		if key.local != ref.local {
			continue
		}
		if match != nil {
			return nil
		}
		match = value
	}
	return match
}

func resolveQName(n *node, value, fallbackNS string) qname {
	value = strings.TrimSpace(value)
	if value == "" {
		return qname{}
	}
	if prefix, local, ok := strings.Cut(value, ":"); ok {
		return qname{ns: n.ns[prefix], local: local}
	}
	namespace := n.ns[""]
	if namespace == "" || namespace == "http://schemas.xmlsoap.org/wsdl/" {
		namespace = fallbackNS
	}
	return qname{ns: namespace, local: value}
}

func typeLabel(ref qname) string {
	if ref.local == "" {
		return ""
	}
	if ref.ns == xsdNS || strings.Contains(strings.ToLower(ref.ns), "xmlschema") {
		switch strings.ToLower(ref.local) {
		case "integer", "int", "long", "short", "byte", "nonnegativeinteger", "positiveinteger":
			return "int"
		case "decimal", "double", "float":
			return "number"
		case "boolean":
			return "boolean"
		case "datetime", "date", "time", "duration":
			return strings.ToLower(ref.local)
		case "base64binary", "hexbinary":
			return "bytes"
		case "anytype", "anysimpletype":
			return "any"
		default:
			return "string"
		}
	}
	return ref.local
}

func builtin(ref qname) bool {
	return ref.local == "" || ref.ns == xsdNS || strings.Contains(strings.ToLower(ref.ns), "xmlschema")
}

func documentationOf(n *node) string {
	if n == nil {
		return ""
	}
	return n.documentation()
}

func uniqueContracts(in []Contract) []Contract {
	seen := map[string]bool{}
	var out []Contract
	for _, contract := range in {
		key := contract.Source + "\x00" + contract.Name
		if !seen[key] {
			out = append(out, contract)
			seen[key] = true
		}
	}
	return out
}

func uniqueFields(in []Field) []Field {
	seen := map[string]bool{}
	var out []Field
	for _, field := range in {
		if field.Name == "" || seen[field.Name] {
			continue
		}
		seen[field.Name] = true
		out = append(out, field)
	}
	return out
}

func qnameLess(left, right qname) bool {
	if left.ns != right.ns {
		return left.ns < right.ns
	}
	return left.local < right.local
}

func unique(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range in {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func first(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
