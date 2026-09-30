// The manifest's source globs, matched without a Node globber. On its own and
// free of imports, because vite.config.ts reads it too: the build groups each
// profile's sources into a chunk by the same patterns the app selects them by.

/** Match the source globs used by the manifest without bringing a Node globber into the browser. */
export function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char !== "*") {
      source += /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
      continue;
    }
    if (glob[i + 1] === "*") {
      i++;
      source += glob[i + 1] === "/" ? "(?:.*/)?" : ".*";
      if (glob[i + 1] === "/") i++;
    } else {
      source += "[^/]*";
    }
  }
  return new RegExp(`${source}$`);
}

/** Whether a source path is one of the patterns'. */
export function matchesSourceGlobs(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}
