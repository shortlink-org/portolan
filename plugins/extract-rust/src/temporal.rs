//! Temporal workflows proved by worker registration and the Rust SDK macros.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use quote::ToTokens;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Expr, ExprCall, ExprMatch, ExprMethodCall, GenericArgument, ImplItem, Item, Pat, Type};

use crate::catalog::{Alt, AltBranch, Flow, FlowHandoff, FlowNode, FlowTrigger, Participant, RpcCall, Step};
use crate::ids::{same_name, slug, title};
use crate::source::{Crate, Source, self_type_name};

#[derive(Clone)]
struct Registration {
    workflow: String,
    source: String,
}

enum RunAction {
    Timer(String),
    Wait(String),
    Activity { owner: String, name: String, source: String },
}

#[derive(Clone)]
struct ActivityCall {
    field: String,
    method: String,
    source: String,
}

struct ActionBranch {
    title: String,
    actions: Vec<RunAction>,
    terminal: bool,
}

struct ActionContext<'a> {
    svc_id: &'a str,
    temporal: &'a str,
    channel: &'a str,
    rpc_calls: &'a [RpcCall],
    activity_calls: &'a BTreeMap<(String, String), Vec<ActivityCall>>,
}

pub fn read_temporal(krate: &Crate, context: &str, svc_id: &str, rpc_calls: &[RpcCall], rel: &dyn Fn(&Path) -> String) -> Vec<Flow> {
    let activity_calls = read_activity_calls(krate, rel);
    let mut registrations = Vec::new();
    for source in &krate.sources {
        let mut reader = RegistrationReader {
            source,
            rel,
            registrations: &mut registrations,
        };
        reader.visit_file(&source.file);
    }
    registrations.sort_by(|a, b| a.workflow.cmp(&b.workflow));
    registrations.dedup_by(|a, b| a.workflow == b.workflow);

    registrations
        .into_iter()
        .filter_map(|registration| workflow_flow(krate, context, svc_id, rpc_calls, &activity_calls, rel, registration))
        .collect()
}

fn workflow_flow(
    krate: &Crate,
    context: &str,
    svc_id: &str,
    rpc_calls: &[RpcCall],
    activity_calls: &BTreeMap<(String, String), Vec<ActivityCall>>,
    rel: &dyn Fn(&Path) -> String,
    registration: Registration,
) -> Option<Flow> {
    let workflow_source = krate.sources.iter().find(|source| {
        source
            .structs()
            .any(|item| item.ident == registration.workflow && has_attr(&item.attrs, "workflow"))
    })?;
    let implementation = workflow_source
        .impls()
        .find(|item| self_type_name(item).as_deref() == Some(registration.workflow.as_str()) && has_attr(&item.attrs, "workflow_methods"))?;

    let mut actions = Vec::new();
    let mut action_branches: Option<Vec<ActionBranch>> = None;
    let mut signals = Vec::new();
    for item in &implementation.items {
        let ImplItem::Fn(method) = item else { continue };
        if has_attr(&method.attrs, "run") {
            let mut finder = PhaseMatchFinder { found: None };
            finder.visit_block(&method.block);
            if let Some(branching) = finder.found {
                action_branches = Some(
                    branching
                        .arms
                        .iter()
                        .map(|arm| ActionBranch {
                            title: branch_title(&arm.pat),
                            actions: actions_in_expr(workflow_source, rel, &arm.body),
                            terminal: branch_is_terminal(&arm.pat, &arm.body),
                        })
                        .collect(),
                );
            } else {
                actions = actions_in_block(workflow_source, rel, &method.block);
            }
        }
        if has_attr(&method.attrs, "signal") {
            signals.push((method.sig.ident.to_string(), workflow_source.at(method.sig.ident.span(), rel)));
        }
    }
    let stem = registration.workflow.strip_suffix("Workflow").unwrap_or(&registration.workflow);
    let flow_name = title(&slug(stem));
    let flow_slug = format!("temporal-{}", slug(stem));
    let channel = format!("temporal.{}", slug(stem));
    let temporal = "temporal".to_string();
    let mut participants = vec![
        Participant {
            id: temporal.clone(),
            kind: "external".into(),
            context: None,
            label: Some("Temporal".into()),
        },
        Participant {
            id: svc_id.into(),
            kind: "service".into(),
            context: Some(context.into()),
            label: None,
        },
    ];
    let mut steps = Vec::new();
    let mut step = 1;
    steps.push(FlowNode::Step(Step {
        id: format!("s{step}"),
        from: temporal.clone(),
        to: svc_id.into(),
        kind: "call".into(),
        label: format!("run {flow_name}"),
        status: "declared".into(),
        reference: None,
        note: Some(format!("Registered Temporal workflow `{}`.", registration.workflow)),
        line: Some(registration.source.clone()),
        handoff: Some(job_handoff(&channel, &registration.workflow, "receive")),
    }));
    let action_context = ActionContext {
        svc_id,
        temporal: &temporal,
        channel: &channel,
        rpc_calls,
        activity_calls,
    };

    if let Some(branches) = action_branches {
        let branches = branches
            .into_iter()
            .map(|branch| AltBranch {
                title: branch.title,
                steps: action_nodes(branch.actions, &mut step, &mut participants, &action_context),
                terminal: branch.terminal.then_some(true),
            })
            .collect();
        steps.push(FlowNode::Alt(Alt { id: "a1".into(), branches }));
    } else {
        steps.extend(action_nodes(actions, &mut step, &mut participants, &action_context));
    }
    for (signal, source) in signals {
        step += 1;
        steps.push(FlowNode::Step(Step {
            id: format!("s{step}"),
            from: temporal.clone(),
            to: svc_id.into(),
            kind: "event".into(),
            label: format!("signal {}", title(&slug(&signal))),
            status: "declared".into(),
            reference: None,
            note: Some("Temporal delivers this signal to the running workflow.".into()),
            line: Some(source),
            handoff: Some(job_handoff(&channel, &signal, "receive")),
        }));
    }

    Some(Flow {
        id: format!("{svc_id}.{flow_slug}"),
        slug: flow_slug,
        name: flow_name.clone(),
        summary: format!("Temporal workflow registered and implemented by {svc_id}."),
        source: registration.source,
        trigger: FlowTrigger {
            kind: "callback".into(),
            label: format!("Temporal · {flow_name}"),
            confidence: "high".into(),
        },
        owner: context.into(),
        participants,
        steps,
    })
}

fn action_nodes(actions: Vec<RunAction>, step: &mut usize, participants: &mut Vec<Participant>, context: &ActionContext<'_>) -> Vec<FlowNode> {
    let mut nodes = Vec::new();
    let mut seen_activities = BTreeSet::new();
    let mut saw_timer = false;
    let mut saw_wait = false;
    for action in actions {
        match action {
            RunAction::Timer(source) if !saw_timer => {
                saw_timer = true;
                *step += 1;
                nodes.push(FlowNode::Step(Step {
                    id: format!("s{step}"),
                    from: context.svc_id.into(),
                    to: context.temporal.into(),
                    kind: "call".into(),
                    label: "schedule durable timer".into(),
                    status: "declared".into(),
                    reference: None,
                    note: Some("Temporal persists the timer and resumes the workflow when it fires.".into()),
                    line: Some(source),
                    handoff: None,
                }));
            }
            RunAction::Wait(source) if !saw_wait => {
                saw_wait = true;
                *step += 1;
                nodes.push(FlowNode::Step(Step {
                    id: format!("s{step}"),
                    from: context.svc_id.into(),
                    to: context.temporal.into(),
                    kind: "call".into(),
                    label: "wait for workflow condition".into(),
                    status: "declared".into(),
                    reference: None,
                    note: Some("Temporal suspends the workflow until this condition becomes true.".into()),
                    line: Some(source),
                    handoff: None,
                }));
            }
            RunAction::Activity { owner, name, source } if seen_activities.insert(name.clone()) => {
                *step += 1;
                nodes.push(FlowNode::Step(Step {
                    id: format!("s{step}"),
                    from: context.svc_id.into(),
                    to: context.temporal.into(),
                    kind: "call".into(),
                    label: format!("schedule activity {}", title(&slug(&name))),
                    status: "declared".into(),
                    reference: None,
                    note: Some("The workflow schedules this activity through Temporal.".into()),
                    line: Some(source),
                    handoff: Some(job_handoff(context.channel, &name, "send")),
                }));
                if let Some(calls) = context.activity_calls.get(&(owner, name.clone())) {
                    let mut seen_rpcs = BTreeSet::new();
                    for activity_call in calls {
                        let exact = context
                            .rpc_calls
                            .iter()
                            .filter(|rpc| rpc.id.rsplit('/').next().is_some_and(|method| same_name(method, &activity_call.method)))
                            .collect::<Vec<_>>();
                        let fallback = context
                            .rpc_calls
                            .iter()
                            .filter(|rpc| rpc.peer.rsplit('.').next().is_some_and(|peer| same_name(peer, &activity_call.field)))
                            .collect::<Vec<_>>();
                        let matches = if exact.is_empty() && fallback.len() == 1 { fallback } else { exact };
                        for rpc in matches {
                            if !seen_rpcs.insert(rpc.id.as_str()) {
                                continue;
                            }
                            if !participants.iter().any(|participant| participant.id == rpc.peer) {
                                participants.push(Participant {
                                    id: rpc.peer.clone(),
                                    kind: if rpc.status == "unresolved" { "unknown" } else { "service" }.into(),
                                    context: (rpc.status != "unresolved").then(|| rpc.peer.split('.').next().unwrap_or_default().to_string()),
                                    label: (rpc.status == "unresolved").then(|| rpc.peer.clone()),
                                });
                            }
                            *step += 1;
                            nodes.push(FlowNode::Step(Step {
                                id: format!("s{step}"),
                                from: context.svc_id.into(),
                                to: rpc.peer.clone(),
                                kind: "rpc".into(),
                                label: rpc.id.rsplit('/').next().unwrap_or(&rpc.id).into(),
                                status: rpc.status.clone(),
                                reference: Some(rpc.id.clone()),
                                note: Some(format!("Temporal activity {} calls this peer.", title(&slug(&name)))),
                                line: Some(activity_call.source.clone()),
                                handoff: None,
                            }));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    nodes
}

fn read_activity_calls(krate: &Crate, rel: &dyn Fn(&Path) -> String) -> BTreeMap<(String, String), Vec<ActivityCall>> {
    let mut found = BTreeMap::new();
    for source in &krate.sources {
        for implementation in source.impls().filter(|implementation| has_attr(&implementation.attrs, "activities")) {
            let Some(owner) = self_type_name(implementation) else { continue };
            for item in &implementation.items {
                let ImplItem::Fn(method) = item else { continue };
                if !has_attr(&method.attrs, "activity") {
                    continue;
                }
                let mut calls = Vec::new();
                let mut reader = ActivityCallReader {
                    source,
                    rel,
                    calls: &mut calls,
                };
                reader.visit_block(&method.block);
                found.insert((owner.clone(), method.sig.ident.to_string()), calls);
            }
        }
    }
    found
}

struct ActivityCallReader<'a> {
    source: &'a Source,
    rel: &'a dyn Fn(&Path) -> String,
    calls: &'a mut Vec<ActivityCall>,
}

impl<'ast> Visit<'ast> for ActivityCallReader<'_> {
    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        if let Some(field) = self_field_name(&call.receiver) {
            self.calls.push(ActivityCall {
                field,
                method: call.method.to_string(),
                source: self.source.at(call.method.span(), self.rel),
            });
        }
        visit::visit_expr_method_call(self, call);
    }
}

fn self_field_name(expression: &Expr) -> Option<String> {
    match expression {
        Expr::Field(field) if matches!(field.base.as_ref(), Expr::Path(path) if path.path.is_ident("self")) => match &field.member {
            syn::Member::Named(name) => Some(name.to_string()),
            syn::Member::Unnamed(_) => None,
        },
        Expr::Paren(paren) => self_field_name(&paren.expr),
        Expr::Reference(reference) => self_field_name(&reference.expr),
        _ => None,
    }
}

fn actions_in_block(source: &Source, rel: &dyn Fn(&Path) -> String, block: &syn::Block) -> Vec<RunAction> {
    let mut actions = Vec::new();
    let mut reader = RunReader {
        source,
        rel,
        actions: &mut actions,
        calls: BTreeSet::new(),
    };
    reader.visit_block(block);
    let calls = reader.calls;
    if !actions.iter().any(|action| matches!(action, RunAction::Timer(_)))
        && let Some(found) = macro_timer_source(source, block.span(), rel)
    {
        actions.push(RunAction::Timer(found));
    }
    expand_helpers(source, rel, &mut actions, calls);
    actions.sort_by_key(action_line);
    actions
}

fn actions_in_expr(source: &Source, rel: &dyn Fn(&Path) -> String, expression: &Expr) -> Vec<RunAction> {
    let mut actions = Vec::new();
    let mut reader = RunReader {
        source,
        rel,
        actions: &mut actions,
        calls: BTreeSet::new(),
    };
    reader.visit_expr(expression);
    let calls = reader.calls;
    if !actions.iter().any(|action| matches!(action, RunAction::Timer(_)))
        && let Some(found) = macro_timer_source(source, expression.span(), rel)
    {
        actions.push(RunAction::Timer(found));
    }
    expand_helpers(source, rel, &mut actions, calls);
    actions.sort_by_key(action_line);
    actions
}

fn expand_helpers(source: &Source, rel: &dyn Fn(&Path) -> String, actions: &mut Vec<RunAction>, calls: BTreeSet<String>) {
    let mut pending: Vec<String> = calls.into_iter().collect();
    let mut visited = BTreeSet::new();
    while let Some(name) = pending.pop() {
        if !visited.insert(name.clone()) {
            continue;
        }
        let Some(function) = source.file.items.iter().find_map(|item| match item {
            Item::Fn(function) if function.sig.ident == name => Some(function),
            _ => None,
        }) else {
            continue;
        };
        let before = actions.len();
        let mut nested = RunReader {
            source,
            rel,
            actions,
            calls: BTreeSet::new(),
        };
        nested.visit_block(&function.block);
        if !nested.actions[before..].iter().any(|action| matches!(action, RunAction::Timer(_)))
            && let Some(found) = macro_timer_source(source, function.block.span(), rel)
        {
            nested.actions.push(RunAction::Timer(found));
        }
        pending.extend(nested.calls);
    }
}

struct PhaseMatchFinder<'a> {
    found: Option<&'a ExprMatch>,
}

impl<'ast> Visit<'ast> for PhaseMatchFinder<'ast> {
    fn visit_expr_match(&mut self, expression: &'ast ExprMatch) {
        if self.found.is_none() && expression.arms.len() >= 3 && expression.arms.iter().any(|arm| arm.pat.to_token_stream().to_string().contains("Phase ::")) {
            self.found = Some(expression);
            return;
        }
        visit::visit_expr_match(self, expression);
    }
}

fn branch_title(pattern: &Pat) -> String {
    let title = pattern
        .to_token_stream()
        .to_string()
        .split('|')
        .map(|part| {
            let leaf = part.rsplit("::").next().unwrap_or(part).trim();
            let name = leaf.split(['(', '{', ' ']).next().unwrap_or(leaf);
            title(&slug(name))
        })
        .collect::<Vec<_>>()
        .join(" / ");
    if title.is_empty() { "Otherwise".into() } else { title }
}

fn branch_is_terminal(pattern: &Pat, expression: &Expr) -> bool {
    let pattern = pattern.to_token_stream().to_string();
    if pattern.contains("Terminal") || pattern.contains("InvariantViolation") {
        return true;
    }
    let mut finder = ReturnFinder(false);
    finder.visit_expr(expression);
    finder.0
}

struct ReturnFinder(bool);

impl<'ast> Visit<'ast> for ReturnFinder {
    fn visit_expr_return(&mut self, _: &'ast syn::ExprReturn) {
        self.0 = true;
    }
}

fn macro_timer_source(source: &Source, span: proc_macro2::Span, rel: &dyn Fn(&Path) -> String) -> Option<String> {
    let start = span.start().line.max(1);
    let end = span.end().line;
    source
        .text
        .lines()
        .enumerate()
        .skip(start - 1)
        .take(end.saturating_sub(start) + 1)
        .find(|(_, line)| line.contains(".timer("))
        .map(|(line, _)| format!("{}:{}", rel(&source.path), line + 1))
}

fn action_line(action: &RunAction) -> usize {
    let source = match action {
        RunAction::Timer(source) | RunAction::Wait(source) | RunAction::Activity { source, .. } => source,
    };
    source.rsplit(':').next().and_then(|line| line.parse().ok()).unwrap_or(usize::MAX)
}

fn has_attr(attrs: &[syn::Attribute], name: &str) -> bool {
    attrs
        .iter()
        .any(|attr| attr.path().segments.last().is_some_and(|segment| segment.ident == name))
}

fn job_handoff(channel: &str, message: &str, direction: &str) -> FlowHandoff {
    FlowHandoff {
        kind: "job".into(),
        transport: "temporal".into(),
        channel: channel.into(),
        message: message.into(),
        direction: direction.into(),
    }
}

struct RegistrationReader<'a> {
    source: &'a Source,
    rel: &'a dyn Fn(&Path) -> String,
    registrations: &'a mut Vec<Registration>,
}

impl<'ast> Visit<'ast> for RegistrationReader<'_> {
    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        if node.method == "register_workflow"
            && let Some(arguments) = &node.turbofish
            && let Some(workflow) = arguments.args.iter().find_map(|argument| match argument {
                GenericArgument::Type(Type::Path(path)) => path.path.segments.last().map(|segment| segment.ident.to_string()),
                _ => None,
            })
        {
            self.registrations.push(Registration {
                workflow,
                source: self.source.at(node.method.span(), self.rel),
            });
        }
        visit::visit_expr_method_call(self, node);
    }
}

struct RunReader<'a> {
    source: &'a Source,
    rel: &'a dyn Fn(&Path) -> String,
    actions: &'a mut Vec<RunAction>,
    calls: BTreeSet<String>,
}

impl<'ast> Visit<'ast> for RunReader<'_> {
    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        if node.method == "timer" {
            self.actions.push(RunAction::Timer(self.source.at(node.method.span(), self.rel)));
        } else if node.method == "wait_condition" {
            self.actions.push(RunAction::Wait(self.source.at(node.method.span(), self.rel)));
        } else if node.method == "execute_activity"
            && let Some(Expr::Path(activity)) = node.args.first()
            && let Some(method) = activity.path.segments.last()
        {
            let owner = activity
                .path
                .segments
                .iter()
                .rev()
                .nth(1)
                .map(|segment| segment.ident.to_string())
                .unwrap_or_default();
            self.actions.push(RunAction::Activity {
                owner,
                name: method.ident.to_string(),
                source: self.source.at(node.method.span(), self.rel),
            });
        }
        visit::visit_expr_method_call(self, node);
    }

    fn visit_expr_call(&mut self, node: &'ast ExprCall) {
        if let Expr::Path(path) = node.func.as_ref()
            && path.path.segments.len() == 1
            && let Some(function) = path.path.segments.last()
        {
            self.calls.insert(function.ident.to_string());
        }
        visit::visit_expr_call(self, node);
    }
}
