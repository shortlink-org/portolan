package main

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
	reflect.TypeOf(catalog.Catalog{}):          "generatedAt commit contexts defs flows adrs stores modules terms repos externals",
	reflect.TypeOf(catalog.External{}):         "id slug name summary url provides",
	reflect.TypeOf(catalog.RepoPin{}):          "repo commit",
	reflect.TypeOf(catalog.BoundedContext{}):   "id slug name summary classification viewId services",
	reflect.TypeOf(catalog.Service{}):          "id slug name repo path readme provides consumes aggregates stores modules channels owners",
	reflect.TypeOf(catalog.RpcService{}):       "id methods source messages module",
	reflect.TypeOf(catalog.RpcMethod{}):        "name doc request requestRef response responseRef streaming deprecated http",
	reflect.TypeOf(catalog.HttpRoute{}):        "method path",
	reflect.TypeOf(catalog.RpcMessage{}):       "name fields discriminator",
	reflect.TypeOf(catalog.RpcDiscriminator{}): "property variants",
	reflect.TypeOf(catalog.RpcVariant{}):       "value message",
	reflect.TypeOf(catalog.RpcCall{}):          "id peer status source note module via",
	reflect.TypeOf(catalog.EdgeVia{}):          "flow step",
	reflect.TypeOf(catalog.ProtoModule{}):      "id slug name registry owner commit digest packages files deps source",
	reflect.TypeOf(catalog.Aggregate{}):        "id slug name readme root entities valueObjects operations events lifecycle",
	reflect.TypeOf(catalog.Lifecycle{}):        "states transitions",
	reflect.TypeOf(catalog.Transition{}):       "from to on emits source",
	reflect.TypeOf(catalog.Operation{}):        "id kind doc exposedBy",
	reflect.TypeOf(catalog.Block{}):            "id slug name doc ref fields",
	reflect.TypeOf(catalog.Event{}):            "id slug name versions consumers wire",
	reflect.TypeOf(catalog.EventWire{}):        "name channel",
	reflect.TypeOf(catalog.Channel{}):          "address title doc messages source",
	reflect.TypeOf(catalog.ChannelMessage{}):   "name title doc direction",
	reflect.TypeOf(catalog.EventConsumer{}):    "service status note via",
	reflect.TypeOf(catalog.EventVersion{}):     "version doc source fields",
	reflect.TypeOf(catalog.Field{}):            "name type doc ref",
	reflect.TypeOf(catalog.TypeDef{}):          "fields",
	reflect.TypeOf(catalog.Store{}):            "id slug name kind owner tables views source",
	reflect.TypeOf(catalog.Table{}):            "id name doc columns indexes persists role",
	reflect.TypeOf(catalog.Persists{}):         "aggregate block",
	reflect.TypeOf(catalog.TableIndex{}):       "name columns unique",
	reflect.TypeOf(catalog.Column{}):           "name type nullable pk fk from maps doc",
	reflect.TypeOf(catalog.FK{}):               "table column onDelete",
	reflect.TypeOf(catalog.View{}):             "id name doc materialized columns reads definition persists source",
	reflect.TypeOf(catalog.Flow{}):             "id slug name summary source owner participants steps",
	reflect.TypeOf(catalog.Participant{}):      "id kind context label",
	reflect.TypeOf(catalog.Step{}):             "type id from to kind ref label status note line",
	reflect.TypeOf(catalog.Parallel{}):         "type id title branches",
	reflect.TypeOf(catalog.Alt{}):              "type id branches",
	reflect.TypeOf(catalog.AltBranch{}):        "title steps terminal",
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
