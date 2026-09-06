//! Development tasks for the service, run as `cargo xtask <task>` through the
//! alias in `.cargo/config.toml`. Plain std, no argument parser: two tasks do
//! not need one, and a dependency here is a dependency every clone pays for.

use std::path::Path;
use std::process::{Command, exit};

fn main() {
    let task = std::env::args().nth(1);
    let ok = match task.as_deref() {
        // Regenerate the gRPC stubs from the registry pins, own contract and the payments client
        Some("gen") => {
            run("buf", &["generate"]) && run("buf", &["generate", "--template", "buf.payments.gen.yaml"])
        }
        // Run fmt, clippy and the tests the way CI does
        Some("ci") => {
            run("cargo", &["fmt", "--check"])
                && run("cargo", &["clippy", "--all-targets", "--", "-D", "warnings"])
                && run("cargo", &["test"])
        }
        _ => {
            eprintln!("usage: cargo xtask <gen|ci>");
            false
        }
    };
    if !ok {
        exit(1);
    }
}

/// Runs one program at the crate root and says whether it succeeded. The
/// root is the parent of this package, wherever cargo was invoked from.
fn run(program: &str, args: &[&str]) -> bool {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("xtask sits inside the crate");
    match Command::new(program).args(args).current_dir(root).status() {
        Ok(status) => status.success(),
        Err(err) => {
            eprintln!("{program}: {err}");
            false
        }
    }
}
