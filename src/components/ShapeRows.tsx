// A shape, small enough to sit inside something else.
//
// Three columns and no toolbar: this is what a reader wants when the shape is
// an aside - the fields of a shared type opened from a schema row, the body an
// endpoint accepts - rather than the subject of the page. When it IS the
// subject, the sortable, filterable table on the block page is the right
// instrument and this one would be a worse version of it.

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Field, RpcEnum } from "../catalog";
import { parseType } from "../lib/shape";
import { RuleMarks } from "./RuleMarks";

/**
 * The enum a field's type names, among the ones the interface declares. By
 * bare name: a proto field says `OrderStatus`, and the list holds it as
 * `OrderStatus` too.
 */
function enumFor(enums: RpcEnum[] | undefined, field: Field): RpcEnum | null {
  if (!enums?.length) return null;
  const { base } = parseType(field.type);
  return enums.find((e) => e.name === base) ?? null;
}

/** The values of a proto enum, with the numbers a binary message carries. */
function EnumRows({ set }: { set: RpcEnum }) {
  return (
    <table className="ml-4 mt-1 mb-1">
      <tbody>
        {set.values.map((value) => (
          <tr key={value.name} className="align-top">
            <td className="mono py-0.5 pr-3 whitespace-nowrap">{value.name}</td>
            <td className="mono tnum py-0.5 pr-3 text-right text-muted">
              {value.number}
            </td>
            <td className="py-0.5 text-muted">{value.doc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EnumList({ set }: { set: RpcEnum }) {
  return (
    <div className="mt-1 border-l border-line pl-2">
      {set.values.map((value) => (
        <div key={value.name} className="py-0.5">
          <div className="mono flex min-w-0 items-baseline justify-between gap-2">
            <span className="min-w-0 break-all text-ink">{value.name}</span>
            <span className="tnum shrink-0 text-muted">{value.number}</span>
          </div>
          {value.doc ? <div className="text-muted">{value.doc}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function ShapeRows({
  fields,
  enums,
  showHeader = false,
  stacked = false,
}: {
  fields: Field[];
  /** The interface's enums, so a field typed by one can open its values. */
  enums?: RpcEnum[];
  /** A contract panel needs named columns; compact inline shapes do not. */
  showHeader?: boolean;
  /** A narrow detail rail reads fields top-to-bottom instead of squeezing columns. */
  stacked?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (stacked) {
    return (
      <dl className="divide-y divide-[var(--border)]">
        {fields.map((field) => {
          const set = enumFor(enums, field);
          const shown = set !== null && open.has(field.name);

          return (
            <div key={field.name} className="min-w-0 py-2 first:pt-0 last:pb-0">
              <dt
                className={`mono break-all text-ink${field.deprecated ? " line-through" : ""}`}
                title={field.deprecated ? "deprecated" : undefined}
              >
                {field.name}
              </dt>
              <dd className="mono mt-0.5 min-w-0 text-muted">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {set ? (
                    <button
                      type="button"
                      onClick={() => toggle(field.name)}
                      aria-expanded={shown}
                      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-control text-left hover:text-ink"
                      title={`${set.name}: ${set.values.length} values — click to ${shown ? "hide" : "show"} them`}
                    >
                      {shown ? (
                        <ChevronDown size={11} aria-hidden />
                      ) : (
                        <ChevronRight size={11} aria-hidden />
                      )}
                      <span className="min-w-0 break-all">{field.type}</span>
                    </button>
                  ) : (
                    <span className="min-w-0 break-all">
                      {field.type}
                      {field.ref ? " →" : ""}
                    </span>
                  )}
                  <RuleMarks field={field} />
                </span>
              </dd>
              {field.doc ? <dd className="mt-0.5 text-muted">{field.doc}</dd> : null}
              {shown && set ? <EnumList set={set} /> : null}
            </div>
          );
        })}
      </dl>
    );
  }

  return (
    <table className={`w-full${showHeader ? " table-fixed" : ""}`}>
      {showHeader ? (
        <colgroup>
          <col className="w-[32%]" />
          <col className="w-[40%]" />
          <col className="w-[28%]" />
        </colgroup>
      ) : null}
      {showHeader ? (
        <thead>
          <tr className="label border-b border-line text-left">
            <th className="py-1.5 pr-4 font-normal">Field</th>
            <th className="py-1.5 pr-4 font-normal">Type</th>
            <th className="py-1.5 font-normal">Description</th>
          </tr>
        </thead>
      ) : null}
      <tbody>
        {fields.map((field) => {
          const set = enumFor(enums, field);
          const shown = set !== null && open.has(field.name);
          return (
          <Fragment key={field.name}>
          <tr className={`align-top${showHeader ? " border-b border-line last:border-b-0" : ""}`}>
            {/* Struck through rather than chipped: an aside has no room for a
                badge, and the doc beside it says why. */}
            <td
              className={`mono pr-4${showHeader ? " break-words py-1.5" : " whitespace-nowrap py-0.5"}${field.deprecated ? " line-through" : ""}`}
              title={field.deprecated ? "deprecated" : undefined}
            >
              {field.name}
            </td>
            {/* An arrow marks a type that is a shared definition rather than a
                primitive, so a reader can tell which names are worth following
                without the row becoming a link it is not. */}
            <td className={`mono pr-4 text-muted${showHeader ? " break-words py-1.5" : " whitespace-nowrap py-0.5"}`}>
              <span className={`${showHeader ? "flex min-w-0 max-w-full flex-wrap break-words" : "inline-flex"} items-center gap-1.5`}>
                {set ? (
                  <button
                    type="button"
                    onClick={() => toggle(field.name)}
                    aria-expanded={shown}
                    className={`inline-flex items-center gap-1 rounded-control hover:text-ink${showHeader ? " min-w-0 max-w-full whitespace-normal break-words text-left" : ""}`}
                    title={`${set.name}: ${set.values.length} values — click to ${shown ? "hide" : "show"} them`}
                  >
                    {shown ? (
                      <ChevronDown size={11} aria-hidden />
                    ) : (
                      <ChevronRight size={11} aria-hidden />
                    )}
                    <span className={showHeader ? "min-w-0 break-all" : undefined}>
                      {field.type}
                    </span>
                  </button>
                ) : (
                  <span className={showHeader ? "min-w-0 break-all" : undefined}>
                    {field.type}
                    {field.ref ? " →" : ""}
                  </span>
                )}
                <RuleMarks field={field} />
              </span>
            </td>
            <td className={`${showHeader ? "break-words py-1.5" : "py-0.5"} text-muted`}>
              {field.doc}
            </td>
          </tr>
          {shown && set ? (
            <tr>
              <td colSpan={3} className="pb-1">
                <EnumRows set={set} />
              </td>
            </tr>
          ) : null}
          </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
