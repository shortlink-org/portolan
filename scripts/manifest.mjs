// Reads portolan.json and refuses one that does not match the schema the
// plugins describe.
//
// Without this a misspelled option is dropped in silence - `encoding/json`
// ignores a field it does not recognise, so `contextSummry` reads as no summary
// at all, and the page it should have written comes out blank with nothing said
// about why. The schema is checked here rather than asked for on every run:
// composing it means starting five plugins, and `npm run schema -- --check` in
// CI is what keeps the committed copy in step with them.

import { readFileSync } from "node:fs";
import { normalize } from "node:path";

import Ajv from "ajv/dist/2020.js";

// Read when asked, not when loaded: the CLI sets PORTOLAN_SCHEMA after its imports.
const schemaFile = () => process.env.PORTOLAN_SCHEMA || "schema/portolan.schema.json";

/**
 * Reads the manifest and validates it.
 *
 * @param {string} path
 * @returns {{manifest: object, problems: string[]}} problems is empty when the
 *   manifest is good, and the schema being absent is not a problem: a checkout
 *   that has not run `npm run schema` yet should still be able to generate.
 */
export function loadManifest(path = "portolan.json") {
  return parseManifest(readFileSync(path, "utf8"), path);
}

/**
 * Parses and validates manifest text. This is for manifests that do not live
 * in the working tree, such as the copy read from another git revision.
 *
 * @param {string} text
 * @param {string} path
 * @returns {{manifest: object, problems: string[]}}
 */
export function parseManifest(text, path = "portolan.json") {
  const manifest = JSON.parse(text);

  let schema;
  try {
    schema = JSON.parse(readFileSync(schemaFile(), "utf8"));
  } catch {
    return { manifest, problems: [] };
  }

  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  const validate = ajv.compile(schema);

  if (validate(manifest)) return { manifest, problems: [] };

  return { manifest, problems: explain(validate.errors ?? [], manifest, schema, path) };
}

/**
 * The runtime entry point: a caller either gets a schema-valid manifest or a
 * single actionable error. Code that wants to present every problem itself
 * can keep using loadManifest/parseManifest.
 *
 * @param {string} path
 * @returns {object}
 */
export function readManifest(path = "portolan.json") {
  return requireValidManifest(loadManifest(path));
}

/** @param {string} text @param {string} [path] */
export function readManifestText(text, path = "portolan.json") {
  return requireValidManifest(parseManifest(text, path));
}

/** @param {{manifest: object, problems: string[]}} loaded */
export function requireValidManifest(loaded) {
  if (loaded.problems.length > 0) {
    throw new Error(
      `portolan.json does not match schema/portolan.schema.json:\n${loaded.problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
  }
  return loaded.manifest;
}

/**
 * Turns ajv's errors into lines somebody can act on.
 *
 * The `if`/`then` branches that carry the per-plugin options report a failure
 * of their own on top of the real one, and `enum` repeats what `additionalProperties`
 * already said. Those are dropped: an error list nobody reads to the end is an
 * error list that hides the line that mattered.
 */
function explain(errors, manifest, schema, path) {
  const lines = [];

  for (const error of errors) {
    if (error.keyword === "if" || error.keyword === "allOf") continue;

    // `portolan.json extract/0/options`, rather than the two run together:
    // the pointer reads as a path of its own and gluing it to a filename makes
    // one long thing that is neither.
    const where = error.instancePath ? `${path} ${error.instancePath.slice(1)}` : path;

    if (error.keyword === "additionalProperties") {
      const key = error.params.additionalProperty;
      // Resolved from the schema rather than read off the error, because the
      // options of a step come in through a $ref and ajv hands back the
      // referring schema, which has no properties of its own.
      const known = Object.keys(at(schema, parentOf(error.schemaPath))?.properties ?? {});
      const near = closest(key, known);

      lines.push(
        `${where}: unknown key "${key}"${near ? `, did you mean "${near}"?` : ""}` +
          (known.length ? ` (known: ${known.join(", ")})` : ""),
      );

      continue;
    }

    if (error.keyword === "enum") {
      lines.push(
        `${where}: ${JSON.stringify(at(manifest, error.instancePath))} is not one of ${error.params.allowedValues.join(", ")}`,
      );

      continue;
    }

    if (error.keyword === "required") {
      lines.push(`${where}: "${error.params.missingProperty}" is missing`);

      continue;
    }

    lines.push(`${where}: ${error.message}`);
  }

  return [...new Set(lines)];
}

/** Follows a JSON pointer, as `#/$defs/options.go-domain` or `/extract/0`. */
function at(root, pointer) {
  return pointer
    .replace(/^#/, "")
    .split("/")
    .slice(1)
    .reduce(
      (value, segment) =>
        value?.[decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~")],
      root,
    );
}

/** The schema a keyword belongs to: its pointer without the keyword. */
function parentOf(schemaPath) {
  return schemaPath.slice(0, schemaPath.lastIndexOf("/"));
}

/** The known key a typo most likely meant, or null when nothing is close. */
function closest(key, known) {
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of known) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  // A third of the word, so `contextSummry` finds `contextSummary` and `traces`
  // does not find `events`.
  return bestDistance <= Math.max(1, Math.floor(key.length / 3)) ? best : null;
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }

  return previous[b.length];
}

/**
 * Names each step for the listing of what it wrote into its directory.
 *
 * A step is keyed by its plugin, which is enough while one step of a plugin
 * writes into a directory. Two of them - the service's own OpenAPI document and
 * the vendored copy of a supplier's, both read by `openapi` into the same
 * `portolan/` - are told apart by the file each names in its `out` option;
 * keyed by plugin alone, the second would take the first's listing for its own
 * and delete the fragment it had just written. A pair that not even the file
 * name tells apart would write the same file twice, and is refused.
 *
 * @param {object} manifest
 * @returns {{keyOf: (step: object) => string, liveIn: (out: string) => Set<string>}}
 *   keyOf names one step; liveIn is every key that writes into a directory on
 *   this run, so a key left in the listing by a step that no longer exists can
 *   be told from one that has simply not run yet.
 */
export function stepKeys(manifest) {
  const steps = [
    ...(manifest.extract ?? []),
    ...(manifest.verify ?? []),
    ...(manifest.generate ?? []),
  ];

  const dir = (out) => normalize(out).replace(/[\\/]+$/, "") || ".";

  const groups = new Map();
  for (const step of steps) {
    const group = `${dir(step.out)}\0${step.plugin}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(step);
  }

  const keys = new Map();
  const live = new Map();
  for (const group of groups.values()) {
    const taken = new Set();
    for (const step of group) {
      const file = typeof step.options?.out === "string" ? step.options.out.trim() : "";
      const key = group.length === 1 ? step.plugin : file ? `${step.plugin}:${file}` : "";
      if (!key || taken.has(key)) {
        throw new Error(
          `portolan.json: ${group.length} ${step.plugin} steps write into ${step.out}` +
            (key
              ? `, and two of them name ${file} in their options`
              : ", and nothing in their options tells them apart"),
        );
      }
      taken.add(key);
      keys.set(step, key);

      const out = dir(step.out);
      if (!live.has(out)) live.set(out, new Set());
      live.get(out).add(key);
    }
  }

  return {
    keyOf: (step) => keys.get(step),
    liveIn: (out) => live.get(dir(out)) ?? new Set(),
  };
}
