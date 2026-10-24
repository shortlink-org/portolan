import { plural } from "../lib/format";

export function overviewFinding({
  contexts,
  services,
  flows,
  problems,
  errors,
}: {
  contexts: number;
  services: number;
  flows: number;
  problems: number;
  errors: number;
}): string {
  const counted = (value: number, unit: string) => `${value} ${plural(value, unit)}`;
  const scope = `${counted(contexts, "context")}, ${counted(services, "service")} and ${counted(flows, "flow")}`;
  if (problems === 0) return `No catalog problems across ${scope}.`;
  return `${counted(errors, "error")} and ${counted(Math.max(0, problems - errors), "warning")} across ${scope}.`;
}
