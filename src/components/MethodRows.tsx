// One method of one interface, drawn the same way wherever it appears.
//
// The service page's `provides` tab and the module page both list methods, and
// a method that reads differently in the two places is a method a reader has to
// re-learn. So the row lives here, and both pages hand it the same thing.
//
// What a method carries beyond its name — the shapes on either side and how it
// streams — is the whole reason `RpcService.methods` stopped being a list of
// strings. Unary draws nothing at all: it is the common case, and a marker on
// every row would say only that most methods are ordinary.

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Field, RpcMethod, RpcService } from "../catalog";
import { catalog } from "../data";
import { streamingKind } from "../lib/api";
import { Ident } from "./Ident";
import { RowActions } from "./RowActions";
import { ShapeRows } from "./ShapeRows";

const STREAM_LABEL: Record<"client" | "server" | "bidi", string> = {
  client: "client stream",
  server: "server stream",
  bidi: "bidi stream",
};

/**
 * The fields of a message a method names.
 *
 * Resolution order matters and is one rule: a `ref` into `catalog.defs` wins,
 * because a shared type is the same type wherever it turns up; otherwise the
 * name is looked up among the messages the interface itself lists. A name that
 * resolves to neither is still shown — the catalog knows what the method sends
 * even when it could not read the shape.
 */
export function shapeFor(
  provided: RpcService,
  name: string | undefined,
  ref: string | undefined,
): Field[] | null {
  if (ref) {
    const def = catalog.defs[ref];
    if (def) return def.fields;
  }
  if (!name) return null;

  return provided.messages?.find((m) => m.name === name)?.fields ?? null;
}

function Shape({
  provided,
  label,
  name,
  refKey,
  open,
  onToggle,
}: {
  provided: RpcService;
  label: string;
  name: string | undefined;
  refKey: string | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  if (!name) return null;

  const fields = shapeFor(provided, name, refKey);

  // Nothing to expand into: the shape is named but was never read, which is
  // ordinary for an interface described by an OpenAPI document.
  if (!fields) {
    return (
      <span className="mono text-muted" title={`${label} ${name}`}>
        {name}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mono rounded-control text-left text-muted hover:text-ink"
      title={`${label} ${name}`}
    >
      {name}
    </button>
  );
}

export function MethodRows({
  provided,
  open,
  onToggle,
  runs,
}: {
  provided: RpcService;
  /** Which shapes are expanded, keyed `<interface>/<method>/req|res`. */
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** What the method runs, when the page knows — the service page does. */
  runs?: (method: RpcMethod) => ReactNode;
}) {
  return (
    <ul data-nav-list>
      {provided.methods.map((method) => {
        const id = `${provided.id}/${method.name}`;
        const reqKey = `${id}/req`;
        const resKey = `${id}/res`;
        const streaming = streamingKind(method);
        const reqFields = shapeFor(provided, method.request, method.requestRef);
        const resFields = shapeFor(
          provided,
          method.response,
          method.responseRef,
        );

        return (
          <li
            key={method.name}
            className="row rounded-none border-x-0 border-t-0 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <Ident
                  value={id}
                  className={method.deprecated ? "line-through" : undefined}
                />
                {method.deprecated ? (
                  <span className="chip">deprecated</span>
                ) : null}
                {streaming !== "unary" ? (
                  <span className="chip">{STREAM_LABEL[streaming]}</span>
                ) : null}
              </div>

              {method.request || method.response ? (
                <p className="mono mt-0.5 flex flex-wrap items-center gap-x-1.5 text-muted">
                  <Shape
                    provided={provided}
                    label="sends"
                    name={method.request}
                    refKey={method.requestRef}
                    open={open.has(reqKey)}
                    onToggle={() => onToggle(reqKey)}
                  />
                  <span aria-hidden>→</span>
                  <Shape
                    provided={provided}
                    label="returns"
                    name={method.response}
                    refKey={method.responseRef}
                    open={open.has(resKey)}
                    onToggle={() => onToggle(resKey)}
                  />
                </p>
              ) : null}

              {method.doc ? (
                <p className="mt-0.5 text-muted">{method.doc}</p>
              ) : null}

              {runs?.(method)}

              {open.has(reqKey) && reqFields ? (
                <div className="mt-2">
                  <ShapeRows fields={reqFields} />
                </div>
              ) : null}
              {open.has(resKey) && resFields ? (
                <div className="mt-2">
                  <ShapeRows fields={resFields} />
                </div>
              ) : null}
            </div>
            <RowActions copy={id} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The messages an interface moves, collapsed.
 *
 * Extracted from the service page so the module page lists them identically.
 * Collapsed by default for the reason the service page always had: the question
 * a reader opens with is "what can I call", and a page that opens with six
 * schemas answers a question nobody asked yet.
 */
export function MessageList({
  provided,
  open,
  onToggle,
}: {
  provided: RpcService;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (!provided.messages?.length) return null;

  return (
    <div className="border-t border-line">
      <div className="mono px-3 py-1 text-muted">
        <span className="tnum">{provided.messages.length}</span> message
        {provided.messages.length === 1 ? "" : "s"}
      </div>
      {provided.messages.map((message) => {
        const id = `${provided.id}/${message.name}`;
        const shown = open.has(id);

        return (
          <div key={id} className="border-t border-line last:border-b-0">
            <button
              type="button"
              onClick={() => onToggle(id)}
              aria-expanded={shown}
              className="mono flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
            >
              {shown ? (
                <ChevronDown size={11} aria-hidden className="text-muted" />
              ) : (
                <ChevronRight size={11} aria-hidden className="text-muted" />
              )}
              <span className="truncate">{message.name}</span>
              <span className="tnum ml-auto text-muted">
                {message.fields.length}
              </span>
            </button>
            {shown ? (
              <div className="px-3 pb-3">
                <ShapeRows fields={message.fields} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
