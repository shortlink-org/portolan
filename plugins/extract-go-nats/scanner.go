package extractgonats

import "github.com/shortlink-org/portolan/internal/goscan"

const (
	natsPkg = "github.com/nats-io/nats.go"
	jsPkg   = "github.com/nats-io/nats.go/jetstream"
)

// hops is how far up the callers a subject is followed. One hop is the port:
// the adapter takes the subject as a parameter and the assembly passes a
// constant. Two is an assembly that itself was handed the subject. Further
// than that is not a declaration any more.
const hops = 2

// scanner is the shared Go index, told what nats.go hands back and how a bus
// port names its message.
type scanner struct {
	*goscan.Index
}

func newScanner(tree *goscan.Tree) *scanner {
	index := goscan.NewIndex(tree)
	index.KnownResults = knownResults
	index.Companion = companionString
	index.Hops = hops
	return &scanner{Index: index}
}

// knownResults is what the nats.go constructors hand back, since their
// declarations are not in the tree.
var knownResults = map[string][]string{
	natsPkg + ".Connect":                      {natsPkg + ".Conn", "error"},
	natsPkg + ".Conn.JetStream":               {natsPkg + ".JetStreamContext", "error"},
	jsPkg + ".New":                            {jsPkg + ".JetStream", "error"},
	jsPkg + ".NewWithAPIPrefix":               {jsPkg + ".JetStream", "error"},
	jsPkg + ".NewWithDomain":                  {jsPkg + ".JetStream", "error"},
	jsPkg + ".JetStream.Stream":               {jsPkg + ".Stream", "error"},
	jsPkg + ".JetStream.CreateStream":         {jsPkg + ".Stream", "error"},
	jsPkg + ".JetStream.UpdateStream":         {jsPkg + ".Stream", "error"},
	jsPkg + ".JetStream.CreateOrUpdateStream": {jsPkg + ".Stream", "error"},
}

// companionString is the one string parameter beside the subject, or -1
// when there is none or more than one. A call site that passes a literal or
// constant for it is taken to name the message - the shape of a bus port,
// Subscribe(subject, name, handler).
func companionString(fn *goscan.Function, subject int) int {
	found := -1
	for i, param := range fn.Params {
		if i == subject || fn.Types[param] != "string" {
			continue
		}
		if found >= 0 {
			return -1
		}
		found = i
	}
	return found
}
