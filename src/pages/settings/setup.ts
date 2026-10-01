import { createContext, useContext } from "react";
import { setupInfo as staticSetupInfo } from "../../lib/setup-info";
import type { SetupInfo, SetupProject } from "../../lib/setup-info";
import type { ProjectDraft } from "../../lib/local-api";

export type ProjectSource = ProjectDraft["source"];

export const SetupContext = createContext<SetupInfo>(staticSetupInfo);
export const useSetup = () => useContext(SetupContext);

export function starterProject(setupInfo: SetupInfo): SetupProject | undefined {
  if (setupInfo.projects.length !== 1) return undefined;
  const project = setupInfo.projects[0];
  const steps = setupInfo.steps.filter((step) => step.projectId === project?.id);
  return project?.root === "." && !project.groupKind && !project.componentKind && steps.length === 1 && steps[0]?.plugin === "project" ? project : undefined;
}
