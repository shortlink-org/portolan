// Why a generated file is not what the generator produces now, in one line.
//
// `gen --check` used to say "changed docs/x.md" and nothing else, which sent
// the reader to a diff of the whole file to learn that one number moved.
// The first difference is usually the whole story: a JSON fragment names the
// path that differs and both values, a page names the line.

/**
 * @param {string | Buffer | null} current  what is on disk, null when absent
 * @param {string | Buffer} wanted          what the generator produced
 * @param {string} name                     the file's name, for its format
 * @returns {string}
 */
export function explainChange(current, wanted, name) {
  if (current === null) return "not on disk yet";
  if (Buffer.isBuffer(current) || Buffer.isBuffer(wanted)) return "binary contents differ";
  if (name.endsWith(".json")) {
    const found = jsonDifference(current, wanted);
    if (found) return found;
  }
  return lineDifference(current, wanted);
}

/** The first path where two JSON documents disagree, or "" when either does not parse. */
export function jsonDifference(current, wanted) {
  let a;
  let b;
  try {
    a = JSON.parse(current);
    b = JSON.parse(wanted);
  } catch {
    return "";
  }
  return firstDifference(a, b, "") ?? "same value, different formatting";
}

function firstDifference(a, b, path) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (found) return found;
    }
    if (a.length !== b.length) {
      return `${path || "the document"}: ${a.length} item${a.length === 1 ? "" : "s"} → ${b.length}`;
    }
    return null;
  }
  if (isObject(a) && isObject(b)) {
    for (const key of Object.keys(b)) {
      const at = path ? `${path}.${key}` : key;
      if (!(key in a)) return `${at}: added ${short(b[key])}`;
      const found = firstDifference(a[key], b[key], at);
      if (found) return found;
    }
    for (const key of Object.keys(a)) {
      if (!(key in b)) return `${path ? `${path}.${key}` : key}: removed`;
    }
    return null;
  }
  if (Object.is(a, b)) return null;
  return `${path || "the document"}: ${short(a)} → ${short(b)}`;
}

/** The first line that differs, with both sides, or the extra lines when one is a prefix of the other. */
export function lineDifference(current, wanted) {
  const a = current.split("\n");
  const b = wanted.split("\n");
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return `line ${i + 1}: ${short(a[i])} → ${short(b[i])}`;
  }
  if (a.length === b.length) return "identical";
  const extra = Math.abs(a.length - b.length);
  return a.length < b.length
    ? `line ${shared + 1}: ${extra} line${extra === 1 ? "" : "s"} added`
    : `line ${shared + 1}: ${extra} line${extra === 1 ? "" : "s"} removed`;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value as one short token: strings quoted, structures summarised. */
function short(value) {
  const text = typeof value === "string" ? JSON.stringify(value) : isObject(value) || Array.isArray(value) ? summarise(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function summarise(value) {
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  const keys = Object.keys(value);
  return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
}
