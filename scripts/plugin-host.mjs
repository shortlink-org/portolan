// Runs a portolan generator plugin and returns what it wants written.
//
// A plugin never touches the tree. It is handed a request on stdin and answers
// with named files on stdout; writing them - and refusing a name that climbs
// out of the output directory - is this file's job. That split is what lets the
// same plugin run as a sandboxed wasm module with no directory preopened at
// all, and it is why `--check` can compare a render against disk without the
// plugin knowing there is a disk.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";

const PORTOLAN_VERSION = "0.1.0";

/**
 * Runs one plugin.
 *
 * @param {{name: string, wasm?: {url: string, sha256?: string}, process?: {cmd: string}}} plugin
 * @param {unknown} request
 * @returns {Promise<{files: {name: string, contents: string}[], diagnostics: {severity: string, message: string, ref?: string}[]}>}
 */
export async function runPlugin(plugin, request) {
  const payload = JSON.stringify(request);

  const raw = plugin.wasm
    ? await runWasm(plugin, payload)
    : await runProcess(plugin, payload);

  let response;
  try {
    response = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `plugin ${plugin.name} did not answer with JSON: ${cause.message}`,
    );
  }

  if (!Array.isArray(response.files)) {
    throw new Error(`plugin ${plugin.name} answered without a files list`);
  }

  return {
    files: response.files,
    diagnostics: response.diagnostics ?? [],
    describe: response.describe,
  };
}

/**
 * Asks a plugin what it is and what it can be told.
 *
 * The answer is a descriptor with a JSON Schema for its options, which is what
 * schema/portolan.schema.json is composed from. A plugin written against an
 * older protocol answers without one; that comes back as null rather than as
 * an error, because a manifest naming it is not wrong, it is just a manifest
 * nothing can check.
 *
 * @param {{name: string, wasm?: {url: string, sha256?: string}, process?: {cmd: string}}} plugin
 */
export async function describePlugin(plugin) {
  const { describe } = await runPlugin(plugin, {
    portolanVersion: PORTOLAN_VERSION,
    kind: "describe",
  });

  return describe ?? null;
}

// ---------------------------------------------------------------------------
// wasm
//
// Node's WASI takes file descriptors rather than pipes, so the request and the
// response go through a scratch directory. That is the only place the sandbox
// leaks, and it leaks into a temporary directory the plugin is not told about:
// `preopens` stays empty, so the module cannot open a path even if it tries.
// ---------------------------------------------------------------------------

async function runWasm(plugin, payload) {
  const bytes = await loadWasm(plugin);

  const dir = await mkdtemp(join(tmpdir(), "portolan-plugin-"));
  const inPath = join(dir, "request.json");
  const outPath = join(dir, "response.json");
  const errPath = join(dir, "stderr.txt");

  writeFileSync(inPath, payload);
  writeFileSync(outPath, "");
  writeFileSync(errPath, "");

  const stdin = openSync(inPath, "r");
  const stdout = openSync(outPath, "w");
  const stderr = openSync(errPath, "w");

  try {
    const wasi = new WASI({
      version: "preview1",
      args: [plugin.name],
      env: {},
      preopens: {},
      stdin,
      stdout,
      stderr,
    });

    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(
      module,
      wasi.getImportObject(),
    );

    const code = wasi.start(instance);
    closeSync(stdout);
    closeSync(stderr);

    if (code !== 0 && code !== undefined) {
      const message = readFileSync(errPath, "utf8").trim();
      throw new Error(
        `plugin ${plugin.name} exited ${code}${message ? `: ${message}` : ""}`,
      );
    }

    return readFileSync(outPath, "utf8");
  } finally {
    for (const fd of [stdin, stdout, stderr]) {
      try {
        closeSync(fd);
      } catch {
        // Already closed on the success path; closing twice is not an error
        // worth reporting over whatever brought us here.
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadWasm(plugin) {
  const { url, sha256 } = plugin.wasm;

  if (url.startsWith("file://")) {
    // Repo-relative, not a URL host. `file://plugins/x.wasm` means the file at
    // plugins/x.wasm next to the manifest, which is the only thing anyone
    // writing that line means.
    const bytes = readFileSync(url.slice("file://".length));
    // A checksum on a local file is optional: it protects a download, not a
    // module that was just built from the source next to it.
    if (sha256) verifyDigest(plugin.name, bytes, sha256);

    return bytes;
  }

  if (!url.startsWith("https://")) {
    throw new Error(
      `plugin ${plugin.name}: wasm url must be https:// or file://, got ${url}`,
    );
  }
  if (!sha256) {
    throw new Error(
      `plugin ${plugin.name}: a downloaded plugin must declare its sha256`,
    );
  }

  const cacheDir = join("node_modules", ".cache", "portolan-plugins");
  const cached = join(cacheDir, `${sha256}.wasm`);
  try {
    const bytes = readFileSync(cached);
    verifyDigest(plugin.name, bytes, sha256);

    return bytes;
  } catch {
    // Not cached yet, or cached wrongly. Either way, fetch it again.
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `plugin ${plugin.name}: ${url} answered ${response.status}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  verifyDigest(plugin.name, bytes, sha256);

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, bytes);

  return bytes;
}

function verifyDigest(name, bytes, expected) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `plugin ${name}: sha256 is ${actual}, the manifest says ${expected}`,
    );
  }
}

// ---------------------------------------------------------------------------
// process
//
// The escape hatch for a generator that needs a toolchain - one reading Go
// source has to run `go list`, which no wasm module can. It gets the same
// protocol and none of the sandbox, which is the trade being made and the
// reason it is not the default.
// ---------------------------------------------------------------------------

function runProcess(plugin, payload) {
  const [command, ...args] = plugin.process.cmd.split(/\s+/);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (cause) =>
      reject(new Error(`plugin ${plugin.name} did not start: ${cause.message}`)),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `plugin ${plugin.name} exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );

        return;
      }
      resolve(stdout);
    });

    child.stdin.end(payload);
  });
}
