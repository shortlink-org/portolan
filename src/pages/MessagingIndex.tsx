import { ArrowDownLeft, ArrowUpDown, ArrowUpRight, Minus, Search, X } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useDocumentTitle } from "../app/title";
import { Empty } from "../components/PageHeader";
import { KindIcon } from "../components/kind";
import { catalog, index } from "../data";
import {
  messagingClaims,
  type ChannelClaim,
  type ChannelUsage,
  type MessageClaim,
  type MessagingIssue,
} from "../lib/messaging";
import { plural } from "../lib/format";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { eventPath, paths, serviceBusPath } from "../routes";
import { Select } from "../components/Select";

type Mode = "channels" | "messages";

const CHANNEL_COLUMNS: ColumnSpec<ChannelClaim>[] = [
  {
    id: "address",
    header: "channel",
    type: "mono",
    value: (row) => row.address,
    primary: true,
    title: (row) => row.title ?? row.doc,
    cell: (row) => <KindLabel kind="channel" contextId={row.contextId} value={row.address} />,
  },
  { id: "protocol", header: "protocol", type: "text", value: (row) => row.protocol },
  { id: "service", header: "service", type: "mono", value: (row) => row.serviceId },
  {
    id: "direction",
    header: "used to",
    type: "text",
    value: (row) => row.direction,
    cell: (row) => <DirectionLabel value={row.direction} />,
  },
  { id: "messages", header: "messages", type: "count", value: (row) => row.messages },
  { id: "issue", header: "issue", type: "text", value: (row) => row.issue },
  { id: "source", header: "source", type: "mono", value: (row) => row.source ?? "—" },
];

const MESSAGE_COLUMNS: ColumnSpec<MessageClaim>[] = [
  {
    id: "name",
    header: "message",
    type: "mono",
    value: (row) => row.name,
    primary: true,
    title: (row) => row.title ?? row.doc,
    cell: (row) => <KindLabel kind="message" contextId={row.contextId} value={row.name} />,
  },
  {
    id: "direction",
    header: "direction",
    type: "text",
    value: (row) => row.direction,
    cell: (row) => <DirectionLabel value={row.direction} />,
  },
  { id: "channel", header: "channel", type: "mono", value: (row) => row.address },
  { id: "protocol", header: "protocol", type: "text", value: (row) => row.protocol },
  { id: "service", header: "service", type: "mono", value: (row) => row.serviceId },
  {
    id: "format",
    header: "format",
    type: "text",
    value: (row) => row.encoding ?? row.contentType ?? row.schema?.type ?? "—",
  },
  { id: "issue", header: "issue", type: "text", value: (row) => row.issue },
  { id: "source", header: "source", type: "mono", value: (row) => row.source ?? "—" },
];

function KindLabel({
  kind,
  contextId,
  value,
}: {
  kind: "channel" | "message";
  contextId: string;
  value: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <KindIcon kind={kind} contextId={contextId} />
      <span className="mono truncate">{value}</span>
    </span>
  );
}

function DirectionLabel({ value }: { value: ChannelUsage }) {
  const Icon = value === "send"
    ? ArrowUpRight
    : value === "receive"
      ? ArrowDownLeft
      : value === "both"
        ? ArrowUpDown
        : Minus;
  const color = value === "send"
    ? "dir-send"
    : value === "receive"
      ? "dir-receive"
      : "text-muted";

  return (
    <span className={`inline-flex items-center gap-1.5 ${color}`}>
      <Icon size={13} aria-hidden className="shrink-0" />
      <span>{value}</span>
    </span>
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function Issue({ value }: { value: MessagingIssue }) {
  return (
    <span className={`chip ${value === "clear" ? "" : "status-unresolved"}`}>
      {value}
    </span>
  );
}

function SelectFilter({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  return <Select
    label={`Filter by ${label}`}
    prefix={label}
    value={value}
    onChange={onChange}
    options={[
      { value: "", label: "all" },
      ...values.map((item) => ({ value: item, label: item })),
    ]}
  />;
}

function ChannelDetail({
  claim,
  peers,
  close,
}: {
  claim: ChannelClaim;
  peers: readonly ChannelClaim[];
  close: () => void;
}) {
  return (
    <aside className="rounded-card border border-line bg-canvas p-4 xl:sticky xl:top-4 xl:self-start">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">channel declaration</p>
          <h2 className="mono mt-1 break-all font-semibold">{claim.address}</h2>
        </div>
        <button type="button" className="tbtn shrink-0" onClick={close} aria-label="Close details">
          <X size={13} aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip mono">{claim.protocol}</span>
        <span className="chip">{claim.direction}</span>
        <Issue value={claim.issue} />
      </div>
      {claim.title || claim.doc ? (
        <p className="mt-3 text-sm text-muted">{claim.doc ?? claim.title}</p>
      ) : null}
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">service</dt>
        <dd>
          <Link className="mono text-accent hover:underline" to={serviceBusPath(claim.contextId, claim.serviceSlug, claim.address)}>
            {claim.serviceId}
          </Link>
        </dd>
        <dt className="text-muted">source</dt>
        <dd className="mono break-all">{claim.source ?? "not recorded"}</dd>
        <dt className="text-muted">messages</dt>
        <dd className="tnum">{claim.messages}</dd>
      </dl>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
        same address in {peers.length} {plural(peers.length, "service")}
      </h3>
      <div className="mt-2 flex flex-col gap-2">
        {peers.map((peer) => (
          <Link
            key={peer.id}
            to={serviceBusPath(peer.contextId, peer.serviceSlug, peer.address)}
            className="rounded-control border border-line px-2.5 py-2 hover:border-line-strong"
          >
            <span className="mono block text-accent">{peer.serviceId}</span>
            <span className="mt-0.5 block text-xs text-muted">
              {peer.direction} · {peer.protocol} · {peer.messages} {plural(peer.messages, "message")}
            </span>
          </Link>
        ))}
      </div>
      {peers.length > 1 ? (
        <p className="mt-3 text-xs text-muted">
          These are compared declarations, not one globally merged channel.
        </p>
      ) : null}
    </aside>
  );
}

function MessageDetail({
  claim,
  peers,
  close,
}: {
  claim: MessageClaim;
  peers: readonly MessageClaim[];
  close: () => void;
}) {
  const event = index.eventByWireName.get(claim.name);
  const eventOwner = event ? index.eventOwner.get(event.id) : undefined;
  const eventTo = event?.wire?.channel === claim.address ? eventPath(event.id) : null;
  const senders = unique([
    ...peers.filter((peer) => peer.direction === "send").map((peer) => peer.serviceId),
    ...(eventOwner && event?.wire?.channel === claim.address
      ? [eventOwner.service.id]
      : []),
  ]);
  const receivers = unique(peers.filter((peer) => peer.direction === "receive").map((peer) => peer.serviceId));
  return (
    <aside className="rounded-card border border-line bg-canvas p-4 xl:sticky xl:top-4 xl:self-start">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">message declaration</p>
          <h2 className="mono mt-1 break-all font-semibold">{claim.name}</h2>
          <p className="mono mt-1 break-all text-xs text-muted">{claim.address}</p>
        </div>
        <button type="button" className="tbtn shrink-0" onClick={close} aria-label="Close details">
          <X size={13} aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip">{claim.direction}</span>
        <span className="chip mono">{claim.protocol}</span>
        <Issue value={claim.issue} />
      </div>
      {claim.title || claim.doc ? (
        <p className="mt-3 text-sm text-muted">{claim.doc ?? claim.title}</p>
      ) : null}
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">declaration</dt>
        <dd>
          <Link
            className="mono text-accent hover:underline"
            to={serviceBusPath(claim.contextId, claim.serviceSlug, claim.address, claim)}
          >
            {claim.serviceId}
          </Link>
        </dd>
        <dt className="text-muted">source</dt>
        <dd className="mono break-all">{claim.source ?? "not recorded"}</dd>
        <dt className="text-muted">format</dt>
        <dd className="mono break-all">
          {claim.encoding ?? claim.contentType ?? claim.schema?.type ?? "not declared"}
        </dd>
        <dt className="text-muted">sends</dt>
        <dd className="mono break-all">{senders.join(", ") || "none in catalog"}</dd>
        <dt className="text-muted">receives</dt>
        <dd className="mono break-all">{receivers.join(", ") || "none in catalog"}</dd>
      </dl>
      {eventTo && event && eventOwner ? (
        <div className="mt-4 rounded-control border border-line px-2.5 py-2 text-sm">
          <p className="text-xs text-muted">domain event</p>
          <Link className="mt-0.5 block text-accent hover:underline" to={eventTo}>
            {event.name}
          </Link>
          <p className="mono mt-0.5 text-xs text-muted">{eventOwner.aggregate.id}</p>
        </div>
      ) : null}
      {peers.length > 1 ? (
        <p className="mt-3 text-xs text-muted">
          Services are compared by exact channel and message name; their declarations remain separate claims.
        </p>
      ) : null}
    </aside>
  );
}

export function MessagingIndex() {
  useDocumentTitle("Messaging");
  const [params, setParams] = useSearchParams();
  const inventory = useMemo(() => messagingClaims(catalog), []);
  const mode: Mode = params.get("view") === "messages" ? "messages" : "channels";
  const query = params.get("q") ?? "";
  const context = params.get("context") ?? "";
  const service = params.get("service") ?? "";
  const protocol = params.get("protocol") ?? "";
  const direction = params.get("direction") ?? "";
  const issue = params.get("issue") ?? "";
  const selectedId = params.get("selected") ?? "";

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "selected") next.delete("selected");
    setParams(next, { replace: true });
  };
  const setMode = (nextMode: Mode) => {
    const next = new URLSearchParams(params);
    if (nextMode === "messages") next.set("view", "messages");
    else next.delete("view");
    next.delete("selected");
    next.delete("direction");
    setParams(next, { replace: true });
  };
  const rowLink = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("selected", id);
    return `${paths.messaging()}?${next.toString()}`;
  };
  const needle = query.trim().toLowerCase();
  const common = (row: ChannelClaim | MessageClaim) =>
    (!context || row.contextId === context) &&
    (!service || row.serviceId === service) &&
    (!protocol || row.protocol === protocol) &&
    (!direction || row.direction === direction) &&
    (!issue || row.issue === issue);
  const channels = inventory.channels.filter(
    (row) =>
      common(row) &&
      (!needle ||
        `${row.address} ${row.title ?? ""} ${row.doc ?? ""} ${row.contextId} ${row.contextName} ${row.serviceId} ${row.serviceName} ${row.source ?? ""}`
          .toLowerCase()
          .includes(needle)),
  );
  const messages = inventory.messages.filter(
    (row) =>
      common(row) &&
      (!needle ||
        `${row.name} ${row.title ?? ""} ${row.doc ?? ""} ${row.address} ${row.contextId} ${row.contextName} ${row.serviceId} ${row.serviceName} ${row.source ?? ""}`
          .toLowerCase()
          .includes(needle)),
  );
  const selectedChannel = inventory.channels.find((row) => row.id === selectedId);
  const selectedMessage = inventory.messages.find((row) => row.id === selectedId);
  const contexts = unique(inventory.channels.map((row) => row.contextId));
  const services = unique(inventory.channels.map((row) => row.serviceId));
  const protocols = unique(inventory.channels.map((row) => row.protocol));
  const issues = unique(
    (mode === "channels" ? inventory.channels : inventory.messages).map((row) => row.issue),
  );

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">Messaging</h1>
        <span className="mono text-muted">
          {inventory.channels.length} {plural(inventory.channels.length, "channel claim")} · {inventory.messages.length}{" "}
          {plural(inventory.messages.length, "message claim")}
        </span>
      </div>
      <p className="mt-1 max-w-prose text-sm text-muted">
        What each service declares it sends and receives. Matching names are compared across services, but stay separate claims with their own source.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Messaging inventory">
          <button type="button" className={mode === "channels" ? "is-on" : undefined} aria-pressed={mode === "channels"} onClick={() => setMode("channels")}>channels</button>
          <button type="button" className={mode === "messages" ? "is-on" : undefined} aria-pressed={mode === "messages"} onClick={() => setMode("messages")}>messages</button>
        </div>
        <label className="tbtn gap-1.5 focus-within:border-line-strong">
          <Search size={13} aria-hidden className="shrink-0" />
          <input type="search" value={query} onChange={(event) => set("q", event.target.value)} placeholder="name, address or docs" aria-label="Filter messaging" className="mono w-48 bg-transparent text-ink placeholder:text-muted focus:outline-none" />
        </label>
        <SelectFilter label="context" value={context} values={contexts} onChange={(value) => set("context", value)} />
        <SelectFilter label="service" value={service} values={services} onChange={(value) => set("service", value)} />
        <SelectFilter label="protocol" value={protocol} values={protocols} onChange={(value) => set("protocol", value)} />
        <SelectFilter label="direction" value={direction} values={mode === "channels" ? ["send", "receive", "both", "none"] : ["send", "receive"]} onChange={(value) => set("direction", value)} />
        <SelectFilter label="issue" value={issue} values={issues} onChange={(value) => set("issue", value)} />
      </div>

      {inventory.channels.length === 0 ? (
        <div className="mt-section max-w-table"><Empty>no messaging declarations were discovered</Empty></div>
      ) : (
        <div className={`mt-section grid gap-grid ${selectedChannel || selectedMessage ? "xl:grid-cols-[minmax(0,1fr)_20rem]" : ""}`}>
          <div className="min-w-0 max-w-table">
            {mode === "channels" ? (
              <DataTable tableId="messaging-channels" caption="Channel declarations" columns={CHANNEL_COLUMNS} rows={channels} rowId={(row) => row.id} defaultSort={[{ id: "address", desc: false }]} sortInUrl toolbarAt={Number.MAX_SAFE_INTEGER} rowLink={(row) => rowLink(row.id)} rowClassName={(row) => row.id === selectedId ? "bg-surface" : undefined} empty={<Empty>no channel matches these filters</Empty>} />
            ) : (
              <DataTable tableId="messaging-messages" caption="Message declarations" columns={MESSAGE_COLUMNS} rows={messages} rowId={(row) => row.id} defaultSort={[{ id: "name", desc: false }]} sortInUrl toolbarAt={Number.MAX_SAFE_INTEGER} rowLink={(row) => rowLink(row.id)} rowClassName={(row) => row.id === selectedId ? "bg-surface" : undefined} empty={<Empty>no message matches these filters</Empty>} />
            )}
          </div>
          {selectedChannel ? (
            <ChannelDetail claim={selectedChannel} peers={inventory.channels.filter((row) => row.address === selectedChannel.address)} close={() => set("selected")} />
          ) : selectedMessage ? (
            <MessageDetail claim={selectedMessage} peers={inventory.messages.filter((row) => row.address === selectedMessage.address && row.name === selectedMessage.name)} close={() => set("selected")} />
          ) : null}
        </div>
      )}
    </div>
  );
}
