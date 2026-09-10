use std::io::{Read, Write};

fn main() {
    let mut raw = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut raw) {
        eprintln!("portolan-extract-laravel: reading the request: {e}");
        std::process::exit(1);
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    match portolan_extract_laravel::serve(&raw, &cwd) {
        Ok(out) => {
            let _ = std::io::stdout().write_all(out.as_bytes());
        }
        Err(e) => {
            eprintln!("portolan-extract-laravel: {e}");
            std::process::exit(1);
        }
    }
}
