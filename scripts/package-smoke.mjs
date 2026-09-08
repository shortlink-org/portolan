// Exercises the CLI from a directory that contains none of Portolan's source.
// This catches accidental cwd coupling before the same package reaches npm.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "cli/portolan.mjs");
const fixture = mkdtempSync(resolve(tmpdir(), "portolan-package-smoke-"));

try {
  writeFileSync(resolve(fixture, "package.json"), '{"name":"package-smoke","version":"1.0.0"}\n');
  writeFileSync(resolve(fixture, "README.md"), "# Package smoke\n");
  // A Go domain layout: init should notice it and wire the extractor without being asked.
  writeFileSync(resolve(fixture, "go.mod"), "module example.com/smoke\n\ngo 1.24\n");
  mkdirSync(resolve(fixture, "internal/domain/order"), { recursive: true });
  writeFileSync(resolve(fixture, "internal/domain/order/order.go"), "package order\n\ntype Order struct{ ID string }\n");
  run("git", ["init", "--quiet"]);
  run("git", ["config", "user.email", "portolan@example.invalid"]);
  run("git", ["config", "user.name", "Portolan smoke test"]);
  run(process.execPath, [cli, "init", "--cwd", fixture, "--yes"]);
  run("git", ["add", "."]);
  run("git", ["commit", "--quiet", "-m", "fixture"]);
  run(process.execPath, [cli, "generate", "--cwd", fixture]);
  run(process.execPath, [cli, "check", "--cwd", fixture]);
  run(process.execPath, [cli, "build", "--cwd", fixture, "--output", "dist", "--base", "/architecture/"]);

  for (const path of ["portolan/project.json", "portolan/domain.json", "docs/README.md", "dist/index.html", "dist/404.html"]) {
    if (!existsSync(resolve(fixture, path))) throw new Error(`smoke test did not write ${path}`);
  }
  console.log("package smoke: init, generate, check, and build passed outside the repository");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function run(command, args) {
  execFileSync(command, args, { cwd: fixture, stdio: "inherit" });
}
