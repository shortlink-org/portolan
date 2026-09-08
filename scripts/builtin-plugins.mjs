// Resolves the plugins shipped with Portolan.
//
// A user manifest names built-ins by name and does not repeat how this npm
// package happens to run them. Custom plugins may still be declared in the
// manifest with `process` or `wasm`; those declarations always win.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INSTALL_ROOT = process.env.PORTOLAN_INSTALL_ROOT
  ? resolve(process.env.PORTOLAN_INSTALL_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");

let definitions;

function shippedDefinitions() {
  if (definitions) return definitions;
  const manifest = JSON.parse(readFileSync(resolve(INSTALL_ROOT, "portolan.json"), "utf8"));
  definitions = new Map((manifest.plugins ?? []).map((plugin) => [plugin.name, plugin]));
  return definitions;
}

export function builtinPluginNames() {
  return new Set(shippedDefinitions().keys());
}

/** Return a runnable built-in definition, or null when the package has none. */
export function builtinPlugin(name) {
  const declared = shippedDefinitions().get(name);
  if (!declared) return null;

  if (declared.wasm) {
    const value = declared.wasm.url;
    const url = value.startsWith("file://")
      ? `file://${resolve(INSTALL_ROOT, value.slice("file://".length))}`
      : value;
    return { ...declared, builtin: true, wasm: { ...declared.wasm, url } };
  }

  return {
    name,
    builtin: true,
    process: {
      command: process.execPath,
      args: [resolve(INSTALL_ROOT, "scripts/run-builtin.mjs"), name],
    },
  };
}
