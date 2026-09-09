// Every reading the catalog makes of itself, in one list.
//
// Four readers, each answering a different question: edges that resolve to
// nothing, producer and consumer schemas that disagree, tables and columns
// that disagree with the model, and channels that documents and events do not
// agree on. The problems page, the overview and the landing all want the
// union, errors first - a boundary leak is not the same kind of news as a
// column whose type has drifted, and mixing them buries the first.

import type { Catalog, CatalogIndex } from "../catalog";
import { dataProblems } from "./data-problems";
import { problems } from "./derive";
import type { Problem } from "./derive";
import { protoProblems } from "./proto-problems";
import { wireProblems } from "./wire-problems";

export function allProblems(catalog: Catalog, index: CatalogIndex): Problem[] {
  const found = [
    ...problems(catalog),
    ...protoProblems(catalog, index),
    ...dataProblems(catalog, index),
    ...wireProblems(catalog, index),
  ];
  return [
    ...found.filter((p) => p.severity === "error"),
    ...found.filter((p) => p.severity === "warning"),
  ];
}
