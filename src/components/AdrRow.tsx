import { Link } from "react-router";
import type { Adr } from "../catalog";
import { paths } from "../routes";
import { AdrNumber, AdrScopePill, AdrStatusChip } from "./primitives";

/** One decision in a list that is not the decisions index itself. */
export function AdrRow({ adr }: { adr: Adr }) {
  return (
    <Link to={paths.adr(adr.slug)} className="row flex-wrap">
      <AdrNumber adr={adr} />
      <span className="font-semibold" title={adr.title}>
        {adr.title}
      </span>
      <AdrStatusChip status={adr.status} />
      <span className="ml-auto flex items-center gap-3">
        <AdrScopePill scope={adr.scope} link={false} />
        <span className="mono text-muted">{adr.date}</span>
      </span>
    </Link>
  );
}
