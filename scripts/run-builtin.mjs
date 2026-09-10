#!/usr/bin/env node

// Process adapter for plugins bundled in the npm package. It keeps the
// plugin's cwd in the user's workspace while resolving source and toolchain
// files from the installation. Most Go plugins are one wasm module
// (portolan.0006). A Go plugin that needs the project toolchain is compiled to
// a workspace-local sidecar here, then run with the user's workspace as cwd.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readManifest } from "./manifest.mjs";

const installRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = process.cwd();
const name = process.argv[2];
const manifest = readManifest(resolve(installRoot, "portolan.json"));
const plugin = (manifest.plugins ?? []).find((candidate) => candidate.name === name);

if (!plugin?.process) {
  console.error(`portolan: built-in process plugin ${JSON.stringify(name)} does not exist`);
  process.exit(2);
}

const command = plugin.process.command;
const args = [...(plugin.process.args ?? [])];

const prebuilt = command === "cargo" ? prebuiltCargoBinary(args) : "";
if (prebuilt) {
  run(prebuilt, []);
} else if (command === "go") {
  buildAndRunGo(args);
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

// `go run` changes module resolution with the current directory, but the
// analyzer must keep the scanned workspace as its cwd. Build from Portolan's
// shipped module first, outside the workspace, and execute the resulting
// native sidecar from the workspace. The Go build cache makes subsequent
// describe/extract calls cheap; rebuilding also prevents a stale sidecar after
// an npm upgrade with the same workspace cache.
function buildAndRunGo(argv) {
  if (argv[0] !== "run" || typeof argv[1] !== "string" || !argv[1] || argv[1].startsWith("-")) {
    console.error(`portolan: built-in ${name} has an unsupported Go command`);
    process.exitCode = 2;
    return;
  }
  const binDir = resolve(workspace, ".portolan", "bin", "go");
  const executable = resolve(binDir, process.platform === "win32" ? `${name}.exe` : name);
  mkdirSync(binDir, { recursive: true });
  const built = spawnSync("go", ["build", "-mod=readonly", "-o", executable, argv[1]], {
    cwd: installRoot,
    env: { ...process.env, GOWORK: "off" },
    stdio: "inherit",
  });
  if (built.error) {
    console.error(`portolan: built-in ${name} could not build: ${built.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (built.status !== 0) {
    process.exitCode = built.status ?? 1;
    return;
  }
  run(executable, argv.slice(2));
}

// A Rust plugin already built in release mode under its own crate directory,
// `plugins/extract-rust/target/release/portolan-extract-rust`, is run as it
// is; the crate is named after its directory, which is what the manifest
// path names.
function prebuiltCargoBinary(argv) {
  const manifest = argv[argv.indexOf("--manifest-path") + 1];
  if (!manifest || argv.indexOf("--manifest-path") < 0) return "";
  const crate = dirname(manifest).split("/").pop();
  const binary = resolve(installRoot, dirname(manifest), "target", "release", `portolan-${crate}`);
  return existsSync(binary) ? binary : "";
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
