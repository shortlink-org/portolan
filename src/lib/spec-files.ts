// Which source documents this repository actually holds.
//
// `import.meta.glob` needs a literal pattern, so the glob itself stays in the
// component that draws the document - one for OpenAPI, one for AsyncAPI - and
// this is what both of them do with the answer.
//
// A catalog source is a path as the extractor wrote it, relative to the
// repository root; a glob's keys are relative to the file the glob is written
// in. Stripping the leading `../` is what makes the two comparable, and it is
// the whole of the trick.

export type Specs = Record<string, () => Promise<string>>;

export function loaderFor(
  specs: Specs,
  source: string,
): (() => Promise<string>) | null {
  for (const [path, load] of Object.entries(specs)) {
    if (path.replace(/^(\.\.\/)+/, "") === source) return load;
  }

  return null;
}
