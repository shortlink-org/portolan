//! Queued jobs: what the application hands to a worker instead of doing
//! now. A class under `Jobs/` or implementing `ShouldQueue` is a job; the
//! places that hand one over are `Job::dispatch(...)`, `dispatch(new Job)`,
//! `Bus::dispatch(new Job)` and the `Bus::chain([...])` and `Bus::batch`
//! lists. Each queue the jobs go on is a channel of kind `job`, the way
//! extract-celery writes a Celery queue, and a dispatch is a hop in a flow.

use std::path::PathBuf;

use crate::events::every_chain;
use crate::ids::short;
use crate::source::{Base, Chain, ClassInfo, ClassKind, SourceFile, Tree, Val};

#[derive(Debug, Clone)]
pub struct Job {
    pub fqn: String,
    pub name: String,
    pub doc: String,
    /// `public $queue = 'indexing'` on the job, when it says.
    pub queue: Option<String>,
    pub module: usize,
    pub file: PathBuf,
    pub line: u32,
}

#[derive(Debug, Clone)]
pub struct Dispatch {
    pub job: String,
    /// `->onQueue('mail')` at the site, when it says.
    pub queue: Option<String>,
    pub file: PathBuf,
    pub line: u32,
}

#[derive(Debug, Default)]
pub struct Jobs {
    pub jobs: Vec<Job>,
    pub dispatches: Vec<Dispatch>,
}

impl Jobs {
    pub fn job(&self, fqn: &str) -> Option<&Job> {
        self.jobs.iter().find(|j| j.fqn == fqn)
    }

    /// The queue a job lands on: the site's `onQueue`, else the job's own
    /// `$queue`, else the queue its first dispatch site names, else
    /// Laravel's `default`.
    pub fn queue_of(&self, fqn: &str, site: Option<&str>) -> String {
        site.map(String::from)
            .or_else(|| self.job(fqn).and_then(|j| j.queue.clone()))
            .or_else(|| self.dispatches.iter().filter(|d| d.job == fqn).find_map(|d| d.queue.clone()))
            .unwrap_or_else(|| "default".into())
    }
}

pub fn is_job_class(file: &SourceFile, class: &ClassInfo) -> bool {
    class.kind == ClassKind::Class
        && !class.is_abstract
        // A queued listener is worked through the queue too, but it is a
        // listener, drawn from the event it reacts to.
        && !file.has_segment("Listeners")
        // A mailable or a notification is queued too, but it is not worked
        // by a `handle`; only what has one is a job.
        && (class.method("handle").is_some() || class.method("__invoke").is_some())
        && (class.implements.iter().any(|i| short(i) == "ShouldQueue") || file.has_segment("Jobs"))
}

pub fn read(tree: &Tree) -> Jobs {
    let mut jobs = Jobs::default();
    for (file, class) in tree.classes() {
        if !is_job_class(file, class) {
            continue;
        }
        let queue = match class.prop("queue").and_then(|p| p.value.as_ref()) {
            Some(Val::Str(q)) => Some(q.clone()),
            _ => None,
        };
        jobs.jobs.push(Job {
            fqn: class.fqn.clone(),
            name: class.name.clone(),
            doc: class.doc.clone(),
            queue,
            module: file.module,
            file: file.path.clone(),
            line: class.line,
        });
    }
    for (file, chain, _) in every_chain(tree) {
        for (job, queue) in dispatched(tree, &jobs, chain) {
            jobs.dispatches.push(Dispatch {
                job,
                queue,
                file: file.path.clone(),
                line: chain.line,
            });
        }
    }
    jobs
}

/// The jobs a chain hands to the queue, with the queue the site names.
pub fn dispatched(tree: &Tree, jobs: &Jobs, chain: &Chain) -> Vec<(String, Option<String>)> {
    let on_queue = |parts: &[crate::source::Part]| {
        parts
            .iter()
            .find(|p| p.name == "onQueue")
            .and_then(|p| p.args.as_ref())
            .and_then(|a| a.first())
            .and_then(Val::as_str)
            .map(String::from)
    };
    let is_job = |name: &str| tree.class(name).is_some_and(|c| jobs.job(&c.fqn).is_some());
    let new_jobs = |val: &Val| -> Vec<String> {
        match val {
            Val::Chain(inner) => match &inner.base {
                Base::New(class, _) if is_job(class) => vec![class.clone()],
                _ => vec![],
            },
            Val::Arr(items) => items
                .iter()
                .flat_map(|(_, v)| match v {
                    Val::Chain(inner) => match &inner.base {
                        Base::New(class, _) if is_job(class) => Some(class.clone()),
                        _ => None,
                    },
                    _ => None,
                })
                .collect(),
            _ => vec![],
        }
    };
    match &chain.base {
        Base::Static(class) if short(class) == "Bus" => {
            let Some(part) = chain.parts.first() else { return vec![] };
            let Some(args) = part.args.as_ref() else { return vec![] };
            if !matches!(
                part.name.as_str(),
                "dispatch" | "dispatchSync" | "dispatchNow" | "dispatchAfterResponse" | "chain" | "batch"
            ) {
                return vec![];
            }
            let queue = on_queue(&chain.parts);
            args.first()
                .map(|a| new_jobs(a).into_iter().map(|j| (j, queue.clone())).collect())
                .unwrap_or_default()
        }
        Base::Static(class) if is_job(class) => {
            let Some(part) = chain.parts.first() else { return vec![] };
            if part.args.is_none()
                || !matches!(
                    part.name.as_str(),
                    "dispatch" | "dispatchSync" | "dispatchNow" | "dispatchAfterResponse" | "dispatchIf" | "dispatchUnless"
                )
            {
                return vec![];
            }
            vec![(
                tree.class(class).map(|c| c.fqn.clone()).unwrap_or_else(|| class.clone()),
                on_queue(&chain.parts),
            )]
        }
        Base::Func(name, args) if matches!(short(name), "dispatch" | "dispatch_sync") => {
            let queue = on_queue(&chain.parts);
            args.first()
                .map(|a| new_jobs(a).into_iter().map(|j| (j, queue.clone())).collect())
                .unwrap_or_default()
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_jobs_and_every_way_they_are_dispatched() {
        let tree = Tree::from_sources(&[
            (
                "packages/A/Sales/src/Jobs/IndexOrder.php",
                "<?php\nnamespace A\\Sales\\Jobs;\nuse Illuminate\\Contracts\\Queue\\ShouldQueue;\n/** Puts the order in the search index. */\nclass IndexOrder implements ShouldQueue { public $queue = 'indexing'; public function handle() {} }\n",
            ),
            (
                "packages/A/Mail/src/Jobs/SendReceipt.php",
                "<?php\nnamespace A\\Mail\\Jobs;\nclass SendReceipt { public function handle() {} }\n",
            ),
            (
                "packages/A/Sales/src/Repositories/OrderRepository.php",
                "<?php\nnamespace A\\Sales\\Repositories;\nuse A\\Sales\\Jobs\\IndexOrder;\nuse A\\Mail\\Jobs\\SendReceipt;\nuse Illuminate\\Support\\Facades\\Bus;\nclass OrderRepository {\n  public function create($o) {\n    IndexOrder::dispatch($o);\n    dispatch(new SendReceipt($o))->onQueue('mail');\n    Bus::chain([new IndexOrder($o), new SendReceipt($o)])->dispatch();\n    IndexOrder::dispatchSync($o)->onQueue('now');\n  }\n}\n",
            ),
        ]);
        let jobs = read(&tree);
        assert_eq!(jobs.jobs.iter().map(|j| j.name.as_str()).collect::<Vec<_>>(), ["IndexOrder", "SendReceipt"]);
        let sites: Vec<String> = jobs
            .dispatches
            .iter()
            .map(|d| format!("{} {} @{}", short(&d.job), jobs.queue_of(&d.job, d.queue.as_deref()), d.line))
            .collect();
        // SendReceipt names no queue of its own; the site that does says `mail`, and the chain follows it.
        assert_eq!(
            sites,
            [
                "IndexOrder indexing @8",
                "SendReceipt mail @9",
                "IndexOrder indexing @10",
                "SendReceipt mail @10",
                "IndexOrder now @11"
            ]
        );
        assert_eq!(jobs.queue_of("A\\Mail\\Jobs\\SendReceipt", None), "mail");
        assert_eq!(
            crate::source::summary(&jobs.job("A\\Sales\\Jobs\\IndexOrder").unwrap().doc),
            "Puts the order in the search index."
        );
    }
}
