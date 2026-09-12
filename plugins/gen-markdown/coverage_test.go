package genmarkdown

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

// Every catalog field must be acknowledged when the mirror grows. Some are
// printed, others are structural (ids, slugs and union discriminators), but a
// new field may not disappear from generated documentation by default.
var catalogCoverage = map[reflect.Type]string{
	reflect.TypeOf(catalog.Catalog{}):          "generatedAt commit contexts defs flows adrs stores modules terms repos deployments externals",
	reflect.TypeOf(catalog.External{}):         "id slug name summary url provides",
	reflect.TypeOf(catalog.RepoPin{}):          "repo commit",
	reflect.TypeOf(catalog.Deployment{}):       "id name project environment cluster namespace repo path chart targetRevision revision tool url service images basis drift",
	reflect.TypeOf(catalog.DeploymentDrift{}):  "project cluster namespace path targetRevision images",
	reflect.TypeOf(catalog.BoundedContext{}):   "id slug name summary kind classification viewId services",
	reflect.TypeOf(catalog.Service{}):          "id slug name repo path readme kind technologies provides consumes copies aggregates stores modules channels owners commands hosts dials",
	reflect.TypeOf(catalog.Command{}):          "runner name run doc body source",
	reflect.TypeOf(catalog.RpcService{}):       "id methods source messages enums module",
	reflect.TypeOf(catalog.RpcEnum{}):          "name doc values",
	reflect.TypeOf(catalog.RpcEnumValue{}):     "name number doc",
	reflect.TypeOf(catalog.RpcMethod{}):        "name doc request requestRef response responseRef streaming deprecated http soap",
	reflect.TypeOf(catalog.HttpRoute{}):        "method path",
	reflect.TypeOf(catalog.SoapRoute{}):        "action version style endpoint binding faults headers",
	reflect.TypeOf(catalog.RpcMessage{}):       "name fields discriminator",
	reflect.TypeOf(catalog.RpcDiscriminator{}): "property variants",
	reflect.TypeOf(catalog.RpcVariant{}):       "value message",
	reflect.TypeOf(catalog.RpcCall{}):          "id peer status source note module via destination evidence",
	reflect.TypeOf(catalog.EdgeVia{}):          "flow step",
	reflect.TypeOf(catalog.ProtoModule{}):      "id slug name registry owner commit digest packages files deps source",
	reflect.TypeOf(catalog.Aggregate{}):        "id slug name readme kind root entities valueObjects operations events enums lifecycle",
	reflect.TypeOf(catalog.Enum{}):             "id slug name doc deprecated values",
	reflect.TypeOf(catalog.EnumValue{}):        "name doc deprecated",
	reflect.TypeOf(catalog.Lifecycle{}):        "states transitions",
	reflect.TypeOf(catalog.Transition{}):       "from to on emits source",
	reflect.TypeOf(catalog.Operation{}):        "id kind doc exposedBy fields source",
	reflect.TypeOf(catalog.Block{}):            "id slug name doc ref fields",
	reflect.TypeOf(catalog.Event{}):            "id slug name versions consumers wire",
	reflect.TypeOf(catalog.EventWire{}):        "name channel",
	reflect.TypeOf(catalog.Channel{}):          "address kind title doc messages source",
	reflect.TypeOf(catalog.ChannelMessage{}):   "name title doc direction encoding contentType",
	reflect.TypeOf(catalog.EventConsumer{}):    "service status note via",
	reflect.TypeOf(catalog.EventVersion{}):     "version doc source fields",
	reflect.TypeOf(catalog.Field{}):            "name type doc ref number",
	reflect.TypeOf(catalog.TypeDef{}):          "fields",
	reflect.TypeOf(catalog.Store{}):            "id slug name kind owner tables views keyspaces source",
	reflect.TypeOf(catalog.RedisKeyspace{}):    "pattern operations ttl value source persists accesses",
	reflect.TypeOf(catalog.RedisAccess{}):      "operation method ttl value source",
	reflect.TypeOf(catalog.Table{}):            "id name doc columns indexes persists role accesses evidence",
	reflect.TypeOf(catalog.TableAccess{}):      "operation method source",
	reflect.TypeOf(catalog.Persists{}):         "aggregate block evidence",
	reflect.TypeOf(catalog.TableIndex{}):       "name columns unique",
	reflect.TypeOf(catalog.Column{}):           "name type nullable pk fk from maps doc",
	reflect.TypeOf(catalog.FK{}):               "table column onDelete",
	reflect.TypeOf(catalog.View{}):             "id name doc materialized columns reads definition persists source",
	reflect.TypeOf(catalog.Flow{}):             "id slug name summary source trigger entrypoint includes owner participants steps examples",
	reflect.TypeOf(catalog.FlowExample{}):      "id recording traceId recordedAt durationMs steps",
	reflect.TypeOf(catalog.ExampleStep{}):      "step label durationMs attributes",
	reflect.TypeOf(catalog.StepSeen{}):         "traces",
	reflect.TypeOf(catalog.FlowTrigger{}):      "kind label confidence",
	reflect.TypeOf(catalog.Participant{}):      "id kind context label",
	reflect.TypeOf(catalog.Step{}):             "type id from to kind ref label status note line replyTo http continuesAt reaches handoff storeAccess destination evidence seen",
	reflect.TypeOf(catalog.HTTPResponse{}):     "status contentType body bodyRef encoding outcome warning source fields",
	reflect.TypeOf(catalog.FlowHandoff{}):      "kind transport channel message direction",
	reflect.TypeOf(catalog.FlowStoreAccess{}):  "store method operation keyspace source",
	reflect.TypeOf(catalog.Parallel{}):         "type id title branches",
	reflect.TypeOf(catalog.Alt{}):              "type id branches",
	reflect.TypeOf(catalog.AltBranch{}):        "title steps terminal seen",
	reflect.TypeOf(catalog.Loop{}):             "type id title steps",
	reflect.TypeOf(catalog.AdrScope{}):         "kind context service",
	reflect.TypeOf(catalog.Adr{}):              "id slug number title status date scope body note supersededBy supersedes relates source created revised",
	reflect.TypeOf(catalog.AdrCommit{}):        "commit author date",
	reflect.TypeOf(catalog.AdrRelates{}):       "services events flows",
	reflect.TypeOf(catalog.Term{}):             "id slug context name definition source",
}

func TestCatalogFieldCoverageIsExplicit(t *testing.T) {
	for typ, declared := range catalogCoverage {
		want := strings.Fields(declared)
		got := make([]string, 0, typ.NumField())
		for i := 0; i < typ.NumField(); i++ {
			name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
			if name != "" && name != "-" {
				got = append(got, name)
			}
		}
		sort.Strings(want)
		sort.Strings(got)
		if strings.Join(want, " ") != strings.Join(got, " ") {
			t.Errorf("%s coverage changed\nfields:  %s\ncovered: %s", typ.Name(), strings.Join(got, " "), strings.Join(want, " "))
		}
	}
}
