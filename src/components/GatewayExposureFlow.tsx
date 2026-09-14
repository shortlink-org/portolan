// A service's public Gateway API path as a small, literal topology:
// hostname -> Route -> accepted Gateway listener -> backend Service.

import { useMemo } from "react";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Globe2, Network, Route, Server } from "lucide-react";
import type { GatewayExposure, Service } from "../catalog";
import { allRepos } from "../catalog";
import { catalog } from "../data";
import { sourceLocation, splitLine } from "../lib/source-link";
import { usePhone } from "../app/responsive";

type GatewayNodeKind = "hostname" | "route" | "gateway" | "service";

interface GatewayNodeData extends Record<string, unknown> {
  kind: GatewayNodeKind;
  eyebrow: string;
  label: string;
  sub?: string;
  evidence?: string;
  evidenceClass?: string;
  evidenceTitle?: string;
  sourceLabel?: string;
  sourceHref?: string;
  vertical?: boolean;
}

type GatewayNode = Node<GatewayNodeData, "gatewayExposure">;

const ICONS = {
  hostname: Globe2,
  route: Route,
  gateway: Network,
  service: Server,
} as const;

const HANDLE = { opacity: 0, width: 1, height: 1 } as const;

function GatewayNodeCard({ data }: NodeProps<GatewayNode>) {
  const Icon = ICONS[data.kind];
  return (
    <div className="flow-card flex h-full w-full items-center gap-2 px-2.5" title={`${data.eyebrow}: ${data.label}`}>
      <span className="flow-tile text-accent">
        <Icon size={12} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-px">
        <span className="truncate uppercase text-accent" style={{ fontSize: 9, lineHeight: 1.3, letterSpacing: "0.06em", fontWeight: 600 }}>
          {data.eyebrow}
        </span>
        <span className="mono truncate text-ink" style={{ fontSize: 11, lineHeight: 1.35 }}>
          {data.label}
        </span>
        {data.sub || data.evidence ? (
          <span className="flex min-w-0 items-center gap-1 text-muted" style={{ fontSize: 9, lineHeight: 1.35 }}>
            {data.sub ? <span className="mono truncate">{data.sub}</span> : null}
            {data.evidence ? <span className={`chip shrink-0 ${data.evidenceClass ?? ""}`} title={data.evidenceTitle}>{data.evidence}</span> : null}
            {data.sourceLabel ? data.sourceHref ? (
              <a href={data.sourceHref} target="_blank" rel="noreferrer" className="nodrag nopan mono truncate hover:text-ink hover:underline" title="Route manifest at the built commit">
                {data.sourceLabel}
              </a>
            ) : <span className="mono truncate">{data.sourceLabel}</span> : null}
          </span>
        ) : null}
      </div>
      <Handle type="target" position={data.vertical ? Position.Top : Position.Left} style={HANDLE} />
      <Handle type="source" position={data.vertical ? Position.Bottom : Position.Right} style={HANDLE} />
    </div>
  );
}

const nodeTypes = { gatewayExposure: GatewayNodeCard };

function routeSource(exposure: GatewayExposure, service: Service): string {
  const source = exposure.source ?? "";
  if (!source || !service.path || source.startsWith(`${service.path}/`)) return source;
  return `${service.path.replace(/\/$/, "")}/${source}`;
}

function evidence(exposure: GatewayExposure): Pick<GatewayNodeData, "evidence" | "evidenceClass" | "evidenceTitle"> {
  if (exposure.drift) {
    const details = [
      exposure.drift.hostnames ? `manifest hostnames: ${exposure.drift.hostnames.join(", ") || "not constrained"}` : "",
      exposure.drift.protocol ? `manifest protocol: ${exposure.drift.protocol}` : "",
      exposure.drift.port ? `manifest port: ${exposure.drift.port}` : "",
    ].filter(Boolean).join("\n");
    return { evidence: "drift", evidenceClass: "status-unresolved", evidenceTitle: details };
  }
  if (exposure.basis === "manifest") return { evidence: "manifest", evidenceClass: "status-declared", evidenceTitle: "declared in the manifest; the cluster API has not confirmed it" };
  if (exposure.basis === "both") return { evidence: "both", evidenceClass: "status-verified", evidenceTitle: "manifest and cluster API agree" };
  return { evidence: "cluster API", evidenceClass: "", evidenceTitle: "read from the live cluster" };
}

function diagram(exposures: GatewayExposure[], service: Service, vertical: boolean): { nodes: GatewayNode[]; edges: Edge[]; height: number } {
  const layers: GatewayNode[][] = [[], [], [], []];
  const seen = new Map<string, GatewayNode>();
  const edges = new Map<string, Edge>();
  const add = (layer: number, node: GatewayNode) => {
    const held = seen.get(node.id);
    if (held) return held.id;
    seen.set(node.id, node);
    layers[layer]!.push(node);
    return node.id;
  };
  const connect = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (!edges.has(id)) edges.set(id, {
      id,
      source,
      target,
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: { strokeWidth: 1.25 },
    });
  };

  for (const exposure of exposures) {
    const source = routeSource(exposure, service);
    const location = source ? sourceLocation(source, service, allRepos(catalog)) : null;
    const sourceLabel = source ? splitLine(source).path.split("/").pop() : undefined;
    const route = add(1, {
      id: `route:${exposure.routeKind}:${exposure.routeNamespace}/${exposure.routeName}`,
      type: "gatewayExposure",
      position: { x: 0, y: 0 },
      data: {
        kind: "route",
        eyebrow: exposure.routeKind,
        label: `${exposure.routeNamespace}/${exposure.routeName}`,
        ...evidence(exposure),
        sourceLabel,
        sourceHref: location?.href ?? undefined,
      },
      style: { width: 210, height: 68 },
    });
    const gateway = add(2, {
      id: `gateway:${exposure.gatewayNamespace}/${exposure.gatewayName}#${exposure.listener}`,
      type: "gatewayExposure",
      position: { x: 0, y: 0 },
      data: {
        kind: "gateway",
        eyebrow: "Gateway listener",
        label: `${exposure.gatewayNamespace}/${exposure.gatewayName} · ${exposure.listener}`,
        sub: `${exposure.protocol}:${exposure.port}`,
      },
      style: { width: 210, height: 68 },
    });
    const backend = add(3, {
      id: `service:${exposure.backendNamespace}/${exposure.backendName}`,
      type: "gatewayExposure",
      position: { x: 0, y: 0 },
      data: {
        kind: "service",
        eyebrow: "Backend Service",
        label: `${exposure.backendNamespace}/${exposure.backendName}`,
      },
      style: { width: 190, height: 60 },
    });
    const hostnames = exposure.hostnames.length ? exposure.hostnames : ["not constrained"];
    for (const hostname of hostnames) {
      const host = add(0, {
        id: `hostname:${hostname}`,
        type: "gatewayExposure",
        position: { x: 0, y: 0 },
        data: { kind: "hostname", eyebrow: "Hostname", label: hostname },
        style: { width: 190, height: 60 },
      });
      connect(host, route);
    }
    connect(route, gateway);
    connect(gateway, backend);
  }

  const count = Math.max(...layers.map((layer) => layer.length), 1);
  const gapY = 86;
  const width = [190, 210, 210, 190];
  const x = [0, 255, 530, 805];
  for (let layer = 0; layer < layers.length; layer += 1) {
    const nodes = layers[layer]!;
    const offset = vertical ? ((count - nodes.length) * 220) / 2 : ((count - nodes.length) * gapY) / 2;
    nodes.forEach((node, i) => {
      node.position = vertical
        ? { x: offset + i * 220, y: layer * 92 }
        : { x: x[layer]!, y: offset + i * gapY };
      node.data.vertical = vertical;
      node.style = { ...node.style, width: width[layer] ?? 190 };
    });
  }
  return {
    nodes: layers.flat(),
    edges: [...edges.values()],
    height: vertical ? 420 : Math.min(460, Math.max(220, 150 + (count - 1) * gapY)),
  };
}

function Canvas({ exposures, service }: { exposures: GatewayExposure[]; service: Service }) {
  const phone = usePhone();
  const graph = useMemo(() => diagram(exposures, service, phone), [exposures, service, phone]);
  return (
    <div className="canvas-motion w-full overflow-hidden rounded-card border border-line bg-canvas shadow-xs" style={{ height: graph.height }}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1.1 }}
        minZoom={0.25}
        maxZoom={1.5}
        key={phone ? "phone" : "wide"}
      >
        <Background gap={20} size={2} />
      </ReactFlow>
    </div>
  );
}

export function GatewayExposureFlow({ exposures, service }: { exposures: GatewayExposure[]; service: Service }) {
  return (
    <ReactFlowProvider>
      <Canvas exposures={exposures} service={service} />
    </ReactFlowProvider>
  );
}
