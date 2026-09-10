// Exercises the CLI from a directory that contains none of Portolan's source.
// This catches accidental cwd coupling before the same package reaches npm.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
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
  writeFileSync(resolve(fixture, "go.mod"), "module example.com/smoke\n\ngo 1.27.0\n");
  mkdirSync(resolve(fixture, "internal/domain/order"), { recursive: true });
  writeFileSync(resolve(fixture, "internal/domain/order/order.go"), "package order\n\ntype Order struct{ ID string }\n");
  writeGoFixture("app/main.go", `package app
import (
  "example.com/smoke/actions/rules"
  "example.com/smoke/connector"
)
type Router struct{}
func (*Router) POST(string, func()) {}
type Requester interface { ConnExec(connector.API) }
func Start(r *Router) { r.POST("/rules", RulesAction) }
func RulesAction() {
  request := &rules.Request{}
  Dispatch(request)
}
func Dispatch(request Requester) { Invoke(request) }
func Invoke(request Requester) {
  conn := connector.Build("runtime")
  request.ConnExec(conn)
}
`);
  writeGoFixture("actions/rules/request.go", `package rules
import "example.com/smoke/connector"
type Request struct{}
func (*Request) ConnExec(conn connector.API) { conn.Rules() }
`);
  writeGoFixture("connector/factory.go", `package connector
import "example.com/smoke/provider/alpha"
type API interface { Rules() }
func Build(name string) API {
  switch name { case "alpha": return alpha.New(); default: return nil }
}
`);
  writeGoFixture("provider/alpha/connector.go", `package alpha
import "example.com/smoke/provider/alpha/client"
type rulesClient interface { FetchRules() }
type Connector struct { client rulesClient }
func New() *Connector { return &Connector{client: &client.Client{}} }
func (c *Connector) Rules() { c.client.FetchRules() }
`);
  writeGoFixture("provider/alpha/client/client.go", `package client
import "net/http"
type Client struct{}
func (c *Client) FetchRules() { c.fetchRules() }
func (c *Client) fetchRules() { c.finishRules() }
func (c *Client) finishRules() {
  _, _ = http.Get("https://alpha.example/v1/rules")
  if false { c.fetchRules() }
}
func (*Client) CheckRules() { _, _ = http.Get("https://alpha.example/v1/check-rules") }
`);
  run("git", ["init", "--quiet"]);
  run("git", ["config", "user.email", "portolan@example.invalid"]);
  run("git", ["config", "user.name", "Portolan smoke test"]);
  run(process.execPath, [cli, "init", "--cwd", fixture, "--yes"]);
  run("git", ["add", "."]);
  run("git", ["commit", "--quiet", "-m", "fixture"]);
  run(process.execPath, [cli, "generate", "--cwd", fixture]);
  run(process.execPath, [cli, "check", "--cwd", fixture]);
  run(process.execPath, [cli, "build", "--cwd", fixture, "--output", "dist", "--base", "/architecture/"]);

  for (const path of ["portolan/project.json", "portolan/domain.json", "portolan/http-clients.json", "docs/README.md", "dist/index.html", "dist/404.html"]) {
    if (!existsSync(resolve(fixture, path))) throw new Error(`smoke test did not write ${path}`);
  }
  const calls = JSON.parse(readFileSync(resolve(fixture, "portolan/http-clients.json"), "utf8"));
  if (!calls.flows.some((flow) => flow.name === "POST /rules → provider APIs")) {
    throw new Error(`package smoke did not preserve the typed HTTP provider flow; got ${calls.flows.map((flow) => flow.name).join(", ")}`);
  }
  console.log("package smoke: init, generate, check, and build passed outside the repository");
} finally {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(install, { recursive: true, force: true });
}

function run(command, args) {
  execFileSync(command, args, { cwd: fixture, stdio: "inherit" });
}

function writeGoFixture(path, contents) {
  mkdirSync(dirname(resolve(fixture, path)), { recursive: true });
  writeFileSync(resolve(fixture, path), contents);
}
