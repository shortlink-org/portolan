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

import Ajv from "ajv/dist/2020.js";

const SCHEMA = "schema/portolan.schema.json";

/**
 * Reads the manifest and validates it.
 *
 * @param {string} path
 * @returns {{manifest: object, problems: string[]}} problems is empty when the
 *   manifest is good, and the schema being absent is not a problem: a checkout
 *   that has not run `npm run schema` yet should still be able to generate.
 */
export function loadManifest(path = "portolan.json") {
  const manifest = JSON.parse(readFileSync(path, "utf8"));

  let schema;
  try {
    schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
  } catch {
    return { manifest, problems: [] };
  }

  const ajv = new Ajv({ allErrors: true, strictSchema: false });
  const validate = ajv.compile(schema);

  if (validate(manifest)) return { manifest, problems: [] };

  return { manifest, problems: explain(validate.errors ?? [], manifest, schema, path) };
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
