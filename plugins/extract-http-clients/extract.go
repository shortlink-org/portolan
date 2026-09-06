package main

import (
	"encoding/json"
	"net/url"
	"path/filepath"
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
	if result.TypedCallGraphError != "" {
		b.Warn(in.Root, "typed call graph unavailable; using syntax fallback: "+result.TypedCallGraphError)
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

	endpointFlows, covered := flowsOfEndpoints(serviceID, opts.Context, result.EndpointFlows, opts)
	coverEndpointDescendants(covered, result.EndpointFlows, result.Flows)
	rootFlows := flowsOfRoots(serviceID, opts.Context, result.RootFlows, opts, covered)
	coverRootDescendants(covered, result.RootFlows, result.Flows)
	flows := append(endpointFlows, rootFlows...)
	flows = append(flows, flowsOfGroupsExcept(serviceID, opts.Context, result.Flows, opts, covered)...)
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
			if !called[op.Interface+"/"+op.ID] {
				continue
			}
			byInterface[op.Interface] = append(byInterface[op.Interface], catalog.RpcMethod{
				Name: op.ID, Request: op.Request, Response: op.Response,
				SOAP: &catalog.SoapRoute{
					Action: op.Action, Version: op.Version, Style: op.Style,
					Endpoint: op.Endpoint, Binding: op.Binding,
					Faults: append([]string(nil), op.Faults...), Headers: append([]string(nil), op.Headers...),
				},
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
	return flowsOfGroupsExcept(serviceID, context, groups, opts, nil)
}

func flowsOfGroupsExcept(serviceID, context string, groups []gohttp.FlowGroup, opts Options, excluded map[string]bool) []catalog.Flow {
	var flows []catalog.Flow
	for _, flowGroup := range groups {
		if excluded[flowGroup.Function] {
			continue
		}
		function := flowGroup.Function
		group := flowGroup.Calls
		if len(group) == 0 {
			continue
		}
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
		name := flowName(function)
		flowSource := flowGroup.Source.String()
		if flowSource == "" {
			flowSource = group[0].Source.String()
		}
		flows = append(flows, catalog.Flow{
			ID:      "flow." + serviceID + ".http-client." + slug(function),
			Slug:    serviceID + "-http-client-" + slug(function),
			Name:    name + " → outbound APIs",
			Summary: standaloneFlowSummary(function, flowGroup.Callers),
			Source:  flowSource,
			Trigger: &catalog.FlowTrigger{
				Kind: "unproven", Label: "No execution root proven", Confidence: "low",
			},
			EntryPoint: function, Owner: context,
			Participants: participants, Steps: steps,
		})
	}
	return flows
}

func flowsOfRoots(serviceID, context string, roots []gohttp.RootFlow, opts Options, covered map[string]bool) []catalog.Flow {
	flows := make([]catalog.Flow, 0, len(roots))
	for _, root := range roots {
		for _, function := range root.Covered {
			covered[function] = true
		}
		actorID := serviceID + ".api-client"
		actorLabel := "API client"
		firstKind := catalog.StepRPC
		firstLabel := strings.TrimSpace(root.Method + " " + root.Path)
		if root.Kind == gohttp.RootCallback {
			actorID = serviceID + ".callback-sender"
			actorLabel = "Callback sender"
		}
		if root.Kind == gohttp.RootStartup {
			actorID = serviceID + ".process"
			actorLabel = "Process startup"
			firstKind = catalog.StepCall
			firstLabel = root.Label
		}
		if root.Kind == gohttp.RootScheduled {
			actorID = serviceID + ".scheduler"
			actorLabel = "Scheduler"
			firstKind = catalog.StepCall
			firstLabel = root.Label
		}
		participants := []catalog.Participant{
			{ID: actorID, Kind: catalog.ParticipantActor, Label: actorLabel},
			{ID: serviceID, Kind: catalog.ParticipantService, Context: &context},
		}
		participantSeen := map[string]bool{actorID: true, serviceID: true}
		steps := catalog.FlowNodes{&catalog.Step{
			Type: "step", ID: "s1", From: actorID, To: serviceID,
			Kind: firstKind, Label: firstLabel, Status: catalog.StatusDeclared,
			Line: root.Source.String(),
		}}
		for index, call := range root.Calls {
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
			steps = append(steps, &catalog.Step{
				Type: "step", ID: "s" + strconv.Itoa(index+2), From: serviceID, To: participant.ID,
				Kind: catalog.StepRPC, Ref: call.ID, Label: callLabel(call), Status: status,
				Note: note, Line: call.Source.String(),
			})
		}
		summary := "Source-backed execution path from a concrete root to outbound APIs."
		switch root.Kind {
		case gohttp.RootCallback:
			summary = "Source-backed callback path from the inbound webhook to outbound APIs."
		case gohttp.RootStartup:
			summary = "Source-backed startup path executed while the process is assembled."
		case gohttp.RootScheduled:
			summary = "Source-backed scheduled path from timer registration to outbound APIs."
		case gohttp.RootHTTP:
			summary = "Source-backed request path from the inbound endpoint to outbound APIs."
		}
		rootIdentity := root.Label
		if root.Kind == gohttp.RootStartup {
			rootIdentity = strings.TrimPrefix(rootIdentity, "Startup → ")
		}
		rootSlug := slug(string(root.Kind) + "-" + rootIdentity)
		flows = append(flows, catalog.Flow{
			ID:   "flow." + serviceID + ".root." + rootSlug,
			Slug: serviceID + "-root-" + rootSlug,
			Name: root.Label + " → outbound APIs", Summary: summary,
			Source: root.Source.String(),
			Trigger: &catalog.FlowTrigger{
				Kind: string(root.Kind), Label: root.Label, Confidence: root.Confidence,
			},
			Owner: context, Participants: participants, Steps: steps,
		})
	}
	return flows
}

func standaloneFlowSummary(function string, callers []string) string {
	base := "Source-backed outbound calls made by '" + function + "'."
	if len(callers) == 0 {
		return base + " No source caller was found; this may be a public entrypoint, a background task, or unreachable code."
	}
	displays := make([]string, 0, len(callers))
	for _, caller := range callers {
		displays = append(displays, flowName(caller))
	}
	return base + " Source callers were found (" + strings.Join(uniqueStrings(displays), ", ") + "), but no inbound or asynchronous root was proven."
}

func flowsOfEndpoints(serviceID, context string, endpoints []gohttp.EndpointFlow, opts Options) ([]catalog.Flow, map[string]bool) {
	covered := map[string]bool{}
	flows := make([]catalog.Flow, 0, len(endpoints))
	for _, endpoint := range endpoints {
		actorID := serviceID + ".api-client"
		participants := []catalog.Participant{
			{ID: actorID, Kind: catalog.ParticipantActor, Label: "API client"},
			{ID: serviceID, Kind: catalog.ParticipantService, Context: &context},
		}
		participantSeen := map[string]bool{actorID: true, serviceID: true}
		branches := make([]catalog.AltBranch, 0, len(endpoint.Branches))
		stepIndex := 2
		for _, branch := range endpoint.Branches {
			covered[branch.Function] = true
			steps := catalog.FlowNodes{}
			for _, call := range branch.Calls {
				peer, status := peerOf(call, opts)
				participant := participantOf(peer, call, opts)
				if !participantSeen[participant.ID] {
					participants = append(participants, participant)
					participantSeen[participant.ID] = true
				}
				note := callNote(call)
				if len(call.Chain) > 1 {
					chain := "via " + strings.Join(call.Chain, " → ")
					if note == "" {
						note = chain
					} else {
						note += "; " + chain
					}
				}
				steps = append(steps, &catalog.Step{
					Type: "step", ID: "s" + strconv.Itoa(stepIndex), From: serviceID, To: participant.ID,
					Kind: catalog.StepRPC, Ref: call.ID, Label: callLabel(call), Status: status,
					Note: note, Line: call.Source.String(),
				})
				stepIndex++
			}
			if len(steps) == 0 {
				provider := filepath.Base(branch.Provider)
				steps = append(steps, &catalog.Step{
					Type: "step", ID: "s" + strconv.Itoa(stepIndex), From: serviceID, To: serviceID,
					Kind: catalog.StepCall, Label: title(provider) + " " + title(branch.Operation),
					Status: catalog.StatusDeclared,
					Note:   "provider implementation is source-backed; its outbound transport was not resolved in the analyzed source",
					Line:   branch.Source.String(),
				})
				stepIndex++
			}
			branches = append(branches, catalog.AltBranch{
				Title: "connector = \"" + branch.Condition + "\"", Steps: steps,
			})
		}
		steps := catalog.FlowNodes{&catalog.Step{
			Type: "step", ID: "s1", From: actorID, To: serviceID,
			Kind: catalog.StepRPC, Label: strings.TrimSpace(endpoint.Method + " " + endpoint.Path),
			Status: catalog.StatusDeclared, Line: endpoint.Source.String(),
		}}
		if len(branches) == 1 {
			steps = append(steps, branches[0].Steps...)
		} else {
			steps = append(steps, &catalog.Alt{Type: "alt", ID: "providers", Branches: branches})
		}
		name := strings.TrimSpace(endpoint.Method + " " + endpoint.Path)
		flows = append(flows, catalog.Flow{
			ID:      "flow." + serviceID + ".endpoint." + slug(name),
			Slug:    serviceID + "-endpoint-" + slug(name),
			Name:    name + " → provider APIs",
			Summary: "Source-backed request path from the inbound endpoint through provider selection to outbound APIs.",
			Source:  endpoint.Source.String(),
			Trigger: &catalog.FlowTrigger{
				Kind: "http", Label: name, Confidence: "high",
			},
			Owner: context, Participants: participants, Steps: steps,
		})
	}
	return flows, covered
}

func coverRootDescendants(covered map[string]bool, roots []gohttp.RootFlow, groups []gohttp.FlowGroup) {
	for _, root := range roots {
		callKeys := map[string]bool{}
		for _, call := range root.Calls {
			callKeys[endpointCallKey(call)] = true
		}
		for _, group := range groups {
			if covered[group.Function] || len(group.Calls) == 0 {
				continue
			}
			allCallsCovered := true
			for _, call := range group.Calls {
				if !callKeys[endpointCallKey(call)] {
					allCallsCovered = false
					break
				}
			}
			if allCallsCovered {
				covered[group.Function] = true
			}
		}
	}
}

func coverEndpointDescendants(covered map[string]bool, endpoints []gohttp.EndpointFlow, groups []gohttp.FlowGroup) {
	for _, endpoint := range endpoints {
		// Typed dispatch can lift a union of calls from every provider branch
		// into a shared coordinator such as ActionFlow. Compare those callers
		// with the whole endpoint, not with one branch at a time, or the same
		// source-backed calls reappear as a misleading standalone flow.
		callKeys := map[string]bool{}
		for _, branch := range endpoint.Branches {
			for _, call := range branch.Calls {
				callKeys[endpointCallKey(call)] = true
			}
		}
		for _, group := range groups {
			if covered[group.Function] || len(group.Calls) == 0 {
				continue
			}
			// Exact source location plus operation id is stronger evidence than
			// a display name in the reconstructed call chain. Wrappers reached
			// through interfaces and promoted methods can omit that name while
			// still contributing precisely the same source-backed calls.
			allCallsCovered := true
			for _, call := range group.Calls {
				if !callKeys[endpointCallKey(call)] {
					allCallsCovered = false
					break
				}
			}
			if allCallsCovered {
				covered[group.Function] = true
			}
		}
	}
}

func endpointCallKey(call gohttp.Call) string {
	return call.Source.String() + "\x00" + call.ID
}

func flowName(function string) string {
	directory, display, qualified := strings.Cut(function, ":")
	if !qualified {
		display = function
	}
	receiver, method, methodCall := strings.Cut(display, ".")
	if !methodCall || (receiver != "Client" && receiver != "Connector") {
		return title(strings.ReplaceAll(display, ".", " "))
	}
	parts := strings.Split(filepath.ToSlash(directory), "/")
	for index := len(parts) - 1; index >= 0; index-- {
		part := parts[index]
		if part == "" || part == "client" || part == "connector" || part == "adapter" {
			continue
		}
		return title(part) + " " + title(method)
	}
	return title(strings.ReplaceAll(display, ".", " "))
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
	if len(call.URLTrace) > 1 {
		parts = append(parts, "URL source "+strings.Join(call.URLTrace, " → "))
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
