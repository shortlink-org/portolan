// Writes a JSON value the way the file already on disk writes it.
//
// A manifest is edited by hand and by the page, and the two must not fight:
// a page that adds one glob to one array and rewrites every other array in
// the file has made a diff nobody can review. So the value is written against
// the old text. A subtree that did not change is copied out of the old text
// byte for byte; one that did is written in the style its old self had - an
// array on one line stays on one line, one spread over lines stays spread -
// and only something with no old self at all gets the default shape: scalars
// on one line, objects and arrays of objects spread.

/** A parsed value with where it sat in the text it came from. */
class Node {
  constructor(type, start, end, value) {
    this.type = type;
    this.start = start;
    this.end = end;
    this.value = value;
    /** For objects: key -> Node, in source order. For arrays: Node[]. */
    this.children = type === "object" ? new Map() : type === "array" ? [] : null;
  }
}

/**
 * Parses JSON into nodes that remember their source range. Strict JSON, the
 * same grammar JSON.parse accepts; anything else throws, and the caller
 * falls back to writing from scratch.
 */
export function parseWithRanges(text) {
  let at = 0;
  const skip = () => {
    while (at < text.length && /\s/.test(text[at])) at += 1;
  };
  const expect = (ch) => {
    if (text[at] !== ch) throw new SyntaxError(`Expected ${ch} at ${at}`);
    at += 1;
  };
  const scalarEnd = () => {
    if (text[at] === '"') {
      let i = at + 1;
      while (i < text.length) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') return i + 1;
        else i += 1;
      }
      throw new SyntaxError("Unterminated string");
    }
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at));
    if (!m) throw new SyntaxError(`Unexpected token at ${at}`);
    return at + m[0].length;
  };
  const value = () => {
    skip();
    const start = at;
    if (text[at] === "{") {
      at += 1;
      const node = new Node("object", start, 0, {});
      skip();
      if (text[at] === "}") {
        at += 1;
        node.end = at;
        return node;
      }
      for (;;) {
        skip();
        const keyEnd = scalarEnd();
        if (text[at] !== '"') throw new SyntaxError(`Expected a key at ${at}`);
        const key = JSON.parse(text.slice(at, keyEnd));
        at = keyEnd;
        skip();
        expect(":");
        const child = value();
        node.children.set(key, child);
        node.value[key] = child.value;
        skip();
        if (text[at] === ",") {
          at += 1;

          continue;
        }
        expect("}");
        node.end = at;

        return node;
      }
    }
    if (text[at] === "[") {
      at += 1;
      const node = new Node("array", start, 0, []);
      skip();
      if (text[at] === "]") {
        at += 1;
        node.end = at;
        return node;
      }
      for (;;) {
        const child = value();
        node.children.push(child);
        node.value.push(child.value);
        skip();
        if (text[at] === ",") {
          at += 1;

          continue;
        }
        expect("]");
        node.end = at;

        return node;
      }
    }
    const end = scalarEnd();
    const node = new Node("scalar", start, end, JSON.parse(text.slice(start, end)));
    at = end;

    return node;
  };
  const root = value();
  skip();
  if (at !== text.length) throw new SyntaxError(`Trailing content at ${at}`);

  return root;
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;

  return keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}

function isScalar(value) {
  return value === null || typeof value !== "object";
}

/** The indent step the old text uses, or two spaces. */
function indentOf(text) {
  const m = /\n([ \t]+)\S/.exec(text);

  return m ? m[1] : "  ";
}

/**
 * Writes `value` in the style of `oldText`. Keys already in the old text
 * keep their order; new keys go after them. A value with no old self is
 * written the default way.
 */
export function formatLike(oldText, value) {
  let root = null;
  try {
    root = parseWithRanges(oldText);
  } catch {
    return JSON.stringify(value, null, 2);
  }
  const step = indentOf(oldText);
  const slice = (node) => oldText.slice(node.start, node.end);
  const multiline = (node) => slice(node).includes("\n");

  const write = (node, next, indent) => {
    if (node && same(node.value, next)) return slice(node);
    if (isScalar(next)) return JSON.stringify(next);
    const inner = indent + step;

    if (Array.isArray(next)) {
      if (next.length === 0) return "[]";
      const old = node && node.type === "array" ? node : null;
      const spread = old ? multiline(old) : !next.every(isScalar);
      const items = next.map((item, i) => write(old?.children[i], item, spread ? inner : indent));
      if (!spread) return "[" + items.join(", ") + "]";

      return "[\n" + items.map((item) => inner + item).join(",\n") + "\n" + indent + "]";
    }

    const keys = Object.keys(next);
    if (keys.length === 0) return "{}";
    const old = node && node.type === "object" ? node : null;
    const ordered = old
      ? [...[...old.children.keys()].filter((key) => Object.hasOwn(next, key)), ...keys.filter((key) => !old.children.has(key))]
      : keys;
    const spread = old ? multiline(old) : true;
    const entries = ordered.map((key) => JSON.stringify(key) + ": " + write(old?.children.get(key), next[key], spread ? inner : indent));
    if (!spread) return "{ " + entries.join(", ") + " }";

    return "{\n" + entries.map((entry) => inner + entry).join(",\n") + "\n" + indent + "}";
  };

  return write(root, value, "");
}
