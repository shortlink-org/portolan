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
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Worker } from "node:worker_threads";

const PORTOLAN_VERSION = "0.1.0";
const HOST_LIMITS = Object.freeze({
  requestBytes: 4 * 1024 * 1024,
  responseBytes: 16 * 1024 * 1024,
  stderrBytes: 1024 * 1024,
  wasmBytes: 64 * 1024 * 1024,
  timeoutMs: 120_000,
});

/**
 * Runs one plugin.
 *
 * @param {{name: string, wasm?: {url: string, sha256?: string}, process?: {command: string, args?: string[]}}} plugin
 * @param {unknown} request
 * @returns {Promise<{files: {name: string, contents: string}[], describe?: object}>}
 */
export async function runPlugin(plugin, request, requestedLimits = {}) {
  const limits = lowerLimits(requestedLimits);
  let payload;
  try {
    payload = JSON.stringify(request);
  } catch (cause) {
    throw new Error(`plugin ${plugin.name}: request is not JSON-serializable: ${cause.message}`);
  }
  if (typeof payload !== "string") {
    throw new Error(`plugin ${plugin.name}: request is not a JSON value`);
  }
  if (Buffer.byteLength(payload) > limits.requestBytes) {
    throw new Error(`plugin ${plugin.name}: request exceeds ${limits.requestBytes} bytes`);
  }

  const result = plugin.wasm
    ? await runWasm(plugin, payload, limits)
    : await runProcess(plugin, payload, limits);
  if (result.stderr) process.stderr.write(result.stderr);

  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error(
      `plugin ${plugin.name} did not answer with JSON: ${cause.message}`,
    );
  }

  return validateResponse(plugin.name, response);
}

function lowerLimits(requested) {
  const limits = {};
  for (const [name, maximum] of Object.entries(HOST_LIMITS)) {
    const value = requested[name];
    limits[name] = Number.isSafeInteger(value) && value > 0
      ? Math.min(value, maximum)
      : maximum;
  }
  return limits;
}

/** Reject malformed or over-broad responses before they reach the filesystem. */
export function validateResponse(name, response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error(`plugin ${name} answered with a non-object response`);
  }
  const unexpected = Object.keys(response).filter((key) => !["files", "describe"].includes(key));
  if (unexpected.length > 0) {
    throw new Error(`plugin ${name} answered with unsupported properties: ${unexpected.join(", ")}`);
  }
  if (!Array.isArray(response.files)) {
    throw new Error(`plugin ${name} answered without a files list`);
  }

  const seen = new Set();
  const files = response.files.map((file, index) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new Error(`plugin ${name}: files[${index}] is not an object`);
    }
    const keys = Object.keys(file);
    if (keys.some((key) => !["name", "contents"].includes(key))) {
      throw new Error(`plugin ${name}: files[${index}] has unsupported properties`);
    }
    if (typeof file.name !== "string" || !safeFileName(file.name)) {
      throw new Error(`plugin ${name}: files[${index}] has an unsafe name`);
    }
    if (typeof file.contents !== "string") {
      throw new Error(`plugin ${name}: files[${index}].contents is not a string`);
    }
    if (seen.has(file.name)) {
      throw new Error(`plugin ${name}: duplicate output file ${file.name}`);
    }
    seen.add(file.name);
    return { name: file.name, contents: file.contents };
  });

  if (response.describe !== undefined) validateDescriptor(name, response.describe);
  return { files, ...(response.describe === undefined ? {} : { describe: response.describe }) };
}

function safeFileName(name) {
  if (!name || name.includes("\0") || isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) return false;
  const parts = name.split(/[\\/]/);
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function validateDescriptor(pluginName, descriptor) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error(`plugin ${pluginName}: describe is not an object`);
  }
  if (typeof descriptor.name !== "string" || descriptor.name.length === 0) {
    throw new Error(`plugin ${pluginName}: describe.name is missing`);
  }
  if (typeof descriptor.summary !== "string") {
    throw new Error(`plugin ${pluginName}: describe.summary is missing`);
  }
  if (!Array.isArray(descriptor.phases) || descriptor.phases.some((phase) => !["extract", "verify", "generate"].includes(phase))) {
    throw new Error(`plugin ${pluginName}: describe.phases is invalid`);
  }
  if (!descriptor.options || typeof descriptor.options !== "object" || Array.isArray(descriptor.options)) {
    throw new Error(`plugin ${pluginName}: describe.options is invalid`);
  }
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
 * @param {{name: string, wasm?: {url: string, sha256?: string}, process?: {command: string, args?: string[]}}} plugin
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

async function runWasm(plugin, payload, limits) {
  const bytes = await loadWasm(plugin, limits);

  const dir = await mkdtemp(join(tmpdir(), "portolan-plugin-"));
  const inPath = join(dir, "request.json");
  const outPath = join(dir, "response.json");
  const errPath = join(dir, "stderr.txt");

  writeFileSync(inPath, payload);
  writeFileSync(outPath, "");
  writeFileSync(errPath, "");

  try {
    const worker = new Worker(new URL("./plugin-wasm-worker.mjs", import.meta.url), {
      workerData: { name: plugin.name, bytes, inPath, outPath, errPath },
    });
    const code = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (cause, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cause ? reject(cause) : resolve(value);
      };
      const timer = setTimeout(async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          await worker.terminate();
        } finally {
          reject(new Error(`plugin ${plugin.name}: timed out after ${limits.timeoutMs} ms`));
        }
      }, limits.timeoutMs);
      worker.once("message", (message) => {
        if (message.error) finish(new Error(`plugin ${plugin.name}: ${message.error}`));
        else finish(null, message.code);
      });
      worker.once("error", (cause) => finish(new Error(`plugin ${plugin.name}: ${cause.message}`)));
      worker.once("exit", (exitCode) => {
        finish(new Error(`plugin ${plugin.name}: wasm worker exited ${exitCode} without a response`));
      });
    });

    if (code !== 0 && code !== undefined) {
      const message = readFileSync(errPath, "utf8").trim();
      throw new Error(
        `plugin ${plugin.name} exited ${code}${message ? `: ${message}` : ""}`,
      );
    }

    if (statSync(outPath).size > limits.responseBytes) {
      throw new Error(`plugin ${plugin.name}: response exceeds ${limits.responseBytes} bytes`);
    }
    if (statSync(errPath).size > limits.stderrBytes) {
      throw new Error(`plugin ${plugin.name}: stderr exceeds ${limits.stderrBytes} bytes`);
    }
    const stdoutText = readFileSync(outPath, "utf8");
    const stderrText = readFileSync(errPath, "utf8");
    return { stdout: stdoutText, stderr: stderrText };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadWasm(plugin, limits) {
  const { url, sha256 } = plugin.wasm;

  if (url.startsWith("file://")) {
    // Repo-relative, not a URL host. `file://plugins/x.wasm` means the file at
    // plugins/x.wasm next to the manifest, which is the only thing anyone
    // writing that line means.
    const bytes = readFileSync(url.slice("file://".length));
    // A checksum on a local file is optional: it protects a download, not a
    // module that was just built from the source next to it.
    if (sha256) verifyDigest(plugin.name, bytes, sha256);

    verifyWasmSize(plugin.name, bytes, limits.wasmBytes);
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

    verifyWasmSize(plugin.name, bytes, limits.wasmBytes);
    return bytes;
  } catch {
    // Not cached yet, or cached wrongly. Either way, fetch it again.
  }

  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(limits.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `plugin ${plugin.name}: ${url} answered ${response.status}`,
    );
  }

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > limits.wasmBytes) {
    throw new Error(`plugin ${plugin.name}: wasm module exceeds ${limits.wasmBytes} bytes`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limits.wasmBytes) {
      throw new Error(`plugin ${plugin.name}: wasm module exceeds ${limits.wasmBytes} bytes`);
    }
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  verifyWasmSize(plugin.name, bytes, limits.wasmBytes);
  verifyDigest(plugin.name, bytes, sha256);

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, bytes);

  return bytes;
}

function verifyWasmSize(name, bytes, maximum) {
  if (bytes.byteLength > maximum) {
    throw new Error(`plugin ${name}: wasm module exceeds ${maximum} bytes`);
  }
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

function runProcess(plugin, payload, limits) {
  const { command, args = [] } = plugin.process ?? {};
  if (typeof command !== "string" || command.length === 0 || !Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error(`plugin ${plugin.name}: process must declare command and string args`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (cause, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cause ? reject(cause) : resolve(value);
    };
    const stopForLimit = (stream, limit) => {
      child.kill("SIGKILL");
      finish(new Error(`plugin ${plugin.name}: ${stream} exceeds ${limit} bytes`));
    };

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > limits.responseBytes) return stopForLimit("response", limits.responseBytes);
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > limits.stderrBytes) return stopForLimit("stderr", limits.stderrBytes);
      stderr.push(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`plugin ${plugin.name}: timed out after ${limits.timeoutMs} ms`));
    }, limits.timeoutMs);

    child.on("error", (cause) => finish(new Error(`plugin ${plugin.name} did not start: ${cause.message}`)));
    child.on("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        finish(
          new Error(
            `plugin ${plugin.name} exited ${code}${stderrText ? `: ${stderrText.trim()}` : ""}`,
          ),
        );

        return;
      }
      finish(null, { stdout: stdoutText, stderr: stderrText });
    });

    child.stdin.end(payload);
  });
}
