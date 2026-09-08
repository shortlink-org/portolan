import { closeSync, openSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { WASI } from "node:wasi";

async function run() {
  const stdin = openSync(workerData.inPath, "r");
  const stdout = openSync(workerData.outPath, "w");
  const stderr = openSync(workerData.errPath, "w");
  try {
    const wasi = new WASI({
      version: "preview1",
      args: [workerData.name],
      env: {},
      // Empty for a generator or a describe request. An extract or verify
      // step gets the workspace as `/`, and nothing else (portolan.0006).
      preopens: workerData.workspace ? { "/": workerData.workspace } : {},
      stdin,
      stdout,
      stderr,
    });
    // The module was compiled once by the host and shared; a 20 MB module
    // compiled per step would cost more than the step.
    const instance = await WebAssembly.instantiate(workerData.module, wasi.getImportObject());
    return wasi.start(instance);
  } finally {
    closeSync(stdin);
    closeSync(stdout);
    closeSync(stderr);
  }
}

try {
  const code = await run();
  parentPort.postMessage({ code });
} catch (cause) {
  parentPort.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
}
