// What a folded arrow says, and how a view scoped to an element may spell
// the boxes it labels.

import { counted, q, safeId, withVerb } from "./ids.mjs";

/** The labels of folded arrows, and who stands outside the estate. */
export function labelHelpers(g) {
  const { fqn, model, rootParticipants, crossings, addTo } = g;
  // --- C4 level 1: the estate and what stands outside it ---------------------
  // Contexts as black boxes, and the participants that are not the estate's to
  // build: the people who use it, the systems it pays and asks, and the
  // consumers nothing in the catalog accounts for. Brokers and stores are left
  // out on purpose — they are containers, and they belong to the level below.
  //
  // This is not /graph's picture: that one is services against the events they
  // carry, and it is drawn by React Flow. No picture is drawn by both.
  const OUTSIDE = new Set(["actor", "external", "unknown"]);
  const outside = [...rootParticipants]
    .filter(([, meta]) => OUTSIDE.has(meta.kind))
    .map(([id]) => safeId(id));
  // LikeC4 folds every relation between two top-level boxes into one arrow and,
  // once there is more than one, labels it `[...]`. The fold is labelled here
  // instead: what crosses, counted by what it does, and each fact in the notes.
  const CROSSING_NOUNS = [
    ["calls", "method"],
    ["publishes", "event"],
    ["starts", "flow"],
    ["owns", "store"],
    ["reads", "store"],
    ["persists", "shape"],
    ["depends on", "service"],
  ];
  /**
   * `include from -> to with { title … }` lines for folded arrows. `endpoint`
   * maps a relation's end to the box that draws it on this picture, or to
   * nothing when the picture does not hold it. `spell` is how the view names a
   * box, or nothing when it cannot name it without naming something else, and
   * `keep` says which pairs of boxes are labelled at all.
   */
  function foldLabels(endpoint, indent = "    ", spell = (box) => box, keep = () => true) {
    const pairs = new Map(); // "from|to" -> { from, to, byVerb: Map<verb, Set<name>> }
    for (const { from: source, to: target, verb, name } of crossings) {
      const [from, to] = [endpoint(source), endpoint(target)];
      if (!from || !to || from === to || !keep(from, to)) continue;
      const key = `${from}|${to}`;
      const pair = pairs.get(key) ?? { from, to, byVerb: new Map() };
      const names = pair.byVerb.get(verb) ?? new Set();
      names.add(name);
      pair.byVerb.set(verb, names);
      pairs.set(key, pair);
    }
    return [...pairs.values()].flatMap((pair) => {
      const [from, to] = [spell(pair.from), spell(pair.to)];
      if (!from || !to) return [];
      const parts = CROSSING_NOUNS.filter(([verb]) => pair.byVerb.has(verb)).map(([verb, noun]) => {
        const names = [...pair.byVerb.get(verb)].sort();
        return { verb, names, title: names.length === 1 ? withVerb(verb, names[0]) : counted(verb, names.length, noun) };
      });
      const title = parts.map((part) => part.title).join(" · ");
      const facts = parts.flatMap((part) => part.names.map((name) => withVerb(part.verb, name)));
      // One fact is its own title; the notes are for the ones a count stands for.
      const notes = facts.length > 1 ? `  notes ${q(facts.join("\n"))}` : "";
      return [`${indent}include ${from} -> ${to} with { title ${q(title)}${notes} }`];
    });
  }

  // What a view scoped to an element can name. Inside `view x of a.b` the first
  // segment of a reference is the scope itself when it is the scope's own name,
  // else one of the scope's children, else an element at the model's root - and
  // nothing else: not the scope's siblings, and no second try when the first
  // match leads nowhere. So inside `auth.auth` the service is spelled `auth`,
  // `auth.auth` means `auth.auth.auth`, and the context's store beside it cannot
  // be named at all. (Checked against `likec4 validate`, 1.59.) The tree is read
  // off the model as written.
  const childrenOf = new Map(); // parent reference ("" for the root) -> Set of names
  const declaredRefs = new Set();
  {
    const path = [];
    for (const line of model) {
      for (const row of line.split("\n")) {
        const declared = /^( *)([A-Za-z_][\w-]*) = \w+\b/.exec(row);
        if (!declared) continue;
        const depth = declared[1].length / 2 - 1;
        path.length = depth;
        addTo(childrenOf, path.join("."), declared[2]);
        path.push(declared[2]);
        declaredRefs.add(path.join("."));
      }
    }
  }
  function resolveIn(scope, reference) {
    const [head, ...rest] = reference.split(".");
    const base =
      head === scope.split(".").at(-1) ? scope
      : childrenOf.get(scope)?.has(head) ? `${scope}.${head}`
      : childrenOf.get("")?.has(head) ? head
      : null;
    const resolved = base && [base, ...rest].join(".");
    return resolved && declaredRefs.has(resolved) ? resolved : null;
  }
  /** The shortest spelling that, inside `scope`, names `target` and nothing else. */
  function spellIn(scope, target) {
    const segments = target.split(".");
    for (let start = segments.length - 1; start >= 0; start -= 1) {
      const candidate = segments.slice(start).join(".");
      if (resolveIn(scope, candidate) === target) return candidate;
    }
    return null;
  }

  /**
   * A service's neighbours view draws the service, the stores and services of
   * its own context as their own boxes, and everything in another context folded
   * into that context. Only arrows with the service at one end are labelled:
   * those are the ones whose far box the view is sure to hold, and a label on
   * any other pair would pull boxes into the picture that it does not draw.
   */
  function neighbourLabels(service, context, indent = "    ") {
    const self = fqn(service.id);
    const home = safeId(context.id);
    const box = (reference) => {
      if (reference === self || reference.startsWith(`${self}.`)) return self;
      const segments = reference.split(".");
      if (segments.length === 1) return reference;
      return segments[0] === home ? segments.slice(0, 2).join(".") : segments[0];
    };
    return foldLabels(box, indent, (reference) => spellIn(self, reference), (from, to) => from === self || to === self);
  }

  /**
   * A context's own L2 view opens the context and folds every other one. The
   * arrows between the two sides are labelled here; the ones inside are the
   * folded call pairs `containerPredicates` already names.
   */
  function contextLabels(context, indent = "    ") {
    const home = safeId(context.id);
    const inside = (box) => box.startsWith(`${home}.`);
    const box = (reference) => {
      const segments = reference.split(".");
      if (segments.length === 1) return reference;
      return segments[0] === home ? segments.slice(0, 2).join(".") : segments[0];
    };
    return foldLabels(box, indent, (reference) => spellIn(home, reference), (from, to) => inside(from) !== inside(to));
  }

  /** A top-level box stands for everything nested in it. */
  function landscapeLabels(roots, indent = "    ") {
    const visible = new Set(roots);
    return foldLabels((ref) => {
      const root = ref.split(".")[0];
      return visible.has(root) ? root : null;
    }, indent);
  }
  return { OUTSIDE, outside, landscapeLabels, neighbourLabels, contextLabels };
}
