import type { FlowTrigger as Trigger } from "../catalog";

const KIND: Record<Trigger["kind"], string> = {
  http: "HTTP endpoint",
  callback: "callback",
  event: "event",
  message: "message",
  job: "job",
  startup: "startup",
  scheduled: "scheduled",
  manual: "manual",
  unproven: "root unproven",
};

const CONFIDENCE: Record<Trigger["confidence"], string> = {
  high: "status-verified",
  medium: "status-declared",
  low: "status-unresolved",
};

export function FlowTrigger({ trigger }: { trigger: Trigger }) {
  const label = KIND[trigger.kind];
  const detail = trigger.label && trigger.label !== label ? ` · ${trigger.label}` : "";
  return (
    <span
      className={`chip ${CONFIDENCE[trigger.confidence]}`}
      title={`${label}${detail} · ${trigger.confidence}-confidence source evidence`}
    >
      {label}
      <span aria-hidden className="opacity-60"> · </span>
      {trigger.confidence}
    </span>
  );
}
