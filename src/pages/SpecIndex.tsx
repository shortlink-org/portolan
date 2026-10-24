import { Link } from "react-router";
import type { ChangeSpec } from "../catalog";
import { allSpecs } from "../catalog";
import { useDocumentTitle } from "../app/title";
import { CapabilityEmpty } from "../components/PageHeader";
import { catalog } from "../data";
import { paths } from "../routes";

function progress(spec: ChangeSpec): string {
  const done = spec.tasks.filter((task) => task.done).length;
  return `${done} of ${spec.tasks.length} tasks`;
}

export function SpecIndexView({ specs }: { specs: ChangeSpec[] }) {
  if (specs.length === 0) {
    return (
      <CapabilityEmpty
        title="No specifications in this catalog"
        signal="Signal: OpenSpec changes → specs[]."
      >
        Add the SDD extractor to read proposals, requirements, scenarios, and task checklists without changing their source files.
      </CapabilityEmpty>
    );
  }

  return (
    <div className="max-w-table overflow-x-auto rounded-card border border-line shadow-xs">
      <div className="border-b border-line bg-surface px-4 py-3 text-sm text-muted">
        Lifecycle and checklist progress come from the specification; implementation evidence is tracked separately.
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <thead className="label bg-surface">
          <tr>
            <th className="px-4 py-2 font-medium">change</th>
            <th className="px-4 py-2 font-medium">format</th>
            <th className="px-4 py-2 font-medium">lifecycle</th>
            <th className="px-4 py-2 font-medium">checklist</th>
            <th className="px-4 py-2 font-medium">requirements</th>
          </tr>
        </thead>
        <tbody>
          {specs.map((spec) => (
            <tr key={spec.id} className="border-t border-line hover:bg-surface">
              <td className="px-4 py-3">
                <Link className="font-medium text-accent hover:underline" to={paths.spec(spec.slug)}>
                  {spec.title}
                </Link>
                <div className="mono mt-0.5 text-muted">{spec.id}</div>
              </td>
              <td className="mono px-4 py-3 text-muted">{spec.format}</td>
              <td className="px-4 py-3"><span className="chip border-line-strong">{spec.lifecycle}</span></td>
              <td className="mono px-4 py-3">{progress(spec)}</td>
              <td className="mono px-4 py-3">{spec.requirements.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SpecIndex() {
  useDocumentTitle("Specifications");
  const specs = [...allSpecs(catalog)].sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="label">spec-driven development</div>
      <h1 className="mt-1 text-lg font-semibold">Specifications</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Intent captured by SDD tools, normalized without treating a checked task as proof that the architecture implements it.
      </p>
      <div className="mt-section"><SpecIndexView specs={specs} /></div>
    </div>
  );
}
