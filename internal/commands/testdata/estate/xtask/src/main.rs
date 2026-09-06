use clap::{Parser, Subcommand};

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Regenerate the gRPC stubs from the vendored protos
    Gen,
    /// Run fmt, clippy and the tests the way CI does
    Ci { #[arg(long)] fix: bool },
    #[command(about = "Build the release artefacts")]
    Dist(DistArgs),
}

fn main() {
    let arg = std::env::args().nth(1);
    match arg.as_deref() {
        Some("gen") => gen(),
        // Run the benchmarks against the compose stack
        Some("bench") | Some("perf") => bench(),
        _ => usage(),
    }
}
