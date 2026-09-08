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

/**
 * The definition as portolan.json declares it - `wasm`, or the `process`
 * with the real command - rather than the adapter `builtinPlugin` runs it
 * through. What `init` and `doctor` read to know which toolchain a plugin
 * asks for.
 */
export function builtinDefinition(name) {
  return shippedDefinitions().get(name) ?? null;
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

  // A plugin the host runs in its own process (portolan.0008): one that
  // needs a socket or a git binary, which the host holds and no module gets.
  if (declared.host) return { ...declared, builtin: true };

  return {
    name,
    builtin: true,
    process: {
      command: process.execPath,
      args: [resolve(INSTALL_ROOT, "scripts/run-builtin.mjs"), name],
    },
  };
}
