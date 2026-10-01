import { Link } from "react-router";
import { catalog } from "../../data";
import { StatusChip } from "../../components/primitives";
import { StepDetailBody } from "../../flow/StepDetail";
import { paths } from "../../routes";
import type { Resolved, Selection } from "../model";
import { Label, Row, SelectLink } from "./shared";

export function FlowStepBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "flow-step" }>;
}) {
  return <StepDetailBody step={resolved.step} flow={resolved.flow} />;
}

/**
 * One bundled edge, opened.
 *
 * Compact mode trades every event label for a number, and this is where the
 * number is spent: the count on the line is the length of this list, and the
 * list is the only place the reader can find out which events it stood for.
 */
export function BundleBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "bundle" }>;
}) {
  const { bundle } = resolved;
  return (
    <>
      <Label>Publisher</Label>
      <SelectLink id={bundle.from}>{bundle.from}</SelectLink>

      <Label>Consumer</Label>
      {resolved.to ? (
        <SelectLink id={bundle.to}>{bundle.to}</SelectLink>
      ) : (
        <div className="mono text-muted" title="not in the catalog">
          {bundle.to} — not in catalog
        </div>
      )}

      <Label>
        {bundle.events.length} {bundle.events.length === 1 ? "event" : "events"}
      </Label>
      {bundle.events.map((event) => (
        <Row key={event.id}>
          <SelectLink id={event.id}>{event.name}</SelectLink>
          <span className="ml-auto shrink-0">
            <StatusChip status={event.status} />
          </span>
        </Row>
      ))}
    </>
  );
}

/**
 * A node the model draws but the catalog has never heard of — an external
 * participant, most often. Saying so beats saying nothing.
 */
export function UnknownBody({ selection }: { selection: Selection }) {
  const consumers = catalog.contexts.flatMap((c) =>
    c.services.flatMap((s) =>
      s.aggregates.flatMap((a) =>
        a.events
          .filter((e) => e.consumers.some((x) => x.service === selection.id))
          .map((e) => e),
      ),
    ),
  );
  const flows = catalog.flows.filter((f) =>
    f.participants.some((p) => p.id === selection.id),
  );

  return (
    <>
      <p className="meta mt-1.5 text-unresolved">
        nothing in the catalog owns this id
      </p>
      {consumers.length > 0 ? (
        <>
          <Label>Named as a consumer of</Label>
          {consumers.map((e) => (
            <Row key={e.id}>
              <SelectLink id={e.id}>{e.name}</SelectLink>
            </Row>
          ))}
        </>
      ) : null}
      {flows.length > 0 ? (
        <>
          <Label>Appears in flows</Label>
          {flows.map((f) => (
            <Link
              key={f.slug}
              to={paths.flow(f.slug)}
              className="mono block text-accent"
            >
              {f.slug} →
            </Link>
          ))}
        </>
      ) : null}
      {consumers.length === 0 && flows.length === 0 ? (
        <p className="meta mt-3">it is not referenced anywhere else either</p>
      ) : null}
    </>
  );
}
