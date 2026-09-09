#!/usr/bin/env node

// Process adapter for plugins bundled in the npm package. It keeps the
// plugin's cwd in the user's workspace while resolving source and toolchain
// files from the installation. The Go plugins no longer come through here:
// they are one wasm module (portolan.0006), and the fetchers run inside the
// host (portolan.0008).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

if (command === "cargo" && existsSync(resolve(installRoot, "plugins/extract-rust/target/release/portolan-extract-rust"))) {
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
