// Exercises the CLI from a directory that contains none of Portolan's source.
// This catches accidental cwd coupling before the same package reaches npm.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = mkdtempSync(resolve(tmpdir(), "portolan-package-smoke-"));
const install = mkdtempSync(resolve(tmpdir(), "portolan-package-install-"));

try {
  // Exercise the tarball from a real node_modules path. Node permits native
  // TypeScript stripping in a checkout but rejects it below node_modules, so
  // invoking the source-tree CLI did not catch broken published entry graphs.
  const tarball = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", install], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim().split("\n").at(-1);
  const scope = resolve(install, "node_modules/@shortlink-org");
  mkdirSync(scope, { recursive: true });
  execFileSync("tar", ["-xzf", resolve(install, tarball), "-C", scope]);
  const installed = resolve(scope, "portolan");
  renameSync(resolve(scope, "package"), installed);
  symlinkSync(resolve(root, "node_modules"), resolve(installed, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const cli = resolve(installed, "cli/portolan.mjs");

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
  rmSync(install, { recursive: true, force: true });
}

function run(command, args) {
  execFileSync(command, args, { cwd: fixture, stdio: "inherit" });
}
