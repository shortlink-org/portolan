package extractgokafka

import "github.com/shortlink-org/portolan/internal/goscan"

// The four clients read, by import path. sarama moved from Shopify to IBM and
// confluent-kafka-go gained a /v2; each spelling is the same API.
const (
	saramaPkg      = "github.com/IBM/sarama"
	saramaOldPkg   = "github.com/Shopify/sarama"
	kafkaGoPkg     = "github.com/segmentio/kafka-go"
	confluentPkg   = "github.com/confluentinc/confluent-kafka-go/kafka"
	confluentV2Pkg = "github.com/confluentinc/confluent-kafka-go/v2/kafka"
	kgoPkg         = "github.com/twmb/franz-go/pkg/kgo"
)

var (
	saramaPkgs    = []string{saramaPkg, saramaOldPkg}
	confluentPkgs = []string{confluentPkg, confluentV2Pkg}
)

// library is the name a client goes by in a sentence.
var library = map[string]string{
	saramaPkg:      "sarama",
	saramaOldPkg:   "sarama",
	kafkaGoPkg:     "kafka-go",
	confluentPkg:   "confluent-kafka-go",
	confluentV2Pkg: "confluent-kafka-go",
	kgoPkg:         "franz-go",
}

// hops is how far up the callers a topic is followed. One hop is the port:
// the adapter takes the topic as a parameter and the assembly passes a
// constant. Two is an assembly that itself was handed the topic. Further
// than that is not a declaration any more.
const hops = 2

// scanner is the shared Go index, told what the clients hand back and how a
// port names its message.
type scanner struct {
	*goscan.Index
}

func newScanner(tree *goscan.Tree) *scanner {
	index := goscan.NewIndex(tree)
	index.KnownResults = knownResults()
	index.Companion = companionString
	index.Hops = hops
	return &scanner{Index: index}
}

// knownResults is what the client constructors hand back, since their
// declarations are not in the tree. Only the consumers need a type: a
// producer is read off the message it is handed, which says its topic.
func knownResults() map[string][]string {
	out := map[string][]string{
		kgoPkg + ".NewClient": {kgoPkg + ".Client", "error"},
	}
	for _, pkg := range saramaPkgs {
		out[pkg+".NewConsumerGroup"] = []string{pkg + ".ConsumerGroup", "error"}
		out[pkg+".NewConsumerGroupFromClient"] = []string{pkg + ".ConsumerGroup", "error"}
		out[pkg+".NewConsumer"] = []string{pkg + ".Consumer", "error"}
		out[pkg+".NewConsumerFromClient"] = []string{pkg + ".Consumer", "error"}
	}
	for _, pkg := range confluentPkgs {
		out[pkg+".NewConsumer"] = []string{pkg + ".Consumer", "error"}
		out[pkg+".NewProducer"] = []string{pkg + ".Producer", "error"}
	}
	return out
}

// companionString is the one string parameter beside the topic, or -1 when
// there is none or more than one. A call site that passes a literal or
// constant for it is taken to name the message - the shape of a bus port,
// Publish(ctx, topic, name, payload).
func companionString(fn *goscan.Function, topic int) int {
	found := -1
	for i, param := range fn.Params {
		if i == topic || fn.Types[param] != "string" {
			continue
		}
		if found >= 0 {
			return -1
		}
		found = i
	}
	return found
}
