// The demo estate as one document, for the tests that read it raw.
//
// data/catalog.json is hand-written and holds everything but the flows; those
// are written by hand too, as data/flows/*.flow.md, and arrive as
// data/flows.json through the extract step for them. A test that wants the
// estate as its author sees it - one catalog, validated on its own - joins
// the two here rather than each learning where the flows went.
import catalog from "../data/catalog.json";
import flows from "../data/flows.json";

export const rawCatalog = { ...catalog, flows: flows.flows };
