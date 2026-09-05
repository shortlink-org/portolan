import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

/** Resolve one plugin-owned path and reject traversal and existing symlinks. */
export function safeOutputPath(out, name) {
  if (!name || isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.includes("\\")) {
    throw new Error(`plugin asked to use ${JSON.stringify(name)}, which is not a relative path`);
  }

  const root = resolve(out);
  const target = resolve(root, normalize(name));
  const inside = relative(root, target);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`plugin asked to use ${JSON.stringify(name)}, which is outside ${out}`);
  }
  assertNoSymlinks(root, inside, name);
  return target;
}

/**
 * Write after validating again immediately before open. The hook is used by a
 * regression test to replace a checked directory with a symlink at the exact
 * point where the historical implementation was vulnerable.
 */
export function writeOutputFile(out, name, contents, { beforeOpen } = {}) {
  let target = safeOutputPath(out, name);
  mkdirSync(dirname(target), { recursive: true });
  beforeOpen?.({ target });

  target = safeOutputPath(out, name);
  assertParentInside(resolve(out), target, name);

  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC |
    (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(target, flags, 0o644);
  try {
    writeFileSync(fd, contents, "utf8");
  } finally {
    closeSync(fd);
  }
}

export function removeOutputFile(out, name) {
  const target = safeOutputPath(out, name);
  assertParentInside(resolve(out), target, name);
  rmSync(target, { force: true });
}

function assertNoSymlinks(root, inside, name) {
  let current = root;
  for (const part of ["", ...inside.split(sep)]) {
    if (part) current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`plugin asked to use ${JSON.stringify(name)}, but ${current} is a symlink`);
      }
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
  }
}

function assertParentInside(root, target, name) {
  const realRoot = realpathSync(root);
  const realParent = realpathSync(dirname(target));
  const held = relative(realRoot, realParent);
  if (held === ".." || held.startsWith(`..${sep}`) || isAbsolute(held)) {
    throw new Error(`plugin asked to use ${JSON.stringify(name)}, whose parent escaped ${root}`);
  }
}
