import { Link } from "react-router";
import { catalog, index } from "../../data";
import { KIND_LABEL } from "../../lib/kinds";
import { eventScope, resolveShape } from "../../lib/shape";
import { stepsInto } from "../../lib/backlinks";
import { Ident } from "../../components/Ident";
import { StatusChip } from "../../components/primitives";
import { blockPath, paths } from "../../routes";
import type { Resolved } from "../model";
import { Label, Row, SelectLink } from "./shared";

export function EventBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "event" }>;
}) {
  const { event, service } = resolved;
  const latest = event.versions[event.versions.length - 1];
  const scope = eventScope(index, event);
  // The steps that carry this event, not just the flows: a panel that says
  // "checkout" sends the reader to the top of a forty-step rail, and one that
  // says "checkout · step 14" opens on the step.
  const steps = stepsInto(catalog, new Set([event.id]));
  const decisions = index.adrsByEvent.get(event.id) ?? [];
  const rfcs = index.rfcsByEvent.get(event.id) ?? [];

  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {event.versions.map((v) => (
          <span
            key={v.version}
            className="mono rounded-control border px-1.5 py-px"
            style={{
              borderColor: v === latest ? "var(--accent)" : "var(--border)",
              color: v === latest ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            {v.version}
          </span>
        ))}
      </div>

      <Label>Producer</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Schema · {latest?.version ?? "—"}</Label>
      <table className="w-full">
        <tbody>
          {(latest?.fields ?? []).map((f) => {
            // A shared def moves the selection; a block of the aggregate has
            // a page and no selection, so it is a link.
            const shape = f.ref ? null : resolveShape(catalog, f, scope);
            const page =
              shape && shape.kind !== "def" ? blockPath(shape.id) : null;
            return (
              <tr key={f.name} className="align-top">
                <td className="mono py-0.5 pr-2 whitespace-nowrap">{f.name}</td>
                <td className="mono py-0.5 text-muted">
                  {f.ref ? (
                    <SelectLink id={f.ref}>{f.type}</SelectLink>
                  ) : page && shape ? (
                    <Link
                      to={page}
                      className="rounded-control text-accent hover:underline"
                      title={`open ${KIND_LABEL[shape.kind as "vo" | "entity"]} ${shape.name}`}
                    >
                      {f.type}
                    </Link>
                  ) : (
                    f.type
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Label>Consumers</Label>
      {event.consumers.length === 0 ? (
        <div className="mono text-muted">nothing consumes this event</div>
      ) : null}
      {event.consumers.map((c) => (
        <Row key={c.service}>
          <SelectLink id={c.service}>{c.service}</SelectLink>
          {c.via ? (
            <Link
              to={paths.flowStep(c.via.flow, c.via.step)}
              className="mono shrink-0 text-muted hover:text-ink hover:underline"
              title={`read from flow ${c.via.flow}, step ${c.via.step}; no source declares this consumer`}
            >
              via flow
            </Link>
          ) : null}
          <span className="ml-auto shrink-0">
            <StatusChip status={c.status} title={c.note} />
          </span>
        </Row>
      ))}

      <Label>Appears in flows</Label>
      {steps.length === 0 ? (
        <div className="mono text-muted">no flow references this event</div>
      ) : (
        <div className="flex flex-col gap-1">
          {steps.map((s) => (
            <Link
              key={`${s.flow.slug}:${s.stepId}`}
              to={paths.flowStep(s.flow.slug, s.stepId)}
              className="mono text-accent"
            >
              {s.flow.slug} · step {s.number} →
            </Link>
          ))}
        </div>
      )}

      {decisions.length > 0 ? (
        <>
          <Label>Decisions</Label>
          <div className="flex flex-col gap-1">
            {decisions.map((adr) => (
              <Link
                key={adr.id}
                to={paths.adr(adr.slug)}
                className="mono truncate text-accent"
                title={adr.title}
              >
                {adr.id} · {adr.title}
              </Link>
            ))}
          </div>
        </>
      ) : null}

      {rfcs.length > 0 ? (
        <>
          <Label>Requests for comments</Label>
          <div className="flex flex-col gap-1">
            {rfcs.map((rfc) => (
              <Link
                key={rfc.id}
                to={paths.rfc(rfc.slug)}
                className="mono truncate text-accent"
                title={rfc.title}
              >
                {rfc.displayId} · {rfc.title}
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <Label>Source</Label>
      {latest?.source ? (
        <Ident block value={latest.source} className="text-muted" />
      ) : (
        <div className="mono text-muted">not recorded</div>
      )}
    </>
  );
}
