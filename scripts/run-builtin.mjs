#!/usr/bin/env node

// Process adapter for plugins bundled in the npm package. It keeps the
// plugin's cwd in the user's workspace while resolving source and toolchain
// files from the installation. Go plugins are compiled into the ignored
// `.portolan/bin` directory because `go run` changes the child cwd to the
// module containing the plugin.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const installRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = process.cwd();
const name = process.argv[2];
const manifest = JSON.parse(readFileSync(resolve(installRoot, "portolan.json"), "utf8"));
const plugin = (manifest.plugins ?? []).find((candidate) => candidate.name === name);

if (!plugin?.process) {
  console.error(`portolan: built-in process plugin ${JSON.stringify(name)} does not exist`);
  process.exit(2);
}

const command = plugin.process.command;
const args = [...(plugin.process.args ?? [])];

if (command === "go" && args[0] === "run" && args[1]) {
  const binDir = resolve(workspace, ".portolan", "bin");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const binary = resolve(binDir, `${name}${suffix}`);
  mkdirSync(binDir, { recursive: true });

  // Rebuilding is deliberately left to Go's build cache. Package upgrades can
  // change shared extractor code without changing this plugin directory, so a
  // timestamp shortcut here would make an old binary look current.
  const built = spawnSync(
    "go",
    ["build", "-o", binary, args[1]],
    { cwd: installRoot, stdio: ["ignore", "ignore", "inherit"] },
  );
  if (built.error) {
    console.error(`portolan: could not start Go to build ${name}: ${built.error.message}`);
    process.exit(1);
  }
  if (built.status !== 0 || !existsSync(binary)) process.exit(built.status ?? 1);
  // What follows the package path is the binary's own argv: the plugin name
  // for the multi-call portolan-go.
  run(binary, args.slice(2));
} else if (command === "cargo" && existsSync(resolve(installRoot, "plugins/extract-rust/target/release/portolan-extract-rust"))) {
  run(resolve(installRoot, "plugins/extract-rust/target/release/portolan-extract-rust"), []);
} else {
  if (command === "cargo") {
    process.env.CARGO_TARGET_DIR = resolve(workspace, ".portolan", "bin", "cargo");
  }
  const resolved = args.map((arg, index) => {
    if (!arg || arg.startsWith("-") || resolveArgument(command, index) === false) return arg;
    return resolve(installRoot, arg);
  });
  run(command, resolved);
}

function resolveArgument(executable, index) {
  if (["node", "python", "python3"].includes(executable)) return index === 0;
  if (executable === "java") return index === 1;
  if (executable === "cargo") return index === 3;
  return false;
}

function run(executable, argv) {
  const child = spawn(executable, argv, { cwd: workspace, stdio: "inherit" });
  child.once("error", (cause) => {
    console.error(`portolan: built-in ${name} did not start: ${cause.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}
