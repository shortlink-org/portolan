// What the glossary calls the thing this page is about.
//
// One line, under the header, before the model: a reader who does not know
// what the word means in this context cannot read the page below it, and the
// sentence that says so is already written - in a file next to the code, by
// somebody who knows.
//
// It appears only where the glossary and the code spell the word the same
// way. That is most of the words worth knowing and nowhere near all of them,
// and the page says nothing at all when there is no pairing: a strip reading
// "no definition" on two thirds of the estate would be a lint nobody asked
// for, printed on every page.

import { Link } from "react-router";
import { catalog } from "../data";
import { paths } from "../routes";
import { bindTerms } from "../lib/terms";

// Built once, from the catalog the app ships, exactly as the palette builds
// its index: the pairing is a property of the estate, not of a render.
const BOUND = bindTerms(catalog);

export function InLanguage({ id }: { id: string }) {
  const term = BOUND.byTarget.get(id);
  if (!term) return null;

  return (
    <p className="mb-3 max-w-prose text-muted">
      <Link
        to={paths.term(term.id)}
        className="rounded-control font-medium text-ink hover:underline"
        title={`${term.id} — in the glossary of ${term.context}`}
      >
        {term.name}
      </Link>
      {" — "}
      {term.definition}
    </p>
  );
}
