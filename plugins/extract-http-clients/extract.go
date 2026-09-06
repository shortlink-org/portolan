package main

import (
	"encoding/json"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/internal/gohttp"
	"github.com/shortlink-org/portolan/plugin"
)

func extract(in plugin.Input, opts Options) (plugin.Response, error) {
	result, err := gohttp.Analyze(in.Root)
	if err != nil {
		return plugin.Response{}, err
	}
	b := &plugin.Builder{}
	for _, warning := range result.Warnings {
		b.Warn(in.Root, warning)
	}

	serviceID := opts.Context + "." + opts.Service
	externals := externalCatalog(result.Contracts, result.Calls, opts)
	consumes := make([]catalog.RpcCall, 0, len(result.Calls))
	seenCalls := map[string]bool{}
	for _, call := range result.Calls {
		peer, status := peerOf(call, opts)
		if seenCalls[call.ID] {
			continue
		}
		seenCalls[call.ID] = true
		source := call.Source.String()
		if call.Contract != "" {
			source = call.Contract
		}
		consumes = append(consumes, catalog.RpcCall{
			ID: call.ID, Peer: peer, Status: status, Source: source,
			Note: callNote(call),
		})
	}
	sort.Slice(consumes, func(i, j int) bool { return consumes[i].ID < consumes[j].ID })

	flows := flowsOfGroups(serviceID, opts.Context, result.Flows, opts)
	if len(result.Calls) == 0 {
		b.Warn(in.Root, "no outbound net/http, oapi-codegen, or SOAP calls were found")
	}
	fragment := catalog.Catalog{
		GeneratedAt: in.GeneratedAt,
		Commit:      in.Commit,
		Contexts: []catalog.BoundedContext{{
			ID: opts.Context, Slug: opts.Context,
			Services: []catalog.Service{{
				ID: serviceID, Slug: opts.Service,
				Provides: []catalog.RpcService{}, Consumes: consumes, Aggregates: []catalog.Aggregate{},
			}},
		}},
		Defs: map[string]catalog.TypeDef{}, Flows: flows, Adrs: []catalog.Adr{}, Externals: externals,
	}
	encoded, err := json.MarshalIndent(fragment, "", "  ")
	if err != nil {
		return plugin.Response{}, err
	}
	b.File(firstNonEmpty(opts.Out, "http-clients.json"), string(encoded)+"\n")
	return b.Response(), nil
}

func externalCatalog(contracts []gohttp.Contract, calls []gohttp.Call, opts Options) []catalog.External {
	used := map[string]bool{}
	called := map[string]bool{}
	for _, call := range calls {
		used[call.API] = call.API != ""
		called[call.ID] = true
	}
	byExternal := map[string]*catalog.External{}
	for _, contract := range contracts {
		if !used[contract.API] || opts.Peers[contract.API] != "" {
			continue
		}
		external := firstNonEmpty(opts.Externals[contract.API], contract.External)
		if external == "" {
			continue
		}
		target := byExternal[external]
		if target == nil {
			target = &catalog.External{
				ID: external, Slug: external, Name: firstNonEmpty(contract.Name, title(external)),
				Summary: contract.Summary, URL: contract.URL, Provides: []catalog.RpcService{},
			}
			byExternal[external] = target
		}
		byInterface := map[string][]catalog.RpcMethod{}
		for _, op := range contract.Operations {
			if !called[op.CallID(contract.API)] {
				continue
			}
			iface := op.Interface(contract.API)
			byInterface[iface] = append(byInterface[iface], catalog.RpcMethod{
				Name: op.ID, HTTP: &catalog.HttpRoute{Method: op.Verb, Path: op.Path},
			})
		}
		for _, op := range contract.SOAP {
			if !called[contract.API+".SOAP/"+op.ID] {
				continue
			}
			byInterface[contract.API+".SOAP"] = append(byInterface[contract.API+".SOAP"], catalog.RpcMethod{
				Name: op.ID,
				Doc:  firstNonEmpty(op.Action, "SOAP operation"),
			})
		}
		var provides []catalog.RpcService
		for id, methods := range byInterface {
			sort.Slice(methods, func(i, j int) bool { return methods[i].Name < methods[j].Name })
			provides = append(provides, catalog.RpcService{ID: id, Source: contract.Source, Methods: methods})
		}
		sort.Slice(provides, func(i, j int) bool { return provides[i].ID < provides[j].ID })
		for _, provided := range provides {
			at := -1
			for i := range target.Provides {
				if target.Provides[i].ID == provided.ID {
					at = i
					break
				}
			}
			if at < 0 {
				target.Provides = append(target.Provides, provided)
				continue
			}
			seenMethod := map[string]bool{}
			for _, method := range target.Provides[at].Methods {
				seenMethod[method.Name] = true
			}
			for _, method := range provided.Methods {
				if !seenMethod[method.Name] {
					target.Provides[at].Methods = append(target.Provides[at].Methods, method)
					seenMethod[method.Name] = true
				}
			}
			sort.Slice(target.Provides[at].Methods, func(i, j int) bool {
				return target.Provides[at].Methods[i].Name < target.Provides[at].Methods[j].Name
			})
		}
	}
	var out []catalog.External
	for _, external := range byExternal {
		sort.Slice(external.Provides, func(i, j int) bool { return external.Provides[i].ID < external.Provides[j].ID })
		out = append(out, *external)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func flowsOf(serviceID, context string, calls []gohttp.Call, opts Options) []catalog.Flow {
	byFunction := map[string][]gohttp.Call{}
	for _, call := range calls {
		byFunction[call.Function] = append(byFunction[call.Function], call)
	}
	functions := make([]string, 0, len(byFunction))
	for function := range byFunction {
		functions = append(functions, function)
	}
	sort.Strings(functions)
	groups := make([]gohttp.FlowGroup, 0, len(functions))
	for _, function := range functions {
		groups = append(groups, gohttp.FlowGroup{Function: function, Calls: byFunction[function]})
	}
	return flowsOfGroups(serviceID, context, groups, opts)
}

func flowsOfGroups(serviceID, context string, groups []gohttp.FlowGroup, opts Options) []catalog.Flow {
	var flows []catalog.Flow
	for _, flowGroup := range groups {
		function := flowGroup.Function
		group := flowGroup.Calls
		participants := []catalog.Participant{{ID: serviceID, Kind: catalog.ParticipantService, Context: &context}}
		participantSeen := map[string]bool{serviceID: true}
		callSteps := make([]*catalog.Step, 0, len(group))
		for index, call := range group {
			peer, status := peerOf(call, opts)
			participant := participantOf(peer, call, opts)
			if !participantSeen[participant.ID] {
				participants = append(participants, participant)
				participantSeen[participant.ID] = true
			}
			note := callNote(call)
			if len(call.Conditions) > 0 {
				condition := "when " + strings.Join(uniqueStrings(call.Conditions), " and ")
				if note == "" {
					note = condition
				} else {
					note += "; " + condition
				}
			}
			if len(call.Chain) > 1 {
				chain := "via " + strings.Join(call.Chain, " → ")
				if note == "" {
					note = chain
				} else {
					note += "; " + chain
				}
			}
			callSteps = append(callSteps, &catalog.Step{
				Type: "step", ID: "s" + strconv.Itoa(index+1), From: serviceID, To: participant.ID,
				Kind: catalog.StepRPC, Ref: call.ID, Label: callLabel(call), Status: status,
				Note: note, Line: call.Source.String(),
			})
		}
		steps := catalog.FlowNodes{}
		if left, right, ok := complementaryCalls(group); ok && len(group) == 2 {
			steps = append(steps, &catalog.Alt{
				Type: "alt", ID: "alt1",
				Branches: []catalog.AltBranch{
					{Title: left, Steps: catalog.FlowNodes{callSteps[0]}},
					{Title: right, Steps: catalog.FlowNodes{callSteps[1]}},
				},
			})
		} else {
			for _, step := range callSteps {
				steps = append(steps, step)
			}
		}
		display := function
		if _, tail, ok := strings.Cut(function, ":"); ok {
			display = tail
		}
		name := strings.TrimSpace(strings.ReplaceAll(display, ".", " "))
		flowSource := flowGroup.Source.String()
		if flowSource == "" {
			flowSource = group[0].Source.String()
		}
		flows = append(flows, catalog.Flow{
			ID:      "flow." + serviceID + ".http-client." + slug(function),
			Slug:    serviceID + "-http-client-" + slug(function),
			Name:    title(name) + " → outbound APIs",
			Summary: "Source-backed outbound calls made by '" + function + "'.",
			Source:  flowSource, Owner: context, Participants: participants, Steps: steps,
		})
	}
	return flows
}

func complementaryCalls(calls []gohttp.Call) (string, string, bool) {
	if len(calls) != 2 {
		return "", "", false
	}
	for _, left := range calls[0].Conditions {
		for _, right := range calls[1].Conditions {
			if right == "not ("+left+")" || left == "not ("+right+")" {
				return left, right, true
			}
		}
	}
	return "", "", false
}

func participantOf(peer string, call gohttp.Call, opts Options) catalog.Participant {
	if call.API != "" {
		if service := opts.Peers[call.API]; service != "" {
			context, _, _ := strings.Cut(service, ".")
			return catalog.Participant{ID: service, Kind: catalog.ParticipantService, Context: &context}
		}
		if external := firstNonEmpty(opts.Externals[call.API], call.External); external != "" {
			return catalog.Participant{ID: external, Kind: catalog.ParticipantExternal}
		}
	}
	return catalog.Participant{ID: peer, Kind: catalog.ParticipantUnknown, Label: rawPeerLabel(call)}
}

func peerOf(call gohttp.Call, opts Options) (string, catalog.Status) {
	if call.API != "" {
		if peer := opts.Peers[call.API]; peer != "" {
			return peer, catalog.StatusDeclared
		}
		if peer := firstNonEmpty(opts.Externals[call.API], call.External); peer != "" {
			return peer, catalog.StatusDeclared
		}
	}
	return rawPeer(call), catalog.StatusUnresolved
}

func rawPeer(call gohttp.Call) string {
	if parsed, err := url.Parse(call.Endpoint); err == nil && parsed.Hostname() != "" {
		return slug(parsed.Hostname())
	}
	if call.Protocol == "SOAP" {
		if parsed, err := url.Parse(call.Action); err == nil && parsed.Hostname() != "" {
			return slug(parsed.Hostname())
		}
		return "soap-peer"
	}
	return "http-peer"
}

func rawPeerLabel(call gohttp.Call) string {
	if call.Endpoint != "" {
		return call.Endpoint
	}
	if call.Protocol == "SOAP" {
		if call.Action != "" {
			if parsed, err := url.Parse(call.Action); err == nil && parsed.Hostname() != "" {
				return parsed.Hostname()
			}
			return call.Action
		}
		return "SOAP endpoint"
	}
	return "HTTP endpoint"
}

func callLabel(call gohttp.Call) string {
	if call.Protocol == "SOAP" {
		return "SOAP " + call.Action
	}
	return strings.TrimSpace(call.Method + " " + call.Path)
}

func callNote(call gohttp.Call) string {
	var parts []string
	if call.Endpoint != "" && call.Endpoint != call.Path {
		parts = append(parts, "endpoint '"+call.Endpoint+"'")
	}
	if call.Request != "" {
		parts = append(parts, "request '"+call.Request+"'")
	}
	if call.Response != "" {
		parts = append(parts, "response '"+call.Response+"'")
	}
	return strings.Join(parts, "; ")
}

func slug(value string) string {
	var out strings.Builder
	dash := false
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
			dash = false
		} else if out.Len() > 0 && !dash {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(out.String(), "-")
}

func title(value string) string {
	var words []string
	for _, word := range strings.FieldsFunc(value, func(r rune) bool { return r == '-' || r == '_' || unicode.IsSpace(r) }) {
		runes := []rune(word)
		if len(runes) > 0 {
			runes[0] = unicode.ToUpper(runes[0])
		}
		words = append(words, string(runes))
	}
	return strings.Join(words, " ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
