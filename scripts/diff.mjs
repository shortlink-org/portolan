// What a branch changes about the architecture.
//
//   node scripts/diff.mjs             against origin/main, or main
//   node scripts/diff.mjs <ref>       against any commit, tag or branch
//
// `gen:check` proves the documentation follows from the catalog; it says
// nothing about what a change DOES. The diff it leaves a reviewer with is a
// hundred markdown pages, which is a shape nobody reads and everybody
// approves. This prints the other thing: the events, endpoints, transitions
// and owners that are not what they were.
//
// The catalog at the base ref is not rebuilt. Every source a plugin writes is
// COMMITTED - that is the whole point of `gen:check` - so the estate as it
// stood at any commit is a handful of `git show`s away, and nothing here needs
// a checkout, a worktree, a toolchain, or the extractors to run twice. The
// working tree's side is read the way the app reads it.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { validateCatalog } from "../src/catalog.ts";
import { enrichCatalog } from "../src/enrich.ts";
import { mergeCatalogs } from "../src/merge.ts";
import { diffCatalogs, SEVERITIES } from "../src/lib/catalog-diff.ts";
import { loadCatalog } from "./catalog-sources.mjs";

const HEADINGS = {
  breaking: "Breaking",
  addition: "Added",
  change: "Changed",
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const ref = options.ref || defaultBase();
  const before = catalogAt(ref);
  const { catalog: after } = await loadCatalog("portolan.json");
  const changes = diffCatalogs(before, after);
  const output = renderFormat(options.format, ref, changes);
  if (options.output) {
    writeFileSync(options.output, output);
    console.log(`architecture diff: ${options.format} → ${options.output}`);
  } else {
    process.stdout.write(output);
  }

  // Zero either way. This describes a change; it does not judge one, and a
  // non-zero exit would make every pull request that touches the estate look
  // like a failure.
}

export function parseArgs(args) {
  const options = { ref: "", format: "markdown", output: "" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--format" || arg === "--output") {
      const value = args[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    } else if (options.ref) {
      throw new Error(`more than one base ref: ${options.ref}, ${arg}`);
    } else {
      options.ref = arg;
    }
  }
  if (!["markdown", "json", "sarif"].includes(options.format)) {
    throw new Error(`unknown diff format ${options.format}; use markdown, json or sarif`);
  }
  return options;
}

export function renderFormat(format, ref, changes) {
  if (format === "json") return renderJson(ref, changes);
  if (format === "sarif") return renderSarif(ref, changes);
  return render(ref, changes);
}

/**
 * Where to compare against when nobody said: the trunk as the remote has it,
 * because a local `main` that has not been fetched for a week would report a
 * week of somebody else's work as this branch's.
 */
function defaultBase() {
  for (const ref of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { stdio: "ignore" });

      return ref;
    } catch {
      // Not a ref in this repository.
    }
  }

  throw new Error("no origin/main or main to compare against; name a ref");
}

/** The merged, enriched, validated catalog as it stood at `ref`. */
function catalogAt(ref) {
  const manifest = JSON.parse(git(["show", ref + ":portolan.json"]));
  const patterns = (manifest.sources ?? []).map(globToRegExp);

  const paths = git(["ls-tree", "-r", "--name-only", ref])
    .split("\n")
    .filter((path) => patterns.some((re) => re.test(path)));

  if (paths.length === 0) {
    throw new Error(ref + " holds no catalog sources matching " + JSON.stringify(manifest.sources));
  }

  const merged = mergeCatalogs(
    paths.map((path) => ({ path, catalog: JSON.parse(git(["show", ref + ":" + path])) })),
  );

  // Enriched before it is compared, exactly as the app and the generators see
  // it, so a derived edge is compared with a derived edge rather than with a
  // difference in how the two sides were built.
  const { catalog } = enrichCatalog(merged.catalog);
  try {
    validateCatalog(catalog);
  } catch (cause) {
    throw new Error("the catalog at " + ref + " is not valid: " + cause.message);
  }

  return catalog;
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trimEnd();
}

/**
 * A manifest glob as a regular expression.
 *
 * A star stops at a slash and two stars do not, which is what the manifest's
 * patterns mean and what `fs.glob` gives the working tree's side. Anchored at
 * both ends: a source pattern names a whole path.
 */
export function globToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }

      continue;
    }
    out += /[a-zA-Z0-9/_-]/.test(c) ? c : "\\" + c;
  }

  return new RegExp("^" + out + "$");
}

/** The report, as markdown, because that is what a pull request renders. */
export function render(ref, changes) {
  if (changes.length === 0) {
    return "No architectural change against `" + ref + "`.\n";
  }

  const lines = [
    "### Architecture, against `" + ref + "`",
    "",
    changes.length + " change" + (changes.length === 1 ? "" : "s") + ".",
    "",
  ];

  for (const severity of SEVERITIES) {
    const of = changes.filter((change) => change.severity === severity);
    if (of.length === 0) continue;

    lines.push("**" + HEADINGS[severity] + "** (" + of.length + ")", "");
    for (const change of of) lines.push("- " + change.summary);
    lines.push("");
  }

  return lines.join("\n");
}

function counts(changes) {
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, changes.filter((change) => change.severity === severity).length]));
}

/** Stable machine output for CI, bots and downstream reports. */
export function renderJson(ref, changes) {
  return `${JSON.stringify({ version: 1, base: ref, counts: counts(changes), changes }, null, 2)}\n`;
}

/** SARIF 2.1.0: breaking changes are errors; everything else remains reviewable. */
export function renderSarif(ref, changes) {
  const kinds = [...new Set(changes.map((change) => change.kind))].sort();
  const rules = kinds.map((kind) => ({
    id: kind,
    name: kind.replace(/[^a-zA-Z0-9]+/g, "_"),
    shortDescription: { text: `Portolan architecture change: ${kind}` },
    helpUri: "https://github.com/shortlink-org/portolan",
  }));
  const level = { breaking: "error", change: "warning", addition: "note" };
  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: "Portolan", informationUri: "https://github.com/shortlink-org/portolan", rules } },
      automationDetails: { id: `architecture-diff/${ref}` },
      results: changes.map((change) => ({
        ruleId: change.kind,
        level: level[change.severity],
        message: { text: change.summary },
        properties: { severity: change.severity, where: change.where, base: ref },
      })),
    }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

// Only when run, not when imported: the tests below this reach for the two
// pieces with logic in them, and a module that ran a git command on import
// would be a module they could not reach at all.
if (import.meta.main) {
  main().catch((cause) => {
    console.error("diff: " + cause.message);
    process.exit(1);
  });
}
