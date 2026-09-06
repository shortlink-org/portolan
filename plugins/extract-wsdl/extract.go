package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/wsdl"
	"github.com/shortlink-org/portolan/plugin"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	if opts.Mode != "" && opts.Mode != "service" && opts.Mode != "external" {
		return plugin.Response{}, fmt.Errorf("mode %q is not service or external", opts.Mode)
	}
	if opts.External != "" && strings.Contains(opts.External, ".") {
		return plugin.Response{}, fmt.Errorf("external %q has a dot in its id", opts.External)
	}
	var result wsdl.Result
	var err error
	if opts.Spec != "" {
		result, err = wsdl.Read(in.Root, opts.Spec)
	} else {
		result, err = wsdl.Discover(in.Root)
	}
	if err != nil {
		return plugin.Response{}, err
	}
	b := &plugin.Builder{}
	for _, warning := range result.Warnings {
		b.Warn(in.Root, warning)
	}
	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt, Commit: in.Commit,
		Contexts: []catalog.BoundedContext{}, Defs: map[string]catalog.TypeDef{},
		Flows: []catalog.Flow{}, Adrs: []catalog.Adr{}, Externals: []catalog.External{},
	}
	apiIDs := wsdl.APIIDs(result.Contracts)
	if opts.Mode == "external" || opts.External != "" {
		fragment.Externals = externalContracts(result.Contracts, apiIDs, opts)
	} else {
		var provides []catalog.RpcService
		for _, contract := range result.Contracts {
			api := apiOf(contract, apiIDs, opts, len(result.Contracts))
			provides = append(provides, servicesOf(contract, api)...)
		}
		sort.Slice(provides, func(i, j int) bool { return provides[i].ID < provides[j].ID })
		fragment.Contexts = []catalog.BoundedContext{{
			ID: opts.Context, Slug: opts.Context,
			Services: []catalog.Service{{
				ID: opts.Context + "." + opts.Service, Slug: opts.Service,
				Provides: provides, Consumes: []catalog.RpcCall{}, Aggregates: []catalog.Aggregate{},
			}},
		}}
	}
	if len(result.Contracts) == 0 {
		b.Warn(in.Root, "no WSDL service or port type was found")
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(firstNonEmpty(opts.Out, "wsdl.json"), string(encoded)+"\n")
	return b.Response(), nil
}

func externalContracts(contracts []wsdl.Contract, apiIDs map[string]string, opts Options) []catalog.External {
	byID := map[string]*catalog.External{}
	for _, contract := range contracts {
		api := apiOf(contract, apiIDs, opts, len(contracts))
		id := firstNonEmpty(opts.External, opts.Externals[api], wsdl.ExternalID(contract))
		external := byID[id]
		if external == nil {
			external = &catalog.External{
				ID: id, Slug: id,
				Name:    firstNonEmpty(opts.ExternalName, contract.Name),
				Summary: firstNonEmpty(opts.ExternalSummary, contract.Summary),
				URL:     opts.ExternalURL, Provides: []catalog.RpcService{},
			}
			byID[id] = external
		}
		if external.URL == "" {
			for _, iface := range contract.Interfaces {
				if iface.Endpoint != "" {
					external.URL = iface.Endpoint
					break
				}
			}
		}
		external.Provides = append(external.Provides, servicesOf(contract, api)...)
	}
	var out []catalog.External
	for _, external := range byID {
		sort.Slice(external.Provides, func(i, j int) bool { return external.Provides[i].ID < external.Provides[j].ID })
		out = append(out, *external)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func apiOf(contract wsdl.Contract, apiIDs map[string]string, opts Options, count int) string {
	if opts.API != "" && count == 1 {
		return opts.API
	}
	return apiIDs[wsdl.ContractKey(contract)]
}

func servicesOf(contract wsdl.Contract, api string) []catalog.RpcService {
	var out []catalog.RpcService
	for _, iface := range contract.Interfaces {
		methods := make([]catalog.RpcMethod, 0, len(iface.Operations))
		for _, operation := range iface.Operations {
			methods = append(methods, catalog.RpcMethod{
				Name: operation.Name, Doc: operation.Doc,
				Request: operation.Request, Response: operation.Response,
				SOAP: &catalog.SoapRoute{
					Action: operation.Action, Version: iface.Version, Style: iface.Style,
					Endpoint: iface.Endpoint, Binding: iface.Binding,
					Faults: append([]string(nil), operation.Faults...), Headers: append([]string(nil), operation.Headers...),
				},
			})
		}
		messages := make([]catalog.RpcMessage, 0, len(iface.Messages))
		for _, message := range iface.Messages {
			fields := make([]catalog.Field, 0, len(message.Fields))
			for _, field := range message.Fields {
				fields = append(fields, catalog.Field{Name: field.Name, Type: field.Type, Doc: field.Doc})
			}
			messages = append(messages, catalog.RpcMessage{Name: message.Name, Fields: fields})
		}
		out = append(out, catalog.RpcService{
			ID: wsdl.InterfaceID(api, iface), Source: contract.Source,
			Methods: methods, Messages: messages,
		})
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
