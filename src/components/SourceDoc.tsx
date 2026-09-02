// A service's schema, drawn from the catalog rather than from the file.
//
// `ApiReference` draws the OpenAPI document itself, and its header explains
// why: the catalog cannot carry the document's own shape, and re-deriving that
// into the schema would be rebuilding OpenAPI inside it.
//
// For a proto that premise does not hold. The extractor reads exactly that
// shape — the interfaces, their methods, the two messages each one moves — so
// the catalog already has it. Drawing the raw text would be a worse copy of
// data we hold structured, and an unlinkable one: a `<pre>` cannot take a
// reader from a field to the shared type it refs, or from a method to the
// operation it exposes.

import { useState } from "react";
import { Link } from "react-router";
import { index } from "../data";
import { Empty, SectionTitle } from "./PageHeader";
import { Ident } from "./Ident";
import { KindIcon } from "./kind";
import { MessageList, MethodRows } from "./MethodRows";
import { paths } from "../routes";
import { packageOf } from "../lib/registry";

/** The interfaces of one module, as the service page's spec tab shows them. */
export function ModuleSpec({ moduleId }: { moduleId: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((shown) => {
      const next = new Set(shown);
      if (!next.delete(id)) next.add(id);

      return next;
    });

  const module = index.moduleById.get(moduleId);
  const declared = index.interfacesByModule.get(moduleId) ?? [];

  if (!module) {
    return (
      <Empty>
        this service&apos;s interfaces name a module the catalog does not hold
      </Empty>
    );
  }

  return (
    <div className="max-w-table">
      <div className="mono flex flex-wrap items-center gap-x-3">
        <KindIcon kind="module" />
        <Link
          to={paths.module(module.slug)}
          className="text-ink hover:underline"
        >
          {module.name}
        </Link>
        {module.commit ? (
          <Ident value={module.commit.slice(0, 12)} className="text-muted" />
        ) : null}
      </div>

      {declared.length === 0 ? (
        <div className="mt-section">
          <Empty>nothing in this catalog was declared in this module</Empty>
        </div>
      ) : null}

      {declared.map(({ provided }) => (
        <section key={provided.id} className="mt-section">
          <SectionTitle>{packageOf(provided.id) || provided.id}</SectionTitle>
          <div className="rounded-card border border-line">
            <div className="mono border-b px-3 py-1.5 border-line bg-surface">
              <Ident value={provided.id} className="text-ink" />
            </div>
            <MethodRows provided={provided} open={open} onToggle={toggle} />
            <MessageList provided={provided} open={open} onToggle={toggle} />
          </div>
        </section>
      ))}
    </div>
  );
}
