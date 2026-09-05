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
      preopens: {},
      stdin,
      stdout,
      stderr,
    });
    const module = await WebAssembly.compile(workerData.bytes);
    const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
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
