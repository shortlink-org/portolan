import { Link } from "react-router";
import type { Rfc } from "../catalog";
import { paths } from "../routes";
import { AdrScopePill, RfcDisplayId, RfcStatusChip } from "./primitives";

export const RFC_ROW_COLUMNS = "grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]";

export function RfcRow({ rfc }: { rfc: Rfc }) {
  return (
    <Link to={paths.rfc(rfc.slug)} data-nav-item className="row">
      <RfcDisplayId rfc={rfc} />
      <span className="truncate font-semibold" title={rfc.title}>{rfc.title}</span>
      <RfcStatusChip rfc={rfc} />
      <AdrScopePill scope={rfc.scope} link={false} />
      <span className="mono tnum text-muted">{(rfc.updatedAt ?? rfc.createdAt ?? "—").slice(0, 10)}</span>
    </Link>
  );
}
