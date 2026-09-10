package extractgosqs

import "github.com/shortlink-org/portolan/internal/goscan"

const (
	sqsPkg = "github.com/aws/aws-sdk-go-v2/service/sqs"
	awsPkg = "github.com/aws/aws-sdk-go-v2/aws"
)

// hops is how far up the callers a queue is followed. One hop is the port:
// the adapter takes the queue as a parameter and the assembly passes a
// constant. Two is an assembly that itself was handed the queue. Further
// than that is not a declaration any more.
const hops = 2

// scanner is the shared Go index, told what the SDK hands back and how a
// queue port names its message.
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

// knownResults is what the SDK constructors and the one lookup call hand
// back, since their declarations are not in the tree.
var knownResults = map[string][]string{
	sqsPkg + ".NewFromConfig":      {sqsPkg + ".Client"},
	sqsPkg + ".New":                {sqsPkg + ".Client"},
	sqsPkg + ".Client.GetQueueUrl": {sqsPkg + ".GetQueueUrlOutput", "error"},
}

// companionString is the one string parameter beside the queue, or -1 when
// there is none or more than one. A call site that passes a literal or
// constant for it is taken to name the message - the shape of a queue port,
// Send(ctx, queue, name, payload).
func companionString(fn *goscan.Function, queue int) int {
	found := -1
	for i, param := range fn.Params {
		if i == queue || fn.Types[param] != "string" {
			continue
		}
		if found >= 0 {
			return -1
		}
		found = i
	}
	return found
}
