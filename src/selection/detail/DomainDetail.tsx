import { Link } from "react-router";
import { catalog } from "../../data";
import { usesOfDef } from "../../lib/derive";
import { AGGREGATE_ANCHOR, SERVICE_ANCHOR, paths } from "../../routes";
import type { Resolved } from "../model";
import { Label, Row, SelectLink } from "./shared";

export function AggregateBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "aggregate" }>;
}) {
  const { aggregate, service, context } = resolved;
  const commands = aggregate.operations.filter((o) => o.kind === "command");
  const queries = aggregate.operations.filter((o) => o.kind === "query");
  const aggregatePath = paths.aggregate(
    context.id,
    service.slug,
    aggregate.slug,
  );

  return (
    <>
      <Label>Owner</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Operations</Label>
      <div className="mono flex gap-3 text-muted">
        <Link
          to={`${aggregatePath}#${AGGREGATE_ANCHOR.commands}`}
          className="rounded-control hover:text-ink"
        >
          <span className="tnum">{commands.length}</span> command
          {commands.length === 1 ? "" : "s"}
        </Link>
        <Link
          to={`${aggregatePath}#${AGGREGATE_ANCHOR.queries}`}
          className="rounded-control hover:text-ink"
        >
          <span className="tnum">{queries.length}</span> quer
          {queries.length === 1 ? "y" : "ies"}
        </Link>
      </div>

      <Label>Events</Label>
      {aggregate.events.length === 0 ? (
        <div className="mono text-muted">this aggregate publishes nothing</div>
      ) : null}
      {aggregate.events.map((e) => (
        <Row key={e.id}>
          <SelectLink id={e.id}>{e.name}</SelectLink>
        </Row>
      ))}
    </>
  );
}

export function ContextBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "context" }>;
}) {
  const { context } = resolved;
  return (
    <>
      <p className="mt-1.5 text-muted">{context.summary}</p>
      <Label>Services</Label>
      {context.services.map((s) => (
        <Row key={s.id}>
          <SelectLink id={s.id}>{s.slug}</SelectLink>
          <Link
            to={`${paths.service(context.id, s.slug)}#${SERVICE_ANCHOR.events}`}
            className="mono ml-auto shrink-0 rounded-control text-muted hover:text-ink"
          >
            <span className="tnum">
              {s.aggregates.reduce((n, a) => n + a.events.length, 0)}
            </span>{" "}
            events
          </Link>
        </Row>
      ))}
    </>
  );
}

export function ValueObjectBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "value-object" }>;
}) {
  const uses = usesOfDef(catalog, resolved.id);
  return (
    <>
      <Label>Fields</Label>
      <table className="w-full">
        <tbody>
          {resolved.def.fields.map((f) => (
            <tr key={f.name} className="align-top">
              <td className="mono py-0.5 pr-2 whitespace-nowrap">{f.name}</td>
              <td className="mono py-0.5 pr-2 text-muted">
                {f.ref ? <SelectLink id={f.ref}>{f.type}</SelectLink> : f.type}
              </td>
              <td className="py-0.5 text-muted">{f.doc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Label>Used in</Label>
      {uses.events.length === 0 && uses.defs.length === 0 ? (
        <div className="mono text-muted">nothing carries this type</div>
      ) : null}
      {uses.events.map((use) => (
        <Row key={use.eventId}>
          <SelectLink id={use.eventId}>{use.eventId}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">
            {use.versions.join(" ")}
          </span>
        </Row>
      ))}
      {uses.defs.map((id) => (
        <Row key={id}>
          <SelectLink id={id}>{id}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">type</span>
        </Row>
      ))}
    </>
  );
}
