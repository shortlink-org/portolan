// Compact mode: the same sequence, as a table.
//
// The rail is for reading a flow in order. This is for the other question —
// "which steps are unresolved", "what does payments touch", "give me the list"
// — and that question wants columns, sorting, filtering and an export, all of
// which the app already has exactly once. So compact mode is not a narrower
// rail; it is the flow handed to the same DataTable every index page uses.

import { useMemo } from "react";
import type { Flow, Status, Step } from "../catalog";
import { contextName } from "../lib/context-color";
import { flowStepId } from "../selection/model";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import type { Chapter } from "./chapters";
import type { OutlineStep } from "./outline";

interface Row {
  id: string;
  number: number;
  step: string;
  route: string;
  kind: string;
  status: Status;
  note: string | undefined;
  chapter: string;
  /** Not a column: what the row's selection lights up elsewhere. */
  selection: string;
}

const COLUMNS: ColumnSpec<Row>[] = [
  { id: "number", header: "#", type: "number", value: (r) => r.number, size: 56 },
  {
    id: "step",
    header: "step",
    type: "text",
    value: (r) => r.step,
    primary: true,
    size: 260,
  },
  {
    id: "route",
    header: "from → to",
    type: "mono",
    value: (r) => r.route,
    size: 300,
  },
  { id: "kind", header: "kind", type: "text", value: (r) => r.kind, facet: true, size: 96 },
  {
    id: "status",
    header: "status",
    type: "status",
    value: (r) => r.status,
    facet: true,
    size: 128,
  },
  {
    id: "chapter",
    header: "chapter",
    type: "text",
    // Not offered as a chip-set: a chapter is named by its condition, and a
    // toolbar of fifteen sentences is taller than the table it filters. The
    // text filter reaches them, and the rail is where chapters are navigated.
    value: (r) => r.chapter,
    size: 220,
  },
  { id: "note", header: "note", type: "text", value: (r) => r.note, size: 320 },
];

/** The two participants, with the context each sits in when it has one. */
function route(step: Step, contextOf: (id: string) => string | null): string {
  const name = (id: string): string => {
    const context = contextOf(id);
    return context ? `${id} (${contextName(context)})` : id;
  };
  return step.from === step.to
    ? `${name(step.from)} ↺`
    : `${name(step.from)} → ${name(step.to)}`;
}

export function FlowTable({
  flow,
  rows,
  chapters,
  contextOf,
}: {
  flow: Flow;
  /** The rail's step rows, so the table shows exactly what the rail shows. */
  rows: readonly OutlineStep[];
  chapters: readonly Chapter[];
  contextOf: (participantId: string) => string | null;
}) {
  const data = useMemo<Row[]>(() => {
    const chapterOf = new Map<string, string>();
    for (const chapter of chapters) {
      for (const stepId of chapter.stepIds) chapterOf.set(stepId, chapter.title);
    }
    return rows.map(({ step, number }) => ({
      id: step.id,
      number,
      step: step.label ?? step.ref ?? step.kind,
      route: route(step, contextOf),
      kind: step.kind,
      status: step.status,
      note: step.note,
      chapter: chapterOf.get(step.id) ?? "—",
      selection: flowStepId(flow.slug, step.id),
    }));
  }, [rows, chapters, contextOf, flow.slug]);

  return (
    <DataTable
      tableId={`flow-steps:${flow.slug}`}
      columns={COLUMNS}
      rows={data}
      rowId={(row) => row.id}
      defaultSort={[{ id: "number", desc: false }]}
      selectionId={(row) => row.selection}
      caption={`${flow.name} — steps`}
      empty="no step survives the filters on this view"
    />
  );
}
