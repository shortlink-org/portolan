// A shape, small enough to sit inside something else.
//
// Three columns and no toolbar: this is what a reader wants when the shape is
// an aside - the fields of a shared type opened from a schema row, the body an
// endpoint accepts - rather than the subject of the page. When it IS the
// subject, the sortable, filterable table on the block page is the right
// instrument and this one would be a worse version of it.

import type { Field } from "../catalog";

export function ShapeRows({ fields }: { fields: Field[] }) {
  return (
    <table className="w-full">
      <tbody>
        {fields.map((field) => (
          <tr key={field.name} className="align-top">
            <td className="mono py-0.5 pr-3 whitespace-nowrap">{field.name}</td>
            {/* An arrow marks a type that is a shared definition rather than a
                primitive, so a reader can tell which names are worth following
                without the row becoming a link it is not. */}
            <td className="mono py-0.5 pr-3 whitespace-nowrap text-muted">
              {field.ref ? `${field.type} →` : field.type}
            </td>
            <td className="py-0.5 text-muted">{field.doc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
