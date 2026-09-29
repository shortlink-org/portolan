import { Link } from "react-router";
import { index } from "../data";
import { eventPath } from "../routes";
import { EventIcon } from "./ddd-icons";

/**
 * One event named inline, by id: its name in event amber, linked to its page.
 * An id the catalog does not hold keeps its last segment as the name and
 * stays plain text - there is nowhere honest to link it.
 */
export function EventChip({ id, title }: { id: string; title?: string }) {
  const name = index.eventById.get(id)?.name ?? id.slice(id.lastIndexOf(".") + 1);
  const to = eventPath(id);
  const body = (
    <>
      <EventIcon size={11} aria-hidden />
      {name}
    </>
  );
  return to ? (
    <Link to={to} className="chip chip-event" title={title ?? id}>
      {body}
    </Link>
  ) : (
    <span className="chip chip-event" title={title ?? id}>
      {body}
    </span>
  );
}
