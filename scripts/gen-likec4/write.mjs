// Writes the generated sources under likec4/ in the working directory.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Writes `files` under likec4/, so that it holds exactly one workspace, and says what was written. */
export function writeLikeC4Sources(files) {
  // What an earlier run wrote and this one does not - the single model's
  // files once profiles appear, a profile since dropped - goes, so that
  // likec4/ holds exactly one workspace.
  mkdirSync("likec4", { recursive: true });
  const written = new Set(files.map((file) => file.name.split("/")[0]));
  for (const entry of readdirSync("likec4", { withFileTypes: true })) {
    if (entry.name.startsWith(".") || written.has(entry.name)) continue;
    if (entry.isDirectory() || entry.name.endsWith(".c4")) rmSync(join("likec4", entry.name), { recursive: true, force: true });
  }
  for (const file of files) {
    mkdirSync(dirname(join("likec4", file.name)), { recursive: true });
    writeFileSync(join("likec4", file.name), file.contents);
  }
  console.log(
    `wrote ${files.map((file) => `likec4/${file.name}`).join(", ")} ` +
      `(${files.filter((file) => file.name.endsWith("views.c4")).reduce((n, file) => n + (file.contents.match(/dynamic view /g)?.length ?? 0), 0)} dynamic views)`,
  );
}
