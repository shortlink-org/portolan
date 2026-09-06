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

export function ShapeRows({
  fields,
  enums,
}: {
  fields: Field[];
  /** The interface's enums, so a field typed by one can open its values. */
  enums?: RpcEnum[];
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <table className="w-full">
      <tbody>
        {fields.map((field) => {
          const set = enumFor(enums, field);
          const shown = set !== null && open.has(field.name);
          return (
          <Fragment key={field.name}>
          <tr className="align-top">
            {/* Struck through rather than chipped: an aside has no room for a
                badge, and the doc beside it says why. */}
            <td
              className={`mono py-0.5 pr-3 whitespace-nowrap${field.deprecated ? " line-through" : ""}`}
              title={field.deprecated ? "deprecated" : undefined}
            >
              {field.name}
            </td>
            {/* An arrow marks a type that is a shared definition rather than a
                primitive, so a reader can tell which names are worth following
                without the row becoming a link it is not. */}
            <td className="mono py-0.5 pr-3 whitespace-nowrap text-muted">
              {set ? (
                <button
                  type="button"
                  onClick={() => toggle(field.name)}
                  aria-expanded={shown}
                  className="inline-flex items-center gap-1 rounded-control hover:text-ink"
                  title={`${set.name}: ${set.values.length} values — click to ${shown ? "hide" : "show"} them`}
                >
                  {shown ? (
                    <ChevronDown size={11} aria-hidden />
                  ) : (
                    <ChevronRight size={11} aria-hidden />
                  )}
                  {field.type}
                </button>
              ) : field.ref ? (
                `${field.type} →`
              ) : (
                field.type
              )}
            </td>
            <td className="py-0.5 text-muted">{field.doc}</td>
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
