// Plain JavaScript on purpose: the CLI's `init` runs this from node_modules,
// where Node strips no types, so the one parser the host and the browser
// share cannot be a .ts file. Types live in django-aggregates.d.mts.

const MARKER = "; aggregate candidates: ";

/**
 * Evidence emitted by extract-django, carried through the warning protocol.
 *
 * @param {string} message
 * @returns {import("./django-aggregates.d.mts").DjangoAggregateCandidates | null}
 */
export function djangoAggregateCandidates(message) {
  const start = message.lastIndexOf(MARKER);
  if (start < 0) return null;
  try {
    const value = JSON.parse(message.slice(start + MARKER.length));
    if (!value || typeof value.app !== "string" || !/^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u.test(value.app)
      || !Array.isArray(value.models) || !value.models.length) return null;
    const models = [];
    for (const model of value.models) {
      if (!model || typeof model.name !== "string" || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(model.name)
        || typeof model.path !== "string" || !model.path || !Number.isSafeInteger(model.line) || model.line < 1) return null;
      models.push({ name: model.name, path: model.path, line: model.line });
    }
    // The extractor's option accepts a class name, so duplicate names cannot
    // be resolved safely by this picker.
    if (new Set(models.map((model) => model.name)).size !== models.length) return null;
    return { app: value.app, models };
  } catch { return null; }
}

/** @param {string} message */
export function djangoAggregateMessage(message) {
  return djangoAggregateCandidates(message) ? message.slice(0, message.lastIndexOf(MARKER)) : message;
}
