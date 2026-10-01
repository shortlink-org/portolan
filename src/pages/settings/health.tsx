import type { SetupInfo, SetupRunStep, SetupRunStepStatus } from "../../lib/setup-info";

export type Health = "healthy" | "changed" | "failed" | "unchecked";

export function duration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
}

export function healthFor(steps: SetupRunStep[], expected: number, setupInfo: SetupInfo): Health {
  if (
    expected === 0 ||
    setupInfo.reportStale ||
    !setupInfo.run ||
    setupInfo.run.status === "running" ||
    steps.length < expected
  ) {
    return "unchecked";
  }
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "drifted")) return "changed";
  return "healthy";
}

export const HEALTH_LABEL: Record<Health, string> = {
  healthy: "healthy",
  changed: "out of date",
  failed: "failed",
  unchecked: "not checked",
};

export function HealthBadge({ health }: { health: Health }) {
  const style =
    health === "healthy"
      ? "status-verified"
      : health === "unchecked"
        ? "text-muted"
        : health === "changed"
          ? "status-declared"
          : "status-unresolved";
  return <span className={`chip ${style}`}>{HEALTH_LABEL[health]}</span>;
}

export function StepStatus({ status }: { status: SetupRunStepStatus }) {
  const health: Health =
    status === "failed"
      ? "failed"
      : status === "drifted"
        ? "changed"
        : "healthy";
  return (
    <span className={`chip ${health === "healthy" ? "status-verified" : health === "changed" ? "status-declared" : "status-unresolved"}`}>
      {status}
    </span>
  );
}
