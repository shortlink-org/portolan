import { Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { index } from "../data";

export interface AdrRelationsValue {
  services: string[];
  events: string[];
  flows: string[];
}

interface ReferenceOption {
  id: string;
  label: string;
}

function ReferencePicker({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string[];
  options: ReferenceOption[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const listId = useId();
  const [candidate, setCandidate] = useState("");
  const known = useMemo(() => new Set(options.map((option) => option.id)), [options]);
  const valid = known.has(candidate) && !value.includes(candidate);

  function add() {
    if (!valid) return;
    onChange([...value, candidate]);
    setCandidate("");
  }

  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex gap-1.5">
        <input
          className="min-w-0 flex-1 rounded-control border border-line bg-canvas px-2.5 py-1.5 mono text-ink outline-none focus:border-accent"
          list={listId}
          value={candidate}
          disabled={disabled}
          placeholder={`Choose ${label.toLowerCase().replace(/s$/, "")}`}
          onChange={(event) => setCandidate(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <datalist id={listId}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </datalist>
        <button type="button" className="tbtn h-8 px-2" disabled={disabled || !valid} onClick={add}>
          <Plus size={13} /> Add
        </button>
      </div>
      {value.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <button
              key={id}
              type="button"
              className="chip gap-1 border-line-strong hover:bg-surface"
              disabled={disabled}
              title={`Remove ${id}`}
              onClick={() => onChange(value.filter((candidateId) => candidateId !== id))}
            >
              {id} <X size={11} />
            </button>
          ))}
        </div>
      ) : <div className="mt-2 text-faint">No {label.toLowerCase()} linked.</div>}
    </div>
  );
}

export function AdrRelationsEditor({
  value,
  disabled,
  onChange,
}: {
  value: AdrRelationsValue;
  disabled: boolean;
  onChange: (value: AdrRelationsValue) => void;
}) {
  const services = useMemo(
    () => [...index.serviceById.values()].map((service) => ({ id: service.id, label: service.name })),
    [],
  );
  const events = useMemo(
    () => [...index.eventById.values()].map((event) => ({ id: event.id, label: event.name })),
    [],
  );
  const flows = useMemo(
    () => index.catalog.flows.map((flow) => ({ id: flow.slug, label: flow.name })),
    [],
  );

  return (
    <section className="border-t border-line bg-surface/40 px-4 py-4">
      <div className="mb-3">
        <div className="label">related architecture</div>
        <p className="mt-1 text-muted">These references become navigable links on the decision page and are checked against the catalog.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ReferencePicker label="Services" value={value.services} options={services} disabled={disabled} onChange={(services) => onChange({ ...value, services })} />
        <ReferencePicker label="Events" value={value.events} options={events} disabled={disabled} onChange={(events) => onChange({ ...value, events })} />
        <ReferencePicker label="Flows" value={value.flows} options={flows} disabled={disabled} onChange={(flows) => onChange({ ...value, flows })} />
      </div>
    </section>
  );
}
