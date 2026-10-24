//! Kafka channels proved by Rust `rdkafka` client construction.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Expr, ExprCall, ExprMethodCall, Item};

use crate::catalog::{Channel, Flow, FlowHandoff, FlowNode, FlowTrigger, Participant, Step};
use crate::ids::slug;
use crate::source::{Crate, Source};

#[derive(Clone, Default)]
struct FoundChannel {
    directions: BTreeSet<String>,
    sources: BTreeSet<String>,
}

pub struct KafkaFacts {
    pub channels: Vec<Channel>,
    pub flows: Vec<Flow>,
}

pub fn read_kafka(krate: &Crate, context: &str, svc_id: &str, rel: &dyn Fn(&Path) -> String) -> KafkaFacts {
    let constants = string_constants(krate);
    let mut found: BTreeMap<String, FoundChannel> = BTreeMap::new();
    for source in &krate.sources {
        if !source.uses.values().any(|path| path.starts_with("rdkafka::")) {
            continue;
        }
        let mut reader = KafkaReader {
            source,
            constants: &constants,
            rel,
            found: &mut found,
        };
        reader.visit_file(&source.file);
    }

    let channels = found
        .iter()
        .map(|(address, found)| {
            let directions: Vec<String> = found.directions.iter().cloned().collect();
            let doc = match directions.as_slice() {
                [direction] if direction == "receive" => "Rust rdkafka client receives from this topic.",
                [direction] if direction == "send" => "Rust rdkafka client sends to this topic.",
                _ => "Rust rdkafka client sends to and receives from this topic.",
            };
            Channel {
                address: address.clone(),
                kind: "message".into(),
                protocol: "kafka".into(),
                title: "Kafka topic".into(),
                doc: doc.into(),
                // rdkafka proves the topic and how this service uses it, but
                // not the wire message name a handler dispatches on. Keep the
                // channel without inventing a message; a contract extractor
                // can merge the named messages into the same address.
                messages: vec![],
                source: found.sources.iter().next().cloned().unwrap_or_default(),
            }
        })
        .collect();
    let broker = "kafka".to_string();
    let mut flows = Vec::new();
    for (address, found) in found {
        for direction in found.directions {
            let receive = direction == "receive";
            let source = found.sources.iter().next().cloned().unwrap_or_default();
            let flow_slug = format!("kafka-{direction}-{}", slug(&address));
            let (from, to) = if receive {
                (broker.clone(), svc_id.to_string())
            } else {
                (svc_id.to_string(), broker.clone())
            };
            flows.push(Flow {
                id: format!("{svc_id}.{flow_slug}"),
                slug: flow_slug,
                name: format!("{} {address}", if receive { "Receive" } else { "Publish" }),
                summary: format!(
                    "Rust rdkafka client {} Kafka topic {address}.",
                    if receive { "subscribes to" } else { "publishes to" }
                ),
                source: source.clone(),
                trigger: FlowTrigger {
                    kind: if receive { "event" } else { "callback" }.into(),
                    label: format!("Kafka · {address}"),
                    confidence: "high".into(),
                },
                owner: context.into(),
                participants: if receive {
                    vec![
                        Participant { id: broker.clone(), kind: "broker".into(), context: None, label: Some("Kafka".into()) },
                        Participant { id: svc_id.into(), kind: "service".into(), context: Some(context.into()), label: None },
                    ]
                } else {
                    vec![
                        Participant { id: svc_id.into(), kind: "service".into(), context: Some(context.into()), label: None },
                        Participant { id: broker.clone(), kind: "broker".into(), context: None, label: Some("Kafka".into()) },
                    ]
                },
                steps: vec![FlowNode::Step(Step {
                    id: "delivery".into(),
                    from,
                    to,
                    kind: "event".into(),
                    label: format!("{} {address}", if receive { "receive" } else { "publish" }),
                    status: "declared".into(),
                    reference: None,
                    note: None,
                    line: Some(source),
                    handoff: Some(FlowHandoff {
                        kind: "message".into(),
                        transport: "kafka".into(),
                        channel: address.clone(),
                        message: String::new(),
                        direction,
                    }),
                })],
            });
        }
    }
    KafkaFacts { channels, flows }
}

fn string_constants(krate: &Crate) -> BTreeMap<String, String> {
    let mut constants = BTreeMap::new();
    for source in &krate.sources {
        for item in &source.file.items {
            let Item::Const(item) = item else { continue };
            if let Expr::Lit(value) = item.expr.as_ref()
                && let syn::Lit::Str(value) = &value.lit
            {
                constants.insert(item.ident.to_string(), value.value());
            }
        }
    }
    constants
}

struct KafkaReader<'a> {
    source: &'a Source,
    constants: &'a BTreeMap<String, String>,
    rel: &'a dyn Fn(&Path) -> String,
    found: &'a mut BTreeMap<String, FoundChannel>,
}

impl KafkaReader<'_> {
    fn keep(&mut self, expression: &Expr, direction: &str) {
        let source = self.source.at(expression.span(), self.rel);
        for topic in topics_of(expression, self.constants) {
            let channel = self.found.entry(topic).or_default();
            channel.directions.insert(direction.into());
            channel.sources.insert(source.clone());
        }
    }
}

impl<'ast> Visit<'ast> for KafkaReader<'_> {
    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        if node.method == "subscribe"
            && let Some(topics) = node.args.first()
        {
            self.keep(topics, "receive");
        }
        visit::visit_expr_method_call(self, node);
    }

    fn visit_expr_call(&mut self, node: &'ast ExprCall) {
        if let Expr::Path(path) = node.func.as_ref() {
            let segments: Vec<String> = path.path.segments.iter().map(|segment| segment.ident.to_string()).collect();
            if segments.ends_with(&["FutureRecord".into(), "to".into()])
                && self.source.resolve("FutureRecord").starts_with("rdkafka::producer::FutureRecord")
                && let Some(topic) = node.args.first()
            {
                self.keep(topic, "send");
            }
        }
        visit::visit_expr_call(self, node);
    }
}

fn topics_of(expression: &Expr, constants: &BTreeMap<String, String>) -> Vec<String> {
    match expression {
        Expr::Reference(reference) => topics_of(&reference.expr, constants),
        Expr::Array(array) => array.elems.iter().flat_map(|item| topics_of(item, constants)).collect(),
        Expr::Paren(paren) => topics_of(&paren.expr, constants),
        Expr::Lit(value) => match &value.lit {
            syn::Lit::Str(value) => vec![value.value()],
            _ => vec![],
        },
        Expr::Path(path) => path
            .path
            .segments
            .last()
            .and_then(|segment| constants.get(&segment.ident.to_string()))
            .cloned()
            .into_iter()
            .collect(),
        _ => vec![],
    }
}
