package extractgoeventgrid

import "github.com/shortlink-org/portolan/internal/goscan"

const (
	eventGridPkg  = "github.com/Azure/azure-sdk-for-go/sdk/messaging/eventgrid/azeventgrid"
	namespacesPkg = "github.com/Azure/azure-sdk-for-go/sdk/messaging/eventgrid/aznamespaces"
	messagingPkg  = "github.com/Azure/azure-sdk-for-go/sdk/azcore/messaging"
	hops          = 2
)

type scanner struct {
	*goscan.Index
}

func newScanner(tree *goscan.Tree) *scanner {
	index := goscan.NewIndex(tree)
	index.KnownResults = knownResults
	index.Hops = hops
	return &scanner{Index: index}
}

var knownResults = map[string][]string{
	eventGridPkg + ".NewClient":                               {eventGridPkg + ".Client", "error"},
	eventGridPkg + ".NewClientWithSAS":                        {eventGridPkg + ".Client", "error"},
	eventGridPkg + ".NewClientWithSharedKeyCredential":        {eventGridPkg + ".Client", "error"},
	namespacesPkg + ".NewSenderClient":                        {namespacesPkg + ".SenderClient", "error"},
	namespacesPkg + ".NewSenderClientWithSharedKeyCredential": {namespacesPkg + ".SenderClient", "error"},
}
