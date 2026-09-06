import { Link } from "react-router";
import type { Adr } from "../catalog";
import { paths } from "../routes";
import { AdrNumber, AdrScopePill, AdrStatusChip } from "./primitives";

/**
 * The columns a list of these rows declares, so every field starts at the
 * same x down the list: number, title, status, scope, date.
 */
export const ADR_ROW_COLUMNS = "grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]";

/**
 * One decision in a list that is not the decisions index itself. The list
 * is a `.rows` grid with {@link ADR_ROW_COLUMNS}; the row is a subgrid of
 * it, so the title takes what is left and the chips line up.
 */
export function AdrRow({ adr }: { adr: Adr }) {
  return (
    <Link to={paths.adr(adr.slug)} data-nav-item className="row">
      <AdrNumber adr={adr} />
      <span className="truncate font-semibold" title={adr.title}>
        {adr.title}
      </span>
      <AdrStatusChip status={adr.status} />
      <AdrScopePill scope={adr.scope} link={false} />
      <span className="mono tnum text-muted">{adr.date}</span>
    </Link>
  );
}
