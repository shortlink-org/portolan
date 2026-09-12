// Which project a recording of a flow belongs to.
//
// A recording is kept beside the project whose verify step reads it, and a
// flow says which context owns it - one level up from a project. The project
// is the one in that context whose service the flow runs through; when the
// context has one project, that one; otherwise the page has to ask.

import type { Flow } from "../catalog";
import type { SetupProject } from "./setup-info";

/** The projects a flow's recording could be kept under, the likeliest first. */
export function projectsForFlow(
  projects: readonly SetupProject[],
  flow: Pick<Flow, "owner" | "participants">,
): SetupProject[] {
  const inContext = projects.filter(
    (project) => (project.group ?? project.context) === flow.owner,
  );
  const services = new Set(
    flow.participants
      .filter((p) => p.kind === "service" && p.context === flow.owner)
      .map((p) => p.id.split(".").slice(1).join(".")),
  );
  const runsThrough = (project: SetupProject) =>
    services.has(project.component ?? project.service ?? "");

  return [...inContext].sort(
    (a, b) => Number(runsThrough(b)) - Number(runsThrough(a)) || a.id.localeCompare(b.id),
  );
}

/** The one project a recording of the flow goes to, or null when it has to be asked. */
export function projectForFlow(
  projects: readonly SetupProject[],
  flow: Pick<Flow, "owner" | "participants">,
): SetupProject | null {
  const candidates = projectsForFlow(projects, flow);
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) return null;
  const services = new Set(
    flow.participants
      .filter((p) => p.kind === "service" && p.context === flow.owner)
      .map((p) => p.id.split(".").slice(1).join(".")),
  );
  const through = candidates.filter((project) =>
    services.has(project.component ?? project.service ?? ""),
  );

  return through.length === 1 ? through[0]! : null;
}
