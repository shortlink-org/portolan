// ---------------------------------------------------------------------------
// Validation. Throws on the first violation with a message that names the
// offending flow / step / field, so a bad generator run fails loudly.
// ---------------------------------------------------------------------------

export class CatalogError extends Error {
  /**
   * Where the violation is, as a reader would name it: "flow checkout-happy /
   * step s4", "aggregate shop.oms.order". The message already says what is
   * wrong; this says which line of the generator run to go and look at, and it
   * is what the error page prints under the message.
   */
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super(message);
    this.name = "CatalogError";
    this.path = path;
  }
}

export function fail(message: string, path?: string): never {
  throw new CatalogError(message, path);
}

export function assertUniqueSlugs(
  slugs: string[],
  parent: string,
  what: string,
): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug))
      fail(`${what} slug "${slug}" is not unique within ${parent}`, parent);
    seen.add(slug);
  }
}
